// GET /api/projects/shared — projects the signed-in user is invited to
// as a member. Works on any account (free included, no business needed).
// Only projects whose owner's business is on a paid tier are included.
// Members see ONLY these projects, never the rest of the business.
import { json, getAuthContext } from "../_utils";
import { projectTotals } from "./_lib";
import { getBusinessOwnerTier } from "../billing";

export async function onRequestGet(context) {
  try {
    const db = context.env.KOPABOOK_DB;
    const auth = await getAuthContext(context);
    if (!auth || !auth.user) return json({ ok: false, message: "Not signed in." }, 401);

    const rows = await db
      .prepare(
        `SELECT p.*, pm.role AS member_role, b.name AS business_name
         FROM project_members pm
         INNER JOIN projects p ON p.id = pm.project_id
         INNER JOIN businesses b ON b.id = p.business_id
         WHERE pm.user_id = ?
         ORDER BY p.id DESC`
      )
      .bind(auth.user.id)
      .all();

    const projects = [];
    for (const p of rows.results || []) {
      const { tier } = await getBusinessOwnerTier(db, p.business_id);
      if (!["pro", "solo", "starter"].includes(tier)) continue;
      projects.push({ ...p, totals: await projectTotals(db, p.id) });
    }
    return json({ ok: true, projects });
  } catch (e) {
    return json({ ok: false, message: "Could not load shared projects.", error: String(e) }, 500);
  }
}
