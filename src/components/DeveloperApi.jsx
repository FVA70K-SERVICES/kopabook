import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Developer API section for Settings. Desktop only (see .desktop-only)
// so the mobile layout stays clean.
export default function DeveloperApi() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [newKey, setNewKey] = useState(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState("");
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
      const d = await api.post("/api/api-keys", {
        name: name.trim() || websiteUrl.trim() || "Untitled key",
        website_url: websiteUrl.trim(),
      });
      setNewKey(d.key);
      setNewKeyName(name.trim() || websiteUrl.trim() || "Untitled key");
      setName(""); setWebsiteUrl("");
      load();
    } catch (err) { setError(err.message); }
    setCreating(false);
  }

  async function revoke(id) {
    if (!window.confirm("Revoke this key? Every website or app using it will stop working immediately.")) return;
    try {
      await api.del("/api/api-keys?id=" + id);
      load();
    } catch (e) { setError(e.message); }
  }

  function copy(text, which) {
    try {
      navigator.clipboard.writeText(text);
      setCopied(which); setTimeout(() => setCopied(""), 2000);
    } catch { /* clipboard unavailable */ }
  }

  const snippet = `<script src="https://kopabook.com/connect.js"></script>
<script>
  const kb = KopaBook.connect("${newKey || "kbk_live_YOUR_KEY"}");
  // Live products with stock, straight from your KopaBook:
  const { products } = await kb.products({ limit: 50 });
  console.log(products);
</script>`;

  return (
    <div className="desktop-only">
      <h3 style={{ marginTop: 0 }}>🔗 Connected websites</h3>
      <p className="hint">
        Link your website to KopaBook. It gets <strong>read-only</strong> access to this business:
        live products and stock, today's sales, debts and more.{" "}
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDocs(!showDocs)} style={{ marginLeft: 4 }}>
          {showDocs ? "Hide how it works" : "How it works"}
        </button>
      </p>

      {showDocs && (
        <div className="card" style={{ background: "#f8faf9", fontSize: 14 }}>
          <strong>1. Connect your website below.</strong> You get an API key. Copy it once, it is never shown again.<br /><br />
          <strong>2. Paste this snippet on your website</strong> (replace the key):
          <pre style={{ background: "#1a2b49", color: "#e2e8f0", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>
{`<script src="https://kopabook.com/connect.js"></script>
<script>
  const kb = KopaBook.connect("kbk_live_YOUR_KEY");
  const { products } = await kb.products({ limit: 50 });
</script>`}</pre>
          <strong>3. Or call the REST API directly</strong> from any language:
          <pre style={{ background: "#1a2b49", color: "#e2e8f0", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>
{`curl https://kopabook.com/api/v1/dashboard \\
  -H "Authorization: Bearer kbk_live_YOUR_KEY"`}</pre>
          <strong>Endpoints</strong> (all GET, all read-only):
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            <li><code>/api/v1/business</code> — business info</li>
            <li><code>/api/v1/dashboard</code> — today's sales, stock, debts at a glance</li>
            <li><code>/api/v1/products?limit=50</code> — products and live stock</li>
            <li><code>/api/v1/sales?limit=20</code> — recent sales</li>
            <li><code>/api/v1/debts</code> — customers owing money</li>
            <li><code>/api/v1/expenses?limit=20</code> — recent expenses</li>
          </ul>
          <strong>Limits.</strong> 60 requests per minute per key. Revoke a key any time and
          every website using it stops working immediately. Keys never see other businesses.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {newKey && (
        <div className="alert alert-ok" style={{ wordBreak: "break-all" }}>
          <strong>{newKeyName} connected.</strong> Copy your key now. It will never be shown again.<br />
          <code style={{ fontSize: 14 }}>{newKey}</code><br />
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => copy(newKey, "key")}>
              {copied === "key" ? "Copied!" : "Copy key"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => copy(snippet, "snippet")}>
              {copied === "snippet" ? "Copied!" : "Copy website snippet"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setNewKey(null)}>Done</button>
          </div>
          <pre style={{ background: "#1a2b49", color: "#e2e8f0", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 11, marginTop: 10, whiteSpace: "pre-wrap" }}>
            {snippet}
          </pre>
        </div>
      )}

      <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder="Website name, e.g. My shop site" />
        <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} maxLength={200}
          inputMode="url" placeholder="Website URL, e.g. myshop.com" />
        <button className="btn btn-primary btn-sm" disabled={creating}>
          {creating ? "Connecting..." : "+ Connect website"}
        </button>
      </form>

      {loading && <div className="loading">Loading connections...</div>}
      {!loading && keys.length === 0 && (
        <p className="hint">No websites connected yet. Connect your website above to show live KopaBook data on it.</p>
      )}
      {keys.map((k) => (
        <div key={k.id} className="card" style={{ margin: "0 0 8px", padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <strong>{k.name}</strong>{" "}
              <code style={{ fontSize: 12, color: "#666" }}>{k.key_prefix}...</code>
              {k.status === "revoked" && (
                <span style={{ fontSize: 12, color: "#b3261e", marginLeft: 8 }}>revoked</span>
              )}
              {k.website_url && (
                <div style={{ fontSize: 13, marginTop: 2 }}>
                  <a href={k.website_url} target="_blank" rel="noreferrer" style={{ color: "#1a6b3c" }}>
                    {k.website_url.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#888" }}>
                Connected {k.created_at?.slice(0, 10)}
                {k.last_used_at ? ` · Last synced ${k.last_used_at.slice(0, 16).replace("T", " ")}` : " · Never synced"}
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
