const express = require("express");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 4200;
const WORLD_HEIGHT = 4200;
const FOOD_COUNT = 360;
const BOT_COUNT = 14;
const MAX_FOOD_MASS = 7;
const TICK_RATE = 1000 / 30;
const START_MASS = 36;
const MAX_CELLS = 8;
const MIN_SPLIT_MASS = 36;
const MERGE_DELAY = 7000;
const BOOST_DECAY = 0.9;
const BURST_COST = 35;
const BURST_RECHARGE = 11;
const BURST_DURATION = 900;

const players = new Map();
const bots = new Map();
const food = [];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function now() {
  return Date.now();
}

function createFood() {
  return {
    id: `food-${Math.random().toString(36).slice(2, 10)}`,
    x: randomBetween(40, WORLD_WIDTH - 40),
    y: randomBetween(40, WORLD_HEIGHT - 40),
    mass: randomBetween(3, MAX_FOOD_MASS),
    hue: Math.floor(randomBetween(0, 360)),
  };
}

function getRadius(mass) {
  return Math.sqrt(mass) * 6 + 8;
}

function createCell(x, y, mass, angle = 0, boost = 0) {
  return {
    id: `cell-${Math.random().toString(36).slice(2, 10)}`,
    x,
    y,
    mass,
    vx: Math.cos(angle) * boost,
    vy: Math.sin(angle) * boost,
    mergeAt: now() + MERGE_DELAY,
  };
}

function getTotalMass(player) {
  return player.cells.reduce((sum, cell) => sum + cell.mass, 0);
}

function getCenter(player) {
  const totalMass = Math.max(getTotalMass(player), 1);
  const weighted = player.cells.reduce(
    (acc, cell) => {
      acc.x += cell.x * cell.mass;
      acc.y += cell.y * cell.mass;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: weighted.x / totalMass,
    y: weighted.y / totalMass,
  };
}

function createPlayer(id, name, isBot = false) {
  const x = randomBetween(220, WORLD_WIDTH - 220);
  const y = randomBetween(220, WORLD_HEIGHT - 220);

  return {
    id,
    name,
    isBot,
    hue: Math.floor(randomBetween(0, 360)),
    targetX: x,
    targetY: y,
    angle: randomBetween(0, Math.PI * 2),
    burstMeter: 100,
    burstUntil: 0,
    cells: [createCell(x, y, START_MASS)],
  };
}

function respawnPlayer(player) {
  const x = randomBetween(220, WORLD_WIDTH - 220);
  const y = randomBetween(220, WORLD_HEIGHT - 220);
  player.targetX = x;
  player.targetY = y;
  player.cells = [createCell(x, y, START_MASS)];
}

function spawnFoodUntilFull() {
  while (food.length < FOOD_COUNT) {
    food.push(createFood());
  }
}

function findNearestFood(player) {
  const center = getCenter(player);
  let best = null;
  let bestDistance = Infinity;

  for (const pellet of food) {
    const dx = pellet.x - center.x;
    const dy = pellet.y - center.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pellet;
    }
  }

  return best;
}

function updateBot(bot) {
  const center = getCenter(bot);
  if (Math.random() < 0.015) {
    bot.angle += randomBetween(-0.8, 0.8);
  }

  const targetFood = findNearestFood(bot);
  if (targetFood) {
    bot.targetX = targetFood.x;
    bot.targetY = targetFood.y;
  } else {
    bot.targetX = center.x + Math.cos(bot.angle) * 300;
    bot.targetY = center.y + Math.sin(bot.angle) * 300;
  }

  if (getTotalMass(bot) > 90 && bot.cells.length < 4 && Math.random() < 0.008) {
    splitPlayer(bot);
  }
}

function activateBurst(player) {
  if (player.burstMeter < BURST_COST) {
    return false;
  }

  player.burstMeter -= BURST_COST;
  player.burstUntil = now() + BURST_DURATION;
  return true;
}

function splitPlayer(player) {
  if (player.cells.length >= MAX_CELLS) {
    return false;
  }

  const center = getCenter(player);
  const baseAngle = Math.atan2(player.targetY - center.y, player.targetX - center.x) || 0;
  const nextCells = [];

  for (const cell of player.cells) {
    if (nextCells.length >= MAX_CELLS) {
      nextCells.push(cell);
      continue;
    }

    if (cell.mass < MIN_SPLIT_MASS) {
      nextCells.push(cell);
      continue;
    }

    const splitMass = cell.mass / 2;
    cell.mass = splitMass;
    cell.mergeAt = now() + MERGE_DELAY;
    const radius = getRadius(splitMass);
    const angle = baseAngle + randomBetween(-0.18, 0.18);
    const launched = createCell(
      cell.x + Math.cos(angle) * (radius + 18),
      cell.y + Math.sin(angle) * (radius + 18),
      splitMass,
      angle,
      480
    );
    cell.vx -= Math.cos(angle) * 80;
    cell.vy -= Math.sin(angle) * 80;
    nextCells.push(cell, launched);
  }

  player.cells = nextCells.slice(0, MAX_CELLS);
  return true;
}

function keepOwnCellsSeparated(player) {
  for (let left = 0; left < player.cells.length; left += 1) {
    for (let right = left + 1; right < player.cells.length; right += 1) {
      const a = player.cells[left];
      const b = player.cells[right];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minDistance = getRadius(a.mass) + getRadius(b.mass) + 4;

      if (distance < minDistance) {
        const overlap = (minDistance - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }
    }
  }
}

function mergeOwnCells(player) {
  for (let left = 0; left < player.cells.length; left += 1) {
    for (let right = player.cells.length - 1; right > left; right -= 1) {
      const a = player.cells[left];
      const b = player.cells[right];
      if (a.mergeAt > now() || b.mergeAt > now()) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const mergeDistance = Math.max(getRadius(a.mass), getRadius(b.mass)) * 0.8;

      if (distance < mergeDistance) {
        a.mass += b.mass;
        a.x = (a.x + b.x) * 0.5;
        a.y = (a.y + b.y) * 0.5;
        player.cells.splice(right, 1);
      }
    }
  }
}

function movePlayerCells(player, deltaSeconds) {
  const center = getCenter(player);
  const burstMultiplier = player.burstUntil > now() ? 1.55 : 1;

  if (player.burstUntil <= now()) {
    player.burstMeter = clamp(player.burstMeter + BURST_RECHARGE * deltaSeconds, 0, 100);
  }

  for (const cell of player.cells) {
    const dx = player.targetX - cell.x;
    const dy = player.targetY - cell.y;
    const distance = Math.hypot(dx, dy);
    const radius = getRadius(cell.mass);
    const baseSpeed = clamp(260 - radius * 1.95, 72, 255) * burstMultiplier;

    if (distance > 1) {
      const step = Math.min(distance, baseSpeed * deltaSeconds);
      cell.x += (dx / distance) * step;
      cell.y += (dy / distance) * step;
    }

    cell.x += cell.vx * deltaSeconds;
    cell.y += cell.vy * deltaSeconds;
    cell.vx *= BOOST_DECAY;
    cell.vy *= BOOST_DECAY;

    const leashX = (center.x - cell.x) * 0.012;
    const leashY = (center.y - cell.y) * 0.012;
    cell.x += leashX;
    cell.y += leashY;

    cell.x = clamp(cell.x, radius, WORLD_WIDTH - radius);
    cell.y = clamp(cell.y, radius, WORLD_HEIGHT - radius);
  }

  keepOwnCellsSeparated(player);
  mergeOwnCells(player);
}

function consumeFood(player) {
  for (const cell of player.cells) {
    const radius = getRadius(cell.mass);

    for (let index = food.length - 1; index >= 0; index -= 1) {
      const pellet = food[index];
      const dx = pellet.x - cell.x;
      const dy = pellet.y - cell.y;
      const distance = Math.hypot(dx, dy);

      if (distance < radius) {
        cell.mass += pellet.mass * 0.42;
        food.splice(index, 1);
      }
    }
  }
}

function handlePlayerVsPlayer(hunter, prey) {
  for (const hunterCell of hunter.cells) {
    const hunterRadius = getRadius(hunterCell.mass);

    for (let index = prey.cells.length - 1; index >= 0; index -= 1) {
      const preyCell = prey.cells[index];
      if (hunterCell.mass <= preyCell.mass * 1.15) {
        continue;
      }

      const dx = preyCell.x - hunterCell.x;
      const dy = preyCell.y - hunterCell.y;
      const distance = Math.hypot(dx, dy);
      const preyRadius = getRadius(preyCell.mass);

      if (distance < hunterRadius - preyRadius * 0.3) {
        hunterCell.mass += preyCell.mass * 0.9;
        prey.cells.splice(index, 1);
      }
    }
  }

  if (prey.cells.length === 0) {
    respawnPlayer(prey);
  }
}

function serializePlayer(player) {
  const center = getCenter(player);
  return {
    id: player.id,
    name: player.name,
    hue: player.hue,
    isBot: player.isBot,
    center,
    totalMass: getTotalMass(player),
    burstMeter: player.burstMeter,
    cells: player.cells.map((cell) => ({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      mass: cell.mass,
      radius: getRadius(cell.mass),
    })),
  };
}

function networkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const values of Object.values(interfaces)) {
    if (!values) {
      continue;
    }

    for (const value of values) {
      if (value.family === "IPv4" && !value.internal) {
        addresses.push(value.address);
      }
    }
  }

  return addresses;
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("join", (payload = {}) => {
    const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
    players.set(socket.id, createPlayer(socket.id, rawName.slice(0, 16) || "Yigiy"));
    socket.emit("joined", { id: socket.id });
  });

  socket.on("move", (payload = {}) => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    if (typeof payload.worldX === "number" && typeof payload.worldY === "number") {
      player.targetX = clamp(payload.worldX, 0, WORLD_WIDTH);
      player.targetY = clamp(payload.worldY, 0, WORLD_HEIGHT);
    }
  });

  socket.on("split", () => {
    const player = players.get(socket.id);
    if (player) {
      splitPlayer(player);
    }
  });

  socket.on("burst", () => {
    const player = players.get(socket.id);
    if (player) {
      activateBurst(player);
    }
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
  });
});

spawnFoodUntilFull();

for (let index = 0; index < BOT_COUNT; index += 1) {
  const bot = createPlayer(`bot-${index}`, `Bot ${index + 1}`, true);
  bots.set(bot.id, bot);
}

let lastTick = now();
setInterval(() => {
  const tickNow = now();
  const deltaSeconds = (tickNow - lastTick) / 1000;
  lastTick = tickNow;

  for (const bot of bots.values()) {
    updateBot(bot);
  }

  for (const player of [...players.values(), ...bots.values()]) {
    movePlayerCells(player, deltaSeconds);
    consumeFood(player);
  }

  const everyone = [...players.values(), ...bots.values()];
  for (let left = 0; left < everyone.length; left += 1) {
    for (let right = 0; right < everyone.length; right += 1) {
      if (left === right) {
        continue;
      }
      handlePlayerVsPlayer(everyone[left], everyone[right]);
    }
  }

  spawnFoodUntilFull();

  const serialized = [...players.values(), ...bots.values()].map(serializePlayer);

  io.emit("state", {
    world: {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    },
    players: serialized,
    food,
    leaderboard: serialized
      .sort((left, right) => right.totalMass - left.totalMass)
      .slice(0, 6)
      .map((player) => ({
        id: player.id,
        name: player.name,
        mass: Math.round(player.totalMass),
      })),
  });
}, TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  const addresses = networkAddresses();
  console.log(`Yigiyio running on http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`LAN: http://${address}:${PORT}`);
  }
});
