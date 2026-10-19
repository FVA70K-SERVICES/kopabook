// /api/projects/milestones — GET list milestones for a project,
// POST add milestone, PATCH update status/details.
// Project members (invitees) see ONLY the invited project. Contributors can
// add and update milestones; viewers are read-only.
import { json, safeAudit, projectAccessContext } from "./_lib";

export async function onRequestGet(context) {
  try {
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    const { db, project, error } = await projectAccessContext(context, projectId);
    if (error) return error;

    const rows = await db
      .prepare(`SELECT * FROM project_milestones WHERE project_id = ? ORDER BY id ASC`)
      .bind(project.id)
      .all();
    return json({ ok: true, milestones: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load milestones.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const projectId = Number(body.projectId) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, projectId);
    if (error) return error;
    if (!access.canWrite) {
      return json({ ok: false, message: "Viewers cannot add milestones to this project." }, 403);
    }

    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return json({ ok: false, message: "Milestone title is required." }, 400);
    const description = String(body.description || "").trim().slice(0, 1000);
    const dueDate = body.dueDate ? String(body.dueDate).slice(0, 10) : null;

    const res = await db
      .prepare(
        `INSERT INTO project_milestones (project_id, business_id, title, description, due_date)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(project.id, project.business_id, title, description, dueDate)
      .run();

    await safeAudit(context, auth, "project.milestone", "project_milestone", res.meta.last_row_id, { projectId: project.id, title });
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not add milestone.", error: String(e) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const id = Number(body.id) || null;
    if (!id) return json({ ok: false, message: "Milestone id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const ms = await db
      .prepare(`SELECT id, project_id, business_id FROM project_milestones WHERE id = ?`)
      .bind(id)
      .first();
    if (!ms) return json({ ok: false, message: "Milestone not found." }, 404);

    const { access, error } = await projectAccessContext(context, ms.project_id);
    if (error) return error;
    if (!access.canWrite) {
      return json({ ok: false, message: "Viewers cannot update milestones on this project." }, 403);
    }

    const fields = [];
    const vals = [];
    if (body.status !== undefined) {
      if (!["pending", "done"].includes(body.status)) return json({ ok: false, message: "Invalid status." }, 400);
      fields.push("status = ?");
      vals.push(body.status);
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return json({ ok: false, message: "Milestone title cannot be empty." }, 400);
      fields.push("title = ?");
      vals.push(title.slice(0, 200));
    }
    if (body.description !== undefined) { fields.push("description = ?"); vals.push(String(body.description).slice(0, 1000)); }
    if (body.dueDate !== undefined) { fields.push("due_date = ?"); vals.push(body.dueDate ? String(body.dueDate).slice(0, 10) : null); }
    if (!fields.length) return json({ ok: false, message: "Nothing to update." }, 400);
    vals.push(id);

    await db.prepare(`UPDATE project_milestones SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not update milestone.", error: String(e) }, 500);
  }
}
