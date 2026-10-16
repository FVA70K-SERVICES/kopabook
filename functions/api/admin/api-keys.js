// /api/admin/api-keys — platform admin only. Full control over every
// developer API key on the platform: list all, revoke any.
import { json, getAuthContext, requireAuth } from "../_utils.js";
import { requirePlatformAdmin } from "./overview.js";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;
    const rows = await db.prepare(
      `SELECT k.id, k.name, k.key_prefix, k.scopes, k.status, k.last_used_at, k.created_at,
              b.name AS business_name, u.full_name AS owner_name, u.email AS owner_email,
              (SELECT COUNT(*) FROM api_key_hits h
               WHERE h.key_id = k.id AND h.window_start >= ?) AS hits_last_hour
       FROM api_keys k
       INNER JOIN businesses b ON b.id = k.business_id
       INNER JOIN users u ON u.id = k.user_id
       ORDER BY k.id DESC LIMIT 200`
    ).bind(Math.floor(Date.now() / 60000) - 60).all();

    const total = await db.prepare(
      `SELECT COUNT(*) AS c FROM api_keys WHERE status = 'active'`
    ).first();

    return json({ ok: true, keys: rows.results || [], activeCount: Number(total?.c || 0) });
  } catch (e) {
    return json({ ok: false, message: "Could not load API keys." }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const url = new URL(context.request.url);
    const id = Number(url.searchParams.get("id")) || 0;
    const db = context.env.KOPABOOK_DB;
    const row = await db.prepare(`SELECT id FROM api_keys WHERE id = ?`).bind(id).first();
    if (!row) return json({ ok: false, message: "Key not found." }, 404);

    await db.prepare(
      `UPDATE api_keys SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?`
    ).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not revoke the key." }, 500);
  }
}
