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
  const [method, setMethod] = useState("card"); // card | crypto
  const [cryptoCurrency, setCryptoCurrency] = useState("USDT");
  const [cryptoQuote, setCryptoQuote] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoMsg, setCryptoMsg] = useState("");
  const [copied, setCopied] = useState(false);

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

  async function cryptoCheckout(tier) {
    setCryptoBusy(true);
    setCryptoMsg("");
    setCryptoQuote(null);
    try {
      const d = await api.post("/api/crypto/checkout", { tier, cycle, crypto_currency: cryptoCurrency });
      setCryptoQuote({ ...d, tier });
      setTxHash("");
    } catch (e) {
      setCryptoMsg(e.message);
    }
    setCryptoBusy(false);
  }

  async function cryptoConfirm() {
    if (!cryptoQuote || !txHash.trim()) {
      setCryptoMsg("Paste your transaction hash first.");
      return;
    }
    setCryptoBusy(true);
    setCryptoMsg("");
    try {
      const d = await api.post("/api/crypto/confirm", { reference: cryptoQuote.reference, tx_hash: txHash.trim() });
      setCryptoMsg(d.message);
      setCryptoQuote(null);
      setTxHash("");
      load();
    } catch (e) {
      setCryptoMsg(e.message);
    }
    setCryptoBusy(false);
  }

  function copyAddress() {
    if (!cryptoQuote?.wallet_address) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cryptoQuote.wallet_address).then(done).catch(done);
    } else done();
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
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {(["card", "crypto"]).map((m) => (
              <button
                key={m}
                type="button"
                className={"btn btn-sm " + (method === m ? "btn-primary" : "btn-secondary")}
                onClick={() => { setMethod(m); setCryptoQuote(null); setCryptoMsg(""); }}
              >
                {m === "card" ? "Pay with card" : "Pay with crypto"}
              </button>
            ))}
          </div>
          {method === "crypto" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {(["USDT", "BTC"]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={"btn btn-sm " + (cryptoCurrency === c ? "btn-primary" : "btn-secondary")}
                  onClick={() => { setCryptoCurrency(c); setCryptoQuote(null); setCryptoMsg(""); }}
                >
                  {c === "USDT" ? "USDT (Tron)" : "BTC (Bitcoin)"}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {plan.tier === "free" && prices?.starter?.[cycle] && method === "card" && (
              <button className="btn btn-primary btn-sm" disabled={!!paying} onClick={() => checkout("starter")}>
                {paying === "starter" ? "Opening Paystack..." : `Pay ${prices.starter[cycle].label} for Starter`}
              </button>
            )}
            {prices?.pro?.[cycle] && method === "card" && (
              <button className="btn btn-secondary btn-sm" disabled={!!paying} onClick={() => checkout("pro")}>
                {paying === "pro" ? "Opening Paystack..." : `Pay ${prices.pro[cycle].label} for Pro`}
              </button>
            )}
            {(plan.tier === "free" || plan.tier === "starter") && prices?.solo?.[cycle] && method === "card" && (
              <button className="btn btn-secondary btn-sm" disabled={!!paying} onClick={() => checkout("solo")}>
                {paying === "solo" ? "Opening Paystack..." : `Pay ${prices.solo[cycle].label} for Solo`}
              </button>
            )}
            {method === "crypto" && !cryptoQuote && (
              <>
                {plan.tier === "free" && prices?.starter?.[cycle] && (
                  <button className="btn btn-primary btn-sm" disabled={cryptoBusy} onClick={() => cryptoCheckout("starter")}>
                    {cryptoBusy ? "Preparing..." : `Crypto: Starter (${cryptoCurrency})`}
                  </button>
                )}
                {prices?.pro?.[cycle] && (
                  <button className="btn btn-secondary btn-sm" disabled={cryptoBusy} onClick={() => cryptoCheckout("pro")}>
                    {cryptoBusy ? "Preparing..." : `Crypto: Pro (${cryptoCurrency})`}
                  </button>
                )}
                {(plan.tier === "free" || plan.tier === "starter") && prices?.solo?.[cycle] && (
                  <button className="btn btn-secondary btn-sm" disabled={cryptoBusy} onClick={() => cryptoCheckout("solo")}>
                    {cryptoBusy ? "Preparing..." : `Crypto: Solo (${cryptoCurrency})`}
                  </button>
                )}
              </>
            )}
          </div>
          {cryptoMsg && <div className="alert alert-ok" style={{ marginTop: 8 }}>{cryptoMsg}</div>}
          {cryptoQuote && (
            <div className="card" style={{ marginTop: 12, background: "var(--bg-soft, #f8fafc)" }}>
              <h4 style={{ marginTop: 0 }}>Pay {cryptoQuote.amount_label} for {cryptoQuote.tier}</h4>
              <p className="hint" style={{ marginBottom: 6 }}>Network: <strong>{cryptoQuote.network}</strong>. Complete within 24 hours.</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <code style={{ wordBreak: "break-all", flex: 1, fontSize: 13 }}>{cryptoQuote.wallet_address}</code>
                <button type="button" className="btn btn-sm btn-secondary" onClick={copyAddress}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="hint" style={{ color: "#b45309" }}>
                Send only on the {cryptoQuote.network} network. Any other network will lose your money.
              </p>
              <label className="hint" htmlFor="txhash">Transaction hash from your wallet</label>
              <input
                id="txhash"
                className="input"
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="Paste the 64-character transaction hash"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={cryptoBusy} onClick={cryptoConfirm}>
                  {cryptoBusy ? "Submitting..." : "I have sent the payment"}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={cryptoBusy}
                  onClick={() => { setCryptoQuote(null); setTxHash(""); setCryptoMsg(""); }}>
                  Cancel
                </button>
              </div>
              <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
                We verify every transaction on the blockchain before activating. Your plan turns on after verification, usually within a few hours.
              </p>
            </div>
          )}
        </>
      )}
      <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
        {method === "card"
          ? "Secure card payment by Paystack. Your plan activates immediately after payment."
          : "Crypto payments (USDT on Tron, BTC on Bitcoin) are verified on the blockchain before activation."}
      </p>
    </div>
  );
}
