import { useEffect, useState } from "react";
import { api } from "../lib/api";

function bar(used, limit) {
  if (limit === null || limit === undefined) return null;
  const pct = Math.min(100, Math.round((Number(used) / Math.max(1, limit)) * 100));
  return (
    <div style={{ height: 6, background: "var(--border)", borderRadius: 3, marginTop: 4 }}>
      <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: pct >= 90 ? "#b45309" : "var(--brand)" }} />
    </div>
  );
}

export default function PlanCard() {
  const [plan, setPlan] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get("/api/billing").then(setPlan).catch(() => {});
  }, []);

  async function upgrade(tier) {
    setUpgrading(true);
    setMsg("");
    try {
      const d = await api.post("/api/billing", { tier });
      setMsg(d.message || "Request noted.");
      const fresh = await api.get("/api/billing");
      setPlan(fresh);
    } catch (e) {
      setMsg(e.message);
    }
    setUpgrading(false);
  }

  if (!plan || !plan.ok) return null;
  const u = plan.usage || {};
  const l = plan.limits || {};
  const fmtLimit = (v) => (v === null || v === undefined ? "Unlimited" : v);

  return (
    <div className="card narrow" style={{ margin: "0 0 18px", border: "2px solid var(--brand)" }}>
      <h3 style={{ marginTop: 0 }}>Your plan: {plan.tierName}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {plan.price}
        {plan.status === "pending" && plan.pendingTier && (
          <> · Upgrade to {plan.pendingTier} requested, we will contact you on WhatsApp to complete payment.</>
        )}
      </p>
      {msg && <div className="alert alert-ok">{msg}</div>}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        <li style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Businesses</span><strong>{u.businesses} of {fmtLimit(l.businesses)}</strong>
          </div>
          {bar(u.businesses, l.businesses)}
        </li>
        <li style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Sales this week</span><strong>{u.salesThisWeek} of {fmtLimit(l.salesPerWeek)}</strong>
          </div>
          {bar(u.salesThisWeek, l.salesPerWeek)}
          <small className="hint">Resets every Monday. Recording a sale is never blocked.</small>
        </li>
        <li style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Products and services</span><strong>{u.products} of {fmtLimit(l.products)}</strong>
          </div>
          {bar(u.products, l.products)}
        </li>
        <li>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Staff accounts</span><strong>{u.staff} of {fmtLimit(l.staff)}</strong>
          </div>
          {bar(u.staff, l.staff)}
        </li>
      </ul>
      {plan.tier === "free" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" disabled={upgrading} onClick={() => upgrade("starter")}>
            Upgrade to Starter (NGN 1,000/mo)
          </button>
          <button className="btn btn-secondary btn-sm" disabled={upgrading} onClick={() => upgrade("pro")}>
            Upgrade to Pro (NGN 2,500/mo)
          </button>
        </div>
      )}
      {plan.tier === "starter" && (
        <button className="btn btn-primary btn-sm" disabled={upgrading} onClick={() => upgrade("pro")}>
          Upgrade to Pro (NGN 2,500/mo)
        </button>
      )}
      <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
        KopaBook never takes money inside the app. After you request an upgrade we reach you on
        WhatsApp to arrange payment, then your new limits turn on.
      </p>
    </div>
  );
}
