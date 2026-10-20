// /api/projects/join — accept a project invite.
// GET ?token=  public invite preview (project name, business name, role).
//   The token is the secret; no login needed to preview.
// POST { token }  join the project. Requires a signed-in user (any account,
//   free included, no business needed). One account, one login: nobody
//   creates a new account per project.
import { json, getAuthContext } from "../_utils";

export async function onRequestGet(context) {
  try {
    const db = context.env.KOPABOOK_DB;
    const token = String(new URL(context.request.url).searchParams.get("token") || "").trim();
    if (!token) return json({ ok: false, message: "Invite token is required." }, 400);

    const invite = await db
      .prepare(
        `SELECT i.project_id, i.role, p.name AS project_name, p.type AS project_type,
                b.name AS business_name
         FROM project_invites i
         INNER JOIN projects p ON p.id = i.project_id
         INNER JOIN businesses b ON b.id = i.business_id
         WHERE i.token = ? AND i.status = 'pending' LIMIT 1`
      )
      .bind(token)
      .first();
    if (!invite) {
      return json({ ok: false, message: "This invite link is invalid or has been revoked." }, 404);
    }
    return json({
      ok: true,
      project: { id: invite.project_id, name: invite.project_name, type: invite.project_type },
      businessName: invite.business_name,
      role: invite.role,
    });
  } catch (e) {
    return json({ ok: false, message: "Could not read invite.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.KOPABOOK_DB;
    const auth = await getAuthContext(context);
    if (!auth || !auth.user) return json({ ok: false, message: "Sign in to join this project." }, 401);

    const body = await context.request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return json({ ok: false, message: "Invite token is required." }, 400);

    const invite = await db
      .prepare(
        `SELECT id, project_id, business_id, role
         FROM project_invites WHERE token = ? AND status = 'pending' LIMIT 1`
      )
      .bind(token)
      .first();
    if (!invite) {
      return json({ ok: false, message: "This invite link is invalid or has been revoked." }, 404);
    }

    const existing = await db
      .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`)
      .bind(invite.project_id, auth.user.id)
      .first();
    if (existing) {
      return json({ ok: true, projectId: invite.project_id, role: existing.role, alreadyMember: true });
    }

    await db
      .prepare(
        `INSERT INTO project_members (project_id, business_id, user_id, role) VALUES (?, ?, ?, ?)`
      )
      .bind(invite.project_id, invite.business_id, auth.user.id, invite.role)
      .run();

    return json({ ok: true, projectId: invite.project_id, role: invite.role, alreadyMember: false }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not join project.", error: String(e) }, 500);
  }
}
