// DELETE /api/sales/:id — void a sale (owner/partner only).
// WORLD-BEST (Dashboard stream, merge fix): this REPLACES the live
// hard-delete void (base blob deefe43c, present since before round 1),
// which deleted the sale row, its items, its payment records and its
// ledger entries. A deleted sale leaves no receipt, no History record
// and no audit trail beyond one audit row, which contradicts this
// upgrade's History rule (every record kept). The soft void instead
// marks the sale 'voided' (Dashboard, Reports and the sales list all
// exclude voided sales, so totals stay correct), restores the stock its
// product lines took, and reverses any debt the sale created with a new
// ledger entry. Money already taken is not moved by this call. No past
// sale, price, or tax rate is rewritten, and voids already done under
// the old hard delete stay deleted — nothing is restored.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../_utils";
import { canVoidSale } from "../_creditRules.js";
import { recordHistory } from "../_history.js";

export async function onRequestDelete(context) {
  const db = context.env.KOPABOOK_DB;
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canVoidSale(auth.business.role)) {
      return json({ ok: false, message: "Only the owner or a partner can void a sale." }, 403);
    }

    const url = new URL(context.request.url);
    const id = Number(url.pathname.split("/").filter(Boolean).pop());
    if (!id) return json({ ok: false, message: "Sale id is required." }, 400);

    const sale = await db.prepare(
      `SELECT * FROM sales WHERE id = ? AND business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!sale) return json({ ok: false, message: "Sale not found." }, 404);
    if (sale.status === "voided") {
      return json({ ok: false, message: "This sale is already voided." }, 400);
    }

    const lines = await db.prepare(
      `SELECT product_id, quantity FROM sale_items
       WHERE sale_id = ? AND item_type = 'product' AND product_id IS NOT NULL`
    ).bind(id).all();

    // Latest ledger balance, so the debt reversal lands on the right figure.
    let prevLedgerBalance = 0;
    const balanceDue = Number(sale.balance_due || 0);
    if (balanceDue > 0 && sale.customer_id) {
      const lastLedger = await db.prepare(
        `SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(sale.customer_id).first();
      prevLedgerBalance = lastLedger ? Number(lastLedger.balance_after) : 0;
    }

    const now = toSqliteDate();
    const stmts = [];
    stmts.push(
      db.prepare(`UPDATE sales SET status = 'voided' WHERE id = ? AND business_id = ?`)
        .bind(id, auth.business.id)
    );
    for (const line of lines.results || []) {
      const qty = Number(line.quantity || 0);
      if (!qty) continue;
      stmts.push(
        db.prepare(
          `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ?, updated_at = ?
           WHERE product_id = ?`
        ).bind(qty, now, line.product_id)
      );
      stmts.push(
        db.prepare(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, source_id, note, created_by)
           VALUES (?, 'void', ?, 'sale', ?, ?, ?)`
        ).bind(line.product_id, qty, id, `Void sale ${sale.sale_number}`, auth.user.id)
      );
    }
    if (balanceDue > 0 && sale.customer_id) {
      const newBalance = Math.round((prevLedgerBalance - balanceDue) * 100) / 100;
      stmts.push(
        db.prepare(
          `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
           VALUES (?, 'void', ?, ?, 'sale', ?, ?)`
        ).bind(sale.customer_id, -balanceDue, newBalance, id, `Void sale ${sale.sale_number}`)
      );
    }

    await db.batch(stmts);
    await audit(context, auth, "sale.void", "sale", id, { saleNumber: sale.sale_number });
    // WORLD-BEST (merge, History stream §6b): a voided sale leaves a trace.
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "sale",
      entityType: "sale",
      entityId: id,
      summary: `Voided sale ${sale.sale_number} — ${auth.business.currency} ${Number(sale.total_amount || 0).toLocaleString("en-US")}`,
      amount: Number(sale.total_amount || 0),
    });
    return json({ ok: true, saleNumber: sale.sale_number });
  } catch (error) {
    return json({ ok: false, message: "Could not void sale: " + String(error && error.message || error), error: String(error) }, 500);
  }
}
