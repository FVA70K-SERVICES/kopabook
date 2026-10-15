import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

function statusPill(status) {
  const label = { unverified: "Unverified", pending: "Pending", verified: "Verified" }[status] || status;
  const cls =
    status === "verified" ? "pill-green" : status === "pending" ? "pill-gold" : "pill-gray";
  return <span className={"pill " + cls}>{label}</span>;
}

function Stars({ value, onRate, small }) {
  const [hover, setHover] = useState(0);
  const active = hover || Math.round(value || 0);
  return (
    <span style={{ display: "inline-flex", gap: 2 }} role="radiogroup" aria-label="Rate supplier">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="btn btn-sm"
          style={{
            padding: small ? "2px 6px" : "4px 8px",
            border: "none",
            background: "transparent",
            color: n <= active ? "#d4a017" : "#c9cfc9",
            fontSize: small ? 18 : 24,
            cursor: "pointer",
          }}
          onClick={() => onRate(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
        >
          {"\u2605"}
        </button>
      ))}
    </span>
  );
}

export default function SuppliersPage({ session }) {
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);

  const [purchaseFor, setPurchaseFor] = useState(null);
  const [pform, setPform] = useState({ amount: "", note: "", date: todayISO() });
  const [psaving, setPsaving] = useState(false);
  const [pwarning, setPwarning] = useState("");

  const canManage = session.business?.role === "owner" || session.business?.role === "manager";
  const isOwner = session.business?.role === "owner";

  async function load(search) {
    setLoading(true);
    try {
      const d = await api.get("/api/suppliers" + (search ? `?q=${encodeURIComponent(search)}` : ""));
      setSuppliers(d.suppliers);
      setError("");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }
  useEffect(() => { load(""); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function pset(k, v) { setPform((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/suppliers", form);
      setShowForm(false);
      setForm({ name: "", phone: "", address: "" });
      setNotice("Supplier added.");
      load(q);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function setStatus(supplier, status) {
    try {
      await api.post("/api/suppliers/verify", { supplierId: supplier.id, status });
      setNotice(`"${supplier.name}" is now ${status}.`);
      load(q);
    } catch (err) {
      setError(err.message);
    }
  }

  async function rate(supplier, n) {
    try {
      await api.patch(`/api/suppliers/${supplier.id}`, { rating: n });
      setNotice(`Rated "${supplier.name}" ${n} of 5.`);
      load(q);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(supplier) {
    if (!window.confirm(`Delete supplier "${supplier.name}"?`)) return;
    try {
      await api.del(`/api/suppliers/${supplier.id}`);
      setNotice("Supplier deleted.");
      load(q);
    } catch (err) {
      setError(err.message);
    }
  }

  function openPurchase(s) {
    setPurchaseFor(s);
    setPform({ amount: "", note: "", date: todayISO() });
    setPwarning(s.verification_status === "unverified"
      ? "This supplier is not verified yet. Confirm their details before paying."
      : "");
  }

  async function savePurchase(e) {
    e.preventDefault();
    setPsaving(true);
    setPwarning("");
    try {
      const d = await api.post("/api/suppliers/purchase", {
        supplierId: purchaseFor.id,
        amount: Number(pform.amount),
        note: pform.note,
        purchasedOn: pform.date,
      });
      if (d.warning) setPwarning(d.message);
      setNotice(`Purchase of ${fmt(pform.amount)} recorded for "${purchaseFor.name}".`);
      setPurchaseFor(null);
      load(q);
    } catch (err) {
      setError(err.message);
    }
    setPsaving(false);
  }

  return (
    <>
      <div className="page-head">
        <h1>Suppliers</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add supplier</button>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search suppliers..."
          value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert" onClick={() => setNotice("")}>{notice}</div>}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : suppliers.length === 0 ? (
        <p className="empty">No suppliers yet. Add your first supplier above.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {suppliers.map((s) => (
            <div className="card" key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{s.name}</strong>
                  <div style={{ marginTop: 4 }}>{statusPill(s.verification_status)}</div>
                </div>
                <div className="money" style={{ fontSize: 13 }}>
                  {Number(s.trade_count || 0)} trade{Number(s.trade_count || 0) === 1 ? "" : "s"}
                </div>
              </div>

              {s.phone && <div style={{ marginTop: 6, fontSize: 14 }}>{s.phone}</div>}
              {s.address && <div style={{ fontSize: 13, color: "#666" }}>{s.address}</div>}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Stars value={s.rating} small onRate={(n) => rate(s, n)} />
                <small style={{ color: "#666" }}>
                  {Number(s.rating_count) > 0
                    ? `${Number(s.rating).toFixed(1)} avg (${s.rating_count} rating${Number(s.rating_count) === 1 ? "" : "s"})`
                    : "Tap a star to rate"}
                </small>
              </div>

              <div className="row2" style={{ marginTop: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openPurchase(s)}>
                  Record purchase
                </button>
                {isOwner && (
                  <button className="btn btn-secondary btn-sm" onClick={() => remove(s)}>
                    Delete
                  </button>
                )}
              </div>

              {canManage && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {s.verification_status !== "verified" && (
                    <button className="btn btn-sm" onClick={() => setStatus(s, "verified")}>
                      Verify
                    </button>
                  )}
                  {s.verification_status === "unverified" && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setStatus(s, "pending")}>
                      Mark pending
                    </button>
                  )}
                  {(s.verification_status === "verified" || s.verification_status === "pending") && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setStatus(s, "unverified")}>
                      Unverify
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add supplier</h2>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
              <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              <div className="field"><label>Address</label><input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save supplier"}</button>
            </form>
          </div>
        </div>
      )}

      {purchaseFor && (
        <div className="modal-back" onClick={() => setPurchaseFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Record purchase</h2>
            <p style={{ marginTop: 0 }}>Supplier: <strong>{purchaseFor.name}</strong> {statusPill(purchaseFor.verification_status)}</p>
            {pwarning && <div className="alert alert-error">{pwarning}</div>}
            <form onSubmit={savePurchase}>
              <div className="field"><label>Amount (NGN) *</label><input type="number" min="1" step="any" value={pform.amount} onChange={(e) => pset("amount", e.target.value)} required /></div>
              <div className="field"><label>Note</label><input value={pform.note} onChange={(e) => pset("note", e.target.value)} placeholder="What was bought" /></div>
              <div className="field"><label>Date</label><input type="date" value={pform.date} onChange={(e) => pset("date", e.target.value)} /></div>
              <button className="btn btn-primary btn-block" disabled={psaving}>{psaving ? "Saving..." : "Save purchase"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
