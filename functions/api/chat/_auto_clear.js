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
// Sweep throttle: at most one sweep per session per 30 minutes, held in
// isolate memory. This is best effort only: isolates come and go, and the
// worst case is a sweep running a little more often. Correctness never
// depends on it, and request handlers stay stateless.
const LAST_SWEEP = new Map();
const SWEEP_EVERY_MS = 30 * 60 * 1000;

export async function clearExpiredMergedChat(db, sessionId) {
  try {
    if (!sessionId) return;
    const nowMs = Date.now();
    if (nowMs - (LAST_SWEEP.get(sessionId) || 0) < SWEEP_EVERY_MS) return;
    if (LAST_SWEEP.size > 10000) LAST_SWEEP.clear();
    LAST_SWEEP.set(sessionId, nowMs);
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

// Login clear (round 6, Fortune 2026-11-06): on any login the Ask Kopa
// AI chat starts fresh and never first shows old questions. The widget
// calls POST /api/chat/clear-on-login with the session id it holds in
// localStorage, and this helper wipes that session's thread. Best
// effort like everything else here: it never throws, and a failure
// leaves the thread alone instead of breaking the login.
// Guard (mirrors the round-5 manual clear in chat.js, stricter on one
// point): skip when a person is on the chat. The manual clear blocks
// only on handled_by = 'human' or an 'agent' message, because a bare
// needs_human flag can be set by ordinary AI-side words. The login
// clear is background cleanup, so it errs the safe way and also skips
// on needs_human = 1 and on any open support case for the session.
// Only chat_messages rows for this session are deleted, nothing else:
// no support table, no business record, no other session.
export async function clearAskAiThreadOnLogin(db, sessionId) {
  try {
    if (!sessionId) return { cleared: 0, skipped: 'missing_session' };
    const sess = await db
      .prepare('SELECT site_id, needs_human, handled_by FROM chat_sessions WHERE id = ?')
      .bind(sessionId)
      .first()
      .catch(() => null);
    if (!sess) return { cleared: 0, skipped: 'unknown_session' };
    if (sess.site_id !== 'kopabook') return { cleared: 0, skipped: 'wrong_site' };
    let human = Number(sess.needs_human || 0) === 1 || sess.handled_by === 'human';
    if (!human) {
      try {
        const agentMsg = await db
          .prepare("SELECT id FROM chat_messages WHERE session_id = ? AND sender = 'agent' LIMIT 1")
          .bind(sessionId)
          .first();
        human = !!agentMsg;
      } catch (e) { /* if we cannot tell, the case check below still guards */ }
    }
    if (!human) {
      try {
        const openCase = await db
          .prepare("SELECT id FROM support_cases WHERE session_id = ? AND status = 'open' LIMIT 1")
          .bind(sessionId)
          .first();
        human = !!openCase;
      } catch (e) { /* if we cannot tell, allow the clear: the case table itself is never touched */ }
    }
    if (human) return { cleared: 0, skipped: 'human' };
    // Count first: D1 run() meta.changes is not relied on, so the
    // audited count is exact even where the driver omits it.
    let counted = null;
    try {
      const rows = await db
        .prepare('SELECT id FROM chat_messages WHERE session_id = ?')
        .bind(sessionId)
        .all();
      counted = (rows.results || []).length;
    } catch (e) { counted = null; }
    const res = await db
      .prepare('DELETE FROM chat_messages WHERE session_id = ?')
      .bind(sessionId)
      .run();
    let cleared = counted;
    if (cleared === null) {
      const changes = res && res.meta ? Number(res.meta.changes) : NaN;
      cleared = Number.isFinite(changes) ? changes : 0;
    }
    return { cleared, skipped: null };
  } catch (e) {
    return { cleared: 0, skipped: 'error' };
  }
}
