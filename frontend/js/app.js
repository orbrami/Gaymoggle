/**
 * GAYMOGGLE — Main App
 * Socket.io + WebRTC + GayOMeter + UI
 */

// ── Constants ──────────────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls:       'turn:openrelay.metered.ca:80',
    username:   'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls:       'turn:openrelay.metered.ca:443',
    username:   'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls:       'turn:openrelay.metered.ca:443',
    username:   'openrelayproject',
    credential: 'openrelayproject',
    credentialType: 'password',
  },
];

const ICEBREAKERS = [
  "If you were a gay stereotype which one would you be?",
  "Rate your outfit right now, honestly",
  "What's your gay origin story?",
  "Slay, serve, or survive — this conversation",
  "Describe your vibe in 3 emojis",
  "Most iconic thing you've ever done?",
  "Camp, high femme, or butch? Defend it.",
  "If you had a drag name, what would it be?",
  "Assign yourself a Spice Girl name",
  "What song are you currently obsessed with?",
  "Tell me something that would make your mother worry",
  "On a scale of 1–10 how gay is your bedroom?",
  "Best and worst thing about your own vibe?",
  "What's your most unhinged personality trait?",
];

const GAY_LABELS = [
  { min:0,  label:'Straight as an Arrow',       emoji:'👔' },
  { min:1,  label:'Probably Just Metrosexual',  emoji:'💼' },
  { min:2,  label:'One Gay Friend Away',         emoji:'🤝' },
  { min:3,  label:'The "Ally"™',                emoji:'🏳️‍🌈'},
  { min:4,  label:'Bisexual Lighting™',          emoji:'💡' },
  { min:5,  label:'Technically Pan',             emoji:'🍳' },
  { min:6,  label:'Gay Coded',                   emoji:'🌈' },
  { min:7,  label:'Full-on Gay',                 emoji:'💅' },
  { min:8,  label:'Extremely Gay',               emoji:'👑' },
  { min:9,  label:'Mother of All Homos',         emoji:'🏆' },
  { min:9.5,label:'Certified Homosexual™',       emoji:'✨' },
];

const WIN_MSGS  = ["You're the gayest. Congratulations, icon.","Gay-O-Meter™ has spoken. You WIN.","Out-gayed the competition. Slay.","Certified more gay. Collect your trophy."];
const LOSE_MSGS = ["You were out-gayed. Train harder.","The gayer one won today. Not you. Yet.","They were gayer. Respect. Try again.","Your vibe didn't vibe hard enough."];
const TIE_MSGS  = ["A TIE?! You're both equally gay. Iconic.","Dead heat on the Gay-O-Meter™. Twinning!"];

// ── State ──────────────────────────────────────────────────────────────────
let socket        = null;
let pc            = null;   // RTCPeerConnection
let localStream   = null;
let matched       = false;
let myRole        = null;   // 'caller' | 'callee'
let callSeconds   = 0;
let timerInterval = null;
let ibIdx         = 0;
let myScore       = 5.0;
let strangerScore = 5.0;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnStart').addEventListener('click', startFlow);
  document.getElementById('msgInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
  });
  ibIdx = Math.floor(Math.random() * ICEBREAKERS.length);
  document.getElementById('ibText').textContent = ICEBREAKERS[ibIdx];
});

// ── Page Switcher ──────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
}

// ── Start Flow ─────────────────────────────────────────────────────────────
async function startFlow() {
  // 1. Get camera
  setStatus('searching', '📡 Requesting camera...');
  showPage('chat');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' },
      audio: { echoCancellation:true, noiseSuppression:true },
    });
    const lv = document.getElementById('localVideo');
    lv.srcObject = localStream;
    document.getElementById('youOverlay').classList.add('hidden');
  } catch(e) {
    addSys('⚠ Camera denied — you\'ll appear as black video. Others can still see you.');
  }

  // 2. Start Gay-O-Meter on local video
  GayOMeter.start(document.getElementById('localVideo'), score => {
    myScore = score;
    updateMeter('you', score);
    if (socket && matched) socket.emit('gay_score', { score });
  });

  // 3. Connect to signaling server
  connectSocket();
}

// ── Socket.io ──────────────────────────────────────────────────────────────
function connectSocket() {
  setStatus('searching', '🌐 Connecting to server...');

  socket = io(BACKEND_URL, {
    transports:        ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    setStatus('searching', '🔍 Finding your match...');
    socket.emit('find_match');
  });

  socket.on('connect_error', (e) => {
    console.error('Socket error:', e.message);
    setStatus('error', '⚠ Cannot reach server. Check BACKEND_URL in config.js.');
  });

  socket.on('online_count', n => {
    document.getElementById('onlineCount').textContent     = n;
    document.getElementById('onlineCountChat').textContent = n;
  });

  socket.on('waiting', () => {
    setStatus('searching', '👀 Waiting for someone gay enough for you...');
  });

  // ── Matched! ──
  socket.on('matched', async ({ partnerId, role }) => {
    console.log('Matched! role:', role, 'partner:', partnerId.slice(0,6));
    matched = true;
    myRole  = role;
    setStatus('connecting', '🤝 Match found! Connecting video...');
    await createPeerConnection();
    if (role === 'caller') {
      // We initiate — create offer
      await sendOffer();
    }
    // callee waits for offer event
  });

  // ── WebRTC signaling ──
  socket.on('webrtc_offer', async ({ offer }) => {
    if (!pc) await createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { answer });
  });

  socket.on('webrtc_answer', async ({ answer }) => {
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice_candidate', async ({ candidate }) => {
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){}
    }
  });

  // ── Chat ──
  socket.on('chat_message', ({ text }) => addMsg('stranger', text));
  socket.on('chat_reaction', ({ emoji }) => addReaction(emoji));
  socket.on('gay_score',    ({ score }) => {
    strangerScore = score;
    updateMeter('stranger', score);
  });

  // ── Partner left ──
  socket.on('partner_left', () => {
    addSys('Stranger disconnected. Hit Skip to find someone new.');
    setStatus('disconnected', 'Stranger left.');
    matched = false;
    clearInterval(timerInterval);
    resetStrangerVideo();
  });

  socket.on('disconnect', () => {
    if (matched) addSys('Connection lost. Reconnecting...');
  });
}

// ── WebRTC ─────────────────────────────────────────────────────────────────
async function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // ICE candidates → send to server to relay
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) socket.emit('ice_candidate', { candidate });
  };

  pc.oniceconnectionstatechange = () => {
    console.log('ICE state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      onVideoConnected();
    }
    if (pc.iceConnectionState === 'failed') {
      setStatus('error', '⚠ Video connection failed. Try skipping.');
    }
  };

  // Remote stream arrives
  pc.ontrack = ({ streams }) => {
    const sv = document.getElementById('strangerVideo');
    sv.srcObject = streams[0];
    sv.play().catch(() => {});
    document.getElementById('strangerOverlay').classList.add('hidden');
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      if (matched) addSys('Video connection dropped.');
    }
  };
}

async function sendOffer() {
  const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
  await pc.setLocalDescription(offer);
  socket.emit('webrtc_offer', { offer });
}

function onVideoConnected() {
  setStatus('connected', '🌈 Connected! Be iconic.');
  addSys("You're live! The Gay-O-Meter™ is watching.");
  startTimer();
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer() {
  callSeconds = 0;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s = String(callSeconds%60).padStart(2,'0');
    document.getElementById('callTimer').textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

// ── Gay Meter UI ───────────────────────────────────────────────────────────
function updateMeter(who, score) {
  const fillId  = who === 'you' ? 'youMeterFill'   : 'strangerMeterFill';
  const scoreId = who === 'you' ? 'youMeterScore'  : 'strangerMeterScore';
  const fill    = document.getElementById(fillId);
  const scoreEl = document.getElementById(scoreId);
  if (fill)    fill.style.width    = (score * 10) + '%';
  if (scoreEl) scoreEl.textContent = score.toFixed(1);
}

function getLabel(score) {
  let best = GAY_LABELS[0];
  for (const l of GAY_LABELS) { if (score >= l.min) best = l; }
  return best;
}

// ── Messages ───────────────────────────────────────────────────────────────
function addMsg(who, text) {
  const c   = document.getElementById('messages');
  const d   = document.createElement('div');
  d.className   = 'msg msg-' + who;
  d.textContent = text;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}
function addSys(text) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className   = 'sys-msg';
  d.textContent = text;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}
function addReaction(emoji) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className   = 'reaction-msg';
  d.textContent = emoji;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text || !socket) return;
  addMsg('you', text);
  input.value = '';
  socket.emit('chat_message', { text });
}

function sendReaction(emoji) {
  addReaction(emoji);
  if (socket) socket.emit('chat_reaction', { emoji });
}

// ── Icebreakers ────────────────────────────────────────────────────────────
function nextIcebreaker() {
  ibIdx = (ibIdx + 1) % ICEBREAKERS.length;
  document.getElementById('ibText').textContent = ICEBREAKERS[ibIdx];
}

// ── Controls ───────────────────────────────────────────────────────────────
function skip() {
  cleanup(false);
  resetStrangerVideo();
  clearInterval(timerInterval);
  document.getElementById('callTimer').textContent = '';
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🔍 Finding a new match...</div>';
  matched = false;
  if (socket) socket.emit('skip');
  setStatus('searching', '🔍 Finding your next match...');
}

function endAndRate() {
  const my  = GayOMeter.getScore();
  const str = strangerScore;
  cleanup(true);
  showResults(my, str);
}

function playAgain() {
  resetStrangerVideo();
  showPage('chat');
  matched = false;
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🌈 Welcome back. Be iconic.</div>';
  document.getElementById('callTimer').textContent = '';
  clearInterval(timerInterval);
  if (socket) socket.emit('find_match');
  setStatus('searching', '🔍 Finding your match...');
}

function cleanup(stopCamera) {
  GayOMeter.stop();
  clearInterval(timerInterval);
  if (pc) { pc.close(); pc = null; }
  if (stopCamera && localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
}

function resetStrangerVideo() {
  const sv = document.getElementById('strangerVideo');
  sv.srcObject = null;
  const ov = document.getElementById('strangerOverlay');
  ov.classList.remove('hidden');
  document.getElementById('searchText').textContent  = 'Searching...';
  document.getElementById('searchEmoji').textContent = '🔍';
  updateMeter('stranger', 0);
}

// ── Results ────────────────────────────────────────────────────────────────
function showResults(my, stranger) {
  showPage('results');

  const myR  = Math.round(my * 10) / 10;
  const strR = Math.round(stranger * 10) / 10;
  const won  = myR > strR;
  const tied = myR === strR;

  document.getElementById('resultCrown').textContent    = won ? '👑' : tied ? '🤝' : '😢';
  document.getElementById('resultHeadline').textContent = won ? 'YOU WIN!' : tied ? "IT'S A TIE!" : 'YOU LOSE.';
  document.getElementById('resultSub').textContent      = won
    ? WIN_MSGS[Math.floor(Math.random()*WIN_MSGS.length)]
    : tied
    ? TIE_MSGS[Math.floor(Math.random()*TIE_MSGS.length)]
    : LOSE_MSGS[Math.floor(Math.random()*LOSE_MSGS.length)];

  document.getElementById('yourScoreDisp').textContent    = myR.toFixed(1);
  document.getElementById('strangerScoreDisp').textContent = strR.toFixed(1);

  const myLabel  = getLabel(myR);
  const strLabel = getLabel(strR);
  document.getElementById('yourTag').textContent    = myLabel.emoji  + ' ' + myLabel.label;
  document.getElementById('strangerTag').textContent = strLabel.emoji + ' ' + strLabel.label;

  setTimeout(() => {
    document.getElementById('yourBar').style.height    = (myR  * 10) + '%';
    document.getElementById('strangerBar').style.height = (strR * 10) + '%';
  }, 200);

  if (won && typeof confetti !== 'undefined') {
    confetti({ particleCount:120, spread:80, colors:['#ff6ef7','#6ef7ff','#ffef6e','#6eff9e','#a06eff'] });
    setTimeout(() => confetti({ angle:60, spread:55, origin:{x:0}, particleCount:60, colors:['#ff6ef7','#6ef7ff','#ffef6e'] }), 300);
    setTimeout(() => confetti({ angle:120, spread:55, origin:{x:1}, particleCount:60, colors:['#ff6ef7','#6ef7ff','#ffef6e'] }), 300);
  }
}

function shareResult() {
  const my  = document.getElementById('yourScoreDisp').textContent;
  const str = document.getElementById('strangerScoreDisp').textContent;
  const won = parseFloat(my) > parseFloat(str);
  const text = won
    ? `I scored ${my}/10 on Gaymoggle's Gay-O-Meter™ and WON! 🏳️‍🌈 Can you beat me?`
    : `I scored ${my}/10 on Gaymoggle's Gay-O-Meter™. Stranger got ${str}. The gayer one always wins. 💅`;
  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text + ' #Gaymoggle'), '_blank');
}

// ── Video Filters ──────────────────────────────────────────────────────────
function setFilter(f, btn) {
  const v = document.getElementById('localVideo');
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // mirror is the default (CSS). Additional filters stack.
  v.dataset.filter = f;
  v.className = '';
  if (f === 'rainbow') v.classList.add('f-rainbow');
  if (f === 'glam')    v.classList.add('f-glam');
  // 'mirror' and 'none' handled by CSS below
}

// ── Status ─────────────────────────────────────────────────────────────────
function setStatus(type, text) {
  const dot  = document.getElementById('statusDot');
  const el   = document.getElementById('statusText');
  dot.className = 'sdot sdot-' + type;
  if (el) el.textContent = text;
}

// ── Report ─────────────────────────────────────────────────────────────────
function reportUser()    { document.getElementById('reportBackdrop').classList.remove('hidden'); }
function closeReport()   { document.getElementById('reportBackdrop').classList.add('hidden'); }
function submitReport(r) {
  closeReport();
  addSys(`Report submitted: "${r}". Thanks for keeping Gaymoggle safe.`);
}

// ── Confetti (CDN loaded below) ────────────────────────────────────────────
// Loaded lazily only on results page
const _confScript = document.createElement('script');
_confScript.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
document.head.appendChild(_confScript);
