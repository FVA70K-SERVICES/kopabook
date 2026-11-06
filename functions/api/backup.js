// /api/backup — full business data backup stored in the KOPABOOK_R2 bucket.
// POST: export all business tables to JSON, save as backups/<businessId>/<stamp>.json
// GET: list backups (newest first). GET ?download=<key>: download one backup file.
// GET ?csv=<table>: download one record type as CSV (this business only).
//
// Full backup and export, self-serve (roadmap item 8, picked up):
// - The JSON export covers EVERY record type for the business, including
//   the tables the Phase-1 audit noted as missing: hotel_rooms,
//   hotel_bookings, hotel_charges, hotel_payments, notes, business_members,
//   and the new 0061 tables receipt_sends and stock_adjustments.
// - Tables without their own business_id are exported through the record
//   that owns them (sale_items through sales, inventory_items and
//   inventory_movements through products, customer_ledger through
//   customers). The old code filtered those by business_id and silently
//   exported empty lists for them; that is fixed here.
// - A table that does not exist yet in this database still returns an
//   empty list, never an error, so the export never fails on a table the
//   business has never used.
// - Never exported: sessions (sign-in tokens) and the users table itself
//   (password hashes). Team members appear only as the public columns
//   joined through business_members, as before.
// - CSV export reuses the Reports buildCsv escaping (quote a cell when it
//   holds a comma, quote, or line break). Columns come from the rows.
// - Restore into a live business is NOT done here: it is a live test on a
//   test business, still owed. This endpoint only exports.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

// Tables that carry their own business_id column.
const DIRECT_TABLES = [
  "products", "services", "customers", "suppliers",
  "sales", "payment_records",
  "expenses", "expense_categories",
  "supplier_purchases",
  "payment_modes", "phone_contacts", "reminder_logs",
  "daily_summaries", "staff_shifts",
  // Phase-1 audit gaps: hotel and notes records, staff membership rows,
  // and the 0061 tables (receipt sends, stock adjustments).
  "hotel_rooms", "hotel_bookings", "hotel_charges", "hotel_payments",
  "notes", "business_members",
  "receipt_sends", "stock_adjustments",
  // Owner-visible history of who changed what.
  "audit_logs",
];

// Tables joined through the record that owns them (no business_id column).
const JOINED_TABLES = {
  sale_items: `SELECT si.* FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ?`,
  inventory_items: `SELECT i.* FROM inventory_items i
    INNER JOIN products p ON p.id = i.product_id WHERE p.business_id = ?`,
  inventory_movements: `SELECT m.* FROM inventory_movements m
    INNER JOIN products p ON p.id = m.product_id WHERE p.business_id = ?`,
  customer_ledger: `SELECT l.* FROM customer_ledger l
    INNER JOIN customers c ON c.id = l.customer_id WHERE c.business_id = ?`,
};

const TABLES = [...DIRECT_TABLES, ...Object.keys(JOINED_TABLES)];

function r2(context) {
  return context.env.KOPABOOK_R2 || null;
}

function ownedBy(key, businessId) {
  return typeof key === "string" && key.startsWith(`backups/${businessId}/`) && !key.includes("..");
}

async function rowsForTable(db, table, businessId) {
  if (JOINED_TABLES[table]) {
    try {
      const r = await db.prepare(JOINED_TABLES[table]).bind(businessId).all();
      return r.results || [];
    } catch {
      return [];
    }
  }
  try {
    const rows = await db.prepare(`SELECT * FROM ${table} WHERE business_id = ?`).bind(businessId).all();
    return rows.results || [];
  } catch {
    return [];
  }
}

async function memberUsers(db, businessId) {
  try {
    const members = await db.prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
       FROM users u JOIN business_members m ON m.user_id = u.id
       WHERE m.business_id = ?`
    ).bind(businessId).all();
    return members.results || [];
  } catch {
    return [];
  }
}

// Every record type for the business, as { tableName: rows }.
async function exportTables(db, businessId) {
  const tables = {};
  const biz = await db.prepare(`SELECT * FROM businesses WHERE id = ?`).bind(businessId).first();
  tables.businesses = biz ? [biz] : [];
  for (const t of TABLES) tables[t] = await rowsForTable(db, t, businessId);
  // Team members: public columns only, never password hashes.
  tables.users = await memberUsers(db, businessId);
  return tables;
}

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// One CSV per record type, same escaping as Reports buildCsv.
// Columns come from the rows. An empty record type still downloads, with
// its name and a "No records" line, so the link never fails.
function toCsv(table, rows) {
  if (!rows.length) return `${table}\nNo records`;
  const cols = Object.keys(rows[0]);
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n");
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet. Create the R2 bucket and bind it as KOPABOOK_R2." }, 503);

    const db = context.env.KOPABOOK_DB;
    const tables = await exportTables(db, auth.business.id);
    const counts = {};
    for (const [k, v] of Object.entries(tables)) counts[k] = v.length;
    const data = { exported_at: new Date().toISOString(), business_id: auth.business.id, tables, counts };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const key = `backups/${auth.business.id}/${stamp}.json`;
    const body = JSON.stringify(data);
    await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });

    await audit(context, auth, "backup.create", "backups", null, { key, bytes: body.length });
    return json({ ok: true, key, bytes: body.length, tables: Object.keys(tables).length, counts }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create backup.", error: String(error) }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const db = context.env.KOPABOOK_DB;

    // CSV export of one record type. Needs no R2 bucket: it reads the
    // live database for this business only.
    const csvTable = url.searchParams.get("csv") || "";
    if (csvTable) {
      if (!TABLES.includes(csvTable) && csvTable !== "businesses" && csvTable !== "users") {
        return json({ ok: false, message: "Unknown record type for export." }, 400);
      }
      let rows = [];
      if (csvTable === "businesses") {
        const biz = await db.prepare(`SELECT * FROM businesses WHERE id = ?`).bind(auth.business.id).first();
        rows = biz ? [biz] : [];
      } else if (csvTable === "users") {
        rows = await memberUsers(db, auth.business.id);
      } else {
        rows = await rowsForTable(db, csvTable, auth.business.id);
      }
      const headers = new Headers();
      headers.set("Content-Type", "text/csv; charset=utf-8");
      headers.set("Content-Disposition", `attachment; filename="kopabook-${csvTable}.csv"`);
      return new Response(toCsv(csvTable, rows), { headers });
    }

    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet." }, 503);

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
