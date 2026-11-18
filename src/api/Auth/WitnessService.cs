using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Auth;

public static class WitnessService
{
    // Attach after acquiring the company transaction lock. It must remain held through sign-off and commit.
    public static WitnessAuthorization Attach(InventoryDbContext db, DatabaseStore store, AccessContext context, HttpContext http, string route, JsonObject body)
        => new(db, store, context, http, route, body);
}

public sealed class WitnessAuthorization
{
    private readonly InventoryDbContext db;
    private readonly DatabaseStore store;
    private readonly AccessContext context;
    private readonly HttpContext http;
    private readonly string route;
    private readonly JsonObject body;
    private readonly JsonObject? credentials;
    private readonly Dictionary<string, InventoryItem> items = [];
    private readonly InventoryBox[] boxes;
    private readonly DrugDefinition? definition;
    private readonly JsonObject summary;
    private bool verified;

    internal WitnessAuthorization(InventoryDbContext db, DatabaseStore store, AccessContext context, HttpContext http, string route, JsonObject body)
    {
        this.db = db;
        this.store = store;
        this.context = context;
        this.http = http;
        this.route = route;
        this.body = body;

        credentials = body["witnessCredentials"] as JsonObject;
        foreach (var key in new[] { "witnessCredentials", "witnessSignoff", "witness", "witnessVerified", "operatorProfile" })
            body.Remove(key);

        var selected = (body["items"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
        var itemIds = selected.Select(row => row.Text("id")).Append(body.Text("itemId")).ToList();
        if ((route is "/api/incidents" or "/api/incidents/draft" or "/api/incidents/reopen") &&
            body["id"] is JsonValue value && value.TryGetValue<int>(out var incidentId))
            itemIds.AddRange(db.IncidentAllocations.Where(a => a.IncidentId == incidentId).Select(a => a.ItemId).ToList());

        foreach (var id in itemIds.Where(IsLookupId).Distinct())
            if (db.InventoryItems.Find(id) is { } item)
                items[item.Id] = item;

        var destinationId = body.Text("destinationId");
        var boxId = route == "/api/drugs" ? body.Text("boxId", "unassigned") : body.Text("boxId");
        var boxIds = items.Values.Select(i => i.BoxId).Append(destinationId).Append(boxId).ToList();
        if (route == "/api/containers") boxIds.Add(body.Text("id"));
        boxes = boxIds.Where(IsLookupId).Distinct().Select(id => db.InventoryBoxes.Find(id)).OfType<InventoryBox>().ToArray();
        foreach (var box in boxes)
        {
            if (route is "/api/containers" or "/api/seals" || box.Sealed == 1)
                foreach (var item in db.InventoryItems.Where(i => i.BoxId == box.Id &&
                    (i.Status == InventoryItemStatus.Available || i.Status == InventoryItemStatus.Opened)).ToList())
                    items[item.Id] = item;
        }

        var definitionId = body.Text("definitionId");
        definition = IsLookupId(definitionId) ? db.DrugDefinitions.Find(definitionId) : null;
        var visibleBoxes = boxes.Where(box => AccessService.StorageAllowed(context, box)).ToDictionary(box => box.Id);
        var destination = visibleBoxes.GetValueOrDefault(destinationId);
        var requestedBreaks = (body["brokenSeals"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
        var confirmedBreaks = visibleBoxes.Values.Where(box => box.Sealed != 0 &&
            requestedBreaks.Any(entry => entry.Text("id") == box.Id &&
                SealNumber(entry) == box.Seal));
        var visibleItems = items.Values.Where(item => visibleBoxes.ContainsKey(item.BoxId) &&
            AccessService.MedicationPermitted(context, AccessService.DrugForItem(db, item), "view"));

        summary = new JsonObject
        {
            ["notes"] = body.Text("notes"),
            ["correctionNote"] = body.Text("correctionNote"),
            ["container"] = route == "/api/containers" ? new JsonObject
            {
                ["name"] = body["name"]?.DeepClone(),
                ["location"] = body["location"]?.DeepClone(),
                ["sealed"] = body["sealed"]?.DeepClone(),
                ["seal"] = body["seal"]?.DeepClone()
            } : null,
            ["sealBreaks"] = new JsonArray(confirmedBreaks.Select(box => (JsonNode)new JsonObject
            {
                ["seal"] = box.Seal,
                ["container"] = box.Name
            }).ToArray()),
            ["action"] = route switch
            {
                "/api/move" => "Transfer medication",
                "/api/drugs" => "Receive replacement medication",
                "/api/containers" => "Change container seal",
                "/api/seals" => body.Text("action") == "break" ? "Break container seal" : "Reseal container",
                "/api/incidents" => "Save medication incident",
                _ => "Save medication record"
            },
            ["incidentNumber"] = body.Text("incidentNumber"),
            ["reason"] = body.Text("reason"),
            ["quantity"] = body["quantity"]?.DeepClone(),
            ["lotNumber"] = body.Text("lotNumber"),
            ["destination"] = destination is null ? null : new JsonObject { ["location"] = destination.Location, ["name"] = destination.Name },
            ["items"] = new JsonArray(visibleItems.Select(item =>
            {
                var dose = selected.FirstOrDefault(row => row.Text("id") == item.Id);
                return (JsonNode)new JsonObject
                {
                    ["code"] = item.Code,
                    ["medication"] = item.Medication,
                    ["presentation"] = item.Presentation,
                    ["unit"] = Body.Object(item.DefinitionSnapshot).Text("amountUnit"),
                    ["given"] = dose?["given"]?.DeepClone(),
                    ["wasted"] = dose?["wasted"]?.DeepClone()
                };
            }).ToArray())
        };
        if (definition is not null && AccessService.MedicationPermitted(context, definition, "view"))
            summary["medication"] = definition.Name;
    }

    public void Require()
    {
        if (verified) return;
        if (credentials is null) throw Problem("A second user must sign off with their own username and password.");

        UserContext witness;
        try { witness = IdentityService.VerifyWitnessCredentials(store, credentials, context.User, http); }
        catch (ApiException error) { throw Problem(error.Message, error.Status); }

        try
        {
            var access = AccessService.Context(db, witness);
            AccessService.Authorize(access, "medications.witness");
            foreach (var box in boxes)
                AccessService.AuthorizeStorage(db, access, box.Id);
            foreach (var item in items.Values)
            {
                AccessService.AuthorizeStorage(db, access, item.BoxId);
                AuthorizeMedication(access, AccessService.DrugForItem(db, item));
            }
            if (definition is not null) AuthorizeMedication(access, definition);
        }
        catch (ApiException)
        {
            throw Problem("This user is not permitted to witness the selected medication(s).");
        }

        var signoff = new WitnessSignoff
        {
            Id = Guid.NewGuid().ToString(),
            ActorUserId = context.User.Id,
            WitnessUserId = witness.Id,
            WitnessUsername = witness.Username,
            WitnessName = witness.Name,
            ServiceId = context.User.ServiceId,
            Action = route,
            RequestHash = PasswordHash.Hash(body.ToJsonString()),
            CreatedAt = Body.Now()
        };
        db.WitnessSignoffs.Add(signoff);
        body["witnessSignoff"] = new JsonObject
        {
            ["id"] = signoff.Id,
            ["userId"] = signoff.WitnessUserId,
            ["username"] = signoff.WitnessUsername,
            ["name"] = signoff.WitnessName,
            ["serviceId"] = signoff.ServiceId,
            ["signedAt"] = signoff.CreatedAt,
            ["method"] = "password"
        };
        body["witness"] = witness.Actor;
        verified = true;
    }

    private ApiException Problem(string message, int status = 422) => new(status, message, new JsonObject
    {
        ["witnessRequired"] = true,
        ["witnessSummary"] = summary.DeepClone()
    });

    private static string? SealNumber(JsonObject entry) =>
        entry["seal"] is JsonValue value && value.TryGetValue<string>(out var seal) ? seal : null;

    private static bool IsLookupId(string id) => id is { Length: > 0 and <= 128 } && !id.Any(char.IsControl);

    private static void AuthorizeMedication(AccessContext access, DrugDefinition? definition)
    {
        AccessService.AuthorizeMedication(access, definition, "view");
        AccessService.AuthorizeMedication(access, definition, "witness");
    }
}
