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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function resetPasswordEmail({ resetUrl, businessName, userName }) {
  const subject = `Reset your KopaBook password`;
  const name = userName && String(userName).trim() ? String(userName).trim() : "there";
  const cleanBiz = businessName && String(businessName).trim() ? String(businessName).trim() : "";
  // Never print "your KopaBook account at KopaBook" when the business name is just the app name.
  const showBiz = cleanBiz && cleanBiz.toLowerCase() !== "kopabook";
  const bizText = showBiz ? ` for ${cleanBiz}` : "";
  const bizHtml = showBiz ? ` for <strong>${escapeHtml(cleanBiz)}</strong>` : "";
  const text =
    `Hello ${name},\n\n` +
    `Someone asked to reset the password for your KopaBook account${bizText}.\n\n` +
    `Choose a new password here (works once, expires in 1 hour):\n${resetUrl}\n\n` +
    `If you did not ask for this, just ignore this email. Your password will stay the same.\n\n` +
    `- KopaBook\nkopabook.com`;
  const html = `
    <div style="font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f3f6f3; padding: 32px 16px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
        <div style="padding: 24px 24px 8px; text-align: center; border-bottom: 3px solid #166534;">
          <img src="https://kopabook.com/logo.png" alt="KopaBook" width="170" style="display: block; margin: 0 auto; max-width: 170px;" />
        </div>
        <div style="padding: 24px 28px 8px;">
          <h2 style="color: #14532d; margin: 0 0 12px; font-size: 20px;">Reset your password</h2>
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">Hello ${escapeHtml(name)},</p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">Someone asked to reset the password for your KopaBook account${bizHtml}. Tap the button below to choose a new one.</p>
          <p style="text-align: center; margin: 0 0 20px;"><a href="${resetUrl}" style="display: inline-block; background: #166534; color: #ffffff; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">Reset password</a></p>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 10px;">This link works once and expires in 1 hour. If you did not ask for this, just ignore this email, your password will stay the same.</p>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 20px; word-break: break-all;">Button not working? Copy this link:<br><a href="${resetUrl}" style="color: #166534;">${resetUrl}</a></p>
        </div>
        <div style="background: #f9fafb; padding: 16px 28px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.6;">KopaBook, the free record book for your business.<br><a href="https://kopabook.com" style="color: #166534;">kopabook.com</a></p>
        </div>
      </div>
    </div>`;
  return { subject, text, html };
}
