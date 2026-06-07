/**
 * GAYMOGGLE — Signaling + Matchmaking Server
 *
 * What this does:
 *  - Keeps a waiting queue of users looking for a match
 *  - When two users are available, pairs them and tells each
 *    other's socket IDs so WebRTC can connect directly
 *  - Relays WebRTC offer/answer/ICE candidates between peers
 *  - Handles disconnects cleanly (notifies the partner)
 *  - Tracks real online count and broadcasts it
 *
 * Video/audio NEVER touches this server.
 * It's purely a matchmaking + signaling coordinator.
 */

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');

const app    = express();
const server = http.createServer(app);

// ---- CORS: allow your Vercel frontend ----
// During setup set FRONTEND_URL env var on Render to your Vercel URL
// e.g. https://gaymoggle.vercel.app
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
  pingTimeout:  30000,
  pingInterval: 10000,
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// Health check — Render pings this to keep the server alive
app.get('/',        (req, res) => res.send('Gaymoggle signaling server running 🌈'));
app.get('/health',  (req, res) => res.json({ status: 'ok', online: connectedUsers.size, waiting: waitingQueue.length }));

// ---- State ----
const connectedUsers = new Map();
// Map<socketId, { socketId, partnerId|null, inCall }>

const waitingQueue = [];
// Array of socketIds waiting to be matched

// ---- Helpers ----
function getOnlineCount() {
  return connectedUsers.size;
}

function broadcastOnlineCount() {
  io.emit('online_count', getOnlineCount());
}

function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function tryMatch() {
  // Remove any queued users who are no longer connected
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    if (!connectedUsers.has(waitingQueue[i])) {
      waitingQueue.splice(i, 1);
    }
  }

  while (waitingQueue.length >= 2) {
    const idA = waitingQueue.shift();
    const idB = waitingQueue.shift();

    const userA = connectedUsers.get(idA);
    const userB = connectedUsers.get(idB);

    if (!userA || !userB) {
      // One disappeared — put the survivor back
      if (userA) waitingQueue.unshift(idA);
      if (userB) waitingQueue.unshift(idB);
      continue;
    }

    // Pair them
    userA.partnerId = idB;
    userB.partnerId = idA;
    userA.inCall    = true;
    userB.inCall    = true;

    // Tell A: you are the CALLER (you send the WebRTC offer)
    io.to(idA).emit('matched', { partnerId: idB, role: 'caller' });
    // Tell B: you are the CALLEE (you wait for the offer, then answer)
    io.to(idB).emit('matched', { partnerId: idA, role: 'callee' });

    console.log(`Matched: ${idA.slice(0,6)} ↔ ${idB.slice(0,6)}`);
  }
}

// ---- Socket.io events ----
io.on('connection', (socket) => {
  console.log(`+ Connected: ${socket.id.slice(0,8)}`);

  connectedUsers.set(socket.id, {
    socketId:  socket.id,
    partnerId: null,
    inCall:    false,
  });

  broadcastOnlineCount();

  // --- User is ready to be matched ---
  socket.on('find_match', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    // Make sure they're not already queued or in a call
    removeFromQueue(socket.id);
    user.partnerId = null;
    user.inCall    = false;

    waitingQueue.push(socket.id);
    socket.emit('waiting');
    console.log(`Queued: ${socket.id.slice(0,8)} | Queue length: ${waitingQueue.length}`);
    tryMatch();
  });

  // --- WebRTC signaling relay ---
  // Caller sends offer → server forwards to callee
  socket.on('webrtc_offer', ({ offer }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('webrtc_offer', { offer, from: socket.id });
  });

  // Callee sends answer → server forwards to caller
  socket.on('webrtc_answer', ({ answer }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('webrtc_answer', { answer });
  });

  // ICE candidates — relay to partner
  socket.on('ice_candidate', ({ candidate }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    io.to(user.partnerId).emit('ice_candidate', { candidate });
  });

  // --- Text chat relay ---
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

  // Gay score sharing (for stranger's meter display)
  socket.on('gay_score', ({ score }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.partnerId) return;
    const s = Math.max(0, Math.min(10, parseFloat(score) || 5));
    io.to(user.partnerId).emit('gay_score', { score: s });
  });

  // --- Skip / leave call ---
  socket.on('skip', () => {
    handleLeave(socket);
    // Put them back in queue
    const user = connectedUsers.get(socket.id);
    if (user) {
      user.partnerId = null;
      user.inCall    = false;
      waitingQueue.push(socket.id);
      socket.emit('waiting');
      tryMatch();
    }
  });

  socket.on('leave', () => {
    handleLeave(socket);
  });

  // --- Disconnect ---
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
    // Notify partner
    io.to(user.partnerId).emit('partner_left');

    // Put partner back in queue
    const partner = connectedUsers.get(user.partnerId);
    if (partner) {
      partner.partnerId = null;
      partner.inCall    = false;
    }
  }

  user.partnerId = null;
  user.inCall    = false;
}

// ---- Start ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌈 Gaymoggle server running on port ${PORT}`);
});
