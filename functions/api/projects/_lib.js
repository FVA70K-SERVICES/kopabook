// Shared helpers for the Projects API.
// Projects is a paid-tier feature (Starter and up), business-scoped.
import { json, getAuthContext, requireAuth } from "../_utils";
import { getBusinessOwnerTier } from "../billing";

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
