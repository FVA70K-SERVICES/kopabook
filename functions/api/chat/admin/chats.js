// GET /api/chat/admin/chats?key=xxx&siteId=xxx&search=xxx - list chat sessions (with site filter + search)
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.KOPABOOK_ADMIN_KEY) {
      // Also allow session auth (for chat-center.html)
      const { getAuthContext } = await import('../../_utils.js');
      const auth = await getAuthContext(request, env);
      if (!auth || !auth.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    const siteId = url.searchParams.get('siteId');
    const needsHuman = url.searchParams.get('needsHuman') === '1';
    const search = url.searchParams.get('search');

    let query = `
      SELECT s.id, s.site_id, s.visitor_name, s.status, s.last_activity, s.needs_human,
        s.assigned_to, s.handled_by, s.visitor_intent,
        (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND sender = 'visitor' AND read_by_agent = 0) as unread
      FROM chat_sessions s
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.visitor_name LIKE ? OR s.id IN (SELECT session_id FROM chat_messages WHERE message LIKE ?))`;
      params.push(`%${search}%`, `%${search}%`);
    } else {
      query += ` AND s.status = 'active'`;
    }

    if (siteId) {
      query += ` AND s.site_id = ?`;
      params.push(siteId);
    }
    if (needsHuman) {
      query += ` AND s.needs_human = 1`;
    }
    query += ` ORDER BY s.needs_human DESC, s.last_activity DESC LIMIT 50`;

    const sessions = await env.KOPABOOK_DB.prepare(query).bind(...params).all();
    return Response.json({ chats: sessions.results, sessions: sessions.results });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
