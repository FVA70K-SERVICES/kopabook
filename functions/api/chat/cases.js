// Kopa Support case history, client side.
// GET  /api/chat/cases              -> my business's support cases (paginated)
// GET  /api/chat/cases?caseId=xxx   -> one case: messages + status history
// POST /api/chat/cases              -> { caseId, action: 'confirm' | 'reopen' }
//
// The business always comes from the signed-in session, never from the
// request, so one business can only ever see its own cases. Payloads are
// shaped with clientCaseView: no internal notes, no assignment, no
// priority, nothing from the FVA70K side's desk leaks in here.
import { getAuthContext } from '../_utils.js';
import {
  ensureCaseTables, listCases, getCaseDetail, getCaseById,
  setCaseStatus, confirmCaseResolved, clientCaseView, clientEventView,
} from './_cases.js';

async function ownCase(db, caseId, businessId) {
  const kase = await getCaseById(db, caseId);
  if (!kase || String(kase.business_id) !== String(businessId)) return null;
  return kase;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    if (!auth || !auth.user || !auth.business) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const db = context.env.KOPABOOK_DB;
    await ensureCaseTables(db);
    const url = new URL(context.request.url);
    const caseId = url.searchParams.get('caseId');

    if (caseId) {
      const kase = await ownCase(db, caseId, auth.business.id);
      if (!kase) return Response.json({ error: 'Case not found' }, { status: 404 });
      const detail = await getCaseDetail(db, caseId, {
        msgAfter: url.searchParams.get('msgAfter') || 0,
        msgLimit: url.searchParams.get('msgLimit') || 100,
      });
      return Response.json({
        case: clientCaseView({ ...detail.kase, message_count: undefined, last_message: undefined }),
        messages: detail.messages,
        events: detail.events.map(clientEventView),
        nextMsgAfter: detail.nextMsgAfter,
      });
    }

    const { rows, nextCursor } = await listCases(db, {
      businessId: auth.business.id,
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit') || 20,
    });
    return Response.json({ cases: rows.map(clientCaseView), nextCursor });
  } catch (e) {
    return Response.json({ error: 'Failed to load support history' }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    if (!auth || !auth.user || !auth.business) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const db = context.env.KOPABOOK_DB;
    await ensureCaseTables(db);
    const { caseId, action } = await context.request.json();
    if (!caseId || !['confirm', 'reopen'].includes(action)) {
      return Response.json({ error: 'Missing or invalid action' }, { status: 400 });
    }
    const kase = await ownCase(db, caseId, auth.business.id);
    if (!kase) return Response.json({ error: 'Case not found' }, { status: 404 });
    const actor = { type: 'client', name: auth.user.fullName || 'You', id: String(auth.user.id) };

    let updated = kase;
    if (action === 'confirm') {
      const r = await confirmCaseResolved(db, kase, actor);
      if (!r.changed && r.reason === 'not_resolved') {
        return Response.json({ error: 'Only a resolved case can be confirmed.' }, { status: 400 });
      }
      updated = r.kase;
    } else {
      // reopen
      if (kase.status === 'open') {
        return Response.json({ error: 'This case is already open.' }, { status: 400 });
      }
      updated = await setCaseStatus(db, kase, 'open', actor);
    }
    return Response.json({ ok: true, case: clientCaseView(updated) });
  } catch (e) {
    return Response.json({ error: 'Action failed' }, { status: 500 });
  }
}
