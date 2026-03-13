const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("joinOverlay");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");
const leaderboard = document.getElementById("leaderboard");
const stats = document.getElementById("stats");
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const splitButton = document.getElementById("splitButton");
const burstButton = document.getElementById("burstButton");

const camera = { x: 0, y: 0, zoom: 1 };
const world = { width: 3600, height: 3600 };
const pointer = { active: false, x: 0, y: 0 };
const joystick = {
  active: false,
  pointerId: null,
  centerX: 0,
  centerY: 0,
  dx: 0,
  dy: 0,
  radius: 48,
};

let viewport = { width: window.innerWidth, height: window.innerHeight };
let selfId = null;
let lastState = { players: [], food: [], leaderboard: [] };

function resizeCanvas() {
  viewport = { width: window.innerWidth, height: window.innerHeight };
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getSelf() {
  return lastState.players.find((player) => player.id === selfId);
}

function getSelfCenter() {
  const self = getSelf();
  return self ? self.center : null;
}

function sendMove(worldX, worldY) {
  socket.emit("move", { worldX, worldY });
}

function updatePointerTarget() {
  const center = getSelfCenter();
  if (!center) {
    return;
  }

  if (joystick.active) {
    const scale = 260;
    sendMove(
      center.x + (joystick.dx / joystick.radius) * scale,
      center.y + (joystick.dy / joystick.radius) * scale
    );
    return;
  }

  if (pointer.active) {
    sendMove(camera.x + pointer.x / camera.zoom, camera.y + pointer.y / camera.zoom);
  }
}

function screenToWorld(x, y) {
  return { x: camera.x + x / camera.zoom, y: camera.y + y / camera.zoom };
}

function drawGrid() {
  const size = 80;
  const visibleWidth = viewport.width / camera.zoom;
  const visibleHeight = viewport.height / camera.zoom;
  const startX = -(camera.x % size);
  const startY = -(camera.y % size);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;

  for (let x = camera.x + startX; x < camera.x + visibleWidth; x += size) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, world.height);
    ctx.stroke();
  }

  for (let y = camera.y + startY; y < camera.y + visibleHeight; y += size) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.width, y);
    ctx.stroke();
  }
}

function drawFood(pellet) {
  ctx.beginPath();
  ctx.fillStyle = `hsl(${pellet.hue} 78% 60%)`;
  ctx.arc(pellet.x, pellet.y, pellet.mass + 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(player, isSelf) {
  for (const cell of player.cells) {
    const gradient = ctx.createRadialGradient(
      cell.x - cell.radius * 0.35,
      cell.y - cell.radius * 0.35,
      cell.radius * 0.2,
      cell.x,
      cell.y,
      cell.radius
    );
    gradient.addColorStop(0, `hsl(${player.hue} 90% 68%)`);
    gradient.addColorStop(1, `hsl(${player.hue} 72% 46%)`);

    ctx.beginPath();
    ctx.fillStyle = gradient;
    ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
    ctx.fill();

    if (isSelf) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 3;
      ctx.arc(cell.x, cell.y, cell.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `${Math.max(12, Math.sqrt(player.totalMass) * 0.8)}px Trebuchet MS`;
  ctx.fillText(player.name, player.center.x, player.center.y + 4);
}

function render() {
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const self = getSelf();
  if (self) {
    const targetZoom = Math.max(0.42, Math.min(1, 1.18 - Math.sqrt(self.totalMass) / 42));
    camera.zoom += (targetZoom - camera.zoom) * 0.12;
    const visibleWidth = viewport.width / camera.zoom;
    const visibleHeight = viewport.height / camera.zoom;
    camera.x = self.center.x - visibleWidth / 2;
    camera.y = self.center.y - visibleHeight / 2;
    camera.x = Math.max(0, Math.min(camera.x, world.width - visibleWidth));
    camera.y = Math.max(0, Math.min(camera.y, world.height - visibleHeight));
  }

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  drawGrid();

  for (const pellet of lastState.food) {
    drawFood(pellet);
  }

  const sortedPlayers = [...lastState.players].sort((a, b) => a.totalMass - b.totalMass);
  for (const player of sortedPlayers) {
    drawPlayer(player, player.id === selfId);
  }

  ctx.restore();

  requestAnimationFrame(render);
}

function setJoystickKnob(dx, dy) {
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function resetJoystick() {
  joystick.active = false;
  joystick.pointerId = null;
  joystick.dx = 0;
  joystick.dy = 0;
  setJoystickKnob(0, 0);
}

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  joystick.centerX = rect.left + rect.width / 2;
  joystick.centerY = rect.top + rect.height / 2;

  const dx = clientX - joystick.centerX;
  const dy = clientY - joystick.centerY;
  const distance = Math.hypot(dx, dy);
  const clamped = Math.min(distance, joystick.radius);
  const angle = Math.atan2(dy, dx);

  joystick.dx = Math.cos(angle) * clamped;
  joystick.dy = Math.sin(angle) * clamped;
  joystick.active = true;
  setJoystickKnob(joystick.dx, joystick.dy);
  updatePointerTarget();
}

socket.on("joined", ({ id }) => {
  selfId = id;
  overlay.classList.add("hidden");
});

socket.on("state", (nextState) => {
  world.width = nextState.world.width;
  world.height = nextState.world.height;
  lastState = nextState;

  leaderboard.innerHTML = nextState.leaderboard
    .map((entry) => `<li>${entry.name} - ${entry.mass}</li>`)
    .join("");

  const self = getSelf();
  if (self) {
    stats.textContent = `Kutle ${Math.round(self.totalMass)} | Hucre ${self.cells.length} | Hiz ${Math.round(
      self.burstMeter
    )}`;
  } else {
    stats.textContent = "Oyuncu bekleniyor...";
  }
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  socket.emit("join", { name: nameInput.value });
});

window.addEventListener("resize", resizeCanvas);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    socket.emit("split");
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyW") {
    socket.emit("burst");
  }
});

canvas.addEventListener("mousemove", (event) => {
  pointer.active = true;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  updatePointerTarget();
});

canvas.addEventListener("mouseleave", () => {
  pointer.active = false;
});

window.addEventListener("touchstart", (event) => {
  for (const touch of event.changedTouches) {
    if (touch.target.closest && touch.target.closest(".action-button")) {
      continue;
    }

    const rect = joystickBase.getBoundingClientRect();
    const insideJoystick =
      touch.clientX >= rect.left &&
      touch.clientX <= rect.right &&
      touch.clientY >= rect.top &&
      touch.clientY <= rect.bottom;

    if (insideJoystick && joystick.pointerId === null) {
      joystick.pointerId = touch.identifier;
      updateJoystick(touch.clientX, touch.clientY);
      continue;
    }

    pointer.active = true;
    pointer.x = touch.clientX;
    pointer.y = touch.clientY;
    const worldPoint = screenToWorld(pointer.x, pointer.y);
    sendMove(worldPoint.x, worldPoint.y);
  }
}, { passive: true });

window.addEventListener("touchmove", (event) => {
  for (const touch of event.changedTouches) {
    if (touch.identifier === joystick.pointerId) {
      updateJoystick(touch.clientX, touch.clientY);
    }
  }
}, { passive: true });

window.addEventListener("touchend", (event) => {
  for (const touch of event.changedTouches) {
    if (touch.identifier === joystick.pointerId) {
      resetJoystick();
    }
  }
}, { passive: true });

splitButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  socket.emit("split");
});

burstButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  socket.emit("burst");
});

resizeCanvas();
setJoystickKnob(0, 0);
render();
