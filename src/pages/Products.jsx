import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";

const emptyForm = { name: "", sku: "", unitPrice: "", costPrice: "", openingQuantity: "", lowStockThreshold: "5", category: "" };

export default function ProductsPage({ session }) {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory(p) {
    setHistoryFor(p); setHistoryRows([]); setHistoryLoading(true);
    try {
      const d = await api.get(`/api/products/${p.id}/movements`);
      setHistoryRows(d.movements || []);
    } catch (e) { setError(e.message); }
    setHistoryLoading(false);
  }

  const canManage = session.perms?.can_manage_products;

  async function load(search) {
    setLoading(true);
    try {
      const d = await api.get("/api/products" + (search ? `?q=${encodeURIComponent(search)}` : ""));
      setProducts(d.products);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(""); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function openAdd() { setEditing(null); setForm(emptyForm); setPhotoFile(null); setShowForm(true); }
  function openEdit(p) {
    setEditing(p);
    setPhotoFile(null);
    setForm({
      name: p.name, sku: p.sku || "", unitPrice: String(p.unit_price),
      costPrice: String(p.cost_price || ""), openingQuantity: "",
      lowStockThreshold: String(p.low_stock_threshold ?? 5), category: p.category || "",
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/products/${editing.id}`, {
          name: form.name, sku: form.sku || null,
          unitPrice: Number(form.unitPrice), costPrice: Number(form.costPrice || 0),
          lowStockThreshold: Number(form.lowStockThreshold || 5),
          category: form.category || null,
        });
      } else {
        await api.post("/api/products", {
          name: form.name, sku: form.sku || null,
          unitPrice: Number(form.unitPrice), costPrice: Number(form.costPrice || 0),
          openingQuantity: Number(form.openingQuantity || 0),
          lowStockThreshold: Number(form.lowStockThreshold || 5),
          category: form.category || null,
        });
      }
      setShowForm(false);
      load(q);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function uploadPhoto() {
    if (!photoFile || !editing) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("productId", editing.id);
      fd.append("photo", photoFile);
      const res = await fetch("/api/product-photo", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || "Upload failed.");
      setPhotoFile(null);
      setEditing({ ...editing, photo_key: d.key });
      setError("");
      load(q);
    } catch (err) { setError(err.message); }
    setUploading(false);
  }

  async function removePhoto() {
    if (!editing || !window.confirm("Remove this product photo?")) return;
    try {
      const res = await fetch(`/api/product-photo?productId=${editing.id}`, { method: "DELETE", credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || "Could not remove photo.");
      setEditing({ ...editing, photo_key: null });
      load(q);
    } catch (err) { setError(err.message); }
  }

  async function archive(p) {
    if (!window.confirm(`Archive "${p.name}"? It will be hidden but its history stays.`)) return;
    try { await api.del(`/api/products/${p.id}`); load(q); }
    catch (e) { setError(e.message); }
  }

  async function adjust(p) {
    const delta = Number(adjustQty);
    if (!delta) return;
    try {
      await api.post("/api/stock/adjust", { productId: p.id, quantityDelta: delta, note: adjustNote || "Manual adjustment" });
      setAdjusting(null); setAdjustQty(""); setAdjustNote("");
      load(q);
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="page-head">
        <h1>Products</h1>
        {canManage && <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add product</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search products..." value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading products...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {products.map((p) => {
                const low = Number(p.stock) <= Number(p.reorder_level);
                return (
                  <tr key={p.id}>
                    <td>
                      {p.photo_key && (
                        <img src={`/api/product-photo?key=${encodeURIComponent(p.photo_key)}`} alt=""
                          style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, marginRight: 8, verticalAlign: "middle" }} />
                      )}
                      <strong>{p.name}</strong><br /><small style={{ color: "var(--muted)" }}>{p.sku ? <span className="pill pill-gray" style={{ fontSize: 11 }}>ID: {p.sku}</span> : ""}{p.category ? ` · ${p.category}` : ""}</small>
                    </td>
                    <td className="money">{fmt(p.unit_price)}</td>
                    <td>
                      <span className={"pill " + (low ? "pill-gold" : "pill-green")}>{p.stock}</span>
                    </td>
                    <td>{low ? <span className="pill pill-gold">Low stock</span> : <span className="pill pill-green">OK</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {canManage && <>
                        <button className="btn btn-secondary btn-sm" onClick={() => setAdjusting(p.id)}>Stock</button>{" "}
                        <button className="btn btn-secondary btn-sm" onClick={() => openHistory(p)}>History</button>{" "}
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Edit</button>{" "}
                        {["owner", "partner"].includes(session.business?.role) && (
                          <button className="btn btn-danger btn-sm" onClick={() => archive(p)}>Archive</button>
                        )}
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {products.length === 0 && <p className="empty">No products yet. Add your first product to start selling.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit product" : "Add product"}</h2>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
              <div className="field"><div className="row2">
                <div><label>Product ID (auto if blank)</label><input value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="e.g. KB-0001" /></div>
                <div><label>Category</label><input value={form.category} onChange={(e) => set("category", e.target.value)} /></div>
              </div></div>
              <div className="field"><div className="row2">
                <div><label>Selling price *</label><input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} required /></div>
                <div><label>Cost price</label><input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></div>
              </div></div>
              <div className="field"><div className="row2">
                {!editing && <div><label>Opening stock</label><input type="number" step="0.01" value={form.openingQuantity} onChange={(e) => set("openingQuantity", e.target.value)} /></div>}
                <div><label>Low-stock alert at</label><input type="number" min="0" step="0.01" value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} /></div>
              </div></div>
              {editing && (
                <div className="field"><label>Photo</label>
                  {editing.photo_key && (
                    <div style={{ marginBottom: 8 }}>
                      <img src={`/api/product-photo?key=${encodeURIComponent(editing.photo_key)}`} alt=""
                        style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 12 }} />
                    </div>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files[0] || null)} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!photoFile || uploading} onClick={uploadPhoto}>
                      {uploading ? "Uploading..." : "Upload photo"}
                    </button>
                    {editing.photo_key && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={removePhoto}>Remove</button>
                    )}
                  </div>
                  <p className="hint">Stored in your R2 bucket, under 3 MB.</p>
                </div>
              )}
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save product"}</button>
            </form>
          </div>
        </div>
      )}

      {adjusting && (
        <div className="modal-back" onClick={() => setAdjusting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Adjust stock</h2>
            <p style={{ color: "var(--muted)" }}>Use a positive number to add stock, negative to remove.</p>
            <div className="field"><label>Quantity change</label><input type="number" step="0.01" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} placeholder="e.g. 10 or -3" /></div>
            <div className="field"><label>Note</label><input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Reason for adjustment" /></div>
            <button className="btn btn-primary btn-block" onClick={() => adjust(products.find((p) => p.id === adjusting))}>Apply adjustment</button>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="modal-back" onClick={() => setHistoryFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Goods tracking</h2>
            <p style={{ marginTop: 0 }}>
              <strong>{historyFor.name}</strong>{" "}
              {historyFor.sku && <span className="pill pill-gray">ID: {historyFor.sku}</span>}
            </p>
            {historyLoading ? <p className="hint">Loading movements...</p> : historyRows.length === 0 ? (
              <p className="empty">No movements recorded yet.</p>
            ) : (
              <table className="data" style={{ margin: 0 }}>
                <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead>
                <tbody>
                  {historyRows.map((m) => (
                    <tr key={m.id}>
                      <td><small>{m.created_at?.slice(0, 16).replace("T", " ")}</small></td>
                      <td>
                        {m.movement_type === "sale" && <span className="pill pill-green">Sold</span>}
                        {m.movement_type === "opening" && <span className="pill pill-gray">Opening</span>}
                        {m.movement_type === "adjustment" && <span className="pill pill-gold">Adjusted</span>}
                        {!["sale", "opening", "adjustment"].includes(m.movement_type) && m.movement_type}
                      </td>
                      <td className="money" style={{ color: Number(m.quantity_delta) < 0 ? "var(--danger)" : "var(--brand-dark)" }}>
                        {Number(m.quantity_delta) > 0 ? "+" : ""}{m.quantity_delta}
                      </td>
                      <td><small>{m.note || "—"}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setHistoryFor(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
