// Kopa AI — Product/customer matching, reminders, business time, name similarity.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Split verbatim from chat.js; the dead "column not migrated yet"
// fallbacks were then removed (Phase 7.3: the columns are relied on
// directly — live D1 has them).

export async function matchProduct(db, businessId, name) {
  // Defence in depth: the fast path strips time words before matching,
  // but the model path can still ask for "laptop now". A time word is
  // never part of a product name, so drop it before matching.
  const raw = cleanProductQuery(name);
  // Numeric id fast-path.
  // Phase 7.3: the unit column (migration 0042) is relied on directly;
  // live D1 has it.
  if (/^\d+$/.test(raw)) {
    const r = await db.prepare(
      `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock
       FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
       WHERE p.id = ? AND p.business_id = ? AND p.is_active = 1 LIMIT 1`
    ).bind(Number(raw), businessId).first();
    if (r) return [{ id: r.id, name: r.name, price: Number(r.unit_price) || 0, unit: r.unit || "piece", stock: Number(r.stock) || 0 }];
  }
  const like = `%${raw.toLowerCase()}%`;
  const rs = await db.prepare(
    `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock
     FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
     WHERE p.business_id = ? AND p.is_active = 1 AND LOWER(p.name) LIKE ? LIMIT 5`
  ).bind(businessId, like).all();
  const rows = (rs.results || []).map((p) => ({
    id: p.id, name: p.name, price: Number(p.unit_price) || 0, unit: p.unit || "piece", stock: Number(p.stock) || 0,
  }));
  // Prefer an exact (case-insensitive) name hit when several fuzzy matches exist.
  const exact = rows.filter((p) => p.name.toLowerCase() === raw.toLowerCase());
  return exact.length === 1 ? [exact[0]] : rows;
}

// Time words and filler are never part of a product name. "laptop now"
// is the product Laptop plus the word "now".
function cleanProductQuery(name) {
  const raw = String(name || "").trim();
  const cleaned = raw
    .replace(/\b(now|today|just|yesterday|recently|tonight|this morning|this afternoon|this evening)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw;
}

// The closest real product names to a name that was not found, best
// first, up to three. Used by the not-found clarifications so the owner
// is offered real names to pick from instead of a bare rejection. When
// nothing is close, the first names in catalogue order are still more
// useful than silence.
async function closestProductNames(db, businessId, name, limit = 3) {
  let rows = [];
  try {
    const rs = await db.prepare(
      `SELECT name FROM products WHERE business_id = ? AND is_active = 1 LIMIT 100`
    ).bind(businessId).all();
    rows = (rs.results || []).map((r) => String(r.name)).filter(Boolean);
  } catch (e) {
    return [];
  }
  if (!rows.length) return [];
  const wanted = String(name || "").toLowerCase().trim();
  const score = (candidate) => {
    const c = candidate.toLowerCase();
    if (!wanted) return 0;
    if (c === wanted) return 100;
    if (c.includes(wanted) || wanted.includes(c)) return 80;
    const cw = c.split(/\s+/);
    const ww = wanted.split(/\s+/);
    const shared = cw.filter((x) => ww.some((y) => namesSimilar(x, y))).length;
    if (shared) return 50 + shared * 10;
    if (namesSimilar(c, wanted)) return 40;
    return 0;
  };
  return rows
    .map((n) => ({ name: n, s: score(n) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.name);
}

// One short not-found line that lists the closest real product names
// when there are any, so the owner can pick one. Never invents a name.
export async function productNotFoundLine(db, businessId, requested) {
  const clean = cleanProductQuery(requested);
  const closest = await closestProductNames(db, businessId, clean);
  if (!closest.length) return `I could not find "${clean}" in your products. Check the name and try again.`;
  const list = closest.length === 1
    ? closest[0]
    : closest.slice(0, -1).join(", ") + ", or " + closest[closest.length - 1];
  return `I could not find "${clean}" in your products. Did you mean ${list}?`;
}

export async function matchCustomer(db, businessId, name) {
  const like = `%${String(name).trim().toLowerCase()}%`;
  const rs = await db.prepare(
    `SELECT c.id, c.name, COALESCE((SELECT balance_after FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS bal
     FROM customers c WHERE c.business_id = ? AND LOWER(c.name) LIKE ? LIMIT 5`
  ).bind(businessId, like).all();
  const rows = (rs.results || []).map((c) => ({ id: c.id, name: c.name, balance: Number(c.bal) || 0 }));
  const exact = rows.filter((c) => c.name.toLowerCase() === String(name).trim().toLowerCase());
  return exact.length === 1 ? [exact[0]] : rows;
}

// ---------------------------------------------------------------------------
// Natural-language remind_at parser. Accepts "tomorrow 9am", "in 3 hours",
// "2026-10-25 14:00", weekday names. Defaults to tomorrow 9am WAT.
// Returns "YYYY-MM-DD HH:MM:SS" in UTC.
// ---------------------------------------------------------------------------
export function parseRemindAt(text, businessTz) {
  const WAT = 1; // Africa/Lagos
  const now = new Date();
  const nowWat = new Date(now.getTime() + WAT * 3600 * 1000);
  const t = String(text || "").trim().toLowerCase();
  const toUtc = (watDate) => {
    const utc = new Date(watDate.getTime() - WAT * 3600 * 1000);
    return utc.toISOString().slice(0, 19).replace("T", " ");
  };
  const atTime = (base, hh, mm) => {
    const d = new Date(base);
    d.setUTCHours(hh, mm || 0, 0, 0);
    return d;
  };
  const parseClock = (s) => {
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    let hh = Number(m[1]);
    const mm = Number(m[2] || 0);
    const ap = m[3];
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  };

  let m;
  if ((m = t.match(/in\s+(\d+)\s*(minute|hour|day)s?/))) {
    const n = Number(m[1]);
    const ms = m[2].startsWith("minute") ? n * 60000 : m[2].startsWith("hour") ? n * 3600000 : n * 86400000;
    return toUtc(new Date(nowWat.getTime() + ms));
  }
  if ((m = t.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?)?/))) {
    const [y, mo, d] = m[1].split("-").map(Number);
    const hh = m[2] !== undefined ? Number(m[2]) : 9;
    const mm = m[3] !== undefined ? Number(m[3]) : 0;
    return toUtc(new Date(Date.UTC(y, mo - 1, d, hh, mm, 0)));
  }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayIdx = days.findIndex((d) => t.includes(d));
  let base = new Date(nowWat);
  let hasDateHint = false;
  if (t.includes("tomorrow")) {
    base = new Date(base.getTime() + 86400000);
    hasDateHint = true;
  } else if (t.includes("today")) {
    hasDateHint = true;
  } else if (dayIdx >= 0) {
    let delta = (dayIdx - base.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    base = new Date(base.getTime() + delta * 86400000);
    hasDateHint = true;
  }
  const clock = parseClock(t);
  if (!hasDateHint && !clock) {
    // Unparseable: default to tomorrow 9am WAT.
    base = new Date(base.getTime() + 86400000);
  }
  const { hh, mm } = clock || { hh: 9, mm: 0 };
  return toUtc(atTime(base, hh, mm));
}

const BUSINESS_TIME_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Display a stored UTC "YYYY-MM-DD HH:MM:SS" instant in the business
// timezone (round 5). The stored value stays UTC; only the words
// change: "2026-11-07 14:00:00" in Africa/Lagos reads "3:00 pm
// tomorrow, 7 Nov" when today is 6 Nov. The raw UTC stamp used to show
// in the reminder proposal and done message, where 14:00 UTC read as
// 2pm instead of 3pm WAT. An unparseable stamp, or an unknown timezone,
// falls back to the raw stamp with no crash. Pure, exported for tests.
export function formatBusinessTime(utcStamp, tz, now) {
  const raw = String(utcStamp || "");
  const at = new Date(raw.replace(" ", "T") + "Z");
  if (!raw || Number.isNaN(at.getTime())) return raw;
  const zone = tz || "Africa/Lagos";
  const ref = now instanceof Date ? now : new Date();
  try {
    const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });
    const localDate = dateFmt.format(at);
    const refDate = dateFmt.format(ref);
    const time = timeFmt.format(at).toLowerCase();
    const [y, mo, d] = localDate.split("-").map(Number);
    const dayMs = 24 * 3600 * 1000;
    const diff = Math.round((Date.parse(localDate + "T00:00:00Z") - Date.parse(refDate + "T00:00:00Z")) / dayMs);
    let dayWord;
    if (diff === 0) dayWord = "today";
    else if (diff === 1) dayWord = "tomorrow";
    else if (diff === -1) dayWord = "yesterday";
    else dayWord = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(at);
    return `${time} ${dayWord}, ${d} ${BUSINESS_TIME_MONTHS[mo - 1]}`;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Tool executors. Each returns { ok, summary, clarification? }.
// clarification (string) means: do not execute, ask the user this instead.
// ---------------------------------------------------------------------------
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Close-name test for S3/S5: contains, shared first word, singular/plural,
// or a small edit distance. Never across businesses: callers only pass
// names already resolved inside this business.
export function namesSimilar(a, b) {
  const na = String(a || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nb = String(b || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!na || !nb || na === nb) return na === nb;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  const sing = (s) => (s.endsWith("s") ? s.slice(0, -1) : s);
  if (sing(na) === sing(nb)) return true;
  const fa = na.split(" ")[0], fb = nb.split(" ")[0];
  if (fa.length >= 3 && fa === fb) return true;
  if (na.length >= 4 && nb.length >= 4 && levenshtein(na, nb) <= 2) return true;
  return false;
}
