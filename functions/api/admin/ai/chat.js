// /api/admin/ai/chat: platform admin only. Admin AI chat.
// This endpoint reads figures and prepares proposals. It NEVER executes
// a write action, even if the message says yes or confirm. Execution
// happens only through POST /api/admin/ai/confirm.
import { json, getAuthContext, requireAuth } from "../../_utils.js";
import { requirePlatformAdmin } from "../overview.js";
import { runAdminAiChat } from "./_engine.js";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const body = await context.request.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    if (!message) return json({ ok: false, message: "Message is required." }, 400);
    const history = Array.isArray(body.history) ? body.history : [];

    const result = await runAdminAiChat(context, auth, { message, history });
    return json(result, result && result.ok === false ? 400 : 200);
  } catch (error) {
    return json({ ok: false, message: "Admin AI chat failed.", error: String(error) }, 500);
  }
}
