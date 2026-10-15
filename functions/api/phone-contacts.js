// /api/phone-contacts — GET list, POST bulk import, DELETE one/all.
// The merchant's own phone contacts, used to match customers against the
// real contact list. Stored per business.
import { json, getAuthContext, requireAuth, audit } from "./_utils";

function cleanPhone(p) {
  return String(p || "").replace(/\D/g, "").slice(0, 15);
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, name, phone FROM phone_contacts WHERE business_id = ? ORDER BY name ASC LIMIT 5000`
    ).bind(auth.business.id).all();
    const count = await context.env.KOPABOOK_DB.prepare(
      `SELECT COUNT(*) AS n FROM phone_contacts WHERE business_id = ?`
    ).bind(auth.business.id).first();
    return json({ ok: true, contacts: rows.results || [], count: Number(count.n) || 0 });
  } catch (error) {
    return json({ ok: false, message: "Could not load phone contacts.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const list = Array.isArray(body.contacts) ? body.contacts : [];
    if (!list.length) return json({ ok: false, message: "No contacts to import." }, 400);
    if (list.length > 5000) return json({ ok: false, message: "Too many contacts at once (max 5000)." }, 400);

    const seen = new Set();
    const clean = [];
    for (const c of list) {
      const phone = cleanPhone(c.phone);
      const name = String(c.name || "").trim().slice(0, 80);
      if (!phone || !name || seen.has(phone)) continue;
      seen.add(phone);
      clean.push({ name, phone });
    }
    if (!clean.length) return json({ ok: false, message: "No valid contacts found." }, 400);

    const db = context.env.KOPABOOK_DB;
    // Chunked batch inserts (D1 batch limits).
    for (let i = 0; i < clean.length; i += 100) {
      const chunk = clean.slice(i, i + 100);
      await db.batch(
        chunk.map((c) =>
          db.prepare(
            `INSERT OR IGNORE INTO phone_contacts (business_id, name, phone) VALUES (?, ?, ?)`
          ).bind(auth.business.id, c.name, c.phone)
        )
      );
    }
    // De-dupe against existing rows is handled by exact (business_id, name, phone)
    // duplicates slipping through; keep it simple.

    await audit(context, auth, "phone_contacts.import", "phone_contacts", null, { count: clean.length });
    return json({ ok: true, imported: clean.length }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not import contacts.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");
    const db = context.env.KOPABOOK_DB;
    if (id === "all") {
      await db.prepare(`DELETE FROM phone_contacts WHERE business_id = ?`).bind(auth.business.id).run();
    } else {
      const n = Number(id);
      if (!n) return json({ ok: false, message: "Contact id is required." }, 400);
      await db.prepare(`DELETE FROM phone_contacts WHERE id = ? AND business_id = ?`).bind(n, auth.business.id).run();
    }
    await audit(context, auth, "phone_contacts.delete", "phone_contacts", null, { id });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete contacts.", error: String(error) }, 500);
  }
}
