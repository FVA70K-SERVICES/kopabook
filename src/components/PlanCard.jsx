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
  const [prices, setPrices] = useState(null);
  const [cycle, setCycle] = useState("monthly");
  const [paying, setPaying] = useState("");
  const [msg, setMsg] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function load() {
    try { setPlan(await api.get("/api/billing")); } catch (e) {}
  }

  useEffect(() => {
    load();
    api.get("/api/plans").then((d) => setPrices(d.plans || {})).catch(() => {});
    // Returning from Paystack: verify the payment.
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("payment");
    if (ref) {
      setVerifying(true);
      api.get("/api/paystack/verify?reference=" + encodeURIComponent(ref))
        .then((d) => {
          setMsg(d.message || "Payment confirmed.");
          load();
        })
        .catch((e) => setMsg(e.message))
        .finally(() => {
          setVerifying(false);
          window.history.replaceState({}, "", "/app/settings");
        });
    }
  }, []);

  async function checkout(tier) {
    setPaying(tier);
    setMsg("");
    try {
      const d = await api.post("/api/billing/checkout", { tier, cycle });
      window.location.href = d.authorization_url;
    } catch (e) {
      setMsg(e.message);
      setPaying("");
    }
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
        {plan.current_period_end && <> · renews {String(plan.current_period_end).slice(0, 10)}</>}
        {verifying && <> · confirming your payment...</>}
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

      {plan.tier !== "pro" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {(["monthly", "yearly"]).map((c) => (
              <button
                key={c}
                type="button"
                className={"btn btn-sm " + (cycle === c ? "btn-primary" : "btn-secondary")}
                onClick={() => setCycle(c)}
              >
                {c === "monthly" ? "Monthly" : "Yearly (2 months free)"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {plan.tier === "free" && prices?.starter?.[cycle] && (
              <button className="btn btn-primary btn-sm" disabled={!!paying} onClick={() => checkout("starter")}>
                {paying === "starter" ? "Opening Paystack..." : `Pay ${prices.starter[cycle].label} for Starter`}
              </button>
            )}
            {prices?.pro?.[cycle] && (
              <button className="btn btn-secondary btn-sm" disabled={!!paying} onClick={() => checkout("pro")}>
                {paying === "pro" ? "Opening Paystack..." : `Pay ${prices.pro[cycle].label} for Pro`}
              </button>
            )}
          </div>
        </>
      )}
      <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
        Secure payment by Paystack. Your plan activates immediately after payment.
      </p>
    </div>
  );
}
