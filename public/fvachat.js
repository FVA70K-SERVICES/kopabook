/* FVAChat widget v2 - Full-featured live chat by FVA70K Services */
(function() {
  const scriptTag = document.currentScript;
  const SITE_ID = (scriptTag && scriptTag.getAttribute('data-site-id')) || window.FVAChatSiteId || 'fva70k-main';
  const API_BASE = (scriptTag && scriptTag.getAttribute('data-api')) || window.FVAChatAPI || '';
  const API = API_BASE + '/api/chat';
  const BUSINESS_NAME = (scriptTag && scriptTag.getAttribute('data-business')) || window.FVAChatBusiness || 'FVA70K Support';
  const BOT_NAME = (scriptTag && scriptTag.getAttribute('data-bot-name')) || 'FVA Bot';
  const ACCENT = (scriptTag && scriptTag.getAttribute('data-color')) || '#1a6b3c';

  let sessionId = localStorage.getItem('fva_chat_session_' + SITE_ID);
  let visitorName = localStorage.getItem('fva_chat_name') || '';
  let visitorEmail = localStorage.getItem('fva_chat_email') || '';
  let lastMsgId = 0;
  let pollTimer = null;
  let isOpen = false;
  let unread = 0;
  let soundOn = localStorage.getItem('fva_chat_sound') !== 'off';
  let rated = false;
  let proactiveShown = sessionStorage.getItem('fva_proactive_' + SITE_ID) === '1';

  const EMOJIS = ['😀','😁','😂','🤣','😊','😍','👍','👏','🙏','❤️','🔥','✅','❌','👋','🎉','💯','🤔','😢','😮','👀'];

  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = (API_BASE || '') + '/fvachat.css';
  document.head.appendChild(link);

  // Sound: simple beep via Web Audio
  let audioCtx = null;
  function playSound() {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.15, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      o.start(); o.stop(audioCtx.currentTime + 0.3);
    } catch (e) {}
  }

  // Build widget
  const btn = document.createElement('button');
  btn.id = 'fva-chat-btn';
  btn.innerHTML = '💬<span id="fva-chat-badge">0</span>';
  btn.setAttribute('aria-label', 'Open live chat');
  document.body.appendChild(btn);

  const win = document.createElement('div');
  win.id = 'fva-chat-window';
  win.innerHTML =
    '<div id="fva-chat-header">' +
      '<div><div class="title">' + escapeHtml(BUSINESS_NAME) + '</div>' +
      '<div class="status"><span class="dot"></span><span id="fva-chat-status">Online</span></div></div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<button id="fva-chat-sound" aria-label="Toggle sound" title="Sound on/off" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;">🔔</button>' +
        '<button id="fva-chat-menu" aria-label="Chat options" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;">⋮</button>' +
        '<button id="fva-chat-close" aria-label="Close chat">×</button>' +
      '</div>' +
    '</div>' +
    '<div id="fva-chat-menu-dropdown" style="display:none;">' +
      '<button data-action="transcript">📧 Email transcript</button>' +
      '<button data-action="end">🔚 End chat</button>' +
      '<button data-action="whatsapp">💬 Switch to WhatsApp</button>' +
    '</div>' +
    '<div id="fva-chat-body" style="display:flex;flex-direction:column;flex:1;min-height:0;"></div>';
  document.body.appendChild(win);
  const body = win.querySelector('#fva-chat-body');

  // Proactive invite bubble
  const invite = document.createElement('div');
  invite.id = 'fva-chat-invite';
  invite.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">👋 Need help?</div><div style="font-size:13px;">' + escapeHtml(BOT_NAME) + ' is here to answer your questions!</div><button id="fva-invite-go">Chat now</button><button id="fva-invite-no">×</button>';
  invite.style.display = 'none';
  document.body.appendChild(invite);

  btn.addEventListener('click', () => { isOpen ? closeChat() : openChat(); });
  win.querySelector('#fva-chat-close').addEventListener('click', closeChat);
  win.querySelector('#fva-chat-sound').addEventListener('click', toggleSound);
  win.querySelector('#fva-chat-menu').addEventListener('click', toggleMenu);
  win.querySelectorAll('#fva-chat-menu-dropdown button').forEach(b => {
    b.addEventListener('click', () => handleMenuAction(b.getAttribute('data-action')));
  });

  invite.querySelector('#fva-invite-go').addEventListener('click', () => { invite.style.display = 'none'; openChat(); });
  invite.querySelector('#fva-invite-no').addEventListener('click', () => { invite.style.display = 'none'; });

  function toggleSound() {
    soundOn = !soundOn;
    localStorage.setItem('fva_chat_sound', soundOn ? 'on' : 'off');
    win.querySelector('#fva-chat-sound').textContent = soundOn ? '🔔' : '🔕';
  }
  if (!soundOn) win.querySelector('#fva-chat-sound').textContent = '🔕';

  function toggleMenu() {
    const dd = win.querySelector('#fva-chat-menu-dropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  }

  function handleMenuAction(action) {
    win.querySelector('#fva-chat-menu-dropdown').style.display = 'none';
    if (action === 'transcript') emailTranscript();
    else if (action === 'end') endChat();
    else if (action === 'whatsapp') window.open('https://wa.me/2348130244617', '_blank');
  }

  function openChat() {
    isOpen = true;
    win.classList.add('open');
    btn.innerHTML = '×<span id="fva-chat-badge">0</span>';
    unread = 0; updateBadge();
    invite.style.display = 'none';
    if (!sessionId) { showNamePrompt(); }
    else { showChatUI(); startPolling(); }
  }

  function closeChat() {
    isOpen = false;
    win.classList.remove('open');
    btn.innerHTML = '💬<span id="fva-chat-badge">0</span>';
    updateBadge();
    stopPolling();
  }

  function showNamePrompt() {
    body.innerHTML =
      '<div id="fva-chat-name-prompt">' +
        '<div style="font-size:40px;">👋</div>' +
        '<h3 style="margin:8px 0;">Hi there!</h3>' +
        '<p style="color:#666;font-size:14px;">What should we call you?</p>' +
        '<input type="text" id="fva-name-input" placeholder="Your name" maxlength="60" value="' + escapeHtml(visitorName) + '">' +
        '<input type="email" id="fva-email-input" placeholder="Email (for transcript)" maxlength="120" value="' + escapeHtml(visitorEmail) + '" style="margin-top:8px;">' +
        '<button class="btn btn-primary" id="fva-name-go" style="width:100%;">Start Chat</button>' +
        '<p style="margin-top:16px;font-size:13px;"><a href="https://wa.me/2348130244617" target="_blank" style="color:var(--brand);">Prefer WhatsApp? Chat there →</a></p>' +
      '</div>';
    const nameInput = body.querySelector('#fva-name-input');
    const emailInput = body.querySelector('#fva-email-input');
    const go = () => {
      visitorName = nameInput.value.trim() || 'Visitor';
      visitorEmail = emailInput.value.trim();
      localStorage.setItem('fva_chat_name', visitorName);
      localStorage.setItem('fva_chat_email', visitorEmail);
      startSession();
    };
    body.querySelector('#fva-name-go').addEventListener('click', go);
    nameInput.addEventListener('keypress', e => { if (e.key === 'Enter') go(); });
    nameInput.focus();
  }

  async function startSession() {
    try {
      const res = await fetch(API + '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: visitorName, siteId: SITE_ID,
          page: window.location.href,
          userAgent: navigator.userAgent.slice(0, 200)
        })
      });
      const data = await res.json();
      sessionId = data.sessionId;
      localStorage.setItem('fva_chat_session_' + SITE_ID, sessionId);
      lastMsgId = 0; rated = false;
      showChatUI();
      startPolling();
    } catch (e) {
      body.innerHTML = '<div id="fva-chat-name-prompt"><p>Could not start chat. <a href="https://wa.me/2348130244617" target="_blank">Chat on WhatsApp instead →</a></p></div>';
    }
  }

  function showChatUI() {
    body.innerHTML =
      '<div id="fva-chat-messages"></div>' +
      '<div id="fva-typing">Someone is typing...</div>' +
      '<div id="fva-chat-quick"></div>' +
      '<div id="fva-emoji-picker" style="display:none;">' +
        EMOJIS.map(e => '<button class="fva-emoji">' + e + '</button>').join('') +
      '</div>' +
      '<div id="fva-chat-input-area">' +
        '<button id="fva-emoji-btn" aria-label="Emoji">😀</button>' +
        '<input type="text" id="fva-chat-input" placeholder="Type a message..." maxlength="2000">' +
        '<button id="fva-chat-send" aria-label="Send">➤</button>' +
      '</div>' +
      '<div id="fva-chat-rating" style="display:none;">' +
        '<p>How was your chat?</p><div id="fva-stars">' +
        [1,2,3,4,5].map(i => '<button class="fva-star" data-v="' + i + '">⭐</button>').join('') +
        '</div></div>';
    const input = body.querySelector('#fva-chat-input');
    const sendBtn = body.querySelector('#fva-chat-send');
    const emojiBtn = body.querySelector('#fva-emoji-btn');
    const emojiPicker = body.querySelector('#fva-emoji-picker');

    emojiBtn.addEventListener('click', () => {
      emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
    });
    emojiPicker.querySelectorAll('.fva-emoji').forEach(b => {
      b.addEventListener('click', () => { input.value += b.textContent; input.focus(); });
    });

    body.querySelectorAll('.fva-star').forEach(s => {
      s.addEventListener('click', () => submitRating(parseInt(s.getAttribute('data-v'))));
    });

    const trySend = () => { const t = input.value.trim(); if (t) { sendMessage(t); input.value = ''; emojiPicker.style.display = 'none'; } };
    sendBtn.addEventListener('click', trySend);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') trySend(); });

    let typingTimeout;
    input.addEventListener('input', () => {
      sendTyping(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => sendTyping(false), 2000);
    });

    loadHistory();
    poll();
  }

  // Load full chat history on open
  async function loadHistory() {
    if (!sessionId) return;
    try {
      const res = await fetch(API + '/poll?sessionId=' + sessionId + '&since=0');
      const data = await res.json();
      (data.messages || []).forEach(m => {
        if (m.id > lastMsgId) {
          lastMsgId = m.id;
          appendMsg(m.sender, m.message, m.created_at, null, true);
        }
      });
      // Scroll to bottom
      const msgs = body.querySelector('.fva-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    } catch (e) {}
  }

  function sendTyping(typing) {
    if (!sessionId) return;
    fetch(API + '/typing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, who: 'visitor', typing }) }).catch(() => {});
  }

  // Owner context: set by host page if user is logged in as owner/staff
  // window.FVAChatOwner = { businessId, userId, userName, userRole }
  function getOwnerCtx() {
    try {
      if (window.FVAChatOwner && window.FVAChatOwner.businessId && window.FVAChatOwner.userId) {
        return window.FVAChatOwner;
      }
    } catch (e) {}
    return null;
  }

  async function sendMessage(text) {
    const msgId = 'local_' + Date.now();
    appendMsg('visitor', text, Date.now(), msgId, false);
    showBotTyping();
    try {
      const payload = { sessionId, sender: 'visitor', message: text, siteId: SITE_ID };
      const ownerCtx = getOwnerCtx();
      if (ownerCtx) payload.ownerCtx = ownerCtx;
      const res = await fetch(API + '/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      hideBotTyping();
      // Mark our message as read when bot replies (bot saw it)
      if (data.ok) markRead(msgId);
      if (data.botReply && data.botReply.quickReplies && data.botReply.quickReplies.length) {
        showQuickReplies(data.botReply.quickReplies);
      }
      // Handle action buttons (e.g. WhatsApp order link)
      if (data.botReply && data.botReply.action) {
        showActionButton(data.botReply.action);
      }
    } catch (e) { hideBotTyping(); }
  }

  function markRead(localId) {
    const el = body.querySelector('[data-local-id="' + localId + '"] .read-receipt');
    if (el) { el.textContent = '✓✓'; el.classList.add('read'); }
  }

  function showBotTyping() {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap || body.querySelector('#fva-bot-typing')) return;
    const div = document.createElement('div');
    div.id = 'fva-bot-typing';
    div.className = 'fva-msg bot typing';
    div.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function hideBotTyping() {
    const el = body.querySelector('#fva-bot-typing');
    if (el) el.remove();
  }

  function showQuickReplies(replies) {
    const qr = body.querySelector('#fva-chat-quick');
    if (!qr) return;
    qr.innerHTML = replies.map(r => '<button class="fva-quick-btn">' + escapeHtml(r) + '</button>').join('');
    qr.querySelectorAll('.fva-quick-btn').forEach(b => {
      b.addEventListener('click', () => sendMessage(b.textContent));
    });
  }

  function showActionButton(action) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-action-wrap';
    div.innerHTML = '<a href="' + escapeHtml(action.url) + '" target="_blank" class="fva-action-btn">' + escapeHtml(action.label) + '</a>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function appendMsg(sender, text, at, localId, isRead) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-msg ' + sender;
    if (localId) div.setAttribute('data-local-id', localId);
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let html = escapeHtml(text) + '<div class="time">' + time;
    if (sender === 'visitor') {
      html += ' <span class="read-receipt' + (isRead ? ' read' : '') + '">' + (isRead ? '✓✓' : '✓') + '</span>';
    }
    html += '</div>';
    div.innerHTML = html;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function appendBotMsg(text, at) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-msg bot';
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = '<div class="bot-label">🤖 ' + escapeHtml(BOT_NAME) + '</div>' + escapeHtml(text) + '<div class="time">' + time + '</div>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function startPolling() { stopPolling(); pollTimer = setInterval(poll, 3000); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  async function poll() {
    if (!sessionId) return;
    try {
      const res = await fetch(API + '/poll?sessionId=' + sessionId + '&since=' + lastMsgId);
      const data = await res.json();
      const typingEl = body.querySelector('#fva-typing');
      if (typingEl) typingEl.classList.toggle('show', !!data.agentTyping);

      // Update online status
      const statusEl = document.getElementById('fva-chat-status');
      if (statusEl && data.agentsOnline !== undefined) {
        statusEl.textContent = data.agentsOnline ? 'Online' : 'Away - ' + BOT_NAME + ' will help';
      }

      (data.messages || []).forEach(m => {
        if (m.id > lastMsgId) {
          lastMsgId = m.id;
          hideBotTyping();
          const existing = body.querySelectorAll('.fva-msg.visitor');
          if (m.sender === 'visitor' && existing.length) {
            const lastV = existing[existing.length - 1];
            if (lastV && lastV.textContent.includes(m.message.slice(0, 20))) {
              // Mark as read
              const rr = lastV.querySelector('.read-receipt');
              if (rr) { rr.textContent = '✓✓'; rr.classList.add('read'); }
              return;
            }
          }
          if (m.sender === 'bot') appendBotMsg(m.message, m.created_at);
          else appendMsg(m.sender, m.message, m.created_at, null, m.sender === 'visitor' ? !!m.read_by_agent : false);

          if ((m.sender === 'agent' || m.sender === 'bot') && m.sender !== 'visitor') {
            playSound();
            if (!isOpen) { unread++; updateBadge(); notify(m.message); }
          }
        }
      });

      if (data.status === 'closed' && !rated) showRating();
    } catch (e) {}
  }

  function showRating() {
    const r = body.querySelector('#fva-chat-rating');
    if (r) r.style.display = 'block';
  }

  async function submitRating(value) {
    rated = true;
    try {
      await fetch(API + '/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, rating: value })
      });
    } catch (e) {}
    const r = body.querySelector('#fva-chat-rating');
    if (r) r.innerHTML = '<p>Thanks for your feedback! 🙏</p>';
  }

  async function emailTranscript() {
    const email = visitorEmail || prompt('Enter your email to receive the chat transcript:');
    if (!email) return;
    try {
      await fetch(API + '/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email })
      });
      alert('Transcript sent to ' + email);
    } catch (e) { alert('Could not send transcript.'); }
  }

  async function endChat() {
    if (!confirm('End this chat?')) return;
    try {
      await fetch(API + '/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (e) {}
    showRating();
    const inputArea = body.querySelector('#fva-chat-input-area');
    if (inputArea) inputArea.style.display = 'none';
  }

  function updateBadge() {
    const badge = document.getElementById('fva-chat-badge');
    if (badge) { badge.textContent = unread; badge.classList.toggle('show', unread > 0); }
  }

  function notify(text) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(BUSINESS_NAME, { body: text.slice(0, 100) });
    }
  }
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 5000);
  }

  // Proactive invite: show after 30s if visitor hasn't chatted
  if (!proactiveShown && !sessionId) {
    setTimeout(() => {
      if (!isOpen && !sessionId) {
        invite.style.display = 'block';
        sessionStorage.setItem('fva_proactive_' + SITE_ID, '1');
        playSound();
      }
    }, 30000);
  }

  // Expose API for programmatic control
  window.FVAChat = {
    open: openChat,
    close: closeChat,
    send: sendMessage,
  };
})();
