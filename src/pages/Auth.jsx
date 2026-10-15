import { useState } from "react";
import { api, nav } from "../lib/api";

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
          <a href="/" className="brand">Kopa<span>Book</span></a>
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
          </form>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "var(--muted)" }}>
            First time here? <a href="/owner-setup">Set up your business</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export function OwnerSetupPage() {
  const [form, setForm] = useState({
    bootstrapKey: "", fullName: "", email: "", password: "",
    businessName: "", businessType: "", city: "",
  });
  const [status, setStatus] = useState({ loading: false, error: "" });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      await api.bootstrap(form);
      nav("/app/dashboard");
    } catch (err) {
      setStatus({ loading: false, error: err.message });
    }
  }

  return (
    <div className="page" style={{ background: "var(--bg)" }}>
      <div className="wrap">
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href="/" className="brand">Kopa<span>Book</span></a>
        </div>
        <div className="form-card">
          <h1>Set up your business</h1>
          <p className="hint">Create the owner account. This page only works once, using your bootstrap key.</p>
          {status.error && <div className="alert alert-error">{status.error}</div>}
          <form onSubmit={submit}>
            <div className="field"><label>Bootstrap key *</label><input value={form.bootstrapKey} onChange={(e) => set("bootstrapKey", e.target.value)} required placeholder="From your Cloudflare Pages secrets" /></div>
            <div className="field"><label>Your full name *</label><input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Your name" /></div>
            <div className="field"><div className="row2">
              <div><label>Email *</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></div>
              <div><label>Password *</label><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} /></div>
            </div></div>
            <div className="field"><label>Business name *</label><input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required placeholder="e.g. Chidi Provisions" /></div>
            <div className="field"><div className="row2">
              <div><label>Business type</label><input value={form.businessType} onChange={(e) => set("businessType", e.target.value)} placeholder="Provision store" /></div>
              <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Asaba" /></div>
            </div></div>
            <button className="btn btn-primary btn-block" disabled={status.loading}>
              {status.loading ? "Setting up..." : "Create my business"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
