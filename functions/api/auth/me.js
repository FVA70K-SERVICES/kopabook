// GET /api/auth/me — current session + business context
// PATCH /api/auth/me — update own profile (full name, phone)
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestGet(context) {
  const auth = await getAuthContext(context);
  if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
  return json({ ok: true, user: auth.user, business: auth.business, perms: auth.perms });
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const fullName = String(body.fullName || "").trim();
    if (fullName.length < 2) {
      return json({ ok: false, message: "Please enter your full name." }, 400);
    }
    const phone = String(body.phone || "").trim();
    if (phone && !/^[+\d][\d\s\-()]{6,18}$/.test(phone)) {
      return json({ ok: false, message: "Please enter a valid phone number." }, 400);
    }

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET full_name = ?, phone = ? WHERE id = ?`
    )
      .bind(fullName, phone || null, auth.user.id)
      .run();

    await audit(context, auth, "auth.profile.update", "user", auth.user.id, { fullName, phone: phone || null });
    return json({ ok: true, message: "Profile updated.", fullName, phone: phone || null });
  } catch (error) {
    return json({ ok: false, message: "Could not update profile.", error: String(error) }, 500);
  }
}
