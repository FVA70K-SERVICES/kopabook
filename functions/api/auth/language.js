// GET /api/auth/language — the signed-in user's app language.
// POST /api/auth/language {language} — set it (users.language, migration 0061).
// Language is per USER, not per business, so this endpoint deliberately does
// NOT require a business (requireAuth would 403 a user between register and
// first business); it only requires a signed-in, active user. No other
// server change. Codes are validated against the same 10 as src/lib/i18n.js.
import { json, getAuthContext } from "../_utils";

export const LANGUAGES = ["en", "pcm", "ha", "yo", "ig", "fr", "es", "pt", "ar", "sw"];

async function readLanguage(context, userId) {
  try {
    const row = await context.env.KOPABOOK_DB.prepare(
      `SELECT language FROM users WHERE id = ?`
    ).bind(userId).first();
    const code = row && String(row.language || "").trim();
    return LANGUAGES.includes(code) ? code : "en";
  } catch {
    return "en";
  }
}

export async function onRequestGet(context) {
  const auth = await getAuthContext(context);
  if (!auth || !auth.user) return json({ ok: false, message: "Not signed in." }, 401);
  const language = await readLanguage(context, auth.user.id);
  return json({ ok: true, language });
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    if (!auth || !auth.user) return json({ ok: false, message: "Not signed in." }, 401);

    const body = await context.request.json().catch(() => ({}));
    const language = String(body.language || "").trim();
    if (!LANGUAGES.includes(language)) {
      return json({ ok: false, message: "Unknown language." }, 400);
    }

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET language = ? WHERE id = ?`
    ).bind(language, auth.user.id).run();

    return json({ ok: true, language });
  } catch (error) {
    return json({ ok: false, message: "Could not save language.", error: String(error) }, 500);
  }
}
