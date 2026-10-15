// /api/files — generic R2 file storage for business records.
// Folders: customers (customer photos), expenses (receipt photos), cards (saved share cards).
// POST: multipart form (folder, refId, file). For customers/expenses the matching
//   table's key column is updated automatically; for cards the key is returned.
// GET: ?key=... -> serves the file (business-scoped).
// DELETE: ?folder=...&refId=... -> removes the file and clears the key column.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

// folder -> [table, key column]
const FOLDERS = {
  customers: ["customers", "photo_key"],
  expenses: ["expenses", "receipt_key"],
  cards: [null, null],
};

function r2(context) {
  return context.env.KOPABOOK_R2 || null;
}

function ownedBy(key, businessId) {
  if (typeof key !== "string" || key.includes("..")) return false;
  const parts = key.split("/");
  return parts.length >= 3 && !!FOLDERS[parts[0]] && parts[1] === String(businessId);
}

function keyFor(folder, businessId, refId, filename) {
  const ext = String(filename || "").toLowerCase().match(/\.(jpe?g|png|webp|gif|pdf)$/);
  const suffix = ext ? ext[0] : ".jpg";
  const ref = refId ? `${refId}-` : "";
  return `${folder}/${businessId}/${ref}${Date.now()}${suffix}`;
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet. Create the R2 bucket and bind it as KOPABOOK_R2." }, 503);

    const form = await context.request.formData();
    const folder = String(form.get("folder") || "");
    const refId = Number(form.get("refId")) || null;
    const file = form.get("file");
    const mapping = FOLDERS[folder];
    if (!mapping) return json({ ok: false, message: "Unknown folder." }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, message: "No file attached." }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, message: "File must be under 3 MB." }, 400);
    const type = String(file.type || "");
    if (!type.startsWith("image/") && type !== "application/pdf") return json({ ok: false, message: "Only images or PDFs are allowed." }, 400);

    const [table, column] = mapping;
    let oldKey = null;
    if (table) {
      if (!refId) return json({ ok: false, message: "Record id is required." }, 400);
      const row = await context.env.KOPABOOK_DB.prepare(
        `SELECT id, ${column} AS k FROM ${table} WHERE id = ? AND business_id = ?`
      ).bind(refId, auth.business.id).first();
      if (!row) return json({ ok: false, message: "Record not found." }, 404);
      oldKey = row.k;
    }

    const key = keyFor(folder, auth.business.id, refId, file.name);
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: type || "image/jpeg" },
    });
    if (oldKey && ownedBy(oldKey, auth.business.id)) {
      await bucket.delete(oldKey).catch(() => {});
    }
    if (table) {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE ${table} SET ${column} = ? WHERE id = ? AND business_id = ?`
      ).bind(key, refId, auth.business.id).run();
    }

    await audit(context, auth, "files.upload", table || "files", refId, { key, folder });
    return json({ ok: true, key, url: `/api/files?key=${encodeURIComponent(key)}` });
  } catch (error) {
    return json({ ok: false, message: "Could not upload file.", error: String(error) }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet." }, 503);

    const key = new URL(context.request.url).searchParams.get("key") || "";
    if (!ownedBy(key, auth.business.id)) return json({ ok: false, message: "File not found." }, 404);
    const obj = await bucket.get(key);
    if (!obj) return json({ ok: false, message: "File not found." }, 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(obj.body, { headers });
  } catch (error) {
    return json({ ok: false, message: "Could not load file.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet." }, 503);

    const url = new URL(context.request.url);
    const folder = url.searchParams.get("folder") || "";
    const refId = Number(url.searchParams.get("refId")) || null;
    const mapping = FOLDERS[folder];
    if (!mapping || !mapping[0]) return json({ ok: false, message: "Unknown folder." }, 400);
    if (!refId) return json({ ok: false, message: "Record id is required." }, 400);
    const [table, column] = mapping;

    const row = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, ${column} AS k FROM ${table} WHERE id = ? AND business_id = ?`
    ).bind(refId, auth.business.id).first();
    if (!row) return json({ ok: false, message: "Record not found." }, 404);

    if (row.k && ownedBy(row.k, auth.business.id)) {
      await bucket.delete(row.k).catch(() => {});
    }
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE ${table} SET ${column} = NULL WHERE id = ? AND business_id = ?`
    ).bind(refId, auth.business.id).run();

    await audit(context, auth, "files.delete", table, refId, { folder });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete file.", error: String(error) }, 500);
  }
}
