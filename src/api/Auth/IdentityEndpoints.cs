using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Auth;

public static partial class IdentityService
{
    public static WebApplication MapIdentityEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/status", GetStatus);
        app.MapPost("/api/auth/setup", Setup);
        app.MapPost("/api/auth/login", Login);
        app.MapPost("/api/auth/logout", Logout);
        app.MapPost("/api/auth/password", ChangePassword);
        app.MapPost("/api/auth/service", SelectService).AddEndpointFilter(AuditDenied);
        app.MapGet("/api/users", GetUsers).AddEndpointFilter(AuditDenied);
        app.MapPost("/api/users", SaveUser).AddEndpointFilter(AuditDenied);
        app.MapGet("/api/services", GetCompanies);
        app.MapPost("/api/services", SaveCompany).AddEndpointFilter(AuditDenied);
        app.MapPost("/api/companies/status", SetCompanyStatus).AddEndpointFilter(AuditDenied);
        app.MapPost("/api/companies/delete", DeleteCompany).AddEndpointFilter(AuditDenied);
        return app;
    }

    private static IResult GetStatus(HttpContext http, DatabaseStore store)
    {
        using var db = store.OpenIdentity();
        var user = OptionalSession(http, db);
        return Results.Json(new
        {
            setupRequired = !db.Users.Any(),
            user = user is null ? null : new
            {
                user.Id, user.Name, user.Username, user.ServiceId, user.ServiceName,
                user.Tags, user.LicenseLevel, user.PlatformRole, user.PlatformOnly
            }
        });
    }

    private static async ValueTask<object?> AuditDenied(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        try { return await next(invocation); }
        catch (ApiException error) when (error.Status == 403)
        {
            var http = invocation.HttpContext;
            using var db = http.RequestServices.GetRequiredService<DatabaseStore>().OpenIdentity();
            var user = http.Items.TryGetValue(typeof(UserContext), out var actor)
                ? actor as UserContext : OptionalSession(http, db);
            if (user is not null)
            {
                var route = (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
                Audit(db, user, "Access denied: " + http.Request.Method + " " + route, new { });
                db.SaveChanges();
            }
            throw;
        }
    }

    private static UserContext? OptionalSession(HttpContext http, InventoryDbContext db)
    {
        try { return Session(http, db); }
        catch (ApiException error) when (error.Status == 401) { return null; }
    }

    private static UserContext AuditSession(HttpContext http, InventoryDbContext db)
    {
        var user = Session(http, db);
        http.Items[typeof(UserContext)] = user;
        return user;
    }

    private static IResult Setup(HttpContext http, DatabaseStore store, SetupRequest request)
    {
        if (!PolicyCatalog.LicenseLevels.Contains(request.LicenseLevel))
            throw new ApiException(400, "Choose a clinical license");
        var fields = UserFields(request.Username, request.Name);
        var details = CompanyDetails(new CompanySaveRequest { Name = request.ServiceName });
        ValidPassword(request.Password);

        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        if (db.Users.Any()) throw new ApiException(409, "Initial setup is already complete");
        var company = LockService(db, DatabaseStore.PrimaryServiceId);
        if (company is null)
        {
            company = new Service { Id = DatabaseStore.PrimaryServiceId };
            db.Services.Add(company);
        }
        company.Name = details.Text("name");
        company.Details = details.ToJsonString();
        var user = new User
        {
            Id = Guid.NewGuid().ToString(),
            Name = fields.Name,
            Username = fields.Username,
            PasswordHash = PasswordHash.Create(request.Password),
            CreatedAt = Body.Now(),
            LicenseLevel = request.LicenseLevel,
            PlatformRole = PlatformRole
        };
        db.Users.Add(user);
        var membership = new ServiceMembership
        {
            UserId = user.Id,
            ServiceId = company.Id,
            Tags = Body.Encode(AccessService.DefaultTags(request.LicenseLevel, "Company Admin"))
        };
        db.ServiceMemberships.Add(membership);
        Audit(db, Effective(user, company, membership), "Initial administrator created", new { });
        return CommitSession(http, db, tx, user.Id, company.Id);
    }

    private static IResult Logout(HttpContext http, DatabaseStore store)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = OptionalSession(http, db);
        if (user is not null)
        {
            LockService(db, user.ServiceId);
            db.UserSessions.Where(s => s.TokenHash == user.TokenHash).ExecuteDelete();
            Audit(db, user, "Signed out", new { });
        }
        db.SaveChanges();
        tx.Commit();
        http.Response.Cookies.Delete(CookieName, SessionCookie(http));
        return Results.Ok(new { ok = true });
    }

    private static IResult ChangePassword(HttpContext http, DatabaseStore store, PasswordChangeRequest request)
    {
        ValidPassword(request.Password);
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = Session(http, db);
        LockUserCompanies(db, user.Id);
        var row = db.Users.Find(user.Id)!;
        if (!PasswordHash.Matches(request.CurrentPassword, row.PasswordHash))
            throw new ApiException(400, "Current password is incorrect");

        row.PasswordHash = PasswordHash.Create(request.Password);
        db.UserSessions.Where(s => s.UserId == user.Id).ExecuteDelete();
        Audit(db, user, "Password changed", new { });
        return CommitSession(http, db, tx, user.Id, user.ServiceId);
    }

    private static IResult SelectService(HttpContext http, DatabaseStore store, ServiceSelectionRequest request)
    {
        using var db = store.OpenIdentity();
        using var tx = BeginIdentityWrite(db);
        var user = AuditSession(http, db);
        LockService(db, user.ServiceId);
        var service = LockService(db, RequestId(request.ServiceId));
        if (service is null || (!AccessService.IsSeacoast(user) && (service.Active == 0 || service.Internal != 0 ||
            !db.ServiceMemberships.Any(m => m.UserId == user.Id && m.ServiceId == request.ServiceId && m.Active == 1))))
            throw new ApiException(403, "You do not belong to that service");

        db.UserSessions.Find(user.TokenHash)!.ServiceId = service.Id;
        Audit(db, user, "Service selected", new { }, service.Id);
        db.SaveChanges();
        tx.Commit();
        return Results.Ok(new { ok = true });
    }

    private static IResult CommitSession(HttpContext http, InventoryDbContext db,
        IDbContextTransaction tx, string userId, string serviceId)
    {
        var token = Issue(db, userId, serviceId);
        db.SaveChanges();
        tx.Commit();
        WriteCookie(http, token);
        return Results.Ok(new { ok = true });
    }
}
