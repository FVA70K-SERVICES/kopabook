import { useState } from "react";
import { api, nav } from "../lib/api";

function MNav() {
  return (
    <header className="mnav">
      <div className="wrap mnav-inner">
        <a href="/" className="brand">Kopa<span>Book</span></a>
        <nav className="mnav-links">
          <a href="/features" className="hide-m">Features</a>
          <a href="/pricing" className="hide-m">Pricing</a>
          <a href="/login">Sign in</a>
          <a href="/waitlist" className="btn btn-primary btn-sm">Join waitlist</a>
        </nav>
      </div>
    </header>
  );
}

function MFooter() {
  return (
    <footer className="mfooter">
      <div className="wrap">
        <div>
          <div className="brand">Kopa<span>Book</span></div>
          <p>Simple sales, stock and debt tracking for Nigerian businesses.<br />Built by Lifeverse Technologies.</p>
        </div>
        <div>
          <a href="/features">Features</a> · <a href="/pricing">Pricing</a> ·{" "}
          <a href="/waitlist">Waitlist</a> · <a href="/login">Sign in</a>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="page">
      <MNav />
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">Built for Nigerian merchants</span>
          <h1>Know your sales, stock and debts.<br />Every single day.</h1>
          <p className="lead">
            KopaBook replaces the notebook and scattered WhatsApp chats with one simple
            dashboard: record sales in seconds, watch stock move, and always know who owes you.
          </p>
          <div className="hero-cta">
            <a href="/waitlist" className="btn btn-primary">Start free</a>
            <a href="/features" className="btn btn-secondary">See how it works</a>
          </div>
          <p className="hero-proof">Made for provision stores, phone sellers, fashion vendors and market traders.</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>One book for the whole shop</h2>
          <p className="sub">Everything a busy merchant needs, nothing they do not.</p>
          <div className="grid">
            <div className="card"><div className="icon">🧾</div><h3>Fast sales recording</h3><p>Record a sale in under 5 taps. Stock deducts automatically the moment you save.</p></div>
            <div className="card"><div className="icon">📦</div><h3>Stock that tracks itself</h3><p>Every sale, adjustment and opening balance writes to your stock ledger. Low-stock alerts included.</p></div>
            <div className="card"><div className="icon">📒</div><h3>Debts you never forget</h3><p>Unpaid balances become customer debts automatically, with a running ledger per customer.</p></div>
            <div className="card"><div className="icon">💸</div><h3>Expenses in seconds</h3><p>Capture daily expenses by category and see exactly where the money goes.</p></div>
            <div className="card"><div className="icon">📊</div><h3>Daily position at a glance</h3><p>Open your dashboard and understand today's sales, expenses and debts in 30 seconds.</p></div>
            <div className="card"><div className="icon">🧑‍💼</div><h3>Staff without chaos</h3><p>Give attendants controlled access to record sales while you keep full control.</p></div>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "#fff", borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <h2>How it works</h2>
          <div className="steps narrow" style={{ margin: "30px auto" }}>
            <div className="step"><div className="n">1</div><div><strong>Add your products once.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Name, price, opening stock. Done in minutes.</p></div></div>
            <div className="step"><div className="n">2</div><div><strong>Record sales as they happen.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Pick products, take payment, done. Partial payments become debts automatically.</p></div></div>
            <div className="step"><div className="n">3</div><div><strong>See your day clearly.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Sales, expenses, debts and low stock, live on one dashboard.</p></div></div>
          </div>
          <div style={{ textAlign: "center" }}>
            <a href="/waitlist" className="btn btn-primary">Join the waitlist</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Questions merchants ask</h2>
          <div className="faq narrow" style={{ margin: "0 auto" }}>
            <details><summary>Do I need accounting knowledge?</summary><p>No. If you can use WhatsApp, you can use KopaBook. It speaks sales, stock and debts, not debits and credits.</p></details>
            <details><summary>Will it work on my phone?</summary><p>Yes. KopaBook is mobile-first and designed to be light on data.</p></details>
            <details><summary>What happens when a customer does not pay in full?</summary><p>The unpaid balance automatically becomes a debt on that customer's ledger, so you never lose track.</p></details>
            <details><summary>Can my shop attendant use it?</summary><p>Yes. Staff roles let attendants record sales while you keep control of products, settings and reports.</p></details>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

export function FeaturesPage() {
  const feats = [
    ["🧾", "Sales in seconds", "A fast cart builder with product search, quantity steppers and payment methods. Under 5 taps from open to saved."],
    ["📦", "Automatic stock control", "Every sale deducts stock instantly. Manual adjustments and opening balances are all written to an immutable movement ledger."],
    ["📒", "Customer debts and ledgers", "Partial payments auto-create debts. Every customer gets a running-balance ledger showing debts, payments and history."],
    ["💸", "Expense capture", "Log daily expenses by category in seconds and review where money leaves the business."],
    ["📊", "Live dashboard", "Today's sales, today's expenses, outstanding debts, low-stock alerts and recent sales, computed from real data."],
    ["📈", "Daily summaries and reports", "Date-range sales totals, top products, expense breakdowns and debtor lists, ready to review or export."],
    ["🧑‍💼", "Staff roles", "Owner, manager and attendant roles with sensible permissions. Attendants record sales; owners keep control."],
    ["🔒", "Secure by design", "Password hashing, secure httpOnly sessions, and audit logs for sensitive actions."],
  ];
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap">
          <h2>Everything in KopaBook</h2>
          <p className="sub">Designed around how Nigerian merchants actually work: transfers, WhatsApp orders, walk-ins and trust-based credit.</p>
          <div className="grid">
            {feats.map(([icon, title, desc]) => (
              <div className="card" key={title}><div className="icon">{icon}</div><h3>{title}</h3><p>{desc}</p></div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 36 }}>
            <a href="/waitlist" className="btn btn-primary">Join the waitlist</a>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

export function PricingPage() {
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap">
          <h2>Simple pricing</h2>
          <p className="sub">Start free. Upgrade when your business grows. No payment collection yet, join the waitlist and we will notify you at launch.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card price-card" style={{ border: "2px solid var(--brand)" }}>
              <div className="tier">Free</div>
              <div className="amount">Free</div>
              <p style={{ color: "var(--muted)" }}>Always free. For solo merchants getting organised.</p>
              <ul>
                <li>100 sales per week</li>
                <li>100 products</li>
                <li>1 branch</li>
                <li>2 staff accounts</li>
              </ul>
              <a href="/waitlist" className="btn btn-primary btn-block">Get started</a>
            </div>
            <div className="card price-card">
              <div className="tier">Starter</div>
              <div className="amount">NGN 1,000</div>
              <p style={{ color: "var(--muted)" }}>Per month. For growing shops with attendants.</p>
              <ul>
                <li>1,000 sales per week</li>
                <li>1,000 products</li>
                <li>5 staff accounts</li>
                <li>WhatsApp auto reminders</li>
                <li>CSV import</li>
              </ul>
              <a href="/waitlist" className="btn btn-secondary btn-block">Join waitlist</a>
            </div>
            <div className="card price-card">
              <div className="tier">Pro</div>
              <div className="amount">NGN 2,500</div>
              <p style={{ color: "var(--muted)" }}>Per month. For bigger businesses with branches.</p>
              <ul>
                <li>Unlimited sales and products</li>
                <li>3 branches</li>
                <li>Unlimited staff accounts</li>
                <li>Supplier verification</li>
                <li>Advanced reports</li>
              </ul>
              <a href="/waitlist" className="btn btn-secondary btn-block">Join waitlist</a>
            </div>
          </div>
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Add-ons, billed separately</h3>
            <p style={{ color: "var(--muted)" }}>Optional extras on top of any plan.</p>
            <ul>
              <li>WhatsApp chatbot: billed per conversation at the Meta rate, zero markup.</li>
              <li>Extra branch: NGN 500 per month, per branch.</li>
              <li>Custom domain: at cost.</li>
            </ul>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

export function WaitlistPage() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", businessType: "", city: "", monthlyTransactions: "", currentTool: "", consent: true });
  const [status, setStatus] = useState({ loading: false, error: "", ok: false });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setStatus({ loading: true, error: "", ok: false });
    try {
      await api.post("/api/waitlist", form);
      setStatus({ loading: false, error: "", ok: true });
    } catch (err) {
      setStatus({ loading: false, error: err.message, ok: false });
    }
  }

  return (
    <div className="page">
      <MNav />
      <div className="wrap">
        <div className="form-card">
          {status.ok ? (
            <>
              <h1>You are on the list 🎉</h1>
              <p className="hint">We will reach out as soon as KopaBook opens for early merchants. Tell a fellow trader.</p>
              <a href="/" className="btn btn-secondary btn-block">Back home</a>
            </>
          ) : (
            <>
              <h1>Join the waitlist</h1>
              <p className="hint">Be first in line when KopaBook launches for Nigerian merchants.</p>
              {status.error && <div className="alert alert-error">{status.error}</div>}
              <form onSubmit={submit}>
                <div className="field"><label>Full name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="Your name" /></div>
                <div className="field"><div className="row2">
                  <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
                  <div><label>Email</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" /></div>
                </div></div>
                <div className="field"><div className="row2">
                  <div><label>Business type</label><input value={form.businessType} onChange={(e) => set("businessType", e.target.value)} placeholder="Provision store" /></div>
                  <div><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Asaba" /></div>
                </div></div>
                <div className="field"><label>How do you track sales today?</label>
                  <select value={form.currentTool} onChange={(e) => set("currentTool", e.target.value)}>
                    <option value="">Select...</option>
                    <option>Notebook</option><option>Memory</option><option>WhatsApp chats</option><option>Excel</option><option>Another app</option>
                  </select>
                </div>
                <button className="btn btn-primary btn-block" disabled={status.loading}>
                  {status.loading ? "Joining..." : "Join the waitlist"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      <MFooter />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="page">
      <MNav />
      <div className="wrap" style={{ textAlign: "center", padding: "80px 20px" }}>
        <h1>Page not found</h1>
        <p style={{ color: "var(--muted)" }}>The page you are looking for does not exist.</p>
        <a href="/" className="btn btn-primary">Back home</a>
      </div>
      <MFooter />
    </div>
  );
}
