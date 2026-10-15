// /api/suppliers/verify — POST set verification status (owner or manager only)
import { json, getAuthContext, requireAuth, canManage, audit } from "../_utils";

const VALID_STATUSES = ["unverified", "pending", "verified"];

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can verify suppliers." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const supplierId = Number(body.supplierId);
    const status = body.status ? String(body.status).toLowerCase() : "";

    if (!supplierId) {
      return json({ ok: false, message: "Supplier is required." }, 400);
    }
    if (!VALID_STATUSES.includes(status)) {
      return json({ ok: false, message: "Status must be unverified, pending, or verified." }, 400);
    }

    const supplier = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, name, verification_status FROM suppliers
       WHERE id = ? AND business_id = ? LIMIT 1`
    )
      .bind(supplierId, auth.business.id)
      .first();

    if (!supplier) return json({ ok: false, message: "Supplier not found." }, 404);

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE suppliers SET verification_status = ? WHERE id = ? AND business_id = ?`
    )
      .bind(status, supplierId, auth.business.id)
      .run();

    await audit(context, auth, "supplier.verify", "supplier", supplierId, {
      name: supplier.name,
      from: supplier.verification_status,
      to: status,
    });
    return json({ ok: true, status });
  } catch (error) {
    return json({ ok: false, message: "Could not update verification status.", error: String(error) }, 500);
  }
}
