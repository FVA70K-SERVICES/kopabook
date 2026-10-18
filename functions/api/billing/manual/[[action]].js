// /api/billing/manual/* — manual bank-transfer payments.
// POST /api/billing/manual/initiate {tier, billing_cycle} -> reference number + bank details
// POST /api/billing/manual/submit (multipart: reference_number, proof) -> upload proof to R2
//
// Routing note: Cloudflare Pages file routing cannot serve /manual/initiate from a
// file named manual.js, so this optional catch-all ([[action]].js) exposes both
// sub-routes from one file. The public endpoint URLs are exactly as specified.
//
// Table: manual_payments (migrations/0043_recurring_billing.sql, owned by the
// billing-overhaul worker). Schema: id TEXT PRIMARY KEY, user_id TEXT,
// tier/billing_cycle with CHECKs, amount_kobo, reference_number UNIQUE,
// proof_url, status CHECK(pending/approved/rejected), created_at, reviewed_at,
// reviewed_by TEXT. The row id IS the reference number (unique by construction).
import { json, getAuthContext, requireAuth, toSqliteDate } from "../../_utils";
import { checkRateLimit } from "../../_webhook_security";

const VALID_TIERS = ["starter", "pro", "solo"];
const VALID_CYCLES = ["monthly", "yearly"];

const BANK = {
  account_number: "6112431993",
  bank_name: "Opay",
  account_name: "FVA70K SERVICES",
};

// No ambiguous characters (0/O, 1/I) so references read cleanly over the phone.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeReference() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return "KB-" + s;
}

async function uniqueReference(db) {
  for (let i = 0; i < 10; i++) {
    const ref = makeReference();
    const existing = await db
      .prepare(`SELECT id FROM manual_payments WHERE reference_number = ?`)
      .bind(ref)
      .first();
    if (!existing) return ref;
  }
  throw new Error("Could not generate a unique reference number.");
}

function amountLabel(amount_kobo) {
  return "NGN " + (Number(amount_kobo) / 100).toLocaleString("en-NG");
}

async function handleInitiate(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth);
  if (denied) return denied;

  const db = context.env.KOPABOOK_DB;

  // Rate limit: max 10 manual-payment initiations per user per hour.
  if (!(await checkRateLimit(db, `manual_${auth.user.id}`, 10, 3600000))) {
    return json(
      { ok: false, message: "Too many payment attempts. Please try again later." },
      429
    );
  }

  const body = await context.request.json().catch(() => ({}));
  const tier = String(body.tier || "").toLowerCase();
  const cycle = String(body.billing_cycle || "").toLowerCase();
  if (!VALID_TIERS.includes(tier) || !VALID_CYCLES.includes(cycle)) {
    return json(
      { ok: false, message: "Pick a valid plan: starter, pro or solo, monthly or yearly." },
      400
    );
  }

  // Single price source: the DB price book (subscription_plans).
  const plan = await db
    .prepare(
      `SELECT amount_kobo FROM subscription_plans
       WHERE tier = ? AND billing_cycle = ? AND (active IS NULL OR active = 1)`
    )
    .bind(tier, cycle)
    .first();
  if (!plan || !Number.isFinite(Number(plan.amount_kobo)) || Number(plan.amount_kobo) <= 0) {
    return json({ ok: false, message: "This plan is not available right now." }, 400);
  }
  const amount_kobo = Number(plan.amount_kobo);

  const reference_number = await uniqueReference(db);
  await db
    .prepare(
      `INSERT INTO manual_payments
         (id, user_id, tier, billing_cycle, amount_kobo, reference_number, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(reference_number, String(auth.user.id), tier, cycle, amount_kobo, reference_number, toSqliteDate())
    .run();

  return json({
    ok: true,
    reference_number,
    amount_kobo,
    amount_label: amountLabel(amount_kobo),
    bank: BANK,
    instruction: "Put the reference number in your transfer narration",
  });
}

const PROOF_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

async function handleSubmit(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth);
  if (denied) return denied;

  const db = context.env.KOPABOOK_DB;
  const bucket = context.env.MANUAL_PROOFS;
  if (!bucket) {
    return json(
      { ok: false, message: "Proof uploads are not configured yet. Please try again later." },
      503
    );
  }

  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ ok: false, message: "Send the proof as a multipart form." }, 400);
  }
  const reference_number = String(form.get("reference_number") || "").trim().toUpperCase();
  const proof = form.get("proof");

  if (!reference_number) {
    return json({ ok: false, message: "Reference number is required." }, 400);
  }

  // The reference must exist, belong to the caller, and still be pending.
  // Not-found and not-yours share one message so references cannot be enumerated.
  const row = await db
    .prepare(`SELECT id, user_id, status FROM manual_payments WHERE reference_number = ?`)
    .bind(reference_number)
    .first();
  if (!row || String(row.user_id) !== String(auth.user.id)) {
    return json({ ok: false, message: "Payment reference not found." }, 404);
  }
  if (row.status !== "pending") {
    return json({ ok: false, message: "This payment has already been submitted for review." }, 400);
  }

  if (!proof || typeof proof === "string" || proof.size === 0) {
    return json({ ok: false, message: "Attach a photo of your transfer receipt." }, 400);
  }
  const ext = PROOF_TYPES[proof.type];
  if (!ext) {
    return json({ ok: false, message: "Proof must be a JPG, PNG or WebP image." }, 400);
  }
  if (proof.size > MAX_PROOF_BYTES) {
    return json({ ok: false, message: "Proof image must be 5MB or smaller." }, 400);
  }

  const key = `proofs/${reference_number}.${ext}`;
  await bucket.put(key, await proof.arrayBuffer(), {
    httpMetadata: { contentType: proof.type },
  });

  // Status stays 'pending' so the payment remains in the admin review queue;
  // a non-null proof_url tells the admin a receipt is attached.
  await db
    .prepare(`UPDATE manual_payments SET proof_url = ? WHERE id = ?`)
    .bind(key, row.id)
    .run();

  return json({
    ok: true,
    message: "Proof received. We will verify your payment and turn on your plan.",
    reference_number,
  });
}

export async function onRequestPost(context) {
  try {
    const action = context.params && context.params.action;
    if (action === "initiate") return await handleInitiate(context);
    if (action === "submit") return await handleSubmit(context);
    return json({ ok: false, message: "Not found." }, 404);
  } catch (error) {
    return json(
      { ok: false, message: "Could not process the request.", error: String(error) },
      500
    );
  }
}
