using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation
{
    internal void SaveContainer()
    {
        if (body.ContainsKey("allowedRoles"))
        {
            var roles = body["allowedRoles"] is JsonArray array ? array.Select(x => x is JsonValue value && value.TryGetValue<string>(out var role) ? role : "").ToArray() : [];
            Require(roles.Length > 0 && roles.Distinct().Count() == roles.Length && roles.All(x => MatrixRoles.Contains(x)), "Choose allowed storage roles");
        }
        Require(body.OptionalText("name") is { Length: > 0 and <= 100 } && !string.IsNullOrWhiteSpace(body.Text("name")) && body.OptionalText("location") is { Length: > 0 and <= 100 } && !string.IsNullOrWhiteSpace(body.Text("location")), "Enter a container name and storage area");
        Require(new[] { "box", "cabinet", "truck", "lock", "medical" }.Contains(body.Text("icon")) && new[] { "Drug box", "Cabinet", "Narcotic box", "Pelican box" }.Contains(body.Text("kind")), "Choose a valid container type and icon");
        Require(body.IsNumber("checkIntervalHours") && body.Number("checkIntervalHours") is >= 0 and <= 8760, "Check interval must be from 0 to 8,760 hours");
        Require(body.IsBoolean("sealed") && body.IsBoolean("transparent"), "Choose sealed and transparent states");
        Require(!body.Boolean("sealed") || body.OptionalText("seal") is { Length: > 0 and <= 40 } && !string.IsNullOrWhiteSpace(body.Text("seal")), "A sealed container requires a seal number");
        var existing = body.ContainsKey("id") ? db.InventoryBoxes.Find(body.Text("id")) : null;
        Require(!body.ContainsKey("id") || existing is not null, "Container not found", 404);
        var box = existing ?? new InventoryBox { Id = Guid.NewGuid().ToString() };
        var contents = existing is null ? [] : Contents(box.Id);
        var previousSealed = box.Sealed != 0;
        var previousSeal = box.Seal;
        var nextSealed = body.Boolean("sealed");
        var nextSeal = body.Text("seal").Trim();
        if (previousSealed && (!nextSealed || previousSeal != nextSeal)) BreakSeals([box]);
        var resealing = nextSealed && (!previousSealed || previousSeal != nextSeal);
        if (resealing && access.User.LicenseLevel == "Driver") witness.Require();
        if (resealing) RequireWitness(contents.SelectMany(x => Requirements(x.DefinitionId)), "resealed");
        box.Location = body.Text("location").Trim(); box.Name = body.Text("name").Trim();
        box.Sealed = nextSealed ? 1 : 0; box.Seal = nextSealed ? nextSeal : previousSeal;
        box.Transparent = body.Boolean("transparent") ? 1 : 0; box.CheckIntervalHours = body.Number("checkIntervalHours");
        box.Icon = body.Text("icon"); box.Kind = body.Text("kind");
        if (body.ContainsKey("allowedRoles")) box.AllowedRoles = body["allowedRoles"]!.ToJsonString();
        if (existing is null) db.InventoryBoxes.Add(box);
        foreach (var item in contents) Event(item.Id, resealing ? "container_resealed" : "container_updated", box.Id, box.Id, new { containerName = box.Name, location = box.Location, seal = nextSealed ? nextSeal : null, witness = body.OptionalText("witness"), checkIntervalHours = box.CheckIntervalHours });
        if (existing is not null && (previousSealed != nextSealed || nextSealed && previousSeal != nextSeal)) box.StockRevision++;
        Setting(box.Id, "container_saved");
    }

    internal void SaveSeal()
    {
        var box = AccessService.AuthorizeStorage(db, access, body.Text("boxId"));
        Require(box.Id != "unassigned", "Unassigned has no physical seal");
        var action = body.Text("action");
        Require(action is "break" or "reseal", "Choose break or reseal");
        Require(!body.ContainsKey("incidentNumber") || body.OptionalText("incidentNumber") is { Length: <= 60 }, "Invalid incident number");
        if (action == "break")
        {
            Require(box.Sealed != 0, "This container is already unsealed", 409);
            if (access.User.LicenseLevel == "Driver") witness.Require();
            BreakSeals([box]);
        }
        else
        {
            Require(box.Sealed == 0, "Break the current seal before resealing", 409);
            Require(body.OptionalText("seal") is { Length: > 0 and <= 40 } && !string.IsNullOrWhiteSpace(body.Text("seal")), "Enter the new physical seal number");
            if (access.User.LicenseLevel == "Driver") witness.Require();
            var items = Contents(box.Id);
            RequireWitness(items.SelectMany(x => Requirements(x.DefinitionId)), "resealed");
            box.Sealed = 1; box.Seal = body.Text("seal").Trim(); box.StockRevision++;
            foreach (var item in items) Event(item.Id, "container_resealed", box.Id, box.Id, new { seal = box.Seal, incidentNumber = body.Text("incidentNumber"), witness = body.OptionalText("witness") });
        }
        Setting(box.Id, action == "break" ? "seal_broken" : "container_resealed");
    }

    internal void SaveDiscrepancy(string path)
    {
        if (path.EndsWith("/approve"))
        {
            var row = db.Discrepancies.Find(body.Text("id")) ?? throw new ApiException(404, "Discrepancy not found");
            AccessService.AuthorizeStorage(db, access, row.BoxId);
            Require(row.Status == "open" && row.Revision == body.Integer("revision"), "This discrepancy changed. Refresh before approving.", 409);
            Require(body.OptionalText("resolution") is { Length: > 0 and <= 1000 } && !string.IsNullOrWhiteSpace(body.Text("resolution")), "Enter an approval / resolution note");
            row.Status = "approved"; row.ApprovedBy = access.User.Actor; row.ApprovedAt = now; row.Resolution = body.Text("resolution").Trim(); row.Revision++;
            if (row.ItemId is not null) Event(row.ItemId, "discrepancy_approved", row.BoxId, row.BoxId, new { discrepancyId = row.Id, resolution = row.Resolution });
        }
        else
        {
            var box = AccessService.AuthorizeStorage(db, access, body.Text("boxId"));
            Require(body.OptionalText("notes") is { Length: > 0 and <= 1000 } && !string.IsNullOrWhiteSpace(body.Text("notes")), "Describe the discrepancy in up to 1,000 characters");
            InventoryItem? item = null;
            if (!string.IsNullOrEmpty(body.Text("itemCode")))
            {
                var code = body.Text("itemCode").Trim().ToUpperInvariant();
                item = db.InventoryItems.FirstOrDefault(x => x.Code == code && x.BoxId == box.Id);
                Require(item is not null, "That item code does not belong to this container");
            }
            var row = new Discrepancy { Id = Guid.NewGuid().ToString(), BoxId = box.Id, ItemId = item?.Id, Notes = body.Text("notes").Trim(), ReportedBy = access.User.Actor, ReportedAt = now, Status = "open", Resolution = "", Revision = 1 };
            db.Discrepancies.Add(row);
            if (item is not null) Event(item.Id, "discrepancy_reported", box.Id, box.Id, new { discrepancyId = row.Id, notes = row.Notes });
        }
        Setting(body.OptionalText("id") ?? body.Text("boxId"), path.EndsWith("/approve") ? "discrepancy_approved" : "discrepancy_reported");
    }
}
