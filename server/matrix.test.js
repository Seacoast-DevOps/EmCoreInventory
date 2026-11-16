import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createInventoryServer } from "./index.js";
import {
  defaultTags,
  matrixRoles,
  matrixAllowed,
} from "../shared/matrix-rules.js";
import { permitted, policyResources } from "../shared/access-rules.js";
async function fixture(run) {
  const db = new DatabaseSync(":memory:"),
    server = createInventoryServer(db);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/";
  const call = async (path, body, cookie) => {
    const res = await fetch(base + path, {
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    const admin = (
      await call("auth/setup", {
        name: "Platform Owner",
        username: "owner",
        password: "Matrix-password-123",
        serviceName: "Matrix EMS",
        licenseLevel: "Paramedic",
      })
    ).cookie;
    const actors = {};
    for (const [role, license, organization] of [
      ["Driver", "Driver", "User"],
      ["EMT", "EMT", "User"],
      ["AEMT", "AEMT", "User"],
      ["Paramedic", "Paramedic", "User"],
      ["Supervisor", "EMT", "Supervisor"],
      ["Company Admin", "EMT", "Company Admin"],
      ["Seacoast Admin", "EMT", "Company Admin"],
    ]) {
      const username = role.toLowerCase().replaceAll(" ", "-");
      const created = await call(
        "users",
        {
          name: role,
          username,
          password: "Matrix-password-123",
          licenseLevel: license,
          tags: [
            ...new Set([
              ...defaultTags(license, organization),
              "Can Create",
              "Can Edit",
              "Can Transfer",
              "Can Administer",
              "Can Waste",
            ]),
          ],
          platformAdmin: role === "Seacoast Admin",
        },
        admin,
      );
      assert.equal(created.status, 200, JSON.stringify(created.data));
      actors[role] = {
        username,
        cookie: (
          await call("auth/login", {
            username,
            password: "Matrix-password-123",
          })
        ).cookie,
      };
    }
    await run({ db, call, admin, actors });
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
}
test("matrix ceilings survive arbitrary capability grants and empty company policies for all seven columns", () => {
  const rules = Object.fromEntries(
    policyResources.map((r) => [r.id, { anyTags: [], allTags: [] }]),
  );
  for (const role of matrixRoles) {
    const tags = [
      role === "Driver"
        ? "Driver"
        : role === "EMT"
          ? "EMT"
          : role === "AEMT"
            ? "AEMT"
            : "Paramedic",
      "User",
      "Can Create",
      "Can Edit",
      "Can Check",
      "Can Transfer",
      "Can Administer",
      "Can Waste",
      "Can Witness",
      ...(role === "Supervisor" ||
      role === "Company Admin" ||
      role === "Seacoast Admin"
        ? [role]
        : []),
    ];
    const profile = { tags };
    assert.equal(
      permitted(profile, rules, "stock.create"),
      ["Paramedic", "Supervisor", "Company Admin", "Seacoast Admin"].includes(
        role,
      ),
      role + " receive",
    );
    assert.equal(
      permitted(profile, rules, "inventory.transfer"),
      role !== "Driver",
      role + " transfer",
    );
    assert.equal(
      permitted(profile, rules, "policies.edit"),
      role === "Seacoast Admin",
      role + " company permissions",
    );
    for (const resource of [
      "definitions.view",
      "checks.verify",
      "checks.start",
      "medications.witness",
      "seals.break",
      "seals.reseal",
    ])
      assert.equal(
        matrixAllowed(profile, resource),
        true,
        role + " " + resource,
      );
  }
});
test("HTTP matrix: everyone can view/check/witness, receiving starts at Paramedic, and clinical license still constrains administrators", () =>
  fixture(async ({ call, admin, actors }) => {
    let state = (await call("inventory", undefined, admin)).data;
    const aspirin = state.definitions.find((d) => d.name === "Aspirin"),
      fentanyl = state.definitions.find((d) => d.name === "Fentanyl");
    assert.equal(
      (
        await call(
          "definitions",
          {
            ...aspirin,
            minimumLicense: "EMT",
            isNarcotic: false,
            parTargets: [],
          },
          admin,
        )
      ).status,
      200,
    );
    for (const [role, actor] of Object.entries(actors)) {
      const inv = await call("inventory", undefined, actor.cookie);
      assert.equal(inv.status, 200);
      assert.ok(inv.data.definitions.length >= 12, role + " formulary");
      assert.equal(
        (
          await call(
            "checks/start",
            { boxId: "unit-42-out", kind: "scheduled" },
            actor.cookie,
          )
        ).status,
        200,
        role + " routine check",
      );
      const received = await call(
        "drugs",
        { definitionId: aspirin.id, quantity: 1 },
        actor.cookie,
      );
      assert.equal(
        received.status,
        ["Paramedic", "Supervisor", "Company Admin", "Seacoast Admin"].includes(
          role,
        )
          ? 200
          : 403,
        role + " receive",
      );
    }
    const narcotic = state.items.find(
      (i) => i.definition_id === fentanyl.id && i.box_id === "storage-narcotic",
    );
    for (const [role, witness] of Object.entries(actors)) {
      const used = await call(
        "incidents",
        {
          reason: "used",
          incidentNumber: "WITNESS-" + role,
          items: [
            { id: narcotic.id, boxId: narcotic.box_id, given: 1, wasted: 1 },
          ],
          witnessCredentials: {
            username: witness.username,
            password: "Matrix-password-123",
          },
        },
        admin,
      );
      assert.equal(
        used.status,
        200,
        role + " can witness narcotic: " + JSON.stringify(used.data.error),
      );
    }
    const nonNarcotic = state.items.find(
      (i) => i.definition_id === aspirin.id && i.box_id === "storage-bls",
    );
    for (const [role, actor] of Object.entries(actors)) {
      const used = await call(
        "incidents",
        {
          reason: "used",
          incidentNumber: "NONNARC-" + role,
          items: [
            {
              id: nonNarcotic.id,
              boxId: nonNarcotic.box_id,
              given: 1,
              wasted: 1,
            },
          ],
        },
        actor.cookie,
      );
      assert.equal(
        used.status,
        role === "Driver" ? 403 : 200,
        role + " non-narcotic clinical access",
      );
      const narc = await call(
        "incidents",
        {
          reason: "used",
          incidentNumber: "NARC-" + role,
          items: [
            { id: narcotic.id, boxId: narcotic.box_id, given: 1, wasted: 1 },
          ],
          witnessCredentials: {
            username: "driver",
            password: "Matrix-password-123",
          },
        },
        actor.cookie,
      );
      assert.equal(
        narc.status,
        role === "Paramedic" ? 200 : 403,
        role + " cannot elevate clinical license",
      );
    }
    assert.equal(
      (
        await call(
          "definitions",
          {
            ...aspirin,
            minimumLicense: "AEMT",
            isNarcotic: false,
            parTargets: [],
          },
          admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "incidents",
          {
            reason: "used",
            incidentNumber: "ADMIN-LIMIT",
            items: [
              {
                id: nonNarcotic.id,
                boxId: nonNarcotic.box_id,
                given: 1,
                wasted: 0,
              },
            ],
          },
          actors["Seacoast Admin"].cookie,
        )
      ).status,
      403,
    );
  }));
test("both transfer endpoints require storage access; Driver cannot transfer even with Can Transfer", () =>
  fixture(async ({ call, admin, actors }) => {
    const state = (await call("inventory", undefined, admin)).data,
      item = state.items.find((i) => i.box_id === "unit-42-out"),
      source = state.boxes.find((b) => b.id === item.box_id),
      dest = state.boxes.find((b) => b.id === "unit-42-pelican");
    assert.equal(
      (
        await call(
          "move",
          { itemId: item.id, sourceId: item.box_id, destinationId: dest.id },
          actors.Driver.cookie,
        )
      ).status,
      403,
    );
    const configure = (box) => ({
      id: box.id,
      name: box.name,
      location: box.location,
      kind: box.kind,
      icon: box.icon,
      transparent: Boolean(box.transparent),
      sealed: false,
      seal: "",
      checkIntervalHours: 24,
      allowedRoles: ["Supervisor", "Company Admin", "Seacoast Admin"],
    });
    assert.equal(
      (await call("containers", configure(dest), admin)).status,
      200,
    );
    assert.equal(
      (
        await call(
          "move",
          { itemId: item.id, sourceId: item.box_id, destinationId: dest.id },
          actors.EMT.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("containers", configure(source), admin)).status,
      200,
    );
    const hidden = (await call("inventory", undefined, actors.EMT.cookie)).data;
    assert.equal(
      hidden.items.some((i) => i.id === item.id),
      false,
    );
    assert.equal(
      hidden.boxes.some((b) => b.id === source.id),
      false,
    );
    assert.equal(
      (await call("history?item=" + item.code, undefined, actors.EMT.cookie))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          "checks/start",
          { boxId: source.id, kind: "scheduled" },
          actors.Driver.cookie,
        )
      ).status,
      403,
    );
  }));
test("Driver seal actions require an independent partner; EMT-plus seal actions do not require a witness", () =>
  fixture(async ({ call, admin, actors }) => {
    let box = (await call("inventory", undefined, admin)).data.boxes.find(
      (b) => b.id === "unit-42-narcotic",
    );
    const breaking = {
      boxId: box.id,
      action: "break",
      brokenSeals: [{ id: box.id, seal: box.seal }],
      incidentNumber: "SEAL-42",
    };
    assert.equal(
      (await call("seals", breaking, actors.Driver.cookie)).status,
      422,
    );
    const verified = await call(
      "seals",
      {
        ...breaking,
        witnessCredentials: {
          username: "emt",
          password: "Matrix-password-123",
        },
      },
      actors.Driver.cookie,
    );
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal(
      (
        await call(
          "seals",
          { boxId: box.id, action: "reseal", seal: "NEWSEAL" },
          actors.Driver.cookie,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await call(
          "seals",
          {
            boxId: box.id,
            action: "reseal",
            seal: "NEWSEAL",
            witnessCredentials: {
              username: "emt",
              password: "Matrix-password-123",
            },
          },
          actors.Driver.cookie,
        )
      ).status,
      200,
    );
    for (const role of [
      "EMT",
      "AEMT",
      "Paramedic",
      "Supervisor",
      "Company Admin",
      "Seacoast Admin",
    ]) {
      box = (await call("inventory", undefined, admin)).data.boxes.find(
        (b) => b.id === "unit-42-narcotic",
      );
      assert.equal(
        (
          await call(
            "seals",
            {
              boxId: box.id,
              action: "break",
              brokenSeals: [{ id: box.id, seal: box.seal }],
            },
            actors[role].cookie,
          )
        ).status,
        200,
        role + " break",
      );
      assert.equal(
        (
          await call(
            "seals",
            { boxId: box.id, action: "reseal", seal: "ROLE-" + role },
            actors[role].cookie,
          )
        ).status,
        200,
        role + " reseal",
      );
    }
  }));
test("only supervisors/admins approve discrepancies and approval never silently changes inventory", () =>
  fixture(async ({ db, call, admin, actors }) => {
    const state = (await call("inventory", undefined, admin)).data,
      item = state.items.find((i) => i.box_id === "unit-42-out");
    const report = await call(
      "discrepancies",
      {
        boxId: item.box_id,
        itemCode: item.code,
        notes: "Training: item not physically located",
      },
      actors.Driver.cookie,
    );
    assert.equal(report.status, 200);
    const d = report.data.discrepancies[0],
      before = db
        .prepare("SELECT * FROM inventory_items WHERE id=?")
        .get(item.id);
    for (const role of ["Driver", "EMT", "AEMT", "Paramedic"])
      assert.equal(
        (
          await call(
            "discrepancies/approve",
            { id: d.id, revision: d.revision, resolution: "Review" },
            actors[role].cookie,
          )
        ).status,
        403,
      );
    assert.equal(
      (
        await call(
          "discrepancies/approve",
          {
            id: d.id,
            revision: d.revision,
            resolution: "Reviewed; follow-up required",
          },
          actors.Supervisor.cookie,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM inventory_items WHERE id=?").get(item.id),
      before,
    );
  }));
test("company administration is scoped; only platform can create/change permissions/lifecycle and cannot be granted through local tags", () =>
  fixture(async ({ call, admin, actors }) => {
    assert.equal(
      (
        await call(
          "services",
          { name: "Forbidden" },
          actors["Company Admin"].cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "access/rules",
          {
            resource: "inventory.transfer",
            rule: { anyTags: [], allTags: [] },
          },
          actors["Company Admin"].cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "users",
          {
            name: "Escalation",
            username: "escalation",
            password: "Matrix-password-123",
            tags: defaultTags("EMT"),
            platformAdmin: true,
          },
          actors["Company Admin"].cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "services",
          {
            id: "primary",
            name: "Matrix EMS",
            serviceChief: "Chief User",
            deaContact: "DEA User",
            backupDeaContact: "Backup User",
            medicalDirector: "Medical User",
            assistantMedicalDirector: "Assistant User",
          },
          actors["Company Admin"].cookie,
        )
      ).status,
      200,
    );
    const details = (
      await call("services", undefined, actors["Company Admin"].cookie)
    ).data.services[0];
    assert.equal(details.backupDeaContact, "Backup User");
    assert.equal(
      (
        await call(
          "companies/status",
          { id: "primary", active: false },
          actors["Company Admin"].cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("companies/status", { id: "primary", active: false }, admin))
        .status,
      200,
    );
    assert.equal(
      (await call("inventory", undefined, actors.Driver.cookie)).status,
      401,
    );
    assert.equal(
      (
        await call("auth/login", {
          username: "emt",
          password: "Matrix-password-123",
        })
      ).status,
      401,
    );
    const owner = (
      await call("auth/login", {
        username: "owner",
        password: "Matrix-password-123",
      })
    ).cookie;
    assert.equal(
      (await call("companies/status", { id: "primary", active: true }, owner))
        .status,
      200,
    );
    assert.equal(
      (
        await call("auth/login", {
          username: "emt",
          password: "Matrix-password-123",
        })
      ).status,
      200,
    );
  }));
test("hard deletion purges only the confirmed company and leaves platform administration recoverable", () =>
  fixture(async ({ db, call, admin }) => {
    assert.equal(
      (
        await call(
          "companies/delete",
          {
            id: "primary",
            confirmCompanyName: "Wrong",
            acknowledgePermanentDeletion: true,
            currentPassword: "Matrix-password-123",
          },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory_items").get().n,
      148,
    );
    const result = await call(
      "companies/delete",
      {
        id: "primary",
        confirmCompanyName: "Matrix EMS",
        acknowledgePermanentDeletion: true,
        currentPassword: "Matrix-password-123",
      },
      admin,
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory_items").get().n,
      0,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 8);
    const cookie = result.cookie,
      access = await call("access", undefined, cookie);
    assert.equal(access.status, 200);
    assert.equal(access.data.user.platformOnly, true);
    assert.equal(
      (await call("services", { name: "Recovered company" }, cookie)).status,
      200,
    );
    const companies = (await call("services", undefined, cookie)).data;
    assert.equal(companies.services.length, 1);
    assert.equal(companies.deletedCompanies.length, 1);
    assert.equal(
      (
        await call(
          "auth/service",
          { serviceId: companies.services[0].id },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("inventory", undefined, cookie)).data.items.length,
      0,
    );
  }));
