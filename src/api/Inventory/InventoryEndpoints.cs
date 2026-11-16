using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WitnessService = EmCoreInventory.Api.Auth.WitnessService;
using IdentityService = EmCoreInventory.Api.Auth.IdentityService;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Catalog;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

public static class InventoryEndpoints
{
    public static WebApplication MapInventoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/health", () => Results.Ok(new { status = "ok", database = "sqlite" }));
        foreach (var route in new[] { "access", "discrepancies", "logs", "qr", "qr/resolve", "qr/image", "inventory", "vials", "incident", "checks", "history" })
            app.MapGet("/api/" + route, Get);
        foreach (var route in new[] { "verify", "move", "drugs", "incidents", "tags", "definitions", "containers", "incidents/draft", "incidents/reopen", "checks/start", "checks/verify", "checks/save", "checks/complete", "classes", "access/profiles", "access/rules", "seals", "discrepancies", "discrepancies/approve" })
            app.MapPost("/api/" + route, Post);
        return app;
    }
    private static IResult Get(HttpContext http, DatabaseStore store)
    {
        using var identityDb = store.OpenIdentity();
        var user = IdentityService.Session(http, identityDb);
        using var tenant = user.ServiceId == "primary" || user.PlatformOnly ? null : store.OpenService(user.ServiceId);
        var db = tenant ?? identityDb;
        var access = AccessService.Context(db, user);
        var path = http.Request.Path.Value!;
        if (path == "/api/access") return Results.Json(AccessService.Snapshot(db, access));
        Require(!user.PlatformOnly && user.CompanyActive, "Select an active company for inventory operations", 403);
        try
        {
            switch (path)
            {
                case "/api/inventory": return Results.Json(InventoryQueries.Snapshot(db, access));
                case "/api/vials": AccessService.Authorize(access, "inventory.view"); return Results.Json(InventoryQueries.Snapshot(db, access)["items"]);
                case "/api/discrepancies": AccessService.Authorize(access, "discrepancies.view"); return Results.Json(new { entries = InventoryQueries.Discrepancies(db, access) });
                case "/api/logs": AccessService.Authorize(access, "logs.view"); return Results.Json(AccessService.Logs(db, http.Request.Query, identityDb, user.ServiceId));
                case "/api/checks": return Results.Json(InventoryQueries.CheckHistory(db, access, http.Request.Query["boxId"].ToString()));
                case "/api/incident":
                    AccessService.Authorize(access, "incidents.view");
                    Require(int.TryParse(http.Request.Query["id"], out var id), "Choose a valid incident");
                    var record = IncidentQueries.Record(db, id);
                    foreach (var row in record["items"]!.AsArray().OfType<JsonObject>()) InventoryQueries.AuthorizeItem(db, access, db.InventoryItems.Find(row.Text("id"))!);
                    return Results.Json(record);
                case "/api/history":
                    AccessService.Authorize(access, "records.view");
                    var item = InventoryQueries.Lookup(db, http.Request.Query["item"].ToString());
                    InventoryQueries.AuthorizeItem(db, access, item);
                    return Results.Json(new { item, events = db.InventoryEvents.Where(x => x.ItemId == item.Id).OrderByDescending(x => x.Id).ToList() });
                default: return Qr(http, db, access);
            }
        }
        catch (ApiException error) { AuditFailure(db, identityDb, access, http, error); throw; }
    }
    private static IResult Qr(HttpContext http, InventoryDbContext db, AccessContext access)
    {
        AccessService.Authorize(access, "records.view");
        var identity = http.Request.Query["item"].ToString();
        string? parsedId = null;
        if (http.Request.Path == "/api/qr/resolve")
        {
            var raw = http.Request.Query["value"].ToString();
            Require(raw.Length <= 300, "Enter an EMCore vial QR code or eight-character tracking code");
            var value = raw.Trim();
            if (Regex.IsMatch(value, "^[a-zA-Z0-9]{8}$")) identity = value.ToUpperInvariant();
            else
            {
                var match = Regex.Match(value, "^EMCORE:1:([a-zA-Z0-9-]{1,80}):([a-zA-Z0-9-]{1,80}):([A-Z0-9]{8})$");
                Require(match.Success, "This is not a supported EMCore vial QR code");
                Require(match.Groups[1].Value == access.User.ServiceId, "This QR belongs to another service. Select that service before scanning.", 403);
                parsedId = match.Groups[2].Value; identity = match.Groups[3].Value;
            }
        }
        Require(!string.IsNullOrWhiteSpace(identity) && identity.Length <= 80, "Enter an item code");
        var item = db.InventoryItems.FirstOrDefault(x => x.Id == identity || x.Code == identity);
        Require(item is not null && (parsedId is null || parsedId == item.Id), "No matching vial exists in the current service", 404);
        InventoryQueries.AuthorizeItem(db, access, item!);
        var valueText = $"EMCORE:1:{access.User.ServiceId}:{item!.Id}:{item.Code}";
        if (http.Request.Path == "/api/qr/image") return Results.File(QrImages.Create(valueText), "image/png", "EMCore-" + item.Code + ".png");
        var box = db.InventoryBoxes.Find(item.BoxId)!;
        return Results.Json(new { item, box = new { location = box.Location, name = box.Name }, value = valueText, serviceName = access.User.ServiceName });
    }
    private static async Task<IResult> Post(HttpContext http, DatabaseStore store)
    {
        using var identityDb = store.OpenIdentity();
        var user = IdentityService.Session(http, identityDb);
        Require(!user.PlatformOnly && user.CompanyActive, "Select an active company for inventory operations", 403);
        using var tenant = user.ServiceId == "primary" ? null : store.OpenService(user.ServiceId);
        var db = tenant ?? identityDb;
        var access = AccessService.Context(db, user);
        var body = await http.Request.ReadFromJsonAsync<JsonObject>() ?? throw new ApiException(400, "Invalid request");
        var path = http.Request.Path.Value!;
        var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var witness = WitnessService.Attach(db, identityDb, access, http, path, body);
        var operation = new InventoryOperation(db, access, witness, body, now);
        using var transaction = db.Database.BeginTransaction();
        int? savedIncident = null;
        try
        {
            operation.Authorize(path);
            var lastSetting = db.SettingsEvents.Select(x => (int?)x.Id).Max() ?? 0;
            switch (path)
            {
                case "/api/seals": operation.SaveSeal(); break;
                case "/api/discrepancies": case "/api/discrepancies/approve": operation.SaveDiscrepancy(path); break;
                case "/api/classes": case "/api/access/profiles": case "/api/access/rules": AccessService.Save(db, path, body, now); break;
                case "/api/checks/start": case "/api/checks/verify": case "/api/checks/save": case "/api/checks/complete": operation.SaveCheck(path); break;
                case "/api/containers": operation.SaveContainer(); break;
                case "/api/incidents/reopen": operation.ReopenIncident(); break;
                case "/api/incidents": case "/api/incidents/draft": savedIncident = operation.SaveIncident(path.EndsWith("/draft")); break;
                case "/api/tags": case "/api/definitions": CatalogService.Save(db, path, body, now, access); break;
                case "/api/drugs": operation.Receive(); break;
                case "/api/verify": operation.Verify(); break;
                case "/api/move": operation.Move(); break;
                default: throw new ApiException(404, "Not found");
            }
            var audit = (JsonObject)body.DeepClone(); audit["actorUserId"] = user.Id;
            db.AccessAudits.Add(new AccessAudit { ActorProfile = user.Actor, Action = path, Details = audit.ToJsonString(), CreatedAt = now });
            db.SaveChanges();
            foreach (var setting in db.SettingsEvents.Where(x => x.Id > lastSetting).ToList()) { setting.ActorProfile = user.Actor; setting.ActorUserId = user.Id; }
            db.SaveChanges();
            transaction.Commit();
        }
        catch (Exception error)
        {
            transaction.Rollback();
            db.ChangeTracker.Clear();
            if (identityDb != db) identityDb.ChangeTracker.Clear();
            if (error is ApiException apiError) AuditFailure(db, identityDb, access, http, apiError);
            throw;
        }
        if (identityDb != db) identityDb.SaveChanges();
        var result = InventoryQueries.Snapshot(db, access);
        if (savedIncident is not null) result["savedIncident"] = IncidentQueries.Record(db, savedIncident.Value);
        else result["access"] = Node(AccessService.Snapshot(db, AccessService.Context(db, IdentityService.Session(http, identityDb))));
        return Results.Json(result);
    }
    private static void AuditFailure(InventoryDbContext db, InventoryDbContext identityDb, AccessContext access, HttpContext http, ApiException error)
    {
        var extra = Node(error.Extra) as JsonObject;
        if (extra?.OptionalText("witnessFailureKey") is { } key) IdentityService.RecordFailure(identityDb, key);
        if (extra?.Boolean("witnessRequired") == true) IdentityService.Audit(identityDb, access.User, "Witness sign-off required / rejected", new { action = http.Request.Path.Value, error = error.Message });
        if (error.Status == 403) db.AccessAudits.Add(new AccessAudit { ActorProfile = access.User.Actor, Action = "Access denied: " + http.Request.Method + " " + http.Request.Path, Details = Serialize(new { error = error.Message }), CreatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") });
        identityDb.SaveChanges();
        if (identityDb != db) db.SaveChanges();
    }
}
