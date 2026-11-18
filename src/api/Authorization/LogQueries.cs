using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Authorization;

internal static class LogQueries
{
    private sealed record IdentityEntry(int Id, string Action, string Details, string CreatedAt, string Actor);

    internal static object Page(InventoryDbContext db, IQueryCollection query, string serviceId)
    {
        var type = query["type"].ToString();
        if (type is not ("" or "all" or "item" or "settings" or "access"))
            throw new ApiException(400, "Choose a valid log type");
        var search = query["q"].ToString().ToLowerInvariant();
        search = search[..Math.Min(search.Length, 200)];
        var offset = int.TryParse(query["offset"], out var requested) ? Math.Clamp(requested, 0, 100000) : 0;
        const int pageSize = 100;

        // Identity events share one schema across companies. Filter them by the
        // authenticated service before combining them with the tenant's own logs.
        var identity = db.Database.SqlQuery<IdentityEntry>($"""
            SELECT id AS "Id", action AS "Action", details AS "Details", created_at AS "CreatedAt", actor AS "Actor"
            FROM emcore_primary.identity_audit WHERE service_id = {serviceId}
            """);
        var inventory = from entry in db.InventoryEvents
                        join item in db.InventoryItems on entry.ItemId equals item.Id
                        select new
                        {
                            Kind = "item", Source = 0, entry.Id, entry.Action, entry.Details, entry.CreatedAt,
                            Actor = entry.ActorProfile ?? "Migration / legacy", Code = item.Code ?? "", Subject = item.Medication
                        };
        var entries = inventory.Concat(db.SettingsEvents.Select(e => new
        {
            Kind = "settings", Source = 1, e.Id, e.Action, Details = (string?)e.Details, e.CreatedAt,
            Actor = e.ActorProfile ?? "Migration / legacy", Code = "", Subject = e.EntityId
        })).Concat(db.AccessAudits.Select(e => new
        {
            Kind = "access", Source = 2, e.Id, e.Action, Details = (string?)e.Details, e.CreatedAt,
            Actor = e.ActorProfile, Code = "", Subject = "Application"
        })).Concat(identity.Select(e => new
        {
            Kind = "access", Source = 3, e.Id, e.Action, Details = (string?)e.Details, e.CreatedAt,
            e.Actor, Code = "", Subject = "Users / services"
        }));
        if (type is not ("" or "all")) entries = entries.Where(e => e.Kind == type);
        if (search != "")
            entries = entries.Where(e => (e.Action + " " + (e.Details ?? "") + " " + e.Actor + " " + e.Code + " " + e.Subject)
                .ToLower().Contains(search));

        var total = entries.LongCount();
        var page = entries.OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).ThenBy(e => e.Source)
            .Skip(offset).Take(pageSize)
            .Select(e => new { e.Kind, e.Id, e.Action, e.Details, created_at = e.CreatedAt, e.Actor, e.Code, e.Subject }).ToList();
        return new { entries = page, total, hasMore = offset + page.Count < total };
    }
}
