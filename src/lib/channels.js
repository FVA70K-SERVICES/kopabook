// Extra free messaging channels: SMS and Telegram.
// Like WhatsApp, everything opens the phone's own app with the message ready;
// nothing sends automatically, so there is no cost and no API key needed.
import { normalizeNaijaPhone, waLink } from "./whatsapp";

// sms: link — opens the SMS app with recipient and text prefilled.
export function smsLink(phone, text) {
  const digits = normalizeNaijaPhone(phone);
  const q = "?body=" + encodeURIComponent(text || "");
  return digits ? `sms:${digits}${q}` : `sms:${q}`;
}

// Telegram share — opens Telegram's share picker with the text ready.
export function telegramShareUrl(text) {
  return "https://t.me/share/url?url=" + "&text=" + encodeURIComponent(text || "");
}

// Direct Telegram chat when the customer has a username saved.
export function telegramChatUrl(username) {
  const u = String(username || "").trim().replace(/^@/, "");
  return u ? `https://t.me/${u}` : "";
}

export const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "telegram", label: "Telegram" },
];

// Open the right app for a channel. Returns the wa/sms/tg URL opened.
export function sendVia(channel, { phone, text, telegram }) {
  let url = "";
  if (channel === "sms") {
    url = smsLink(phone, text);
  } else if (channel === "telegram") {
    url = (telegram && telegramChatUrl(telegram)) || telegramShareUrl(text);
  } else {
    url = waLink(phone, text);
  }
  window.open(url, "_blank", "noopener");
  return url;
}
