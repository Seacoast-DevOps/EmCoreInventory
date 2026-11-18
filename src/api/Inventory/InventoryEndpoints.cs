using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdentityService = EmCoreInventory.Api.Auth.IdentityService;
using UserContext = EmCoreInventory.Api.Auth.UserContext;
using WitnessService = EmCoreInventory.Api.Auth.WitnessService;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.AspNetCore.Mvc;
using static EmCoreInventory.Api.Inventory.InventoryJson;

namespace EmCoreInventory.Api.Inventory;

public static class InventoryEndpoints
{
    public static WebApplication MapInventoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/health", () => Results.Ok(new { status = "ok", database = "postgresql" }));
        app.MapGet("/api/access", Read((_, db, access) => Results.Json(AccessService.Snapshot(db, access)), allowPlatformAccess: true));
        app.MapGet("/api/inventory", Read((_, db, access) => Results.Json(InventoryQueries.Snapshot(db, access))));
        app.MapGet("/api/vials", Read((_, db, access) =>
        {
            AccessService.Authorize(access, "inventory.view");
            return Results.Json(InventoryQueries.Snapshot(db, access)["items"]);
        }));
        app.MapGet("/api/discrepancies", Read((_, db, access) =>
        {
            AccessService.Authorize(access, "discrepancies.view");
            return Results.Json(new { entries = InventoryQueries.Discrepancies(db, access) });
        }));
        app.MapGet("/api/logs", Read((http, db, access) =>
        {
            AccessService.Authorize(access, "logs.view");
            return Results.Json(LogQueries.Page(db, http.Request.Query, access.User.ServiceId));
        }));
        app.MapGet("/api/checks", Read((http, db, access) => Results.Json(
            InventoryQueries.CheckHistory(db, access, http.Request.Query["boxId"].ToString()))));
        app.MapGet("/api/incident", Read((http, db, access) => GetIncident(db, access, http.Request.Query["id"].ToString())));
        app.MapGet("/api/history", Read((http, db, access) => GetHistory(db, access, http.Request.Query["item"].ToString())));
        app.MapGet("/api/qr", Read((http, db, access) => GetQr(db, access, http.Request.Query["item"].ToString(), QrMode.Label)));
        app.MapGet("/api/qr/image", Read((http, db, access) => GetQr(db, access, http.Request.Query["item"].ToString(), QrMode.Image)));
        app.MapGet("/api/qr/resolve", Read((http, db, access) => GetQr(db, access, http.Request.Query["value"].ToString(), QrMode.Resolve)));

        MapWrite<VerifyRequest>(app, "/api/verify", (op, request) => op.Verify(request));
        MapWrite<MoveRequest>(app, "/api/move", (op, request) => op.Move(request));
        MapWrite<ReceiveRequest>(app, "/api/drugs", (op, request) => op.Receive(request));
        MapWrite<IncidentRequest>(app, "/api/incidents", (op, _) => { return op.SaveIncident(draftOnly: false); });
        MapWrite<IncidentRequest>(app, "/api/incidents/draft", (op, _) => { return op.SaveIncident(draftOnly: true); });
        MapWrite<ReopenIncidentRequest>(app, "/api/incidents/reopen", (op, _) => op.ReopenIncident());
        MapWrite<TagRequest>(app, "/api/tags", (op, _) => op.SaveTag());
        MapWrite<DefinitionRequest>(app, "/api/definitions", (op, _) => op.SaveDefinition());
        MapWrite<ContainerRequest>(app, "/api/containers", (op, _) => op.SaveContainer());
        MapWrite<StartCheckRequest>(app, "/api/checks/start", (op, request) => op.StartCheck(request));
        MapWrite<VerifyCheckRequest>(app, "/api/checks/verify", (op, _) => op.UpdateCheck(CheckUpdate.Verify));
        MapWrite<SaveCheckRequest>(app, "/api/checks/save", (op, _) => op.UpdateCheck(CheckUpdate.Save));
        MapWrite<SaveCheckRequest>(app, "/api/checks/complete", (op, _) => op.UpdateCheck(CheckUpdate.Complete));
        MapWrite<ClassRequest>(app, "/api/classes", (op, _) => op.SaveClass());
        MapWrite<ProfileRequest>(app, "/api/access/profiles", (op, _) => op.SaveProfile());
        MapWrite<RuleRequest>(app, "/api/access/rules", (op, _) => op.SaveRule());
        MapWrite<SealRequest>(app, "/api/seals", (op, request) => op.SaveSeal(request));
        MapWrite<DiscrepancyRequest>(app, "/api/discrepancies", (op, _) => op.ReportDiscrepancy());
        MapWrite<ApproveDiscrepancyRequest>(app, "/api/discrepancies/approve", (op, _) => op.ApproveDiscrepancy());
        return app;
    }

    private static Func<HttpContext, DatabaseStore, Task<IResult>> Read(
        Func<HttpContext, InventoryDbContext, AccessContext, IResult> execute, bool allowPlatformAccess = false)
        => async (http, store) =>
        {
            using var identityDb = store.OpenIdentity();
            var initialUser = IdentityService.Session(http, identityDb);
            if (allowPlatformAccess && (initialUser.PlatformOnly || !initialUser.CompanyActive))
                return Results.Json(AccessService.Snapshot(null, AccessService.Context(null, initialUser)));
            RequireActiveCompany(initialUser);

            await using var transaction = await store.BeginCompanyTransactionAsync(
                identityDb, initialUser.ServiceId, http.RequestAborted, CompanyLockMode.Read);
            var user = LockedSession(http, identityDb, initialUser.ServiceId);
            using var tenant = user.ServiceId == DatabaseStore.PrimaryServiceId ? null : store.OpenService(user.ServiceId, identityDb);
            var db = tenant ?? identityDb;
            try
            {
                var result = execute(http, db, AccessService.Context(db, user));
                await transaction.CommitAsync();
                return result;
            }
            catch (ApiException error)
            {
                AuditFailure(db, identityDb, user, http, error);
                await transaction.CommitAsync();
                throw;
            }
        };

    private static UserContext LockedSession(HttpContext http, InventoryDbContext db, string selectedCompany)
    {
        var user = IdentityService.Session(http, db);
        Require(user.ServiceId == selectedCompany, "The selected company changed. Reload and try again.", 409);
        RequireActiveCompany(user);
        return user;
    }

    private static IResult GetIncident(InventoryDbContext db, AccessContext access, string incidentId)
    {
        AccessService.Authorize(access, "incidents.view");
        Require(int.TryParse(incidentId, out var id), "Choose a valid incident");
        return Results.Json(IncidentQueries.AuthorizedRecord(db, access, id));
    }

    private static IResult GetHistory(InventoryDbContext db, AccessContext access, string identity)
    {
        AccessService.Authorize(access, "records.view");
        var item = InventoryQueries.Lookup(db, identity);
        InventoryQueries.AuthorizeItem(db, access, item);
        return Results.Json(new { item, events = db.InventoryEvents.Where(x => x.ItemId == item.Id).OrderByDescending(x => x.Id).ToList() });
    }

    private enum QrMode { Label, Image, Resolve }

    private static IResult GetQr(InventoryDbContext db, AccessContext access, string identity, QrMode mode)
    {
        AccessService.Authorize(access, "records.view");
        string? parsedId = null;
        if (mode == QrMode.Resolve)
        {
            Require(identity.Length <= 300, "Enter an EMCore vial QR code or eight-character tracking code");
            var value = identity.Trim();
            if (Regex.IsMatch(value, "^[a-zA-Z0-9]{8}$")) identity = value.ToUpperInvariant();
            else
            {
                var match = Regex.Match(value, "^EMCORE:1:([a-zA-Z0-9-]{1,80}):([a-zA-Z0-9-]{1,80}):([A-Z0-9]{8})$");
                Require(match.Success, "This is not a supported EMCore vial QR code");
                Require(match.Groups[1].Value == access.User.ServiceId, "This QR belongs to another service. Select that service before scanning.", 403);
                parsedId = match.Groups[2].Value;
                identity = match.Groups[3].Value;
            }
        }
        Require(!string.IsNullOrWhiteSpace(identity) && identity.Length <= 80, "Enter an item code");
        var item = db.InventoryItems.FirstOrDefault(x => x.Id == identity || x.Code == identity);
        Require(item is not null && (parsedId is null || parsedId == item.Id), "No matching vial exists in the current service", 404);
        InventoryQueries.AuthorizeItem(db, access, item!);
        var valueText = $"EMCORE:1:{access.User.ServiceId}:{item!.Id}:{item.Code}";
        if (mode == QrMode.Image) return Results.File(QrImages.Create(valueText), "image/png", "EMCore-" + item.Code + ".png");
        var box = db.InventoryBoxes.Find(item.BoxId)!;
        return Results.Json(new { item, box = new { location = box.Location, name = box.Name }, value = valueText, serviceName = access.User.ServiceName });
    }

    private static void MapWrite<TRequest>(WebApplication app, string route, Action<InventoryOperation, TRequest> execute)
        where TRequest : InventoryRequest
    {
        MapWrite<TRequest>(app, route, (operation, request) =>
        {
            execute(operation, request);
            return null;
        });
    }

    private static void MapWrite<TRequest>(WebApplication app, string route, Func<InventoryOperation, TRequest, int?> execute)
        where TRequest : InventoryRequest
    {
        app.MapPost(route, (HttpContext http, DatabaseStore store, [FromBody] TRequest request) => Write(http, store, route, request, execute));
    }

    private static async Task<IResult> Write<TRequest>(HttpContext http, DatabaseStore store, string route, TRequest request, Func<InventoryOperation, TRequest, int?> execute)
        where TRequest : InventoryRequest
    {
        using var identityDb = store.OpenIdentity();
        var initialUser = IdentityService.Session(http, identityDb);
        RequireActiveCompany(initialUser);
        var body = InventoryRequest.ToBody(request);
        UserContext? actor = null;
        try
        {
            await using var transaction = await store.BeginCompanyTransactionAsync(identityDb, initialUser.ServiceId, http.RequestAborted);
            var user = LockedSession(http, identityDb, initialUser.ServiceId);
            using var tenant = user.ServiceId == "primary" ? null : store.OpenService(user.ServiceId, identityDb);
            var db = tenant ?? identityDb;
            var access = AccessService.Context(db, user);
            actor = user;
            var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            var witness = WitnessService.Attach(db, store, access, http, route, body);
            var savedIncident = execute(new InventoryOperation(db, access, witness, body, now), request);
            var audit = (JsonObject)body.DeepClone();
            audit["actorUserId"] = user.Id;
            db.AccessAudits.Add(new AccessAudit { ActorProfile = user.Actor, Action = route, Details = audit.ToJsonString(), CreatedAt = now });
            db.SaveChanges();
            if (identityDb != db) identityDb.SaveChanges();

            var updatedAccess = AccessService.Context(db, user);
            var result = InventoryQueries.Snapshot(db, updatedAccess);
            if (savedIncident is not null) result["savedIncident"] = IncidentQueries.AuthorizedRecord(db, updatedAccess, savedIncident.Value);
            else result["access"] = Node(AccessService.Snapshot(db, updatedAccess));
            await transaction.CommitAsync();
            return Results.Json(result);
        }
        catch (ApiException error) when (actor is not null)
        {
            using var auditIdentityDb = store.OpenIdentity();
            using var auditTenant = error.Status == 403 && actor.ServiceId != "primary"
                ? await store.OpenServiceAsync(actor.ServiceId, http.RequestAborted)
                : null;
            AuditFailure(auditTenant ?? auditIdentityDb, auditIdentityDb, actor, http, error);
            throw;
        }
    }

    private static void RequireActiveCompany(UserContext user)
        => Require(!user.PlatformOnly && user.CompanyActive, "Select an active company for inventory operations", 403);

    private static void AuditFailure(InventoryDbContext db, InventoryDbContext identityDb, UserContext user, HttpContext http, ApiException error)
    {
        if (Node(error.Extra) is JsonObject extra && extra.Boolean("witnessRequired"))
            IdentityService.Audit(identityDb, user, "Witness sign-off required / rejected", new { action = http.Request.Path.Value, error = error.Message });
        if (error.Status == 403)
            db.AccessAudits.Add(new AccessAudit { ActorProfile = user.Actor, Action = "Access denied: " + http.Request.Method + " " + http.Request.Path, Details = Serialize(new { error = error.Message }), CreatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") });
        identityDb.SaveChanges();
        if (identityDb != db) db.SaveChanges();
    }
}
