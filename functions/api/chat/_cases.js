// Kopa Support case history: the kept record of support conversations
// between a KopaBook business and the FVA70K team.
//
// Why this exists: the merged in-app chat keeps a rolling 24-hour window
// (see _auto_clear.js), which is right for Ask Kopa AI. Support is
// different: both sides need to look back at what was said, so every
// support-side exchange for a verified signed-in owner is mirrored here at
// send time. The 24-hour sweep only ever touches chat_messages, never
// these tables, so the case record survives the window clearing.
//
// Retention: support cases are kept while the business account is active.
// To change that later (for example 12 months or 90 days), set
// SUPPORT_CASE_RETENTION.mode to 'days' and SUPPORT_CASE_RETENTION.days to
// the number of days; supportCaseRetentionCutoff() then returns the cutoff
// a cleanup pass should use. Nothing deletes cases today.
export const SUPPORT_CASE_RETENTION = { mode: 'account_lifetime', days: null };

export function supportCaseRetentionCutoff(now = Date.now()) {
  if (SUPPORT_CASE_RETENTION.mode === 'days' && SUPPORT_CASE_RETENTION.days) {
    return now - SUPPORT_CASE_RETENTION.days * 24 * 3600000;
  }
  return null; // account_lifetime: no time-based cutoff
}

// chat_messages was defined by the original FVAChat migration (0030)
// WITHOUT a sender_name column, but the team reply writers (the case desk
// and the per-session team chat) insert the agent's display name there.
// On any deployment whose chat_messages came from 0030 the column is
// missing, and every team reply died on that insert with a 500. Lazy
// self-heal, the same pattern the AI assistant settings use: attempt the
// ADD COLUMN once per isolate and swallow the duplicate-column error.
// Migration 0059 records the same change for console-applied databases.
let senderNameReady = false;
export async function ensureChatSenderName(db) {
  if (senderNameReady) return;
  senderNameReady = true;
  try {
    await db.prepare('ALTER TABLE chat_messages ADD COLUMN sender_name TEXT').run();
  } catch (e) { /* column already exists on this deployment */ }
}

export const CASE_STATUSES = ['open', 'resolved', 'closed'];
export const CASE_PRIORITIES = ['normal', 'high', 'urgent'];
export const CASE_CATEGORIES = ['billing', 'account', 'technical', 'other'];

let tablesReady = false;

export async function ensureCaseTables(db) {
  if (tablesReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS support_cases (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      site_id TEXT DEFAULT 'kopabook',
      business_id TEXT,
      business_name TEXT,
      user_id TEXT,
      client_name TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      category TEXT DEFAULT 'other',
      assigned_to TEXT,
      assigned_name TEXT,
      opened_at INTEGER,
      first_response_at INTEGER,
      last_activity INTEGER,
      status_changed_at INTEGER,
      status_changed_by TEXT,
      confirmed_at INTEGER,
      confirmed_by TEXT,
      reopen_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS support_case_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT,
      session_id TEXT,
      sender TEXT,
      sender_name TEXT,
      message TEXT,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS support_case_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT,
      session_id TEXT,
      event TEXT,
      actor_type TEXT,
      actor_name TEXT,
      actor_id TEXT,
      detail TEXT,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS support_case_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT,
      author_name TEXT,
      author_id TEXT,
      note TEXT,
      created_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_support_cases_biz_activity ON support_cases (business_id, last_activity DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_support_cases_status_activity ON support_cases (status, last_activity DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_support_cases_session ON support_cases (session_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_support_case_messages_case ON support_case_messages (case_id, id)`,
    `CREATE INDEX IF NOT EXISTS idx_support_case_events_case ON support_case_events (case_id, id)`,
    `CREATE INDEX IF NOT EXISTS idx_support_case_notes_case ON support_case_notes (case_id, id)`,
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run();
  }
  tablesReady = true;
}

// Best-effort auto category from the words a client actually uses. The
// team can override it at any time; this only saves them the obvious ones.
export function detectCaseCategory(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  if (/(bill|billed|billing|charge|charged|payment|paystack|subscription|subscribe|upgrade|downgrade|plan|price|pricing|invoice|refund|renew)/.test(t)) return 'billing';
  if (/(password|log ?in|sign ?in|sign ?up|register|account|email|profile|forgot|reset|locked out|verify)/.test(t)) return 'account';
  if (/(error|bug|broken|not working|does not work|won't|wont|can't|cannot|crash|freeze|frozen|slow|fail|failed|upload|download|sync)/.test(t)) return 'technical';
  return 'other';
}

export async function recordCaseEvent(db, kase, event, actor, detail) {
  try {
    await db.prepare(
      'INSERT INTO support_case_events (case_id, session_id, event, actor_type, actor_name, actor_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      kase.id, kase.session_id, event,
      (actor && actor.type) || 'system',
      (actor && actor.name) || '',
      (actor && actor.id) || '',
      detail || '',
      Date.now()
    ).run();
  } catch (e) { /* the audit trail is best effort; the case itself already saved */ }
}

export async function latestCaseForSession(db, sessionId) {
  await ensureCaseTables(db);
  return db.prepare(
    'SELECT * FROM support_cases WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(sessionId).first();
}

export async function getCaseById(db, caseId) {
  await ensureCaseTables(db);
  return db.prepare('SELECT * FROM support_cases WHERE id = ?').bind(caseId).first();
}

async function createCase(db, { sessionId, businessId, businessName, userId, clientName, firstMessageText }) {
  const now = Date.now();
  const id = 'case_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const category = detectCaseCategory(firstMessageText);
  const kase = {
    id, session_id: sessionId, site_id: 'kopabook',
    business_id: businessId != null ? String(businessId) : null,
    business_name: businessName || '',
    user_id: userId != null ? String(userId) : null,
    client_name: clientName || '',
    status: 'open', priority: 'normal', category,
    assigned_to: null, assigned_name: null,
    opened_at: now, first_response_at: null, last_activity: now,
    status_changed_at: now, status_changed_by: clientName || 'Client',
    confirmed_at: null, confirmed_by: null, reopen_count: 0,
    created_at: now, updated_at: now,
  };
  await db.prepare(
    `INSERT INTO support_cases (id, session_id, site_id, business_id, business_name, user_id, client_name,
       status, priority, category, assigned_to, assigned_name, opened_at, first_response_at, last_activity,
       status_changed_at, status_changed_by, confirmed_at, confirmed_by, reopen_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    kase.id, kase.session_id, kase.site_id, kase.business_id, kase.business_name, kase.user_id, kase.client_name,
    kase.status, kase.priority, kase.category, kase.assigned_to, kase.assigned_name, kase.opened_at,
    kase.first_response_at, kase.last_activity, kase.status_changed_at, kase.status_changed_by,
    kase.confirmed_at, kase.confirmed_by, kase.reopen_count, kase.created_at, kase.updated_at
  ).run();
  await recordCaseEvent(db, kase, 'opened', { type: 'client', name: clientName || '', id: kase.user_id }, 'category: ' + category);
  return kase;
}

// Find the case a new support message belongs to. An open case continues.
// A resolved or closed case does NOT silently resume: the new message
// opens a fresh case, and the old one stays readable in the history.
export async function caseForSupportMessage(db, opts) {
  await ensureCaseTables(db);
  const latest = await latestCaseForSession(db, opts.sessionId);
  if (latest && latest.status === 'open') return { kase: latest, created: false };
  const kase = await createCase(db, opts);
  return { kase, created: true };
}

export async function mirrorCaseMessage(db, kase, { sender, senderName, message, at }) {
  const ts = at || Date.now();
  await db.prepare(
    'INSERT INTO support_case_messages (case_id, session_id, sender, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(kase.id, kase.session_id, sender, senderName || null, String(message || '').slice(0, 2000), ts).run();
  if (sender === 'agent' && !kase.first_response_at) {
    await db.prepare(
      'UPDATE support_cases SET last_activity = ?, updated_at = ?, first_response_at = ? WHERE id = ?'
    ).bind(ts, ts, ts, kase.id).run();
    kase.first_response_at = ts;
  } else {
    await db.prepare(
      'UPDATE support_cases SET last_activity = ?, updated_at = ? WHERE id = ?'
    ).bind(ts, ts, kase.id).run();
  }
  kase.last_activity = ts;
  // Auto category: while a case is still 'other', an obvious later
  // message can classify it. The team can always override afterwards.
  if (sender === 'visitor' && kase.category === 'other') {
    const cat = detectCaseCategory(message);
    if (cat !== 'other') {
      await db.prepare('UPDATE support_cases SET category = ? WHERE id = ?').bind(cat, kase.id).run();
      kase.category = cat;
      await recordCaseEvent(db, kase, 'category', { type: 'system', name: 'Auto' }, 'other -> ' + cat);
    }
  }
}

// A human reply from the Chat Center lands in the session's current case.
// If that case was resolved or closed, a person replying means the case
// is being worked again, so it reopens with the change on the record.
export async function mirrorAgentReply(db, sessionId, { senderName, message, at }) {
  await ensureCaseTables(db);
  let kase = await latestCaseForSession(db, sessionId);
  if (!kase) return null;
  if (kase.status === 'resolved' || kase.status === 'closed') {
    kase = await setCaseStatus(db, kase, 'open', { type: 'team', name: senderName || 'FVA70K team' });
  }
  await mirrorCaseMessage(db, kase, { sender: 'agent', senderName, message, at });
  return kase;
}

// Closing a chat from the Chat Center closes its open support case too.
export async function closeCaseForSession(db, sessionId, actor) {
  await ensureCaseTables(db);
  const kase = await latestCaseForSession(db, sessionId);
  if (!kase || kase.status === 'closed') return kase;
  return setCaseStatus(db, kase, 'closed', actor || { type: 'team', name: 'FVA70K team' });
}

export async function setCaseStatus(db, kase, next, actor) {
  if (!CASE_STATUSES.includes(next)) throw new Error('Bad status');
  const now = Date.now();
  const event = next === 'open' ? 'reopened' : next;
  const reopenCount = next === 'open' ? Number(kase.reopen_count || 0) + 1 : Number(kase.reopen_count || 0);
  await db.prepare(
    `UPDATE support_cases SET status = ?, status_changed_at = ?, status_changed_by = ?,
       reopen_count = ?, confirmed_at = CASE WHEN ? = 'open' THEN NULL ELSE confirmed_at END,
       confirmed_by = CASE WHEN ? = 'open' THEN NULL ELSE confirmed_by END,
       last_activity = ?, updated_at = ? WHERE id = ?`
  ).bind(next, now, (actor && actor.name) || '', reopenCount, next, next, now, now, kase.id).run();
  const updated = { ...kase, status: next, status_changed_at: now, status_changed_by: (actor && actor.name) || '', reopen_count: reopenCount, last_activity: now, updated_at: now };
  if (next === 'open') { updated.confirmed_at = null; updated.confirmed_by = null; }
  await recordCaseEvent(db, updated, event, actor, 'was ' + kase.status);
  return updated;
}

// Client confirms the team really did resolve it. The status stays
// 'resolved'; the confirmation is its own stamp and audit event.
export async function confirmCaseResolved(db, kase, actor) {
  if (kase.status !== 'resolved') return { kase, changed: false, reason: 'not_resolved' };
  if (kase.confirmed_at && Number(kase.confirmed_at) >= Number(kase.status_changed_at || 0)) {
    return { kase, changed: false, reason: 'already_confirmed' };
  }
  const now = Date.now();
  await db.prepare(
    'UPDATE support_cases SET confirmed_at = ?, confirmed_by = ?, updated_at = ? WHERE id = ?'
  ).bind(now, (actor && actor.name) || '', now, kase.id).run();
  const updated = { ...kase, confirmed_at: now, confirmed_by: (actor && actor.name) || '' };
  await recordCaseEvent(db, updated, 'confirmed', actor, '');
  return { kase: updated, changed: true };
}

export async function assignCase(db, kase, { assignedTo, assignedName }, actor) {
  const now = Date.now();
  await db.prepare(
    'UPDATE support_cases SET assigned_to = ?, assigned_name = ?, updated_at = ? WHERE id = ?'
  ).bind(assignedTo || null, assignedName || null, now, kase.id).run();
  const updated = { ...kase, assigned_to: assignedTo || null, assigned_name: assignedName || null, updated_at: now };
  await recordCaseEvent(db, updated, 'assigned', actor, (kase.assigned_name || kase.assigned_to || 'Unassigned') + ' -> ' + (assignedName || assignedTo || 'Unassigned'));
  return updated;
}

export async function setCasePriority(db, kase, priority, actor) {
  if (!CASE_PRIORITIES.includes(priority)) throw new Error('Bad priority');
  const now = Date.now();
  await db.prepare('UPDATE support_cases SET priority = ?, updated_at = ? WHERE id = ?').bind(priority, now, kase.id).run();
  const updated = { ...kase, priority, updated_at: now };
  await recordCaseEvent(db, updated, 'priority', actor, (kase.priority || 'normal') + ' -> ' + priority);
  return updated;
}

export async function setCaseCategory(db, kase, category, actor) {
  if (!CASE_CATEGORIES.includes(category)) throw new Error('Bad category');
  const now = Date.now();
  await db.prepare('UPDATE support_cases SET category = ?, updated_at = ? WHERE id = ?').bind(category, now, kase.id).run();
  const updated = { ...kase, category, updated_at: now };
  await recordCaseEvent(db, updated, 'category', actor, (kase.category || 'other') + ' -> ' + category);
  return updated;
}

export async function addCaseNote(db, kase, { authorName, authorId, note }) {
  const now = Date.now();
  const r = await db.prepare(
    'INSERT INTO support_case_notes (case_id, author_name, author_id, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(kase.id, authorName || '', authorId || '', String(note || '').slice(0, 4000), now).run();
  return { id: r && r.meta ? r.meta.last_row_id : null, case_id: kase.id, author_name: authorName || '', note: String(note || '').slice(0, 4000), created_at: now };
}

// Cursor pagination on (last_activity, id), newest activity first. The
// cursor is opaque to clients: base64 of the last row's stamps.
export function encodeCursor(row) {
  return btoa(JSON.stringify({ a: row.last_activity, i: row.id })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const s = String(raw).replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(atob(s));
    if (o && typeof o.a === 'number' && o.i) return o;
  } catch (e) {}
  return null;
}

export async function listCases(db, { businessId, status, priority, category, assignedTo, search, cursor, limit } = {}) {
  await ensureCaseTables(db);
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const where = [];
  const params = [];
  if (businessId != null && businessId !== '') { where.push('c.business_id = ?'); params.push(String(businessId)); }
  if (status && CASE_STATUSES.includes(status)) { where.push('c.status = ?'); params.push(status); }
  if (priority && CASE_PRIORITIES.includes(priority)) { where.push('c.priority = ?'); params.push(priority); }
  if (category && CASE_CATEGORIES.includes(category)) { where.push('c.category = ?'); params.push(category); }
  if (assignedTo) { where.push('c.assigned_to = ?'); params.push(assignedTo); }
  if (search) { where.push('c.business_name LIKE ?'); params.push('%' + String(search).slice(0, 80) + '%'); }
  const cur = decodeCursor(cursor);
  if (cur) {
    where.push('(c.last_activity < ? OR (c.last_activity = ? AND c.id < ?))');
    params.push(cur.a, cur.a, cur.i);
  }
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM support_case_messages WHERE case_id = c.id) AS message_count,
      (SELECT message FROM support_case_messages WHERE case_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
    FROM support_cases c
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.last_activity DESC, c.id DESC
    LIMIT ?`;
  params.push(lim + 1);
  const r = await db.prepare(sql).bind(...params).all();
  const rows = r.results || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return { rows: page, nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null };
}

// Full case view. Internal notes are only included when the caller is the
// FVA70K side (includeInternal). Client callers must never receive notes,
// assignment, or priority, and the endpoint shapes its payload with
// clientCaseView / teamCaseView below rather than returning rows raw.
export async function getCaseDetail(db, caseId, { includeInternal = false, msgAfter = 0, msgLimit = 100 } = {}) {
  await ensureCaseTables(db);
  const kase = await getCaseById(db, caseId);
  if (!kase) return null;
  const lim = Math.min(Math.max(Number(msgLimit) || 100, 1), 200);
  const mr = await db.prepare(
    'SELECT id, sender, sender_name, message, created_at FROM support_case_messages WHERE case_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
  ).bind(caseId, Number(msgAfter) || 0, lim + 1).all();
  const mrows = mr.results || [];
  const mHasMore = mrows.length > lim;
  const messages = mHasMore ? mrows.slice(0, lim) : mrows;
  const er = await db.prepare(
    'SELECT id, event, actor_type, actor_name, detail, created_at FROM support_case_events WHERE case_id = ? ORDER BY id ASC LIMIT 300'
  ).bind(caseId).all();
  const detail = {
    kase,
    messages,
    nextMsgAfter: mHasMore && messages.length ? messages[messages.length - 1].id : null,
    events: er.results || [],
  };
  if (includeInternal) {
    const nr = await db.prepare(
      'SELECT id, author_name, note, created_at FROM support_case_notes WHERE case_id = ? ORDER BY id ASC LIMIT 300'
    ).bind(caseId).all();
    detail.notes = nr.results || [];
  }
  return detail;
}

// What the business (client) may see. Deliberately excludes assigned_to,
// assigned_name, priority, user internals and all notes.
export function clientCaseView(row) {
  return {
    id: row.id,
    status: row.status,
    category: row.category,
    opened_at: row.opened_at,
    last_activity: row.last_activity,
    status_changed_at: row.status_changed_at,
    status_changed_by: row.status_changed_by,
    confirmed_at: row.confirmed_at,
    reopen_count: Number(row.reopen_count || 0),
    message_count: row.message_count != null ? Number(row.message_count) : undefined,
    last_message: row.last_message != null ? String(row.last_message).slice(0, 160) : undefined,
  };
}

export function clientEventView(e) {
  return {
    event: e.event,
    actor_type: e.actor_type,
    actor_name: e.actor_type === 'client' ? (e.actor_name || 'You') : (e.actor_name || ''),
    created_at: e.created_at,
  };
}

// What the FVA70K team may see: everything, including assignment,
// priority, activity stamps and (in detail) internal notes.
export function teamCaseView(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    business_id: row.business_id,
    business_name: row.business_name,
    client_name: row.client_name,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assigned_to: row.assigned_to,
    assigned_name: row.assigned_name,
    opened_at: row.opened_at,
    first_response_at: row.first_response_at,
    last_activity: row.last_activity,
    status_changed_at: row.status_changed_at,
    status_changed_by: row.status_changed_by,
    confirmed_at: row.confirmed_at,
    confirmed_by: row.confirmed_by,
    reopen_count: Number(row.reopen_count || 0),
    awaiting_first_response: !row.first_response_at && row.status === 'open',
    message_count: row.message_count != null ? Number(row.message_count) : undefined,
    last_message: row.last_message != null ? String(row.last_message).slice(0, 160) : undefined,
  };
}

// Staff the team can assign cases to: the Chat Center staff list when it
// exists in this database, else the platform admin users.
export async function listAssignableStaff(db) {
  try {
    const r = await db.prepare(
      "SELECT email FROM chat_center_staff WHERE COALESCE(status, 'active') = 'active' ORDER BY email ASC LIMIT 100"
    ).all();
    const rows = (r.results || []).filter((x) => x.email);
    if (rows.length) return rows.map((x) => ({ email: x.email, name: x.email }));
  } catch (e) { /* table lives with the centre; fall through */ }
  try {
    const r = await db.prepare(
      'SELECT full_name, email FROM users WHERE is_platform_admin = 1 ORDER BY full_name ASC LIMIT 100'
    ).all();
    return (r.results || []).filter((x) => x.email).map((x) => ({ email: x.email, name: x.full_name || x.email }));
  } catch (e) {
    return [];
  }
}
