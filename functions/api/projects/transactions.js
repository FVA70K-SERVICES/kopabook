// /api/projects/transactions — GET list transactions for a project,
// POST record income/expense, DELETE remove a transaction.
// Project members (invitees) see ONLY the invited project. Contributors can
// add records; viewers are read-only. Deletes stay owner/partner only.
import { json, safeAudit, projectAccessContext } from "./_lib";

export async function onRequestGet(context) {
  try {
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    const { auth, db, project, error } = await projectAccessContext(context, projectId);
    if (error) return error;

    const rows = await db
      .prepare(
        `SELECT t.*, u.full_name AS recorded_by_name
         FROM project_transactions t
         LEFT JOIN users u ON u.id = t.recorded_by
         WHERE t.project_id = ?
         ORDER BY t.created_at DESC, t.id DESC`
      )
      .bind(project.id)
      .all();
    return json({ ok: true, transactions: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load transactions.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const projectId = Number(body.projectId) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, projectId);
    if (error) return error;
    if (!access.canWrite) {
      return json({ ok: false, message: "Viewers cannot add records to this project." }, 403);
    }

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
      .bind(project.id, project.business_id, kind, amount, category, description, receiptUrl, auth.user.id)
      .run();

    await safeAudit(context, auth, "project.transaction", "project_transaction", res.meta.last_row_id, { projectId: project.id, kind, amount });
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not record transaction.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const id = Number(new URL(context.request.url).searchParams.get("id")) || null;
    if (!id) return json({ ok: false, message: "Transaction id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const tx = await db
      .prepare(`SELECT id, project_id, business_id FROM project_transactions WHERE id = ?`)
      .bind(id)
      .first();
    if (!tx) return json({ ok: false, message: "Transaction not found." }, 404);

    const { auth, access, error } = await projectAccessContext(context, tx.project_id);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can delete records." }, 403);
    }

    await db.prepare(`DELETE FROM project_transactions WHERE id = ?`).bind(id).run();
    await safeAudit(context, auth, "project.transaction.delete", "project_transaction", id, { projectId: tx.project_id });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not delete transaction.", error: String(e) }, 500);
  }
}
