// /api/admin/ai/settings: platform admin only. The Admin AI door's OWN
// settings, owned by the platform owner account and stored in
// admin_ai_settings keyed by the owner's user id: voice gender, language
// and auto-speak.
//
// Separation rule: these settings are completely independent of the
// per-business Ask Kopa assistant settings (business_chat_settings).
// Nothing here reads or writes that table, and nothing in the Ask Kopa
// settings path reads or writes this one. The only shared layer is the
// device's own speech engine.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../../_utils.js";
import { requirePlatformAdmin } from "../overview.js";

export const ADMIN_AI_VOICES = ["ng_female", "ng_male", "default"];
export const ADMIN_AI_LANGUAGES = ["en", "pcm", "ha", "yo", "ig"];
export const ADMIN_AI_SETTINGS_DEFAULTS = { voice: "default", language: "en", auto_speak: 0 };

export async function ensureAdminAiSettings(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS admin_ai_settings (
       user_id INTEGER PRIMARY KEY,
       voice TEXT NOT NULL DEFAULT 'default',
       language TEXT NOT NULL DEFAULT 'en',
       auto_speak INTEGER NOT NULL DEFAULT 0,
       updated_at TEXT
     )`
  ).run();
}

export async function getAdminAiSettings(db, userId) {
  await ensureAdminAiSettings(db);
  const row = await db.prepare(
    `SELECT voice, language, auto_speak FROM admin_ai_settings WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
  if (!row) return { ...ADMIN_AI_SETTINGS_DEFAULTS };
  return {
    voice: ADMIN_AI_VOICES.includes(String(row.voice)) ? String(row.voice) : "default",
    language: ADMIN_AI_LANGUAGES.includes(String(row.language)) ? String(row.language) : "en",
    auto_speak: Number(row.auto_speak) ? 1 : 0,
  };
}

async function gate(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth);
  if (denied) return { error: denied };
  const adminDenied = await requirePlatformAdmin(context, auth);
  if (adminDenied) return { error: adminDenied };
  return { auth };
}

export async function onRequestGet(context) {
  try {
    const { auth, error } = await gate(context);
    if (error) return error;
    const settings = await getAdminAiSettings(context.env.KOPABOOK_DB, auth.user.id);
    return json({ ok: true, settings });
  } catch (error) {
    return json({ ok: false, message: "Could not load Admin AI settings.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { auth, error } = await gate(context);
    if (error) return error;
    const db = context.env.KOPABOOK_DB;
    const body = await context.request.json().catch(() => ({}));
    const current = await getAdminAiSettings(db, auth.user.id);

    const next = { ...current };
    if (body.voice !== undefined) {
      const voice = String(body.voice || "").trim();
      if (!ADMIN_AI_VOICES.includes(voice)) {
        return json({ ok: false, message: "Invalid voice." }, 400);
      }
      next.voice = voice;
    }
    if (body.language !== undefined) {
      const language = String(body.language || "").trim();
      if (!ADMIN_AI_LANGUAGES.includes(language)) {
        return json({ ok: false, message: "Invalid language." }, 400);
      }
      next.language = language;
    }
    if (body.auto_speak !== undefined) {
      if (![0, 1, "0", "1", true, false].includes(body.auto_speak)) {
        return json({ ok: false, message: "auto_speak must be 0 or 1." }, 400);
      }
      next.auto_speak = body.auto_speak === true || Number(body.auto_speak) === 1 ? 1 : 0;
    }

    await db.prepare(
      `INSERT INTO admin_ai_settings (user_id, voice, language, auto_speak, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET voice = excluded.voice,
         language = excluded.language, auto_speak = excluded.auto_speak,
         updated_at = excluded.updated_at`
    ).bind(auth.user.id, next.voice, next.language, next.auto_speak, toSqliteDate()).run();

    try {
      await audit(context, auth, "admin_ai.settings.update", "admin_ai_settings", auth.user.id, { ...next });
    } catch (e) { /* audit must never break a settings save */ }

    return json({ ok: true, settings: next });
  } catch (error) {
    return json({ ok: false, message: "Could not save Admin AI settings.", error: String(error) }, 500);
  }
}
