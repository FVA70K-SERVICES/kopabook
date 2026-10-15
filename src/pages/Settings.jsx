import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";
import PaymentModesEditor from "../components/PaymentModesEditor";

export default function SettingsPage({ session }) {
  const [biz, setBiz] = useState(null);
  const [form, setForm] = useState({ name: "", businessType: "", state: "", city: "", currency: "NGN", brandColor: "#166534", tagline: "", reminderTemplate: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);

  // My profile (own full name)
  const [myName, setMyName] = useState(session.user?.full_name || "");
  const [nameStatus, setNameStatus] = useState({ loading: false, error: "", ok: "" });

  async function saveName(e) {
    e.preventDefault();
    setNameStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.patch("/api/auth/me", { fullName: myName });
      setNameStatus({ loading: false, error: "", ok: d.message || "Profile updated." });
      window.location.reload();
    } catch (err) {
      setNameStatus({ loading: false, error: err.message, ok: "" });
    }
  }

  // Change password
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwStatus, setPwStatus] = useState({ loading: false, error: "", ok: "" });

  const isOwner = session.business?.role === "owner";

  useEffect(() => {
    api.get("/api/business")
      .then((d) => {
        setBiz(d.business);
        setForm({
          name: d.business.name || "", businessType: d.business.business_type || "",
          state: d.business.state || "", city: d.business.city || "", currency: d.business.currency || "NGN",
          brandColor: d.business.brand_color || "#166534", tagline: d.business.tagline || "",
          reminderTemplate: d.business.reminder_template || "",
        });
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setOk(""); }

  async function save(e) {
    e.preventDefault(); setSaving(true); setError(""); setOk("");
    try {
      await api.patch("/api/business", form);
      setOk("Business profile updated.");
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  function setPwField(k, v) { setPw((p) => ({ ...p, [k]: v })); setPwStatus({ loading: false, error: "", ok: "" }); }

  async function changePassword(e) {
    e.preventDefault();
    setPwStatus({ loading: true, error: "", ok: "" });
    try {
      if (pw.next !== pw.confirm) {
        setPwStatus({ loading: false, error: "New passwords do not match.", ok: "" });
        return;
      }
      const d = await api.post("/api/auth/change-password", {
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      setPw({ current: "", next: "", confirm: "" });
      setPwStatus({ loading: false, error: "", ok: d.message || "Password changed." });
    } catch (err) {
      setPwStatus({ loading: false, error: err.message, ok: "" });
    }
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}

      <div className="card narrow" style={{ margin: "0 0 18px" }}>
        <h3 style={{ marginTop: 0 }}>My profile</h3>
        {nameStatus.error && <div className="alert alert-error">{nameStatus.error}</div>}
        {nameStatus.ok && <div className="alert alert-ok">{nameStatus.ok}</div>}
        <form onSubmit={saveName}>
          <div className="field"><label>Full name</label><input value={myName} onChange={(e) => setMyName(e.target.value)} required minLength={2} /></div>
          <div className="field"><label>Email</label><input value={session.user?.email || ""} disabled /></div>
          <button className="btn btn-secondary" disabled={nameStatus.loading}>{nameStatus.loading ? "Saving..." : "Save name"}</button>
        </form>
      </div>

      <div className="card narrow" style={{ margin: 0 }}>
        <h3 style={{ marginTop: 0 }}>Business profile</h3>
        <form onSubmit={save}>
          <div className="field"><label>Business name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!isOwner} /></div>
          <div className="field"><div className="row2">
            <div><label>Business type</label><input value={form.businessType} onChange={(e) => set("businessType", e.target.value)} disabled={!isOwner} /></div>
            <div><label>State</label><select value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!isOwner}>
              <option value="">Select state</option>
              {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          </div></div>
          <div className="field"><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!isOwner} /></div>
          <div className="field"><label>Currency</label>
            <select value={form.currency} onChange={(e) => set("currency", e.target.value)} disabled={!isOwner}>
              <option value="NGN">NGN — Nigerian Naira</option>
              <option value="GHS">GHS — Ghanaian Cedi</option>
              <option value="KES">KES — Kenyan Shilling</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>
          {isOwner
            ? <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
            : <p style={{ color: "var(--muted)" }}>Only the owner can change business settings.</p>}
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Store branding</h3>
        <p className="hint">Your brand color and tagline appear on the share cards you send on WhatsApp.</p>
        <form onSubmit={save}>
          <div className="field"><label>Brand color</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {["#166534", "#1d4ed8", "#7c3aed", "#c2410c", "#be185d", "#0f766e", "#111827"].map((c) => (
                <button key={c} type="button" onClick={() => set("brandColor", c)} disabled={!isOwner}
                  style={{ width: 36, height: 36, borderRadius: "50%", background: c, border: form.brandColor === c ? "3px solid #111" : "2px solid #ddd", cursor: "pointer" }}
                  aria-label={"Brand color " + c} />
              ))}
              <input type="color" value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} disabled={!isOwner}
                style={{ width: 40, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8 }} aria-label="Custom brand color" />
            </div>
          </div>
          <div className="field"><label>Tagline</label><input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} disabled={!isOwner} placeholder="e.g. Quality you can trust" maxLength={80} /></div>
          {isOwner && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save branding"}</button>}
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Payment modes</h3>
        <p className="hint">The ways your customers can pay. Add your own, e.g. OPay, Moniepoint, PalmPay. Disabled modes stop showing in the sale form.</p>
        <PaymentModesEditor canManage={isOwner || session.business?.role === "manager"} />
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Debt reminder template</h3>
        <p className="hint">Use {"{name}"}, {"{amount}"} and {"{business}"} as placeholders. Leave empty to use the default message.</p>
        <form onSubmit={save}>
          <div className="field"><label>Template</label>
            <textarea rows={4} value={form.reminderTemplate} onChange={(e) => set("reminderTemplate", e.target.value)} disabled={!isOwner}
              placeholder="Hello {name}, this is a friendly reminder from {business}. Your outstanding balance is {amount}. Please pay at your earliest convenience. Thank you." />
          </div>
          {isOwner && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save template"}</button>}
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        {pwStatus.error && <div className="alert alert-error">{pwStatus.error}</div>}
        {pwStatus.ok && <div className="alert alert-ok">{pwStatus.ok}</div>}
        <form onSubmit={changePassword}>
          <div className="field"><label>Current password</label><input type="password" value={pw.current} onChange={(e) => setPwField("current", e.target.value)} required /></div>
          <div className="field"><div className="row2">
            <div><label>New password</label><input type="password" value={pw.next} onChange={(e) => setPwField("next", e.target.value)} required minLength={8} /></div>
            <div><label>Confirm new</label><input type="password" value={pw.confirm} onChange={(e) => setPwField("confirm", e.target.value)} required minLength={8} /></div>
          </div></div>
          <button className="btn btn-secondary" disabled={pwStatus.loading}>{pwStatus.loading ? "Changing..." : "Change password"}</button>
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Plan</h3>
        <p style={{ color: "var(--muted)", margin: "0 0 6px" }}>
          Current plan: <strong style={{ textTransform: "capitalize" }}>{biz?.plan_tier || "free"}</strong>
        </p>
        <p style={{ color: "var(--muted)", margin: 0 }}>Paid upgrades for staff workflows and advanced reports are coming soon.</p>
      </div>
    </>
  );
}
