// Kopa Support case desk, FVA70K team side.
// GET  /api/chat/admin/cases                 -> filterable, paginated case list
//        filters: businessId, status, priority, category, assigned, search (business name)
// GET  /api/chat/admin/cases?caseId=xxx      -> full case: transcript, status
//        history (audit trail) and internal notes
// POST /api/chat/admin/cases                 -> { caseId, action, ... }
//        actions: resolve | close | reopen | assign | priority | category | note | reply
//
// Auth: the platform admin key (same key the Chat Center already uses), or
// a signed-in platform admin user. Internal notes and assignment live only
// behind this endpoint; the client endpoint never returns them.
import { getAuthContext } from '../../_utils.js';
import {
  ensureCaseTables, ensureChatSenderName, listCases, getCaseDetail, getCaseById,
  setCaseStatus, assignCase, setCasePriority, setCaseCategory, addCaseNote,
  teamCaseView, listAssignableStaff, mirrorAgentReply, CASE_PRIORITIES, CASE_CATEGORIES,
} from '../_cases.js';

async function authorize(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let body = null;
  if (request.method === 'POST') {
    try { body = await request.clone().json(); } catch (e) { body = null; }
  }
  const key = url.searchParams.get('key') || (body && body.key);
  if (key && env.KOPABOOK_ADMIN_KEY && key === env.KOPABOOK_ADMIN_KEY) {
    return { ok: true, actor: { type: 'team', name: (body && body.actorName) || 'FVA70K team', id: '' } };
  }
  try {
    const auth = await getAuthContext(context);
    if (auth && auth.user && auth.user.isPlatformAdmin) {
      return { ok: true, actor: { type: 'team', name: auth.user.fullName || auth.user.email || 'FVA70K team', id: String(auth.user.id) } };
    }
  } catch (e) { /* fall through to 401 */ }
  return { ok: false };
}

export async function onRequestGet(context) {
  try {
    const a = await authorize(context);
    if (!a.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const db = context.env.KOPABOOK_DB;
    await ensureCaseTables(db);
    const url = new URL(context.request.url);
    const caseId = url.searchParams.get('caseId');

    if (caseId) {
      const detail = await getCaseDetail(db, caseId, {
        includeInternal: true,
        msgAfter: url.searchParams.get('msgAfter') || 0,
        msgLimit: url.searchParams.get('msgLimit') || 100,
      });
      if (!detail) return Response.json({ error: 'Case not found' }, { status: 404 });
      return Response.json({
        case: teamCaseView(detail.kase),
        messages: detail.messages,
        events: detail.events,
        notes: detail.notes || [],
        nextMsgAfter: detail.nextMsgAfter,
      });
    }

    const { rows, nextCursor } = await listCases(db, {
      businessId: url.searchParams.get('businessId') || undefined,
      status: url.searchParams.get('status') || undefined,
      priority: url.searchParams.get('priority') || undefined,
      category: url.searchParams.get('category') || undefined,
      assignedTo: url.searchParams.get('assigned') || undefined,
      search: url.searchParams.get('search') || undefined,
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit') || 25,
    });
    const staff = await listAssignableStaff(db);
    return Response.json({ cases: rows.map(teamCaseView), nextCursor, staff });
  } catch (e) {
    return Response.json({ error: 'Failed to load cases' }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const a = await authorize(context);
    if (!a.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const db = context.env.KOPABOOK_DB;
    await ensureCaseTables(db);
    const body = await context.request.json();
    const { caseId, action } = body || {};
    if (!caseId || !action) {
      return Response.json({ error: 'Missing caseId or action' }, { status: 400 });
    }
    const kase = await getCaseById(db, caseId);
    if (!kase) return Response.json({ error: 'Case not found' }, { status: 404 });
    const actor = a.actor;
    let updated = kase;
    let note = null;

    if (action === 'resolve' || action === 'close' || action === 'reopen') {
      const next = action === 'reopen' ? 'open' : action === 'resolve' ? 'resolved' : 'closed';
      if (kase.status === next) {
        return Response.json({ error: 'Case is already ' + next + '.' }, { status: 400 });
      }
      updated = await setCaseStatus(db, kase, next, actor);
    } else if (action === 'assign') {
      const assignedTo = body.assignedTo ? String(body.assignedTo).slice(0, 120) : null;
      const assignedName = body.assignedName ? String(body.assignedName).slice(0, 120) : assignedTo;
      updated = await assignCase(db, kase, { assignedTo, assignedName }, actor);
    } else if (action === 'priority') {
      if (!CASE_PRIORITIES.includes(body.priority)) {
        return Response.json({ error: 'Bad priority' }, { status: 400 });
      }
      updated = await setCasePriority(db, kase, body.priority, actor);
    } else if (action === 'category') {
      if (!CASE_CATEGORIES.includes(body.category)) {
        return Response.json({ error: 'Bad category' }, { status: 400 });
      }
      updated = await setCaseCategory(db, kase, body.category, actor);
    } else if (action === 'note') {
      if (!body.note || !String(body.note).trim()) {
        return Response.json({ error: 'Empty note' }, { status: 400 });
      }
      note = await addCaseNote(db, kase, { authorName: actor.name, authorId: actor.id, note: String(body.note).trim() });
    } else if (action === 'reply') {
      const message = String(body.message || '').trim().slice(0, 2000);
      if (!message) {
        return Response.json({ error: 'Empty message' }, { status: 400 });
      }
      const now = Date.now();
      await ensureChatSenderName(db);
      await db.prepare(
        'INSERT INTO chat_messages (session_id, sender, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(kase.session_id, 'agent', actor.name, message, now).run();
      try {
        await db.prepare(
          'UPDATE chat_sessions SET last_activity = ?, agent_typing = 0 WHERE id = ?'
        ).bind(now, kase.session_id).run();
      } catch (e) { /* a missing session row must not block the case reply */ }
      await mirrorAgentReply(db, kase.session_id, { senderName: actor.name, message, at: now });
      const reread = await getCaseById(db, caseId);
      updated = reread || kase;
      return Response.json({
        ok: true,
        case: teamCaseView(updated),
        message: { sender: 'agent', sender_name: actor.name, message, created_at: now },
      });
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    return Response.json({ ok: true, case: teamCaseView(updated), note });
  } catch (e) {
    return Response.json({ error: 'Action failed' }, { status: 500 });
  }
}
