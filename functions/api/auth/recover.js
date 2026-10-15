// POST /api/auth/recover — reset any account password using the bootstrap key.
// This is the owner lockout path: only the holder of the Cloudflare Pages
// secret (the business owner) can use it. Body: { bootstrapKey, email, newPassword }.
import { json, hashPassword, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { bootstrapKey, email, newPassword } = body;

    const expected = context.env.BOOTSTRAP_KEY;
    if (!expected || bootstrapKey !== expected) {
      return json({ ok: false, message: "Invalid bootstrap key." }, 403);
    }
    if (!email || !newPassword) {
      return json({ ok: false, message: "Email and new password are required." }, 400);
    }
    if (String(newPassword).length < 8) {
      return json({ ok: false, message: "New password must be at least 8 characters." }, 400);
    }

    const user = await context.env.KOPABOOK_DB.prepare(
      `SELECT id FROM users WHERE email = ? LIMIT 1`
    )
      .bind(String(email).trim().toLowerCase())
      .first();
    if (!user) return json({ ok: false, message: "No account found for that email." }, 404);

    const passwordHash = await hashPassword(String(newPassword));
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET password_hash = ? WHERE id = ?`
    )
      .bind(passwordHash, user.id)
      .run();

    // Minimal auth shape for the audit helper.
    const fakeAuth = { user: { id: user.id }, business: { id: 0 } };
    await audit(context, fakeAuth, "auth.password.recover", "user", user.id, {}).catch(() => {});
    return json({ ok: true, message: "Password reset. You can now sign in with the new password." });
  } catch (error) {
    return json({ ok: false, message: "Could not reset password.", error: String(error) }, 500);
  }
}
