// POST /api/auth/forgot — request a password reset link by email.
// Always returns ok (never reveals whether the email exists). Rate-limited
// to 5 requests per email per hour to prevent mail bombing.
import { json } from "../_utils";
import { sha256Hex, randomToken, sendMail, resetPasswordEmail } from "../_mail";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, message: "Enter a valid email address." }, 400);
    }

    const db = context.env.KOPABOOK_DB;

    const recent = await db.prepare(
      `SELECT COUNT(*) AS c FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE u.email = ? AND pr.created_at > datetime('now', '-1 hour')`
    ).bind(email).first();
    if (Number(recent?.c || 0) >= 5) {
      return json({ ok: true, message: "If that email is registered, a reset link is on its way." });
    }

    const user = await db.prepare(
      `SELECT u.id, u.email, u.full_name,
              (SELECT b.name FROM businesses b
               JOIN business_members m ON m.business_id = b.id
               WHERE m.user_id = u.id LIMIT 1) AS business_name
       FROM users u WHERE u.email = ? LIMIT 1`
    ).bind(email).first();

    if (user) {
      const token = randomToken(32);
      const tokenHash = await sha256Hex(token);
      await db.prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES (?, ?, datetime('now', '+1 hour'))`
      ).bind(user.id, tokenHash).run();

      const origin = new URL(context.request.url).origin;
      const resetUrl = `${origin}/reset-password?token=${token}`;
      const mail = resetPasswordEmail({ resetUrl, businessName: user.business_name, userName: user.full_name });
      try {
        await sendMail(context.env, { to: user.email, ...mail });
      } catch (mailErr) {
        return json({ ok: false, message: "Email is not set up yet. Ask the business owner for a password reset." }, 503);
      }
    }

    return json({ ok: true, message: "If that email is registered, a reset link is on its way." });
  } catch (error) {
    return json({ ok: false, message: "Could not process the request.", error: String(error) }, 500);
  }
}
