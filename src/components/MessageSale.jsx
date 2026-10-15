import { useState } from "react";
import { fmt } from "../lib/api";

// Parse one typed line like:
//   "sold 3 indomie @4500 to Mama Nkechi paid 10000 cash"
//   "2 rice 1500 for John owes 500"
//   "haircut x2 @3000 paid transfer 6000"
// Returns { line, customer, paid, paymentMethod, owes, warnings, error }.
function parseLine(raw, products, services) {
  let line = String(raw || "").trim();
  if (!line) return null;
  const warnings = [];
  let customer = "";
  let paid = null;
  let paymentMethod = null;
  let owes = null;

  const num = "[\\d,]+(?:\\.\\d+)?";

  // Payment: "paid 10000", "paid cash 10000", "paid 10000 cash",
  // "paid via transfer 5000". Extracted BEFORE the customer name so a trailing
  // "to Mama Nkechi paid 10000 cash" does not swallow the payment.
  const methodMap = { cash: "cash", transfer: "transfer", pos: "pos", bank: "transfer" };
  const paidPatterns = [
    new RegExp(`\\bpaid\\s+(cash|transfer|pos|bank)\\s+[₦N]?\\s*(${num})`, "i"),
    new RegExp(`\\bpaid\\s+via\\s+(cash|transfer|pos|bank)\\s+[₦N]?\\s*(${num})`, "i"),
    new RegExp(`\\bpaid\\s+[₦N]?\\s*(${num})\\s*(cash|transfer|pos|bank)?`, "i"),
  ];
  for (const re of paidPatterns) {
    const m = line.match(re);
    if (m) {
      let amtStr = null, methStr = null;
      for (let i = 1; i < m.length; i++) {
        const g = String(m[i] || "");
        if (/^[\d,]+(?:\.\d+)?$/.test(g)) amtStr = g;
        else if (/^(cash|transfer|pos|bank)$/i.test(g)) methStr = g;
      }
      if (amtStr) {
        paid = Number(amtStr.replace(/,/g, ""));
        if (methStr) paymentMethod = methodMap[methStr.toLowerCase()];
        line = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length)).trim();
        break;
      }
    }
  }

  // Owed balance: "owes 7000", "owing 7000", "balance 7000".
  const owesMatch = line.match(new RegExp(`\\b(owes|owing|balance|debt)\\s+[₦N]?\\s*(${num})`, "i"));
  if (owesMatch) {
    owes = Number(owesMatch[2].replace(/,/g, ""));
    line = (line.slice(0, owesMatch.index) + " " + line.slice(owesMatch.index + owesMatch[0].length)).trim();
  }

  // Customer name after the last " to " or " for ".
  const low = line.toLowerCase();
  const toIdx = Math.max(low.lastIndexOf(" to "), low.lastIndexOf(" for "));
  if (toIdx !== -1) {
    customer = line.slice(toIdx + 4).trim();
    line = line.slice(0, toIdx).trim();
  }

  // Drop a leading "sold"/"sell" keyword.
  line = line.replace(/^(sold|sell)\s+/i, "").trim();
  if (!line) return { customer, paid, paymentMethod, owes, warnings, error: "" };

  // Quantity: leading ("3 indomie", "3x indomie"), mid-line ("haircut x2 @3000"),
  // or trailing ("indomie x3"). Runs before price extraction so "x3" is never
  // read as a price.
  let qty = 1;
  let qm = line.match(/^(\d+)\s*(?:[xX]\s+|\s+)(.+)$/);
  if (qm && qm[2].trim()) {
    qty = Number(qm[1]);
    line = qm[2].trim();
  } else {
    qm = line.match(/^(.*?)\s+[xX]\s*(\d+)\s*(.*)$/);
    if (qm && qm[1].trim()) {
      qty = Number(qm[2]);
      line = (qm[1] + " " + qm[3]).trim();
    }
  }

  // Unit price: after @ first (supports ₦/N prefix), else a trailing number.
  let unitPrice = null;
  const atMatch = line.match(new RegExp(`@\\s*[₦N]?\\s*(${num})`));
  if (atMatch) {
    unitPrice = Number(atMatch[1].replace(/,/g, ""));
    line = (line.slice(0, atMatch.index) + " " + line.slice(atMatch.index + atMatch[0].length)).trim();
  } else {
    const trail = line.match(new RegExp(`[₦N]?\\s*(${num})\\s*$`));
    if (trail && line.replace(trail[0], "").trim()) {
      unitPrice = Number(trail[1].replace(/,/g, ""));
      line = line.slice(0, trail.index).trim();
    }
  }
  if (!line) return { customer, paid, paymentMethod, owes, warnings, error: "" };

  // Fuzzy match: products first, then services.
  const typed = line.toLowerCase();
  function fuzzyMatch(list) {
    let best = null, bestScore = 0;
    for (const p of list || []) {
      const pn = String(p.name || "").toLowerCase();
      if (!pn || !typed) continue;
      let score = 0;
      if (typed === pn) score = 3;
      else if (typed.includes(pn)) score = 2;
      else if (typed.length >= 3 && pn.includes(typed)) score = 1;
      if (score > bestScore || (score === bestScore && best && score > 0 && pn.length > String(best.name).toLowerCase().length)) {
        best = p; bestScore = score;
      }
    }
    return best;
  }
  const product = fuzzyMatch(products);
  const service = product ? null : fuzzyMatch(services);
  const item = product || service;
  if (!item) {
    return { customer, paid, paymentMethod, owes, warnings, error: `No product or service matched for "${line}". Try a name from your list.` };
  }

  const isService = !product;
  const listPrice = isService ? Number(service.price) : Number(product.unit_price);
  const price = unitPrice != null && unitPrice > 0 ? unitPrice : listPrice || 0;
  const belowList = price > 0 && listPrice > 0 && Math.round(price * 100) < Math.round(listPrice * 100);

  let finalQty = qty;
  if (!isService) {
    const stock = Number(product.stock);
    if (stock > 0 && qty > stock) {
      finalQty = stock;
      warnings.push(`Only ${stock} of ${product.name} in stock. Quantity reduced from ${qty}.`);
    } else if (stock <= 0) {
      warnings.push(`${product.name} is out of stock.`);
    }
  }

  return {
    customer, paid, paymentMethod, owes, warnings,
    error: "",
    line: {
      productId: product ? product.id : null,
      serviceId: service ? service.id : null,
      name: item.name,
      quantity: finalQty,
      unitPrice: price,
      belowList,
      isService,
    },
  };
}

export default function MessageSale({ products = [], services = [], onUseDraft }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(null); // { lines, customerName, total, amountPaid, paymentMethod, warnings }
  const [error, setError] = useState("");

  function parse() {
    setError(""); setDraft(null);
    const rawLines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) { setError("Type the sale first, e.g. sold 3 indomie @4500 to Mama Nkechi paid 10000 cash"); return; }

    const lines = [];
    const warnings = [];
    let customerName = "";
    let amountPaid = null;
    let paymentMethod = null;
    let owes = null;
    for (const raw of rawLines) {
      const r = parseLine(raw, products, services);
      if (!r) continue;
      if (r.customer && !customerName) customerName = r.customer;
      if (r.paid != null && amountPaid == null) amountPaid = r.paid;
      if (r.paymentMethod && !paymentMethod) paymentMethod = r.paymentMethod;
      if (r.owes != null && owes == null) owes = r.owes;
      if (r.warnings) warnings.push(...r.warnings);
      if (r.error) { setError(r.error); return; }
      if (r.line) lines.push(r.line);
    }
    if (!lines.length) { setError("I could not find any item in that message."); return; }
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    // "owes X" means the customer pays total minus X.
    if (amountPaid == null && owes != null) {
      amountPaid = Math.max(0, Math.round((total - owes) * 100) / 100);
    }
    setDraft({ lines, customerName, total, amountPaid, paymentMethod: paymentMethod || "cash", warnings });
  }

  function useDraft() {
    if (!draft) return;
    onUseDraft({
      items: draft.lines.map((l) => l.isService
        ? { serviceId: l.serviceId, quantity: l.quantity, unitPrice: l.unitPrice }
        : { productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice }),
      customerName: draft.customerName,
      amountPaid: draft.amountPaid != null ? String(draft.amountPaid) : "",
      paymentMethod: draft.paymentMethod,
    });
    setDraft(null); setText("");
  }

  const balance = draft && draft.amountPaid != null
    ? Math.max(0, Math.round((draft.total - draft.amountPaid) * 100) / 100)
    : 0;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Record from a message</h3>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 10px" }}>
        Type it the way you would send it, e.g. sold 3 indomie @4500 to Mama Nkechi paid 10000 cash.
        Add "owes 2000" for a part payment. One item per line works too, and services work as well.
      </p>
      <div className="field">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="sold 3 indomie @4500 to Mama Nkechi paid 10000 cash"
          aria-label="Sale message"
        />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-secondary" onClick={parse}>Parse</button>

      {draft && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {draft.warnings.map((w, i) => (
            <div key={i} style={{ background: "#fef3c7", color: "#92400e", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>{w}</div>
          ))}
          {draft.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
              <span>{l.quantity} x {l.name}{l.isService ? " (service)" : ""} <small style={{ color: "var(--muted)" }}>@ {fmt(l.unitPrice)}</small>
                {l.belowList && <small style={{ color: "#b45309" }}> below list price</small>}
              </span>
              <span className="money">{fmt(l.quantity * l.unitPrice)}</span>
            </div>
          ))}
          <div className="total-row"><span>Total</span><span>{fmt(draft.total)}</span></div>
          {draft.customerName && <p style={{ fontSize: 14 }}>Customer: <strong>{draft.customerName}</strong></p>}
          {draft.amountPaid != null && (
            <p style={{ fontSize: 14 }}>
              Paid: <strong>{fmt(draft.amountPaid)}</strong> ({draft.paymentMethod})
              {balance > 0 && <span> · Balance: <strong style={{ color: "#b91c1c" }}>{fmt(balance)}</strong></span>}
            </p>
          )}
          <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={useDraft}>Use this sale</button>
        </div>
      )}
    </div>
  );
}
