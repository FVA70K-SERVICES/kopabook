// /api/staff/clock - staff clock in / clock out (self only).
// GET: current shift status for the signed-in member.
// POST: { action: "in" | "out" }.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../_utils";

async function memberRow(context, auth) {
  return await context.env.KOPABOOK_DB.prepare(
    `SELECT id FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
  ).bind(auth.business.id, auth.user.id).first();
}

async function openShift(context, auth, memberId) {
  return await context.env.KOPABOOK_DB.prepare(
    `SELECT id, clock_in FROM staff_shifts
     WHERE business_id = ? AND member_id = ? AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1`
  ).bind(auth.business.id, memberId).first();
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const member = await memberRow(context, auth);
    if (!member) return json({ ok: true, clockedIn: false });

    const open = await openShift(context, auth, member.id);
    return json({
      ok: true,
      clockedIn: !!open,
      clockIn: open ? open.clock_in : null,
      shiftId: open ? open.id : null,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not check clock status.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const member = await memberRow(context, auth);
    if (!member) return json({ ok: false, message: "No staff record for this account." }, 403);

    const body = await context.request.json().catch(() => ({}));
    const action = body.action;
    const now = toSqliteDate();
    const open = await openShift(context, auth, member.id);

    if (action === "in") {
      if (open) {
        return json({ ok: false, message: "You are already clocked in.", clockIn: open.clock_in }, 409);
      }
      const res = await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO staff_shifts (business_id, member_id, clock_in, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(auth.business.id, member.id, now, now).run();
      await audit(context, auth, "staff.clock_in", "staff_shift", res.meta.last_row_id, {});
      return json({ ok: true, clockedIn: true, clockIn: now }, 201);
    }

    if (action === "out") {
      if (!open) {
        return json({ ok: false, message: "You are not clocked in." }, 409);
      }
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE staff_shifts SET clock_out = ? WHERE id = ?`
      ).bind(now, open.id).run();
      await audit(context, auth, "staff.clock_out", "staff_shift", open.id, { clockIn: open.clock_in });
      return json({ ok: true, clockedIn: false, clockIn: open.clock_in, clockOut: now });
    }

    return json({ ok: false, message: "action must be \"in\" or \"out\"." }, 400);
  } catch (error) {
    return json({ ok: false, message: "Could not record clock action.", error: String(error) }, 500);
  }
}
