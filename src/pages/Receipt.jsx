import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";

// Printable receipts, sized for Nigerian thermal printers (58mm / 80mm).
// Opened outside the app Layout so printing outputs only the receipt.

function money(n) {
  return fmt(n);
}

function ReceiptShell({ width, children }) {
  return (
    <div className="receipt-screen">
      <div className="receipt-toolbar noprint">
        <button className="btn btn-secondary btn-sm" onClick={() => window.history.back()}>← Back</button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨️ Print</button>
      </div>
      <div className={`receipt-paper paper-${width === "58mm" ? "58" : "80"}`}>
        {children}
      </div>
      <p className="hint noprint" style={{ textAlign: "center", marginTop: 12 }}>
        Tip: pair your Bluetooth thermal printer in your phone settings first, then choose it in the print dialog.
      </p>
    </div>
  );
}

function ReceiptHeader({ business }) {
  return (
    <div className="r-center">
      <div className="r-biz">{business.name || "My Business"}</div>
      {business.tagline && <div className="r-sub">{business.tagline}</div>}
      {business.receipt_address && <div className="r-sub">{business.receipt_address}</div>}
      {business.receipt_phone && <div className="r-sub">Tel: {business.receipt_phone}</div>}
      <div className="r-line">{"-".repeat(32)}</div>
    </div>
  );
}

function ReceiptFooter({ business }) {
  return (
    <div className="r-center">
      <div className="r-line">{"-".repeat(32)}</div>
      <div className="r-sub">{business.receipt_footer || "Thank you for your patronage!"}</div>
      <div className="r-tiny">Powered by KopaBook</div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className={bold ? "r-row r-bold" : "r-row"}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

export function SaleReceiptPage({ saleId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (saleId === "0") {
      // Sample receipt for the printer test page.
      api.get("/api/business").then((d) => {
        const b = d.business || {};
        setData({
          business: b,
          sale: { id: 0, sale_number: "SAMPLE-001", total_amount: 15500, subtotal: 15500, amount_paid: 15500, balance_due: 0, payment_method: "Cash", created_at: new Date().toISOString() },
          items: [
            { product_name: "Sample item 1", quantity: 2, unit_price: 5000, line_total: 10000 },
            { product_name: "Sample item 2", quantity: 1, unit_price: 5500, line_total: 5500 },
          ],
          payments: [{ amount: 15500, mode: "Cash" }],
        });
      }).catch((e) => setError(e.message));
      return;
    }
    api.get(`/api/receipts/sale?id=${saleId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [saleId]);

  if (error) return <div className="receipt-screen"><div className="alert alert-error">{error}</div></div>;
  if (!data) return <div className="receipt-screen"><div className="loading">Loading receipt...</div></div>;

  const { business, sale, items, payments } = data;
  const width = business.receipt_paper_width || "80mm";
  const date = (sale.created_at || "").slice(0, 16).replace("T", " ");

  return (
    <ReceiptShell width={width}>
      <ReceiptHeader business={business} />
      <div className="r-center r-title">SALES RECEIPT</div>
      <Row label={`Receipt: ${sale.sale_number || "#" + sale.id}`} value={date} />
      {sale.customer_name && <Row label="Customer" value={sale.customer_name} />}
      <div className="r-line">{"-".repeat(32)}</div>
      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <div>{it.product_name || "Item"}</div>
          <div className="r-row">
            <span>{it.quantity} x {money(it.unit_price)}</span>
            <span>{money(it.line_total)}</span>
          </div>
        </div>
      ))}
      <div className="r-line">{"-".repeat(32)}</div>
      <Row label="Subtotal" value={money(sale.subtotal || sale.total_amount)} />
      {Number(sale.discount_amount) > 0 && <Row label="Discount" value={money(sale.discount_amount)} />}
      <Row label="TOTAL" value={money(sale.total_amount)} bold />
      <div className="r-line">{"-".repeat(32)}</div>
      {(payments.length ? payments : [{ amount: sale.amount_paid, mode: sale.payment_method }]).map((p, i) => (
        <Row key={i} label={`Paid (${p.mode || "Cash"})`} value={money(p.amount)} />
      ))}
      {Number(sale.balance_due) > 0 && <Row label="Balance due" value={money(sale.balance_due)} bold />}
      <ReceiptFooter business={business} />
    </ReceiptShell>
  );
}

export function HotelReceiptPage({ bookingId }) {
  const [data, setData] = useState(null);
  const [business, setBusiness] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get(`/api/hotel/folio?bookingId=${bookingId}`),
      api.get("/api/business"),
    ])
      .then(([folio, biz]) => { setData(folio); setBusiness(biz.business || {}); })
      .catch((e) => setError(e.message));
  }, [bookingId]);

  if (error) return <div className="receipt-screen"><div className="alert alert-error">{error}</div></div>;
  if (!data) return <div className="receipt-screen"><div className="loading">Loading receipt...</div></div>;

  const { booking, charges, payments, totalCharged, totalPaid, balance } = data;
  const width = business.receipt_paper_width || "80mm";
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");

  return (
    <ReceiptShell width={width}>
      <ReceiptHeader business={business} />
      <div className="r-center r-title">GUEST RECEIPT</div>
      <Row label={`Folio: #${booking.id}`} value={date} />
      <Row label="Guest" value={booking.guest_name} />
      <Row label="Room" value={`${booking.room_number} (${booking.room_type})`} />
      <Row label="Stay" value={`${booking.check_in} to ${booking.check_out}`} />
      <div className="r-line">{"-".repeat(32)}</div>
      {charges.map((c) => (
        <div key={c.id} className="r-row">
          <span>{c.description}</span>
          <span>{money(c.amount)}</span>
        </div>
      ))}
      <div className="r-line">{"-".repeat(32)}</div>
      <Row label="TOTAL CHARGES" value={money(totalCharged)} bold />
      {payments.map((p) => (
        <Row key={p.id} label={`Paid (${p.mode})`} value={money(p.amount)} />
      ))}
      <Row label="Total paid" value={money(totalPaid)} />
      {balance > 0 && <Row label="Balance due" value={money(balance)} bold />}
      <ReceiptFooter business={business} />
    </ReceiptShell>
  );
}
