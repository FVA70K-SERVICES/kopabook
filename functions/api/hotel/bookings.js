// /api/hotel/bookings — GET list, POST create (with availability check),
// PATCH change status: check_in, check_out handled via folio checkout, cancel, no_show.
import { json, getAuthContext, requireAuth, requireHotelRole, audit } from "../_utils";

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.round(ms / 86400000);
}

async function roomFree(db, businessId, roomId, checkIn, checkOut, excludeId) {
  const clash = await db.prepare(
    `SELECT COUNT(*) AS n FROM hotel_bookings
     WHERE business_id = ? AND room_id = ? AND status IN ('reserved','checked_in')
       AND NOT (check_out <= ? OR check_in >= ?)
       ${excludeId ? "AND id != ?" : ""}`
  ).bind(businessId, roomId, checkIn, checkOut, ...(excludeId ? [excludeId] : [])).first();
  return Number(clash.n) === 0;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const url = new URL(context.request.url);
    const status = url.searchParams.get("status") || "";
    const date = url.searchParams.get("date") || "";

    let sql = `SELECT b.*, r.room_number, r.room_type, r.rate_per_night,
        COALESCE((SELECT SUM(amount) FROM hotel_charges c WHERE c.booking_id = b.id), 0) AS total_charged,
        COALESCE((SELECT SUM(amount) FROM hotel_payments p WHERE p.booking_id = b.id), 0) AS total_paid
      FROM hotel_bookings b JOIN hotel_rooms r ON r.id = b.room_id
      WHERE b.business_id = ?`;
    const vals = [auth.business.id];
    if (status) { sql += ` AND b.status = ?`; vals.push(status); }
    if (date) { sql += ` AND b.check_in <= ? AND b.check_out > ?`; vals.push(date, date); }
    sql += ` ORDER BY b.check_in DESC LIMIT 200`;

    const rows = await context.env.KOPABOOK_DB.prepare(sql).bind(...vals).all();
    return json({ ok: true, bookings: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load bookings.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const roleDenied = requireHotelRole(auth, ["hotel_manager", "receptionist"]);
    if (roleDenied) return roleDenied;
    const body = await context.request.json().catch(() => ({}));

    const room_id = Number(body.room_id);
    const guest_name = String(body.guest_name || "").trim().slice(0, 80);
    const check_in = String(body.check_in || "").slice(0, 10);
    const check_out = String(body.check_out || "").slice(0, 10);
    if (!room_id) return json({ ok: false, message: "Room is required." }, 400);
    if (!guest_name) return json({ ok: false, message: "Guest name is required." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(check_in) || !/^\d{4}-\d{2}-\d{2}$/.test(check_out)) {
      return json({ ok: false, message: "Check-in and check-out dates are required." }, 400);
    }
    const nights = nightsBetween(check_in, check_out);
    if (!(nights >= 1)) return json({ ok: false, message: "Check-out must be after check-in." }, 400);

    const db = context.env.KOPABOOK_DB;
    const room = await db.prepare(
      `SELECT * FROM hotel_rooms WHERE id = ? AND business_id = ?`
    ).bind(room_id, auth.business.id).first();
    if (!room) return json({ ok: false, message: "Room not found." }, 404);
    if (room.status === "maintenance") return json({ ok: false, message: "Room is under maintenance." }, 400);
    if (!(await roomFree(db, auth.business.id, room_id, check_in, check_out, null))) {
      return json({ ok: false, message: "Room is already booked for those dates." }, 409);
    }

    const res = await db.prepare(
      `INSERT INTO hotel_bookings (business_id, room_id, guest_name, guest_phone, guest_id_type, guest_id_number,
        check_in, check_out, adults, children, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`
    ).bind(
      auth.business.id, room_id, guest_name,
      String(body.guest_phone || "").slice(0, 20) || null,
      String(body.guest_id_type || "").slice(0, 30) || null,
      String(body.guest_id_number || "").slice(0, 40) || null,
      check_in, check_out,
      Math.max(1, Number(body.adults) || 1),
      Math.max(0, Number(body.children) || 0),
      String(body.notes || "").slice(0, 500) || null,
      auth.user.id
    ).run();
    const bookingId = Number(res.meta.last_row_id);

    // Auto-post the room charge for the booked nights.
    const roomTotal = Number(room.rate_per_night) * nights;
    if (roomTotal > 0) {
      await db.prepare(
        `INSERT INTO hotel_charges (business_id, booking_id, category, description, amount, created_by)
         VALUES (?, ?, 'room', ?, ?, ?)`
      ).bind(auth.business.id, bookingId, `Room ${room.room_number} — ${nights} night${nights > 1 ? "s" : ""} @ ${room.rate_per_night}`, roomTotal, auth.user.id).run();
    }
    // Mark room reserved.
    await db.prepare(`UPDATE hotel_rooms SET status = 'reserved' WHERE id = ? AND business_id = ?`)
      .bind(room_id, auth.business.id).run();

    await audit(context, auth, "hotel.booking_create", "hotel_bookings", bookingId, { guest_name, room_id, nights });
    return json({ ok: true, id: bookingId }, 201);
  } catch (error) {
    return json({ ok: false, message: error.message || "Could not create booking.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const roleDenied = requireHotelRole(auth, ["hotel_manager", "receptionist"]);
    if (roleDenied) return roleDenied;
    const body = await context.request.json().catch(() => ({}));
    const id = Number(body.id);
    const action = String(body.action || "");
    if (!id) return json({ ok: false, message: "Booking id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const booking = await db.prepare(
      `SELECT * FROM hotel_bookings WHERE id = ? AND business_id = ?`
    ).bind(id, auth.business.id).first();
    if (!booking) return json({ ok: false, message: "Booking not found." }, 404);

    if (action === "check_in") {
      if (booking.status !== "reserved") return json({ ok: false, message: "Only reserved bookings can be checked in." }, 400);
      await db.batch([
        db.prepare(`UPDATE hotel_bookings SET status = 'checked_in' WHERE id = ?`).bind(id),
        db.prepare(`UPDATE hotel_rooms SET status = 'occupied' WHERE id = ?`).bind(booking.room_id),
      ]);
    } else if (action === "cancel") {
      if (!["reserved"].includes(booking.status)) return json({ ok: false, message: "Only reserved bookings can be cancelled." }, 400);
      await db.batch([
        db.prepare(`UPDATE hotel_bookings SET status = 'cancelled' WHERE id = ?`).bind(id),
        db.prepare(`UPDATE hotel_rooms SET status = 'vacant' WHERE id = ? AND status = 'reserved'`).bind(booking.room_id),
      ]);
    } else if (action === "no_show") {
      if (booking.status !== "reserved") return json({ ok: false, message: "Only reserved bookings can be marked no-show." }, 400);
      await db.batch([
        db.prepare(`UPDATE hotel_bookings SET status = 'no_show' WHERE id = ?`).bind(id),
        db.prepare(`UPDATE hotel_rooms SET status = 'vacant' WHERE id = ? AND status = 'reserved'`).bind(booking.room_id),
      ]);
    } else {
      return json({ ok: false, message: "Unknown action." }, 400);
    }

    await audit(context, auth, `hotel.booking_${action}`, "hotel_bookings", id, {});
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update booking.", error: String(error) }, 500);
  }
}
