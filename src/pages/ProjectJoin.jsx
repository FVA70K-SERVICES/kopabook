// Project invite join page: /app/projects/join/:token
// Public page. Shows what the invite is for, then:
// - signed out: sign in or create an account (the token is remembered and
//   the join completes right after auth, one account, one login).
// - signed in: one tap to join, then lands on the shared project.
import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import Logo from "../components/Logo";

const ROLE_LABEL = { contributor: "Contributor (can add records)", viewer: "Viewer (read only)" };

export default function ProjectJoinPage({ token, session }) {
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api.get("/api/projects/join?token=" + encodeURIComponent(token))
      .then((d) => { setInvite(d); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function joinNow() {
    setJoining(true);
    try {
      const d = await api.post("/api/projects/join", { token });
      nav("/app/projects?shared=" + d.projectId);
    } catch (e) { setError(e.message); }
    setJoining(false);
  }

  function goAuth(path) {
    try { localStorage.setItem("kb_pending_invite", token); } catch {}
    nav(path);
  }

  return (
    <div className="page" style={{ background: "var(--bg)" }}>
      <div className="wrap">
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
        </div>
        <div className="form-card">
          <h1>You are invited</h1>
          {loading && <div className="loading">Checking invite...</div>}
          {error && <div className="alert alert-error">{error}</div>}
          {!loading && !error && invite && (
            <>
              <p style={{ fontSize: 16 }}>
                <strong>{invite.businessName}</strong> invited you to the project{" "}
                <strong>{invite.project.name}</strong>.
              </p>
              <p className="hint">Your role: {ROLE_LABEL[invite.role] || invite.role}</p>
              <p className="hint">
                {invite.role === "viewer"
                  ? "You will see this project only: its records, milestones and reports. Nothing else in their business."
                  : "You can add money records and update milestones on this project. You will see this project only, nothing else in their business."}
              </p>
              {session ? (
                <button className="btn btn-primary btn-block" disabled={joining} onClick={joinNow}>
                  {joining ? "Joining..." : "Join project"}
                </button>
              ) : (
                <>
                  <button className="btn btn-primary btn-block" onClick={() => goAuth("/login")}>Sign in to join</button>
                  <p style={{ textAlign: "center", marginTop: 12, fontSize: 14, color: "var(--muted)" }}>
                    New to KopaBook? <a href="#" onClick={(e) => { e.preventDefault(); goAuth("/register"); }}>Create your free account</a>
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
