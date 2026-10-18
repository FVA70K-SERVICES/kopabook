// /api/admin/manual/* — platform admin only. Review manual bank-transfer payments.
// GET  /api/admin/manual         -> pending manual_payments with the payer's email
// POST /api/admin/manual/review  {id, decision: 'approved'|'rejected'}
//
// Routing note: Cloudflare Pages file routing cannot serve /manual/review from a
// file named manual.js, so this optional catch-all ([[action]].js) exposes both
// sub-routes from one file. The public endpoint URLs are exactly as specified.
//
// Table: manual_payments (migrations/0043_recurring_billing.sql, owned by the
// billing-overhaul worker). The row id IS the reference number (TEXT).
import { json, getAuthContext, requireAuth, toSqliteDate } from "../../_utils";
import { requirePlatformAdmin } from "../overview";
// The billing worker placed activateSubscription in paystack/verify.js (not
// billing.js) so verify + webhook share one activation path. Namespace import
// keeps this route safe if the export ever moves again; the local fallback
// performs the same activation in that case.
import * as paystackVerify from "../../paystack/verify";

async function activateSubscriptionSafe(db, userId, tier, billingCycle, periodStart, periodEnd) {
  const fn = paystackVerify && paystackVerify.activateSubscription;
  if (typeof fn === "function") {
    // (db, userId, tier, cycle, psData, reference, extra). Manual payments have
    // no Paystack data: psData null, reference null (skips the
    // subscription_payments touch), period dates passed via extra.
    return await fn(db, userId, tier, billingCycle, null, null, {
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });
  }
  await db
    .prepare(
      `INSERT INTO account_subscriptions
         (user_id, tier, status, billing_cycle, current_period_start, current_period_end, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = 'active',
         billing_cycle = excluded.billing_cycle,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`
    )
    .bind(userId, tier, billingCycle, periodStart, periodEnd, toSqliteDate())
    .run();
}

function periodEndDate(cycle, startDate) {
  const end = new Date(startDate.getTime());
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

async function handleList(context) {
  const rows = await context.env.KOPABOOK_DB.prepare(
    `SELECT m.id, m.user_id, u.email AS user_email, m.tier, m.billing_cycle,
            m.amount_kobo, m.reference_number, m.status, m.proof_url, m.created_at
     FROM manual_payments m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.status = 'pending'
     ORDER BY m.created_at DESC`
  ).all();
  return json({ ok: true, payments: rows.results || [] });
}

async function handleReview(context, auth) {
  const db = context.env.KOPABOOK_DB;
  const body = await context.request.json().catch(() => ({}));
  // The row id is the KB-XXXXXX reference number (TEXT).
  const id = String(body.id || "").trim();
  const decision = String(body.decision || "").toLowerCase();
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    return json(
      { ok: false, message: "Send a valid payment id and decision (approved or rejected)." },
      400
    );
  }

  const row = await db
    .prepare(`SELECT id, user_id, tier, billing_cycle, status FROM manual_payments WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return json({ ok: false, message: "Payment not found." }, 404);
  if (row.status !== "pending") {
    return json({ ok: false, message: "This payment has already been reviewed." }, 400);
  }

  const now = new Date();
  const reviewedAt = toSqliteDate(now);

  if (decision === "approved") {
    const periodStart = toSqliteDate(now);
    const end = toSqliteDate(periodEndDate(row.billing_cycle, now));
    await activateSubscriptionSafe(db, row.user_id, row.tier, row.billing_cycle, periodStart, end);
  }

  await db
    .prepare(
      `UPDATE manual_payments
       SET status = ?, reviewed_at = ?, reviewed_by = ?
       WHERE id = ?`
    )
    .bind(decision === "approved" ? "approved" : "rejected", reviewedAt, String(auth.user.id), id)
    .run();

  return json({
    ok: true,
    message:
      decision === "approved"
        ? "Payment approved. The plan is now active on the account."
        : "Payment rejected.",
  });
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;
    if (context.params && context.params.action) {
      return json({ ok: false, message: "Not found." }, 404);
    }
    return await handleList(context);
  } catch (error) {
    return json(
      { ok: false, message: "Could not load manual payments.", error: String(error) },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;
    const action = context.params && context.params.action;
    if (action === "review") return await handleReview(context, auth);
    return json({ ok: false, message: "Not found." }, 404);
  } catch (error) {
    return json(
      { ok: false, message: "Could not review the payment.", error: String(error) },
      500
    );
  }
}
