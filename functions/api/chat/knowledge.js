// /api/chat/knowledge - platform admin only. Teach Kopa Bot new things.
// The bot reads the bot_knowledge D1 table on every message, so changes
// here take effect within minutes, no deploy needed.
import { json, getAuthContext, requireAuth, requirePlatformAdmin } from '../_utils.js';

async function guard(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth) || requirePlatformAdmin(auth);
  return { auth, denied };
}

// GET: list all knowledge entries
export async function onRequestGet(context) {
  const { denied } = await guard(context);
  if (denied) return denied;
  try {
    const rows = await context.env.KOPABOOK_DB.prepare(
      'SELECT id, topic, patterns, answer, quick_replies, priority, updated_at FROM bot_knowledge ORDER BY priority DESC, topic ASC'
    ).all();
    return json({ ok: true, knowledge: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: 'Knowledge table not ready. Apply migration 0038 first.' }, 500);
  }
}

// POST: add or update an entry { topic, patterns[], answer, quickReplies[], priority }
export async function onRequestPost(context) {
  const { denied } = await guard(context);
  if (denied) return denied;
  try {
    const body = await context.request.json();
    const topic = String(body.topic || '').trim().slice(0, 80);
    const answer = String(body.answer || '').trim().slice(0, 2000);
    const patterns = Array.isArray(body.patterns) ? body.patterns.map(String).slice(0, 20) : [];
    const quickReplies = Array.isArray(body.quickReplies) ? body.quickReplies.map(String).slice(0, 4) : [];
    const priority = Number.isFinite(+body.priority) ? Math.max(0, Math.min(1000, +body.priority)) : 50;
    if (!topic || !answer || !patterns.length) {
      return json({ ok: false, message: 'topic, answer and at least one pattern are required.' }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO bot_knowledge (topic, patterns, answer, quick_replies, priority, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(topic) DO UPDATE SET patterns=excluded.patterns, answer=excluded.answer,
         quick_replies=excluded.quick_replies, priority=excluded.priority, updated_at=excluded.updated_at`
    ).bind(topic, JSON.stringify(patterns), answer, JSON.stringify(quickReplies), priority, now).run();
    return json({ ok: true, message: `Taught the bot about "${topic}".` });
  } catch (e) {
    return json({ ok: false, message: 'Could not save. Apply migration 0038 first.' }, 500);
  }
}

// DELETE ?id=: remove an entry
export async function onRequestDelete(context) {
  const { denied } = await guard(context);
  if (denied) return denied;
  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, message: 'id is required.' }, 400);
    await context.env.KOPABOOK_DB.prepare('DELETE FROM bot_knowledge WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: 'Could not delete.' }, 500);
  }
}
