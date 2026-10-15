// POST /api/auth/reset-password — consume a reset token and set a new password.
// Body: { token, newPassword }. Tokens are single-use and expire after 1 hour.
import { json, hashPassword } from "../_utils";
import { sha256Hex } from "../_mail";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const newPassword = String(body.newPassword || "");
    if (!token) return json({ ok: false, message: "Reset token is missing." }, 400);
    if (newPassword.length < 8) {
      return json({ ok: false, message: "New password must be at least 8 characters." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const tokenHash = await sha256Hex(token);
    const row = await db.prepare(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       LIMIT 1`
    ).bind(tokenHash).first();
    if (!row) {
      return json({ ok: false, message: "This reset link is invalid or expired. Request a new one." }, 400);
    }

    const passwordHash = await hashPassword(newPassword);
    await db.batch([
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(passwordHash, row.user_id),
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).bind(row.id),
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND id != ?`).bind(row.user_id, row.id),
    ]);

    return json({ ok: true, message: "Password reset. You can now sign in with the new password." });
  } catch (error) {
    return json({ ok: false, message: "Could not reset password.", error: String(error) }, 500);
  }
}
