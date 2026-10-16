import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";
import { staffRolesFor } from "../lib/businessTypes";

const PERMS = [
  { key: "can_view_profit", label: "View profit" },
  { key: "can_discount", label: "Apply discounts" },
  { key: "can_manage_expenses", label: "Manage expenses" },
  { key: "can_manage_products", label: "Manage products" },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseStamp(s) {
  // DB stores "YYYY-MM-DD HH:MM:SS" in UTC.
  return new Date(String(s).replace(" ", "T") + "Z");
}

function hoursBetween(start, end) {
  const ms = parseStamp(end) - parseStamp(start);
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return (ms / 3600000).toFixed(2);
}

function shortTime(s) {
  const d = parseStamp(s);
  return d.toLocaleString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

export default function StaffPage({ session }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "", phone: "" });
  const [saving, setSaving] = useState(false);

  // Owner password reset for a staff member
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [resetStatus, setResetStatus] = useState({ loading: false, error: "", ok: "" });

  // Clock in / out state (signed-in member)
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInAt, setClockInAt] = useState(null);
  const [clockBusy, setClockBusy] = useState(false);

  // Attendance (owner/manager)
  const [attFrom, setAttFrom] = useState(daysAgo(7));
  const [attTo, setAttTo] = useState(todayISO());
  const [shifts, setShifts] = useState([]);
  const [attLoading, setAttLoading] = useState(false);

  // Commissions (owner/manager)
  const [comFrom, setComFrom] = useState(daysAgo(30));
  const [comTo, setComTo] = useState(todayISO());
  const [comReport, setComReport] = useState([]);
  const [unattributed, setUnattributed] = useState(null);
  const [comLoading, setComLoading] = useState(false);

  const role = session.business?.role;
  const isOwner = role === "owner";
  const isPartner = role === "partner";
  const canManageStaff = isOwner || isPartner;
  const rolesForType = staffRolesFor(session.business?.business_type);
  const defaultRole = rolesForType[rolesForType.length - 1].key;
  // Roles the current user may assign: only the owner can make someone a partner.
  const assignableRoles = isOwner ? rolesForType : rolesForType.filter((r) => r.key !== "partner");
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ fullName: "", role: "" });
  const [deleting, setDeleting] = useState(null);
  const manage = canManageStaff;

  async function load() {
    if (!canManageStaff) { setLoading(false); return; }
    setLoading(true);
    try { const d = await api.get("/api/staff"); setMembers(d.members); setError(""); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadClock() {
    try {
      const d = await api.get("/api/staff/clock");
      setClockedIn(!!d.clockedIn);
      setClockInAt(d.clockIn || null);
    } catch { /* clock card is best-effort */ }
  }

  async function loadAttendance() {
    setAttLoading(true);
    try {
      const d = await api.get(`/api/staff/attendance?from=${attFrom}&to=${attTo}`);
      setShifts(d.shifts || []);
    } catch (e) { setError(e.message); }
    setAttLoading(false);
  }

  async function loadCommissions() {
    setComLoading(true);
    try {
      const d = await api.get(`/api/staff/commissions?from=${comFrom}&to=${comTo}`);
      setComReport(d.report || []);
      setUnattributed({ total: d.unattributedTotal || 0, count: d.unattributedCount || 0 });
    } catch (e) { setError(e.message); }
    setComLoading(false);
  }

  useEffect(() => {
    load();
    loadClock();
  }, []);

  useEffect(() => { if (manage) { loadAttendance(); loadCommissions(); } }, [manage]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function invite(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api.post("/api/staff", { ...form, role: form.role || defaultRole });
      setShowForm(false); setForm({ fullName: "", email: "", password: "", role: "", phone: "" });
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function resetPassword(e) {
    e.preventDefault();
    setResetStatus({ loading: true, error: "", ok: "" });
    try {
      const d = await api.post("/api/staff/reset-password", {
        userId: resetFor.id, newPassword: resetPw,
      });
      setResetStatus({ loading: false, error: "", ok: d.message || "Password reset." });
      setResetPw("");
    } catch (err) {
      setResetStatus({ loading: false, error: err.message, ok: "" });
    }
  }

  async function saveEdit(e) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      await api.put("/api/staff", {
        userId: editing.id,
        fullName: editForm.fullName.trim(),
        role: editForm.role,
      });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true); setError("");
    try {
      await api.del(`/api/staff?userId=${deleting.id}`);
      setDeleting(null);
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function clockAction() {
    setClockBusy(true);
    try {
      const d = await api.post("/api/staff/clock", { action: clockedIn ? "out" : "in" });
      setClockedIn(!!d.clockedIn);
      setClockInAt(d.clockIn || null);
    } catch (e) { setError(e.message); }
    setClockBusy(false);
  }

  async function savePerms(userId, patch) {    try {
      await api.patch("/api/staff", { userId, ...patch });
      setMembers((ms) => ms.map((m) => (m.id === userId ? { ...m, ...patch } : m)));
      setError("");
    } catch (e) { setError(e.message); }
  }

  function togglePerm(member, key) {
    savePerms(member.id, { [key]: member[key] ? 0 : 1 });
  }

  function clockCard() {
    return (
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>My shift</h3>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
          {clockedIn && clockInAt
            ? `Clocked in since ${shortTime(clockInAt)} (${hoursBetween(clockInAt, new Date().toISOString().slice(0, 19).replace("T", " "))}h so far)`
            : "You are not clocked in."}
        </p>
        <button className={"btn " + (clockedIn ? "btn-secondary" : "btn-primary")} onClick={clockAction} disabled={clockBusy}>
          {clockBusy ? "Please wait..." : clockedIn ? "Clock out" : "Clock in"}
        </button>
      </div>
    );
  }

  // Attendants only see their own clock button and status.
  if (!manage) {
    return (
      <>
        <div className="page-head"><h1>Staff</h1></div>
        {error && <div className="alert alert-error">{error}</div>}
        {clockCard()}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Staff</h1>
        {canManageStaff && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Invite staff</button>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {clockCard()}

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>How roles work</h3>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          <strong>Owners</strong> control everything including staff and settings.{" "}
          {rolesForType.map((r) => (
            <span key={r.key}><strong>{r.label}s</strong> {r.desc.charAt(0).toLowerCase() + r.desc.slice(1)}{" "}</span>
          ))}
        </p>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <>
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <table className="data">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.full_name}</strong></td>
                    <td>{m.email}</td>
                    <td><span className={"pill " + (m.business_role === "owner" ? "pill-green" : m.business_role === "partner" ? "pill-gold" : m.business_role === "manager" ? "pill-gold" : "pill-gray")}>{m.business_role}</span></td>
                    <td>{m.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h3 style={{ marginTop: 0 }}>Permissions and commission</h3>
            <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
              {isOwner
                ? "Toggle what each staff member can do, and set their commission rate. Owners and partners always keep full access."
                : "Set by the business owner (read only)."}
            </p>
            {members.filter((m) => m.business_role !== "owner").map((m) => (
              <div key={m.id} style={{ borderTop: "1px solid var(--border, #eee)", padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong>{m.full_name}</strong>
                  <span className="pill pill-gray">{m.business_role}</span>
                  {Number(m.suspended || 0) === 1 && (
                    <span className="pill pill-red" style={{ marginLeft: 6 }}>Suspended</span>
                  )}
                </div>
                <div className="row2" style={{ marginTop: 8 }}>
                  {PERMS.map((p) => (
                    <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                      <input
                        type="checkbox"
                        checked={!!m[p.key]}
                        disabled={!canManageStaff || (m.business_role === "partner" && !isOwner)}
                        onChange={() => togglePerm(m, p.key)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
                <div className="row2" style={{ marginTop: 8 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Commission %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      defaultValue={m.commission_percent ?? 0}
                      key={`${m.id}-comm-${m.commission_percent}`}
                      disabled={!canManageStaff || (m.business_role === "partner" && !isOwner)}
                      onBlur={(e) => {
                        const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                        if (v !== Number(m.commission_percent || 0)) {
                          savePerms(m.id, { commission_percent: v });
                        }
                      }}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Max discount % (blank = no cap)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      placeholder="No cap"
                      defaultValue={m.max_discount_percent ?? ""}
                      key={`${m.id}-disc-${m.max_discount_percent ?? "none"}`}
                      disabled={!canManageStaff || (m.business_role === "partner" && !isOwner)}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const cur = m.max_discount_percent ?? null;
                        const v = raw === "" ? null : Math.min(100, Math.max(0, Number(raw) || 0));
                        if (v !== cur) {
                          savePerms(m.id, { max_discount_percent: v });
                        }
                      }}
                    />
                  </div>
                </div>
                {canManageStaff && (isOwner || m.business_role !== "partner") && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setEditing(m); setEditForm({ fullName: m.full_name, role: m.business_role }); }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setResetFor(m); setResetPw(""); setResetStatus({ loading: false, error: "", ok: "" }); }}
                    >
                      Reset password
                    </button>
                    {Number(m.suspended || 0) === 1 ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ color: "var(--green, #15803d)" }}
                        onClick={() => savePerms(m.id, { suspended: 0 })}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ color: "var(--gold, #b45309)" }}
                        onClick={() => {
                          if (window.confirm(`${m.full_name} will lose access until reactivated. Suspend?`)) {
                            savePerms(m.id, { suspended: 1 });
                          }
                        }}
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ color: "var(--danger, #b91c1c)" }}
                      onClick={() => setDeleting(m)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>Attendance</h3>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={attFrom} onChange={(e) => setAttFrom(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={attTo} onChange={(e) => setAttTo(e.target.value)} /></div>
          <button className="btn btn-secondary btn-sm" onClick={loadAttendance} disabled={attLoading}>{attLoading ? "Loading..." : "View"}</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Member</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Hours</th></tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{String(s.clock_in).slice(0, 10)}</td>
                  <td>{shortTime(s.clock_in)}</td>
                  <td>{s.clock_out ? shortTime(s.clock_out) : "On shift"}</td>
                  <td>{s.clock_out ? hoursBetween(s.clock_in, s.clock_out) : "-"}</td>
                </tr>
              ))}
              {shifts.length === 0 && !attLoading && (
                <tr><td colSpan={5}><div className="empty">No shifts in this period.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>Commission report</h3>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}><label>From</label><input type="date" value={comFrom} onChange={(e) => setComFrom(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>To</label><input type="date" value={comTo} onChange={(e) => setComTo(e.target.value)} /></div>
          <button className="btn btn-secondary btn-sm" onClick={loadCommissions} disabled={comLoading}>{comLoading ? "Loading..." : "View"}</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Member</th><th>Rate</th><th>Sales</th><th>Sales total</th><th>Commission due</th></tr></thead>
            <tbody>
              {comReport.map((r) => (
                <tr key={r.memberId}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.commissionPercent}%</td>
                  <td>{r.salesCount}</td>
                  <td className="money">{fmt(r.salesTotal)}</td>
                  <td className="money"><strong>{fmt(r.commissionDue)}</strong></td>
                </tr>
              ))}
              {comReport.length === 0 && !comLoading && (
                <tr><td colSpan={5}><div className="empty">No staff in this business yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {unattributed && unattributed.count > 0 && (
          <p style={{ color: "var(--muted)", margin: "8px 0 0" }}>
            {unattributed.count} sale(s) ({fmt(unattributed.total)}) could not be linked to any staff member.
          </p>
        )}
      </div>

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Invite staff</h2>
            <form onSubmit={invite}>
              <div className="field"><label>Full name *</label><input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required /></div>
              <div className="field"><label>Email *</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></div>
              <div className="field"><label>WhatsApp number</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              <div className="field"><div className="row2">
                <div><label>Temporary password *</label><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} /></div>
                <div><label>Role</label>
                  <select value={form.role || defaultRole} onChange={(e) => set("role", e.target.value)}>
                    {rolesForType.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div></div>
              {(form.role || defaultRole) === "partner" && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  A partner is a co-owner with full access to money, records and staff. Only invite someone you trust completely.
                </div>
              )}
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Inviting..." : "Invite staff"}</button>
            </form>
          </div>
        </div>
      )}

      {resetFor && (
        <div className="modal-back" onClick={() => setResetFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reset password</h2>
            <p className="hint">Set a new password for <strong>{resetFor.full_name}</strong> ({resetFor.email}). Share it with them directly.</p>
            {resetStatus.error && <div className="alert alert-error">{resetStatus.error}</div>}
            {resetStatus.ok && <div className="alert alert-ok">{resetStatus.ok}</div>}
            <form onSubmit={resetPassword}>
              <div className="field"><label>New temporary password *</label><input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} required minLength={8} placeholder="At least 8 characters" /></div>
              <button className="btn btn-primary btn-block" disabled={resetStatus.loading}>{resetStatus.loading ? "Resetting..." : "Set new password"}</button>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-back" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit staff member</h2>
            <p className="hint">{editing.email}</p>
            <form onSubmit={saveEdit}>
              <div className="field"><label>Full name *</label><input value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} required /></div>
              <div className="field"><label>Role</label>
                <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                  {assignableRoles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <p className="hint" style={{ marginTop: 6 }}>Changing the role resets their permissions to the {assignableRoles.find((r) => r.key === editForm.role)?.label || "role"} defaults.</p>
              </div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
            </form>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-back" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remove staff member</h2>
            <p>Remove <strong>{deleting.full_name}</strong> ({deleting.email}) from {session.business?.name || "this business"}?</p>
            <p className="hint">They will lose access to this business immediately. Their other businesses are not affected.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, background: "var(--danger, #b91c1c)" }} disabled={saving} onClick={confirmDelete}>
                {saving ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
