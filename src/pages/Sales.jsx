import { useEffect, useRef, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";
import { waLink, receiptText } from "../lib/whatsapp";
import { receiptCardUrl, shareCard } from "../lib/shareCards";
import MessageSale from "../components/MessageSale";

export default function SalesPage() {
  const [view, setView] = useState("new"); // new | history
  const [products, setProducts] = useState([]);
  const [catalog, setCatalog] = useState("products"); // products | services
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [customerPick, setCustomerPick] = useState(""); // "" = walk-in, "new" = new buyer, else customer id
  const [customerName, setCustomerName] = useState("");
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([{ mode: "Cash", amount: "" }]);
  const [payModes, setPayModes] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [doneItems, setDoneItems] = useState([]);
  const [doneCustomer, setDoneCustomer] = useState("");
  const [history, setHistory] = useState([]);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [receiptPhone, setReceiptPhone] = useState("");
  const [bizName, setBizName] = useState("");
  const salePanelRef = useRef(null);

  useEffect(() => {
    api.get("/api/products").then((d) => setProducts(d.products)).catch(() => {});
    api.get("/api/services").then((d) => setServices(d.services)).catch(() => {});
    api.get("/api/customers").then((d) => setCustomers(d.customers || [])).catch(() => {});
    api.get("/api/payment-modes").then((d) => {
      const modes = (d.modes || []).filter((m) => m.enabled);
      setPayModes(modes);
      if (modes.length) setPayments([{ mode: modes[0].name, amount: "" }]);
    }).catch(() => {});
    api.get("/api/business").then((d) => {
      setBizName(d.business?.name || "");
      setBrand({ name: d.business?.name || "", color: d.business?.brand_color || "#166534", tagline: d.business?.tagline || "" });
    }).catch(() => {});
  }, []);

  async function loadHistory() {
    try {
      const d = await api.get(`/api/sales?from=${dateFilter}&to=${dateFilter}&limit=100`);
      setHistory(d.sales);
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
        qty: Math.max(1, Math.min(Number(it.quantity) || 1, Number(p.stock) || 0)),
        stock: Number(p.stock),
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
      return [...c, { productId: p.id, name: p.name, unitPrice: Number(p.unit_price), qty: 1, stock: Number(p.stock) }];
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
      setDoneItems(cart.map((l) => ({ qty: l.qty, name: l.name, unitPrice: fmt(l.unitPrice) })));
      setDoneCustomer(pickedCustomer ? pickedCustomer.name : newName);
      setCart([]); setCustomerPick(""); setCustomerName("");
      setPayments([{ mode: payModes[0]?.name || "Cash", amount: "" }]);
      const pd = await api.get("/api/products"); setProducts(pd.products);
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  if (done) {
    return (
      <>
        <div className="page-head"><h1>Sale recorded</h1></div>
        <div className="card narrow" style={{ margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>✅</div>
          <h2>{done.saleNumber}</h2>
          <p className="money" style={{ fontSize: 28 }}>{fmt(done.total)}</p>
          {done.balanceDue > 0
            ? <p className="debt-amt">Balance of {fmt(done.balanceDue)} recorded as debt.</p>
            : <p style={{ color: "var(--brand-dark)" }}>Fully paid. Stock updated.</p>}
          {done.change > 0 && (
            <p style={{ color: "var(--muted)", marginTop: 4 }}>Change to give: <strong>{fmt(done.change)}</strong></p>
          )}
          <div className="field" style={{ marginTop: 12, textAlign: "left" }}>
            <label>Customer WhatsApp number (optional)</label>
            <input value={receiptPhone} onChange={(e) => setReceiptPhone(e.target.value)} placeholder="080..." />
          </div>
          <a className="btn btn-secondary btn-block" style={{ marginTop: 8 }}
            target="_blank" rel="noreferrer"
            href={waLink(receiptPhone, receiptText({
              saleNumber: done.saleNumber,
              total: fmt(done.total),
              items: [],
              businessName: bizName,
              balanceDue: done.balanceDue > 0 ? fmt(done.balanceDue) : null,
            }))}>
            Send receipt on WhatsApp
          </a>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => {
            const url = receiptCardUrl({
              saleNumber: done.saleNumber,
              date: new Date().toLocaleDateString(),
              items: doneItems,
              total: fmt(done.total),
              paid: fmt(done.paid),
              balanceDue: done.balanceDue > 0 ? fmt(done.balanceDue) : null,
              customerName: doneCustomer || null,
            }, brand);
            shareCard(url, { title: "Receipt " + done.saleNumber, filename: `receipt-${done.saleNumber}.png` });
          }}>
            Share receipt card (image)
          </button>
          <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={() => setDone(null)}>New sale</button>
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
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {view === "history" ? (
        <>
          <div className="toolbar">
            <input type="date" className="search" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Sale</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Time</th><th></th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.sale_number}</strong></td>
                    <td>{s.customer_name || "Walk-in"}</td>
                    <td className="money">{fmt(s.total_amount)}</td>
                    <td className="money">{fmt(s.amount_paid)}</td>
                    <td className={Number(s.balance_due) > 0 ? "money debt-amt" : "money"}>{fmt(s.balance_due)}</td>
                    <td><small>{s.created_at?.slice(11, 16)}</small></td>
                    <td><a className="btn btn-secondary btn-sm" href={`/app/receipt/sale/${s.id}`} target="_blank" rel="noreferrer">🧾</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length === 0 && <p className="empty">No sales on this date.</p>}
          </div>
        </>
      ) : (
        <>
          <MessageSale products={products} services={services} onUseDraft={useMessageDraft} />
          <div className="toolbar">
            <button className={"btn btn-sm " + (catalog === "products" ? "btn-primary" : "btn-secondary")} onClick={() => setCatalog("products")}>Products</button>
            <button className={"btn btn-sm " + (catalog === "services" ? "btn-primary" : "btn-secondary")} onClick={() => setCatalog("services")}>Services</button>
          </div>
          <div className="dash-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div>
            {catalog === "products" ? (
              <>
                <input className="search" style={{ width: "100%", marginBottom: 12 }} placeholder="Search products to add..."
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
                <input className="search" style={{ width: "100%", marginBottom: 12 }} placeholder="Search services to add..."
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
                  <div className="money" style={{ fontWeight: 400, fontSize: 14 }}>{fmt(l.unitPrice)} each</div>
                </div>
                <div className="qty-ctl">
                  <button onClick={() => l.serviceId ? setServiceQty(l.serviceId, l.qty - 1) : setQty(l.productId, l.qty - 1)}>−</button>
                  <strong>{l.qty}</strong>
                  <button onClick={() => l.serviceId ? setServiceQty(l.serviceId, l.qty + 1) : setQty(l.productId, l.qty + 1)}>+</button>
                </div>
                <div className="money">{fmt(l.unitPrice * l.qty)}</div>
              </div>
            ))}
            {cart.length > 0 && (
              <>
                <div className="total-row"><span>Total</span><span>{fmt(total)}</span></div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Customer</label>
                  <select value={customerPick} onChange={(e) => setCustomerPick(e.target.value)}>
                    <option value="">Walk-in (no customer)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>
                    ))}
                    <option value="new">＋ New buyer...</option>
                  </select>
                </div>
                {customerPick === "new" && (
                  <div className="field">
                    <label>New buyer name (required if not fully paid)</label>
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Buyer's name" />
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
                        <input type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setPay(i, "amount", e.target.value)}
                          placeholder={i === 0 ? String(total) : "0"} aria-label="Payment amount" />
                        {payments.length > 1 && (
                          <button className="btn btn-secondary btn-sm" onClick={() => removePay(i)} aria-label="Remove payment">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button className="btn btn-secondary btn-sm" onClick={addPay}>+ Split payment</button>
                  {paid > 0 && <p className="hint" style={{ margin: "6px 0 0" }}>Paid so far: <strong>{fmt(paid)}</strong></p>}
                </div>
                {balance > 0 && <div className="alert alert-error" style={{ marginBottom: 12 }}>Balance of {fmt(balance)} will be recorded as debt for {customerPick === "new" ? (customerName.trim() || "the new buyer") : (customers.find((c) => String(c.id) === String(customerPick))?.name || "the customer")}.</div>}
                <button className="btn btn-primary btn-block" disabled={saving} onClick={complete}>
                  {saving ? "Saving..." : `Complete sale · ${fmt(total)}`}
                </button>
              </>
            )}
          </div>
          </div>
        </>
      )}
    </>
  );
}
