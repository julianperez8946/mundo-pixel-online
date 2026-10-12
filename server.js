
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 10_000,
  cors: { origin: false }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 50;
const WORLD = { width: 2400, height: 1600 };
const SPEED = 190;
const TICK_RATE = 50;
const CHAT_COOLDOWN = 800;
const BUBBLE_DURATION = 7000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", players: players.size });
});

const players = new Map();
const lastChat = new Map();
const lastGreeting = new Map();

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    color: p.color,
    bubble: p.bubble,
    bubbleUntil: p.bubbleUntil
  };
}

function broadcastPlayers() {
  io.emit("players", Array.from(players.values(), publicPlayer));
}

function showBubble(player, text) {
  player.bubble = text;
  player.bubbleUntil = Date.now() + BUBBLE_DURATION;
}

io.on("connection", (socket) => {
  if (players.size >= MAX_PLAYERS) {
    socket.emit("joinError", "El mundo está lleno. Intenta más tarde.");
    socket.disconnect(true);
    return;
  }

  socket.emit("welcome", {
    world: WORLD,
    maxPlayers: MAX_PLAYERS
  });

  socket.on("join", (data) => {
    if (players.has(socket.id)) return;

    const name = cleanText(data && data.name, 18);
    if (name.length < 2) {
      socket.emit("joinError", "Escribe un nombre de al menos 2 caracteres.");
      return;
    }

    const duplicate = Array.from(players.values()).some(
      p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      socket.emit("joinError", "Ese nombre ya está en uso.");
      return;
    }

    const colors = [
      "#5ba7ff", "#ff7777", "#f3c64e",
      "#a980ff", "#57d69a", "#ff9f54"
    ];

    const player = {
      id: socket.id,
      name,
      x: 180 + Math.random() * 500,
      y: 180 + Math.random() * 350,
      color: colors[Math.floor(Math.random() * colors.length)],
      dx: 0,
      dy: 0,
      bubble: "",
      bubbleUntil: 0
    };

    players.set(socket.id, player);
    socket.emit("joined", {
      id: socket.id,
      world: WORLD,
      players: Array.from(players.values(), publicPlayer)
    });

    socket.broadcast.emit("systemMessage", `${name} entró al mundo.`);
    broadcastPlayers();
  });

  socket.on("move", (input) => {
    const p = players.get(socket.id);
    if (!p || !input || typeof input !== "object") return;

    let dx = Number(input.dx);
    let dy = Number(input.dy);

    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));

    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }

    p.dx = dx;
    p.dy = dy;
  });

  socket.on("chat", (raw) => {
    const p = players.get(socket.id);
    if (!p) return;

    const now = Date.now();
    if (now - (lastChat.get(socket.id) || 0) < CHAT_COOLDOWN) return;

    const message = cleanText(raw, 180);
    if (!message) return;

    lastChat.set(socket.id, now);
    showBubble(p, message);

    io.emit("chatMessage", {
      id: socket.id,
      name: p.name,
      message,
      time: now
    });

    broadcastPlayers();
  });

  socket.on("greet", (targetId) => {
    const p = players.get(socket.id);
    const target = players.get(targetId);

    if (!p || !target || p.id === target.id) return;

    const now = Date.now();
    if (now - (lastGreeting.get(socket.id) || 0) < 1500) return;

    if (Math.hypot(p.x - target.x, p.y - target.y) > 100) {
      socket.emit("notice", "Acércate más para saludar.");
      return;
    }

    lastGreeting.set(socket.id, now);
    showBubble(p, `¡Hola, ${target.name}!`);
    showBubble(target, `¡Hola, ${p.name}!`);

    io.emit("greetMessage", {
      from: p.name,
      to: target.name
    });

    broadcastPlayers();
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);

    if (p) {
      players.delete(socket.id);
      lastChat.delete(socket.id);
      lastGreeting.delete(socket.id);
      io.emit("systemMessage", `${p.name} salió del mundo.`);
      broadcastPlayers();
    }
  });
});

// El servidor controla las posiciones para evitar que
// cada navegador pueda decidir libremente dónde aparecer.
setInterval(() => {
  const dt = TICK_RATE / 1000;

  for (const p of players.values()) {
    p.x = Math.max(
      20,
      Math.min(WORLD.width - 20, p.x + p.dx * SPEED * dt)
    );

    p.y = Math.max(
      20,
      Math.min(WORLD.height - 20, p.y + p.dy * SPEED * dt)
    );

    if (p.bubbleUntil < Date.now()) {
      p.bubble = "";
    }
  }

  if (players.size > 0) broadcastPlayers();
}, TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mundo Pixel Online activo en el puerto ${PORT}`);
  console.log(`Abre http://localhost:${PORT}`);
});
