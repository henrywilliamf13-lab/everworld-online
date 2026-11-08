const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  maxHttpBufferSize: 100000
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, game: "EVERWORLD" }));

const players = new Map();
function cleanText(value, max) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}
function safeNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}

io.on("connection", socket => {
  socket.on("room:join", (payload = {}) => {
    const room = cleanText(payload.room, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const username = cleanText(payload.username, 18);
    if (room.length < 4 || !username) {
      socket.emit("server:error", { message: "Choose a nickname and room code (at least 4 characters)." });
      return;
    }
    if (socket.data.room) {
      const old = socket.data.room;
      socket.leave(old);
      players.delete(socket.id);
      socket.to(old).emit("player:left", { id: socket.id });
    }
    const existing = [...players.values()]
      .filter(p => p.room === room)
      .map(({ id, username, x, y, z, yaw }) => ({ id, username, x, y, z, yaw }));

    socket.join(room);
    socket.data.room = room;
    const player = { id: socket.id, room, username, x: 0, y: 0, z: 0, yaw: 0, movedAt: 0, chattedAt: 0 };
    players.set(socket.id, player);
    socket.emit("room:joined", { id: socket.id, players: existing });
    socket.to(room).emit("player:joined", { id: socket.id, username, x: 0, y: 0, z: 0, yaw: 0 });
  });

  socket.on("player:move", payload => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.movedAt < 40) return;
    p.movedAt = now;
    p.x = safeNumber(payload?.x, -250, 250);
    p.y = safeNumber(payload?.y, 0, 30);
    p.z = safeNumber(payload?.z, -250, 250);
    p.yaw = safeNumber(payload?.yaw, -100, 100);
    socket.to(p.room).emit("player:moved", { id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  });

  socket.on("chat:send", payload => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.chattedAt < 700) return;
    p.chattedAt = now;
    const message = cleanText(payload?.message, 180);
    if (message) io.to(p.room).emit("chat:message", { username: p.username, message });
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;
    players.delete(socket.id);
    socket.to(p.room).emit("player:left", { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`EVERWORLD server running on port ${PORT}`));
