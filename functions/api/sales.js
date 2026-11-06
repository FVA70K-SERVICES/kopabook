// /api/sales — GET list, POST create sale
// POST creates: sale header, sale items, stock deduction + movements,
// payment record, and customer debt via customer_ledger when balance remains.
// All writes for one sale run in a single D1 batch so a sale is atomic:
// it either records completely or not at all.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "./_utils";
// WORLD-BEST (Dashboard stream): credit, debt and change guards. The
// discount gate below is unchanged; the client-side cash-change warning
// lives in the Current-sale screen (round-3 region) and is NOT edited here.
import {
  loadModeRows, splitTender, checkCashChange,
  checkCreditPermission, checkCreditLimit, loadCustomerCredit,
} from "./_creditRules.js";
import { recordHistory } from "./_history.js";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    // WORLD-BEST (merge, soft void): voided sales are corrections, not
    // sales, so the list excludes them by default — the same rows the old
    // hard-delete void removed from view. Pass ?includeVoided=1 to see
    // them (the voided row still carries its receipt and history).
    const includeVoided = url.searchParams.get("includeVoided") === "1";

    let sql = `SELECT s.*, c.name AS customer_name
               FROM sales s
               LEFT JOIN customers c ON c.id = s.customer_id
               WHERE s.business_id = ?`;
    const params = [auth.business.id];
    if (!includeVoided) sql += ` AND (s.status IS NULL OR s.status != 'voided')`;
    if (from) { sql += ` AND date(s.created_at) >= ?`; params.push(from); }
    if (to) { sql += ` AND date(s.created_at) <= ?`; params.push(to); }
    sql += ` ORDER BY s.id DESC LIMIT ?`;
    params.push(limit);

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, sales: result.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load sales.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.KOPABOOK_DB;
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { items, customerId, customerName, amountPaid, paymentMethod } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return json({ ok: false, message: "Add at least one item to the sale." }, 400);
    }

    // Validate items and compute totals. Each item is either a product line
    // ({productId, quantity, unitPrice?}) or a service line
    // ({serviceId, quantity, unitPrice?}). Services skip all stock checks.
    let subtotal = 0;
    const lines = [];
    for (const item of items) {
      if (item.serviceId !== undefined && item.serviceId !== null) {
        const qty = Number(item.quantity);
        if (Number.isNaN(qty) || qty <= 0) {
          return json({ ok: false, message: "Invalid quantity for one of the sale items." }, 400);
        }
        const service = await db.prepare(
          `SELECT * FROM services
           WHERE id = ? AND business_id = ? AND is_active = 1
           LIMIT 1`
        )
          .bind(Number(item.serviceId), auth.business.id)
          .first();
        if (!service) {
          return json({ ok: false, message: `Service not found (id ${item.serviceId}).` }, 400);
        }
        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(service.price);
        const lineTotal = Math.round(unitPrice * qty * 100) / 100;
        subtotal += lineTotal;
        lines.push({ kind: "service", service, qty, unitPrice, lineTotal, defaultPrice: Number(service.price) });
        continue;
      }

      const product = await db.prepare(
        `SELECT p.*, COALESCE(i.quantity_on_hand, 0) AS stock
         FROM products p
         LEFT JOIN inventory_items i ON i.product_id = p.id
         WHERE p.id = ? AND p.business_id = ? AND p.is_active = 1
         LIMIT 1`
      )
        .bind(Number(item.productId), auth.business.id)
        .first();
      if (!product) {
        return json({ ok: false, message: `Product not found (id ${item.productId}).` }, 400);
      }
      const qty = Number(item.quantity);
      if (Number.isNaN(qty) || qty <= 0) {
        return json({ ok: false, message: `Invalid quantity for ${product.name}.` }, 400);
      }
      if (product.stock < qty) {
        return json({ ok: false, message: `Not enough stock for ${product.name} (have ${product.stock}).` }, 400);
      }
      const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.unit_price);
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      subtotal += lineTotal;
      lines.push({ kind: "product", product, qty, unitPrice, lineTotal, defaultPrice: Number(product.unit_price) });
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Discount gate: selling below the default price needs the discount permission.
    const discounted = lines.some((l) => Math.round(l.unitPrice * 100) < Math.round(l.defaultPrice * 100));
    if (discounted) {
      const permDenied = requirePerm(auth, "can_discount", "Only staff with discount permission can sell below the listed price.");
      if (permDenied) return permDenied;
      // Per-staff discount cap: no line may be discounted beyond their limit.
      const cap = auth.limits?.max_discount_percent;
      if (cap !== null && cap !== undefined) {
        for (const l of lines) {
          if (l.defaultPrice > 0 && l.unitPrice < l.defaultPrice) {
            const pct = Math.round(((l.defaultPrice - l.unitPrice) / l.defaultPrice) * 1000) / 10;
            if (pct > cap) {
              return json({ ok: false, message: `Your discount limit is ${cap}%. This sale needs ${pct}%. Ask the owner.` }, 403);
            }
          }
        }
      }
    }

    // Payments: accept a split list [{mode, amount}], or fall back to the
    // legacy single amountPaid + paymentMethod pair.
    let payments = [];
    if (Array.isArray(body.payments) && body.payments.length) {
      for (const p of body.payments) {
        const amt = Math.round(Number(p.amount || 0) * 100) / 100;
        const mode = String(p.mode || "").trim().slice(0, 40);
        if (amt > 0 && mode) payments.push({ mode, amount: amt });
      }
    } else if (Number(amountPaid || 0) > 0) {
      payments = [{ mode: String(paymentMethod || "cash").slice(0, 40), amount: Math.round(Number(amountPaid) * 100) / 100 }];
    }

    // Overpayment guard: amount paid is capped at the subtotal so balance_due
    // can never go negative. Any excess comes back as change.
    // WORLD-BEST: credit-kind tender (kind 'credit', or a mode named
    // 'credit' before migration 0061) is a promise, not money in: it does
    // NOT count as paid, so that portion becomes balance due. Change is
    // computed from the non-credit tender only, and may only come from the
    // cash portion of it (checked below).
    const modeRows = await loadModeRows(db, auth.business.id);
    const tender = splitTender(payments, modeRows);
    const tendered = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const paid = Math.min(tender.nonCreditTender, subtotal);
    const change = Math.round((tender.nonCreditTender - paid) * 100) / 100;
    const balanceDue = Math.round((subtotal - paid) * 100) / 100;
    // Change may only come from cash received.
    const changeError = checkCashChange(change, tender.cashTendered, auth.business.currency);
    if (changeError) {
      return json({ ok: false, message: changeError }, 400);
    }
    if (balanceDue > 0 && !customerId && !customerName) {
      return json({ ok: false, message: "Unpaid balance needs a customer. Add or select one." }, 400);
    }

    // Resolve the customer for validation only. A brand-new customer is created
    // INSIDE the batch below so a failed sale never leaves orphan rows.
    let custId = customerId ? Number(customerId) : null;
    const trimmedName = customerName ? String(customerName).trim() : "";
    const createCustomer = !custId && trimmedName.length > 0;
    if (custId) {
      const owns = await db.prepare(
        `SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
      )
        .bind(custId, auth.business.id)
        .first();
      if (!owns) return json({ ok: false, message: "Customer not found." }, 400);
    }

    const now = toSqliteDate();
    // Random suffix keeps the number unique even for same-millisecond sales.
    const saleNumber = `KB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Subqueries that resolve the sale (and its customer) created earlier in
    // the SAME batch. Because the batch runs as one transaction, every
    // statement sees the rows inserted by the statements before it, and no
    // statement depends on last_insert_rowid() surviving later inserts.
    const S_SALE = `(SELECT id FROM sales WHERE sale_number = ? AND business_id = ?)`;
    const S_CUST = `(SELECT customer_id FROM sales WHERE sale_number = ? AND business_id = ?)`;

    // Previous ledger balance (read before the batch so the debt entry is correct).
    // A brand-new customer starts at zero.
    let prevLedgerBalance = 0;
    if (balanceDue > 0 && custId) {
      const lastLedger = await db.prepare(
        `SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
      )
        .bind(custId)
        .first();
      prevLedgerBalance = lastLedger ? Number(lastLedger.balance_after) : 0;
    }

    // WORLD-BEST: credit guards (server-side; the sale form may warn
    // earlier, but the server decides). A balance due needs a caller who
    // may sell on credit, and must fit the customer's credit limit:
    // NULL = no limit set (allowed, as today), 0 = no credit at all,
    // above 0 = cap on existing outstanding + this balance.
    if (balanceDue > 0) {
      const perm = await checkCreditPermission(db, auth.business.id, auth.user.id, auth.business.role);
      if (!perm.allowed) {
        return json({ ok: false, message: perm.message }, 403);
      }
      if (custId) {
        const cust = await loadCustomerCredit(db, custId);
        const limitError = checkCreditLimit(cust, prevLedgerBalance, balanceDue, auth.business.currency);
        if (limitError) {
          return json({ ok: false, message: limitError }, 400);
        }
      }
    }

    // Every write for this sale goes in ONE batch: all or nothing. The sale
    // header, a new customer, items, stock movements, payment record and debt
    // entry either all commit together or all roll back.
    const stmts = [];
    if (createCustomer) {
      stmts.push(
        db.prepare(`INSERT INTO customers (business_id, name) VALUES (?, ?)`)
          .bind(auth.business.id, trimmedName)
      );
    }

    // Sale header. For a new customer, last_insert_rowid() is the customer
    // just inserted by the statement above (nothing runs between them).
    stmts.push(
      db.prepare(
        `INSERT INTO sales (business_id, staff_user_id, customer_id, sale_number, subtotal, total_amount, amount_paid, balance_due, payment_method, status, change_given)
         VALUES (?, ?, ${createCustomer ? "last_insert_rowid()" : "?"}, ?, ?, ?, ?, ?, ?, 'completed', ?)`
      ).bind(
        auth.business.id,
        auth.user.id,
        ...(createCustomer ? [] : [custId]),
        saleNumber,
        subtotal,
        subtotal,
        paid,
        balanceDue,
        payments.length > 1 ? "Split" : payments.length === 1 ? payments[0].mode : paymentMethod || "cash",
        change
      )
    );
    const headerIdx = stmts.length - 1;

    for (const line of lines) {
      if (line.kind === "service") {
        // Service lines: no product, no cost snapshot, no stock deduction.
        stmts.push(
          db.prepare(
            `INSERT INTO sale_items (sale_id, item_type, product_id, service_id, quantity, unit_price, cost_snapshot, line_total)
             VALUES (${S_SALE}, 'service', NULL, ?, ?, ?, 0, ?)`
          ).bind(saleNumber, auth.business.id, line.service.id, line.qty, line.unitPrice, line.lineTotal)
        );
        continue;
      }

      stmts.push(
        db.prepare(
          `INSERT INTO sale_items (sale_id, item_type, product_id, quantity, unit_price, cost_snapshot, line_total)
           VALUES (${S_SALE}, 'product', ?, ?, ?, ?, ?)`
        ).bind(saleNumber, auth.business.id, line.product.id, line.qty, line.unitPrice, Number(line.product.cost_price || 0), line.lineTotal)
      );

      stmts.push(
        db.prepare(
          `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand - ?, updated_at = ?
           WHERE product_id = ?`
        ).bind(line.qty, now, line.product.id)
      );

      stmts.push(
        db.prepare(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, source_id, note, created_by)
           VALUES (?, 'sale', ?, 'sale', ${S_SALE}, ?, ?)`
        ).bind(line.product.id, -line.qty, saleNumber, auth.business.id, `Sale ${saleNumber}`, auth.user.id)
      );
    }

    // Payment records: one row per tender (split payments supported).
    // Always at least one row, even if zero paid.
    const payRows = payments.length ? payments : [{ mode: "cash", amount: 0 }];
    for (const pr of payRows) {
      stmts.push(
        db.prepare(
          `INSERT INTO payment_records (business_id, sale_id, customer_id, amount, payment_method, recorded_by)
           VALUES (?, ${S_SALE}, ${S_CUST}, ?, ?, ?)`
        ).bind(auth.business.id, saleNumber, auth.business.id, saleNumber, auth.business.id, pr.amount, pr.mode, auth.user.id)
      );
    }

    // Debt: unpaid balance becomes customer debt via ledger. balanceDue > 0
    // always implies a customer here (validated above).
    if (balanceDue > 0) {
      const newBalance = Math.round((prevLedgerBalance + balanceDue) * 100) / 100;
      stmts.push(
        db.prepare(
          `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
           VALUES (${S_CUST}, 'debt', ?, ?, 'sale', ${S_SALE}, ?)`
        ).bind(saleNumber, auth.business.id, balanceDue, newBalance, saleNumber, auth.business.id, `Sale ${saleNumber}`)
      );
    }

    const batchResults = await db.batch(stmts);
    const saleId = batchResults[headerIdx].meta.last_row_id;

    await audit(context, auth, "sale.create", "sale", saleId, { saleNumber, total: subtotal });
    // WORLD-BEST (merge, History stream §6a): one plain line per sale.
    // Amount is the sale total (never cost). A partly-paid sale writes
    // three rows (sale + payment + debt), which is what the History page
    // and the running balance need. recordHistory never throws.
    const custRow = custId
      ? await db.prepare(`SELECT name FROM customers WHERE id = ? AND business_id = ? LIMIT 1`).bind(custId, auth.business.id).first()
      : null;
    const buyer = custRow?.name || trimmedName || "Walk-in";
    const itemBits = lines.map((l) => `${l.qty} ${(l.product || l.service)?.name || "item"}`).join(", ");
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "sale",
      entityType: "sale",
      entityId: saleId,
      summary: `Sold ${itemBits} to ${buyer} — ${auth.business.currency} ${subtotal.toLocaleString("en-US")}${balanceDue > 0 ? ` (${auth.business.currency} ${balanceDue.toLocaleString("en-US")} unpaid)` : ""}`,
      amount: subtotal,
    });
    if (paid > 0) {
      await recordHistory(context.env, {
        businessId: auth.business.id,
        actorId: auth.user.id,
        actorName: auth.user.fullName,
        actorRole: auth.business.role,
        type: "payment",
        entityType: "sale",
        entityId: saleId,
        summary: `Recorded payment of ${auth.business.currency} ${paid.toLocaleString("en-US")} from ${buyer} (sale ${saleNumber})`,
        amount: paid,
      });
    }
    if (balanceDue > 0) {
      await recordHistory(context.env, {
        businessId: auth.business.id,
        actorId: auth.user.id,
        actorName: auth.user.fullName,
        actorRole: auth.business.role,
        type: "debt",
        entityType: "sale",
        entityId: saleId,
        summary: `Recorded debt of ${auth.business.currency} ${balanceDue.toLocaleString("en-US")} for ${buyer} (sale ${saleNumber})`,
        amount: balanceDue,
      });
    }
    return json({ ok: true, saleId, saleNumber, total: subtotal, paid, change, balanceDue }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record sale: " + String(error && error.message || error), error: String(error) }, 500);
  }
}
