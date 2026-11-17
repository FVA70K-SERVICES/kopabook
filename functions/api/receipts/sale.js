// GET /api/receipts/sale?id= — full receipt data for one sale:
// business header info, sale, line items, payments, customer.
// Also returns (additive): customer email / Telegram handle, whether a
// Telegram chat id is stored (never the id itself), the business receipt
// contact settings, the payment-methods breakdown, the due date for a
// balance, and the profit figure — profit only when the caller may see
// it (owner/partner or can_view_profit, the same pattern as Reports).
import { json, getAuthContext, requireAuth } from "../_utils";
import { dueDateISO, round2 } from "../_receipts";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const id = Number(new URL(context.request.url).searchParams.get("id"));
    if (!id) return json({ ok: false, message: "Sale id is required." }, 400);

    // Phase 7.3: the customer columns (migration 0061) and the product
    // unit column (migration 0042) are relied on directly; live D1 has them.
    const db = context.env.KOPABOOK_DB;
    const sale = await db.prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email, c.telegram AS customer_telegram,
              c.telegram_chat_id AS customer_telegram_chat_id
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.business_id = ?`
    ).bind(id, auth.business.id).first();
    if (!sale) return json({ ok: false, message: "Sale not found." }, 404);

    const items = await db.prepare(
      `SELECT si.quantity, si.unit_price, si.line_total, si.cost_snapshot, p.name AS product_name, p.unit AS product_unit
       FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? ORDER BY si.id ASC`
    ).bind(id).all();

    const payments = await db.prepare(
      `SELECT amount, payment_method AS mode, created_at FROM payment_records
       WHERE sale_id = ? ORDER BY id ASC`
    ).bind(id).all().catch(() => ({ results: [] }));

    const business = await db.prepare(
      `SELECT * FROM businesses WHERE id = ?`
    ).bind(auth.business.id).first();

    const itemList = items.results || [];
    const payList = payments.results || [];
    // Never send the raw Telegram chat id to the client; only the boolean.
    const hasTelegramChatId = Boolean(sale.customer_telegram_chat_id);
    delete sale.customer_telegram_chat_id;
    const paidByMethod = (payList.length ? payList : [{ amount: sale.amount_paid, mode: sale.payment_method }])
      .map((p) => ({ mode: p.mode || "Cash", amount: round2(p.amount) }));
    const canViewProfit = !!auth.perms.can_view_profit;
    const profit = canViewProfit
      ? round2(itemList.reduce((s, it) => s + (Number(it.line_total || 0) - Number(it.quantity || 0) * Number(it.cost_snapshot || 0)), 0))
      : null;
    const overdueDays = business?.overdue_days ?? 7;
    const dueDate = Number(sale.balance_due) > 0 ? dueDateISO(sale.created_at, overdueDays) : null;

    return json({
      ok: true,
      business: business || {},
      sale,
      items: itemList,
      payments: payList,
      customer: {
        id: sale.customer_id || null,
        name: sale.customer_name || null,
        phone: sale.customer_phone || null,
        email: sale.customer_email || null,
        telegram: sale.customer_telegram || null,
        hasTelegramChatId,
      },
      paidByMethod,
      dueDate,
      canViewProfit,
      profit,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load receipt.", error: String(error) }, 500);
  }
}
