// /api/customer-profile?id= — GET full customer profile with stats, PATCH edit.
// Flat route (query param) instead of /api/customers/[id] for reliable
// Cloudflare Pages Functions routing.
import { json, getAuthContext, requireAuth, audit } from "./_utils";
import { recordHistory } from "./_history.js";

async function getCustomer(context, id, businessId) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
  )
    .bind(id, businessId)
    .first();
}

function getId(context) {
  const url = new URL(context.request.url);
  return Number(url.searchParams.get("id"));
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = getId(context);
    if (!id) return json({ ok: false, message: "Customer id is required." }, 400);
    const customer = await getCustomer(context, id, auth.business.id);
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const db = context.env.KOPABOOK_DB;
    const stats = await db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'sale' THEN amount_delta END), 0) AS lifetime_sales,
         COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN -amount_delta END), 0) AS total_paid,
         COUNT(CASE WHEN entry_type = 'sale' THEN 1 END) AS purchase_count,
         MIN(created_at) AS first_seen,
         MAX(created_at) AS last_activity,
         MAX(CASE WHEN entry_type = 'payment' THEN created_at END) AS last_payment_at
       FROM customer_ledger WHERE customer_id = ?`
    ).bind(id).first();

    const outstanding = await db.prepare(
      `SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(id).first();

    const reminders = await db.prepare(
      `SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM reminder_logs
       WHERE customer_id = ? AND kind IN ('debt', 'broadcast')`
    ).bind(id).first();

    const recent = await db.prepare(
      `SELECT id, entry_type, amount_delta, balance_after, note, created_at
       FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(id).all();

    return json({
      ok: true,
      customer,
      stats: {
        lifetime_sales: Number(stats.lifetime_sales) || 0,
        total_paid: Number(stats.total_paid) || 0,
        outstanding: Number(outstanding?.balance_after) || 0,
        purchase_count: Number(stats.purchase_count) || 0,
        first_seen: stats.first_seen,
        last_activity: stats.last_activity,
        last_payment_at: stats.last_payment_at,
        reminders_count: Number(reminders.n) || 0,
        last_reminded_at: reminders.last_at,
      },
      recent: recent.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load customer.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = getId(context);
    if (!id) return json({ ok: false, message: "Customer id is required." }, 400);
    const customer = await getCustomer(context, id, auth.business.id);
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];
    // Email is optional; a grossly invalid value is refused, never stored.
    if (body.email !== undefined) {
      const v = String(body.email).trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return json({ ok: false, message: "Enter a valid email address, or leave it blank." }, 400);
      }
      fields.push(`email = ?`);
      params.push(v || null);
    }
    // Credit limit: blank = no limit set, 0 = no credit. Owner/partner
    // only (the CustomerDetail page hides the field for other roles; the
    // server enforces it here too).
    if (body.credit_limit !== undefined) {
      if (auth.business.role !== "owner" && auth.business.role !== "partner") {
        return json({ ok: false, message: "Only the owner or a partner can set a credit limit." }, 403);
      }
      const raw = String(body.credit_limit).trim();
      if (raw !== "" && (Number.isNaN(Number(raw)) || Number(raw) < 0)) {
        return json({ ok: false, message: "Credit limit must be a number, 0 or more." }, 400);
      }
      fields.push(`credit_limit = ?`);
      params.push(raw === "" ? null : Number(raw));
    }
    for (const [key, col] of [["name", "name"], ["phone", "phone"], ["notes", "notes"], ["tags", "tags"], ["telegram", "telegram"]]) {
      if (body[key] !== undefined) {
        const v = String(body[key]).trim();
        fields.push(`${col} = ?`);
        params.push(key === "name" ? (v || customer.name) : (v || null));
      }
    }
    if (fields.length === 0) return json({ ok: false, message: "Nothing to update." }, 400);

    params.push(id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE customers SET ${fields.join(", ")} WHERE id = ?`
    ).bind(...params).run();

    await audit(context, auth, "customer.update", "customer", id, body);
    // WORLD-BEST (merge, History stream §6g).
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "customer",
      entityType: "customer",
      entityId: id,
      summary: `Updated customer ${customer.name}`,
      amount: null,
    });
    const updated = await getCustomer(context, id, auth.business.id);
    return json({ ok: true, customer: updated });
  } catch (error) {
    return json({ ok: false, message: "Could not update customer.", error: String(error) }, 500);
  }
}

// DELETE /api/customer-profile?id= — delete a customer (owner/partner only).
// Blocked when the customer has sales or ledger history, so records are
// never orphaned. Remove or void those first.
export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner" && auth.business.role !== "partner") {
      return json({ ok: false, message: "Only the owner or a partner can delete customers." }, 403);
    }

    const id = getId(context);
    if (!id) return json({ ok: false, message: "Customer id is required." }, 400);
    const customer = await getCustomer(context, id, auth.business.id);
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const db = context.env.KOPABOOK_DB;
    const salesCount = await db.prepare(
      `SELECT COUNT(*) AS c FROM sales WHERE customer_id = ? AND business_id = ?`
    ).bind(id, auth.business.id).first();
    const ledgerCount = await db.prepare(
      `SELECT COUNT(*) AS c FROM customer_ledger WHERE customer_id = ?`
    ).bind(id).first();
    if (Number(salesCount?.c || 0) > 0 || Number(ledgerCount?.c || 0) > 0) {
      return json({
        ok: false,
        message: "This customer has sales or debt history and cannot be deleted. Their record stays for your books.",
      }, 409);
    }

    await db.prepare(`DELETE FROM customers WHERE id = ?`).bind(id).run();

    await audit(context, auth, "customer.delete", "customer", id, { name: customer.name });
    // WORLD-BEST (merge, History stream §6g).
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "customer",
      entityType: "customer",
      entityId: id,
      summary: `Removed customer ${customer.name}`,
      amount: null,
    });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete customer.", error: String(error) }, 500);
  }
}
