using System.Text.Json.Nodes;
using WitnessAuthorization = EmCoreInventory.Api.Auth.WitnessAuthorization;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation(InventoryDbContext db, AccessContext access, WitnessAuthorization witness, JsonObject body, string now)
{
    private static readonly string[] ActiveStatuses = ["available", "opened"];
    internal static readonly string[] MatrixRoles = ["Driver", "EMT", "AEMT", "Paramedic", "Supervisor", "Company Admin", "Seacoast Admin"];
    internal InventoryItem Item(string id, bool requireActive = true)
    {
        Require(!string.IsNullOrWhiteSpace(id) && id.Length <= 80, "An item ID is required");
        var item = db.InventoryItems.Find(id) ?? throw new ApiException(404, "Item not found");
        Require(!requireActive || new[] { "available", "opened", "unassigned" }.Contains(item.Status), "This item has already been used or disposed of. Refresh inventory.", 409);
        return item;
    }
    internal InventoryBox Box(string id) => db.InventoryBoxes.Find(id) ?? throw new ApiException(400, "Container not found");
    internal List<InventoryItem> Contents(string id) => db.InventoryItems.Where(x => x.BoxId == id && ActiveStatuses.Contains(x.Status)).ToList();
    internal string[] Requirements(string? definitionId) => (from link in db.DefinitionTags join tag in db.MedicationTags on link.TagId equals tag.Id where link.DefinitionId == definitionId select tag.Requirements).ToList().SelectMany(Strings).Distinct().ToArray();
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
    internal void Authorize(string path)
    {
        void Drug(InventoryItem? item, string action)
        {
            if (item is null) return;
            AccessService.AuthorizeStorage(db, access, item.BoxId);
            var drug = AccessService.DrugForItem(db, item);
            AccessService.AuthorizeMedication(access, drug, "view");
            AccessService.AuthorizeMedication(access, drug, action);
        }
        if (path == "/api/classes") AccessService.Authorize(access, "classes.edit");
        else if (path.StartsWith("/api/access/")) AccessService.Authorize(access, "policies.edit");
        else if (path == "/api/definitions") AccessService.Authorize(access, body.ContainsKey("id") ? "definitions.edit" : "definitions.create");
        else if (path == "/api/tags") AccessService.Authorize(access, "tags.edit");
        else if (path == "/api/containers")
        {
            AccessService.Authorize(access, "containers.edit");
            Require(body.Text("id") != "unassigned", "Unassigned is a fixed staging area");
        }
        else if (path == "/api/drugs")
        {
            AccessService.Authorize(access, "stock.create");
            if (body.Text("boxId") is not ("" or "unassigned")) AccessService.Authorize(access, "inventory.transfer");
            var drug = db.DrugDefinitions.Find(body.Text("definitionId"));
            if (drug is not null)
            {
                AccessService.AuthorizeMedication(access, drug, "view");
                AccessService.AuthorizeMedication(access, drug, "create");
            }
            AccessService.AuthorizeStorage(db, access, body.Text("boxId", "unassigned"));
        }
        else if (path == "/api/seals")
        {
            AccessService.Authorize(access, "seals." + (body.Text("action") == "break" ? "break" : "reseal"));
            AccessService.AuthorizeStorage(db, access, body.Text("boxId"));
        }
        else if (path.StartsWith("/api/discrepancies")) AccessService.Authorize(access, path.EndsWith("/approve") ? "discrepancies.approve" : "discrepancies.report");
        else if (path == "/api/move")
        {
            AccessService.AuthorizeStorage(db, access, body.Text("destinationId"));
            AccessService.Authorize(access, "inventory.view");
            AccessService.Authorize(access, "inventory.transfer");
            Drug(db.InventoryItems.Find(body.Text("itemId")), "transfer");
        }
        else if (path == "/api/verify" || path.StartsWith("/api/checks/"))
        {
            AccessService.Authorize(access, "inventory.view");
            if (body.ContainsKey("boxId")) AccessService.AuthorizeStorage(db, access, body.Text("boxId"));
            var action = path == "/api/verify" ? "verify" : path.Split('/').Last();
            AccessService.Authorize(access, "checks." + (action == "start" && body.Text("kind") is "reset" or "adhoc" ? body.Text("kind") : action));
            if (body.ContainsKey("itemId")) Drug(db.InventoryItems.Find(body.Text("itemId")), "check");
            else if (body.ContainsKey("boxId")) foreach (var item in Contents(body.Text("boxId"))) Drug(item, "check");
        }
        else if (path == "/api/incidents/reopen")
        {
            AccessService.Authorize(access, "incidents.view");
            AccessService.Authorize(access, "incidents.reopen");
            var id = body.Integer("id");
            foreach (var itemId in db.IncidentItems.Where(x => x.IncidentId == id).Select(x => x.ItemId).ToList()) Drug(db.InventoryItems.Find(itemId), "edit");
        }
        else if (path.StartsWith("/api/incidents"))
        {
            AccessService.Authorize(access, "incidents.view");
            AccessService.Authorize(access, body.ContainsKey("id") ? "incidents.edit" : "incidents.create");
            var entries = body.Entries("items").Select(x => (Id: x.Text("id"), Wasted: x.Number("wasted", 0))).ToList();
            var id = body.Integer("id");
            entries.AddRange(db.IncidentAllocations.Where(x => x.IncidentId == id).ToList().Select(x => (x.ItemId, x.Wasted)));
            foreach (var entry in entries)
            {
                var item = db.InventoryItems.Find(entry.Id);
                Drug(item, body.ContainsKey("id") ? "edit" : "view");
                if (path.EndsWith("/draft")) continue;
                if (body.Text("reason") is "used" or "opened") { AccessService.Authorize(access, "medications.administer"); Drug(item, "administer"); }
                if (body.Text("reason") is not ("used" or "opened") || entry.Wasted > 0) { AccessService.Authorize(access, "medications.waste"); Drug(item, "waste"); }
            }
        }
    }
}
