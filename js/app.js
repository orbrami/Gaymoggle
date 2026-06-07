/**
 * GAYMOGGLE v3 — Main App
 * Features: accounts, leaderboard, 30s countdown, extra time, mirrored videos,
 *           score dots on face, save photo, rematch, return home, private rooms
 */

// ── Constants ──────────────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls:'turn:openrelay.metered.ca:80', username:'openrelayproject', credential:'openrelayproject' },
  { urls:'turn:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject' },
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
  { min:0,   label:'Straight as an Arrow',      emoji:'👔' },
  { min:1,   label:'Probably Just Metrosexual', emoji:'💼' },
  { min:2,   label:'One Gay Friend Away',        emoji:'🤝' },
  { min:3,   label:'The "Ally"™',               emoji:'🏳️‍🌈'},
  { min:4,   label:'Bisexual Lighting™',         emoji:'💡' },
  { min:5,   label:'Technically Pan',            emoji:'🍳' },
  { min:6,   label:'Gay Coded',                  emoji:'🌈' },
  { min:7,   label:'Full-on Gay',                emoji:'💅' },
  { min:8,   label:'Extremely Gay',              emoji:'👑' },
  { min:9,   label:'Mother of All Homos',        emoji:'🏆' },
  { min:9.5, label:'Certified Homosexual™',      emoji:'✨' },
];

const WIN_MSGS  = ["You're the gayest. Congratulations, icon.","Gay-O-Meter™ has spoken. You WIN.","Out-gayed the competition. Slay.","Certified more gay. Collect your trophy."];
const LOSE_MSGS = ["You were out-gayed. Train harder.","The gayer one won today. Not you. Yet.","They were gayer. Respect. Try again.","Your vibe didn't vibe hard enough."];
const TIE_MSGS  = ["A TIE?! You're both equally gay. Iconic.","Dead heat on the Gay-O-Meter™. Twinning!"];

const MATCH_DURATION  = 30;   // seconds
const EXTRA_DURATION  = 15;   // extra time seconds
const STABLE_THRESHOLD = 0.4; // score must be within ±0.4 to be "consistent"

// ── State ──────────────────────────────────────────────────────────────────
let socket         = null;
let pc             = null;
let localStream    = null;
let matched        = false;
let myRole         = null;
let callSeconds    = 0;
let timerInterval  = null;
let countdownInt   = null;
let ibIdx          = 0;
let myScore        = 5.0;
let strangerScore  = 5.0;
let myRecentScores = [];
let partnerName    = null;
let isExtraTime    = false;
let extraVoteGiven = false;
let rematchPartnerId = null;

// Account
let myUsername = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load saved username
  const saved = localStorage.getItem('gaymoggle_username');
  if (saved) {
    myUsername = saved;
    document.getElementById('usernameDisplay').textContent = saved;
    document.getElementById('navUsername').textContent = saved;
    document.getElementById('navUsername').classList.remove('hidden');
    document.getElementById('navLoginBtn').classList.add('hidden');
  }

  document.getElementById('btnStart').addEventListener('click', () => startFlow(false));
  document.getElementById('btnPrivate').addEventListener('click', showPrivateLobby);
  document.getElementById('btnLeaderboard').addEventListener('click', showLeaderboard);
  document.getElementById('btnCreateRoom').addEventListener('click', createRoom);
  document.getElementById('btnJoinRoom').addEventListener('click', joinRoom);
  document.getElementById('btnBackFromPrivate').addEventListener('click', () => showPage('landing'));
  document.getElementById('btnBackFromLeaderboard').addEventListener('click', () => showPage('landing'));
  document.getElementById('navLoginBtn').addEventListener('click', showAccountModal);
  document.getElementById('navUsername').addEventListener('click', showAccountModal);
  document.getElementById('btnSaveAccount').addEventListener('click', saveAccount);
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnCloseAccount').addEventListener('click', closeAccountModal);
  document.getElementById('msgInput').addEventListener('keydown', e => { if (e.key==='Enter') sendMessage(); });

  // Room code input uppercase
  document.getElementById('joinCodeInput').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });

  ibIdx = Math.floor(Math.random() * ICEBREAKERS.length);
  document.getElementById('ibText').textContent = ICEBREAKERS[ibIdx];
});

// ── Page Switcher ──────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
}

// ── Account ────────────────────────────────────────────────────────────────
function showAccountModal() {
  document.getElementById('accountModal').classList.remove('hidden');
  document.getElementById('accountInput').value = myUsername || '';
  document.getElementById('accountInput').focus();
  if (myUsername) {
    document.getElementById('btnLogout').classList.remove('hidden');
  } else {
    document.getElementById('btnLogout').classList.add('hidden');
  }
}

function closeAccountModal() {
  document.getElementById('accountModal').classList.add('hidden');
}

function saveAccount() {
  const val = document.getElementById('accountInput').value.trim().slice(0,20);
  if (!val) return;
  myUsername = val;
  localStorage.setItem('gaymoggle_username', val);
  document.getElementById('usernameDisplay').textContent = val;
  document.getElementById('navUsername').textContent = val;
  document.getElementById('navUsername').classList.remove('hidden');
  document.getElementById('navLoginBtn').classList.add('hidden');
  closeAccountModal();
  if (socket) socket.emit('set_username', { username: val });
}

function logout() {
  myUsername = null;
  localStorage.removeItem('gaymoggle_username');
  document.getElementById('navUsername').classList.add('hidden');
  document.getElementById('navLoginBtn').classList.remove('hidden');
  closeAccountModal();
}

// ── Leaderboard ────────────────────────────────────────────────────────────
function showLeaderboard() {
  showPage('leaderboard');
  if (!socket) initSocket(false);
  socket.emit('get_leaderboard');
}

function renderLeaderboard(data) {
  const { entries, seasonEnd } = data;

  // Countdown
  const remaining = Math.max(0, seasonEnd - Date.now());
  const days    = Math.floor(remaining / 86400000);
  const hours   = Math.floor((remaining % 86400000) / 3600000);
  const mins    = Math.floor((remaining % 3600000) / 60000);
  document.getElementById('seasonCountdown').textContent =
    `⏳ Season resets in: ${days}d ${hours}h ${mins}m`;

  // Podium
  const podiumEl = document.getElementById('podium');
  podiumEl.innerHTML = '';
  const top3 = entries.slice(0,3);
  const order = [1,0,2]; // 2nd, 1st, 3rd visual order
  order.forEach(idx => {
    if (!top3[idx]) return;
    const e = top3[idx];
    const place = idx+1;
    const div = document.createElement('div');
    div.className = `podium-spot podium-${place}`;
    div.innerHTML = `
      <div class="podium-crown">${place===1?'👑':place===2?'🥈':'🥉'}</div>
      <div class="podium-name">${esc(e.username)}</div>
      <div class="podium-wins">${e.wins} wins</div>
      <div class="podium-score">Best: ${e.score.toFixed(1)}</div>
      <div class="podium-base podium-base-${place}">#${place}</div>
    `;
    podiumEl.appendChild(div);
  });

  // List
  const listEl = document.getElementById('leaderboardList');
  listEl.innerHTML = '';
  entries.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'lb-row' + (i<3?' lb-top':'');
    div.innerHTML = `
      <span class="lb-rank">#${i+1}</span>
      <span class="lb-name">${esc(e.username)}</span>
      <span class="lb-wins">${e.wins}W</span>
      <span class="lb-games">${e.gamesPlayed} games</span>
      <span class="lb-score">${e.score.toFixed(1)}/10</span>
    `;
    listEl.appendChild(div);
  });

  if (!entries.length) {
    listEl.innerHTML = '<div class="lb-empty">No scores yet this season. Be the first! 🌈</div>';
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Private Lobby ──────────────────────────────────────────────────────────
function showPrivateLobby() {
  showPage('private');
  document.getElementById('createdCode').textContent = '';
  document.getElementById('privateStatus').textContent = '';
  document.getElementById('joinCodeInput').value = '';
  if (!socket) initSocket(false);
}

function createRoom() {
  if (!socket) initSocket(false);
  socket.emit('create_room');
  document.getElementById('privateStatus').textContent = '⏳ Creating room...';
}

function joinRoom() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (code.length < 4) { document.getElementById('privateStatus').textContent = '⚠ Enter the 6-character code'; return; }
  if (!socket) initSocket(false);
  document.getElementById('privateStatus').textContent = '⏳ Joining room...';
  socket.emit('join_room', { code });
}

// ── Start Flow ─────────────────────────────────────────────────────────────
async function startFlow(skipSocketInit) {
  setStatus('searching','📡 Requesting camera...');
  showPage('chat');
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🏳️‍🌈 Welcome. Be iconic.</div>';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video:{ width:{ideal:1280}, height:{ideal:720}, facingMode:'user' },
      audio:{ echoCancellation:true, noiseSuppression:true },
    });
    const lv = document.getElementById('localVideo');
    lv.srcObject = localStream;
    document.getElementById('youOverlay').classList.add('hidden');
  } catch(e) {
    addSys('⚠ Camera denied — you\'ll appear as black video.');
  }

  GayOMeter.start(document.getElementById('localVideo'), (score, landmarks) => {
    myScore = score;
    updateMeter('you', score);
    trackScore(score);
    drawScoreDots('youCanvas', landmarks, score);
    if (socket && matched) socket.emit('gay_score', { score });
  });

  if (!skipSocketInit) connectSocket();
}

// ── Track recent scores for consistency check ──────────────────────────────
function trackScore(score) {
  myRecentScores.push(score);
  if (myRecentScores.length > 10) myRecentScores.shift();
}

function isScoreStable() {
  if (myRecentScores.length < 5) return false;
  const recent = myRecentScores.slice(-5);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  return (max - min) <= STABLE_THRESHOLD;
}

// ── Score Dots on Face ─────────────────────────────────────────────────────
function drawScoreDots(canvasId, landmarks, score) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !landmarks || !landmarks.length) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const numDots = Math.round(score);
  // Place dots along jawline / face outline
  const positions = [0,2,4,6,8,10,12,14,16].slice(0, numDots); // jawline points
  const hue = (score / 10) * 280; // green → purple

  positions.forEach((ptIdx, i) => {
    if (!landmarks[ptIdx]) return;
    const x = (landmarks[ptIdx].x / 160) * canvas.width;
    const y = (landmarks[ptIdx].y / 120) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI*2);
    ctx.fillStyle = `hsla(${hue},100%,65%,0.85)`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

// ── Socket.io ──────────────────────────────────────────────────────────────
function initSocket(andMatch) {
  if (socket && socket.connected) {
    if (andMatch) socket.emit('find_match');
    return;
  }
  connectSocket(andMatch);
}

function connectSocket(andMatch) {
  setStatus('searching','🌐 Connecting to server...');
  socket = io(BACKEND_URL, {
    transports:['websocket','polling'],
    reconnectionDelay:1000,
    reconnectionAttempts:10,
  });

  socket.on('connect', () => {
    if (myUsername) socket.emit('set_username', { username: myUsername });
    if (andMatch !== false) {
      setStatus('searching','🔍 Finding your match...');
      socket.emit('find_match');
    }
  });

  socket.on('connect_error', e => {
    setStatus('error','⚠ Cannot reach server. Check BACKEND_URL in config.js.');
  });

  socket.on('online_count', n => {
    document.getElementById('onlineCount').textContent = n;
    document.getElementById('onlineCountChat').textContent = n;
  });

  socket.on('waiting', () => {
    setStatus('searching','👀 Waiting for someone gay enough for you...');
  });

  // Private room events
  socket.on('room_created', ({ code }) => {
    document.getElementById('createdCode').textContent = code;
    document.getElementById('privateStatus').textContent = '⏳ Waiting for someone to join...';
    // Trigger camera + wait
    startFlow(true);
    setStatus('searching', `🔐 Private room: ${code} — waiting...`);
  });

  socket.on('room_error', ({ msg }) => {
    document.getElementById('privateStatus').textContent = '⚠ ' + msg;
  });

  // Leaderboard
  socket.on('leaderboard_data', renderLeaderboard);
  socket.on('leaderboard_reset', () => {
    if (document.getElementById('page-leaderboard').classList.contains('active')) {
      socket.emit('get_leaderboard');
    }
  });

  // ── Matched! ──
  socket.on('matched', async ({ partnerId, role, partnerName: pn }) => {
    matched  = true;
    myRole   = role;
    partnerName = pn || null;
    rematchPartnerId = partnerId;
    setStatus('connecting','🤝 Match found! Connecting video...');
    // If we're coming from private page, switch to chat
    if (!document.getElementById('page-chat').classList.contains('active')) {
      showPage('chat');
    }
    await createPeerConnection();
    if (role === 'caller') await sendOffer();
  });

  // ── WebRTC ──
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
    if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){} }
  });

  // ── Chat ──
  socket.on('chat_message', ({ text }) => addMsg('stranger', text));
  socket.on('chat_reaction', ({ emoji }) => addReaction(emoji));
  socket.on('gay_score', ({ score }) => {
    strangerScore = score;
    updateMeter('stranger', score);
  });

  // ── Extra time ──
  socket.on('extra_time_vote', () => {
    if (!isExtraTime && !extraVoteGiven) {
      addSys('⚡ Stranger wants extra time!');
    }
  });

  // ── Rematch ──
  socket.on('rematch_requested', () => {
    document.getElementById('rematchNotice').classList.remove('hidden');
  });
  socket.on('rematch_start', () => {
    document.getElementById('rematchNotice').classList.add('hidden');
    startRematch();
  });

  // ── Partner left ──
  socket.on('partner_left', () => {
    addSys('Stranger disconnected. Hit Skip to find someone new.');
    setStatus('disconnected','Stranger left.');
    matched = false;
    clearInterval(timerInterval);
    clearInterval(countdownInt);
    resetStrangerVideo();
    hideCountdown();
  });

  socket.on('disconnect', () => {
    if (matched) addSys('Connection lost. Reconnecting...');
  });
}

// ── WebRTC ─────────────────────────────────────────────────────────────────
async function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) socket.emit('ice_candidate', { candidate });
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState==='connected'||pc.iceConnectionState==='completed') onVideoConnected();
    if (pc.iceConnectionState==='failed') setStatus('error','⚠ Video connection failed. Try skipping.');
  };
  pc.ontrack = ({ streams }) => {
    const sv = document.getElementById('strangerVideo');
    sv.srcObject = streams[0];
    sv.play().catch(()=>{});
    document.getElementById('strangerOverlay').classList.add('hidden');
  };
  pc.onconnectionstatechange = () => {
    if ((pc.connectionState==='disconnected'||pc.connectionState==='failed') && matched) addSys('Video connection dropped.');
  };
}

async function sendOffer() {
  const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
  await pc.setLocalDescription(offer);
  socket.emit('webrtc_offer', { offer });
}

function onVideoConnected() {
  setStatus('connected','🌈 Connected! Be iconic.');
  const name = partnerName ? `You matched with ${partnerName}!` : "You're live! The Gay-O-Meter™ is watching.";
  addSys(name);
  startCountdown();
}

// ── Countdown Timer ────────────────────────────────────────────────────────
function startCountdown(duration) {
  const secs = duration || MATCH_DURATION;
  let remaining = secs;
  isExtraTime = (duration === EXTRA_DURATION);
  extraVoteGiven = false;

  clearInterval(countdownInt);
  clearInterval(timerInterval);
  callSeconds = 0;

  document.getElementById('countdownBar').style.display = 'flex';
  updateCountdownUI(remaining, secs);

  countdownInt = setInterval(() => {
    remaining--;
    callSeconds++;
    updateCountdownUI(remaining, secs);

    // Last 5 seconds: check consistency → extra time
    if (remaining <= 5 && remaining > 0 && !isExtraTime) {
      checkForExtraTime(remaining);
    }

    if (remaining <= 0) {
      clearInterval(countdownInt);
      if (isExtraTime) {
        // Extra time over — force end
        endAndRate();
      } else {
        // Normal time over
        endAndRate();
      }
    }
  }, 1000);
}

function updateCountdownUI(remaining, total) {
  const el    = document.getElementById('countdownNumber');
  const fill  = document.getElementById('countdownFill');
  const label = document.getElementById('countdownLabel');
  if (!el) return;
  el.textContent = remaining;
  fill.style.width = ((remaining / total) * 100) + '%';
  if (isExtraTime) {
    label.textContent = '⚡ EXTRA TIME';
    fill.style.background = 'linear-gradient(90deg,#ff6e6e,#ffef6e)';
  } else {
    label.textContent = '⏱ MATCH TIME';
    fill.style.background = 'var(--grad-gay)';
  }
  if (remaining <= 5) {
    el.style.color = '#ff6e6e';
    el.style.animation = 'countdownPulse .5s ease-in-out infinite';
  } else {
    el.style.color = '';
    el.style.animation = '';
  }
}

function hideCountdown() {
  document.getElementById('countdownBar').style.display = 'none';
  clearInterval(countdownInt);
}

function checkForExtraTime(remaining) {
  if (extraVoteGiven) return;
  const myStable  = isScoreStable();
  const strStable = Math.abs(strangerScore - myScore) <= 0.5; // proxy
  if (myStable && strStable) {
    addSys('⚡ Scores are too close! Voting for EXTRA TIME...');
    extraVoteGiven = true;
    if (socket) socket.emit('extra_time_vote');
    // Give extra time regardless (since we decided based on our local state)
    clearInterval(countdownInt);
    setTimeout(() => startCountdown(EXTRA_DURATION), 1000);
  }
}

// ── Gay Meter UI ───────────────────────────────────────────────────────────
function updateMeter(who, score) {
  const fillId  = who==='you' ? 'youMeterFill'  : 'strangerMeterFill';
  const scoreId = who==='you' ? 'youMeterScore' : 'strangerMeterScore';
  const fill    = document.getElementById(fillId);
  const scoreEl = document.getElementById(scoreId);
  if (fill)    fill.style.width    = (score*10)+'%';
  if (scoreEl) scoreEl.textContent = score.toFixed(1);
}

function getLabel(score) {
  let best = GAY_LABELS[0];
  for (const l of GAY_LABELS) { if (score >= l.min) best = l; }
  return best;
}

// ── Messages ───────────────────────────────────────────────────────────────
function addMsg(who, text) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className   = 'msg msg-'+who;
  d.textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function addSys(text) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className   = 'sys-msg';
  d.textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function addReaction(emoji) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className   = 'reaction-msg';
  d.textContent = emoji;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
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
  ibIdx = (ibIdx+1) % ICEBREAKERS.length;
  document.getElementById('ibText').textContent = ICEBREAKERS[ibIdx];
}

// ── Controls ───────────────────────────────────────────────────────────────
function skip() {
  cleanup(false);
  resetStrangerVideo();
  clearInterval(timerInterval);
  clearInterval(countdownInt);
  hideCountdown();
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🔍 Finding a new match...</div>';
  matched = false;
  if (socket) socket.emit('skip');
  setStatus('searching','🔍 Finding your next match...');
}

function endAndRate() {
  clearInterval(countdownInt);
  const my  = GayOMeter.getScore();
  const str = strangerScore;
  cleanup(true);
  showResults(my, str);
}

function returnHome() {
  cleanup(true);
  resetStrangerVideo();
  matched = false;
  rematchPartnerId = null;
  showPage('landing');
}

function requestRematch() {
  if (!socket || !rematchPartnerId) return;
  socket.emit('request_rematch');
  document.getElementById('rematchBtn').textContent = '⏳ Waiting...';
  document.getElementById('rematchBtn').disabled = true;
}

function acceptRematch() {
  if (!socket) return;
  socket.emit('accept_rematch');
}

function startRematch() {
  // Reset state for a new match
  matched = false;
  myRecentScores = [];
  isExtraTime = false;
  extraVoteGiven = false;
  document.getElementById('rematchNotice').classList.add('hidden');
  document.getElementById('rematchBtn').textContent = '🔁 Rematch';
  document.getElementById('rematchBtn').disabled = false;

  showPage('chat');
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🔥 Rematch started!</div>';
  updateMeter('you', 5); updateMeter('stranger', 5);
  resetStrangerVideo();

  // Restart gayometer on same stream
  if (localStream) {
    const lv = document.getElementById('localVideo');
    lv.srcObject = localStream;
    GayOMeter.start(lv, (score, landmarks) => {
      myScore = score;
      updateMeter('you', score);
      trackScore(score);
      drawScoreDots('youCanvas', landmarks, score);
      if (socket && matched) socket.emit('gay_score', { score });
    });
  }
}

function playAgain() {
  cleanup(false);
  resetStrangerVideo();
  showPage('chat');
  matched = false;
  myRecentScores = [];
  document.getElementById('messages').innerHTML = '<div class="sys-msg">🌈 Welcome back. Be iconic.</div>';
  hideCountdown();

  if (!localStream) {
    startFlow(false);
  } else {
    if (socket) socket.emit('find_match');
    setStatus('searching','🔍 Finding your match...');
  }
}

function cleanup(stopCamera) {
  GayOMeter.stop();
  clearInterval(timerInterval);
  clearInterval(countdownInt);
  if (pc) { pc.close(); pc = null; }
  if (stopCamera && localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
}

function resetStrangerVideo() {
  const sv = document.getElementById('strangerVideo');
  sv.srcObject = null;
  document.getElementById('strangerOverlay').classList.remove('hidden');
  document.getElementById('searchText').textContent  = 'Searching...';
  document.getElementById('searchEmoji').textContent = '🔍';
  updateMeter('stranger', 0);
  // Clear stranger canvas dots
  const sc = document.getElementById('strangerCanvas');
  if (sc) sc.getContext('2d').clearRect(0,0,sc.width,sc.height);
}

// ── Results ────────────────────────────────────────────────────────────────
function showResults(my, stranger) {
  showPage('results');
  document.getElementById('rematchBtn').textContent = '🔁 Rematch';
  document.getElementById('rematchBtn').disabled = false;
  document.getElementById('rematchNotice').classList.add('hidden');

  const myR  = Math.round(my*10)/10;
  const strR = Math.round(stranger*10)/10;
  const won  = myR > strR;
  const tied = myR === strR;

  document.getElementById('resultCrown').textContent    = won?'👑':tied?'🤝':'😢';
  document.getElementById('resultHeadline').textContent = won?'YOU WIN!':tied?"IT'S A TIE!":'YOU LOSE.';
  document.getElementById('resultSub').textContent      = won
    ? WIN_MSGS[Math.floor(Math.random()*WIN_MSGS.length)]
    : tied
    ? TIE_MSGS[Math.floor(Math.random()*TIE_MSGS.length)]
    : LOSE_MSGS[Math.floor(Math.random()*LOSE_MSGS.length)];

  document.getElementById('yourScoreDisp').textContent    = myR.toFixed(1);
  document.getElementById('strangerScoreDisp').textContent = strR.toFixed(1);

  const myLabel  = getLabel(myR);
  const strLabel = getLabel(strR);
  document.getElementById('yourTag').textContent    = myLabel.emoji+' '+myLabel.label;
  document.getElementById('strangerTag').textContent = strLabel.emoji+' '+strLabel.label;

  const winnerName = won ? (myUsername||'YOU') : (partnerName||'STRANGER');
  document.getElementById('winnerName').textContent = winnerName + ' is GAYER! 🏆';

  setTimeout(() => {
    document.getElementById('yourBar').style.height    = (myR*10)+'%';
    document.getElementById('strangerBar').style.height = (strR*10)+'%';
  }, 200);

  if (won && typeof confetti !== 'undefined') {
    confetti({ particleCount:120, spread:80, colors:['#ff6ef7','#6ef7ff','#ffef6e','#6eff9e','#a06eff'] });
    setTimeout(()=>confetti({ angle:60, spread:55, origin:{x:0}, particleCount:60, colors:['#ff6ef7','#6ef7ff','#ffef6e'] }),300);
    setTimeout(()=>confetti({ angle:120, spread:55, origin:{x:1}, particleCount:60, colors:['#ff6ef7','#6ef7ff','#ffef6e'] }),300);
  }

  // Submit to leaderboard
  if (myUsername && socket) {
    socket.emit('submit_result', { username: myUsername, score: myR, won });
  }
}

// ── Save Photo ─────────────────────────────────────────────────────────────
async function saveResultPhoto() {
  const el = document.getElementById('results-wrap');
  try {
    // Use html2canvas if available, else fallback
    if (typeof html2canvas !== 'undefined') {
      const canvas = await html2canvas(el, { backgroundColor: '#07070f', scale: 2 });
      const link = document.createElement('a');
      link.download = 'gaymoggle-result.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } else {
      // Fallback: share via Web Share API
      shareResult();
    }
  } catch(e) {
    shareResult();
  }
}

function shareResult() {
  const my  = document.getElementById('yourScoreDisp').textContent;
  const str = document.getElementById('strangerScoreDisp').textContent;
  const won = parseFloat(my) > parseFloat(str);
  const text = won
    ? `I scored ${my}/10 on Gaymoggle's Gay-O-Meter™ and WON! 🏳️‍🌈 Can you beat me?`
    : `I scored ${my}/10 on Gaymoggle's Gay-O-Meter™. Stranger got ${str}. The gayer one always wins. 💅`;
  if (navigator.share) {
    navigator.share({ title:'Gaymoggle Result', text: text + ' #Gaymoggle' }).catch(()=>{});
  } else {
    window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text+' #Gaymoggle'),'_blank');
  }
}

// ── Video Filters ──────────────────────────────────────────────────────────
function setFilter(f, btn) {
  const v = document.getElementById('localVideo');
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  v.className = '';
  if (f==='rainbow') v.classList.add('f-rainbow');
  if (f==='glam')    v.classList.add('f-glam');
}

// ── Status ─────────────────────────────────────────────────────────────────
function setStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const el  = document.getElementById('statusText');
  dot.className = 'sdot sdot-'+type;
  if (el) el.textContent = text;
}

// ── Report ─────────────────────────────────────────────────────────────────
function reportUser()    { document.getElementById('reportBackdrop').classList.remove('hidden'); }
function closeReport()   { document.getElementById('reportBackdrop').classList.add('hidden'); }
function submitReport(r) { closeReport(); addSys(`Report submitted: "${r}". Thanks for keeping Gaymoggle safe.`); }

// ── Confetti ───────────────────────────────────────────────────────────────
const _confScript = document.createElement('script');
_confScript.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
document.head.appendChild(_confScript);

// html2canvas for photo saving
const _h2cScript = document.createElement('script');
_h2cScript.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
document.head.appendChild(_h2cScript);
