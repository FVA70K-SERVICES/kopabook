// /api/hotel/rooms — GET list, POST create, PATCH update, DELETE remove.
import { json, getAuthContext, requireAuth, requireHotelRole, audit } from "../_utils";
import { getBusinessOwnerTier } from "../billing";

// Tier gate: paid feature, business-scoped (staff act under the owner's plan).
async function requireFeatureTier(db, businessId) {
  const { tier } = await getBusinessOwnerTier(db, businessId);
  if (!["pro", "solo"].includes(tier)) {
    return json({ ok: false, upgradeRequired: true, message: "Hotel operations is a Pro feature. Upgrade to use it." }, 403);
  }
  return null;
}


const STATUSES = ["vacant", "occupied", "reserved", "maintenance"];

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;
    const db = context.env.KOPABOOK_DB;
    const rooms = await db.prepare(
      `SELECT r.*,
        (SELECT b.guest_name FROM hotel_bookings b
         WHERE b.room_id = r.id AND b.business_id = ? AND b.status = 'checked_in'
         ORDER BY b.check_in DESC LIMIT 1) AS current_guest
       FROM hotel_rooms r WHERE r.business_id = ? ORDER BY r.room_number ASC`
    ).bind(auth.business.id, auth.business.id).all();
    return json({ ok: true, rooms: rooms.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load rooms.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;
    const roleDenied = requireHotelRole(auth, ["hotel_manager"]);
    if (roleDenied) return roleDenied;
    const body = await context.request.json().catch(() => ({}));
    const room_number = String(body.room_number || "").trim();
    if (!room_number) return json({ ok: false, message: "Room number is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const res = await db.prepare(
      `INSERT INTO hotel_rooms (business_id, room_number, room_type, floor, rate_per_night, capacity, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'vacant', ?)`
    ).bind(
      auth.business.id, room_number,
      String(body.room_type || "Standard").slice(0, 40) || "Standard",
      String(body.floor || "").slice(0, 20) || null,
      Number(body.rate_per_night) || 0,
      Math.max(1, Number(body.capacity) || 2),
      String(body.notes || "").slice(0, 500) || null
    ).run().catch((e) => {
      if (String(e).includes("UNIQUE")) throw new Error("A room with that number already exists.");
      throw e;
    });

    await audit(context, auth, "hotel.room_create", "hotel_rooms", Number(res.meta.last_row_id), { room_number });
    return json({ ok: true, id: Number(res.meta.last_row_id) }, 201);
  } catch (error) {
    return json({ ok: false, message: error.message || "Could not create room.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;
    const body = await context.request.json().catch(() => ({}));
    // Status-only updates (housekeeping) are open to housekeepers;
    // editing room details or rates needs a manager.
    const keys = Object.keys(body).filter((k) => k !== "id");
    const statusOnly = keys.length === 1 && keys[0] === "status";
    const roleDenied = requireHotelRole(auth, statusOnly ? ["hotel_manager", "housekeeper"] : ["hotel_manager"]);
    if (roleDenied) return roleDenied;
    const id = Number(body.id);
    if (!id) return json({ ok: false, message: "Room id is required." }, 400);

    const sets = [];
    const vals = [];
    const allow = {
      room_number: (v) => String(v).trim().slice(0, 20),
      room_type: (v) => String(v).trim().slice(0, 40),
      floor: (v) => String(v).trim().slice(0, 20) || null,
      rate_per_night: (v) => Number(v) || 0,
      capacity: (v) => Math.max(1, Number(v) || 2),
      status: (v) => (STATUSES.includes(v) ? v : null),
      notes: (v) => String(v).slice(0, 500) || null,
    };
    for (const [k, fn] of Object.entries(allow)) {
      if (body[k] !== undefined) {
        const v = fn(body[k]);
        if (v !== null) { sets.push(`${k} = ?`); vals.push(v); }
      }
    }
    if (!sets.length) return json({ ok: false, message: "Nothing to update." }, 400);

    const db = context.env.KOPABOOK_DB;
    const r = await db.prepare(
      `UPDATE hotel_rooms SET ${sets.join(", ")} WHERE id = ? AND business_id = ?`
    ).bind(...vals, id, auth.business.id).run();
    if (!r.meta.changes) return json({ ok: false, message: "Room not found." }, 404);

    await audit(context, auth, "hotel.room_update", "hotel_rooms", id, { fields: sets.map((s) => s.split(" ")[0]) });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update room.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;
    const roleDenied = requireHotelRole(auth, []);
    if (roleDenied) return roleDenied;
    const id = Number(new URL(context.request.url).searchParams.get("id"));
    if (!id) return json({ ok: false, message: "Room id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const active = await db.prepare(
      `SELECT COUNT(*) AS n FROM hotel_bookings WHERE room_id = ? AND business_id = ? AND status IN ('reserved','checked_in')`
    ).bind(id, auth.business.id).first();
    if (Number(active.n) > 0) return json({ ok: false, message: "Cannot delete a room with active bookings." }, 400);

    await db.prepare(`DELETE FROM hotel_rooms WHERE id = ? AND business_id = ?`).bind(id, auth.business.id).run();
    await audit(context, auth, "hotel.room_delete", "hotel_rooms", id, {});
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete room.", error: String(error) }, 500);
  }
}
