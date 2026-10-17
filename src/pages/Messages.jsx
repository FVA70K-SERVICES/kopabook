import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";
import { waLink } from "../lib/whatsapp";
import { sendVia } from "../lib/channels";
import ChannelPicker from "../components/ChannelPicker";
import { promoCardUrl, shareCard, downloadCard } from "../lib/shareCards";

// Messages: WhatsApp broadcasts to customers and quick notes to staff.
// Free tier: every send opens WhatsApp with the message ready; the merchant
// presses send. Nothing goes out automatically.
export default function MessagesPage({ session }) {
  const [tab, setTab] = useState("broadcast");
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [biz, setBiz] = useState({ name: "", brand_color: "#166534", tagline: "" });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Broadcast composer
  const [audience, setAudience] = useState("all"); // all | debtors
  const [msgKind, setMsgKind] = useState("announcement"); // announcement | newproduct
  const [productId, setProductId] = useState("");
  const [message, setMessage] = useState("");
  const [cardUrl, setCardUrl] = useState("");
  const [queue, setQueue] = useState(null);

  // Staff composer
  const [staffTpl, setStaffTpl] = useState("shift");
  const [staffMsg, setStaffMsg] = useState("");
  const [staffQueue, setStaffQueue] = useState(null);
  const [channel, setChannel] = useState("whatsapp");

  useEffect(() => {
    Promise.all([
      api.get("/api/customers").then((d) => setCustomers(d.customers || [])).catch(() => {}),
      api.get("/api/staff").then((d) => setMembers(d.members || [])).catch(() => {}),
      api.get("/api/products").then((d) => setProducts(d.products || [])).catch(() => {}),
      api.get("/api/business").then((d) => setBiz(d.business || {})).catch(() => {}),
      api.get("/api/reminders").then((d) => setLogs(d.logs || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const brand = { name: biz.name, color: biz.brand_color || "#166534", tagline: biz.tagline || "" };
  const withPhones = customers.filter((c) => c.phone);
  const targets = audience === "debtors"
    ? withPhones.filter((c) => Number(c.outstanding || 0) > 0)
    : withPhones;

  const STAFF_TEMPLATES = {
    shift: { label: "Shift reminder", text: "Hello {name}, quick reminder from {business}: your shift starts soon. Please be on time. Thank you!" },
    announcement: { label: "Announcement", text: "Hello {name}, announcement from {business}: " },
    thanks: { label: "Thank you", text: "Hello {name}, thank you for your great work today at {business}. We appreciate you!" },
  };

  function fillStaff(tpl, name) {
    return tpl.replace(/\{name\}/g, name || "team").replace(/\{business\}/g, biz.name || "us");
  }

  function buildPromo() {
    const p = products.find((x) => String(x.id) === String(productId));
    if (!p) { setCardUrl(""); return; }
    const url = promoCardUrl({
      headline: "New arrival at " + (biz.name || "our store"),
      productName: p.name,
      price: fmt(p.unit_price),
      note: biz.tagline || "Come and get yours today!",
    }, brand);
    setCardUrl(url);
    if (!message) {
      setMessage(`Hello! New arrival at ${biz.name || "our store"}: ${p.name} for ${fmt(p.unit_price)} per ${p.unit || "piece"}. Come and get yours today!`);
    }
  }

  async function log(kind, { customerId, userId, phone, message: msg }) {
    try {
      await api.post("/api/reminders", { kind, customerId, userId, phone, message: msg });
    } catch { /* never block sending */ }
  }

  function startBroadcast() {
    if (!message.trim() || !targets.length) return;
    setQueue({ list: targets, idx: 0 });
  }

  function broadcastSend() {
    const t = queue.list[queue.idx];
    if (!t) return;
    const msg = message.replace(/\{name\}/g, t.name || "valued customer");
    log("broadcast", { customerId: t.id, phone: t.phone, message: `[${channel}] ${msg}` });
    sendVia(channel, { phone: t.phone, text: msg });
    if (queue.idx + 1 < queue.list.length) setQueue({ ...queue, idx: queue.idx + 1 });
    else { setQueue(null); api.get("/api/reminders").then((d) => setLogs(d.logs || [])).catch(() => {}); }
  }

  function startStaffQueue() {
    const list = members.filter((m) => m.phone);
    if (!list.length || !effectiveStaffMsg.trim()) return;
    setStaffQueue({ list, idx: 0, msg: effectiveStaffMsg });
  }

  function staffSend() {
    const m = staffQueue.list[staffQueue.idx];
    if (!m) return;
    const msg = fillStaff(staffQueue.msg, m.full_name);
    log("staff", { userId: m.id, phone: m.phone, message: `[${channel}] ${msg}` });
    sendVia(channel, { phone: m.phone, text: msg });
    if (staffQueue.idx + 1 < staffQueue.list.length) setStaffQueue({ ...staffQueue, idx: staffQueue.idx + 1 });
    else { setStaffQueue(null); api.get("/api/reminders").then((d) => setLogs(d.logs || [])).catch(() => {}); }
  }

  const cur = queue ? queue.list[queue.idx] : null;
  const curStaff = staffQueue ? staffQueue.list[staffQueue.idx] : null;
  const effectiveStaffMsg = staffMsg || STAFF_TEMPLATES[staffTpl].text;

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="page-head"><h1>Messages</h1></div>
      <p className="hint" style={{ marginTop: 0 }}>
        Send updates on WhatsApp, SMS or Telegram. Each tap opens the app with the message ready; you press send.
        Nothing goes out automatically.
      </p>

      <div style={{ marginBottom: 12 }}>
        <ChannelPicker value={channel} onChange={setChannel} />
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button className={"btn btn-sm " + (tab === "broadcast" ? "btn-primary" : "btn-secondary")} onClick={() => setTab("broadcast")}>Customer broadcast</button>
        <button className={"btn btn-sm " + (tab === "staff" ? "btn-primary" : "btn-secondary")} onClick={() => setTab("staff")}>Staff</button>
        <button className={"btn btn-sm " + (tab === "history" ? "btn-primary" : "btn-secondary")} onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "broadcast" && (
        <div className="card narrow" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Broadcast to customers</h3>
          <div className="field"><label>Audience</label>
            <select value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="all">All customers with WhatsApp ({withPhones.length})</option>
              <option value="debtors">Debtors with WhatsApp</option>
            </select>
          </div>
          <div className="field"><label>Message type</label>
            <select value={msgKind} onChange={(e) => { setMsgKind(e.target.value); setCardUrl(""); }}>
              <option value="announcement">Announcement</option>
              <option value="newproduct">New product (with share card)</option>
            </select>
          </div>
          {msgKind === "newproduct" && (
            <>
              <div className="field"><label>Product</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select a product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.unit_price)}</option>)}
                </select>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={buildPromo} disabled={!productId}>Generate share card</button>
              {cardUrl && (
                <div style={{ marginTop: 12 }}>
                  <img src={cardUrl} alt="Promo card preview" style={{ width: "100%", maxWidth: 320, borderRadius: 12, border: "1px solid var(--line)" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => shareCard(cardUrl, { title: "New product", filename: "kopabook-promo.png" })}>Share card image</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => downloadCard(cardUrl, "kopabook-promo.png")}>Download</button>
                  </div>
                  <p className="hint">Share the card image first, then send the text below so customers get both.</p>
                </div>
              )}
            </>
          )}
          <div className="field" style={{ marginTop: 12 }}><label>Message (use {"{name}"} for the customer)</label>
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hello {name}! ..." />
          </div>
          <button className="btn btn-primary btn-block" onClick={startBroadcast} disabled={!message.trim() || !targets.length}>
            Send to {targets.length} customer{targets.length === 1 ? "" : "s"}
          </button>
          {!targets.length && <p className="hint">No customers with WhatsApp numbers in this audience yet. Add phone numbers on the Customers page.</p>}
        </div>
      )}

      {tab === "staff" && (
        <div className="card narrow" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Message staff</h3>
          <div className="field"><label>Template</label>
            <select value={staffTpl} onChange={(e) => { setStaffTpl(e.target.value); setStaffMsg(""); }}>
              {Object.entries(STAFF_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field"><label>Message (use {"{name}"} and {"{business}"})</label>
            <textarea rows={4} value={effectiveStaffMsg} onChange={(e) => setStaffMsg(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" onClick={startStaffQueue}
            disabled={!members.filter((m) => m.phone).length || !effectiveStaffMsg.trim()}>
            Send to {members.filter((m) => m.phone).length} staff
          </button>
          {!members.filter((m) => m.phone).length && <p className="hint">No staff with WhatsApp numbers yet. Add phone numbers when inviting staff.</p>}
          {members.filter((m) => !m.phone).length > 0 && (
            <p className="hint">{members.filter((m) => !m.phone).length} staff member(s) have no phone number saved.</p>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Type</th><th>To</th><th>Message</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td><small>{String(l.created_at || "").slice(0, 16).replace("T", " ")}</small></td>
                  <td><span className="pill pill-gray">{l.kind}</span></td>
                  <td>{l.customer_name || l.staff_name || l.phone || "—"}</td>
                  <td><small>{String(l.message || "").slice(0, 80)}{String(l.message || "").length > 80 ? "…" : ""}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="empty">No messages sent yet.</p>}
        </div>
      )}

      {queue && cur && (
        <div className="modal-back" onClick={() => setQueue(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sending ({queue.idx + 1} of {queue.list.length})</h2>
            <p><strong>{cur.name}</strong> · {cur.phone}</p>
            <div className="card" style={{ background: "var(--bg)", margin: "12px 0" }}>
              <p style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>{message.replace(/\{name\}/g, cur.name || "valued customer")}</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                if (queue.idx + 1 < queue.list.length) setQueue({ ...queue, idx: queue.idx + 1 });
                else setQueue(null);
              }}>Skip</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={broadcastSend}>Send on WhatsApp</button>
            </div>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setQueue(null)}>Done</button>
          </div>
        </div>
      )}

      {staffQueue && curStaff && (
        <div className="modal-back" onClick={() => setStaffQueue(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sending ({staffQueue.idx + 1} of {staffQueue.list.length})</h2>
            <p><strong>{curStaff.full_name}</strong> · {curStaff.phone}</p>
            <div className="card" style={{ background: "var(--bg)", margin: "12px 0" }}>
              <p style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>{fillStaff(staffQueue.msg, curStaff.full_name)}</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                if (staffQueue.idx + 1 < staffQueue.list.length) setStaffQueue({ ...staffQueue, idx: staffQueue.idx + 1 });
                else setStaffQueue(null);
              }}>Skip</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={staffSend}>Send on WhatsApp</button>
            </div>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setStaffQueue(null)}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}
