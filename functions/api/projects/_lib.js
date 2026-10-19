// Shared helpers for the Projects API.
// Projects is a paid-tier feature (Starter and up), business-scoped.
// Invited members reach a single project without joining the business:
// they see ONLY that project, never the rest of the business.
import { json, getAuthContext, requireAuth, audit } from "../_utils";
import { getBusinessOwnerTier } from "../billing";

// Re-exported so project route files can `import { json } from "./_lib"`.
export { json };

export const PROJECT_TYPES = [
  "construction",
  "event",
  "charity",
  "business",
  "custom",
];

export async function projectContext(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth);
  if (denied) return { error: denied };
  const { tier } = await getBusinessOwnerTier(context.env.KOPABOOK_DB, auth.business.id);
  if (!["pro", "solo", "starter"].includes(tier)) {
    return {
      error: json(
        { ok: false, upgradeRequired: true, message: "Projects is a Starter feature. Upgrade to track full project accountability." },
        403
      ),
    };
  }
  return { auth, db: context.env.KOPABOOK_DB };
}

// Project-scoped access. The signed-in user may reach a project either
// through their business membership (existing behaviour) or as an invited
// project member. Returns { auth, db, project, access } or { error }.
// access = { kind: "business" | "member", role, isOwnerPartner, canWrite }.
export async function projectAccessContext(context, projectId) {
  const db = context.env.KOPABOOK_DB;
  const auth = await getAuthContext(context);
  if (!auth || !auth.user) {
    return { error: json({ ok: false, message: "Not signed in." }, 401) };
  }
  const id = Number(projectId);
  if (!id) return { error: json({ ok: false, message: "Project id is required." }, 400) };

  const project = await db
    .prepare(`SELECT * FROM projects WHERE id = ?`)
    .bind(id)
    .first();
  if (!project) return { error: json({ ok: false, message: "Project not found." }, 404) };

  // The project owner's business must be on a paid tier. Invitees join on
  // any account, including free.
  const { tier } = await getBusinessOwnerTier(db, project.business_id);
  if (!["pro", "solo", "starter"].includes(tier)) {
    return {
      error: json(
        { ok: false, upgradeRequired: true, message: "Projects is a Starter feature. The project owner's plan has lapsed." },
        403
      ),
    };
  }

  // Business path: the user belongs to the project's business. The active
  // business on the session may be a different one the user also owns, so
  // check membership directly too (one-tap switching between businesses).
  let bizRole = null;
  if (auth.business && auth.business.id === project.business_id) {
    bizRole = auth.business.role;
  } else {
    const m = await db
      .prepare(
        `SELECT role FROM business_members
         WHERE business_id = ? AND user_id = ? AND (suspended IS NULL OR suspended = 0) LIMIT 1`
      )
      .bind(project.business_id, auth.user.id)
      .first();
    if (m) bizRole = m.role;
  }
  if (bizRole) {
    const isOwnerPartner = bizRole === "owner" || bizRole === "partner";
    return {
      auth, db, project,
      access: { kind: "business", role: bizRole, isOwnerPartner, canWrite: true },
    };
  }

  // Member path: invited to this project only. Sees ONLY this project.
  const member = await db
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`)
    .bind(id, auth.user.id)
    .first();
  if (!member) {
    return { error: json({ ok: false, message: "You do not have access to this project." }, 403) };
  }
  return {
    auth, db, project,
    access: {
      kind: "member",
      role: member.role,
      isOwnerPartner: false,
      canWrite: member.role === "contributor",
    },
  };
}

// Audit that never breaks the flow for members who have no active business.
export async function safeAudit(context, auth, actionType, entityType, entityId, metadata) {
  try {
    if (!auth || !auth.business || !auth.business.id) return;
    await audit(context, auth, actionType, entityType, entityId, metadata);
  } catch {
    // audit must never break the main flow
  }
}

export async function getProject(db, businessId, id) {
  return db
    .prepare(`SELECT * FROM projects WHERE id = ? AND business_id = ?`)
    .bind(id, businessId)
    .first();
}

export async function projectTotals(db, projectId) {
  const income = await db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM project_transactions WHERE project_id = ? AND kind = 'income'`)
    .bind(projectId)
    .first();
  const expense = await db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM project_transactions WHERE project_id = ? AND kind = 'expense'`)
    .bind(projectId)
    .first();
  const milestones = await db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM project_milestones WHERE project_id = ?`
    )
    .bind(projectId)
    .first();
  const tIn = Number(income?.n) || 0;
  const tOut = Number(expense?.n) || 0;
  return {
    totalIncome: tIn,
    totalExpense: tOut,
    balance: tIn - tOut,
    milestonesTotal: Number(milestones?.total) || 0,
    milestonesDone: Number(milestones?.done) || 0,
  };
}
