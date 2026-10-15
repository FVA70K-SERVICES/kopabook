import { useState } from "react";
import { nav } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";
import { ORG_TYPES } from "../lib/businessTypes";

export default function RegisterPage({ preset }) {
  const [orgKey, setOrgKey] = useState(preset || "");
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", password: "",
    businessName: "", state: "", city: "",
  });
  const [status, setStatus] = useState({ loading: false, error: "" });

  const org = ORG_TYPES.find((t) => t.key === orgKey);
  const nameLabel = orgKey === "hotel" ? "Hotel name *" : "Business name *";
  const namePlaceholder = orgKey === "hotel" ? "e.g. Grand Palace Hotel" : "e.g. Chidi Provisions";

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...form, businessType: orgKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || "Registration failed.");
      nav(orgKey === "hotel" ? "/app/hotels" : "/app/dashboard");
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

        {!orgKey ? (
          <>
            <h1 style={{ textAlign: "center", marginTop: 24 }}>What are you registering?</h1>
            <p className="hint" style={{ textAlign: "center" }}>Pick your organization type. Your dashboard will carry the tools that fit it.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginTop: 24, maxWidth: 900, marginLeft: "auto", marginRight: "auto" }}>
              {ORG_TYPES.map((t) => (
                <button key={t.key} onClick={() => setOrgKey(t.key)} className="card"
                  style={{ margin: 0, textAlign: "left", cursor: "pointer", background: "var(--surface)" }}>
                  <div style={{ fontSize: 28 }}>{t.icon}</div>
                  <div style={{ fontWeight: 700, marginTop: 8 }}>{t.label}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>{t.tagline}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="form-card">
            <button className="btn btn-secondary btn-sm" onClick={() => { setOrgKey(""); setStatus({ loading: false, error: "" }); }} style={{ marginBottom: 12 }}>
              ← Change organization type
            </button>
            <h1 style={{ marginTop: 0 }}>{org.icon} Register your {org.label.toLowerCase()}</h1>
            <p className="hint">Free to start. Your {org.label.toLowerCase()} gets its own private dashboard with {org.tagline.toLowerCase()}</p>
            {status.error && <div className="alert alert-error">{status.error}</div>}
            <form onSubmit={submit}>
              <div className="field"><label>{nameLabel}</label><input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required placeholder={namePlaceholder} /></div>
              <div className="field"><div className="row2">
                <div><label>Your full name *</label><input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Your name" /></div>
                <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Email *</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></div>
                <div><label>Password *</label><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} placeholder="8+ characters" /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>State</label><select value={form.state} onChange={(e) => set("state", e.target.value)}>
                  <option value="">Select...</option>
                  {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
                <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Asaba" /></div>
              </div></div>
              <button className="btn btn-primary btn-block" disabled={status.loading}>
                {status.loading ? "Creating your account..." : "Create my account"}
              </button>
            </form>
            <p className="hint" style={{ textAlign: "center", marginTop: 12 }}>
              Already registered? <a href="/login">Sign in</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
