// GET /api/receipts/telegram/bot — is bot delivery available?
// Returns { configured, username }. The token never leaves the server:
// unconfigured returns { configured: false } without calling Telegram.
import { json, getAuthContext, requireAuth } from "../../_utils.js";
import { telegramBotConfigured, getBotUsername } from "../../_receipts.js";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!telegramBotConfigured(context.env)) {
      return json({ ok: true, configured: false, username: null });
    }
    try {
      const username = await getBotUsername(context.env);
      return json({ ok: true, configured: true, username });
    } catch (e) {
      return json({ ok: true, configured: false, username: null, error: "Bot token did not work. Check TELEGRAM_BOT_TOKEN." });
    }
  } catch (error) {
    return json({ ok: false, message: "Could not check Telegram bot.", error: String(error) }, 500);
  }
}
