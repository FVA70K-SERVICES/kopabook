// /api/projects/transactions — GET list transactions for a project,
// POST record income/expense, DELETE remove a transaction.
import { json, audit } from "../_utils";
import { projectContext, getProject } from "./_lib";

export async function onRequestGet(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    if (!projectId) return json({ ok: false, message: "projectId is required." }, 400);

    const project = await getProject(db, auth.business.id, projectId);
    if (!project) return json({ ok: false, message: "Project not found." }, 404);

    const rows = await db
      .prepare(
        `SELECT t.*, u.full_name AS recorded_by_name
         FROM project_transactions t
         LEFT JOIN users u ON u.id = t.recorded_by
         WHERE t.project_id = ?
         ORDER BY t.created_at DESC, t.id DESC`
      )
      .bind(projectId)
      .all();
    return json({ ok: true, transactions: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load transactions.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;

    const body = await context.request.json().catch(() => ({}));
    const projectId = Number(body.projectId) || null;
    if (!projectId) return json({ ok: false, message: "projectId is required." }, 400);

    const project = await getProject(db, auth.business.id, projectId);
    if (!project) return json({ ok: false, message: "Project not found." }, 404);

    const kind = body.kind === "income" ? "income" : "expense";
    const amount = Number(body.amount) || 0;
    if (amount <= 0) return json({ ok: false, message: "Amount must be greater than zero." }, 400);
    const category = String(body.category || "").trim().slice(0, 100);
    const description = String(body.description || "").trim().slice(0, 500);
    if (!description) return json({ ok: false, message: "Description is required." }, 400);
    const receiptUrl = body.receiptUrl ? String(body.receiptUrl).slice(0, 500) : null;

    const res = await db
      .prepare(
        `INSERT INTO project_transactions (project_id, business_id, kind, amount, category, description, receipt_url, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(projectId, auth.business.id, kind, amount, category, description, receiptUrl, auth.user.id)
      .run();

    await audit(context, auth, "project.transaction", "project_transaction", res.meta.last_row_id, { projectId, kind, amount });
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not record transaction.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const { auth, db, error } = await projectContext(context);
    if (error) return error;
    const id = Number(new URL(context.request.url).searchParams.get("id")) || null;
    if (!id) return json({ ok: false, message: "Transaction id is required." }, 400);

    const tx = await db
      .prepare(`SELECT id, project_id FROM project_transactions WHERE id = ? AND business_id = ?`)
      .bind(id, auth.business.id)
      .first();
    if (!tx) return json({ ok: false, message: "Transaction not found." }, 404);

    await db.prepare(`DELETE FROM project_transactions WHERE id = ?`).bind(id).run();
    await audit(context, auth, "project.transaction.delete", "project_transaction", id, { projectId: tx.project_id });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not delete transaction.", error: String(e) }, 500);
  }
}
