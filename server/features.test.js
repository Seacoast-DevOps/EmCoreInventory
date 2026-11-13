import { authenticatedFetch as fetch } from "./test-client.js";

import test from "node:test";

import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";

import { createInventoryServer } from "./index.js";

import { seedInventory } from "./seed.js";

async function fixture(run) {
  const db = new DatabaseSync(":memory:");

  const server = createInventoryServer(db);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const base = "http://127.0.0.1:" + server.address().port + "/api/";

  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, data: await res.json() };
  };

  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { status: res.status, data: await res.json() };
  };

  try {
    await run({ db, get, post });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

test("legacy migration preserves item identity, prior history, and immutable tracking codes", async () => {
  const db = new DatabaseSync(":memory:");

  seedInventory(db);

  db.prepare(
    "INSERT INTO inventory_events(item_id,action,details,created_at) VALUES(?,?,?,?)",
  ).run("EM-0001", "verify", "true", "2026-01-01T00:00:00Z");

  const server = createInventoryServer(db);

  const before = db
    .prepare("SELECT id,code FROM inventory_items ORDER BY id")
    .all();

  assert.ok(before.every((item) => /^[A-Z0-9]{8}$/.test(item.code)));

  assert.equal(new Set(before.map((item) => item.code)).size, before.length);

  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM inventory_events WHERE item_id='EM-0001' AND action='verify'",
      )
      .get().n,
    1,
  );

  assert.throws(() =>
    db
      .prepare("UPDATE inventory_items SET code='ABCDEFGH' WHERE id='EM-0001'")
      .run(),
  );

  createInventoryServer(db).close();

  assert.deepEqual(
    db.prepare("SELECT id,code FROM inventory_items ORDER BY id").all(),
    before,
  );

  server.close();
  db.close();
});

test("drug creation assigns individual identities and enforces sealed destinations", () =>
  fixture(async ({ get, post }) => {
    const stock = (await get("inventory")).data;

    const definition = await post("definitions", {
      name: "Test medication",
      concentrationValue: 1,
      amountUnit: "mg",
      concentrationBasis: "mL",
      maxAmount: 5,
      form: "Vial",
      tagIds: [],
      parTargets: [],
    });

    assert.equal(definition.status, 200);

    const body = {
      definitionId: definition.data.definitions.find(
        (drug) => drug.name === "Test medication",
      ).id,
      quantity: 3,
      boxId: "unit-42-narcotic",
    };

    const denied = await post("drugs", body);

    assert.equal(denied.status, 409);

    assert.equal(
      (await get("inventory")).data.items.length,
      stock.items.length,
    );

    const saved = await post("drugs", {
      ...body,
      brokenSeals: [{ id: body.boxId, seal: "12345678" }],
    });

    assert.equal(saved.status, 200);

    const items = saved.data.items.filter(
      (item) => item.medication === "Test medication",
    );

    assert.equal(items.length, 3);

    assert.equal(new Set(items.map((item) => item.code)).size, 3);

    assert.ok(items.every((item) => /^[A-Z0-9]{8}$/.test(item.code)));

    assert.equal(
      saved.data.boxes.find((box) => box.id === body.boxId).sealed,
      0,
    );

    assert.equal(
      (await get("history?item=" + items[0].code)).data.events[0].action,
      "received",
    );

    assert.equal((await post("drugs", { ...body, quantity: 0 })).status, 400);

    assert.equal((await post("drugs", { ...body, quantity: 1.5 })).status, 400);

    assert.equal(
      (await post("drugs", { ...body, definitionId: "missing" })).status,
      400,
    );
  }));

test("incident pool is atomic, requires number for use, retains history and rejects reused or stale stock", () =>
  fixture(async ({ db, get, post }) => {
    let stock = (await get("inventory")).data;

    const selected = stock.items
      .filter((item) => item.box_id === "unit-42-pelican")
      .slice(0, 2);

    const body = {
      items: selected.map((item) => ({ id: item.id, boxId: item.box_id })),
      reason: "used",
      incidentNumber: "",
    };

    assert.equal((await post("incidents", body)).status, 400);

    assert.equal(
      (
        await post("incidents", {
          ...body,
          incidentNumber: "INC-101",
          items: [body.items[0], body.items[0]],
        })
      ).status,
      400,
    );

    assert.equal(
      (
        await post("incidents", {
          ...body,
          incidentNumber: "INC-101",
          items: [{ ...body.items[0], boxId: "storage-bls" }],
        })
      ).status,
      409,
    );

    assert.equal(
      (await post("incidents", { ...body, reason: "unknown" })).status,
      400,
    );

    const saved = await post("incidents", {
      ...body,
      incidentNumber: "INC-101",
    });

    assert.equal(saved.status, 200);

    assert.equal(saved.data.items.length, stock.items.length - 2);

    assert.equal(saved.data.incidents[0].incident_number, "INC-101");

    assert.equal(saved.data.incidents[0].item_count, 2);

    const history = (await get("history?item=" + selected[0].code)).data;

    assert.equal(history.item.status, "used");

    assert.equal(
      JSON.parse(history.events[0].details).incidentNumber,
      "INC-101",
    );

    assert.equal(
      (await post("incidents", { ...body, incidentNumber: "INC-102" })).status,
      409,
    );

    assert.equal(
      (await post("verify", { itemId: selected[0].id, verified: true })).status,
      409,
    );

    assert.equal(db.prepare("SELECT count(*) n FROM incidents").get().n, 1);

    stock = saved.data;

    const sealedItem = stock.items.find(
      (item) => item.box_id === "unit-42-narcotic",
    );

    const openItem = stock.items.find((item) => item.box_id === "unit-42-out");

    const disposal = {
      reason: "expired",
      items: [sealedItem, openItem].map((item) => ({
        id: item.id,
        boxId: item.box_id,
      })),
    };

    assert.equal((await post("incidents", disposal)).status, 409);

    assert.equal(
      (await get("inventory")).data.items.length,
      stock.items.length,
    );

    assert.equal(db.prepare("SELECT count(*) n FROM incidents").get().n, 1);

    const disposed = await post("incidents", {
      ...disposal,
      brokenSeals: [{ id: "unit-42-narcotic", seal: "12345678" }],
    });

    assert.equal(disposed.status, 200);

    assert.equal(
      (await get("history?item=" + sealedItem.code)).data.item.status,
      "disposed",
    );

    assert.ok(
      (await get("history?item=" + sealedItem.code)).data.events.some(
        (event) => event.action === "seal_broken",
      ),
    );

    assert.equal(disposed.data.items.length, stock.items.length - 2);
  }));

test("opened items remain available; same-container moves never log changes or break seals", () =>
  fixture(async ({ db, get, post }) => {
    const stock = (await get("inventory")).data;

    const item = stock.items.find((item) => item.box_id === "unit-42-pelican");

    const saved = await post("incidents", {
      items: [{ id: item.id, boxId: item.box_id }],
      reason: "opened",
    });

    assert.equal(saved.status, 200);

    assert.equal(
      saved.data.items.find((entry) => entry.id === item.id).status,
      "opened",
    );

    const sealed = stock.items.find(
      (item) => item.box_id === "unit-42-narcotic",
    );

    const events = db
      .prepare("SELECT count(*) n FROM inventory_events")
      .get().n;

    const result = await post("move", {
      itemId: sealed.id,
      sourceId: sealed.box_id,
      destinationId: sealed.box_id,
      brokenSeals: [{ id: sealed.box_id, seal: "12345678" }],
    });

    assert.equal(result.status, 400);

    assert.equal(
      (await get("inventory")).data.boxes.find(
        (box) => box.id === sealed.box_id,
      ).sealed,
      1,
    );

    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory_events").get().n,
      events,
    );

    assert.equal(
      (
        await post("incidents", {
          items: [{ id: item.id, boxId: item.box_id }],
          reason: "other",
          notes: "",
        })
      ).status,
      400,
    );
  }));
