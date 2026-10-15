// /api/staff - GET list members, POST invite (owner/manager only)
import { json, getAuthContext, requireAuth, hashPassword, audit, toSqliteDate } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const members = await context.env.KOPABOOK_DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.status, bm.role AS business_role, bm.joined_at,
              bm.can_view_profit, bm.can_discount, bm.can_manage_expenses,
              bm.can_manage_products, bm.commission_percent
       FROM business_members bm
       INNER JOIN users u ON u.id = bm.user_id
       WHERE bm.business_id = ?
       ORDER BY bm.id ASC`
    ).bind(auth.business.id).all();

    return json({ ok: true, members: members.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load staff.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can invite staff." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { fullName, email, password, role } = body;
    const staffRole = ["manager", "attendant"].includes(role) ? role : "attendant";

    if (!fullName || !email || !password) {
      return json({ ok: false, message: "Name, email and password are required." }, 400);
    }
    if (String(password).length < 8) {
      return json({ ok: false, message: "Password must be at least 8 characters." }, 400);
    }

    const exists = await context.env.KOPABOOK_DB.prepare(
      `SELECT id FROM users WHERE email = ? LIMIT 1`
    ).bind(String(email).trim().toLowerCase()).first();
    if (exists) return json({ ok: false, message: "That email is already registered." }, 409);

    const passwordHash = await hashPassword(String(password));
    const now = toSqliteDate();
    const userResult = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO users (full_name, email, password_hash, role, status) VALUES (?, ?, ?, 'staff', 'active')`
    )
      .bind(String(fullName).trim(), String(email).trim().toLowerCase(), passwordHash)
      .run();

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO business_members (business_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`
    )
      .bind(auth.business.id, userResult.meta.last_row_id, staffRole, now)
      .run();

    await audit(context, auth, "staff.invite", "user", userResult.meta.last_row_id, { role: staffRole });
    return json({ ok: true, userId: userResult.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not invite staff.", error: String(error) }, 500);
  }
}

// PATCH /api/staff - owner updates a member's permission flags / commission.
// Body: { userId, can_view_profit, can_discount, can_manage_expenses,
//         can_manage_products, commission_percent }
export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can change staff permissions." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { userId } = body;
    if (!userId) return json({ ok: false, message: "userId is required." }, 400);

    const member = await context.env.KOPABOOK_DB.prepare(
      `SELECT id FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    ).bind(auth.business.id, userId).first();
    if (!member) return json({ ok: false, message: "Staff member not found." }, 404);

    const bool = (v) => (v ? 1 : 0);
    let commission = Number(body.commission_percent ?? 0);
    if (!Number.isFinite(commission)) commission = 0;
    commission = Math.min(100, Math.max(0, commission));

    const fields = {
      can_view_profit: bool(body.can_view_profit),
      can_discount: bool(body.can_discount),
      can_manage_expenses: bool(body.can_manage_expenses),
      can_manage_products: bool(body.can_manage_products),
      commission_percent: commission,
    };

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE business_members
       SET can_view_profit = ?, can_discount = ?, can_manage_expenses = ?,
           can_manage_products = ?, commission_percent = ?
       WHERE id = ?`
    )
      .bind(
        fields.can_view_profit, fields.can_discount, fields.can_manage_expenses,
        fields.can_manage_products, fields.commission_percent, member.id
      )
      .run();

    await audit(context, auth, "staff.permissions.update", "business_member", member.id, {
      targetUserId: userId, ...fields,
    });
    return json({ ok: true, ...fields });
  } catch (error) {
    return json({ ok: false, message: "Could not update staff permissions.", error: String(error) }, 500);
  }
}
