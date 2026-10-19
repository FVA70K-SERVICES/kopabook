// Shared Chat Center access control.
// Owner and partner always allowed. Other staff allowed only when the business
// owner turned on staff_chat_enabled in business_chat_settings (migration 0047).
// Every check is scoped to the caller business_id from auth. Never trust a
// business_id passed in by the client.

export async function canUseChatCenter(db, auth) {
  if (!auth || !auth.user || !auth.business) return false;
  const role = auth.business.role;
  if (role === "owner" || role === "partner") return true;
  try {
    const s = await db
      .prepare("SELECT staff_chat_enabled FROM business_chat_settings WHERE business_id = ?")
      .bind(auth.business.id)
      .first();
    return Number(s && s.staff_chat_enabled) === 1;
  } catch (e) {
    // Pre-migration 0047: staff stay locked out.
    return false;
  }
}

// Business site id convention used by the public chat widget.
export function businessSiteId(businessId) {
  return "biz_" + businessId;
}
