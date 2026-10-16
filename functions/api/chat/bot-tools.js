// Kopa Bot Tools - the bot's hands to read and manage the business
// These query real D1 data for the owner's business

export async function getBusinessContext(db, businessId) {
  try {
    const biz = await db.prepare(
      'SELECT id, name FROM businesses WHERE id = ?'
    ).bind(businessId).first();
    return biz || null;
  } catch { return null; }
}

export async function getTodaySales(db, businessId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM sales WHERE business_id = ? AND date(created_at) = date(?)
    `).bind(businessId, today).first();
    return { count: r?.count || 0, total: r?.total || 0 };
  } catch { return { count: 0, total: 0 }; }
}

export async function getTodayExpenses(db, businessId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses WHERE business_id = ? AND date(incurred_on) = date(?)
    `).bind(businessId, today).first();
    return { total: r?.total || 0 };
  } catch { return { total: 0 }; }
}

export async function getLowStock(db, businessId, limit = 10) {
  try {
    const r = await db.prepare(`
      SELECT p.id, p.name, COALESCE(i.quantity_on_hand, 0) as quantity,
             p.unit_price as price, COALESCE(i.reorder_level, 5) as threshold
      FROM products p
      LEFT JOIN inventory_items i ON i.product_id = p.id
      WHERE p.business_id = ? AND p.is_active = 1
        AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_level, 5)
      ORDER BY quantity ASC LIMIT ?
    `).bind(businessId, limit).all();
    return r.results || [];
  } catch { return []; }
}

export async function getOwed(db, businessId) {
  try {
    const r = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(balance_due), 0) as total
      FROM sales WHERE business_id = ? AND balance_due > 0 AND status != 'voided'
    `).bind(businessId).first();
    return { count: r?.count || 0, total: r?.total || 0 };
  } catch { return { count: 0, total: 0 }; }
}

export async function getWeekSales(db, businessId) {
  try {
    const r = await db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM sales
      WHERE business_id = ? AND created_at >= datetime('now', '-7 days')
      GROUP BY date(created_at) ORDER BY day DESC
    `).bind(businessId).all();
    return r.results || [];
  } catch { return []; }
}

export async function findProduct(db, businessId, searchTerm) {
  try {
    const r = await db.prepare(`
      SELECT p.id, p.name, p.unit_price as price, COALESCE(i.quantity_on_hand, 0) as quantity
      FROM products p
      LEFT JOIN inventory_items i ON i.product_id = p.id
      WHERE p.business_id = ? AND p.is_active = 1 AND p.name LIKE ? LIMIT 5
    `).bind(businessId, `%${searchTerm}%`).all();
    return r.results || [];
  } catch { return []; }
}

export async function getTargets(db, businessId) {
  try {
    const r = await db.prepare(`
      SELECT * FROM bot_targets
      WHERE business_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).bind(businessId).all();
    return r.results || [];
  } catch { return []; }
}

export async function setTarget(db, businessId, type, targetValue, period, description, userId) {
  try {
    const id = 'tgt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.prepare(`
      INSERT INTO bot_targets (id, business_id, type, target_value, period, description, created_by, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `).bind(id, businessId, type, targetValue, period, description, userId).run();
    return { ok: true, id };
  } catch (e) { return { error: e.message }; }
}

export async function getTargetProgress(db, businessId, target) {
  try {
    if (target.type === 'sales') {
      let dateFilter = "date(created_at) = date('now')";
      if (target.period === 'week') dateFilter = "created_at >= datetime('now', '-7 days')";
      if (target.period === 'month') dateFilter = "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')";
      const r = await db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total FROM sales
        WHERE business_id = ? AND ${dateFilter}
      `).bind(businessId).first();
      const current = r?.total || 0;
      const pct = target.target_value > 0 ? Math.round((current / target.target_value) * 100) : 0;
      return { current, target: target.target_value, pct };
    }
    return { current: 0, target: target.target_value, pct: 0 };
  } catch { return { current: 0, target: target?.target_value || 0, pct: 0 }; }
}

export function formatNaira(amount) {
  return '₦' + Number(amount || 0).toLocaleString();
}
