// POST /api/auth/logout
import { json, getCookie, clearSessionCookieHeader } from "../_utils";

export async function onRequestPost(context) {
  try {
    const token = getCookie(context.request, "kopabook_session");
    if (token) {
      await context.env.KOPABOOK_DB.prepare(
        `DELETE FROM sessions WHERE session_token = ?`
      )
        .bind(token)
        .run();
    }
  } catch {
    // ignore
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}
