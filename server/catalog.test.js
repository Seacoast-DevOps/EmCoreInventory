import { authenticatedFetch as fetch, witnessLabel } from "./test-client.js";

import test from "node:test";

import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";

import { createInventoryServer } from "./index.js";

async function fixture(run) {
  const db = new DatabaseSync(":memory:");

  const server = createInventoryServer(db);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const base = "http://127.0.0.1:" + server.address().port + "/api/";

  const get = async (path) => (await fetch(base + path)).json();

  const post = async (path, body) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { status: response.status, data: await response.json() };
  };

  try {
    await run({ db, get, post });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

const definition = {
  name: "Test drug",
  concentrationValue: 2,
  amountUnit: "mg",
  concentrationBasis: "mL",
  maxAmount: 10,
  form: "Vial",
  tagIds: [],
  parTargets: [{ boxId: "unit-42-pelican", target: 3 }],
};

test("catalog, tags and pars persist with validated definitions and configuration audit", () =>
  fixture(async ({ db, get, post }) => {
    let state = await get("inventory");

    assert.equal(state.tags[0].name, "Narcotic");

    assert.deepEqual(state.tags[0].requirements, [
      "entire",
      "partial",
      "replacement",
      "resealed",
    ]);

    const tag = await post("tags", {
      name: "Witnessed",
      requirements: ["entire", "disposal"],
    });

    assert.equal(tag.status, 200);

    const tagId = tag.data.tags.find((tag) => tag.name === "Witnessed").id;

    assert.equal(
      (await post("tags", { name: "witnessed", requirements: [] })).status,
      409,
    );

    assert.equal(
      (await post("tags", { name: "Bad", requirements: ["invalid"] })).status,
      400,
    );

    const created = await post("definitions", {
      ...definition,
      tagIds: [tagId],
    });

    assert.equal(created.status, 200);

    const drug = created.data.definitions.find(
      (drug) => drug.name === "Test drug",
    );

    assert.equal(drug.concentrationValue, 2);

    assert.equal(drug.maxAmount, 10);

    assert.deepEqual(drug.tagIds, [tagId]);

    assert.equal(
      created.data.parLevels.find((par) => par.definitionId === drug.id).target,
      3,
    );

    assert.equal(
      (await post("definitions", { ...definition, tagIds: [tagId] })).status,
      409,
    );

    const edited = await post("definitions", {
      ...definition,
      id: drug.id,
      parTargets: [{ boxId: "unit-42-pelican", target: 0 }],
    });

    assert.equal(edited.status, 200);

    assert.equal(
      edited.data.parLevels.find((par) => par.definitionId === drug.id).target,
      0,
    );

    createInventoryServer(db).close();

    state = await get("inventory");

    assert.equal(
      state.definitions.find((drug) => drug.name === "Test drug").id,
      drug.id,
    );

    assert.equal(state.tags.length, 2);

    assert.equal(
      db.prepare("SELECT count(*) n FROM settings_events").get().n,
      3,
    );
  }));

test("invalid definitions or pars cannot partially change settings", () =>
  fixture(async ({ get, post }) => {
    for (const changes of [
      { concentrationValue: 0 },
      { maxAmount: -1 },
      { amountUnit: "unknown" },
      { tagIds: ["missing"] },
      { parTargets: [{ boxId: "unit-42-pelican", target: 1.5 }] },
      { parTargets: [{ boxId: "missing", target: 2 }] },
    ]) {
      assert.equal(
        (await post("definitions", { ...definition, ...changes })).status,
        400,
      );

      assert.equal((await get("inventory")).definitions.length, 12);
    }

    assert.equal(
      (
        await post("drugs", {
          medication: "Free text",
          presentation: "Vial",
          boxId: "storage-bls",
          quantity: 1,
        })
      ).status,
      400,
    );
  }));

test("witness policy guards replacements and full use, persists signoff, and protects stocked drug identity", () =>
  fixture(async ({ get, post }) => {
    const result = await post("definitions", {
      ...definition,
      tagIds: ["narcotic"],
    });

    const drug = result.data.definitions.find(
      (drug) => drug.name === "Test drug",
    );

    const stock = {
      definitionId: drug.id,
      quantity: 2,
      boxId: "unit-42-pelican",
      replacement: true,
    };

    const count = (await get("inventory")).items.length;

    const denied = await post("drugs", stock);

    assert.equal(denied.status, 422);

    assert.equal(denied.data.witnessRequired, true);

    assert.equal((await get("inventory")).items.length, count);

    const received = await post("drugs", { ...stock, witness: "Witness 42" });

    assert.equal(received.status, 200);

    const items = received.data.items.filter(
      (item) => item.definition_id === drug.id,
    );

    assert.equal(items.length, 2);

    assert.ok(items[0].requirements.includes("entire"));

    assert.deepEqual(items[0].tagNames, ["Narcotic"]);

    assert.equal(
      (
        await post("definitions", {
          ...definition,
          id: drug.id,
          concentrationValue: 3,
        })
      ).status,
      409,
    );

    assert.equal(
      (
        await post("definitions", {
          ...definition,
          id: drug.id,
          tagIds: ["narcotic"],
          parTargets: [{ boxId: stock.boxId, target: 4 }],
        })
      ).status,
      200,
    );

    const use = {
      reason: "used",
      incidentNumber: "TEST-42",
      items: [{ id: items[0].id, boxId: stock.boxId }],
    };

    assert.equal((await post("incidents", use)).status, 422);

    assert.equal(
      (await post("incidents", { ...use, witness: "Witness 43" })).status,
      200,
    );

    const history = await get("history?item=" + items[0].code);

    assert.equal(
      JSON.parse(history.events[0].details).witness,
      witnessLabel("Witness 43"),
    );

    assert.equal(
      JSON.parse(
        history.events.find((event) => event.action === "received").details,
      ).witness,
      witnessLabel("Witness 42"),
    );

    assert.equal(history.item.status, "used");

    assert.equal(
      (
        await post("tags", {
          id: "narcotic",
          name: "Narcotic",
          requirements: ["partial", "resealed"],
        })
      ).status,
      200,
    );

    assert.equal(
      (
        await post("incidents", {
          ...use,
          items: [{ id: items[1].id, boxId: stock.boxId }],
        })
      ).status,
      200,
    );
  }));

test("transfer, opening, disposal and seal-breaking witness rules block changes atomically", () =>
  fixture(async ({ db, get, post }) => {
    const result = await post("tags", {
      name: "Tracked",
      requirements: ["opening", "disposal", "transfer", "seal_break"],
    });

    const tagId = result.data.tags.find((tag) => tag.name === "Tracked").id;

    const created = await post("definitions", {
      ...definition,
      tagIds: [tagId],
    });

    const drug = created.data.definitions.find(
      (drug) => drug.name === "Test drug",
    );

    const received = await post("drugs", {
      definitionId: drug.id,
      boxId: "unit-42-narcotic",
      quantity: 1,
      brokenSeals: [{ id: "unit-42-narcotic", seal: "12345678" }],
    });

    const item = received.data.items.find(
      (item) => item.definition_id === drug.id,
    );

    assert.equal(received.status, 200);

    const move = {
      itemId: item.id,
      sourceId: item.box_id,
      destinationId: "unit-42-pelican",
    };

    assert.equal((await post("move", move)).status, 422);

    // Re-seal only in the isolated fixture to exercise the seal-break requirement.

    db.prepare(
      "UPDATE inventory_boxes SET sealed=1 WHERE id='unit-42-narcotic'",
    ).run();

    const before = db
      .prepare("SELECT count(*) n FROM inventory_events")
      .get().n;

    const attempt = await post("drugs", {
      definitionId: drug.id,
      boxId: "unit-42-narcotic",
      quantity: 1,
      brokenSeals: [{ id: "unit-42-narcotic", seal: "12345678" }],
    });

    assert.equal(attempt.status, 422);

    assert.equal(
      (await get("inventory")).boxes.find((box) => box.id === item.box_id)
        .sealed,
      1,
    );

    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory_events").get().n,
      before,
    );

    assert.equal(
      (
        await post("move", {
          ...move,
          witness: "Witness",
          brokenSeals: [{ id: item.box_id, seal: "12345678" }],
        })
      ).status,
      200,
    );

    const incident = {
      items: [{ id: item.id, boxId: move.destinationId }],
      reason: "opened",
    };

    assert.equal((await post("incidents", incident)).status, 422);

    assert.equal(
      (await post("incidents", { ...incident, witness: "Witness" })).status,
      200,
    );

    assert.equal(
      (await post("incidents", { ...incident, reason: "expired" })).status,
      422,
    );

    assert.equal(
      (
        await post("incidents", {
          ...incident,
          reason: "expired",
          witness: "Witness",
        })
      ).status,
      200,
    );
  }));
