import { useState } from "react";
import { ClearInput } from "./FormControls.jsx";
import { request } from "./api.js";
export default function Login({ setupRequired, onSignedIn }) {
  const [form, setForm] = useState({
      username: "",
      name: "",
      password: "",
      confirm: "",
      serviceName: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (key, label, type = "text") => (
    <label>
      {label}
      <ClearInput
        clearLabel={label}
        type={type}
        required
        value={form[key]}
        autoComplete={
          key === "username"
            ? "username"
            : type === "password"
              ? setupRequired
                ? "new-password"
                : "current-password"
              : undefined
        }
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  async function submit(e) {
    e.preventDefault();
    setError("");
    if (setupRequired && form.password !== form.confirm)
      return setError("Passwords do not match");
    setBusy(true);
    try {
      await request(setupRequired ? "auth/setup" : "auth/login", form);
      await onSignedIn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          EMCore <small>INVENTORY</small>
        </div>
        <h1>{setupRequired ? "Set up your service" : "Sign in"}</h1>
        {setupRequired && (
          <p>
            Create the first Service Admin. Existing stock will belong to this
            service.
          </p>
        )}
        <form className="form-stack" onSubmit={submit}>
          {setupRequired && field("serviceName", "Service name")}
          {setupRequired && field("name", "Your name")}
          {field("username", "Username")}
          {field("password", "Password", "password")}
          {setupRequired && (
            <>
              {field("confirm", "Confirm password", "password")}
              <p className="field-help">Use 12–128 characters.</p>
            </>
          )}
          {error && (
            <p className="error-note" role="alert">
              {error}
            </p>
          )}
          <button className="action-primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : setupRequired
                ? "Create service & administrator"
                : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
