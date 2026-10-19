import { useState } from "react";
import { nav } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";
import { ORG_TYPES, WORLD_CURRENCIES, COUNTRIES } from "../lib/businessTypes";
import Logo from "../components/Logo";
import HumanCheck, { FVA_VERIFY_SITEKEY } from "../components/HumanCheck";

export default function RegisterPage({ preset }) {
  const [orgKey, setOrgKey] = useState(preset || "");
  const [customType, setCustomType] = useState("");
  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos"; }
    catch { return "Africa/Lagos"; }
  })();
  const [form, setForm] = useState({
    fullName: "", email: "", username: "", phone: "", password: "",
    businessName: "", state: "", city: "", country: "Nigeria", currency: "NGN",
    timezone: detectedTz,
  });
  const [status, setStatus] = useState({ loading: false, error: "" });
  const [humanToken, setHumanToken] = useState(null);

  const org = ORG_TYPES.find((t) => t.key === orgKey);
  const nameLabel = orgKey === "hotel" ? "Hotel name *" : "Business name *";
  const namePlaceholder = orgKey === "hotel" ? "e.g. Grand Palace Hotel" : "e.g. Chidi Provisions";

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (FVA_VERIFY_SITEKEY && !humanToken) {
      setStatus({ loading: false, error: "Please tick the 'Verify you are human' box." });
      return;
    }
    setStatus({ loading: true, error: "" });
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...form, businessType: orgKey, customType: orgKey === "other" ? customType.trim() : undefined, fvaverify_token: humanToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || "Registration failed.");
      const pending = localStorage.getItem("kb_pending_invite");
      if (pending) {
        localStorage.removeItem("kb_pending_invite");
        nav("/app/projects/join/" + encodeURIComponent(pending));
      } else {
        nav(orgKey === "hotel" ? "/app/hotels" : "/app/dashboard");
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

        {!orgKey ? (
          <div className="form-card">
            <h1 style={{ marginTop: 0 }}>What are you registering?</h1>
            <p className="hint">Pick your organization type from the list. Your dashboard will carry the tools that fit it.</p>
            <div className="field">
              <label htmlFor="reg-org-type">Organization type *</label>
              <select id="reg-org-type" value={orgKey} onChange={(e) => setOrgKey(e.target.value)} autoFocus>
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
              <div className="field"><label htmlFor="reg-business-name">{nameLabel}</label><input id="reg-business-name" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required placeholder={namePlaceholder} /></div>
              {orgKey === "other" && (
                <div className="field"><label htmlFor="reg-custom-type">What kind of business is it?</label><input id="reg-custom-type" value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. Logistics company, Laundry, Farm..." /></div>
              )}
              <div className="field"><div className="row2">
                <div><label htmlFor="reg-full-name">Your full name *</label><input id="reg-full-name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required placeholder="Your name" /></div>
                <div><label htmlFor="reg-phone">Phone</label><input id="reg-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label htmlFor="reg-email">Email *</label><input id="reg-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></div>
                <div><label htmlFor="reg-password">Password *</label><input id="reg-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} placeholder="8+ characters" /></div>
              </div></div>
              <div className="field"><label htmlFor="reg-username">Username (optional)</label><input id="reg-username" value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="e.g. chidi_trades" />
              <p className="hint" style={{ marginTop: 4 }}>Pick one if you want. You can sign in with your email or this username. Letters, numbers and underscore, 3 to 20 characters.</p></div>
              <div className="field"><div className="row2">
                <div><label htmlFor="reg-country">Country</label><select id="reg-country" value={form.country} onChange={(e) => set("country", e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
                <div><label htmlFor="reg-currency">Currency</label><select id="reg-currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                  {WORLD_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                </select></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label htmlFor="reg-state">{form.country === "Nigeria" ? "State" : "State / region"}</label>
                {form.country === "Nigeria" ? (
                  <select id="reg-state" value={form.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">Select...</option>
                    {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input id="reg-state" value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="State or region" />
                )}</div>
                <div><label htmlFor="reg-city">City</label><input id="reg-city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder={form.country === "Nigeria" ? "e.g. Asaba" : "e.g. Accra"} /></div>
              </div></div>
              <HumanCheck onToken={setHumanToken} />
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
