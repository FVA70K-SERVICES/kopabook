// Bot Reminders + Routines - never miss or forget
// Handles "remind me to..." and daily/monthly autopilot

export async function handleReminderCommand(message, ctx) {
  const { db, businessId, userId, userName } = ctx;
  const lower = message.toLowerCase().trim();

  // "remind me to call supplier tomorrow at 9am"
  // "remind me to restock rice every monday"
  // "remind me in 2 hours to check delivery"
  const remindMatch = lower.match(/remind me to (.+?)(?:\s+(tomorrow|today|in \d+ (?:hours?|minutes?|days?)|every (?:day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|at \d+(?::\d+)?\s*(?:am|pm)?))?\s*$/);

  if (lower.startsWith('remind me')) {
    const taskText = remindMatch ? remindMatch[1].trim() : lower.replace('remind me to', '').replace('remind me', '').trim();
    const timeSpec = remindMatch ? remindMatch[2] : null;

    if (!taskText) {
      return { answer: `What should I remind you about? Say "remind me to call the supplier tomorrow at 9am".` };
    }

    const { remindAt, repeatType } = parseTimeSpec(timeSpec);

    const id = 'rem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.prepare(`
      INSERT INTO bot_reminders (id, business_id, user_id, title, remind_at, repeat_type, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).bind(id, businessId, userId, taskText, remindAt.toISOString(), repeatType).run();

    const when = formatRemindTime(remindAt, repeatType);
    return {
      answer: `Got it! I will remind you to "${taskText}" ${when}. I never forget.`,
      quickReplies: ['My reminders', 'Brief me']
    };
  }

  // "my reminders" / "list reminders"
  if (lower.match(/^(my reminders|list reminders|reminders|what.*remind)/)) {
    const r = await db.prepare(`
      SELECT * FROM bot_reminders
      WHERE business_id = ? AND status = 'pending'
      ORDER BY remind_at ASC LIMIT 10
    `).bind(businessId).all();

    const reminders = r.results || [];
    if (reminders.length === 0) {
      return { answer: `You have no pending reminders. Say "remind me to..." and I will handle it.`, quickReplies: ['Brief me'] };
    }

    let msg = `Your reminders:\n\n`;
    reminders.forEach((rem, i) => {
      const d = new Date(rem.remind_at);
      msg += `${i + 1}. ${rem.title}\n   ${d.toLocaleString()}${rem.repeat_type !== 'once' ? ` (repeats ${rem.repeat_type})` : ''}\n`;
      msg += `   [Cancel: "cancel reminder ${i + 1}"]\n\n`;
    });
    return { answer: msg, quickReplies: ['Brief me'] };
  }

  // "cancel reminder 1"
  const cancelMatch = lower.match(/cancel reminder (\d+)/);
  if (cancelMatch) {
    const idx = parseInt(cancelMatch[1]) - 1;
    const r = await db.prepare(`
      SELECT * FROM bot_reminders
      WHERE business_id = ? AND status = 'pending'
      ORDER BY remind_at ASC LIMIT 10
    `).bind(businessId).all();
    const reminders = r.results || [];
    if (reminders[idx]) {
      await db.prepare(`UPDATE bot_reminders SET status = 'cancelled' WHERE id = ?`).bind(reminders[idx].id).run();
      return { answer: `Cancelled: "${reminders[idx].title}"`, quickReplies: ['My reminders'] };
    }
    return { answer: `I could not find that reminder.` };
  }

  return null;
}

function parseTimeSpec(spec) {
  const now = new Date();
  let remindAt = new Date(now);
  let repeatType = 'once';

  if (!spec) {
    remindAt.setHours(remindAt.getHours() + 1); // default: 1 hour
    return { remindAt, repeatType };
  }

  const s = spec.toLowerCase();

  if (s === 'tomorrow') {
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(9, 0, 0, 0);
  } else if (s === 'today') {
    remindAt.setHours(18, 0, 0, 0);
  } else if (s.match(/in (\d+) hours?/)) {
    remindAt.setHours(remindAt.getHours() + parseInt(s.match(/in (\d+) hours?/)[1]));
  } else if (s.match(/in (\d+) minutes?/)) {
    remindAt.setMinutes(remindAt.getMinutes() + parseInt(s.match(/in (\d+) minutes?/)[1]));
  } else if (s.match(/in (\d+) days?/)) {
    remindAt.setDate(remindAt.getDate() + parseInt(s.match(/in (\d+) days?/)[1]));
  } else if (s.match(/every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/)) {
    const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const target = days[s.match(/every (\w+)/)[1]];
    const diff = (target - now.getDay() + 7) % 7 || 7;
    remindAt.setDate(remindAt.getDate() + diff);
    remindAt.setHours(9, 0, 0, 0);
    repeatType = 'weekly';
  } else if (s === 'every day') {
    remindAt.setDate(remindAt.getDate() + 1);
    remindAt.setHours(9, 0, 0, 0);
    repeatType = 'daily';
  } else if (s === 'every week') {
    remindAt.setDate(remindAt.getDate() + 7);
    remindAt.setHours(9, 0, 0, 0);
    repeatType = 'weekly';
  } else if (s === 'every month') {
    remindAt.setMonth(remindAt.getMonth() + 1);
    remindAt.setHours(9, 0, 0, 0);
    repeatType = 'monthly';
  } else if (s.match(/at (\d+)(?::(\d+))?\s*(am|pm)?/)) {
    const m = s.match(/at (\d+)(?::(\d+))?\s*(am|pm)?/);
    let h = parseInt(m[1]);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    remindAt.setHours(h, parseInt(m[2] || 0), 0, 0);
    if (remindAt < now) remindAt.setDate(remindAt.getDate() + 1);
  }

  return { remindAt, repeatType };
}

function formatRemindTime(date, repeat) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let when;
  if (date.toDateString() === now.toDateString()) {
    when = 'today at ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (date.toDateString() === tomorrow.toDateString()) {
    when = 'tomorrow at ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else {
    when = 'on ' + date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (repeat !== 'once') when += ` (repeats ${repeat})`;
  return when;
}

// Check for due reminders (called by cron or on chat open)
export async function checkDueReminders(db, businessId) {
  try {
    const now = new Date().toISOString();
    const r = await db.prepare(`
      SELECT * FROM bot_reminders
      WHERE business_id = ? AND status = 'pending' AND remind_at <= ?
      ORDER BY remind_at ASC
    `).bind(businessId, now).all();

    const due = r.results || [];

    // Mark as sent and reschedule repeating ones
    for (const rem of due) {
      if (rem.repeat_type === 'once') {
        await db.prepare(`UPDATE bot_reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).bind(rem.id).run();
      } else {
        // Reschedule
        const next = new Date(rem.remind_at);
        if (rem.repeat_type === 'daily') next.setDate(next.getDate() + 1);
        if (rem.repeat_type === 'weekly') next.setDate(next.getDate() + 7);
        if (rem.repeat_type === 'monthly') next.setMonth(next.getMonth() + 1);
        await db.prepare(
          `UPDATE bot_reminders SET remind_at = ?, sent_at = datetime('now') WHERE id = ?`
        ).bind(next.toISOString(), rem.id).run();
      }
    }

    return due;
  } catch { return []; }
}
