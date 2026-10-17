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
      SELECT p.id, p.name, p.unit_price as price, COALESCE(p.unit, 'piece') as unit, COALESCE(i.quantity_on_hand, 0) as quantity
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

export function formatNGN(amount) {
  return 'NGN ' + Number(amount || 0).toLocaleString();
}

// --- CUSTOMER LOOKOUT: always scoped to business_id ---
export async function findCustomer(db, businessId, searchTerm) {
  try {
    const r = await db.prepare(`
      SELECT c.id, c.name, c.phone,
        COALESCE((SELECT SUM(s.balance_due) FROM sales s
                  WHERE s.customer_id = c.id AND s.business_id = ? AND s.status != 'voided'), 0) as owed,
        (SELECT MAX(s.created_at) FROM sales s
                  WHERE s.customer_id = c.id AND s.business_id = ?) as last_purchase
      FROM customers c
      WHERE c.business_id = ? AND c.name LIKE ? LIMIT 5
    `).bind(businessId, businessId, businessId, `%${searchTerm}%`).all();
    return r.results || [];
  } catch { return []; }
}

export async function getDebtors(db, businessId, limit = 10) {
  try {
    const r = await db.prepare(`
      SELECT c.id, c.name, c.phone, COALESCE(SUM(s.balance_due), 0) as owed
      FROM customers c
      JOIN sales s ON s.customer_id = c.id
      WHERE c.business_id = ? AND s.business_id = ? AND s.balance_due > 0 AND s.status != 'voided'
      GROUP BY c.id, c.name, c.phone
      HAVING owed > 0
      ORDER BY owed DESC LIMIT ?
    `).bind(businessId, businessId, limit).all();
    return r.results || [];
  } catch { return []; }
}

// --- CONFIRMED SALE RECORDING: writes a real sale + line item, decrements stock ---
export async function recordSale(db, businessId, productId, qty, unitPrice, userId) {
  try {
    const lineTotal = qty * unitPrice;
    const saleNumber = 'S' + Date.now().toString(36).toUpperCase();
    const saleRes = await db.prepare(`
      INSERT INTO sales (business_id, staff_user_id, sale_number, subtotal, total_amount, amount_paid, balance_due, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'completed', datetime('now'))
    `).bind(businessId, userId, saleNumber, lineTotal, lineTotal, lineTotal).run();
    const saleId = saleRes.meta.last_row_id;
    await db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?)
    `).bind(saleId, productId, qty, unitPrice, lineTotal).run();
    try {
      await db.prepare(`
        UPDATE inventory_items SET quantity_on_hand = quantity_on_hand - ?
        WHERE product_id = ?
      `).bind(qty, productId).run();
    } catch {}
    return { ok: true, saleNumber, total: lineTotal };
  } catch (e) { return { error: e.message }; }
}

// --- PER-BUSINESS MEMORY: every query filters by business_id ---
export async function saveMemory(db, businessId, key, value, createdBy) {
  try {
    const existing = await db.prepare(
      'SELECT id FROM bot_business_memory WHERE business_id = ? AND memory_key = ?'
    ).bind(businessId, key).first();
    if (existing) {
      await db.prepare(
        `UPDATE bot_business_memory SET memory_value = ?, created_by = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(value, createdBy, existing.id).run();
      return { ok: true, id: existing.id, updated: true };
    }
    const id = 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.prepare(
      `INSERT INTO bot_business_memory (id, business_id, memory_key, memory_value, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, businessId, key, value, createdBy).run();
    return { ok: true, id };
  } catch (e) { return { error: e.message }; }
}

export async function listMemories(db, businessId) {
  try {
    const r = await db.prepare(
      'SELECT memory_key, memory_value FROM bot_business_memory WHERE business_id = ? ORDER BY updated_at DESC'
    ).bind(businessId).all();
    return r.results || [];
  } catch { return []; }
}

export async function forgetMemory(db, businessId, key) {
  try {
    let r = await db.prepare(
      'DELETE FROM bot_business_memory WHERE business_id = ? AND memory_key = ?'
    ).bind(businessId, key).run();
    if ((r.meta.changes || 0) === 0) {
      r = await db.prepare(
        'DELETE FROM bot_business_memory WHERE business_id = ? AND memory_key LIKE ?'
      ).bind(businessId, `%${key}%`).run();
    }
    return { deleted: r.meta.changes || 0 };
  } catch (e) { return { error: e.message }; }
}

// --- PENDING ACTIONS (sale confirmations): keyed by session + business ---
export async function savePendingAction(db, sessionId, businessId, actionType, payload) {
  try {
    await db.prepare('DELETE FROM bot_pending_actions WHERE session_id = ? AND business_id = ?').bind(sessionId, businessId).run();
    const id = 'pa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.prepare(
      `INSERT INTO bot_pending_actions (id, session_id, business_id, action_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, sessionId, businessId, actionType, JSON.stringify(payload)).run();
    return { ok: true, id };
  } catch (e) { return { error: e.message }; }
}

export async function getPendingAction(db, sessionId, businessId) {
  try {
    const r = await db.prepare(
      'SELECT * FROM bot_pending_actions WHERE session_id = ? AND business_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(sessionId, businessId).first();
    if (!r) return null;
    return { ...r, payload: JSON.parse(r.payload) };
  } catch { return null; }
}

export async function clearPendingAction(db, sessionId, businessId) {
  try {
    if (businessId !== undefined) {
      await db.prepare('DELETE FROM bot_pending_actions WHERE session_id = ? AND business_id = ?').bind(sessionId, businessId).run();
    } else {
      await db.prepare('DELETE FROM bot_pending_actions WHERE session_id = ?').bind(sessionId).run();
    }
  } catch {}
}
