// /api/services — GET list, POST create
// Services are sold like products but never touch stock.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const activeOnly = url.searchParams.get("active") !== "all";

    let sql = `SELECT * FROM services WHERE business_id = ?`;
    const params = [auth.business.id];
    if (activeOnly) sql += ` AND is_active = 1`;
    sql += ` ORDER BY name ASC`;

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, services: result.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load services.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can add services.");
    if (permDenied) return permDenied;

    const body = await context.request.json().catch(() => ({}));
    const { name, description, price, unit } = body;

    if (!name || price === undefined || price === null) {
      return json({ ok: false, message: "Service name and price are required." }, 400);
    }
    const p = Number(price);
    if (Number.isNaN(p) || p < 0) {
      return json({ ok: false, message: "Price must be a valid number." }, 400);
    }

    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO services (business_id, name, description, price, unit, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        auth.business.id,
        String(name).trim(),
        description ? String(description).trim() : null,
        p,
        unit ? String(unit) : "per job",
        toSqliteDate()
      )
      .run();
    const serviceId = result.meta.last_row_id;

    await audit(context, auth, "service.create", "service", serviceId, { name: String(name).trim() });
    return json({ ok: true, serviceId }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create service.", error: String(error) }, 500);
  }
}
