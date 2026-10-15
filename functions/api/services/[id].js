// /api/services/[id] — PATCH update, DELETE deactivate (soft)
import { json, getAuthContext, requireAuth, canManage, audit } from "../_utils";

async function getService(context, auth, id) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT * FROM services WHERE id = ? AND business_id = ? LIMIT 1`
  )
    .bind(id, auth.business.id)
    .first();
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can edit services." }, 403);
    }

    const id = Number(context.params.id);
    const service = await getService(context, auth, id);
    if (!service) return json({ ok: false, message: "Service not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return json({ ok: false, message: "Service name cannot be empty." }, 400);
      fields.push("name = ?");
      params.push(name);
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      params.push(body.description ? String(body.description).trim() : null);
    }
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (Number.isNaN(price) || price < 0) {
        return json({ ok: false, message: "Price must be a valid number." }, 400);
      }
      fields.push("price = ?");
      params.push(price);
    }
    if (body.unit !== undefined) {
      fields.push("unit = ?");
      params.push(String(body.unit));
    }
    if (body.isActive !== undefined) {
      fields.push("is_active = ?");
      params.push(body.isActive ? 1 : 0);
    }
    if (fields.length === 0) {
      return json({ ok: false, message: "Nothing to update." }, 400);
    }

    params.push(id, auth.business.id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE services SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
    )
      .bind(...params)
      .run();

    await audit(context, auth, "service.update", "service", id, body);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update service.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can deactivate services." }, 403);
    }

    const id = Number(context.params.id);
    const service = await getService(context, auth, id);
    if (!service) return json({ ok: false, message: "Service not found." }, 404);

    // Soft deactivate: history in past sales stays intact.
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE services SET is_active = 0 WHERE id = ? AND business_id = ?`
    )
      .bind(id, auth.business.id)
      .run();

    await audit(context, auth, "service.deactivate", "service", id, { name: service.name });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not deactivate service.", error: String(error) }, 500);
  }
}
