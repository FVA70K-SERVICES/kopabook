// WORLD-BEST (Dashboard stream): money-kind helpers shared by the Dashboard
// and sales endpoints. No business, currency, or customer is hardcoded here.
// A payment mode is credit-kind (buy-now-pay-later) when its kind is
// 'credit' OR — before migration 0061 runs, when the payment_modes.kind
// column does not exist yet — when its NAME is exactly 'credit'
// (case-insensitive). See AUDIT.md: if Fortune's "Credit" mode means card
// payment rather than buy-now-pay-later, the mode must be renamed in
// Settings instead; past sales are never rewritten.

export const PAYMENT_KINDS = ["cash", "transfer", "card", "credit"];

export function isValidKind(kind) {
  return PAYMENT_KINDS.includes(String(kind || "").trim().toLowerCase());
}

// mode may be a string (the mode name), or a row/object { kind, name }.
export function isCreditKind(mode) {
  if (!mode) return false;
  if (typeof mode === "string") return mode.trim().toLowerCase() === "credit";
  const kind = String(mode.kind || "").trim().toLowerCase();
  if (kind) return kind === "credit";
  // No kind recorded (pre-migration row): fall back to the name.
  return String(mode.name || "").trim().toLowerCase() === "credit";
}

// A mode is the cash kind when kind is 'cash', or — with no kind recorded —
// when its name is exactly 'cash' (case-insensitive). Unknown modes are not
// cash: change may only come from the cash portion of a tender.
export function isCashKind(mode) {
  if (!mode) return false;
  if (typeof mode === "string") return mode.trim().toLowerCase() === "cash";
  const kind = String(mode.kind || "").trim().toLowerCase();
  if (kind) return kind === "cash";
  return String(mode.name || "").trim().toLowerCase() === "cash";
}

// Look a tender mode name up in the business's payment_modes rows.
// Matching is case-insensitive on the trimmed name. Returns the row, or
// null when the business has no such mode (unknown modes are treated by
// name only, so pre-migration behaviour is preserved).
export function findModeRow(modeRows, modeName) {
  const want = String(modeName || "").trim().toLowerCase();
  if (!want) return null;
  for (const row of modeRows || []) {
    if (String(row.name || "").trim().toLowerCase() === want) return row;
  }
  return null;
}

// Split today's tendered amounts into money actually received.
// tenderedByMethod: { methodName: amount } as summed from payment_records.
// changeGiven: change handed back today.
// Returns { moneyInByMethod, creditTendered, actuallyReceived }.
// moneyInByMethod excludes credit-kind modes entirely. actuallyReceived =
// tendered minus credit-kind tender minus change given.
export function computeMoneySplit(tenderedByMethod, changeGiven, modeRows) {
  const moneyInByMethod = {};
  let creditTendered = 0;
  let tenderedTotal = 0;
  for (const [method, total] of Object.entries(tenderedByMethod || {})) {
    const amount = Number(total || 0);
    tenderedTotal += amount;
    const row = findModeRow(modeRows, method);
    if (isCreditKind(row || method)) {
      creditTendered += amount;
    } else {
      moneyInByMethod[method] = Math.round(amount * 100) / 100;
    }
  }
  const change = Number(changeGiven || 0);
  const actuallyReceived = Math.round((tenderedTotal - creditTendered - change) * 100) / 100;
  return {
    moneyInByMethod,
    creditTendered: Math.round(creditTendered * 100) / 100,
    actuallyReceived,
  };
}

// Format an amount with the business currency code, e.g. "NGN 1,000,000".
// Plain text only; no currency symbol lookup is needed server-side.
export function fmtMoney(amount, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "NGN";
  return `${code} ${Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
