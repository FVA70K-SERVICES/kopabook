// FVA70K Maintenance Dashboard - internal monitoring for all our services
// GET /api/maintenance/dashboard?key=xxx - overview of all services

const SERVICES = [
  { id: 'kopabook', name: 'KopaBook', url: 'https://kopabook-bop.pages.dev', type: 'internal' },
  { id: 'fva70k', name: 'FVA70K Services', url: 'https://fva70k.com', type: 'internal' },
  { id: 'fixpro', name: 'FixPro Hub', url: 'https://fixprohub.ng', type: 'internal' },
  { id: 'gou', name: 'Global Open University', url: 'https://globalopenuniversity.online', type: 'internal' },
];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    // Use platform admin auth or maintenance key
    const key = url.searchParams.get('key');

    // For now, accept KOPABOOK_ADMIN_KEY or BOOTSTRAP_KEY
    if (key !== env.KOPABOOK_ADMIN_KEY && key !== env.BOOTSTRAP_KEY) {
      // Also allow platform admin session (check via existing auth)
      // Simplified: require key for now
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = [];
    for (const svc of SERVICES) {
      const check = await checkService(svc);
      results.push(check);
    }

    // KopaBook D1 stats
    let dbStats = null;
    try {
      const users = await env.KOPABOOK_DB.prepare('SELECT COUNT(*) as c FROM users').first();
      const businesses = await env.KOPABOOK_DB.prepare('SELECT COUNT(*) as c FROM businesses').first();
      const chats = await env.KOPABOOK_DB.prepare('SELECT COUNT(*) as c FROM chat_sessions').first();
      dbStats = {
        users: users?.c || 0,
        businesses: businesses?.c || 0,
        chatSessions: chats?.c || 0
      };
    } catch (e) {
      dbStats = { error: e.message };
    }

    const down = results.filter(r => r.status !== 'up').length;

    return Response.json({
      timestamp: new Date().toISOString(),
      maintainedBy: 'FVA70K Services',
      overall: down === 0 ? 'all_operational' : `${down}_service(s)_need_attention`,
      services: results,
      kopabookDb: dbStats
    });
  } catch (e) {
    return Response.json({ error: 'Dashboard failed: ' + e.message }, { status: 500 });
  }
}

async function checkService(svc) {
  const start = Date.now();
  try {
    const res = await fetch(svc.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    return {
      id: svc.id,
      name: svc.name,
      url: svc.url,
      status: res.ok ? 'up' : 'degraded',
      httpStatus: res.status,
      responseTimeMs: Date.now() - start,
      type: svc.type
    };
  } catch (e) {
    return {
      id: svc.id,
      name: svc.name,
      url: svc.url,
      status: 'down',
      error: e.message,
      responseTimeMs: Date.now() - start,
      type: svc.type
    };
  }
}
