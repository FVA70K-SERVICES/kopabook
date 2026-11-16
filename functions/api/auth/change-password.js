// POST /api/auth/change-password — signed-in user changes their own password.
// Requires the current password so a stolen session alone cannot lock someone out.
import { json, getAuthContext, requireAuth, hashPassword, verifyPassword, audit, getCookie } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return json({ ok: false, message: "Current and new passwords are required." }, 400);
    }
    if (String(newPassword).length < 8) {
      return json({ ok: false, message: "New password must be at least 8 characters." }, 400);
    }

    const row = await context.env.KOPABOOK_DB.prepare(
      `SELECT password_hash FROM users WHERE id = ? LIMIT 1`
    )
      .bind(auth.user.id)
      .first();
    if (!row || !(await verifyPassword(String(currentPassword), row.password_hash))) {
      return json({ ok: false, message: "Current password is incorrect." }, 403);
    }

    const passwordHash = await hashPassword(String(newPassword));
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET password_hash = ? WHERE id = ?`
    )
      .bind(passwordHash, auth.user.id)
      .run();

    // Fix 2.6: revoke every OTHER session, so a stolen session on
    // another device stops working the moment the password changes.
    // The current session is kept: the user just proved the current
    // password in this session, and kicking them out right after a
    // change they made themselves is the worse UX. If the current
    // session token cannot be read, the token is "" and the !=
    // comparison deletes everything — fail secure, not fail open.
    const currentToken = getCookie(context.request, "kopabook_session") || "";
    await context.env.KOPABOOK_DB.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND session_token != ?`
    )
      .bind(auth.user.id, currentToken)
      .run();

    await audit(context, auth, "auth.password.change", "user", auth.user.id, {});
    return json({ ok: true, message: "Password changed." });
  } catch (error) {
    return json({ ok: false, message: "Could not change password.", error: String(error) }, 500);
  }
}
