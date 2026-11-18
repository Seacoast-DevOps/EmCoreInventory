using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Auth;

public static partial class IdentityService
{
    private static IResult GetUsers(HttpContext http, DatabaseStore store)
    {
        using var db = store.OpenIdentity();
        var user = AuditSession(http, db);
        RequireAdmin(user);
        RequireCompany(user);
        var rows = (from account in db.Users.AsNoTracking()
                    join membership in db.ServiceMemberships.AsNoTracking() on account.Id equals membership.UserId
                    where membership.ServiceId == user.ServiceId
                    orderby account.Name
                    select new { account, membership }).ToList();
        return Results.Json(new
        {
            users = rows.Select(row => new
            {
                row.account.Id, row.account.Username, row.account.Name, tags = Body.ReadStrings(row.membership.Tags),
                active = row.membership.Active != 0, row.account.LicenseLevel, platformAdmin = row.account.PlatformRole == PlatformRole
            })
        });
    }

    private static IResult GetCompanies(HttpContext http, DatabaseStore store)
    {
        using var db = store.OpenIdentity();
        var user = Session(http, db);
        var platform = AccessService.IsSeacoast(user);
        var companies = db.Services.AsNoTracking().Where(s => s.Internal == 0);
        if (!platform)
        {
            companies = from company in companies
                        join membership in db.ServiceMemberships.AsNoTracking() on company.Id equals membership.ServiceId
                        where membership.UserId == user.Id && membership.Active == 1 && company.Active == 1
                        select company;
        }

        var rows = companies.OrderBy(s => s.Name).ToList();
        var services = rows.Select(company =>
        {
            var result = new JsonObject();
            if (AccessService.CompanyAdmin(user) && (platform || company.Id == user.ServiceId))
                result = Body.Object(company.Details);
            result["id"] = company.Id;
            result["name"] = company.Name;
            result["active"] = company.Active != 0;
            return result;
        }).ToArray();
        return Results.Json(new
        {
            services,
            deletedCompanies = platform ? db.CompanyTombstones.AsNoTracking().OrderByDescending(c => c.DeletedAt).ToArray() : []
        });
    }

    private static IResult SaveCompany(HttpContext http, DatabaseStore store, CompanySaveRequest request)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = AuditSession(http, db);
        RequireAdmin(user);
        var creating = request.Id is null;
        Service company;
        if (creating)
        {
            if (!AccessService.IsSeacoast(user))
                throw new ApiException(403, "Only Seacoast Admin can create a company");
            company = new Service { Id = Guid.NewGuid().ToString() };
            db.Services.Add(company);
            db.ServiceMemberships.Add(new ServiceMembership
            {
                UserId = user.Id,
                ServiceId = company.Id,
                Tags = Body.Encode(AccessService.DefaultTags(user.LicenseLevel, "Company Admin"))
            });
        }
        else
        {
            if (request.Id != user.ServiceId)
                throw new ApiException(403, "Select a service before editing it");
            company = LockCompany(db, request.Id);
        }

        var details = CompanyDetails(request);
        company.Name = details.Text("name");
        company.Details = details.ToJsonString();
        Audit(db, user, creating ? "Service created" : "Service updated",
            new { fields = details.Where(pair => pair.Value?.GetValue<string>() != "").Select(pair => pair.Key).ToArray() },
            company.Id);
        db.SaveChanges();
        tx.Commit();
        return Results.Ok(new { ok = true });
    }

    private static IResult SaveUser(HttpContext http, DatabaseStore store, UserSaveRequest request)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var actor = AuditSession(http, db);
        RequireAdmin(actor);
        RequireCompany(actor);
        LockCompany(db, actor.ServiceId);

        var fields = UserFields(request.Username, request.Name);
        var (license, tags) = AccountTags(request);
        var password = request.Password ?? "";
        var creating = request.Id is null;
        var id = creating ? Guid.NewGuid().ToString() : RequestId(request.Id!);
        var membership = creating ? null : db.ServiceMemberships.Find(id, actor.ServiceId);
        var row = membership is null ? null : db.Users.Find(id);
        if (!creating && (row is null || membership is null))
            throw new ApiException(404, "User not found in this service");
        if (creating || password.Length > 0) ValidPassword(password);

        var platformActor = AccessService.IsSeacoast(actor);
        var platformTarget = row?.PlatformRole == PlatformRole;
        if (!platformActor && (request.PlatformAdmin == true || platformTarget))
            throw new ApiException(403, "Only Seacoast Admin can manage platform administrators");
        if (platformTarget && request.PlatformAdmin == false && db.Users.Count(u => u.PlatformRole == PlatformRole) == 1)
            throw new ApiException(400, "Keep at least one Seacoast Admin");

        if (db.Users.Any(u => u.Username.ToLower() == fields.Username && u.Id != id))
            throw new ApiException(409, "Username already exists");

        if (row is not null)
        {
            var profileChanged = row.Username != fields.Username || row.Name != fields.Name || row.LicenseLevel != license;
            if (!platformActor && (profileChanged || password.Length > 0) &&
                db.ServiceMemberships.Any(m => m.UserId == id && m.ServiceId != actor.ServiceId))
                throw new ApiException(403, "Only Seacoast Admin can change the profile or password of a user shared by multiple companies");

            if (profileChanged || password.Length > 0 || !request.Active ||
                (request.PlatformAdmin is { } platformAdmin && platformAdmin != platformTarget))
                LockUserCompanies(db, id);

            ProtectLastCompanyAdmin(db, actor.ServiceId, id, request.Active, tags);
            if (password.Length > 0 || !request.Active)
                db.UserSessions.Where(s => s.UserId == id).ExecuteDelete();
        }
        else
        {
            row = new User { Id = id, CreatedAt = Body.Now() };
            db.Users.Add(row);
            membership = new ServiceMembership { UserId = id, ServiceId = actor.ServiceId };
            db.ServiceMemberships.Add(membership);
        }

        row.Username = fields.Username;
        row.Name = fields.Name;
        row.LicenseLevel = license;
        if (request.PlatformAdmin is { } platform) row.PlatformRole = platform ? PlatformRole : "";
        if (password.Length > 0) row.PasswordHash = PasswordHash.Create(password);
        membership!.Tags = Body.Encode(tags);
        membership.Active = request.Active ? 1 : 0;
        Audit(db, actor, creating ? "User created" : "User updated", new
        {
            userId = id, username = fields.Username, tags, active = request.Active,
            platformAdmin = row.PlatformRole == PlatformRole, passwordReset = password.Length > 0 && !creating
        });
        db.SaveChanges();
        tx.Commit();
        return Results.Ok(new { ok = true });
    }

    private static (string License, string[] Tags) AccountTags(UserSaveRequest request)
    {
        var supplied = request.Tags;
        if (supplied.Contains(PlatformRole))
            throw new ApiException(403, "Assign platform access separately");
        if (supplied.Any(tag => !PolicyCatalog.Tags.Any(option => option.Id == tag)))
            throw new ApiException(400, "Choose valid role and permission tags");
        if (supplied.Count(PolicyCatalog.LicenseLevels.Contains) > 1)
            throw new ApiException(400, "Choose one clinical license level");
        var license = request.LicenseLevel ?? PolicyCatalog.LicenseLevels.LastOrDefault(supplied.Contains) ?? "Driver";
        if (!PolicyCatalog.LicenseLevels.Contains(license))
            throw new ApiException(400, "Choose a clinical license level");
        var tags = supplied.Where(t => !PolicyCatalog.LicenseLevels.Contains(t))
            .Select(t => t == "Service Admin" ? "Company Admin" : t).Append(license).Distinct().ToArray();
        if (tags.Contains("Supervisor") && tags.Contains("Company Admin"))
            throw new ApiException(400, "Choose one organization role");
        return (license, tags);
    }

    private static void ProtectLastCompanyAdmin(InventoryDbContext db, string serviceId, string id, bool active, string[] tags)
    {
        if (active && CanAdministerCompany(tags)) return;
        var admins = db.ServiceMemberships.Where(m => m.ServiceId == serviceId && m.Active == 1)
            .Select(m => new { m.UserId, m.Tags }).ToList()
            .Where(m => CanAdministerCompany(Body.ReadStrings(m.Tags))).Select(m => m.UserId).ToList();
        if (admins.Count == 1 && admins[0] == id)
            throw new ApiException(400, "Keep at least one active Service Admin");
    }

    private static bool CanAdministerCompany(string[] tags) =>
        !tags.Contains("Read Only") && tags.Any(t => t is "Company Admin" or "Service Admin");

    private static IResult SetCompanyStatus(HttpContext http, DatabaseStore store, CompanyStatusRequest request)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = AuditSession(http, db);
        RequireLifecycleAdmin(user);
        var company = LockCompany(db, request.Id);
        LockService(db, user.ServiceId);

        company.Active = request.Active ? 1 : 0;
        db.UserSessions.Where(s => s.ServiceId == company.Id || s.TokenHash == user.TokenHash).ExecuteDelete();
        Audit(db, user, request.Active ? "Company reactivated" : "Company deactivated", new { companyId = company.Id }, company.Id);
        return CommitSession(http, db, tx, user.Id, PlatformId);
    }

    private static async Task<IResult> DeleteCompany(HttpContext http, DatabaseStore store, CompanyDeleteRequest request)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = AuditSession(http, db);
        RequireLifecycleAdmin(user);
        var company = LockCompany(db, request.Id);
        LockService(db, user.ServiceId);

        if (!PasswordHash.Matches(request.CurrentPassword, db.Users.Find(user.Id)!.PasswordHash))
            throw new ApiException(400, "Current password is incorrect");
        if (request.ConfirmCompanyName != company.Name || !request.AcknowledgePermanentDeletion)
            throw new ApiException(400, "Confirm the exact company name and permanent deletion");

        await store.PurgeCompanyAsync(company.Id, db, http.RequestAborted);
        db.UserSessions.Where(s => s.ServiceId == company.Id || s.TokenHash == user.TokenHash).ExecuteDelete();
        db.ServiceMemberships.Where(m => m.ServiceId == company.Id).ExecuteDelete();
        db.Services.Remove(company);
        db.CompanyTombstones.Add(new CompanyTombstone { Id = company.Id, Name = company.Name, DeletedAt = Body.Now(), ActorId = user.Id });
        Audit(db, user, "Company permanently deleted", new { companyId = company.Id }, PlatformId);
        return CommitSession(http, db, tx, user.Id, PlatformId);
    }

    private static void RequireLifecycleAdmin(UserContext user)
    {
        if (!AccessService.IsSeacoast(user) || user.Tags.Contains("Read Only"))
            throw new ApiException(403, "Only Seacoast Admin can deactivate, reactivate, or delete companies");
    }

    private static Service LockCompany(InventoryDbContext db, string id) =>
        LockService(db, RequestId(id)) is { Internal: 0 } company ? company : throw new ApiException(404, "Company not found");

    private static string RequestId(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 128 || id.Any(char.IsControl))
            throw new ApiException(400, "Invalid identifier");
        return id;
    }

    private static JsonObject CompanyDetails(CompanySaveRequest request)
    {
        var details = JsonSerializer.SerializeToNode(request, Body.Options)!.AsObject();
        details.Remove("id");
        foreach (var key in details.Select(pair => pair.Key).ToList())
        {
            var value = details.Text(key);
            if (value.Length > (key == "notes" ? 2000 : 500) || value.Contains('\0'))
                throw new ApiException(400, "Invalid " + key);
            details[key] = value.Trim();
        }

        if (details.Text("name") == "" || details.Text("name").Any(char.IsControl))
            throw new ApiException(400, "Service name is required");
        var deaNumber = details.Text("deaNumber").ToUpperInvariant();
        if (deaNumber.Length > 0 && !Regex.IsMatch(deaNumber, @"\A[A-Z]{2}[0-9]{7}\z"))
            throw new ApiException(400, "DEA registration number must have two letters and seven digits");
        details["deaNumber"] = deaNumber;
        var expires = details.Text("deaExpiresOn");
        if (expires.Length > 0 && !DateOnly.TryParseExact(expires, "yyyy-MM-dd", out _))
            throw new ApiException(400, "Enter a valid DEA expiration date");
        return details;
    }
}
