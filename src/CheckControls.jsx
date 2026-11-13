import { ClearTextarea } from "./FormControls.jsx";
import { useState } from "react";
import { request } from "./api.js";
import { useAccess } from "./access-state.js";
import Modal from "./Modal.jsx";

export default function CheckControls({ box, check, busy, onAction }) {
  const { can } = useAccess();
  const [notes, setNotes] = useState(check?.draft?.notes || ""),
    [history, setHistory] = useState(null),
    [error, setError] = useState("");
  async function showHistory() {
    try {
      setHistory(await request("checks?boxId=" + encodeURIComponent(box.id)));
      setError("");
    } catch (error) {
      setError(error.message);
    }
  }
  const body = { boxId: box.id, revision: check?.draft?.revision, notes };
  return (
    <div className="check-controls">
      {check?.stale && (
        <p className="error-note">
          Stock changed since this draft began. Reset the check before
          continuing.
        </p>
      )}
      <p>
        {check?.status === "complete"
          ? "Complete"
          : check?.draft
            ? `${check.checkedIds.length} / ${check.total} verified · saved check`
            : "Not checked"}
        {check?.overdue ? " · Overdue" : ""}
        <small>
          {check?.intervalHours
            ? "Every " + check.intervalHours + " hours"
            : "Manual checks"}
          {check?.lastCompletedAt
            ? " · Last completed " +
              new Date(check.lastCompletedAt).toLocaleString()
            : ""}
        </small>
      </p>
      {check?.draft && (
        <label>
          Check notes
          <ClearTextarea
            clearLabel="Check notes"
            aria-label="Check notes"
            className="form-control"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      )}
      <div className="check-actions">
        {check?.draft ? (
          <>
            <button
              className="cancel-button"
              disabled={busy || check.stale || !can("checks.save")}
              onClick={() => onAction("checks/save", body)}
            >
              Save draft
            </button>
            <button
              className="action-primary"
              disabled={
                busy ||
                check.stale ||
                check.checkedIds.length !== check.total ||
                !can("checks.complete")
              }
              onClick={() => onAction("checks/complete", body)}
            >
              Complete check
            </button>
          </>
        ) : (
          check?.status !== "complete" && (
            <button
              className="action-primary"
              disabled={busy || !can("checks.start")}
              onClick={() =>
                onAction("checks/start", { boxId: box.id, kind: "scheduled" })
              }
            >
              Start check
            </button>
          )
        )}
        <button
          className="text-button"
          disabled={busy || !can("checks.reset")}
          onClick={() =>
            onAction("checks/start", { boxId: box.id, kind: "reset" })
          }
        >
          Reset check
        </button>
        <button
          className="text-button"
          disabled={busy || !can("checks.adhoc")}
          onClick={() =>
            onAction("checks/start", { boxId: box.id, kind: "adhoc" })
          }
        >
          Ad hoc check
        </button>
        <button className="text-button" onClick={showHistory}>
          Check history
        </button>
      </div>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {history && (
        <Modal
          title={box.name + " check history"}
          onClose={() => setHistory(null)}
        >
          {!history.length && <p>No saved checks.</p>}
          {history.map((record) => (
            <details className="check-history-entry" key={record.id}>
              <summary>
                {record.status} · {record.checkedIds.length}/
                {record.items.length} ·{" "}
                {new Date(record.updated_at).toLocaleString()}
              </summary>
              <p>
                {record.kind} · {record.notes}
              </p>
              <ul>
                {record.items.map((item) => (
                  <li key={item.id}>
                    {record.checkedIds.includes(item.id) ? "✓" : "—"}{" "}
                    {item.medication} · <code>{item.code}</code>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <div className="dialog-actions">
            <button className="cancel-button" onClick={() => setHistory(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
