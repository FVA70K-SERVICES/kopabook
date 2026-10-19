// /api/projects/report — GET the full accountability summary for a project.
// Returns everything the frontend needs to render the printable report:
// project details, totals, per-category breakdowns, all transactions,
// milestones and who recorded what.
// Project members (invitees) see ONLY the invited project.
import { json, projectAccessContext, projectTotals } from "./_lib";

export async function onRequestGet(context) {
  try {
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    const { auth, db, project, error } = await projectAccessContext(context, projectId);
    if (error) return error;

    const totals = await projectTotals(db, project.id);

    const byCategory = await db
      .prepare(
        `SELECT kind, category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM project_transactions WHERE project_id = ?
         GROUP BY kind, category ORDER BY kind, total DESC`
      )
      .bind(project.id)
      .all();

    const transactions = await db
      .prepare(
        `SELECT t.id, t.kind, t.amount, t.category, t.description, t.created_at,
                u.full_name AS recorded_by_name
         FROM project_transactions t
         LEFT JOIN users u ON u.id = t.recorded_by
         WHERE t.project_id = ?
         ORDER BY t.created_at ASC, t.id ASC`
      )
      .bind(project.id)
      .all();

    const milestones = await db
      .prepare(`SELECT id, title, description, due_date, status, created_at FROM project_milestones WHERE project_id = ? ORDER BY id ASC`)
      .bind(project.id)
      .all();

    const business = await db
      .prepare(`SELECT name FROM businesses WHERE id = ?`)
      .bind(project.business_id)
      .first();

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      businessName: business?.name || "",
      generatedBy: auth.user.full_name || auth.user.name || "",
      project,
      totals,
      byCategory: byCategory.results || [],
      transactions: transactions.results || [],
      milestones: milestones.results || [],
    });
  } catch (e) {
    return json({ ok: false, message: "Could not build report.", error: String(e) }, 500);
  }
}
