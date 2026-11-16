// Developer API key authentication for KopaBook.
// Developers call /api/v1/* with: Authorization: Bearer kbk_live_...
// Keys are read-only and scoped to one business.
//
// Phase 3.5 (2026-11-16): scopes are now enforced (see requireScope:
// every v1 route requires the 'read' scope) and each key carries the
// one browser origin it may be used from — the website_url the owner
// registered for the key, parsed to an origin (allowedOrigin). A key
// with no website registered has allowedOrigin null and gets no CORS
// headers at all: it still works server-to-server and same-origin,
// where CORS does not apply.
import { json } from "./_utils.js";

export async function sha256hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (const b of bytes) s += chars[b % chars.length];
  return "kbk_live_" + s;
}

// Parse a registered website URL to its browser origin
// ("https://myshop.com"). Returns null for a missing, unparseable,
// or non-http(s) value — the key then gets no CORS headers.
export function parseKeyOrigin(websiteUrl) {
  try {
    const raw = String(websiteUrl || "").trim();
    if (!raw) return null;
    // A scheme that is not http(s) is not a browser origin at all.
    if (raw.includes("://") && !/^https?:\/\//i.test(raw)) return null;
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function hasScope(auth, scope) {
  if (!auth || !Array.isArray(auth.scopes)) return false;
  return auth.scopes.includes(scope);
}

// Phase 3.5: enforce the key's scopes. Returns a 403 response when the
// key lacks the required scope, else null. All keys minted today carry
// 'read', so no live key is locked out by this; a key minted later
// without 'read' is refused instead of silently reading everything.
export function requireScope(auth, scope) {
  if (hasScope(auth, scope)) return null;
  return json({ ok: false, error: "insufficient-scope",
    message: "This API key does not have the '" + scope + "' scope." }, 403);
}

// Resolve a Bearer API key to its business. Returns null when invalid.
// Also enforces 60 requests/minute per key and updates last_used_at.
export async function getApiKeyAuth(context) {
  const header = context.request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(kbk_live_[A-Za-z0-9]{16,})$/);
  if (!m) return null;

  const db = context.env.KOPABOOK_DB;
  const hash = await sha256hex(m[1]);
  // website_url needs migration 0040; fall back without it (same pattern
  // as api-keys.js) so an old DB never breaks key auth.
  let key;
  try {
    key = await db.prepare(
      `SELECT k.id, k.business_id, k.scopes, k.status, k.website_url,
              b.name AS business_name, b.currency, b.business_type, b.country, b.timezone
       FROM api_keys k
       INNER JOIN businesses b ON b.id = k.business_id
       WHERE k.key_hash = ? LIMIT 1`
    ).bind(hash).first();
  } catch {
    key = await db.prepare(
      `SELECT k.id, k.business_id, k.scopes, k.status,
              b.name AS business_name, b.currency, b.business_type, b.country, b.timezone
       FROM api_keys k
       INNER JOIN businesses b ON b.id = k.business_id
       WHERE k.key_hash = ? LIMIT 1`
    ).bind(hash).first();
  }

  if (!key || key.status !== "active") return null;

  // Rate limit: 60 requests per minute per key.
  const windowStart = Math.floor(Date.now() / 60000);
  try {
    const hit = await db.prepare(
      `SELECT count FROM api_key_hits WHERE key_id = ? AND window_start = ?`
    ).bind(key.id, windowStart).first();
    const count = hit ? hit.count : 0;
    if (count >= 60) return { rateLimited: true };
    await db.prepare(
      `INSERT INTO api_key_hits (key_id, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key_id, window_start) DO UPDATE SET count = count + 1`
    ).bind(key.id, windowStart).run();
    if (Math.random() < 0.02) {
      await db.prepare(`DELETE FROM api_key_hits WHERE window_start < ?`)
        .bind(windowStart - 2).run();
    }
  } catch { /* rate limit is best-effort */ }

  try {
    await db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
      .bind(key.id).run();
  } catch { /* best-effort */ }

  return {
    keyId: key.id,
    business: {
      id: key.business_id,
      name: key.business_name,
      currency: key.currency || "NGN",
      business_type: key.business_type || "other",
      country: key.country || "Nigeria",
      timezone: key.timezone || "Africa/Lagos",
    },
    scopes: String(key.scopes || "read").split(",").map((s) => s.trim()).filter(Boolean),
    allowedOrigin: parseKeyOrigin(key.website_url),
  };
}

export function requireApiKey(auth) {
  if (!auth) {
    return json({ ok: false, error: "missing-or-invalid-key",
      message: "Send your API key as: Authorization: Bearer kbk_live_..." }, 401);
  }
  if (auth.rateLimited) {
    return json({ ok: false, error: "rate-limited",
      message: "Too many requests. The limit is 60 per minute per key." }, 429);
  }
  return null;
}
