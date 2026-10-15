import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";
import { normalizeNaijaPhone } from "../lib/whatsapp";

function parseContactsCsv(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^name/i.test(line)) continue;
    const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    let phone = "";
    let nameParts = [];
    for (const p of parts) {
      if (!phone && /[0-9]{7,}/.test(p)) phone = p;
      else nameParts.push(p);
    }
    const name = nameParts.join(" ").slice(0, 80);
    if (name && phone) out.push({ name, phone });
  }
  return out;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState([]);
  const [contactsCount, setContactsCount] = useState(0);
  const [showContacts, setShowContacts] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);

  async function loadContacts() {
    try {
      const d = await api.get("/api/phone-contacts");
      setPhoneContacts(d.contacts || []);
      setContactsCount(d.count || 0);
    } catch { /* optional feature */ }
  }

  async function load(search) {
    setLoading(true);
    try {
      const d = await api.get("/api/customers" + (search ? `?q=${encodeURIComponent(search)}` : ""));
      setCustomers(d.customers); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(""); loadContacts(); }, []);

  const contactDigits = new Set(phoneContacts.map((c) => normalizeNaijaPhone(c.phone)).filter(Boolean));
  const isInContacts = (phone) => {
    const d = normalizeNaijaPhone(phone);
    return d && contactDigits.has(d);
  };

  async function importContacts(list) {
    if (!list.length) { setError("No contacts found to import."); return; }
    setImporting(true);
    try {
      const d = await api.post("/api/phone-contacts", { contacts: list });
      setError("");
      alert(`Imported ${d.imported} phone contacts.`);
      setCsvText("");
      loadContacts();
    } catch (err) { setError(err.message); }
    setImporting(false);
  }

  async function pickFromPhone() {
    try {
      if (!navigator.contacts || !navigator.contacts.select) {
        setError("Your browser does not support picking contacts. Use the CSV option instead.");
        return;
      }
      const picked = await navigator.contacts.select(["name", "tel"], { multiple: true });
      const list = [];
      for (const p of picked) {
        const name = (p.name && p.name[0]) || "";
        for (const t of (p.tel || [])) list.push({ name, phone: t });
      }
      await importContacts(list);
    } catch (err) {
      if (err && err.name !== "NotAllowedError") setError("Could not read contacts: " + err.message);
    }
  }

  async function clearContacts() {
    if (!window.confirm(`Remove all ${contactsCount} imported phone contacts?`)) return;
    try {
      await api.del("/api/phone-contacts?id=all");
      loadContacts();
    } catch (err) { setError(err.message); }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api.post("/api/customers", form);
      setShowForm(false); setForm({ name: "", phone: "", notes: "" });
      load(q);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  const withPhones = customers.filter((c) => c.phone).length;
  const owing = customers.filter((c) => Number(c.outstanding) > 0).length;

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowContacts(true)}>
            📱 Contacts{contactsCount > 0 ? ` (${contactsCount})` : ""}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add customer</button>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 12 }}>
        <div className="metric-card"><span>Total customers</span><strong>{customers.length}</strong></div>
        <div className="metric-card"><span>With WhatsApp</span><strong>{withPhones}</strong></div>
        <div className="metric-card"><span>Owing</span><strong>{owing}</strong></div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search name, phone or tag..." value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Phone</th><th>Tags</th><th>Outstanding</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => {
                const tags = String(c.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
                return (
                  <tr key={c.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {c.photo_key ? (
                          <img src={`/api/files?key=${encodeURIComponent(c.photo_key)}`} alt=""
                            style={{ width: 32, height: 32, objectFit: "cover", borderRadius: "50%" }} />
                        ) : null}
                        <strong>{c.name}</strong>
                      </span>{isInContacts(c.phone) && <span title="In your phone contacts"> 📱</span>}</td>
                    <td>{c.phone || "—"}</td>
                    <td>{tags.length ? tags.map((t) => <span key={t} className="pill pill-green" style={{ marginRight: 4 }}>{t}</span>) : <small style={{ color: "var(--muted)" }}>—</small>}</td>
                    <td className={Number(c.outstanding) > 0 ? "money debt-amt" : "money"}>{fmt(c.outstanding)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => nav(`/app/customers/${c.id}`)}>View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {customers.length === 0 && <p className="empty">No customers yet. Add your first one above.</p>}
        </div>
      )}

      {showContacts && (
        <div className="modal-back" onClick={() => setShowContacts(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>📱 Phone contacts</h2>
            <p className="hint">
              Import your phone's real contacts so KopaBook can match them against your customers.
              Matching customers get a 📱 badge. Your contacts stay in your own business database.
            </p>
            <p><strong>{contactsCount}</strong> contacts imported.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={pickFromPhone} disabled={importing}>
                {importing ? "Importing..." : "Pick from phone"}
              </button>
              {contactsCount > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={clearContacts}>Clear all</button>
              )}
            </div>
            <div className="field"><label>Or paste CSV (name, phone per line)</label>
              <textarea rows={4} value={csvText} onChange={(e) => setCsvText(e.target.value)}
                placeholder={"Mama Nkechi, 08031234567\nJohn Okafor, +2348031234568"} />
            </div>
            <button className="btn btn-secondary btn-block" disabled={importing || !csvText.trim()}
              onClick={() => importContacts(parseContactsCsv(csvText))}>
              {importing ? "Importing..." : "Import pasted contacts"}
            </button>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setShowContacts(false)}>Close</button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add customer</h2>
            <p className="hint">Just a name gets them in the book. Add the WhatsApp number when you have it.</p>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus /></div>
              <div className="field"><label>Phone (WhatsApp)</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." inputMode="tel" /></div>
              <div className="field"><label>Notes</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything to remember..." /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save customer"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
