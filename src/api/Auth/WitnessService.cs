using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;

namespace EmCoreInventory.Api.Auth;

public static class WitnessService
{
    public static WitnessAuthorization Attach(InventoryDbContext db, InventoryDbContext identityDb, AccessContext context, HttpContext http, string path, JsonObject body)
        => new(db, identityDb, context, http, path, body);
}

public sealed class WitnessAuthorization
{
    private readonly InventoryDbContext db;
    private readonly InventoryDbContext identityDb;
    private readonly AccessContext context;
    private readonly HttpContext http;
    private readonly string path;
    private readonly JsonObject body;
    private readonly JsonObject? credentials;
    private readonly Dictionary<string, InventoryItem> items = [];
    private readonly JsonObject summary;
    private bool verified;

    internal WitnessAuthorization(InventoryDbContext db, InventoryDbContext identityDb, AccessContext context, HttpContext http, string path, JsonObject body)
    {
        this.db = db; this.identityDb = identityDb; this.context = context; this.http = http; this.path = path; this.body = body;
        credentials = body["witnessCredentials"] as JsonObject;
        foreach (var key in new[] { "witnessCredentials", "witnessSignoff", "witness", "witnessVerified", "operatorProfile" }) body.Remove(key);
        void Collect(string? id) { if (!string.IsNullOrEmpty(id) && db.InventoryItems.Find(id) is { } item) items[item.Id] = item; }
        Collect(body.Text("itemId"));
        if (body["items"] is JsonArray selected) foreach (var row in selected.OfType<JsonObject>()) Collect(row.Text("id"));
        if (path.StartsWith("/api/incidents") && body["id"] is JsonValue value && value.TryGetValue<int>(out var incidentId))
            foreach (var id in db.IncidentAllocations.Where(a => a.IncidentId == incidentId).Select(a => a.ItemId)) Collect(id);
        var boxes = new[] { body.Text("sourceId"), body.Text("destinationId"), body.Text("boxId") }.Concat(items.Values.Select(i => i.BoxId)).ToList();
        if (path == "/api/containers") boxes.Add(body.Text("id"));
        foreach (var id in boxes.Where(id => id != "").Distinct())
        {
            var box = db.InventoryBoxes.Find(id);
            if (path is "/api/containers" or "/api/seals" || box?.Sealed == 1)
                foreach (var item in db.InventoryItems.Where(i => i.BoxId == id && (i.Status == "available" || i.Status == "opened"))) items[item.Id] = item;
        }
        var destination = db.InventoryBoxes.Find(body.Text("destinationId"));
        summary = new JsonObject
        {
            ["notes"] = body.Text("notes"), ["correctionNote"] = body.Text("correctionNote"),
            ["container"] = path == "/api/containers" ? new JsonObject { ["name"] = body["name"]?.DeepClone(), ["location"] = body["location"]?.DeepClone(), ["sealed"] = body["sealed"]?.DeepClone(), ["seal"] = body["seal"]?.DeepClone() } : null,
            ["sealBreaks"] = new JsonArray((body["brokenSeals"] as JsonArray ?? []).OfType<JsonObject>().Select(seal => (JsonNode)new JsonObject { ["seal"] = seal["seal"]?.DeepClone(), ["container"] = db.InventoryBoxes.Find(seal.Text("id"))?.Name ?? "" }).ToArray()),
            ["action"] = path switch { "/api/move" => "Transfer medication", "/api/drugs" => "Receive replacement medication", "/api/containers" => "Change container seal", "/api/seals" => body.Text("action") == "break" ? "Break container seal" : "Reseal container", "/api/incidents" => "Save medication incident", _ => "Save medication record" },
            ["incidentNumber"] = body.Text("incidentNumber"), ["reason"] = body.Text("reason"), ["quantity"] = body["quantity"]?.DeepClone(), ["lotNumber"] = body.Text("lotNumber"),
            ["destination"] = destination is null ? null : new JsonObject { ["location"] = destination.Location, ["name"] = destination.Name },
            ["items"] = new JsonArray(items.Values.Select(item =>
            {
                var dose = (body["items"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(row => row.Text("id") == item.Id);
                return (JsonNode)new JsonObject { ["code"] = item.Code, ["medication"] = item.Medication, ["presentation"] = item.Presentation, ["unit"] = Body.Object(item.DefinitionSnapshot).Text("amountUnit"), ["given"] = dose?["given"]?.DeepClone(), ["wasted"] = dose?["wasted"]?.DeepClone() };
            }).ToArray())
        };
        if (db.DrugDefinitions.Find(body.Text("definitionId")) is { } drug) summary["medication"] = drug.Name;
    }
    public void Require()
    {
        if (verified) return;
        ApiException Problem(string message, int status = 422, object? extra = null)
        {
            var data = extra is null ? new JsonObject() : JsonSerializer.SerializeToNode(extra, Body.Options)!.AsObject();
            data["witnessRequired"] = true; data["witnessSummary"] = summary.DeepClone();
            return new ApiException(status, message, data);
        }
        if (credentials is null) throw Problem("A second user must sign off with their own username and password.");
        UserContext witness;
        try { witness = IdentityService.VerifyWitnessCredentials(identityDb, credentials, context.User, http.Connection.RemoteIpAddress?.ToString() ?? ""); }
        catch (ApiException error) { throw Problem(error.Message, error.Status, error.Extra); }
        try
        {
            var access = AccessService.Context(db, witness); AccessService.Authorize(access, "medications.witness");
            foreach (var item in items.Values)
            {
                var drug = AccessService.DrugForItem(db, item); AccessService.AuthorizeMedication(access, drug, "view"); AccessService.AuthorizeMedication(access, drug, "witness");
            }
            if (db.DrugDefinitions.Find(body.Text("definitionId")) is { } definition)
            {
                AccessService.AuthorizeMedication(access, definition, "view"); AccessService.AuthorizeMedication(access, definition, "witness");
            }
        }
        catch (ApiException) { throw Problem("This user is not permitted to witness the selected medication(s)."); }
        var signoff = new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["userId"] = witness.Id, ["username"] = witness.Username, ["name"] = witness.Name, ["serviceId"] = context.User.ServiceId, ["signedAt"] = Body.Now(), ["method"] = "password" };
        db.WitnessSignoffs.Add(new WitnessSignoff { Id = signoff.Text("id"), ActorUserId = context.User.Id, WitnessUserId = witness.Id, WitnessUsername = witness.Username, WitnessName = witness.Name, ServiceId = context.User.ServiceId, Action = path, RequestHash = PasswordHash.Hash(body.ToJsonString()), CreatedAt = signoff.Text("signedAt") });
        body["witnessSignoff"] = signoff; body["witness"] = witness.Actor;
        verified = true;
    }
}
