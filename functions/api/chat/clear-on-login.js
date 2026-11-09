// POST /api/chat/clear-on-login - fresh Ask Kopa AI thread on login.
//
// Fortune, 2026-11-06: on any login the chat must start fresh and NEVER
// first show old questions. The session id lives in the browser
// (localStorage), so the widget calls this right after a successful
// login / PIN verify, passing the session id it holds. The endpoint
// wipes that session's chat_messages rows only, never support cases,
// never business records, never another session. Best effort throughout:
// cleanup must never fail the login, so any error answers 200 with
// skipped 'error'. The 24-hour rolling sweep stays as a backstop.
import { getAuthContext, audit } from "../_utils.js";
import { clearAskAiThreadOnLogin } from "./_auto_clear.js";

export async function onRequestPost(context) {
  try {
    let auth = null;
    try {
      auth = await getAuthContext(context);
    } catch (e) {
      auth = null;
    }
    if (!auth) {
      return Response.json({ ok: true, cleared: 0, skipped: "unauthenticated" }, { status: 401 });
    }
    let body = {};
    try {
      body = (await context.request.json()) || {};
    } catch (e) {
      body = {};
    }
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      return Response.json({ ok: true, cleared: 0, skipped: "missing_session" }, { status: 200 });
    }
    // Optional ownerCtx: verified against the signed-in session exactly
    // like send.js does. A mismatch deletes nothing.
    const ownerCtx = body.ownerCtx;
    if (ownerCtx && ownerCtx.businessId && ownerCtx.userId) {
      const matches =
        auth.user &&
        auth.business &&
        String(auth.user.id) === String(ownerCtx.userId) &&
        String(auth.business.id) === String(ownerCtx.businessId);
      if (!matches) {
        return Response.json({ ok: true, cleared: 0, skipped: "owner_mismatch" }, { status: 403 });
      }
    }
    const db = context.env.KOPABOOK_DB;
    const result = await clearAskAiThreadOnLogin(db, sessionId);
    if (result.skipped) {
      return Response.json({ ok: true, cleared: 0, skipped: result.skipped }, { status: 200 });
    }
    if (result.cleared > 0) {
      try {
        await audit(context, auth, "ai.chat.login_clear", "chat", sessionId, { cleared: result.cleared, session_key: sessionId });
      } catch (e) { /* audit must never break the login clear */ }
    }
    return Response.json({ ok: true, cleared: result.cleared, skipped: null }, { status: 200 });
  } catch (e) {
    // Never fail the login because cleanup failed.
    return Response.json({ ok: true, cleared: 0, skipped: "error" }, { status: 200 });
  }
}
