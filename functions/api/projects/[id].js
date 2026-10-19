// /api/projects/[id] — GET project detail with totals, PATCH update, DELETE.
// Project members (invitees) can view the detail of ONLY the invited project.
// PATCH and DELETE stay owner/partner only.
import { json, safeAudit, projectAccessContext } from "./_lib";
import { projectTotals } from "./_lib";

export async function onRequestGet(context) {
  try {
    const id = Number(context.params.id) || null;
    const { db, project, error } = await projectAccessContext(context, id);
    if (error) return error;
    const totals = await projectTotals(db, project.id);
    return json({ ok: true, project, totals });
  } catch (e) {
    return json({ ok: false, message: "Could not load project.", error: String(e) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const id = Number(context.params.id) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, id);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can change project details." }, 403);
    }

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
    vals.push(id, project.business_id);

    await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`).bind(...vals).run();
    await safeAudit(context, auth, "project.update", "project", id, { fields: fields.length });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not update project.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const id = Number(context.params.id) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, id);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can delete a project." }, 403);
    }

    await db.batch([
      db.prepare(`DELETE FROM project_transactions WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM project_milestones WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM project_members WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM project_invites WHERE project_id = ?`).bind(id),
      db.prepare(`DELETE FROM projects WHERE id = ? AND business_id = ?`).bind(id, project.business_id),
    ]);
    await safeAudit(context, auth, "project.delete", "project", id, { name: project.name });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not delete project.", error: String(e) }, 500);
  }
}
