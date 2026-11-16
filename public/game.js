'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const login = document.getElementById('login');
const hud = document.getElementById('hud');
const nicknameInput = document.getElementById('nickname');
const roomInput = document.getElementById('room-code');
const joinButton = document.getElementById('join');
const phaseElement = document.getElementById('phase');
const roomLabel = document.getElementById('room-label');
const statsElement = document.getElementById('stats');
const scoresElement = document.getElementById('scores');
const hintElement = document.getElementById('hint');

let socket = null;
let myId = null;
let world = { width: 1200, height: 700 };
let latestState = null;
let renderPlayers = new Map();
let particles = [];
let screenShake = 0;
let camera = { x: 0, y: 0, zoom: 1 };
let mouse = { x: 0, y: 0, worldX: 0, worldY: 0 };
let selectedBuild = 'wood';
let keys = {};
let lastFrame = performance.now();
let lastInput = 0;

const buildNames = {
  wood: 'Wood Wall',
  stone: 'Stone Wall',
  gate: 'Gate',
  pad: 'Launch Pad'
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';

  socket = new WebSocket(`${protocol}://${location.host}`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'join',
      nickname: nicknameInput.value.trim() || 'Rookie',
      room: roomInput.value.trim().toUpperCase()
    }));
  });

  socket.addEventListener('message', (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'welcome') {
      myId = message.id;
      login.style.display = 'none';
      hud.style.display = 'block';
      roomLabel.textContent = `Room ${message.room}`;
      return;
    }

    if (message.type === 'state') {
      receiveState(message);
    }
  });

  socket.addEventListener('close', () => {
    hintElement.textContent = 'Connection lost. Refresh to rejoin CoreHeist.io.';
  });
}

joinButton.addEventListener('click', connect);

nicknameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') connect();
});

function receiveState(state) {
  const previous = latestState;
  latestState = state;
  world = state.world;

  for (const player of state.players) {
    const old = renderPlayers.get(player.id);

    if (!old) {
      renderPlayers.set(player.id, {
        x: player.x,
        y: player.y,
        previousX: player.x,
        previousY: player.y,
        color: player.color
      });
    } else {
      old.previousX = old.x;
      old.previousY = old.y;
      old.x = player.x;
      old.y = player.y;
      old.color = player.color;
    }
  }

  for (const oldId of renderPlayers.keys()) {
    if (!state.players.some((player) => player.id === oldId)) {
      renderPlayers.delete(oldId);
    }
  }

  if (previous) {
    const oldMe = previous.players.find((player) => player.id === myId);
    const newMe = state.players.find((player) => player.id === myId);

    if (oldMe && newMe && oldMe.carryingCoreId !== newMe.carryingCoreId) {
      burst(
        newMe.x,
        newMe.y,
        newMe.carryingCoreId ? '#ffdd56' : '#ff6688',
        22
      );

      screenShake = 8;
    }
  }

  updateHud();
}

function updateHud() {
  if (!latestState) return;

  const me = latestState.players.find((player) => player.id === myId);

  const phaseName =
    latestState.phase === 'build'
      ? 'BUILD PHASE'
      : latestState.phase === 'raid'
        ? 'RAID PHASE'
        : 'ROUND COMPLETE';

  phaseElement.textContent =
    `${phaseName} · ${latestState.phaseRemaining}s`;

  if (!me) return;

  statsElement.innerHTML = [
    `<b>${escapeHtml(me.nickname)}</b>`,
    `HP ${Math.ceil(me.hp)}/${me.maxHp}`,
    `Score ${me.roundScore}`,
    `Wood ${me.inventory.wood} · Stone ${me.inventory.stone}`,
    `Build: ${buildNames[selectedBuild]}`
  ].join('<br>');

  scoresElement.innerHTML = latestState.leaderboard
    .map((entry, index) =>
      `<div class="row"><span>${index + 1}. ${escapeHtml(entry.nickname)}</span><b>${entry.score}</b></div>`
    )
    .join('');

  if (latestState.phase === 'build') {
    hintElement.textContent =
      'Gather near resource rocks with E. Right-click nearby to build. Protect your core!';
  } else if (latestState.phase === 'raid') {
    hintElement.textContent = me.carryingCoreId
      ? 'CORE STOLEN! Return to your own glowing core to extract it!'
      : 'Find a rival core, smash through their fort, and bring it home.';
  } else {
    hintElement.textContent =
      'The next round starts automatically. Get ready for another heist!';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

function sendInput(extra = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: 'input',
    input: {
      up: Boolean(keys.w || keys.ArrowUp),
      down: Boolean(keys.s || keys.ArrowDown),
      left: Boolean(keys.a || keys.ArrowLeft),
      right: Boolean(keys.d || keys.ArrowRight),
      attack: Boolean(extra.attack),
      gather: Boolean(keys.e),
      dash: Boolean(extra.dash),
      place: extra.place || null
    }
  }));
}

window.addEventListener('keydown', (event) => {
  keys[event.key] = true;
  keys[event.key.toLowerCase()] = true;

  if (event.key === '1') selectedBuild = 'wood';
  if (event.key === '2') selectedBuild = 'stone';
  if (event.key === '3') selectedBuild = 'gate';
  if (event.key === '4') selectedBuild = 'pad';

  if (event.key === ' ') {
    event.preventDefault();
    sendInput({ dash: true });
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.key] = false;
  keys[event.key.toLowerCase()] = false;
});

canvas.addEventListener('mousemove', (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
  updateMouseWorld();
});

canvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    sendInput({ attack: true });
    burst(mouse.worldX, mouse.worldY, '#ffffff', 4);
  }

  if (event.button === 2) {
    event.preventDefault();

    sendInput({
      place: {
        type: selectedBuild,
        x: mouse.worldX,
        y: mouse.worldY
      }
    });
  }
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function updateMouseWorld() {
  mouse.worldX = mouse.x / camera.zoom + camera.x;
  mouse.worldY = mouse.y / camera.zoom + camera.y;
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 80;

    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: .45 + Math.random() * .55,
      maxLife: 1,
      color,
      size: 2 + Math.random() * 4
    });
  }
}

function updateParticles(dt) {
  for (const particle of particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= .96;
    particle.vy *= .96;
    particle.life -= dt;
  }

  particles = particles.filter((particle) => particle.life > 0);
}

function updateCamera() {
  const me = latestState?.players.find((player) => player.id === myId);

  camera.zoom = Math.min(innerWidth / 1000, innerHeight / 650);
  camera.zoom = Math.max(.72, Math.min(1.2, camera.zoom));

  if (me) {
    camera.x = me.x - innerWidth / camera.zoom / 2;
    camera.y = me.y - innerHeight / camera.zoom / 2;
  } else {
    camera.x = world.width / 2 - innerWidth / camera.zoom / 2;
    camera.y = world.height / 2 - innerHeight / camera.zoom / 2;
  }

  camera.x = Math.max(
    0,
    Math.min(world.width - innerWidth / camera.zoom, camera.x)
  );

  camera.y = Math.max(
    0,
    Math.min(world.height - innerHeight / camera.zoom, camera.y)
  );

  updateMouseWorld();
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom,
    y: (y - camera.y) * camera.zoom
  };
}

function drawBackground() {
  ctx.fillStyle = '#101c2d';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  ctx.save();
  ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);

  ctx.fillStyle = '#172943';
  ctx.fillRect(0, 0, world.width, world.height);

  ctx.strokeStyle = 'rgba(144, 193, 225, .08)';
  ctx.lineWidth = 1;

  for (let x = 0; x <= world.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, world.height);
    ctx.stroke();
  }

  for (let y = 0; y <= world.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#457090';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, world.width - 6, world.height - 6);

  ctx.restore();
}

function drawResourceNodes() {
  for (const node of latestState.nodes) {
    const point = worldToScreen(node.x, node.y);
    const color = node.type === 'wood' ? '#a87048' : '#8a9caf';

    ctx.save();
    ctx.translate(point.x, point.y);

    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(0, 12, 28, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();

    if (node.type === 'wood') {
      ctx.moveTo(-20, 12);
      ctx.lineTo(-17, -12);
      ctx.lineTo(-4, -25);
      ctx.lineTo(8, -12);
      ctx.lineTo(18, 10);
    } else {
      ctx.moveTo(-22, 8);
      ctx.lineTo(-12, -20);
      ctx.lineTo(14, -23);
      ctx.lineTo(23, 5);
      ctx.lineTo(7, 20);
    }

    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawStructures() {
  for (const structure of latestState.structures) {
    const point = worldToScreen(structure.x, structure.y);
    const width = structure.width * camera.zoom;
    const height = structure.height * camera.zoom;

    ctx.save();
    ctx.translate(point.x, point.y);

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-width / 2 + 4, -height / 2 + 5, width, height);

    ctx.fillStyle = structure.color;
    ctx.strokeStyle = '#172033';
    ctx.lineWidth = 3;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeRect(-width / 2, -height / 2, width, height);

    const ratio = Math.max(0, structure.health / structure.maxHealth);

    ctx.fillStyle = '#66e6b0';
    ctx.fillRect(-width / 2, -height / 2 - 7, width * ratio, 4);

    ctx.restore();
  }
}

function drawCores() {
  for (const core of latestState.cores) {
    const owner = latestState.players.find(
      (player) => player.id === core.ownerId
    );

    if (!owner) continue;

    const point = worldToScreen(core.x, core.y);

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.shadowColor = owner.color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#fff5a7';
    ctx.beginPath();
    ctx.arc(0, 0, 11 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = owner.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 20 * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(core.carriedBy ? 'STOLEN' : 'CORE', 0, -28);

    ctx.restore();
  }
}

function drawPlayers(dt) {
  for (const player of latestState.players) {
    const render = renderPlayers.get(player.id);

    if (!render) continue;

    const blend = Math.min(1, dt * 14);

    render.previousX += (render.x - render.previousX) * blend;
    render.previousY += (render.y - render.previousY) * blend;

    const point = worldToScreen(render.previousX, render.previousY);
    const radius = 17 * camera.zoom;

    ctx.save();
    ctx.translate(point.x, point.y);

    if (!player.alive) {
      ctx.globalAlpha = .35;
      ctx.fillStyle = '#6d7890';
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(0, radius + 5, radius * 1.1, radius * .35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = player.color;
    ctx.strokeStyle = player.id === myId ? '#ffffff' : '#162238';
    ctx.lineWidth = player.id === myId ? 3 : 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (player.carryingCoreId) {
      ctx.strokeStyle = '#ffe76a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#0a1424';
    ctx.fillRect(-22, -radius - 13, 44, 4);

    ctx.fillStyle = '#67e6ae';
    ctx.fillRect(
      -22,
      -radius - 13,
      44 * Math.max(0, player.hp / player.maxHp),
      4
    );

    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(10, 12 * camera.zoom)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(player.nickname, 0, radius + 19);

    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of particles) {
    const point = worldToScreen(particle.x, particle.y);

    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      particle.size * camera.zoom,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawBuildPreview() {
  if (!latestState || latestState.phase !== 'build') return;

  const point = worldToScreen(mouse.worldX, mouse.worldY);

  const sizes = {
    wood: [72, 20],
    stone: [72, 24],
    gate: [52, 30],
    pad: [42, 42]
  };

  const size = sizes[selectedBuild];

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.globalAlpha = .5;
  ctx.fillStyle = selectedBuild === 'stone' ? '#91a0b2' : '#b97b50';
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 2;

  ctx.fillRect(
    -size[0] * camera.zoom / 2,
    -size[1] * camera.zoom / 2,
    size[0] * camera.zoom,
    size[1] * camera.zoom
  );

  ctx.strokeRect(
    -size[0] * camera.zoom / 2,
    -size[1] * camera.zoom / 2,
    size[0] * camera.zoom,
    size[1] * camera.zoom
  );

  ctx.restore();
}

function draw() {
  const now = performance.now();
  const dt = Math.min(.05, (now - lastFrame) / 1000);

  lastFrame = now;
  updateParticles(dt);

  if (latestState) {
    updateCamera();

    ctx.save();

    if (screenShake > 0) {
      ctx.translate(
        (Math.random() - .5) * screenShake,
        (Math.random() - .5) * screenShake
      );

      screenShake *= .9;

      if (screenShake < .2) {
        screenShake = 0;
      }
    }

    drawBackground();
    drawResourceNodes();
    drawStructures();
    drawCores();
    drawPlayers(dt);
    drawParticles();
    drawBuildPreview();

    ctx.restore();
  } else {
    ctx.fillStyle = '#101c2d';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  if (Date.now() - lastInput > 50) {
    lastInput = Date.now();
    sendInput();
  }

  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
