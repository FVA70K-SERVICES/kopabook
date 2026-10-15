// /api/product-photo — product photos stored in the KOPABOOK_R2 bucket.
// POST: multipart form (productId, photo file) -> uploads, saves photo_key.
// GET: ?key=... -> serves the image (business-scoped).
// DELETE: ?productId=... -> removes photo from R2 and clears photo_key.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

function r2(context) {
  return context.env.KOPABOOK_R2 || null;
}

function keyFor(businessId, productId, filename) {
  const ext = String(filename || "").toLowerCase().match(/\.(jpe?g|png|webp|gif)$/);
  const suffix = ext ? ext[0] : ".jpg";
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
    const bucket = r2(context);
    if (!bucket) return json({ ok: false, message: "File storage is not connected yet. Create the R2 bucket and bind it as KOPABOOK_R2." }, 503);

    const form = await context.request.formData();
    const productId = Number(form.get("productId"));
    const file = form.get("photo");
    if (!productId) return json({ ok: false, message: "Product is required." }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, message: "No photo attached." }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, message: "Photo must be under 3 MB." }, 400);
    if (!String(file.type || "").startsWith("image/")) return json({ ok: false, message: "Only image files are allowed." }, 400);

    const product = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, photo_key FROM products WHERE id = ? AND business_id = ?`
    ).bind(productId, auth.business.id).first();
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const key = keyFor(auth.business.id, productId, file.name);
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
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
    headers.set("Cache-Control", "public, max-age=86400");
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
