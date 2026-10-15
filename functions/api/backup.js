// /api/backup — full business data backup stored in the KOPABOOK_R2 bucket.
// POST: export all business tables to JSON, save as backups/<businessId>/<stamp>.json
// GET: list backups (newest first). GET ?download=<key>: download one backup file.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

const TABLES = [
  "products", "services", "customers", "suppliers",
  "sales", "sale_items", "payment_records",
  "expenses", "expense_categories",
  "inventory_items", "inventory_movements", "supplier_purchases",
  "payment_modes", "phone_contacts", "reminder_logs",
  "customer_ledger", "daily_summaries", "staff_shifts",
];

function r2(context) {
  return context.env.KOPABOOK_R2 || null;
}

function ownedBy(key, businessId) {
  return typeof key === "string" && key.startsWith(`backups/${businessId}/`) && !key.includes("..");
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet. Create the R2 bucket and bind it as KOPABOOK_R2." }, 503);

    const db = context.env.KOPABOOK_DB;
    const data = { exported_at: new Date().toISOString(), business_id: auth.business.id, tables: {} };

    const biz = await db.prepare(`SELECT * FROM businesses WHERE id = ?`).bind(auth.business.id).first();
    data.tables.businesses = biz ? [biz] : [];

    for (const t of TABLES) {
      try {
        const rows = await db.prepare(`SELECT * FROM ${t} WHERE business_id = ?`).bind(auth.business.id).all();
        data.tables[t] = rows.results || [];
      } catch {
        data.tables[t] = [];
      }
    }
    // Business members (users linked to this business).
    try {
      const members = await db.prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
         FROM users u JOIN business_members m ON m.user_id = u.id
         WHERE m.business_id = ?`
      ).bind(auth.business.id).all();
      data.tables.users = members.results || [];
    } catch {
      data.tables.users = [];
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const key = `backups/${auth.business.id}/${stamp}.json`;
    const body = JSON.stringify(data);
    await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });

    await audit(context, auth, "backup.create", "backups", null, { key, bytes: body.length });
    return json({ ok: true, key, bytes: body.length, tables: Object.keys(data.tables).length }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create backup.", error: String(error) }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet." }, 503);

    const url = new URL(context.request.url);
    const download = url.searchParams.get("download") || "";
    if (download) {
      if (!ownedBy(download, auth.business.id)) return json({ ok: false, message: "Backup not found." }, 404);
      const obj = await bucket.get(download);
      if (!obj) return json({ ok: false, message: "Backup not found." }, 404);
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Content-Disposition", `attachment; filename="${download.split("/").pop()}"`);
      return new Response(obj.body, { headers });
    }

    const listed = await bucket.list({ prefix: `backups/${auth.business.id}/`, limit: 30 });
    const items = (listed.objects || [])
      .map((o) => ({ key: o.key, size: o.size, created: o.uploaded }))
      .sort((a, b) => (b.key > a.key ? 1 : -1));
    return json({ ok: true, backups: items });
  } catch (error) {
    return json({ ok: false, message: "Could not list backups.", error: String(error) }, 500);
  }
}
