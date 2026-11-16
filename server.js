'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const TICK_RATE = 20;
const DT = 1 / TICK_RATE;

const WORLD = {
  width: 1200,
  height: 700,
  playerRadius: 17,
  maxPlayers: 8,
  minContestants: 4,
  buildSeconds: 45,
  raidSeconds: 90,
  intermissionSeconds: 8,
  roundSeconds: 135
};

const COLORS = [
  '#ff5577',
  '#4dc9ff',
  '#ffd447',
  '#9b7bff',
  '#40e890',
  '#ff914d',
  '#ed6bff',
  '#62e6d9'
];

const BUILD_TYPES = {
  wood: {
    name: 'Wood Wall',
    cost: 2,
    health: 80,
    width: 72,
    height: 20,
    color: '#a96843'
  },
  stone: {
    name: 'Stone Wall',
    cost: 4,
    health: 170,
    width: 72,
    height: 24,
    color: '#718096'
  },
  gate: {
    name: 'Gate',
    cost: 5,
    health: 130,
    width: 52,
    height: 30,
    color: '#cc8c49'
  },
  pad: {
    name: 'Launch Pad',
    cost: 6,
    health: 90,
    width: 42,
    height: 42,
    color: '#43d7ce'
  }
};

const rooms = new Map();
const leaderboard = new Map();

function id(prefix = '') {
  return prefix + crypto.randomBytes(5).toString('hex');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(value) {
  const name = String(value || 'Rookie')
    .replace(/[^\w \-!?.]/g, '')
    .trim()
    .slice(0, 18);

  return name || 'Rookie';
}

function roomCode() {
  let code;

  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(code));

  return code;
}

function createResourceNodes() {
  return [
    { id: 'wood-a', type: 'wood', x: 300, y: 160, amount: 9999 },
    { id: 'wood-b', type: 'wood', x: 900, y: 540, amount: 9999 },
    { id: 'wood-c', type: 'wood', x: 600, y: 110, amount: 9999 },
    { id: 'stone-a', type: 'stone', x: 890, y: 160, amount: 9999 },
    { id: 'stone-b', type: 'stone', x: 300, y: 540, amount: 9999 },
    { id: 'stone-c', type: 'stone', x: 600, y: 590, amount: 9999 }
  ];
}

function basePosition(index) {
  const points = [
    { x: 110, y: 110 },
    { x: 1090, y: 110 },
    { x: 110, y: 590 },
    { x: 1090, y: 590 },
    { x: 600, y: 70 },
    { x: 600, y: 630 },
    { x: 70, y: 350 },
    { x: 1130, y: 350 }
  ];

  return points[index % points.length];
}

function createRoom(code) {
  const room = {
    code,
    players: new Map(),
    structures: new Map(),
    nodes: createResourceNodes(),
    phase: 'build',
    phaseStartedAt: Date.now(),
    roundNumber: 1,
    nextColor: 0,
    lastBroadcast: 0,
    createdAt: Date.now()
  };

  rooms.set(code, room);
  return room;
}

function getRunningRoom() {
  for (const room of rooms.values()) {
    if (room.players.size < WORLD.maxPlayers) {
      return room;
    }
  }

  return createRoom(roomCode());
}

function createPlayer(room, nickname, socket, bot = false) {
  const index = room.nextColor++;
  const home = basePosition(index);
  const safeName = cleanName(nickname);

  const player = {
    id: id('p_'),
    nickname: safeName,
    color: COLORS[index % COLORS.length],
    index,
    bot,
    socket: socket || null,
    roomCode: room.code,

    x: home.x,
    y: home.y,
    targetX: home.x,
    targetY: home.y,
    homeX: home.x,
    homeY: home.y,

    radius: WORLD.playerRadius,
    hp: 100,
    maxHp: 100,
    alive: true,
    respawnAt: 0,
    invulnerableUntil: Date.now() + 1200,

    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      attack: false,
      gather: false,
      dash: false,
      place: null
    },

    inventory: {
      wood: 8,
      stone: 4
    },

    carryingCoreId: null,
    roundScore: 0,
    totalScore: leaderboard.get(safeName) || 0,
    scrap: 0,
    kills: 0,
    placed: 0,
    gathered: 0,
    extracted: 0,
    lastAttackAt: 0,
    lastGatherAt: 0,
    lastDashAt: 0,
    botThinkAt: 0
  };

  room.players.set(player.id, player);

  if (!bot) {
    leaderboard.set(player.nickname, player.totalScore);
  }

  return player;
}

function createBot(room) {
  if (room.players.size >= WORLD.maxPlayers) return null;

  const names = [
    'BrickBot',
    'DashUnit',
    'Wall-E',
    'Core Scout',
    'Fort Fox',
    'Rivet',
    'Bolt',
    'Masonry'
  ];

  const used = new Set([...room.players.values()].map((player) => player.nickname));
  const nickname =
    names.find((name) => !used.has(name)) ||
    `Bot ${room.players.size + 1}`;

  return createPlayer(room, nickname, null, true);
}

function fillRoomWithBots(room) {
  while (
    room.players.size < WORLD.minContestants &&
    room.players.size < WORLD.maxPlayers
  ) {
    createBot(room);
  }
}

function resetPlayerForRound(player) {
  player.x = player.homeX;
  player.y = player.homeY;
  player.targetX = player.homeX;
  player.targetY = player.homeY;
  player.hp = player.maxHp;
  player.alive = true;
  player.respawnAt = 0;
  player.invulnerableUntil = Date.now() + 1000;
  player.carryingCoreId = null;
  player.inventory.wood = 8;
  player.inventory.stone = 4;
  player.roundScore = 0;
  player.placed = 0;
  player.gathered = 0;
  player.extracted = 0;
  player.kills = 0;
}

function resetRound(room) {
  room.roundNumber++;
  room.phase = 'build';
  room.phaseStartedAt = Date.now();
  room.structures.clear();
  room.nodes = createResourceNodes();

  for (const player of room.players.values()) {
    resetPlayerForRound(player);
  }
}

function phaseDuration(room) {
  if (room.phase === 'build') return WORLD.buildSeconds;
  if (room.phase === 'raid') return WORLD.raidSeconds;
  return WORLD.intermissionSeconds;
}

function phaseRemaining(room) {
  const elapsed = (Date.now() - room.phaseStartedAt) / 1000;
  return Math.max(0, phaseDuration(room) - elapsed);
}

function finishRound(room) {
  for (const player of room.players.values()) {
    if (!player.alive) continue;

    if (!player.carryingCoreId) {
      player.roundScore += 10;
    }

    player.totalScore += player.roundScore;
    player.scrap += Math.max(5, Math.floor(player.roundScore / 4));
    leaderboard.set(player.nickname, player.totalScore);
  }
}

function updatePhase(room) {
  if (phaseRemaining(room) > 0) return;

  if (room.phase === 'build') {
    room.phase = 'raid';
    room.phaseStartedAt = Date.now();
    return;
  }

  if (room.phase === 'raid') {
    finishRound(room);
    room.phase = 'intermission';
    room.phaseStartedAt = Date.now();
    return;
  }

  resetRound(room);
}

function circleIntersectsRect(circle, rect) {
  const closestX = clamp(
    circle.x,
    rect.x - rect.width / 2,
    rect.x + rect.width / 2
  );

  const closestY = clamp(
    circle.y,
    rect.y - rect.height / 2,
    rect.y + rect.height / 2
  );

  return Math.hypot(circle.x - closestX, circle.y - closestY) < circle.radius;
}

function collidesWithStructure(room, circle, ignoreId = null) {
  for (const structure of room.structures.values()) {
    if (structure.id === ignoreId || structure.health <= 0) continue;

    if (circleIntersectsRect(circle, structure)) {
      return structure;
    }
  }

  return null;
}

function movePlayer(room, player, dx, dy) {
  if (!player.alive) return;

  const speed = player.carryingCoreId ? 112 : 150;
  const length = Math.hypot(dx, dy);

  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  const nx = clamp(
    player.x + dx * speed * DT,
    player.radius,
    WORLD.width - player.radius
  );

  const ny = clamp(
    player.y + dy * speed * DT,
    player.radius,
    WORLD.height - player.radius
  );

  if (!collidesWithStructure(room, { x: nx, y: player.y, radius: player.radius })) {
    player.x = nx;
  }

  if (!collidesWithStructure(room, { x: player.x, y: ny, radius: player.radius })) {
    player.y = ny;
  }

  player.targetX = player.x;
  player.targetY = player.y;
}

function resetCoreToOwner(room, coreId) {
  const owner = room.players.get(coreId);

  if (owner) {
    owner.carryingCoreId = null;
  }
}

function respawnPlayer(room, player) {
  player.x = player.homeX;
  player.y = player.homeY;
  player.hp = player.maxHp;
  player.alive = true;
  player.respawnAt = 0;
  player.invulnerableUntil = Date.now() + 1500;

  if (player.carryingCoreId) {
    resetCoreToOwner(room, player.carryingCoreId);
    player.carryingCoreId = null;
  }
}

function damagePlayer(room, attacker, victim, amount) {
  if (!victim.alive || Date.now() < victim.invulnerableUntil) return;

  victim.hp -= amount;

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.respawnAt = Date.now() + 2500;

    if (victim.carryingCoreId) {
      resetCoreToOwner(room, victim.carryingCoreId);
      victim.carryingCoreId = null;
    }

    if (attacker && attacker.id !== victim.id) {
      attacker.kills++;
      attacker.roundScore += 15;
    }
  }
}

function performAttack(room, attacker) {
  const now = Date.now();

  if (!attacker.alive || now - attacker.lastAttackAt < 550) return;

  attacker.lastAttackAt = now;

  let closest = null;
  let closestDistance = 78;

  for (const victim of room.players.values()) {
    if (victim.id === attacker.id || !victim.alive) continue;

    const currentDistance = distance(attacker, victim);

    if (currentDistance < closestDistance) {
      closest = victim;
      closestDistance = currentDistance;
    }
  }

  if (closest) {
    damagePlayer(room, attacker, closest, 34);
    return;
  }

  for (const structure of room.structures.values()) {
    if (structure.ownerId === attacker.id) continue;

    if (Math.hypot(attacker.x - structure.x, attacker.y - structure.y) < 88) {
      structure.health -= 42;
      attacker.roundScore += 2;

      if (structure.health <= 0) {
        room.structures.delete(structure.id);
        attacker.roundScore += 8;
      }

      return;
    }
  }
}

function gather(room, player) {
  const now = Date.now();

  if (!player.alive || now - player.lastGatherAt < 600) return;

  player.lastGatherAt = now;

  for (const node of room.nodes) {
    if (distance(player, node) < 48) {
      player.inventory[node.type] += 2;
      player.gathered += 2;
      player.roundScore += 2;
      return;
    }
  }
}

function validBuildPosition(room, player, type, x, y) {
  const definition = BUILD_TYPES[type];

  if (!definition || room.phase !== 'build' || !player.alive) {
    return false;
  }

  if (Math.hypot(x - player.x, y - player.y) > 150) {
    return false;
  }

  if (
    x < definition.width / 2 ||
    x > WORLD.width - definition.width / 2 ||
    y < definition.height / 2 ||
    y > WORLD.height - definition.height / 2
  ) {
    return false;
  }

  for (const structure of room.structures.values()) {
    const overlapX =
      Math.abs(x - structure.x) <
      (definition.width + structure.width) / 2;

    const overlapY =
      Math.abs(y - structure.y) <
      (definition.height + structure.height) / 2;

    if (overlapX && overlapY) return false;
  }

  for (const other of room.players.values()) {
    if (other.id !== player.id && Math.hypot(other.x - x, other.y - y) < 38) {
      return false;
    }
  }

  return true;
}

function placeStructure(room, player, payload) {
  if (!payload || room.phase !== 'build') return;

  const type = String(payload.type || '');
  const definition = BUILD_TYPES[type];

  if (!definition) return;

  const x = Math.round(Number(payload.x) / 10) * 10;
  const y = Math.round(Number(payload.y) / 10) * 10;

  if (!validBuildPosition(room, player, type, x, y)) return;

  if (type === 'wood') {
    if (player.inventory.wood < 2) return;
    player.inventory.wood -= 2;
  } else if (type === 'stone') {
    if (player.inventory.stone < 4) return;
    player.inventory.stone -= 4;
  } else if (type === 'gate') {
    if (player.inventory.wood < 3 || player.inventory.stone < 2) return;
    player.inventory.wood -= 3;
    player.inventory.stone -= 2;
  } else if (type === 'pad') {
    if (player.inventory.stone < 6) return;
    player.inventory.stone -= 6;
  }

  room.structures.set(id('s_'), {
    id: id('s_'),
    ownerId: player.id,
    type,
    x,
    y,
    width: definition.width,
    height: definition.height,
    health: definition.health,
    maxHealth: definition.health,
    color: definition.color
  });

  player.placed++;
  player.roundScore += 3;
}

function attemptCoreInteraction(room, player) {
  if (room.phase !== 'raid' || !player.alive) return;

  if (player.carryingCoreId) {
    const owner = room.players.get(player.carryingCoreId);

    if (owner && distance(player, owner) < 48) {
      player.roundScore += 100;
      player.extracted++;
      player.totalScore += 100;
      player.scrap += 20;
      leaderboard.set(player.nickname, player.totalScore);

      owner.carryingCoreId = null;
      player.carryingCoreId = null;
    }

    return;
  }

  for (const owner of room.players.values()) {
    if (owner.id === player.id || owner.carryingCoreId) continue;

    if (distance(player, owner) < 42) {
      owner.carryingCoreId = player.id;
      player.carryingCoreId = owner.id;
      player.roundScore += 40;
      return;
    }
  }
}

function runBotBrain(room, bot) {
  const now = Date.now();

  if (now < bot.botThinkAt) return;

  bot.botThinkAt = now + 300 + Math.random() * 500;

  bot.input.up = false;
  bot.input.down = false;
  bot.input.left = false;
  bot.input.right = false;
  bot.input.attack = false;
  bot.input.gather = false;
  bot.input.dash = false;
  bot.input.place = null;

  let destination = null;

  if (room.phase === 'build') {
    const node = room.nodes[(bot.index + room.roundNumber) % room.nodes.length];
    destination = node;

    if (distance(bot, node) < 48) {
      bot.input.gather = true;
    }

    if (Math.random() < 0.45) {
      bot.input.place = {
        type: bot.inventory.stone >= 6 && Math.random() < 0.3 ? 'pad' : 'wood',
        x: bot.homeX + (Math.random() * 2 - 1) * 90,
        y: bot.homeY + (Math.random() * 2 - 1) * 90
      };
    }
  } else if (room.phase === 'raid') {
    if (bot.carryingCoreId) {
      destination = { x: bot.homeX, y: bot.homeY };
    } else {
      const targets = [...room.players.values()].filter(
        (player) => player.id !== bot.id
      );

      destination = targets.length
        ? targets[(bot.index + room.roundNumber) % targets.length]
        : { x: WORLD.width / 2, y: WORLD.height / 2 };
    }

    if (destination && distance(bot, destination) < 70) {
      bot.input.attack = true;
    }
  }

  if (destination) {
    const dx = destination.x - bot.x;
    const dy = destination.y - bot.y;

    bot.input.left = dx < -8;
    bot.input.right = dx > 8;
    bot.input.up = dy < -8;
    bot.input.down = dy > 8;
  }
}

function processPlayer(room, player) {
  if (player.bot) runBotBrain(room, player);

  if (!player.alive) {
    if (Date.now() >= player.respawnAt && room.phase !== 'intermission') {
      respawnPlayer(room, player);
    }

    return;
  }

  const input = player.input;
  let dx = 0;
  let dy = 0;

  if (input.left) dx--;
  if (input.right) dx++;
  if (input.up) dy--;
  if (input.down) dy++;

  if (input.dash && Date.now() - player.lastDashAt > 1800) {
    player.lastDashAt = Date.now();
    movePlayer(room, player, dx * 2.7, dy * 2.7);
  } else {
    movePlayer(room, player, dx, dy);
  }

  if (input.gather) gather(room, player);
  if (input.attack) performAttack(room, player);

  if (input.place) {
    placeStructure(room, player, input.place);
    input.place = null;
  }

  attemptCoreInteraction(room, player);

  if (player.carryingCoreId) {
    player.roundScore += 0.01;
  }
}

function publicPlayer(player) {
  return {
    id: player.id,
    nickname: player.nickname,
    color: player.color,
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    hp: player.hp,
    maxHp: player.maxHp,
    alive: player.alive,
    homeX: player.homeX,
    homeY: player.homeY,
    carryingCoreId: player.carryingCoreId,
    roundScore: Math.floor(player.roundScore),
    totalScore: player.totalScore,
    scrap: player.scrap,
    inventory: player.inventory,
    bot: player.bot
  };
}

function roomSnapshot(room) {
  const cores = [...room.players.values()].map((owner) => {
    const carrier = owner.carryingCoreId
      ? room.players.get(owner.carryingCoreId)
      : null;

    return {
      ownerId: owner.id,
      x: carrier ? carrier.x : owner.homeX,
      y: carrier ? carrier.y : owner.homeY,
      carriedBy: owner.carryingCoreId
    };
  });

  const topScores = [...leaderboard.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([nickname, score]) => ({ nickname, score }));

  return {
    type: 'state',
    room: room.code,
    phase: room.phase,
    phaseRemaining: Math.ceil(phaseRemaining(room)),
    round: room.roundNumber,
    world: WORLD,
    players: [...room.players.values()].map(publicPlayer),
    structures: [...room.structures.values()],
    nodes: room.nodes,
    cores,
    leaderboard: topScores
  };
}

function send(socket, data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcast(room) {
  const state = roomSnapshot(room);

  for (const player of room.players.values()) {
    if (!player.bot) send(player.socket, state);
  }
}

function removePlayer(player) {
  const room = rooms.get(player.roomCode);

  if (!room) return;

  if (player.carryingCoreId) {
    resetCoreToOwner(room, player.carryingCoreId);
  }

  room.players.delete(player.id);

  for (const structure of room.structures.values()) {
    if (structure.ownerId === player.id) {
      room.structures.delete(structure.id);
    }
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
  }
}

function handleMessage(socket, rawMessage) {
  let data;

  try {
    data = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (data.type === 'join') {
    if (socket.player) return;

    const requestedRoom = String(data.room || '').trim().toUpperCase();
    let room = requestedRoom
      ? rooms.get(requestedRoom)
      : getRunningRoom();

    if (!room || room.players.size >= WORLD.maxPlayers) {
      room = createRoom(roomCode());
    }

    const bot = [...room.players.values()].find((player) => player.bot);

    if (bot) {
      room.players.delete(bot.id);
    }

    const player = createPlayer(room, data.nickname, socket);
    socket.player = player;

    fillRoomWithBots(room);

    send(socket, {
      type: 'welcome',
      id: player.id,
      room: room.code,
      nickname: player.nickname
    });

    broadcast(room);
    return;
  }

  const player = socket.player;

  if (!player) return;

  if (data.type === 'input') {
    const input = data.input || {};

    player.input.up = Boolean(input.up);
    player.input.down = Boolean(input.down);
    player.input.left = Boolean(input.left);
    player.input.right = Boolean(input.right);
    player.input.attack = Boolean(input.attack);
    player.input.gather = Boolean(input.gather);
    player.input.dash = Boolean(input.dash);

    if (input.place && typeof input.place === 'object') {
      player.input.place = {
        type: String(input.place.type),
        x: Number(input.place.x),
        y: Number(input.place.y)
      };
    }
  }

  if (data.type === 'respawn') {
    const room = rooms.get(player.roomCode);

    if (
      room &&
      !player.alive &&
      Date.now() >= player.respawnAt
    ) {
      respawnPlayer(room, player);
    }
  }
}

const app = express();

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/play', (req, res) => {
  res.sendFile('play.html', { root: 'public' });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    game: 'CoreHeist.io',
    rooms: rooms.size,
    players: [...rooms.values()].reduce(
      (total, room) => total + room.players.size,
      0
    ),
    uptime: process.uptime()
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  socket.on('message', (message) => {
    handleMessage(socket, message.toString());
  });

  socket.on('close', () => {
    if (socket.player) {
      removePlayer(socket.player);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    updatePhase(room);

    for (const player of room.players.values()) {
      processPlayer(room, player);
    }

    if (Date.now() - room.lastBroadcast >= 1000 / 15) {
      room.lastBroadcast = Date.now();
      broadcast(room);
    }
  }
}, 1000 / TICK_RATE);

setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms.entries()) {
    if (
      room.players.size === 0 ||
      now - room.createdAt > 1000 * 60 * 60
    ) {
      rooms.delete(code);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`CoreHeist.io server listening on port ${PORT}`);
});
