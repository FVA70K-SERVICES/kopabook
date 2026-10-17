// /api/shipments — GET list, POST create tracking, PATCH update status.
// Lets a store generate a tracking number when a sold product ships.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "./_utils";
import { getBusinessOwnerTier } from "./billing";

// Tier gate: shipment tracking is a Pro feature (solo gets Pro features for
// one business). Business-scoped: staff act under the owner's plan.
async function requireProTier(db, businessId) {
  const { tier } = await getBusinessOwnerTier(db, businessId);
  if (tier !== "pro" && tier !== "solo") {
    return json({
      ok: false,
      upgradeRequired: true,
      message: "Shipment tracking is a Pro feature. Upgrade to use it.",
    }, 403);
  }
  return null;
}

const STATUSES = ["pending", "shipped", "delivered", "cancelled"];

function makeTracking() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = crypto.getRandomValues(new Uint8Array(6));
  for (const b of buf) s += chars[b % chars.length];
  return "KB-" + s;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const tierGate = await requireProTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const url = new URL(context.request.url);
    const status = url.searchParams.get("status");
    let sql = `SELECT sh.*, s.sale_number, s.total_amount, c.name AS customer_name
               FROM shipments sh
               LEFT JOIN sales s ON s.id = sh.sale_id
               LEFT JOIN customers c ON c.id = s.customer_id
               WHERE sh.business_id = ?`;
    const params = [auth.business.id];
    if (status && STATUSES.includes(status)) { sql += ` AND sh.status = ?`; params.push(status); }
    sql += ` ORDER BY sh.id DESC LIMIT 200`;

    const rows = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, shipments: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load shipments.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const tierGate = await requireProTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const body = await context.request.json().catch(() => ({}));
    const saleId = Number(body.saleId) || null;
    if (!saleId) return json({ ok: false, message: "Sale is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const sale = await db.prepare(
      `SELECT s.id, s.sale_number, s.customer_id, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.business_id = ? LIMIT 1`
    ).bind(saleId, auth.business.id).first();
    if (!sale) return json({ ok: false, message: "Sale not found." }, 404);

    const existing = await db.prepare(
      `SELECT id FROM shipments WHERE sale_id = ? AND business_id = ? AND status != 'cancelled' LIMIT 1`
    ).bind(saleId, auth.business.id).first();
    if (existing) {
      return json({ ok: false, message: "This sale already has an active shipment." }, 409);
    }

    // Generate a unique tracking number for this business.
    let tracking = null;
    for (let i = 0; i < 5; i++) {
      const t = makeTracking();
      const clash = await db.prepare(
        `SELECT id FROM shipments WHERE business_id = ? AND tracking_number = ? LIMIT 1`
      ).bind(auth.business.id, t).first();
      if (!clash) { tracking = t; break; }
    }
    if (!tracking) return json({ ok: false, message: "Could not generate a tracking number. Try again." }, 500);

    const now = toSqliteDate();
    const result = await db.prepare(
      `INSERT INTO shipments (business_id, sale_id, tracking_number, recipient_name, recipient_phone, address, courier, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      auth.business.id, saleId, tracking,
      String(body.recipientName || sale.customer_name || "").slice(0, 120) || null,
      String(body.recipientPhone || sale.customer_phone || "").slice(0, 40) || null,
      String(body.address || "").slice(0, 300) || null,
      String(body.courier || "").slice(0, 80) || null,
      auth.user.id, now
    ).run();

    await audit(context, auth, "shipment.create", "shipment", result.meta.last_row_id, {
      tracking, saleNumber: sale.sale_number,
    });
    return json({ ok: true, shipmentId: result.meta.last_row_id, tracking }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create shipment.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const tierGate = await requireProTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const body = await context.request.json().catch(() => ({}));
    const id = Number(body.id) || null;
    const status = String(body.status || "");
    if (!id || !STATUSES.includes(status)) {
      return json({ ok: false, message: "Valid id and status are required." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const row = await db.prepare(
      `SELECT id FROM shipments WHERE id = ? AND business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!row) return json({ ok: false, message: "Shipment not found." }, 404);

    const now = toSqliteDate();
    const extra = status === "shipped" ? `, shipped_at = '${now}'`
      : status === "delivered" ? `, delivered_at = '${now}'` : "";
    await db.prepare(`UPDATE shipments SET status = ?${extra} WHERE id = ?`).bind(status, id).run();

    await audit(context, auth, "shipment.status", "shipment", id, { status });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update shipment.", error: String(error) }, 500);
  }
}
