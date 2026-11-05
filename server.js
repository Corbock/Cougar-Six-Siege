const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const players = new Map();
const parties = new Map();
const lobbies = new Map();
const playlistMaps = {
  standard: ["field", "harbor", "foundry"],
  ranked: ["field", "harbor"],
  defuse: ["field", "foundry"],
  rescue: ["harbor", "foundry"],
  duel: ["field"]
};
const quickMatchPlaylists = ["standard", "defuse", "rescue", "duel"];
const queueSeconds = Number(process.env.QUEUE_SECONDS || 60);
const fullLobbySeconds = 15;
const prepSeconds = Number(process.env.PREP_SECONDS || 45);
const roundEndSeconds = 6;
const matchOverSeconds = 8;
const roundsToWin = 2;
const spawnXs = [-17.6, -5.9, 5.9, 17.6, 29.3];
const spawnZ = 50.5;
const barrierClampZ = 0.7;
const matches = new Map();
const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendPlayer(player, message) {
  if (player) send(player.socket, message);
}

function broadcastParty(party) {
  const members = [...party.members].map((id) => players.get(id)).filter(Boolean);
  const message = { type: "party_update", code: party.code, leader: party.leader, members: members.map(({ id, name }) => ({ id, name })) };
  members.forEach((member) => sendPlayer(member, message));
}

function broadcastOnline() {
  const message = { type: "online", count: players.size };
  players.forEach((player) => sendPlayer(player, message));
}

function notifyQueue(unit, status, extra = {}) {
  unit.members.forEach((id) => sendPlayer(players.get(id), { type: "queue_status", mode: unit.mode, status, ...extra }));
}

function teamSize(mode) {
  return mode === "duel" ? 1 : 5;
}

function assignTeams(units, target) {
  const teams = [[], []];
  const sizes = [0, 0];
  for (const unit of [...units].sort((a, b) => b.members.length - a.members.length)) {
    const side = sizes[0] <= sizes[1] ? 0 : 1;
    if (sizes[side] + unit.members.length > target) return null;
    teams[side].push(unit);
    sizes[side] += unit.members.length;
  }
  return teams;
}

function lobbySize(lobby) {
  return lobby.units.reduce((total, unit) => total + unit.members.length, 0);
}

function lobbyMembers(lobby) {
  return lobby.units.flatMap((unit) => unit.members).map((id) => players.get(id)).filter(Boolean);
}

function findLobby(mode, size) {
  const candidate = { members: new Array(size) };
  let best = null;
  for (const lobby of lobbies.values()) {
    if (lobby.mode !== mode || !assignTeams([...lobby.units, candidate], teamSize(mode))) continue;
    if (!best || lobbySize(lobby) > lobbySize(best)) best = lobby;
  }
  return best;
}

function scheduleLobby(lobby) {
  clearTimeout(lobby.timer);
  lobby.timer = null;
  if (lobby.units.length < 2) {
    lobby.deadline = lobby.baseDeadline = lobby.fullDeadline = null;
    return;
  }
  const now = Date.now();
  lobby.baseDeadline ??= now + queueSeconds * 1000;
  if (!lobby.fullDeadline && lobbySize(lobby) >= teamSize(lobby.mode) * 2) lobby.fullDeadline = now + fullLobbySeconds * 1000;
  lobby.deadline = Math.min(lobby.baseDeadline, lobby.fullDeadline ?? Infinity);
  lobby.timer = setTimeout(() => startLobby(lobby), Math.max(0, lobby.deadline - now));
}

function broadcastLobby(lobby) {
  const tally = Object.fromEntries(lobby.options.map((map) => [map, 0]));
  lobby.ballots.forEach((map) => { tally[map]++; });
  const members = lobbyMembers(lobby);
  const startsInMs = lobby.deadline ? Math.max(0, lobby.deadline - Date.now()) : null;
  members.forEach((member) => sendPlayer(member, {
    type: "lobby_update",
    mode: lobby.mode,
    options: lobby.options,
    tally,
    voted: lobby.ballots.size,
    total: members.length,
    capacity: teamSize(lobby.mode) * 2,
    startsInMs,
    fastStart: Boolean(lobby.fullDeadline),
    myVote: lobby.ballots.get(member.id) || null
  }));
}

function enqueueUnit(unit) {
  let lobby = findLobby(unit.mode, unit.members.length);
  if (!lobby) {
    lobby = { id: crypto.randomUUID(), mode: unit.mode, units: [], ballots: new Map(), options: playlistMaps[unit.mode], timer: null, deadline: null, baseDeadline: null, fullDeadline: null };
    lobbies.set(lobby.id, lobby);
  }
  lobby.units.push(unit);
  unit.members.forEach((id) => {
    const member = players.get(id);
    member.queuedMode = unit.mode;
    member.lobbyId = lobby.id;
  });
  notifyQueue(unit, "searching", { partySize: unit.members.length });
  scheduleLobby(lobby);
  broadcastLobby(lobby);
}

function removeFromQueue(player) {
  const lobby = lobbies.get(player.lobbyId);
  player.lobbyId = null;
  if (!lobby) {
    player.queuedMode = null;
    return;
  }
  const unit = lobby.units.find((entry) => entry.members.includes(player.id));
  if (!unit) return;
  lobby.units = lobby.units.filter((entry) => entry !== unit);
  unit.members.forEach((id) => {
    lobby.ballots.delete(id);
    const member = players.get(id);
    if (member) {
      member.queuedMode = null;
      member.lobbyId = null;
    }
  });
  notifyQueue(unit, "cancelled");
  if (!lobby.units.length) {
    clearTimeout(lobby.timer);
    lobbies.delete(lobby.id);
    return;
  }
  scheduleLobby(lobby);
  broadcastLobby(lobby);
}

function detachParty(player) {
  if (!player.partyCode) return;
  const party = parties.get(player.partyCode);
  player.partyCode = null;
  if (!party) return;
  party.members.delete(player.id);
  if (!party.members.size) {
    parties.delete(party.code);
    return;
  }
  if (party.leader === player.id) party.leader = party.members.values().next().value;
  broadcastParty(party);
}

function spawnPoint(team, index) {
  return { x: spawnXs[index % spawnXs.length], y: 1.8, z: team === 1 ? -spawnZ : spawnZ, yaw: team === 1 ? 0 : Math.PI };
}

function matchInfo(match) {
  return {
    matchId: match.id,
    mode: match.mode,
    map: match.map,
    round: match.round,
    phase: match.phase,
    phaseMs: Math.max(0, match.phaseEnd - Date.now()),
    wins: match.wins,
    roundsToWin
  };
}

let dropCounter = 0;
const extraDrops = ["grenade", "medkit", "wood", "metal"];

function dropLoot(match, victim) {
  const state = victim.state || victim.spawn;
  if (!state) return;
  const floor = Math.max(0, state.y - (state.crouched ? 1.05 : 1.8));
  const kinds = ["ammo"];
  if (Math.random() < .3) kinds.push(extraDrops[Math.floor(Math.random() * extraDrops.length)]);
  kinds.forEach((kind, index) => {
    const drop = { id: `d${++dropCounter}`, kind, x: state.x + (index ? .7 : 0), y: floor, z: state.z + (index ? .4 : 0) };
    match.drops.set(drop.id, drop);
    for (const id of match.players) sendPlayer(players.get(id), { type: "drop", ...drop });
  });
}

function startRound(match, type) {
  match.round++;
  match.drops = new Map();
  match.phase = "prep";
  match.phaseEnd = Date.now() + prepSeconds * 1000;
  const slots = { 1: 0, 2: 0 };
  const members = [...match.players].map((id) => players.get(id)).filter(Boolean);
  for (const player of members) {
    player.health = 100;
    player.medkits = 2;
    player.lastHealAt = 0;
    player.lastShotAt = 0;
    player.spawn = spawnPoint(player.team, slots[player.team]++);
    player.state = { ...player.spawn, pitch: 0, crouched: false, lean: 0, droneState: null };
  }
  const roster = members.map(({ id, name, team }) => ({ id, name, team }));
  for (const player of members) {
    sendPlayer(player, { type, ...matchInfo(match), team: player.team, spawn: player.spawn, players: roster });
  }
}

function teamAlive(match, team) {
  return [...match.players].filter((id) => {
    const player = players.get(id);
    return player && player.team === team && player.health > 0;
  }).length;
}

function checkRound(match) {
  if (match.phase !== "live") return;
  const first = teamAlive(match, 1), second = teamAlive(match, 2);
  if (first && second) return;
  const winner = first ? 1 : second ? 2 : 0;
  if (!winner) return;
  match.wins[winner]++;
  const decided = match.wins[winner] >= roundsToWin;
  match.phase = decided ? "over" : "roundEnd";
  match.phaseEnd = Date.now() + (decided ? matchOverSeconds : roundEndSeconds) * 1000;
  for (const id of match.players) sendPlayer(players.get(id), { type: "round_end", winner, wins: match.wins, matchWinner: decided ? winner : null, phaseMs: match.phaseEnd - Date.now() });
}

function finishMatch(match, reason) {
  matches.delete(match.id);
  for (const id of match.players) {
    const player = players.get(id);
    if (!player) continue;
    player.matchId = null;
    player.team = null;
    sendPlayer(player, { type: "match_ended", reason, final: true });
  }
}

function advanceMatch(match, now) {
  if (now < match.phaseEnd) return;
  if (match.phase === "prep") match.phase = "live", match.phaseEnd = Infinity;
  else if (match.phase === "roundEnd") startRound(match, "round_start");
  else if (match.phase === "over") finishMatch(match, `Team ${match.wins[1] > match.wins[2] ? 1 : 2} won the match ${Math.max(match.wins[1], match.wins[2])}-${Math.min(match.wins[1], match.wins[2])}.`);
}

function leaveMatch(player) {
  if (!player.matchId) return;
  const match = matches.get(player.matchId);
  player.matchId = null;
  player.team = null;
  if (!match) return;
  match.players.delete(player.id);
  for (const id of match.players) sendPlayer(players.get(id), { type: "player_left", playerId: player.id });
  const remaining = [...match.players].map((id) => players.get(id)).filter(Boolean);
  if (!remaining.some((member) => member.team === 1) || !remaining.some((member) => member.team === 2)) {
    finishMatch(match, "The match ended because your opponents left.");
    return;
  }
  checkRound(match);
}

function chooseQuickMatch(size) {
  let best = null;
  let bestCount = -1;
  for (const mode of quickMatchPlaylists) {
    if (mode === "duel" && size > 1) continue;
    const count = findLobby(mode, size) ? lobbySize(findLobby(mode, size)) : 0;
    if (count > bestCount) { best = mode; bestCount = count; }
  }
  return best;
}

function startLobby(lobby) {
  const teams = lobby.units.length >= 2 && assignTeams(lobby.units, teamSize(lobby.mode));
  if (!teams) return scheduleLobby(lobby);
  clearTimeout(lobby.timer);
  lobbies.delete(lobby.id);
  const counts = new Map(lobby.options.map((map) => [map, 0]));
  lobby.ballots.forEach((map) => counts.set(map, counts.get(map) + 1));
  const top = Math.max(...counts.values());
  const winners = lobby.options.filter((map) => counts.get(map) === top);
  createMatch(lobby.mode, teams, winners[Math.floor(Math.random() * winners.length)]);
}

function createMatch(mode, teams, map) {
  const match = { id: crypto.randomUUID(), mode, map, players: new Set(), wins: { 1: 0, 2: 0 }, round: 0, phase: "prep", phaseEnd: 0 };
  teams.forEach((teamUnits, teamIndex) => {
    for (const unit of teamUnits) {
      unit.members.forEach((id) => {
        const player = players.get(id);
        if (!player) return;
        player.matchId = match.id;
        player.lobbyId = null;
        player.queuedMode = null;
        player.team = teamIndex + 1;
        player.kills = 0;
        player.deaths = 0;
        match.players.add(id);
      });
    }
  });
  matches.set(match.id, match);
  startRound(match, "match_found");
}

function joinQueue(player, mode) {
  const party = player.partyCode && parties.get(player.partyCode);
  const members = party ? [...party.members] : [player.id];
  if (mode === "quick") mode = chooseQuickMatch(members.length);
  if (!(mode in playlistMaps)) return sendPlayer(player, { type: "error", message: "Choose a supported playlist." });
  if (player.matchId) return sendPlayer(player, { type: "error", message: "You are already in a match." });
  if (player.queuedMode) return sendPlayer(player, { type: "error", message: "Leave your current queue first." });
  if (mode === "duel" && members.length > 1) return sendPlayer(player, { type: "error", message: "1v1 is solo only. Leave your party to queue." });
  if (mode !== "duel" && members.length > 5) return sendPlayer(player, { type: "error", message: "A squad party can have up to five players." });
  if (party && party.leader !== player.id) return sendPlayer(player, { type: "error", message: "Only the party leader can start the queue." });
  if (members.some((id) => !players.has(id) || players.get(id).matchId || players.get(id).queuedMode)) {
    return sendPlayer(player, { type: "error", message: "Every party member must be online and available." });
  }
  enqueueUnit({ id: crypto.randomUUID(), members, mode });
}

function rayBox(origin, direction, box) {
  let near = 0, far = Infinity;
  for (const axis of ["x", "y", "z"]) {
    const min = box[axis + "0"], max = box[axis + "1"];
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min || origin[axis] > max) return Infinity;
      continue;
    }
    let first = (min - origin[axis]) / direction[axis];
    let second = (max - origin[axis]) / direction[axis];
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return Infinity;
  }
  return far >= 0 ? near : Infinity;
}

function removePlayer(player) {
  removeFromQueue(player);
  detachParty(player);
  leaveMatch(player);
  players.delete(player.id);
  broadcastOnline();
}

function handleMessage(player, raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  if (!message || typeof message.type !== "string") return;

  if (message.type === "set_name") {
    player.name = String(message.name || "OPERATOR").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "OPERATOR";
    sendPlayer(player, { type: "welcome", playerId: player.id, name: player.name });
    if (player.partyCode) broadcastParty(parties.get(player.partyCode));
    return;
  }
  if (message.type === "create_party") {
    if (player.partyCode || player.matchId || player.queuedMode) return sendPlayer(player, { type: "error", message: "Leave your party, match, or queue first." });
    let code;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (parties.has(code));
    const party = { code, leader: player.id, members: new Set([player.id]) };
    parties.set(code, party);
    player.partyCode = code;
    broadcastParty(party);
    return;
  }
  if (message.type === "join_party") {
    const code = String(message.code || "").trim().toUpperCase();
    const party = parties.get(code);
    if (!party) return sendPlayer(player, { type: "error", message: "That party code was not found." });
    if (player.partyCode || player.matchId || player.queuedMode) return sendPlayer(player, { type: "error", message: "Leave your party, match, or queue first." });
    if (party.members.size >= 5) return sendPlayer(player, { type: "error", message: "That party is full (5 players max)." });
    party.members.add(player.id);
    player.partyCode = party.code;
    broadcastParty(party);
    return;
  }
  if (message.type === "leave_party") {
    if (player.queuedMode) return sendPlayer(player, { type: "error", message: "Leave the queue before changing your party." });
    detachParty(player);
    sendPlayer(player, { type: "party_update", code: null, leader: null, members: [] });
    return;
  }
  if (message.type === "queue") return joinQueue(player, message.mode);
  if (message.type === "vote_map") {
    const lobby = lobbies.get(player.lobbyId);
    const map = String(message.map || "");
    if (!lobby || !lobby.options.includes(map)) return;
    lobby.ballots.set(player.id, map);
    const everyoneVoted = lobby.ballots.size >= lobbyMembers(lobby).length;
    if (everyoneVoted && lobbySize(lobby) >= teamSize(lobby.mode) * 2) startLobby(lobby);
    else broadcastLobby(lobby);
    return;
  }
  if (message.type === "leave_queue") return removeFromQueue(player);
  if (message.type === "leave_match") return leaveMatch(player);
  if (message.type === "shoot" && player.matchId) {
    const now = Date.now();
    const match = matches.get(player.matchId);
    if (!match || match.phase !== "live" || player.health <= 0) return;
    if (now - player.lastShotAt < 70) return;
    const target = players.get(String(message.targetId || ""));
    if (!target || target.matchId !== player.matchId || target.team === player.team || target.health <= 0) return;
    const lean = player.state.lean || 0;
    const origin = {
      x: player.state.x + Math.cos(player.state.yaw) * lean * .7,
      y: player.state.y - Math.abs(lean) * .12,
      z: player.state.z - Math.sin(player.state.yaw) * lean * .7
    };
    const cosPitch = Math.cos(player.state.pitch);
    const forward = { x: Math.sin(player.state.yaw) * cosPitch, y: Math.sin(player.state.pitch), z: Math.cos(player.state.yaw) * cosPitch };
    const aim = message.direction || {};
    const length = Math.hypot(aim.x, aim.y, aim.z);
    if (!Number.isFinite(length) || length < .9 || length > 1.1) return;
    const direction = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
    if (direction.x * forward.x + direction.y * forward.y + direction.z * forward.z < Math.cos(.3)) return;
    const targetLean = target.state.lean || 0;
    const targetBase = target.state.y - Math.abs(targetLean) * .12 - (target.state.crouched ? 1.05 : 1.8);
    const distance = rayBox(origin, direction, {
      x0: target.state.x + Math.cos(target.state.yaw) * targetLean * .7 - .45, x1: target.state.x + Math.cos(target.state.yaw) * targetLean * .7 + .45,
      y0: targetBase + .05, y1: targetBase + (target.state.crouched ? 1.7 : 2),
      z0: target.state.z - Math.sin(target.state.yaw) * targetLean * .7 - .35, z1: target.state.z - Math.sin(target.state.yaw) * targetLean * .7 + .35
    });
    const damage = Number(message.damage);
    if (!Number.isFinite(distance) || distance > 100 || !Number.isFinite(damage)) return;
    player.lastShotAt = now;
    target.health = Math.max(0, target.health - Math.min(55, Math.max(1, damage)));
    if (target.health === 0) {
      player.kills++;
      target.deaths++;
      dropLoot(match, target);
    }
    const event = { type: "player_damaged", playerId: target.id, health: target.health, killerId: target.health === 0 ? player.id : null, killerKills: player.kills, deaths: target.deaths };
    for (const id of match.players) sendPlayer(players.get(id), event);
    checkRound(match);
    return;
  }
  if (message.type === "pickup" && player.matchId) {
    const match = matches.get(player.matchId);
    const drop = match?.drops?.get(String(message.dropId || ""));
    if (!drop || player.health <= 0 || match.phase === "over") return;
    if (Math.hypot(player.state.x - drop.x, player.state.z - drop.z) > 3) return;
    match.drops.delete(drop.id);
    if (drop.kind === "medkit") player.medkits = Math.min(3, player.medkits + 1);
    for (const id of match.players) sendPlayer(players.get(id), { type: "drop_taken", id: drop.id, kind: drop.kind, by: player.id });
    return;
  }
  if (message.type === "heal" && player.matchId) {
    const match = matches.get(player.matchId);
    const now = Date.now();
    if (!match || match.phase === "over" || player.health <= 0 || player.health >= 100 || player.medkits <= 0 || now - player.lastHealAt < 1000) return;
    player.lastHealAt = now;
    player.medkits--;
    player.health = Math.min(100, player.health + 50);
    for (const id of match.players) sendPlayer(players.get(id), { type: "player_healed", playerId: player.id, health: player.health });
    return;
  }
  if (message.type === "state" && player.matchId) {
    const now = Date.now();
    if (now - player.lastStateAt < 40 || player.health <= 0) return;
    const state = message.state || {};
    const number = (value, limit) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
    const locked = matches.get(player.matchId)?.phase === "prep";
    const side = (z) => locked ? (player.team === 1 ? Math.min(z, -barrierClampZ) : Math.max(z, barrierClampZ)) : z;
    player.state = {
      x: number(state.x, 120),
      y: number(state.y, 30),
      z: side(number(state.z, 120)),
      yaw: number(state.yaw, Math.PI * 4),
      pitch: number(state.pitch, Math.PI / 2),
      crouched: state.crouched === true,
      lean: number(state.lean, 1),
      droneState: state.droneState && typeof state.droneState === "object" ? {
        x: number(state.droneState.x, 120),
        y: number(state.droneState.y, 30),
        z: number(state.droneState.z, 120),
        yaw: number(state.droneState.yaw, Math.PI * 4),
        pitch: number(state.droneState.pitch, Math.PI / 2)
      } : null
    };
    player.lastStateAt = now;
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") { response.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
  const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(root, `.${relativePath}`);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(response);
  });
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 2048 });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") { socket.destroy(); return; }
  webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit("connection", client));
});

webSockets.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  const player = {
    id: crypto.randomUUID(),
    name: `OPERATOR_${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    socket,
    partyCode: null,
    queuedMode: null,
    lobbyId: null,
    matchId: null,
    team: null,
    kills: 0,
    deaths: 0,
    health: 100,
    spawn: null,
    lastShotAt: 0,
    state: { x: -30, y: 1.8, z: 0, yaw: Math.PI / 2, pitch: 0, crouched: false, lean: 0, droneState: null },
    lastStateAt: 0
  };
  players.set(player.id, player);
  sendPlayer(player, { type: "welcome", playerId: player.id, name: player.name });
  broadcastOnline();
  socket.on("message", (data) => handleMessage(player, data.toString()));
  socket.on("close", () => removePlayer(player));
  socket.on("error", () => removePlayer(player));
});

setInterval(() => {
  const now = Date.now();
  for (const match of [...matches.values()]) {
    advanceMatch(match, now);
    if (!matches.has(match.id)) continue;
    const roster = [...match.players].map((id) => players.get(id)).filter(Boolean).map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      kills: player.kills,
      deaths: player.deaths,
      health: player.health,
      state: player.state
    }));
    const snapshot = JSON.stringify({ type: "snapshot", ...matchInfo(match), phaseMs: Number.isFinite(match.phaseEnd) ? Math.max(0, match.phaseEnd - now) : 0, players: roster });
    for (const id of match.players) {
      const player = players.get(id);
      if (player?.socket.readyState === WebSocket.OPEN) player.socket.send(snapshot);
    }
  }
}, 50).unref();

server.listen(port, "0.0.0.0", () => console.log(`Cougar Six server listening on http://0.0.0.0:${port}`));
setInterval(() => {
  for (const player of players.values()) {
    if (!player.socket.isAlive) { player.socket.terminate(); continue; }
    player.socket.isAlive = false;
    player.socket.ping();
  }
}, 25000).unref();
