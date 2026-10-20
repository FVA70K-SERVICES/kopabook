// Chat Center message thread API.
// GET  /api/chat/admin/messages?sessionId=xxx - get full thread + mark read
// POST /api/chat/admin/messages - agent sends reply { sessionId, message }
// PUT  /api/chat/admin/messages - close a session { sessionId }
// Auth: platform admin key, or logged-in business user with Chat Center access
// (owner/partner always; staff only when owner enabled staff chat).
// Every session is verified to belong to the caller's business site.
import { getAuthContext } from '../../_utils.js';
import { canUseChatCenter, businessSiteId } from '../_access.js';
import { mirrorAgentReply, closeCaseForSession } from '../_cases.js';

async function authorize(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('key') === env.KOPABOOK_ADMIN_KEY) {
    return { ok: true, siteId: null }; // platform key: no business scoping
  }
  let bodyKey = null;
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      const clone = request.clone();
      const b = await clone.json().catch(() => ({}));
      bodyKey = b.key || null;
    } catch (e) {}
  }
  if (bodyKey && bodyKey === env.KOPABOOK_ADMIN_KEY) {
    return { ok: true, siteId: null };
  }
  const auth = await getAuthContext(request, env);
  const db = env.KOPABOOK_DB;
  if (auth && auth.user && auth.business && (await canUseChatCenter(db, auth))) {
    return { ok: true, siteId: businessSiteId(auth.business.id), user: auth.user };
  }
  return { ok: false };
}

async function sessionBelongsTo(db, sessionId, siteId) {
  if (!siteId) return true; // platform key: trusted
  const s = await db
    .prepare('SELECT site_id FROM chat_sessions WHERE id = ?')
    .bind(sessionId)
    .first();
  return !!(s && s.site_id === siteId);
}

export async function onRequestGet({ request, env }) {
  try {
    const a = await authorize(request, env);
    if (!a.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('session_id');
    if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });
    const db = env.KOPABOOK_DB;
    if (!(await sessionBelongsTo(db, sessionId, a.siteId))) {
      return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
    }

    const msgs = await db.prepare(
      'SELECT id, sender, message, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
    ).bind(sessionId).all();

    await db.prepare(
      "UPDATE chat_messages SET read_by_agent = 1 WHERE session_id = ? AND sender = 'visitor'"
    ).bind(sessionId).run();

    const session = await db.prepare(
      'SELECT visitor_name, visitor_typing, status FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

    return Response.json({ messages: msgs.results, session });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const a = await authorize(request, env);
    if (!a.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { sessionId, session_id, message } = await request.json();
    const sid = sessionId || session_id;
    if (!sid || !message || !message.trim()) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }
    const db = env.KOPABOOK_DB;
    if (!(await sessionBelongsTo(db, sid, a.siteId))) {
      return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
    }
    const now = Date.now();
    const senderName = a.user ? (a.user.name || a.user.email || 'Agent') : 'Agent';
    await db.prepare(
      'INSERT INTO chat_messages (session_id, sender, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(sid, 'agent', senderName, message.trim().slice(0, 2000), now).run();
    await db.prepare(
      'UPDATE chat_sessions SET last_activity = ?, agent_typing = 0 WHERE id = ?'
    ).bind(now, sid).run();
    // Kopa Support: the reply also lands in the kept case record, and it
    // stamps the case's first human response. If the case was resolved or
    // closed, a person replying reopens it, on the record. No-op for
    // sessions that have no support case (for example biz site chats).
    try {
      await mirrorAgentReply(db, sid, { senderName, message: message.trim().slice(0, 2000), at: now });
    } catch (e) { /* the reply itself already saved */ }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const a = await authorize(request, env);
    if (!a.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { sessionId, session_id } = await request.json();
    const sid = sessionId || session_id;
    if (!sid) return Response.json({ error: 'Missing sessionId' }, { status: 400 });
    const db = env.KOPABOOK_DB;
    if (!(await sessionBelongsTo(db, sid, a.siteId))) {
      return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
    }
    await db.prepare(
      "UPDATE chat_sessions SET status = 'closed' WHERE id = ?"
    ).bind(sid).run();
    // Kopa Support: closing the chat from the centre also closes its
    // support case, with the change on the case's audit trail.
    const actorName = a.user ? (a.user.fullName || a.user.name || a.user.email || 'FVA70K team') : 'FVA70K team';
    try {
      await closeCaseForSession(db, sid, { type: 'team', name: actorName });
    } catch (e) { /* the session close itself already saved */ }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
