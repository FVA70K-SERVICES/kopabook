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

// Returns { user, business, membership } or null.
export async function getAuthContext(context) {
  const token = getCookie(context.request, "kopabook_session");
  if (!token) return null;
  const now = toSqliteDate();

  const user = await context.env.KOPABOOK_DB.prepare(
    `SELECT users.id, users.full_name, users.email, users.role, users.status
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.session_token = ? AND sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(token, now)
    .first();

  if (!user || user.status !== "active") return null;

  await context.env.KOPABOOK_DB.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE session_token = ?`
  )
    .bind(now, token)
    .run();

  const membership = await context.env.KOPABOOK_DB.prepare(
    `SELECT business_members.business_id, business_members.role AS business_role,
            business_members.can_view_profit, business_members.can_discount,
            business_members.can_manage_expenses, business_members.can_manage_products,
            businesses.name AS business_name, businesses.currency
     FROM business_members
     INNER JOIN businesses ON businesses.id = business_members.business_id
     WHERE business_members.user_id = ?
     ORDER BY business_members.id ASC
     LIMIT 1`
  )
    .bind(user.id)
    .first();

  const isOwner = membership && membership.business_role === "owner";
  return {
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    business: membership
      ? {
          id: membership.business_id,
          name: membership.business_name,
          currency: membership.currency || "NGN",
          role: membership.business_role,
        }
      : null,
    // Granular staff permission flags. Owners always have full access.
    perms: {
      can_view_profit: isOwner || Number(membership?.can_view_profit || 0) === 1,
      can_discount: isOwner || Number(membership?.can_discount || 0) === 1,
      can_manage_expenses: isOwner || Number(membership?.can_manage_expenses || 0) === 1,
      can_manage_products: isOwner || Number(membership?.can_manage_products || 0) === 1,
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
