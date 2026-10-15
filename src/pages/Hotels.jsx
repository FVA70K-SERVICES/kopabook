import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

const STATUS_COLORS = {
  vacant: "#16a34a",
  occupied: "#dc2626",
  reserved: "#d97706",
  maintenance: "#6b7280",
};
const CHARGE_CATS = ["room", "restaurant", "bar", "laundry", "transport", "other"];
const emptyRoom = { room_number: "", room_type: "Standard", floor: "", rate_per_night: "", capacity: "2", notes: "" };

function nightsBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export default function HotelsPage({ session }) {
  const [tab, setTab] = useState("board");
  const [overview, setOverview] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modes, setModes] = useState([]);

  // Room form
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState(emptyRoom);
  const [savingRoom, setSavingRoom] = useState(false);

  // Booking form
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    room_id: "", guest_name: "", guest_phone: "", guest_id_type: "", guest_id_number: "",
    check_in: todayISO(), check_out: "", check_in_time: "14:00", check_out_time: "12:00", adults: "1", children: "0", notes: "",
  });
  const [savingBooking, setSavingBooking] = useState(false);
  const [preselectedRoom, setPreselectedRoom] = useState(null);

  // Folio
  const [folioId, setFolioId] = useState(null);
  const [folio, setFolio] = useState(null);
  const [folioLoading, setFolioLoading] = useState(false);
  const [chargeForm, setChargeForm] = useState({ category: "restaurant", description: "", amount: "" });
  const [payForm, setPayForm] = useState({ amount: "", mode: "Cash", note: "" });
  const [checkoutForm, setCheckoutForm] = useState({ amount: "", mode: "Cash", note: "" });
  const [showCheckout, setShowCheckout] = useState(false);
  const [folioBusy, setFolioBusy] = useState(false);

  const role = session?.business?.role || "owner";
  const canManageRooms = ["owner", "partner", "hotel_manager"].includes(role);
  const canFrontdesk = ["owner", "partner", "hotel_manager", "receptionist"].includes(role);
  const canHousekeeping = ["owner", "hotel_manager", "housekeeper"].includes(role);

  async function load() {
    setLoading(true);
    try {
      const [o, r, b, m] = await Promise.all([
        api.get("/api/hotel/overview"),
        api.get("/api/hotel/rooms"),
        api.get("/api/hotel/bookings" + (filter ? `?status=${filter}` : "")),
        api.get("/api/payment-modes").catch(() => ({ modes: [] })),
      ]);
      setOverview(o);
      setRooms(r.rooms || []);
      setBookings(b.bookings || []);
      setModes((m.modes || []).filter((x) => x.enabled !== 0).map((x) => x.name));
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  async function loadFolio(id) {
    setFolioId(id);
    setFolioLoading(true);
    try {
      const d = await api.get(`/api/hotel/folio?bookingId=${id}`);
      setFolio(d);
      setCheckoutForm({ amount: String(Math.max(0, d.balance)), mode: payForm.mode || "Cash", note: "" });
    } catch (e) { setError(e.message); }
    setFolioLoading(false);
  }

  function closeFolio() { setFolioId(null); setFolio(null); setShowCheckout(false); }

  // ---- rooms ----
  function openRoomAdd() { setEditingRoom(null); setRoomForm(emptyRoom); setShowRoomForm(true); }
  function openRoomEdit(r) {
    setEditingRoom(r);
    setRoomForm({ room_number: r.room_number, room_type: r.room_type, floor: r.floor || "", rate_per_night: String(r.rate_per_night), capacity: String(r.capacity), notes: r.notes || "" });
    setShowRoomForm(true);
  }

  async function saveRoom(e) {
    e.preventDefault();
    setSavingRoom(true);
    try {
      if (editingRoom) {
        await api.patch("/api/hotel/rooms", { id: editingRoom.id, ...roomForm, rate_per_night: Number(roomForm.rate_per_night) || 0, capacity: Number(roomForm.capacity) || 2 });
      } else {
        await api.post("/api/hotel/rooms", { ...roomForm, rate_per_night: Number(roomForm.rate_per_night) || 0, capacity: Number(roomForm.capacity) || 2 });
      }
      setShowRoomForm(false);
      load();
    } catch (err) { setError(err.message); }
    setSavingRoom(false);
  }

  async function deleteRoom(r) {
    if (!window.confirm(`Delete room ${r.room_number}?`)) return;
    try { await api.del(`/api/hotel/rooms?id=${r.id}`); load(); }
    catch (e) { setError(e.message); }
  }

  async function setRoomStatus(r, status) {
    try { await api.patch("/api/hotel/rooms", { id: r.id, status }); load(); }
    catch (e) { setError(e.message); }
  }

  // ---- bookings ----
  function openBookingAdd(room) {
    setPreselectedRoom(room || null);
    setBookingForm({
      room_id: room ? String(room.id) : "", guest_name: "", guest_phone: "", guest_id_type: "", guest_id_number: "",
      check_in: todayISO(), check_out: "", check_in_time: "14:00", check_out_time: "12:00", adults: "1", children: "0", notes: "",
    });
    setShowBookingForm(true);
  }

  async function saveBooking(e) {
    e.preventDefault();
    setSavingBooking(true);
    try {
      await api.post("/api/hotel/bookings", {
        room_id: Number(bookingForm.room_id),
        guest_name: bookingForm.guest_name,
        guest_phone: bookingForm.guest_phone || null,
        guest_id_type: bookingForm.guest_id_type || null,
        guest_id_number: bookingForm.guest_id_number || null,
        check_in: bookingForm.check_in,
        check_out: bookingForm.check_out,
        check_in_time: bookingForm.check_in_time || null,
        check_out_time: bookingForm.check_out_time || null,
        adults: Number(bookingForm.adults) || 1,
        children: Number(bookingForm.children) || 0,
        notes: bookingForm.notes || null,
      });
      setShowBookingForm(false);
      setTab("bookings");
      load();
    } catch (err) { setError(err.message); }
    setSavingBooking(false);
  }

  async function bookingAction(id, action) {
    const labels = { check_in: "check in this guest", cancel: "cancel this booking", no_show: "mark as no-show" };
    if (!window.confirm(`Are you sure you want to ${labels[action]}?`)) return;
    try {
      await api.patch("/api/hotel/bookings", { id, action });
      load();
      if (folioId === id) loadFolio(id);
    } catch (e) { setError(e.message); }
  }

  // ---- folio ----
  async function addCharge(e) {
    e.preventDefault();
    setFolioBusy(true);
    try {
      await api.post("/api/hotel/folio", {
        action: "charge", bookingId: folioId,
        category: chargeForm.category, description: chargeForm.description, amount: Number(chargeForm.amount),
      });
      setChargeForm({ category: "restaurant", description: "", amount: "" });
      loadFolio(folioId);
    } catch (err) { setError(err.message); }
    setFolioBusy(false);
  }

  async function addPayment(e) {
    e.preventDefault();
    setFolioBusy(true);
    try {
      await api.post("/api/hotel/folio", {
        action: "payment", bookingId: folioId,
        amount: Number(payForm.amount), mode: payForm.mode, note: payForm.note,
      });
      setPayForm({ amount: "", mode: payForm.mode, note: "" });
      loadFolio(folioId);
    } catch (err) { setError(err.message); }
    setFolioBusy(false);
  }

  async function checkout(e) {
    e.preventDefault();
    if (!window.confirm("Check out this guest? The room will be freed.")) return;
    setFolioBusy(true);
    try {
      await api.post("/api/hotel/folio", {
        action: "checkout", bookingId: folioId,
        amount: Number(checkoutForm.amount) || 0, mode: checkoutForm.mode, note: checkoutForm.note,
      });
      closeFolio();
      load();
    } catch (err) { setError(err.message); }
    setFolioBusy(false);
  }

  const modeOptions = modes.length ? modes : ["Cash", "Bank Transfer", "POS / Card"];

  return (
    <>
      <div className="page-head">
        <h1>🏨 Hotels</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {canManageRooms && <button className="btn btn-secondary btn-sm" onClick={openRoomAdd}>+ Room</button>}
          {canFrontdesk && <button className="btn btn-primary btn-sm" onClick={() => openBookingAdd(null)}>+ Booking</button>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {overview && (
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric-card"><span>Occupancy</span><strong>{overview.rooms.occupancyPct}%</strong></div>
          <div className="metric-card"><span>Vacant</span><strong>{overview.rooms.vacant}</strong></div>
          <div className="metric-card"><span>In-house guests</span><strong>{overview.inHouseGuests}</strong></div>
          <div className="metric-card"><span>Arrivals today</span><strong>{overview.arrivals}</strong></div>
          <div className="metric-card"><span>Departures today</span><strong>{overview.departures}</strong></div>
          <div className="metric-card"><span>Collected today</span><strong>{fmt(overview.revenueToday)}</strong></div>
        </div>
      )}

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["board", "Room board"], ["bookings", "Bookings"], ["rooms", "Manage rooms"]].map(([id, label]) => (
          <button key={id} className={"btn btn-sm " + (tab === id ? "btn-primary" : "btn-secondary")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loading ? <div className="loading">Loading...</div> : (<>
        {tab === "board" && (
          rooms.length === 0 ? <p className="empty">No rooms yet. Add your first room to start.</p> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {rooms.map((r) => (
                <div key={r.id} className="card" style={{ margin: 0, borderTop: `4px solid ${STATUS_COLORS[r.status] || "#999"}`, cursor: canManageRooms ? "pointer" : "default" }}
                  onClick={() => { if (canManageRooms) { setEditingRoom(r); openRoomEdit(r); } }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{r.room_number}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>{r.room_type} · {fmt(r.rate_per_night)}/night</div>
                  <div style={{ marginTop: 6 }}>
                    <span className="pill" style={{ background: STATUS_COLORS[r.status] + "22", color: STATUS_COLORS[r.status] }}>{r.status}</span>
                  </div>
                  {r.current_guest && <div style={{ fontSize: 12, marginTop: 6 }}>🧑 {r.current_guest}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                    {canFrontdesk && r.status === "vacant" && <button className="btn btn-secondary btn-sm" onClick={() => openBookingAdd(r)}>Book</button>}
                    {canHousekeeping && (r.status === "maintenance"
                      ? <button className="btn btn-secondary btn-sm" onClick={() => setRoomStatus(r, "vacant")}>Back in service</button>
                      : (r.status === "vacant" || r.status === "reserved") &&
                        <button className="btn btn-secondary btn-sm" onClick={() => setRoomStatus(r, "maintenance")}>Maintenance</button>)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "bookings" && (<>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="search" style={{ maxWidth: 220 }}>
              <option value="">All bookings</option>
              <option value="reserved">Reserved</option>
              <option value="checked_in">Checked in</option>
              <option value="checked_out">Checked out</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No-show</option>
            </select>
          </div>
          {bookings.length === 0 ? <p className="empty">No bookings found.</p> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Guest</th><th>Room</th><th>Dates</th><th>Status</th><th className="money">Balance</th><th></th></tr></thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.guest_name}</strong><br /><small style={{ color: "var(--muted)" }}>{b.guest_phone || ""}</small></td>
                    <td>{b.room_number} <small style={{ color: "var(--muted)" }}>({b.room_type})</small></td>
                    <td><small>{b.check_in}{b.check_in_time ? ` ${b.check_in_time}` : ""} → {b.check_out}{b.check_out_time ? ` ${b.check_out_time}` : ""}<br />{nightsBetween(b.check_in, b.check_out)} night(s)</small></td>
                    <td><span className="pill pill-green">{b.status.replace("_", " ")}</span></td>
                    <td className="money">{fmt((b.total_charged || 0) - (b.total_paid || 0))}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => loadFolio(b.id)}>Folio</button>{" "}
                      {canFrontdesk && b.status === "reserved" && <button className="btn btn-secondary btn-sm" onClick={() => bookingAction(b.id, "check_in")}>Check in</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>)}

        {tab === "rooms" && (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Room</th><th>Type</th><th>Floor</th><th className="money">Rate/night</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.room_number}</strong></td>
                  <td>{r.room_type}</td>
                  <td>{r.floor || "—"}</td>
                  <td className="money">{fmt(r.rate_per_night)}</td>
                  <td><span className="pill" style={{ background: STATUS_COLORS[r.status] + "22", color: STATUS_COLORS[r.status] }}>{r.status}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canManageRooms && <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openRoomEdit(r)}>Edit</button>{" "}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteRoom(r)}>Delete</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </>)}

      {/* Room form */}
      {showRoomForm && (
        <div className="modal-back" onClick={() => setShowRoomForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingRoom ? `Edit room ${editingRoom.room_number}` : "Add room"}</h2>
            <form onSubmit={saveRoom}>
              <div className="field"><div className="row2">
                <div><label>Room number *</label><input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} required /></div>
                <div><label>Room type</label><input value={roomForm.room_type} onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })} placeholder="Standard, Deluxe..." /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Rate per night *</label><input type="number" min="0" step="0.01" value={roomForm.rate_per_night} onChange={(e) => setRoomForm({ ...roomForm, rate_per_night: e.target.value })} required /></div>
                <div><label>Floor</label><input value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Capacity</label><input type="number" min="1" value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} /></div>
                <div><label>Notes</label><input value={roomForm.notes} onChange={(e) => setRoomForm({ ...roomForm, notes: e.target.value })} /></div>
              </div></div>
              <button className="btn btn-primary btn-block" disabled={savingRoom}>{savingRoom ? "Saving..." : "Save room"}</button>
            </form>
          </div>
        </div>
      )}

      {/* Booking form */}
      {showBookingForm && (
        <div className="modal-back" onClick={() => setShowBookingForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New booking{preselectedRoom ? ` — Room ${preselectedRoom.room_number}` : ""}</h2>
            <form onSubmit={saveBooking}>
              <div className="field"><label>Room *</label>
                <select value={bookingForm.room_id} onChange={(e) => setBookingForm({ ...bookingForm, room_id: e.target.value })} required>
                  <option value="">Select room...</option>
                  {rooms.filter((r) => r.status !== "maintenance").map((r) => (
                    <option key={r.id} value={r.id}>{r.room_number} — {r.room_type} ({fmt(r.rate_per_night)}/night)</option>
                  ))}
                </select>
              </div>
              <div className="field"><div className="row2">
                <div><label>Guest name *</label><input value={bookingForm.guest_name} onChange={(e) => setBookingForm({ ...bookingForm, guest_name: e.target.value })} required /></div>
                <div><label>Guest phone</label><input value={bookingForm.guest_phone} onChange={(e) => setBookingForm({ ...bookingForm, guest_phone: e.target.value })} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>ID type</label><input value={bookingForm.guest_id_type} onChange={(e) => setBookingForm({ ...bookingForm, guest_id_type: e.target.value })} placeholder="NIN, Driver's licence..." /></div>
                <div><label>ID number</label><input value={bookingForm.guest_id_number} onChange={(e) => setBookingForm({ ...bookingForm, guest_id_number: e.target.value })} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Check-in date *</label><input type="date" value={bookingForm.check_in} onChange={(e) => setBookingForm({ ...bookingForm, check_in: e.target.value })} required /></div>
                <div><label>Time</label><input type="time" value={bookingForm.check_in_time} onChange={(e) => setBookingForm({ ...bookingForm, check_in_time: e.target.value })} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Check-out date *</label><input type="date" value={bookingForm.check_out} onChange={(e) => setBookingForm({ ...bookingForm, check_out: e.target.value })} required /></div>
                <div><label>Time</label><input type="time" value={bookingForm.check_out_time} onChange={(e) => setBookingForm({ ...bookingForm, check_out_time: e.target.value })} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Adults</label><input type="number" min="1" value={bookingForm.adults} onChange={(e) => setBookingForm({ ...bookingForm, adults: e.target.value })} /></div>
                <div><label>Children</label><input type="number" min="0" value={bookingForm.children} onChange={(e) => setBookingForm({ ...bookingForm, children: e.target.value })} /></div>
              </div></div>
              <div className="field"><label>Notes</label><input value={bookingForm.notes} onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })} /></div>
              <button className="btn btn-primary btn-block" disabled={savingBooking}>{savingBooking ? "Saving..." : "Create booking"}</button>
            </form>
          </div>
        </div>
      )}

      {/* Folio */}
      {folioId && (
        <div className="modal-back" onClick={closeFolio}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            {folioLoading ? <div className="loading">Loading folio...</div> : folio && (<>
              <h2>Folio — {folio.booking.guest_name}</h2>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                Room {folio.booking.room_number} · {folio.booking.check_in}{folio.booking.check_in_time ? ` ${folio.booking.check_in_time}` : ""} → {folio.booking.check_out}{folio.booking.check_out_time ? ` ${folio.booking.check_out_time}` : ""} · {folio.booking.status.replace("_", " ")}
              </p>

              <h3>Charges</h3>
              {folio.charges.length === 0 ? <p className="hint">No charges yet.</p> : (
                <div className="table-wrap"><table className="data">
                  <tbody>
                    {folio.charges.map((c) => (
                      <tr key={c.id}><td>{c.description}<br /><small style={{ color: "var(--muted)" }}>{c.category}</small></td><td className="money">{fmt(c.amount)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
              {canFrontdesk && ["reserved", "checked_in"].includes(folio.booking.status) && (
                <form onSubmit={addCharge} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <select value={chargeForm.category} onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}>
                    {CHARGE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input placeholder="Description" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} required style={{ flex: "1 1 140px" }} />
                  <input type="number" min="0" step="0.01" placeholder="Amount" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} required style={{ width: 110 }} />
                  <button className="btn btn-secondary btn-sm" disabled={folioBusy}>Add</button>
                </form>
              )}

              <h3 style={{ marginTop: 16 }}>Payments</h3>
              {folio.payments.length === 0 ? <p className="hint">No payments yet.</p> : (
                <div className="table-wrap"><table className="data">
                  <tbody>
                    {folio.payments.map((p) => (
                      <tr key={p.id}><td>{p.mode}{p.note ? ` — ${p.note}` : ""}<br /><small style={{ color: "var(--muted)" }}>{(p.created_at || "").slice(0, 16).replace("T", " ")}</small></td><td className="money">{fmt(p.amount)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
              {canFrontdesk && ["reserved", "checked_in"].includes(folio.booking.status) && (
                <form onSubmit={addPayment} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <input type="number" min="0" step="0.01" placeholder="Amount" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required style={{ width: 110 }} />
                  <select value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                    {modeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input placeholder="Note" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} style={{ flex: "1 1 120px" }} />
                  <button className="btn btn-secondary btn-sm" disabled={folioBusy}>Record</button>
                </form>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontWeight: 700 }}>
                <span>Total charged: {fmt(folio.totalCharged)}</span>
                <span>Paid: {fmt(folio.totalPaid)}</span>
                <span style={{ color: folio.balance > 0 ? "var(--danger)" : "inherit" }}>Balance: {fmt(folio.balance)}</span>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {canFrontdesk && folio.booking.status === "reserved" && (
                  <button className="btn btn-primary btn-sm" onClick={() => bookingAction(folio.booking.id, "check_in")}>Check in</button>
                )}
                {canFrontdesk && folio.booking.status === "checked_in" && !showCheckout && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowCheckout(true)}>Check out</button>
                )}
                {canFrontdesk && folio.booking.status === "reserved" && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => bookingAction(folio.booking.id, "cancel")}>Cancel</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => bookingAction(folio.booking.id, "no_show")}>No-show</button>
                  </>
                )}
                <button className="btn btn-secondary btn-sm" onClick={closeFolio}>Close</button>
                <a className="btn btn-secondary btn-sm" href={`/app/receipt/hotel/${folio.booking.id}`} target="_blank" rel="noreferrer">🖨️ Receipt</a>
              </div>

              {showCheckout && (
                <form onSubmit={checkout} style={{ marginTop: 16, padding: 12, background: "var(--bg)", borderRadius: 10 }}>
                  <h3 style={{ marginTop: 0 }}>Check out — final payment</h3>
                  <p className="hint">Balance due: {fmt(folio.balance)}. Record the final payment or leave at 0.</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input type="number" min="0" step="0.01" placeholder="Amount" value={checkoutForm.amount} onChange={(e) => setCheckoutForm({ ...checkoutForm, amount: e.target.value })} style={{ width: 120 }} />
                    <select value={checkoutForm.mode} onChange={(e) => setCheckoutForm({ ...checkoutForm, mode: e.target.value })}>
                      {modeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" disabled={folioBusy}>{folioBusy ? "..." : "Confirm checkout"}</button>
                  </div>
                </form>
              )}
            </>)}
          </div>
        </div>
      )}
    </>
  );
}
