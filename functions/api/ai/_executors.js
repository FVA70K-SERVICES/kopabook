// Kopa AI — Tool executors: the writes Kopa AI can perform.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Split verbatim from chat.js; the dead "column not migrated yet"
// fallbacks were then removed (Phase 7.3: the columns are relied on
// directly — live D1 has them).
import { checkCreditPermission, checkCreditLimit, loadCustomerCredit } from "../_creditRules.js";
import { requirePerm, audit, toSqliteDate } from "../_utils";
import { getBusinessOwnerTier, LIMITS } from "../billing";
import { qtyLeftText } from "./_fastpath.js";
import { debtorDraftMatches, fmt, pricePhrase } from "./_gating.js";
import { formatBusinessTime, matchCustomer, matchProduct, parseRemindAt, productNotFoundLine } from "./_matchers.js";
import { generateText } from "./_providers.js";

export async function execRecordSale(context, db, auth, params, currency, opts) {
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) return { ok: false, clarification: "What exactly should I record? Tell me the product and quantity, e.g. '2 Rice'." };

  const lines = [];
  for (const it of items) {
    const qty = Number(it.qty || it.quantity || 1);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, clarification: `How many "${it.product}"? I need a valid quantity.` };
    const matches = await matchProduct(db, auth.business.id, it.product || "");
    if (!matches.length) return { ok: false, clarification: await productNotFoundLine(db, auth.business.id, it.product || "") };
    if (matches.length > 1) return { ok: false, clarification: `"${it.product}" matches more than one product: ${matches.map((p) => p.name).join(", ")}. Which one do you mean?` };
    const p = matches[0];
    if (p.stock < qty) return { ok: false, clarification: `Not enough stock for ${p.name}. You have ${qtyLeftText(p.stock, p.unit)}.` };
    const lineTotal = Math.round(p.price * qty * 100) / 100;
    lines.push({ product: p, qty, unitPrice: p.price, lineTotal });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const paymentMethod = String(params.payment_method || params.paymentMethod || "cash").slice(0, 40);
  const amountPaid = params.amount_paid !== undefined && params.amount_paid !== null ? Number(params.amount_paid) : subtotal;
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return { ok: false, clarification: "How much did the customer pay? I need a valid amount." };
  const paid = Math.min(amountPaid, subtotal);
  const change = Math.round((amountPaid - paid) * 100) / 100;
  const balanceDue = Math.round((subtotal - paid) * 100) / 100;

  const customerName = params.customer_name || params.customerName ? String(params.customer_name || params.customerName).trim() : "";
  let custId = null;
  let createCustomer = false;
  if (customerName) {
    const cm = await matchCustomer(db, auth.business.id, customerName);
    if (cm.length > 1) return { ok: false, clarification: `"${customerName}" matches more than one customer: ${cm.map((c) => c.name).join(", ")}. Which one?` };
    if (cm.length === 1) custId = cm[0].id;
    else createCustomer = true;
  }
  if (balanceDue > 0 && !custId && !createCustomer) {
    return { ok: false, clarification: `There is an unpaid balance of ${fmt(balanceDue, currency)}. Whose account should I put it on?` };
  }

  const now = toSqliteDate();
  const saleNumber = `KB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const S_SALE = `(SELECT id FROM sales WHERE sale_number = ? AND business_id = ?)`;
  const S_CUST = `(SELECT customer_id FROM sales WHERE sale_number = ? AND business_id = ?)`;

  let prevLedgerBalance = 0;
  if (balanceDue > 0 && custId) {
    const last = await db.prepare(`SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`).bind(custId).first();
    prevLedgerBalance = last ? Number(last.balance_after) : 0;
  }

  // Phase 4.1: the AI sale path honours the same credit guards as POST
  // /api/sales. A balance due needs credit permission and must fit the
  // customer's credit limit. This runs before the dry-run branch, so a
  // sale that cannot be recorded is refused at draft time, and the same
  // check runs again at execution: the dry-run branch returns below,
  // the execute path continues past it.
  if (balanceDue > 0) {
    const perm = await checkCreditPermission(db, auth.business.id, auth.user.id, auth.business.role);
    if (!perm.allowed) return { ok: false, clarification: perm.message };
    if (custId) {
      const cust = await loadCustomerCredit(db, custId);
      const limitError = checkCreditLimit(cust, prevLedgerBalance, balanceDue, currency);
      if (limitError) return { ok: false, clarification: limitError };
    }
  }

  if (opts && opts.dryRun) {
    // Be sure before proposing: if the user's own words did not name the
    // resolved product in full, and another product shares its first word
    // (Rice 5kg vs Rice 10kg), the model may have guessed between siblings.
    // Ask one targeted question instead of proposing the wrong item.
    if (opts.userMessage) {
      const msgLower = String(opts.userMessage).toLowerCase();
      for (const l of lines) {
        if (msgLower.includes(l.product.name.toLowerCase())) continue;
        const firstToken = l.product.name.trim().split(/\s+/)[0].toLowerCase();
        if (firstToken.length < 3) continue;
        const all = await db.prepare(
          `SELECT name FROM products WHERE business_id = ? AND is_active = 1 LIMIT 100`
        ).bind(auth.business.id).all();
        const siblings = (all.results || [])
          .map((r) => String(r.name))
          .filter((n) => n.toLowerCase() !== l.product.name.toLowerCase()
            && n.trim().split(/\s+/)[0].toLowerCase() === firstToken);
        if (siblings.length) {
          return { ok: false, clarification: `I want to be sure before I record anything: did you mean ${l.product.name} or ${siblings.join(" or ")}?` };
        }
      }
    }
    const proposalLines = lines.map((l) => `${l.qty} × ${l.product.name} at ${fmt(l.unitPrice, currency)} ${pricePhrase(l.product.unit)} = ${fmt(l.lineTotal, currency)}`);
    proposalLines.push(`Total: ${fmt(subtotal, currency)}`);
    proposalLines.push(`Customer: ${customerName || "Walk-in"}`);
    proposalLines.push(`Amount paid: ${fmt(paid, currency)} (${paymentMethod})`);
    if (change > 0) proposalLines.push(`Change to give back: ${fmt(change, currency)}`);
    if (balanceDue > 0) proposalLines.push(`Balance going to debt: ${fmt(balanceDue, currency)}`);
    const itemDesc = lines.map((l) => `${l.qty} ${l.product.name} at ${fmt(l.unitPrice, currency)} ${pricePhrase(l.product.unit)}`).join(", ");
    const custDesc = customerName ? ` for ${customerName}` : "";
    const payDesc = balanceDue > 0
      ? `paid ${fmt(paid, currency)} ${paymentMethod}, balance ${fmt(balanceDue, currency)} to be recorded as debt`
      : `paid ${fmt(paid, currency)} ${paymentMethod}`;
    return {
      ok: true,
      proposal: {
        summary: `Record sale of ${itemDesc}${custDesc}, total ${fmt(subtotal, currency)}, ${payDesc}.`,
        lines: proposalLines,
      },
    };
  }

  // Phase 4.1: reserve stock BEFORE the batch, with one atomic guarded
  // UPDATE per line (sufficient stock, and the product must belong to
  // this business). Two simultaneous AI sales cannot both pass, so stock
  // can never go negative. The batch below no longer decrements; a
  // failed batch gives the reservation back.
  const reserved = [];
  for (const l of lines) {
    const reserve = await db.prepare(
      `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand - ?, updated_at = ? WHERE product_id = ? AND quantity_on_hand >= ? AND EXISTS (SELECT 1 FROM products p WHERE p.id = inventory_items.product_id AND p.business_id = ?)`
    ).bind(l.qty, now, l.product.id, l.qty, auth.business.id).run();
    if ((reserve.meta?.changes ?? 0) !== 1) {
      for (const r of reserved) {
        try { await db.prepare(`UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ? WHERE product_id = ?`).bind(r.qty, r.productId).run(); } catch { /* best-effort */ }
      }
      return { ok: false, clarification: `Not enough stock for ${l.product.name}.` };
    }
    reserved.push({ productId: l.product.id, qty: l.qty });
  }

  const stmts = [];
  if (createCustomer) {
    stmts.push(db.prepare(`INSERT INTO customers (business_id, name) VALUES (?, ?)`).bind(auth.business.id, customerName));
  }
  stmts.push(
    db.prepare(
      `INSERT INTO sales (business_id, staff_user_id, customer_id, sale_number, subtotal, total_amount, amount_paid, balance_due, payment_method, status, change_given)
       VALUES (?, ?, ${createCustomer ? "last_insert_rowid()" : "?"}, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).bind(auth.business.id, auth.user.id, ...(createCustomer ? [] : [custId]), saleNumber, subtotal, subtotal, paid, balanceDue, paymentMethod, change)
  );
  const headerIdx = stmts.length - 1;
  for (const l of lines) {
    stmts.push(
      db.prepare(`INSERT INTO sale_items (sale_id, item_type, product_id, quantity, unit_price, cost_snapshot, line_total)
                  VALUES (${S_SALE}, 'product', ?, ?, ?, 0, ?)`)
        .bind(saleNumber, auth.business.id, l.product.id, l.qty, l.unitPrice, l.lineTotal)
    );
    // Stock was already reserved above (guarded UPDATE); the batch only
    // records the movement, it never touches quantity_on_hand again.
    stmts.push(
      db.prepare(`INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, source_id, note, created_by)
                  VALUES (?, 'sale', ?, 'sale', ${S_SALE}, ?, ?)`)
        .bind(l.product.id, -l.qty, saleNumber, auth.business.id, `Sale ${saleNumber}`, auth.user.id)
    );
  }
  const payRows = paid > 0 ? [{ mode: paymentMethod, amount: paid }] : [{ mode: "cash", amount: 0 }];
  for (const pr of payRows) {
    stmts.push(
      db.prepare(`INSERT INTO payment_records (business_id, sale_id, customer_id, amount, payment_method, recorded_by)
                  VALUES (?, ${S_SALE}, ${S_CUST}, ?, ?, ?)`)
        .bind(auth.business.id, saleNumber, auth.business.id, saleNumber, auth.business.id, pr.amount, pr.mode, auth.user.id)
    );
  }
  if (balanceDue > 0) {
    const newBalance = Math.round((prevLedgerBalance + balanceDue) * 100) / 100;
    stmts.push(
      db.prepare(`INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
                  VALUES (${S_CUST}, 'debt', ?, ?, 'sale', ${S_SALE}, ?)`)
        .bind(saleNumber, auth.business.id, balanceDue, newBalance, saleNumber, auth.business.id, `Sale ${saleNumber}`)
    );
  }
  // A failed batch rolls back, so give the reservation back: the stock
  // was already decremented above and no sale was recorded.
  let batchResults;
  try {
    batchResults = await db.batch(stmts);
  } catch (e) {
    for (const r of reserved) {
      try { await db.prepare(`UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ? WHERE product_id = ?`).bind(r.qty, r.productId).run(); } catch { /* best-effort */ }
    }
    throw e;
  }
  const saleId = batchResults[headerIdx].meta.last_row_id;
  await audit(context, auth, "ai.sale.create", "sale", saleId, { saleNumber, total: subtotal, via: "kopa_ai" });

  const itemDesc = lines.map((l) => `${l.qty} ${l.product.name} at ${fmt(l.unitPrice, currency)} ${pricePhrase(l.product.unit)}`).join(", ");
  const custDesc = customerName ? ` for ${customerName}` : "";
  const payDesc = balanceDue > 0
    ? `paid ${fmt(paid, currency)} ${paymentMethod}, balance ${fmt(balanceDue, currency)} recorded as debt`
    : `paid ${fmt(paid, currency)} ${paymentMethod}`;
  return { ok: true, summary: `Recorded sale of ${itemDesc}${custDesc}, total ${fmt(subtotal, currency)}, ${payDesc}. Ref ${saleNumber}.` };
}

export async function execAddExpense(context, db, auth, params, currency, opts) {
  const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can record expenses.");
  if (permDenied) return { ok: false, clarification: "You don't have permission to record expenses. Ask the business owner to grant it." };
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, clarification: "How much was the expense? I need an amount greater than zero." };
  const description = String(params.description || "").trim();
  if (!description) return { ok: false, clarification: "What was the expense for? Give me a short description." };

  let catId = null;
  const categoryName = params.category ? String(params.category).trim().slice(0, 60) : null;
  if (categoryName) {
    const existing = await db.prepare(`SELECT id FROM expense_categories WHERE business_id = ? AND name = ? LIMIT 1`)
      .bind(auth.business.id, categoryName).first();
    if (existing) catId = existing.id;
    else if (!(opts && opts.dryRun)) {
      const ins = await db.prepare(`INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 0)`)
        .bind(auth.business.id, categoryName).run();
      catId = ins.meta.last_row_id;
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record expense: ${description}, ${fmt(amt, currency)}${categoryName ? ` under ${categoryName}` : ""} on ${date}.`,
        lines: [
          `Description: ${description}`,
          `Amount: ${fmt(amt, currency)}`,
          `Category: ${categoryName || "Uncategorised"}`,
          `Date: ${date}`,
        ],
      },
    };
  }
  const result = await db.prepare(
    `INSERT INTO expenses (business_id, category_id, amount, note, incurred_on, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(auth.business.id, catId, Math.round(amt * 100) / 100, description, date, auth.user.id).run();
  await audit(context, auth, "ai.expense.create", "expense", result.meta.last_row_id, { amount: amt, via: "kopa_ai" });
  return { ok: true, summary: `Recorded expense: ${description}, ${fmt(amt, currency)}${categoryName ? ` under ${categoryName}` : ""}.` };
}

export async function execAddProduct(context, db, auth, params, currency, opts) {
  const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can add products.");
  if (permDenied) return { ok: false, clarification: "You don't have permission to add products. Ask the business owner to grant it." };
  const name = String(params.name || "").trim();
  const price = Number(params.price);
  if (!name) return { ok: false, clarification: "What is the product called?" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, clarification: `What is the selling price of "${name}"? I need a valid number.` };

  const { tier } = await getBusinessOwnerTier(db, auth.business.id);
  const maxProducts = LIMITS[tier] ? LIMITS[tier].products : 100;
  if (maxProducts !== null) {
    const count = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM products WHERE business_id = ? AND is_active = 1)
            + (SELECT COUNT(*) FROM services WHERE business_id = ? AND is_active = 1) AS n`
    ).bind(auth.business.id, auth.business.id).first();
    if (Number(count && count.n) >= maxProducts) {
      return { ok: false, clarification: `Your plan allows ${maxProducts} products and services per business. Upgrade to add more.` };
    }
  }

  const unit = String(params.unit || "piece").trim().slice(0, 30) || "piece";
  // Phase 7.3: opening stock must be a real number, zero or more — the
  // same rule as POST /api/products. A negative or non-numeric stock is
  // refused with a question instead of landing in inventory as a
  // negative quantity (or silently becoming 0). This runs before the
  // dry-run branch so a proposal never offers a bad opening stock.
  let opening = 0;
  if (params.stock !== undefined && params.stock !== null && params.stock !== "") {
    opening = Number(params.stock);
    if (!Number.isFinite(opening) || opening < 0) {
      return { ok: false, clarification: `How many ${name} do you have in stock to start with? I need a number, zero or more.` };
    }
  }
  const countRow = await db.prepare(`SELECT COUNT(*) AS c FROM products WHERE business_id = ?`).bind(auth.business.id).first();
  let n = Number(countRow && countRow.c || 0) + 1;
  let finalSku = null;
  for (;;) {
    const candidate = "KB-" + String(n).padStart(4, "0");
    const clash = await db.prepare(`SELECT id FROM products WHERE business_id = ? AND sku = ? COLLATE NOCASE LIMIT 1`).bind(auth.business.id, candidate).first();
    if (!clash) { finalSku = candidate; break; }
    n++;
  }
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Add product "${name}" at ${fmt(price, currency)} ${pricePhrase(unit)}${opening > 0 ? ` with opening stock of ${opening}` : ""}.`,
        lines: [
          `Name: ${name}`,
          `Price: ${fmt(price, currency)}`,
          `Unit: ${unit}`,
          `Opening stock: ${opening}`,
        ],
      },
    };
  }
  // Phase 7.3: the unit column (migration 0042) is relied on directly;
  // live D1 has it. A UNIQUE-constraint failure here can only be a race
  // against another create that picked the same auto-generated SKU, so
  // retry with the next number (bounded; a persistent failure throws).
  let result;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      result = await db.prepare(
        `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, unit, is_active)
         VALUES (?, ?, ?, ?, 0, 5, ?, 1)`
      ).bind(auth.business.id, name, finalSku, price, unit).run();
      break;
    } catch (e) {
      if (!/UNIQUE constraint failed/i.test(String(e && e.message))) throw e;
      const m = /KB-(\d+)/.exec(finalSku || "");
      finalSku = "KB-" + String((m ? Number(m[1]) : 0) + 1).padStart(4, "0");
    }
  }
  if (!result) throw new Error("Could not save product after retrying the SKU.");
  const productId = result.meta.last_row_id;
  await db.prepare(`INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level) VALUES (?, ?, 5)`)
    .bind(productId, opening).run();
  if (opening > 0) {
    await db.prepare(`INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
                      VALUES (?, 'opening', ?, 'manual', ?, ?)`)
      .bind(productId, opening, `Opening stock for ${name}`, auth.user.id).run();
  }
  await audit(context, auth, "ai.product.create", "product", productId, { name, price, via: "kopa_ai" });
  return { ok: true, summary: `Added product "${name}" at ${fmt(price, currency)} ${pricePhrase(unit)}${opening > 0 ? ` with opening stock of ${opening}` : ""}.` };
}

export async function execRecordCustomerPayment(context, db, auth, params, currency, opts) {
  const name = String(params.customer_name || params.customerName || "").trim();
  const amt = Number(params.amount);
  if (!name) return { ok: false, clarification: "Which customer paid?" };
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, clarification: "How much did they pay? I need an amount greater than zero." };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}". Check the name and try again.` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  if (c.balance <= 0) return { ok: false, clarification: `${c.name} has no outstanding balance, so there is nothing to record.` };
  if (amt > c.balance) {
    return { ok: false, clarification: `${c.name} owes ${fmt(c.balance, currency)}. ${fmt(amt, currency)} is more than the balance. Tell me the correct amount.` };
  }
  const applied = Math.round(amt * 100) / 100;
  const newBalance = Math.round((c.balance - applied) * 100) / 100;
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record payment of ${fmt(applied, currency)} from ${c.name}. Balance will go from ${fmt(c.balance, currency)} to ${fmt(newBalance, currency)}.`,
        lines: [
          `Customer: ${c.name}`,
          `Amount: ${fmt(applied, currency)}`,
          `Balance before: ${fmt(c.balance, currency)}`,
          `Balance after: ${fmt(newBalance, currency)}`,
        ],
      },
    };
  }
  const payResult = await db.prepare(
    `INSERT INTO payment_records (business_id, customer_id, amount, payment_method, recorded_by) VALUES (?, ?, ?, 'cash', ?)`
  ).bind(auth.business.id, c.id, applied, auth.user.id).run();
  await db.prepare(
    `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
     VALUES (?, 'payment', ?, ?, 'payment', ?, 'Payment recorded by Kopa AI')`
  ).bind(c.id, -applied, newBalance, payResult.meta.last_row_id).run();
  await audit(context, auth, "ai.debt.payment", "customer", c.id, { amount: applied, via: "kopa_ai" });
  return { ok: true, summary: `Recorded payment of ${fmt(applied, currency)} from ${c.name}. New balance: ${fmt(newBalance, currency)}.` };
}

export async function execSetReminder(context, db, auth, params, currency, opts) {
  const text = String(params.text || "").trim().slice(0, 200);
  if (!text) return { ok: false, clarification: "What should I remind you about?" };
  const remindAt = parseRemindAt(params.remind_at || params.remindAt, auth.business.timezone);
  // Display only: the stored instant stays UTC (remindAt), the words
  // the owner reads are in the business timezone (round 5). 14:00 UTC
  // is 3:00 pm WAT, and the old "(UTC)" stamp read as 2pm.
  const remindDisplay = formatBusinessTime(remindAt, auth.business.timezone);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Set reminder: "${text}" for ${remindDisplay}.`,
        lines: [
          `Reminder: ${text}`,
          `Remind at: ${remindDisplay}`,
        ],
      },
    };
  }
  const id = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare(
    `INSERT INTO bot_reminders (id, business_id, user_id, title, remind_at, repeat_type, status) VALUES (?, ?, ?, ?, ?, 'once', 'pending')`
  ).bind(id, auth.business.id, String(auth.user.id), text, remindAt).run();
  await audit(context, auth, "ai.reminder.create", "reminder", null, { text, remind_at: remindAt, via: "kopa_ai" });
  return { ok: true, summary: `Reminder set: "${text}" for ${remindDisplay}.` };
}

export async function execGetCustomerBalance(context, db, auth, params, currency) {
  const name = String(params.customer_name || params.customerName || "").trim();
  if (!name) return { ok: false, clarification: "Which customer's balance do you want to check?" };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}".` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  return {
    ok: true,
    summary: c.balance > 0
      ? `${c.name} owes ${fmt(c.balance, currency)}.`
      : `${c.name} has no outstanding balance.`,
  };
}

// Draft a professional debtor reminder. The model writes the draft via a
// second AI call using the customer's REAL balance; the reply is the draft
// for the user to review. Nothing is sent.
export async function execDraftDebtorMessage(env, db, auth, params, currency) {
  const name = String(params.customer_name || params.customerName || "").trim();
  if (!name) return { ok: false, clarification: "Which customer should I write the reminder for?" };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}". Check the name and try again.` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  if (c.balance <= 0) return { ok: false, clarification: `${c.name} has no outstanding balance, so there is no reminder to write.` };
  const tone = ["polite", "firm", "final"].includes(String(params.tone || "").toLowerCase())
    ? String(params.tone).toLowerCase() : "polite";
  const businessName = auth.business.name || "us";
  let draft;
  try {
    draft = await generateText(env, [
        { role: "system", content: `You write short, professional payment reminders for Nigerian small businesses. Tone: ${tone} (${tone === "polite" ? "warm and respectful, first reminder" : tone === "firm" ? "direct but respectful, second reminder" : "serious and final, last warning before further action"}). Rules: address the customer by first name only, state the EXACT amount owed, mention the business name once, sign off with the business name, no emojis, no slang, keep it under 60 words. Plain text only, no quotes around it.` },
        { role: "user", content: `Customer: ${c.name}. Owes: ${fmt(c.balance, currency)}. Business: ${businessName}. Write the ${tone} reminder now.` },
      ], { maxOutputTokens: 400 });
    draft = String(draft).trim();
    if (!draft) throw new Error("empty");
  } catch (e) {
    draft = `Hello ${c.name.split(" ")[0]}, this is ${businessName}. This is a friendly reminder that you have an outstanding balance of ${fmt(c.balance, currency)} with us. Kindly pay at your earliest convenience. Thank you. - ${businessName}`;
  }
  await logAiAction(db, auth, params, "draft_debtor_message", { customer: c.name, balance: c.balance, tone }, { draft });
  return {
    ok: true,
    isDraft: true,
    draft,
    summary: `Drafted a ${tone} payment reminder for ${c.name} (${fmt(c.balance, currency)}).`,
  };
}

// Send a debtor reminder ONLY after the user approved the exact draft.
// Delivery is a wa.me link the user taps; Kopa never auto-sends WhatsApp.
export async function execSendDebtorMessage(db, auth, params, currency, history, opts) {
  const name = String(params.customer_name || params.customerName || "").trim();
  const message = String(params.message || "").trim();
  if (!name || !message) return { ok: false, clarification: "Tell me which customer and the exact message to send." };
  // Enforcement: the previous assistant message must contain the exact draft.
  // On execution (Confirm tap), this check is skipped on purpose: the
  // proposal itself is the approval, and it was created only after the
  // dry-run below validated the draft. Re-checking chat history at
  // execution time would fail for a tap that carries no chat history.
  const lastAssistant = [...(history || [])].reverse().find((h) => h.role === "assistant");
  const approved = (opts && opts.skipDraftCheck) || debtorDraftMatches(lastAssistant && lastAssistant.content, message);
  if (!approved) {
    return { ok: false, clarification: `I need you to see and approve the message before I send anything. Tell me which customer you want reminded and I will draft it first.` };
  }
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}".` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer. Which one?` };
  const c = matches[0];
  if (opts && opts.dryRun) {
    // Proposal only: no action log, no link handed out yet. The link is
    // built again at execution time, after the Confirm tap.
    return {
      ok: true,
      proposal: {
        summary: `Send a WhatsApp reminder to ${c.name} (${fmt(c.balance, currency)}).`,
        lines: [`Send to ${c.name} on WhatsApp:`, message],
      },
    };
  }
  // Fetch phone for the wa.me link.
  const row = await db.prepare(`SELECT phone FROM customers WHERE id = ? AND business_id = ?`).bind(c.id, auth.business.id).first().catch(() => null);
  const digits = String((row && row.phone) || "").replace(/\D/g, "");
  let link = null;
  if (digits) {
    const intl = digits.startsWith("234") ? digits : digits.startsWith("0") ? "234" + digits.slice(1) : digits;
    link = `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
  }
  await logAiAction(db, auth, params, "send_debtor_message", { customer: c.name, balance: c.balance }, { waLink: link, hasPhone: !!digits });
  if (!link) {
    return { ok: true, summary: `Message approved for ${c.name}, but I don't have a phone number saved for them, so I can't open WhatsApp. Here is the message to copy:\n\n${message}` };
  }
  return { ok: true, waLink: link, summary: `Ready to send to ${c.name} on WhatsApp.` };
}

// Long-term memory: the model can remember facts about this business across
// chats. Empty value deletes the key. Needs migration 0050 (ai_memory table).
export async function execSaveMemory(context, db, auth, params, currency, opts) {
  const key = String((params && (params.key || params.label)) || "").trim().slice(0, 80);
  const value = String((params && (params.value || params.fact)) || "").trim().slice(0, 1000);
  if (!key) return { ok: false, clarification: "What should I remember? Give me a short label and the fact." };
  if (opts && opts.dryRun) {
    const line = value ? `Remember ${key}: ${value}` : `Forget ${key}`;
    return {
      ok: true,
      proposal: {
        summary: line,
        lines: [line],
      },
    };
  }
  try {
    if (!value) {
      await db.prepare(`DELETE FROM ai_memory WHERE business_id = ? AND memory_key = ?`).bind(auth.business.id, key).run();
      await logAiAction(db, auth, params, "save_memory", { key, deleted: true }, {});
      return { ok: true, summary: `Forgot "${key}". I will not remember that anymore.` };
    }
    await db.prepare(
      `INSERT INTO ai_memory (business_id, memory_key, memory_value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(business_id, memory_key) DO UPDATE SET memory_value = excluded.memory_value, updated_at = datetime('now')`
    ).bind(auth.business.id, key, value).run();
  } catch (e) {
    return { ok: false, clarification: "I could not save that memory yet. The memory store needs a quick update first." };
  }
  await logAiAction(db, auth, params, "save_memory", { key }, { value });
  return { ok: true, summary: `Remembered "${key}". I will keep it in mind from now on.` };
}

export async function execMarkReminderDone(context, db, auth, params, currency, opts) {
  const reminderId = String((params && (params.reminder_id || params.reminderId || params.id)) || "").trim();
  const title = String((params && params.title) || "").trim();
  if (!reminderId) return { ok: false, clarification: "Which reminder should I mark as done? Give me its exact title." };
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Mark reminder "${title || reminderId}" as done.`,
        lines: [`Mark reminder "${title || reminderId}" as done.`],
      },
    };
  }
  try {
    const res = await db.prepare(`UPDATE bot_reminders SET status = 'done' WHERE id = ? AND business_id = ?`).bind(reminderId, businessIdOf(auth)).run();
    // D1 run() does not reliably report changed rows, so re-read to prove it.
    const row = await db.prepare(`SELECT status FROM bot_reminders WHERE id = ? AND business_id = ?`).bind(reminderId, businessIdOf(auth)).first();
    if (!row || row.status !== "done") return { ok: false, clarification: "I could not find that reminder in this business." };
  } catch (e) {
    return { ok: false, clarification: "I could not update that reminder just now. Please try again." };
  }
  return { ok: true, summary: `Marked the reminder "${title || reminderId}" as done.` };
}
function businessIdOf(auth) { return auth && auth.business ? auth.business.id : null; }

async function logAiAction(db, auth, params, tool, p, result) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(
      `INSERT INTO ai_action_log (business_id, user_id, day, tool, params, result) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(auth.business.id, auth.user.id, day, tool, JSON.stringify(p || params || {}), JSON.stringify(result || {})).run();
  } catch (e) { /* logging must never break the action */ }
}

// ---------------------------------------------------------------------------
// Project powers. These executors are adapters around the existing Projects
// endpoints: every read and write goes through those handlers, with the
// caller's original session request, so project access, tier checks and
// audit behaviour stay in exactly one place.
// ---------------------------------------------------------------------------
