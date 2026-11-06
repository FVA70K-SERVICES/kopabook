// POST /api/telegram/webhook — Telegram bot webhook.
// On /start <saleRef> the sender has started the bot: store their chat id
// on that sale's customer (telegram_chat_id) so bot receipt delivery can
// reach them, and reply with a short confirmation.
//
// KNOWN GAP (v1): this endpoint does not verify a webhook secret. Add
// TELEGRAM_WEBHOOK_SECRET verification as a follow-up. Blast radius is
// small: the only write is a chat id onto a customer matched by a valid
// sale ref in a real business, and no receipt is ever sent from here.
import { json } from "../_utils.js";
import { telegramSendMessage } from "../_receipts.js";

export async function onRequestPost(context) {
  try {
    const env = context.env;
    if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: true });
    const update = await context.request.json().catch(() => ({}));
    const msg = update?.message;
    const text = String(msg?.text || "").trim();
    const chatId = msg?.chat?.id;
    if (!chatId || !text.startsWith("/start")) return json({ ok: true });

    const saleRef = text.replace(/^\/start\s*/, "").trim();
    if (!saleRef) {
      await telegramSendMessage(env, chatId, "Hello! You are set up for KopaBook receipts. Your shop will send receipts here after a sale.");
      return json({ ok: true });
    }

    const db = env.KOPABOOK_DB;
    const sale = await db.prepare(
      `SELECT id, business_id, customer_id, sale_number FROM sales WHERE sale_number = ? LIMIT 1`
    ).bind(saleRef).first();
    if (!sale || !sale.customer_id) return json({ ok: true });

    try {
      await db.prepare(
        `UPDATE customers SET telegram_chat_id = ? WHERE id = ? AND business_id = ?`
      ).bind(String(chatId), sale.customer_id, sale.business_id).run();
    } catch {
      // Column missing before migration 0061: nothing to store yet.
      return json({ ok: true });
    }
    await telegramSendMessage(
      env, chatId,
      `Thanks, you are set up. Receipts for sale ${sale.sale_number} and future sales from your shop will arrive here.`
    );
    return json({ ok: true });
  } catch {
    // Never fail the webhook loudly; Telegram retries on non-200s.
    return json({ ok: true });
  }
}
