// WORLD-BEST (Dashboard stream): server-side credit, debt and change guards
// for POST /api/sales. Every guard here runs server-side; the sale form may
// warn earlier, but the server is the authority. All reads are defensive:
// the 0061 columns (business_members.can_sell_on_credit, customers
// .credit_limit) may not exist yet if the migration has not run, so a
// missing column is treated as "not set" instead of failing the sale.
// Nothing here rewrites a past sale, price, or tax rate.

import { isCreditKind, isCashKind, findModeRow, fmtMoney } from "./_money.js";

// Roles allowed to sell on credit by role alone (proposal D7).
export function canSellOnCreditByRole(role) {
  return ["owner", "partner", "manager"].includes(String(role || ""));
}

// Only owner/partner may void a sale (DELETE /api/sales/:id).
export function canVoidSale(role) {
  return ["owner", "partner"].includes(String(role || ""));
}

// Load the business's payment_modes rows. Pre-migration the kind column
// does not exist, so fall back to a name-only read; the name fallback in
// _money.js still classifies a mode named "Credit" as credit-kind.
export async function loadModeRows(db, businessId) {
  try {
    const r = await db.prepare(
      `SELECT id, name, kind FROM payment_modes WHERE business_id = ?`
    ).bind(businessId).all();
    return r.results || [];
  } catch {
    try {
      const r = await db.prepare(
        `SELECT id, name FROM payment_modes WHERE business_id = ?`
      ).bind(businessId).all();
      return r.results || [];
    } catch {
      return [];
    }
  }
}

// Split a tender list into its credit-kind portion and the rest.
// payments: [{ mode, amount }]. modeRows: from loadModeRows.
// Returns { creditTender, nonCreditTender, cashTendered }.
export function splitTender(payments, modeRows) {
  let creditTender = 0;
  let nonCreditTender = 0;
  let cashTendered = 0;
  for (const p of payments || []) {
    const amount = Number(p.amount || 0);
    const row = findModeRow(modeRows, p.mode);
    const kind = row || String(p.mode || "");
    if (isCreditKind(kind)) {
      creditTender += amount;
    } else {
      nonCreditTender += amount;
      if (isCashKind(kind)) cashTendered += amount;
    }
  }
  return {
    creditTender: Math.round(creditTender * 100) / 100,
    nonCreditTender: Math.round(nonCreditTender * 100) / 100,
    cashTendered: Math.round(cashTendered * 100) / 100,
  };
}

// Change may only come from the cash portion of the tender.
// Returns null when the change is fine, or the refusal message otherwise.
export function checkCashChange(change, cashTendered, currency) {
  const c = Math.round(Number(change || 0) * 100) / 100;
  const cash = Math.round(Number(cashTendered || 0) * 100) / 100;
  if (c > 0 && c > cash) {
    return `Change of ${fmtMoney(c, currency)} is more than the cash received. Take more cash or reduce the tender.`;
  }
  return null;
}

// Is this caller allowed to record a sale with a balance due?
// Owner/partner/manager pass by role. Anyone else needs
// business_members.can_sell_on_credit = 1. Pre-migration (column absent)
// the flag read fails and is treated as 0: not allowed.
export async function checkCreditPermission(db, businessId, userId, role) {
  if (canSellOnCreditByRole(role)) return { allowed: true };
  try {
    const row = await db.prepare(
      `SELECT can_sell_on_credit FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    ).bind(businessId, userId).first();
    if (row && Number(row.can_sell_on_credit || 0) === 1) return { allowed: true };
  } catch {
    // Column not present yet (migration 0061 not run): flag is unset.
  }
  return {
    allowed: false,
    message: "Only staff allowed to sell on credit can record a sale with a balance due. Ask the owner.",
  };
}

// Per-customer credit limit. credit_limit semantics (migration 0061):
// NULL = no limit set (current behaviour preserved, balance allowed),
// 0 = no credit at all, above 0 = cap in business currency.
// Returns null when the sale may proceed, or the refusal message.
// customer: { name, credit_limit } (null when the customer is brand new —
// a new customer has no limit set, so the sale proceeds).
// prevOutstanding: the customer's existing outstanding balance.
// newBalance: the balance this sale would add.
export function checkCreditLimit(customer, prevOutstanding, newBalance, currency) {
  if (!customer) return null;
  const limit = customer.credit_limit;
  if (limit === null || limit === undefined) return null;
  const lim = Number(limit);
  const owed = Math.round((Number(prevOutstanding || 0) + Number(newBalance || 0)) * 100) / 100;
  const name = customer.name || "This customer";
  if (lim === 0) {
    return `${name}'s credit limit is ${fmtMoney(0, currency)}. This sale would owe ${fmtMoney(owed, currency)}.`;
  }
  if (owed > lim) {
    return `${name}'s credit limit is ${fmtMoney(lim, currency)}. This sale would owe ${fmtMoney(owed, currency)}.`;
  }
  return null;
}

// Read one customer's name + credit limit for the guard above.
// Returns null for a brand-new customer (no row yet) or when the column
// does not exist yet (pre-migration: no limit set, current behaviour).
export async function loadCustomerCredit(db, customerId) {
  if (!customerId) return null;
  try {
    const row = await db.prepare(
      `SELECT id, name, credit_limit FROM customers WHERE id = ? LIMIT 1`
    ).bind(customerId).first();
    return row || null;
  } catch {
    try {
      const row = await db.prepare(
        `SELECT id, name FROM customers WHERE id = ? LIMIT 1`
      ).bind(customerId).first();
      return row ? { ...row, credit_limit: null } : null;
    } catch {
      return null;
    }
  }
}
