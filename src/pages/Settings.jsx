import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";
import { WORLD_CURRENCIES, WORLD_TIMEZONES, COUNTRIES } from "../lib/businessTypes";
import PaymentModesEditor from "../components/PaymentModesEditor";

export default function SettingsPage({ session }) {
  const [biz, setBiz] = useState(null);
  const [form, setForm] = useState({ name: "", businessType: "", state: "", city: "", currency: "NGN", brandColor: "#166534", tagline: "", reminderTemplate: "", receiptPhone: "", receiptAddress: "", receiptFooter: "", receiptPaperWidth: "80mm" });
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

  const isOwner = ["owner", "partner"].includes(session.business?.role);

  useEffect(() => {
    api.get("/api/business")
      .then((d) => {
        setBiz(d.business);
        setForm({
          name: d.business.name || "", businessType: d.business.business_type || "",
          customType: d.business.custom_type || "",
          state: d.business.state || "", city: d.business.city || "", country: d.business.country || "Nigeria",
          timezone: d.business.timezone || "Africa/Lagos", currency: d.business.currency || "NGN",
          brandColor: d.business.brand_color || "#166534", tagline: d.business.tagline || "",
          reminderTemplate: d.business.reminder_template || "",
          receiptPhone: d.business.receipt_phone || "", receiptAddress: d.business.receipt_address || "",
          receiptFooter: d.business.receipt_footer || "", receiptPaperWidth: d.business.receipt_paper_width || "80mm",
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
            {form.businessType === "other" && (
              <div><label>Custom type</label><input value={form.customType} onChange={(e) => set("customType", e.target.value)} disabled={!isOwner} placeholder="e.g. Logistics company" /></div>
            )}
            <div><label>Country</label><select value={form.country} onChange={(e) => set("country", e.target.value)} disabled={!isOwner}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          </div></div>
          <div className="field"><div className="row2">
            <div><label>{form.country === "Nigeria" ? "State" : "State / region"}</label>
            {form.country === "Nigeria" ? (
              <select value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!isOwner}>
                <option value="">Select state</option>
                {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input value={form.state} onChange={(e) => set("state", e.target.value)} disabled={!isOwner} placeholder="State or region" />
            )}</div>
            <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!isOwner} /></div>
          </div></div>
          <div className="field"><div className="row2">
          <div><label>Currency</label>
            <select value={form.currency} onChange={(e) => set("currency", e.target.value)} disabled={!isOwner}>
              {WORLD_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
            </select>
          </div>
          <div><label>Timezone</label>
            <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={!isOwner}>
              {WORLD_TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </div>
          </div></div>
          {isOwner
            ? <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
            : <p style={{ color: "var(--muted)" }}>Only the owner or a partner can change business settings.</p>}
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
        <h3 style={{ marginTop: 0 }}>🧾 Receipts & printing</h3>
        <p className="hint">These details print on every sales and hotel receipt. Set your paper size to match your thermal printer.</p>
        <form onSubmit={save}>
          <div className="field"><div className="row2">
            <div><label>Receipt phone</label><input value={form.receiptPhone} onChange={(e) => set("receiptPhone", e.target.value)} disabled={!isOwner} placeholder="080..." /></div>
            <div><label>Receipt address</label><input value={form.receiptAddress} onChange={(e) => set("receiptAddress", e.target.value)} disabled={!isOwner} placeholder="Shop address" /></div>
          </div></div>
          <div className="field"><label>Receipt footer message</label><input value={form.receiptFooter} onChange={(e) => set("receiptFooter", e.target.value)} disabled={!isOwner} placeholder="e.g. Goods sold in good condition are not returnable. Thank you!" maxLength={120} /></div>
          <div className="field"><label>Paper width</label>
            <select value={form.receiptPaperWidth} onChange={(e) => set("receiptPaperWidth", e.target.value)} disabled={!isOwner}>
              <option value="80mm">80mm (standard thermal)</option>
              <option value="58mm">58mm (small portable)</option>
            </select>
          </div>
          {isOwner && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save receipt settings"}</button>}
        </form>
        <div style={{ marginTop: 16, padding: 12, background: "var(--bg)", borderRadius: 10 }}>
          <strong>Connect your printer</strong>
          <ol style={{ margin: "8px 0", paddingLeft: 20, color: "var(--muted)", fontSize: 14 }}>
            <li>Put your Bluetooth thermal printer in pairing mode.</li>
            <li>On your phone, go to Settings → Bluetooth and pair the printer.</li>
            <li>Open any receipt in KopaBook and tap Print, then choose your printer.</li>
            <li>For WiFi printers, join the same WiFi network, then print the same way.</li>
          </ol>
          <button className="btn btn-secondary btn-sm" onClick={() => window.open("/app/receipt/sale/0", "_blank")}>Print test page</button>
        </div>
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

      {isOwner && (
        <div className="card narrow" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>🕒 Activity & security</h3>
          <p className="hint">See every important action in this business, who did it and when. The log is permanent and cannot be edited.</p>
          <button className="btn btn-secondary" onClick={() => nav("/app/activity")}>View activity log</button>
        </div>
      )}

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
        <h3 style={{ marginTop: 0 }}>Backups</h3>
        <p className="hint">Save a full copy of your business data (products, customers, sales, debts and more) to your R2 bucket. Download any backup to keep it safe.</p>
        <BackupCard />
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

function BackupCard() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await api.get("/api/backup");
      setBackups(d.backups || []);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!window.confirm("Create a backup of all your business data now?")) return;
    setBusy(true);
    try {
      const d = await api.post("/api/backup", {});
      setOk(`Backup saved (${(d.bytes / 1024).toFixed(0)} KB, ${d.tables} tables).`);
      setError("");
      load();
    } catch (e) { setError(e.message); setOk(""); }
    setBusy(false);
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}
      <button className="btn btn-primary btn-sm" onClick={create} disabled={busy}>
        {busy ? "Backing up..." : "Backup now"}
      </button>
      <div style={{ marginTop: 12 }}>
        {loading ? <p className="hint">Loading backups...</p>
          : backups.length === 0 ? <p className="hint">No backups yet.</p>
          : backups.map((b) => (
            <div key={b.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <span><strong>{b.key.split("/").pop()}</strong><br /><small style={{ color: "var(--muted)" }}>{(b.size / 1024).toFixed(0)} KB</small></span>
              <a className="btn btn-secondary btn-sm" href={`/api/backup?download=${encodeURIComponent(b.key)}`}>Download</a>
            </div>
          ))}
      </div>
    </div>
  );
}
