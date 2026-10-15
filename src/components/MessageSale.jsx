import { useState } from "react";
import { fmt } from "../lib/api";

// Parse one typed line like "sold 3 indomie @4500", "2 rice 1500", "indomie 4500".
// Returns { line: { productId, name, quantity, unitPrice, stock } | null, customer, error }.
function parseLine(raw, products) {
  let line = String(raw || "").trim();
  if (!line) return null;

  // Customer name comes after the last " to ", e.g. "... @4500 to Mama Nkechi".
  let customer = "";
  const toIdx = line.toLowerCase().lastIndexOf(" to ");
  if (toIdx !== -1) {
    customer = line.slice(toIdx + 4).trim();
    line = line.slice(0, toIdx).trim();
  }

  // Drop a leading "sold"/"sell" keyword.
  line = line.replace(/^(sold|sell)\s+/i, "").trim();
  if (!line) return { customer, error: "" };

  // Unit price: after @ first, else a trailing number.
  let unitPrice = null;
  const atMatch = line.match(/@\s*([\d,]+(?:\.\d+)?)/);
  if (atMatch) {
    unitPrice = Number(atMatch[1].replace(/,/g, ""));
    line = (line.slice(0, atMatch.index) + " " + line.slice(atMatch.index + atMatch[0].length)).trim();
  } else {
    const trail = line.match(/([\d,]+(?:\.\d+)?)\s*$/);
    if (trail) {
      unitPrice = Number(trail[1].replace(/,/g, ""));
      line = line.slice(0, trail.index).trim();
    }
  }

  // Quantity: a leading number. Defaults to 1.
  let qty = 1;
  const qtyMatch = line.match(/^(\d+)\s+(.+)$/);
  if (qtyMatch) {
    qty = Number(qtyMatch[1]);
    line = qtyMatch[2].trim();
  }

  // Fuzzy product match: case-insensitive substring either way.
  const typed = line.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const p of products || []) {
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
  if (!best) {
    return { customer, error: `No product matched for "${line}". Try a product name from your list.` };
  }

  const price = unitPrice != null && unitPrice > 0 ? unitPrice : Number(best.unit_price) || 0;
  const stock = Number(best.stock);
  return {
    customer,
    error: "",
    line: {
      productId: best.id,
      name: best.name,
      quantity: stock > 0 ? Math.min(qty, stock) : qty,
      unitPrice: price,
    },
  };
}

export default function MessageSale({ products = [], onUseDraft }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(null); // { lines, customerName, total }
  const [error, setError] = useState("");

  function parse() {
    setError(""); setDraft(null);
    const rawLines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) { setError("Type the sale first, e.g. sold 3 indomie @4500 to Mama Nkechi"); return; }

    const lines = [];
    let customerName = "";
    for (const raw of rawLines) {
      const r = parseLine(raw, products);
      if (!r) continue;
      if (r.customer && !customerName) customerName = r.customer;
      if (r.error) { setError(r.error); return; }
      if (r.line) lines.push(r.line);
    }
    if (!lines.length) { setError("I could not find any item in that message."); return; }
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    setDraft({ lines, customerName, total });
  }

  function useDraft() {
    if (!draft) return;
    onUseDraft({
      items: draft.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      customerName: draft.customerName,
    });
    setDraft(null); setText("");
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Record from a message</h3>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 10px" }}>
        Type it the way you would send it, e.g. sold 3 indomie @4500 to Mama Nkechi. One item per line works too.
      </p>
      <div className="field">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="sold 3 indomie @4500 to Mama Nkechi"
          aria-label="Sale message"
        />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-secondary" onClick={parse}>Parse</button>

      {draft && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {draft.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
              <span>{l.quantity} x {l.name} <small style={{ color: "var(--muted)" }}>@ {fmt(l.unitPrice)}</small></span>
              <span className="money">{fmt(l.quantity * l.unitPrice)}</span>
            </div>
          ))}
          <div className="total-row"><span>Total</span><span>{fmt(draft.total)}</span></div>
          {draft.customerName && <p style={{ fontSize: 14 }}>Customer: <strong>{draft.customerName}</strong></p>}
          <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={useDraft}>Use this sale</button>
        </div>
      )}
    </div>
  );
}
