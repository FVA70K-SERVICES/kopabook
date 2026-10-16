// POST /api/chat/transcript - email chat transcript to visitor (for real)
import { sendMail } from '../_mail.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function onRequestPost({ request, env }) {
  try {
    const { sessionId, email } = await request.json();
    const to = String(email || '').trim();
    if (!sessionId || !to || !to.includes('@')) {
      return Response.json({ error: 'Valid sessionId and email required' }, { status: 400 });
    }

    // Get messages
    const msgs = await env.KOPABOOK_DB.prepare(
      'SELECT sender, message, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
    ).bind(sessionId).all();

    const session = await env.KOPABOOK_DB.prepare(
      'SELECT visitor_name, site_id FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

    if (!msgs.results.length) {
      return Response.json({ error: 'No messages found' }, { status: 404 });
    }

    const visitorName = session?.visitor_name || 'Visitor';
    const dateStr = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });

    // Build transcript rows
    let rowsHtml = '';
    let textBody = `Chat transcript - ${dateStr}\nVisitor: ${visitorName}\n\n`;
    for (const m of msgs.results) {
      const who = m.sender === 'visitor' ? visitorName :
                  m.sender === 'bot' ? 'Kopa Bot' : 'Support Agent';
      const time = new Date(m.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
      rowsHtml += `<tr><td style="color:#888;font-size:12px;white-space:nowrap;vertical-align:top;padding:6px 8px 6px 0;">${escapeHtml(time)}</td><td style="padding:6px 0;"><strong>${escapeHtml(who)}:</strong> ${escapeHtml(m.message)}</td></tr>`;
      textBody += `[${time}] ${who}: ${m.message}\n`;
    }

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <div style="background:#14532d;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;">KopaBook chat transcript</h2>
        <p style="margin:6px 0 0;opacity:.85;">${escapeHtml(dateStr)} - ${escapeHtml(visitorName)}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fff;padding:10px;">${rowsHtml}</table>
      <p style="font-size:12px;color:#888;">Sent from KopaBook Support. Questions? Reply to info@kopabook.com or WhatsApp +234 813 024 4617.</p>
    </body></html>`;

    // Actually send it (throws if email is not configured)
    await sendMail(env, {
      to,
      subject: `Your KopaBook chat transcript (${dateStr})`,
      html,
      text: textBody,
    });

    return Response.json({ ok: true, sent: true });
  } catch (e) {
    return Response.json({ error: 'Could not send the transcript email. Please try again later.' }, { status: 500 });
  }
}
