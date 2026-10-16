// /api/admin/plans — platform admin only. View and set subscription fees.
import { json, getAuthContext, requireAuth, toSqliteDate } from "../_utils";
import { requirePlatformAdmin } from "./overview";

const VALID = [
  ["starter", "monthly"],
  ["starter", "yearly"],
  ["pro", "monthly"],
  ["pro", "yearly"],
];

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT tier, billing_cycle, amount_kobo, currency, active, updated_at
       FROM subscription_plans ORDER BY tier, billing_cycle`
    ).all();
    return json({ ok: true, plans: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load plans.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    const cycle = String(body.cycle || "").toLowerCase();
    const amountNgn = Number(body.amount_ngn);

    if (!VALID.some(([t, c]) => t === tier && c === cycle)) {
      return json({ ok: false, message: "Invalid plan." }, 400);
    }
    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      return json({ ok: false, message: "Enter a valid amount in naira." }, 400);
    }

    const amount_kobo = Math.round(amountNgn * 100);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE subscription_plans SET amount_kobo = ?, updated_at = ?
       WHERE tier = ? AND billing_cycle = ?`
    ).bind(amount_kobo, toSqliteDate(), tier, cycle).run();

    return json({ ok: true, message: `Price updated: ${tier} ${cycle} is now NGN ${amountNgn.toLocaleString()}.` });
  } catch (error) {
    return json({ ok: false, message: "Could not update the price.", error: String(error) }, 500);
  }
}
