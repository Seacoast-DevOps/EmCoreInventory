import { authenticatedFetch as fetch, witnessLabel } from "./test-client.js";

import test from "node:test";

import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";

import { createInventoryServer } from "./index.js";

import { checkSnapshot } from "./workflows.js";

async function fixture(run) {
  const db = new DatabaseSync(":memory:"),
    server = createInventoryServer(db);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const base = "http://127.0.0.1:" + server.address().port + "/api/";

  const get = async (path) => {
    const response = await fetch(base + path);
    return response.json();
  };

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

const row = (item, given, wasted) => ({
  id: item.id,
  boxId: item.box_id,
  given,
  wasted,
});

test("starter stock is standardized once, keeps identities and has permanent tracking codes", () =>
  fixture(async ({ db, get }) => {
    const before = await get("inventory");

    assert.equal(before.definitions.length, 12);

    assert.ok(
      before.items.every(
        (item) =>
          item.definition_id &&
          item.amount_total > 0 &&
          item.remaining_amount === item.amount_total,
      ),
    );

    assert.equal(
      before.items.filter((item) => item.medication === "Fentanyl").length,
      25,
    );

    assert.equal(
      before.definitions.find((drug) => drug.name === "Fentanyl").maxAmount,
      100,
    );

    const codes = before.items.map((item) => item.code).sort();

    createInventoryServer(db).close();

    assert.deepEqual(
      (await get("inventory")).items.map((item) => item.code).sort(),
      codes,
    );

    assert.equal(
      db.prepare("SELECT count(*) n FROM tracking_codes").get().n,
      codes.length,
    );

    assert.throws(() =>
      db.prepare("DELETE FROM tracking_codes WHERE code=?").run(codes[0]),
    );

    assert.ok(
      (await get("history?item=" + codes[0])).events.some(
        (event) => event.action === "standardized",
      ),
    );
  }));

test("manual codes are unique forever, normalized and validated atomically", () =>
  fixture(async ({ get, post }) => {
    const state = await get("inventory"),
      drug = state.definitions.find((drug) => drug.name === "Aspirin");

    const receive = {
      definitionId: drug.id,
      quantity: 2,
      boxId: "storage-bls",
      codeMode: "manual",
      codes: ["ab12cd34", "ZX98YU76"],
    };

    const saved = await post("drugs", receive);
    assert.equal(saved.status, 200);

    assert.ok(saved.data.items.some((item) => item.code === "AB12CD34"));

    assert.equal((await post("drugs", receive)).status, 409);

    assert.equal(
      (await post("drugs", { ...receive, codes: ["SAME1234", "SAME1234"] }))
        .status,
      400,
    );

    assert.equal(
      (await post("drugs", { ...receive, codes: ["SHORT"] })).status,
      400,
    );

    assert.equal(
      (await post("drugs", { ...receive, codes: ["INVALID!", "GOOD1234"] }))
        .status,
      400,
    );

    const item = saved.data.items.find((item) => item.code === "AB12CD34");

    assert.equal(
      (
        await post("incidents", {
          reason: "used",
          incidentNumber: "CODE-1",
          items: [row(item, 324, 0)],
        })
      ).status,
      200,
    );

    assert.equal(
      (await post("drugs", { ...receive, quantity: 1, codes: ["AB12CD34"] }))
        .status,
      409,
    );

    const generated = await post("drugs", {
      definitionId: drug.id,
      quantity: 20,
      boxId: "storage-bls",
      codeMode: "auto",
    });

    assert.equal(generated.status, 200);

    assert.equal(
      new Set(generated.data.items.map((item) => item.code)).size,
      generated.data.items.length,
    );
  }));

test("incident drafts survive reload without stock changes; partial use and waste enforce tags", () =>
  fixture(async ({ get, post }) => {
    const state = await get("inventory"),
      item = state.items.find(
        (item) =>
          item.box_id === "storage-narcotic" && item.medication === "Fentanyl",
      );

    const body = {
      clientKey: "draft-client-1",
      reason: "used",
      incidentNumber: "PARTIAL-1",
      notes: "saved draft",
      items: [row(item, 25, 25)],
    };

    const saved = await post("incidents/draft", body);
    assert.equal(saved.status, 200);

    const record = saved.data.savedIncident;

    assert.equal(record.incident.status, "draft");

    assert.equal(
      (await get("inventory")).items.find((current) => current.id === item.id)
        .remaining_amount,
      100,
    );

    assert.equal(
      (await get("incident?id=" + record.incident.id)).payload.items[0].given,
      25,
    );

    assert.equal(
      (await post("incidents/draft", body)).status,
      409,
      "network retries cannot create duplicate incidents",
    );

    const final = {
      ...body,
      id: record.incident.id,
      revision: record.incident.revision,
    };

    assert.equal((await post("incidents", final)).status, 422);

    const completed = await post("incidents", {
      ...final,
      witness: "Witness 1",
    });
    assert.equal(completed.status, 200);

    const current = completed.data.items.find(
      (current) => current.id === item.id,
    );

    assert.equal(current.remaining_amount, 50);
    assert.equal(current.status, "opened");

    const event = (await get("history?item=" + item.code)).events.find(
      (event) => event.action === "medication_used",
    );

    assert.deepEqual(
      [
        JSON.parse(event.details).given,
        JSON.parse(event.details).wasted,
        JSON.parse(event.details).witness,
      ],
      [25, 25, witnessLabel("Witness 1")],
    );

    assert.equal(
      (await post("incidents", { ...final, witness: "Witness 1" })).status,
      409,
    );

    assert.equal(
      (
        await post("incidents", {
          reason: "used",
          incidentNumber: "OVER",
          items: [row(current, 51, 0)],
          witness: "Witness 1",
        })
      ).status,
      400,
    );

    assert.equal(
      (
        await post("incidents", {
          reason: "expired",
          items: [row(current, 0, 25)],
          witness: "Witness 1",
        })
      ).status,
      400,
      "disposal cannot leave expired medication in available stock",
    );
  }));

test("reopening and correcting incidents applies only ledger differences and retains every revision", () =>
  fixture(async ({ get, post }) => {
    const initial = await get("inventory"),
      item = initial.items.find(
        (item) =>
          item.box_id === "storage-narcotic" && item.medication === "Fentanyl",
      );

    const first = await post("incidents", {
      reason: "used",
      incidentNumber: "CORRECT-1",
      items: [row(item, 40, 10)],
      witness: "Witness",
    });

    assert.equal(first.status, 200);

    const id = first.data.savedIncident.incident.id;

    assert.equal(
      (
        await post("incidents", {
          reason: "used",
          incidentNumber: "LATER-2",
          items: [row(item, 20, 0)],
          witness: "Witness",
        })
      ).status,
      200,
    );

    assert.equal(
      (await get("inventory")).items.find((current) => current.id === item.id)
        .remaining_amount,
      30,
    );

    assert.equal(
      (
        await post("incidents/reopen", {
          id,
          revision: first.data.savedIncident.incident.revision,
        })
      ).status,
      200,
    );

    let record = await get("incident?id=" + id);

    const correction = {
      ...record.payload,
      id,
      revision: record.incident.revision,
      items: [row(item, 50, 10)],
      witness: "Witness",
      correctionNote: "Corrected amount from chart",
    };

    assert.equal(
      (await post("incidents", { ...correction, correctionNote: "" })).status,
      400,
    );

    const corrected = await post("incidents", correction);
    assert.equal(corrected.status, 200);

    assert.equal(
      corrected.data.items.find((current) => current.id === item.id)
        .remaining_amount,
      20,
    );

    assert.equal(corrected.data.savedIncident.versions.length, 3);

    assert.equal((await post("incidents", correction)).status, 409);

    assert.equal(
      (
        await post("incidents/reopen", {
          id,
          revision: corrected.data.savedIncident.incident.revision,
        })
      ).status,
      200,
    );

    record = await get("incident?id=" + id);

    const invalid = await post("incidents", {
      ...record.payload,
      id,
      revision: record.incident.revision,
      items: [row(item, 90, 10)],
      correctionNote: "Too much",
      witness: "Witness",
    });

    assert.equal(invalid.status, 400);

    assert.equal(
      (await get("inventory")).items.find((current) => current.id === item.id)
        .remaining_amount,
      20,
    );

    assert.ok(
      (await get("history?item=" + item.code)).events.some(
        (event) => event.action === "incident_corrected",
      ),
    );
  }));

test("saved inventory checks resume, reject stale writes and expire on the strictest schedule", () =>
  fixture(async ({ db, get, post }) => {
    const boxId = "unit-42-out";

    let result = await post("checks/start", { boxId, kind: "scheduled" });
    assert.equal(result.status, 200);

    let check = result.data.checks.find((check) => check.boxId === boxId);

    const ids = check.draft.itemIds;

    const staleRevision = check.draft.revision;

    result = await post("checks/verify", {
      boxId,
      revision: staleRevision,
      itemId: ids[0],
      verified: true,
    });
    assert.equal(result.status, 200);

    check = result.data.checks.find((check) => check.boxId === boxId);
    assert.equal(check.status, "draft");

    assert.equal(
      (
        await post("checks/verify", {
          boxId,
          revision: staleRevision,
          itemId: ids[1],
          verified: true,
        })
      ).status,
      409,
    );

    assert.equal(
      (await post("checks/complete", { boxId, revision: check.draft.revision }))
        .status,
      400,
    );

    result = await post("checks/save", {
      boxId,
      revision: check.draft.revision,
      notes: "Resume this check",
    });
    assert.equal(result.status, 200);

    check = (await get("inventory")).checks.find(
      (check) => check.boxId === boxId,
    );

    assert.equal(check.draft.notes, "Resume this check");
    assert.ok(check.checkedIds.includes(ids[0]));

    for (const itemId of ids.slice(1)) {
      result = await post("checks/verify", {
        boxId,
        revision: check.draft.revision,
        itemId,
        verified: true,
      });
      check = result.data.checks.find((check) => check.boxId === boxId);
    }

    result = await post("checks/complete", {
      boxId,
      revision: check.draft.revision,
    });
    assert.equal(result.status, 200);

    check = result.data.checks.find((check) => check.boxId === boxId);
    assert.equal(check.status, "complete");
    assert.equal(check.checkedIds.length, ids.length);

    const drugId = db
      .prepare("SELECT definition_id FROM inventory_items WHERE id=?")
      .get(ids[0]).definition_id;

    db.prepare(
      "UPDATE drug_definitions SET check_interval_hours=1 WHERE id=?",
    ).run(drugId);

    const expired = checkSnapshot(
      db,
      Date.parse(check.lastCompletedAt) + 3600001,
    ).find((check) => check.boxId === boxId);

    assert.equal(expired.status, "not_done");
    assert.equal(expired.overdue, true);

    assert.equal(expired.intervalHours, 1);

    result = await post("checks/start", { boxId, kind: "adhoc" });
    assert.equal(result.status, 200);

    check = result.data.checks.find((check) => check.boxId === boxId);

    const item = (await get("inventory")).items.find(
      (item) => item.id === ids[0],
    );

    assert.equal(
      (
        await post("incidents", {
          reason: "used",
          incidentNumber: "CHECK-CHANGE",
          items: [row(item, 1, 0)],
        })
      ).status,
      200,
    );

    assert.equal(
      (
        await post("checks/verify", {
          boxId,
          revision: check.draft.revision,
          itemId: ids[1],
          verified: true,
        })
      ).status,
      409,
    );

    result = await post("checks/start", { boxId, kind: "reset" });
    assert.equal(result.status, 200);

    assert.equal(
      result.data.checks.find((check) => check.boxId === boxId).checkedIds
        .length,
      0,
    );

    assert.ok(
      (await get("checks?boxId=" + boxId)).some(
        (check) => check.status === "complete",
      ),
    );
  }));

test("storage design saves schedules and resealing enforces witness rules", () =>
  fixture(async ({ get, post }) => {
    const create = {
      name: "New box",
      location: "Unit 45",
      kind: "Drug box",
      icon: "truck",
      sealed: false,
      seal: "",
      transparent: false,
      checkIntervalHours: 12,
    };

    let result = await post("containers", create);
    assert.equal(result.status, 200);

    const box = result.data.boxes.find((box) => box.name === "New box");

    assert.equal(box.check_interval_hours, 12);

    const source = result.data.boxes.find(
      (box) => box.id === "unit-42-narcotic",
    );

    const seal = {
      ...create,
      id: source.id,
      name: source.name,
      location: source.location,
      kind: source.kind,
      icon: source.icon,
      sealed: true,
      seal: "87654321",
      transparent: true,
    };

    assert.equal((await post("containers", seal)).status, 409);

    assert.equal(
      (
        await post("containers", {
          ...seal,
          brokenSeals: [{ id: source.id, seal: source.seal }],
        })
      ).status,
      422,
    );

    assert.equal(
      (await get("inventory")).boxes.find((box) => box.id === source.id).seal,
      "12345678",
    );

    result = await post("containers", {
      ...seal,
      brokenSeals: [{ id: source.id, seal: source.seal }],
      witness: "Witness",
    });

    assert.equal(result.status, 200);

    assert.equal(
      result.data.boxes.find((box) => box.id === source.id).seal,
      "87654321",
    );

    const item = result.data.items.find((item) => item.box_id === source.id);

    assert.ok(
      (await get("history?item=" + item.code)).events.some(
        (event) => event.action === "container_resealed",
      ),
    );

    assert.equal(
      (await post("containers", { ...create, checkIntervalHours: -1 })).status,
      400,
    );
  }));
