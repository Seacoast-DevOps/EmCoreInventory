import { createHash } from "node:crypto";
export const witnessUsername = (name) =>
  "witness-" + createHash("sha256").update(name).digest("hex").slice(0, 12);
export const witnessLabel = (name) =>
  name + " (@" + witnessUsername(name) + ")";
import { defaultProfiles } from "../shared/access-rules.js";
const sessions = new Map();
export async function authenticatedFetch(url, options = {}) {
  const parsed = new URL(url),
    base = parsed.origin + "/api/",
    profile = options.headers?.["X-EMCore-Profile"] || "service-admin";
  let state = sessions.get(base);
  if (!state) {
    const status = await (await globalThis.fetch(base + "auth/status")).json();
    let response;
    if (status.setupRequired)
      response = await globalThis.fetch(base + "auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Service Admin — Paramedic",
          username: "test-admin",
          password: "Test-Password-12345",
          serviceName: "Test EMS",
        }),
      });
    else
      response = await globalThis.fetch(base + "auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "test-admin",
          password: "Test-Password-12345",
        }),
      });
    state = {
      admin: response.headers.get("set-cookie")?.split(";")[0],
      profiles: new Map(),
    };
    sessions.set(base, state);
  }
  let cookie = state.admin;
  if (profile !== "service-admin") {
    if (!state.profiles.has(profile)) {
      const data = await (
        await globalThis.fetch(base + "access", {
          headers: { Cookie: state.admin },
        })
      ).json();
      const template =
        data.profiles.find((p) => p.id === profile) ||
        defaultProfiles.find((p) => p.id === profile);
      if (!template)
        return new Response(JSON.stringify({ error: "No such test user" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      const username = "test-" + state.profiles.size;
      const created = await globalThis.fetch(base + "users", {
        method: "POST",
        headers: { Cookie: state.admin, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          username,
          password: "Test-Password-12345",
          tags: template.tags,
        }),
      });
      if (!created.ok) throw Error(await created.text());
      const login = await globalThis.fetch(base + "auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "Test-Password-12345" }),
      });
      state.profiles.set(
        profile,
        login.headers.get("set-cookie").split(";")[0],
      );
    }
    cookie = state.profiles.get(profile);
  }
  if (options.body) {
    const body = JSON.parse(options.body);
    if (body.witness && !body.witnessCredentials) {
      state.witnesses ??= new Set();
      const username = witnessUsername(body.witness);
      if (!state.witnesses.has(username)) {
        const created = await globalThis.fetch(base + "users", {
          method: "POST",
          headers: { Cookie: state.admin, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: body.witness,
            username,
            password: "Witness-password-12345",
            tags: ["Paramedic", "User", "Can Witness"],
          }),
        });
        if (!created.ok) throw Error(await created.text());
        state.witnesses.add(username);
      }
      body.witnessCredentials = {
        username,
        password: "Witness-password-12345",
      };
      options = { ...options, body: JSON.stringify(body) };
    }
  }
  return globalThis.fetch(url, {
    ...options,
    headers: { ...options.headers, Cookie: cookie },
  });
}
