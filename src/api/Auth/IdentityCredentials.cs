using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Auth;

public static partial class IdentityService
{
    private const int FailureLimit = 5;
    private const long AttemptWindowMs = 15 * 60 * 1000;

    private static string LoginUsername(string username)
    {
        username = username.Trim();
        return Regex.IsMatch(username, @"\A[a-zA-Z0-9._@+-]{3,80}\z") ? username.ToLowerInvariant() : "";
    }

    private static LoginAttempt LockAttempt(InventoryDbContext db, string key, bool witness)
    {
        // The upsert locks existing rows and protects first attempts from racing over a missing key.
        db.Database.ExecuteSqlInterpolated($"""
            INSERT INTO emcore_primary.login_attempts (key, failures, until_ms) VALUES ({key}, 0, 0)
            ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
            """);
        var attempt = db.LoginAttempts.Single(a => a.Key == key);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (attempt.UntilMs <= now)
        {
            attempt.Failures = 0;
            attempt.UntilMs = now + AttemptWindowMs;
        }
        if (attempt.Failures >= FailureLimit)
            throw new ApiException(429, witness ? "Too many witness sign-in attempts. Try again in 15 minutes."
                : "Too many attempts. Try again in 15 minutes.");

        return attempt;
    }

    private static void CleanExpiredAttempts(InventoryDbContext db)
    {
        // Use an independent statement so cleanup releases all row locks before credential verification.
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        db.Database.ExecuteSqlInterpolated($"""
            DELETE FROM emcore_primary.login_attempts WHERE key IN (
                SELECT key FROM emcore_primary.login_attempts
                WHERE until_ms <= {now}
                LIMIT 32 FOR UPDATE SKIP LOCKED
            )
            """);
    }

    private static IResult Login(HttpContext http, DatabaseStore store, LoginRequest request)
    {
        var username = LoginUsername(request.Username);
        var key = PasswordHash.Hash(RemoteAddress(http) + ":" + username);
        using var db = store.OpenIdentity();
        CleanExpiredAttempts(db);
        using var tx = db.Database.BeginTransaction();
        var attempt = LockAttempt(db, key, witness: false);
        var candidate = username.Length == 0 ? null : db.Users.AsNoTracking().SingleOrDefault(u => u.Username.ToLower() == username);
        var valid = PasswordHash.Matches(request.Password, candidate?.PasswordHash);

        if (valid && candidate is not null)
        {
            LockIdentity(db);
            // Recheck under the same lock as password changes, renames and company lifecycle writes.
            var user = db.Users.AsNoTracking().SingleOrDefault(u => u.Id == candidate.Id);
            if (user is not null && user.Username == candidate.Username && user.PasswordHash == candidate.PasswordHash)
            {
                var service = LoginService(db, user);
                if (service is not null)
                {
                    var membership = db.ServiceMemberships.Find(user.Id, service.Id);
                    db.LoginAttempts.Remove(attempt);
                    var token = Issue(db, user.Id, service.Id);
                    Audit(db, Effective(user, service, membership), "Signed in", new { });
                    db.SaveChanges();
                    tx.Commit();
                    WriteCookie(http, token);
                    return Results.Ok(new { ok = true });
                }
            }
        }

        attempt.Failures++;
        if (candidate is not null)
        {
            var serviceIds = db.ServiceMemberships.Where(m => m.UserId == candidate.Id).Select(m => m.ServiceId).ToList();
            foreach (var serviceId in serviceIds.DefaultIfEmpty(PlatformId))
            {
                db.IdentityAudits.Add(new IdentityAudit
                {
                    ServiceId = serviceId,
                    Actor = "Unauthenticated",
                    Action = "Sign-in failed",
                    Details = Body.Encode(new { targetUserId = candidate.Id, username = candidate.Username }),
                    CreatedAt = Body.Now()
                });
            }
        }
        db.SaveChanges();
        tx.Commit();
        throw new ApiException(401, "Username or password is incorrect");
    }

    private static Service? LoginService(InventoryDbContext db, User user)
    {
        var eligible = db.Services.AsNoTracking().Where(s => s.Active == 1 && s.Internal == 0);
        var service = (from membership in db.ServiceMemberships.AsNoTracking()
                       join company in eligible on membership.ServiceId equals company.Id
                       where membership.UserId == user.Id && membership.Active == 1
                       orderby company.Id
                       select company).FirstOrDefault();
        if (service is null && user.PlatformRole == PlatformRole)
            service = eligible.OrderBy(s => s.Id).FirstOrDefault() ?? db.Services.Find(PlatformId);
        return service;
    }

    internal static UserContext VerifyWitnessCredentials(DatabaseStore store, JsonObject credentials, UserContext actor, HttpContext http)
    {
        var username = LoginUsername(credentials.Text("username"));
        var key = PasswordHash.Hash("witness:" + RemoteAddress(http) + ":" + username);
        // The inventory transaction holds the company row lock. This connection reads identity
        // without locking those rows and commits only the attempt counter, even if inventory rolls back.
        using var db = store.OpenIdentity();
        CleanExpiredAttempts(db);
        using var tx = db.Database.BeginTransaction();
        var attempt = LockAttempt(db, key, witness: true);
        var user = username.Length == 0 ? null : db.Users.AsNoTracking().SingleOrDefault(u => u.Username.ToLower() == username);
        var valid = PasswordHash.Matches(credentials.Text("password"), user?.PasswordHash);
        var service = db.Services.AsNoTracking().SingleOrDefault(s => s.Id == actor.ServiceId && s.Active == 1 && s.Internal == 0);
        var membership = user is null ? null : db.ServiceMemberships.AsNoTracking()
            .SingleOrDefault(m => m.UserId == user.Id && m.ServiceId == actor.ServiceId && m.Active == 1);
        if (user is null || membership is null || service is null || !valid)
        {
            attempt.Failures++;
            db.SaveChanges();
            tx.Commit();
            throw new ApiException(422, "Witness username or password is incorrect, or the account is inactive in this service.");
        }

        db.LoginAttempts.Remove(attempt);
        db.SaveChanges();
        tx.Commit();

        var witness = Effective(user, service, membership);
        if (witness.Id == actor.Id)
            throw new ApiException(422, "The witness must be a different user from the signed-in operator.");
        if (!witness.Tags.Contains("Can Witness") || witness.Tags.Contains("Read Only"))
            throw new ApiException(422, "This user must have Can Witness and must not be Read Only.");
        return witness;
    }

    private static string RemoteAddress(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "";
}
