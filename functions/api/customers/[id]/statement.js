// GET /api/customers/[id]/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
// Customer statement for a period: opening balance, sales, payments,
// closing balance, and every ledger entry in the period.
//
// A statement is a record of what happened, never a demand: the wording
// stays plain ("Opening balance", "Sales", "Payments", "Balance").
// Business-scoped: the customer must belong to the caller's business.
// Any signed-in member of the business may view a statement, exactly like
// the customer list and profile. Nothing here writes, so no permission
// flag is needed beyond being signed in to the business.
// Dates default to the current month. Balances come from customer_ledger
// (balance_after), the same source as the customer profile and debts list.
// No past sale, price, or tax rate is rewritten: this endpoint only reads.
import { json, getAuthContext, requireAuth } from "../../_utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v) {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function customerIdFrom(context) {
  // Cloudflare Pages Functions dynamic segment.
  const param = context.params && context.params.id;
  if (param) return Number(param);
  // Fallback: parse /api/customers/<id>/statement from the URL.
  const m = String(context.request.url).match(/\/customers\/(\d+)\/statement/);
  return m ? Number(m[1]) : NaN;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = customerIdFrom(context);
    if (!id) return json({ ok: false, message: "Customer id is required." }, 400);

    const url = new URL(context.request.url);
    const today = new Date().toISOString().slice(0, 10);
    const from = url.searchParams.get("from") || today.slice(0, 8) + "01";
    const to = url.searchParams.get("to") || today;
    if (!isRealDate(from) || !isRealDate(to)) {
      return json({ ok: false, message: "Dates must be YYYY-MM-DD." }, 400);
    }
    if (from > to) {
      return json({ ok: false, message: "The start date must be before the end date." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const customer = await db.prepare(
      `SELECT id, name FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    // Opening balance: the latest ledger balance before the period starts.
    const openingRow = await db.prepare(
      `SELECT balance_after FROM customer_ledger
       WHERE customer_id = ? AND date(created_at) < ?
       ORDER BY id DESC LIMIT 1`
    ).bind(id, from).first();
    const opening = round2(openingRow ? openingRow.balance_after : 0);

    const period = await db.prepare(
      `SELECT id, entry_type, amount_delta, balance_after, note, created_at
       FROM customer_ledger
       WHERE customer_id = ? AND date(created_at) BETWEEN ? AND ?
       ORDER BY id ASC`
    ).bind(id, from, to).all();
    const entries = period.results || [];

    // Ledger sign rule (same as the customer profile): a sale or debt adds
    // to what the customer owes (positive amount_delta); a payment reduces
    // it (negative amount_delta); a write-off reduces it too.
    let sales = 0;
    let payments = 0;
    let adjustments = 0;
    for (const e of entries) {
      const d = Number(e.amount_delta) || 0;
      if (e.entry_type === "sale" || e.entry_type === "debt") sales += d;
      else if (e.entry_type === "payment") payments += -d;
      else if (e.entry_type === "writeoff") adjustments += -d;
    }
    sales = round2(sales);
    payments = round2(payments);
    adjustments = round2(adjustments);

    // Closing balance is the ledger's own latest balance in the period,
    // so the statement always agrees with the customer profile. With only
    // known entry types it equals opening + sales - payments - adjustments.
    const closing = entries.length
      ? round2(entries[entries.length - 1].balance_after)
      : opening;

    return json({
      ok: true,
      customer: { id: customer.id, name: customer.name },
      from,
      to,
      opening_balance: opening,
      sales,
      payments,
      adjustments,
      closing_balance: closing,
      entries: entries.map((e) => ({
        id: e.id,
        date: String(e.created_at || "").slice(0, 10),
        type: e.entry_type,
        amount: round2(e.amount_delta),
        balance: round2(e.balance_after),
        note: e.note || "",
      })),
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load statement.", error: String(error) }, 500);
  }
}
