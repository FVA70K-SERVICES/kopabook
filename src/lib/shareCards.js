// Branded share cards for WhatsApp, drawn on canvas in the browser.
// Free tier: the merchant shares the image themselves (Web Share sheet on
// mobile, download fallback on desktop). No paid APIs involved.
//
// Receipt card rules: the card is shared with the customer, so it shows
// only what the customer should see — items with LINE totals, subtotal /
// discount / total, paid per method, change, balance due. Never cost,
// profit, staff names, or internal notes.
const W = 1080;
const H = 1350;

// All user-facing strings on the receipt card, in one place. English
// defaults; a later translation pass swaps these values per language.
export const RECEIPT_CARD_LABELS = {
  receipt: "Receipt",
  paidInFull: "Paid in full. Thank you!",
  total: "Total",
  subtotal: "Subtotal",
  discount: "Discount",
  paid: "Paid",
  changeGiven: "Change given",
  balanceDue: "Balance due",
  customer: "Customer",
  poweredBy: "Powered by KopaBook",
  thankYou: "Thank you!",
};

function hexToRgb(hex) {
  const h = String(hex || "#166534").replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Parse a number out of a formatted amount ("NGN 567,564" -> 567564).
// Numbers pass through untouched.
export function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Pure maths for the receipt card: no canvas, no DOM, so tests can assert
// every figure. Amounts in `sale` are NUMBERS here.
//   sale = { items: [{ qty, name, unit, unitPrice, lineTotal? }],
//            subtotal?, discount?, total?, paidByMethod?: [{ mode, amount }],
//            paid?, change?, balanceDue? }
// paidByMethod wins over `paid` when both are given.
export function buildReceiptCardRows(sale = {}) {
  const rawItems = Array.isArray(sale.items) ? sale.items : [];
  const shown = rawItems.slice(0, 8);
  const hidden = rawItems.slice(8);
  const lineOf = (it) => {
    const qty = Number(it.qty) || 0;
    const unitPrice = round2(parseAmount(it.unitPrice));
    const lineTotal = it.lineTotal !== undefined && it.lineTotal !== null
      ? round2(parseAmount(it.lineTotal))
      : round2(qty * unitPrice);
    return { qty, name: String(it.name || "Item"), unit: it.unit || "", unitPrice, lineTotal };
  };
  const items = shown.map(lineOf);
  const moreCount = hidden.length;
  const computedSubtotal = round2(
    [...shown, ...hidden].reduce((s, it) => s + lineOf(it).lineTotal, 0)
  );
  const subtotal = sale.subtotal !== undefined && sale.subtotal !== null
    ? round2(parseAmount(sale.subtotal)) : computedSubtotal;
  const discount = round2(parseAmount(sale.discount));
  const total = sale.total !== undefined && sale.total !== null
    ? round2(parseAmount(sale.total)) : round2(subtotal - discount);
  let paidByMethod = [];
  if (Array.isArray(sale.paidByMethod) && sale.paidByMethod.length) {
    paidByMethod = sale.paidByMethod.map((p) => ({
      mode: String(p.mode || ""),
      amount: round2(parseAmount(p.amount)),
    })).filter((p) => p.amount > 0 || p.mode);
  } else if (parseAmount(sale.paid) > 0) {
    paidByMethod = [{ mode: "", amount: round2(parseAmount(sale.paid)) }];
  }
  const paidTotal = round2(paidByMethod.reduce((s, p) => s + p.amount, 0));
  const change = round2(parseAmount(sale.change));
  const balanceDue = sale.balanceDue !== undefined && sale.balanceDue !== null
    ? round2(parseAmount(sale.balanceDue)) : round2(Math.max(0, total - paidTotal));
  return { items, moreCount, subtotal, discount, total, paidByMethod, paidTotal, change, balanceDue };
}

function base(brand, { height = H, footerText } = {}) {
  const c = document.createElement("canvas");
  c.width = W; c.height = height;
  const ctx = c.getContext("2d");
  const color = brand?.color || "#166534";
  // Background
  ctx.fillStyle = "#f7f8f4";
  ctx.fillRect(0, 0, W, height);
  // Header band
  const grad = ctx.createLinearGradient(0, 0, W, 340);
  grad.addColorStop(0, shade(color, 18));
  grad.addColorStop(1, shade(color, -28));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 340);
  // Store name
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "800 64px Arial, sans-serif";
  const nameLines = wrapText(ctx, brand?.name || "My Store", W - 160);
  nameLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, 130 + i * 74));
  if (brand?.tagline) {
    ctx.font = "400 34px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    wrapText(ctx, brand.tagline, W - 200).slice(0, 1).forEach((ln) => ctx.fillText(ln, W / 2, 130 + nameLines.slice(0, 2).length * 74 + 10));
  }
  // Footer: the business footer text when set, then "Powered by KopaBook".
  ctx.fillStyle = "#6b7280";
  ctx.font = "400 28px Arial, sans-serif";
  ctx.textAlign = "center";
  if (footerText) {
    wrapText(ctx, footerText, W - 200).slice(0, 1).forEach((ln) => ctx.fillText(ln, W / 2, height - 100));
  }
  ctx.fillText(RECEIPT_CARD_LABELS.poweredBy, W / 2, height - 60);
  return { canvas: c, ctx, color };
}

function cardShell(ctx, y, h) {
  ctx.fillStyle = "#ffffff";
  rr(ctx, 70, y, W - 140, h, 28);
  ctx.fill();
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function show(v) {
  return String(v ?? "");
}

// Receipt card. Amounts may be pre-formatted strings (fmt()) or numbers.
// items: [{ qty, name, unit, unitPrice (unit price), lineTotal (line total) }]
// When lineTotal is missing it is computed as qty x unitPrice.
// brand may carry contactLines (array of strings, owner-chosen channels
// only) and footer (business receipt footer text).
export function receiptCardUrl({ saleNumber, date, items, total, paid, balanceDue, customerName, subtotal, discount, change, paidByMethod, contactLines, footer }, brand) {
  const L = RECEIPT_CARD_LABELS;
  const rows = buildReceiptCardRows({
    items: (items || []).map((it) => ({
      qty: it.qty, name: it.name, unit: it.unit,
      unitPrice: parseAmount(it.unitPrice),
      lineTotal: it.lineTotal !== undefined ? parseAmount(it.lineTotal) : undefined,
    })),
    subtotal: subtotal !== undefined ? parseAmount(subtotal) : undefined,
    discount: discount !== undefined ? parseAmount(discount) : undefined,
    total: total !== undefined ? parseAmount(total) : undefined,
    paidByMethod,
    paid: paid !== undefined ? parseAmount(paid) : undefined,
    change: change !== undefined ? parseAmount(change) : undefined,
    balanceDue: balanceDue !== undefined && balanceDue !== null ? parseAmount(balanceDue) : undefined,
  });
  const display = {
    total: total !== undefined && total !== null ? show(total) : String(rows.total),
    subtotal: subtotal !== undefined && subtotal !== null ? show(subtotal) : String(rows.subtotal),
    discount: discount !== undefined && discount !== null ? show(discount) : String(rows.discount),
    change: change !== undefined && change !== null ? show(change) : String(rows.change),
    balanceDue: balanceDue !== undefined && balanceDue !== null ? show(balanceDue) : String(rows.balanceDue),
  };
  const paidDisplay = rows.paidByMethod.map((p, i) => {
    const raw = Array.isArray(paidByMethod) && paidByMethod[i] ? paidByMethod[i].amount : undefined;
    return { mode: p.mode, text: raw !== undefined && raw !== null ? show(raw) : String(p.amount) };
  });

  // Totals block rows (excluding the TOTAL line itself) to size the card.
  const extraRows = (rows.subtotal !== rows.total ? 1 : 0)
    + (rows.discount > 0 ? 1 : 0)
    + rows.paidByMethod.length
    + (rows.change > 0 ? 1 : 0)
    + 1; // balance due OR paid-in-full line
  const cardH = 64 + rows.items.length * 52 + (rows.moreCount > 0 ? 44 : 0) + 30 + extraRows * 48 + 56;
  const height = Math.max(H, 400 + 190 + cardH + 140);
  const { canvas, ctx, color } = base(brand, { height, footerText: footer || brand?.footer || "" });
  let y = 400;
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = "800 52px Arial, sans-serif";
  ctx.fillText(L.receipt, W / 2, y); y += 52;
  ctx.fillStyle = "#6b7280";
  ctx.font = "400 32px Arial, sans-serif";
  if (saleNumber) { ctx.fillText(saleNumber, W / 2, y); y += 44; }
  if (date) { ctx.fillText(date, W / 2, y); y += 20; }
  if (customerName) { ctx.fillText(`${L.customer}: ${customerName}`, W / 2, y + 24); y += 44; }
  const contacts = Array.isArray(contactLines) ? contactLines.filter(Boolean)
    : (Array.isArray(brand?.contactLines) ? brand.contactLines.filter(Boolean) : []);
  if (contacts.length) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "400 28px Arial, sans-serif";
    contacts.slice(0, 2).forEach((ln) => { ctx.fillText(String(ln), W / 2, y + 24); y += 40; });
  }

  y += 30;
  cardShell(ctx, y, cardH);
  let iy = y + 58;
  ctx.textAlign = "left";
  rows.items.forEach((it, idx) => {
    const raw = (items || [])[idx] || {};
    ctx.fillStyle = "#111827";
    ctx.font = "600 30px Arial, sans-serif";
    const label = `${it.qty}${it.unit ? " " + it.unit : ""} x ${it.name} — ${raw.unitPrice !== undefined ? show(raw.unitPrice) : String(it.unitPrice)}${it.unit ? " / " + it.unit : ""}`;
    wrapText(ctx, label, 560).slice(0, 1).forEach((ln) => ctx.fillText(ln, 120, iy));
    ctx.textAlign = "right";
    ctx.font = "700 32px Arial, sans-serif";
    ctx.fillText(raw.lineTotal !== undefined ? show(raw.lineTotal) : String(it.lineTotal), W - 120, iy);
    ctx.textAlign = "left";
    iy += 52;
  });
  if (rows.moreCount > 0) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "400 30px Arial, sans-serif";
    ctx.fillText(`+ ${rows.moreCount} more items`, 120, iy);
    iy += 44;
  }
  // Totals
  iy += 14;
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath(); ctx.moveTo(120, iy - 14); ctx.lineTo(W - 120, iy - 14); ctx.stroke();
  const totalRow = (label, value, { bold = false, large = false, col = "#111827" } = {}) => {
    ctx.font = large ? "800 40px Arial, sans-serif" : bold ? "700 34px Arial, sans-serif" : "400 32px Arial, sans-serif";
    ctx.fillStyle = col;
    ctx.textAlign = "left";
    ctx.fillText(label, 120, iy);
    ctx.textAlign = "right";
    ctx.fillText(value, W - 120, iy);
    ctx.textAlign = "left";
    iy += large ? 56 : 48;
  };
  if (rows.subtotal !== rows.total) totalRow(L.subtotal, display.subtotal);
  if (rows.discount > 0) totalRow(L.discount, display.discount);
  totalRow(L.total, display.total, { large: true, col: color });
  paidDisplay.forEach((p) => {
    totalRow(p.mode ? `${L.paid} (${p.mode})` : L.paid, p.text);
  });
  if (rows.change > 0) totalRow(L.changeGiven, display.change);
  if (rows.balanceDue > 0) {
    totalRow(L.balanceDue, display.balanceDue, { bold: true, col: "#b91c1c" });
  } else {
    ctx.fillStyle = "#15803d";
    ctx.font = "700 34px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(L.paidInFull, 120, iy);
    ctx.textAlign = "left";
  }
  return canvas.toDataURL("image/png");
}

export function debtCardUrl({ debtorName, amount, note }, brand) {
  const { canvas, ctx, color } = base(brand);
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = "800 56px Arial, sans-serif";
  ctx.fillText("Friendly reminder", W / 2, 470);
  ctx.fillStyle = "#4b5563";
  ctx.font = "400 36px Arial, sans-serif";
  wrapText(ctx, `Hello ${debtorName || "valued customer"},`, W - 200).slice(0, 2)
    .forEach((ln, i) => ctx.fillText(ln, W / 2, 560 + i * 48));

  cardShell(ctx, 660, 300);
  ctx.fillStyle = "#6b7280";
  ctx.font = "600 32px Arial, sans-serif";
  ctx.fillText("OUTSTANDING BALANCE", W / 2, 740);
  ctx.fillStyle = "#b91c1c";
  ctx.font = "800 96px Arial, sans-serif";
  ctx.fillText(String(amount), W / 2, 860);

  ctx.fillStyle = "#4b5563";
  ctx.font = "400 34px Arial, sans-serif";
  const msg = note || "Please pay at your earliest convenience. Thank you!";
  wrapText(ctx, msg, W - 240).slice(0, 3).forEach((ln, i) => ctx.fillText(ln, W / 2, 1040 + i * 48));
  return canvas.toDataURL("image/png");
}

export function promoCardUrl({ headline, productName, price, note }, brand) {
  const { canvas, ctx, color } = base(brand);
  ctx.textAlign = "center";
  // Badge
  ctx.fillStyle = "#ffffff";
  rr(ctx, W / 2 - 190, 400, 380, 76, 38);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = "800 38px Arial, sans-serif";
  ctx.fillText("NEW ARRIVAL", W / 2, 450);

  ctx.fillStyle = "#111827";
  ctx.font = "800 72px Arial, sans-serif";
  const headLines = wrapText(ctx, headline || productName || "Something new!", W - 160).slice(0, 2);
  headLines.forEach((ln, i) => ctx.fillText(ln, W / 2, 590 + i * 84));
  let py = 590 + headLines.length * 84 + 10;
  if (productName && headline) {
    ctx.fillStyle = "#4b5563";
    ctx.font = "400 40px Arial, sans-serif";
    ctx.fillText(productName, W / 2, py);
    py += 20;
  }
  cardShell(ctx, 800, 260);
  ctx.fillStyle = "#6b7280";
  ctx.font = "600 32px Arial, sans-serif";
  ctx.fillText("PRICE", W / 2, 880);
  ctx.fillStyle = color;
  ctx.font = "800 88px Arial, sans-serif";
  ctx.fillText(String(price || ""), W / 2, 990);
  if (note) {
    ctx.fillStyle = "#4b5563";
    ctx.font = "400 32px Arial, sans-serif";
    wrapText(ctx, note, W - 260).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, 1140 + i * 44));
  }
  return canvas.toDataURL("image/png");
}

export function thankYouCardUrl({ customerName }, brand) {
  const { canvas, ctx, color } = base(brand);
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = "800 76px Arial, sans-serif";
  ctx.fillText(RECEIPT_CARD_LABELS.thankYou, W / 2, 520);
  ctx.fillStyle = "#4b5563";
  ctx.font = "400 38px Arial, sans-serif";
  const who = customerName ? `${customerName}, thanks` : "Thanks";
  wrapText(ctx, `${who} for shopping with us. We appreciate your patronage and hope to see you again soon.`, W - 200)
    .slice(0, 4).forEach((ln, i) => ctx.fillText(ln, W / 2, 620 + i * 52));
  // Big check badge
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(W / 2, 950, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 22;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 52, 950);
  ctx.lineTo(W / 2 - 12, 992);
  ctx.lineTo(W / 2 + 56, 908);
  ctx.stroke();
  return canvas.toDataURL("image/png");
}

export function downloadCard(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename || "kopabook-card.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl || "").split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function dataUrlToFile(dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], filename, { type: blob.type || "image/png" });
}

// Mobile-first share: opens the system share sheet (WhatsApp is one tap away).
// Returns true if the share sheet opened, false if we fell back to download.
export async function shareCard(dataUrl, { title, text, filename } = {}) {
  const file = dataUrlToFile(dataUrl, filename || "kopabook-card.png");
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || "KopaBook", text: text || "" });
      return true;
    }
  } catch (e) {
    if (String(e && e.name) === "AbortError") return true; // user closed the sheet
  }
  downloadCard(dataUrl, filename);
  return false;
}
