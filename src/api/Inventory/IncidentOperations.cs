using System.Text.Json.Nodes;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation
{
    private static readonly Dictionary<string, (string Label, string Status)> IncidentReasons = new()
    {
        ["used"] = ("Used Medication", "used"), ["opened"] = ("Opened for preparation", "opened"),
        ["expired"] = ("Expired — dispose", "disposed"), ["damaged"] = ("Damaged — dispose", "disposed"),
        ["contaminated"] = ("Contaminated — dispose", "disposed"), ["unused"] = ("Opened but unused — dispose", "disposed"), ["other"] = ("Other disposal", "disposed")
    };
    private sealed record Dose(InventoryItem Item, JsonNode? GivenValue, JsonNode? WastedValue, double Given, double Wasted);

    internal int SaveIncident(bool draftOnly)
    {
        Incident? previous = null;
        Require(!body.ContainsKey("clientKey") || body.OptionalText("clientKey") is { Length: > 0 and <= 100 }, "Invalid incident client key");
        var clientKey = body.OptionalText("clientKey");
        Require(body.ContainsKey("id") || clientKey is null || !db.Incidents.Any(x => x.ClientKey == clientKey), "This incident has already been saved. Open it from Saved incidents to continue.", 409);
        if (body.ContainsKey("id"))
        {
            Require(body.Integer("id") > 0, "Choose a valid incident");
            previous = db.Incidents.Find(body.Integer("id")) ?? throw new ApiException(404, "Incident not found");
            Require(previous.Revision == body.Integer("revision"), "This incident changed elsewhere. Reload it before editing.", 409);
            Require(previous.Status != "completed", "Reopen this incident before editing it", 409);
        }
        var entries = body.Entries("items").ToList();
        Require(body["items"] is JsonArray items && items.Count == entries.Count && items.Count <= 100 && entries.Select(x => x.Text("id")).Distinct().Count() == items.Count, "Choose up to 100 different items");
        Require(!body.ContainsKey("notes") || body.OptionalText("notes") is not null, "Enter valid notes");
        Require(!body.ContainsKey("reason") || body.OptionalText("reason") is not null, "Choose a valid reason");
        Require(body.Text("notes").Length <= 1000 && (!body.ContainsKey("incidentNumber") || body.OptionalText("incidentNumber") is { Length: <= 60 }), "Incident number or notes are too long");
        Require(!body.ContainsKey("correctionNote") || body.OptionalText("correctionNote") is { Length: <= 500 }, "Correction reason must be 500 characters or fewer");
        var reason = body.Text("reason");
        Require(draftOnly || IncidentReasons.ContainsKey(reason) && entries.Count > 0, "Choose items and a reason before completing the incident");
        Require(draftOnly || reason != "used" || !string.IsNullOrWhiteSpace(body.Text("incidentNumber")), "Enter the incident number for used medication");
        Require(draftOnly || reason != "other" || !string.IsNullOrWhiteSpace(body.Text("notes")), "Explain the disposal reason");
        var old = previous is null ? [] : db.IncidentAllocations.Where(x => x.IncidentId == previous.Id).ToList();
        Require(draftOnly || previous is null || !db.IncidentVersions.Any(x => x.IncidentId == previous.Id && x.Status == "completed") || !string.IsNullOrWhiteSpace(body.Text("correctionNote")), "Enter a correction reason for the reopened incident");
        var validated = new List<Dose>();
        foreach (var entry in entries)
        {
            var item = db.InventoryItems.Find(entry.Text("id")) ?? throw new ApiException(400, "An incident item no longer exists");
            var allocation = old.Find(x => x.ItemId == item.Id);
            Require(allocation is not null || ActiveStatuses.Contains(item.Status) && entry.Text("boxId") == item.BoxId, "An item is unavailable or moved. Remove it and select it again.", 409);
            if (draftOnly) { validated.Add(new Dose(item, entry["given"]?.DeepClone() ?? JsonValue.Create(""), entry["wasted"]?.DeepClone() ?? JsonValue.Create(""), 0, 0)); continue; }
            double? available = item.RemainingAmount + (allocation?.Given ?? 0) + (allocation?.Wasted ?? 0);
            Require(reason == "opened" || available is not null, "Complete the drug profile before recording quantities for " + item.Code);
            var given = reason == "opened" ? 0 : entry["given"] is null || entry.OptionalText("given") == "" ? reason == "used" ? available!.Value : 0 : entry.Number("given");
            var wasted = reason == "opened" ? 0 : entry["wasted"] is null || entry.OptionalText("wasted") == "" ? reason == "used" ? 0 : available!.Value : entry.Number("wasted");
            Require(double.IsFinite(given) && double.IsFinite(wasted) && given >= 0 && wasted >= 0 && (available is null || given + wasted <= available + 1e-8) && (reason == "opened" || given + wasted > 0), "Given plus wasted must be positive and cannot exceed the vial balance for " + item.Code);
            Require(reason == "used" || given == 0, "Medication given is only valid for Used Medication");
            Require(reason is "used" or "opened" || Math.Abs(wasted - available!.Value) <= 1e-8, "Disposal must account for the full remaining vial amount. Use Used Medication for partial-use entries.");
            RequireWitness(Requirements(item.DefinitionId), reason == "used" ? given < (item.AmountTotal ?? 0) - 1e-8 || wasted > 0 ? "partial" : "entire" : reason == "opened" ? "opening" : "disposal", wasted > 0 ? "disposal" : "");
            validated.Add(new Dose(item, JsonValue.Create(given), JsonValue.Create(wasted), given, wasted));
        }
        if (!draftOnly)
        {
            foreach (var allocation in old)
            {
                var item = Item(allocation.ItemId, false);
                RequireWitness(Requirements(item.DefinitionId), allocation.Given > 0 ? allocation.Given < (item.AmountTotal ?? 0) || allocation.Wasted > 0 ? "partial" : "entire" : "disposal");
                if (validated.All(x => x.Item.Id != allocation.ItemId))
                {
                    RequireWitness(Requirements(item.DefinitionId), "partial", "disposal");
                    Require((item.RemainingAmount ?? 0) + allocation.Given + allocation.Wasted <= (item.AmountTotal ?? 0) + 1e-8, "This vial changed after the incident. Review its record before correcting it.", 409);
                }
            }
            BreakSeals(validated.Where(entry =>
            {
                var before = old.Find(x => x.ItemId == entry.Item.Id);
                return before is null || entry.Given + entry.Wasted > before.Given + before.Wasted + 1e-8 && entry.Item.RemainingAmount > 0;
            }).Select(x => Box(x.Item.BoxId)));
        }
        var payload = new JsonObject
        {
            ["incidentNumber"] = body.Text("incidentNumber"), ["reason"] = reason, ["notes"] = body.Text("notes"),
            ["witness"] = body.Text("witness"), ["witnessSignoff"] = body["witnessSignoff"]?.DeepClone(), ["correctionNote"] = body.Text("correctionNote"),
            ["items"] = new JsonArray(validated.Select(x => (JsonNode)new JsonObject { ["id"] = x.Item.Id, ["boxId"] = x.Item.BoxId, ["given"] = x.GivenValue?.DeepClone(), ["wasted"] = x.WastedValue?.DeepClone() }).ToArray())
        };
        var incident = previous ?? new Incident { CreatedAt = now, ClientKey = clientKey, Revision = 0 };
        incident.IncidentNumber = body.Text("incidentNumber");
        incident.Reason = reason;
        incident.Notes = body.Text("notes");
        incident.Payload = payload.ToJsonString();
        incident.Status = draftOnly ? old.Count > 0 ? "reopened" : "draft" : "completed";
        incident.Revision++;
        incident.UpdatedAt = now;
        if (previous is null) db.Incidents.Add(incident);
        db.SaveChanges();
        db.IncidentVersions.Add(new IncidentVersion { IncidentId = incident.Id, Revision = incident.Revision, Status = incident.Status, Payload = incident.Payload, CreatedAt = now });
        if (!draftOnly)
        {
            foreach (var id in old.Select(x => x.ItemId).Concat(validated.Select(x => x.Item.Id)).Distinct())
            {
                var item = Item(id, false);
                var before = old.Find(x => x.ItemId == id);
                var after = validated.Find(x => x.Item.Id == id);
                var difference = (after is null ? 0 : after.Given + after.Wasted) - (before is null ? 0 : before.Given + before.Wasted);
                item.RemainingAmount = item.RemainingAmount is null ? null : Math.Max(0, Math.Round(item.RemainingAmount.Value - difference, 9));
                item.Status = item.RemainingAmount == 0 ? after?.Given > 0 ? "used" : "disposed" : "opened";
                item.WasOpened = 1;
                item.VerifiedAt = null;
                if (difference != 0 || before is null) Box(item.BoxId).StockRevision++;
                Event(id, old.Count > 0 ? "incident_corrected" : after?.Given > 0 ? "medication_used" : IncidentReasons[reason].Status, item.BoxId, null, new
                {
                    incidentId = incident.Id, incidentNumber = incident.IncidentNumber, revision = incident.Revision, reason = IncidentReasons[reason].Label,
                    given = after?.Given ?? 0, wasted = after?.Wasted ?? 0, previousGiven = before?.Given ?? 0, previousWasted = before?.Wasted ?? 0,
                    remaining = item.RemainingAmount, unit = Object(item.DefinitionSnapshot).Text("amountUnit"), witness = body.Text("witness"), correctionNote = body.Text("correctionNote"), notes = incident.Notes
                });
            }
            db.IncidentAllocations.RemoveRange(old);
            db.IncidentItems.RemoveRange(db.IncidentItems.Where(x => x.IncidentId == incident.Id));
            db.SaveChanges();
            foreach (var entry in validated)
            {
                db.IncidentAllocations.Add(new IncidentAllocation { IncidentId = incident.Id, ItemId = entry.Item.Id, Given = entry.Given, Wasted = entry.Wasted });
                db.IncidentItems.Add(new IncidentItem { IncidentId = incident.Id, ItemId = entry.Item.Id });
            }
        }
        return incident.Id;
    }
    internal void ReopenIncident()
    {
        var incident = db.Incidents.Find(body.Integer("id"));
        Require(incident is not null && incident.Status == "completed" && incident.Revision == body.Integer("revision"), "Only the current completed incident can be reopened. Reload and try again.", 409);
        incident!.Status = "reopened";
        incident.Revision++;
        incident.UpdatedAt = now;
        foreach (var itemId in db.IncidentItems.Where(x => x.IncidentId == incident.Id).Select(x => x.ItemId).ToList())
            Event(itemId, "incident_reopened", null, null, new { incidentId = incident.Id, revision = incident.Revision });
        db.IncidentVersions.Add(new IncidentVersion { IncidentId = incident.Id, Revision = incident.Revision, Status = "reopened", Payload = incident.Payload ?? "{}", CreatedAt = now });
    }
}

internal static class IncidentQueries
{
    internal static JsonObject Record(InventoryDbContext db, int id)
    {
        var incident = db.Incidents.Find(id) ?? throw new ApiException(404, "Incident not found");
        var rows = (from link in db.IncidentItems join item in db.InventoryItems on link.ItemId equals item.Id where link.IncidentId == id select item).ToList();
        var allocations = db.IncidentAllocations.Where(x => x.IncidentId == id).ToList();
        var payload = incident.Payload is not null ? Object(incident.Payload) : new JsonObject
        {
            ["incidentNumber"] = incident.IncidentNumber ?? "", ["reason"] = incident.Reason, ["notes"] = incident.Notes, ["witness"] = "",
            ["items"] = new JsonArray(rows.Select(item => (JsonNode)new JsonObject { ["id"] = item.Id, ["boxId"] = item.BoxId, ["given"] = allocations.Find(x => x.ItemId == item.Id)?.Given, ["wasted"] = allocations.Find(x => x.ItemId == item.Id)?.Wasted }).ToArray())
        };
        var versions = db.IncidentVersions.Where(x => x.IncidentId == id).OrderByDescending(x => x.Revision).ThenByDescending(x => x.Id).ToList();
        var ids = payload.Entries("items").Select(x => x.Text("id")).Concat(rows.Select(x => x.Id)).Concat(versions.SelectMany(x => Object(x.Payload).Entries("items").Select(v => v.Text("id")))).Distinct().ToArray();
        var items = db.InventoryItems.Where(x => ids.Contains(x.Id)).ToList().Select(item =>
        {
            var row = Row(item);
            var requirements = (from link in db.DefinitionTags join tag in db.MedicationTags on link.TagId equals tag.Id where link.DefinitionId == item.DefinitionId select tag.Requirements).ToList().SelectMany(Strings).Distinct();
            row["requirements"] = Array(requirements);
            return (JsonNode)row;
        });
        return new JsonObject { ["incident"] = Row(incident), ["payload"] = payload, ["allocations"] = RowArray(allocations), ["items"] = new JsonArray(items.ToArray()), ["versions"] = RowArray(versions) };
    }
}
