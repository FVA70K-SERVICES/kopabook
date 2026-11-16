// /api/files — generic R2 file storage for business records.
// Folders: customers (customer photos), expenses (receipt photos), cards (saved share cards).
// POST: multipart form (folder, refId, file). For customers/expenses the matching
//   table's key column is updated automatically; for cards the key is returned.
// GET: ?key=... -> serves the file (business-scoped).
// DELETE: ?folder=...&refId=... -> removes the file and clears the key column.
// Fix 1.8: uploads are verified by magic bytes (never the client MIME), so
// SVG/HTML can never be stored; the stored content type comes from the
// sniffed bytes; serves are sandboxed with nosniff. Expense receipt
// writes need can_manage_expenses; customers/cards keep requireAuth only
// (no matching staff flag exists and customer creation itself is ungated).
import { json, getAuthContext, requireAuth, requirePerm, audit, sniffUploadType, UPLOAD_FILE_TYPES, applyUploadServeHeaders } from "./_utils";

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

function keyFor(folder, businessId, refId, ext) {
  // The suffix comes from the sniffed bytes, never the uploaded filename,
  // so a renamed file cannot keep a misleading extension.
  const suffix = ext || ".jpg";
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
    // Receipt proofs are the sensitive folder: only staff with expense
    // permission may overwrite them (an attendant could otherwise replace
    // or delete another member's proof). Customers/cards have no matching
    // staff flag, so they stay on requireAuth as before.
    if (folder === "expenses") {
      const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can upload receipt photos.");
      if (permDenied) return permDenied;
    }
    // Fix 1.8: the client MIME is attacker-controlled (image/svg+xml used
    // to pass here). Reject anything outside the allowlist, then verify
    // the real type from magic bytes: an HTML file renamed to .png, or an
    // SVG, is refused even when its declared type claims image/png.
    const declared = String(file.type || "").toLowerCase().split(";")[0].trim();
    if (declared && !UPLOAD_FILE_TYPES.has(declared)) {
      return json({ ok: false, message: "Only JPG, PNG, GIF, WebP images or PDFs are allowed. SVG files are not accepted." }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffUploadType(bytes);
    if (!sniffed || !UPLOAD_FILE_TYPES.has(sniffed.mime)) {
      return json({ ok: false, message: "Only JPG, PNG, GIF, WebP images or PDFs are allowed. SVG files are not accepted." }, 400);
    }

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

    const key = keyFor(folder, auth.business.id, refId, sniffed.ext);
    // The stored content type comes from the sniffed bytes, never the
    // client-supplied MIME, so a served file cannot be an SVG/HTML in
    // disguise.
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: sniffed.mime },
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
    // Fix 1.8: sandboxed + nosniff; only sniffed raster/PDF types are
    // shown inline, anything else (e.g. a legacy object) downloads.
    applyUploadServeHeaders(headers);
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
    // Receipt proofs need expense permission to delete, as they do to upload.
    if (folder === "expenses") {
      const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can remove receipt photos.");
      if (permDenied) return permDenied;
    }
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
