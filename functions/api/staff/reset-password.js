// POST /api/staff/reset-password — owner sets a new password for a staff member.
// Body: { userId, newPassword }. For when staff forget their passwords.
import { json, getAuthContext, requireAuth, hashPassword, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can reset staff passwords." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { userId, newPassword } = body;
    if (!userId || !newPassword) {
      return json({ ok: false, message: "Staff member and new password are required." }, 400);
    }
    if (String(newPassword).length < 8) {
      return json({ ok: false, message: "New password must be at least 8 characters." }, 400);
    }

    const member = await context.env.KOPABOOK_DB.prepare(
      `SELECT user_id FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    )
      .bind(auth.business.id, Number(userId))
      .first();
    if (!member) return json({ ok: false, message: "Staff member not found." }, 404);

    const passwordHash = await hashPassword(String(newPassword));
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET password_hash = ? WHERE id = ?`
    )
      .bind(passwordHash, Number(userId))
      .run();

    await audit(context, auth, "staff.password.reset", "user", Number(userId), {});
    return json({ ok: true, message: "Password reset. Share the new password with the staff member." });
  } catch (error) {
    return json({ ok: false, message: "Could not reset password.", error: String(error) }, 500);
  }
}
