import { useEffect, useRef, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";
import { waLink, receiptText } from "../lib/whatsapp";
import MessageSale from "../components/MessageSale";

export default function SalesPage() {
  const [view, setView] = useState("new"); // new | history
  const [products, setProducts] = useState([]);
  const [catalog, setCatalog] = useState("products"); // products | services
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [history, setHistory] = useState([]);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [receiptPhone, setReceiptPhone] = useState("");
  const [bizName, setBizName] = useState("");
  const salePanelRef = useRef(null);

  useEffect(() => {
    api.get("/api/products").then((d) => setProducts(d.products)).catch(() => {});
    api.get("/api/services").then((d) => setServices(d.services)).catch(() => {});
    api.get("/api/business").then((d) => setBizName(d.business?.name || "")).catch(() => {});
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
    if (draft.customerName) setCustomerName(draft.customerName);
    if (draft.amountPaid !== undefined) setAmountPaid(draft.amountPaid);
    if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
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
  const paid = Number(amountPaid || 0);
  const balance = Math.max(0, total - paid);

  async function complete() {
    if (cart.length === 0) { setError("Add at least one item."); return; }
    if (balance > 0 && !customerName.trim()) { setError("Unpaid balance needs a customer name."); return; }
    setSaving(true); setError("");
    try {
      const d = await api.post("/api/sales", {
        items: cart.map((l) => l.serviceId
          ? { serviceId: l.serviceId, quantity: l.qty, unitPrice: l.unitPrice }
          : { productId: l.productId, quantity: l.qty, unitPrice: l.unitPrice }),
        customerName: customerName.trim() || undefined,
        amountPaid: paid,
        paymentMethod,
      });
      setDone(d);
      setCart([]); setCustomerName(""); setAmountPaid("");
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
              <thead><tr><th>Sale</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Time</th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.sale_number}</strong></td>
                    <td>{s.customer_name || "Walk-in"}</td>
                    <td className="money">{fmt(s.total_amount)}</td>
                    <td className="money">{fmt(s.amount_paid)}</td>
                    <td className={Number(s.balance_due) > 0 ? "money debt-amt" : "money"}>{fmt(s.balance_due)}</td>
                    <td><small>{s.created_at?.slice(11, 16)}</small></td>
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
                  <label>Customer name (required if not fully paid)</label>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer name" />
                </div>
                <div className="field"><div className="row2">
                  <div><label>Amount paid</label><input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={String(total)} /></div>
                  <div><label>Payment method</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      <option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option><option value="credit">Credit</option>
                    </select>
                  </div>
                </div></div>
                {balance > 0 && <div className="alert alert-error" style={{ marginBottom: 12 }}>Balance of {fmt(balance)} will be recorded as debt for {customerName || "the customer"}.</div>}
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
