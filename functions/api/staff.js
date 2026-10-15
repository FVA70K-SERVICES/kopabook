// /api/staff - GET list members, POST invite (owner/manager only)
import { json, getAuthContext, requireAuth, hashPassword, audit, toSqliteDate } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const members = await context.env.KOPABOOK_DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.status, u.phone, bm.role AS business_role, bm.joined_at,
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
    const isOwner = auth.business.role === "owner";
    const isPartner = auth.business.role === "partner";
    if (!isOwner && !isPartner) {
      return json({ ok: false, message: "Only the owner or a partner can invite staff." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { fullName, email, password, role, phone } = body;
    const staffRole = ["partner", "manager", "attendant", "hotel_manager", "receptionist", "housekeeper"].includes(role)
      ? role : "attendant";
    // Risk control: only the original owner can create another partner.
    if (staffRole === "partner" && !isOwner) {
      return json({ ok: false, message: "Only the owner can invite a partner." }, 403);
    }

    // Sensible default permission flags per role. Partners are co-owners.
    const roleFlags = {
      partner: { can_view_profit: 1, can_discount: 1, can_manage_expenses: 1, can_manage_products: 1 },
      manager: { can_view_profit: 1, can_discount: 1, can_manage_expenses: 1, can_manage_products: 1 },
      attendant: { can_view_profit: 0, can_discount: 0, can_manage_expenses: 0, can_manage_products: 0 },
      hotel_manager: { can_view_profit: 1, can_discount: 1, can_manage_expenses: 1, can_manage_products: 1 },
      receptionist: { can_view_profit: 0, can_discount: 1, can_manage_expenses: 0, can_manage_products: 0 },
      housekeeper: { can_view_profit: 0, can_discount: 0, can_manage_expenses: 0, can_manage_products: 0 },
    };
    const flags = roleFlags[staffRole];

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
      `INSERT INTO users (full_name, email, password_hash, role, status, phone) VALUES (?, ?, ?, 'staff', 'active', ?)`
    )
      .bind(String(fullName).trim(), String(email).trim().toLowerCase(), passwordHash, phone ? String(phone).trim() : null)
      .run();

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO business_members (business_id, user_id, role, joined_at,
        can_view_profit, can_discount, can_manage_expenses, can_manage_products)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, userResult.meta.last_row_id, staffRole, now,
        flags.can_view_profit, flags.can_discount, flags.can_manage_expenses, flags.can_manage_products)
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
    const isOwner = auth.business.role === "owner";
    const isPartner = auth.business.role === "partner";
    if (!isOwner && !isPartner) {
      return json({ ok: false, message: "Only the owner or a partner can change staff permissions." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { userId } = body;
    if (!userId) return json({ ok: false, message: "userId is required." }, 400);

    const member = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, role FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    ).bind(auth.business.id, userId).first();
    if (!member) return json({ ok: false, message: "Staff member not found." }, 404);
    // Risk control: only the original owner can change an owner or partner.
    if ((member.role === "owner" || member.role === "partner") && !isOwner) {
      return json({ ok: false, message: "Only the owner can change an owner's or partner's access." }, 403);
    }

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
