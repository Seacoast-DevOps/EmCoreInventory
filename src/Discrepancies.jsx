import { useState } from "react";
import { request, useInventory, confirmedSeals } from "./api.js";
import { useAccess } from "./access-state.js";
import { ClearInput, ClearTextarea, SearchSelect } from "./FormControls.jsx";
import Modal, { SealQuestion } from "./Modal.jsx";
import { needsPartner } from "../shared/matrix-rules.js";
export function ReportDiscrepancy({ box, boxes = [], onClose, onSaved }) {
  const [boxId, setBoxId] = useState(box?.id || ""),
    [itemCode, setItemCode] = useState(""),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await request("discrepancies", { boxId, itemCode, notes });
      onSaved?.(result);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Report discrepancy" onClose={onClose} busy={busy}>
      <form className="form-stack" onSubmit={save}>
        {box ? (
          <p>
            {box.location} — {box.name}
          </p>
        ) : (
          <label>
            Container
            <SearchSelect
              clearLabel="Discrepancy container"
              required
              value={boxId}
              onChange={(e) => setBoxId(e.target.value)}
            >
              <option value="">Choose container</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.location} — {b.name}
                </option>
              ))}
            </SearchSelect>
          </label>
        )}
        <label>
          Item code (optional)
          <ClearInput
            clearLabel="Discrepancy item code"
            maxLength={8}
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          What did you find?
          <ClearTextarea
            clearLabel="Discrepancy notes"
            maxLength={1000}
            required
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <p className="field-help">
          Reporting or approving does not adjust stock or verify a missing item.
        </p>
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
            Save discrepancy
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SealDialog({ box, onClose, onAction }) {
  const { access } = useAccess(),
    breaking = Boolean(box.sealed),
    [seal, setSeal] = useState(""),
    [incidentNumber, setIncidentNumber] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (
        await onAction("seals", {
          boxId: box.id,
          action: breaking ? "break" : "reseal",
          seal,
          incidentNumber,
          brokenSeals: breaking ? confirmedSeals([box]) : [],
        })
      )
        onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={breaking ? "Confirm physical seal break" : "Reseal container"}
      onClose={onClose}
      busy={busy}
    >
      <form className="form-stack" onSubmit={save}>
        {breaking ? (
          <SealQuestion boxes={[box]} />
        ) : (
          <label>
            New physical seal number
            <ClearInput
              clearLabel="New seal number"
              maxLength={40}
              required
              value={seal}
              onChange={(e) => setSeal(e.target.value)}
            />
          </label>
        )}
        <label>
          Incident number (optional)
          <ClearInput
            clearLabel="Seal incident number"
            maxLength={60}
            value={incidentNumber}
            onChange={(e) => setIncidentNumber(e.target.value)}
          />
        </label>
        {needsPartner(access.profile) && (
          <p className="policy-note">
            Driver seal breaking/resealing requires another eligible user to
            verify this action with their own credentials.
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="cancel-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="action-primary" disabled={busy}>
            {breaking
              ? "Yes, physically broken — continue"
              : "Confirm physical reseal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function Discrepancies() {
  const { can } = useAccess(),
    { data, setData, error, reload } = useInventory(),
    [report, setReport] = useState(false),
    [approval, setApproval] = useState(null),
    [resolution, setResolution] = useState(""),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  async function approve(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setData(
        await request("discrepancies/approve", {
          id: approval.id,
          revision: approval.revision,
          resolution,
        }),
      );
      setApproval(null);
      setResolution("");
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <p>
        {error || "Loading discrepancies…"}
        {error && <button onClick={reload}>Retry</button>}
      </p>
    );
  return (
    <section>
      <button
        className="action-primary"
        disabled={!can("discrepancies.report")}
        onClick={() => setReport(true)}
      >
        Report discrepancy
      </button>
      <p>
        Supervisor, Company Admin, or Seacoast Admin can approve discrepancies.
        Approval records review; it does not silently adjust stock or mark a
        missing vial present.
      </p>
      {data.discrepancies?.map((d) => (
        <article className="settings-card" key={d.id}>
          <h2>
            {d.container_name} · {d.status}
          </h2>
          <p>
            {d.location}
            {d.code && " · " + d.code}
          </p>
          <p>{d.notes}</p>
          <small>
            Reported by {d.reported_by} ·{" "}
            {new Date(d.reported_at).toLocaleString()}
          </small>
          {d.approved_by && (
            <p>
              Approved by {d.approved_by}
              <br />
              {d.resolution}
            </p>
          )}
          {d.status === "open" && (
            <button
              className="cancel-button"
              disabled={!can("discrepancies.approve")}
              onClick={() => {
                setFailure("");
                setApproval(d);
              }}
            >
              Review / approve
            </button>
          )}
        </article>
      ))}
      {!data.discrepancies?.length && <p>No discrepancies reported.</p>}
      {report && (
        <ReportDiscrepancy
          boxes={data.boxes}
          onClose={() => setReport(false)}
          onSaved={setData}
        />
      )}{" "}
      {approval && (
        <Modal
          title="Approve discrepancy"
          onClose={() => setApproval(null)}
          busy={busy}
        >
          <form className="form-stack" onSubmit={approve}>
            <p>{approval.notes}</p>
            <label>
              Review / resolution note
              <ClearTextarea
                clearLabel="Discrepancy resolution"
                required
                maxLength={1000}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </label>
            {failure && (
              <p role="alert" className="error-note">
                {failure}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setApproval(null)}
              >
                Cancel
              </button>
              <button className="action-primary" disabled={busy}>
                Approve discrepancy
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
