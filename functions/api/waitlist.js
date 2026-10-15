// POST /api/waitlist — save a waitlist lead
import { json } from "./_utils";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { name, phone, email, businessType, state, city, monthlyTransactions, currentTool, consent } = body;

    if (!name) {
      return json({ ok: false, message: "Name is required." }, 400);
    }

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO waitlist_signups
         (name, phone, email, business_type, state, city, monthly_transactions, current_tool, consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(name).trim(),
        phone ? String(phone).trim() : null,
        email ? String(email).trim().toLowerCase() : null,
        businessType || null,
        state || null,
        city || null,
        monthlyTransactions || null,
        currentTool || null,
        consent ? 1 : 0
      )
      .run();

    return json({ ok: true, message: "You are on the waitlist." }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not save. Please try again.", error: String(error) }, 500);
  }
}
