// /api/product-photo — product photos stored in the KOPABOOK_R2 bucket.
// POST: multipart form (productId, photo file) -> uploads, saves photo_key.
// GET: ?key=... -> serves the image (business-scoped).
// DELETE: ?productId=... -> removes photo from R2 and clears photo_key.
// Fix 1.8: uploads are verified by magic bytes (never the client MIME), so
// SVG/HTML can never be stored; serves are sandboxed with nosniff. Writes
// need can_manage_products, as product creation does.
import { json, getAuthContext, requireAuth, requirePerm, audit, sniffUploadType, UPLOAD_IMAGE_TYPES, applyUploadServeHeaders } from "./_utils";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

function r2(context) {
  return context.env.KOPABOOK_R2 || null;
}

function keyFor(businessId, productId, ext) {
  // The suffix comes from the sniffed bytes, never the uploaded filename.
  const suffix = ext || ".jpg";
  return `products/${businessId}/${productId}-${Date.now()}${suffix}`;
}

function ownedBy(key, businessId) {
  return typeof key === "string" && key.startsWith(`products/${businessId}/`) && !key.includes("..");
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    // Only staff with product permission may overwrite a product photo
    // (an attendant could otherwise replace or delete any product's photo).
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can upload product photos.");
    if (permDenied) return permDenied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet. Create the R2 bucket and bind it as KOPABOOK_R2." }, 503);

    const form = await context.request.formData();
    const productId = Number(form.get("productId"));
    const file = form.get("photo");
    if (!productId) return json({ ok: false, message: "Product is required." }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, message: "No photo attached." }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, message: "Photo must be under 3 MB." }, 400);
    // Fix 1.8: the client MIME is attacker-controlled (image/svg+xml used
    // to pass here). Reject anything outside the image allowlist, then
    // verify the real type from magic bytes: an HTML file renamed to .png,
    // or an SVG, is refused even when its declared type claims image/png.
    const declared = String(file.type || "").toLowerCase().split(";")[0].trim();
    if (declared && !UPLOAD_IMAGE_TYPES.has(declared)) {
      return json({ ok: false, message: "Only JPG, PNG, GIF or WebP photos are allowed. SVG files are not accepted." }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffUploadType(bytes);
    if (!sniffed || !UPLOAD_IMAGE_TYPES.has(sniffed.mime)) {
      return json({ ok: false, message: "Only JPG, PNG, GIF or WebP photos are allowed. SVG files are not accepted." }, 400);
    }

    const product = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, photo_key FROM products WHERE id = ? AND business_id = ?`
    ).bind(productId, auth.business.id).first();
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const key = keyFor(auth.business.id, productId, sniffed.ext);
    // The stored content type comes from the sniffed bytes, never the
    // client-supplied MIME, so a served photo cannot be an SVG/HTML in
    // disguise.
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: sniffed.mime },
    });
    if (product.photo_key && ownedBy(product.photo_key, auth.business.id)) {
      await bucket.delete(product.photo_key).catch(() => {});
    }
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE products SET photo_key = ? WHERE id = ? AND business_id = ?`
    ).bind(key, productId, auth.business.id).run();

    await audit(context, auth, "product.photo_upload", "products", productId, { key });
    return json({ ok: true, key, url: `/api/product-photo?key=${encodeURIComponent(key)}` });
  } catch (error) {
    return json({ ok: false, message: "Could not upload photo.", error: String(error) }, 500);
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
    if (!ownedBy(key, auth.business.id)) return json({ ok: false, message: "Photo not found." }, 404);
    const obj = await bucket.get(key);
    if (!obj) return json({ ok: false, message: "Photo not found." }, 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    // Fix 1.8: sandboxed + nosniff; only sniffed raster types are shown
    // inline, anything else (e.g. a legacy object) downloads.
    applyUploadServeHeaders(headers);
    return new Response(obj.body, { headers });
  } catch (error) {
    return json({ ok: false, message: "Could not load photo.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can remove product photos.");
    if (permDenied) return permDenied;
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet." }, 503);

    const productId = Number(new URL(context.request.url).searchParams.get("productId"));
    if (!productId) return json({ ok: false, message: "Product is required." }, 400);
    const product = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, photo_key FROM products WHERE id = ? AND business_id = ?`
    ).bind(productId, auth.business.id).first();
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    if (product.photo_key && ownedBy(product.photo_key, auth.business.id)) {
      await bucket.delete(product.photo_key).catch(() => {});
    }
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE products SET photo_key = NULL WHERE id = ? AND business_id = ?`
    ).bind(productId, auth.business.id).run();

    await audit(context, auth, "product.photo_delete", "products", productId, {});
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete photo.", error: String(error) }, 500);
  }
}
