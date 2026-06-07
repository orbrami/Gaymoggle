/**
 * GAYMOGGLE v3 — Signaling + Matchmaking + Private Rooms
 */
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);
const FRONTEND = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: { origin: FRONTEND, methods: ['GET','POST'] },
  pingTimeout: 30000, pingInterval: 10000,
});

app.use(cors({ origin: FRONTEND }));
app.get('/',       (_, res) => res.json({ status: 'ok', online: users.size }));
app.get('/health', (_, res) => res.json({ status: 'ok', online: users.size, waiting: queue.length, rooms: privateRooms.size }));

// ── State ──────────────────────────────────────────────────────────────────
const users        = new Map(); // socketId → { socketId, partnerId, username, roomCode }
const queue        = [];        // socketIds waiting for random match
const privateRooms = new Map(); // roomCode → { creator: socketId, joiner: socketId|null }
const rematchOffers= new Map(); // socketId → partnerSocketId they want to rematch

function broadcast() { io.emit('online_count', users.size); }
function rmQueue(id) { const i = queue.indexOf(id); if (i !== -1) queue.splice(i,1); }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function tryMatch() {
  // Purge disconnected
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!users.has(queue[i])) queue.splice(i, 1);
  }
  while (queue.length >= 2) {
    const idA = queue.shift();
    const idB = queue.shift();
    const uA  = users.get(idA);
    const uB  = users.get(idB);
    if (!uA || !uB) { if (uA) queue.unshift(idA); if (uB) queue.unshift(idB); continue; }
    pair(idA, idB, 'random');
  }
}

function pair(idA, idB, mode) {
  const uA = users.get(idA);
  const uB = users.get(idB);
  if (!uA || !uB) return;
  uA.partnerId = idB;
  uB.partnerId = idA;
  io.to(idA).emit('matched', { partnerId: idB, partnerName: uB.username, role: 'caller',  mode });
  io.to(idB).emit('matched', { partnerId: idA, partnerName: uA.username, role: 'callee',  mode });
  console.log(`Paired [${mode}]: ${idA.slice(0,6)} ↔ ${idB.slice(0,6)}`);
}

function handleLeave(socket) {
  const u = users.get(socket.id);
  if (!u) return;
  if (u.partnerId) {
    io.to(u.partnerId).emit('partner_left');
    const partner = users.get(u.partnerId);
    if (partner) partner.partnerId = null;
  }
  u.partnerId = null;
  // Clean up any private room they created
  if (u.roomCode) {
    privateRooms.delete(u.roomCode);
    u.roomCode = null;
  }
}

// ── Socket events ──────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`+ ${socket.id.slice(0,8)}`);
  users.set(socket.id, { socketId: socket.id, partnerId: null, username: 'Anonymous', roomCode: null });
  broadcast();

  socket.on('set_username', ({ username }) => {
    const u = users.get(socket.id);
    if (u && typeof username === 'string') u.username = username.slice(0, 24);
  });

  socket.on('find_match', () => {
    const u = users.get(socket.id);
    if (!u) return;
    handleLeave(socket);
    rmQueue(socket.id);
    queue.push(socket.id);
    socket.emit('waiting');
    tryMatch();
  });

  // ── Private room ──
  socket.on('create_room', () => {
    const u = users.get(socket.id);
    if (!u) return;
    handleLeave(socket);
    rmQueue(socket.id);
    // Make unique code
    let code;
    do { code = generateRoomCode(); } while (privateRooms.has(code));
    privateRooms.set(code, { creator: socket.id, joiner: null });
    u.roomCode = code;
    socket.emit('room_created', { code });
  });

  socket.on('join_room', ({ code }) => {
    const u    = users.get(socket.id);
    const room = privateRooms.get(code?.toUpperCase().trim());
    if (!u || !room) { socket.emit('room_error', { msg: 'Room not found. Check the code.' }); return; }
    if (room.joiner)  { socket.emit('room_error', { msg: 'Room is full.' }); return; }
    if (room.creator === socket.id) { socket.emit('room_error', { msg: "You can't join your own room." }); return; }
    handleLeave(socket);
    rmQueue(socket.id);
    room.joiner = socket.id;
    privateRooms.delete(code.toUpperCase().trim());
    const creator = users.get(room.creator);
    if (creator) creator.roomCode = null;
    pair(room.creator, socket.id, 'private');
  });

  // ── WebRTC relay ──
  socket.on('webrtc_offer',     ({ offer })     => { const u = users.get(socket.id); if (u?.partnerId) io.to(u.partnerId).emit('webrtc_offer',    { offer }); });
  socket.on('webrtc_answer',    ({ answer })    => { const u = users.get(socket.id); if (u?.partnerId) io.to(u.partnerId).emit('webrtc_answer',   { answer }); });
  socket.on('ice_candidate',    ({ candidate }) => { const u = users.get(socket.id); if (u?.partnerId) io.to(u.partnerId).emit('ice_candidate',   { candidate }); });

  // ── Chat ──
  socket.on('chat_message', ({ text }) => {
    const u = users.get(socket.id);
    if (!u?.partnerId || typeof text !== 'string') return;
    io.to(u.partnerId).emit('chat_message', { text: text.slice(0,300) });
  });
  socket.on('chat_reaction', ({ emoji }) => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    const ok = ['🌈','💅','👑','💀','🔥','👏','😍','✨','🎉','💃'];
    if (ok.includes(emoji)) io.to(u.partnerId).emit('chat_reaction', { emoji });
  });

  // Gay score sharing
  socket.on('gay_score', ({ score }) => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    io.to(u.partnerId).emit('gay_score', { score: Math.max(0, Math.min(10, parseFloat(score)||5)) });
  });

  // ── Rematch ──
  socket.on('request_rematch', () => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    const partnerId = u.partnerId;
    rematchOffers.set(socket.id, partnerId);
    io.to(partnerId).emit('rematch_requested');
    // Check if both want rematch
    if (rematchOffers.get(partnerId) === socket.id) {
      rematchOffers.delete(socket.id);
      rematchOffers.delete(partnerId);
      // Reset partner state but keep them paired — re-match
      const uP = users.get(partnerId);
      if (uP) {
        pair(socket.id, partnerId, 'rematch');
      }
    }
  });

  socket.on('decline_rematch', () => {
    const u = users.get(socket.id);
    if (!u?.partnerId) return;
    rematchOffers.delete(u.partnerId);
    io.to(u.partnerId).emit('rematch_declined');
  });

  // ── Skip / Leave ──
  socket.on('skip', () => {
    handleLeave(socket);
    const u = users.get(socket.id);
    if (u) { queue.push(socket.id); socket.emit('waiting'); tryMatch(); }
  });
  socket.on('leave', () => handleLeave(socket));

  socket.on('disconnect', () => {
    console.log(`- ${socket.id.slice(0,8)}`);
    handleLeave(socket);
    rmQueue(socket.id);
    rematchOffers.delete(socket.id);
    users.delete(socket.id);
    broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌈 Gaymoggle v3 on :${PORT}`));
