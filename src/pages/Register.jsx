import { useState } from "react";
import { nav } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";
import { ORG_TYPES, WORLD_CURRENCIES, COUNTRIES } from "../lib/businessTypes";

export default function RegisterPage({ preset }) {
  const [orgKey, setOrgKey] = useState(preset || "");
  const [customType, setCustomType] = useState("");
  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos"; }
    catch { return "Africa/Lagos"; }
  })();
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", password: "",
    businessName: "", state: "", city: "", country: "Nigeria", currency: "NGN",
    timezone: detectedTz,
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
        body: JSON.stringify({ ...form, businessType: orgKey, customType: orgKey === "other" ? customType.trim() : undefined }),
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
          <div className="form-card">
            <h1 style={{ marginTop: 0 }}>What are you registering?</h1>
            <p className="hint">Pick your organization type from the list. Your dashboard will carry the tools that fit it.</p>
            <div className="field">
              <label>Organization type *</label>
              <select value={orgKey} onChange={(e) => setOrgKey(e.target.value)} autoFocus>
                <option value="">Select your business type...</option>
                {ORG_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <p className="hint" style={{ textAlign: "center", marginTop: 12 }}>
              Already registered? <a href="/login">Sign in</a>
            </p>
          </div>
        ) : (
          <div className="form-card">
            <button className="btn btn-secondary btn-sm" onClick={() => { setOrgKey(""); setStatus({ loading: false, error: "" }); }} style={{ marginBottom: 12 }}>
              ← Change organization type
            </button>
            <h1 style={{ marginTop: 0 }}>{org.icon} Register your {orgKey === "other" ? "business" : org.label.toLowerCase()}</h1>
            <p className="hint">Free to start. Your {orgKey === "other" ? "business" : org.label.toLowerCase()} gets its own private dashboard with {org.tagline.toLowerCase()}</p>
            {status.error && <div className="alert alert-error">{status.error}</div>}
            <form onSubmit={submit}>
              <div className="field"><label>{nameLabel}</label><input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required placeholder={namePlaceholder} /></div>
              {orgKey === "other" && (
                <div className="field"><label>What kind of business is it?</label><input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. Logistics company, Laundry, Farm..." /></div>
              )}
              <div className="field"><div className="row2">
                <div><label>Your full name *</label><input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Your name" /></div>
                <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Email *</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></div>
                <div><label>Password *</label><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} placeholder="8+ characters" /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Country</label><select value={form.country} onChange={(e) => set("country", e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
                <div><label>Currency</label><select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                  {WORLD_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                </select></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>{form.country === "Nigeria" ? "State" : "State / region"}</label>
                {form.country === "Nigeria" ? (
                  <select value={form.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">Select...</option>
                    {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="State or region" />
                )}</div>
                <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder={form.country === "Nigeria" ? "e.g. Asaba" : "e.g. Accra"} /></div>
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
