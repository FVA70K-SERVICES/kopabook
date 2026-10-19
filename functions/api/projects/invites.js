// /api/projects/invites — manage project invites (owner/partner only).
// GET ?projectId=  list invites for a project.
// POST { projectId, identifier, role }  create an invite. identifier is an
//   email or a username. Returns a shareable join link for WhatsApp.
// DELETE ?id=  revoke an invite.
import { json, safeAudit, projectAccessContext } from "./_lib";

function joinLink(request, token) {
  const url = new URL(request.url);
  return `${url.origin}/app/projects/join/${token}`;
}

export async function onRequestGet(context) {
  try {
    const projectId = Number(new URL(context.request.url).searchParams.get("projectId")) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, projectId);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can manage invites." }, 403);
    }

    const rows = await db
      .prepare(
        `SELECT i.id, i.token, i.role, i.invited_email, i.invited_username, i.status,
                i.created_at, u.full_name AS created_by_name,
                (SELECT COUNT(*) FROM project_members m WHERE m.project_id = i.project_id) AS member_count
         FROM project_invites i
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.project_id = ? AND i.business_id = ?
         ORDER BY i.id DESC`
      )
      .bind(project.id, project.business_id)
      .all();
    const invites = (rows.results || []).map((r) => ({
      ...r,
      joinLink: r.status === "pending" ? joinLink(context.request, r.token) : null,
    }));
    return json({ ok: true, invites });
  } catch (e) {
    return json({ ok: false, message: "Could not load invites.", error: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const projectId = Number(body.projectId) || null;
    const { auth, db, project, access, error } = await projectAccessContext(context, projectId);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can invite people." }, 403);
    }

    const identifier = String(body.identifier || "").trim();
    if (!identifier) return json({ ok: false, message: "Enter an email or username to invite." }, 400);
    const role = body.role === "viewer" ? "viewer" : "contributor";

    const isEmail = identifier.includes("@");
    const invited_email = isEmail ? identifier.toLowerCase() : null;
    const invited_username = isEmail ? null : identifier.toLowerCase();

    const token = crypto.randomUUID().replace(/-/g, "");
    const res = await db
      .prepare(
        `INSERT INTO project_invites
           (project_id, business_id, token, role, invited_email, invited_username, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(project.id, project.business_id, token, role, invited_email, invited_username, auth.user.id)
      .run();

    await safeAudit(context, auth, "project.invite", "project_invite", res.meta.last_row_id, {
      projectId: project.id, role, identifier,
    });
    return json({ ok: true, id: res.meta.last_row_id, token, joinLink: joinLink(context.request, token), role }, 201);
  } catch (e) {
    return json({ ok: false, message: "Could not create invite.", error: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const id = Number(new URL(context.request.url).searchParams.get("id")) || null;
    if (!id) return json({ ok: false, message: "Invite id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const invite = await db
      .prepare(`SELECT id, project_id, business_id FROM project_invites WHERE id = ?`)
      .bind(id)
      .first();
    if (!invite) return json({ ok: false, message: "Invite not found." }, 404);

    const { auth, access, error } = await projectAccessContext(context, invite.project_id);
    if (error) return error;
    if (!access.isOwnerPartner) {
      return json({ ok: false, message: "Only the project owner can revoke invites." }, 403);
    }

    await db.prepare(`UPDATE project_invites SET status = 'revoked' WHERE id = ?`).bind(id).run();
    await safeAudit(context, auth, "project.invite.revoke", "project_invite", id, { projectId: invite.project_id });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, message: "Could not revoke invite.", error: String(e) }, 500);
  }
}
