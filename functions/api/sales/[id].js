// DELETE /api/sales/[id] — void a sale (owner/partner only).
// Restores stock for product lines, removes payment records and the sale's
// debt ledger entries, then recomputes the customer's running ledger balance
// so later payments and write-offs stay correct. Audited as sale.void.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../_utils";

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner" && auth.business.role !== "partner") {
      return json({ ok: false, message: "Only the owner or a partner can void a sale." }, 403);
    }

    const id = Number(context.params.id) || null;
    if (!id) return json({ ok: false, message: "Sale id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const sale = await db.prepare(
      `SELECT id, sale_number, customer_id, total_amount FROM sales WHERE id = ? AND business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!sale) return json({ ok: false, message: "Sale not found." }, 404);

    const items = await db.prepare(
      `SELECT item_type, product_id, quantity FROM sale_items WHERE sale_id = ?`
    ).bind(sale.id).all();

    const now = toSqliteDate();
    const stmts = [];

    // Restore stock for product lines.
    for (const it of items.results || []) {
      if (it.item_type === "product" && it.product_id) {
        stmts.push(
          db.prepare(
            `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ?, updated_at = ? WHERE product_id = ?`
          ).bind(it.quantity, now, it.product_id)
        );
        stmts.push(
          db.prepare(
            `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, source_id, note, created_by)
             VALUES (?, 'void', ?, 'sale', ?, ?, ?)`
          ).bind(it.product_id, it.quantity, sale.id, `Voided sale ${sale.sale_number}`, auth.user.id)
        );
      }
    }

    // Remove payment records and the sale's debt ledger entries.
    stmts.push(db.prepare(`DELETE FROM payment_records WHERE sale_id = ?`).bind(sale.id));
    if (sale.customer_id) {
      stmts.push(
        db.prepare(
          `DELETE FROM customer_ledger WHERE customer_id = ? AND source_type = 'sale' AND source_id = ?`
        ).bind(sale.customer_id, sale.sale_number)
      );
    }
    stmts.push(db.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).bind(sale.id));
    stmts.push(db.prepare(`DELETE FROM sales WHERE id = ?`).bind(sale.id));

    await db.batch(stmts);

    // Recompute the customer's running ledger balance after removing entries.
    if (sale.customer_id) {
      const remaining = await db.prepare(
        `SELECT id, amount_delta FROM customer_ledger WHERE customer_id = ? ORDER BY id ASC`
      ).bind(sale.customer_id).all();
      let running = 0;
      const fixes = [];
      for (const r of remaining.results || []) {
        running = Math.round((running + Number(r.amount_delta || 0)) * 100) / 100;
        fixes.push(db.prepare(`UPDATE customer_ledger SET balance_after = ? WHERE id = ?`).bind(running, r.id));
      }
      if (fixes.length) await db.batch(fixes);
    }

    await audit(context, auth, "sale.void", "sale", sale.id, {
      saleNumber: sale.sale_number, total: sale.total_amount,
    });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not void sale.", error: String(error) }, 500);
  }
}
