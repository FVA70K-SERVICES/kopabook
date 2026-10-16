import { useState } from "react";
import { api, nav } from "../lib/api";
import { COUNTRIES } from "../lib/businessTypes";
import ThemeToggle from "../components/ThemeToggle";

function MNav() {
  return (
    <header className="mnav">
      <div className="wrap mnav-inner">
        <a href="/" className="brand">Kopa<span>Book</span></a>
        <nav className="mnav-links">
          <a href="/features" className="hide-m">Features</a>
          <a href="/hotels" className="hide-m">Hotels</a>
          <a href="/pricing" className="hide-m">Pricing</a>
          <a href="/about" className="hide-m">About</a>
          <a href="/faq" className="hide-m">FAQ</a>
          <a href="/login">Sign in</a>
          <ThemeToggle />
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
          <p>Simple sales, stock and debt tracking for businesses everywhere.<br />Owned by Fortune Godson. Built by FVA70K Services.</p>
        </div>
        <div>
          <a href="/features">Features</a> · <a href="/pricing">Pricing</a> ·{" "}
          <a href="/about">About</a> · <a href="/faq">FAQ</a> ·{" "}
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
          <span className="eyebrow">Built for local merchants, ready for the world</span>
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

      <section className="section section-band" style={{ borderTop: "1px solid var(--line)" }}>
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
            <details><summary>Does KopaBook take my money?</summary><p>Never. KopaBook is a record keeper, not a payment processor. Every payment is a record of money exchanged outside the app.</p></details>
          </div>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <a href="/faq" className="btn btn-secondary">See all questions</a>
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
    ["🛠️", "Products and services", "Sell physical products with automatic stock control, and services priced per job or per hour, in the same sale."],
    ["📦", "Automatic stock control", "Every sale deducts stock instantly. Manual adjustments and opening balances are all written to an immutable movement ledger."],
    ["📒", "Customer debts and ledgers", "Partial payments auto-create debts. Customers can pay bit by bit, and overpayments come back as change, never negative debt."],
    ["🚚", "Shipment tracking", "Generate a tracking number when a sold product ships. Move it from pending to shipped to delivered, and share the number with your customer."],
    ["💸", "Expense capture", "Log daily expenses by category in seconds and review where money leaves the business."],
    ["📊", "Live dashboard", "Today's sales, today's expenses, change given, outstanding debts, low-stock alerts and recent sales, computed from real data in your timezone."],
    ["📈", "Daily summaries and reports", "Date-range sales totals, top products, expense breakdowns and debtor lists, ready to review or export."],
    ["🧑‍💼", "Full staff control", "Partner, manager, accountant, cashier, storekeeper, attendant, and hotel roles. Discount limits, commissions, suspend or remove, each role sees only its own workspace."],
    ["🏢", "Many businesses, one account", "Own and manage multiple businesses. Switch between them instantly; each keeps its own staff, sales, stock, and records."],
    ["🧾", "Thermal receipts", "Printable receipts for 58mm and 80mm printers, with your business name, phone, address, and custom footer."],
    ["💬", "WhatsApp friendly", "Share receipts, send debt reminders, and broadcast promos straight to WhatsApp."],
    ["🏨", "Hotel module", "Rooms, bookings, guest folios, charges, and payments for hotels, guest houses, and lodges."],
    ["🔒", "Secure by design", "Password hashing, secure httpOnly sessions, role-based access, and audit logs for sensitive actions."],
  ];
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap">
          <h2>Everything in KopaBook</h2>
          <p className="sub">Designed around how local merchants actually work: transfers, WhatsApp orders, walk-ins and trust-based credit.</p>
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
          <p className="sub">Start free. Upgrade when your business grows. Recording a sale is always free and never blocked, on any plan.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card price-card" style={{ border: "2px solid var(--brand)" }}>
              <div className="tier">Free</div>
              <div className="amount">Free</div>
              <p style={{ color: "var(--muted)" }}>Always free. For solo merchants getting organised.</p>
              <ul>
                <li>2 businesses</li>
                <li>100 sales per week, per business</li>
                <li>100 products and services, per business</li>
                <li>2 staff accounts, per business</li>
                <li>Sales, stock, debts, expenses, receipts</li>
              </ul>
              <a href="/register" className="btn btn-primary btn-block">Get started</a>
            </div>
            <div className="card price-card">
              <div className="tier">Starter</div>
              <div className="amount">NGN 1,000</div>
              <p style={{ color: "var(--muted)" }}>Per month. For growing shops with attendants.</p>
              <ul>
                <li>5 businesses</li>
                <li>1,000 sales per week, per business</li>
                <li>1,000 products and services, per business</li>
                <li>5 staff accounts, per business</li>
                <li>WhatsApp debt reminders</li>
                <li>CSV import</li>
              </ul>
              <a href="/register" className="btn btn-secondary btn-block">Start free, upgrade later</a>
            </div>
            <div className="card price-card">
              <div className="tier">Pro</div>
              <div className="amount">NGN 2,500</div>
              <p style={{ color: "var(--muted)" }}>Per month. For bigger businesses running multiple shops.</p>
              <ul>
                <li>Unlimited businesses</li>
                <li>Unlimited sales and products</li>
                <li>Unlimited staff accounts</li>
                <li>Shipment tracking</li>
                <li>Hotel operations</li>
                <li>Advanced reports</li>
              </ul>
              <a href="/register" className="btn btn-secondary btn-block">Start free, upgrade later</a>
            </div>
          </div>
          <div className="card" style={{ marginTop: 24 }}>
            <h3>How upgrading works</h3>
            <p style={{ color: "var(--muted)" }}>
              KopaBook never takes money inside the app. When you hit a free limit, tap upgrade in your
              settings and we will reach you on WhatsApp to arrange payment by bank transfer.
              Your new limits turn on as soon as payment is confirmed. Sales recording is never blocked, on any plan.
            </p>
          </div>
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Add-ons, billed separately</h3>
            <p style={{ color: "var(--muted)" }}>Optional extras on top of any plan.</p>
            <ul>
              <li>Extra business on Starter: NGN 500 per month, per business.</li>
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
  const [form, setForm] = useState({ name: "", phone: "", email: "", businessType: "", state: "", city: "", monthlyTransactions: "", currentTool: "", consent: true });
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
              <p className="hint">Be first in line when KopaBook launches in your country.</p>
              {status.error && <div className="alert alert-error">{status.error}</div>}
              <form onSubmit={submit}>
                <div className="field"><label>Full name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="Your name" /></div>
                <div className="field"><div className="row2">
                  <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
                  <div><label>Email</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" /></div>
                </div></div>
                <div className="field"><div className="row2">
                  <div><label>Business type</label><input value={form.businessType} onChange={(e) => set("businessType", e.target.value)} placeholder="Provision store" /></div>
                  <div><label>Country</label><select value={form.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                </div></div>
                <div className="field"><label>City</label><input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Your city" /></div>
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

export function AboutPage() {
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap narrow" style={{ margin: "0 auto" }}>
          <span className="eyebrow">About KopaBook</span>
          <h1>The record book for<br />everyday business.</h1>
          <p className="lead">
            KopaBook is a simple, free record keeper for local businesses everywhere.
            Shops, hotels, restaurants, salons, pharmacies, artisans. If you sell something,
            KopaBook keeps your books straight.
          </p>
          <h2>Why it exists</h2>
          <p>
            Most small businesses run on memory, paper notebooks, or chat messages.
            Money goes missing, debts get forgotten, and stock counts never add up.
            KopaBook replaces all of that with one simple app that works on the phone
            already in your pocket.
          </p>
          <h2>What it is, and what it is not</h2>
          <p>
            KopaBook is a <strong>record keeper, not a payment processor</strong>. It never
            touches your money. Every payment in the app is a record of money that changed
            hands outside it, through cash, bank transfer, or POS. There is no gateway,
            no wallet, no card charging. Your money stays yours.
          </p>
          <h2>Built for the real world</h2>
          <ul>
            <li><strong>Worldwide.</strong> Your country, currency, and timezone, set at signup and changeable anytime.</li>
            <li><strong>Any business type.</strong> Hotels get rooms and folios. Restaurants, pharmacies, salons, and artisans each get a workspace shaped for them.</li>
            <li><strong>Staff that fits.</strong> Partners, managers, cashiers, storekeepers, accountants, attendants, and hotel roles, each seeing only their own workspace.</li>
            <li><strong>WhatsApp friendly.</strong> Share receipts, debt reminders, and promos straight to WhatsApp.</li>
            <li><strong>Free core.</strong> Recording sales is free and always will be. Limits never block you from recording a sale.</li>
          </ul>
          <h2>Who builds it</h2>
          <p>
            KopaBook is built by <strong>FVA70K Services</strong>, founded by Fortune Godson.
            It is designed with real merchants, for real merchants, one honest feature at a time.
          </p>
          <div style={{ marginTop: 32 }}>
            <a href="/waitlist" className="btn btn-primary">Join the waitlist</a>{" "}
            <a href="/faq" className="btn btn-secondary">Read the FAQ</a>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

const FAQS = [
  {
    q: "What is KopaBook?",
    a: "KopaBook is a free record-keeping app for small businesses. It records your sales, tracks stock, manages customer debts, logs expenses, and shows you how the business is doing, all from your phone.",
  },
  {
    q: "Does KopaBook take or process payments?",
    a: "No. KopaBook never touches your money. Every payment in the app is a record of money exchanged outside it, through cash, bank transfer, or POS terminal. There is no payment gateway and no card charging.",
  },
  {
    q: "Is it really free?",
    a: "The core record keeping is free: record sales, manage stock, track debts, and add staff. Paid plans exist for larger teams and higher volumes, but the free tier never blocks you from recording a sale.",
  },
  {
    q: "Which countries does it work in?",
    a: "KopaBook is built to be usable worldwide. You set your country, currency, and timezone at signup, and money shows in your own currency with dates in your own timezone.",
  },
  {
    q: "What types of business can use it?",
    a: "Shops, supermarkets, pharmacies, restaurants, hotels, salons, fashion stores, electronics shops, artisans, and more. Hotels get rooms, bookings, and guest folios. Every type gets a workspace shaped for how it works.",
  },
  {
    q: "Can my staff use it?",
    a: "Yes. Invite staff by email and give each person a role: partner, manager, accountant, cashier, storekeeper, attendant, or hotel roles. Everyone signs in on the same login page, but each role sees only its own workspace. You can set discount limits, commissions, suspend access, or remove staff anytime.",
  },
  {
    q: "What is a Partner?",
    a: "A Partner is a co-owner with full access to the business, just like you. Only the true owner can invite a partner or change a partner's access, so your ownership is always protected.",
  },
  {
    q: "Can I run more than one business?",
    a: "Yes. One account can own and manage many businesses. Switch between them from the business switcher. Each business keeps its own staff, sales, stock, and records, completely separate.",
  },
  {
    q: "How do customer debts work?",
    a: "When a sale is not fully paid, the unpaid balance automatically becomes a debt on the customer's ledger. Customers can pay bit by bit, and every payment updates the running balance. If a customer overpays, the extra is shown as change to give back, never as negative debt.",
  },
  {
    q: "How does stock control work?",
    a: "Every product sale deducts stock instantly. You get low-stock alerts, a full movement history for each product, and manual adjustments are all recorded. Services are sold without touching stock.",
  },
  {
    q: "Can I sell services, not just products?",
    a: "Yes. Add services with a price per job or per hour, and record them in the same sale as products. Service sales never affect stock.",
  },
  {
    q: "What is shipment tracking?",
    a: "When you sell a product that needs to be shipped, generate a tracking number from the sale. Move it through pending, shipped, and delivered, and share the number with your customer.",
  },
  {
    q: "Can I print receipts?",
    a: "Yes. Every sale has a printable receipt formatted for 58mm and 80mm thermal printers. Add your business phone, address, and a custom footer in Settings.",
  },
  {
    q: "Does it work with WhatsApp?",
    a: "Yes. Share receipts, send debt reminders, and broadcast promos straight to WhatsApp. Every send opens WhatsApp with the message ready.",
  },
  {
    q: "What happens if I void a sale?",
    a: "Voiding a sale restores the stock, removes the payment records, and recomputes the customer's debt balance so later payments stay correct. Voids are logged in the activity trail.",
  },
  {
    q: "Can I delete records?",
    a: "Expenses and customers with no history can be deleted. Customers with sales or debt history are protected and cannot be deleted, so your books always stay consistent. Sales are voided rather than deleted, keeping the audit trail intact.",
  },
  {
    q: "Can I close a business?",
    a: "Yes. Owners can close a business from Settings. All records are kept, staff lose access, and you can reopen it anytime from the business switcher.",
  },
  {
    q: "Is my data safe?",
    a: "Passwords are hashed, sessions are secure, and sensitive actions are written to an audit log you can review. You can export a full backup of your data from Settings anytime.",
  },
  {
    q: "How do I get started?",
    a: "Join the waitlist, then register your business in minutes: name, business type, country, currency, and timezone. Add your products, invite your staff, and record your first sale.",
  },
];

export function FaqPage() {
  const [open, setOpen] = useState(-1);
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap narrow" style={{ margin: "0 auto" }}>
          <span className="eyebrow">FAQ</span>
          <h1>Questions, answered.</h1>
          <p className="lead">Everything merchants ask about KopaBook, in one place.</p>
          <div className="faq">
            {FAQS.map((f, i) => (
              <details key={i} open={open === i} onToggle={(e) => setOpen(e.target.open ? i : -1)}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <a href="/waitlist" className="btn btn-primary">Join the waitlist</a>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

export function HotelsLandingPage() {
  return (
    <div className="page">
      <MNav />
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">KopaBook for Hotels</span>
          <h1>Run your whole hotel<br />from one dashboard.</h1>
          <p className="lead">
            Rooms, bookings, guest folios and billing in one simple app your front desk
            learns in an afternoon. Built for hotels, guest houses and lodges everywhere.
          </p>
          <div className="hero-cta">
            <a href="/hotels/register" className="btn btn-primary">Register your hotel — free</a>
            <a href="/login" className="btn btn-secondary">Sign in</a>
          </div>
          <p className="hero-proof">Free to start. Your data stays yours, backed up to your own storage.</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Full hotel operations, without the complexity</h2>
          <p className="sub">Everything the front desk needs, nothing it does not.</p>
          <div className="grid">
            <div className="card"><div className="icon">🛏️</div><h3>Room board</h3><p>See every room at a glance: vacant, occupied, reserved or under maintenance. One tap to book or service a room.</p></div>
            <div className="card"><div className="icon">📅</div><h3>Bookings that protect you</h3><p>Reservations with guest details and ID. Double bookings are blocked automatically.</p></div>
            <div className="card"><div className="icon">🧾</div><h3>Guest folios</h3><p>Room charges post automatically. Add restaurant, bar, laundry and transport, then record payments against the bill.</p></div>
            <div className="card"><div className="icon">💳</div><h3>Checkout in seconds</h3><p>Record the balance as it is settled by cash, transfer or POS, and the room frees up instantly. KopaBook never touches the money, it only keeps the record.</p></div>
            <div className="card"><div className="icon">📊</div><h3>Know your occupancy</h3><p>Live occupancy rate, arrivals and departures today, in-house guests and cash collected.</p></div>
            <div className="card"><div className="icon">💾</div><h3>Backups included</h3><p>One-tap full backups of your entire hotel data to your own cloud storage.</p></div>
          </div>
        </div>
      </section>

      <section className="section section-band" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <h2>Get running today</h2>
          <div className="steps narrow" style={{ margin: "30px auto" }}>
            <div className="step"><div className="n">1</div><div><strong>Register your hotel.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Hotel name, your details, done in two minutes.</p></div></div>
            <div className="step"><div className="n">2</div><div><strong>Add your rooms.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Room numbers, types and nightly rates.</p></div></div>
            <div className="step"><div className="n">3</div><div><strong>Take bookings.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Check guests in, post charges, check out. That is the whole job.</p></div></div>
          </div>
          <div style={{ textAlign: "center" }}>
            <a href="/hotels/register" className="btn btn-primary">Register your hotel — free</a>
          </div>
        </div>
      </section>
      <MFooter />
    </div>
  );
}
