// GET /api/chat/admin/chats?key=xxx&siteId=xxx - list chat sessions (with site filter)
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.KOPABOOK_ADMIN_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const siteId = url.searchParams.get('siteId');
    const needsHuman = url.searchParams.get('needsHuman') === '1';

    let query = `
      SELECT s.id, s.site_id, s.visitor_name, s.status, s.last_activity, s.needs_human,
        (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender = 'visitor' AND read_by_agent = 0) as unread
      FROM chat_sessions s
      WHERE s.status = 'active'
    `;
    const params = [];
    if (siteId) {
      query += ` AND s.site_id = ?`;
      params.push(siteId);
    }
    if (needsHuman) {
      query += ` AND s.needs_human = 1`;
    }
    query += ` ORDER BY s.needs_human DESC, s.last_activity DESC LIMIT 50`;

    const sessions = await env.KOPABOOK_DB.prepare(query).bind(...params).all();
    return Response.json({ chats: sessions.results });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
