/* ── GAYMOGGLE v3 — Main App ─────────────────────────────────────────────── */

// ── ICE servers ──────────────────────────────────────────────────────────────
const ICE = [
  { urls:'stun:stun.l.google.com:19302' },
  { urls:'stun:stun1.l.google.com:19302' },
  { urls:'turn:openrelay.metered.ca:80',  username:'openrelayproject', credential:'openrelayproject' },
  { urls:'turn:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject' },
];

const ICEBREAKERS = [
  "If you were a gay stereotype, which one?",
  "Rate your outfit right now, honestly",
  "What's your gay origin story?",
  "Slay, serve, or survive — this conversation",
  "Describe your vibe in 3 emojis",
  "Most iconic thing you've ever done?",
  "If you had a drag name, what would it be?",
  "On a scale of 1–10 how gay is your bedroom?",
  "Assign yourself a Spice Girl name",
  "Most unhinged thing you've ever worn?",
  "Who's your gay icon?",
  "What would your villain origin story be?",
  "Rate this conversation so far, out of 10",
];

const WIN_LINES  = ["You're the gayest. Congratulations, icon.","Gay-O-Meter™ has spoken. You WIN.","Out-gayed the competition. Absolute slay.","Certified more gay. Collect your trophy.","The algorithm bowed down. You won."];
const LOSE_LINES = ["You were out-gayed. Train harder.","The gayer one won today. Not you. Yet.","They were gayer. Respect. Come back stronger.","Your vibe didn't vibe hard enough.","So close. So straight. Try again."];
const TIE_LINES  = ["A TIE?! You're both equally gay. Iconic.","Dead heat on the Gay-O-Meter™. Twinning!","The universe is balanced. You're both gay."];

const MATCH_DURATION  = 30;  // seconds
const OVERTIME_EXTRA  = 15;  // extra seconds
const STABILITY_WINDOW = 8;  // last N scores checked for stability
const STABILITY_THRESH = 0.6; // max range to be "stable"

// ── State ─────────────────────────────────────────────────────────────────────
let socket      = null;
let pc          = null;
let localStream = null;
let matched     = false;
let matchMode   = 'random'; // 'random' | 'private' | 'rematch'
let partnerName = 'Stranger';
let isOvertimeActive  = false;
let matchTimer  = null;
let callTimer   = null;
let matchSeconds = 0;
let callSeconds  = 0;
let ibIdx        = 0;
let myScore      = 5.0;
let strangerScore= 5.0;
let lastMyScore  = 5.0;
let waitingForRematchAnswer = false;
let myRoomCode   = null;  // if I created a private room

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function showPage(id) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $(id).classList.add('active');
}

function setStatus(type, text) {
  const dot = $('statusDot'), el = $('statusText');
  if (dot) dot.className = 'sdot sdot-' + type;
  if (el)  el.textContent = text;
}

function addMsg(who, text) {
  const c = $('messages'), d = document.createElement('div');
  d.className = 'msg msg-'+who; d.textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function addSys(text) {
  const c = $('messages'), d = document.createElement('div');
  d.className = 'sys-msg'; d.textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function addReaction(emoji) {
  const c = $('messages'), d = document.createElement('div');
  d.className = 'reaction-msg'; d.textContent = emoji;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkSeason();
  initUsernameCheck();
  initIcebreaker();
  $('msgInput')?.addEventListener('keydown', e => { if (e.key==='Enter') sendMessage(); });

  // Copy room code button
  $('copyCodeBtn')?.addEventListener('click', () => {
    if (myRoomCode) {
      navigator.clipboard?.writeText(myRoomCode).catch(()=>{});
      $('copyCodeBtn').textContent = '✓ Copied!';
      setTimeout(()=>{ $('copyCodeBtn').textContent='📋 Copy Code'; }, 2000);
    }
  });

  // Join room on enter
  $('joinCodeInput')?.addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });
});

// ── Username / Account ────────────────────────────────────────────────────────
function initUsernameCheck() {
  const username = stGet('username');
  if (username) {
    showMainMenu(username);
  } else {
    showPage('page-setup');
  }
  updateProfileDisplay();
}

function saveUsername() {
  const input = $('usernameInput');
  const name  = input?.value.trim().slice(0, 24);
  if (!name || name.length < 2) {
    input?.classList.add('error');
    $('usernameError').textContent = 'At least 2 characters!';
    return;
  }
  stSet('username', name);
  updateLeaderboardEntry();
  showMainMenu(name);
}

function showMainMenu(username) {
  showPage('page-home');
  updateProfileDisplay();
}

function updateProfileDisplay() {
  const d   = stLoad();
  const name = d.username || '';
  $$('.display-username').forEach(el => el.textContent = name || '—');
  $$('.display-gp').forEach(el       => el.textContent = (d.totalGP||0).toLocaleString());
  $$('.display-season-gp').forEach(el=> el.textContent = (d.seasonGP||0).toLocaleString());
  $$('.display-wins').forEach(el     => el.textContent = (d.wins||0));
  $$('.display-streak').forEach(el   => el.textContent = (d.streak||0));
  if ($('navUsername')) $('navUsername').textContent = name;
  if ($('navGP'))       $('navGP').textContent = (d.totalGP||0).toLocaleString() + ' GP';
}

// ── Start random match ────────────────────────────────────────────────────────
async function startRandom() {
  matchMode = 'random';
  await initChat();
  socket.emit('find_match');
  setStatus('searching','🔍 Finding your match...');
}

// ── Private room: create ──────────────────────────────────────────────────────
async function createPrivateRoom() {
  matchMode = 'private';
  await initChat();
  socket.emit('create_room');
}

// ── Private room: join ────────────────────────────────────────────────────────
async function joinRoom() {
  const code = $('joinCodeInput')?.value.trim().toUpperCase();
  if (!code || code.length < 4) return;
  matchMode = 'private';
  await initChat(true); // skipPageSwitch to show the waiting state inline
  socket.emit('join_room', { code });
  setStatus('searching', `🔗 Joining room ${code}...`);
}

// ── Init chat (camera + socket) ───────────────────────────────────────────────
let chatInitialized = false;
async function initChat(skipPageSwitch) {
  if (!skipPageSwitch) showPage('page-chat');
  else                 showPage('page-chat');

  if (!chatInitialized) {
    chatInitialized = true;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video:{ width:{ideal:1280}, height:{ideal:720}, facingMode:'user' },
        audio:{ echoCancellation:true, noiseSuppression:true },
      });
      const lv = $('localVideo');
      lv.srcObject  = localStream;
      $('youOverlay').classList.add('hidden');
    } catch(e) {
      addSys('⚠ Camera denied — text chat only.');
    }

    // Start Gay-O-Meter with overlay canvas
    GayOMeter.start($('localVideo'), $('youDotCanvas'), score => {
      myScore = score;
      updateMeter('you', score);
    });

    connectSocket();
  }
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
function connectSocket() {
  if (socket?.connected) return;

  setStatus('searching','🌐 Connecting...');
  socket = io(BACKEND_URL, { transports:['websocket','polling'], reconnectionAttempts:10 });

  socket.on('connect', () => {
    socket.emit('set_username', { username: stGet('username') || 'Anonymous' });
    setStatus('searching','🔍 Ready. Finding match...');
  });

  socket.on('connect_error', e => setStatus('error','⚠ Server unreachable. Check config.js'));

  socket.on('online_count', n => {
    $$('.online-count').forEach(el => el.textContent = n);
  });

  socket.on('waiting', () => setStatus('searching','👀 Waiting for an opponent...'));

  socket.on('room_created', ({ code }) => {
    myRoomCode = code;
    $('roomCodeDisplay').textContent = code;
    $('privateRoomWaiting').classList.remove('hidden');
    setStatus('searching', `🔐 Room ${code} created. Waiting...`);
  });

  socket.on('room_error', ({ msg }) => {
    $('joinError').textContent = msg;
    setStatus('error', '⚠ ' + msg);
  });

  socket.on('matched', async ({ partnerId, partnerName: pName, role, mode }) => {
    matched     = true;
    partnerName = pName || 'Stranger';
    matchMode   = mode;
    $('privateRoomWaiting').classList.add('hidden');
    $('strangerNameDisplay').textContent = partnerName;
    setStatus('connecting','🤝 Match found! Connecting...');
    addSys(`Matched with ${partnerName}!`);
    await createPC();
    if (role === 'caller') await sendOffer();
  });

  socket.on('webrtc_offer',  async ({ offer })     => { if (!pc) await createPC(); await pc.setRemoteDescription(new RTCSessionDescription(offer)); const a = await pc.createAnswer(); await pc.setLocalDescription(a); socket.emit('webrtc_answer',{ answer:a }); });
  socket.on('webrtc_answer', async ({ answer })    => { if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)); });
  socket.on('ice_candidate', async ({ candidate }) => { if (pc && candidate) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){} });

  socket.on('chat_message',  ({ text })  => addMsg('stranger', text));
  socket.on('chat_reaction', ({ emoji }) => addReaction(emoji));
  socket.on('gay_score',     ({ score }) => {
    strangerScore = score;
    updateMeter('stranger', score);
    updateStrangerDotColor(score);
  });

  socket.on('partner_left', () => {
    addSys(`${partnerName} disconnected.`);
    setStatus('disconnected','Partner left.');
    onMatchEnd(false);
  });

  socket.on('rematch_requested', () => {
    showRematchPrompt();
  });

  socket.on('rematch_declined', () => {
    hideRematchPrompt();
    addSys('Rematch declined.');
  });

  socket.on('disconnect', () => { if (matched) addSys('Connection lost.'); });
}

// ── WebRTC ────────────────────────────────────────────────────────────────────
async function createPC() {
  pc = new RTCPeerConnection({ iceServers: ICE });
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.onicecandidate = ({ candidate }) => { if (candidate && socket) socket.emit('ice_candidate',{ candidate }); };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') onVideoConnected();
    if (pc.iceConnectionState === 'failed') setStatus('error','⚠ Video failed. Try skipping.');
  };

  pc.ontrack = ({ streams }) => {
    const sv = $('strangerVideo');
    sv.srcObject = streams[0];
    sv.play().catch(()=>{});
    $('strangerOverlay').classList.add('hidden');
  };
}

async function sendOffer() {
  const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
  await pc.setLocalDescription(offer);
  socket.emit('webrtc_offer',{ offer });
}

function onVideoConnected() {
  setStatus('connected', `🌈 Connected with ${partnerName}!`);
  addSys(`You're live! 30 seconds on the Gay-O-Meter™. Go!`);
  startMatchCountdown();
  startCallTimer();
}

// ── Match Countdown ───────────────────────────────────────────────────────────
function startMatchCountdown() {
  matchSeconds = MATCH_DURATION;
  isOvertimeActive = false;
  clearInterval(matchTimer);
  updateCountdownDisplay(matchSeconds, false);

  matchTimer = setInterval(() => {
    matchSeconds--;
    updateCountdownDisplay(matchSeconds, isOvertimeActive);

    // Check for stability in last 5 seconds → possible overtime
    if (matchSeconds <= 5 && matchSeconds > 0 && !isOvertimeActive) {
      if (GayOMeter.checkStability(STABILITY_WINDOW, STABILITY_THRESH)) {
        // Scores are too close — will trigger overtime at 0
        showOvertimeWarning();
      }
    }

    if (matchSeconds <= 0) {
      clearInterval(matchTimer);
      if (!isOvertimeActive && GayOMeter.checkStability(STABILITY_WINDOW, STABILITY_THRESH)) {
        triggerOvertime();
      } else {
        onMatchEnd(true);
      }
    }
  }, 1000);
}

function triggerOvertime() {
  isOvertimeActive = true;
  matchSeconds = OVERTIME_EXTRA;
  addSys('⚡ OVERTIME! Scores too close — 15 more seconds!');
  showOvertimeBanner();

  // Mark achievement
  const d = stLoad();
  d._overtime = true;
  stSave(d);
  checkAchievements(d);

  matchTimer = setInterval(() => {
    matchSeconds--;
    updateCountdownDisplay(matchSeconds, true);
    if (matchSeconds <= 0) {
      clearInterval(matchTimer);
      onMatchEnd(true);
    }
  }, 1000);
}

function updateCountdownDisplay(secs, overtime) {
  const el = $('matchCountdown');
  if (!el) return;
  el.textContent = secs > 0 ? secs : '0';
  el.className   = 'match-countdown' + (overtime ? ' overtime' : '') + (secs <= 5 ? ' urgent' : '');
}

function showOvertimeWarning() {
  const el = $('overtimeWarning');
  if (el) el.classList.remove('hidden');
}
function showOvertimeBanner() {
  const el = $('overtimeBanner');
  if (el) { el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000); }
  const el2 = $('overtimeWarning');
  if (el2) el2.classList.add('hidden');
}

function startCallTimer() {
  callSeconds = 0;
  clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s = String(callSeconds%60).padStart(2,'0');
    const el = $('callTimer');
    if (el) el.textContent = `⏱ ${m}:${s}`;
  },1000);
}

// ── Meters ────────────────────────────────────────────────────────────────────
function updateMeter(who, score) {
  const fid = who==='you' ? 'youMeterFill'   : 'strangerMeterFill';
  const sid = who==='you' ? 'youMeterScore'  : 'strangerMeterScore';
  const f   = $(fid), s = $(sid);
  if (f) f.style.width    = (score*10) + '%';
  if (s) s.textContent    = score.toFixed(1);
}

function updateStrangerDotColor(score) {
  // Change stranger video border color based on their score
  const el = $('strangerVideoWrap');
  if (!el) return;
  const hue = score * 27; // 0=red(0°) → 10=green(270°) roughly
  el.style.borderColor = `hsl(${hue},100%,60%)`;
}

// ── Gay Meter labels ──────────────────────────────────────────────────────────
// (getLabel is defined in storage.js)

// ── Messages ──────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = $('msgInput');
  const text  = input?.value.trim();
  if (!text || !socket) return;
  addMsg('you', text);
  input.value = '';
  socket.emit('chat_message',{ text });
}

function sendReaction(emoji) {
  addReaction(emoji);
  if (socket) socket.emit('chat_reaction',{ emoji });
}

// ── Icebreaker ────────────────────────────────────────────────────────────────
function initIcebreaker() {
  ibIdx = Math.floor(Math.random()*ICEBREAKERS.length);
  const el = $('ibText');
  if (el) el.textContent = ICEBREAKERS[ibIdx];
}
function nextIcebreaker() {
  ibIdx = (ibIdx+1) % ICEBREAKERS.length;
  const el = $('ibText');
  if (el) el.textContent = ICEBREAKERS[ibIdx];
}

// ── Match End ─────────────────────────────────────────────────────────────────
function onMatchEnd(showResults) {
  clearInterval(matchTimer);
  clearInterval(callTimer);
  GayOMeter.hideDots();
  matched = false;

  if (showResults) {
    const my  = GayOMeter.getScore();
    const str = strangerScore;
    showResultsScreen(my, str);
  }
}

function endAndRate() {
  if (socket) socket.emit('leave');
  onMatchEnd(true);
}

function skip() {
  cleanupCall(false);
  clearMessages();
  resetStrangerVideo();
  clearInterval(matchTimer);
  clearInterval(callTimer);
  $('callTimer').textContent = '';
  updateCountdownDisplay(MATCH_DURATION, false);
  matched = false;
  if (socket) socket.emit('skip');
  setStatus('searching','🔍 Finding next match...');
  GayOMeter.showDots();
}

function cleanupCall(stopCamera) {
  if (pc) { pc.close(); pc = null; }
  if (stopCamera && localStream) {
    localStream.getTracks().forEach(t=>t.stop());
    localStream = null;
    chatInitialized = false;
  }
}

function clearMessages() {
  $('messages').innerHTML = '<div class="sys-msg">🌈 New match starting...</div>';
}

function resetStrangerVideo() {
  const sv = $('strangerVideo');
  if (sv) sv.srcObject = null;
  $('strangerOverlay')?.classList.remove('hidden');
  updateMeter('stranger', 0);
  updateMeter('you', 0);
  $('strangerNameDisplay').textContent = 'Stranger';
}

// ── Results Screen ────────────────────────────────────────────────────────────
function showResultsScreen(my, stranger) {
  const myR  = Math.round(my*10)/10;
  const strR = Math.round(stranger*10)/10;
  const won  = myR > strR;
  const tied = myR === strR;

  // Record match
  const result = recordMatch(myR, strR, partnerName);
  updateLeaderboardEntry();
  updateProfileDisplay();

  showPage('page-results');

  $('resultCrown').textContent      = won ? '👑' : tied ? '🤝' : '😢';
  $('resultHeadline').textContent   = won ? 'YOU WIN!' : tied ? "IT'S A TIE!" : 'YOU LOSE.';
  $('resultSubLine').textContent    = won
    ? WIN_LINES[Math.floor(Math.random()*WIN_LINES.length)]
    : tied
    ? TIE_LINES[Math.floor(Math.random()*TIE_LINES.length)]
    : LOSE_LINES[Math.floor(Math.random()*LOSE_LINES.length)];

  const myLabel  = getLabel(myR);
  const strLabel = getLabel(strR);

  $('resultYouScore').textContent      = myR.toFixed(1);
  $('resultStrangerScore').textContent = strR.toFixed(1);
  $('resultYouLabel').textContent      = myLabel.emoji  + ' ' + myLabel.label;
  $('resultStrangerLabel').textContent = strLabel.emoji + ' ' + strLabel.label;
  $('resultVsName').textContent        = 'vs ' + partnerName;
  $('resultGPEarned').textContent      = '+' + result.gp + ' GP';

  setTimeout(()=>{
    $('resultYouBar').style.height      = (myR*10)  + '%';
    $('resultStrangerBar').style.height = (strR*10) + '%';
  }, 200);

  // New achievements
  const newAch = checkAchievements(stLoad());
  if (newAch.length) {
    $('newAchievement').textContent = newAch.map(a=>a.icon+' '+a.name).join(' · ');
    $('achievementToast').classList.remove('hidden');
    setTimeout(()=>$('achievementToast').classList.add('hidden'), 4000);
  }

  // Confetti on win
  if (won && typeof confetti !== 'undefined') {
    confetti({ particleCount:120, spread:80, colors:['#ff6ef7','#6ef7ff','#ffef6e','#6eff9e','#a06eff'] });
    setTimeout(()=>confetti({ angle:60,  spread:55, origin:{x:0}, particleCount:60, colors:['#ff6ef7','#6ef7ff'] }),300);
    setTimeout(()=>confetti({ angle:120, spread:55, origin:{x:1}, particleCount:60, colors:['#ffef6e','#6eff9e'] }),300);
  }

  // Enable/disable rematch button based on whether partner is still connected
  $('rematchBtn').disabled = !matched;
}

// ── Photo save ────────────────────────────────────────────────────────────────
function saveResultPhoto() {
  const canvas = document.createElement('canvas');
  canvas.width  = 680; canvas.height = 420;
  const ctx     = canvas.getContext('2d');

  // Background
  const bg = ctx.createLinearGradient(0,0,680,420);
  bg.addColorStop(0,'#0d0d1a'); bg.addColorStop(1,'#1a0033');
  ctx.fillStyle = bg; ctx.fillRect(0,0,680,420);

  // Rainbow top bar
  const rb = ctx.createLinearGradient(0,0,680,0);
  ['#ff0080','#ff6600','#ffff00','#00ff80','#0080ff','#8000ff'].forEach((c,i) => rb.addColorStop(i/5,c));
  ctx.fillStyle = rb; ctx.fillRect(0,0,680,6);

  // Logo
  ctx.font='bold 14px monospace'; ctx.fillStyle='rgba(255,255,255,.3)';
  ctx.textAlign='center'; ctx.fillText('🏳️‍🌈 GAYMOGGLE — WHO\'S GAYER?',340,32);

  // Scores
  const myR  = parseFloat($('resultYouScore').textContent)      || 0;
  const strR = parseFloat($('resultStrangerScore').textContent) || 0;
  const won  = myR > strR;

  ctx.font='bold 90px monospace';
  ctx.fillStyle='#ff6ef7'; ctx.textAlign='right'; ctx.fillText(myR.toFixed(1), 280, 210);
  ctx.fillStyle='#ffef6e'; ctx.font='bold 44px monospace'; ctx.textAlign='center'; ctx.fillText('VS',340,200);
  ctx.fillStyle='#6ef7ff'; ctx.font='bold 90px monospace'; ctx.textAlign='left';  ctx.fillText(strR.toFixed(1),400,210);

  ctx.font='italic 22px monospace'; ctx.fillStyle='rgba(255,255,255,.5)';
  ctx.textAlign='center'; ctx.fillText($('resultSubLine').textContent, 340, 260);

  // Labels
  ctx.font='15px monospace'; ctx.fillStyle='rgba(255,255,255,.35)';
  ctx.textAlign='left';  ctx.fillText(stGet('username')||'You',  60, 290);
  ctx.textAlign='right'; ctx.fillText(partnerName, 620, 290);

  // Footer
  ctx.font='11px monospace'; ctx.fillStyle='rgba(255,255,255,.15)';
  ctx.textAlign='center'; ctx.fillText('gaymoggle • Original idea by Or Brami', 340, 405);

  // Download
  const link = document.createElement('a');
  link.download = 'gaymoggle-result.png';
  link.href     = canvas.toDataURL('image/png');
  link.click();
}

// ── Share ─────────────────────────────────────────────────────────────────────
function shareResult() {
  const myR  = parseFloat($('resultYouScore').textContent)||0;
  const strR = parseFloat($('resultStrangerScore').textContent)||0;
  const won  = myR > strR;
  const text = won
    ? `I scored ${myR}/10 on the Gay-O-Meter™ and out-gayed ${partnerName} on Gaymoggle! 🏳️‍🌈 Can you beat me?`
    : `${partnerName} got ${strR}/10 and out-gayed me (${myR}/10) on Gaymoggle 💅 The struggle is real.`;
  window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text+' #Gaymoggle'),'_blank');
}

// ── Rematch ───────────────────────────────────────────────────────────────────
function requestRematch() {
  if (!socket) return;
  waitingForRematchAnswer = true;
  $('rematchBtn').textContent = '⏳ Waiting...';
  $('rematchBtn').disabled    = true;
  socket.emit('request_rematch');
}

function showRematchPrompt() {
  $('rematchPrompt').classList.remove('hidden');
}
function hideRematchPrompt() {
  $('rematchPrompt').classList.add('hidden');
}

function acceptRematch() {
  hideRematchPrompt();
  socket.emit('request_rematch'); // mutual
}
function declineRematch() {
  hideRematchPrompt();
  socket.emit('decline_rematch');
}

// Listen for server pairing us again
socket?.on && socket.on('matched', async ({ partnerId, partnerName: pName, role, mode }) => {
  // handled in connectSocket above — but also reset the UI
  if (mode === 'rematch') {
    resetForNewMatch();
  }
});

function resetForNewMatch() {
  matched    = true;
  $('rematchBtn').textContent = '🔁 Rematch';
  $('rematchBtn').disabled    = false;
  waitingForRematchAnswer     = false;
  showPage('page-chat');
  clearMessages();
  resetStrangerVideo();
  GayOMeter.showDots();
  addSys('Rematch! Same opponents. Go!');
}

// ── Play Again (home) ─────────────────────────────────────────────────────────
function goHome() {
  cleanupAll();
  showPage('page-home');
  updateProfileDisplay();
}

function playAgainRandom() {
  cleanupCall(false);
  resetForRematch();
  clearMessages();
  resetStrangerVideo();
  showPage('page-chat');
  GayOMeter.showDots();
  if (socket) { socket.emit('find_match'); setStatus('searching','🔍 Finding match...'); }
  else startRandom();
}

function resetForRematch() {
  clearInterval(matchTimer);
  clearInterval(callTimer);
  updateCountdownDisplay(MATCH_DURATION, false);
  $('callTimer').textContent = '';
  matched = false;
  isOvertimeActive = false;
}

function cleanupAll() {
  GayOMeter.stop();
  cleanupCall(true);
  clearInterval(matchTimer);
  clearInterval(callTimer);
  if (socket) { socket.emit('leave'); socket.disconnect(); socket = null; }
  matched = false;
  chatInitialized = false;
}

// ── Filters ───────────────────────────────────────────────────────────────────
function setFilter(f, btn) {
  $$('.fbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const v = $('localVideo');
  v.className = f !== 'none' && f !== 'mirror' ? 'f-'+f : '';
  // Mirror is always on via CSS; filters are additional
}

// ── Report ────────────────────────────────────────────────────────────────────
function reportUser()    { $('reportBackdrop').classList.remove('hidden'); }
function closeReport()   { $('reportBackdrop').classList.add('hidden'); }
function submitReport(r) { closeReport(); addSys(`Report submitted: "${r}". Thanks. 💪`); }

// ── Leaderboard Page ──────────────────────────────────────────────────────────
function openLeaderboard() {
  showPage('page-leaderboard');
  renderLeaderboard();
  renderSeasonTimer();
  renderAchievements();
}

function renderLeaderboard() {
  const entries  = getLeaderboard();
  const myName   = stGet('username');
  const podium   = $('lbPodium');
  const list     = $('lbList');
  podium.innerHTML = '';
  list.innerHTML   = '';

  if (!entries.length) {
    list.innerHTML = '<div class="lb-empty">No scores yet. Play some matches!</div>';
    return;
  }

  // Podium (top 3)
  const podiumOrder = [1,0,2]; // silver, gold, bronze
  const podiumLabels = ['🥈','🥇','🥉'];
  const podiumHeights = ['160px','200px','130px'];

  podiumOrder.forEach((rankIdx, posIdx) => {
    const e = entries[rankIdx];
    if (!e) return;
    const d = document.createElement('div');
    d.className = 'podium-col' + (e.username===myName?' is-me':'');
    d.innerHTML = `
      <div class="podium-name">${esc(e.username)}</div>
      <div class="podium-score">${(e.seasonGP||0).toLocaleString()} GP</div>
      <div class="podium-block" style="height:${podiumHeights[posIdx]}">
        <div class="podium-medal">${podiumLabels[posIdx]}</div>
        <div class="podium-rank">#${rankIdx+1}</div>
      </div>
    `;
    podium.appendChild(d);
  });

  // Full list (all)
  entries.forEach((e, i) => {
    const d   = document.createElement('div');
    d.className = 'lb-row' + (e.username===myName?' is-me':'');
    const rankIcon = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
    d.innerHTML = `
      <span class="lb-rank">${rankIcon}</span>
      <span class="lb-name">${esc(e.username)}${e.username===myName?' (you)':''}</span>
      <span class="lb-gp">${(e.seasonGP||0).toLocaleString()} GP</span>
      <span class="lb-wins">${e.wins||0}W</span>
      <span class="lb-streak">🔥${e.streak||0}</span>
    `;
    list.appendChild(d);
  });
}

function renderSeasonTimer() {
  const ms   = getSeasonTimeLeft();
  const el   = $('seasonTimer');
  if (!el) return;

  function fmt(ms) {
    const s = Math.floor(ms/1000);
    const d = Math.floor(s/86400);
    const h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    return `${h}h ${m}m ${sec}s`;
  }

  el.textContent = fmt(ms);
  clearInterval(window._seasonInterval);
  window._seasonInterval = setInterval(() => {
    const left = getSeasonTimeLeft();
    el.textContent = fmt(left);
    if (left <= 0) { clearInterval(window._seasonInterval); el.textContent = 'Season ended!'; }
  }, 1000);
}

function renderAchievements() {
  const grid = $('achGrid');
  if (!grid) return;
  grid.innerHTML = '';
  getAllAchievements().forEach(a => {
    const d = document.createElement('div');
    d.className = 'ach-item' + (a.unlocked?' unlocked':'');
    d.title     = a.desc;
    d.innerHTML = `<span class="ach-icon">${a.icon}</span><span class="ach-name">${a.name}</span>`;
    grid.appendChild(d);
  });
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str||''));
  return d.innerHTML;
}

// Confetti CDN
const _cs = document.createElement('script');
_cs.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
document.head.appendChild(_cs);
