// GET /api/activity — owner/partner view of the business audit trail.
// Query: ?limit=50&offset=0&action=sale.record&actor=123&from=2026-10-01&to=2026-10-31
import { json, getAuthContext, requireAuth } from "./_utils";

const ACTION_LABELS = {
  "sale.record": "Sale recorded", "sale.refund": "Sale refunded",
  "product.create": "Product added", "product.update": "Product updated", "product.archive": "Product archived",
  "product.stock_adjust": "Stock adjusted",
  "debt.add": "Debt added", "debt.payment": "Debt payment recorded", "debt.writeoff": "Debt written off",
  "expense.create": "Expense recorded", "expense.delete": "Expense deleted",
  "supplier.purchase": "Supplier purchase recorded",
  "staff.invite": "Staff invited", "staff.edit": "Staff member updated", "staff.remove": "Staff member removed", "staff.permissions.update": "Staff permissions changed",
  "staff.password_reset": "Staff password reset",
  "customer.create": "Customer added", "customer.update": "Customer updated",
  "hotel.booking": "Booking made", "hotel.checkin": "Guest checked in", "hotel.checkout": "Guest checked out",
  "hotel.room": "Room changed", "hotel.folio": "Folio charge/payment",
  "business.update": "Business settings changed",
  "auth.login": "Signed in", "auth.password_reset": "Password reset",
};

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner" && auth.business.role !== "partner") {
      return json({ ok: false, message: "Only the owner or a partner can view the activity log." }, 403);
    }

    const url = new URL(context.request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const action = String(url.searchParams.get("action") || "").slice(0, 60);
    const actor = Number(url.searchParams.get("actor")) || null;
    const from = String(url.searchParams.get("from") || "").slice(0, 10);
    const to = String(url.searchParams.get("to") || "").slice(0, 10);

    const conds = ["a.business_id = ?"];
    const params = [auth.business.id];
    if (action) { conds.push("a.action_type = ?"); params.push(action); }
    if (actor) { conds.push("a.actor_user_id = ?"); params.push(actor); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { conds.push("date(a.created_at) >= ?"); params.push(from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { conds.push("date(a.created_at) <= ?"); params.push(to); }

    const db = context.env.KOPABOOK_DB;
    const rows = await db.prepare(
      `SELECT a.id, a.action_type, a.entity_type, a.entity_id, a.metadata_json, a.created_at,
              u.full_name AS actor_name, u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${conds.join(" AND ")}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();

    const total = await db.prepare(
      `SELECT COUNT(*) AS c FROM audit_logs a WHERE ${conds.join(" AND ")}`
    ).bind(...params).first();

    const actors = await db.prepare(
      `SELECT DISTINCT u.id, u.full_name FROM audit_logs a
       INNER JOIN users u ON u.id = a.actor_user_id
       WHERE a.business_id = ? ORDER BY u.full_name ASC LIMIT 100`
    ).bind(auth.business.id).all();

    const actions = await db.prepare(
      `SELECT DISTINCT action_type FROM audit_logs WHERE business_id = ? ORDER BY action_type ASC`
    ).bind(auth.business.id).all();

    const entries = (rows.results || []).map((r) => {
      let meta = null;
      try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : null; } catch { meta = null; }
      // Never leak secrets: strip anything sensitive from metadata.
      if (meta && typeof meta === "object") {
        for (const k of Object.keys(meta)) {
          if (/password|token|secret|hash/i.test(k)) delete meta[k];
        }
      }
      return {
        id: r.id,
        action: r.action_type,
        label: ACTION_LABELS[r.action_type] || r.action_type,
        entityType: r.entity_type, entityId: r.entity_id,
        actorName: r.actor_name || "Unknown", actorEmail: r.actor_email || "",
        meta, createdAt: r.created_at,
      };
    });

    return json({
      ok: true,
      entries,
      total: Number(total?.c || 0),
      actors: actors.results || [],
      actions: (actions.results || []).map((a) => ({
        key: a.action_type,
        label: ACTION_LABELS[a.action_type] || a.action_type,
      })),
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load activity log.", error: String(error) }, 500);
  }
}
