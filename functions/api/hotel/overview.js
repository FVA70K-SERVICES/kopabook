// /api/hotel/overview — GET today's hotel stats: occupancy, arrivals,
// departures, in-house guests, revenue collected today.
import { json, getAuthContext, requireAuth } from "../_utils";
import { getBusinessOwnerTier } from "../billing";

// Tier gate: paid feature, business-scoped (staff act under the owner's plan).
async function requireFeatureTier(db, businessId) {
  const { tier } = await getBusinessOwnerTier(db, businessId);
  if (!["pro", "solo"].includes(tier)) {
    return json({ ok: false, upgradeRequired: true, message: "Hotel operations is a Pro feature. Upgrade to use it." }, 403);
  }
  return null;
}


export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;
    const db = context.env.KOPABOOK_DB;
    const today = new Date().toISOString().slice(0, 10);
    const b = auth.business.id;

    const rooms = await db.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
        SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) AS reserved,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance
       FROM hotel_rooms WHERE business_id = ?`
    ).bind(b).first();

    const arrivals = await db.prepare(
      `SELECT COUNT(*) AS n FROM hotel_bookings
       WHERE business_id = ? AND status = 'reserved' AND check_in = ?`
    ).bind(b, today).first();

    const departures = await db.prepare(
      `SELECT COUNT(*) AS n FROM hotel_bookings
       WHERE business_id = ? AND status = 'checked_in' AND check_out = ?`
    ).bind(b, today).first();

    const inHouse = await db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(adults + children), 0) AS guests
       FROM hotel_bookings WHERE business_id = ? AND status = 'checked_in'`
    ).bind(b).first();

    const revenue = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM hotel_payments
       WHERE business_id = ? AND date(created_at) = date(?)`
    ).bind(b, today).first();

    const outstanding = await db.prepare(
      `SELECT COALESCE(SUM(c.amount), 0) - COALESCE((SELECT SUM(p.amount) FROM hotel_payments p
        WHERE p.business_id = ? AND p.booking_id IN
          (SELECT id FROM hotel_bookings WHERE business_id = ? AND status = 'checked_in')), 0) AS n
       FROM hotel_charges c WHERE c.business_id = ? AND c.booking_id IN
        (SELECT id FROM hotel_bookings WHERE business_id = ? AND status = 'checked_in')`
    ).bind(b, b, b, b).first();

    const total = Number(rooms.total) || 0;
    return json({
      ok: true,
      rooms: {
        total,
        occupied: Number(rooms.occupied) || 0,
        vacant: Number(rooms.vacant) || 0,
        reserved: Number(rooms.reserved) || 0,
        maintenance: Number(rooms.maintenance) || 0,
        occupancyPct: total ? Math.round((Number(rooms.occupied) / total) * 100) : 0,
      },
      arrivals: Number(arrivals.n) || 0,
      departures: Number(departures.n) || 0,
      inHouseBookings: Number(inHouse.n) || 0,
      inHouseGuests: Number(inHouse.guests) || 0,
      revenueToday: Number(revenue.n) || 0,
      outstandingInHouse: Number(outstanding.n) || 0,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load overview.", error: String(error) }, 500);
  }
}
