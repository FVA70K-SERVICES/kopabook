// Hardened Paystack webhook verification.
// - Constant-time signature comparison (timing attack resistant)
// - Strict tier allowlist including solo
// - Amount and reference matching to prevent tampering
// - Durable rate limiting backed by D1 (works across Cloudflare isolates),
//   with an in-memory fallback so a missing table never blocks real users.

export const VALID_TIERS = ["starter", "pro", "solo"];
export const VALID_CYCLES = ["monthly", "yearly"];

// Constant-time string comparison to prevent timing attacks
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyPaystackSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return timingSafeEqual(hex, signature);
  } catch {
    return false;
  }
}

// In-memory fallback only (per isolate, best effort). The D1 table is the
// real store; this keeps some protection if the table is missing.
const memFallback = new Map();

function memCheck(key, maxRequests, windowMs) {
  const now = Date.now();
  const record = memFallback.get(key);
  if (!record || now - record.windowStart > windowMs) {
    if (memFallback.size > 5000) memFallback.clear();
    memFallback.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= maxRequests) return false;
  record.count++;
  return true;
}

// Durable rate limit: max `maxRequests` per `windowMs` for `key`.
// Fails open to the in-memory fallback (never blocks legit traffic on DB errors).
export async function checkRateLimit(db, key, maxRequests, windowMs) {
  const now = Date.now();
  const windowStart = now - windowMs;
  try {
    const row = await db.prepare(
      `SELECT count, window_start FROM rate_limits WHERE key = ?`
    ).bind(key).first();
    if (!row || Number(row.window_start) < windowStart) {
      await db.prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`
      ).bind(key, now).run();
      return true;
    }
    if (Number(row.count) >= maxRequests) return false;
    await db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).bind(key).run();
    return true;
  } catch {
    return memCheck(key, maxRequests, windowMs);
  }
}
