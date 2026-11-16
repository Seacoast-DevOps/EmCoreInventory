using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EmCoreInventory.Api.Catalog;
using EmCoreInventory.Api.Data;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

internal sealed partial class InventoryOperation
{
    internal void Receive()
    {
        var definition = db.DrugDefinitions.Find(body.Text("definitionId"));
        Require(definition is not null, "Choose a standardized drug from Manage Par Levels");
        var quantity = body.Integer("quantity");
        Require(quantity is >= 1 and <= 1000, "Quantity must be a whole number from 1 to 1000");
        Require(!body.ContainsKey("replacement") || body.IsBoolean("replacement"), "Replacement must be true or false");
        Require(!body.ContainsKey("codeMode") || body.Text("codeMode") is "manual" or "auto", "Choose manual or generated codes");
        var codes = new List<string>();
        if (body.Text("codeMode") == "manual")
        {
            Require(body["codes"] is JsonArray a && a.Count == quantity, "Enter one code for each item");
            foreach (var node in (JsonArray)body["codes"]!) codes.Add(node is JsonValue v && v.TryGetValue<string>(out var code) ? code.Trim().ToUpperInvariant() : "");
            Require(codes.All(x => Regex.IsMatch(x, "^[A-Z0-9]{8}$")) && codes.Distinct().Count() == codes.Count, "Each code must be a different eight-character alphanumeric code");
            Require(!db.TrackingCodes.Any(x => codes.Contains(x.Code)), "That tracking code has been used before. It cannot be reused.", 409);
        }
        Require(!body.ContainsKey("lotNumber") || body.OptionalText("lotNumber") is not null, "Enter a valid lot number");
        Require(!body.ContainsKey("batchCreate") || body.IsBoolean("batchCreate"), "Batch creation must be true or false");
        var lot = body.Text("lotNumber").Trim();
        var expiration = body.Text("expirationDate");
        if (body.Boolean("batchCreate") || lot.Length > 0 || expiration.Length > 0)
            Require(lot.Length is > 0 and <= 80 && DateOnly.TryParseExact(expiration, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "Enter a lot number and a valid expiration date for the batch");
        var batchId = lot.Length > 0 ? Guid.NewGuid().ToString() : null;
        if (batchId is not null) db.InventoryBatches.Add(new InventoryBatch { Id = batchId, DefinitionId = definition!.Id, LotNumber = lot, ExpiresOn = expiration, Quantity = quantity, CreatedAt = now });
        var box = Box(body.Text("boxId", "unassigned"));
        RequireWitness(Requirements(definition!.Id), body.Boolean("replacement") ? "replacement" : "");
        BreakSeals([box]);
        var snapshot = CatalogService.DefinitionSnapshot(definition);
        snapshot["hasStock"] = db.InventoryItems.Any(item => item.DefinitionId == definition.Id);
        snapshot["tagIds"] = Array(db.DefinitionTags.Where(link => link.DefinitionId == definition.Id).Select(link => link.TagId).ToList());
        var generatedCodes = new HashSet<string>();
        var presentation = $"{definition.ConcentrationValue.ToString(CultureInfo.InvariantCulture)} {definition.AmountUnit}/{definition.ConcentrationBasis} · {definition.MaxAmount.ToString(CultureInfo.InvariantCulture)} {definition.AmountUnit} per {definition.Form.ToLowerInvariant()}";
        for (var i = 0; i < quantity; i++)
        {
            string code;
            if (codes.Count > 0) code = codes[i];
            else do { code = string.Concat(Enumerable.Range(0, 8).Select(_ => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[RandomNumberGenerator.GetInt32(36)])); } while (generatedCodes.Contains(code) || db.TrackingCodes.Any(x => x.Code == code));
            generatedCodes.Add(code);
            var item = new InventoryItem { Id = Guid.NewGuid().ToString(), BoxId = box.Id, Medication = definition.Name, Presentation = presentation, Code = code, Status = box.Id == "unassigned" ? "unassigned" : "available", ReceivedAt = now, DefinitionId = definition.Id, DefinitionSnapshot = snapshot.ToJsonString(), AmountTotal = definition.MaxAmount, RemainingAmount = definition.MaxAmount, BatchId = batchId, LotNumber = lot.Length > 0 ? lot : null, ExpiresOn = expiration.Length > 0 ? expiration : null };
            db.InventoryItems.Add(item);
            db.SaveChanges();
            if (!db.TrackingCodes.Any(x => x.Code == code)) db.TrackingCodes.Add(new TrackingCode { Code = code, ItemId = item.Id, IssuedAt = now });
            Event(item.Id, "received", null, box.Id, new { code, definition = snapshot, batchId, lotNumber = item.LotNumber, expirationDate = item.ExpiresOn, replacement = body.Boolean("replacement"), witness = body.OptionalText("witness") });
        }
        box.StockRevision++;
    }
    internal void Verify()
    {
        var item = Item(body.Text("itemId"));
        Require(item.BoxId != "unassigned", "Assign this item to a container before checking it");
        Require(body.IsBoolean("verified"), "Verification must be true or false");
        item.VerifiedAt = body.Boolean("verified") ? now : null;
        Event(item.Id, "verify", item.BoxId, item.BoxId, new { verified = body.Boolean("verified") });
    }
    internal void Move()
    {
        var item = Item(body.Text("itemId"));
        Require(body.Text("sourceId") == item.BoxId, "The item location changed. Refresh inventory and try again.", 409);
        var destination = Box(body.Text("destinationId"));
        Require(destination.Id != item.BoxId, "Choose a different container. An item cannot move within the same container.");
        var source = Box(item.BoxId);
        RequireWitness(Requirements(item.DefinitionId), "transfer");
        BreakSeals([source, destination]);
        item.BoxId = destination.Id;
        item.Status = destination.Id == "unassigned" ? "unassigned" : item.Status == "unassigned" ? item.WasOpened != 0 || item.RemainingAmount < item.AmountTotal ? "opened" : "available" : item.Status;
        item.VerifiedAt = null;
        source.StockRevision++; destination.StockRevision++;
        Event(item.Id, "move", source.Id, destination.Id, new { witness = body.OptionalText("witness") });
    }
}
