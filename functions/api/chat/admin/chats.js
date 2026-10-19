// GET /api/chat/admin/chats?siteId=xxx&search=xxx - list chat sessions (with site filter + search)
// Auth: platform admin key, or logged-in business user with Chat Center access
// (owner/partner always; staff only when owner enabled staff chat).
// For session auth the site is forced to the caller's business; a client-passed
// siteId is only honored for the platform key.
import { getAuthContext } from '../../_utils.js';
import { canUseChatCenter, businessSiteId } from '../_access.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const db = env.KOPABOOK_DB;
    let forcedSiteId = null;

    if (url.searchParams.get('key') !== env.KOPABOOK_ADMIN_KEY) {
      // Session auth (for chat-center.html): must have Chat Center access.
      const auth = await getAuthContext(request, env);
      if (!auth || !(await canUseChatCenter(db, auth))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      forcedSiteId = businessSiteId(auth.business.id);
    }

    const needsHuman = url.searchParams.get('needsHuman') === '1';
    const search = url.searchParams.get('search');
    const siteId = forcedSiteId || url.searchParams.get('siteId');

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

    const sessions = await db.prepare(query).bind(...params).all();
    return Response.json({ chats: sessions.results, sessions: sessions.results });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
