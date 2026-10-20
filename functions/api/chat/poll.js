// GET /api/chat/poll?sessionId=xxx&since=0 - get new messages for a session
import { maybeAutoClearChat, clearExpiredMergedChat } from './_auto_clear.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

    let session = null;
    try {
      session = await env.KOPABOOK_DB.prepare(
        'SELECT agent_typing, status, site_id, needs_human, handled_by, assigned_to, bot_enabled FROM chat_sessions WHERE id = ?'
      ).bind(sessionId).first();
    } catch (e) {
      session = await env.KOPABOOK_DB.prepare(
        'SELECT agent_typing, status, site_id FROM chat_sessions WHERE id = ?'
      ).bind(sessionId).first();
    }

    // Merged in-app chat: enforce the rolling 24-hour window on read too.
    // The sweep itself is throttled inside clearExpiredMergedChat, so this
    // costs nothing on the normal poll path.
    if (session && session.site_id === 'kopabook') {
      await clearExpiredMergedChat(env.KOPABOOK_DB, sessionId);
    }

    let msgs;
    try {
      msgs = await env.KOPABOOK_DB.prepare(
        'SELECT id, sender, sender_name, message, created_at FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY created_at ASC LIMIT 50'
      ).bind(sessionId, since).all();
    } catch (e) {
      // Older deployments may not have sender_name yet. Poll must never fail
      // because an optional display column is missing.
      msgs = await env.KOPABOOK_DB.prepare(
        'SELECT id, sender, message, created_at FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY created_at ASC LIMIT 50'
      ).bind(sessionId, since).all();
    }

    // Honest support state for the merged chat: who is handling this now,
    // and the name of the human when one has joined.
    let supportState = null;
    if (session && session.site_id === 'kopabook') {
      let agentName = null;
      try {
        const a = await env.KOPABOOK_DB.prepare(
          "SELECT sender_name FROM chat_messages WHERE session_id = ? AND sender = 'agent' ORDER BY created_at DESC LIMIT 1"
        ).bind(sessionId).first();
        if (a && a.sender_name) agentName = a.sender_name;
      } catch (e) {}
      supportState = {
        needsHuman: Number(session.needs_human || 0) === 1,
        handledBy: session.handled_by || 'bot',
        assignedTo: session.assigned_to || null,
        botEnabled: session.bot_enabled === undefined || session.bot_enabled === null ? true : Number(session.bot_enabled) !== 0,
        agentName,
        status: session.status || 'active',
      };
      // The current Kopa Support case for this thread, so the widget can
      // show its lifecycle state (open / resolved / closed) honestly.
      try {
        const kc = await env.KOPABOOK_DB.prepare(
          'SELECT id, status FROM support_cases WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
        ).bind(sessionId).first();
        if (kc) { supportState.caseId = kc.id; supportState.caseStatus = kc.status; }
      } catch (e) { /* case tables not created yet: no case state */ }
    }

    // Lazy auto-clear of old chat history (per-business setting, best effort).
    if (session && session.site_id) {
      maybeAutoClearChat(env.KOPABOOK_DB, session.site_id).catch(() => {});
    }

    // Mark visitor messages as read by visitor (they just polled)
    if (msgs.results.length) {
      const maxId = Math.max(...msgs.results.map(m => m.id));
      await env.KOPABOOK_DB.prepare(
        'UPDATE chat_messages SET read_by_visitor = 1 WHERE session_id = ? AND id <= ? AND sender = ?'
      ).bind(sessionId, maxId, 'agent').run();
    }

    return Response.json({
      messages: msgs.results,
      agentTyping: session ? !!session.agent_typing : false,
      status: session ? session.status : 'closed',
      supportState
    });
  } catch (e) {
    return Response.json({ error: 'Poll failed' }, { status: 500 });
  }
}
