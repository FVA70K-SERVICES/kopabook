// /api/projects/members — who belongs to a project via invite.
// GET ?projectId=  list the project's invited members (anyone with
//   access to the project: business members and fellow project members).
// DELETE ?projectId=&userId=  remove a member (project owner/partner
//   only). The removed person loses access to the project at once;
//   their past records stay, still credited to their name.
import { json, safeAudit, projectAccessContext } from "./_lib";

export async function onRequestGet(context) {
  try {
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    const { db, project, error } = await projectAccessContext(context, projectId);
    if (error) return error;

    const rows = await db
      .prepare(
        `SELECT pm.user_id, pm.role, pm.joined_at, u.full_name, u.email
         FROM project_members pm
         INNER JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = ?
         ORDER BY pm.id ASC`
      )
      .bind(project.id)
      .all();
    return json({ ok: true, members: rows.results || [] });
  } catch (e) {
    return json({ ok: false, message: "Could not load members.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const url = new URL(context.request.url);
    const projectId = Number(url.searchParams.get("projectId")) || null;
    const userId = Number(url.searchParams.get("userId")) || null;
    if (!userId) return json({ ok: false, message: "Member user id is required." }, 400);

    const { auth, db, project, access, error } = await projectAccessContext(context, projectId);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can remove members." }, 403);
    }

    const res = await db
      .prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`)
      .bind(project.id, userId)
      .run();
    if (!res.meta || !res.meta.changes) {
      return json({ ok: false, message: "That person is not a member of this project." }, 404);
    }

    await safeAudit(context, auth, "project.member.remove", "project_member", userId, {
      projectId: project.id,
    });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not remove member.", error: String(e) }, 500);
  }
}
