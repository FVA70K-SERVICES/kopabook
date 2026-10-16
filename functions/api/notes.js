// /api/notes — KopaBook Notebook.
// visibility: 'private' = only the creator can see it.
//             'shared'  = everyone in the business (owners, managers, staff) can see it.
import { json, getAuthContext, requireAuth } from "./_utils.js";

function canSee(auth, note) {
  if (note.business_id !== auth.business.id) return false;
  if (note.visibility === "shared") return true;
  return note.user_id === auth.user.id;
}

function isManager(auth) {
  return auth.business.role === "owner" || auth.business.role === "partner";
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const filter = url.searchParams.get("visibility"); // private | shared | all
    const conds = ["business_id = ?", "(visibility = 'shared' OR (visibility = 'private' AND user_id = ?))"];
    const params = [auth.business.id, auth.user.id];
    if (filter === "private" || filter === "shared") {
      conds.push("visibility = ?");
      params.push(filter);
    }

    const db = context.env.KOPABOOK_DB;
    const rows = await db.prepare(
      `SELECT n.id, n.title, n.content, n.visibility, n.user_id, n.created_at, n.updated_at,
              u.full_name AS author_name
       FROM notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE ${conds.join(" AND ")}
       ORDER BY n.updated_at DESC LIMIT 200`
    ).bind(...params).all();

    return json({ ok: true, notes: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load notes." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const title = String(body.title || "").slice(0, 120);
    const content = String(body.content || "").slice(0, 20000);
    const visibility = body.visibility === "shared" ? "shared" : "private";
    if (!title && !content) {
      return json({ ok: false, message: "Write something first." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const r = await db.prepare(
      `INSERT INTO notes (business_id, user_id, title, content, visibility) VALUES (?, ?, ?, ?, ?)`
    ).bind(auth.business.id, auth.user.id, title, content, visibility).run();

    return json({ ok: true, id: Number(r.meta.last_row_id) });
  } catch (e) {
    return json({ ok: false, message: "Could not save the note." }, 500);
  }
}

export async function onRequestPut(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const id = Number(body.id) || 0;
    const db = context.env.KOPABOOK_DB;
    const note = await db.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first();
    if (!note || !canSee(auth, note)) {
      return json({ ok: false, message: "Note not found." }, 404);
    }
    // Only the creator edits, except owners/partners may edit shared notes.
    const mine = note.user_id === auth.user.id;
    if (!mine && !(note.visibility === "shared" && isManager(auth))) {
      return json({ ok: false, message: "Only the person who wrote it can edit this note." }, 403);
    }

    const title = String(body.title ?? note.title).slice(0, 120);
    const content = String(body.content ?? note.content).slice(0, 20000);
    const visibility = body.visibility === "shared" || body.visibility === "private"
      ? body.visibility : note.visibility;

    await db.prepare(
      `UPDATE notes SET title = ?, content = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(title, content, visibility, id).run();

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not update the note." }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const id = Number(url.searchParams.get("id")) || 0;
    const db = context.env.KOPABOOK_DB;
    const note = await db.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first();
    if (!note || !canSee(auth, note)) {
      return json({ ok: false, message: "Note not found." }, 404);
    }
    const mine = note.user_id === auth.user.id;
    if (!mine && !(note.visibility === "shared" && isManager(auth))) {
      return json({ ok: false, message: "Only the person who wrote it can delete this note." }, 403);
    }

    await db.prepare(`DELETE FROM notes WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not delete the note." }, 500);
  }
}
