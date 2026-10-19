// Staff control for FVAChat - assign chats, manage handlers
// GET /api/chat/admin/staff - list staff with chat status
// POST /api/chat/admin/staff - assign/takeover/release chat

import { getAuthContext } from '../../_utils.js';
import { canUseChatCenter, businessSiteId } from '../_access.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthContext(request, env);
    const db = env.KOPABOOK_DB;
    if (!auth || !(await canUseChatCenter(db, auth))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Always scope to the caller's own business; ignore client-passed business_id.
    const businessId = auth.business.id;

    // Get staff members (business members with staff roles)
    let staffQuery = `
      SELECT bm.id, bm.user_id, u.name, u.email, bm.role,
             (SELECT COUNT(*) FROM chat_sessions cs
              WHERE cs.assigned_to = u.email AND cs.status = 'active') as active_chats
      FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE bm.status = 'active'
    `;
    const params = [];
    if (businessId) {
      staffQuery += ' AND bm.business_id = ?';
      params.push(businessId);
    }

    const staff = await env.KOPABOOK_DB.prepare(staffQuery).bind(...params).all();

    // Get unassigned active chats needing attention
    const unassigned = await db.prepare(`
      SELECT COUNT(*) as count FROM chat_sessions
      WHERE status = 'active' AND (assigned_to IS NULL OR assigned_to = '')
      AND needs_human = 1 AND site_id = ?
    `).bind(businessSiteId(businessId)).first();

    return Response.json({
      staff: staff.results || [],
      unassignedNeedingHuman: unassigned?.count || 0
    });
  } catch (e) {
    return Response.json({ error: 'Failed to load staff: ' + e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getAuthContext(request, env);
    const db = env.KOPABOOK_DB;
    if (!auth || !(await canUseChatCenter(db, auth))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const siteId = businessSiteId(auth.business.id);

    const { action, session_id, assign_to } = await request.json();

    // Never touch another business's chats.
    async function ownSession(sid) {
      if (!sid) return false;
      const s = await db.prepare('SELECT site_id FROM chat_sessions WHERE id = ?').bind(sid).first();
      return !!(s && s.site_id === siteId);
    }

    if (action === 'assign' && session_id && assign_to) {
      if (!(await ownSession(session_id))) {
        return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
      }
      // Assign chat to a staff member (or owner)
      await env.KOPABOOK_DB.prepare(`
        UPDATE chat_sessions
        SET assigned_to = ?, assigned_at = datetime('now'), handled_by = 'human', needs_human = 0
        WHERE id = ?
      `).bind(assign_to, session_id).run();

      // Notify in chat
      await env.KOPABOOK_DB.prepare(`
        INSERT INTO chat_messages (session_id, sender, sender_name, message, created_at)
        VALUES (?, 'system', 'System', ?, datetime('now'))
      `).bind(session_id, `${auth.user.name || 'Staff'} joined the chat`).run();

      return Response.json({ ok: true, assigned_to: assign_to });
    }

    if (action === 'takeover' && session_id) {
      if (!(await ownSession(session_id))) {
        return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
      }
      // Owner/staff takes over from bot
      await env.KOPABOOK_DB.prepare(`
        UPDATE chat_sessions
        SET assigned_to = ?, assigned_at = datetime('now'), handled_by = 'human', needs_human = 0, bot_enabled = 0
        WHERE id = ?
      `).bind(auth.user.email, session_id).run();

      await env.KOPABOOK_DB.prepare(`
        INSERT INTO chat_messages (session_id, sender, sender_name, message, created_at)
        VALUES (?, 'system', 'System', ?, datetime('now'))
      `).bind(session_id, `${auth.user.name || 'Support'} (human) joined the chat`).run();

      return Response.json({ ok: true, handled_by: 'human' });
    }

    if (action === 'release' && session_id) {
      if (!(await ownSession(session_id))) {
        return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
      }
      // Hand back to bot
      await env.KOPABOOK_DB.prepare(`
        UPDATE chat_sessions
        SET assigned_to = NULL, assigned_at = NULL, handled_by = 'bot', bot_enabled = 1
        WHERE id = ?
      `).bind(session_id).run();

      await env.KOPABOOK_DB.prepare(`
        INSERT INTO chat_messages (session_id, sender, sender_name, message, created_at)
        VALUES (?, 'system', 'System', 'Kopa Bot is back. How else can I help?', datetime('now'))
      `).bind(session_id).run();

      return Response.json({ ok: true, handled_by: 'bot' });
    }

    if (action === 'toggle_bot' && session_id) {
      if (!(await ownSession(session_id))) {
        return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
      }
      const { bot_enabled } = await request.json();
      await env.KOPABOOK_DB.prepare(`
        UPDATE chat_sessions SET bot_enabled = ? WHERE id = ?
      `).bind(bot_enabled ? 1 : 0, session_id).run();
      return Response.json({ ok: true, bot_enabled });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: 'Action failed: ' + e.message }, { status: 500 });
  }
}
