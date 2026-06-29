import { useState } from "react";

/** Inline SignalK login shown to anonymous viewers so they can take control. */
export default function LoginPanel({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="login__title">Log in to control the watch</div>
      <input
        placeholder="Username"
        value={username}
        autoComplete="username"
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        placeholder="Password"
        type="password"
        value={password}
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? <div className="warn">{error}</div> : null}
      <button className="btn btn--start" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </button>
      <div className="muted">You can view the schedule without logging in.</div>
    </form>
  );
}
