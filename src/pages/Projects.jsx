import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

const TYPE_LABELS = {
  construction: "Construction",
  event: "Event",
  charity: "Charity / NGO",
  business: "Business venture",
  custom: "Custom",
};

const TYPE_ICONS = {
  construction: "🏗️",
  event: "🎉",
  charity: "🤝",
  business: "💼",
  custom: "📁",
};

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d.length <= 10 ? d + "T00:00:00" : d).toLocaleDateString(); }
  catch { return d; }
}

export default function ProjectsPage({ session }) {
  const role = session?.business?.role || "";
  const isOwnerPartner = ["owner", "partner"].includes(role);
  const canManage = ["owner", "partner", "manager"].includes(role);
  const [projects, setProjects] = useState([]);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [selected, setSelected] = useState(null); // { id, sharedRole, businessName }
  const [showCreate, setShowCreate] = useState(false);
  const [inviteFor, setInviteFor] = useState(null);
  const [createForm, setCreateForm] = useState({ name: "", type: "construction", description: "", budget: "", startDate: todayISO(), endDate: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const results = await Promise.allSettled([api.get("/api/projects"), api.get("/api/projects/shared")]);
      const sh = results[1].status === "fulfilled" ? (results[1].value.projects || []) : [];
      setShared(sh);
      if (results[0].status === "fulfilled") {
        setProjects(results[0].value.projects || []);
        setNeedsUpgrade(false);
        setError("");
      } else {
        const e = results[0].reason || new Error("Could not load projects.");
        if (e.upgradeRequired) setNeedsUpgrade(true);
        else if (sh.length === 0) setError(e.message);
        else setError("");
      }
      // Deep link from a fresh invite join: open the shared project at once.
      const q = new URLSearchParams(window.location.search).get("shared");
      if (q) {
        const hit = sh.find((x) => String(x.id) === String(q));
        if (hit) setSelected({ id: hit.id, sharedRole: hit.member_role, businessName: hit.business_name });
        window.history.replaceState({}, "", "/app/projects");
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createProject(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/projects", {
        name: createForm.name,
        type: createForm.type,
        description: createForm.description || undefined,
        budget: Number(createForm.budget) || 0,
        startDate: createForm.startDate || undefined,
        endDate: createForm.endDate || undefined,
      });
      setShowCreate(false);
      setCreateForm({ name: "", type: "construction", description: "", budget: "", startDate: todayISO(), endDate: "" });
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  if (selected) {
    return (
      <ProjectDetail
        projectId={selected.id}
        canManage={canManage}
        sharedRole={selected.sharedRole || null}
        sharedFrom={selected.businessName || ""}
        onBack={() => { setSelected(null); load(); }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        {canManage && !needsUpgrade && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ New project</button>
        )}
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Track any project from start to finish. Record every naira in and out, hit milestones, then generate a full accountability report.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {needsUpgrade ? (
        <div className="card">
          <h2>Projects is a Starter feature</h2>
          <p className="hint">Upgrade to Starter or higher to track full project accountability with printable reports.</p>
          <a className="btn btn-primary" href="/app/settings">View plans</a>
        </div>
      ) : loading ? (
        <div className="loading">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="card"><p className="empty">No projects yet. {canManage ? "Create your first project to start tracking." : ""}</p></div>
      ) : (
        <div className="grid2">
          {projects.map((p) => {
            const t = p.totals || {};
            const spent = t.totalExpense || 0;
            const pct = p.budget > 0 ? Math.min(100, Math.round((spent / p.budget) * 100)) : 0;
            return (
              <div className="card" key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelected({ id: p.id })}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{TYPE_ICONS[p.type] || "📁"} {p.name}</h3>
                  <span className={p.status === "completed" ? "pill pill-green" : "pill pill-gold"}>
                    {p.status === "completed" ? "Completed" : "Active"}
                  </span>
                </div>
                <p className="hint">{TYPE_LABELS[p.type] || p.type}{p.start_date ? ` · from ${fmtDate(p.start_date)}` : ""}</p>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
                  <span>Spent <strong className="money">{fmt(spent)}</strong></span>
                  <span>of <strong className="money">{fmt(p.budget)}</strong> budget</span>
                </div>
                <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                  style={{ height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--danger, #c0392b)" : "var(--brand)", borderRadius: 4 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8, color: "var(--muted)" }}>
                  <span>Balance: <strong className="money">{fmt(t.balance || 0)}</strong></span>
                  <span>{t.milestonesDone || 0}/{t.milestonesTotal || 0} milestones</span>
                </div>
                {isOwnerPartner && (
                  <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setInviteFor(p)}>Invite to project</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !needsUpgrade && shared.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>Shared with me</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            Projects other businesses invited you to. One tap to switch in. You see only the project, never their business.
          </p>
          <div className="grid2">
            {shared.map((p) => {
              const t = p.totals || {};
              const spent = t.totalExpense || 0;
              return (
                <div className="card" key={"shared-" + p.id} style={{ cursor: "pointer" }} onClick={() => setSelected({ id: p.id, sharedRole: p.member_role, businessName: p.business_name })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <h3 style={{ margin: 0 }}>{TYPE_ICONS[p.type] || "📁"} {p.name}</h3>
                    <span className="pill pill-gold">{p.member_role === "viewer" ? "Viewer" : "Contributor"}</span>
                  </div>
                  <p className="hint">by {p.business_name}</p>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
                    <span>Spent <strong className="money">{fmt(spent)}</strong></span>
                    <span>{t.milestonesDone || 0}/{t.milestonesTotal || 0} milestones</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {inviteFor && (
        <InviteModal project={inviteFor} onClose={() => setInviteFor(null)} />
      )}

      {showCreate && (
        <div className="modal-back" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New project</h2>
            <form onSubmit={createProject}>
              <div className="field"><label>Project name *</label><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. Shop building phase 2" required /></div>
              <div className="field"><label>Project type</label>
                <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Budget (NGN)</label><input type="number" min="0" step="0.01" value={createForm.budget} onChange={(e) => setCreateForm({ ...createForm, budget: e.target.value })} placeholder="0" /></div>
              <div className="field"><div className="row2">
                <div><label>Start date</label><input type="date" value={createForm.startDate} onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })} /></div>
                <div><label>End date</label><input type="date" value={createForm.endDate} onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })} /></div>
              </div></div>
              <div className="field"><label>Description</label><textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="What is this project about?" rows={3} /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Creating..." : "Create project"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectDetail({ projectId, canManage, sharedRole, sharedFrom, onBack }) {
  const isShared = !!sharedRole;
  const canAdd = isShared ? sharedRole === "contributor" : canManage;
  const canDelete = !isShared && canManage;
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTx, setShowTx] = useState(false);
  const [showMs, setShowMs] = useState(false);
  const [txForm, setTxForm] = useState({ kind: "expense", amount: "", category: "", description: "" });
  const [msForm, setMsForm] = useState({ title: "", description: "", dueDate: "" });
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [report, setReport] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [d, t, m] = await Promise.all([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/transactions?projectId=${projectId}`),
        api.get(`/api/projects/milestones?projectId=${projectId}`),
      ]);
      setData(d);
      setTransactions(t.transactions || []);
      setMilestones(m.milestones || []);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  async function saveTx(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/projects/transactions", { projectId, ...txForm, amount: Number(txForm.amount) });
      setShowTx(false);
      setTxForm({ kind: "expense", amount: "", category: "", description: "" });
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function saveMs(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/projects/milestones", { projectId, ...msForm });
      setShowMs(false);
      setMsForm({ title: "", description: "", dueDate: "" });
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function toggleMilestone(m) {
    try {
      await api.patch("/api/projects/milestones", { id: m.id, status: m.status === "done" ? "pending" : "done" });
      load();
    } catch (err) { setError(err.message); }
  }

  async function deleteTx(id) {
    if (!window.confirm("Delete this record?")) return;
    try {
      await api.del(`/api/projects/transactions?id=${id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function toggleStatus() {
    if (!window.confirm(data.project.status === "active" ? "Mark this project as completed?" : "Reopen this project?")) return;
    try {
      await api.patch(`/api/projects/${projectId}`, { status: data.project.status === "active" ? "completed" : "active" });
      load();
    } catch (err) { setError(err.message); }
  }

  async function generateReport() {
    setPrinting(true);
    try {
      const r = await api.get(`/api/projects/report?projectId=${projectId}`);
      setReport(r);
      setError("");
    } catch (err) { setError(err.message); }
    setPrinting(false);
  }

  function printReport() {
    document.body.classList.add("printing-project-report");
    window.print();
  }
  useEffect(() => {
    const done = () => document.body.classList.remove("printing-project-report");
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  if (loading) return <div className="loading">Loading project...</div>;
  if (!data) return (<><button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to projects</button><div className="alert alert-error">{error || "Project not found."}</div></>);

  const p = data.project;
  const t = data.totals || {};
  const pct = p.budget > 0 ? Math.min(100, Math.round(((t.totalExpense || 0) / p.budget) * 100)) : 0;

  return (
    <>
      <style>{`
        @media print {
          body.printing-project-report .app .sidebar,
          body.printing-project-report .app .mobilebar,
          body.printing-project-report .app .main > div:first-child,
          body.printing-project-report .no-print { display: none !important; }
          body.printing-project-report .app .main { margin: 0; padding: 0; }
          #kb-project-report { display: block !important; color: #000; }
        }
        #kb-project-report { display: none; font-family: Georgia, serif; max-width: 720px; margin: 0 auto; }
        #kb-project-report h1 { font-size: 22px; margin-bottom: 2px; }
        #kb-project-report h2 { font-size: 16px; margin: 18px 0 6px; border-bottom: 1px solid #999; padding-bottom: 4px; }
        #kb-project-report table { width: 100%; border-collapse: collapse; font-size: 12px; }
        #kb-project-report th, #kb-project-report td { border: 1px solid #999; padding: 5px 7px; text-align: left; }
        #kb-project-report .rpt-meta { color: #444; font-size: 12px; margin-bottom: 10px; }
        #kb-project-report .rpt-totals { display: flex; gap: 18px; margin: 12px 0; font-size: 14px; }
      `}</style>

      <div className="no-print">
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to projects</button>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="page-head" style={{ marginTop: 10 }}>
          <h1>{TYPE_ICONS[p.type] || "📁"} {p.name}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            {canDelete && <button className="btn btn-secondary btn-sm" onClick={toggleStatus}>{p.status === "active" ? "Mark completed" : "Reopen"}</button>}
            <button className="btn btn-primary btn-sm" onClick={generateReport} disabled={printing}>{printing ? "Building..." : "Generate report"}</button>
          </div>
        </div>
        <p className="hint">{TYPE_LABELS[p.type] || p.type} · {p.status === "completed" ? "Completed" : "Active"}{p.start_date ? ` · ${fmtDate(p.start_date)}` : ""}{p.end_date ? ` to ${fmtDate(p.end_date)}` : ""}</p>
        {isShared && <p><span className="pill pill-gold">Shared with me{sharedFrom ? ` by ${sharedFrom}` : ""} · {sharedRole === "viewer" ? "Viewer (read only)" : "Contributor"}</span></p>}
        {p.description && <p>{p.description}</p>}

        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Budget vs spent</h3>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>Budget: <strong className="money">{fmt(p.budget)}</strong></span>
              <span>Spent: <strong className="money">{fmt(t.totalExpense || 0)}</strong></span>
            </div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
              style={{ height: 10, borderRadius: 5, background: "var(--line)", overflow: "hidden", margin: "8px 0" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--danger, #c0392b)" : "var(--brand)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>Received: <strong className="money">{fmt(t.totalIncome || 0)}</strong></span>
              <span>Balance: <strong className="money">{fmt(t.balance || 0)}</strong></span>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Milestones</h3>
            <p style={{ fontSize: 28, margin: "4px 0" }}>{t.milestonesDone || 0}<span style={{ color: "var(--muted)", fontSize: 16 }}> / {t.milestonesTotal || 0} done</span></p>
            <p className="hint">{transactions.length} records kept</p>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 14 }}>
          {["overview", "transactions", "milestones"].map((k) => (
            <button key={k} className={"btn btn-sm " + (tab === k ? "btn-primary" : "btn-secondary")}
              onClick={() => setTab(k)}>{k === "overview" ? "Records" : k[0].toUpperCase() + k.slice(1)}</button>
          ))}
          <span style={{ flex: 1 }} />
          {canAdd && tab !== "milestones" && <button className="btn btn-primary btn-sm" onClick={() => setShowTx(true)}>+ Add record</button>}
          {canAdd && tab === "milestones" && <button className="btn btn-primary btn-sm" onClick={() => setShowMs(true)}>+ Add milestone</button>}
        </div>

        {tab !== "milestones" ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Recorded by</th><th>Amount</th>{canDelete && <th></th>}</tr></thead>
              <tbody>
                {transactions.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDate(x.created_at)}</td>
                    <td><span className={x.kind === "income" ? "pill pill-green" : "pill pill-gray"}>{x.kind === "income" ? "Money in" : "Money out"}</span></td>
                    <td>{x.category || "—"}</td>
                    <td>{x.description}</td>
                    <td>{x.recorded_by_name || "—"}</td>
                    <td className="money">{x.kind === "income" ? "+" : "−"}{fmt(x.amount)}</td>
                    {canDelete && <td><button className="btn btn-secondary btn-sm" style={{ color: "var(--danger, #b91c1c)" }} onClick={() => deleteTx(x.id)}>Delete</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && <p className="empty">No records yet. Add the first money in or out.</p>}
          </div>
        ) : (
          <div>
            {milestones.map((m) => (
              <div className="card" key={m.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{m.status === "done" ? "✅" : "⬜"} {m.title}</h3>
                  {canAdd && (
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleMilestone(m)}>
                      {m.status === "done" ? "Reopen" : "Mark done"}
                    </button>
                  )}
                </div>
                {m.description && <p className="hint">{m.description}</p>}
                {m.due_date && <p className="hint">Due: {fmtDate(m.due_date)}</p>}
              </div>
            ))}
            {milestones.length === 0 && <p className="empty">No milestones yet.</p>}
          </div>
        )}

        {report && (
          <div className="card" style={{ marginTop: 14 }}>
            <h2>Accountability report ready</h2>
            <p className="hint">The report below prints cleanly. Use your browser print to save as PDF or send to a printer.</p>
            <button className="btn btn-primary" onClick={printReport}>Print / Save as PDF</button>
          </div>
        )}
      </div>

      {report && (
        <div id="kb-project-report">
          <h1>Project Accountability Report</h1>
          <div className="rpt-meta">
            {report.businessName && <div><strong>Business:</strong> {report.businessName}</div>}
            <div><strong>Project:</strong> {report.project.name} ({TYPE_LABELS[report.project.type] || report.project.type})</div>
            <div><strong>Period:</strong> {fmtDate(report.project.start_date)} to {report.project.end_date ? fmtDate(report.project.end_date) : "ongoing"}</div>
            <div><strong>Generated:</strong> {fmtDate(report.generatedAt)}{report.generatedBy ? ` by ${report.generatedBy}` : ""}</div>
          </div>
          <h2>Summary</h2>
          <div className="rpt-totals">
            <div><strong>Budget:</strong> {fmt(report.project.budget)}</div>
            <div><strong>Total received:</strong> {fmt(report.totals.totalIncome)}</div>
            <div><strong>Total spent:</strong> {fmt(report.totals.totalExpense)}</div>
            <div><strong>Balance:</strong> {fmt(report.totals.balance)}</div>
          </div>
          <h2>Breakdown by category</h2>
          <table>
            <thead><tr><th>Type</th><th>Category</th><th>Records</th><th>Total</th></tr></thead>
            <tbody>
              {report.byCategory.map((c, i) => (
                <tr key={i}><td>{c.kind === "income" ? "Money in" : "Money out"}</td><td>{c.category || "Uncategorized"}</td><td>{c.count}</td><td>{fmt(c.total)}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>Full record ({report.transactions.length})</h2>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>By</th><th>Amount</th></tr></thead>
            <tbody>
              {report.transactions.map((x) => (
                <tr key={x.id}><td>{fmtDate(x.created_at)}</td><td>{x.kind === "income" ? "In" : "Out"}</td><td>{x.category || "-"}</td><td>{x.description}</td><td>{x.recorded_by_name || "-"}</td><td>{fmt(x.amount)}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>Milestones ({report.totals.milestonesDone}/{report.totals.milestonesTotal})</h2>
          <table>
            <thead><tr><th>Status</th><th>Milestone</th><th>Due</th></tr></thead>
            <tbody>
              {report.milestones.map((m) => (
                <tr key={m.id}><td>{m.status === "done" ? "Done" : "Pending"}</td><td>{m.title}</td><td>{fmtDate(m.due_date)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="rpt-meta" style={{ marginTop: 16 }}>Generated by KopaBook. Every record above was entered in the app and is traceable to the person who recorded it.</p>
        </div>
      )}

      {showTx && (
        <div className="modal-back" onClick={() => setShowTx(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add record</h2>
            <form onSubmit={saveTx}>
              <div className="field"><label>Type</label>
                <select value={txForm.kind} onChange={(e) => setTxForm({ ...txForm, kind: e.target.value })}>
                  <option value="expense">Money out (spent)</option>
                  <option value="income">Money in (received)</option>
                </select>
              </div>
              <div className="field"><label>Amount *</label><input type="number" min="0" step="0.01" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required /></div>
              <div className="field"><label>Category</label><input value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })} placeholder="e.g. Materials, Labour, Transport" /></div>
              <div className="field"><label>Description *</label><input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="What was this for?" required /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save record"}</button>
            </form>
          </div>
        </div>
      )}

      {showMs && (
        <div className="modal-back" onClick={() => setShowMs(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add milestone</h2>
            <form onSubmit={saveMs}>
              <div className="field"><label>Title *</label><input value={msForm.title} onChange={(e) => setMsForm({ ...msForm, title: e.target.value })} placeholder="e.g. Foundation completed" required /></div>
              <div className="field"><label>Description</label><textarea value={msForm.description} onChange={(e) => setMsForm({ ...msForm, description: e.target.value })} rows={3} /></div>
              <div className="field"><label>Due date</label><input type="date" value={msForm.dueDate} onChange={(e) => setMsForm({ ...msForm, dueDate: e.target.value })} /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Add milestone"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function InviteModal({ project, onClose }) {
  const [identifier, setIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState("contributor");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [invites, setInvites] = useState([]);
  const [members, setMembers] = useState([]);
  const [copied, setCopied] = useState("");

  async function loadInvites() {
    try {
      const d = await api.get(`/api/projects/invites?projectId=${project.id}`);
      setInvites(d.invites || []);
      setError("");
    } catch (e) { setError(e.message); }
  }

  async function loadMembers() {
    try {
      const d = await api.get(`/api/projects/members?projectId=${project.id}`);
      setMembers(d.members || []);
    } catch { /* member list is best-effort inside this modal */ }
  }
  useEffect(() => { loadInvites(); loadMembers(); }, [project.id]);

  async function removeMember(m) {
    if (!window.confirm(`Remove ${m.full_name || m.email || "this person"} from the project? They lose access at once.`)) return;
    try {
      await api.del(`/api/projects/members?projectId=${project.id}&userId=${m.user_id}`);
      loadMembers();
      loadInvites();
    } catch (err) { setError(err.message); }
  }

  async function createInvite(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const d = await api.post("/api/projects/invites", { projectId: project.id, identifier, role: inviteRole });
      setCreated(d);
      setIdentifier("");
      setError("");
      loadInvites();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function revoke(id) {
    if (!window.confirm("Revoke this invite? The link will stop working.")) return;
    try {
      await api.del(`/api/projects/invites?id=${id}`);
      if (created && invites.find((i) => i.id === id)) setCreated(null);
      loadInvites();
    } catch (err) { setError(err.message); }
  }

  function copyLink(link) {
    try {
      navigator.clipboard.writeText(link);
      setCopied(link);
      setTimeout(() => setCopied(""), 2000);
    } catch { window.prompt("Copy this link:", link); }
  }

  const waShare = (link) => "https://wa.me/?text=" + encodeURIComponent("You are invited to track this project on KopaBook. Tap to join: " + link);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite to {project.name}</h2>
        <p className="hint">Invite by email or username. No new account per project: they join with their own KopaBook login and see only this project.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={createInvite}>
          <div className="field"><label>Email or username *</label><input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. chidi@example.com or chidi_trades" required /></div>
          <div className="field"><label>Role</label>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="contributor">Contributor: can add records and update milestones</option>
              <option value="viewer">Viewer: read only</option>
            </select>
          </div>
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Creating..." : "Create invite link"}</button>
        </form>

        {created && created.joinLink && (
          <div className="card" style={{ marginTop: 12, background: "var(--bg)" }}>
            <p className="hint" style={{ marginTop: 0 }}>Share this link:</p>
            <p style={{ wordBreak: "break-all", fontSize: 13 }}>{created.joinLink}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => copyLink(created.joinLink)}>{copied === created.joinLink ? "Copied" : "Copy link"}</button>
              <a className="btn btn-secondary btn-sm" href={waShare(created.joinLink)} target="_blank" rel="noreferrer">Share on WhatsApp</a>
            </div>
          </div>
        )}

        {invites.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3>Pending invites</h3>
            {invites.filter((i) => i.status === "pending").map((i) => (
              <div key={i.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14 }}><strong>{i.invited_email || i.invited_username}</strong> · {i.role === "viewer" ? "Viewer" : "Contributor"}</div>
                    <div className="hint" style={{ fontSize: 12 }}>{i.member_count || 0} joined · {fmtDate(i.created_at)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {i.joinLink && <button className="btn btn-secondary btn-sm" onClick={() => copyLink(i.joinLink)}>{copied === i.joinLink ? "Copied" : "Copy"}</button>}
                    <button className="btn btn-secondary btn-sm" style={{ color: "var(--danger, #b91c1c)" }} onClick={() => revoke(i.id)}>Revoke</button>
                  </div>
                </div>
              </div>
            ))}
            {invites.filter((i) => i.status === "pending").length === 0 && <p className="empty">No pending invites.</p>}
          </div>
        )}

        {members.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3>Members</h3>
            {members.map((m) => (
              <div key={m.user_id} className="card" style={{ marginBottom: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14 }}><strong>{m.full_name || m.email}</strong> · {m.role === "viewer" ? "Viewer" : "Contributor"}</div>
                    <div className="hint" style={{ fontSize: 12 }}>{m.email} · joined {fmtDate(m.joined_at)}</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{ color: "var(--danger, #b91c1c)" }} onClick={() => removeMember(m)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
