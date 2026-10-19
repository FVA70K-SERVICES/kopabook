// Chatbot control panel API for business owners.
// GET  /api/chat/control - settings + active bot-handled conversations
// POST /api/chat/control - { action: 'set_bot' | 'set_auto_clear' | 'clear_session', ... }
// Owner and partner roles only. Every query is scoped to the caller's business.
import { json, getAuthContext, requireAuth } from "../_utils.js";

// Convention: each business gets its own chat site id for its public widget.
const SITE_PREFIX = "biz_";

function ownerOnly(auth) {
  if (!auth || !auth.business) {
    return json({ ok: false, message: "No business found for this account." }, 403);
  }
  const role = auth.business.role;
  if (role !== "owner" && role !== "partner") {
    return json({ ok: false, message: "Only the business owner can change chatbot settings." }, 403);
  }
  return null;
}

async function ensureSettings(db, businessId) {
  await db
    .prepare("INSERT OR IGNORE INTO business_chat_settings (business_id) VALUES (?)")
    .bind(businessId)
    .run();
}

async function ensureSite(db, businessId, businessName) {
  const siteId = SITE_PREFIX + businessId;
  const name = String(businessName || "My Business").slice(0, 80);
  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO chat_sites (site_id, business_id, business_name, bot_name, bot_enabled, plan, created_at) VALUES (?, ?, ?, 'Kopa Bot', 1, 'internal', ?)"
      )
      .bind(siteId, businessId, name, Date.now())
      .run();
  } catch (e) {
    // Pre-migration fallback: chat_sites has no business_id column yet.
    await db
      .prepare(
        "INSERT OR IGNORE INTO chat_sites (site_id, business_name, bot_name, bot_enabled, plan, created_at) VALUES (?, ?, 'Kopa Bot', 1, 'internal', ?)"
      )
      .bind(siteId, name, Date.now())
      .run()
      .catch(() => {});
  }
  return siteId;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth) || ownerOnly(auth);
    if (denied) return denied;
    const businessId = auth.business.id;
    const db = context.env.KOPABOOK_DB;

    await ensureSettings(db, businessId);
    const settings = await db
      .prepare(
        "SELECT bot_enabled, auto_clear_enabled, auto_clear_hours FROM business_chat_settings WHERE business_id = ?"
      )
      .bind(businessId)
      .first();
    // staff_chat_enabled lives in migration 0047; read defensively pre-migration.
    let staffChat = false;
    try {
      const sc = await db
        .prepare("SELECT staff_chat_enabled FROM business_chat_settings WHERE business_id = ?")
        .bind(businessId)
        .first();
      staffChat = Number(sc && sc.staff_chat_enabled) === 1;
    } catch (e) {}

    const siteId = SITE_PREFIX + businessId;
    const site = await db
      .prepare("SELECT bot_enabled FROM chat_sites WHERE site_id = ?")
      .bind(siteId)
      .first()
      .catch(() => null);

    const convos = await db
      .prepare(
        `SELECT s.id, s.visitor_name, s.handled_by, s.needs_human, s.last_activity,
          (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_message
         FROM chat_sessions s
         WHERE s.site_id = ? AND s.status = 'active'
         ORDER BY s.last_activity DESC LIMIT 20`
      )
      .bind(siteId)
      .all()
      .catch(() => ({ results: [] }));

    return json({
      ok: true,
      settings: {
        bot_enabled: Number(settings && settings.bot_enabled) !== 0,
        auto_clear_enabled: Number(settings && settings.auto_clear_enabled) === 1,
        auto_clear_hours: Number(settings && settings.auto_clear_hours) || 24,
        staff_chat_enabled: staffChat,
        site_id: siteId,
        site_linked: !!site,
      },
      conversations: convos.results || [],
    });
  } catch (e) {
    return json({ ok: false, message: "Could not load chatbot controls." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth) || ownerOnly(auth);
    if (denied) return denied;
    const businessId = auth.business.id;
    const db = context.env.KOPABOOK_DB;
    const siteId = SITE_PREFIX + businessId;
    const body = await context.request.json().catch(() => ({}));
    const action = body.action;

    if (action === "set_bot") {
      const enabled = !!body.enabled;
      await ensureSettings(db, businessId);
      await ensureSite(db, businessId, auth.business.name);
      await db
        .prepare("UPDATE business_chat_settings SET bot_enabled = ?, updated_at = datetime('now') WHERE business_id = ?")
        .bind(enabled ? 1 : 0, businessId)
        .run();
      // Flip the public widget immediately: with bot_enabled off, send.js
      // stores visitor messages but sends no bot reply, so new chats wait
      // for a human in the Chat Center.
      await db
        .prepare("UPDATE chat_sites SET bot_enabled = ? WHERE site_id = ?")
        .bind(enabled ? 1 : 0, siteId)
        .run();
      return json({ ok: true, bot_enabled: enabled });
    }

    if (action === "set_auto_clear") {
      const enabled = !!body.enabled;
      let hours = Math.round(Number(body.hours) || 24);
      hours = Math.min(Math.max(hours, 1), 720);
      await ensureSettings(db, businessId);
      await db
        .prepare(
          "UPDATE business_chat_settings SET auto_clear_enabled = ?, auto_clear_hours = ?, updated_at = datetime('now') WHERE business_id = ?"
        )
        .bind(enabled ? 1 : 0, hours, businessId)
        .run();
      return json({ ok: true, auto_clear_enabled: enabled, auto_clear_hours: hours });
    }

    if (action === "set_staff_chat") {
      const enabled = !!body.enabled;
      await ensureSettings(db, businessId);
      try {
        await db
          .prepare("UPDATE business_chat_settings SET staff_chat_enabled = ?, updated_at = datetime('now') WHERE business_id = ?")
          .bind(enabled ? 1 : 0, businessId)
          .run();
      } catch (e) {
        return json({ ok: false, message: "Apply migration 0047 in D1 first (staff_chat_enabled column)." }, 400);
      }
      return json({ ok: true, staff_chat_enabled: enabled });
    }

    if (action === "clear_session") {
      const sessionId = String(body.session_id || "").slice(0, 64);
      if (!sessionId) return json({ ok: false, message: "Pick a conversation first." }, 400);
      // Never touch another business's chats: the session must belong to
      // this business's own chat site.
      const sess = await db
        .prepare("SELECT site_id FROM chat_sessions WHERE id = ?")
        .bind(sessionId)
        .first();
      if (!sess || sess.site_id !== siteId) {
        return json({ ok: false, message: "That conversation does not belong to this business." }, 403);
      }
      const del = await db
        .prepare("DELETE FROM chat_messages WHERE session_id = ?")
        .bind(sessionId)
        .run();
      const deleted = del && del.meta ? Number(del.meta.changes) || 0 : 0;
      return json({ ok: true, deleted });
    }

    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, message: "Chatbot control failed. Try again." }, 500);
  }
}
