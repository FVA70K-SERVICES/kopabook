// Kopa Bot Tools - the bot's hands to read and manage the business
// These query real D1 data for the owner's business

export async function getBusinessContext(db, businessId) {
  try {
    const biz = await db.prepare(
      'SELECT id, name, type, currency FROM businesses WHERE id = ?'
    ).bind(businessId).first();
    return biz || null;
  } catch { return null; }
}

export async function getTodaySales(db, businessId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
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
      FROM expenses WHERE business_id = ? AND date(created_at) = date(?)
    `).bind(businessId, today).first();
    return { total: r?.total || 0 };
  } catch { return { total: 0 }; }
}

export async function getLowStock(db, businessId, limit = 10) {
  try {
    const r = await db.prepare(`
      SELECT id, name, quantity, low_stock_threshold, price
      FROM products
      WHERE business_id = ? AND quantity <= COALESCE(low_stock_threshold, 5)
      ORDER BY quantity ASC LIMIT ?
    `).bind(businessId, limit).all();
    return r.results || [];
  } catch { return []; }
}

export async function getOwed(db, businessId) {
  try {
    const r = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(balance), 0) as total
      FROM customers WHERE business_id = ? AND balance > 0
    `).bind(businessId).first();
    return { count: r?.count || 0, total: r?.total || 0 };
  } catch { return { count: 0, total: 0 }; }
}

export async function getWeekSales(db, businessId) {
  try {
    const r = await db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count, COALESCE(SUM(total), 0) as total
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
      SELECT id, name, price, quantity FROM products
      WHERE business_id = ? AND name LIKE ? LIMIT 5
    `).bind(businessId, `%${searchTerm}%`).all();
    return r.results || [];
  } catch { return []; }
}

export async function recordQuickSale(db, businessId, productId, quantity, userId) {
  try {
    const product = await db.prepare(
      'SELECT id, name, price, quantity FROM products WHERE id = ? AND business_id = ?'
    ).bind(productId, businessId).first();
    if (!product) return { error: 'Product not found' };
    if (product.quantity < quantity) return { error: `Only ${product.quantity} in stock` };

    const total = product.price * quantity;
    const saleId = 'sale_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO sales (id, business_id, total, payment_method, created_by, created_at)
      VALUES (?, ?, ?, 'cash', ?, ?)
    `).bind(saleId, businessId, total, userId, now).run();

    await db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, price, total)
      VALUES (?, ?, ?, ?, ?)
    `).bind(saleId, productId, quantity, product.price, total).run();

    await db.prepare(
      'UPDATE products SET quantity = quantity - ? WHERE id = ?'
    ).bind(quantity, productId).run();

    return { ok: true, saleId, product: product.name, quantity, total };
  } catch (e) { return { error: e.message }; }
}

export async function recordQuickExpense(db, businessId, amount, description, category, userId) {
  try {
    const id = 'exp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO expenses (id, business_id, amount, description, category, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, businessId, amount, description, category || 'general', userId, now).run();
    return { ok: true, id, amount, description };
  } catch (e) { return { error: e.message }; }
}

// Targets / goals
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
        SELECT COALESCE(SUM(total), 0) as total FROM sales
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
