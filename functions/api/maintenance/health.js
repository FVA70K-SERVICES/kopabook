// FVA70K Maintenance Route - health checks and maintenance status
// GET /api/maintenance/health - full system health check
// GET /api/maintenance/status - quick status for monitoring

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.endsWith('/health')) {
    return await fullHealthCheck(env);
  }
  return await quickStatus(env);
}

async function quickStatus(env) {
  return Response.json({
    service: 'KopaBook',
    status: 'operational',
    timestamp: new Date().toISOString(),
    maintainedBy: 'FVA70K Services'
  });
}

async function fullHealthCheck(env) {
  const checks = {};
  const start = Date.now();

  // D1 database check
  try {
    const result = await env.KOPABOOK_DB.prepare('SELECT 1 as ok').first();
    checks.database = {
      status: result?.ok === 1 ? 'healthy' : 'degraded',
      type: 'D1',
      latencyMs: Date.now() - start
    };
  } catch (e) {
    checks.database = { status: 'down', error: e.message };
  }

  // Check critical tables exist
  try {
    const tables = await env.KOPABOOK_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','businesses','chat_sites','chat_sessions')"
    ).all();
    const found = (tables.results || []).map(t => t.name);
    checks.tables = {
      status: found.length >= 4 ? 'healthy' : 'degraded',
      found,
      expected: ['users', 'businesses', 'chat_sites', 'chat_sessions']
    };
  } catch (e) {
    checks.tables = { status: 'down', error: e.message };
  }

  // Chat system check
  try {
    const site = await env.KOPABOOK_DB.prepare(
      "SELECT site_id, bot_enabled, plan FROM chat_sites WHERE site_id = 'kopabook'"
    ).first();
    checks.fvachat = site ? {
      status: 'healthy',
      botEnabled: !!site.bot_enabled,
      plan: site.plan
    } : { status: 'degraded', note: 'KopaBook chat site not registered' };
  } catch (e) {
    checks.fvachat = { status: 'down', error: e.message };
  }

  // R2 storage check
  try {
    if (env.KOPABOOK_R2) {
      await env.KOPABOOK_R2.list({ limit: 1 });
      checks.storage = { status: 'healthy', type: 'R2' };
    } else {
      checks.storage = { status: 'unknown', note: 'R2 binding not configured' };
    }
  } catch (e) {
    checks.storage = { status: 'down', error: e.message };
  }

  // Paystack config check (without exposing secrets)
  checks.payments = {
    status: env.PAYSTACK_SECRET_KEY ? 'configured' : 'not_configured',
    provider: 'Paystack'
  };

  // Overall status
  const statuses = Object.values(checks).map(c => c.status);
  const overall = statuses.includes('down') ? 'degraded' :
                  statuses.includes('degraded') ? 'degraded' : 'operational';

  return Response.json({
    service: 'KopaBook',
    status: overall,
    timestamp: new Date().toISOString(),
    maintainedBy: 'FVA70K Services',
    plan: 'internal (unlimited)',
    checks,
    responseTimeMs: Date.now() - start
  });
}
