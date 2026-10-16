// GET /api/chat/admin/messages?key=xxx&sessionId=xxx - get full thread + mark read
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.KOPABOOK_ADMIN_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

    const msgs = await env.KOPABOOK_DB.prepare(
      'SELECT id, sender, message, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
    ).bind(sessionId).all();

    await env.KOPABOOK_DB.prepare(
      "UPDATE chat_messages SET read_by_agent = 1 WHERE session_id = ? AND sender = 'visitor'"
    ).bind(sessionId).run();

    const session = await env.KOPABOOK_DB.prepare(
      'SELECT visitor_name, visitor_typing, status FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

    return Response.json({ messages: msgs.results, session });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/chat/admin/messages - agent sends reply (key in body)
export async function onRequestPost({ request, env }) {
  try {
    const { key, sessionId, message } = await request.json();
    if (key !== env.KOPABOOK_ADMIN_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!sessionId || !message || !message.trim()) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }
    const now = Date.now();
    await env.KOPABOOK_DB.prepare(
      'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, 'agent', message.trim().slice(0, 2000), now).run();
    await env.KOPABOOK_DB.prepare(
      'UPDATE chat_sessions SET last_activity = ?, agent_typing = 0 WHERE id = ?'
    ).bind(now, sessionId).run();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/chat/admin/close - close a session
export async function onRequestPut({ request, env }) {
  try {
    const { key, sessionId } = await request.json();
    if (key !== env.KOPABOOK_ADMIN_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await env.KOPABOOK_DB.prepare(
      "UPDATE chat_sessions SET status = 'closed' WHERE id = ?"
    ).bind(sessionId).run();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
