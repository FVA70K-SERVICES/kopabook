// /api/payment-modes — GET list (seeds defaults on first use), POST add,
// PATCH rename/toggle, DELETE remove. Owner and manager can manage;
// attendants get the read list for the sale form.
// WORLD-BEST (Dashboard stream): each mode carries a kind
// ('cash'|'transfer'|'card'|'credit', migration 0061). A kind of 'credit'
// means buy-now-pay-later: its tender does not count as money received.
// Every kind read/write is defensive: before the migration runs the kind
// column does not exist, and the name fallback ('Credit' = credit-kind)
// keeps the Dashboard split correct.
import { json, getAuthContext, requireAuth, audit } from "./_utils";
import { isValidKind } from "./_money.js";

const DEFAULTS = ["Cash", "Bank Transfer", "POS / Card", "USSD", "Credit"];

// Default kind for a mode name when no kind is stored.
function defaultKindForName(name) {
  return String(name || "").trim().toLowerCase() === "credit" ? "credit" : "cash";
}

// Read the mode list with kind when the column exists, without it when it
// does not (pre-migration). Never fails the list over a missing column.
async function loadModes(db, businessId) {
  try {
    const modes = await db.prepare(
      `SELECT id, name, enabled, sort_order, kind FROM payment_modes
       WHERE business_id = ? ORDER BY sort_order ASC, id ASC`
    ).bind(businessId).all();
    return (modes.results || []).map((m) => ({
      ...m,
      kind: m.kind || defaultKindForName(m.name),
    }));
  } catch {
    const modes = await db.prepare(
      `SELECT id, name, enabled, sort_order FROM payment_modes
       WHERE business_id = ? ORDER BY sort_order ASC, id ASC`
    ).bind(businessId).all();
    return (modes.results || []).map((m) => ({
      ...m,
      kind: defaultKindForName(m.name),
    }));
  }
}

// Best-effort kind write: silently ignored pre-migration (no kind column).
async function trySetKind(db, businessId, id, kind) {
  try {
    await db.prepare(
      `UPDATE payment_modes SET kind = ? WHERE id = ? AND business_id = ?`
    ).bind(kind, id, businessId).run();
  } catch {
    // Kind column not present yet; the name fallback still applies.
  }
}

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
  // The seeded "Credit" mode is buy-now-pay-later (migration 0061 or later).
  try {
    await db.prepare(
      `UPDATE payment_modes SET kind = 'credit' WHERE business_id = ? AND lower(name) = 'credit'`
    ).bind(businessId).run();
  } catch {
    // Pre-migration: the name fallback treats it as credit-kind anyway.
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const db = context.env.KOPABOOK_DB;
    await ensureSeeded(db, auth.business.id);
    const modes = await loadModes(db, auth.business.id);
    return json({ ok: true, modes });
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
    // Kind is optional on create; a mode named "Credit" defaults to credit.
    let kind = defaultKindForName(name);
    if (body.kind !== undefined) {
      if (!isValidKind(body.kind)) {
        return json({ ok: false, message: "Kind must be cash, transfer, card or credit." }, 400);
      }
      kind = String(body.kind).trim().toLowerCase();
    }

    const db = context.env.KOPABOOK_DB;
    await ensureSeeded(db, auth.business.id);
    const maxSort = await db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM payment_modes WHERE business_id = ?`
    ).bind(auth.business.id).first();
    try {
      const r = await db.prepare(
        `INSERT INTO payment_modes (business_id, name, sort_order) VALUES (?, ?, ?)`
      ).bind(auth.business.id, name, Number(maxSort.m) + 1).run();
      await trySetKind(db, auth.business.id, r.meta.last_row_id, kind);
      await audit(context, auth, "payment_mode.add", "payment_mode", r.meta.last_row_id, { name, kind });
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
    // Kind is applied after the main update so a pre-migration database
    // (no kind column) still accepts the rename/toggle.
    let kind = null;
    if (body.kind !== undefined) {
      if (!isValidKind(body.kind)) {
        return json({ ok: false, message: "Kind must be cash, transfer, card or credit." }, 400);
      }
      kind = String(body.kind).trim().toLowerCase();
    }
    if (!fields.length && !kind) return json({ ok: false, message: "Nothing to update." }, 400);
    if (fields.length) {
      params.push(id, auth.business.id);
      const r = await context.env.KOPABOOK_DB.prepare(
        `UPDATE payment_modes SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
      ).bind(...params).run();
      if (!r.meta.changes && !kind) return json({ ok: false, message: "Payment mode not found." }, 404);
    }
    if (kind) {
      await trySetKind(context.env.KOPABOOK_DB, auth.business.id, id, kind);
      // trySetKind is best-effort pre-migration; confirm the row exists.
      const check = await context.env.KOPABOOK_DB.prepare(
        `SELECT id FROM payment_modes WHERE id = ? AND business_id = ? LIMIT 1`
      ).bind(id, auth.business.id).first();
      if (!check) return json({ ok: false, message: "Payment mode not found." }, 404);
    }
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
