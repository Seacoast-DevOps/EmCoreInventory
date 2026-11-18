using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Catalog;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation
{
    internal void Receive(ReceiveRequest request)
    {
        AccessService.Authorize(access, "stock.create");
        var destination = request.BoxId ?? "unassigned";
        if (destination != "unassigned") AccessService.Authorize(access, "inventory.transfer");
        var box = AccessService.AuthorizeStorage(db, access, destination);
        var definition = db.DrugDefinitions.Find(request.DefinitionId)
            ?? throw new ApiException(400, "Choose a standardized drug from Manage Par Levels");
        AccessService.AuthorizeMedication(access, definition, "view");
        AccessService.AuthorizeMedication(access, definition, "create");

        Require(request.Quantity is >= 1 and <= 1000, "Quantity must be a whole number from 1 to 1000");
        var codes = ReceiptCodes(request);
        var lot = request.LotNumber?.Trim();
        var expiration = request.ExpirationDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string? batchId = null;
        if (request.BatchCreate == true || !string.IsNullOrEmpty(lot) || expiration is not null)
        {
            Require(lot is { Length: > 0 and <= 80 } && expiration is not null, "Enter a lot number and a valid expiration date for the batch");
            batchId = Guid.NewGuid().ToString();
            db.InventoryBatches.Add(new InventoryBatch
            {
                Id = batchId, DefinitionId = definition.Id, LotNumber = lot!, ExpiresOn = expiration!,
                Quantity = request.Quantity, CreatedAt = now
            });
        }

        var replacement = request.Replacement == true;
        if (replacement) RequireWitness(Requirements(definition.Id), "replacement");
        BreakSeals([box]);
        var snapshot = CatalogService.DefinitionSnapshot(definition);
        snapshot["hasStock"] = db.InventoryItems.Any(item => item.DefinitionId == definition.Id);
        snapshot["tagIds"] = Array(db.DefinitionTags.Where(link => link.DefinitionId == definition.Id).Select(link => link.TagId).ToList());
        var snapshotJson = snapshot.ToJsonString();
        var presentation = FormattableString.Invariant($"{definition.ConcentrationValue} {definition.AmountUnit}/{definition.ConcentrationBasis} · {definition.MaxAmount} {definition.AmountUnit} per {definition.Form.ToLowerInvariant()}");
        foreach (var code in codes)
        {
            var item = new InventoryItem
            {
                Id = Guid.NewGuid().ToString(), BoxId = box.Id, Medication = definition.Name, Presentation = presentation,
                Code = code, Status = destination == "unassigned" ? InventoryItemStatus.Unassigned : InventoryItemStatus.Available,
                ReceivedAt = now, DefinitionId = definition.Id, DefinitionSnapshot = snapshotJson, AmountTotal = definition.MaxAmount,
                RemainingAmount = definition.MaxAmount, BatchId = batchId, LotNumber = batchId is null ? null : lot, ExpiresOn = expiration
            };
            db.InventoryItems.Add(item);
            db.TrackingCodes.Add(new TrackingCode { Code = code, ItemId = item.Id, IssuedAt = now });
            Event(item.Id, "received", null, box.Id, new
            {
                code, definition = snapshot, batchId, lotNumber = item.LotNumber, expirationDate = expiration, replacement,
                witness = body.OptionalText("witness")
            });
        }
        box.StockRevision++;
    }

    private string[] ReceiptCodes(ReceiveRequest request)
    {
        if (request.CodeMode == CodeMode.Manual)
        {
            var supplied = request.Codes?.Select(code => code?.Trim().ToUpperInvariant() ?? "").ToArray() ?? [];
            Require(supplied.Length == request.Quantity, "Enter one code for each item");
            Require(supplied.All(code => Regex.IsMatch(code, @"\A[A-Z0-9]{8}\z")) && supplied.Distinct().Count() == supplied.Length,
                "Each code must be a different eight-character alphanumeric code");
            Require(!db.TrackingCodes.Any(row => supplied.Contains(row.Code)), "That tracking code has been used before. It cannot be reused.", 409);
            return supplied;
        }

        var generated = new HashSet<string>(StringComparer.Ordinal);
        do
        {
            while (generated.Count < request.Quantity)
                generated.Add(RandomNumberGenerator.GetString("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8));
            var candidates = generated.ToArray();
            generated.ExceptWith(db.TrackingCodes.Where(row => candidates.Contains(row.Code)).Select(row => row.Code).ToList());
        } while (generated.Count < request.Quantity);
        return generated.ToArray();
    }

    internal void Verify(VerifyRequest request)
    {
        AccessService.Authorize(access, "inventory.view");
        AccessService.Authorize(access, "checks.verify");
        var item = Item(request.ItemId);
        AuthorizeDrug(item, "check");
        Require(item.BoxId != "unassigned", "Assign this item to a container before checking it");
        item.VerifiedAt = request.Verified ? now : null;
        Event(item.Id, "verify", item.BoxId, item.BoxId, new { verified = request.Verified });
    }

    internal void Move(MoveRequest request)
    {
        AccessService.Authorize(access, "inventory.view");
        AccessService.Authorize(access, "inventory.transfer");
        var destination = AccessService.AuthorizeStorage(db, access, request.DestinationId);
        var item = Item(request.ItemId);
        AuthorizeDrug(item, "transfer");
        Require(request.SourceId == item.BoxId, "The item location changed. Refresh inventory and try again.", 409);
        Require(destination.Id != item.BoxId, "Choose a different container. An item cannot move within the same container.");
        var source = Box(item.BoxId);
        RequireWitness(Requirements(item.DefinitionId), "transfer");
        BreakSeals([source, destination]);
        item.BoxId = destination.Id;
        if (destination.Id == "unassigned") item.Status = InventoryItemStatus.Unassigned;
        else if (item.Status == InventoryItemStatus.Unassigned)
            item.Status = item.WasOpened != 0 || item.RemainingAmount < item.AmountTotal ? InventoryItemStatus.Opened : InventoryItemStatus.Available;
        item.VerifiedAt = null;
        source.StockRevision++;
        destination.StockRevision++;
        Event(item.Id, "move", source.Id, destination.Id, new { witness = body.OptionalText("witness") });
    }
}
