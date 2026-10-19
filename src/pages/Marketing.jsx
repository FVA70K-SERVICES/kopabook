import { useState, useEffect } from "react";
import { api, nav } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/Logo";

function MNav() {
  const [open, setOpen] = useState(false);
  const links = [
    ["Features", "/features"],
    ["Hotels", "/hotels"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
    ["FAQ", "/faq"],
  ];
  return (
    <header className="mnav">
      <div className="wrap mnav-inner">
        <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
        <nav className="mnav-links">
          {links.map(([label, href]) => <a key={href} href={href} className="hide-m">{label}</a>)}
          <a href="/login" className="hide-m">Sign in</a>
          <ThemeToggle />
          <a href="/register" className="btn btn-primary btn-sm hide-m">Start free</a>
          <button className="mnav-menu-btn" onClick={() => setOpen(!open)} aria-label="Open menu" aria-expanded={open}>☰</button>
        </nav>
      </div>
      {open && (
        <nav className="mnav-dropdown" aria-label="Mobile menu">
          {links.map(([label, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
          <a href="/login" onClick={() => setOpen(false)}>Sign in</a>
          <a href="/register" className="btn btn-primary" onClick={() => setOpen(false)}>Start free</a>
        </nav>
      )}
    </header>
  );
}

function MFooter() {
  return (
    <footer className="mfooter">
      <div className="wrap">
        <div>
          <div className="brand"><Logo /></div>
          <p>Simple sales, stock and debt tracking for businesses everywhere.<br />Owned by Fortune Godson. Built by FVA70K Services.<br /><a href="mailto:info@kopabook.com">info@kopabook.com</a></p>
        </div>
        <div>
          <a href="/features">Features</a> · <a href="/pricing">Pricing</a> ·{" "}
          <a href="/about">About</a> · <a href="/faq">FAQ</a> ·{" "}
          <a href="/login">Sign in</a>
        </div>
        <div style={{ marginTop: 8 }}>
          <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a> ·{" "}
          <a href="/refund">Refund Policy</a>
        </div>
      </div>
    </footer>
  );
}

const HERO_CSS = `
.hero-premium { position: relative; overflow: hidden; }
.hero-bg { position: absolute; inset: 0; pointer-events: none; }
.hero-grid {
  position: absolute; inset: 0;
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(ellipse 72% 62% at 50% 28%, #000 25%, transparent 78%);
  mask-image: radial-gradient(ellipse 72% 62% at 50% 28%, #000 25%, transparent 78%);
  opacity: .45;
}
.blob { position: absolute; border-radius: 9999px; filter: blur(90px); }
.blob.b1 { width: 540px; height: 540px; top: -170px; left: -130px; background: radial-gradient(circle, var(--brand) 0%, transparent 66%); opacity: .30; animation: kb-drift1 15s ease-in-out infinite; }
.blob.b2 { width: 470px; height: 470px; top: -90px; right: -150px; background: radial-gradient(circle, var(--gold) 0%, transparent 66%); opacity: .24; animation: kb-drift2 19s ease-in-out infinite; }
.blob.b3 { width: 640px; height: 420px; bottom: -200px; left: 50%; margin-left: -320px; background: radial-gradient(ellipse, var(--brand) 0%, transparent 66%); opacity: .16; }
.hero-inner { position: relative; z-index: 1; }
.reveal { opacity: 0; animation: kb-rise .85s cubic-bezier(.16,.7,.3,1) forwards; }
.grad-text { background: linear-gradient(95deg, var(--brand) 5%, var(--gold) 55%, var(--brand) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.pulse-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #22c55e; margin-right: 9px; vertical-align: 1px; animation: kb-pulse-dot 2.2s ease-out infinite; }
.btn-shine { position: relative; overflow: hidden; transition: transform .18s ease, box-shadow .18s ease; }
.btn-shine:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(21,128,61,.35); }
.btn-shine::after { content: ""; position: absolute; top: -10%; bottom: -10%; width: 55%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent); transform: translateX(-160%) skewX(-18deg); animation: kb-shine 3.4s ease-in-out infinite; }
.phone-stage { display: flex; justify-content: center; margin-top: 48px; perspective: 1400px; }
.phone-float { animation: kb-float 7s ease-in-out infinite; }
.phone-tilt { position: relative; transform: rotateY(var(--px, 0deg)) rotateX(var(--py, 0deg)); transition: transform .25s ease-out; transform-style: preserve-3d; }
.float-chip { position: absolute; display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; font-size: 13px; font-weight: 700; color: var(--ink); box-shadow: 0 16px 40px rgba(20,35,26,.16); white-space: nowrap; z-index: 2; animation: kb-float-chip 5.5s ease-in-out infinite; }
.chip-a { top: 14%; left: -200px; }
.chip-b { bottom: 20%; right: -210px; animation-delay: 1.1s; }
.chip-tick { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--brand); color: #fff; font-size: 12px; flex: 0 0 auto; }
.stats-strip { display: flex; justify-content: center; gap: 42px; flex-wrap: wrap; margin-top: 30px; padding: 24px 0 4px; border-top: 1px solid var(--line); }
.stat { text-align: center; min-width: 130px; }
.stat-val { font-weight: 800; font-size: 27px; letter-spacing: -0.5px; }
.stat-label { font-size: 13px; color: var(--muted); margin-top: 3px; }
.marquee { overflow: hidden; margin-top: 34px; -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); }
.marquee-track { display: inline-flex; white-space: nowrap; will-change: transform; animation: kb-scroll-x 32s linear infinite; }
.marquee:hover .marquee-track { animation-play-state: paused; }
.mq-item { display: inline-flex; align-items: center; gap: 9px; margin-right: 10px; font-size: 13px; font-weight: 600; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; }
.mq-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); flex: 0 0 auto; }
@keyframes kb-rise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes kb-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
@keyframes kb-float-chip { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
@keyframes kb-drift1 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(70px, 45px) scale(1.12); } }
@keyframes kb-drift2 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-80px, -35px) scale(1.1); } }
@keyframes kb-shine { 0% { transform: translateX(-160%) skewX(-18deg); } 55%, 100% { transform: translateX(260%) skewX(-18deg); } }
@keyframes kb-scroll-x { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes kb-pulse-dot { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
[data-theme="dark"] .blob.b1 { opacity: .38; }
[data-theme="dark"] .blob.b2 { opacity: .30; }
[data-theme="dark"] .blob.b3 { opacity: .22; }
[data-theme="dark"] .hero-grid { opacity: .30; }
@media (max-width: 980px) { .float-chip { display: none; } }
@media (prefers-reduced-motion: reduce) {
  .hero-premium .reveal { animation: none; opacity: 1; }
  .hero-premium .phone-float, .hero-premium .blob, .hero-premium .btn-shine::after, .hero-premium .marquee-track, .hero-premium .float-chip, .hero-premium .pulse-dot { animation: none !important; }
}
`;

const MARQUEE_ITEMS = ["Fast sales", "Stock control", "Debt tracking", "WhatsApp receipts", "Staff roles", "Daily reports", "Project accountability", "Free forever plan"];

// ---- Everything inside KopaBook: showcase data (matches production code) ----
const MODULES = [
  { icon: "\uD83D\uDCCA", name: "Dashboard", access: "free", desc: "Your whole day at a glance. Today's sales, today's expenses, what customers owe you, products running low, and your latest sales, computed from your real records in your timezone.", bestFor: "Every merchant, every morning." },
  { icon: "\uD83E\uDDFE", name: "Sales recording", access: "free", desc: "A sale in under 5 taps. Search the product, set the quantity, record how the customer paid. Stock deducts the moment you save, and partial payments automatically become debts.", bestFor: "Shop attendants and owners at the counter." },
  { icon: "\uD83D\uDCE6", name: "Products and stock", access: "free", desc: "Products and services with units of measure like piece, kg or litre. Every sale, adjustment and opening balance writes to your stock ledger, with low-stock alerts before your shelf runs empty.", bestFor: "Anyone who buys and resells goods." },
  { icon: "\uD83D\uDC65", name: "Customers and debts", access: "free", desc: "Customer records with a running debt ledger each. Customers can pay bit by bit, and overpayments come back as change, never negative debt.", bestFor: "Merchants who sell on trust and credit." },
  { icon: "\uD83D\uDCB8", name: "Expenses", access: "free", desc: "Log daily expenses by category in seconds and see exactly what leaves the business.", bestFor: "Owners watching their margins." },
  { icon: "\uD83E\uDDFB", name: "Receipts", access: "free", desc: "Share a receipt with any customer on WhatsApp, or download, save and copy it as a clean PNG image. Printable formats for 58mm and 80mm thermal printers too.", bestFor: "Every sale that needs proof." },
  { icon: "\uD83D\uDCD3", name: "Notebook", access: "free", desc: "Your paper book, inside the app. Shared notes the whole team sees, plus private notes only you see, written like real book pages.", bestFor: "Teams that run on shared notes." },
  { icon: "\uD83D\uDCE3", name: "Messages", access: "free", desc: "Broadcast promos and new products to your customers on WhatsApp, and send quick notes to staff. On the free plan every send opens WhatsApp with your message ready, and you press send.", bestFor: "Promos, announcements and staff updates." },
  { icon: "\uD83E\uDDD1\u200D\uD83D\uDCBC", name: "Staff and roles", access: "free", desc: "Partner, manager, accountant, cashier, storekeeper, attendant and hotel roles. Each role sees only its own workspace, with discount limits and full control for you.", bestFor: "Shops with attendants and teams." },
  { icon: "\uD83C\uDFE2", name: "Many businesses, one account", access: "free", desc: "Own several businesses and switch between them instantly with one login. Each keeps its own staff, sales, stock and records, completely separate.", bestFor: "Owners running more than one shop." },
  { icon: "\uD83C\uDFED", name: "Suppliers", access: "free", desc: "Keep supplier records linked to your stock, so you know exactly who to call when it is time to restock.", bestFor: "Shops that buy from wholesalers." },
  { icon: "\uD83E\uDDEE", name: "Calculator", access: "free", desc: "Quick business math with history and memory, right inside the app. No need to leave for another tool.", bestFor: "Fast totals at the counter." },
  { icon: "\uD83D\uDCDC", name: "Activity log", access: "free", desc: "An audit trail of important actions across your business, so you always know who did what.", bestFor: "Owners who want full visibility." },
  { icon: "\uD83D\uDCAC", name: "Website chatbot and Chat Center", access: "free", desc: "Your business gets its own chatbot that answers customers on your connected website. Turn it on or off per business, take over any chat from the Chat Center, and let smart replies draft answers for you.", bestFor: "Businesses with a website or online customers." },
  { icon: "\uD83E\uDD16", name: "Ask Kopa AI", access: "tiered", desc: "Your business assistant in chat. Ask about your sales, stock and debts in plain words. Free answers 5 questions a day. Paid plans let Kopa record sales, add expenses and draft debtor messages for you, within daily limits.", bestFor: "Owners who want answers without digging." },
  { icon: "\uD83D\uDE9A", name: "Shipments", access: "paid", tiers: "Solo and Pro", desc: "Generate a tracking number when a sold product ships. Move it from pending to shipped to delivered, and share the number with your customer.", bestFor: "Vendors who waybill goods." },
  { icon: "\uD83C\uDFE8", name: "Hotel module", access: "paid", tiers: "Solo and Pro", desc: "Rooms, bookings, guest folios, extra charges and payments, built for hotels, guest houses and lodges.", bestFor: "Hotels and guest houses." },
  { icon: "\uD83D\uDD14", name: "WhatsApp debt reminders", access: "paid", tiers: "Starter, Solo and Pro", desc: "Send polite debt reminders straight to WhatsApp, drafted from each customer's real balance.", bestFor: "Anyone tired of chasing payments." },
  { icon: "\uD83D\uDCC8", name: "Full reports", access: "paid", tiers: "Starter, Solo and Pro", desc: "Profit trend over time, best sellers, slow movers, payment breakdown and date-range summaries, with one-tap CSV export.", bestFor: "Owners making restock and pricing decisions." },
  { icon: "\uD83D\uDCE5", name: "CSV import", access: "paid", tiers: "Starter, Solo and Pro", desc: "Import marketplace sales reports from CSV files, so your Jumia and Konga sales land in your books automatically.", bestFor: "Sellers on online marketplaces." },
  { icon: "\uD83D\uDCCB", name: "Projects", access: "paid", tiers: "Starter, Solo and Pro", desc: "Full accountability for any project. Record every income and expense, track milestones, then generate a complete report showing exactly where every naira went.", bestFor: "Anyone handling project money." },
];

function TierBadge(props) {
  var access = props.access; var tiers = props.tiers;
  var label = "Free forever"; var fg = "#15803d"; var bg = "#f0fdf4";
  if (access === "paid") { label = "Paid plans" + (tiers ? ": " + tiers : ""); fg = "#b45309"; bg = "#fefce8"; }
  else if (access === "tiered") { label = "Free plus paid plans"; fg = "#1d4ed8"; bg = "#eff6ff"; }
  return <span className="tier-badge" style={{ color: fg, background: bg, border: "1px solid " + fg + "55" }}>{label}</span>;
}

const SHOWCASE_CSS = `
.tier-badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px; margin: 8px 0 10px; }
.showcase-tabs { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 28px 0 6px; }
.showcase-tab { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.showcase-tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tour-panel { display: grid; grid-template-columns: 300px 1fr; gap: 36px; align-items: center; margin: 26px auto 8px; max-width: 920px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 30px; }
.tour-visual { display: flex; justify-content: center; }
.tour-bullets { margin: 14px 0 0; padding-left: 20px; color: var(--muted); }
.tour-bullets li { margin-bottom: 8px; }
.tour-bar-row { display: flex; align-items: flex-end; gap: 8px; height: 110px; margin-top: 10px; }
.tour-bar { flex: 1; background: linear-gradient(180deg, #16a34a, #15803d); border-radius: 6px 6px 0 0; }
.chat-u { background: #15803d; color: #fff; border-radius: 14px 14px 4px 14px; padding: 10px 12px; font-size: 13px; margin: 8px 0 8px 34px; }
.chat-a { background: #f0fdf4; color: #14532d; border-radius: 14px 14px 14px 4px; padding: 10px 12px; font-size: 13px; margin: 8px 34px 8px 0; }
.role-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 9px 0; border-bottom: 1px solid #f0f0f0; }
.role-tag { font-size: 11px; font-weight: 700; background: #f0fdf4; color: #15803d; border-radius: 999px; padding: 3px 10px; }
.stock-tag { display: inline-block; font-size: 11px; font-weight: 700; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 3px 10px; margin-left: 8px; }
.stock-ok { display: inline-block; font-size: 11px; font-weight: 700; background: #f0fdf4; color: #15803d; border-radius: 999px; padding: 3px 10px; margin-left: 8px; }
.compare-wrap { overflow-x: auto; margin-top: 26px; border: 1px solid var(--line); border-radius: 14px; }
.compare-table { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 660px; }
.compare-table th, .compare-table td { padding: 11px 14px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
.compare-table thead th { background: var(--surface); font-weight: 800; }
.compare-table tbody tr:last-child th, .compare-table tbody tr:last-child td { border-bottom: none; }
.tick-y { color: #15803d; font-weight: 800; font-size: 16px; }
.tick-n { color: var(--muted); font-weight: 700; }
@media (max-width: 760px) { .tour-panel { grid-template-columns: 1fr; padding: 22px; } }
`;

function MiniPhone(props) {
  return (
    <div style={{ width: 280, maxWidth: "78vw", borderRadius: 32, border: "9px solid #111", background: "#fff", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.16)", textAlign: "left" }}>
      <div style={{ background: "#15803d", color: "#fff", padding: "12px 14px" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>KopaBook</div>
        <div style={{ fontSize: 11, opacity: 0.9 }}>Demo Provisions Store</div>
      </div>
      <div style={{ padding: 12, minHeight: 290, color: "#111" }}>{props.children}</div>
    </div>
  );
}

const TOUR_TABS = [
  { id: "sell", label: "Sell", icon: "\uD83E\uDDFE", title: "Record a sale in under 5 taps", access: "free",
    desc: "The cart builder finds your product as you type. Set the quantity, record how the customer paid, and save. That is the whole job.",
    bullets: ["Product search with quantity steppers", "Cash, transfer and your own payment methods", "Partial payments become debts on their own"],
    phone: (<div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Rice x2 <span style={{ float: "right", fontWeight: 700 }}>&#8358;1,000</span></div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Palm Oil x1 <span style={{ float: "right", fontWeight: 700 }}>&#8358;1,200</span></div>
      <div style={{ fontSize: 13, padding: "9px 0" }}>Beans x1 <span style={{ float: "right", fontWeight: 700 }}>&#8358;800</span></div>
      <div style={{ marginTop: 12, background: "#15803d", color: "#fff", textAlign: "center", padding: 10, borderRadius: 10, fontWeight: 700, fontSize: 14 }}>+ Record sale</div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Cash &#183; change &#8358;0</div>
    </div>) },
  { id: "stock", label: "Stock", icon: "\uD83D\uDCE6", title: "Stock that tracks itself", access: "free",
    desc: "Add a product once with its price and quantity. From then on KopaBook deducts stock with every sale and warns you before anything runs out.",
    bullets: ["Units of measure: piece, kg, litre and more", "Every movement written to your stock ledger", "Low-stock alerts before the shelf runs empty"],
    phone: (<div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Rice <span className="stock-ok">48 pcs</span></div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Palm Oil <span className="stock-ok">12 litres</span></div>
      <div style={{ fontSize: 13, padding: "9px 0" }}>Beans <span className="stock-tag">Low: 3 pcs</span></div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Every sale deducts stock by itself.</div>
    </div>) },
  { id: "owed", label: "Debts", icon: "\uD83D\uDC65", title: "Never lose track of who owes you", access: "free",
    desc: "When a customer does not pay in full, the balance becomes a debt on their name. You always know exactly who owes what.",
    bullets: ["A running debt ledger per customer", "Customers pay back bit by bit", "Overpayments return as change, never negative debt"],
    phone: (<div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Mama Nkechi <span style={{ float: "right", fontWeight: 700 }}>&#8358;4,500</span></div>
      <div style={{ fontSize: 13, padding: "9px 0", borderBottom: "1px solid #f0f0f0" }}>Emeka <span style={{ float: "right", fontWeight: 700 }}>&#8358;1,700</span></div>
      <div style={{ fontSize: 13, padding: "9px 0" }}>Aisha <span style={{ float: "right", fontWeight: 700, color: "#15803d" }}>Paid up</span></div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Partial payments tracked bit by bit.</div>
    </div>) },
  { id: "reports", label: "Reports", icon: "\uD83D\uDCC8", title: "See your business clearly", access: "paid", tiers: "Starter, Solo and Pro",
    desc: "Your numbers turned into plain answers: what made money, what moved fastest, what is sitting still, and how customers paid.",
    bullets: ["Profit trend, best sellers and slow movers", "Payment breakdown and date-range summaries", "One-tap CSV export of any report"],
    phone: (<div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Profit this week</div>
      <div className="tour-bar-row">
        <div className="tour-bar" style={{ height: "40%" }} />
        <div className="tour-bar" style={{ height: "65%" }} />
        <div className="tour-bar" style={{ height: "52%" }} />
        <div className="tour-bar" style={{ height: "85%" }} />
        <div className="tour-bar" style={{ height: "100%" }} />
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Best sellers, slow movers, CSV export.</div>
    </div>) },
  { id: "team", label: "Team", icon: "\uD83E\uDDD1\u200D\uD83D\uDCBC", title: "Staff without chaos", access: "free",
    desc: "Give attendants exactly what they need to work and nothing more. You keep products, settings and money matters to yourself.",
    bullets: ["Partner, manager, accountant, cashier, storekeeper, attendant and hotel roles", "Discount limits and shift control", "Suspend or remove anyone instantly"],
    phone: (<div>
      <div className="role-row"><span>Amara (you)</span><span className="role-tag">Owner</span></div>
      <div className="role-row"><span>Chidi</span><span className="role-tag">Cashier</span></div>
      <div className="role-row"><span>Fatima</span><span className="role-tag">Storekeeper</span></div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Each role sees only its own workspace.</div>
    </div>) },
  { id: "ai", label: "Kopa AI", icon: "\uD83E\uDD16", title: "Ask about your business in plain words", access: "tiered",
    desc: "Ask Kopa how today went, what is low on stock, or who owes you. On paid plans Kopa does the recording too, just by chatting.",
    bullets: ["Free: 5 questions a day, read-only", "Starter: 20 a day, Kopa can record sales and expenses", "Solo and Pro: 50 to 100 a day with every tool"],
    phone: (<div>
      <div className="chat-u">How did we do today?</div>
      <div className="chat-a">You made &#8358;24,500 from 18 sales. Mama Nkechi still owes &#8358;4,500.</div>
      <div className="chat-u">Record sale: Rice x2, cash</div>
      <div className="chat-a">Done. Sale saved and stock updated.</div>
    </div>) },
];

function ShowcaseTour() {
  const [active, setActive] = useState("sell");
  const tab = TOUR_TABS.find((t) => t.id === active) || TOUR_TABS[0];
  return (
    <div id="kb-showcase-tour">
      <div className="showcase-tabs" role="tablist" aria-label="KopaBook tour">
        {TOUR_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={"showcase-tab" + (active === t.id ? " active" : "")} onClick={() => setActive(t.id)}>
            <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      <div className="tour-panel">
        <div className="tour-visual"><MiniPhone>{tab.phone}</MiniPhone></div>
        <div>
          <h3 style={{ marginTop: 0 }}>{tab.title}</h3>
          <TierBadge access={tab.access} tiers={tab.tiers} />
          <p style={{ color: "var(--muted)" }}>{tab.desc}</p>
          <ul className="tour-bullets">{tab.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      </div>
      <style>{SHOWCASE_CSS}</style>
    </div>
  );
}


export function LandingPage() {
  useEffect(() => {
    var hero = document.getElementById("kb-hero");
    var phone = document.getElementById("kb-phone");
    var fine = window.matchMedia("(pointer: fine) and (min-width: 768px)").matches;
    if (!hero || !phone || !fine) return;
    var raf = 0;
    var onMove = function (e) {
      var r = phone.getBoundingClientRect();
      var cx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
      var cy = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        phone.style.setProperty("--px", (cx * 12).toFixed(2) + "deg");
        phone.style.setProperty("--py", (cy * -9).toFixed(2) + "deg");
      });
    };
    var onLeave = function () {
      phone.style.setProperty("--px", "0deg");
      phone.style.setProperty("--py", "0deg");
    };
    hero.addEventListener("mousemove", onMove);
    hero.addEventListener("mouseleave", onLeave);
    return function () {
      hero.removeEventListener("mousemove", onMove);
      hero.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  useEffect(() => {
    var el = document.getElementById("kb-count");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var target = 5;
    var started = false;
    var run = function () {
      started = true;
      el.textContent = "0";
      var dur = 900;
      var t0 = performance.now();
      var tick = function (t) {
        var p = Math.min(1, (t - t0) / dur);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === "undefined") { run(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !started) { io.disconnect(); run(); }
      });
    }, { threshold: 0.5 });
    io.observe(el);
    return function () { io.disconnect(); };
  }, []);
  return (
    <div className="page">
      <MNav />
            <section className="hero hero-premium" id="kb-hero">
        <div className="hero-bg" aria-hidden="true">
          <span className="hero-grid" />
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
        </div>
        <div className="wrap hero-inner">
          <span className="eyebrow reveal" style={{ animationDelay: "0ms" }}><span className="pulse-dot" />Free forever plan. No card needed.</span>
          <h1 className="reveal" style={{ animationDelay: "90ms" }}>Know your sales, stock and debts.<br /><span className="grad-text">Every single day.</span></h1>
          <p className="lead reveal" style={{ animationDelay: "180ms" }}>
            KopaBook replaces the paper notebook with one simple app on your phone.
            Record sales in seconds, watch your stock move, and always know who owes you.
            Free to start, works on any phone.
          </p>
          <div className="hero-cta reveal" style={{ animationDelay: "270ms" }}>
            <a href="/register" className="btn btn-primary btn-shine">Start free</a>
            <a href="#how-it-works" className="btn btn-secondary" onClick={(e) => { e.preventDefault(); var el = document.getElementById("how-it-works"); if (el) { el.scrollIntoView({ behavior: "smooth" }); } }}>See how it works</a>
          </div>
          <div className="phone-stage reveal" style={{ animationDelay: "360ms" }}>
            <div className="phone-float">
              <div className="phone-tilt" id="kb-phone">
                <div className="float-chip chip-a"><span className="chip-tick">✓</span>Sale recorded · Rice x2</div>
                <div className="float-chip chip-b"><span className="chip-tick">✓</span>Debt reminder sent</div>
                <div style={{ width: 300, maxWidth: "86vw", borderRadius: 36, border: "10px solid #111", background: "#fff", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.18), 0 0 90px rgba(21,128,61,0.22)", textAlign: "left" }}>
                  <div style={{ background: "#15803d", color: "#fff", padding: "14px 16px" }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Demo Provisions Store</div>
                    <div style={{ fontSize: 12, opacity: 0.9 }}>Today at a glance</div>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontSize: 11, color: "#666" }}>Sales today</div>
                        <div style={{ fontWeight: 800, fontSize: 18 }}>&#8358;4,000</div>
                      </div>
                      <div style={{ background: "#fefce8", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontSize: 11, color: "#666" }}>Owed to you</div>
                        <div style={{ fontWeight: 800, fontSize: 18 }}>&#8358;1,700</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Recent sales</div>
                    <div style={{ fontSize: 13, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>Rice x2 &#183; &#8358;1,000</div>
                    <div style={{ fontSize: 13, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>Palm Oil x1 &#183; &#8358;1,200</div>
                    <div style={{ fontSize: 13, padding: "8px 0" }}>Beans x1 &#183; &#8358;800</div>
                    <div style={{ marginTop: 12, background: "#15803d", color: "#fff", textAlign: "center", padding: 10, borderRadius: 10, fontWeight: 700, fontSize: 14 }}>+ Record sale</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="hero-proof reveal" style={{ animationDelay: "450ms" }}>Made for provision stores, phone sellers, fashion vendors and market traders.</p>
          <div className="stats-strip reveal" style={{ animationDelay: "540ms" }}>
            <div className="stat"><div className="stat-val">Free</div><div className="stat-label">to start, no card needed</div></div>
            <div className="stat"><div className="stat-val"><span id="kb-count">5</span> taps</div><div className="stat-label">to record a sale</div></div>
            <div className="stat"><div className="stat-val">Any phone</div><div className="stat-label">works in your browser</div></div>
          </div>
          <div className="marquee reveal" style={{ animationDelay: "620ms" }} aria-hidden="true">
            <div className="marquee-track">
              {MARQUEE_ITEMS.concat(MARQUEE_ITEMS).map((t, i) => (
                <span className="mq-item" key={i}><span className="mq-dot" />{t}</span>
              ))}
            </div>
          </div>
        </div>
        <style>{HERO_CSS}</style>
      </section>

            <section className="section" id="kb-showcase">
        <div className="wrap">
          <h2>Everything inside KopaBook</h2>
          <p className="sub">Every tool in the real app, explained plainly. Take the tour, then browse the full list. Green means free forever, gold means paid plans.</p>
          <ShowcaseTour />
          <div className="grid" style={{ marginTop: 44 }}>
            {MODULES.map((m) => (
              <div className="card" key={m.name}>
                <div className="icon">{m.icon}</div>
                <h3>{m.name}</h3>
                <TierBadge access={m.access} tiers={m.tiers} />
                <p>{m.desc}</p>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 0 }}><strong>Best for:</strong> {m.bestFor}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 28 }}>
            <a href="/pricing" className="btn btn-secondary">Compare plans and pricing</a>
          </div>
        </div>
      </section>

<section id="how-it-works" className="section section-band" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <h2>See how KopaBook works for your shop</h2>
          <p className="sub" style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 30px" }}>Watch the 5-minute tour below. If you can use WhatsApp, you can use KopaBook.</p>
          <div style={{ maxWidth: 760, margin: "0 auto 40px" }}>
            <video
              controls
              preload="metadata"
              playsInline
              src="https://pub-9febb8d034344470ae8c0f7493a261f9.r2.dev/kopabook-walkthrough-FINAL.mp4"
              style={{ width: "100%", display: "block", borderRadius: 12, aspectRatio: "16 / 9", background: "#000", border: "1px solid var(--line)" }}
            >
              Sorry, your browser cannot play this video. Watch it on YouTube: https://youtu.be/tII6wBaWhqE?is=CcsYga-K99LgyezC
            </video>
          </div>
          <h3 style={{ textAlign: "center", marginBottom: 24 }}>Three steps and you are set</h3>
          <div className="steps narrow" style={{ margin: "0 auto 40px" }}>
            <div className="step"><div className="n">1</div><div><strong>Create your free account.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Sign up in under a minute. No card, no payment, your shop is open.</p></div></div>
            <div className="step"><div className="n">2</div><div><strong>Add your products.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Name, price, how many you have. You do it once and KopaBook remembers.</p></div></div>
            <div className="step"><div className="n">3</div><div><strong>Record sales daily.</strong><p style={{ margin: "4px 0 0", color: "var(--muted)" }}>Each sale takes seconds. Stock, debts and profit update by themselves.</p></div></div>
          </div>
          <h3 style={{ textAlign: "center", marginBottom: 24 }}>What you get from day one</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 40 }}>
            <div className="card"><div className="icon">📊</div><h3>Know your daily profit</h3><p>Sales minus expenses, every day, without touching a calculator.</p></div>
            <div className="card"><div className="icon">📒</div><h3>See who owes you</h3><p>Every debtor and balance in one list, with reminders straight to WhatsApp.</p></div>
            <div className="card"><div className="icon">📦</div><h3>Know before stock finishes</h3><p>Low-stock alerts tell you what to buy before your shelf is empty.</p></div>
            <div className="card"><div className="icon">🧾</div><h3>Share receipts on WhatsApp</h3><p>Send a proper receipt image to any customer in one tap.</p></div>
          </div>
          <div style={{ textAlign: "center" }}>
            <a href="/register" className="btn btn-primary">Start free</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
      <section className="section section-band" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <h2>Simple pricing</h2>
          <p className="sub">Start free. Upgrade only when your shop grows.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div className="card"><h3>Free</h3><div style={{ fontSize: 26, fontWeight: 800, margin: "8px 0" }}>&#8358;0</div><p>1 business, 1 staff. Sales, stock and debts, free forever.</p></div>
            <div className="card"><h3>Starter</h3><div style={{ fontSize: 26, fontWeight: 800, margin: "8px 0" }}>&#8358;1,000<span style={{ fontSize: 14, fontWeight: 400 }}>/mo</span></div><p>For growing shops. More products, more staff, a taste of Kopa AI.</p></div>
            <div className="card" style={{ border: "2px solid #15803d" }}><h3>Solo</h3><div style={{ fontSize: 26, fontWeight: 800, margin: "8px 0" }}>&#8358;5,000<span style={{ fontSize: 14, fontWeight: 400 }}>/mo</span></div><p>Kopa AI does the work. Ask anything, record sales by chatting.</p></div>
            <div className="card"><h3>Pro</h3><div style={{ fontSize: 26, fontWeight: 800, margin: "8px 0" }}>&#8358;10,000<span style={{ fontSize: 14, fontWeight: 400 }}>/mo</span></div><p>Everything unlimited. For serious businesses with teams.</p></div>
          </div>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <a href="/pricing" className="btn btn-secondary">See full pricing</a>
          </div>
        </div>
      </section>

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
      <section className="section section-band" style={{ borderTop: "1px solid var(--line)", textAlign: "center" }}>
        <div className="wrap">
          <h2>Your shop deserves better than a paper notebook.</h2>
          <p className="sub">Join KopaBook free today. Set up in minutes, no card needed.</p>
          <a href="/register" className="btn btn-primary" style={{ fontSize: 18, padding: "14px 40px" }}>Start free</a>
          <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 14 }}>Built for Nigerian market traders, shops and artisans.</p>
        </div>
      </section>
      <MFooter />
    </div>
  );
}

export function FeaturesPage() {
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap">
          <h2>Everything in KopaBook</h2>
          <p className="sub">Every tool in the real app, explained plainly. Designed around how local merchants actually work: transfers, WhatsApp orders, walk-ins and trust-based credit. Green means free forever, gold means paid plans.</p>
          <div className="grid">
            {MODULES.map((m) => (
              <div className="card" key={m.name}>
                <div className="icon">{m.icon}</div>
                <h3>{m.name}</h3>
                <TierBadge access={m.access} tiers={m.tiers} />
                <p>{m.desc}</p>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 0 }}><strong>Best for:</strong> {m.bestFor}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 36 }}>
            <a href="/register" className="btn btn-primary">Start free</a>
          </div>
        </div>
      </section>
      <style>{SHOWCASE_CSS}</style>
      <MFooter />
    </div>
  );
}

export function PricingPage() {
  function cell(v) {
    if (v === 1) return <span className="tick-y">{"\u2713"}</span>;
    if (v === 0) return <span className="tick-n">{"\u2715"}</span>;
    return v;
  }
  const head = ["", "Free", "Starter", "Solo", "Pro"];
  const rows = [
    ["Price per month", "NGN 0", "NGN 1,000", "NGN 5,000", "NGN 10,000"],
    ["Price per year", "NGN 0", "NGN 10,000", "NGN 50,000", "NGN 100,000"],
    ["Businesses", "1", "5", "1", "Unlimited"],
    ["Sales per week, per business", "100", "1,000", "Unlimited", "Unlimited"],
    ["Products and services, per business", "100", "1,000", "500", "Unlimited"],
    ["Staff accounts, per business", "1", "5", "3", "Unlimited"],
    ["Sales, stock, customers, debts, expenses", 1, 1, 1, 1],
    ["Receipts, notebook and WhatsApp messages", 1, 1, 1, 1],
    ["Staff roles, activity log and chatbot", 1, 1, 1, 1],
    ["Shipments", 0, 0, 1, 1],
    ["Hotel module", 0, 0, 1, 1],
    ["WhatsApp debt reminders", 0, 1, 1, 1],
    ["Full reports with CSV export", 0, 1, 1, 1],
    ["CSV import", 0, 1, 1, 1],
    ["Projects", 0, 1, 1, 1],
    ["Ask Kopa AI", "5 questions a day, read-only", "20 a day, plus sale, expense and reminder actions (10 actions a day)", "50 a day, all tools", "100 a day, all tools"],
  ];
  return (
    <div className="page">
      <MNav />
      <section className="section">
        <div className="wrap">
          <h2>Simple pricing</h2>
          <p className="sub">Start free. Upgrade when your business grows. Prices in Nigerian naira. Recording a sale is always free and never blocked, on any plan.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card price-card" style={{ border: "2px solid var(--brand)" }}>
              <div className="tier">Free</div>
              <div className="amount">NGN 0</div>
              <p style={{ color: "var(--muted)" }}>Free forever. For solo merchants getting organised.</p>
              <ul>
                <li>1 business</li>
                <li>100 sales per week, per business</li>
                <li>100 products and services, per business</li>
                <li>1 staff account</li>
                <li>Full records: sales, stock, customers, debts, expenses</li>
                <li>Receipts, notebook and WhatsApp messages</li>
                <li>Ask Kopa AI: 5 questions a day</li>
              </ul>
              <a href="/register" className="btn btn-primary btn-block">Get started</a>
            </div>
            <div className="card price-card">
              <div className="tier">Starter</div>
              <div className="amount">NGN 1,000</div>
              <p style={{ color: "var(--muted)" }}>Per month, or NGN 10,000 per year (2 months free). For growing shops with attendants.</p>
              <ul>
                <li>5 businesses</li>
                <li>1,000 sales per week, per business</li>
                <li>1,000 products and services, per business</li>
                <li>5 staff accounts</li>
                <li>WhatsApp debt reminders</li>
                <li>Full reports with CSV export</li>
                <li>CSV import</li>
                <li>Projects</li>
                <li>Ask Kopa AI: 20 questions a day plus actions</li>
              </ul>
              <a href="/register" className="btn btn-secondary btn-block">Start free, upgrade later</a>
            </div>
            <div className="card price-card">
              <div className="tier">Solo <span style={{ fontSize: 12, background: "#7c3aed", color: "#fff", padding: "2px 8px", borderRadius: 12 }}>AI</span></div>
              <div className="amount">NGN 5,000</div>
              <p style={{ color: "var(--muted)" }}>Per month, or NGN 50,000 per year (2 months free). Your AI business assistant.</p>
              <ul>
                <li>1 business</li>
                <li>500 products and services</li>
                <li>3 staff accounts</li>
                <li>Everything in Starter</li>
                <li>Shipment tracking</li>
                <li>Hotel operations</li>
                <li>Ask Kopa AI: 50 questions a day, all tools</li>
              </ul>
              <a href="/register" className="btn btn-secondary btn-block">Start free, upgrade later</a>
            </div>
            <div className="card price-card">
              <div className="tier">Pro</div>
              <div className="amount">NGN 10,000</div>
              <p style={{ color: "var(--muted)" }}>Per month, or NGN 100,000 per year (2 months free). For bigger businesses running multiple shops.</p>
              <ul>
                <li>Unlimited businesses</li>
                <li>Unlimited sales and products</li>
                <li>Unlimited staff accounts</li>
                <li>Everything in Solo</li>
                <li>Ask Kopa AI: 100 questions a day, all tools</li>
              </ul>
              <a href="/register" className="btn btn-secondary btn-block">Start free, upgrade later</a>
            </div>
          </div>
          <h3 style={{ marginTop: 40, textAlign: "center" }}>What each plan gets</h3>
          <div className="compare-wrap">
            <table className="compare-table">
              <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}><th>{r[0]}</th>{r.slice(1).map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 24 }}>
            <h3>How upgrading works</h3>
            <p style={{ color: "var(--muted)" }}>
              When you hit a free limit, upgrade from your settings in one tap and pay securely with
              Paystack or crypto (USDT/BTC). Monthly or yearly billing, your choice. Your new limits turn on immediately
              after payment. Recording a sale is never blocked, on any plan.
            </p>
          </div>
          <div className="card" style={{ marginTop: 24 }}>
            <h3>Add-ons, billed separately</h3>
            <p style={{ color: "var(--muted)" }}>Optional extras on top of any plan.</p>
            <ul>
              <li>Custom domain: at cost.</li>
            </ul>
          </div>
        </div>
      </section>
      <style>{SHOWCASE_CSS}</style>
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
          <div className="card" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
            <img
              src="/founder.jpg"
              alt="Fortune Godson, founder of KopaBook"
              style={{ width: 160, height: 160, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--brand)" }}
            />
            <div style={{ flex: "1 1 260px" }}>
              <h3 style={{ margin: "0 0 4px" }}>Fortune Godson</h3>
              <p className="hint" style={{ margin: "0 0 12px" }}>Founder, FVA70K Services</p>
              <p style={{ margin: 0 }}>
                Fortune started FVA70K Services to build practical tools for real businesses.
                KopaBook grew out of watching small merchants lose money to forgotten debts,
                untracked stock, and notebooks that never add up. It is designed with real
                merchants, for real merchants, one honest feature at a time.
              </p>
            </div>
          </div>
          <div style={{ marginTop: 32 }}>
            <a href="/register" className="btn btn-primary">Get started free</a>{" "}
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
    a: "Register your business in minutes: name, business type, country, currency, and timezone. Add your products, invite your staff, and record your first sale.",
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
            <a href="/register" className="btn btn-primary">Start free</a>
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
            <div className="card"><div className="icon">💾</div><h3>Backups included</h3><p>One-tap full backups of your entire hotel data to KopaBook's secure storage, downloadable anytime.</p></div>
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
