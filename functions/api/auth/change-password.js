// POST /api/auth/change-password — signed-in user changes their own password.
// Requires the current password so a stolen session alone cannot lock someone out.
import { json, getAuthContext, requireAuth, hashPassword, verifyPassword, audit } from "./_utils";

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

    await audit(context, auth, "auth.password.change", "user", auth.user.id, {});
    return json({ ok: true, message: "Password changed." });
  } catch (error) {
    return json({ ok: false, message: "Could not change password.", error: String(error) }, 500);
  }
}
