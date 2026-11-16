import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createInventoryServer } from "./index.js";
import { qrValue, parseQr } from "../shared/qr.js";
import QRCode from "qrcode";
async function fixture(run) {
  const db = new DatabaseSync(":memory:"),
    server = createInventoryServer(db);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/";
  const call = async (path, body, cookie) => {
    const r = await fetch(base + path, {
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: r.headers.get("content-type")?.startsWith("image/")
        ? Buffer.from(await r.arrayBuffer())
        : await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    const admin = await call("auth/setup", {
      name: "Operator Admin",
      username: "admin",
      password: "Admin-password-123",
      serviceName: "Test EMS",
    });
    const add = async (username, tags, active = true) =>
      call(
        "users",
        {
          name: username,
          username,
          password: "Account-password-123",
          tags,
          active,
        },
        admin.cookie,
      );
    await add("operator", [
      "Paramedic",
      "User",
      "Can Create",
      "Can Edit",
      "Can Administer",
      "Can Waste",
      "Can Transfer",
    ]);
    await add("witness", ["Paramedic", "User", "Can Witness"]);
    await add("no-witness", ["Paramedic", "User", "Service Admin"]);
    await add("inactive", ["Paramedic", "User", "Can Witness"], false);
    const operator = await call("auth/login", {
      username: "operator",
      password: "Account-password-123",
    });
    const state = (await call("inventory", undefined, operator.cookie)).data,
      item = state.items.find(
        (i) => i.medication === "Fentanyl" && i.box_id === "storage-narcotic",
      );
    const body = {
      reason: "used",
      incidentNumber: "SIGNED-1",
      items: [{ id: item.id, boxId: item.box_id, given: 25, wasted: 25 }],
    };
    await run({
      db,
      call,
      admin: admin.cookie,
      operator: operator.cookie,
      item,
      body,
      credentials: { username: "witness", password: "Account-password-123" },
    });
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
}
test("witness names, forged identity, self-signoff, wrong password, inactive/foreign users and absent Can Witness cannot authorize a save", () =>
  fixture(async ({ db, call, admin, operator, item, body, credentials }) => {
    const rejected = async (extra) => {
      const r = await call("incidents", { ...body, ...extra }, operator);
      assert.equal(r.status, 422);
      assert.equal(r.data.witnessRequired, true);
      assert.equal(
        db
          .prepare("SELECT remaining_amount FROM inventory_items WHERE id=?")
          .get(item.id).remaining_amount,
        100,
      );
      assert.equal(
        db.prepare("SELECT count(*) n FROM witness_signoffs").get().n,
        0,
      );
      return r;
    };
    await rejected({
      witness: "Fake Person",
      witnessSignoff: { userId: "witness", method: "password" },
      witnessVerified: true,
    });
    await rejected({
      witnessCredentials: { ...credentials, password: "wrong" },
    });
    await rejected({
      witnessCredentials: {
        username: "operator",
        password: "Account-password-123",
      },
    });
    await rejected({
      witnessCredentials: {
        username: "no-witness",
        password: "Account-password-123",
      },
    });
    await rejected({
      witnessCredentials: {
        username: "inactive",
        password: "Account-password-123",
      },
    });
    await call("services", { name: "Other EMS" }, admin);
    const second = (
      await call("services", undefined, admin)
    ).data.services.find((s) => s.name === "Other EMS");
    await call("auth/service", { serviceId: second.id }, admin);
    await call(
      "users",
      {
        name: "Foreign witness",
        username: "foreign",
        password: "Account-password-123",
        tags: ["Paramedic", "User", "Can Witness"],
      },
      admin,
    );
    await call("auth/service", { serviceId: "primary" }, admin);
    await rejected({
      witnessCredentials: {
        username: "foreign",
        password: "Account-password-123",
      },
    });
    const drug = (
      await call("inventory", undefined, admin)
    ).data.definitions.find((d) => d.id === item.definition_id);
    await call(
      "definitions",
      {
        ...drug,
        parTargets: [],
        accessRules: { witness: { allTags: ["EMT"], anyTags: [] } },
      },
      admin,
    );
    await rejected({ witnessCredentials: credentials });
  }));
test("successful signoff records both users immutably on vial/log/revision; credentials are excluded and every correction requires fresh authentication", () =>
  fixture(async ({ db, call, operator, item, body, credentials }) => {
    const saved = await call(
      "incidents",
      { ...body, witnessCredentials: credentials },
      operator,
    );
    assert.equal(saved.status, 200);
    const signature = saved.data.savedIncident.payload.witnessSignoff;
    assert.equal(signature.username, "witness");
    assert.notEqual(
      signature.userId,
      db.prepare("SELECT id FROM users WHERE username='operator'").get().id,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM witness_signoffs").get().n,
      1,
    );
    const history = (
        await call("history?item=" + item.code, undefined, operator)
      ).data,
      entry = history.events.find((e) => e.action === "medication_used");
    assert.equal(entry.actor_profile, "operator (@operator)");
    assert.equal(JSON.parse(entry.details).witnessSignoff.id, signature.id);
    assert.equal(JSON.parse(entry.details).witness, "witness (@witness)");
    assert.equal(history.item.remaining_amount, 50);
    const adminLogin = await call("auth/login", {
      username: "admin",
      password: "Admin-password-123",
    });
    const logs = (await call("logs?q=witness", undefined, adminLogin.cookie))
      .data.entries;
    assert.ok(
      logs.some(
        (e) => JSON.parse(e.details).witnessSignoff?.id === signature.id,
      ),
    );
    assert.ok(!JSON.stringify(logs).includes("Account-password-123"));
    for (const table of [
      "incidents",
      "incident_versions",
      "inventory_events",
      "access_audit",
    ])
      assert.ok(
        !JSON.stringify(db.prepare("SELECT * FROM " + table).all()).includes(
          "Account-password-123",
        ),
      );
    assert.throws(
      () =>
        db.prepare("UPDATE witness_signoffs SET witness_name=?").run("Changed"),
      /immutable/,
    );
    const id = saved.data.savedIncident.incident.id;
    await call(
      "incidents/reopen",
      { id, revision: saved.data.savedIncident.incident.revision },
      operator,
    );
    const record = (await call("incident?id=" + id, undefined, operator)).data;
    const correction = {
      ...record.payload,
      id,
      revision: record.incident.revision,
      items: [{ id: item.id, boxId: item.box_id, given: 20, wasted: 25 }],
      correctionNote: "Corrected chart amount",
    };
    assert.equal((await call("incidents", correction, operator)).status, 422);
    const revised = await call(
      "incidents",
      { ...correction, witnessCredentials: credentials },
      operator,
    );
    assert.equal(revised.status, 200);
    assert.notEqual(
      revised.data.savedIncident.payload.witnessSignoff.id,
      signature.id,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM witness_signoffs").get().n,
      2,
    );
  }));
test("drafts do not authenticate or retain submitted credentials; failed witness attempts remain throttled after transaction rollback", () =>
  fixture(async ({ db, call, operator, body, credentials }) => {
    const draft = await call(
      "incidents/draft",
      { ...body, witnessCredentials: credentials, witness: "forged" },
      operator,
    );
    assert.equal(draft.status, 200);
    assert.equal(draft.data.savedIncident.payload.witnessSignoff, null);
    assert.equal(draft.data.savedIncident.payload.witness, "");
    assert.ok(!JSON.stringify(draft).includes("Account-password-123"));
    assert.equal(
      db.prepare("SELECT count(*) n FROM witness_signoffs").get().n,
      0,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await call(
            "incidents",
            {
              ...body,
              witnessCredentials: { ...credentials, password: "wrong" },
            },
            operator,
          )
        ).status,
        422,
      );
    assert.equal(
      (
        await call(
          "incidents",
          { ...body, witnessCredentials: credentials },
          operator,
        )
      ).status,
      429,
    );
  }));
test("QR labels round-trip vial identity, enforce service/visibility permissions and never create or reassign stock", () =>
  fixture(async ({ db, call, admin, operator, item }) => {
    const count = db.prepare("SELECT count(*) n FROM inventory_items").get().n,
      qr = await call("qr?item=" + item.code, undefined, operator);
    assert.equal(qr.status, 200);
    const png = await call("qr/image?item=" + item.code, undefined, operator);
    assert.equal(png.status, 200);
    assert.equal(png.data.subarray(1, 4).toString(), "PNG");
    assert.equal(qr.data.value, qrValue("primary", item));
    assert.deepEqual(parseQr(qr.data.value), {
      serviceId: "primary",
      itemId: item.id,
      code: item.code,
    });
    const encoded = await QRCode.toDataURL(qr.data.value, { width: 256 });
    assert.match(encoded, /^data:image\/png;base64,/);
    const resolved = await call(
      "qr/resolve?value=" + encodeURIComponent(qr.data.value),
      undefined,
      operator,
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.item.id, item.id);
    assert.equal(
      (
        await call(
          "qr/resolve?value=" + item.code.toLowerCase(),
          undefined,
          operator,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "qr/resolve?value=" +
            encodeURIComponent(qr.data.value.replace("primary", "other")),
          undefined,
          operator,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "qr/resolve?value=" +
            encodeURIComponent(qr.data.value.replace(item.id, "wrong-id")),
          undefined,
          operator,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "qr/resolve?value=" +
            encodeURIComponent("https://untrusted.example/" + item.code),
          undefined,
          operator,
        )
      ).status,
      400,
    );
    assert.equal((await call("qr?item=" + item.code)).status, 401);
    const drug = (
      await call("inventory", undefined, admin)
    ).data.definitions.find((d) => d.id === item.definition_id);
    await call(
      "definitions",
      {
        ...drug,
        parTargets: [],
        accessRules: { view: { allTags: ["EMT"], anyTags: [] } },
      },
      admin,
    );
    assert.equal(
      (await call("qr?item=" + item.code, undefined, operator)).status,
      403,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory_items").get().n,
      count,
    );
  }));
