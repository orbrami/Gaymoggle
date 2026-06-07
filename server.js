/**
 * GAYMOGGLE v3 — Signaling + Matchmaking Server
 * Added: usernames/accounts, leaderboard, private rooms, rematch, extra-time scoring
 */

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');

const app    = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ['GET','POST'] },
  pingTimeout:  30000,
  pingInterval: 10000,
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get('/',       (req,res) => res.send('Gaymoggle v3 signaling server running 🌈'));
app.get('/health', (req,res) => res.json({ status:'ok', online:connectedUsers.size, waiting:waitingQueue.length }));

// ---- Leaderboard storage (in-memory, resets every 10 days) ----
let leaderboard = {};   // { username: { score, wins, gamesPlayed, lastUpdated } }
let seasonStart  = Date.now();
const SEASON_DURATION = 10 * 24 * 60 * 60 * 1000; // 10 days in ms

function checkSeasonReset() {
  if (Date.now() - seasonStart >= SEASON_DURATION) {
    leaderboard = {};
    seasonStart  = Date.now();
    io.emit('leaderboard_reset');
    console.log('🔄 Season reset!');
  }
}

function getLeaderboard() {
  const entries = Object.entries(leaderboard)
    .map(([username, data]) => ({ username, ...data }))
    .sort((a,b) => b.wins - a.wins || b.score - a.score)
    .slice(0, 50);
  return {
    entries,
    seasonStart,
    seasonEnd: seasonStart + SEASON_DURATION,
  };
}

app.get('/leaderboard', (req,res) => {
  checkSeasonReset();
  res.json(getLeaderboard());
});

// ---- State ----
const connectedUsers = new Map();
const waitingQueue   = [];
const privateRooms   = new Map(); // code -> { hostId, guestId|null }

// ---- Helpers ----
function broadcastOnlineCount() { io.emit('online_count', connectedUsers.size); }

function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function tryMatch() {
  for (let i = waitingQueue.length-1; i >= 0; i--) {
    if (!connectedUsers.has(waitingQueue[i])) waitingQueue.splice(i,1);
  }
  while (waitingQueue.length >= 2) {
    const idA = waitingQueue.shift();
    const idB = waitingQueue.shift();
    const userA = connectedUsers.get(idA);
    const userB = connectedUsers.get(idB);
    if (!userA || !userB) {
      if (userA) waitingQueue.unshift(idA);
      if (userB) waitingQueue.unshift(idB);
      continue;
    }
    pairUsers(idA, idB);
  }
}

function pairUsers(idA, idB) {
  const userA = connectedUsers.get(idA);
  const userB = connectedUsers.get(idB);
  if (!userA || !userB) return;
  userA.partnerId = idB;
  userB.partnerId = idA;
  userA.inCall    = true;
  userB.inCall    = true;
  io.to(idA).emit('matched', { partnerId:idB, role:'caller', partnerName: userB.username || null });
  io.to(idB).emit('matched', { partnerId:idA, role:'callee', partnerName: userA.username || null });
  console.log(`Matched: ${idA.slice(0,6)} ↔ ${idB.slice(0,6)}`);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i=0; i<6; i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

// ---- Socket.io ----
io.on('connection', (socket) => {
  console.log(`+ Connected: ${socket.id.slice(0,8)}`);
  connectedUsers.set(socket.id, { socketId:socket.id, partnerId:null, inCall:false, username:null });
  broadcastOnlineCount();

  // --- Username registration ---
  socket.on('set_username', ({ username }) => {
    if (typeof username !== 'string') return;
    const clean = username.trim().slice(0, 20);
    if (!clean) return;
    const user = connectedUsers.get(socket.id);
    if (user) user.username = clean;
    socket.emit('username_confirmed', { username: clean });
  });

  // --- Leaderboard ---
  socket.on('get_leaderboard', () => {
    checkSeasonReset();
    socket.emit('leaderboard_data', getLeaderboard());
  });

  // --- Submit result ---
  socket.on('submit_result', ({ username, score, won }) => {
    if (!username || typeof score !== 'number') return;
    checkSeasonReset();
    if (!leaderboard[username]) {
      leaderboard[username] = { score:0, wins:0, gamesPlayed:0 };
    }
    const entry = leaderboard[username];
    entry.gamesPlayed++;
    entry.score = Math.max(entry.score, Math.round(score*10)/10);
    if (won) entry.wins++;
    // Broadcast updated leaderboard
    io.emit('leaderboard_data', getLeaderboard());
  });

  // --- Matchmaking ---
  socket.on('find_match', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    removeFromQueue(socket.id);
    user.partnerId = null;
    user.inCall    = false;
    waitingQueue.push(socket.id);
    socket.emit('waiting');
    tryMatch();
  });

  // --- Private rooms ---
  socket.on('create_room', () => {
    let code;
    do { code = generateRoomCode(); } while (privateRooms.has(code));
    privateRooms.set(code, { hostId: socket.id, guestId: null });
    socket.emit('room_created', { code });
    console.log(`Room created: ${code} by ${socket.id.slice(0,6)}`);
  });

  socket.on('join_room', ({ code }) => {
    const room = privateRooms.get(code?.toUpperCase());
    if (!room) { socket.emit('room_error', { msg:'Room not found. Check the code.' }); return; }
    if (room.guestId) { socket.emit('room_error', { msg:'Room is already full.' }); return; }
    if (room.hostId === socket.id) { socket.emit('room_error', { msg:"That's your own room!" }); return; }
    room.guestId = socket.id;
    pairUsers(room.hostId, socket.id);
    privateRooms.delete(code);
  });

  // --- Rematch ---
  socket.on('request_rematch', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('rematch_requested');
  });

  socket.on('accept_rematch', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    const partner = connectedUsers.get(user.partnerId);
    if (!partner) return;
    // Reset both and re-pair
    io.to(user.partnerId).emit('rematch_start');
    socket.emit('rematch_start');
    // They'll both re-do WebRTC naturally via the matched event
    pairUsers(socket.id, user.partnerId);
  });

  // --- WebRTC signaling ---
  socket.on('webrtc_offer', ({ offer }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('webrtc_offer', { offer, from:socket.id });
  });
  socket.on('webrtc_answer', ({ answer }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('webrtc_answer', { answer });
  });
  socket.on('ice_candidate', ({ candidate }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('ice_candidate', { candidate });
  });

  // --- Chat ---
  socket.on('chat_message', ({ text }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    if (typeof text !== 'string' || text.length > 300) return;
    io.to(user.partnerId).emit('chat_message', { text });
  });
  socket.on('chat_reaction', ({ emoji }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    const allowed = ['🌈','💅','👑','💀','🔥','👏','😍','💃','✨','🎉'];
    if (!allowed.includes(emoji)) return;
    io.to(user.partnerId).emit('chat_reaction', { emoji });
  });
  socket.on('gay_score', ({ score }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    const s = Math.max(0, Math.min(10, parseFloat(score)||5));
    io.to(user.partnerId).emit('gay_score', { score:s });
  });

  // Extra time sync
  socket.on('extra_time_vote', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('extra_time_vote');
  });

  // --- Skip / leave ---
  socket.on('skip', () => {
    handleLeave(socket);
    const user = connectedUsers.get(socket.id);
    if (user) {
      user.partnerId = null; user.inCall = false;
      waitingQueue.push(socket.id);
      socket.emit('waiting');
      tryMatch();
    }
  });
  socket.on('leave', () => handleLeave(socket));

  socket.on('disconnect', () => {
    console.log(`- Disconnected: ${socket.id.slice(0,8)}`);
    handleLeave(socket);
    removeFromQueue(socket.id);
    connectedUsers.delete(socket.id);
    broadcastOnlineCount();
  });
});

function handleLeave(socket) {
  const user = connectedUsers.get(socket.id);
  if (!user) return;
  if (user.partnerId) {
    io.to(user.partnerId).emit('partner_left');
    const partner = connectedUsers.get(user.partnerId);
    if (partner) { partner.partnerId = null; partner.inCall = false; }
  }
  user.partnerId = null;
  user.inCall    = false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌈 Gaymoggle v3 server on port ${PORT}`));
