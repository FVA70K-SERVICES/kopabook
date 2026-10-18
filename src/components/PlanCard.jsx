import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Manual bank transfer destination. Shown to the user during bank-transfer checkout.
const BANK_DETAILS = {
  accountNumber: "6112431993",
  bank: "Opay",
  accountName: "FVA70K SERVICES",
};

// Fallback price labels, used only if the live price book (/api/plans) has not loaded.
// The real prices always come from the subscription_plans table in the database.
const FALLBACK_PRICES = {
  free: { monthly: { label: "Free" }, yearly: { label: "Free" } },
  starter: { monthly: { label: "NGN 1,000/month" }, yearly: { label: "NGN 10,000/year" } },
  solo: { monthly: { label: "NGN 5,000/month" }, yearly: { label: "NGN 50,000/year" } },
  pro: { monthly: { label: "NGN 10,000/month" }, yearly: { label: "NGN 100,000/year" } },
};

const TIER_RANK = { free: 0, starter: 1, solo: 2, pro: 3 };

const PLAN_FEATURES = {
  free: [
    "1 business",
    "1 staff account",
    "Record sales and expenses",
    "Products and stock tracking",
    "Kopa Bot assistant",
  ],
  starter: [
    "Everything in Free",
    "5 businesses",
    "5 staff accounts",
    "1,000 products and services",
    "Reports and shareable receipts",
  ],
  pro: [
    "Everything in Starter",
    "Unlimited businesses, products and staff",
    "Shipments and hotel tools",
    "Debt reminders",
    "Priority support",
  ],
};

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
  const [method, setMethod] = useState("card"); // card | transfer | crypto
  // Crypto state (existing crypto flow, unchanged).
  const [cryptoCurrency, setCryptoCurrency] = useState("USDT");
  const [cryptoQuote, setCryptoQuote] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoMsg, setCryptoMsg] = useState("");
  const [copied, setCopied] = useState(false);
  // Bank transfer state.
  const [transferInfo, setTransferInfo] = useState(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMsg, setTransferMsg] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const [copiedField, setCopiedField] = useState("");

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

  const priceLabel = (tier) =>
    prices?.[tier]?.[cycle]?.label || FALLBACK_PRICES[tier]?.[cycle]?.label || "";

  function copyText(text, field) {
    const done = () => { setCopiedField(field); setTimeout(() => setCopiedField(""), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else done();
  }

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

  async function manualInitiate(tier) {
    setTransferBusy(true);
    setTransferMsg("");
    setTransferInfo(null);
    setProofSubmitted(false);
    setProofFile(null);
    try {
      const d = await api.post("/api/billing/manual/initiate", { tier, billing_cycle: cycle });
      const reference = d.reference_number || d.reference;
      if (!reference) throw new Error("We could not start your transfer. Please try again.");
      setTransferInfo({
        tier,
        reference_number: reference,
        amount_label: d.amount_label || priceLabel(tier),
      });
    } catch (e) {
      setTransferMsg(e.message);
    }
    setTransferBusy(false);
  }

  async function manualSubmit() {
    if (!transferInfo) return;
    if (!proofFile) {
      setTransferMsg("Choose a photo or screenshot of your receipt first.");
      return;
    }
    setProofBusy(true);
    setTransferMsg("");
    try {
      const form = new FormData();
      form.append("reference_number", transferInfo.reference_number);
      form.append("proof", proofFile, proofFile.name);
      const res = await fetch("/api/billing/manual/submit", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        throw new Error(d.message || "Upload failed. Please try again.");
      }
      setProofSubmitted(true);
      setMsg(d.message || "Payment submitted, pending verification.");
    } catch (e) {
      setTransferMsg(e.message);
    }
    setProofBusy(false);
  }

  function resetTransfer() {
    setTransferInfo(null);
    setTransferMsg("");
    setProofFile(null);
    setProofSubmitted(false);
  }

  // --- Crypto flow (unchanged) ---
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
  // --- end crypto flow ---

  if (!plan || !plan.ok) return null;
  const u = plan.usage || {};
  const l = plan.limits || {};
  const fmtLimit = (v) => (v === null || v === undefined ? "Unlimited" : v);
  const canUpgrade = plan.tier !== "pro";
  const tierRank = TIER_RANK[plan.tier] ?? 0;
  const isUpgradeable = (tier) => (TIER_RANK[tier] ?? 0) > tierRank;

  function planButton(tier) {
    if (!isUpgradeable(tier)) return null;
    if (method === "card") {
      return (
        <button className="btn btn-primary btn-sm" style={{ width: "100%" }} disabled={!!paying} onClick={() => checkout(tier)}>
          {paying === tier ? "Opening Paystack..." : `Pay ${priceLabel(tier)} with card`}
        </button>
      );
    }
    if (method === "transfer") {
      return (
        <button className="btn btn-primary btn-sm" style={{ width: "100%" }} disabled={transferBusy} onClick={() => manualInitiate(tier)}>
          {transferBusy ? "Preparing..." : `Pay ${priceLabel(tier)} by transfer`}
        </button>
      );
    }
    return (
      <button className="btn btn-primary btn-sm" style={{ width: "100%" }} disabled={cryptoBusy} onClick={() => cryptoCheckout(tier)}>
        {cryptoBusy ? "Preparing..." : "Pay with crypto"}
      </button>
    );
  }

  function planCard(tier, name) {
    const isCurrent = plan.tier === tier;
    return (
      <div
        key={tier}
        className="card"
        style={{
          margin: 0,
          border: isCurrent ? "2px solid var(--brand)" : "1px solid var(--border)",
          background: isCurrent ? "var(--bg-soft, #f8fafc)" : undefined,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{name}</h4>
          {isCurrent && (
            <span className="pill" style={{ background: "var(--brand)", color: "#fff", fontSize: 12, padding: "2px 10px", borderRadius: 999 }}>
              Current plan
            </span>
          )}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{priceLabel(tier)}</div>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 13 }}>
          {PLAN_FEATURES[tier].map((f) => (
            <li key={f} style={{ marginBottom: 4, color: "var(--muted, #555)" }}>{f}</li>
          ))}
        </ul>
        {planButton(tier)}
      </div>
    );
  }

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
            <span>Sales this week</span><strong>{u.salesThisWeek}</strong>
          </div>
          <small className="hint">Usage only, not a limit. Recording a sale is never blocked.</small>
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

      {canUpgrade && (
        <>
          <h4 style={{ margin: "14px 0 8px" }}>Upgrade your plan</h4>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {(["monthly", "yearly"]).map((c) => (
              <button
                key={c}
                type="button"
                className={"btn btn-sm " + (cycle === c ? "btn-primary" : "btn-secondary")}
                onClick={() => { setCycle(c); resetTransfer(); }}
              >
                {c === "monthly" ? "Monthly" : "Yearly (2 months free)"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {([["card", "Pay with card"], ["transfer", "Bank transfer"], ["crypto", "Pay with crypto"]]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={"btn btn-sm " + (method === m ? "btn-primary" : "btn-secondary")}
                onClick={() => { setMethod(m); setCryptoQuote(null); setCryptoMsg(""); resetTransfer(); }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
            {planCard("free", "Free")}
            {planCard("starter", "Starter")}
            {planCard("pro", "Pro")}
          </div>

          {prices?.solo?.[cycle] && isUpgradeable("solo") && (
            <div className="card" style={{ margin: "0 0 12px", padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14 }}><strong>Solo</strong> · {priceLabel("solo")} · for one-person businesses</span>
                <span style={{ minWidth: 200, flex: "0 1 240px" }}>{planButton("solo")}</span>
              </div>
            </div>
          )}

          {method === "crypto" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {([["USDT", "USDT (Tron)"], ["BTC", "BTC (Bitcoin)"]]).map(([c, label]) => (
                <button
                  key={c}
                  type="button"
                  className={"btn btn-sm " + (cryptoCurrency === c ? "btn-primary" : "btn-secondary")}
                  onClick={() => { setCryptoCurrency(c); setCryptoQuote(null); setCryptoMsg(""); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {cryptoMsg && <div className="alert alert-ok" style={{ marginTop: 8 }}>{cryptoMsg}</div>}

          {method === "crypto" && cryptoQuote && (
            <div className="card" style={{ marginTop: 12, background: "var(--bg-soft, #f8fafc)" }}>
              <h4 style={{ marginTop: 0 }}>Pay {cryptoQuote.amount_label} for {cryptoQuote.tier}</h4>
              <p className="hint" style={{ marginBottom: 6 }}>Network: <strong>{cryptoQuote.network}</strong>. Complete within 24 hours.</p>
              <div style={{ textAlign: "center", marginBottom: 8 }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(cryptoQuote.wallet_address)}`}
                  alt="Scan wallet address"
                  width={180}
                  height={180}
                  loading="lazy"
                  style={{ borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
                <p className="hint" style={{ margin: "4px 0 0" }}>Scan with your wallet app</p>
              </div>
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

          {method === "transfer" && transferBusy && !transferInfo && (
            <p className="hint">Preparing your transfer details...</p>
          )}

          {transferMsg && <div className="alert" style={{ marginTop: 8 }}>{transferMsg}</div>}

          {method === "transfer" && transferInfo && !proofSubmitted && (
            <div className="card" style={{ marginTop: 12, background: "var(--bg-soft, #f8fafc)" }}>
              <h4 style={{ marginTop: 0 }}>Pay {transferInfo.amount_label} by bank transfer</h4>
              <p className="hint">Send the exact amount to the account below, then upload your receipt.</p>
              <div style={{ display: "grid", gap: 8, marginBottom: 10, fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="hint">Bank</span><strong>{BANK_DETAILS.bank}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="hint">Account number</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 16, letterSpacing: 1 }}>{BANK_DETAILS.accountNumber}</strong>
                    <button type="button" className="btn btn-sm btn-secondary"
                      onClick={() => copyText(BANK_DETAILS.accountNumber, "acct")}>
                      {copiedField === "acct" ? "Copied" : "Copy"}
                    </button>
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="hint">Account name</span><strong>{BANK_DETAILS.accountName}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="hint">Your reference</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 16, letterSpacing: 1 }}>{transferInfo.reference_number}</strong>
                    <button type="button" className="btn btn-sm btn-secondary"
                      onClick={() => copyText(transferInfo.reference_number, "ref")}>
                      {copiedField === "ref" ? "Copied" : "Copy"}
                    </button>
                  </span>
                </div>
              </div>
              <p className="hint" style={{ color: "#b45309" }}>
                Write this reference in your transfer narration (the description field) so we can match your payment to your account.
              </p>
              <label className="hint" htmlFor="proof">Proof of payment (photo or screenshot of your receipt)</label>
              <input
                id="proof"
                type="file"
                accept="image/*"
                className="input"
                style={{ width: "100%", marginBottom: 8 }}
                onChange={(e) => setProofFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
              />
              {proofFile && <p className="hint" style={{ marginTop: 0 }}>Selected: {proofFile.name}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={proofBusy || !proofFile} onClick={manualSubmit}>
                  {proofBusy ? "Submitting..." : "Submit proof of payment"}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={proofBusy} onClick={resetTransfer}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {method === "transfer" && proofSubmitted && (
            <div className="alert alert-ok" style={{ marginTop: 12 }}>
              <strong>Payment submitted, pending verification.</strong>
              <p style={{ margin: "6px 0 8px" }}>
                We have your receipt. Your plan will turn on after we verify the payment, usually within 24 hours.
                Your reference is {transferInfo && transferInfo.reference_number}.
              </p>
              <button type="button" className="btn btn-sm btn-secondary" onClick={resetTransfer}>
                Back to plans
              </button>
            </div>
          )}
        </>
      )}

      <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
        {method === "card" && "Secure card payment by Paystack. Your plan activates immediately after payment."}
        {method === "transfer" && "Transfer to our bank account, then upload your receipt. Your plan activates after we verify your payment."}
        {method === "crypto" && "Crypto payments (USDT on Tron, BTC on Bitcoin) are verified on the blockchain before activation. $2 minimum per crypto payment (covers network charges)."}
      </p>
    </div>
  );
}
