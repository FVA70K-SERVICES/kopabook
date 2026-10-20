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

    // Open human cases are exempt: a chat a person is handling keeps its
    // full thread until the case is closed.
    await db
      .prepare(
        "DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE site_id = ? AND COALESCE(needs_human, 0) = 0 AND COALESCE(handled_by, 'bot') != 'human') AND created_at < ?"
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

// Rolling 24-hour window for the merged in-app chat (site 'kopabook').
// One thread per signed-in user, shared by Ask Kopa AI and Kopa Support.
// Messages older than 24 hours are removed lazily on read and write paths,
// scoped to this one session only, so no other user or business is touched.
// Open human cases are exempt, and a transcript snapshot is saved at
// handoff time (see send.js), so the support story survives the clear.
export async function clearExpiredMergedChat(db, sessionId) {
  try {
    if (!sessionId) return;
    const sess = await db
      .prepare('SELECT needs_human, handled_by FROM chat_sessions WHERE id = ?')
      .bind(sessionId)
      .first()
      .catch(() => null);
    if (sess && (Number(sess.needs_human || 0) === 1 || sess.handled_by === 'human')) return;
    const cutoff = Date.now() - 24 * 3600000;
    await db
      .prepare('DELETE FROM chat_messages WHERE session_id = ? AND created_at < ?')
      .bind(sessionId, cutoff)
      .run();
  } catch (e) {
    // Chat must never break because cleanup failed.
  }
}
