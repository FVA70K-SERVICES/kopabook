// /api/admin/ai/briefing: platform admin only. Daily briefing pack:
// today's figures plus anomalies, with a deterministic plain-text
// message built from the same numbers. Read-only.
import { json, getAuthContext, requireAuth, toSqliteDate } from "../../_utils.js";
import { requirePlatformAdmin } from "../overview.js";
import { executeReadTool, composeDailyText, lagosDayBounds } from "./_tools.js";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;
    const pack = await executeReadTool(db, "full_briefing", {});

    let manualOlder48h = null;
    try {
      const pending = await executeReadTool(db, "pending_payments", {});
      manualOlder48h = pending && pending.manual ? pending.manual.older_than_48h : null;
    } catch (e) {
      manualOlder48h = null;
    }

    let failedToday = null;
    try {
      const { startUtc, endUtc } = lagosDayBounds("today");
      const row = await db.prepare(
        `SELECT COUNT(*) AS n FROM subscription_payments
         WHERE status NOT IN ('paid', 'pending') AND created_at >= ? AND created_at < ?`
      ).bind(startUtc, endUtc).first();
      failedToday = Number((row && row.n) || 0);
    } catch (e) {
      failedToday = null;
    }

    const fullPack = {
      ...pack,
      anomalies: {
        manual_pending_older_48h: manualOlder48h,
        failed_payments_today: failedToday,
      },
    };
    const cards = {
      ...(pack.today || {}),
      manual_pending_older_48h: manualOlder48h,
      failed_payments_today: failedToday,
      all_time: pack.all_time || {},
      growth: pack.growth || {},
      ai_today: pack.ai_today || {},
    };
    return json({
      ok: true,
      briefing: {
        generated_at: toSqliteDate(),
        cards,
        message: composeDailyText(fullPack),
      },
    });
  } catch (error) {
    return json({ ok: false, message: "Could not build the briefing.", error: String(error) }, 500);
  }
}
