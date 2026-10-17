// Branded share cards for WhatsApp, drawn on canvas in the browser.
// Free tier: the merchant shares the image themselves (Web Share sheet on
// mobile, download fallback on desktop). No paid APIs involved.
const W = 1080;
const H = 1350;

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

function base(brand) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const color = brand?.color || "#166534";
  // Background
  ctx.fillStyle = "#f7f8f4";
  ctx.fillRect(0, 0, W, H);
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
  // Footer
  ctx.fillStyle = "#6b7280";
  ctx.font = "400 28px Arial, sans-serif";
  ctx.fillText("Powered by KopaBook", W / 2, H - 60);
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

export function receiptCardUrl({ saleNumber, date, items, total, paid, balanceDue, customerName }, brand) {
  const { canvas, ctx, color } = base(brand);
  let y = 400;
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = "800 52px Arial, sans-serif";
  ctx.fillText("Receipt", W / 2, y); y += 52;
  ctx.fillStyle = "#6b7280";
  ctx.font = "400 32px Arial, sans-serif";
  if (saleNumber) { ctx.fillText(saleNumber, W / 2, y); y += 44; }
  if (date) { ctx.fillText(date, W / 2, y); y += 20; }
  if (customerName) { ctx.fillText("Customer: " + customerName, W / 2, y + 24); y += 44; }

  y += 30;
  const list = (items || []).slice(0, 8);
  const cardH = 70 + list.length * 56 + 150;
  cardShell(ctx, y, cardH);
  let iy = y + 64;
  ctx.textAlign = "left";
  for (const it of list) {
    ctx.fillStyle = "#111827";
    ctx.font = "600 32px Arial, sans-serif";
    const label = `${it.qty}${it.unit ? " " + it.unit : ""} x ${it.name}`;
    wrapText(ctx, label, 560).slice(0, 1).forEach((ln) => ctx.fillText(ln, 120, iy));
    ctx.textAlign = "right";
    ctx.font = "700 32px Arial, sans-serif";
    ctx.fillText(String(it.unitPrice), W - 120, iy);
    ctx.textAlign = "left";
    iy += 56;
  }
  // Totals
  iy += 20;
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath(); ctx.moveTo(120, iy - 30); ctx.lineTo(W - 120, iy - 30); ctx.stroke();
  ctx.font = "800 38px Arial, sans-serif";
  ctx.fillStyle = "#111827";
  ctx.fillText("Total", 120, iy + 10);
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.fillText(String(total), W - 120, iy + 10);
  ctx.textAlign = "left"; iy += 62;
  if (balanceDue && Number(String(balanceDue).replace(/[^0-9.]/g, "")) > 0) {
    ctx.fillStyle = "#b91c1c";
    ctx.font = "700 34px Arial, sans-serif";
    ctx.fillText("Balance due", 120, iy);
    ctx.textAlign = "right";
    ctx.fillText(String(balanceDue), W - 120, iy);
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = "#15803d";
    ctx.font = "700 34px Arial, sans-serif";
    ctx.fillText("Paid in full. Thank you!", 120, iy);
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
  ctx.fillText("Thank you!", W / 2, 520);
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

function dataUrlToFile(dataUrl, filename) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
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
