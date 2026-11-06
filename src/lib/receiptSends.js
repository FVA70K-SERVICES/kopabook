// Receipt send orchestration shared by the Sales done view and the
// Receipt page. Every send needs a merchant tap (confirm-first); nothing
// here sends on its own.
//
// Email: try the server route first (POST /api/receipts/sale/email). When
// the server says email is not configured (501) fall back to a mailto:
// link with a short note. Other failures are thrown so the UI can show
// the real error.
// Telegram: the client share/chat route is the default. Bot delivery is
// offered only when the bot is configured AND the customer has a chat id
// stored; otherwise the caller shows the one-line onboarding instruction.
import { api } from "./api";
import { telegramShareUrl, telegramChatUrl } from "./channels";
import { receiptMailtoLink } from "./receiptContacts";

let botStatusCache = null;

export async function getTelegramBotStatus() {
  if (botStatusCache) return botStatusCache;
  try {
    botStatusCache = await api.get("/api/receipts/telegram/bot");
  } catch {
    botStatusCache = { ok: true, configured: false, username: null };
  }
  return botStatusCache;
}

// Returns { via: "server" } or { via: "mailto", url, note }.
export async function sendEmailReceipt({ saleId, email, saleNumber, businessName, text }) {
  try {
    await api.post("/api/receipts/sale/email", { saleId, email });
    return { via: "server" };
  } catch (e) {
    if (e && e.status === 501) {
      return {
        via: "mailto",
        url: receiptMailtoLink(email, saleNumber, businessName, text),
        note: "Email is not set up yet, so your mail app will open instead.",
      };
    }
    throw e;
  }
}

// Client Telegram URL: direct chat when the username is saved, else the
// share picker with the receipt text ready.
export function telegramClientUrl({ customerTelegram, text }) {
  const chat = customerTelegram ? telegramChatUrl(customerTelegram) : "";
  return chat || telegramShareUrl(text);
}

// Bot delivery. Returns { via: "bot" } on success,
// { via: "client", url } when bot delivery is not available,
// { via: "client", url, needsOnboarding: true, startUrl } when the
// customer has not started the bot yet.
export async function sendTelegramReceipt({ saleId, saleNumber, businessName, text, photoBlob, customerTelegram, hasChatId }) {
  const bot = await getTelegramBotStatus();
  const clientUrl = telegramClientUrl({ customerTelegram, text });
  if (!bot.configured || !hasChatId) {
    return {
      via: "client",
      url: clientUrl,
      needsOnboarding: Boolean(bot.configured && !hasChatId),
      startUrl: bot.configured && bot.username
        ? `https://t.me/${bot.username}?start=${encodeURIComponent(saleNumber || "")}`
        : null,
      botUsername: bot.username || null,
    };
  }
  const fd = new FormData();
  fd.append("saleId", String(saleId));
  if (photoBlob) fd.append("photo", photoBlob, `receipt-${saleNumber || saleId}.png`);
  const res = await fetch("/api/receipts/sale/telegram", { method: "POST", body: fd, credentials: "same-origin" });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) {
    if (d.needsOnboarding) {
      return { via: "client", url: clientUrl, needsOnboarding: true, startUrl: d.startUrl || null, botUsername: bot.username || null };
    }
    throw new Error(d.message || `Telegram send failed (${res.status})`);
  }
  return { via: "bot", photoError: d.photoError || null };
}
