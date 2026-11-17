// Kopa AI — Briefing, end-of-day summary, reminders, action parsing.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.
import { toSqliteDate, businessDay } from "../_utils";
import { qtyLeftText } from "./_fastpath.js";
import { daysSince } from "./_assistant.js";
import { fmt } from "./_gating.js";
import { PROPOSAL_TTL_MS, ensurePendingProposals } from "./_proposals.js";

export async function buildBriefing(db, auth, snap, currency) {
  const businessId = auth.business.id;
  const L = [];
  L.push("Here is your briefing.");
  // Today and yesterday in the BUSINESS timezone, from the same "now":
  // two disjoint UTC windows, so the two lines can never repeat each
  // other. The old query used SQLite's UTC day (date('now','-1 day')),
  // which is a different day from the business day after midnight WAT
  // and repeated today's figure as yesterday's. If either window query
  // fails, today falls back to the snapshot and yesterday is omitted,
  // so the briefing never loses its today line.
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayWindow = businessDay(tz, now);
  const yesterdayWindow = businessDay(tz, new Date(now.getTime() - 24 * 3600 * 1000));
  let todaySales = { total: Number(snap.salesToday.total) || 0, count: Number(snap.salesToday.count) || 0 };
  let yesterdaySales = null;
  try {
    const t = await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, todayWindow.startUtc, todayWindow.endUtc).first();
    todaySales = { total: Number(t && t.total) || 0, count: Number(t && t.cnt) || 0 };
  } catch (e) {}
  try {
    const y = await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, yesterdayWindow.startUtc, yesterdayWindow.endUtc).first();
    yesterdaySales = { total: Number(y && y.total) || 0, count: Number(y && y.cnt) || 0 };
  } catch (e) {}
  L.push(`Sales today so far: ${fmt(todaySales.total, currency)} across ${todaySales.count} ${todaySales.count === 1 ? "sale" : "sales"}.`);
  if (yesterdaySales) {
    L.push(`Yesterday: ${fmt(yesterdaySales.total, currency)} across ${yesterdaySales.count} ${yesterdaySales.count === 1 ? "sale" : "sales"}.`);
  }
  if (snap.debtors && snap.debtors.length) {
    const owingLines = [];
    for (const d of snap.debtors) {
      let line = `${d.name} owes ${fmt(d.balance, currency)}`;
      try {
        const cust = await db.prepare(`SELECT id FROM customers WHERE business_id = ? AND name = ? LIMIT 1`).bind(businessId, d.name).first();
        if (cust) {
          const oldest = await db.prepare(
            `SELECT MIN(created_at) AS oldest FROM sales WHERE business_id = ? AND customer_id = ? AND balance_due > 0 AND (status IS NULL OR status <> 'voided')`
          ).bind(businessId, cust.id).first();
          const days = oldest && oldest.oldest ? daysSince(oldest.oldest) : null;
          if (days !== null) line += `, oldest unpaid sale ${days} ${days === 1 ? "day" : "days"} ago`;
        }
      } catch (e) {}
      owingLines.push(line);
    }
    L.push("Who is owing: " + owingLines.join("; ") + ".");
  } else {
    L.push("Who is owing: nobody owes money right now.");
  }
  if (snap.lowStock && snap.lowStock.length) {
    L.push("Low stock: " + snap.lowStock.map((p) => `${p.name} (${qtyLeftText(p.qty, p.unit)})`).join("; ") + ".");
  } else {
    L.push("Low stock: nothing is running low.");
  }
  try {
    const rs = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' AND remind_at <= ? ORDER BY remind_at ASC LIMIT 10`
    ).bind(businessId, toSqliteDate(new Date())).all();
    const due = (rs && rs.results) || [];
    if (due.length) {
      L.push("Reminders due now: " + due.map((r) => `${r.title} (${r.remind_at})`).join("; ") + ".");
    } else {
      L.push("Reminders due now: none.");
    }
  } catch (e) {
    L.push("Reminders due now: none.");
  }
  return L.join("\n");
}

// PA end-of-day summary: deterministic lines from real data only.
// Business-timezone windows (round 5): the old UTC-day queries counted
// the wrong day after midnight WAT, and counted voided sales. "Sales
// today" and the profit line reuse the snapshot's business-day figures;
// expenses, best sellers and new debts query the same window here.
export async function buildEodSummary(db, auth, snap, currency) {
  const businessId = auth.business.id;
  const L = [];
  L.push("Here is your end of day summary.");
  L.push(`Sales today: ${fmt(snap.salesToday.total, currency)} across ${snap.salesToday.count} ${snap.salesToday.count === 1 ? "sale" : "sales"}.`);
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayW = businessDay(tz, now);
  const tomorrowDate = businessDay(tz, new Date(now.getTime() + 24 * 3600 * 1000)).date;
  let expensesToday = 0;
  let expensesCount = 0;
  try {
    const e = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses WHERE business_id = ? AND incurred_on >= ? AND incurred_on < ?`
    ).bind(businessId, todayW.date, tomorrowDate).first();
    expensesToday = Number(e && e.total) || 0;
    expensesCount = Number(e && e.cnt) || 0;
  } catch (err) {}
  L.push(`Expenses today: ${fmt(expensesToday, currency)} across ${expensesCount} ${expensesCount === 1 ? "expense" : "expenses"}.`);
  L.push(`Profit after expenses today: ${fmt(Math.round((Number(snap.salesToday.total || 0) - expensesToday) * 100) / 100, currency)} (sales minus expenses).`);
  try {
    const rs = await db.prepare(
      `SELECT p.name AS name, COALESCE(SUM(si.quantity),0) AS qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND (s.status IS NULL OR s.status <> 'voided')
       GROUP BY si.product_id ORDER BY qty DESC LIMIT 3`
    ).bind(businessId, todayW.startUtc, todayW.endUtc).all();
    const best = (rs && rs.results) || [];
    if (best.length) {
      L.push("Best sellers today: " + best.map((b) => `${b.name} (${Number(b.qty) || 0} sold)`).join("; ") + ".");
    } else {
      L.push("Best sellers today: no product sales yet today.");
    }
  } catch (err) {
    L.push("Best sellers today: no product sales yet today.");
  }
  try {
    const d = await db.prepare(
      `SELECT COALESCE(SUM(balance_due),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND balance_due > 0 AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, todayW.startUtc, todayW.endUtc).first();
    const debtTotal = Number(d && d.total) || 0;
    const debtCount = Number(d && d.cnt) || 0;
    L.push(`New debts today: ${fmt(debtTotal, currency)} across ${debtCount} ${debtCount === 1 ? "sale" : "sales"}.`);
  } catch (err) {}
  return L.join("\n");
}

const REMINDER_STOP_WORDS = new Set(["reminder", "remind", "done", "mark", "marked", "complete", "completed", "finished", "finish", "please", "the", "that", "this", "with", "for", "and", "you", "your", "have", "has", "now", "can", "set", "off", "as", "is", "it", "to", "a", "an", "my", "me"]);
function reminderTitleMatches(title, message) {
  const words = String(title || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !REMINDER_STOP_WORDS.has(w));
  if (!words.length) return false;
  const msg = " " + String(message || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return words.some((w) => msg.includes(" " + w + " ") || msg.includes(" " + w + "s "));
}

// ---------------------------------------------------------------------------
// ACTION line parsing.
// ---------------------------------------------------------------------------
export function parseAction(text) {
  if (!text) return null;
  // Be lenient: strip code fences in case the model wraps the JSON anyway.
  const stripped = String(text).replace(/```(?:json)?/gi, "");
  const idx = stripped.search(/^\s*ACTION:/m);
  if (idx < 0) return null;
  // Extract a balanced JSON object starting after "ACTION:".
  const start = stripped.indexOf("{", idx);
  if (start < 0) return { parseError: true };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return { parseError: true };
  try {
    const obj = JSON.parse(stripped.slice(start, end));
    if (obj && typeof obj.tool === "string" && obj.params && typeof obj.params === "object") {
      const rest = (stripped.slice(0, idx) + stripped.slice(end)).replace(/^\s*ACTION:\s*/m, "").trim();
      return { tool: obj.tool, params: obj.params, rest };
    }
  } catch (e) {
    return { parseError: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reminder helpers, shared by the deterministic fast path (all tiers)
// and the PA block below. A reminder is never marked done by chat words:
// the owner's words only select it, a proposal is stored, and only a
// Confirm tap on the proposal card marks it done. Nothing is updated here.
// ---------------------------------------------------------------------------
export async function listDueReminders(db, businessId) {
  let pendingReminders = [];
  try {
    const rr = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 50`
    ).bind(businessId).all();
    pendingReminders = (rr && rr.results) || [];
  } catch (e) { pendingReminders = []; }
  const nowStr = toSqliteDate(new Date());
  const due = pendingReminders.filter((r) => String(r.remind_at || "") <= nowStr);
  if (!pendingReminders.length) return "No reminders set.";
  if (!due.length) {
    const next = pendingReminders[0];
    return `No reminders are due right now. Next: "${next.title}" at ${next.remind_at}.`;
  }
  return `Reminders due (${due.length}):\n` + due.map((r) => `- ${r.title} (due ${r.remind_at})`).join("\n");
}

export async function handleReminderDone(db, auth, businessId, sessionKey, message, currency, proposalText) {
  let pendingReminders = [];
  try {
    const rr = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 50`
    ).bind(businessId).all();
    pendingReminders = (rr && rr.results) || [];
  } catch (e) { pendingReminders = []; }
  const nowStr = toSqliteDate(new Date());
  const dueReminders = pendingReminders.filter((r) => String(r.remind_at || "") <= nowStr);
  const matched = pendingReminders.filter((r) => reminderTitleMatches(r.title, message));
  let reminderReply = null;
  let target = null;
  if (matched.length === 1) target = matched[0];
  else if (matched.length > 1) {
    reminderReply = "More than one reminder matches that. Which one is done?\n" + matched.map((r) => "- " + r.title).join("\n");
  } else if (dueReminders.length === 1) {
    target = dueReminders[0];
  } else if (dueReminders.length > 1) {
    reminderReply = "These reminders are due. Which one is done?\n" + dueReminders.map((r) => "- " + r.title).join("\n");
  } else {
    reminderReply = "I do not have a due reminder to mark as done.";
  }
  let reminderProposal = null;
  if (target) {
    // Same proposal shape as the ACTION path: supersede any older pending
    // proposal for this session, store this one with a 10-minute expiry,
    // and ask for a Confirm tap. Execution runs only through the confirm
    // tap path, via mark_reminder_done.
    const proposalId = "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const createdAt = new Date();
    const expiresStr = toSqliteDate(new Date(createdAt.getTime() + PROPOSAL_TTL_MS));
    try {
      await ensurePendingProposals(db);
      await db.prepare(
        `UPDATE ai_pending_proposals SET status = 'superseded', resolved_at = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
      ).bind(toSqliteDate(createdAt), businessId, sessionKey).run();
      await db.prepare(
        `INSERT INTO ai_pending_proposals (id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(proposalId, businessId, auth.user.id, sessionKey, "mark_reminder_done", JSON.stringify({ reminder_id: target.id, title: target.title }), `Mark reminder "${target.title}" as done.`, toSqliteDate(createdAt), expiresStr).run();
      reminderProposal = { id: proposalId, tool: "mark_reminder_done", summary: `Mark reminder "${target.title}" as done.`, lines: [`Mark reminder "${target.title}" as done.`], expires_at: expiresStr };
      // One rendering only: the proposal card shows the lines. The reply
      // stays empty so the same proposal is never also pasted as a chat
      // bubble (duplicate-proposal fix, round 2).
      reminderReply = "";
    } catch (e) {
      reminderReply = "I could not prepare that for confirmation just now. Your reminder is untouched. Try again.";
    }
  }
  return { reply: reminderReply, proposal: reminderProposal };
}

// ---------------------------------------------------------------------------
// Main handler.
// ---------------------------------------------------------------------------
