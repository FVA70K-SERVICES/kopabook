// Shared mail + token helpers for the Cloudflare Workers runtime.
// Sends via Zoho Mail (free tier) using OAuth2. Needs these Pages secrets:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
//   MAIL_FROM (e.g. "KopaBook <noreply@kopabook.com>"),
//   ZOHO_DC (optional, default "com"; use "eu", "in", etc. if your Zoho account lives there).
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function zohoAccessToken(env) {
  const dc = (env.ZOHO_DC || "com").replace(/^\./, "");
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      refresh_token: env.ZOHO_REFRESH_TOKEN,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { token: data.access_token, dc };
}

async function zohoAccountId(env, token, dc) {
  const res = await fetch(`https://mail.zoho.${dc}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  const accountId = data?.data?.[0]?.accountId;
  if (!accountId) {
    throw new Error(`Zoho account lookup failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  return accountId;
}

// Send one transactional email via Zoho Mail.
export async function sendMail(env, { to, subject, html, text }) {
  const from = env.MAIL_FROM;
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN || !from) {
    throw new Error("Email is not configured yet (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / MAIL_FROM).");
  }
  const { token, dc } = await zohoAccessToken(env);
  const accountId = await zohoAccountId(env, token, dc);

  // Extract the bare email from "Name <email>" if present.
  const fromMatch = String(from).match(/<([^>]+)>/);
  const fromAddress = fromMatch ? fromMatch[1] : String(from).trim();

  const res = await fetch(`https://mail.zoho.${dc}/api/accounts/${accountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fromAddress,
      toAddress: to,
      subject,
      content: html || text,
      mailFormat: html ? "html" : "plaintext",
    }),
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
