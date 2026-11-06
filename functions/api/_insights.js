// WORLD-BEST (Dashboard stream): pure insight helpers for the Dashboard.
// No database access here, so these are unit-testable in isolation.
// Nothing is invented: every helper returns null when there is no data,
// and the Dashboard says so in one line instead of showing a fake insight.

// Busiest hour today. timestamps: created_at strings ("YYYY-MM-DD HH:MM:SS",
// stored in UTC). The hour is taken in the business timezone, so a Lagos
// business sees Lagos hours, not UTC hours.
// Returns { hour, label, count } or null when there are no sales.
// label is a short 12-hour label, e.g. "2pm", "11am".
export function busiestHour(timestamps, timezone) {
  const list = (timestamps || []).filter(Boolean);
  if (!list.length) return null;
  const zone = timezone || "Africa/Lagos";
  let hourFmt;
  try {
    hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hour12: false });
  } catch {
    hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false });
  }
  const counts = new Map();
  for (const ts of list) {
    // Stored timestamps are UTC ("YYYY-MM-DD HH:MM:SS"); parse as UTC.
    const d = new Date(String(ts).replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) continue;
    const hour = Number(hourFmt.format(d)) % 24;
    counts.set(hour, (counts.get(hour) || 0) + 1);
  }
  if (!counts.size) return null;
  let bestHour = null;
  let bestCount = 0;
  for (const [hour, count] of counts) {
    if (count > bestCount || (count === bestCount && (bestHour === null || hour < bestHour))) {
      bestHour = hour;
      bestCount = count;
    }
  }
  const h12 = bestHour % 12 === 0 ? 12 : bestHour % 12;
  const label = `${h12}${bestHour < 12 ? "am" : "pm"}`;
  return { hour: bestHour, label, count: bestCount };
}

// Top debtor from rows shaped { name, outstanding }.
// Returns { name, amount } or null when nobody owes anything.
export function topDebtor(rows) {
  let best = null;
  for (const r of rows || []) {
    const amount = Number(r.outstanding || 0);
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { name: r.name || "Customer", amount: Math.round(amount * 100) / 100 };
    }
  }
  return best;
}

// Best seller today from rows shaped { name, qty, revenue } (highest revenue).
// Returns { name, qty, revenue } or null when nothing sold.
export function bestSeller(rows) {
  let best = null;
  for (const r of rows || []) {
    const revenue = Number(r.revenue || 0);
    if ((!best || revenue > best.revenue)) {
      best = {
        name: r.name || "Product",
        qty: Number(r.qty || 0),
        revenue: Math.round(revenue * 100) / 100,
      };
    }
  }
  // A zero-revenue best seller is still "no sales": say so instead.
  if (!best || best.revenue <= 0) return null;
  return best;
}

// Is a debt overdue? lastActivity: latest ledger created_at ("YYYY-MM-DD
// HH:MM:SS" or a date string); overdueDays: owner-set, default 7.
// A debt counts as overdue when its last activity is more than
// overdueDays ago. Missing activity dates are not overdue.
export function isOverdue(lastActivity, overdueDays) {
  if (!lastActivity) return false;
  const days = Number(overdueDays === null || overdueDays === undefined ? 7 : overdueDays);
  const raw = String(lastActivity);
  const iso = raw.length === 10 ? `${raw}T00:00:00Z` : `${raw.replace(" ", "T")}${raw.includes("Z") ? "" : "Z"}`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return (Date.now() - at.getTime()) / 86400000 > days;
}
