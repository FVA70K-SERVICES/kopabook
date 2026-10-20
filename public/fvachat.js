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
  let ownerInboxAuthFailed = false;
  let doorPickerShown = false;
  const renderedProposalIds = new Set();

  // ---- Personal assistant (PA) profile, Ask Kopa AI side ----
  // GET /api/ai/pa returns { ok, assistant: { name, custom_name, voice, language },
  // pa_enabled, cards: [...] }. Fetched once per open in owner mode.
  let paProfile = null;
  let paFetchedThisOpen = false;
  let paCardsRenderedThisOpen = false;
  let localAssistantLanguage = '';
  let activeProposal = null;

  // ---- Live voice (Web Speech API, AI mode, owner mode) ----
  let voiceMode = false;
  let voiceState = 'idle'; // idle | listening | processing | speaking
  let recognition = null;
  let recognitionRunning = false;
  let recognitionHadResult = false;
  let voiceRestartTimer = null;
  let voiceUnsupportedNoteShownThisOpen = false;
  let langVoiceNoteShown = false;
  let introSpokenThisVoiceSession = false;
  const spokenMessageIds = new Set();
  const spokenTexts = new Set();
  let speechQueue = [];
  let speechSpeaking = false;
  let cachedVoices = [];

  function getSR() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  function paAssistant() {
    return (paProfile && paProfile.assistant) || null;
  }
  function paEnabled() {
    return !!paProfile && paProfile.pa_enabled !== false;
  }
  function assistantCustomName() {
    const a = paAssistant();
    if (!paEnabled() || !a || !a.custom_name || !a.name) return '';
    return String(a.name).trim();
  }
  function paLanguage() {
    const a = paAssistant();
    const lang = (a && a.language) || localAssistantLanguage || 'en';
    return ['en', 'pcm', 'ha', 'yo', 'ig'].indexOf(lang) !== -1 ? lang : 'en';
  }

  function resolveLang(language) {
    const map = { en: 'en-NG', pcm: 'en-NG', ha: 'ha-NG', yo: 'yo-NG', ig: 'ig-NG' };
    return map[language] || 'en-NG';
  }

  function voiceGenderMatch(voice, choice) {
    const n = String((voice && voice.name) || '').toLowerCase();
    if (choice === 'ng_female') return n.indexOf('female') !== -1;
    if (choice === 'ng_male') return n.indexOf('male') !== -1 && n.indexOf('female') === -1;
    return false;
  }
  function pickGenderedVoice(list, choice) {
    if (!list || !list.length) return null;
    for (let i = 0; i < list.length; i++) {
      if (voiceGenderMatch(list[i], choice)) return list[i];
    }
    return list[0];
  }
  function resolveVoice(choice, voicesList) {
    const profiles = {
      ng_female: { pitch: 1.1, rate: 1.0 },
      ng_male: { pitch: 0.85, rate: 0.98 },
      default: { pitch: 1, rate: 1 },
    };
    const profile = profiles[choice] || profiles.default;
    if (!choice || choice === 'default' || !profiles[choice]) {
      return { voice: null, pitch: 1, rate: 1 };
    }
    const list = Array.isArray(voicesList) ? voicesList : [];
    const langOf = v => String((v && v.lang) || '').toLowerCase();
    const ng = list.filter(v => langOf(v).indexOf('en-ng') === 0);
    if (ng.length) return { voice: pickGenderedVoice(ng, choice), pitch: profile.pitch, rate: profile.rate };
    const english = list.filter(v => langOf(v).indexOf('en') === 0);
    if (english.length) {
      const tier = v => {
        const l = langOf(v);
        if (l.indexOf('en-gb') === 0) return 0;
        if (l.indexOf('en-us') === 0) return 1;
        return 2;
      };
      const sorted = english.slice().sort((a, b) => tier(a) - tier(b));
      let chosen = null;
      for (let i = 0; i < sorted.length; i++) {
        if (voiceGenderMatch(sorted[i], choice)) { chosen = sorted[i]; break; }
      }
      return { voice: chosen || sorted[0], pitch: profile.pitch, rate: profile.rate };
    }
    return { voice: null, pitch: profile.pitch, rate: profile.rate };
  }

  // Voice for a specific utterance language: match the language first,
  // apply gender resolution inside that pool, else fall back to the
  // English resolution above.
  function resolveVoiceDetailed(choice, voicesList, langTag) {
    const primary = String(langTag || 'en-NG').split('-')[0].toLowerCase();
    if (!choice || choice === 'default') {
      return { voice: null, pitch: 1, rate: 1, matchedLang: primary === 'en' };
    }
    if (primary !== 'en') {
      const list = Array.isArray(voicesList) ? voicesList : [];
      const matching = list.filter(v => String((v && v.lang) || '').toLowerCase().split('-')[0] === primary);
      if (matching.length) {
        const base = resolveVoice(choice, []);
        return { voice: pickGenderedVoice(matching, choice), pitch: base.pitch, rate: base.rate, matchedLang: true };
      }
      const fb = resolveVoice(choice, list);
      return { voice: fb.voice, pitch: fb.pitch, rate: fb.rate, matchedLang: false };
    }
    const r = resolveVoice(choice, voicesList);
    return { voice: r.voice, pitch: r.pitch, rate: r.rate, matchedLang: true };
  }

  window.__FVA_VOICE_TEST__ = { resolveVoice, resolveLang };

  function refreshCachedVoices() {
    try {
      if ('speechSynthesis' in window) {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length) cachedVoices = v;
      }
    } catch (e) {}
    return cachedVoices;
  }
  if ('speechSynthesis' in window && window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
    try { window.speechSynthesis.addEventListener('voiceschanged', refreshCachedVoices); } catch (e) {}
  }

  function detectLanguageSwitch(text) {
    const raw = String(text || '');
    const names = { english: 'en', pidgin: 'pcm', hausa: 'ha', yoruba: 'yo', igbo: 'ig' };
    let found = '';
    const bare = raw.trim().toLowerCase().replace(/[.!]+$/, '');
    if (names[bare]) found = names[bare];
    if (!found) {
      const m = raw.toLowerCase().match(/(?:speak|talk|switch|change|use|reply|respond|answer|continue|in|to)\s+(?:to\s+|in\s+)?(english|pidgin|hausa|yoruba|igbo)\b/);
      if (m && names[m[1]]) found = names[m[1]];
    }
    if (found) {
      localAssistantLanguage = found;
      const a = paAssistant();
      if (a) a.language = found;
    }
    return found;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function scrollMessagesToBottom(wrap) {
    if (!wrap) return;
    if (prefersReducedMotion()) { wrap.scrollTop = wrap.scrollHeight; return; }
    try {
      wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
    } catch (e) { wrap.scrollTop = wrap.scrollHeight; }
  }

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
    if (IS_KOPABOOK && isOwnerMode()) {
      if (chatMode === 'ai') return assistantCustomName() || 'Kopa AI';
      return 'Kopa Bot';
    }
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
    paFetchedThisOpen = false;
    paCardsRenderedThisOpen = false;
    voiceUnsupportedNoteShownThisOpen = false;
    langVoiceNoteShown = false;
    activeProposal = null;
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
    if (mode !== 'ai') stopVoiceMode();
    setChatMode(mode, false);
    if (mode === 'ai') { loadPaProfile(); renderPaCards(); updateVoiceControls(); }
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
      const custom = chatMode === 'ai' ? assistantCustomName() : '';
      title.textContent = custom || (chatMode ? modeName(chatMode) : 'Chat');
      if (status) {
        status.textContent = chatMode === 'ai'
          ? 'Your shop assistant, automated'
          : chatMode === 'support' ? supportStatusText() : 'Choose a side to start';
      }
    } else {
      title.textContent = BUSINESS_NAME;
    }
  }

  function isPlatformOwnerMode() {
    if (!IS_KOPABOOK) return false;
    const ctx = getOwnerCtx();
    return !!ctx && ctx.isPlatformAdmin === true;
  }

  function supportStatusText() {
    if (isPlatformOwnerMode() && !ownerInboxAuthFailed) return 'Support inbox: cases from business owners';
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
    if (tools) {
      if (chatMode === 'support' && isPlatformOwnerMode() && !ownerInboxAuthFailed) tools.style.display = 'none';
      else tools.style.display = chatMode === 'support' ? 'block' : 'none';
    }
    if (chatMode !== 'support') closeCaseHistory();
    if (chatMode === 'support' && isPlatformOwnerMode() && !ownerInboxAuthFailed) openOwnerInbox();
    else {
      if (chatMode !== 'support') ownerInboxAuthFailed = false;
      closeOwnerInbox();
    }
    renderPaCards();
    updateVoiceControls();
  }

  function showDoorPicker() {
    const dp = body.querySelector('#fva-door-picker');
    if (!dp || doorPickerShown) return;
    doorPickerShown = true;
    if (isPlatformOwnerMode()) {
      const supportDesc = dp.querySelector('.fva-door-btn[data-mode="support"] span');
      if (supportDesc) supportDesc.textContent = 'Your support inbox. Read and reply to cases from business owners.';
    }
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
    if (chatMode === 'support' && isPlatformOwnerMode()) return;
    if (chatMode === 'ai') showQuickReplies(['Record a sale', 'Record an expense', "Today's sales", 'Who owes me']);
    else showQuickReplies(['Pricing', 'Features', 'How to start', 'Talk to human']);
  }

  function afterOwnerUI() {
    if (!(IS_KOPABOOK && isOwnerMode())) return;
    updateHeaderPersona();
    renderModeTabs();
    loadPaProfile();
    if (!chatMode) showDoorPicker();
    else showInitialQuickReplies();
  }

  // ---- PA profile and cards ----
  async function loadPaProfile() {
    if (!IS_KOPABOOK || !isOwnerMode()) return null;
    if (paFetchedThisOpen) return paProfile;
    paFetchedThisOpen = true;
    try {
      const res = await fetch((API_BASE || '') + '/api/ai/pa');
      const data = await res.json().catch(() => null);
      if (data && (data.assistant || data.cards || data.pa_enabled !== undefined)) {
        paProfile = data;
      }
    } catch (e) {}
    updateHeaderPersona();
    renderPaCards();
    updateVoiceControls();
    return paProfile;
  }

  function renderPaCards() {
    if (!IS_KOPABOOK || !isOwnerMode() || chatMode !== 'ai') return;
    if (paCardsRenderedThisOpen || !paEnabled()) return;
    const cards = Array.isArray(paProfile.cards) ? paProfile.cards : [];
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    paCardsRenderedThisOpen = true;
    if (!cards.length) return;
    cards.forEach(card => {
      if (card) wrap.appendChild(buildPaCard(card));
    });
    scrollMessagesToBottom(wrap);
  }

  function buildPaCard(card) {
    const el = document.createElement('div');
    el.className = 'fva-pa-card';
    if (card.type) el.setAttribute('data-pa-type', String(card.type));
    if (card.id !== undefined && card.id !== null) el.setAttribute('data-pa-id', String(card.id));

    const text = document.createElement('div');
    text.className = 'fva-pa-card-text';
    text.textContent = card.text || '';
    el.appendChild(text);

    const err = document.createElement('div');
    err.className = 'fva-pa-card-error';
    err.style.display = 'none';

    if (card.type === 'briefing') {
      const actions = document.createElement('div');
      actions.className = 'fva-pa-card-actions';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fva-pa-btn fva-pa-btn-primary';
      b.textContent = 'Brief me';
      b.addEventListener('click', () => sendMessage('Brief me'));
      actions.appendChild(b);
      el.appendChild(actions);
    } else if (card.type === 'reminder_due') {
      const actions = document.createElement('div');
      actions.className = 'fva-pa-card-actions';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fva-pa-btn fva-pa-btn-primary';
      b.textContent = 'Mark done';
      b.addEventListener('click', async () => {
        b.disabled = true;
        err.style.display = 'none';
        try {
          const res = await fetch((API_BASE || '') + '/api/ai/pa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reminder_done', reminder_id: card.reminder_id }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || (data && data.ok === false)) throw new Error('failed');
          el.remove();
        } catch (e) {
          b.disabled = false;
          err.textContent = 'Could not mark that done. Please try again.';
          err.style.display = 'block';
        }
      });
      actions.appendChild(b);
      el.appendChild(actions);
    } else {
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'fva-pa-dismiss';
      dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.addEventListener('click', () => el.remove());
      el.appendChild(dismiss);
    }
    el.appendChild(err);
    return el;
  }

  // ---- Live voice engine ----
  function setVoiceChip(text) {
    const chip = body.querySelector('#fva-voice-chip');
    if (!chip) return;
    if (!text) { chip.style.display = 'none'; chip.textContent = ''; return; }
    chip.style.display = 'inline-flex';
    chip.textContent = text;
  }
  function updateVoiceButtonState() {
    const b = body.querySelector('#fva-voice-btn');
    if (!b) return;
    b.textContent = voiceMode ? '⏹' : '🎤';
    b.classList.toggle('active', !!voiceMode);
    b.classList.toggle('listening', !!(voiceMode && voiceState === 'listening'));
    b.setAttribute('aria-label', voiceMode ? 'Stop voice mode' : 'Start voice mode');
    b.setAttribute('aria-pressed', voiceMode ? 'true' : 'false');
  }
  function updateVoiceControls() {
    const area = body.querySelector('#fva-chat-input-area');
    if (!area) return;
    const eligible = IS_KOPABOOK && isOwnerMode() && chatMode === 'ai';
    let btnEl = body.querySelector('#fva-voice-btn');
    if (!eligible) {
      if (voiceMode) stopVoiceMode();
      btnEl = body.querySelector('#fva-voice-btn');
      if (btnEl) btnEl.remove();
      setVoiceChip('');
      return;
    }
    if (!getSR()) {
      if (btnEl) btnEl.remove();
      setVoiceChip('');
      if (!voiceUnsupportedNoteShownThisOpen && body.querySelector('#fva-chat-messages')) {
        voiceUnsupportedNoteShownThisOpen = true;
        appendModeNote('Voice works in Chrome and in the Android app. Typing works everywhere.');
      }
      return;
    }
    if (!btnEl) {
      btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.id = 'fva-voice-btn';
      btnEl.textContent = '🎤';
      btnEl.setAttribute('aria-label', 'Start voice mode');
      btnEl.addEventListener('click', toggleVoiceMode);
      const inputEl = body.querySelector('#fva-chat-input');
      if (inputEl) area.insertBefore(btnEl, inputEl);
      else area.appendChild(btnEl);
    }
    btnEl.style.display = '';
    updateVoiceButtonState();
  }

  function toggleVoiceMode() {
    if (voiceMode) stopVoiceMode();
    else startVoiceMode();
  }

  function startVoiceMode() {
    if (voiceMode) return;
    if (!(IS_KOPABOOK && isOwnerMode() && chatMode === 'ai')) return;
    if (!getSR()) { updateVoiceControls(); return; }
    loadPaProfile();
    voiceMode = true;
    introSpokenThisVoiceSession = false;
    voiceState = 'processing';
    updateVoiceButtonState();
    setVoiceChip('Listening...');
    const custom = assistantCustomName();
    if (custom && soundOn && 'speechSynthesis' in window) {
      introSpokenThisVoiceSession = true;
      enqueueSpeech('Hi, this is ' + custom + '.');
      // Listening starts when the introduction finishes (queue onend path).
      if (!speechSpeaking && !speechQueue.length) startListening();
    } else {
      startListening();
    }
  }

  function stopVoiceMode() {
    if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
    voiceMode = false;
    voiceState = 'idle';
    speechQueue = [];
    speechSpeaking = false;
    if (recognition) {
      try { if (typeof recognition.abort === 'function') recognition.abort(); else if (typeof recognition.stop === 'function') recognition.stop(); } catch (e) {}
      recognitionRunning = false;
      recognition = null;
    }
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
    updateVoiceButtonState();
    setVoiceChip('');
  }

  function scheduleListeningRestart(delay) {
    if (!voiceMode) return;
    if (voiceRestartTimer) clearTimeout(voiceRestartTimer);
    voiceRestartTimer = setTimeout(() => {
      voiceRestartTimer = null;
      startListening();
    }, delay || 350);
  }

  function startListening(retryLang) {
    if (!voiceMode || speechSpeaking || speechQueue.length || recognitionRunning) return;
    const SR = getSR();
    if (!SR) { stopVoiceMode(); return; }
    let rec;
    try { rec = new SR(); } catch (e) { scheduleListeningRestart(600); return; }
    recognition = rec;
    recognitionHadResult = false;
    rec.lang = retryLang || resolveLang(paLanguage());
    try { rec.interimResults = false; } catch (e) {}
    try { rec.maxAlternatives = 1; } catch (e) {}
    try { rec.continuous = false; } catch (e) {}
    voiceState = 'listening';
    setVoiceChip('Listening...');
    updateVoiceButtonState();
    rec.onresult = event => {
      let finalText = '';
      let hasFinal = false;
      try {
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          if (r && r.isFinal) { hasFinal = true; if (r[0]) finalText += r[0].transcript || ''; }
        }
      } catch (e) {}
      if (!hasFinal) return;
      recognitionHadResult = true;
      const t = finalText.trim();
      if (!t) { handleRecognitionNoMatch(); return; }
      voiceState = 'processing';
      setVoiceChip('Thinking...');
      updateVoiceButtonState();
      try { rec.stop(); } catch (e) {}
      recognitionRunning = false;
      sendMessage(t);
      // If the reply is not spoken (for example sound is off), resume listening.
      setTimeout(() => {
        if (voiceMode && voiceState === 'processing' && !speechSpeaking && !speechQueue.length) {
          scheduleListeningRestart(600);
        }
      }, 2500);
    };
    rec.onnomatch = () => handleRecognitionNoMatch();
    rec.onerror = event => {
      const err = event && event.error;
      recognitionRunning = false;
      if (!voiceMode) return;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        appendModeNote('Microphone is blocked. Allow mic access in your browser settings, or keep typing.');
        stopVoiceMode();
        return;
      }
      if (err === 'language-not-supported') {
        const langNow = paLanguage();
        if (!retryLang && (langNow === 'en' || langNow === 'pcm')) { startListening('en-GB'); return; }
        appendModeNote('Voice recognition is not available for that language on this device. Typing works everywhere.');
        stopVoiceMode();
        return;
      }
      if (err === 'aborted') return;
      if (voiceState === 'listening') scheduleListeningRestart(500);
    };
    rec.onend = () => {
      recognitionRunning = false;
      if (voiceMode && voiceState === 'listening' && !recognitionHadResult) {
        scheduleListeningRestart(500);
      }
    };
    try {
      recognitionRunning = true;
      rec.start();
    } catch (e) {
      recognitionRunning = false;
      scheduleListeningRestart(600);
    }
  }

  function handleRecognitionNoMatch() {
    if (!voiceMode) return;
    try { if (recognition && typeof recognition.stop === 'function') recognition.stop(); } catch (e) {}
    recognitionRunning = false;
    if (activeProposal && !activeProposal.noMatchPrompted) {
      activeProposal.noMatchPrompted = true;
      voiceState = 'processing';
      setVoiceChip('Thinking...');
      enqueueSpeech('I did not catch that. Say yes to confirm, or no to cancel.');
      if (!speechSpeaking && !speechQueue.length) scheduleListeningRestart(400);
    } else {
      scheduleListeningRestart(400);
    }
  }

  function cleanTextForSpeech(text) {
    return String(text || '')
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/www\.[^\s]+/g, '')
      .replace(/[✓✔]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function enqueueSpeech(text) {
    const clean = cleanTextForSpeech(text);
    if (!clean) return;
    if (!soundOn) return;
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    speechQueue.push(clean);
    processSpeechQueue();
  }

  function processSpeechQueue() {
    if (speechSpeaking) return;
    if (!speechQueue.length) return;
    if (!voiceMode) { speechQueue = []; return; }
    const text = speechQueue.shift();
    let utter;
    try {
      utter = new window.SpeechSynthesisUtterance(text);
    } catch (e) { processSpeechQueue(); return; }
    speechSpeaking = true;
    voiceState = 'speaking';
    setVoiceChip('Speaking...');
    updateVoiceButtonState();
    const langTag = resolveLang(paLanguage());
    utter.lang = langTag;
    const voices = refreshCachedVoices();
    const choice = (paAssistant() && paAssistant().voice) || 'default';
    const resolved = resolveVoiceDetailed(choice, voices, langTag);
    const primary = langTag.split('-')[0].toLowerCase();
    if (primary !== 'en' && !resolved.matchedLang && !langVoiceNoteShown) {
      langVoiceNoteShown = true;
      appendModeNote("Voices come from your phone. For a full Nigerian voice, add English (Nigeria) in your phone's text-to-speech settings, it is free.");
    }
    if (resolved.voice) { try { utter.voice = resolved.voice; } catch (e) {} }
    utter.pitch = resolved.pitch;
    utter.rate = resolved.rate;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      speechSpeaking = false;
      if (speechQueue.length) { processSpeechQueue(); return; }
      if (voiceMode) {
        voiceState = 'processing';
        setVoiceChip('Listening...');
        updateVoiceButtonState();
        scheduleListeningRestart(350);
      }
    };
    utter.onend = finish;
    utter.onerror = finish;
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) { finish(); }
  }

  function maybeSpeakBotText(text, msgId) {
    if (!voiceMode || chatMode !== 'ai') return;
    const clean = cleanTextForSpeech(text);
    if (!clean) return;
    if (msgId !== undefined && msgId !== null && msgId !== '') {
      const key = String(msgId);
      if (spokenMessageIds.has(key)) return;
      spokenMessageIds.add(key);
    }
    if (spokenTexts.has(clean)) return;
    spokenTexts.add(clean);
    enqueueSpeech(clean);
  }

  function speakProposal(lines) {
    if (!voiceMode) return;
    const parts = (lines || []).map(l => {
      const s = String(l).trim();
      if (!s) return '';
      return /[.!?]$/.test(s) ? s : s + '.';
    }).filter(Boolean);
    const text = (parts.join(' ') + ' Say yes to confirm, or no to cancel.').trim();
    enqueueSpeech(text);
  }

  function appendModeNote(text) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-mode-note';
    div.textContent = text;
    wrap.appendChild(div);
    scrollMessagesToBottom(wrap);
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

  // ---- Kopa Support inbox (platform owner view) ----
  // The platform owner receives cases here instead of contacting support.
  // Every admin call is re-verified by the server; this flag only renders.
  let inboxListCursor = null;
  let inboxListLoading = false;
  let ownerInboxOpen = false;
  let inboxCurrentCase = null;
  let inboxCurrentCaseId = null;
  let inboxReplySending = false;

  function inboxCaseName(c) {
    return (c && (c.business_name || c.client_name)) || 'Business';
  }
  function inboxPriorityChip(c) {
    if (!c || (c.priority !== 'high' && c.priority !== 'urgent')) return '';
    const label = c.priority === 'urgent' ? 'Urgent' : 'High';
    return '<span class="fva-case-chip priority-' + escapeHtml(c.priority) + '">' + label + '</span>';
  }
  function inboxChipsHtml(c) {
    return '<span class="fva-case-chip ' + escapeHtml(c.status || 'open') + '">' + caseStatusLabel(c.status) + '</span>' + inboxPriorityChip(c);
  }
  function inboxEventText(e) {
    const who = e.actor_name || (e.actor_type === 'client' || e.actor_type === 'visitor' ? 'Business owner' : 'Support team');
    const detail = e.detail ? ': ' + String(e.detail) : '';
    if (e.event === 'opened') return 'Case opened';
    if (e.event === 'resolved') return 'Marked resolved by ' + who;
    if (e.event === 'closed') return 'Closed by ' + who;
    if (e.event === 'reopened') return 'Reopened by ' + who;
    if (e.event === 'confirmed') return 'Resolution confirmed by ' + who;
    if (e.event === 'assigned') return 'Assigned' + detail;
    if (e.event === 'priority') return 'Priority changed' + detail;
    if (e.event === 'category') return 'Category changed' + detail;
    if (e.event === 'note') return 'Internal note added by ' + who;
    if (e.event === 'replied' || e.event === 'reply') return 'Reply sent by ' + who;
    return String(e.event || 'Case updated') + detail;
  }
  function inboxMsgHtml(m, c) {
    const who = m.sender === 'visitor' ? 'visitor' : m.sender === 'agent' ? 'agent' : 'bot';
    let label = '';
    if (m.sender === 'visitor') label = (c && (c.client_name || c.business_name)) || 'Business owner';
    else if (m.sender === 'agent') label = m.sender_name || 'Kopa Support team';
    else label = 'Kopa Bot';
    return '<div class="bot-label">' + escapeHtml(label) + '</div>' +
      escapeHtml(m.message || '') +
      '<div class="time">' + escapeHtml(fmtStamp(m.created_at)) + '</div>';
  }

  function openOwnerInbox() {
    if (!isPlatformOwnerMode() || ownerInboxAuthFailed) return;
    const view = body.querySelector('#fva-owner-inbox');
    if (!view) return;
    if (ownerInboxOpen && view.style.display !== 'none') {
      setLiveVisible(false);
      return;
    }
    ownerInboxOpen = true;
    setLiveVisible(false);
    const hist = body.querySelector('#fva-case-history');
    if (hist) hist.style.display = 'none';
    view.style.display = 'block';
    const detail = body.querySelector('#fva-inbox-detail');
    if (detail) detail.style.display = 'none';
    const list = body.querySelector('#fva-inbox-list');
    if (list) list.style.display = 'block';
    inboxListCursor = null;
    loadInboxList(true);
  }

  function closeOwnerInbox() {
    const view = body.querySelector('#fva-owner-inbox');
    if (!view || view.style.display === 'none') return;
    ownerInboxOpen = false;
    inboxCurrentCase = null;
    inboxCurrentCaseId = null;
    view.style.display = 'none';
    setLiveVisible(true);
  }

  function handleInboxAuthFailure() {
    if (ownerInboxAuthFailed) return;
    ownerInboxAuthFailed = true;
    ownerInboxOpen = false;
    inboxCurrentCase = null;
    inboxCurrentCaseId = null;
    const view = body.querySelector('#fva-owner-inbox');
    if (view) view.style.display = 'none';
    setLiveVisible(true);
    appendModeNote('The support inbox could not be verified for this session, so the standard support view is shown.');
  }

  async function loadInboxList(reset) {
    const list = body.querySelector('#fva-inbox-list');
    if (!list || inboxListLoading) return;
    inboxListLoading = true;
    if (reset) list.innerHTML = '<p class="fva-history-empty">Loading support cases...</p>';
    try {
      const url = API + '/admin/cases?limit=25' + (inboxListCursor ? '&cursor=' + encodeURIComponent(inboxListCursor) : '');
      const res = await fetch(url);
      if (res.status === 401) {
        inboxListLoading = false;
        handleInboxAuthFailure();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('load failed');
      const cases = (data.cases || []).slice().sort((a, b) => {
        const aw = a.awaiting_first_response ? 1 : 0;
        const bw = b.awaiting_first_response ? 1 : 0;
        if (aw !== bw) return bw - aw;
        const at = new Date(a.last_activity || a.opened_at || 0).getTime() || 0;
        const bt = new Date(b.last_activity || b.opened_at || 0).getTime() || 0;
        return bt - at;
      });
      if (reset) list.innerHTML = '';
      if (!cases.length && reset) {
        list.innerHTML = '<p class="fva-history-empty">No support cases yet. When a business owner contacts Kopa Support, their case lands here.</p>';
      }
      cases.forEach(c => {
        const item = document.createElement('button');
        item.className = 'fva-case-item fva-inbox-item';
        item.type = 'button';
        const count = typeof c.message_count === 'number' ? c.message_count : null;
        item.innerHTML =
          '<span class="fva-case-top"><span class="fva-inbox-biz">' + escapeHtml(inboxCaseName(c)) + '</span>' +
          '<span class="fva-case-date">' + escapeHtml(fmtStamp(c.last_activity || c.opened_at)) + '</span></span>' +
          '<span class="fva-inbox-badges">' +
          (c.awaiting_first_response ? '<span class="fva-needs-badge">Needs reply</span>' : '') +
          '<span class="fva-case-chip ' + escapeHtml(c.status || 'open') + '">' + caseStatusLabel(c.status) + '</span>' +
          inboxPriorityChip(c) +
          '</span>' +
          '<span class="fva-case-preview">' + escapeHtml(c.last_message || 'Support conversation') + '</span>' +
          (count !== null ? '<span class="fva-inbox-count">' + count + (count === 1 ? ' message' : ' messages') + '</span>' : '');
        item.addEventListener('click', () => openInboxDetail(c.id));
        list.appendChild(item);
      });
      const oldMore = list.querySelector('.fva-case-more');
      if (oldMore) oldMore.remove();
      inboxListCursor = data.nextCursor || null;
      if (inboxListCursor) {
        const more = document.createElement('button');
        more.className = 'fva-case-more';
        more.type = 'button';
        more.textContent = 'Show older cases';
        more.addEventListener('click', () => loadInboxList(false));
        list.appendChild(more);
      }
    } catch (e) {
      if (reset) list.innerHTML = '<p class="fva-history-empty">Could not load the support inbox. Please try again.</p>';
    }
    inboxListLoading = false;
  }

  function refreshInboxDetailHead(detail, c) {
    if (!detail || !c) return;
    const chips = detail.querySelector('.fva-inbox-chips');
    if (chips) chips.innerHTML = inboxChipsHtml(c);
    const title = detail.querySelector('.fva-inbox-detail-title');
    if (title) title.textContent = inboxCaseName(c);
  }

  function renderInboxActions(detail, c) {
    const actions = detail.querySelector('.fva-inbox-actions');
    if (!actions) return;
    let html = '';
    if (c.status === 'open') {
      html += '<button class="fva-case-act primary fva-inbox-status-act" type="button" data-act="resolve">Resolve</button>';
      html += '<button class="fva-case-act fva-inbox-status-act" type="button" data-act="close">Close</button>';
    } else if (c.status === 'resolved' || c.status === 'closed') {
      html += '<button class="fva-case-act fva-inbox-status-act" type="button" data-act="reopen">Reopen</button>';
    }
    actions.innerHTML = html;
    actions.querySelectorAll('.fva-inbox-status-act').forEach(b => {
      b.addEventListener('click', () => inboxStatusAction(c.id, b.getAttribute('data-act'), detail));
    });
  }

  async function inboxStatusAction(caseId, action, detail) {
    try {
      const res = await fetch(API + '/admin/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, action }),
      });
      if (res.status === 401) { handleInboxAuthFailure(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data && data.ok === false)) throw new Error('action failed');
      if (data.case) {
        inboxCurrentCase = data.case;
        refreshInboxDetailHead(detail, data.case);
        renderInboxActions(detail, data.case);
      }
    } catch (e) {
      const err = detail.querySelector('.fva-inbox-reply-error');
      if (err) { err.textContent = 'That action did not work. Please try again.'; err.style.display = 'block'; }
    }
  }

  async function sendInboxReply(caseId, detail) {
    if (inboxReplySending) return;
    const textarea = detail.querySelector('.fva-inbox-reply-text');
    const sendBtn = detail.querySelector('.fva-inbox-send');
    const err = detail.querySelector('.fva-inbox-reply-error');
    if (!textarea || !sendBtn) return;
    const message = textarea.value.trim();
    if (err) err.style.display = 'none';
    if (!message) {
      if (err) { err.textContent = 'Write a reply first.'; err.style.display = 'block'; }
      return;
    }
    inboxReplySending = true;
    sendBtn.disabled = true;
    textarea.disabled = true;
    try {
      const res = await fetch(API + '/admin/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, action: 'reply', message }),
      });
      if (res.status === 401) {
        inboxReplySending = false;
        handleInboxAuthFailure();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data && data.ok === false)) throw new Error('reply failed');
      const returned = data.message || { sender: 'agent', sender_name: '', message, created_at: Date.now() };
      const msgs = detail.querySelector('.fva-case-msgs');
      if (msgs) {
        const div = document.createElement('div');
        div.className = 'fva-msg ' + (returned.sender === 'agent' ? 'agent' : returned.sender || 'agent');
        div.innerHTML = inboxMsgHtml(returned, data.case || inboxCurrentCase);
        msgs.appendChild(div);
      }
      textarea.value = '';
      if (data.case) {
        inboxCurrentCase = data.case;
        refreshInboxDetailHead(detail, data.case);
        renderInboxActions(detail, data.case);
      }
    } catch (e) {
      if (err) { err.textContent = 'Could not send that reply. Please try again.'; err.style.display = 'block'; }
    }
    inboxReplySending = false;
    sendBtn.disabled = false;
    textarea.disabled = false;
  }

  async function openInboxDetail(caseId) {
    const detail = body.querySelector('#fva-inbox-detail');
    const list = body.querySelector('#fva-inbox-list');
    if (!detail) return;
    inboxCurrentCaseId = caseId;
    if (list) list.style.display = 'none';
    detail.style.display = 'block';
    detail.innerHTML = '<p class="fva-history-empty">Loading...</p>';
    try {
      const res = await fetch(API + '/admin/cases?caseId=' + encodeURIComponent(caseId));
      if (res.status === 401) { handleInboxAuthFailure(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.case) {
        detail.innerHTML = '<p class="fva-history-empty">That support case could not be loaded.</p>';
        return;
      }
      const c = data.case;
      inboxCurrentCase = c;
      let html = '<button class="fva-case-backlist fva-inbox-backlist" type="button">All cases</button>';
      html += '<div class="fva-case-detail-head fva-inbox-detail-head"><span class="fva-inbox-detail-title">' + escapeHtml(inboxCaseName(c)) + '</span>' +
        '<span class="fva-inbox-chips">' + inboxChipsHtml(c) + '</span></div>';
      html += '<div class="fva-case-date fva-inbox-opened">Opened ' + escapeHtml(fmtStamp(c.opened_at)) + '</div>';
      html += '<div class="fva-case-msgs">';
      (data.messages || []).forEach(m => {
        const who = m.sender === 'visitor' ? 'visitor' : m.sender === 'agent' ? 'agent' : 'bot';
        html += '<div class="fva-msg ' + who + '">' + inboxMsgHtml(m, c) + '</div>';
      });
      html += '</div>';
      const notes = data.notes || [];
      html += '<div class="fva-case-events fva-inbox-notes"><div class="fva-case-events-title">Internal notes</div>' +
        '<div class="fva-inbox-notes-note">Only the FVA70K team can see these notes.</div>' +
        (notes.length
          ? notes.map(n => '<div class="fva-inbox-note"><strong>' + escapeHtml(n.author_name || 'Support team') + '</strong> <span class="fva-case-date">' + escapeHtml(fmtStamp(n.created_at)) + '</span><div>' + escapeHtml(n.note || '') + '</div></div>').join('')
          : '<div class="fva-case-event">No internal notes yet.</div>') +
        '</div>';
      const events = data.events || [];
      html += '<div class="fva-case-events fva-inbox-events"><div class="fva-case-events-title">Case history</div>' +
        (events.length
          ? events.map(e => '<div class="fva-case-event">' + escapeHtml(inboxEventText(e)) + ' · ' + escapeHtml(fmtStamp(e.created_at)) + '</div>').join('')
          : '<div class="fva-case-event">No case events yet.</div>') +
        '</div>';
      html += '<div class="fva-case-actions fva-inbox-actions"></div>';
      html += '<div class="fva-inbox-reply">' +
        '<label class="fva-inbox-reply-label" for="fva-inbox-reply-text">Reply to ' + escapeHtml(inboxCaseName(c)) + '</label>' +
        '<textarea id="fva-inbox-reply-text" class="fva-inbox-reply-text" rows="3" maxlength="2000" placeholder="Write a reply..."></textarea>' +
        '<div class="fva-inbox-reply-error" style="display:none;"></div>' +
        '<button class="fva-case-act primary fva-inbox-send" type="button">Send reply</button>' +
        '</div>';
      detail.innerHTML = html;
      const backBtn = detail.querySelector('.fva-inbox-backlist');
      if (backBtn) backBtn.addEventListener('click', () => {
        detail.style.display = 'none';
        if (list) list.style.display = 'block';
        inboxCurrentCase = null;
        inboxCurrentCaseId = null;
        inboxListCursor = null;
        loadInboxList(true);
      });
      renderInboxActions(detail, c);
      const sendBtn = detail.querySelector('.fva-inbox-send');
      if (sendBtn) sendBtn.addEventListener('click', () => sendInboxReply(caseId, detail));
    } catch (e) {
      detail.innerHTML = '<p class="fva-history-empty">Could not load that support case. Please try again.</p>';
    }
  }

  function closeChat() {
    stopVoiceMode();
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
      '<div id="fva-owner-inbox" style="display:none;">' +
        '<div class="fva-history-head fva-inbox-head">' +
          '<strong>Support inbox</strong>' +
          '<button id="fva-inbox-refresh" type="button">Refresh</button>' +
        '</div>' +
        '<p class="fva-history-note">Cases from business owners land here. This is the same inbox the Chat Center shows.</p>' +
        '<div id="fva-inbox-list"></div>' +
        '<div id="fva-inbox-detail" style="display:none;"></div>' +
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
      '<div id="fva-voice-chip" style="display:none;"></div>' +
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
    const inboxRefresh = body.querySelector('#fva-inbox-refresh');
    if (inboxRefresh) inboxRefresh.addEventListener('click', () => {
      const detail = body.querySelector('#fva-inbox-detail');
      if (detail) detail.style.display = 'none';
      const list = body.querySelector('#fva-inbox-list');
      if (list) list.style.display = 'block';
      inboxCurrentCase = null;
      inboxCurrentCaseId = null;
      inboxListCursor = null;
      loadInboxList(true);
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
    // Local language switch mirror (for example "speak Yoruba"), so voice
    // recognition and speech switch in this session straight away.
    if (IS_KOPABOOK && isOwnerMode()) detectLanguageSwitch(text);
    const normText = String(text || '').trim().toLowerCase();
    if (activeProposal && ['confirm', 'cancel', 'yes', 'no', 'na so'].indexOf(normText) !== -1) {
      activeProposal = null;
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
      // Speak the bot reply on the send path in voice mode. The poll path
      // speaks the same text by message id and by text, so it is not repeated.
      if (data.botReply && data.botReply.answer) {
        maybeSpeakBotText(data.botReply.answer);
      }
      // Confirmation proposal card for a write action proposed by Ask Kopa AI.
      // Confirming or cancelling is an ordinary chat message: the server
      // interprets the exact texts "Confirm" and "Cancel".
      if (data.botReply && data.botReply.proposal) {
        renderProposalCard(data.botReply.proposal);
      }
    } catch (e) { hideBotTyping(); }
  }

  function renderProposalCard(p) {
    if (!p) return;
    if (p.id !== undefined && p.id !== null && p.id !== '') {
      const key = String(p.id);
      if (renderedProposalIds.has(key)) return;
      renderedProposalIds.add(key);
    }
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;

    let lines = [];
    if (Array.isArray(p.lines) && p.lines.length) {
      lines = p.lines.map(l => String(l)).filter(l => l.trim() !== '');
    }
    if (!lines.length && p.summary) {
      lines = String(p.summary).split(/\r?\n/).filter(l => l.trim() !== '');
    }

    const card = document.createElement('div');
    card.className = 'fva-proposal-card';
    if (p.id !== undefined && p.id !== null && p.id !== '') {
      card.setAttribute('data-proposal-id', String(p.id));
    }

    const heading = document.createElement('div');
    heading.className = 'fva-proposal-title';
    heading.textContent = 'Please confirm';
    card.appendChild(heading);

    if (lines.length) {
      const linesEl = document.createElement('div');
      linesEl.className = 'fva-proposal-lines';
      lines.forEach(line => {
        const row = document.createElement('div');
        row.className = 'fva-proposal-line';
        row.textContent = line;
        linesEl.appendChild(row);
      });
      card.appendChild(linesEl);
    }

    const note = document.createElement('div');
    note.className = 'fva-proposal-note';
    note.textContent = 'Expires in 10 minutes';
    card.appendChild(note);

    const status = document.createElement('div');
    status.className = 'fva-proposal-status';
    status.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'fva-proposal-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'fva-proposal-btn fva-proposal-confirm';
    confirmBtn.textContent = 'Confirm';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'fva-proposal-btn fva-proposal-cancel';
    cancelBtn.textContent = 'Cancel';

    const choose = (statusText, message) => {
      if (confirmBtn.disabled || cancelBtn.disabled) return;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      card.classList.add('is-done');
      if (activeProposal && activeProposal.cardEl === card) activeProposal = null;
      status.textContent = statusText;
      sendMessage(message);
    };
    confirmBtn.addEventListener('click', () => choose('You tapped Confirm', 'Confirm'));
    cancelBtn.addEventListener('click', () => choose('You cancelled this', 'Cancel'));

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    card.appendChild(status);

    wrap.appendChild(card);
    activeProposal = { id: (p.id !== undefined && p.id !== null ? p.id : null), lines, cardEl: card, noMatchPrompted: false };
    scrollMessagesToBottom(wrap);
    speakProposal(lines);
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
    scrollMessagesToBottom(wrap);
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
    scrollMessagesToBottom(wrap);
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
    scrollMessagesToBottom(wrap);
  }

  function appendBotMsg(text, at, msgId) {
    const wrap = body.querySelector('#fva-chat-messages');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'fva-msg bot';
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = '<div class="bot-label">🤖 ' + escapeHtml(botLabel()) + '</div>' + formatMsg(text) + '<div class="time">' + time + '</div>';
    wrap.appendChild(div);
    scrollMessagesToBottom(wrap);
    maybeSpeakBotText(text, msgId);
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
          if (m.sender === 'bot') appendBotMsg(m.message, m.created_at, m.id);
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
