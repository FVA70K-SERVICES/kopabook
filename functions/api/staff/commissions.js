// /api/staff/commissions - GET per-member commission report (owner/manager only).
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD.
//
// COMMISSION ATTRIBUTION RULE
// 1. Primary: sales.staff_user_id - the sales table already records which user
//    recorded each sale, so any sale with a matching business member is
//    attributed to that member. This is the authoritative source because it is
//    set at the point of sale (STREAM F / others can also set it from the
//    sales screen) and does not depend on clock data being complete.
// 2. Fallback: when staff_user_id is NULL (e.g. legacy sales made before
//    attribution, or owner sales), the sale is attributed to the member whose
//    shift covers the sale time (clock_in <= sale time, and shift is still open
//    or clock_out >= sale time). If more than one member's shift covers the
//    sale time, it goes to the shift that started earliest that day; if none
//    covers it, the sale is counted as unattributed and excluded from every
//    member's total.
// Commission due = sales_total * commission_percent / 100.
import { json, getAuthContext, requireAuth, canManage, toSqliteDate } from "../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can view commissions." }, 403);
    }

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from") || toSqliteDate().slice(0, 10);
    const to = url.searchParams.get("to") || toSqliteDate().slice(0, 10);
    const fromStart = `${from} 00:00:00`;
    const toEnd = `${to} 23:59:59`;

    const membersRes = await context.env.KOPABOOK_DB.prepare(
      `SELECT bm.id AS member_id, bm.user_id, bm.role AS business_role,
              bm.commission_percent, u.full_name AS name
       FROM business_members bm
       INNER JOIN users u ON u.id = bm.user_id
       WHERE bm.business_id = ?`
    ).bind(auth.business.id).all();
    const members = membersRes.results || [];
    const byUserId = new Map(members.map((m) => [m.user_id, m]));

    const salesRes = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, staff_user_id, total_amount, created_at
       FROM sales
       WHERE business_id = ? AND created_at BETWEEN ? AND ?`
    ).bind(auth.business.id, fromStart, toEnd).all();
    const sales = salesRes.results || [];

    // Shifts for the range (extended by open shifts that started before "from").
    const shiftsRes = await context.env.KOPABOOK_DB.prepare(
      `SELECT member_id, clock_in, clock_out
       FROM staff_shifts
       WHERE business_id = ? AND (clock_out IS NULL OR clock_out >= ?)
         AND clock_in <= ?
       ORDER BY clock_in ASC`
    ).bind(auth.business.id, fromStart, toEnd).all();
    const shifts = shiftsRes.results || [];

    const totals = new Map(); // member_id -> { salesTotal, salesCount }
    for (const m of members) totals.set(m.member_id, { salesTotal: 0, salesCount: 0 });
    let unattributedTotal = 0;
    let unattributedCount = 0;

    function coveringMemberId(saleTime) {
      let best = null;
      for (const s of shifts) {
        if (s.clock_in <= saleTime && (s.clock_out === null || saleTime <= s.clock_out)) {
          if (!best || s.clock_in < best.clock_in) best = s;
        }
      }
      return best ? best.member_id : null;
    }

    for (const s of sales) {
      let memberId = null;
      if (s.staff_user_id && byUserId.has(s.staff_user_id)) {
        memberId = byUserId.get(s.staff_user_id).member_id;
      } else {
        memberId = coveringMemberId(s.created_at);
      }
      if (memberId && totals.has(memberId)) {
        const t = totals.get(memberId);
        t.salesTotal += Number(s.total_amount || 0);
        t.salesCount += 1;
      } else {
        unattributedTotal += Number(s.total_amount || 0);
        unattributedCount += 1;
      }
    }

    const report = members.map((m) => {
      const t = totals.get(m.member_id);
      const percent = Number(m.commission_percent || 0);
      return {
        memberId: m.member_id,
        name: m.name,
        role: m.business_role,
        commissionPercent: percent,
        salesTotal: Math.round(t.salesTotal * 100) / 100,
        salesCount: t.salesCount,
        commissionDue: Math.round((t.salesTotal * percent) / 100 * 100) / 100,
      };
    });

    return json({
      ok: true, from, to, report,
      unattributedTotal: Math.round(unattributedTotal * 100) / 100,
      unattributedCount,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not build commission report.", error: String(error) }, 500);
  }
}
