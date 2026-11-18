using System.Security.Cryptography;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Auth;

public static partial class IdentityService
{
    private const string CookieName = "emcore_session";
    private const string PlatformId = "platform";
    private const string PlatformRole = "Seacoast Admin";
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(8);

    public static void Initialize(InventoryDbContext db)
    {
        if (!db.Services.Any(s => s.Id == PlatformId)) db.Services.Add(new Service { Id = PlatformId, Name = "Seacoast administration", Internal = 1 });
        if (!db.CompanyMigrations.Any(m => m.Version == 1))
        {
            foreach (var user in db.Users.ToList())
            {
                var memberships = db.ServiceMemberships.Where(m => m.UserId == user.Id).ToList();
                var tags = memberships.SelectMany(m => Body.ReadStrings(m.Tags)).ToArray();
                user.LicenseLevel = PolicyCatalog.LicenseLevels.LastOrDefault(tags.Contains) ?? "Driver";
                foreach (var membership in memberships) membership.Tags = Body.Encode(Body.ReadStrings(membership.Tags).Select(t => t == "Service Admin" ? "Company Admin" : t));
            }
            var founderId = db.IdentityAudits.Where(a => a.Action == "Initial administrator created").OrderBy(a => a.Id).Select(a => a.ActorId).FirstOrDefault();
            if (founderId is not null && db.Users.Find(founderId) is { } founder) founder.PlatformRole = PlatformRole;
            db.CompanyMigrations.Add(new CompanyMigration { Version = 1 });
        }
        db.SaveChanges();
    }
    public static UserContext Effective(User row, Service service, ServiceMembership? membership = null)
    {
        var license = string.IsNullOrEmpty(row.LicenseLevel) ? "Driver" : row.LicenseLevel;
        var tags = membership is not null ? Body.ReadStrings(membership.Tags)
            : row.PlatformRole == PlatformRole ? AccessService.DefaultTags(license, "Company Admin") : [];
        return new UserContext
        {
            Id = row.Id,
            Username = row.Username,
            Name = row.Name,
            LicenseLevel = license,
            PlatformRole = row.PlatformRole,
            Tags = tags.Where(t => !PolicyCatalog.LicenseLevels.Contains(t) && t != PlatformRole)
                .Append(license).Concat(row.PlatformRole == PlatformRole ? [PlatformRole] : Array.Empty<string>()).Distinct().ToArray(),
            ServiceId = service.Id,
            ServiceName = service.Name,
            CompanyActive = service.Active != 0
        };
    }

    public static UserContext Session(HttpContext http, InventoryDbContext db)
    {
        var token = http.Request.Cookies[CookieName];
        if (token is null || !Regex.IsMatch(token, @"\A[a-f0-9]{64}\z"))
            throw new ApiException(401, "Sign in to continue");

        var hash = PasswordHash.Hash(token);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var identity = (from session in db.UserSessions.AsNoTracking()
                        join user in db.Users.AsNoTracking() on session.UserId equals user.Id
                        join service in db.Services.AsNoTracking() on session.ServiceId equals service.Id
                        join member in db.ServiceMemberships.AsNoTracking()
                            on new { session.UserId, session.ServiceId } equals new { member.UserId, member.ServiceId } into members
                        from membership in members.DefaultIfEmpty()
                        where session.TokenHash == hash && session.ExpiresAt > now
                        select new { user, service, membership }).SingleOrDefault();
        if (identity is null || (identity.user.PlatformRole != PlatformRole &&
            (identity.membership?.Active != 1 || identity.service.Active == 0 || identity.service.Internal != 0)))
            throw new ApiException(401, "Session expired or company/account deactivated. Sign in again.");

        return Effective(identity.user, identity.service, identity.membership) with { TokenHash = hash };
    }

    public static void Audit(InventoryDbContext db, UserContext? user, string action, object details, string? serviceId = null)
    {
        db.IdentityAudits.Add(new IdentityAudit
        {
            ServiceId = serviceId ?? user?.ServiceId,
            ActorId = user?.Id,
            Actor = user?.Actor ?? "Unauthenticated",
            Action = action,
            Details = Body.Encode(details),
            CreatedAt = Body.Now()
        });
    }

    private static CookieOptions SessionCookie(HttpContext http) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Path = "/",
        Secure = http.Request.IsHttps || Environment.GetEnvironmentVariable("EMCORE_SECURE_COOKIE") == "1"
    };

    private static void WriteCookie(HttpContext http, string token)
    {
        var options = SessionCookie(http);
        options.MaxAge = SessionLifetime;
        http.Response.Cookies.Append(CookieName, token, options);
    }

    private static string Issue(InventoryDbContext db, string userId, string serviceId)
    {
        var now = DateTimeOffset.UtcNow;
        var nowMs = now.ToUnixTimeMilliseconds();
        db.UserSessions.Where(s => s.ExpiresAt <= nowMs).ExecuteDelete();
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        db.UserSessions.Add(new UserSession
        {
            TokenHash = PasswordHash.Hash(token),
            UserId = userId,
            ServiceId = serviceId,
            ExpiresAt = (now + SessionLifetime).ToUnixTimeMilliseconds()
        });
        return token;
    }

    private static IDbContextTransaction BeginIdentityWrite(InventoryDbContext db)
    {
        var transaction = db.Database.BeginTransaction();
        try
        {
            LockIdentity(db);
            return transaction;
        }
        catch
        {
            transaction.Dispose();
            throw;
        }
    }

    // The permanent platform row also serializes invariants spanning companies, including first setup
    // and the last platform administrator. Take it before any company row locks.
    private static void LockIdentity(InventoryDbContext db)
    {
        if (LockService(db, PlatformId) is null)
            throw new InvalidOperationException("The platform identity service is missing.");
    }

    private static Service? LockService(InventoryDbContext db, string serviceId) =>
        db.Services.FromSqlInterpolated($"""SELECT * FROM emcore_primary.services WHERE id = {serviceId} FOR UPDATE""")
            .AsTracking().ToList().SingleOrDefault();

    private static void LockUserCompanies(InventoryDbContext db, string userId)
    {
        var serviceIds = db.ServiceMemberships.Where(m => m.UserId == userId).Select(m => m.ServiceId).ToList();
        var sessionServiceIds = db.UserSessions.Where(s => s.UserId == userId).Select(s => s.ServiceId).Distinct().ToList();
        foreach (var serviceId in serviceIds.Concat(sessionServiceIds).Distinct().Order(StringComparer.Ordinal))
            LockService(db, serviceId);
    }

    internal static void ValidPassword(string? password)
    {
        if (password is null || password.Length is < 12 or > 128)
            throw new ApiException(400, "Use a password between 12 and 128 characters");
    }

    private static (string Username, string Name) UserFields(string? username, string? name)
    {
        if (username is null || !Regex.IsMatch(username, @"\A[a-zA-Z0-9._@+-]{3,80}\z") ||
            string.IsNullOrWhiteSpace(name) || name.Length > 100 || name.Any(char.IsControl))
            throw new ApiException(400, "Enter a name and username (3–80 letters, numbers, . _ @ + or -)");

        return (username.ToLowerInvariant(), name.Trim());
    }

    private static void RequireAdmin(UserContext user)
    {
        if (!AccessService.CompanyAdmin(user))
            throw new ApiException(403, "Company Admin access is required");
    }

    private static void RequireCompany(UserContext user)
    {
        if (user.PlatformOnly)
            throw new ApiException(400, "Select a company before managing its users");
        if (!user.CompanyActive)
            throw new ApiException(403, "Select an active company before managing its users");
    }
}
