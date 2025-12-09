// server.js
// Minimal, robust signalling server for pair-matching WebRTC peers.
// Replace nothing unless you know what you're changing.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

// simple health check
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // keepalive tuned for hosted environments
  pingInterval: 20000, // 20s
  pingTimeout: 60000,  // 60s
  transports: ["websocket", "polling"]
});

// store socket ids (not socket objects) to avoid stale references
let waitingQueue = [];

// helper: try to resolve country by IP (best-effort)
async function getCountry(ip) {
  try {
    if (!ip) return "Unknown";
    if (ip === "::1" || ip === "127.0.0.1") return "Local Dev";
    if (ip.includes(",")) ip = ip.split(",")[0].trim();
    // Node 18+ has global fetch. If your node doesn't, install node-fetch.
    const res = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await res.json();
    return data && data.country ? data.country : "Unknown";
  } catch (e) {
    return "Unknown";
  }
}

// cleanup helper - remove disconnected ids periodically
setInterval(() => {
  waitingQueue = waitingQueue.filter(id => io.sockets.sockets.get(id));
}, 30 * 1000);

function broadcastUserCount() {
  const count = io.engine.clientsCount || 0;
  io.emit("user_count", count);
  console.log(`[SIG] user_count=${count}`);
}

io.on("connection", async (socket) => {
  broadcastUserCount();
  console.log(`[SIG] connected: ${socket.id} transport=${socket.conn.transport.name}`);

  // get client ip (works behind proxies when x-forwarded-for is present)
  let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || "";
  if (clientIp && clientIp.includes(",")) clientIp = clientIp.split(",")[0].trim();
  const country = await getCountry(clientIp);
  socket.userData = { country };

  console.log(`[SIG] ${socket.id} from ${country} ip=${clientIp}`);

  socket.on("join_queue", () => {
    console.log(`[SIG] join_queue from ${socket.id}`);
    // remove stale entries
    waitingQueue = waitingQueue.filter(id => io.sockets.sockets.get(id));

    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.pop();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (!partnerSocket) {
        console.log(`[SIG] partner ${partnerId} not found -> requeue ${socket.id}`);
        waitingQueue.push(socket.id);
        return;
      }

      const roomId = `${socket.id}#${partnerId}`;
      socket.join(roomId);
      partnerSocket.join(roomId);

      io.to(socket.id).emit("match_found", {
        roomId,
        initiator: true,
        partnerId,
        partnerCountry: partnerSocket.userData?.country || "Unknown"
      });

      io.to(partnerId).emit("match_found", {
        roomId,
        initiator: false,
        partnerId: socket.id,
        partnerCountry: socket.userData?.country || "Unknown"
      });

      console.log(`[SIG] Matched: ${socket.id} (${socket.userData.country}) <-> ${partnerId} (${partnerSocket.userData?.country})`);
    } else {
      waitingQueue.push(socket.id);
      console.log(`[SIG] queued ${socket.id} (queueLen=${waitingQueue.length})`);
    }
  });

  // generic pass-through signaling: expects { roomId, signalData }
  socket.on("signal", (data) => {
    if (!data || !data.roomId) return;
    console.log(`[SIG] signal from ${socket.id} -> room ${data.roomId} (type:${data.signalData?.type || 'ice/sdp'})`);
    socket.to(data.roomId).emit("signal", { from: socket.id, payload: data.signalData });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[SIG] disconnect ${socket.id} reason=${reason}`);
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    broadcastUserCount();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`[SIG] server running on port ${PORT}`));
