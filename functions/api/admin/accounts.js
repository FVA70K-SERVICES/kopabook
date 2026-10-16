// /api/admin/accounts — platform admin only. List, set tier, suspend.
import { json, getAuthContext, requireAuth, toSqliteDate } from "../_utils";
import { requirePlatformAdmin } from "./overview";
import { LIMITS } from "../billing";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const url = new URL(context.request.url);
    const q = String(url.searchParams.get("q") || "").trim();

    let sql = `SELECT u.id, u.email, u.full_name, u.status, u.is_platform_admin, u.created_at,
              COALESCE(s.tier, 'free') AS tier, COALESCE(s.status, 'active') AS sub_status,
              s.billing_cycle, s.current_period_end,
              (SELECT COUNT(*) FROM businesses b WHERE b.owner_user_id = u.id) AS businesses,
              (SELECT COALESCE(SUM(p.amount_kobo), 0) FROM subscription_payments p WHERE p.user_id = u.id AND p.status = 'paid') AS paid_kobo
       FROM users u LEFT JOIN account_subscriptions s ON s.user_id = u.id`;
    const params = [];
    if (q) {
      sql += ` WHERE u.email LIKE ? OR u.full_name LIKE ?`;
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY u.id DESC LIMIT 100`;

    const rows = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, accounts: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load accounts.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");
    const userId = Number(body.userId);
    if (!userId) return json({ ok: false, message: "Missing user." }, 400);

    const db = context.env.KOPABOOK_DB;
    const now = toSqliteDate();

    if (action === "set_tier") {
      const tier = String(body.tier || "").toLowerCase();
      const cycle = String(body.cycle || "manual").toLowerCase();
      if (!LIMITS[tier]) return json({ ok: false, message: "Invalid tier." }, 400);
      // Never demote yourself out of admin.
      if (userId === auth.user.id && tier === "free") {
        return json({ ok: false, message: "You cannot remove your own Pro tier." }, 400);
      }
      await db.prepare(
        `INSERT INTO account_subscriptions (user_id, tier, status, billing_cycle, updated_at, current_period_start)
         VALUES (?, ?, 'active', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, status = 'active',
           billing_cycle = excluded.billing_cycle, updated_at = excluded.updated_at,
           current_period_start = excluded.current_period_start`
      ).bind(userId, tier, cycle, now, now).run();
      return json({ ok: true, message: `Tier set to ${tier}.` });
    }

    if (action === "suspend" || action === "unsuspend") {
      if (userId === auth.user.id) {
        return json({ ok: false, message: "You cannot suspend yourself." }, 400);
      }
      const status = action === "suspend" ? "suspended" : "active";
      await db.prepare(`UPDATE users SET status = ? WHERE id = ?`).bind(status, userId).run();
      return json({ ok: true, message: action === "suspend" ? "Account suspended." : "Account reactivated." });
    }

    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (error) {
    return json({ ok: false, message: "Admin action failed.", error: String(error) }, 500);
  }
}
