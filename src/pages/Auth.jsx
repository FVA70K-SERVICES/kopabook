import { useState } from "react";
import { api, nav } from "../lib/api";
import Logo from "../components/Logo";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "" });

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      await api.login(email, password);
      nav("/app/dashboard");
    } catch (err) {
      setStatus({ loading: false, error: err.message });
    }
  }

  return (
    <div className="page" style={{ background: "var(--bg)" }}>
      <div className="wrap">
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
        </div>
        <div className="form-card">
          <h1>Welcome back</h1>
          <p className="hint">Sign in to your KopaBook business.</p>
          {status.error && <div className="alert alert-error">{status.error}</div>}
          <form onSubmit={submit}>
            <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></div>
            <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" /></div>
            <button className="btn btn-primary btn-block" disabled={status.loading}>
              {status.loading ? "Signing in..." : "Sign in"}
            </button>
            <p style={{ textAlign: "center", marginTop: 12, fontSize: 14 }}>
              <a href="/forgot-password">Forgot password?</a>
            </p>
          </form>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "var(--muted)" }}>
            First time here? <a href="/register">Create your account</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", ok: "" });

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.post("/api/auth/forgot", { email });
      setStatus({ loading: false, error: "", ok: d.message || "Check your inbox for the reset link." });
    } catch (err) {
      setStatus({ loading: false, error: err.message, ok: "" });
    }
  }

  return (
    <div className="page" style={{ background: "var(--bg)" }}>
      <div className="wrap">
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
        </div>
        <div className="form-card">
          <h1>Reset password</h1>
          {status.error && <div className="alert alert-error">{status.error}</div>}
          {status.ok && <div className="alert alert-ok">{status.ok}</div>}
          <p className="hint">
            Enter your account email and we will send you a reset link. It works once and expires in 1 hour.
          </p>
          <form onSubmit={submit}>
            <div className="field"><label>Account email *</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></div>
            <button className="btn btn-primary btn-block" disabled={status.loading}>
              {status.loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "var(--muted)" }}>
            <a href="/login">Back to sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [form, setForm] = useState({ newPassword: "", confirm: "" });
  const [status, setStatus] = useState({ loading: false, error: "", ok: "" });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setStatus({ loading: false, error: "New passwords do not match.", ok: "" });
      return;
    }
    setStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.post("/api/auth/reset-password", { token, newPassword: form.newPassword });
      setStatus({ loading: false, error: "", ok: d.message || "Password reset." });
    } catch (err) {
      setStatus({ loading: false, error: err.message, ok: "" });
    }
  }

  return (
    <div className="page" style={{ background: "var(--bg)" }}>
      <div className="wrap">
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
        </div>
        <div className="form-card">
          <h1>Choose a new password</h1>
          {status.error && <div className="alert alert-error">{status.error}</div>}
          {status.ok && (
            <div className="alert alert-ok">
              {status.ok} <a href="/login">Sign in now</a>.
            </div>
          )}
          {!status.ok && (
            <form onSubmit={submit}>
              <div className="field"><div className="row2">
                <div><label>New password *</label><input type="password" value={form.newPassword} onChange={(e) => set("newPassword", e.target.value)} required minLength={8} /></div>
                <div><label>Confirm *</label><input type="password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} required minLength={8} /></div>
              </div></div>
              <button className="btn btn-primary btn-block" disabled={status.loading || !token}>
                {status.loading ? "Resetting..." : "Reset password"}
              </button>
              {!token && <p className="alert alert-error" style={{ marginTop: 12 }}>This link is missing its token. Request a new reset link.</p>}
            </form>
          )}
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "var(--muted)" }}>
            <a href="/login">Back to sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
