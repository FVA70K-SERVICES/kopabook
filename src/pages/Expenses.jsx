import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

export default function ExpensesPage({ session }) {
  const canManageExpenses = session?.perms?.can_manage_expenses;
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", categoryId: "", categoryName: "", note: "", incurredOn: todayISO() });
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);

  async function attachReceipt(expenseId, file) {
    if (!file) return;
    setUploadingId(expenseId);
    try {
      const fd = new FormData();
      fd.append("folder", "expenses");
      fd.append("refId", expenseId);
      fd.append("file", file);
      const res = await fetch("/api/files", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || "Upload failed.");
      setError("");
      load();
    } catch (e) { setError(e.message); }
    setUploadingId(null);
  }

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/expenses?from=${from}&to=${to}`);
      setExpenses(d.expenses); setCategories(d.categories); setTotal(d.total);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [from, to]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/expenses", {
        amount: Number(form.amount),
        categoryId: form.categoryId || undefined,
        categoryName: !form.categoryId ? form.categoryName : undefined,
        note: form.note || undefined,
        incurredOn: form.incurredOn,
      });
      setShowForm(false);
      setForm({ amount: "", categoryId: "", categoryName: "", note: "", incurredOn: todayISO() });
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  return (
    <>
      <div className="page-head">
        <h1>Expenses</h1>
        {canManageExpenses && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add expense</button>}
      </div>

      <div className="toolbar">
        <input type="date" className="search" style={{ minWidth: 0 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="search" style={{ minWidth: 0 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="pill pill-gray">Total: <strong className="money">{fmt(total)}</strong></span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th><th>Receipt</th></tr></thead>
            <tbody>
              {expenses.map((x) => (
                <tr key={x.id}>
                  <td>{x.incurred_on}</td>
                  <td>{x.category_name || "—"}</td>
                  <td>{x.note || "—"}{x.supplier_name && <span className="pill pill-gold" style={{ marginLeft: 6 }}>{x.supplier_name}</span>}</td>
                  <td className="money">{fmt(x.amount)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {x.receipt_key ? (
                      <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer"
                        href={`/api/files?key=${encodeURIComponent(x.receipt_key)}`}>View</a>
                    ) : canManageExpenses ? (
                      <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                        {uploadingId === x.id ? "..." : "Attach"}
                        <input type="file" accept="image/*,.pdf" style={{ display: "none" }}
                          onChange={(e) => attachReceipt(x.id, e.target.files[0])} />
                      </label>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && <p className="empty">No expenses in this range.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add expense</h2>
            <form onSubmit={save}>
              <div className="field"><label>Amount *</label><input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} required /></div>
              <div className="field"><label>Category</label>
                <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">Select or type new...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {!form.categoryId && (
                <div className="field"><label>New category name</label><input value={form.categoryName} onChange={(e) => set("categoryName", e.target.value)} placeholder="e.g. Packaging" /></div>
              )}
              <div className="field"><div className="row2">
                <div><label>Date</label><input type="date" value={form.incurredOn} onChange={(e) => set("incurredOn", e.target.value)} /></div>
                <div><label>Note</label><input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional" /></div>
              </div></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save expense"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
