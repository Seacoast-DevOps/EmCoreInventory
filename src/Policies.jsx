import { useState } from "react";

import { Plus, Pencil } from "lucide-react";

import { useAccess } from "./access-state.js";

import { accessTags } from "../shared/access-rules.js";

import { request } from "./api.js";

import { ClearInput, SearchSelect } from "./FormControls.jsx";

import RuleFields from "./RuleFields.jsx";

import Modal from "./Modal.jsx";

function ProfileEditor({ profile, onClose, onSaved }) {
  const [name, setName] = useState(profile?.name || ""),
    [tags, setTags] = useState(profile?.tags || ["User"]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("access/profiles", {
        ...(profile ? { id: profile.id } : {}),
        name,
        tags,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={profile ? "Edit role template" : "Add role template"}
      busy={busy}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={save}>
        <label>
          Profile name
          <ClearInput
            clearLabel="Profile name"
            className="form-control"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset className="settings-fieldset">
          <legend>Combined access tags</legend>
          {accessTags.map((tag) => (
            <label className="settings-check" key={tag.id}>
              <ClearInput
                type="checkbox"
                checked={tags.includes(tag.id)}
                onChange={() =>
                  setTags((current) =>
                    current.includes(tag.id)
                      ? current.filter((id) => id !== tag.id)
                      : [...current, tag.id],
                  )
                }
              />
              <span>
                {tag.label}
                <small>{tag.kind}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="action-primary" disabled={busy}>
            Save profile
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Policies() {
  const { access, can, refresh } = useAccess(),
    [resource, setResource] = useState("inventory.transfer"),
    [rule, setRule] = useState(access.rules["inventory.transfer"]),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await request("access/rules", { resource, rule });
      await refresh();
      setNotice("Policy saved. Accounts now use this rule.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="policy-note">
        Signed-in users use their assigned service roles and tags. Page and
        action policies combine with medication-specific rules. Read Only blocks
        changes. Templates are starting points; editing a template does not
        change existing users.
      </p>
      <section className="settings-card">
        <h2>Page and action policies</h2>
        <label className="field-label">
          Page / function
          <SearchSelect
            clearLabel="Page / function"
            aria-label="Policy resource"
            value={resource}
            onChange={(event) => {
              setResource(event.target.value);
              setRule(
                access.rules[event.target.value] || {
                  anyTags: [],
                  allTags: [],
                },
              );
            }}
          >
            {access.resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.label}
              </option>
            ))}
          </SearchSelect>
        </label>
        {resource && (
          <>
            <RuleFields
              rule={rule}
              onChange={setRule}
              disabled={!can("policies.edit")}
            />
            <p className="field-help">
              Empty lists add no tag restriction. Medication rules still apply.
              Policy management keeps Service Admin recovery access.
            </p>
            <button
              className="action-primary"
              disabled={busy || !can("policies.edit")}
              onClick={save}
            >
              Save policy
            </button>
          </>
        )}
      </section>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <div className="settings-toolbar">
        <h2>Role templates</h2>
        <button
          className="action-primary"
          disabled={!can("policies.edit")}
          onClick={() => setEditing({})}
        >
          <Plus size={18} /> Add template
        </button>
      </div>
      <div className="settings-list">
        {access.profiles.map((profile) => (
          <article className="settings-card" key={profile.id}>
            <div className="settings-card-heading">
              <h2>{profile.name}</h2>
              <button
                className="icon-button"
                disabled={!can("policies.edit")}
                aria-label={"Edit " + profile.name}
                onClick={() => setEditing(profile)}
              >
                <Pencil size={18} />
              </button>
            </div>
            <div className="medication-tags">
              {profile.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <ProfileEditor
          profile={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </section>
  );
}
