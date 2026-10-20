// GET  /api/ai/pa - PA cards for the signed-in business (Solo and Pro).
// POST /api/ai/pa - { action: 'reminder_done', reminder_id }
//
// The personal assistant is a Solo and Pro feature: naming, the manager
// behaviour and these cards unlock on those tiers (a promo Pro month counts,
// because the effective tier comes from getBusinessOwnerTier). Every query
// here is scoped to the caller's own business only.
import { json, getAuthContext, requireAuth, toSqliteDate } from "../_utils.js";
import { getBusinessOwnerTier } from "../billing.js";
import { getAssistantProfile } from "./chat.js";

function fmt(n, currency) {
  const v = Number(n || 0);
  return (currency || "NGN") + " " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function daysSince(dateText) {
  const t = Date.parse(String(dateText || "").replace(" ", "T") + (String(dateText || "").includes("T") ? "" : "Z"));
  if (!Number.isFinite(t)) return null;
  const diff = Math.floor((Date.now() - t) / 86400000);
  return diff < 0 ? 0 : diff;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const db = context.env.KOPABOOK_DB;
    const businessId = auth.business && auth.business.id;
    if (!businessId) return json({ ok: false, message: "Pick a business first." }, 400);
    const currency = auth.business.currency || "NGN";

    const { tier: rawTier } = await getBusinessOwnerTier(db, businessId);
    const tier = rawTier || "free";
    const profile = await getAssistantProfile(db, businessId, tier);
    const paEnabled = !!profile.paEnabled;

    const cards = [];
    if (paEnabled) {
      cards.push({ id: "briefing", type: "briefing", text: "Your manager briefing is ready." });

      // Low stock: name up to 3 items with the counts left.
      try {
        let rows;
        try {
          const rs = await db.prepare(
            `SELECT p.name, p.unit, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p
             LEFT JOIN inventory_items ii ON ii.product_id = p.id
             WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold
             ORDER BY qty ASC, p.name ASC LIMIT 3`
          ).bind(businessId).all();
          rows = rs.results || [];
        } catch (e) {
          if (!/no such column: unit/i.test(String(e && e.message))) throw e;
          const rs = await db.prepare(
            `SELECT p.name, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p
             LEFT JOIN inventory_items ii ON ii.product_id = p.id
             WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold
             ORDER BY qty ASC, p.name ASC LIMIT 3`
          ).bind(businessId).all();
          rows = (rs.results || []).map((r) => ({ name: r.name, unit: "piece", qty: r.qty }));
        }
        if (rows.length) {
          cards.push({
            type: "low_stock",
            text: "Low stock: " + rows.map((p) => `${p.name} (${Number(p.qty) || 0} ${p.unit || "piece"} left)`).join(", ") + ".",
          });
        }
      } catch (e) { /* one bad card must never break the endpoint */ }

      // Top overdue debtor: the debtor whose oldest unpaid sale is the
      // oldest, shown only when that sale is at least 7 days old.
      try {
        const rs = await db.prepare(
          `SELECT c.name AS name,
                  COALESCE((SELECT balance_after FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS bal,
                  MIN(s.created_at) AS oldest
           FROM customers c
           JOIN sales s ON s.customer_id = c.id AND s.business_id = c.business_id
           WHERE c.business_id = ? AND s.balance_due > 0
           GROUP BY c.id
           ORDER BY oldest ASC LIMIT 10`
        ).bind(businessId).all();
        for (const r of (rs.results || [])) {
          const bal = Number(r.bal) || 0;
          const days = r.oldest ? daysSince(r.oldest) : null;
          if (bal > 0 && days !== null && days >= 7) {
            cards.push({
              type: "overdue_debtor",
              text: `${r.name} owes ${fmt(bal, currency)}, oldest unpaid sale ${days} ${days === 1 ? "day" : "days"} ago.`,
            });
            break;
          }
        }
      } catch (e) { /* one bad card must never break the endpoint */ }

      // Due pending reminders, up to 3, soonest first.
      try {
        const rs = await db.prepare(
          `SELECT id, title FROM bot_reminders
           WHERE business_id = ? AND status = 'pending' AND remind_at <= ?
           ORDER BY remind_at ASC LIMIT 3`
        ).bind(businessId, toSqliteDate(new Date())).all();
        for (const r of (rs.results || [])) {
          cards.push({ type: "reminder_due", id: r.id, reminder_id: r.id, text: r.title });
        }
      } catch (e) { /* one bad card must never break the endpoint */ }
    }

    return json({
      ok: true,
      assistant: {
        name: profile.name,
        custom_name: profile.custom ? profile.name : "",
        custom: !!profile.custom,
        voice: profile.voice || "default",
        language: profile.language || "en",
        speech_enabled: profile.speech_enabled !== false,
      },
      pa_enabled: paEnabled,
      cards,
    });
  } catch (e) {
    return json({ ok: false, message: "Could not load your assistant." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const db = context.env.KOPABOOK_DB;
    const businessId = auth.business && auth.business.id;
    if (!businessId) return json({ ok: false, message: "Pick a business first." }, 400);
    const body = await context.request.json().catch(() => ({}));
    const action = body.action;

    if (action === "reminder_done") {
      const reminderId = body.reminder_id || body.reminderId || body.id;
      if (!reminderId) return json({ ok: false, message: "Pick a reminder first." }, 400);
      await db.prepare(
        `UPDATE bot_reminders SET status = 'done' WHERE id = ? AND business_id = ?`
      ).bind(reminderId, businessId).run();
      return json({ ok: true });
    }

    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, message: "Could not update that." }, 500);
  }
}
