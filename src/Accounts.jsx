import { useEffect, useState } from "react";

import { request } from "./api.js";

import { useAccess } from "./access-state.js";

import { accessTags } from "../shared/access-rules.js";

import { ClearInput, ClearTextarea, SearchSelect } from "./FormControls.jsx";

import Modal from "./Modal.jsx";

function Editor({ user, onClose, onSaved }) {
  const { access } = useAccess(),
    [form, setForm] = useState(
      user || {
        name: "",
        username: "",
        password: "",
        tags: ["User"],
        active: true,
      },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("users", form);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={user ? "Edit user" : "Create user"}
      onClose={onClose}
      busy={busy}
    >
      <form className="form-stack" onSubmit={save}>
        {["name", "username", "password"].map((key) => (
          <label key={key}>
            {key === "name"
              ? "Name"
              : key === "username"
                ? "Username"
                : user
                  ? "New password (leave blank to keep)"
                  : "Initial password"}
            <ClearInput
              clearLabel={
                key === "name"
                  ? "Name"
                  : key === "username"
                    ? "Username"
                    : "New password"
              }
              type={key === "password" ? "password" : "text"}
              required={key !== "password" || !user}
              minLength={key === "password" ? 12 : undefined}
              maxLength={key === "password" ? 128 : 100}
              autoComplete={key === "password" ? "new-password" : "off"}
              value={form[key] || ""}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          Start from role template
          <SearchSelect
            clearLabel="Role template"
            value=""
            onChange={(e) => {
              const template = access.profiles.find(
                (p) => p.id === e.target.value,
              );
              if (template) setForm({ ...form, tags: template.tags });
            }}
          >
            <option value="">Choose a template</option>
            {access.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SearchSelect>
        </label>
        <fieldset className="settings-fieldset">
          <legend>Roles and permission tags</legend>
          {accessTags.map((tag) => (
            <label key={tag.id} className="settings-check">
              <ClearInput
                type="checkbox"
                checked={form.tags.includes(tag.id)}
                onChange={() =>
                  setForm({
                    ...form,
                    tags: form.tags.includes(tag.id)
                      ? form.tags.filter((t) => t !== tag.id)
                      : [...form.tags, tag.id],
                  })
                }
              />
              <span>
                {tag.label}
                <small>{tag.kind}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="settings-check">
          <ClearInput
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active in this service
        </label>
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="action-primary" disabled={busy}>
            Save user
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Users() {
  const { refresh } = useAccess(),
    [users, setUsers] = useState([]),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  async function load() {
    try {
      setUsers((await request("users")).users);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    Promise.resolve().then(load);
  }, []);
  return (
    <section>
      <div className="settings-toolbar">
        <p>Accounts and permissions for this service.</p>
        <button className="action-primary" onClick={() => setEditing({})}>
          Create user
        </button>
      </div>
      <ClearInput
        className="form-control"
        clearLabel="Find users"
        placeholder="Find users"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <div className="settings-list">
        {users
          .filter((u) =>
            (u.name + " " + u.username + " " + u.tags.join(" "))
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((user) => (
            <article key={user.id} className="settings-card">
              <h2>{user.name}</h2>
              <p>
                @{user.username} · {user.active ? "Active" : "Inactive"}
              </p>
              <div className="medication-tags">
                {user.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <button
                className="cancel-button"
                onClick={() => setEditing(user)}
              >
                Edit user
              </button>
            </article>
          ))}
      </div>
      {editing && (
        <Editor
          user={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            await refresh();
          }}
        />
      )}
    </section>
  );
}

export function Services() {
  const { access, refresh } = useAccess(),
    [services, setServices] = useState([]),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setServices((await request("services")).services);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    Promise.resolve().then(load);
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("services", editing);
      setEditing(null);
      await load();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    name: "Service name",
    deaRegistrant: "DEA registrant name",
    deaNumber: "DEA registration number",
    deaExpiresOn: "DEA expiration date",
    deaSchedules: "DEA schedules",
    address: "Registered address",
    contactName: "Contact name",
    contactEmail: "Contact email",
    contactPhone: "Contact phone",
    notes: "Notes",
  };
  return (
    <section>
      <button
        className="action-primary"
        onClick={() => setEditing({ name: "" })}
      >
        Add service
      </button>
      <p>
        Each service has separate stock, users, checks, incidents, and policies.
        New services start with empty stock and starter container templates.
      </p>
      {error && !editing && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      {services.map((s) => (
        <article className="settings-card" key={s.id}>
          <h2>{s.name}</h2>
          {s.id === access.user.serviceId ? (
            <>
              <p>Current service</p>
              <p>
                {s.deaRegistrant || "DEA registrant not entered"}
                <br />
                {s.deaNumber || "DEA number not entered"}
                {s.deaExpiresOn && " · Expires " + s.deaExpiresOn}
              </p>
              <button
                className="cancel-button"
                onClick={() => {
                  setError("");
                  setEditing(s);
                }}
              >
                Edit service / DEA
              </button>
            </>
          ) : (
            <p>Select this service in the header to manage it.</p>
          )}
        </article>
      ))}
      {editing && (
        <Modal
          title={editing.id ? "Edit service / DEA" : "Add service"}
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <form className="form-stack" onSubmit={save}>
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                {key === "notes" ? (
                  <ClearTextarea
                    clearLabel={label}
                    value={editing[key] || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, [key]: e.target.value })
                    }
                  />
                ) : (
                  <ClearInput
                    clearLabel={label}
                    required={key === "name"}
                    type={
                      key === "deaExpiresOn"
                        ? "date"
                        : key === "contactEmail"
                          ? "email"
                          : "text"
                    }
                    value={editing[key] || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, [key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
            <p className="field-help">
              Registration details are stored as entered. This does not verify
              DEA registration or authorize controlled-substance handling.
            </p>
            {error && (
              <p role="alert" className="error-note">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="cancel-button"
                type="button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="action-primary" disabled={busy}>
                Save service
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function Account() {
  const { access } = useAccess(),
    [form, setForm] = useState({
      currentPassword: "",
      password: "",
      confirm: "",
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (form.password !== form.confirm)
      return setError("New passwords do not match");
    setBusy(true);
    try {
      await request("auth/password", form);
      setForm({ currentPassword: "", password: "", confirm: "" });
      setNotice("Password changed. Other sessions have been signed out.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>{access.user.name}</h2>
      <p>@{access.user.username}</p>
      <form className="form-stack" onSubmit={save}>
        {[
          ["currentPassword", "Current password"],
          ["password", "New password"],
          ["confirm", "Confirm new password"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <ClearInput
              type="password"
              clearLabel={label}
              required
              minLength={key === "currentPassword" ? undefined : 12}
              maxLength={128}
              autoComplete={
                key === "currentPassword" ? "current-password" : "new-password"
              }
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button className="action-primary" disabled={busy}>
          Change password
        </button>
      </form>
    </section>
  );
}
