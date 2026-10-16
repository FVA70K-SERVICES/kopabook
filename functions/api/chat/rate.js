// POST /api/chat/rate - visitor rates the chat (1-5 stars)
export async function onRequestPost({ request, env }) {
  try {
    const { sessionId, rating, feedback } = await request.json();
    if (!sessionId || !rating || rating < 1 || rating > 5) {
      return Response.json({ error: 'Valid sessionId and rating (1-5) required' }, { status: 400 });
    }

    await env.KOPABOOK_DB.prepare(
      'UPDATE chat_sessions SET rating = ?, rating_feedback = ?, rated_at = ? WHERE id = ?'
    ).bind(rating, (feedback || '').slice(0, 500), Date.now(), sessionId).run().catch(async () => {
      // Column may not exist yet - try ALTER
      await env.KOPABOOK_DB.prepare('ALTER TABLE chat_sessions ADD COLUMN rating INTEGER').run().catch(() => {});
      await env.KOPABOOK_DB.prepare('ALTER TABLE chat_sessions ADD COLUMN rating_feedback TEXT').run().catch(() => {});
      await env.KOPABOOK_DB.prepare('ALTER TABLE chat_sessions ADD COLUMN rated_at INTEGER').run().catch(() => {});
      await env.KOPABOOK_DB.prepare(
        'UPDATE chat_sessions SET rating = ?, rating_feedback = ?, rated_at = ? WHERE id = ?'
      ).bind(rating, (feedback || '').slice(0, 500), Date.now(), sessionId).run();
    });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed to save rating' }, { status: 500 });
  }
}

// GET /api/chat/ratings?key=xxx&siteId=xxx - get rating stats (admin)
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.KOPABOOK_ADMIN_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const siteId = url.searchParams.get('siteId');
    let query = 'SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM chat_sessions WHERE rating IS NOT NULL';
    const params = [];
    if (siteId) { query += ' AND site_id = ?'; params.push(siteId); }
    const stats = await env.KOPABOOK_DB.prepare(query).bind(...params).first().catch(() => null);
    return Response.json({
      average: stats?.avg_rating ? Math.round(stats.avg_rating * 10) / 10 : 0,
      total: stats?.total || 0
    });
  } catch (e) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
