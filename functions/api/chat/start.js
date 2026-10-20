// POST /api/chat/start - create a new chat session (multi-site with FVA Bot welcome)
import { getAuthContext } from '../_utils.js';
import { ownerWelcome } from './kopabook-knowledge.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { name, siteId, ownerCtx } = await request.json();
    const sid = siteId || 'fva70k-main';
    const id = 'chat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const now = Date.now();

    // Get site config for custom welcome
    let welcomeMsg = "Hi there! I'm FVA Bot. How can I help you today?";
    let botName = 'FVA Bot';
    try {
      const site = await env.KOPABOOK_DB.prepare(
        'SELECT welcome_message, bot_name, business_name FROM chat_sites WHERE site_id = ?'
      ).bind(sid).first();
      if (site) {
        if (site.welcome_message) welcomeMsg = site.welcome_message;
        if (site.bot_name) botName = site.bot_name;
      }
    } catch (e) { /* use defaults */ }

    // Merged in-app chat: for site 'kopabook', an owner context only counts
    // when the signed-in session cookie proves it (same user, same active
    // business). A verified owner gets the two-door welcome and their real
    // name on the thread. Anything unverified stays the public bot.
    let ownerMode = false;
    let displayName = name;
    if (sid === 'kopabook' && ownerCtx && ownerCtx.businessId && ownerCtx.userId) {
      try {
        const auth = await getAuthContext(context);
        if (auth && auth.user && auth.business &&
            String(auth.user.id) === String(ownerCtx.userId) &&
            String(auth.business.id) === String(ownerCtx.businessId)) {
          ownerMode = true;
          displayName = auth.user.fullName || name;
          welcomeMsg = ownerWelcome(auth.user.fullName);
          botName = 'Ask Kopa AI';
        }
      } catch (e) { /* stay public */ }
    }

    await env.KOPABOOK_DB.prepare(
      'INSERT INTO chat_sessions (id, site_id, visitor_name, status, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, sid, (displayName || 'Visitor').slice(0, 60), 'active', now, now).run();

    // Welcome message from FVA Bot (not agent)
    await env.KOPABOOK_DB.prepare(
      'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, 'bot', welcomeMsg, now).run();

    return Response.json({ sessionId: id, botName, ownerMode });
  } catch (e) {
    return Response.json({ error: 'Failed to start chat' }, { status: 500 });
  }
}
