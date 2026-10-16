// Shared helpers for KopaBook Pages Functions.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(name + "=")) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

export function sessionCookieHeader(token, maxAgeSecs) {
  const attrs = [
    `kopabook_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSecs}`,
  ];
  // In production (https) mark Secure. Pages serves https in prod.
  attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookieHeader() {
  return "kopabook_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure";
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// PBKDF2-SHA256 password hashing (available in Workers / Pages Functions).
// Note: Cloudflare's WebCrypto caps PBKDF2 at 100,000 iterations, so we use
// exactly that. verifyPassword reads the count back from the stored hash.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$100000$${bytesToHex(salt)}$${bytesToHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [, iterStr, saltHex, hashHex] = stored.split("$");
    const iterations = parseInt(iterStr, 10);
    const salt = hexToBytes(saltHex);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256
    );
    return bytesToHex(bits) === hashHex;
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function toSqliteDate(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Minutes that a timezone is ahead of UTC at a given instant (handles DST).
function tzOffsetMinutes(zone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// "Today" in the business's own timezone. Returns the local date (YYYY-MM-DD)
// plus the matching UTC window for comparing created_at timestamps.
// Pure Intl, no library needed, works on Cloudflare Workers.
export function businessDay(tz) {
  const zone = tz || "Africa/Lagos";
  let date;
  try {
    date = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }
  // Find UTC start of that local day via two refinement passes.
  let guess = Date.parse(date + "T00:00:00Z");
  for (let i = 0; i < 2; i++) {
    let offset;
    try { offset = tzOffsetMinutes(zone, new Date(guess)); }
    catch { offset = 60; }
    guess = Date.parse(date + "T00:00:00Z") - offset * 60000;
  }
  const start = new Date(guess);
  const end = new Date(guess + 24 * 3600 * 1000);
  return { date, startUtc: toSqliteDate(start), endUtc: toSqliteDate(end) };
}

// Returns { user, business, membership } or null.
export async function getAuthContext(context) {
  const token = getCookie(context.request, "kopabook_session");
  if (!token) return null;
  const now = toSqliteDate();

  const sessionRow = await context.env.KOPABOOK_DB.prepare(
    `SELECT sessions.user_id, sessions.business_id AS session_business_id,
            users.id, users.full_name, users.email, users.role, users.status,
            users.is_platform_admin
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.session_token = ? AND sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(token, now)
    .first();

  const user = sessionRow;
  if (!user || user.status !== "active") return null;

  await context.env.KOPABOOK_DB.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE session_token = ?`
  )
    .bind(now, token)
    .run();

  const memberCols = `business_members.business_id, business_members.role AS business_role,
            business_members.can_view_profit, business_members.can_discount,
            business_members.can_manage_expenses, business_members.can_manage_products,
            business_members.max_discount_percent, business_members.suspended,
            businesses.name AS business_name, businesses.currency, businesses.business_type,
            businesses.timezone, businesses.country, businesses.status`;
  const memberFrom = `FROM business_members
     INNER JOIN businesses ON businesses.id = business_members.business_id
     WHERE business_members.user_id = ?`;

  // The session remembers which business is active. Fall back to the first
  // membership for older sessions, then pin it.
  let membership = null;
  if (sessionRow.session_business_id) {
    membership = await context.env.KOPABOOK_DB.prepare(
      `SELECT ${memberCols} ${memberFrom} AND business_members.business_id = ? LIMIT 1`
    ).bind(user.id, sessionRow.session_business_id).first();
    // A closed business is never the active one; fall through to an active business.
    if (membership && membership.status === "closed") membership = null;
    // A suspended staff member loses access immediately.
    if (membership && Number(membership.suspended || 0) === 1) membership = null;
  }
  if (!membership) {
    membership = await context.env.KOPABOOK_DB.prepare(
      `SELECT ${memberCols} ${memberFrom}
       AND (businesses.status IS NULL OR businesses.status = 'active')
       AND (business_members.suspended IS NULL OR business_members.suspended = 0)
       ORDER BY business_members.id ASC LIMIT 1`
    ).bind(user.id).first();
    if (membership) {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE sessions SET business_id = ? WHERE session_token = ?`
      ).bind(membership.business_id, token).run();
    }
  }

  const isOwner = membership && membership.business_role === "owner";
  const isPartner = membership && membership.business_role === "partner";
  // Partners are co-owners: full access like the owner. Destructive owner-only
  // actions (removing the owner, deleting the business) still check isOwner.
  const fullAccess = isOwner || isPartner;
  return {
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      status: user.status,
      isPlatformAdmin: !!user.is_platform_admin,
    },
    business: membership
      ? {
          id: membership.business_id,
          name: membership.business_name,
          currency: membership.currency || "NGN",
          role: membership.business_role,
          business_type: membership.business_type || "other",
          timezone: membership.timezone || "Africa/Lagos",
          country: membership.country || "Nigeria",
        }
      : null,
    // Granular staff permission flags. Owners and partners always have full access.
    perms: {
      can_view_profit: fullAccess || Number(membership?.can_view_profit || 0) === 1,
      can_discount: fullAccess || Number(membership?.can_discount || 0) === 1,
      can_manage_expenses: fullAccess || Number(membership?.can_manage_expenses || 0) === 1,
      can_manage_products: fullAccess || Number(membership?.can_manage_products || 0) === 1,
    },
    // Per-staff limits. Owners and partners have no caps.
    limits: {
      max_discount_percent: fullAccess
        ? null
        : (membership?.max_discount_percent === null || membership?.max_discount_percent === undefined
            ? null : Number(membership.max_discount_percent)),
    },
  };
}

export function requireAuth(auth) {
  if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
  if (!auth.business)
    return json({ ok: false, message: "No business found for this account." }, 403);
  return null;
}

export function canManage(auth) {
  return auth.business.role === "owner" || auth.business.role === "manager";
}

// Granular staff permission gate. Owners always pass; managers and attendants
// need the flag on their membership. Returns a 403 JSON response when denied,
// or null when allowed.
export function requirePerm(auth, flag, message) {
  if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
  if (auth.perms && auth.perms[flag]) return null;
  return json(
    { ok: false, message: message || "You don't have permission for this action. Ask the business owner to grant it." },
    403
  );
}

export async function audit(context, auth, actionType, entityType, entityId, metadata) {
  try {
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO audit_logs (actor_user_id, business_id, action_type, entity_type, entity_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        auth.user.id,
        auth.business.id,
        actionType,
        entityType || null,
        entityId || null,
        metadata ? JSON.stringify(metadata) : null
      )
      .run();
  } catch {
    // audit must never break the main flow
  }
}

// Hotel staff roles. Owner always passes. Shop roles (manager, attendant)
// get no hotel write access.
export const HOTEL_ROLES = {
  owner: "Owner",
  hotel_manager: "Hotel manager",
  receptionist: "Receptionist",
  housekeeper: "Housekeeper",
};

export function requireHotelRole(auth, allowedRoles) {
  const role = auth && auth.business && auth.business.role;
  if (role === "owner" || role === "partner" || allowedRoles.includes(role)) return null;
  return json(
    { ok: false, message: "Your staff role does not allow this action." },
    403
  );
}
