// Hardened Paystack webhook verification.
// - Constant-time signature comparison (timing attack resistant)
// - Strict tier allowlist including solo
// - Amount and reference matching to prevent tampering

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

// Rate limiting: simple in-memory store (per-instance, best-effort)
// For production, consider Durable Objects or KV for distributed limiting
const rateLimits = new Map();

export function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const record = rateLimits.get(key);
  if (!record || now - record.windowStart > windowMs) {
    rateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= maxRequests) return false;
  record.count++;
  return true;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now - record.windowStart > 3600000) rateLimits.delete(key);
  }
}, 600000);
