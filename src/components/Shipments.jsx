import { useEffect, useState } from "react";
import { api } from "../lib/api";

const STATUS_LABEL = {
  pending: "Pending",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_PILL = {
  pending: "pill-gold",
  shipped: "pill-gray",
  delivered: "pill-green",
  cancelled: "pill-red",
};

// Modal: generate a tracking number for a sold product that is being shipped.
export function ShipmentModal({ sale, onClose, onCreated }) {
  const [form, setForm] = useState({
    recipientName: sale?.customer_name || "",
    recipientPhone: "",
    address: "",
    courier: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const d = await api.post("/api/shipments", { saleId: sale.id, ...form });
      setTracking(d.tracking);
      onCreated();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {tracking ? (
          <>
            <h2>Tracking generated</h2>
            <p>Share this tracking number with the customer:</p>
            <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2, fontFamily: "monospace" }}>{tracking}</p>
            <p className="hint">Sale {sale.sale_number} · {form.recipientName || "customer"}</p>
            <button className="btn btn-primary btn-block" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <h2>Ship sale {sale.sale_number}</h2>
            <p className="hint">A tracking number will be generated for this shipment.</p>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field"><label>Recipient name</label><input value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))} placeholder="Customer name" /></div>
              <div className="field"><label>Recipient phone</label><input value={form.recipientPhone} onChange={(e) => setForm((f) => ({ ...f, recipientPhone: e.target.value }))} placeholder="080..." /></div>
              <div className="field"><label>Delivery address</label><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street, city, state" /></div>
              <div className="field"><label>Courier (optional)</label><input value={form.courier} onChange={(e) => setForm((f) => ({ ...f, courier: e.target.value }))} placeholder="e.g. GIG, DHL, driver name" /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Generating..." : "Generate tracking number"}</button>
              <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// Tab: track every shipment and move it through pending -> shipped -> delivered.
export function ShipmentsTab() {
  const [shipments, setShipments] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const q = status ? `?status=${status}` : "";
      const d = await api.get("/api/shipments" + q);
      setShipments(d.shipments || []);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [status]);

  async function setShipStatus(id, next) {
    try {
      await api.patch("/api/shipments", { id, status: next });
      load();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All shipments</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Tracking</th><th>Sale</th><th>Recipient</th><th>Courier</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {shipments.map((sh) => (
                <tr key={sh.id}>
                  <td><strong style={{ fontFamily: "monospace", letterSpacing: 1 }}>{sh.tracking_number}</strong></td>
                  <td>{sh.sale_number}</td>
                  <td>
                    {sh.recipient_name || sh.customer_name || "—"}
                    {sh.address && <div><small style={{ color: "var(--muted)" }}>{sh.address}</small></div>}
                  </td>
                  <td>{sh.courier || "—"}</td>
                  <td><span className={"pill " + (STATUS_PILL[sh.status] || "pill-gray")}>{STATUS_LABEL[sh.status] || sh.status}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <select
                      value={sh.status}
                      onChange={(e) => setShipStatus(sh.id, e.target.value)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: "4px 8px" }}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {shipments.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No shipments yet. Open a sale in History and tap Ship.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
