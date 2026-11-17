// Kopa AI — Assistant identity, language, and PA settings.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.

const ASSISTANT_VOICES = ["ng_female", "ng_male", "default"];
export const ASSISTANT_LANGUAGES = {
  en: "English",
  pcm: "Nigerian Pidgin",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
};
let assistantColumnsEnsured = false;
async function ensureAssistantColumns(db) {
  if (assistantColumnsEnsured) return;
  assistantColumnsEnsured = true;
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_name TEXT`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_voice TEXT NOT NULL DEFAULT 'default'`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_language TEXT NOT NULL DEFAULT 'en'`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_speech INTEGER NOT NULL DEFAULT 1`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
}

export async function getAssistantSettings(db, businessId) {
  await ensureAssistantColumns(db);
  try {
    const row = await db.prepare(
      `SELECT assistant_name, assistant_voice, assistant_language, assistant_speech FROM business_chat_settings WHERE business_id = ?`
    ).bind(businessId).first();
    const voice = row && ASSISTANT_VOICES.includes(String(row.assistant_voice || "")) ? String(row.assistant_voice) : "default";
    const language = row && ASSISTANT_LANGUAGES[String(row.assistant_language || "")] ? String(row.assistant_language) : "en";
    const speech = !(row && (row.assistant_speech === 0 || row.assistant_speech === "0" || row.assistant_speech === false));
    return { storedName: String((row && row.assistant_name) || "").trim(), voice, language, speech };
  } catch (e) {
    return { storedName: "", voice: "default", language: "en", speech: true };
  }
}

export async function setAssistantLanguage(db, businessId, language) {
  if (!ASSISTANT_LANGUAGES[language]) return false;
  await ensureAssistantColumns(db);
  try {
    await db.prepare(`INSERT OR IGNORE INTO business_chat_settings (business_id) VALUES (?)`).bind(businessId).run();
  } catch (e) { /* settings row creation is best effort */ }
  try {
    await db.prepare(
      `UPDATE business_chat_settings SET assistant_language = ?, updated_at = datetime('now') WHERE business_id = ?`
    ).bind(language, businessId).run();
  } catch (e) {
    try {
      await db.prepare(`UPDATE business_chat_settings SET assistant_language = ? WHERE business_id = ?`).bind(language, businessId).run();
    } catch (e2) { return false; }
  }
  return true;
}

export async function getAssistantProfile(db, businessId, tier) {
  const paEnabled = tier === "solo" || tier === "pro";
  let settings = { storedName: "", voice: "default", language: "en", speech: true };
  try {
    settings = await getAssistantSettings(db, businessId);
  } catch (e) { /* defaults above stand */ }
  const custom = !!(paEnabled && settings.storedName);
  return {
    name: custom ? settings.storedName : "Kopa",
    custom,
    paEnabled,
    voice: settings.voice,
    language: settings.language || "en",
    speech_enabled: settings.speech !== false,
  };
}

// Localised proposal framing. Only the intro, the closing question and the
// cancelled line are localised; the item lines are the user's own resolved
// data and figures, so they stay exactly as built by the executors.
export const PROPOSAL_TEXT = {
  en: {
    intro: "Here is exactly what I will record:",
    closing: "Tap Confirm to run it, or tap Cancel to drop it. Nothing is recorded yet.",
    cancelled: "Cancelled. Nothing was recorded.",
  },
  pcm: {
    intro: "Na wetin I go record be this:",
    closing: "Tap Confirm to run am. Tap Cancel, and nothing is recorded.",
    cancelled: "Cancelled. I no record anything.",
  },
  ha: {
    intro: "Ga abin da zan rubuta:",
    closing: "Taɓa Confirm don gudanar da shi, ko taɓa Cancel don sokewa. Ba a rubuta komai ba tukuna.",
    cancelled: "Na soke. Ba a rubuta komai ba.",
  },
  yo: {
    intro: "Ohun ti mo ma kọ silẹ ni eyi:",
    closing: "Tẹ Confirm lati ṣiṣẹ rẹ, tabi tẹ Cancel lati fagile rẹ. Ko si ohun ti a kọ silẹ sibẹsibẹ.",
    cancelled: "Mo ti fagile. Ko si ohun ti a kọ silẹ.",
  },
  ig: {
    intro: "Nke a bụ ihe m ga-edekọ:",
    closing: "Pịa Confirm iji mee ya, ma ọ bụ pịa Cancel iji hapụ ya. Edebeghị ihe ọ bụla.",
    cancelled: "Akagbuola. Ọ dịghị ihe edekọrọ.",
  },
};

export const LANGUAGE_SWITCH_REPLIES = {
  en: "Done. I will speak English with you from now on.",
  pcm: "Done. Na Pidgin I go dey speak with you from now.",
  ha: "An gama. Zan ci gaba da magana da kai da Hausa.",
  yo: "O ti pari. Ma a ba ọ sọrọ ni Yoruba lati isinsinyi.",
  ig: "Ọ dị mma. Aga m asụ Igbo gị site ugbu a.",
};

const LANGUAGE_NAME_TO_CODE = {
  "english": "en",
  "pidgin": "pcm",
  "nigerian pidgin": "pcm",
  "hausa": "ha",
  "yoruba": "yo",
  "igbo": "ig",
};
const LANGUAGE_SWITCH_RE = /^\s*(?:please\s+)?(?:(?:can you|could you|will you)\s+)?(?:speak|switch|talk|use|change)(?:\s+to)?(?:\s+me)?(?:\s+in)?\s+(english|nigerian pidgin|pidgin|hausa|yoruba|igbo)\s*[.!?]*\s*$/i;

export function detectLanguageSwitch(message) {
  const m = String(message || "").match(LANGUAGE_SWITCH_RE);
  if (!m) return null;
  return LANGUAGE_NAME_TO_CODE[m[1].toLowerCase()] || null;
}

export function daysSince(dateText) {
  const t = Date.parse(String(dateText || "").replace(" ", "T") + (String(dateText || "").includes("T") ? "" : "Z"));
  if (!Number.isFinite(t)) return null;
  const diff = Math.floor((Date.now() - t) / 86400000);
  return diff < 0 ? 0 : diff;
}

// PA briefing: deterministic lines from real data only, no model call.
// Note: products has no expiry column anywhere in the schema, so nothing
// about expiring stock is included.
