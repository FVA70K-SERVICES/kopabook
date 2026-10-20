// Proposal machinery for Admin AI.
// The chat never writes. It creates a proposal here; the write itself
// only runs in executeProposal, which is only called by
// POST /api/admin/ai/confirm when the owner taps Confirm on the card.
// A typed or spoken "yes" in chat never executes anything.
import { toSqliteDate, audit } from "../../_utils.js";
import { LIMITS } from "../../billing.js";
import { PROMO_SLUG, getActivePromoClaim } from "../../_promo.js";
import * as paystackVerify from "../../paystack/verify.js";

export const PROPOSAL_ACTIONS = ["set_tier", "grant", "suspend", "unsuspend", "revoke_promo"];

export const PROPOSE_TOOL_DEFS = [
  { name: "propose_set_tier", description: "Prepare a proposal to set an account tier manually (no payment, no end date). The owner must confirm on the card before anything changes.", args: { account: "account email or name", tier: "free | starter | solo | pro", cycle: "optional, default manual" } },
  { name: "propose_grant", description: "Prepare a proposal to grant a paid tier for one billing cycle starting today (monthly or yearly). The owner must confirm on the card before anything changes.", args: { account: "account email or name", tier: "starter | solo | pro", cycle: "monthly | yearly" } },
  { name: "propose_suspend", description: "Prepare a proposal to suspend an account so they cannot sign in. The owner must confirm on the card before anything changes.", args: { account: "account email or name" } },
  { name: "propose_unsuspend", description: "Prepare a proposal to reactivate a suspended account. The owner must confirm on the card before anything changes.", args: { account: "account email or name" } },
  { name: "propose_revoke_promo", description: "Prepare a proposal to revoke an account's active Pro free month promo claim. Their plan returns to the tier they had before the claim. The owner must confirm on the card before anything changes.", args: { account: "account email or name" } },
];

export async function ensureAdminAiTables(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS admin_ai_proposals (
      id TEXT PRIMARY KEY,
      admin_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      target_label TEXT,
      params TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      result TEXT
    )`
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_admin_ai_proposals_admin_status ON admin_ai_proposals (admin_user_id, status)`
  ).run();
}

// Mirrors activateSubscriptionSafe in functions/api/admin/manual/[[action]].js
// exactly: use paystack/verify.js activateSubscription when present, else
// the same local upsert fallback.
async function activateSubscriptionSafe(db, userId, tier, billingCycle, periodStart, periodEnd) {
  const fn = paystackVerify && paystackVerify.activateSubscription;
  if (typeof fn === "function") {
    return await fn(db, userId, tier, billingCycle, null, null, {
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });
  }
  await db
    .prepare(
      `INSERT INTO account_subscriptions
         (user_id, tier, status, billing_cycle, current_period_start, current_period_end, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = 'active',
         billing_cycle = excluded.billing_cycle,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`
    )
    .bind(userId, tier, billingCycle, periodStart, periodEnd, toSqliteDate())
    .run();
}

function periodEndForCycle(cycle, startDate) {
  const end = new Date(startDate.getTime());
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

function tierName(tier) {
  const t = String(tier || "free").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function dateOnly(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

async function safeAudit(context, auth, actionType, entityId, metadata) {
  try {
    await audit(context, auth, actionType, "admin_ai_proposal", entityId, metadata);
  } catch (e) {
    // audit must never break the flow
  }
}

// Resolve an email or name to exactly one account. Exact email wins.
// A partial match only resolves when it is unique; otherwise the caller
// gets the candidate list so the owner can be specific.
export async function resolveAccount(db, emailOrQuery) {
  const q = String(emailOrQuery || "").trim();
  if (!q) return { error: "An account email or name is required.", candidates: [] };
  const exact = await db.prepare(
    `SELECT id, email, full_name, status FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
  ).bind(q).first();
  if (exact) return { user: exact };
  const like = `%${q}%`;
  const rows = await db.prepare(
    `SELECT id, email, full_name, status FROM users WHERE email LIKE ? OR full_name LIKE ? ORDER BY id DESC LIMIT 5`
  ).bind(like, like).all();
  const list = rows.results || [];
  if (list.length === 1) return { user: list[0] };
  if (!list.length) return { error: `No account found matching "${q}".`, candidates: [] };
  return {
    error: `"${q}" matches ${list.length} accounts. Please use the exact email.`,
    candidates: list.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name })),
  };
}

async function currentSubscription(db, userId) {
  const row = await db.prepare(
    `SELECT tier, status, billing_cycle, current_period_start, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
  if (!row) return { tier: "free", status: "active", billing_cycle: null, current_period_end: null };
  return row;
}

function targetLabel(user) {
  return user.full_name ? `${user.email} (${user.full_name})` : String(user.email);
}

function proposalFromRow(row) {
  if (!row) return null;
  let params = {};
  try { params = JSON.parse(row.params || "{}"); } catch (e) { params = {}; }
  return {
    id: row.id,
    admin_user_id: row.admin_user_id,
    action: row.action,
    target_user_id: row.target_user_id,
    target_label: row.target_label,
    params,
    summary: row.summary,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    resolved_at: row.resolved_at || null,
    result: row.result || null,
  };
}

export async function getProposal(db, proposalId) {
  await ensureAdminAiTables(db);
  const row = await db.prepare(
    `SELECT * FROM admin_ai_proposals WHERE id = ? LIMIT 1`
  ).bind(String(proposalId || "")).first();
  return proposalFromRow(row);
}

// The newest still-pending proposal for this admin, if any. The chat
// engine uses this for one job only: telling the owner that a typed
// "yes" does nothing and the action is waiting on the Confirm button.
export async function getPendingProposal(db, adminUserId) {
  await ensureAdminAiTables(db);
  const now = toSqliteDate();
  const row = await db.prepare(
    `SELECT * FROM admin_ai_proposals WHERE admin_user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
  ).bind(adminUserId, now).first();
  return proposalFromRow(row);
}

// Validate, resolve the target, build the exact human summary, supersede
// any pending proposal for the same admin, action and target, and store
// the new proposal with a 15 minute expiry. Returns the proposal object,
// or { error, candidates } when it cannot be prepared.
export async function createProposal(context, auth, action, params) {
  const db = context.env.KOPABOOK_DB;
  await ensureAdminAiTables(db);
  const act = String(action || "").toLowerCase();
  const p = params || {};
  if (!PROPOSAL_ACTIONS.includes(act)) return { error: `Unknown action: ${act || "(empty)"}` };

  const query = String(p.account || p.email || p.query || p.target || p.user || "").trim();
  if (!query) return { error: "Say which account this is for, by email or name." };
  const resolved = await resolveAccount(db, query);
  if (!resolved.user) return { error: resolved.error || "Account not found.", candidates: resolved.candidates || [] };
  const user = resolved.user;
  const label = targetLabel(user);
  const clean = { account: user.email, target_user_id: user.id };
  let summary = "";

  if (act === "set_tier") {
    const tier = String(p.tier || "").toLowerCase();
    if (!LIMITS[tier]) return { error: "Invalid tier. Use free, starter, solo or pro." };
    if (user.id === auth.user.id && tier === "free") {
      return { error: "You cannot set your own tier to free." };
    }
    const cycle = String(p.cycle || "manual").toLowerCase();
    clean.tier = tier;
    clean.cycle = ["monthly", "yearly", "manual"].includes(cycle) ? cycle : "manual";
    const cur = await currentSubscription(db, user.id);
    const curEnd = dateOnly(cur.current_period_end);
    const cycleNote = clean.cycle === "manual" ? "manual, no end date" : clean.cycle;
    summary = `Set tier to ${tierName(tier)} (${cycleNote}) for ${label}. Current: ${tierName(cur.tier)}, ${cur.status}, ends ${curEnd || "no end date"}.`;
  } else if (act === "grant") {
    const tier = String(p.tier || "").toLowerCase();
    if (!LIMITS[tier] || tier === "free") return { error: "Invalid grant tier. Use starter, solo or pro." };
    const cycle = String(p.cycle || "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";
    clean.tier = tier;
    clean.cycle = cycle;
    const now = new Date();
    const end = periodEndForCycle(cycle, now);
    clean.period_start = toSqliteDate(now);
    clean.period_end = toSqliteDate(end);
    summary = `Grant ${tierName(tier)}, ${cycle}, for ${label}. ${tierName(tier)} runs from today to ${dateOnly(clean.period_end)}.`;
  } else if (act === "suspend") {
    if (user.id === auth.user.id) return { error: "You cannot suspend yourself." };
    if (user.status === "suspended") return { error: `${label} is already suspended.` };
    summary = `Suspend account for ${label}. They will not be able to sign in.`;
  } else if (act === "unsuspend") {
    if (user.status !== "suspended") return { error: `${label} is not suspended.` };
    summary = `Unsuspend account for ${label}. They will be able to sign in again.`;
  } else if (act === "revoke_promo") {
    let claim = null;
    try { claim = await getActivePromoClaim(db, user.id); } catch (e) { claim = null; }
    if (!claim) {
      // Fall back to any active-status claim row for this user.
      try {
        claim = await db.prepare(
          `SELECT * FROM promo_claims WHERE promo_slug = ? AND user_id = ? AND status = 'active' ORDER BY claimed_at DESC LIMIT 1`
        ).bind(PROMO_SLUG, user.id).first();
      } catch (e) { claim = null; }
    }
    if (!claim) return { error: `${label} has no active promo claim to revoke.` };
    clean.claim_id = claim.id;
    clean.prior_tier = claim.prior_tier || "free";
    summary = `Revoke the active Pro free month claim for ${label}. Their plan returns to ${tierName(claim.prior_tier || "free")}.`;
  }

  const now = new Date();
  const nowStr = toSqliteDate(now);
  const expiresStr = toSqliteDate(new Date(now.getTime() + 15 * 60 * 1000));
  const id = "aip_" + now.getTime().toString(36) + Math.random().toString(36).slice(2, 8);

  await db.prepare(
    `UPDATE admin_ai_proposals SET status = 'superseded', resolved_at = ?
     WHERE admin_user_id = ? AND action = ? AND target_user_id = ? AND status = 'pending'`
  ).bind(nowStr, auth.user.id, act, user.id).run();

  await db.prepare(
    `INSERT INTO admin_ai_proposals (id, admin_user_id, action, target_user_id, target_label, params, summary, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, auth.user.id, act, user.id, label, JSON.stringify(clean), summary, nowStr, expiresStr).run();

  const proposal = {
    id, admin_user_id: auth.user.id, action: act, target_user_id: user.id,
    target_label: label, params: clean, summary, status: "pending",
    created_at: nowStr, expires_at: expiresStr, resolved_at: null, result: null,
  };
  await safeAudit(context, auth, "admin_ai.proposal.create", id, {
    action: act, target_user_id: user.id, target: label, summary,
  });
  return proposal;
}

async function markProposal(db, id, status, result) {
  await db.prepare(
    `UPDATE admin_ai_proposals SET status = ?, resolved_at = ?, result = ? WHERE id = ?`
  ).bind(status, toSqliteDate(), result || null, id).run();
}

// Execute a confirmed proposal. This is only called by the confirm
// endpoint. It claims the row first (pending to processing in one
// conditional update) so a proposal can never execute twice, then runs
// the write through the same paths the admin screens use.
export async function executeProposal(context, auth, proposal) {
  const db = context.env.KOPABOOK_DB;
  await ensureAdminAiTables(db);
  if (!proposal || !proposal.id) return { ok: false, message: "Proposal not found.", status: "missing" };
  if (Number(proposal.admin_user_id) !== Number(auth.user.id)) {
    return { ok: false, message: "This proposal belongs to another admin.", status: proposal.status };
  }
  if (proposal.status !== "pending") {
    return { ok: false, message: `This proposal is already ${proposal.status} and cannot run again.`, status: proposal.status };
  }
  const nowStr = toSqliteDate();
  if (proposal.expires_at && String(proposal.expires_at) <= nowStr) {
    await markProposal(db, proposal.id, "expired", "Expired before confirmation.");
    return { ok: false, message: "This proposal has expired. Ask Admin AI to prepare it again.", status: "expired" };
  }
  const params = typeof proposal.params === "string"
    ? (() => { try { return JSON.parse(proposal.params); } catch (e) { return {}; } })()
    : (proposal.params || {});
  const targetUserId = Number(proposal.target_user_id || params.target_user_id || 0);
  if (!targetUserId) return { ok: false, message: "Proposal has no target account.", status: proposal.status };

  // Atomic claim: exactly one confirm can win this update.
  try {
    const claim = await db.prepare(
      `UPDATE admin_ai_proposals SET status = 'processing' WHERE id = ? AND status = 'pending'`
    ).bind(proposal.id).run();
    const changes = claim && claim.meta ? Number(claim.meta.changes) : null;
    if (changes === 0) {
      const fresh = await getProposal(db, proposal.id);
      return { ok: false, message: "This proposal was already handled and cannot run again.", status: fresh ? fresh.status : "resolved" };
    }
  } catch (e) {
    // If the claim update itself fails, do not run the write blind.
    return { ok: false, message: "Could not claim this proposal for execution.", status: "pending" };
  }

  const act = String(proposal.action || "");
  let resultText = "";
  try {
    if (act === "set_tier") {
      const tier = String(params.tier || "").toLowerCase();
      const cycle = String(params.cycle || "manual").toLowerCase();
      if (!LIMITS[tier]) throw new Error("Invalid tier.");
      if (targetUserId === auth.user.id && tier === "free") {
        throw new Error("You cannot set your own tier to free.");
      }
      // Mirrors the set_tier upsert in functions/api/admin/accounts.js exactly.
      const now = toSqliteDate();
      await db.prepare(
        `INSERT INTO account_subscriptions (user_id, tier, status, billing_cycle, updated_at, current_period_start)
         VALUES (?, ?, 'active', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, status = 'active',
           billing_cycle = excluded.billing_cycle, updated_at = excluded.updated_at,
           current_period_start = excluded.current_period_start`
      ).bind(targetUserId, tier, cycle, now, now).run();
      resultText = `Tier set to ${tierName(tier)} for ${proposal.target_label || params.account || targetUserId}.`;
    } else if (act === "grant") {
      const tier = String(params.tier || "").toLowerCase();
      const cycle = String(params.cycle || "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";
      if (!LIMITS[tier] || tier === "free") throw new Error("Invalid grant tier.");
      const now = new Date();
      const periodStart = toSqliteDate(now);
      const periodEnd = toSqliteDate(periodEndForCycle(cycle, now));
      await activateSubscriptionSafe(db, targetUserId, tier, cycle, periodStart, periodEnd);
      resultText = `Granted ${tierName(tier)} (${cycle}) to ${proposal.target_label || params.account || targetUserId} until ${dateOnly(periodEnd)}.`;
    } else if (act === "suspend" || act === "unsuspend") {
      if (act === "suspend" && targetUserId === auth.user.id) {
        throw new Error("You cannot suspend yourself.");
      }
      const status = act === "suspend" ? "suspended" : "active";
      await db.prepare(`UPDATE users SET status = ? WHERE id = ?`).bind(status, targetUserId).run();
      resultText = act === "suspend"
        ? `Account suspended: ${proposal.target_label || params.account || targetUserId}.`
        : `Account reactivated: ${proposal.target_label || params.account || targetUserId}.`;
    } else if (act === "revoke_promo") {
      let claimId = params.claim_id || null;
      if (!claimId) {
        let claim = null;
        try { claim = await getActivePromoClaim(db, targetUserId); } catch (e) { claim = null; }
        if (claim) claimId = claim.id;
      }
      if (!claimId) throw new Error("No active promo claim found for this account.");
      // Mirrors the revoke update in functions/api/admin/promo.js.
      const res = await db.prepare(
        `UPDATE promo_claims SET status = 'revoked' WHERE id = ? AND promo_slug = ? AND status = 'active'`
      ).bind(claimId, PROMO_SLUG).run();
      const changed = res && res.meta ? Number(res.meta.changes || 0) : 1;
      if (!changed) throw new Error("Claim not found or not active.");
      resultText = `Promo claim revoked for ${proposal.target_label || params.account || targetUserId}.`;
    } else {
      throw new Error(`Unknown action: ${act}`);
    }
  } catch (e) {
    const failText = String((e && e.message) || e);
    await markProposal(db, proposal.id, "failed", failText);
    await safeAudit(context, auth, "admin_ai.proposal.execute", proposal.id, {
      action: act, target_user_id: targetUserId, outcome: "failed", error: failText,
    });
    return { ok: false, message: failText, status: "failed" };
  }

  await markProposal(db, proposal.id, "executed", resultText);
  await safeAudit(context, auth, "admin_ai.proposal.execute", proposal.id, {
    action: act, target_user_id: targetUserId, outcome: "executed", result: resultText,
  });
  return { ok: true, message: resultText, status: "executed" };
}

export async function cancelProposal(context, auth, proposal) {
  const db = context.env.KOPABOOK_DB;
  await ensureAdminAiTables(db);
  if (!proposal || !proposal.id) return { ok: false, message: "Proposal not found.", status: "missing" };
  if (Number(proposal.admin_user_id) !== Number(auth.user.id)) {
    return { ok: false, message: "This proposal belongs to another admin.", status: proposal.status };
  }
  if (proposal.status !== "pending") {
    return { ok: false, message: `This proposal is already ${proposal.status}.`, status: proposal.status };
  }
  if (proposal.expires_at && String(proposal.expires_at) <= toSqliteDate()) {
    await markProposal(db, proposal.id, "expired", "Expired before a decision was made.");
    return { ok: false, message: "This proposal has expired.", status: "expired" };
  }
  await markProposal(db, proposal.id, "cancelled", "Cancelled by the owner.");
  await safeAudit(context, auth, "admin_ai.proposal.cancel", proposal.id, {
    action: proposal.action, target_user_id: proposal.target_user_id,
  });
  return { ok: true, message: "Proposal cancelled. Nothing was changed.", status: "cancelled" };
}
