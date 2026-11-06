// GET /api/history — the business History record (world-best upgrade).
//
// Free for every plan: it is the owner's own record. Viewing and
// printing a statement are free; CSV export (?csv=1) is Starter-gated
// exactly like /api/reports (tiers pro / solo / starter, same
// getBusinessOwnerTier helper, same { upgradeRequired: true } 403).
//
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sale&person=<actor_id>
//   &q=<free text>&limit=50&offset=0  (limit capped at 100)
//   &csv=1  (CSV export instead of JSON; same filters apply)
//
// Role rules, enforced server-side (SQL filter + a second row-level
// check below, never just by hiding rows in the UI):
//   owner / partner: everything, all types.
//   every other staff role: only sale, expense, payment, debt, stock and
//     customer events — never staff actions, never settings changes,
//     never receipt sends. Summaries never contain cost or profit
//     figures, because recordHistory callers never write them.
// Every query filters by business_id: per-business isolation is absolute.
import { json, getAuthContext, requireAuth } from "./_utils";
import { getBusinessOwnerTier } from "./billing";
import {
  buildHistoryQuery,
  eventVisibleToRole,
  HISTORY_TYPES,
  STAFF_VISIBLE_TYPES,
  historySign,
} from "./_history";

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function historyCsv(events, { businessName, from, to }) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(","));
  row(["KopaBook History", businessName || "", `${from || ""} to ${to || ""}`]);
  row([]);
  row(["Date", "Time", "Type", "Who", "Role", "Summary", "Amount"]);
  for (const e of events) {
    const when = String(e.created_at || "");
    row([
      when.slice(0, 10),
      when.slice(11, 19),
      e.type,
      e.actor_name || "",
      e.actor_role || "",
      e.summary || "",
      e.amount === null || e.amount === undefined ? "" : e.amount,
    ]);
  }
  return lines.join("\r\n");
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const db = context.env.KOPABOOK_DB;
    const bid = auth.business.id;
    const role = auth.business.role;
    const isFull = role === "owner" || role === "partner";
    const visibleTypes = isFull ? null : STAFF_VISIBLE_TYPES;

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const type = url.searchParams.get("type") || "";
    const person = url.searchParams.get("person") || "";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const wantCsv = url.searchParams.get("csv") === "1";

    // CSV export is the one gated part of History: Starter, like Reports.
    if (wantCsv) {
      const { tier } = await getBusinessOwnerTier(db, bid);
      if (!["pro", "solo", "starter"].includes(tier)) {
        return json(
          { ok: false, upgradeRequired: true, message: "CSV export of history is a Starter feature. Upgrade to use it." },
          403
        );
      }
    }

    const built = buildHistoryQuery({
      businessId: bid,
      from,
      to,
      type,
      person,
      q,
      limit: wantCsv ? 1000 : url.searchParams.get("limit"),
      offset: wantCsv ? 0 : url.searchParams.get("offset"),
      visibleTypes,
      maxLimit: wantCsv ? 1000 : 100,
    });

    const totalRow = await db.prepare(built.countSql).bind(...built.countParams).first();
    const total = Number(totalRow?.n || 0);
    const res = await db.prepare(built.sql).bind(...built.params).all();
    // Second enforcement layer: drop any row the role may not see, even
    // if the SQL filter were ever widened by mistake.
    const events = (res.results || [])
      .filter((e) => eventVisibleToRole(role, e.type))
      .map((e) => ({
        id: e.id,
        created_at: e.created_at,
        type: e.type,
        actor_name: e.actor_name,
        actor_role: e.actor_role,
        summary: e.summary,
        amount: e.amount === null || e.amount === undefined ? null : Number(e.amount),
        entity_type: e.entity_type,
        entity_id: e.entity_id,
      }));

    if (wantCsv) {
      const csv = historyCsv(events, { businessName: auth.business.name, from, to });
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="kopabook-history-${from || "all"}-to-${to || "all"}.csv"`,
        },
      });
    }

    // People filter options: distinct actors behind the events this
    // caller is allowed to see. Staff never learn about staff/settings
    // actors through this list.
    const actorSql =
      `SELECT DISTINCT actor_id AS id, actor_name AS name FROM history_events ` +
      `WHERE business_id = ? AND actor_id IS NOT NULL AND actor_name IS NOT NULL ` +
      (visibleTypes ? `AND type IN (${visibleTypes.map(() => "?").join(", ")}) ` : "") +
      `ORDER BY actor_name ASC`;
    const actorParams = visibleTypes ? [bid, ...visibleTypes] : [bid];
    const actorRes = await db.prepare(actorSql).bind(...actorParams).all();

    // History starts the day this upgrade lands: the earliest recorded
    // event, or today when nothing is recorded yet.
    const firstRow = await db
      .prepare(`SELECT MIN(created_at) AS first_at FROM history_events WHERE business_id = ?`)
      .bind(bid)
      .first();
    const startedAt = firstRow?.first_at
      ? String(firstRow.first_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    return json({
      ok: true,
      events,
      total,
      limit: built.limit,
      offset: built.offset,
      actors: (actorRes.results || []).map((a) => ({ id: a.id, name: a.name })),
      types: HISTORY_TYPES,
      startedAt,
      // Signed running-balance helper, per event, for statement views:
      // +1 sale/debt, -1 payment/expense, 0 everything else.
      sign: Object.fromEntries(HISTORY_TYPES.map((t) => [t, historySign(t)])),
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load history.", error: String(error) }, 500);
  }
}
