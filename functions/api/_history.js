// Central History store for KopaBook (world-best upgrade, stream: History).
//
// "History" is the one record store for everything that happens in a
// business. One row per event, append-only: the app never updates or
// deletes a history row, and a failed history write never breaks the
// operation that triggered it.
//
// Why history_events and not the older audit_logs:
//   audit_logs (written by audit() in _utils.js) stores actor_user_id,
//   action_type, entity_type, entity_id and a metadata_json blob. It has
//   no actor name/role snapshot, no human-readable summary line and no
//   amount, and there is no /api/activity endpoint in the base snapshot
//   that reads it (Activity.jsx calls /api/activity, but no such function
//   file exists at base head 077c05c). history_events (migration 0061)
//   stores exactly what History needs: business_id, actor snapshot,
//   type, entity, one plain summary line, amount, created_at.
//   audit_logs is left untouched; both trails can coexist.
//
// Types: sale | expense | payment | debt | stock | customer | staff |
//   settings | receipt. `amount` is in business currency when the event
//   has one, else null. A summary is one plain line a human can read,
//   e.g. "Sold 5 Laptops to Favour — NGN 2,837,820". Summaries never
//   contain cost or profit figures.
import { toSqliteDate } from "./_utils";

export const HISTORY_TYPES = [
  "sale",
  "expense",
  "payment",
  "debt",
  "stock",
  "customer",
  "staff",
  "settings",
  "receipt",
];

export const HISTORY_TYPE_LABELS = {
  sale: "Sale",
  expense: "Expense",
  payment: "Payment",
  debt: "Debt",
  stock: "Stock",
  customer: "Customer",
  staff: "Staff",
  settings: "Settings",
  receipt: "Receipt",
};

// Types a non-owner / non-partner staff member may see. Staff see the
// operational events for pages they can already open, but NEVER staff
// actions (including other people's), NEVER settings changes and NEVER
// receipt sends. Cost/profit never appear because recordHistory callers
// never write cost or profit into a summary or amount.
export const STAFF_VISIBLE_TYPES = [
  "sale",
  "expense",
  "payment",
  "debt",
  "stock",
  "customer",
];

export function isHistoryType(t) {
  return HISTORY_TYPES.includes(String(t || ""));
}

// Server-side visibility rule, applied in history.js on top of the SQL
// filter (defence in depth: a row is only returned when both agree).
export function eventVisibleToRole(role, type) {
  if (role === "owner" || role === "partner") return true;
  return STAFF_VISIBLE_TYPES.includes(String(type || ""));
}

// Escape LIKE wildcards in free-text search so "%" and "_" match literally.
export function escapeLike(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Sign of an event's amount in a running balance. Sales and debts raise
// what is owed / money in; payments and expenses lower it. Stock,
// customer, staff, settings and receipt events carry no balance movement
// even when they have an amount attached.
export function historySign(type) {
  if (type === "sale" || type === "debt") return 1;
  if (type === "payment" || type === "expense") return -1;
  return 0;
}

// Insert one history row. NEVER throws and NEVER breaks the caller:
// any failure (table missing before migration 0061 runs, bad input, D1
// error) is logged server-side only and the call resolves false.
export async function recordHistory(env, evt) {
  try {
    const e = evt || {};
    const businessId = Number(e.businessId);
    const summary = String(e.summary || "").trim();
    if (!businessId || !summary) return false;
    if (!isHistoryType(e.type)) return false;
    const amount =
      e.amount === null || e.amount === undefined || e.amount === ""
        ? null
        : Number(e.amount);
    if (amount !== null && Number.isNaN(amount)) return false;
    const db = env && env.KOPABOOK_DB;
    if (!db) return false;
    const res = await db
      .prepare(
        `INSERT INTO history_events
           (business_id, actor_id, actor_name, actor_role, type, entity_type, entity_id, summary, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        businessId,
        e.actorId === undefined || e.actorId === null ? null : Number(e.actorId),
        e.actorName ? String(e.actorName).slice(0, 120) : null,
        e.actorRole ? String(e.actorRole).slice(0, 40) : null,
        String(e.type),
        e.entityType ? String(e.entityType).slice(0, 40) : null,
        e.entityId === undefined || e.entityId === null ? null : Number(e.entityId),
        summary.slice(0, 500),
        amount,
        toSqliteDate()
      )
      .run();
    return !!(res && res.meta && res.meta.last_row_id);
  } catch (err) {
    try {
      console.error("[history] record failed:", String((err && err.message) || err));
    } catch {
      // Logging must never throw either.
    }
    return false;
  }
}

// Build the (parameterised) list + count queries for GET /api/history.
// Filtering happens in SQL, business-scoped, newest first. `visibleTypes`
// is the role-filtered type list; when null, no type restriction applies
// beyond the caller's explicit `type` filter.
export function buildHistoryQuery({ businessId, from, to, type, person, q, limit, offset, visibleTypes, maxLimit }) {
  const where = ["business_id = ?"];
  const params = [businessId];
  if (from) {
    where.push("date(created_at) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("date(created_at) <= ?");
    params.push(to);
  }
  if (type && isHistoryType(type)) {
    if (Array.isArray(visibleTypes) && !visibleTypes.includes(type)) {
      // A staff caller asking for a type they may never see gets zero
      // rows (list and count agree) instead of a count that disagrees
      // with the row-level filter.
      where.push("1 = 0");
    } else {
      where.push("type = ?");
      params.push(type);
    }
  } else if (Array.isArray(visibleTypes)) {
    where.push(`type IN (${visibleTypes.map(() => "?").join(", ")})`);
    params.push(...visibleTypes);
  }
  if (person) {
    where.push("actor_id = ?");
    params.push(Number(person));
  }
  if (q) {
    where.push("summary LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(q)}%`);
  }
  const whereSql = "WHERE " + where.join(" AND ");
  const lim = Math.max(1, Math.min(Number(limit) || 50, Math.max(1, Number(maxLimit) || 100)));
  const off = Math.max(0, Number(offset) || 0);
  return {
    sql:
      `SELECT id, created_at, type, actor_id, actor_name, actor_role, summary, amount, entity_type, entity_id ` +
      `FROM history_events ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    params: [...params, lim, off],
    countSql: `SELECT COUNT(*) AS n FROM history_events ${whereSql}`,
    countParams: params,
    limit: lim,
    offset: off,
  };
}
