// POST /api/chat/end - end a chat session
export async function onRequestPost({ request, env }) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

    const now = Date.now();
    await env.KOPABOOK_DB.prepare(
      'UPDATE chat_sessions SET status = ?, last_activity = ? WHERE id = ?'
    ).bind('closed', now, sessionId).run();

    // System message
    await env.KOPABOOK_DB.prepare(
      'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, 'bot', 'This chat has ended. Thanks for reaching out! Feel free to start a new chat anytime.', now).run();

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed to end chat' }, { status: 500 });
  }
}
