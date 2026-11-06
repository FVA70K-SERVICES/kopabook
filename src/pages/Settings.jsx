import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import { LANGUAGES } from "../lib/i18n";
import { NIGERIAN_STATES } from "../lib/nigeria";
import { WORLD_CURRENCIES, WORLD_TIMEZONES, COUNTRIES, ORG_TYPES } from "../lib/businessTypes";
import PaymentModesEditor from "../components/PaymentModesEditor";
import DeveloperApi from "../components/DeveloperApi";
import PlanCard from "../components/PlanCard";
import ChatbotControl from "../components/ChatbotControl";
import AppLockSettings from "../components/AppLockSettings";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function SettingsPage({ session }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  async function closeBusiness() {
    setClosing(true);
    try {
      const d = await api.post("/api/businesses/close", { businessId: session.business?.id });
      window.location.href = "/app/dashboard";
    } catch (e) { setError(e.message); setConfirmClose(false); }
    setClosing(false);
  }
  const [form, setForm] = useState({ name: "", businessType: "", state: "", city: "", currency: "NGN", brandColor: "#166534", tagline: "", reminderTemplate: "", receiptPhone: "", receiptAddress: "", receiptFooter: "", receiptPaperWidth: "80mm" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);

  // My profile (own full name + phone)
  const [myName, setMyName] = useState(session.user?.fullName || "");
  const [myPhone, setMyPhone] = useState(session.user?.phone || "");
  const [nameStatus, setNameStatus] = useState({ loading: false, error: "", ok: "" });

  const initials = myName.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  async function saveProfile(e) {
    e.preventDefault();
    setNameStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.patch("/api/auth/me", { fullName: myName, phone: myPhone });
      setNameStatus({ loading: false, error: "", ok: d.message || "Profile updated." });
      // Refresh the sidebar name without a full page reload.
      window.dispatchEvent(new CustomEvent("kopabook:profile-updated", { detail: { fullName: myName } }));
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
        setForm({
          name: d.business?.name || "", businessType: d.business?.business_type || "",
          customType: d.business?.custom_type || "",
          state: d.business?.state || "", city: d.business?.city || "", country: d.business?.country || "Nigeria",
          timezone: d.business?.timezone || "Africa/Lagos", currency: d.business?.currency || "NGN",
          brandColor: d.business?.brand_color || "#166534", tagline: d.business?.tagline || "",
          reminderTemplate: d.business?.reminder_template || "",
          receiptPhone: d.business?.receipt_phone || "", receiptAddress: d.business?.receipt_address || "",
          receiptFooter: d.business?.receipt_footer || "", receiptPaperWidth: d.business?.receipt_paper_width || "80mm",
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
        <form onSubmit={saveProfile}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "#166534", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 700, flexShrink: 0,
            }}>{initials}</div>
            <div>
              <div style={{ fontWeight: 600 }}>{myName || "Your name"}</div>
              <div className="hint" style={{ margin: 0 }}>{session.user?.email || ""}</div>
            </div>
          </div>
          <div className="field"><label>Full name</label><input value={myName} aria-label="Full name" onChange={(e) => { setMyName(e.target.value); setNameStatus((s) => ({ ...s, ok: "", error: "" })); }} required minLength={2} /></div>
          <div className="field"><label>Phone (for WhatsApp messages)</label><input value={myPhone} aria-label="Phone (for WhatsApp messages)" onChange={(e) => { setMyPhone(e.target.value); setNameStatus((s) => ({ ...s, ok: "", error: "" })); }} placeholder="080..." inputMode="tel" /></div>
          <div className="field"><label>Email</label><input value={session.user?.email || ""} aria-label="Email" disabled /></div>
          <button className="btn btn-secondary" disabled={nameStatus.loading}>{nameStatus.loading ? "Saving..." : "Save profile"}</button>
        </form>
      </div>

      {/* WORLD-BEST: Language settings — start */}
      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Language</h3>
        <LanguageSwitcher />
        <p className="hint" style={{ margin: "4px 0 0" }}>Your language is personal. Receipts use the business receipt language.</p>
      </div>
      {/* WORLD-BEST: Language settings — end */}

      <div className="card narrow" style={{ margin: 0 }}>
        <h3 style={{ marginTop: 0 }}>Business profile</h3>
        <form onSubmit={save}>
          <div className="field"><label>Business name</label><input value={form.name} aria-label="Business name" onChange={(e) => set("name", e.target.value)} disabled={!isOwner} /></div>
          <div className="field"><div className="row2">
            <div><label>Business type</label>
              <select value={form.businessType} onChange={(e) => set("businessType", e.target.value)} disabled={!isOwner}>
                {ORG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
              </select>
              <p className="hint" style={{ margin: "4px 0 0" }}>Controls which sections appear in your menu.</p>
            </div>
            {form.businessType === "other" && (
              <div><label>Custom type</label><input value={form.customType} aria-label="Custom type" onChange={(e) => set("customType", e.target.value)} disabled={!isOwner} placeholder="e.g. Logistics company" /></div>
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
              <input value={form.state} aria-label="State" onChange={(e) => set("state", e.target.value)} disabled={!isOwner} placeholder="State or region" />
            )}</div>
            <div><label>City</label><input value={form.city} aria-label="City" onChange={(e) => set("city", e.target.value)} disabled={!isOwner} /></div>
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
        <h3 style={{ marginTop: 0 }}>Add KopaBook to your home screen</h3>
        <InstallCard />
      </div>

      {isOwner && (
        <div className="card narrow" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>Chatbot controls</h3>
          <p className="hint">Switch the website chatbot on or off, watch live chats, clear old messages, and set automatic cleanup.</p>
          <ChatbotControl />
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <PlanCard />
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
              <input type="color" value={form.brandColor} aria-label="Brand color" onChange={(e) => set("brandColor", e.target.value)} disabled={!isOwner}
                style={{ width: 40, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8 }} aria-label="Custom brand color" />
            </div>
          </div>
          <div className="field"><label>Tagline</label><input value={form.tagline} aria-label="Tagline" onChange={(e) => set("tagline", e.target.value)} disabled={!isOwner} placeholder="e.g. Quality you can trust" maxLength={80} /></div>
          {isOwner && <button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save branding"}</button>}
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>🧾 Receipts & printing</h3>
        <p className="hint">These details print on every sales and hotel receipt. Set your paper size to match your thermal printer.</p>
        <form onSubmit={save}>
          <div className="field"><div className="row2">
            <div><label>Receipt phone</label><input value={form.receiptPhone} aria-label="Receipt phone" onChange={(e) => set("receiptPhone", e.target.value)} disabled={!isOwner} placeholder="080..." /></div>
            <div><label>Receipt address</label><input value={form.receiptAddress} aria-label="Receipt address" onChange={(e) => set("receiptAddress", e.target.value)} disabled={!isOwner} placeholder="Shop address" /></div>
          </div></div>
          <div className="field"><label>Receipt footer message</label><input value={form.receiptFooter} aria-label="Receipt footer" onChange={(e) => set("receiptFooter", e.target.value)} disabled={!isOwner} placeholder="e.g. Goods sold in good condition are not returnable. Thank you!" maxLength={120} /></div>
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

      {/* WORLD-BEST: Rules settings — start */}
      <RulesSettingsSection isOwner={isOwner} />
      {/* WORLD-BEST: Rules settings — end */}

      {/* WORLD-BEST: Receipt settings — start (merge: the Receipt stream read
          these settings but had no UI to set them; this section is the owner
          control for them. Migration 0061 columns.) */}
      <ReceiptSettingsSection isOwner={isOwner} />
      {/* WORLD-BEST: Receipt settings — end */}

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

      {isOwner && (
        <div className="card narrow desktop-only" style={{ marginTop: 18 }}>
          <DeveloperApi />
        </div>
      )}

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>App lock</h3>
        <AppLockSettings />
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        {pwStatus.error && <div className="alert alert-error">{pwStatus.error}</div>}
        {pwStatus.ok && <div className="alert alert-ok">{pwStatus.ok}</div>}
        <form onSubmit={changePassword}>
          <div className="field"><label>Current password</label><input type="password" value={pw.current} aria-label="Current password" onChange={(e) => setPwField("current", e.target.value)} required /></div>
          <div className="field"><div className="row2">
            <div><label>New password</label><input type="password" value={pw.next} aria-label="New password" onChange={(e) => setPwField("next", e.target.value)} required minLength={8} /></div>
            <div><label>Confirm new</label><input type="password" value={pw.confirm} aria-label="Confirm new password" onChange={(e) => setPwField("confirm", e.target.value)} required minLength={8} /></div>
          </div></div>
          <button className="btn btn-secondary" disabled={pwStatus.loading}>{pwStatus.loading ? "Changing..." : "Change password"}</button>
        </form>
      </div>

      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Backups</h3>
        <p className="hint">Save a full copy of your business data (products, customers, sales, debts and more) to your R2 bucket. Download any backup to keep it safe.</p>
        <BackupCard />
      </div>

      {/* WORLD-BEST: Backup & export — start */}
      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Backup &amp; export</h3>
        <BackupExportCard />
      </div>
      {/* WORLD-BEST: Backup & export — end */}

      {/* WORLD-BEST: Accessibility — start */}
      <div className="card narrow" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Accessibility</h3>
        <AccessibilityCard />
      </div>
      {/* WORLD-BEST: Accessibility — end */}

      {session.business?.role === "owner" && (
        <div className="card narrow" style={{ marginTop: 18, borderColor: "var(--danger, #b91c1c)" }}>
          <h3 style={{ marginTop: 0 }}>Danger zone</h3>
          <p className="hint">Close this business. Its records are kept and it can be reopened from the business switcher, but staff lose access until then.</p>
          {!confirmClose ? (
            <button className="btn btn-secondary" style={{ color: "var(--danger, #b91c1c)" }} onClick={() => setConfirmClose(true)}>
              Close business
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={() => setConfirmClose(false)}>Keep it open</button>
              <button className="btn btn-primary" style={{ background: "var(--danger, #b91c1c)" }} disabled={closing} onClick={closeBusiness}>
                {closing ? "Closing..." : "Yes, close it"}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* WORLD-BEST: Rules settings — start */
/* Business rules (proposal section 12): low-stock default threshold,
   overdue days, and the kind of each payment mode. Owner/partner only.
   Self-contained: it fetches and saves its own values, so no other part
   of this file changes. A mode with kind "credit" is buy-now-pay-later:
   its tender is still owed, not money in. If "Credit" means card payment
   for this business, rename the mode instead of changing its kind. */
function RulesSettingsSection({ isOwner }) {
  const [lowStockDefault, setLowStockDefault] = useState("5");
  const [overdueDays, setOverdueDays] = useState("7");
  const [modes, setModes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kindSaving, setKindSaving] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.get("/api/business")
      .then((d) => {
        setLowStockDefault(String(d.business?.low_stock_default ?? 5));
        setOverdueDays(String(d.business?.overdue_days ?? 7));
      })
      .catch(() => {});
    api.get("/api/payment-modes")
      .then((d) => setModes(d.modes || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveRules(e) {
    e.preventDefault();
    setSaving(true); setError(""); setOk("");
    try {
      await api.patch("/api/business", {
        lowStockDefault: Number(lowStockDefault),
        overdueDays: Number(overdueDays),
      });
      setOk("Rules updated.");
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function setModeKind(mode, kind) {
    setKindSaving(mode.id); setError(""); setOk("");
    try {
      await api.patch("/api/payment-modes", { id: mode.id, kind });
      setModes((ms) => ms.map((m) => (m.id === mode.id ? { ...m, kind } : m)));
      setOk(`"${mode.name}" is now ${kind}.`);
    } catch (err) { setError(err.message); }
    setKindSaving(null);
  }

  return (
    <div className="card narrow" style={{ marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>Rules</h3>
      <p className="hint">Low-stock warning level, when a debt counts as overdue, and what each payment mode means.</p>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}
      {loading ? <p className="hint">Loading rules...</p> : (
        <form onSubmit={saveRules}>
          <div className="field"><div className="row2">
            <div><label>Low-stock threshold (default)</label>
              <input type="number" min="0" max="1000" step="1" value={lowStockDefault} aria-label="Low-stock threshold (default)"
                onChange={(e) => setLowStockDefault(e.target.value)} disabled={!isOwner} />
              <p className="hint" style={{ margin: "4px 0 0" }}>New products warn at or below this stock. Per-product levels stay as set.</p>
            </div>
            <div><label>Overdue after (days)</label>
              <input type="number" min="1" max="365" step="1" value={overdueDays} aria-label="Overdue after (days)"
                onChange={(e) => setOverdueDays(e.target.value)} disabled={!isOwner} />
              <p className="hint" style={{ margin: "4px 0 0" }}>Debts older than this show “Overdue”. Reminders still go out by hand only.</p>
            </div>
          </div></div>
          {isOwner
            ? <button className="btn btn-primary" style={{ minHeight: 44 }} disabled={saving}>{saving ? "Saving..." : "Save rules"}</button>
            : <p style={{ color: "var(--muted)" }}>Only the owner or a partner can change business rules.</p>}
        </form>
      )}
      <div style={{ marginTop: 16 }}>
        <strong>Payment mode kinds</strong>
        <p className="hint" style={{ margin: "4px 0 8px" }}>
          Credit means buy-now-pay-later: money tendered that way is still owed, not money in.
          Cash, transfer and card count as money in.
        </p>
        {modes.length === 0 ? <p className="hint">No payment modes yet.</p> : modes.map((mode) => (
          <div key={mode.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span>{mode.name}</span>
            <select
              value={mode.kind || "cash"}
              onChange={(e) => setModeKind(mode, e.target.value)}
              disabled={!isOwner || kindSaving === mode.id}
              aria-label={`Kind for ${mode.name}`}
              style={{ minHeight: 44 }}
            >
              <option value="cash">Cash</option>
              <option value="transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="credit">Credit (buy now, pay later)</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
/* WORLD-BEST: Rules settings — end */

/* WORLD-BEST: Receipt settings — start */
/* What shows on a receipt and in which language: the business email and
   Telegram handle printed on receipts, which contact lines appear, and the
   language receipts print in. Owner/partner only. Self-contained: it
   fetches and saves its own values, so no other part of this file changes.
   The receipt phone, address and footer stay in the Business profile form
   above; this section only adds the fields that form never had. */
function ReceiptSettingsSection({ isOwner }) {
  const [receiptEmail, setReceiptEmail] = useState("");
  const [receiptTelegram, setReceiptTelegram] = useState("");
  const [showPhone, setShowPhone] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showTelegram, setShowTelegram] = useState(true);
  const [receiptLanguage, setReceiptLanguage] = useState("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.get("/api/business")
      .then((d) => {
        const b = d.business || {};
        setReceiptEmail(b.receipt_email || "");
        setReceiptTelegram(b.receipt_telegram || "");
        setShowPhone(b.receipt_show_phone === undefined || b.receipt_show_phone === null ? true : Number(b.receipt_show_phone) === 1);
        setShowEmail(b.receipt_show_email === undefined || b.receipt_show_email === null ? true : Number(b.receipt_show_email) === 1);
        setShowTelegram(b.receipt_show_telegram === undefined || b.receipt_show_telegram === null ? true : Number(b.receipt_show_telegram) === 1);
        setReceiptLanguage(b.receipt_language || "en");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveReceipt(e) {
    e.preventDefault();
    setSaving(true); setError(""); setOk("");
    try {
      await api.patch("/api/business", {
        receiptEmail: receiptEmail.trim(),
        receiptTelegram: receiptTelegram.trim(),
        receiptShowPhone: showPhone ? 1 : 0,
        receiptShowEmail: showEmail ? 1 : 0,
        receiptShowTelegram: showTelegram ? 1 : 0,
        receiptLanguage,
      });
      setOk("Receipt settings updated.");
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  return (
    <div className="card narrow" style={{ marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>Receipt</h3>
      <p className="hint">What shows on every receipt and in which language. The phone, address and footer are set in the Business profile above.</p>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}
      {loading ? <p className="hint">Loading receipt settings...</p> : (
        <form onSubmit={saveReceipt}>
          <div className="field"><label>Receipt email (optional)</label>
            <input type="email" value={receiptEmail} aria-label="Receipt email (optional)" onChange={(e) => setReceiptEmail(e.target.value)} disabled={!isOwner} placeholder="receipts@example.com" inputMode="email" />
          </div>
          <div className="field"><label>Receipt Telegram (optional)</label>
            <input value={receiptTelegram} aria-label="Receipt Telegram (optional)" onChange={(e) => setReceiptTelegram(e.target.value)} disabled={!isOwner} placeholder="@business" />
          </div>
          <div className="field">
            <span style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Show on receipts</span>
            <label style={{ display: "block", fontWeight: 400, marginBottom: 4 }}><input type="checkbox" checked={showPhone} aria-label="Show phone on receipts" onChange={(e) => setShowPhone(e.target.checked)} disabled={!isOwner} /> Phone</label>
            <label style={{ display: "block", fontWeight: 400, marginBottom: 4 }}><input type="checkbox" checked={showEmail} aria-label="Show email on receipts" onChange={(e) => setShowEmail(e.target.checked)} disabled={!isOwner} /> Email</label>
            <label style={{ display: "block", fontWeight: 400 }}><input type="checkbox" checked={showTelegram} aria-label="Show Telegram on receipts" onChange={(e) => setShowTelegram(e.target.checked)} disabled={!isOwner} /> Telegram</label>
          </div>
          <div className="field"><label>Receipt language</label>
            <select value={receiptLanguage} onChange={(e) => setReceiptLanguage(e.target.value)} disabled={!isOwner} aria-label="Receipt language">
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native} ({l.name})</option>)}
            </select>
            <p className="hint" style={{ margin: "4px 0 0" }}>Receipts print in this language. Your own app language is set above, under Language.</p>
          </div>
          {isOwner
            ? <button className="btn btn-primary" style={{ minHeight: 44 }} disabled={saving}>{saving ? "Saving..." : "Save receipt settings"}</button>
            : <p style={{ color: "var(--muted)" }}>Only the owner or a partner can change receipt settings.</p>}
        </form>
      )}
    </div>
  );
}
/* WORLD-BEST: Receipt settings — end */

function InstallCard() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    function onBip(e) { e.preventDefault(); setDeferredPrompt(e); }
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    setDeferredPrompt(null);
  }

  const steps = { margin: "8px 0", paddingLeft: 20, color: "var(--muted)", fontSize: 14 };

  return (
    <div>
      <p className="hint">Put KopaBook on your phone like a normal app, so it opens in one tap.</p>
      {deferredPrompt && (
        <button className="btn btn-primary btn-sm" onClick={install} style={{ marginBottom: 12 }}>
          Install KopaBook
        </button>
      )}
      <strong>iPhone (in Safari)</strong>
      <ol style={steps}>
        <li>Open kopabook.com in Safari.</li>
        <li>Tap the Share button (the square with the arrow pointing up).</li>
        <li>Tap Add to Home Screen, then tap Add.</li>
      </ol>
      <strong style={{ display: "block", marginTop: 12 }}>Android (in Chrome)</strong>
      <ol style={steps}>
        <li>Open kopabook.com in Chrome.</li>
        <li>Tap the three dots at the top right.</li>
        <li>Tap Add to Home screen, then tap Add.</li>
      </ol>
    </div>
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

{/* WORLD-BEST: Backup & export — start */}
const EXPORT_TYPES = [
  ["businesses", "Business profile"],
  ["products", "Products"],
  ["services", "Services"],
  ["customers", "Customers"],
  ["suppliers", "Suppliers"],
  ["sales", "Sales"],
  ["sale_items", "Sale items"],
  ["payment_records", "Payment records"],
  ["expenses", "Expenses"],
  ["expense_categories", "Expense categories"],
  ["inventory_items", "Stock levels"],
  ["inventory_movements", "Stock movements"],
  ["stock_adjustments", "Stock adjustments"],
  ["supplier_purchases", "Supplier purchases"],
  ["payment_modes", "Payment modes"],
  ["phone_contacts", "Phone contacts"],
  ["reminder_logs", "Reminders"],
  ["customer_ledger", "Customer ledger"],
  ["daily_summaries", "Daily summaries"],
  ["staff_shifts", "Staff shifts"],
  ["hotel_rooms", "Hotel rooms"],
  ["hotel_bookings", "Hotel bookings"],
  ["hotel_charges", "Hotel charges"],
  ["hotel_payments", "Hotel payments"],
  ["notes", "Notes"],
  ["business_members", "Team memberships"],
  ["users", "Team members"],
  ["receipt_sends", "Receipt sends"],
  ["audit_logs", "Activity log"],
];

function BackupExportCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function downloadFull() {
    setBusy(true);
    try {
      const d = await api.post("/api/backup", {});
      setOk(`Full backup saved (${(d.bytes / 1024).toFixed(0)} KB, ${d.tables} record types).`);
      setError("");
      const a = document.createElement("a");
      a.href = `/api/backup?download=${encodeURIComponent(d.key)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { setError(e.message); setOk(""); }
    setBusy(false);
  }

  return (
    <div>
      <p className="hint">One file with every record for this business. Keep it somewhere safe. Each type below also downloads on its own as a spreadsheet (CSV).</p>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}
      <button className="btn btn-primary btn-sm" onClick={downloadFull} disabled={busy}>
        {busy ? "Preparing..." : "Download full backup (JSON)"}
      </button>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {EXPORT_TYPES.map(([table, label]) => (
          <a key={table} className="btn btn-secondary btn-sm" href={`/api/backup?csv=${table}`}>{label} (CSV)</a>
        ))}
      </div>
    </div>
  );
}
{/* WORLD-BEST: Backup & export — end */}

{/* WORLD-BEST: Accessibility — start */}
function AccessibilityCard() {
  const [textSize, setTextSize] = useState(() => {
    try { return localStorage.getItem("kopabook-text-size") === "large" ? "large" : "normal"; } catch { return "normal"; }
  });

  function apply(size) {
    setTextSize(size);
    try {
      localStorage.setItem("kopabook-text-size", size);
      if (size === "large") document.documentElement.dataset.text = "large";
      else delete document.documentElement.dataset.text;
    } catch { /* choice stays for this visit only */ }
  }

  return (
    <div>
      <p className="hint">Large text makes words bigger without breaking the layout. Your choice is saved on this device.</p>
      <div className="field">
        <span id="text-size-label" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Text size</span>
        <div role="group" aria-labelledby="text-size-label" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={"btn btn-sm " + (textSize === "normal" ? "btn-primary" : "btn-secondary")} onClick={() => apply("normal")} aria-pressed={textSize === "normal"}>Normal text</button>
          <button type="button" className={"btn btn-sm " + (textSize === "large" ? "btn-primary" : "btn-secondary")} onClick={() => apply("large")} aria-pressed={textSize === "large"}>Large text</button>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>Every button and field also shows a clear outline when you tab to it, and no status relies on colour alone: every status carries its word, for example Low stock or Paid.</p>
    </div>
  );
}
{/* WORLD-BEST: Accessibility — end */}
