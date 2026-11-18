using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Data;
using EmCoreInventory.Api.Common;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal enum CheckUpdate { Verify, Save, Complete }

internal sealed partial class InventoryOperation
{
    internal void StartCheck(StartCheckRequest request)
    {
        var permission = request.Kind switch
        {
            CheckKind.Reset => "checks.reset",
            CheckKind.Adhoc => "checks.adhoc",
            CheckKind.Scheduled => "checks.start",
            _ => throw new ArgumentOutOfRangeException(nameof(request))
        };
        var box = AuthorizeCheck(permission);
        var draft = db.DrugChecks.SingleOrDefault(x => x.BoxId == box.Id && x.Status == DrugCheckStatus.Draft);
        if (draft is not null && request.Kind == CheckKind.Scheduled) return;
        if (draft is not null)
        {
            draft.Status = DrugCheckStatus.Superseded;
            draft.UpdatedAt = now;
            db.SaveChanges();
        }
        var currentIds = Contents(box.Id).Select(x => x.Id).Order().ToArray();
        db.DrugChecks.Add(new DrugCheck { Id = Guid.NewGuid().ToString(), BoxId = box.Id, Status = DrugCheckStatus.Draft, Kind = body.Text("kind"), ItemIds = Serialize(currentIds), CheckedIds = "[]", Notes = "", Revision = 1, CreatedAt = now, UpdatedAt = now, StockRevision = box.StockRevision });
    }

    internal void UpdateCheck(CheckUpdate update)
    {
        var permission = update switch
        {
            CheckUpdate.Verify => "checks.verify",
            CheckUpdate.Save => "checks.save",
            CheckUpdate.Complete => "checks.complete",
            _ => throw new ArgumentOutOfRangeException(nameof(update))
        };
        var box = AuthorizeCheck(permission, update == CheckUpdate.Verify ? body.Text("itemId") : null);
        var draft = db.DrugChecks.SingleOrDefault(x => x.BoxId == box.Id && x.Status == DrugCheckStatus.Draft);
        var currentIds = Contents(box.Id).Select(x => x.Id).Order().ToArray();
        if (draft is null) throw new ApiException(409, "Start a check before verifying items");
        Require(body.Integer("revision") == draft.Revision, "This check changed in another session. Reload before saving.", 409);
        var ids = Strings(draft.ItemIds);
        var checkedIds = Strings(draft.CheckedIds).ToHashSet();
        Require(draft.StockRevision == box.StockRevision && ids.Order().SequenceEqual(currentIds), "Container stock changed. Reset this check to include the current items.", 409);
        if (update == CheckUpdate.Verify)
        {
            Require(ids.Contains(body.Text("itemId")) && body.IsBoolean("verified"), "Choose an item in this check");
            if (body.Boolean("verified")) checkedIds.Add(body.Text("itemId")); else checkedIds.Remove(body.Text("itemId"));
            Event(body.Text("itemId"), "check_verified", box.Id, box.Id, new { checkId = draft.Id, verified = body.Boolean("verified") });
        }
        Require(!body.ContainsKey("notes") || body.OptionalText("notes") is { Length: <= 1000 }, "Check notes must be 1,000 characters or fewer");
        var complete = update == CheckUpdate.Complete;
        Require(!complete || ids.All(checkedIds.Contains), "Verify every item before completing the check");
        draft.CheckedIds = Serialize(checkedIds);
        draft.Notes = body.OptionalText("notes") ?? draft.Notes;
        draft.Status = complete ? DrugCheckStatus.Complete : DrugCheckStatus.Draft;
        draft.Revision++;
        draft.UpdatedAt = now;
        draft.CompletedAt = complete ? now : null;
        if (complete) foreach (var id in ids) Event(id, "check_completed", box.Id, box.Id, new { checkId = draft.Id, kind = draft.Kind });
    }

    private InventoryBox AuthorizeCheck(string permission, string? itemId = null)
    {
        AccessService.Authorize(access, "inventory.view");
        var box = AccessService.AuthorizeStorage(db, access, body.Text("boxId"));
        AccessService.Authorize(access, permission);
        if (itemId is not null) AuthorizeDrug(db.InventoryItems.Find(itemId), "check");
        else foreach (var item in Contents(box.Id)) AuthorizeDrug(item, "check");
        Require(box.Id != "unassigned", "Assign stock to a container before starting a check");
        return box;
    }
}

internal static class CheckQueries
{
    internal static IEnumerable<string> ReferencedItemIds(DrugCheck check)
        => Strings(check.ItemIds).Union(Strings(check.CheckedIds));

    internal static JsonArray Snapshot(InventoryDbContext db, AccessContext access, IEnumerable<InventoryBox> visibleBoxes)
    {
        var now = DateTimeOffset.UtcNow;
        var result = new JsonArray();
        foreach (var box in visibleBoxes.Where(x => x.Id != "unassigned"))
        {
            var items = db.InventoryItems.Where(x => x.BoxId == box.Id && (x.Status == InventoryItemStatus.Available || x.Status == InventoryItemStatus.Opened)).ToList();
            if (items.Any(item => !InventoryQueries.Visible(db, access, item))) continue;
            var draft = db.DrugChecks.SingleOrDefault(x => x.BoxId == box.Id && x.Status == DrugCheckStatus.Draft);
            var last = db.DrugChecks.Where(x => x.BoxId == box.Id && x.Status == DrugCheckStatus.Complete).OrderByDescending(x => x.CompletedAt).ThenByDescending(x => x.CreatedAt).FirstOrDefault();
            if ((draft is not null && HasHiddenItems(draft)) || (last is not null && HasHiddenItems(last))) continue;

            var definitions = items.Select(x => x.DefinitionId).ToArray();
            var intervals = db.DrugDefinitions.Where(x => definitions.Contains(x.Id)).Select(x => x.CheckIntervalHours).ToList();
            intervals.Add(box.CheckIntervalHours);
            var hours = intervals.Where(x => x > 0).DefaultIfEmpty().Min();
            DateTimeOffset? due = last?.CompletedAt is not null && hours > 0 ? DateTimeOffset.Parse(last.CompletedAt).AddHours(hours) : null;
            var unchanged = last is not null && last.StockRevision == box.StockRevision && Strings(last.ItemIds).Order().SequenceEqual(items.Select(x => x.Id).Order());
            var complete = draft is null && unchanged && (due is null || due > now);
            var checkedIds = draft is null ? [] : Strings(draft.CheckedIds);
            JsonObject? draftJson = null;
            if (draft is not null) { draftJson = Row(draft); draftJson["itemIds"] = Array(Strings(draft.ItemIds)); draftJson["checkedIds"] = Array(checkedIds); }
            result.Add(new JsonObject { ["boxId"] = box.Id, ["status"] = complete ? "complete" : draft is not null && (checkedIds.Length > 0 || draft.Revision > 1) ? "draft" : "not_done", ["stale"] = draft is not null && draft.StockRevision != box.StockRevision, ["checkedIds"] = Array(complete ? Strings(last!.CheckedIds) : checkedIds), ["total"] = items.Count, ["draft"] = draftJson, ["lastCompletedAt"] = last?.CompletedAt, ["dueAt"] = due?.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), ["overdue"] = due is not null && due <= now, ["intervalHours"] = hours });
        }
        return result;

        bool HasHiddenItems(DrugCheck check) => ReferencedItemIds(check)
            .Any(id => db.InventoryItems.Find(id) is not { } item || !InventoryQueries.Visible(db, access, item));
    }
}
