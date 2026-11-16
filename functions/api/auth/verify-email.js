// POST /api/auth/verify-email — consume an email-verification token.
// Body: { token }. Tokens are single-use and expire after 24 hours.
// Sets users.email_verified_at (migration 0063).
//
// Fix 2.6 plumbing: registration records the token (see auth/register.js)
// but no email is sent yet — the send step waits on the mail-provider
// decision — so this endpoint is only reachable today with a token taken
// from the database. Sign-in never requires email_verified_at: existing
// accounts stay usable, and a new account is never locked out by a
// verification email that was never sent.
import { json, toSqliteDate } from "../_utils";
import { sha256Hex } from "../_mail";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return json({ ok: false, message: "Verification token is missing." }, 400);

    const db = context.env.KOPABOOK_DB;
    const tokenHash = await sha256Hex(token);
    const row = await db.prepare(
      `SELECT id, user_id FROM email_verifications
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       LIMIT 1`
    ).bind(tokenHash).first();
    if (!row) {
      return json({ ok: false, message: "This verification link is invalid or expired." }, 400);
    }

    const now = toSqliteDate();
    await db.batch([
      db.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ?`).bind(now, row.user_id),
      db.prepare(`UPDATE email_verifications SET used_at = ? WHERE id = ?`).bind(now, row.id),
      db.prepare(`UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND id != ?`).bind(now, row.user_id, row.id),
    ]);

    return json({ ok: true, message: "Email verified." });
  } catch (error) {
    return json({ ok: false, message: "Could not verify email.", error: String(error) }, 500);
  }
}
