using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Auth;

public static class IdentityService
{
    public static void Initialize(InventoryDbContext db)
    {
        if (!db.Services.Any(s => s.Id == "platform")) db.Services.Add(new Service { Id = "platform", Name = "Seacoast administration", Internal = 1 });
        if (!db.CompanyMigrations.Any(m => m.Version == 1))
        {
            foreach (var user in db.Users)
            {
                var memberships = db.ServiceMemberships.Where(m => m.UserId == user.Id).ToList();
                var tags = memberships.SelectMany(m => Body.ReadStrings(m.Tags)).ToArray();
                user.LicenseLevel = PolicyCatalog.LicenseLevels.LastOrDefault(tags.Contains) ?? "Driver";
                foreach (var membership in memberships) membership.Tags = Body.Encode(Body.ReadStrings(membership.Tags).Select(t => t == "Service Admin" ? "Company Admin" : t));
            }
            var founderId = db.IdentityAudits.Where(a => a.Action == "Initial administrator created").OrderBy(a => a.Id).Select(a => a.ActorId).FirstOrDefault();
            if (founderId is not null && db.Users.Find(founderId) is { } founder) founder.PlatformRole = "Seacoast Admin";
            db.CompanyMigrations.Add(new CompanyMigration { Version = 1 });
        }
        db.SaveChanges();
    }
    public static UserContext Effective(User row, Service service, ServiceMembership? membership = null)
    {
        var license = string.IsNullOrEmpty(row.LicenseLevel) ? "Driver" : row.LicenseLevel;
        var tags = membership is null ? AccessService.DefaultTags(license, "Company Admin") : Body.ReadStrings(membership.Tags);
        return new UserContext { Id = row.Id, Username = row.Username, Name = row.Name, LicenseLevel = license, PlatformRole = row.PlatformRole,
            Tags = tags.Where(t => !PolicyCatalog.LicenseLevels.Contains(t) && t != "Seacoast Admin").Append(license).Concat(row.PlatformRole == "Seacoast Admin" ? ["Seacoast Admin"] : Array.Empty<string>()).Distinct().ToArray(),
            ServiceId = service.Id, ServiceName = service.Name, CompanyActive = service.Active != 0 };
    }
    public static UserContext Session(HttpContext http, InventoryDbContext db)
    {
        var token = http.Request.Cookies["emcore_session"];
        if (token is null || !Regex.IsMatch(token, "^[a-f0-9]{64}$")) throw new ApiException(401, "Sign in to continue");
        var hash = PasswordHash.Hash(token);
        var session = db.UserSessions.AsNoTracking().FirstOrDefault(s => s.TokenHash == hash);
        if (session is null || session.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) throw new ApiException(401, "Session expired or company/account deactivated. Sign in again.");
        var user = db.Users.AsNoTracking().FirstOrDefault(u => u.Id == session.UserId);
        var service = db.Services.AsNoTracking().FirstOrDefault(s => s.Id == session.ServiceId);
        var membership = db.ServiceMemberships.AsNoTracking().FirstOrDefault(m => m.UserId == session.UserId && m.ServiceId == session.ServiceId);
        if (user is null || service is null || (user.PlatformRole != "Seacoast Admin" && (membership?.Active != 1 || service.Active == 0 || service.Internal != 0))) throw new ApiException(401, "Session expired or company/account deactivated. Sign in again.");
        return Effective(user, service, membership) with { TokenHash = hash };
    }
    public static void Audit(InventoryDbContext db, UserContext? user, string action, object details, string? serviceId = null)
    {
        db.IdentityAudits.Add(new IdentityAudit { ServiceId = serviceId ?? user?.ServiceId, ActorId = user?.Id, Actor = user?.Actor ?? "Initial setup", Action = action, Details = Body.Encode(details), CreatedAt = Body.Now() });
    }
    private static void Issue(HttpContext http, InventoryDbContext db, string userId, string serviceId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.ExpiresAt <= now));
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        db.UserSessions.Add(new UserSession { TokenHash = PasswordHash.Hash(token), UserId = userId, ServiceId = serviceId, ExpiresAt = now + 8 * 3600000 });
        http.Response.Cookies.Append("emcore_session", token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromHours(8), Secure = http.Request.IsHttps || Environment.GetEnvironmentVariable("EMCORE_SECURE_COOKIE") == "1" });
    }
    internal static void ValidPassword(string? password)
    {
        if (password is null || password.Length is < 12 or > 128) throw new ApiException(400, "Use a password between 12 and 128 characters");
    }
    private static (string Username, string Name) UserFields(JsonObject body)
    {
        var username = body.Text("username"); var name = body.Text("name");
        if (!Regex.IsMatch(username, "^[a-zA-Z0-9._@+-]{3,80}$") || string.IsNullOrWhiteSpace(name) || name.Length > 100) throw new ApiException(400, "Enter a name and username (3–80 letters, numbers, . _ @ + or -)");
        if (!AccessService.TagsValid(body["tags"]) || body.Strings("tags").Length == 0) throw new ApiException(400, "Choose valid role and permission tags");
        return (username.ToLowerInvariant(), name.Trim());
    }
    private static JsonObject ServiceFields(JsonObject body)
    {
        var result = new JsonObject();
        foreach (var key in new[] { "name", "deaRegistrant", "deaNumber", "deaExpiresOn", "deaSchedules", "address", "contactName", "contactEmail", "contactPhone", "notes", "serviceChief", "deaContact", "backupDeaContact", "medicalDirector", "assistantMedicalDirector" })
        {
            if (body[key] is not null) Body.RequireString(body, key, key == "notes" ? 2000 : 500, false);
            result[key] = body.Text(key).Trim();
        }
        if (result.Text("name") == "") throw new ApiException(400, "Service name is required");
        result["deaNumber"] = result.Text("deaNumber").ToUpperInvariant();
        if (result.Text("deaNumber") != "" && !Regex.IsMatch(result.Text("deaNumber"), "^[A-Z]{2}[0-9]{7}$")) throw new ApiException(400, "DEA registration number must have two letters and seven digits");
        if (result.Text("deaExpiresOn") != "" && !DateOnly.TryParseExact(result.Text("deaExpiresOn"), "yyyy-MM-dd", out _)) throw new ApiException(400, "Enter a valid DEA expiration date");
        return result;
    }
    public static void RecordFailure(InventoryDbContext db, string key)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.LoginAttempts.RemoveRange(db.LoginAttempts.Where(a => a.UntilMs < now));
        db.SaveChanges();
        var attempt = db.LoginAttempts.Find(key);
        if (attempt is null) db.LoginAttempts.Add(new LoginAttempt { Key = key, Failures = 1, UntilMs = now + 900000 });
        else attempt.Failures++;
        db.SaveChanges();
    }
    private static void CheckAttempts(InventoryDbContext db, string key, bool witness = false)
    {
        var attempt = db.LoginAttempts.AsNoTracking().FirstOrDefault(a => a.Key == key);
        if (attempt is not null && attempt.UntilMs > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() && attempt.Failures >= 5) throw new ApiException(429, witness ? "Too many witness sign-in attempts. Try again in 15 minutes." : "Too many attempts. Try again in 15 minutes.");
    }
    public static UserContext VerifyWitnessCredentials(InventoryDbContext db, JsonObject? credentials, UserContext actor, string remoteAddress)
    {
        var username = credentials?.Text("username").Trim().ToLowerInvariant() ?? ""; username = username[..Math.Min(username.Length, 80)];
        var key = PasswordHash.Hash("witness:" + remoteAddress + ":" + username);
        CheckAttempts(db, key, true);
        var user = db.Users.AsNoTracking().FirstOrDefault(u => u.Username.ToLower() == username);
        var service = db.Services.AsNoTracking().FirstOrDefault(s => s.Id == actor.ServiceId && s.Active == 1);
        var membership = user is null ? null : db.ServiceMemberships.AsNoTracking().FirstOrDefault(m => m.UserId == user.Id && m.ServiceId == actor.ServiceId && m.Active == 1);
        var valid = PasswordHash.Matches(credentials?.Text("password"), user?.PasswordHash);
        if (user is null || membership is null || service is null || !valid) throw new ApiException(422, "Witness username or password is incorrect, or the account is inactive in this service.", new { witnessFailureKey = key });
        var witness = Effective(user, service, membership);
        if (witness.Id == actor.Id) throw new ApiException(422, "The witness must be a different user from the signed-in operator.");
        if (!witness.Tags.Contains("Can Witness") || witness.Tags.Contains("Read Only")) throw new ApiException(422, "This user must have Can Witness and must not be Read Only.");
        db.LoginAttempts.RemoveRange(db.LoginAttempts.Where(a => a.Key == key));
        return witness;
    }
    public static WebApplication MapIdentityEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/status", (HttpContext http, DatabaseStore store) =>
        {
            using var db = store.OpenIdentity(); UserContext? user = null;
            try { user = Session(http, db); } catch (ApiException) { }
            return Results.Json(new { setupRequired = !db.Users.Any(), user = user is null ? null : new { user.Id, user.Name, user.Username, user.ServiceId, user.ServiceName, user.Tags, user.LicenseLevel, user.PlatformRole, user.PlatformOnly } });
        });
        foreach (var path in new[] { "/api/auth/setup", "/api/auth/login", "/api/auth/logout", "/api/auth/password", "/api/auth/service", "/api/users", "/api/services", "/api/companies/status", "/api/companies/delete" })
            app.MapPost(path, HandlePost).AddEndpointFilter(AuditDenied);
        app.MapGet("/api/services", (HttpContext http, DatabaseStore store) => { using var db = store.OpenIdentity(); return Results.Json(Companies(db, Session(http, db))); }).AddEndpointFilter(AuditDenied);
        app.MapGet("/api/users", (HttpContext http, DatabaseStore store) =>
        {
            using var db = store.OpenIdentity(); var user = Session(http, db); RequireAdmin(user);
            if (user.PlatformOnly) throw new ApiException(400, "Select a company before managing its users");
            var rows = (from u in db.Users.AsNoTracking() join m in db.ServiceMemberships.AsNoTracking() on u.Id equals m.UserId where m.ServiceId == user.ServiceId orderby u.Name select new { u, m }).ToList();
            return Results.Json(new { users = rows.Select(row => new { row.u.Id, row.u.Username, row.u.Name, tags = Body.ReadStrings(row.m.Tags), active = row.m.Active != 0, row.u.LicenseLevel, platformAdmin = row.u.PlatformRole == "Seacoast Admin" }) });
        }).AddEndpointFilter(AuditDenied);
        return app;
    }
    private static async ValueTask<object?> AuditDenied(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        try { return await next(invocation); }
        catch (ApiException error) when (error.Status == 403)
        {
            var http = invocation.HttpContext;
            using var db = http.RequestServices.GetRequiredService<DatabaseStore>().OpenIdentity();
            UserContext? user = null;
            try { user = Session(http, db); } catch (ApiException) { }
            if (user is not null)
            {
                Audit(db, user, "Access denied: " + http.Request.Method + " " + http.Request.Path, new { error = error.Message });
                db.SaveChanges();
            }
            throw;
        }
    }
    private static async Task<IResult> HandlePost(HttpContext http, DatabaseStore store)
    {
        var path = http.Request.Path.Value!;
        var body = await http.Request.ReadFromJsonAsync<JsonObject>() ?? throw new ApiException(400, "Expected a JSON object");
        using var db = store.OpenIdentity();
        if (path == "/api/auth/setup") { Setup(http, db, body); return Results.Ok(new { ok = true }); }
        if (path == "/api/auth/login") { Login(http, db, body); return Results.Ok(new { ok = true }); }
        var user = Session(http, db);
        if (path == "/api/auth/logout")
        {
            db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.TokenHash == user.TokenHash)); Audit(db, user, "Signed out", new { }); db.SaveChanges();
            http.Response.Cookies.Delete("emcore_session", new CookieOptions { Path = "/", HttpOnly = true, SameSite = SameSiteMode.Strict });
        }
        else if (path == "/api/auth/password")
        {
            var row = db.Users.Find(user.Id)!;
            if (!PasswordHash.Matches(body.Text("currentPassword"), row.PasswordHash)) throw new ApiException(400, "Current password is incorrect");
            ValidPassword(body.Text("password"));
            using var tx = db.Database.BeginTransaction(); row.PasswordHash = PasswordHash.Create(body.Text("password"));
            db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.UserId == user.Id)); Audit(db, user, "Password changed", new { }); Issue(http, db, user.Id, user.ServiceId); db.SaveChanges(); tx.Commit();
        }
        else if (path == "/api/auth/service")
        {
            var id = body.Text("serviceId"); var service = db.Services.Find(id);
            if (service is null || (!AccessService.IsSeacoast(user) && (service.Active == 0 || service.Internal != 0 || !db.ServiceMemberships.Any(m => m.UserId == user.Id && m.ServiceId == id && m.Active == 1)))) throw new ApiException(403, "You do not belong to that service");
            db.UserSessions.Find(user.TokenHash)!.ServiceId = id; Audit(db, user, "Service selected", new { }, id); db.SaveChanges();
        }
        else if (path.StartsWith("/api/companies/")) { CompanyLifecycle(http, db, store, user, path, body); }
        else
        {
            RequireAdmin(user);
            if (user.PlatformOnly && path == "/api/users") throw new ApiException(400, "Select a company before managing its users");
            using var tx = db.Database.BeginTransaction();
            if (path == "/api/users") SaveUser(db, user, body);
            else if (path == "/api/services") SaveCompany(db, user, body);
            else throw new ApiException(404, "Not found");
            db.SaveChanges(); tx.Commit();
        }
        return Results.Ok(new { ok = true });
    }
    private static void Setup(HttpContext http, InventoryDbContext db, JsonObject body)
    {
        var license = body.Text("licenseLevel", "Driver");
        if (!PolicyCatalog.LicenseLevels.Contains(license)) throw new ApiException(400, "Choose a clinical license");
        body["tags"] = new JsonArray(AccessService.DefaultTags(license, "Company Admin").Select(t => (JsonNode?)JsonValue.Create(t)).ToArray());
        var fields = UserFields(body); var details = ServiceFields(new JsonObject { ["name"] = body.Text("serviceName") }); ValidPassword(body.Text("password"));
        using var tx = db.Database.BeginTransaction();
        if (db.Users.Any()) throw new ApiException(409, "Initial setup is already complete");
        var company = db.Services.Find("primary");
        if (company is null) { company = new Service { Id = "primary" }; db.Services.Add(company); }
        company.Name = details.Text("name"); company.Details = details.ToJsonString();
        var user = new User { Id = Guid.NewGuid().ToString(), Name = fields.Name, Username = fields.Username, PasswordHash = PasswordHash.Create(body.Text("password")), CreatedAt = Body.Now(), LicenseLevel = license, PlatformRole = "Seacoast Admin" };
        db.Users.Add(user); var member = new ServiceMembership { UserId = user.Id, ServiceId = "primary", Tags = body["tags"]!.ToJsonString(), Active = 1 }; db.ServiceMemberships.Add(member);
        Audit(db, Effective(user, company, member), "Initial administrator created", new { username = user.Username }); Issue(http, db, user.Id, "primary"); db.SaveChanges(); tx.Commit();
    }
    private static void Login(HttpContext http, InventoryDbContext db, JsonObject body)
    {
        var username = body.Text("username").ToLowerInvariant(); username = username[..Math.Min(80, username.Length)];
        var key = PasswordHash.Hash((http.Connection.RemoteIpAddress?.ToString() ?? "") + ":" + username); CheckAttempts(db, key);
        var user = db.Users.AsNoTracking().FirstOrDefault(u => u.Username.ToLower() == username);
        var serviceId = user is null ? null : (from m in db.ServiceMemberships join c in db.Services on m.ServiceId equals c.Id where m.UserId == user.Id && m.Active == 1 && c.Active == 1 && c.Internal == 0 orderby m.ServiceId select m.ServiceId).FirstOrDefault();
        if (user?.PlatformRole == "Seacoast Admin" && serviceId is null) serviceId = db.Services.Where(s => s.Active == 1 && s.Internal == 0).OrderBy(s => s.Id).Select(s => s.Id).FirstOrDefault() ?? "platform";
        var valid = PasswordHash.Matches(body.Text("password"), user?.PasswordHash);
        if (user is null || serviceId is null || !valid)
        {
            if (user is not null) foreach (var id in db.ServiceMemberships.Where(m => m.UserId == user.Id).Select(m => m.ServiceId))
                db.IdentityAudits.Add(new IdentityAudit { ServiceId = id, ActorId = user.Id, Actor = "Unauthenticated", Action = "Sign-in failed", Details = Body.Encode(new { username = user.Username }), CreatedAt = Body.Now() });
            RecordFailure(db, key); throw new ApiException(401, "Username or password is incorrect");
        }
        using var tx = db.Database.BeginTransaction(); db.LoginAttempts.RemoveRange(db.LoginAttempts.Where(a => a.Key == key)); Issue(http, db, user.Id, serviceId);
        Audit(db, Effective(user, db.Services.Find(serviceId)!, db.ServiceMemberships.Find(user.Id, serviceId)), "Signed in", new { }); db.SaveChanges(); tx.Commit();
    }
    private static void RequireAdmin(UserContext user)
    {
        if (!AccessService.CompanyAdmin(user)) throw new ApiException(403, "Company Admin access is required");
    }
    private static object Companies(InventoryDbContext db, UserContext user)
    {
        var rows = AccessService.IsSeacoast(user) ? db.Services.Where(s => s.Internal == 0).OrderBy(s => s.Name).ToList() : (from s in db.Services join m in db.ServiceMemberships on s.Id equals m.ServiceId where m.UserId == user.Id && m.Active == 1 && s.Active == 1 && s.Internal == 0 orderby s.Name select s).ToList();
        return new { services = rows.Select(s => { var result = new JsonObject { ["id"] = s.Id, ["name"] = s.Name, ["active"] = s.Active != 0 }; if (AccessService.CompanyAdmin(user) && (AccessService.IsSeacoast(user) || s.Id == user.ServiceId)) foreach (var pair in Body.Object(s.Details)) result[pair.Key] = pair.Value?.DeepClone(); return result; }), deletedCompanies = AccessService.IsSeacoast(user) ? db.CompanyTombstones.AsNoTracking().OrderByDescending(c => c.DeletedAt).ToArray() : [] };
    }
    private static void SaveCompany(InventoryDbContext db, UserContext user, JsonObject body)
    {
        var id = body.Text("id", Guid.NewGuid().ToString()); var creating = !body.ContainsKey("id");
        if (creating && !AccessService.IsSeacoast(user)) throw new ApiException(403, "Only Seacoast Admin can create a company");
        var row = creating ? null : db.Services.FirstOrDefault(s => s.Id == id && s.Internal == 0);
        if (!creating && row is null) throw new ApiException(404, "Company not found");
        if (!creating && id != user.ServiceId) throw new ApiException(403, "Select a service before editing it");
        var details = ServiceFields(body);
        if (row is null) { row = new Service { Id = id }; db.Services.Add(row); db.ServiceMemberships.Add(new ServiceMembership { UserId = user.Id, ServiceId = id, Tags = Body.Encode(AccessService.DefaultTags(user.LicenseLevel, "Company Admin")) }); }
        row.Name = details.Text("name"); row.Details = details.ToJsonString();
        Audit(db, user, creating ? "Service created" : "Service updated", new { name = row.Name, fields = details.Where(pair => pair.Value?.GetValue<string>() != "").Select(pair => pair.Key).ToArray() }, id);
    }
    private static void SaveUser(InventoryDbContext db, UserContext actor, JsonObject body)
    {
        if (body["tags"] is not JsonArray) throw new ApiException(400, "Choose account tags");
        var tags = body.Strings("tags");
        if (tags.Contains("Seacoast Admin")) throw new ApiException(403, "Assign platform access separately");
        if (tags.Count(PolicyCatalog.LicenseLevels.Contains) > 1) throw new ApiException(400, "Choose one clinical license level");
        var license = body.Text("licenseLevel", PolicyCatalog.LicenseLevels.LastOrDefault(tags.Contains) ?? "Driver");
        if (!PolicyCatalog.LicenseLevels.Contains(license)) throw new ApiException(400, "Choose a clinical license level");
        tags = tags.Where(t => !PolicyCatalog.LicenseLevels.Contains(t)).Select(t => t == "Service Admin" ? "Company Admin" : t).Append(license).Distinct().ToArray();
        if (tags.Contains("Supervisor") && tags.Contains("Company Admin")) throw new ApiException(400, "Choose one organization role");
        body["tags"] = new JsonArray(tags.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray());
        if (body.ContainsKey("platformAdmin") && (body["platformAdmin"] is not JsonValue p || !p.TryGetValue<bool>(out _))) throw new ApiException(400, "Invalid platform access");
        if (body.ContainsKey("active") && (body["active"] is not JsonValue a || !a.TryGetValue<bool>(out _))) throw new ApiException(400, "Invalid active status");
        var id = body.Text("id", Guid.NewGuid().ToString()); var creating = !body.ContainsKey("id");
        var row = creating ? null : db.Users.Find(id);
        if (!AccessService.IsSeacoast(actor) && (body.Flag("platformAdmin") || row?.PlatformRole == "Seacoast Admin")) throw new ApiException(403, "Only Seacoast Admin can manage platform administrators");
        if (row?.PlatformRole == "Seacoast Admin" && body.ContainsKey("platformAdmin") && !body.Flag("platformAdmin") && db.Users.Count(u => u.PlatformRole == "Seacoast Admin") == 1) throw new ApiException(400, "Keep at least one Seacoast Admin");
        var fields = UserFields(body); var active = body.Flag("active", true);
        var membership = creating ? null : db.ServiceMemberships.Find(id, actor.ServiceId);
        if (!creating && (row is null || membership is null)) throw new ApiException(404, "User not found in this service");
        if (db.Users.Any(u => u.Username.ToLower() == fields.Username && u.Id != id)) throw new ApiException(409, "Username already exists");
        var password = body.Text("password"); if (password != "" || creating) ValidPassword(password);
        if (!creating)
        {
            var admins = db.ServiceMemberships.Where(m => m.ServiceId == actor.ServiceId && m.Active == 1).AsEnumerable().Where(m => { var roles = Body.ReadStrings(m.Tags); return roles.Any(t => t is "Company Admin" or "Service Admin") && !roles.Contains("Read Only"); }).ToList();
            if (admins.Count == 1 && admins[0].UserId == id && (!active || !tags.Contains("Company Admin") || tags.Contains("Read Only"))) throw new ApiException(400, "Keep at least one active Service Admin");
            if (password != "" || !active) db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.UserId == id));
        }
        if (row is null) { row = new User { Id = id, CreatedAt = Body.Now() }; db.Users.Add(row); }
        if (membership is null) { membership = new ServiceMembership { UserId = id, ServiceId = actor.ServiceId }; db.ServiceMemberships.Add(membership); }
        row.Username = fields.Username; row.Name = fields.Name; row.LicenseLevel = license;
        if (body.ContainsKey("platformAdmin")) row.PlatformRole = body.Flag("platformAdmin") ? "Seacoast Admin" : "";
        if (password != "") row.PasswordHash = PasswordHash.Create(password);
        membership.Tags = Body.Encode(tags); membership.Active = active ? 1 : 0;
        Audit(db, actor, creating ? "User created" : "User updated", new { userId = id, username = fields.Username, tags, active, passwordReset = password != "" && !creating });
    }
    private static void CompanyLifecycle(HttpContext http, InventoryDbContext db, DatabaseStore store, UserContext user, string path, JsonObject body)
    {
        if (!AccessService.IsSeacoast(user) || user.Tags.Contains("Read Only")) throw new ApiException(403, "Only Seacoast Admin can deactivate, reactivate, or delete companies");
        var id = body.Text("id"); var company = db.Services.FirstOrDefault(s => s.Id == id && s.Internal == 0) ?? throw new ApiException(404, "Company not found");
        if (path.EndsWith("/status"))
        {
            if (body["active"] is not JsonValue flag || !flag.TryGetValue<bool>(out var active)) throw new ApiException(400, "Choose company active status");
            using var tx = db.Database.BeginTransaction(); company.Active = active ? 1 : 0; db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.ServiceId == id));
            Audit(db, user, active ? "Company reactivated" : "Company deactivated", new { companyId = id, name = company.Name }, id); Issue(http, db, user.Id, "platform"); db.SaveChanges(); tx.Commit(); return;
        }
        if (!PasswordHash.Matches(body.Text("currentPassword"), db.Users.Find(user.Id)!.PasswordHash)) throw new ApiException(400, "Current password is incorrect");
        if (body.Text("confirmCompanyName") != company.Name || !body.Flag("acknowledgePermanentDeletion")) throw new ApiException(400, "Confirm the exact company name and permanent deletion");
        company.Active = 0; db.UserSessions.RemoveRange(db.UserSessions.Where(s => s.ServiceId == id)); db.SaveChanges();
        store.PurgeCompany(id);
        using var transaction = db.Database.BeginTransaction();
        db.ServiceMemberships.RemoveRange(db.ServiceMemberships.Where(m => m.ServiceId == id)); db.Services.Remove(company);
        db.CompanyTombstones.Add(new CompanyTombstone { Id = id, Name = company.Name, DeletedAt = Body.Now(), ActorId = user.Id });
        Audit(db, user, "Company permanently deleted", new { companyId = id, name = company.Name }, "platform"); Issue(http, db, user.Id, "platform"); db.SaveChanges(); transaction.Commit();
    }
}
