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

  // Merged in-app chat (KopaBook only): one thread, two doors.
  // 'ai' = Ask Kopa AI (the shop's AI assistant), 'support' = Kopa Support
  // (platform help from the FVA70K team). Signed-out visitors never see this.
  const IS_KOPABOOK = SITE_ID === 'kopabook';
  let chatMode = '';
  try { chatMode = localStorage.getItem('fva_chat_mode_kopabook') || ''; } catch (e) {}
  if (chatMode !== 'ai' && chatMode !== 'support') chatMode = '';
  let supportState = null;
  let doorPickerShown = false;

  function routeSide() {
    const p = window.location.pathname;
    if (p === '/app/chat/ai') return 'ai';
    if (p === '/app/chat/support') return 'support';
    if (p === '/app/chat') return 'home';
    return null;
  }
  function chatRouteFor(mode) {
    return mode === 'ai' ? '/app/chat/ai' : mode === 'support' ? '/app/chat/support' : '/app/chat';
  }
  function modeName(mode) { return mode === 'ai' ? 'Ask Kopa AI' : 'Kopa Support'; }
  function botLabel() {
    if (IS_KOPABOOK && isOwnerMode()) return chatMode === 'ai' ? 'Kopa AI' : 'Kopa Bot';
    return BOT_NAME;
  }
  function navigateChatRoute(mode) {
    const target = chatRouteFor(mode);
    if (window.location.pathname !== target) { window.location.href = target; return true; }
    return false;
  }

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
      '<div><div class="title" id="fva-chat-title">' + escapeHtml(BUSINESS_NAME) + '</div>' +
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

  btn.addEventListener('click', () => {
    if (isOpen) { closeChat(); return; }
    // In the signed-in app, the chat button routes to the merged chat home
    // (the two doors) unless we are already on a chat route.
    if (IS_KOPABOOK && isOwnerMode() && !routeSide()) { navigateChatRoute('home'); return; }
    openChat();
  });
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

  function openChat(requestedMode) {
    if (IS_KOPABOOK && isOwnerMode()) {
      const side = routeSide();
      if (requestedMode === 'ai' || requestedMode === 'support') setChatMode(requestedMode, true);
      else if (side === 'ai' || side === 'support') setChatMode(side, true);
    }
    isOpen = true;
    win.classList.add('open');
    btn.innerHTML = '×<span id="fva-chat-badge">0</span>';
    unread = 0; updateBadge();
    invite.style.display = 'none';
    if (!sessionId) {
      // Signed-in owners never see the public name prompt: the server
      // already knows who they are.
      if (IS_KOPABOOK && isOwnerMode()) { startSession(); }
      else { showNamePrompt(); }
    }
    else { showChatUI(); startPolling(); }
  }

  function setChatMode(mode, silent) {
    if (mode !== 'ai' && mode !== 'support') return;
    chatMode = mode;
    try { localStorage.setItem('fva_chat_mode_kopabook', mode); } catch (e) {}
    updateHeaderPersona();
    renderModeTabs();
    if (!silent) {
      appendModeNote('You are now talking to ' + modeName(mode) + '. Your conversation stays here.');
      showInitialQuickReplies();
    }
  }

  function switchMode(mode) {
    if (!IS_KOPABOOK || !isOwnerMode()) return;
    if (mode === chatMode) return;
    setChatMode(mode, false);
    // Keep the address bar on the clean route for the active side.
    const target = chatRouteFor(mode);
    if (routeSide() && window.location.pathname !== target) {
      try { window.history.pushState({}, '', target); } catch (e) {}
    }
    const dp = body.querySelector('#fva-door-picker');
    if (dp) dp.style.display = 'none';
  }

  function updateHeaderPersona() {
    const title = win.querySelector('#fva-chat-title');
    const status = win.querySelector('#fva-chat-status');
    if (!title) return;
    if (IS_KOPABOOK && isOwnerMode()) {
      title.textContent = chatMode ? modeName(chatMode) : 'Chat';
      if (status) {
        status.textContent = chatMode === 'ai'
          ? 'Your shop assistant, automated'
          : chatMode === 'support' ? supportStatusText() : 'Choose a side to start';
      }
    } else {
      title.textContent = BUSINESS_NAME;
    }
  }

  function supportStatusText() {
    if (!supportState) return 'Kopa Bot is answering';
    if (supportState.agentName && (supportState.handledBy === 'human' || supportState.assignedTo)) {
      return supportState.agentName + ' from the KopaBook team has joined';
    }
    if (supportState.handledBy === 'human' || supportState.assignedTo) {
      return 'A person from the KopaBook team has joined';
    }
    if (supportState.needsHuman) return 'Waiting for a human from the KopaBook team';
    if (supportState.status === 'closed') return 'Kopa Bot is answering';
    return 'Kopa Bot is answering';
  }

  function renderModeTabs() {
    const tabs = body.querySelector('#fva-mode-tabs');
    if (!tabs) return;
    if (!(IS_KOPABOOK && isOwnerMode())) { tabs.style.display = 'none'; return; }
    tabs.style.display = 'flex';
    tabs.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-mode') === chatMode);
    });
    const st = body.querySelector('#fva-support-status');
    if (st) {
      if (chatMode === 'support') { st.style.display = 'block'; st.textContent = supportStatusText(); }
      else st.style.display = 'none';
    }
  }

  function showDoorPicker() {
    const dp = body.querySelector('#fva-door-picker');
    if (!dp || doorPickerShown) return;
    doorPickerShown = true;
    dp.style.display = 'block';
    dp.querySelectorAll('.fva-door-btn').forEach(b => {
      b.addEventListener('click', () => {
        dp.style.display = 'none';
        setChatMode(b.getAttribute('data-mode'), false);
        const target = chatRouteFor(chatMode);
        if (routeSide() && window.location.pathname !== target) {
          try { window.history.pushState({}, '', target); } catch (e) {}
        }
      });
    });
  }

  function showInitialQuickReplies() {
    if (!(IS_KOPABOOK && isOwnerMode()) || !chatMode) return;
    if (chatMode === 'ai') showQuickReplies(['Record a sale', 'Record an expense', "Today's sales", 'Who owes me']);
    else showQuickReplies(['Pricing', 'Features', 'How to start', 'Talk to human']);
  }

  function afterOwnerUI() {
    if (!(IS_KOPABOOK && isOwnerMode())) return;
    updateHeaderPersona();
    renderModeTabs();
    if (!chatMode) showDoorPicker();
    else showInitialQuickReplies();
  }

  function appendModeNote(text) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-mode-note';
    div.textContent = text;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
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
          userAgent: navigator.userAgent.slice(0, 200),
          ownerCtx: getOwnerCtx() || undefined
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
      '<div id="fva-mode-tabs" style="display:none;">' +
        '<button data-mode="ai">Ask Kopa AI</button>' +
        '<button data-mode="support">Kopa Support</button>' +
      '</div>' +
      '<div id="fva-support-status" style="display:none;"></div>' +
      '<div id="fva-door-picker" style="display:none;">' +
        '<div class="fva-door-title">Who do you want to talk to?</div>' +
        '<button class="fva-door-btn" data-mode="ai"><strong>Ask Kopa AI</strong><span>Your shop assistant. Records sales and expenses, and answers from your own records.</span></button>' +
        '<button class="fva-door-btn" data-mode="support"><strong>Kopa Support</strong><span>Chat with the FVA70K team about KopaBook itself. Quick platform answers first, a real person when you need one.</span></button>' +
        '<div class="fva-door-note">One chat, one history. This chat keeps the last 24 hours, shared across both sides.</div>' +
      '</div>' +
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

    doorPickerShown = false;
    const tabsEl = body.querySelector('#fva-mode-tabs');
    if (tabsEl) tabsEl.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => switchMode(b.getAttribute('data-mode')));
    });
    loadHistory();
    poll();
    afterOwnerUI();
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
          appendMsg(m.sender, m.message, m.created_at, null, true, m.sender_name);
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
  function isOwnerMode() {
    return IS_KOPABOOK && !!getOwnerCtx();
  }

  function getOwnerCtx() {
    try {
      if (window.FVAChatOwner && window.FVAChatOwner.businessId && window.FVAChatOwner.userId) {
        return window.FVAChatOwner;
      }
    } catch (e) {}
    return null;
  }

  async function sendMessage(text) {
    if (IS_KOPABOOK && isOwnerMode() && !chatMode) {
      showDoorPicker();
      appendModeNote('Choose Ask Kopa AI or Kopa Support first, then send that again.');
      return;
    }
    const msgId = 'local_' + Date.now();
    appendMsg('visitor', text, Date.now(), msgId, false);
    showBotTyping();
    try {
      const payload = { sessionId, sender: 'visitor', message: text, siteId: SITE_ID };
      const ownerCtx = getOwnerCtx();
      if (ownerCtx) payload.ownerCtx = ownerCtx;
      if (IS_KOPABOOK && ownerCtx) payload.mode = chatMode || 'support';
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
      if (data.botReply && data.botReply.escalate) {
        supportState = Object.assign({}, supportState || {}, { needsHuman: true });
        renderModeTabs(); updateHeaderPersona();
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
    if (!wrap || !action) return;
    const div = document.createElement('div');
    div.className = 'fva-action-wrap';
    if (action.type === 'switch' && (action.mode === 'ai' || action.mode === 'support')) {
      // Cross-door suggestion: one tap to the other side, same thread.
      const btn = document.createElement('button');
      btn.className = 'fva-action-btn fva-switch-btn';
      btn.textContent = action.label || ('Switch to ' + modeName(action.mode));
      btn.addEventListener('click', () => {
        if (routeSide()) switchMode(action.mode);
        else navigateChatRoute(action.mode);
      });
      div.appendChild(btn);
    } else if (action.url) {
      div.innerHTML = '<a href="' + escapeHtml(action.url) + '" target="_blank" class="fva-action-btn">' + escapeHtml(action.label) + '</a>';
    } else {
      return;
    }
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function appendMsg(sender, text, at, localId, isRead, senderName) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-msg ' + sender;
    if (localId) div.setAttribute('data-local-id', localId);
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let html = '';
    if (sender === 'agent' && senderName) {
      html += '<div class="bot-label">👤 ' + escapeHtml(senderName) + '</div>';
    }
    html += escapeHtml(text) + '<div class="time">' + time;
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
    div.innerHTML = '<div class="bot-label">🤖 ' + escapeHtml(botLabel()) + '</div>' + formatMsg(text) + '<div class="time">' + time + '</div>';
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function formatMsg(s) {
    var h = escapeHtml(s).split('\\n').join('\n');
    h = h.replace(/\n/g, '<br>');
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return h;
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

      // Merged chat: keep the honest support state current.
      if (data.supportState) {
        supportState = data.supportState;
        if (IS_KOPABOOK && isOwnerMode()) { renderModeTabs(); updateHeaderPersona(); }
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
          else if (m.sender === 'system') appendModeNote(m.message);
          else appendMsg(m.sender, m.message, m.created_at, null, m.sender === 'visitor' ? !!m.read_by_agent : false, m.sender_name);

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
      const res = await fetch(API + '/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && (data.sent || data.ok)) alert('Transcript sent to ' + email);
      else alert('Could not send the transcript. Please try again.');
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
      if (IS_KOPABOOK && isOwnerMode()) return;
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
    setMode: switchMode,
    getMode: () => chatMode,
  };

  // Clean routes: /app/chat/ai and /app/chat/support land on their side.
  // The owner context arrives a moment after the app session loads, so
  // wait briefly for it before opening.
  (function autoOpenFromRoute() {
    const side = routeSide();
    if (!IS_KOPABOOK || (side !== 'ai' && side !== 'support')) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (isOwnerMode()) {
        clearInterval(t);
        setChatMode(side, true);
        openChat(side);
      } else if (tries > 30) {
        clearInterval(t);
      }
    }, 200);
  })();
})();
