// Pro free for one month promotion.
//
// The promo lives entirely in its own tables (promos, promo_claims) and
// never writes to account_subscriptions. The billing read path overlays
// the promo tier on top of the underlying subscription tier, so the
// billing state underneath is preserved and resumes automatically when
// the claim expires. No payment is involved in this promotion at all.
import { toSqliteDate } from "./_utils.js";

export const PROMO_SLUG = "pro-free-month";

const VALID_TIERS = ["free", "starter", "solo", "pro"];

let tablesReady = false;

export async function ensurePromoTables(db) {
  if (tablesReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS promos (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS promo_claims (
      id TEXT PRIMARY KEY,
      promo_slug TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      prior_tier TEXT NOT NULL,
      prior_status TEXT,
      prior_period_end TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(promo_slug, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_promo_claims_user ON promo_claims (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_promo_claims_slug_status ON promo_claims (promo_slug, status)`,
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run();
  }
  await db.prepare(
    `INSERT OR IGNORE INTO promos (slug, name, tier, duration_days, is_active, starts_at, ends_at)
     VALUES (?, ?, ?, ?, 1, NULL, NULL)`
  ).bind(PROMO_SLUG, "Pro free for one month", "pro", 30).run();
  tablesReady = true;
}

export async function getPromoDef(db) {
  await ensurePromoTables(db);
  const row = await db.prepare(
    `SELECT slug, name, tier, duration_days, is_active, starts_at, ends_at, created_at, updated_at
     FROM promos WHERE slug = ? LIMIT 1`
  ).bind(PROMO_SLUG).first();
  return row || null;
}

export async function getClaim(db, userId) {
  await ensurePromoTables(db);
  const row = await db.prepare(
    `SELECT * FROM promo_claims WHERE promo_slug = ? AND user_id = ? LIMIT 1`
  ).bind(PROMO_SLUG, userId).first();
  return row || null;
}

export async function getActivePromoClaim(db, userId) {
  await ensurePromoTables(db);
  const now = toSqliteDate();
  const row = await db.prepare(
    `SELECT * FROM promo_claims
     WHERE promo_slug = ? AND user_id = ? AND status = 'active' AND expires_at > ?
     LIMIT 1`
  ).bind(PROMO_SLUG, userId, now).first();
  return row || null;
}

// Whether the promotion definition is currently running: it must exist,
// be switched on, and sit inside its optional window. A NULL bound is
// unbounded on that side.
export function isPromoRunning(def, now = toSqliteDate()) {
  if (!def) return false;
  if (Number(def.is_active || 0) !== 1) return false;
  if (def.starts_at && String(def.starts_at) > now) return false;
  if (def.ends_at && String(def.ends_at) <= now) return false;
  return true;
}

// The account tier from account_subscriptions alone, with no promo
// overlay. Mirrors getAccountTier in billing.js, including its read-time
// expiry rules, but returns only { tier, status, periodEnd }.
export async function baseTierFromSubscription(db, userId) {
  const row = await db.prepare(
    `SELECT tier, status, billing_cycle, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
  const tier = row && VALID_TIERS.includes(row.tier) ? row.tier : "free";
  // A pending upgrade keeps the old tier until payment is confirmed.
  if (row && row.status === "pending") {
    return { tier: "free", status: "pending", periodEnd: null };
  }
  const periodEnd = row ? row.current_period_end : null;
  if (tier !== "free") {
    const nowIso = toSqliteDate();
    const expired = !!periodEnd && String(periodEnd) < nowIso;
    const badStatus = !!row && (row.status === "past_due" || row.status === "cancelled");
    if (expired || badStatus) {
      return {
        tier: "free",
        status: row ? row.status : "active",
        periodEnd,
      };
    }
  }
  return {
    tier,
    status: row ? row.status : "active",
    periodEnd,
  };
}

export async function promoStateForUser(db, userId) {
  const def = await getPromoDef(db);
  const claim = await getClaim(db, userId);

  const claimed = !!claim;
  const status = claim ? claim.status : null;
  const claimedAt = claim ? claim.claimed_at : null;
  const expiresAt = claim ? claim.expires_at : null;
  const priorTier = claim ? claim.prior_tier : null;

  let daysLeft = null;
  if (claim && claim.status === "active" && claim.expires_at) {
    const expMs = new Date(String(claim.expires_at).replace(" ", "T") + "Z").getTime();
    if (Number.isFinite(expMs) && expMs > Date.now()) {
      daysLeft = Math.ceil((expMs - Date.now()) / 86400000);
    }
  }

  let available = false;
  let reason = null;
  if (claimed) {
    reason = "already_claimed";
  } else if (!isPromoRunning(def)) {
    reason = "promo_off";
  } else {
    const base = await baseTierFromSubscription(db, userId);
    if (base.tier === "pro") {
      reason = "already_pro";
    } else {
      available = true;
      reason = null;
    }
  }
  // A claimed account is never available, even if the window has since
  // closed; already_claimed above stays the most accurate reason.
  if (claimed) available = false;

  return {
    slug: def ? def.slug : PROMO_SLUG,
    name: def ? def.name : null,
    tier: def ? def.tier : null,
    duration_days: def ? def.duration_days : null,
    available,
    reason,
    claimed,
    status,
    claimed_at: claimedAt,
    expires_at: expiresAt,
    days_left: daysLeft,
    prior_tier: priorTier,
  };
}
