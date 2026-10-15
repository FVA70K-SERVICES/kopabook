// /api/hotel/folio — guest folio (bill).
// GET ?bookingId= -> booking, charges, payments, totals.
// POST { action: "charge", bookingId, category, description, amount }
// POST { action: "payment", bookingId, amount, mode, note }
// POST { action: "checkout", bookingId, amount?, mode?, note? } — optional final
//   payment, then closes the booking and frees the room.
import { json, getAuthContext, requireAuth, audit } from "../_utils";

const CATEGORIES = ["room", "restaurant", "bar", "laundry", "transport", "other"];

async function getFolio(db, businessId, bookingId) {
  const booking = await db.prepare(
    `SELECT b.*, r.room_number, r.room_type, r.rate_per_night
     FROM hotel_bookings b JOIN hotel_rooms r ON r.id = b.room_id
     WHERE b.id = ? AND b.business_id = ?`
  ).bind(bookingId, businessId).first();
  if (!booking) return null;
  const charges = await db.prepare(
    `SELECT * FROM hotel_charges WHERE booking_id = ? ORDER BY created_at ASC`
  ).bind(bookingId).all();
  const payments = await db.prepare(
    `SELECT * FROM hotel_payments WHERE booking_id = ? ORDER BY created_at ASC`
  ).bind(bookingId).all();
  const totalCharged = (charges.results || []).reduce((s, c) => s + Number(c.amount), 0);
  const totalPaid = (payments.results || []).reduce((s, p) => s + Number(p.amount), 0);
  return {
    booking,
    charges: charges.results || [],
    payments: payments.results || [],
    totalCharged, totalPaid, balance: totalCharged - totalPaid,
  };
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bookingId = Number(new URL(context.request.url).searchParams.get("bookingId"));
    if (!bookingId) return json({ ok: false, message: "Booking id is required." }, 400);
    const folio = await getFolio(context.env.KOPABOOK_DB, auth.business.id, bookingId);
    if (!folio) return json({ ok: false, message: "Booking not found." }, 404);
    return json({ ok: true, ...folio });
  } catch (error) {
    return json({ ok: false, message: "Could not load folio.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");
    const bookingId = Number(body.bookingId);
    if (!bookingId) return json({ ok: false, message: "Booking id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const booking = await db.prepare(
      `SELECT * FROM hotel_bookings WHERE id = ? AND business_id = ?`
    ).bind(bookingId, auth.business.id).first();
    if (!booking) return json({ ok: false, message: "Booking not found." }, 404);
    if (["checked_out", "cancelled", "no_show"].includes(booking.status)) {
      return json({ ok: false, message: "This booking is closed." }, 400);
    }

    if (action === "charge") {
      const amount = Number(body.amount);
      const description = String(body.description || "").trim().slice(0, 120);
      const category = CATEGORIES.includes(body.category) ? body.category : "other";
      if (!(amount > 0)) return json({ ok: false, message: "Amount must be greater than zero." }, 400);
      if (!description) return json({ ok: false, message: "Description is required." }, 400);
      await db.prepare(
        `INSERT INTO hotel_charges (business_id, booking_id, category, description, amount, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(auth.business.id, bookingId, category, description, amount, auth.user.id).run();
      await audit(context, auth, "hotel.charge_add", "hotel_charges", bookingId, { amount, category });
      return json({ ok: true }, 201);
    }

    if (action === "payment") {
      const amount = Number(body.amount);
      if (!(amount > 0)) return json({ ok: false, message: "Amount must be greater than zero." }, 400);
      await db.prepare(
        `INSERT INTO hotel_payments (business_id, booking_id, amount, mode, note, received_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        auth.business.id, bookingId, amount,
        String(body.mode || "Cash").slice(0, 40),
        String(body.note || "").slice(0, 200) || null,
        auth.user.id
      ).run();
      await audit(context, auth, "hotel.payment_add", "hotel_payments", bookingId, { amount });
      return json({ ok: true }, 201);
    }

    if (action === "checkout") {
      const folio = await getFolio(db, auth.business.id, bookingId);
      const finalAmount = Number(body.amount) || 0;
      const stmts = [];
      if (finalAmount > 0) {
        stmts.push(db.prepare(
          `INSERT INTO hotel_payments (business_id, booking_id, amount, mode, note, received_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(auth.business.id, bookingId, finalAmount, String(body.mode || "Cash").slice(0, 40),
          String(body.note || "Checkout payment").slice(0, 200), auth.user.id));
      }
      stmts.push(db.prepare(`UPDATE hotel_bookings SET status = 'checked_out' WHERE id = ?`).bind(bookingId));
      stmts.push(db.prepare(`UPDATE hotel_rooms SET status = 'vacant' WHERE id = ?`).bind(booking.room_id));
      await db.batch(stmts);
      await audit(context, auth, "hotel.checkout", "hotel_bookings", bookingId,
        { charged: folio.totalCharged, paid: folio.totalPaid + finalAmount });
      return json({ ok: true, charged: folio.totalCharged, paid: folio.totalPaid + finalAmount });
    }

    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (error) {
    return json({ ok: false, message: "Folio update failed.", error: String(error) }, 500);
  }
}
