// GET /api/chat/poll?sessionId=xxx&since=0 - get new messages for a session
import { maybeAutoClearChat } from './_auto_clear.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

    const msgs = await env.KOPABOOK_DB.prepare(
      'SELECT id, sender, message, created_at FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY created_at ASC LIMIT 50'
    ).bind(sessionId, since).all();

    const session = await env.KOPABOOK_DB.prepare(
      'SELECT agent_typing, status, site_id FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

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
      status: session ? session.status : 'closed'
    });
  } catch (e) {
    return Response.json({ error: 'Poll failed' }, { status: 500 });
  }
}
