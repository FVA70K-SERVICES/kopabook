// /api/projects/[id] — GET project detail with totals, PATCH update, DELETE.
import { json, audit } from "../_utils";
import { projectContext, getProject, projectTotals } from "./_lib";

export async function onRequestGet(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    const id = Number(context.params.id) || null;
    if (!id) return json({ ok: false, message: "Project id is required." }, 400);

    const project = await getProject(db, auth.business.id, id);
    if (!project) return json({ ok: false, message: "Project not found." }, 404);
    const totals = await projectTotals(db, id);
    return json({ ok: true, project, totals });
  } catch (e) {
    return json({ ok: false, message: "Could not load project.", error: String(e) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    const id = Number(context.params.id) || null;
    if (!id) return json({ ok: false, message: "Project id is required." }, 400);

    const project = await getProject(db, auth.business.id, id);
    if (!project) return json({ ok: false, message: "Project not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const vals = [];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return json({ ok: false, message: "Project name cannot be empty." }, 400);
      fields.push("name = ?");
      vals.push(name);
    }
    if (body.description !== undefined) { fields.push("description = ?"); vals.push(String(body.description).slice(0, 2000)); }
    if (body.budget !== undefined) {
      const budget = Number(body.budget);
      if (isNaN(budget) || budget < 0) return json({ ok: false, message: "Budget must be a non-negative number." }, 400);
      fields.push("budget = ?");
      vals.push(budget);
    }
    if (body.startDate !== undefined) { fields.push("start_date = ?"); vals.push(body.startDate ? String(body.startDate).slice(0, 10) : null); }
    if (body.endDate !== undefined) { fields.push("end_date = ?"); vals.push(body.endDate ? String(body.endDate).slice(0, 10) : null); }
    if (body.status !== undefined) {
      if (!["active", "completed"].includes(body.status)) return json({ ok: false, message: "Invalid status." }, 400);
      fields.push("status = ?");
      vals.push(body.status);
    }
    if (!fields.length) return json({ ok: false, message: "Nothing to update." }, 400);
    fields.push("updated_at = datetime('now')");
    vals.push(id, auth.business.id);

    await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`).bind(...vals).run();
    await audit(context, auth, "project.update", "project", id, { fields: fields.length });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not update project.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    if (auth.business.role !== "owner" && auth.business.role !== "partner") {
      return json({ ok: false, message: "Only the owner or a partner can delete a project." }, 403);
    }
    const id = Number(context.params.id) || null;
    if (!id) return json({ ok: false, message: "Project id is required." }, 400);

    const project = await getProject(db, auth.business.id, id);
    if (!project) return json({ ok: false, message: "Project not found." }, 404);

    await db.batch([
      db.prepare(`DELETE FROM project_transactions WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM project_milestones WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM projects WHERE id = ? AND business_id = ?`).bind(id, auth.business.id),
    ]);
    await audit(context, auth, "project.delete", "project", id, { name: project.name });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not delete project.", error: String(e) }, 500);
  }
}
