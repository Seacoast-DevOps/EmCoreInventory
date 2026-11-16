import QrLabel from "./QrLabel.jsx";
import { useEffect, useState } from "react";
import { request } from "./api.js";
import Modal from "./Modal.jsx";

export default function History({ identity, boxes, onClose, showQr = false }) {
  const [qr, setQr] = useState(showQr);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request("history?item=" + encodeURIComponent(identity))
      .then((data) => {
        if (active) setRecord(data);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [identity]);
  function place(id) {
    const box = boxes.find((box) => box.id === id);
    return box ? box.location + " — " + box.name : id;
  }
  function describe(event) {
    let detail;
    try {
      detail = JSON.parse(event.details);
    } catch {
      detail = event.details;
    }
    if (
      ["medication_used", "incident_corrected"].includes(event.action) ||
      (detail && typeof detail === "object" && Object.hasOwn(detail, "given"))
    )
      return (
        (event.action === "incident_corrected" ? "Correction · " : "") +
        (detail.incidentNumber
          ? "Incident " + detail.incidentNumber + " · "
          : "") +
        detail.given +
        " " +
        detail.unit +
        " given / " +
        detail.wasted +
        " " +
        detail.unit +
        " wasted · " +
        detail.remaining +
        " remaining" +
        (detail.correctionNote ? " · " + detail.correctionNote : "")
      );
    if (event.action === "incident_reopened")
      return (
        "Incident #" +
        detail.incidentId +
        " reopened for correction (revision " +
        detail.revision +
        ")."
      );
    if (event.action === "standardized")
      return "Standardized medication profile linked; original code and history preserved.";
    if (event.action === "check_verified")
      return (
        "Drug check: " +
        (detail.verified ? "verified present" : "verification cleared")
      );
    if (event.action === "check_completed")
      return "Container drug check completed (" + detail.kind + ").";
    if (event.action === "container_resealed")
      return "Container resealed: " + detail.seal;
    if (event.action === "container_updated")
      return (
        "Container updated: " + detail.location + " — " + detail.containerName
      );
    if (event.action === "verify")
      return detail?.verified === true || detail === true || detail === "true"
        ? "Verified present"
        : "Verification cleared";
    if (event.action === "move")
      return (
        "Moved from " + place(event.from_box) + " to " + place(event.to_box)
      );
    if (event.action === "seal_broken")
      return "Seal " + detail.seal + " broken on " + place(event.from_box);
    if (event.action === "registered")
      return "Tracking code assigned. Earlier events remain linked; original intake date unknown.";
    if (event.action === "received")
      return "Received into " + place(event.to_box);
    return [
      detail?.reason || event.action,
      detail?.incidentNumber ? "Incident " + detail.incidentNumber : "",
      detail?.notes,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function witness(event) {
    try {
      return JSON.parse(event.details)?.witness || "";
    } catch {
      return "";
    }
  }
  return (
    <Modal title="Item record" onClose={onClose}>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      {!record && !error && <p role="status">Loading record…</p>}
      {record && (
        <>
          <p>
            <strong>{record.item.medication}</strong>
            <br />
            {record.item.presentation}
            <br />
            <code className="tracking-code">{record.item.code}</code> ·{" "}
            {record.item.status}
            <br />
            {record.item.remaining_amount ?? "Unknown"} remaining /{" "}
            {record.item.amount_total ?? "Unknown"} total
          </p>
          <button className="cancel-button" onClick={() => setQr(!qr)}>
            {qr ? "Hide QR label" : "Generate / show QR label"}
          </button>
          {qr && <QrLabel identity={record.item.code} />}
          <ol className="history-list">
            {record.events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString()}
                </time>
                <p>{describe(event)}</p>
                {event.actor_profile && (
                  <small>Performed by: {event.actor_profile}</small>
                )}
                {witness(event) && (
                  <small>
                    Witness: {witness(event)}
                    {JSON.parse(event.details)?.witnessSignoff
                      ? " · Account authenticated"
                      : " · Legacy name entry"}
                  </small>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="dialog-actions">
        <button className="cancel-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
