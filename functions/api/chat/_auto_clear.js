// Lazy auto-clear of old chat messages, driven by per-business settings.
// Called from chat read/write paths (Pages Functions have no cron).
// Best effort: never throws, never blocks the chat.
export async function maybeAutoClearChat(db, siteId) {
  try {
    if (!siteId) return;
    const site = await db
      .prepare("SELECT business_id FROM chat_sites WHERE site_id = ?")
      .bind(siteId)
      .first();
    if (!site || !site.business_id) return;

    const s = await db
      .prepare(
        "SELECT auto_clear_enabled, auto_clear_hours, last_auto_clear_at FROM business_chat_settings WHERE business_id = ?"
      )
      .bind(site.business_id)
      .first();
    if (!s || Number(s.auto_clear_enabled) !== 1) return;

    const now = Date.now();
    // Run at most once an hour per business, no matter how busy the chat is.
    if (s.last_auto_clear_at && now - Number(s.last_auto_clear_at) < 3600000) return;

    const hours = Math.min(Math.max(Number(s.auto_clear_hours) || 24, 1), 720);
    const cutoff = now - hours * 3600000;

    await db
      .prepare(
        "DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE site_id = ?) AND created_at < ?"
      )
      .bind(siteId, cutoff)
      .run();
    await db
      .prepare("UPDATE business_chat_settings SET last_auto_clear_at = ? WHERE business_id = ?")
      .bind(now, site.business_id)
      .run();
  } catch (e) {
    // Chat must never break because cleanup failed.
  }
}
