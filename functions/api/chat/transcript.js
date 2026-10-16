// POST /api/chat/transcript - email chat transcript to visitor
export async function onRequestPost({ request, env }) {
  try {
    const { sessionId, email } = await request.json();
    if (!sessionId || !email || !email.includes('@')) {
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

    // Build transcript text
    let transcript = `Chat Transcript\n`;
    transcript += `Date: ${new Date().toLocaleDateString()}\n`;
    transcript += `Visitor: ${session?.visitor_name || 'Visitor'}\n\n`;
    transcript += '---\n\n';
    for (const m of msgs.results) {
      const who = m.sender === 'visitor' ? (session?.visitor_name || 'Visitor') :
                  m.sender === 'bot' ? 'FVA Bot' : 'Support Agent';
      const time = new Date(m.created_at).toLocaleTimeString();
      transcript += `[${time}] ${who}: ${m.message}\n`;
    }
    transcript += '\n---\nPowered by FVAChat - FVA70K Services';

    // Send via FVAMail if configured
    if (env.ZOHO_CLIENT_ID && env.MAIL_FROM) {
      // TODO: Call FVAMail send API internally
      // For now, return the transcript for manual sending
    }

    // Return transcript (frontend can also display it)
    // In production, this would send via the configured email backend
    return Response.json({
      ok: true,
      queued: false,
      note: 'Email sending via FVAMail - configure ZOHO credentials for auto-send',
      transcript: transcript.slice(0, 5000)
    });
  } catch (e) {
    return Response.json({ error: 'Failed to generate transcript' }, { status: 500 });
  }
}
