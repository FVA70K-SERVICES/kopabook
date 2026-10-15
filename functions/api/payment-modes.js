// /api/payment-modes — GET list (seeds defaults on first use), POST add,
// PATCH rename/toggle, DELETE remove. Owner and manager can manage;
// attendants get the read list for the sale form.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

const DEFAULTS = ["Cash", "Bank Transfer", "POS / Card", "USSD", "Credit"];

async function ensureSeeded(db, businessId) {
  const existing = await db.prepare(
    `SELECT COUNT(*) AS n FROM payment_modes WHERE business_id = ?`
  ).bind(businessId).first();
  if (Number(existing.n) > 0) return;
  const stmts = DEFAULTS.map((name, i) =>
    db.prepare(
      `INSERT OR IGNORE INTO payment_modes (business_id, name, sort_order) VALUES (?, ?, ?)`
    ).bind(businessId, name, i + 1)
  );
  await db.batch(stmts);
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const db = context.env.KOPABOOK_DB;
    await ensureSeeded(db, auth.business.id);
    const modes = await db.prepare(
      `SELECT id, name, enabled, sort_order FROM payment_modes
       WHERE business_id = ? ORDER BY sort_order ASC, id ASC`
    ).bind(auth.business.id).all();
    return json({ ok: true, modes: modes.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load payment modes.", error: String(error) }, 500);
  }
}

function canManage(auth) {
  return auth.business.role === "owner" || auth.business.role === "manager";
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) return json({ ok: false, message: "Only owner or manager can add payment modes." }, 403);

    const body = await context.request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) return json({ ok: false, message: "Mode name is required." }, 400);
    if (name.length > 40) return json({ ok: false, message: "Keep the name under 40 characters." }, 400);

    const db = context.env.KOPABOOK_DB;
    await ensureSeeded(db, auth.business.id);
    const maxSort = await db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM payment_modes WHERE business_id = ?`
    ).bind(auth.business.id).first();
    try {
      const r = await db.prepare(
        `INSERT INTO payment_modes (business_id, name, sort_order) VALUES (?, ?, ?)`
      ).bind(auth.business.id, name, Number(maxSort.m) + 1).run();
      await audit(context, auth, "payment_mode.add", "payment_mode", r.meta.last_row_id, { name });
      return json({ ok: true, id: r.meta.last_row_id }, 201);
    } catch (e) {
      if (String(e.message || "").includes("UNIQUE")) {
        return json({ ok: false, message: "That payment mode already exists." }, 409);
      }
      throw e;
    }
  } catch (error) {
    return json({ ok: false, message: "Could not add payment mode.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) return json({ ok: false, message: "Only owner or manager can edit payment modes." }, 403);

    const body = await context.request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!id) return json({ ok: false, message: "Mode id is required." }, 400);
    const fields = [];
    const params = [];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return json({ ok: false, message: "Mode name cannot be empty." }, 400);
      fields.push("name = ?"); params.push(name);
    }
    if (body.enabled !== undefined) { fields.push("enabled = ?"); params.push(body.enabled ? 1 : 0); }
    if (!fields.length) return json({ ok: false, message: "Nothing to update." }, 400);
    params.push(id, auth.business.id);
    const r = await context.env.KOPABOOK_DB.prepare(
      `UPDATE payment_modes SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
    ).bind(...params).run();
    if (!r.meta.changes) return json({ ok: false, message: "Payment mode not found." }, 404);
    await audit(context, auth, "payment_mode.update", "payment_mode", id, body);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update payment mode.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) return json({ ok: false, message: "Only owner or manager can remove payment modes." }, 403);

    const url = new URL(context.request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return json({ ok: false, message: "Mode id is required." }, 400);
    const r = await context.env.KOPABOOK_DB.prepare(
      `DELETE FROM payment_modes WHERE id = ? AND business_id = ?`
    ).bind(id, auth.business.id).run();
    if (!r.meta.changes) return json({ ok: false, message: "Payment mode not found." }, 404);
    await audit(context, auth, "payment_mode.delete", "payment_mode", id, {});
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not remove payment mode.", error: String(error) }, 500);
  }
}
