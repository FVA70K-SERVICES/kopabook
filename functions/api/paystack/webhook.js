// POST /api/paystack/webhook — Paystack event webhook.
// Hardened: constant-time signature verification, strict tier allowlist,
// amount + reference + user matching, idempotency protection.
// Also extends subscription periods on renewal rebills (charge.success and
// invoice.update arrive without our original metadata).
// Configure this URL in the Paystack dashboard: https://kopabook.com/api/paystack/webhook
import { activateSubscription } from "./verify";
import { verifyPaystackSignature, VALID_TIERS, VALID_CYCLES } from "../_webhook_security";

// Normalize a Paystack date (ISO string or unix timestamp) to
// "YYYY-MM-DD HH:MM:SS" for SQLite text comparison. Null when unusable.
function toSqliteDateTime(v) {
  if (v === null || v === undefined || v === "") return null;
  try {
    let d;
    if (typeof v === "number" && Number.isFinite(v)) {
      d = new Date(v < 1e12 ? v * 1000 : v); // unix seconds vs milliseconds
    } else {
      d = new Date(v);
    }
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return null;
  }
}

// Persist the new paystack_subscription_code column. It arrives with the
// billing migration, so this is best-effort and never throws: a missing
// column must not break webhook processing.
async function saveSubscriptionCode(db, userId, subCode) {
  if (!userId || !subCode) return;
  try {
    await db.prepare(
      `UPDATE account_subscriptions SET paystack_subscription_code = ? WHERE user_id = ?`
    ).bind(String(subCode), userId).run();
  } catch {
    // column pending migration
  }
}

// Resolve the account_subscriptions.user_id for a Paystack customer: stored
// customer code first, then the users table by email as a fallback.
async function findUserIdByCustomer(db, customerCode, email) {
  try {
    if (customerCode) {
      const r = await db.prepare(
        `SELECT user_id FROM account_subscriptions WHERE paystack_customer_code = ? LIMIT 1`
      ).bind(String(customerCode)).first();
      if (r && r.user_id) return r.user_id;
    }
    if (email) {
      const r = await db.prepare(
        `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`
      ).bind(String(email).toLowerCase()).first();
      if (r && r.id) return r.id;
    }
  } catch {
    // fall through to null
  }
  return null;
}

// subscription.create — a recurring subscription is now live on Paystack.
// Upsert the account with the subscription code, status active, and the
// period dates from the event. The tier/cycle come from the plan code via
// the DB price book; when that cannot be resolved (column pending migration)
// the charge.success handler has already activated the tier, so we only
// attach the subscription code.
async function handleSubscriptionCreate(db, data) {
  const subCode = data.subscription_code ? String(data.subscription_code) : "";
  if (!subCode) return;
  const customer = data.customer || {};
  const userId = await findUserIdByCustomer(db, customer.customer_code, customer.email);
  if (!userId) return;

  let tier = null;
  let cycle = null;
  const planCode = data.plan && data.plan.plan_code ? String(data.plan.plan_code) : "";
  if (planCode) {
    try {
      const pr = await db.prepare(
        `SELECT tier, billing_cycle FROM subscription_plans WHERE paystack_plan_code = ? AND active = 1 LIMIT 1`
      ).bind(planCode).first();
      if (pr) {
        tier = pr.tier;
        cycle = pr.billing_cycle;
      }
    } catch {
      // column pending migration
    }
  }

  if (!tier) {
    await saveSubscriptionCode(db, userId, subCode);
    return;
  }

  const periodStart = toSqliteDateTime(data.start) || toSqliteDateTime(data.createdAt);
  const periodEnd = toSqliteDateTime(data.next_payment_date);
  const nowS = toSqliteDateTime(new Date());

  await db.prepare(
    `INSERT INTO account_subscriptions (user_id, tier, status, billing_cycle, paystack_customer_code, updated_at, current_period_start, current_period_end)
     VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, status = 'active',
       billing_cycle = excluded.billing_cycle,
       paystack_customer_code = COALESCE(excluded.paystack_customer_code, paystack_customer_code),
       updated_at = excluded.updated_at,
       current_period_start = COALESCE(excluded.current_period_start, current_period_start),
       current_period_end = COALESCE(excluded.current_period_end, current_period_end)`
  ).bind(
    userId,
    tier,
    cycle,
    customer.customer_code ? String(customer.customer_code) : null,
    nowS,
    periodStart,
    periodEnd
  ).run();

  await saveSubscriptionCode(db, userId, subCode);
}

// subscription.disable — the subscription was cancelled on Paystack.
// Drop the account to free. Matched by subscription code so an old
// subscription being disabled can never clobber a newer active one.
async function handleSubscriptionDisable(db, data) {
  const subCode = data.subscription_code ? String(data.subscription_code) : "";
  if (!subCode) return;
  const nowS = toSqliteDateTime(new Date());
  try {
    await db.prepare(
      `UPDATE account_subscriptions SET tier = 'free', status = 'cancelled', updated_at = ?
       WHERE paystack_subscription_code = ? AND tier != 'free'`
    ).bind(nowS, subCode).run();
  } catch {
    // column pending migration; without subscription codes there is nothing
    // meaningful to disable yet (recurring plans are new)
  }
}

// invoice.payment_failed — a renewal charge failed. Mark the subscription
// past due; getAccountTier treats past_due as free until payment recovers.
async function handleInvoicePaymentFailed(db, data) {
  const sub = data.subscription || {};
  const subCode = sub.subscription_code || data.subscription_code
    ? String(sub.subscription_code || data.subscription_code)
    : "";
  if (!subCode) return;
  const nowS = toSqliteDateTime(new Date());
  try {
    await db.prepare(
      `UPDATE account_subscriptions SET status = 'past_due', updated_at = ?
       WHERE paystack_subscription_code = ? AND status = 'active'`
    ).bind(nowS, subCode).run();
  } catch {
    // column pending migration
  }
}

// Renewal rebill handling. Paystack subscription auto-charges arrive as
// charge.success / invoice.update WITHOUT our original metadata, so the
// metadata-based handler ignores them. Without an extension here,
// current_period_end would never move and the expiry enforcement in
// getAccountTier() would drop a paying subscriber to free after the first
// period. This branch NEVER changes tier or billing_cycle: it only extends
// current_period_end and refreshes status. Events that match no subscription
// row are silently ignored.
async function extendSubscriptionPeriod(db, subCode, customerCode) {
  let row = null;
  try {
    if (subCode) {
      row = await db.prepare(
        `SELECT user_id, billing_cycle, current_period_end, status FROM account_subscriptions
         WHERE paystack_subscription_code = ? LIMIT 1`
      ).bind(subCode).first();
    }
    if (!row && customerCode) {
      row = await db.prepare(
        `SELECT user_id, billing_cycle, current_period_end, status FROM account_subscriptions
         WHERE paystack_customer_code = ? LIMIT 1`
      ).bind(customerCode).first();
    }
  } catch {
    // subscription code columns pending migration
    return;
  }
  if (!row || row.status !== "active") return;

  const nowS = toSqliteDateTime(new Date());
  // Extend from the later of now or the current period end, so a late or
  // duplicate webhook can never push the period backwards.
  const base = row.current_period_end && row.current_period_end > nowS
    ? row.current_period_end
    : nowS;
  const modifier = String(row.billing_cycle || "monthly").toLowerCase() === "yearly"
    ? "+1 year"
    : "+1 month";
  try {
    await db.prepare(
      `UPDATE account_subscriptions
       SET current_period_end = datetime(?, ?), status = 'active', updated_at = ?
       WHERE user_id = ?`
    ).bind(base, modifier, nowS, row.user_id).run();
  } catch {
    // webhook processing must never throw
  }
}

export async function onRequestPost(context) {
  try {
    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) return new Response("not configured", { status: 503 });

    const rawBody = await context.request.text();
    const signature = context.request.headers.get("x-paystack-signature") || "";

    // Timing-attack-resistant signature verification
    const valid = await verifyPaystackSignature(rawBody, signature, secret);
    if (!valid) return new Response("invalid signature", { status: 401 });

    const event = JSON.parse(rawBody);
    const db = context.env.KOPABOOK_DB;

    if (event.event === "charge.success") {
      const data = event.data || {};
      const meta = data.metadata || {};
      const userId = Number(meta.user_id);
      const tier = String(meta.tier || "").toLowerCase();
      const cycle = String(meta.billing_cycle || "monthly").toLowerCase();

      if (userId && VALID_TIERS.includes(tier) && VALID_CYCLES.includes(cycle)) {
        // Original checkout charge: strict allowlist validation passed.
        // Match the exact payment by Paystack reference (idempotency)
        const reference = String(data.reference || "");
        if (reference) {
          const payment = await db.prepare(
            `SELECT * FROM subscription_payments
             WHERE paystack_reference = ? AND status != 'paid' LIMIT 1`
          ).bind(reference).first();

          // Triple-check: user matches, amount matches exactly, currency matches
          if (payment &&
              Number(payment.user_id) === userId &&
              Number(data.amount) === Number(payment.amount_kobo) &&
              String(data.currency || "NGN").toUpperCase() === String(payment.currency || "NGN").toUpperCase()) {
            // If this charge created a Paystack subscription (plan charge), carry
            // its code into activation so it is stored on the account.
            const chSub = data.subscription || null;
            const extra = {};
            if (chSub && (chSub.subscription_code || chSub.code)) {
              extra.paystack_subscription_code = String(chSub.subscription_code || chSub.code);
            }
            // activateSubscription atomically upserts the subscription and marks
            // exactly this reference paid (replay-safe).
            await activateSubscription(db, userId, tier, cycle, data, reference, extra);
          }
        }
      } else {
        // Renewal rebill from an active Paystack subscription. These arrive
        // WITHOUT our original metadata, so the handler above ignores them.
        // Extend the subscription period so expiry enforcement does not drop
        // a paying subscriber to free. Tier and cycle are never changed here.
        const sub = data.subscription || {};
        const subCode = data.subscription_code || sub.subscription_code || sub.code || "";
        const customer = data.customer || {};
        if (String(data.status || "").toLowerCase() === "success" &&
            (subCode || customer.customer_code)) {
          await extendSubscriptionPeriod(
            db,
            subCode ? String(subCode) : "",
            customer.customer_code ? String(customer.customer_code) : ""
          );
        }
      }
    } else if (event.event === "subscription.create") {
      await handleSubscriptionCreate(db, event.data || {});
    } else if (event.event === "subscription.disable") {
      await handleSubscriptionDisable(db, event.data || {});
    } else if (event.event === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(db, event.data || {});
    } else if (event.event === "invoice.update") {
      const data = event.data || {};
      // Paystack sends invoice.update for subscription invoices. A successful
      // invoice means the renewal was paid: extend the subscription period.
      // All other invoice statuses are acknowledged and ignored.
      if (String(data.status || "").toLowerCase() === "success") {
        const sub = data.subscription || {};
        const subCode = sub.subscription_code || data.subscription_code || "";
        const customer = data.customer || {};
        if (subCode || customer.customer_code) {
          await extendSubscriptionPeriod(
            db,
            subCode ? String(subCode) : "",
            customer.customer_code ? String(customer.customer_code) : ""
          );
        }
      }
    }
    // Unknown events are acknowledged and ignored.

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response("error", { status: 500 });
  }
}
