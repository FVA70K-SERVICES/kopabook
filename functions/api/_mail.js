// Shared mail + token helpers for the Cloudflare Workers runtime.
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Send one transactional email via Resend. Needs RESEND_API_KEY and
// MAIL_FROM (e.g. "KopaBook <noreply@kopabook.app>") as Pages secrets.
export async function sendMail(env, { to, subject, html, text }) {
  const key = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (!key || !from) {
    throw new Error("Email is not configured yet (RESEND_API_KEY / MAIL_FROM).");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

export function resetPasswordEmail({ resetUrl, businessName, userName }) {
  const subject = `Reset your KopaBook password`;
  const text =
    `Hello ${userName || "there"},\n\n` +
    `Someone asked to reset the password for your KopaBook account` +
    `${businessName ? ` at ${businessName}` : ""}.\n\n` +
    `Reset it here (valid for 1 hour, one-time use):\n${resetUrl}\n\n` +
    `If you did not ask for this, just ignore this email.\n\n` +
    `- KopaBook`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #166534;">Reset your KopaBook password</h2>
      <p>Hello ${userName || "there"},</p>
      <p>Someone asked to reset the password for your KopaBook account${businessName ? ` at <strong>${businessName}</strong>` : ""}.</p>
      <p><a href="${resetUrl}" style="display: inline-block; background: #166534; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Reset password</a></p>
      <p style="color: #666; font-size: 13px;">This link works once and expires in 1 hour. If you did not ask for this, just ignore this email.</p>
      <p style="color: #666; font-size: 13px;">If the button does not work, copy this link:<br>${resetUrl}</p>
    </div>`;
  return { subject, text, html };
}
