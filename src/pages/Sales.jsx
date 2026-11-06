import { useEffect, useRef, useState } from "react";
import { getCachedList, setCachedList } from "../lib/listCache";
import { ListSkeleton } from "../components/ListState";
import { api, fmt, todayISO } from "../lib/api";
import { waLink, receiptText } from "../lib/whatsapp";
import { receiptCardUrl, shareCard, downloadCard, dataUrlToBlob } from "../lib/shareCards";
import StatementPrint from "../components/StatementPrint";
import { requestStatementPrint } from "../lib/statement";
import { contactSavePatch, buildContactLines } from "../lib/receiptContacts";
import { sendEmailReceipt, sendTelegramReceipt, getTelegramBotStatus, telegramClientUrl } from "../lib/receiptSends";
import MessageSale from "../components/MessageSale";
import { ShipmentModal, ShipmentsTab } from "../components/Shipments";

export default function SalesPage({ session }) {
  const canVoid = ["owner", "partner"].includes(session?.business?.role);
  const [view, setView] = useState("new"); // new | history
  const [products, setProducts] = useState(() => { const c = getCachedList("products", session?.business?.id); return c ? c.data : []; });
  const [catalog, setCatalog] = useState("products"); // products | services
  const [services, setServices] = useState(() => { const c = getCachedList("services", session?.business?.id); return c ? c.data : []; });
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [customerPick, setCustomerPick] = useState(""); // "" = walk-in, "new" = new buyer, else customer id
  const [customerName, setCustomerName] = useState("");
  const [customers, setCustomers] = useState(() => { const c = getCachedList("customers", session?.business?.id); return c ? c.data : []; });
  const [payments, setPayments] = useState([{ mode: "Cash", amount: "" }]);
  const [payModes, setPayModes] = useState(() => { const c = getCachedList("payment-modes", session?.business?.id); return c ? c.data : []; });
  const [catalogLoading, setCatalogLoading] = useState(() => !getCachedList("products", session?.business?.id) && !getCachedList("services", session?.business?.id));
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [doneItems, setDoneItems] = useState([]);
  const [doneCustomer, setDoneCustomer] = useState("");
  const [history, setHistory] = useState([]);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [shipFor, setShipFor] = useState(null);
  const [receiptPhone, setReceiptPhone] = useState("");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [receiptTelegram, setReceiptTelegram] = useState("");
  const [bizName, setBizName] = useState(() => { const c = getCachedList("business", session?.business?.id); return c ? (c.data.name || "") : ""; });
  const [brand, setBrand] = useState(() => { const c = getCachedList("business", session?.business?.id); const b = c ? c.data : {}; return { name: b.name || "", color: b.brand_color || "#166534", tagline: b.tagline || "", contactLines: buildContactLines(b), footer: b.receipt_footer || "" }; });
  const [doneMethods, setDoneMethods] = useState([]);
  const [doneCustomerId, setDoneCustomerId] = useState(null);
  const [doneContactBlank, setDoneContactBlank] = useState({ phone: true, email: true, telegram: true });
  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState("");
  const [telegramBot, setTelegramBot] = useState(null);
  const [doneHasChatId, setDoneHasChatId] = useState(false);
  const salePanelRef = useRef(null);

  // The five lookups are independent: one parallel fetch instead of
  // five separate ones, each writing its fresh list back to the shared
  // cache so the next visit paints instantly.
  useEffect(() => {
    Promise.allSettled([
      api.get("/api/products"),
      api.get("/api/services"),
      api.get("/api/customers"),
      api.get("/api/payment-modes"),
      api.get("/api/business"),
    ]).then(([prods, svcs, custs, modesRes, bizRes]) => {
      if (prods.status === "fulfilled") { setProducts(prods.value.products || []); setCachedList("products", session?.business?.id, prods.value.products || []); }
      if (svcs.status === "fulfilled") { setServices(svcs.value.services || []); setCachedList("services", session?.business?.id, svcs.value.services || []); }
      if (custs.status === "fulfilled") { setCustomers(custs.value.customers || []); setCachedList("customers", session?.business?.id, custs.value.customers || []); }
      if (modesRes.status === "fulfilled") {
        const modes = (modesRes.value.modes || []).filter((m) => m.enabled);
        setPayModes(modes);
        setCachedList("payment-modes", session?.business?.id, modes);
        if (modes.length) setPayments([{ mode: modes[0].name, amount: "" }]);
      }
      if (bizRes.status === "fulfilled") {
        const b = bizRes.value.business || {};
        setBizName(b.name || "");
        setBrand({
          name: b.name || "",
          color: b.brand_color || "#166534",
          tagline: b.tagline || "",
          contactLines: buildContactLines(b),
          footer: b.receipt_footer || "",
        });
        setCachedList("business", session?.business?.id, b);
      }
      setCatalogLoading(false);
    });
  }, []);

  async function loadHistory() {
    setHistLoading(true);
    try {
      const d = await api.get(`/api/sales?from=${dateFilter}&to=${dateFilter}&limit=100`);
      setHistory(d.sales);
    } catch (e) { setError(e.message); }
    setHistLoading(false);
  }

  async function voidSale(id) {
    try {
      await api.del(`/api/sales/${id}`);
      loadHistory();
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (view === "history") loadHistory(); }, [view, dateFilter]);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 12);

  const serviceFiltered = services.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 12);

  function addServiceToCart(s) {
    setCart((c) => {
      const found = c.find((l) => l.serviceId === s.id);
      if (found) return c.map((l) => l.serviceId === s.id ? { ...l, qty: l.qty + 1 } : l);
      return [...c, { serviceId: s.id, name: s.name, unitPrice: Number(s.price), qty: 1 }];
    });
    setError("");
  }

  function setServiceQty(serviceId, qty) {
    setCart((c) => c.map((l) => {
      if (l.serviceId !== serviceId) return l;
      const q = Math.max(0, Number(qty) || 0);
      return { ...l, qty: q };
    }).filter((l) => l.qty > 0));
  }

  function useMessageDraft(draft) {
    const byId = new Map(products.map((p) => [p.id, p]));
    const svcById = new Map(services.map((s) => [s.id, s]));
    const lines = [];
    for (const it of draft.items) {
      if (it.serviceId) {
        const s = svcById.get(it.serviceId);
        if (!s) continue;
        lines.push({
          serviceId: s.id,
          name: s.name,
          unitPrice: Number(it.unitPrice),
          qty: Math.max(1, Number(it.quantity) || 1),
        });
        continue;
      }
      const p = byId.get(it.productId);
      if (!p) continue;
      lines.push({
        productId: p.id,
        name: p.name,
        unitPrice: Number(it.unitPrice),
        qty: Math.max(0.01, Math.min(Number(it.quantity) || 1, Number(p.stock) || 0)),
        stock: Number(p.stock),
        unit: p.unit || "piece",
      });
    }
    setCart(lines);
    if (draft.customerName) { setCustomerPick("new"); setCustomerName(draft.customerName); }
    if (draft.amountPaid !== undefined && draft.amountPaid !== "") {
      const rawMode = String(draft.paymentMethod || "Cash");
      const matched = payModes.find((m) => m.name.toLowerCase() === rawMode.toLowerCase())
        || payModes.find((m) => m.name.toLowerCase().includes(rawMode.toLowerCase()));
      setPayments([{ mode: matched ? matched.name : rawMode, amount: draft.amountPaid }]);
    }
    setError("");
    salePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    salePanelRef.current?.focus({ preventScroll: true });
  }

  function addToCart(p) {
    setCart((c) => {
      const found = c.find((l) => l.productId === p.id);
      if (found) {
        if (found.qty + 1 > Number(p.stock)) { setError(`Only ${p.stock} of ${p.name} in stock.`); return c; }
        return c.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l);
      }
      if (Number(p.stock) < 1) { setError(`${p.name} is out of stock.`); return c; }
      return [...c, { productId: p.id, name: p.name, unitPrice: Number(p.unit_price), qty: 1, stock: Number(p.stock), unit: p.unit || "piece" }];
    });
    setError("");
  }

  function setQty(productId, qty) {
    setCart((c) => c.map((l) => {
      if (l.productId !== productId) return l;
      const q = Math.max(0, Math.min(Number(qty) || 0, l.stock));
      return { ...l, qty: q };
    }).filter((l) => l.qty > 0));
  }

  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
  // WORLD-BEST (merge): change may only come from the cash portion of the
  // tender (proposal 12.3). The server refuses the sale when cash is short;
  // this warning shows it before the tap, and the button stays disabled
  // until it is fixed. A mode is cash when its kind is 'cash', or (before
  // migration 0061 runs) when its name is 'cash'.
  const changeDue = Math.max(0, Math.round((paid - total) * 100) / 100);
  const cashPaid = payModes.length === 0 ? changeDue : payments.reduce((s, p) => {
    const mode = payModes.find((m) => m.name === p.mode);
    const isCash = mode ? (mode.kind ? mode.kind === "cash" : mode.name.toLowerCase() === "cash") : p.mode.toLowerCase() === "cash";
    return s + (isCash ? (Number(p.amount) || 0) : 0);
  }, 0);
  const cashShort = changeDue > 0 && cashPaid < changeDue;

  function setPay(i, k, v) {
    setPayments((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  }
  function addPay() {
    setPayments((ps) => [...ps, { mode: payModes[0]?.name || "Cash", amount: "" }]);
  }
  function removePay(i) {
    setPayments((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ps));
  }

  async function complete() {
    if (cart.length === 0) { setError("Add at least one item."); return; }
    const pickedCustomer = customerPick && customerPick !== "new"
      ? customers.find((c) => String(c.id) === String(customerPick)) : null;
    const newName = customerPick === "new" ? customerName.trim() : "";
    if (balance > 0 && !customerPick) { setError("Unpaid balance needs a customer. Select one or add a new buyer."); return; }
    if (customerPick === "new" && !newName) { setError("Enter the new buyer's name."); return; }
    setSaving(true); setError("");
    try {
      const d = await api.post("/api/sales", {
        items: cart.map((l) => l.serviceId
          ? { serviceId: l.serviceId, quantity: l.qty, unitPrice: l.unitPrice }
          : { productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice }),
        customerId: pickedCustomer ? pickedCustomer.id : undefined,
        customerName: newName || undefined,
        payments: payments
          .filter((p) => Number(p.amount) > 0 && p.mode)
          .map((p) => ({ mode: p.mode, amount: Number(p.amount) })),
      });
      setDone(d);
      setDoneItems(cart.map((l) => ({
        qty: l.qty, name: l.name,
        unitPrice: fmt(l.unitPrice),
        lineTotal: fmt(Math.round(l.unitPrice * l.qty * 100) / 100),
        unit: l.unit || (l.serviceId ? "service" : "piece"),
      })));
      setDoneCustomer(pickedCustomer ? pickedCustomer.name : newName);
      setDoneMethods(payments.filter((pay) => Number(pay.amount) > 0).map((pay) => ({ mode: pay.mode, amount: fmt(Number(pay.amount)) })));
      setDoneCustomerId(pickedCustomer ? pickedCustomer.id : null);
      setDoneContactBlank({
        phone: !pickedCustomer?.phone,
        email: !pickedCustomer?.email,
        telegram: !pickedCustomer?.telegram,
      });
      setReceiptPhone(pickedCustomer?.phone || "");
      setReceiptEmail(pickedCustomer?.email || "");
      setReceiptTelegram(pickedCustomer?.telegram || "");
      setSendNote("");
      setTelegramBot(null);
      setDoneHasChatId(false);
      if (pickedCustomer) {
        api.get(`/api/receipts/sale?id=${d.saleId}`).then((r) => {
          setDoneHasChatId(Boolean(r.customer?.hasTelegramChatId));
          if (r.customer?.email && !receiptEmail) setReceiptEmail(r.customer.email);
          if (r.customer?.telegram && !receiptTelegram) setReceiptTelegram(r.customer.telegram);
        }).catch(() => {});
      }
      getTelegramBotStatus().then(setTelegramBot).catch(() => {});
      setCart([]); setCustomerPick(""); setCustomerName("");
      setPayments([{ mode: payModes[0]?.name || "Cash", amount: "" }]);
      const pd = await api.get("/api/products"); setProducts(pd.products); setCachedList("products", session?.business?.id, pd.products);
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  // ---- Sale recorded (done) view helpers ----
  function doneReceiptText() {
    return receiptText({
      saleNumber: done.saleNumber,
      total: fmt(done.total),
      items: doneItems,
      businessName: bizName,
      balanceDue: done.balanceDue > 0 ? fmt(done.balanceDue) : null,
      paid: fmt(done.paid),
      change: done.change > 0 ? fmt(done.change) : null,
      paidByMethod: doneMethods.length ? doneMethods : null,
      contactLines: brand.contactLines || [],
    });
  }

  function doneCardUrl() {
    return receiptCardUrl({
      saleNumber: done.saleNumber,
      date: new Date().toLocaleDateString(),
      items: doneItems,
      total: fmt(done.total),
      paid: fmt(done.paid),
      paidByMethod: doneMethods.map((m) => ({ mode: m.mode, amount: m.amount })),
      change: done.change > 0 ? fmt(done.change) : null,
      balanceDue: done.balanceDue > 0 ? fmt(done.balanceDue) : null,
      customerName: doneCustomer || null,
      contactLines: brand.contactLines || [],
      footer: brand.footer || "",
    }, brand);
  }

  // Save a contact filled in here to the picked customer, but only when
  // that field was blank before. Never overwrites. Walk-in: no customer,
  // so nothing is saved and no customer is created.
  async function saveDoneContacts() {
    if (!doneCustomerId) return;
    const patch = contactSavePatch(doneContactBlank, {
      phone: receiptPhone, email: receiptEmail, telegram: receiptTelegram,
    });
    if (!Object.keys(patch).length) return;
    try { await api.patch(`/api/customer-profile?id=${doneCustomerId}`, patch); } catch { /* never block the send */ }
  }

  function resetDone() {
    setDone(null);
    setDoneItems([]);
    setDoneCustomer("");
    setDoneMethods([]);
    setDoneCustomerId(null);
    setReceiptPhone("");
    setReceiptEmail("");
    setReceiptTelegram("");
    setSendNote("");
    setSending("");
  }

  async function sendByEmail() {
    if (!receiptEmail.trim()) return;
    setSending("email");
    setSendNote("");
    try {
      await saveDoneContacts();
      const r = await sendEmailReceipt({
        saleId: done.saleId, email: receiptEmail.trim(),
        saleNumber: done.saleNumber, businessName: bizName, text: doneReceiptText(),
      });
      setSendNote(r.via === "server" ? "Receipt email sent." : r.note || "Your mail app will open.");
      if (r.via === "mailto" && r.url) window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setSendNote(e.message || "Could not send the email.");
    }
    setSending("");
  }

  async function sendByTelegram() {
    setSending("telegram");
    setSendNote("");
    try {
      await saveDoneContacts();
      let photoBlob = null;
      try { photoBlob = dataUrlToBlob(doneCardUrl()); } catch { photoBlob = null; }
      const r = await sendTelegramReceipt({
        saleId: done.saleId, saleNumber: done.saleNumber, businessName: bizName,
        text: doneReceiptText(), photoBlob,
        customerTelegram: receiptTelegram.trim(), hasChatId: doneHasChatId,
      });
      if (r.via === "bot") {
        setSendNote(r.photoError || "Receipt sent on Telegram.");
      } else {
        if (r.needsOnboarding && r.startUrl) {
          setSendNote(`Start @${r.botUsername || "the bot"} on Telegram first, then tap send.`);
        }
        window.open(r.url, "_blank", "noopener");
      }
    } catch (e) {
      setSendNote(e.message || "Could not send on Telegram.");
    }
    setSending("");
  }

  if (done) {
    const waUrl = waLink(receiptPhone, doneReceiptText());
    const tgUrl = telegramClientUrl({ customerTelegram: receiptTelegram.trim(), text: doneReceiptText() });
    const canEmail = receiptEmail.trim().length > 0;
    const canTelegramBot = Boolean(telegramBot?.configured && doneHasChatId);
    return (
      <>
        <div className="page-head"><h1>Sale recorded</h1></div>
        <div className="card narrow" style={{ margin: "0 auto", textAlign: "center", maxWidth: 480 }}>
          <div
            aria-hidden="true"
            style={{
              width: 72, height: 72, borderRadius: "50%", margin: "8px auto 12px",
              background: brand.color || "#166534", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6.5" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 style={{ margin: "0 0 4px" }}>{done.saleNumber}</h2>
          <p className="money" style={{ fontSize: 28, margin: "0 0 4px" }}>{fmt(done.total)}</p>
          {done.balanceDue > 0
            ? <p className="debt-amt">Balance of {fmt(done.balanceDue)} recorded as debt.</p>
            : <p style={{ color: "var(--brand-dark)" }}>Fully paid. Stock updated.</p>}
          {done.change > 0 && (
            <p style={{ color: "var(--muted)", marginTop: 4 }}>Change to give: <strong>{fmt(done.change)}</strong></p>
          )}
          {doneMethods.length > 0 && (
            <p style={{ color: "var(--muted)", marginTop: 4 }}>
              Paid by {doneMethods.map((m) => `${m.mode} ${m.amount}`).join(" + ")}
            </p>
          )}

          <h3 style={{ textAlign: "left", margin: "20px 0 8px" }}>Send receipt</h3>
          <a className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}
            target="_blank" rel="noreferrer" href={waUrl}
            onClick={() => { saveDoneContacts(); }}>
            WhatsApp{receiptPhone ? ` · ${receiptPhone}` : ""}
          </a>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 44 }}
            disabled={!canEmail || sending === "email"} onClick={sendByEmail}>
            {sending === "email" ? "Sending..." : `Email${receiptEmail ? ` · ${receiptEmail}` : ""}`}
          </button>
          {!canEmail && <p className="hint" style={{ textAlign: "left", margin: "4px 0 0" }}>Add the customer's email to send by email.</p>}
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 44 }}
            disabled={sending === "telegram"} onClick={sendByTelegram}>
            {sending === "telegram" ? "Sending..." : `Telegram${receiptTelegram ? ` · @${receiptTelegram.replace(/^@/, "")}` : ""}${canTelegramBot ? " · bot" : ""}`}
          </button>
          {telegramBot?.configured && !doneHasChatId && receiptTelegram && (
            <p className="hint" style={{ textAlign: "left", margin: "4px 0 0" }}>
              Start @{telegramBot.username} on Telegram, then tap send.
            </p>
          )}
          {sendNote && <p className="hint" style={{ textAlign: "left", margin: "8px 0 0" }}>{sendNote}</p>}

          <div className="field" style={{ marginTop: 12, textAlign: "left" }}>
            <label htmlFor="sale-receipt-phone">Customer WhatsApp number (optional)</label>
            <input id="sale-receipt-phone" value={receiptPhone} onChange={(e) => setReceiptPhone(e.target.value)} placeholder="080..." inputMode="tel" />
          </div>
          <div className="field" style={{ textAlign: "left" }}>
            <label htmlFor="sale-receipt-email">Customer email (optional)</label>
            <input id="sale-receipt-email" type="email" value={receiptEmail} onChange={(e) => setReceiptEmail(e.target.value)} placeholder="customer@example.com" inputMode="email" />
          </div>
          <div className="field" style={{ textAlign: "left" }}>
            <label htmlFor="sale-receipt-telegram">Customer Telegram handle (optional)</label>
            <input id="sale-receipt-telegram" value={receiptTelegram} onChange={(e) => setReceiptTelegram(e.target.value)} placeholder="@username" />
          </div>

          <h3 style={{ textAlign: "left", margin: "20px 0 8px" }}>Share</h3>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 44 }} onClick={() => {
            const url = doneCardUrl();
            shareCard(url, { title: "Receipt " + done.saleNumber, filename: `receipt-${done.saleNumber}.png` });
          }}>
            Share receipt card (image)
          </button>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 44 }} onClick={() => {
            downloadCard(doneCardUrl(), `receipt-${done.saleNumber}.png`);
          }}>
            Download receipt image
          </button>
          <button className="btn btn-primary btn-block" style={{ marginTop: 12, minHeight: 44 }} onClick={resetDone}>New sale</button>
          <p className="hint" style={{ marginTop: 8 }}>
            <a href={`/app/receipt/sale/${done.saleId}`} target="_blank" rel="noreferrer">Open printable receipt</a>
            {" · "}
            <a href={tgUrl} target="_blank" rel="noreferrer">Open Telegram chat</a>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Sales</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={"btn btn-sm " + (view === "new" ? "btn-primary" : "btn-secondary")} onClick={() => setView("new")}>New sale</button>
          <button className={"btn btn-sm " + (view === "history" ? "btn-primary" : "btn-secondary")} onClick={() => setView("history")}>History</button>
          <button className={"btn btn-sm " + (view === "shipments" ? "btn-primary" : "btn-secondary")} onClick={() => setView("shipments")}>Shipments</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {view === "history" ? (
        <>
          <div className="toolbar">
            <input type="date" className="search" value={dateFilter} aria-label="Sales date" onChange={(e) => setDateFilter(e.target.value)} />
            <button className="btn btn-secondary btn-sm" onClick={requestStatementPrint} disabled={history.length === 0}>Print statement</button>
          </div>          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Sale</th><th>Customer</th><th>Total</th><th>Paid</th><th>Change</th><th>Balance</th><th>Time</th><th></th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.sale_number}</strong></td>
                    <td>{s.customer_name || "Walk-in"}</td>
                    <td className="money">{fmt(s.total_amount)}</td>
                    <td className="money">{fmt(s.amount_paid)}</td>
                    <td className="money" style={{ color: Number(s.change_given) > 0 ? "var(--gold, #b45309)" : "var(--muted)" }}>
                      {Number(s.change_given) > 0 ? fmt(s.change_given) : "—"}
                    </td>
                    <td className={Number(s.balance_due) > 0 ? "money debt-amt" : "money"}>{fmt(s.balance_due)}</td>
                    <td><small>{s.created_at?.slice(11, 16)}</small></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a className="btn btn-secondary btn-sm" href={`/app/receipt/sale/${s.id}`} target="_blank" rel="noreferrer">🧾</a>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ marginLeft: 6 }}
                        onClick={() => setShipFor(s)}
                      >
                        Ship
                      </button>
                      {canVoid && (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ color: "var(--danger, #b91c1c)", marginLeft: 6 }}
                          onClick={() => {
                            if (window.confirm(`Void sale ${s.sale_number}? Stock will be restored.`)) voidSale(s.id);
                          }}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {histLoading ? <ListSkeleton rows={3} label="Loading sales..." /> : history.length === 0 && <p className="empty">No sales on this date.</p>}
          </div>
            <div className="print-only">
              <StatementPrint
                business={{ name: bizName }}
                title="Sales statement"
                period={dateFilter}
                lines={[...history].reverse().map((s) => ({
                  date: String(s.created_at || "").slice(0, 10),
                  description: `Sale ${s.sale_number} — ${s.customer_name || "Walk-in"}`,
                  amount: Number(s.total_amount || 0),
                }))}
                totals={[
                  { label: "Total sales", amount: history.reduce((sum, s) => sum + Number(s.total_amount || 0), 0) },
                  { label: "Total paid", amount: history.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0) },
                  { label: "Total balance owed", amount: history.reduce((sum, s) => sum + Number(s.balance_due || 0), 0) },
                ]}
              />
            </div>
        </>
      ) : view === "shipments" ? (
        <ShipmentsTab />
      ) : (
        <>
          <MessageSale products={products} services={services} onUseDraft={useMessageDraft} />
          {catalogLoading && <ListSkeleton rows={3} label="Loading products and services..." />}
          <div className="toolbar">
            <button className={"btn btn-sm " + (catalog === "products" ? "btn-primary" : "btn-secondary")} onClick={() => setCatalog("products")}>Products</button>
            <button className={"btn btn-sm " + (catalog === "services" ? "btn-primary" : "btn-secondary")} onClick={() => setCatalog("services")}>Services</button>
          </div>
          <div className="dash-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div>
            {catalog === "products" ? (
              <>
                <input className="search" style={{ width: "100%", marginBottom: 12 }} placeholder="Search products to add..." aria-label="Search products to add"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                  {filtered.map((p) => (
                    <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer", padding: 14 }}
                      onClick={() => addToCart(p)}>
                      <strong style={{ fontSize: 14 }}>{p.name}</strong>
                      <div className="money" style={{ marginTop: 4 }}>{fmt(p.unit_price)}</div>
                      <small style={{ color: Number(p.stock) <= Number(p.reorder_level) ? "var(--gold)" : "var(--muted)" }}>
                        Stock: {p.stock}
                      </small>
                    </button>
                  ))}
                </div>
                {search && filtered.length === 0 && <p className="empty">No products match.</p>}
              </>
            ) : (
              <>
                <input className="search" style={{ width: "100%", marginBottom: 12 }} placeholder="Search services to add..." aria-label="Search services to add"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                  {serviceFiltered.map((s) => (
                    <button key={s.id} className="card" style={{ textAlign: "left", cursor: "pointer", padding: 14 }}
                      onClick={() => addServiceToCart(s)}>
                      <strong style={{ fontSize: 14 }}>{s.name}</strong>
                      <div className="money" style={{ marginTop: 4 }}>{fmt(s.price)}</div>
                      <small style={{ color: "var(--muted)" }}>{s.unit}</small>
                    </button>
                  ))}
                </div>
                {search && serviceFiltered.length === 0 && <p className="empty">No services match.</p>}
              </>
            )}
          </div>

          <div className="cart" ref={salePanelRef} tabIndex={-1}>
            <h3 style={{ marginTop: 0 }}>Current sale</h3>
            {cart.length === 0 && <p className="empty">Tap products to add them here.</p>}
            {cart.map((l) => (
              <div className="cart-line" key={l.serviceId ? `s${l.serviceId}` : l.productId}>
                <div style={{ flex: 1 }}>
                  <strong>{l.name}</strong>
                  <div className="money" style={{ fontWeight: 400, fontSize: 14 }}>{fmt(l.unitPrice)} / {l.unit || (l.serviceId ? "service" : "piece")}</div>
                </div>
                <div className="qty-ctl">
                  <button aria-label={`Reduce quantity of ${l.name}`} onClick={() => l.serviceId ? setServiceQty(l.serviceId, l.qty - 1) : setQty(l.productId, l.qty - 1)}>−</button>
                  <input type="number" min="0" step="0.01" defaultValue={l.qty}
                    key={`qty-${l.serviceId ? "s" + l.serviceId : "p" + l.productId}-${l.qty}`}
                    aria-label={`Quantity of ${l.name} in ${l.unit || "piece"}`}
                    onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) { l.serviceId ? setServiceQty(l.serviceId, v) : setQty(l.productId, v); } }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ width: 64, textAlign: "center" }} />
                  <button aria-label={`Increase quantity of ${l.name}`} onClick={() => l.serviceId ? setServiceQty(l.serviceId, l.qty + 1) : setQty(l.productId, l.qty + 1)}>+</button>
                </div>
                <div className="money">{fmt(l.unitPrice * l.qty)}</div>
              </div>
            ))}
            {cart.length > 0 && (
              <>
                <div className="total-row"><span>Total</span><span>{fmt(total)}</span></div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label htmlFor="sale-customer">Customer</label>
                  <select id="sale-customer" value={customerPick} onChange={(e) => setCustomerPick(e.target.value)}>
                    <option value="">Walk-in (no customer)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>
                    ))}
                    <option value="new">＋ New buyer...</option>
                  </select>
                </div>
                {customerPick === "new" && (
                  <div className="field">
                    <label htmlFor="sale-new-buyer">New buyer name (required if not fully paid)</label>
                    <input id="sale-new-buyer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Buyer's name" />
                  </div>
                )}
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Payments</label>
                  {payments.map((p, i) => (
                    <div key={i} className="row2" style={{ marginBottom: 8 }}>
                      <div>
                        <select value={p.mode} onChange={(e) => setPay(i, "mode", e.target.value)} aria-label="Payment mode">
                          {payModes.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input type="number" min="0" step="0.01" value={p.amount} aria-label="Payment amount" onChange={(e) => setPay(i, "amount", e.target.value)}
                          placeholder="Amount paid" aria-label="Payment amount" />
                        {payments.length > 1 && (
                          <button className="btn btn-secondary btn-sm" onClick={() => removePay(i)} aria-label="Remove payment">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button className="btn btn-secondary btn-sm" onClick={addPay}>+ Split payment</button>
                  {paid > 0 && <p className="hint" style={{ margin: "6px 0 0" }}>Paid so far: <strong>{fmt(paid)}</strong></p>}
                  {cashShort && <div className="alert alert-error" style={{ marginTop: 8 }}>Change of {fmt(changeDue)} is more than the cash received ({fmt(cashPaid)}). Take more cash or reduce the tender.</div>}
                </div>
                {balance > 0 && <div className="alert alert-error" style={{ marginBottom: 12 }}>Balance of {fmt(balance)} will be recorded as debt for {customerPick === "new" ? (customerName.trim() || "the new buyer") : (customers.find((c) => String(c.id) === String(customerPick))?.name || "the customer")}.</div>}
                <button className="btn btn-primary btn-block" disabled={saving || cashShort} onClick={complete}>
                  {saving ? "Saving..." : `Complete sale · ${fmt(total)}`}
                </button>
              </>
            )}
          </div>
          </div>
        </>
      )}
      {shipFor && (
        <ShipmentModal
          sale={shipFor}
          onClose={() => setShipFor(null)}
          onCreated={() => setView("shipments")}
        />
      )}
    </>
  );
}
