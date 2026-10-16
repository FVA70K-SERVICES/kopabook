// POST /api/chat/typing - set typing indicator
export async function onRequestPost({ request, env }) {
  try {
    const { sessionId, who, typing } = await request.json();
    if (!sessionId || !['visitor', 'agent'].includes(who)) {
      return Response.json({ error: 'Invalid' }, { status: 400 });
    }
    const col = who === 'visitor' ? 'visitor_typing' : 'agent_typing';
    await env.KOPABOOK_DB.prepare(
      `UPDATE chat_sessions SET ${col} = ? WHERE id = ?`
    ).bind(typing ? 1 : 0, sessionId).run();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
