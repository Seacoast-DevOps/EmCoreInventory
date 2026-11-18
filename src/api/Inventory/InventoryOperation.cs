using System.Text.Json.Nodes;
using WitnessAuthorization = EmCoreInventory.Api.Auth.WitnessAuthorization;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Catalog;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation(InventoryDbContext db, AccessContext access, WitnessAuthorization witness, JsonObject body, string now)
{
    internal static readonly string[] MatrixRoles = ["Driver", "EMT", "AEMT", "Paramedic", "Supervisor", "Company Admin", "Seacoast Admin"];
    internal InventoryItem Item(string id, bool requireActive = true)
    {
        Require(!string.IsNullOrWhiteSpace(id) && id.Length <= 80, "An item ID is required");
        var item = db.InventoryItems.Find(id) ?? throw new ApiException(404, "Item not found");
        Require(!requireActive || item.Status is InventoryItemStatus.Available or InventoryItemStatus.Opened or InventoryItemStatus.Unassigned, "This item has already been used or disposed of. Refresh inventory.", 409);
        return item;
    }
    internal InventoryBox Box(string id) => db.InventoryBoxes.Find(id) ?? throw new ApiException(400, "Container not found");
    internal List<InventoryItem> Contents(string id) => db.InventoryItems.Where(x => x.BoxId == id && (x.Status == InventoryItemStatus.Available || x.Status == InventoryItemStatus.Opened)).ToList();
    internal string[] Requirements(string? definitionId) => CatalogService.Requirements(db, definitionId);
    internal void RequireWitness(IEnumerable<string> requirements, params string[] actions)
    {
        if (requirements.Where(rule => rule is not ("seal_break" or "resealed")).Intersect(actions).Any()) witness.Require();
    }
    internal void Event(string itemId, string action, string? from, string? to, object details)
    {
        var data = Node(details)!.AsObject();
        if (body["witnessSignoff"] is not null)
        {
            data["witness"] = body["witness"]?.DeepClone();
            data["witnessSignoff"] = body["witnessSignoff"]?.DeepClone();
        }
        db.InventoryEvents.Add(new InventoryEvent { ItemId = itemId, Action = action, FromBox = from, ToBox = to, Details = data.ToJsonString(), CreatedAt = now, ActorProfile = access.User.Actor, ActorUserId = access.User.Id });
    }
    internal void Setting(string id, string action) => db.SettingsEvents.Add(new SettingsEvent { EntityId = id, Action = action, Details = body.ToJsonString(), CreatedAt = now, ActorProfile = access.User.Actor, ActorUserId = access.User.Id });
    internal void BreakSeals(IEnumerable<InventoryBox> boxes)
    {
        var sealedBoxes = boxes.DistinctBy(x => x.Id).Where(x => x.Sealed != 0).ToList();
        var confirmations = body.Entries("brokenSeals").ToList();
        if (sealedBoxes.Any(x => !confirmations.Any(c => c.Text("id") == x.Id && c.OptionalText("seal") == x.Seal)))
            throw new ApiException(409, "Confirm the physical seal has been broken before continuing.", new { sealedBoxes = RowArray(sealedBoxes) });
        if (sealedBoxes.Count > 0 && access.User.LicenseLevel == "Driver") witness.Require();
        foreach (var box in sealedBoxes) RequireWitness(Contents(box.Id).SelectMany(x => Requirements(x.DefinitionId)), "seal_break");
        foreach (var box in sealedBoxes)
        {
            box.Sealed = 0;
            box.StockRevision++;
            foreach (var item in Contents(box.Id)) Event(item.Id, "seal_broken", box.Id, box.Id, new { seal = box.Seal, witness = body.OptionalText("witness"), incidentNumber = body.OptionalText("incidentNumber") });
        }
    }
    private void AuthorizeDrug(InventoryItem? item, string action)
    {
        if (item is null) return;
        AccessService.AuthorizeStorage(db, access, item.BoxId);
        var drug = AccessService.DrugForItem(db, item);
        AccessService.AuthorizeMedication(access, drug, "view");
        AccessService.AuthorizeMedication(access, drug, action);
    }

    internal void SaveClass() => AccessService.SaveClass(db, access, body, now);
    internal void SaveProfile() => AccessService.SaveProfile(db, access, body, now);
    internal void SaveRule() => AccessService.SaveRule(db, access, body, now);
    internal void SaveTag() => CatalogService.SaveTag(db, access, body, now);
    internal void SaveDefinition() => CatalogService.SaveDefinition(db, access, body, now);
}
