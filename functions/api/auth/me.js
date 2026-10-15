// GET /api/auth/me — current session + business context
import { json, getAuthContext } from "../_utils";

export async function onRequestGet(context) {
  const auth = await getAuthContext(context);
  if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
  return json({ ok: true, user: auth.user, business: auth.business, perms: auth.perms });
}
