import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";
import { waLink, receiptText } from "../lib/whatsapp";

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

// ---------------------------------------------------------------------------
// Receipt image generator: draws a paper-style receipt on a canvas and
// returns a PNG blob. No external dependencies, works offline.
// ---------------------------------------------------------------------------

const IMG_W = 420;
const IMG_PAD = 20;

function drawReceiptCanvas({ business, sale, items, payments }) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const F_TITLE = "bold 22px 'Courier New', Courier, monospace";
  const F_BOLD = "bold 15px 'Courier New', Courier, monospace";
  const F_BODY = "15px 'Courier New', Courier, monospace";
  const F_SMALL = "13px 'Courier New', Courier, monospace";
  const F_TINY = "11px 'Courier New', Courier, monospace";
  const F_TOTAL = "bold 19px 'Courier New', Courier, monospace";

  const maxW = IMG_W - IMG_PAD * 2;

  // Collect draw ops first so we can size the canvas.
  // Each op: { kind: 'text', text, font, align, dy } or { kind: 'dash', dy } or { kind: 'gap', dy }
  const ops = [];
  const push = (op) => ops.push(op);
  const gap = (h) => push({ kind: "gap", dy: h });
  const text = (t, font, align) => push({ kind: "text", text: String(t), font, align: align || "left" });
  const center = (t, font) => text(t, font, "center");
  const dash = () => push({ kind: "dash" });

  function wrapped(t, font, align) {
    ctx.font = font;
    const words = String(t).split(" ");
    let line = "";
    const out = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    out.forEach((l) => text(l, font, align));
  }

  // Header
  gap(14);
  wrapped(business.name || "My Business", F_TITLE, "center");
  gap(4);
  if (business.tagline) wrapped(business.tagline, F_SMALL, "center");
  if (business.receipt_address) wrapped(business.receipt_address, F_SMALL, "center");
  if (business.receipt_phone) center("Tel: " + business.receipt_phone, F_SMALL);
  gap(6);
  dash();
  gap(6);

  // Title + meta
  center("SALES RECEIPT", F_BOLD);
  gap(8);
  const date = (sale.created_at || "").slice(0, 16).replace("T", " ");
  text("Receipt: " + (sale.sale_number || "#" + sale.id), F_BODY, "left");
  // date right-aligned on same visual line handled by two ops
  text(date, F_SMALL, "right");
  if (sale.customer_name) {
    gap(2);
    text("Customer: " + sale.customer_name, F_BODY, "left");
  }
  gap(6);
  dash();
  gap(6);

  // Items
  (items || []).forEach((it) => {
    const name = it.product_name || "Item";
    wrapped(name, F_BODY, "left");
    const qtyPart = `${it.quantity}${it.product_unit ? " " + it.product_unit : ""} x ${money(it.unit_price)}`;
    // draw qty left and line total right on one row: use two ops with manual y
    push({ kind: "row", left: qtyPart, right: money(it.line_total), font: F_BODY });
    gap(6);
  });
  dash();
  gap(6);

  // Totals
  push({ kind: "row", left: "Subtotal", right: money(sale.subtotal || sale.total_amount), font: F_BODY });
  gap(4);
  if (Number(sale.discount_amount) > 0) {
    push({ kind: "row", left: "Discount", right: money(sale.discount_amount), font: F_BODY });
    gap(4);
  }
  push({ kind: "row", left: "TOTAL", right: money(sale.total_amount), font: F_TOTAL });
  gap(6);
  dash();
  gap(6);

  // Payments
  const payList = payments && payments.length ? payments : [{ amount: sale.amount_paid, mode: sale.payment_method }];
  payList.forEach((p) => {
    push({ kind: "row", left: `Paid (${p.mode || "Cash"})`, right: money(p.amount), font: F_BODY });
    gap(4);
  });
  if (Number(sale.balance_due) > 0) {
    gap(2);
    push({ kind: "row", left: "Balance due", right: money(sale.balance_due), font: F_BOLD });
    gap(4);
  }
  gap(2);
  dash();
  gap(8);

  // Footer
  center(business.receipt_footer || "Thank you for your patronage!", F_SMALL);
  gap(6);
  center("Powered by KopaBook", F_TINY);
  gap(16);

  // Measure: walk ops, sum heights.
  let y = 0;
  const lineH = (font) => {
    if (font === F_TITLE) return 28;
    if (font === F_TOTAL) return 26;
    if (font === F_TINY) return 16;
    return 21;
  };
  const measured = ops.map((op) => {
    if (op.kind === "gap") { y += op.dy; return { ...op, y: y - op.dy, h: op.dy }; }
    if (op.kind === "dash") { y += 10; return { ...op, y: y - 10, h: 10 }; }
    const h = lineH(op.font);
    y += h;
    return { ...op, y: y - h, h };
  });
  const H = Math.ceil(y) + 8;

  canvas.width = IMG_W;
  canvas.height = H;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, IMG_W, H);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";

  measured.forEach((op) => {
    if (op.kind === "gap") return;
    if (op.kind === "dash") {
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(IMG_PAD, op.y + 5);
      ctx.lineTo(IMG_W - IMG_PAD, op.y + 5);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (op.kind === "row") {
      ctx.font = op.font;
      ctx.textAlign = "left";
      ctx.fillText(op.left, IMG_PAD, op.y);
      ctx.textAlign = "right";
      ctx.fillText(op.right, IMG_W - IMG_PAD, op.y);
      return;
    }
    ctx.font = op.font;
    if (op.align === "center") {
      ctx.textAlign = "center";
      ctx.fillText(op.text, IMG_W / 2, op.y);
    } else if (op.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(op.text, IMG_W - IMG_PAD, op.y);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(op.text, IMG_PAD, op.y);
    }
  });

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/png");
  });
}

export function SaleReceiptPage({ saleId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgMsg, setImgMsg] = useState("");

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
      .then((d) => { setData(d); setWaPhone(d.sale?.customer_phone || ""); })
      .catch((e) => setError(e.message));
  }, [saleId]);

  if (error) return <div className="receipt-screen"><div className="alert alert-error">{error}</div></div>;
  if (!data) return <div className="receipt-screen"><div className="loading">Loading receipt...</div></div>;

  const { business, sale, items, payments } = data;
  const width = business.receipt_paper_width || "80mm";
  const date = (sale.created_at || "").slice(0, 16).replace("T", " ");
  const imgName = `kopabook-receipt-${sale.sale_number || sale.id}.png`;

  const waText = receiptText({
    saleNumber: sale.sale_number,
    total: money(sale.total_amount),
    businessName: business.name,
    balanceDue: Number(sale.balance_due) > 0 ? money(sale.balance_due) : null,
    items: (items || []).map((it) => ({
      qty: it.quantity,
      name: it.product_name || "Item",
      unitPrice: money(it.unit_price),
      unit: it.product_unit || undefined,
    })),
  });

  async function makeImageBlob() {
    const canvas = drawReceiptCanvas({ business, sale, items, payments });
    return canvasToBlob(canvas);
  }

  async function downloadImage() {
    setImgBusy(true);
    setImgMsg("");
    try {
      const blob = await makeImageBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = imgName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setImgMsg("Image saved. Share it from your gallery or files to WhatsApp.");
    } catch (e) {
      setImgMsg("Could not create the image. Try again.");
    } finally {
      setImgBusy(false);
    }
  }

  async function shareImage() {
    setImgBusy(true);
    setImgMsg("");
    try {
      const blob = await makeImageBlob();
      const file = new File([blob], imgName, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Receipt " + (sale.sale_number || "") });
        setImgMsg("");
      } else {
        // Fall back to download when direct share is not supported.
        await downloadImage();
      }
    } catch (e) {
      if (e && e.name !== "AbortError") setImgMsg("Sharing was cancelled or is not supported on this device. Use Download instead.");
    } finally {
      setImgBusy(false);
    }
  }

  async function copyImage() {
    setImgBusy(true);
    setImgMsg("");
    try {
      const blob = await makeImageBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setImgMsg("Receipt image copied. Paste it straight into WhatsApp.");
    } catch (e) {
      setImgMsg("Copy is not supported on this device. Use Download instead.");
    } finally {
      setImgBusy(false);
    }
  }

  const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

  return (
    <ReceiptShell width={width}>
      <div className="noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={waPhone}
          onChange={(e) => setWaPhone(e.target.value)}
          placeholder="Customer WhatsApp number (080...)"
          aria-label="Customer WhatsApp number"
          inputMode="tel"
          style={{ flex: 1 }}
        />
        <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer" href={waLink(waPhone, waText)}>
          Share on WhatsApp
        </a>
      </div>
      <div className="noprint" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className="btn btn-secondary btn-sm" onClick={downloadImage} disabled={imgBusy}>
          📷 {imgBusy ? "Working..." : "Save receipt image"}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={shareImage} disabled={imgBusy}>
          ↗ Share image
        </button>
        {canCopy && (
          <button className="btn btn-secondary btn-sm" onClick={copyImage} disabled={imgBusy}>
            📋 Copy image
          </button>
        )}
      </div>
      {imgMsg && (
        <p className="hint noprint" style={{ textAlign: "center", marginBottom: 12 }}>{imgMsg}</p>
      )}
      <ReceiptHeader business={business} />
      <div className="r-center r-title">SALES RECEIPT</div>
      <Row label={`Receipt: ${sale.sale_number || "#" + sale.id}`} value={date} />
      {sale.customer_name && <Row label="Customer" value={sale.customer_name} />}
      <div className="r-line">{"-".repeat(32)}</div>
      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <div>{it.product_name || "Item"}</div>
          <div className="r-row">
            <span>{it.quantity}{it.product_unit ? ` ${it.product_unit}` : ""} x {money(it.unit_price)}</span>
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
