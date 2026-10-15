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

  const canManage = ["owner", "manager"].includes(session.business?.role);

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

  function openAdd() { setEditing(null); setForm(emptyForm); setShowForm(true); }
  function openEdit(p) {
    setEditing(p);
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
                    <td><strong>{p.name}</strong><br /><small style={{ color: "var(--muted)" }}>{p.sku || ""}{p.category ? ` · ${p.category}` : ""}</small></td>
                    <td className="money">{fmt(p.unit_price)}</td>
                    <td>
                      <span className={"pill " + (low ? "pill-gold" : "pill-green")}>{p.stock}</span>
                    </td>
                    <td>{low ? <span className="pill pill-gold">Low stock</span> : <span className="pill pill-green">OK</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {canManage && <>
                        <button className="btn btn-secondary btn-sm" onClick={() => setAdjusting(p.id)}>Stock</button>{" "}
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Edit</button>{" "}
                        {session.business?.role === "owner" && (
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
                <div><label>SKU</label><input value={form.sku} onChange={(e) => set("sku", e.target.value)} /></div>
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
    </>
  );
}
