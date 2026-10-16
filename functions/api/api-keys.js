// /api/api-keys — owners/partners create, list and revoke developer API keys.
// The raw key is shown exactly once at creation; only its hash is stored.
import { json, getAuthContext, requireAuth } from "./_utils.js";
import { sha256hex, newApiKey } from "./_apikey.js";

function isManager(auth) {
  return auth.business.role === "owner" || auth.business.role === "partner";
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!isManager(auth)) {
      return json({ ok: false, message: "Only the owner or a partner can manage API keys." }, 403);
    }
    const db = context.env.KOPABOOK_DB;
    // website_url column needs migration 0040; fall back without it.
    let rows;
    try {
      rows = await db.prepare(
        `SELECT id, name, website_url, key_prefix, scopes, status, last_used_at, created_at
         FROM api_keys WHERE business_id = ? ORDER BY id DESC`
      ).bind(auth.business.id).all();
    } catch (e) {
      rows = await db.prepare(
        `SELECT id, name, key_prefix, scopes, status, last_used_at, created_at
         FROM api_keys WHERE business_id = ? ORDER BY id DESC`
      ).bind(auth.business.id).all();
    }
    return json({ ok: true, keys: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load API keys." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!isManager(auth)) {
      return json({ ok: false, message: "Only the owner or a partner can create API keys." }, 403);
    }
    const body = await context.request.json().catch(() => ({}));
    const name = String(body.name || "").slice(0, 80) || "Untitled key";
    let websiteUrl = String(body.website_url || "").trim().slice(0, 200);
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) websiteUrl = "https://" + websiteUrl;

    const db = context.env.KOPABOOK_DB;
    const count = await db.prepare(
      `SELECT COUNT(*) AS c FROM api_keys WHERE business_id = ? AND status = 'active'`
    ).bind(auth.business.id).first();
    if (Number(count?.c || 0) >= 10) {
      return json({ ok: false, message: "You already have 10 active keys. Revoke one first." }, 400);
    }

    const key = newApiKey();
    const hash = await sha256hex(key);
    // website_url needs migration 0040; fall back without it.
    let r;
    try {
      r = await db.prepare(
        `INSERT INTO api_keys (business_id, user_id, name, website_url, key_hash, key_prefix, scopes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'read', 'active')`
      ).bind(auth.business.id, auth.user.id, name, websiteUrl, hash, key.slice(0, 14)).run();
    } catch (e) {
      r = await db.prepare(
        `INSERT INTO api_keys (business_id, user_id, name, key_hash, key_prefix, scopes, status)
         VALUES (?, ?, ?, ?, ?, 'read', 'active')`
      ).bind(auth.business.id, auth.user.id, name, hash, key.slice(0, 14)).run();
    }

    return json({
      ok: true,
      id: Number(r.meta.last_row_id),
      key,
      note: "Copy this key now. It will never be shown again.",
    });
  } catch (e) {
    return json({ ok: false, message: "Could not create the API key." }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!isManager(auth)) {
      return json({ ok: false, message: "Only the owner or a partner can revoke API keys." }, 403);
    }
    const url = new URL(context.request.url);
    const id = Number(url.searchParams.get("id")) || 0;
    const db = context.env.KOPABOOK_DB;
    const row = await db.prepare(
      `SELECT id FROM api_keys WHERE id = ? AND business_id = ?`
    ).bind(id, auth.business.id).first();
    if (!row) return json({ ok: false, message: "Key not found." }, 404);

    await db.prepare(
      `UPDATE api_keys SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?`
    ).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not revoke the key." }, 500);
  }
}
