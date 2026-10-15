import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { NIGERIAN_STATES } from "../lib/nigeria";

export default function SettingsPage({ session }) {
  const [biz, setBiz] = useState(null);
  const [form, setForm] = useState({ name: "", businessType: "", state: "", city: "", currency: "NGN" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);

  const isOwner = session.business?.role === "owner";

  useEffect(() => {
    api.get("/api/business")
      .then((d) => {
        setBiz(d.business);
        setForm({
          name: d.business.name || "", businessType: d.business.business_type || "",
          state: d.business.state || "", city: d.business.city || "", currency: d.business.currency || "NGN",
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

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}

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
        <h3 style={{ marginTop: 0 }}>Plan</h3>
        <p style={{ color: "var(--muted)", margin: "0 0 6px" }}>
          Current plan: <strong style={{ textTransform: "capitalize" }}>{biz?.plan_tier || "free"}</strong>
        </p>
        <p style={{ color: "var(--muted)", margin: 0 }}>Paid upgrades for staff workflows and advanced reports are coming soon.</p>
      </div>
    </>
  );
}
