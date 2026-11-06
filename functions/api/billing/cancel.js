// POST /api/billing/cancel: cancel the owner's own Paystack subscription.
// Self-serve cancel for the promise in Terms 9.1 ("The User may cancel a
// subscription at any time"). Only the owner of the active business can
// cancel, and only the subscription that belongs to their own account.
//
// Paystack shape, verified against the Paystack Subscription API docs
// (https://paystack.com/docs/api/subscription/): disabling a subscription
// needs the subscription code plus its email token, POST
// /subscription/disable with { code, token }. The repo never stored the
// email token, so this endpoint fetches the subscription first
// (GET /subscription/{code}) to read the live status and email_token,
// then disables it. The fetch also catches subscriptions already
// disabled on Paystack, so a second cancel never charges or errors oddly.
//
// Local update: status becomes 'cancelled', tier and current_period_end
// are kept, so the plan stays active until the end of the paid period
// (Terms 9.1, Refund 5.1) and getAccountTier drops it to free only when
// the period ends. History is kept: nothing is deleted, and the
// subscription_payments rows are never touched.
//
// Manual bank-transfer and crypto payments are one-off, so they have no
// Paystack subscription code and nothing to cancel: the button is hidden
// for them and this endpoint answers that there is nothing to cancel.
import { json, getAuthContext, requireAuth, toSqliteDate, audit } from "../_utils";
import { checkRateLimit } from "../_webhook_security";

const PAYSTACK_API = "https://api.paystack.co";

function periodDate(row) {
  const end = row && row.current_period_end ? String(row.current_period_end).slice(0, 10) : "";
  return end || "";
}

function cancelledMessage(row) {
  const end = periodDate(row);
  return end
    ? `Your subscription is already cancelled. Your plan stays active until ${end}, and you will not be charged again.`
    : "Your subscription is already cancelled. You will not be charged again.";
}

// Load the account subscription row. The Paystack code columns arrive
// with migration 0027; on a database that has not run it yet the first
// query throws, so fall back to the plain row and treat the codes as
// missing (no Paystack subscription to cancel, no crash).
async function loadSubscription(db, userId) {
  try {
    const row = await db.prepare(
      `SELECT tier, status, billing_cycle, current_period_end,
              paystack_subscription_code, paystack_customer_code
       FROM account_subscriptions WHERE user_id = ? LIMIT 1`
    ).bind(userId).first();
    return row || null;
  } catch {
    try {
      const row = await db.prepare(
        `SELECT tier, status, billing_cycle, current_period_end
         FROM account_subscriptions WHERE user_id = ? LIMIT 1`
      ).bind(userId).first();
      return row ? { ...row, paystack_subscription_code: null, paystack_customer_code: null } : null;
    } catch {
      return null;
    }
  }
}

async function paystackFetch(secret, path, options) {
  const res = await fetch(PAYSTACK_API + path, {
    ...(options || {}),
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(options && options.headers ? options.headers : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// No stored subscription code (older account, or the code column never
// landed): ask Paystack for the customer's subscriptions and take the
// active one. Returns the subscription object, the string "already" when
// the customer only has a non-renewing one, or null when there is none.
async function findActiveByCustomer(secret, customerCode) {
  try {
    const { ok, data } = await paystackFetch(
      secret, `/subscription?customer=${encodeURIComponent(customerCode)}&per_page=50`
    );
    if (!ok || !data || data.status !== true || !Array.isArray(data.data)) return null;
    const active = data.data.find((s) => String(s && s.status || "").toLowerCase() === "active");
    if (active) return active;
    const ended = data.data.find((s) =>
      ["non-renewing", "cancelled", "complete"].includes(String(s && s.status || "").toLowerCase()));
    if (ended) return "already";
    return null;
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    // Owner only, and only for the business this account owns. A staff
    // member, manager or partner cannot cancel, and an owner of one
    // business cannot cancel the subscription that pays for another
    // business. This matches the close-business gate
    // (functions/api/businesses/close.js), which is also owner only.
    if (!auth.business || auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the business owner can cancel the subscription." }, 403);
    }
    const db = context.env.KOPABOOK_DB;
    let businessRow = null;
    try {
      businessRow = await db.prepare(
        `SELECT owner_user_id FROM businesses WHERE id = ? LIMIT 1`
      ).bind(auth.business.id).first();
    } catch {
      businessRow = null;
    }
    if (!businessRow || Number(businessRow.owner_user_id) !== Number(auth.user.id)) {
      return json({ ok: false, message: "Only the business owner can cancel the subscription." }, 403);
    }

    // Rate limit: max 5 cancel attempts per user per hour.
    if (!(await checkRateLimit(db, `cancel_${auth.user.id}`, 5, 3600000))) {
      return json({ ok: false, message: "Too many cancel attempts. Please try again later." }, 429);
    }

    const sub = await loadSubscription(db, auth.user.id);
    if (!sub || String(sub.tier || "free").toLowerCase() === "free") {
      return json({ ok: false, message: "You are on the Free plan. There is nothing to cancel." }, 409);
    }
    if (String(sub.status || "").toLowerCase() === "cancelled") {
      return json({ ok: false, already_cancelled: true, message: cancelledMessage(sub) }, 409);
    }
    if (String(sub.status || "").toLowerCase() !== "active") {
      return json({ ok: false, message: "Your subscription is not active, so there is nothing to cancel. If you were charged, contact support at info@kopabook.com." }, 409);
    }

    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return json({ ok: false, message: "Payments are not connected yet. Please try again later." }, 503);
    }

    // Resolve the Paystack subscription code and its live state.
    let code = sub.paystack_subscription_code ? String(sub.paystack_subscription_code) : "";
    let live = null;
    if (!code && sub.paystack_customer_code) {
      const found = await findActiveByCustomer(secret, String(sub.paystack_customer_code));
      if (found === "already") {
        await markCancelled(db, auth.user.id);
        return json({ ok: false, already_cancelled: true, message: cancelledMessage(sub) }, 409);
      }
      if (found && found.subscription_code) {
        code = String(found.subscription_code);
        live = found;
      }
    }
    if (!code) {
      return json({ ok: false, message: "We could not find a Paystack subscription to cancel. Your plan is still active. Please contact support at info@kopabook.com and we will cancel it for you." }, 409);
    }

    // Read the live subscription: its status and the email token that
    // the disable call requires. A failed read never changes local state.
    if (!live) {
      try {
        const fetched = await paystackFetch(secret, `/subscription/${encodeURIComponent(code)}`);
        if (!fetched.ok || !fetched.data || fetched.data.status !== true || !fetched.data.data) {
          return json({ ok: false, message: "Paystack did not answer. Your plan is still active. Please try again." }, 502);
        }
        live = fetched.data.data;
      } catch {
        return json({ ok: false, message: "Paystack did not answer. Your plan is still active. Please try again." }, 502);
      }
    }
    const liveStatus = String((live && live.status) || "").toLowerCase();
    if (liveStatus && liveStatus !== "active") {
      await markCancelled(db, auth.user.id);
      return json({ ok: false, already_cancelled: true, message: cancelledMessage(sub) }, 409);
    }
    const token = live && live.email_token ? String(live.email_token) : "";
    if (!token) {
      return json({ ok: false, message: "Paystack did not answer. Your plan is still active. Please try again." }, 502);
    }

    // Disable on Paystack. Only a success here changes the local row.
    let disabled;
    try {
      disabled = await paystackFetch(secret, "/subscription/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, token }),
      });
    } catch {
      return json({ ok: false, message: "Paystack did not answer. Your plan is still active. Please try again." }, 502);
    }
    if (!disabled.ok || !disabled.data || disabled.data.status !== true) {
      return json({ ok: false, message: "Paystack could not cancel the subscription. Your plan is still active. Please try again." }, 502);
    }

    await markCancelled(db, auth.user.id);
    try {
      await audit(context, auth, "billing.cancel", "subscription", auth.user.id, {
        tier: sub.tier, period_end: periodDate(sub),
      });
    } catch {
      // audit must never break the cancel
    }

    const end = periodDate(sub);
    return json({
      ok: true,
      tier: sub.tier,
      current_period_end: sub.current_period_end || null,
      message: end
        ? `Your subscription is cancelled. Your plan stays active until ${end}, and you will not be charged again.`
        : "Your subscription is cancelled. Your plan stays active until the end of the current billing period, and you will not be charged again.",
    });
  } catch (error) {
    return json({ ok: false, message: "Could not cancel the subscription. Please try again.", error: String(error) }, 500);
  }
}

// Mark the local row cancelled and keep everything else: tier and period
// end stay, so access runs to the end of the paid period, and the payment
// history in subscription_payments is never touched.
async function markCancelled(db, userId) {
  try {
    await db.prepare(
      `UPDATE account_subscriptions SET status = 'cancelled', updated_at = ?
       WHERE user_id = ? AND status = 'active'`
    ).bind(toSqliteDate(), userId).run();
  } catch {
    // best effort: the Paystack side is already cancelled, and the
    // webhook subscription.disable handler marks the row too
  }
}
