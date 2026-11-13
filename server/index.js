import QRCode from "qrcode";
import { migrateWitnesses, attachWitness } from "./witness.js";
import { qrValue, parseQr } from "../shared/qr.js";
import { createServer } from "node:http";

import { DatabaseSync } from "node:sqlite";

import { mkdirSync } from "node:fs";

import { dirname, join } from "node:path";

import { migrateAuth, sessionContext, authRoute } from "./auth.js";

import { pathToFileURL } from "node:url";

import { randomUUID } from "node:crypto";

import { seedInventory } from "./seed.js";

import { migrateInventory, newCode } from "./migrate.js";

import { incidentReasons } from "../shared/options.js";

import {
  migrateWorkflows,
  checkSnapshot,
  saveCheck,
  saveIncident,
  incidentRecord,
  fail as workflowFail,
} from "./workflows.js";

import { saveContainer } from "./containers.js";

import {
  migratePermissions,
  accessContext,
  accessSnapshot,
  authorize,
  authorizeMedication,
  drugForItem,
  saveAccess,
  logs,
} from "./permissions.js";

import { medicationPermitted } from "../shared/access-rules.js";

import { definitionLabel } from "../shared/catalog-options.js";

import {
  migrateCatalog,
  catalogSnapshot,
  saveSetting,
  itemRequirements,
  requireWitness,
} from "./catalog.js";

const fail = (status, message, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const textField = (value, max) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= max;

function authorizeRequest(db, context, path, body) {
  const itemFor = (id) =>
    typeof id === "string"
      ? db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id)
      : null;

  const checkDrug = (item, action) => {
    if (item) {
      authorizeMedication(context, drugForItem(db, item), "view");
      authorizeMedication(context, drugForItem(db, item), action);
    }
  };

  if (path === "/api/classes") authorize(context, "classes.edit");
  else if (path.startsWith("/api/access/")) authorize(context, "policies.edit");
  else if (path === "/api/definitions")
    authorize(context, body.id ? "definitions.edit" : "definitions.create");
  else if (path === "/api/tags") authorize(context, "tags.edit");
  else if (path === "/api/containers") {
    authorize(context, "containers.edit");
    if (body.id === "unassigned")
      fail(400, "Unassigned is a fixed staging area");
  } else if (path === "/api/drugs") {
    authorize(context, "stock.create");
    if (body.boxId && body.boxId !== "unassigned")
      authorize(context, "inventory.transfer");
    const drug = catalogSnapshot(db).definitions.find(
      (drug) => drug.id === body.definitionId,
    );
    if (drug) {
      authorizeMedication(context, drug, "view");
      authorizeMedication(context, drug, "create");
    }
  } else if (path === "/api/move") {
    authorize(context, "inventory.view");
    authorize(context, "inventory.transfer");
    checkDrug(itemFor(body.itemId), "transfer");
  } else if (path === "/api/verify" || path.startsWith("/api/checks/")) {
    authorize(context, "inventory.view");

    const action = path === "/api/verify" ? "verify" : path.split("/").at(-1);

    authorize(
      context,
      "checks." +
        (action === "start" && ["reset", "adhoc"].includes(body.kind)
          ? body.kind
          : action),
    );

    const items = body.itemId
      ? [itemFor(body.itemId)]
      : typeof body.boxId === "string"
        ? db
            .prepare(
              "SELECT * FROM inventory_items WHERE box_id=? AND status IN ('available','opened')",
            )
            .all(body.boxId)
        : [];

    for (const item of items) checkDrug(item, "check");
  } else if (path === "/api/incidents/reopen") {
    authorize(context, "incidents.view");
    authorize(context, "incidents.reopen");

    if (Number.isInteger(body.id))
      for (const row of db
        .prepare("SELECT item_id FROM incident_items WHERE incident_id=?")
        .all(body.id))
        checkDrug(itemFor(row.item_id), "edit");
  } else if (path.startsWith("/api/incidents")) {
    authorize(context, "incidents.view");
    authorize(context, body.id ? "incidents.edit" : "incidents.create");

    const draft = path.endsWith("/draft");

    const entries = [
      ...(Array.isArray(body.items) ? body.items : []),
      ...(Number.isInteger(body.id)
        ? db
            .prepare(
              "SELECT item_id id,wasted FROM incident_allocations WHERE incident_id=?",
            )
            .all(body.id)
        : []),
    ];

    for (const entry of entries) {
      const item = itemFor(entry?.id);
      checkDrug(item, body.id ? "edit" : "view");
      if (!draft) {
        if (body.reason === "used") {
          authorize(context, "medications.administer");
          checkDrug(item, "administer");
        }
        if (
          !["used", "opened"].includes(body.reason) ||
          Number(entry?.wasted) > 0
        ) {
          authorize(context, "medications.waste");
          checkDrug(item, "waste");
        }
      }
    }
  }
}

export function createInventoryServer(db, options = {}) {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

  seedInventory(db);

  migrateInventory(db);

  migrateCatalog(db);

  migrateWorkflows(db);

  migratePermissions(db);
  migrateWitnesses(db);

  const identityDb = options.identityDb || db;

  if (!options.identityDb) migrateAuth(identityDb);

  const tenantServers = new Map();

  const serviceId = options.serviceId || "primary";

  const snapshot = (context) => ({
    boxes: db.prepare("SELECT * FROM inventory_boxes").all(),

    items: db
      .prepare(
        "SELECT * FROM inventory_items WHERE status IN ('available','opened','unassigned') ORDER BY medication,code",
      )
      .all()
      .map((item) => ({
        ...item,
        requirements: itemRequirements(db, item.definition_id),
        tagNames: item.definition_id
          ? db
              .prepare(
                "SELECT name FROM medication_tags JOIN definition_tags ON tag_id=medication_tags.id WHERE definition_id=?",
              )
              .all(item.definition_id)
              .map((tag) => tag.name)
          : [],
      }))
      .filter(
        (item) =>
          !context ||
          ((item.box_id === "unassigned"
            ? context.permissions["stock.view"]
            : context.permissions["inventory.view"]) &&
            medicationPermitted(
              context.profile,
              drugForItem(db, item),
              "view",
            )),
      ),

    ...catalogSnapshot(db, context),

    classes: db.prepare("SELECT * FROM medication_classes ORDER BY name").all(),

    checks:
      context && !context.permissions["inventory.view"]
        ? []
        : checkSnapshot(db),

    incidents:
      context && !context.permissions["incidents.view"]
        ? []
        : db
            .prepare(
              `SELECT i.*, (SELECT count(*) FROM incident_items WHERE incident_id=i.id) AS item_count FROM incidents i ORDER BY i.id DESC`,
            )
            .all()
            .filter(
              (record) =>
                !context ||
                [
                  ...new Set([
                    ...(record.payload
                      ? JSON.parse(record.payload).items.map((item) => item.id)
                      : []),
                    ...db
                      .prepare(
                        "SELECT item_id FROM incident_items WHERE incident_id=?",
                      )
                      .all(record.id)
                      .map((row) => row.item_id),
                  ]),
                ].every((id) => {
                  const item = db
                    .prepare("SELECT * FROM inventory_items WHERE id=?")
                    .get(id);
                  return (
                    !item ||
                    medicationPermitted(
                      context.profile,
                      drugForItem(db, item),
                      "view",
                    )
                  );
                }),
            ),
  });

  function event(itemId, action, from, to, details, now) {
    db.prepare(
      "INSERT INTO inventory_events(item_id,action,from_box,to_box,details,created_at) VALUES(?,?,?,?,?,?)",
    )

      .run(itemId, action, from, to, JSON.stringify(details), now);
  }

  function getItem(id) {
    if (!textField(id, 80)) fail(400, "An item ID is required");

    const item = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id);

    if (!item) fail(404, "Item not found");

    if (!["available", "opened", "unassigned"].includes(item.status))
      fail(
        409,
        "This item has already been used or disposed of. Refresh inventory.",
      );

    return item;
  }

  function getBox(id) {
    if (!textField(id, 80)) fail(400, "Choose a container");

    const box = db.prepare("SELECT * FROM inventory_boxes WHERE id=?").get(id);

    if (!box) fail(400, "Container not found");

    return box;
  }

  function breakSeals(boxes, confirmations, now, body) {
    const sealed = [...new Map(boxes.map((b) => [b.id, b])).values()].filter(
      (b) => b.sealed,
    );

    const confirmed = Array.isArray(confirmations) ? confirmations : [];

    if (
      sealed.some(
        (b) => !confirmed.some((c) => c && c.id === b.id && c.seal === b.seal),
      )
    ) {
      fail(
        409,
        "Confirm the physical seal has been broken before continuing.",
        { sealedBoxes: sealed },
      );
    }

    for (const box of sealed) {
      const requirements = db
        .prepare(
          "SELECT definition_id FROM inventory_items WHERE box_id=? AND status IN ('available','opened')",
        )
        .all(box.id)
        .flatMap((item) => itemRequirements(db, item.definition_id));

      requireWitness(body, requirements, ["seal_break"]);
    }

    for (const box of sealed) {
      db.prepare(
        "UPDATE inventory_boxes SET sealed=0,stock_revision=stock_revision+1 WHERE id=?",
      ).run(box.id);

      for (const item of db
        .prepare(
          "SELECT id FROM inventory_items WHERE box_id=? AND status IN ('available','opened')",
        )
        .all(box.id)) {
        event(
          item.id,
          "seal_broken",
          box.id,
          box.id,
          { seal: box.seal, witness: body.witness?.trim() || null },
          now,
        );
      }
    }
  }

  const server = createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };

    let context = null;

    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "POST") {
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          fail(403, "Cross-origin requests are not allowed");

        if (!req.headers["content-type"]?.startsWith("application/json"))
          fail(415, "Use application/json");
      }

      const readBody = async () => {
        let text = "";
        for await (const part of req) {
          text += part;
          if (text.length > 65536) fail(413, "Request too large");
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          fail(400, "Invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "Invalid request");
        return body;
      };

      if (await authRoute(identityDb, req, res, url, readBody)) return;

      if (url.pathname === "/api/health" && req.method === "GET")
        return send(200, { status: "ok", database: "sqlite" });

      const user = sessionContext(identityDb, req);

      if (user.serviceId !== serviceId) {
        if (options.identityDb) fail(403, "Service mismatch");

        if (!tenantServers.has(user.serviceId)) {
          const file = db
            .prepare("PRAGMA database_list")
            .all()
            .find((row) => row.name === "main").file;

          const tenantDb = new DatabaseSync(
            file
              ? join(dirname(file), "service-" + user.serviceId + ".sqlite")
              : ":memory:",
          );

          const fresh = !tenantDb
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_items'",
            )
            .get();

          const tenant = createInventoryServer(tenantDb, {
            identityDb,
            serviceId: user.serviceId,
          });

          if (fresh) {
            tenantDb.exec(
              "DELETE FROM inventory_events; DELETE FROM inventory_items; UPDATE inventory_boxes SET sealed=0,seal=NULL;",
            );
          }

          tenantServers.set(user.serviceId, { server: tenant, db: tenantDb });
        }

        return tenantServers
          .get(user.serviceId)
          .server.emit("request", req, res);
      }

      context = accessContext(db, "service-admin", user);

      if (req.method === "GET") {
        if (url.pathname === "/api/access")
          return send(200, accessSnapshot(db, context));

        if (url.pathname === "/api/logs") {
          authorize(context, "logs.view");
          return send(
            200,
            logs(db, url.searchParams, identityDb, user.serviceId),
          );
        }

        if (url.pathname === "/api/health")
          return send(200, { status: "ok", database: "sqlite" });

        if (
          ["/api/qr", "/api/qr/resolve", "/api/qr/image"].includes(url.pathname)
        ) {
          authorize(context, "records.view");
          let identity = url.searchParams.get("item"),
            parsed = null;
          if (url.pathname === "/api/qr/resolve") {
            try {
              parsed = parseQr(url.searchParams.get("value"));
            } catch (error) {
              fail(400, error.message);
            }
            if (parsed.serviceId && parsed.serviceId !== context.user.serviceId)
              fail(
                403,
                "This QR belongs to another service. Select that service before scanning.",
              );
            identity = parsed.code;
          }
          if (!textField(identity, 80)) fail(400, "Enter an item code");
          const item = db
            .prepare("SELECT * FROM inventory_items WHERE code=? OR id=?")
            .get(identity, identity);
          if (!item || (parsed?.itemId && parsed.itemId !== item.id))
            fail(404, "No matching vial exists in the current service");
          authorizeMedication(context, drugForItem(db, item), "view");
          const box = db
            .prepare("SELECT location,name FROM inventory_boxes WHERE id=?")
            .get(item.box_id);
          if (url.pathname === "/api/qr/image") {
            const png = await QRCode.toBuffer(
              qrValue(context.user.serviceId, item),
              { width: 512, margin: 4, errorCorrectionLevel: "M" },
            );
            res.writeHead(200, {
              "Content-Type": "image/png",
              "Cache-Control": "no-store",
              "Content-Disposition": `attachment; filename="EMCore-${item.code}.png"`,
            });
            return res.end(png);
          }
          return send(200, {
            item,
            box,
            value: qrValue(context.user.serviceId, item),
            serviceName: context.user.serviceName,
          });
        }
        if (url.pathname === "/api/inventory")
          return send(200, snapshot(context));

        if (url.pathname === "/api/vials") {
          authorize(context, "inventory.view");
          return send(200, snapshot(context).items);
        }

        if (url.pathname === "/api/incident") {
          authorize(context, "incidents.view");
          const record = incidentRecord(db, Number(url.searchParams.get("id")));
          for (const item of record.items)
            authorizeMedication(context, drugForItem(db, item), "view");
          return send(200, record);
        }

        if (url.pathname === "/api/checks") {
          authorize(context, "inventory.view");

          const records = db
            .prepare(
              "SELECT * FROM drug_checks WHERE box_id=? ORDER BY created_at DESC,rowid DESC",
            )
            .all(url.searchParams.get("boxId"))
            .map((check) => {
              const items = JSON.parse(check.item_ids)
                .map((id) =>
                  db
                    .prepare("SELECT * FROM inventory_items WHERE id=?")
                    .get(id),
                )
                .filter(Boolean);
              for (const item of items)
                authorizeMedication(context, drugForItem(db, item), "view");
              return {
                ...check,
                items: items.map((item) => ({
                  id: item.id,
                  code: item.code,
                  medication: item.medication,
                })),
                checkedIds: JSON.parse(check.checked_ids),
              };
            });

          return send(200, records);
        }

        if (url.pathname === "/api/history") {
          authorize(context, "records.view");

          const identity = url.searchParams.get("item");

          if (!textField(identity, 80))
            fail(400, "Enter an item tracking code");

          const item = db
            .prepare("SELECT * FROM inventory_items WHERE id=? OR code=?")
            .get(identity, identity);

          if (!item) fail(404, "Item not found");

          authorizeMedication(context, drugForItem(db, item), "view");

          return send(200, {
            item,
            events: db
              .prepare(
                "SELECT * FROM inventory_events WHERE item_id=? ORDER BY id DESC",
              )
              .all(item.id),
          });
        }

        fail(404, "Not found");
      }

      if (
        req.method !== "POST" ||
        ![
          "/api/verify",
          "/api/move",
          "/api/drugs",
          "/api/incidents",
          "/api/tags",
          "/api/definitions",
          "/api/containers",
          "/api/incidents/draft",
          "/api/incidents/reopen",
          "/api/checks/start",
          "/api/checks/verify",
          "/api/checks/save",
          "/api/checks/complete",
          "/api/classes",
          "/api/access/profiles",
          "/api/access/rules",
        ].includes(url.pathname)
      )
        fail(404, "Not found");

      const body = await readBody();
      attachWitness({ db, identityDb, context, req, path: url.pathname, body });

      authorizeRequest(db, context, url.pathname, body);

      db.exec("BEGIN IMMEDIATE");

      const lastItemEvent = db
        .prepare("SELECT COALESCE(max(id),0) n FROM inventory_events")
        .get().n;

      const lastSettingEvent = db
        .prepare("SELECT COALESCE(max(id),0) n FROM settings_events")
        .get().n;

      const auditSuccess = () => {
        if (body.witnessSignoff) {
          for (const row of db
            .prepare("SELECT id,details FROM inventory_events WHERE id>?")
            .all(lastItemEvent)) {
            const details = JSON.parse(row.details);
            db.prepare("UPDATE inventory_events SET details=? WHERE id=?").run(
              JSON.stringify({
                ...details,
                witness: body.witness,
                witnessSignoff: body.witnessSignoff,
              }),
              row.id,
            );
          }
        }
        db.prepare(
          "UPDATE inventory_events SET actor_profile=?,actor_user_id=? WHERE id>?",
        ).run(context.actor, context.user.id, lastItemEvent);
        db.prepare(
          "UPDATE settings_events SET actor_profile=?,actor_user_id=? WHERE id>?",
        ).run(context.actor, context.user.id, lastSettingEvent);
        db.prepare(
          "INSERT INTO access_audit(actor_profile,action,details,created_at) VALUES(?,?,?,?)",
        ).run(
          context.actor,
          url.pathname,
          JSON.stringify({ ...body, actorUserId: context.user.id }),
          new Date().toISOString(),
        );
      };

      try {
        const now = new Date().toISOString();

        if (
          [
            "/api/classes",
            "/api/access/profiles",
            "/api/access/rules",
          ].includes(url.pathname)
        ) {
          saveAccess(db, url.pathname, body, now);
        } else if (url.pathname.startsWith("/api/checks/")) {
          saveCheck(db, url.pathname, body, now, event);
        } else if (url.pathname === "/api/containers") {
          saveContainer(db, body, now, { breakSeals, event });
        } else if (url.pathname === "/api/incidents/reopen") {
          const incident = db
            .prepare("SELECT * FROM incidents WHERE id=?")
            .get(body.id);

          if (
            !incident ||
            incident.status !== "completed" ||
            incident.revision !== body.revision
          )
            workflowFail(
              409,
              "Only the current completed incident can be reopened. Reload and try again.",
            );

          db.prepare(
            "UPDATE incidents SET status='reopened',revision=revision+1,updated_at=? WHERE id=?",
          ).run(now, incident.id);

          for (const row of db
            .prepare("SELECT item_id FROM incident_items WHERE incident_id=?")
            .all(incident.id))
            event(
              row.item_id,
              "incident_reopened",
              null,
              null,
              { incidentId: incident.id, revision: incident.revision + 1 },
              now,
            );

          db.prepare(
            "INSERT INTO incident_versions(incident_id,revision,status,payload,created_at) VALUES(?,?,?,?,?)",
          ).run(
            incident.id,
            incident.revision + 1,
            "reopened",
            incident.payload,
            now,
          );
        } else if (
          ["/api/incidents", "/api/incidents/draft"].includes(url.pathname)
        ) {
          const saved = saveIncident(
            db,
            body,
            url.pathname.endsWith("/draft"),
            { event, breakSeals, incidentReasons },
            now,
          );

          auditSuccess();
          db.exec("COMMIT");
          return send(200, {
            ...snapshot(context),
            savedIncident: incidentRecord(db, saved.id),
          });
        } else if (["/api/tags", "/api/definitions"].includes(url.pathname)) {
          saveSetting(db, url.pathname, body, now);
        } else if (url.pathname === "/api/drugs") {
          const definition = catalogSnapshot(db).definitions.find(
            (drug) => drug.id === body.definitionId,
          );

          if (!definition)
            fail(400, "Choose a standardized drug from Manage Par Levels");

          if (
            !Number.isInteger(body.quantity) ||
            body.quantity < 1 ||
            body.quantity > 1000
          )
            fail(400, "Quantity must be a whole number from 1 to 1000");

          if (
            body.replacement !== undefined &&
            typeof body.replacement !== "boolean"
          )
            fail(400, "Replacement must be true or false");

          const codes = body.codeMode === "manual" ? body.codes : null;

          if (
            body.codeMode !== undefined &&
            !["manual", "auto"].includes(body.codeMode)
          )
            fail(400, "Choose manual or generated codes");

          if (
            codes &&
            (!Array.isArray(codes) || codes.length !== body.quantity)
          )
            fail(400, "Enter one code for each item");

          if (body.codeMode === "manual" && !Array.isArray(codes))
            fail(400, "Enter the item codes");

          const normalized = codes
            ? codes.map((code) =>
                typeof code === "string" ? code.trim().toUpperCase() : "",
              )
            : [];

          if (
            normalized.some((code) => !/^[A-Z0-9]{8}$/.test(code)) ||
            new Set(normalized).size !== normalized.length
          )
            fail(
              400,
              "Each code must be a different eight-character alphanumeric code",
            );

          if (
            normalized.some((code) =>
              db.prepare("SELECT 1 FROM tracking_codes WHERE code=?").get(code),
            )
          )
            fail(
              409,
              "That tracking code has been used before. It cannot be reused.",
            );

          if (
            body.lotNumber !== undefined &&
            typeof body.lotNumber !== "string"
          )
            fail(400, "Enter a valid lot number");

          if (
            body.batchCreate !== undefined &&
            typeof body.batchCreate !== "boolean"
          )
            fail(400, "Batch creation must be true or false");

          const lot =
            typeof body.lotNumber === "string" ? body.lotNumber.trim() : "";

          const expiration = body.expirationDate || "";

          if (body.batchCreate || lot || expiration) {
            if (
              !lot ||
              lot.length > 80 ||
              typeof expiration !== "string" ||
              !/^\d{4}-\d{2}-\d{2}$/.test(expiration) ||
              !Number.isFinite(Date.parse(expiration)) ||
              new Date(expiration).toISOString().slice(0, 10) !== expiration
            )
              fail(
                400,
                "Enter a lot number and a valid expiration date for the batch",
              );
          }

          const batchId = lot ? randomUUID() : null;

          if (batchId)
            db.prepare("INSERT INTO inventory_batches VALUES(?,?,?,?,?,?)").run(
              batchId,
              definition.id,
              lot,
              expiration,
              body.quantity,
              now,
            );

          const box = getBox(body.boxId || "unassigned");

          requireWitness(
            body,
            itemRequirements(db, definition.id),
            body.replacement ? ["replacement"] : [],
          );

          breakSeals([box], body.brokenSeals, now, body);

          for (let i = 0; i < body.quantity; i++) {
            const id = randomUUID(),
              code = normalized[i] || newCode(db);

            const presentation = definitionLabel(definition)
              .split(" — ")
              .slice(1)
              .join(" — ");

            db.prepare(
              "INSERT INTO inventory_items(id,box_id,medication,presentation,code,status,received_at,definition_id,definition_snapshot,amount_total,remaining_amount,batch_id,lot_number,expires_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )

              .run(
                id,
                box.id,
                definition.name,
                presentation,
                code,
                box.id === "unassigned" ? "unassigned" : "available",
                now,
                definition.id,
                JSON.stringify(definition),
                definition.maxAmount,
                definition.maxAmount,
                batchId,
                lot || null,
                expiration || null,
              );

            event(
              id,
              "received",
              null,
              box.id,
              {
                code,
                definition,
                batchId,
                lotNumber: lot || null,
                expirationDate: expiration || null,
                replacement: Boolean(body.replacement),
                witness: body.witness?.trim() || null,
              },
              now,
            );
          }

          db.prepare(
            "UPDATE inventory_boxes SET stock_revision=stock_revision+1 WHERE id=?",
          ).run(box.id);
        } else {
          const item = getItem(body.itemId);

          if (url.pathname === "/api/verify") {
            if (item.box_id === "unassigned")
              fail(400, "Assign this item to a container before checking it");

            if (typeof body.verified !== "boolean")
              fail(400, "Verification must be true or false");

            db.prepare(
              "UPDATE inventory_items SET verified_at=? WHERE id=?",
            ).run(body.verified ? now : null, item.id);

            event(
              item.id,
              "verify",
              item.box_id,
              item.box_id,
              { verified: body.verified },
              now,
            );
          } else {
            if (body.sourceId !== item.box_id)
              fail(
                409,
                "The item location changed. Refresh inventory and try again.",
              );

            const dest = getBox(body.destinationId);

            if (dest.id === item.box_id)
              fail(
                400,
                "Choose a different container. An item cannot move within the same container.",
              );

            const source = getBox(item.box_id);

            requireWitness(body, itemRequirements(db, item.definition_id), [
              "transfer",
            ]);

            breakSeals([source, dest], body.brokenSeals, now, body);

            db.prepare(
              "UPDATE inventory_items SET box_id=?,status=?,verified_at=NULL WHERE id=?",
            ).run(
              dest.id,
              dest.id === "unassigned"
                ? "unassigned"
                : item.status === "unassigned"
                  ? item.was_opened || item.remaining_amount < item.amount_total
                    ? "opened"
                    : "available"
                  : item.status,
              item.id,
            );

            db.prepare(
              "UPDATE inventory_boxes SET stock_revision=stock_revision+1 WHERE id IN (?,?)",
            ).run(source.id, dest.id);

            event(
              item.id,
              "move",
              source.id,
              dest.id,
              { witness: body.witness?.trim() || null },
              now,
            );
          }
        }

        auditSuccess();
        db.exec("COMMIT");

        return send(200, {
          ...snapshot(context),
          access: accessSnapshot(
            db,
            accessContext(db, "service-admin", sessionContext(identityDb, req)),
          ),
        });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if (error.witnessFailureKey) {
        identityDb
          .prepare("DELETE FROM login_attempts WHERE until_ms<?")
          .run(Date.now());
        identityDb
          .prepare(
            "INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1",
          )
          .run(error.witnessFailureKey, Date.now() + 900000);
      }
      if (error.witnessRequired && context)
        identityDb
          .prepare(
            "INSERT INTO identity_audit(service_id,actor_id,actor,action,details,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            context.user.serviceId,
            context.user.id,
            context.actor,
            "Witness sign-off required / rejected",
            JSON.stringify({ action: req.url, error: error.message }),
            new Date().toISOString(),
          );
      if (error.status === 403) {
        let deniedUser = null;
        try {
          deniedUser = sessionContext(identityDb, req);
        } catch {}
        if (deniedUser && !context)
          identityDb
            .prepare(
              "INSERT INTO identity_audit(service_id,actor_id,actor,action,details,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              deniedUser.serviceId,
              deniedUser.id,
              deniedUser.actor,
              "Access denied: " + req.method + " " + req.url,
              JSON.stringify({ error: error.message }),
              new Date().toISOString(),
            );
        else
          db.prepare(
            "INSERT INTO access_audit(actor_profile,action,details,created_at) VALUES(?,?,?,?)",
          ).run(
            context?.actor || "Unauthenticated",
            "Access denied: " + req.method + " " + req.url,
            JSON.stringify({ error: error.message }),
            new Date().toISOString(),
          );
      }

      if (!error.status) console.error(error);

      send(error.status || 500, {
        error: error.status
          ? error.message
          : "Unable to save changes. Please try again.",
        ...(error.sealedBoxes ? { sealedBoxes: error.sealedBoxes } : {}),
        ...(error.witnessRequired
          ? { witnessRequired: true, witnessSummary: error.witnessSummary }
          : {}),
      });
    }
  });

  server.on("close", () => {
    for (const tenant of tenantServers.values()) {
      tenant.server.close();
      tenant.db.close();
    }
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  mkdirSync(new URL("./data/", import.meta.url), { recursive: true });

  const db = new DatabaseSync(
    process.env.EMCORE_DB ||
      new URL("./data/inventory.sqlite", import.meta.url),
  );

  createInventoryServer(db).listen(
    Number(process.env.PORT || 3001),
    "127.0.0.1",
    () => console.log("SQLite API ready"),
  );
}
