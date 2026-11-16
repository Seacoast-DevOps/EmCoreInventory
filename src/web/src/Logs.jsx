import { useEffect, useState } from "react";
import { request } from "./api.js";
import { ClearInput, SearchSelect } from "./FormControls.jsx";
function witnessLabel(entry) {
  try {
    const details = JSON.parse(entry.details);
    return details.witnessSignoff
      ? details.witnessSignoff.name +
          " (@" +
          details.witnessSignoff.username +
          ") · Account authenticated"
      : details.witness
        ? details.witness + " · Legacy name entry"
        : "";
  } catch {
    return "";
  }
}
export default function Logs() {
  const [q, setQ] = useState(""),
    [type, setType] = useState("all"),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      request("logs?type=" + type + "&q=" + encodeURIComponent(q))
        .then((data) => {
          if (active) {
            setResult(data);
            setError("");
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, type]);
  async function more() {
    setBusy(true);
    try {
      const data = await request(
        "logs?type=" +
          type +
          "&q=" +
          encodeURIComponent(q) +
          "&offset=" +
          result.entries.length,
      );
      setResult((current) => ({
        ...data,
        entries: [...current.entries, ...data.entries],
      }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="logs-filters">
        <label>
          Search logs
          <ClearInput
            clearLabel="Log search"
            className="form-control"
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Code, lot, medication, user, witness, action…"
          />
        </label>
        <label>
          Type
          <SearchSelect
            clearLabel="Type"
            aria-label="Log type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="all">All logs</option>
            <option value="item">Vial / inventory records</option>
            <option value="settings">Settings changes</option>
            <option value="access">Actions / access decisions</option>
          </SearchSelect>
        </label>
      </div>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <p role="status">
        {result ? result.total + " entries" : "Loading logs…"}
      </p>
      <div className="logs-list">
        {result?.entries.map((entry) => (
          <article key={entry.kind + "-" + entry.id}>
            <div>
              <strong>
                {entry.action.replaceAll("_", " ").replace("/api/", "")}
              </strong>
              <span>{entry.kind}</span>
            </div>
            <p>
              {entry.subject}
              {entry.code && (
                <>
                  {" "}
                  · <code>{entry.code}</code>
                </>
              )}
            </p>
            <small>
              {new Date(entry.created_at).toLocaleString()} · {entry.actor}
            </small>
            {witnessLabel(entry) && (
              <p className="log-witness">Witness: {witnessLabel(entry)}</p>
            )}
            <details>
              <summary>Details</summary>
              <pre>{JSON.stringify(JSON.parse(entry.details), null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
      {result?.hasMore && (
        <button className="cancel-button" disabled={busy} onClick={more}>
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
