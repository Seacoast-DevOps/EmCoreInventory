import { useEffect, useRef, useState } from "react";
import { setWitnessPrompt } from "./witness-prompt.js";
import { ClearInput } from "./FormControls.jsx";
import Modal from "./Modal.jsx";
export default function WitnessPrompt() {
  const [prompt, setPrompt] = useState(null),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    pending = useRef(null);
  function finish(value) {
    const resolve = pending.current;
    pending.current = null;
    setPassword("");
    setUsername("");
    setPrompt(null);
    resolve?.(value);
  }
  useEffect(() => {
    const dispose = setWitnessPrompt(
      (details) =>
        new Promise((resolve) => {
          if (pending.current) return resolve(null);
          pending.current = resolve;
          setUsername("");
          setPassword("");
          setPrompt(details);
        }),
    );
    const cancel = () => finish(null);
    window.addEventListener("emcore-session-expired", cancel);
    return () => {
      dispose();
      window.removeEventListener("emcore-session-expired", cancel);
      pending.current?.(null);
    };
  }, []);
  if (!prompt) return null;
  const summary = prompt.summary;
  return (
    <Modal title="Witness sign-off" onClose={() => finish(null)}>
      <p>
        A different active user in this service must review this action and sign
        with their own account. Can Witness is required.
      </p>
      {summary && (
        <section className="witness-summary">
          <strong>{summary.action}</strong>
          {summary.incidentNumber && <p>Incident {summary.incidentNumber}</p>}
          {summary.reason && <p>Reason: {summary.reason}</p>}
          {summary.medication && (
            <p>
              {summary.medication} · {summary.quantity} item(s) · Lot{" "}
              {summary.lotNumber}
            </p>
          )}
          {summary.destination && (
            <p>
              To {summary.destination.location} — {summary.destination.name}
            </p>
          )}
          {summary.container && (
            <p>
              {summary.container.location} — {summary.container.name}
              <br />
              {summary.container.sealed
                ? "Sealed · " + summary.container.seal
                : "Unsealed"}
            </p>
          )}
          {summary.sealBreaks?.map((seal, i) => (
            <p key={i}>
              Seal broken: {seal.seal} · {seal.container}
            </p>
          ))}
          {summary.correctionNote && (
            <p>Correction: {summary.correctionNote}</p>
          )}
          {summary.notes && <p>Notes: {summary.notes}</p>}
          <ul>
            {summary.items?.map((item) => (
              <li key={item.code}>
                <strong>{item.medication}</strong> · <code>{item.code}</code>
                <small>{item.presentation}</small>
                {item.given !== null && (
                  <small>
                    Given: {item.given} {item.unit} · Wasted: {item.wasted}{" "}
                    {item.unit}
                  </small>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p role="alert" className="policy-note">
        {prompt.message}
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          finish({ username, password });
        }}
      >
        <label>
          Witness username
          <ClearInput
            clearLabel="Witness username"
            className="form-control"
            autoComplete="off"
            required
            maxLength={80}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Witness password
          <ClearInput
            clearLabel="Witness password"
            className="form-control"
            type="password"
            autoComplete="off"
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="field-help">
          Signing approves this specific save. The operator stays signed in.
          Credentials are cleared after submission.
        </p>
        <div className="dialog-actions">
          <button
            className="cancel-button"
            type="button"
            onClick={() => finish(null)}
          >
            Cancel
          </button>
          <button className="action-primary">Witness & save</button>
        </div>
      </form>
    </Modal>
  );
}
