import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ORG_TYPES, WORLD_CURRENCIES, COUNTRIES, WORLD_TIMEZONES } from "../lib/businessTypes";

// Business switcher: one account, many companies. Shows the active business,
// lets the owner jump between theirs and register a new one.
export default function BusinessSwitcher({ session, collapsed }) {
  const [businesses, setBusinesses] = useState([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [orgKey, setOrgKey] = useState("other");
  const [customType, setCustomType] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [currency, setCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos"; }
    catch { return "Africa/Lagos"; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/businesses").then((d) => setBusinesses(d.businesses || [])).catch(() => {});
  }, []);

  async function switchTo(id) {
    if (id === session.business?.id) { setOpen(false); return; }
    try {
      await api.post("/api/businesses/switch", { businessId: id });
      window.location.href = "/app/dashboard";
    } catch (e) { setError(e.message); }
  }

  async function reopen(id) {
    try {
      await api.post("/api/businesses/reopen", { businessId: id });
      window.location.href = "/app/dashboard";
    } catch (e) { setError(e.message); }
  }

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      await api.post("/api/businesses", {
        name: name.trim(), businessType: orgKey,
        customType: orgKey === "other" ? customType.trim() : undefined,
        country, currency, timezone,
      });
      window.location.href = "/app/dashboard";
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  if (collapsed) {
    return (
      <div className="biz" title={session.business?.name || "Your business"}>
        {(session.business?.name || "B").slice(0, 1)}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="biz"
        onClick={() => setOpen((o) => !o)}
        title="Switch business"
        style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
      >
        {session.business?.name || "Your business"} <span style={{ color: "#7d9484" }}>▾</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 41, margin: "4px 0", padding: 8, maxHeight: 320, overflowY: "auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#7d9484", padding: "4px 8px" }}>
              My businesses
            </div>
            {businesses.filter((b) => b.status !== "closed").map((b) => (
              <button
                key={b.id}
                onClick={() => switchTo(b.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px", borderRadius: 8,
                  border: 0, cursor: "pointer", background: b.id === session.business?.id ? "var(--brand-soft)" : "transparent",
                  fontWeight: b.id === session.business?.id ? 700 : 400, color: "var(--text)",
                }}
              >
                {b.name}
                <span style={{ display: "block", fontSize: 12, color: "#7d9484", fontWeight: 400 }}>
                  {b.role}{b.member_count > 1 ? ` · ${b.member_count} members` : ""}
                </span>
              </button>
            ))}
            {businesses.some((b) => b.status === "closed") && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#7d9484", padding: "8px 8px 4px" }}>
                  Closed
                </div>
                {businesses.filter((b) => b.status === "closed").map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderRadius: 8, opacity: 0.7 }}>
                    <span style={{ fontSize: 14 }}>{b.name} <span className="pill pill-gray">closed</span></span>
                    {b.role === "owner" && (
                      <button className="btn btn-secondary btn-sm" onClick={() => reopen(b.id)}>Reopen</button>
                    )}
                  </div>
                ))}
              </>
            )}
            <button
              onClick={() => { setOpen(false); setShowNew(true); setError(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px", borderRadius: 8, border: 0, cursor: "pointer", background: "transparent", color: "var(--brand-dark)", fontWeight: 700 }}
            >
              ＋ New business
            </button>
            {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
          </div>
        </>
      )}

      {showNew && (
        <div className="modal-back" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New business</h2>
            <p className="hint">It gets its own dashboard, stock, staff and records. You stay in control with this same account.</p>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={create}>
              <div className="field"><label>Business name *</label><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. FVA70K Stores" autoFocus /></div>
              <div className="field"><label>Organization type</label>
                <select value={orgKey} onChange={(e) => setOrgKey(e.target.value)}>
                  {ORG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              {orgKey === "other" && (
                <div className="field"><label>Describe it (optional)</label><input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. Logistics company" /></div>
              )}
              <div className="field"><div className="row2">
                <div><label>Country</label><select value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
                <div><label>Currency</label><select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {WORLD_CURRENCIES.map(([code, cname]) => <option key={code} value={code}>{code} — {cname}</option>)}
                </select></div>
              </div></div>
              <div className="field"><label>Timezone</label><select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {WORLD_TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Creating..." : "Create business"}</button>
              <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setShowNew(false)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
