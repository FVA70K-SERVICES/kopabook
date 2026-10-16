// FVAVerify human check for KopaBook's own public forms (registration,
// forgot-password). Gated: when FVA_VERIFY_SECRET is not set in the
// environment, verification is skipped entirely so nothing breaks before
// FVAVerify is live. When the service is unreachable we fail open rather
// than blocking real signups.

const SITEVERIFY_URL = "https://fva70k.com/api/verify/siteverify";

export async function verifyHumanToken(env, token) {
  const secret = env.FVA_VERIFY_SECRET;
  if (!secret) return null; // not configured yet -> skip
  if (!token) return { ok: false, message: "Please tick the 'Verify you are human' box." };
  try {
    const r = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, token }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => null);
    if (d && d.success) return { ok: true };
    return { ok: false, message: "Human verification failed. Please try again." };
  } catch {
    return null; // service down -> fail open, never block signup
  }
}
