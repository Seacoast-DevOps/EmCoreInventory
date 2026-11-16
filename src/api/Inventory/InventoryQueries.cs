using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Catalog;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal static class InventoryQueries
{
    internal static bool Visible(InventoryDbContext db, AccessContext access, InventoryItem item) => AccessService.StorageAllowed(access, db.InventoryBoxes.Find(item.BoxId)) && AccessService.MedicationPermitted(access, AccessService.DrugForItem(db, item), "view");
    internal static void AuthorizeItem(InventoryDbContext db, AccessContext access, InventoryItem item)
    {
        AccessService.AuthorizeStorage(db, access, item.BoxId);
        AccessService.AuthorizeMedication(access, AccessService.DrugForItem(db, item), "view");
    }
    internal static JsonArray Discrepancies(InventoryDbContext db, AccessContext access)
    {
        var result = new JsonArray();
        foreach (var discrepancy in db.Discrepancies.OrderByDescending(x => x.ReportedAt).ToList())
        {
            var box = db.InventoryBoxes.Find(discrepancy.BoxId);
            if (!AccessService.StorageAllowed(access, box)) continue;
            var item = discrepancy.ItemId is not null ? db.InventoryItems.Find(discrepancy.ItemId) : null;
            var row = Row(discrepancy);
            row["location"] = box!.Location; row["container_name"] = box.Name;
            row["code"] = item?.Code; row["medication"] = item?.Medication;
            result.Add(row);
        }
        return result;
    }
    internal static JsonObject Snapshot(InventoryDbContext db, AccessContext access)
    {
        bool Allowed(string permission) => access.Permissions.GetValueOrDefault(permission);
        var boxes = db.InventoryBoxes.ToList();
        var items = new JsonArray();
        foreach (var item in db.InventoryItems.Where(x => x.Status == "available" || x.Status == "opened" || x.Status == "unassigned").OrderBy(x => x.Medication).ThenBy(x => x.Code).ToList())
        {
            if (!Visible(db, access, item) || !Allowed(item.BoxId == "unassigned" ? "stock.view" : "inventory.view")) continue;
            var row = Row(item);
            row["requirements"] = Array(CatalogService.Requirements(db, item.DefinitionId));
            row["tagNames"] = Array((from link in db.DefinitionTags join tag in db.MedicationTags on link.TagId equals tag.Id where link.DefinitionId == item.DefinitionId select tag.Name).ToList());
            items.Add(row);
        }
        var result = CatalogService.Snapshot(db, access);
        result["boxes"] = RowArray(boxes.Where(x => AccessService.StorageAllowed(access, x)));
        result["managedBoxes"] = RowArray(Allowed("containers.view") ? boxes : []);
        result["discrepancies"] = Allowed("discrepancies.view") ? Discrepancies(db, access) : new JsonArray();
        result["items"] = items;
        result["classes"] = RowArray(db.MedicationClasses.OrderBy(x => x.Name).ToList());
        result["checks"] = Allowed("inventory.view") ? new JsonArray(CheckQueries.Snapshot(db).OfType<JsonObject>().Where(x => AccessService.StorageAllowed(access, db.InventoryBoxes.Find(x.Text("boxId")))).Select(x => x.DeepClone()).ToArray()) : new JsonArray();
        var incidents = new JsonArray();
        if (Allowed("incidents.view")) foreach (var incident in db.Incidents.OrderByDescending(x => x.Id).ToList())
        {
            var links = db.IncidentItems.Where(x => x.IncidentId == incident.Id).Select(x => x.ItemId).ToList();
            var ids = links.Concat(Object(incident.Payload).Entries("items").Select(x => x.Text("id"))).Distinct();
            if (ids.Any(id => db.InventoryItems.Find(id) is { } item && !Visible(db, access, item))) continue;
            var row = Row(incident); row["item_count"] = links.Count; incidents.Add(row);
        }
        result["incidents"] = incidents;
        return result;
    }
    internal static JsonArray CheckHistory(InventoryDbContext db, AccessContext access, string boxId)
    {
        AccessService.Authorize(access, "inventory.view");
        AccessService.AuthorizeStorage(db, access, boxId);
        var result = new JsonArray();
        foreach (var check in db.DrugChecks.Where(x => x.BoxId == boxId).OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).ToList())
        {
            var ids = Strings(check.ItemIds);
            var items = db.InventoryItems.Where(x => ids.Contains(x.Id)).ToList();
            foreach (var item in items) AccessService.AuthorizeMedication(access, AccessService.DrugForItem(db, item), "view");
            var row = Row(check);
            row["items"] = Array(items.Select(x => new { id = x.Id, code = x.Code, medication = x.Medication }));
            row["checkedIds"] = Array(Strings(check.CheckedIds));
            result.Add(row);
        }
        return result;
    }
    internal static InventoryItem Lookup(InventoryDbContext db, string identity)
    {
        Require(!string.IsNullOrWhiteSpace(identity) && identity.Length <= 80, "Enter an item tracking code");
        return db.InventoryItems.FirstOrDefault(x => x.Id == identity || x.Code == identity) ?? throw new ApiException(404, "Item not found");
    }
}
