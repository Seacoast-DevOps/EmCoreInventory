import { ClearInput, ClearTextarea, SearchSelect } from "./FormControls.jsx";
import { useEffect, useState } from "react";
import { Plus, FolderOpen, History as HistoryIcon, X } from "lucide-react";
import { incidentReasons } from "../shared/options.js";
import { request, useInventory, confirmedSeals, getProfileId } from "./api.js";
import StorageBrowser from "./StorageBrowser.jsx";
import History from "./History.jsx";
import { useAccess } from "./access-state.js";
import Modal, { SealQuestion } from "./Modal.jsx";

const cacheKey = () => "emcore-incident-editor-v2:" + getProfileId();
const emptyDraft = (reason) => ({
  clientKey: crypto.randomUUID(),
  incidentNumber: "",
  reason,
  notes: "",
  witness: "",
  correctionNote: "",
  items: [],
  status: "draft",
});
function cachedDraft(reason) {
  try {
    const draft = JSON.parse(localStorage.getItem(cacheKey()));
    return draft && Array.isArray(draft.items) ? draft : emptyDraft(reason);
  } catch {
    return emptyDraft(reason);
  }
}

export default function Incident({
  defaultReason = "",
  initialTab = "editor",
}) {
  const { can, canDrug } = useAccess();
  const { data, setData, error, setError, reload } = useInventory();
  const [draft, setDraft] = useState(() => cachedDraft(defaultReason));
  const [record, setRecord] = useState(null),
    [tab, setTab] = useState(initialTab),
    [location, setLocation] = useState("Unit 42");
  const [busy, setBusy] = useState(false),
    [seals, setSeals] = useState(null),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState(""),
    [witnessNeeded, setWitnessNeeded] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(draft));
    } catch {
      /* Keep the editor usable when browser storage is unavailable. */
    }
  }, [draft]);
  useEffect(() => {
    let active = true;
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(cacheKey()));
    } catch {
      saved = null;
    }
    if (saved?.id)
      request("incident?id=" + saved.id)
        .then((result) => {
          if (active) {
            setRecord(result);
            setDraft({
              ...result.payload,
              id: result.incident.id,
              revision: result.incident.revision,
              status: result.incident.status,
            });
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    return () => {
      active = false;
    };
  }, [setError]);
  function field(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }
  function start() {
    setDraft(emptyDraft(defaultReason));
    setRecord(null);
    setTab("editor");
    setError("");
    setNotice("");
    setWitnessNeeded(false);
  }
  async function open(id) {
    setBusy(true);
    setError("");
    try {
      const result = await request("incident?id=" + id);
      setRecord(result);
      setDraft({
        ...result.payload,
        id,
        revision: result.incident.revision,
        status: result.incident.status,
      });
      setTab("editor");
      setWitnessNeeded(false);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    setBusy(true);
    setError("");
    try {
      const result = await request("incidents/reopen", {
        id: draft.id,
        revision: draft.revision,
      });
      setData(result);
      await open(draft.id);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(draftOnly, confirmed = false) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        draftOnly ? "incidents/draft" : "incidents",
        {
          ...draft,
          brokenSeals: confirmed && seals ? confirmedSeals(seals) : [],
        },
      );
      setData(result);
      const saved = result.savedIncident;
      setRecord(saved);
      setDraft({
        ...saved.payload,
        id: saved.incident.id,
        revision: saved.incident.revision,
        status: saved.incident.status,
      });
      setSeals(null);
      setWitnessNeeded(false);
      setNotice(
        draftOnly
          ? "Draft saved. Open it from Saved incidents to continue."
          : "Incident saved. Vial balances and records updated.",
      );
    } catch (error) {
      if (error.witnessRequired) setWitnessNeeded(true);
      if (error.sealedBoxes) setSeals(error.sealedBoxes);
      else setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="card">
        <p role="status">{error || "Loading…"}</p>
        {error && (
          <button className="action-primary" onClick={reload}>
            Retry
          </button>
        )}
      </section>
    );
  const items = new Map(
    [...data.items, ...(record?.items || [])].map((item) => [item.id, item]),
  );
  function budget(item) {
    const old = record?.allocations?.find(
      (allocation) => allocation.item_id === item.id,
    );
    return item.remaining_amount == null
      ? null
      : item.remaining_amount + (old?.given || 0) + (old?.wasted || 0);
  }
  function unit(item) {
    try {
      return JSON.parse(item.definition_snapshot).amountUnit;
    } catch {
      return "";
    }
  }
  function updateAmount(id, key, value) {
    field(
      "items",
      draft.items.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    );
  }
  function toggle(item) {
    field(
      "items",
      draft.items.some((row) => row.id === item.id)
        ? draft.items.filter((row) => row.id !== item.id)
        : [
            ...draft.items,
            { id: item.id, boxId: item.box_id, given: "", wasted: "0" },
          ],
    );
  }
  const readOnly =
    draft.status === "completed" ||
    !can(draft.id ? "incidents.edit" : "incidents.create");
  const canComplete =
    can(draft.id ? "incidents.edit" : "incidents.create") &&
    (draft.reason !== "used" || can("medications.administer")) &&
    (!draft.items.some((item) => Number(item.wasted) > 0) ||
      can("medications.waste"));
  const needsWitness =
    witnessNeeded ||
    draft.items.some((row) => {
      const item = items.get(row.id);
      if (!item) return false;
      const rule =
        draft.reason === "used"
          ? Number(row.given) < item.amount_total || Number(row.wasted) > 0
            ? "partial"
            : "entire"
          : draft.reason === "opened"
            ? "opening"
            : "disposal";
      return (
        item.requirements?.includes(rule) ||
        (Number(row.wasted) > 0 && item.requirements?.includes("disposal"))
      );
    });
  return (
    <section>
      <div className="workspace-tabs">
        <button
          disabled={busy}
          className={tab === "editor" ? "selected" : ""}
          onClick={() => setTab("editor")}
        >
          Current incident
        </button>
        <button
          disabled={busy}
          className={tab === "list" ? "selected" : ""}
          onClick={() => setTab("list")}
        >
          <FolderOpen size={17} /> Saved incidents
        </button>
        <button disabled={busy || !can("incidents.create")} onClick={start}>
          <Plus size={17} /> New
        </button>
      </div>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <p role="status" className="inventory-status">
        {notice}
      </p>
      {tab === "list" ? (
        <>
          <label className="field-label">
            Find an incident
            <ClearInput
              clearLabel="Find an incident"
              className="form-control"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Incident number or reason"
            />
          </label>
          <div className="record-list">
            {data.incidents
              .filter((incident) =>
                [incident.incident_number, incident.reason, incident.status]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((incident) => (
                <button
                  key={incident.id}
                  onClick={() => open(incident.id)}
                  disabled={busy}
                >
                  <span>
                    <strong>
                      {incident.incident_number || "Incident #" + incident.id}
                    </strong>
                    <small>
                      {incident.status} ·{" "}
                      {new Date(
                        incident.updated_at || incident.created_at,
                      ).toLocaleString()}
                    </small>
                  </span>
                  <FolderOpen size={20} />
                </button>
              ))}
            {!data.incidents.length && <p>No saved incidents yet.</p>}
          </div>
        </>
      ) : (
        <>
          <section className="pool-panel" aria-label="Incident editor">
            <div className="pool-heading">
              <h2>
                {draft.id ? "Incident #" + draft.id : "New incident"}{" "}
                <span>{draft.items.length}</span>
              </h2>
              <span className="state-badge">{draft.status}</span>
            </div>
            {readOnly && (
              <p>
                {draft.status === "completed"
                  ? "Completed · Reopen to edit. Earlier revisions remain in the record."
                  : "Read-only access for this profile."}
              </p>
            )}
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                save(false);
              }}
            >
              <label>
                Incident number
                <ClearInput
                  clearLabel="Incident number"
                  className="form-control"
                  required={draft.reason === "used"}
                  disabled={readOnly || busy}
                  maxLength={60}
                  value={draft.incidentNumber}
                  onChange={(event) =>
                    field("incidentNumber", event.target.value)
                  }
                />
              </label>
              <label>
                Reason
                <SearchSelect
                  clearLabel="Reason"
                  aria-label="Reason"
                  className="form-select"
                  required
                  disabled={readOnly || busy}
                  value={draft.reason}
                  onChange={(event) => field("reason", event.target.value)}
                >
                  <option value="">Choose a reason</option>
                  {incidentReasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </SearchSelect>
              </label>
              <div className="dose-list">
                {draft.items.map((row) => {
                  const item = items.get(row.id);
                  if (!item)
                    return (
                      <p key={row.id}>
                        Item unavailable.{" "}
                        <button
                          type="button"
                          onClick={() =>
                            field(
                              "items",
                              draft.items.filter(
                                (entry) => entry.id !== row.id,
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </p>
                    );
                  const available = budget(item);
                  return (
                    <article key={row.id} className="dose-row">
                      <div className="dose-heading">
                        <span>
                          <strong>{item.medication}</strong>
                          <small>
                            <code>{item.code}</code> ·{" "}
                            {(readOnly ? item.remaining_amount : available) ??
                              "Unknown"}{" "}
                            {unit(item)}{" "}
                            {readOnly
                              ? "remaining"
                              : "available for this entry"}
                          </small>
                        </span>
                        <div>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"Record " + item.code}
                            onClick={() => setHistory(item.code)}
                          >
                            <HistoryIcon size={18} />
                          </button>
                          {!readOnly && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={"Remove " + item.code}
                              onClick={() => toggle(item)}
                            >
                              <X size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                      {draft.reason === "used" ? (
                        <>
                          <div className="dose-grid">
                            <label>
                              Given ({unit(item)})
                              <ClearInput
                                aria-label={"Given " + item.code}
                                className="form-control"
                                type="number"
                                step="any"
                                min="0"
                                max={available ?? undefined}
                                required
                                disabled={readOnly || busy}
                                value={row.given}
                                onChange={(event) =>
                                  updateAmount(
                                    item.id,
                                    "given",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              Wasted ({unit(item)})
                              <ClearInput
                                aria-label={"Wasted " + item.code}
                                className="form-control"
                                type="number"
                                step="any"
                                min="0"
                                max={available ?? undefined}
                                required
                                disabled={readOnly || busy}
                                value={row.wasted}
                                onChange={(event) =>
                                  updateAmount(
                                    item.id,
                                    "wasted",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                          </div>
                          {!readOnly && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                field(
                                  "items",
                                  draft.items.map((entry) =>
                                    entry.id === item.id
                                      ? {
                                          ...entry,
                                          given: available,
                                          wasted: 0,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              Use remaining amount
                            </button>
                          )}
                          <p className="field-help">
                            {readOnly
                              ? "Current vial balance: "
                              : "Balance after this entry: "}
                            {available == null
                              ? "Unknown"
                              : readOnly
                                ? item.remaining_amount
                                : Number(
                                    (
                                      available -
                                      Number(row.given || 0) -
                                      Number(row.wasted || 0)
                                    ).toFixed(6),
                                  )}{" "}
                            {unit(item)}
                          </p>
                        </>
                      ) : (
                        draft.reason &&
                        draft.reason !== "opened" && (
                          <label>
                            Wasted ({unit(item)})
                            <ClearInput
                              aria-label={"Wasted " + item.code}
                              className="form-control"
                              type="number"
                              min="0"
                              step="any"
                              max={available ?? undefined}
                              disabled={readOnly || busy}
                              value={row.wasted}
                              onChange={(event) =>
                                updateAmount(
                                  item.id,
                                  "wasted",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        )
                      )}
                    </article>
                  );
                })}
              </div>
              {!draft.items.length && (
                <p>Select medication items from storage below.</p>
              )}
              <label>
                Notes
                <ClearTextarea
                  clearLabel="Notes"
                  aria-label="Notes"
                  className="form-control"
                  maxLength={1000}
                  disabled={readOnly || busy}
                  value={draft.notes}
                  onChange={(event) => field("notes", event.target.value)}
                />
              </label>
              {readOnly && draft.witness ? (
                <p>
                  Witness: {draft.witness}
                  {draft.witnessSignoff
                    ? " · Account authenticated"
                    : " · Legacy name entry"}
                </p>
              ) : (
                needsWitness && (
                  <p className="policy-note">
                    A second user will sign in to witness this action when you
                    complete it. Drafts do not create a sign-off.
                  </p>
                )
              )}

              {draft.status === "reopened" && (
                <label>
                  Correction reason
                  <ClearInput
                    clearLabel="Correction reason"
                    className="form-control"
                    required
                    maxLength={500}
                    value={draft.correctionNote || ""}
                    onChange={(event) =>
                      field("correctionNote", event.target.value)
                    }
                  />
                </label>
              )}
              <div className="dialog-actions">
                {readOnly ? (
                  <button
                    type="button"
                    className="action-primary"
                    disabled={
                      busy ||
                      draft.status !== "completed" ||
                      !can("incidents.reopen")
                    }
                    onClick={reopen}
                  >
                    Reopen incident
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="cancel-button"
                      disabled={busy}
                      onClick={() => save(true)}
                    >
                      Save draft
                    </button>
                    <button
                      className="action-primary"
                      disabled={busy || !draft.items.length || !canComplete}
                    >
                      {busy
                        ? "Saving…"
                        : draft.status === "reopened"
                          ? "Save correction"
                          : "Complete incident"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </section>
          {record?.versions?.length > 0 && (
            <details className="revision-history">
              <summary>Revision history ({record.versions.length})</summary>
              {record.versions.map((version) => {
                const payload = JSON.parse(version.payload);
                return (
                  <article key={version.id}>
                    <strong>
                      Revision {version.revision} · {version.status}
                    </strong>
                    <small>
                      {new Date(version.created_at).toLocaleString()}
                    </small>
                    <p>
                      {payload.incidentNumber} · {payload.notes}{" "}
                      {payload.correctionNote}
                    </p>
                    <ul>
                      {payload.items.map((item) => (
                        <li key={item.id}>
                          {items.get(item.id)?.code || item.id}:{" "}
                          {item.given || 0} given / {item.wasted || 0} wasted
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </details>
          )}
          {!readOnly && (
            <StorageBrowser
              searchable
              data={data}
              location={location}
              onLocationChange={setLocation}
              renderItem={(item) => (
                <>
                  <label className="verify-control">
                    <ClearInput
                      type="checkbox"
                      disabled={
                        busy ||
                        !can(
                          draft.id ? "incidents.edit" : "incidents.create",
                        ) ||
                        !canDrug(
                          data.definitions.find(
                            (drug) => drug.id === item.definition_id,
                          ) || item,
                          draft.reason === "used" ? "administer" : "view",
                        ) ||
                        (draft.items.length >= 100 &&
                          !draft.items.some((row) => row.id === item.id))
                      }
                      checked={draft.items.some((row) => row.id === item.id)}
                      onChange={() => toggle(item)}
                      aria-label={"Add " + item.code + " to incident"}
                    />
                    <span>
                      <strong>{item.medication}</strong>
                      <small>{item.presentation}</small>
                      <small>
                        <code>{item.code}</code> · {item.remaining_amount}{" "}
                        {unit(item)} remaining
                      </small>
                    </span>
                  </label>
                </>
              )}
            />
          )}
        </>
      )}
      {seals && (
        <Modal
          title="Have the seals been broken?"
          busy={busy}
          onClose={() => setSeals(null)}
        >
          <SealQuestion boxes={seals} />
          {needsWitness && (
            <p>A second user will sign in to witness the confirmed action.</p>
          )}
          {error && (
            <p className="error-note" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="cancel-button"
              disabled={busy}
              onClick={() => setSeals(null)}
            >
              Cancel
            </button>
            <button
              className="action-primary"
              disabled={busy}
              onClick={() => save(false, true)}
            >
              Confirm and save
            </button>
          </div>
        </Modal>
      )}
      {history && (
        <History
          identity={history}
          boxes={data.boxes}
          onClose={() => setHistory("")}
        />
      )}
    </section>
  );
}
