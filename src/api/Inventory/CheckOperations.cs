using System.Text.Json.Nodes;
using EmCoreInventory.Api.Data;
using EmCoreInventory.Api.Common;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation
{
    internal void SaveCheck(string path)
    {
        var box = db.InventoryBoxes.Find(body.Text("boxId"));
        Require(box is not null && box.Id != "unassigned", "Assign stock to a container before starting a check");
        var draft = db.DrugChecks.SingleOrDefault(x => x.BoxId == box!.Id && x.Status == "draft");
        var currentIds = Contents(box!.Id).Select(x => x.Id).Order().ToArray();
        if (path == "/api/checks/start")
        {
            Require(body.Text("kind") is "scheduled" or "reset" or "adhoc", "Choose a check type");
            if (draft is not null && body.Text("kind") == "scheduled") return;
            if (draft is not null) { draft.Status = "superseded"; draft.UpdatedAt = now; db.SaveChanges(); }
            db.DrugChecks.Add(new DrugCheck { Id = Guid.NewGuid().ToString(), BoxId = box.Id, Status = "draft", Kind = body.Text("kind"), ItemIds = Serialize(currentIds), CheckedIds = "[]", Notes = "", Revision = 1, CreatedAt = now, UpdatedAt = now, StockRevision = box.StockRevision });
            return;
        }
        if (draft is null) throw new ApiException(409, "Start a check before verifying items");
        Require(body.Integer("revision") == draft.Revision, "This check changed in another session. Reload before saving.", 409);
        var ids = Strings(draft.ItemIds);
        var checkedIds = Strings(draft.CheckedIds).ToHashSet();
        Require(draft.StockRevision == box.StockRevision && ids.Order().SequenceEqual(currentIds), "Container stock changed. Reset this check to include the current items.", 409);
        if (path == "/api/checks/verify")
        {
            Require(ids.Contains(body.Text("itemId")) && body.IsBoolean("verified"), "Choose an item in this check");
            if (body.Boolean("verified")) checkedIds.Add(body.Text("itemId")); else checkedIds.Remove(body.Text("itemId"));
            Event(body.Text("itemId"), "check_verified", box.Id, box.Id, new { checkId = draft.Id, verified = body.Boolean("verified") });
        }
        Require(!body.ContainsKey("notes") || body.OptionalText("notes") is { Length: <= 1000 }, "Check notes must be 1,000 characters or fewer");
        var complete = path == "/api/checks/complete";
        Require(!complete || ids.All(checkedIds.Contains), "Verify every item before completing the check");
        draft.CheckedIds = Serialize(checkedIds);
        draft.Notes = body.OptionalText("notes") ?? draft.Notes;
        draft.Status = complete ? "complete" : "draft";
        draft.Revision++;
        draft.UpdatedAt = now;
        draft.CompletedAt = complete ? now : null;
        if (complete) foreach (var id in ids) Event(id, "check_completed", box.Id, box.Id, new { checkId = draft.Id, kind = draft.Kind });
    }
}

internal static class CheckQueries
{
    internal static JsonArray Snapshot(InventoryDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var result = new JsonArray();
        foreach (var box in db.InventoryBoxes.Where(x => x.Id != "unassigned").ToList())
        {
            var items = db.InventoryItems.Where(x => x.BoxId == box.Id && (x.Status == "available" || x.Status == "opened")).ToList();
            var definitions = items.Select(x => x.DefinitionId).ToArray();
            var intervals = db.DrugDefinitions.Where(x => definitions.Contains(x.Id)).Select(x => x.CheckIntervalHours).ToList();
            intervals.Add(box.CheckIntervalHours);
            var hours = intervals.Where(x => x > 0).DefaultIfEmpty().Min();
            var draft = db.DrugChecks.SingleOrDefault(x => x.BoxId == box.Id && x.Status == "draft");
            var last = db.DrugChecks.Where(x => x.BoxId == box.Id && x.Status == "complete").OrderByDescending(x => x.CompletedAt).ThenByDescending(x => x.CreatedAt).FirstOrDefault();
            DateTimeOffset? due = last?.CompletedAt is not null && hours > 0 ? DateTimeOffset.Parse(last.CompletedAt).AddHours(hours) : null;
            var unchanged = last is not null && last.StockRevision == box.StockRevision && Strings(last.ItemIds).Order().SequenceEqual(items.Select(x => x.Id).Order());
            var complete = draft is null && unchanged && (due is null || due > now);
            var checkedIds = draft is null ? [] : Strings(draft.CheckedIds);
            JsonObject? draftJson = null;
            if (draft is not null) { draftJson = Row(draft); draftJson["itemIds"] = Array(Strings(draft.ItemIds)); draftJson["checkedIds"] = Array(checkedIds); }
            result.Add(new JsonObject { ["boxId"] = box.Id, ["status"] = complete ? "complete" : draft is not null && (checkedIds.Length > 0 || draft.Revision > 1) ? "draft" : "not_done", ["stale"] = draft is not null && draft.StockRevision != box.StockRevision, ["checkedIds"] = Array(complete ? Strings(last!.CheckedIds) : checkedIds), ["total"] = items.Count, ["draft"] = draftJson, ["lastCompletedAt"] = last?.CompletedAt, ["dueAt"] = due?.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), ["overdue"] = due is not null && due <= now, ["intervalHours"] = hours });
        }
        return result;
    }
}
