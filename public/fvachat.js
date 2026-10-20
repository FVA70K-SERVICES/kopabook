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
    if (supportState.caseStatus === 'resolved') return 'The team marked this support case resolved';
    if (supportState.caseStatus === 'closed') return 'This support case is closed. Sending a message starts a new case';
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
    const tools = body.querySelector('#fva-support-tools');
    if (tools) tools.style.display = chatMode === 'support' ? 'block' : 'none';
    if (chatMode !== 'support') closeCaseHistory();
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

  // ---- Kopa Support case history (client view) ----
  // Support conversations are kept as a record (see /api/chat/cases).
  // This view is read-mostly: a closed case never silently resumes, but
  // the client can reopen one, or confirm a resolution, from here.
  let caseListCursor = null;
  let caseListLoading = false;

  function fmtStamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function caseStatusLabel(s) {
    return s === 'resolved' ? 'Resolved' : s === 'closed' ? 'Closed' : 'Open';
  }
  function eventText(e) {
    const who = e.actor_type === 'client' ? (e.actor_name || 'You') : (e.actor_name || 'Support team');
    if (e.event === 'opened') return 'Case opened';
    if (e.event === 'resolved') return 'Marked resolved by ' + who;
    if (e.event === 'closed') return 'Closed by ' + who;
    if (e.event === 'reopened') return 'Reopened by ' + who;
    if (e.event === 'confirmed') return 'Resolution confirmed by ' + who;
    return e.event;
  }

  function setLiveVisible(v) {
    ['#fva-chat-messages', '#fva-chat-input-area', '#fva-chat-quick'].forEach(sel => {
      const el = body.querySelector(sel);
      if (el) el.style.display = v ? '' : 'none';
    });
    const tools = body.querySelector('#fva-support-tools');
    if (tools && !v) tools.style.display = 'none';
    if (v) renderModeTabs();
  }

  function openCaseHistory() {
    const view = body.querySelector('#fva-case-history');
    if (!view) return;
    setLiveVisible(false);
    view.style.display = 'block';
    const detail = body.querySelector('#fva-history-detail');
    if (detail) detail.style.display = 'none';
    const list = body.querySelector('#fva-history-list');
    if (list) list.style.display = 'block';
    caseListCursor = null;
    loadCaseList(true);
  }

  function closeCaseHistory() {
    const view = body.querySelector('#fva-case-history');
    if (!view || view.style.display === 'none') return;
    view.style.display = 'none';
    setLiveVisible(true);
  }

  async function loadCaseList(reset) {
    const list = body.querySelector('#fva-history-list');
    if (!list || caseListLoading) return;
    caseListLoading = true;
    if (reset) list.innerHTML = '<p class="fva-history-empty">Loading your support chats...</p>';
    try {
      const url = API + '/cases?limit=15' + (caseListCursor ? '&cursor=' + encodeURIComponent(caseListCursor) : '');
      const res = await fetch(url);
      const data = await res.json();
      const cases = data.cases || [];
      if (reset) list.innerHTML = '';
      if (!cases.length && reset) {
        list.innerHTML = '<p class="fva-history-empty">No support chats yet. When you talk to Kopa Support, the conversation is kept here as a record.</p>';
      }
      cases.forEach(c => {
        const item = document.createElement('button');
        item.className = 'fva-case-item';
        item.type = 'button';
        item.innerHTML =
          '<span class="fva-case-top"><span class="fva-case-chip ' + escapeHtml(c.status) + '">' + caseStatusLabel(c.status) + '</span>' +
          '<span class="fva-case-date">' + escapeHtml(fmtStamp(c.opened_at)) + '</span></span>' +
          '<span class="fva-case-preview">' + escapeHtml(c.last_message || 'Support conversation') + '</span>' +
          (c.confirmed_at ? '<span class="fva-case-confirmed">You confirmed this was resolved</span>' : '');
        item.addEventListener('click', () => openCaseDetail(c.id));
        list.appendChild(item);
      });
      const oldMore = list.querySelector('.fva-case-more');
      if (oldMore) oldMore.remove();
      caseListCursor = data.nextCursor || null;
      if (caseListCursor) {
        const more = document.createElement('button');
        more.className = 'fva-case-more';
        more.type = 'button';
        more.textContent = 'Show older chats';
        more.addEventListener('click', () => loadCaseList(false));
        list.appendChild(more);
      }
    } catch (e) {
      if (reset) list.innerHTML = '<p class="fva-history-empty">Could not load your support chats. Please try again.</p>';
    }
    caseListLoading = false;
  }

  async function openCaseDetail(caseId) {
    const detail = body.querySelector('#fva-history-detail');
    const list = body.querySelector('#fva-history-list');
    if (!detail) return;
    if (list) list.style.display = 'none';
    detail.style.display = 'block';
    detail.innerHTML = '<p class="fva-history-empty">Loading...</p>';
    try {
      const res = await fetch(API + '/cases?caseId=' + encodeURIComponent(caseId));
      const data = await res.json();
      if (!res.ok || !data.case) {
        detail.innerHTML = '<p class="fva-history-empty">That support chat could not be loaded.</p>';
        return;
      }
      const c = data.case;
      let html = '<button class="fva-case-backlist" type="button">All support chats</button>';
      html += '<div class="fva-case-detail-head"><span class="fva-case-chip ' + escapeHtml(c.status) + '">' + caseStatusLabel(c.status) + '</span>' +
        '<span class="fva-case-date">Opened ' + escapeHtml(fmtStamp(c.opened_at)) + '</span></div>';
      html += '<div class="fva-case-msgs">';
      (data.messages || []).forEach(m => {
        const who = m.sender === 'visitor' ? 'visitor' : m.sender === 'agent' ? 'agent' : 'bot';
        html += '<div class="fva-msg ' + who + '">' +
          (m.sender === 'agent' && m.sender_name ? '<div class="bot-label">👤 ' + escapeHtml(m.sender_name) + '</div>' : '') +
          escapeHtml(m.message) +
          '<div class="time">' + escapeHtml(fmtStamp(m.created_at)) + '</div></div>';
      });
      html += '</div>';
      const events = data.events || [];
      if (events.length) {
        html += '<div class="fva-case-events"><div class="fva-case-events-title">Case history</div>' +
          events.map(e => '<div class="fva-case-event">' + escapeHtml(eventText(e)) + ' · ' + escapeHtml(fmtStamp(e.created_at)) + '</div>').join('') +
          '</div>';
      }
      html += '<div class="fva-case-actions">';
      if (c.status === 'resolved' && !c.confirmed_at) {
        html += '<button class="fva-case-act primary" type="button" data-act="confirm">Confirm resolved</button>';
      }
      if (c.status === 'resolved' || c.status === 'closed') {
        html += '<button class="fva-case-act" type="button" data-act="reopen">' + (c.status === 'resolved' ? 'Not resolved yet, reopen' : 'Reopen this case') + '</button>';
      }
      if (c.status === 'open') {
        html += '<span class="fva-case-open-note">This case is open. Just send a message in Kopa Support to continue it.</span>';
      }
      html += '</div>';
      detail.innerHTML = html;
      const backBtn = detail.querySelector('.fva-case-backlist');
      if (backBtn) backBtn.addEventListener('click', openCaseHistory);
      detail.querySelectorAll('.fva-case-act').forEach(b => {
        b.addEventListener('click', () => caseAction(caseId, b.getAttribute('data-act')));
      });
    } catch (e) {
      detail.innerHTML = '<p class="fva-history-empty">Could not load that support chat. Please try again.</p>';
    }
  }

  async function caseAction(caseId, action) {
    try {
      const res = await fetch(API + '/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'That did not work. Please try again.'); return; }
      if (action === 'reopen') {
        closeCaseHistory();
        setChatMode('support', true);
        appendModeNote('This support case is open again, with the full conversation kept. Send your message here.');
        poll();
      } else {
        openCaseDetail(caseId);
      }
    } catch (e) {
      alert('That did not work. Please try again.');
    }
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
        '<p style="font-size:14px;">What should we call you?</p>' +
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
      '<div id="fva-support-tools" style="display:none;">' +
        '<button id="fva-history-btn" type="button">Past support chats</button>' +
      '</div>' +
      '<div id="fva-case-history" style="display:none;">' +
        '<div class="fva-history-head">' +
          '<button id="fva-history-back" type="button">Back to chat</button>' +
          '<strong>Past support chats</strong>' +
        '</div>' +
        '<p class="fva-history-note">Support conversations are kept as a record for you and the FVA70K team. Ask Kopa AI keeps the last 24 hours.</p>' +
        '<div id="fva-history-list"></div>' +
        '<div id="fva-history-detail" style="display:none;"></div>' +
      '</div>' +
      '<div id="fva-door-picker" style="display:none;">' +
        '<div class="fva-door-title">Who do you want to talk to?</div>' +
        '<button class="fva-door-btn" data-mode="ai"><strong>Ask Kopa AI</strong><span>Your shop assistant. Records sales and expenses, and answers from your own records.</span></button>' +
        '<button class="fva-door-btn" data-mode="support"><strong>Kopa Support</strong><span>Chat with the FVA70K team about KopaBook itself. Quick platform answers first, a real person when you need one.</span></button>' +
        '<div class="fva-door-note">One chat, two doors. Ask Kopa AI keeps the last 24 hours. Kopa Support conversations are kept as a record, so you and the FVA70K team can always look back at what was said.</div>' +
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
    const histBtn = body.querySelector('#fva-history-btn');
    if (histBtn) histBtn.addEventListener('click', openCaseHistory);
    const histBack = body.querySelector('#fva-history-back');
    if (histBack) histBack.addEventListener('click', closeCaseHistory);
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
