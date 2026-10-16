import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/admin/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page-head"><h1>Admin</h1><div className="alert alert-error">{error}</div></div>;
  if (!data) return <div className="page-head"><h1>Admin</h1><p className="hint">Loading...</p></div>;

  return (
    <>
      <div className="page-head"><h1>Platform admin</h1></div>

      <div className="metric-grid">
        <div className="metric-card"><span>Total accounts</span><strong>{data.totals.users}</strong></div>
        <div className="metric-card"><span>Paying accounts</span><strong>{data.totals.paying}</strong></div>
        <div className="metric-card"><span>Revenue collected</span><strong>NGN {Number(data.totals.revenue).toLocaleString()}</strong></div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Accounts</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Tier</th><th>Status</th><th>Billing</th><th>Businesses</th><th>Joined</th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td><small>{a.email}</small></td>
                  <td>{a.full_name || "-"}</td>
                  <td><strong style={{ textTransform: "capitalize" }}>{a.tier}</strong></td>
                  <td>{a.status}</td>
                  <td>{a.billing_cycle || "-"}</td>
                  <td>{a.businesses}</td>
                  <td><small>{String(a.created_at || "").slice(0, 10)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Recent payments</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Reference</th><th>Account</th><th>Plan</th><th>Amount</th><th>Status</th><th>Paid</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td><small>{p.paystack_reference}</small></td>
                  <td><small>{p.email}</small></td>
                  <td style={{ textTransform: "capitalize" }}>{p.tier} {p.billing_cycle}</td>
                  <td className="money">NGN {(Number(p.amount_kobo) / 100).toLocaleString()}</td>
                  <td>{p.status}</td>
                  <td><small>{p.paid_at ? String(p.paid_at).slice(0, 16) : "-"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
