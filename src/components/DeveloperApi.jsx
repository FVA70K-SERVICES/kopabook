import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Developer API section for Settings. Desktop only (see .desktop-only)
// so the mobile layout stays clean.
export default function DeveloperApi() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const d = await api.get("/api/api-keys");
      setKeys(d.keys || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setCreating(true); setError("");
    try {
      const d = await api.post("/api/api-keys", { name: name.trim() || "Untitled key" });
      setNewKey(d.key);
      setName("");
      load();
    } catch (err) { setError(err.message); }
    setCreating(false);
  }

  async function revoke(id) {
    if (!window.confirm("Revoke this key? Apps using it will stop working immediately.")) return;
    try {
      await api.del("/api/api-keys?id=" + id);
      load();
    } catch (e) { setError(e.message); }
  }

  function copy() {
    try { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable */ }
  }

  return (
    <div className="desktop-only">
      <h3 style={{ marginTop: 0 }}>🔑 Developer API</h3>
      <p className="hint">
        Connect this business to anything: your website, a custom dashboard, WhatsApp bots.
        Keys are read-only and only see this business.{" "}
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDocs(!showDocs)} style={{ marginLeft: 4 }}>
          {showDocs ? "Hide how it works" : "How it works"}
        </button>
      </p>

      {showDocs && (
        <div className="card" style={{ background: "#f8faf9", fontSize: 14 }}>
          <strong>1. Create a key below.</strong> Copy it once, it is never shown again.<br /><br />
          <strong>2. Send it with every request</strong> as an Authorization header:
          <pre style={{ background: "#1a2b49", color: "#e2e8f0", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>
{`curl https://kopabook.com/api/v1/dashboard \\
  -H "Authorization: Bearer kbk_live_YOUR_KEY"`}</pre>
          <strong>3. Available endpoints</strong> (all GET, all read-only):
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            <li><code>/api/v1/business</code> — business info</li>
            <li><code>/api/v1/dashboard</code> — today's sales, stock, debts at a glance</li>
            <li><code>/api/v1/sales?limit=20</code> — recent sales</li>
            <li><code>/api/v1/products?limit=50</code> — products and stock</li>
            <li><code>/api/v1/debts</code> — customers owing money</li>
            <li><code>/api/v1/expenses?limit=20</code> — recent expenses</li>
          </ul>
          <strong>4. Limits.</strong> 60 requests per minute per key. Revoke a key any time and
          every app using it stops working immediately.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {newKey && (
        <div className="alert alert-ok" style={{ wordBreak: "break-all" }}>
          <strong>Copy your key now. It will never be shown again.</strong><br />
          <code style={{ fontSize: 14 }}>{newKey}</code><br />
          <button className="btn btn-secondary btn-sm" onClick={copy} style={{ marginTop: 8 }}>
            {copied ? "Copied!" : "Copy key"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setNewKey(null)} style={{ marginTop: 8, marginLeft: 8 }}>
            Done
          </button>
        </div>
      )}

      <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder="Key name, e.g. My website" style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" disabled={creating}>
          {creating ? "Creating..." : "+ New key"}
        </button>
      </form>

      {loading && <div className="loading">Loading keys...</div>}
      {!loading && keys.length === 0 && (
        <p className="hint">No API keys yet. Create one to connect this business anywhere.</p>
      )}
      {keys.map((k) => (
        <div key={k.id} className="card" style={{ margin: "0 0 8px", padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <strong>{k.name}</strong>{" "}
              <code style={{ fontSize: 12, color: "#666" }}>{k.key_prefix}...</code>
              {k.status === "revoked" && (
                <span style={{ fontSize: 12, color: "#b3261e", marginLeft: 8 }}>revoked</span>
              )}
              <div style={{ fontSize: 12, color: "#888" }}>
                Created {k.created_at?.slice(0, 10)}
                {k.last_used_at ? ` · Last used ${k.last_used_at.slice(0, 16).replace("T", " ")}` : " · Never used"}
              </div>
            </div>
            {k.status === "active" && (
              <button className="btn btn-secondary btn-sm" onClick={() => revoke(k.id)}>Revoke</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
