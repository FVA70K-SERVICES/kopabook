// /api/projects — GET list projects for the business, POST create a project.
import { json, audit } from "../_utils";
import { projectContext, projectTotals, PROJECT_TYPES } from "./_lib";

export async function onRequestGet(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    const b = auth.business.id;

    const rows = await db
      .prepare(`SELECT * FROM projects WHERE business_id = ? ORDER BY status ASC, id DESC`)
      .bind(b)
      .all();
    const projects = [];
    for (const p of rows.results || []) {
      projects.push({ ...p, totals: await projectTotals(db, p.id) });
    }
    return json({ ok: true, projects });
  } catch (e) {
    return json({ ok: false, message: "Could not load projects.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;

    const body = await context.request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) return json({ ok: false, message: "Project name is required." }, 400);
    const type = PROJECT_TYPES.includes(body.type) ? body.type : "custom";
    const description = String(body.description || "").slice(0, 2000);
    const budget = Number(body.budget) || 0;
    if (budget < 0) return json({ ok: false, message: "Budget cannot be negative." }, 400);
    const startDate = body.startDate ? String(body.startDate).slice(0, 10) : null;
    const endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;

    const res = await db
      .prepare(
        `INSERT INTO projects (business_id, name, type, description, budget, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(auth.business.id, name, type, description, budget, startDate, endDate)
      .run();

    await audit(context, auth, "project.create", "project", res.meta.last_row_id, { name, type });
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not create project.", error: String(e) }, 500);
  }
}
