// /api/staff/attendance - GET shift list for a date range (owner/manager only).
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, local day granularity).
import { json, getAuthContext, requireAuth, canManage, toSqliteDate } from "../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can view attendance." }, 403);
    }

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from") || toSqliteDate().slice(0, 10);
    const to = url.searchParams.get("to") || toSqliteDate().slice(0, 10);
    const fromStart = `${from} 00:00:00`;
    const toEnd = `${to} 23:59:59`;

    const shifts = await context.env.KOPABOOK_DB.prepare(
      `SELECT s.id, s.clock_in, s.clock_out, bm.id AS member_id,
              bm.role AS business_role, u.full_name AS name
       FROM staff_shifts s
       INNER JOIN business_members bm ON bm.id = s.member_id
       INNER JOIN users u ON u.id = bm.user_id
       WHERE s.business_id = ? AND s.clock_in BETWEEN ? AND ?
       ORDER BY s.clock_in DESC`
    ).bind(auth.business.id, fromStart, toEnd).all();

    return json({ ok: true, from, to, shifts: shifts.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load attendance.", error: String(error) }, 500);
  }
}
