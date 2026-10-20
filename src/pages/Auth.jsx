import { useState } from "react";
import { api, nav } from "../lib/api";
import Logo from "../components/Logo";
import HumanCheck, { FVA_VERIFY_SITEKEY } from "../components/HumanCheck";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
  );
}

export function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState({ loading: false, error: "" });

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      await api.login(identifier, password);
      // A pending project invite survives sign-in: finish the join after auth.
      const pending = localStorage.getItem("kb_pending_invite");
      if (pending) {
        localStorage.removeItem("kb_pending_invite");
        nav("/app/projects/join/" + encodeURIComponent(pending));
      } else {
        nav("/app/dashboard");
      }
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
            <div className="field"><label htmlFor="auth-email">Email or username</label><input id="auth-email" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required placeholder="you@example.com or your username" autoComplete="username" /></div>
            <div className="field"><label htmlFor="auth-password">Password</label><div className="pw-wrap"><input id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" /><button type="button" className="pw-toggle" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button></div></div>
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
  const [humanToken, setHumanToken] = useState(null);
  const [status, setStatus] = useState({ loading: false, error: "", ok: "" });

  async function submit(e) {
    e.preventDefault();
    if (FVA_VERIFY_SITEKEY && !humanToken) {
      setStatus({ loading: false, error: "Please tick the 'Verify you are human' box.", ok: "" });
      return;
    }
    setStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.post("/api/auth/forgot", { email, fvaverify_token: humanToken });
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
            <div className="field"><label htmlFor="auth-reset-email">Account email *</label><input id="auth-reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></div>
            <HumanCheck onToken={setHumanToken} />
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
                <div><label htmlFor="auth-new-password">New password *</label><input id="auth-new-password" type="password" value={form.newPassword} onChange={(e) => set("newPassword", e.target.value)} required minLength={8} /></div>
                <div><label htmlFor="auth-confirm-password">Confirm *</label><input id="auth-confirm-password" type="password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} required minLength={8} /></div>
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
