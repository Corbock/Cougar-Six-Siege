const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const grandCanyon = require("./grand-canyon");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const players = new Map();
const parties = new Map();
const lobbies = new Map();
const multiplayerMaps = ["field", "harbor", "foundry"];
const playlistMaps = Object.fromEntries(["standard", "ranked", "defuse", "rescue", "duel"].map((mode) => [mode, multiplayerMaps]));
const quickMatchPlaylists = ["standard", "defuse", "rescue", "duel"];
const queueSeconds = Number(process.env.QUEUE_SECONDS || 60);
const fullLobbySeconds = 15;
const prepSeconds = Number(process.env.PREP_SECONDS || 10);
const objectiveModes = new Set(["defuse", "rescue"]);
const objectivePrepSeconds = Number(process.env.OBJECTIVE_PREP_SECONDS || 30);
const roundLiveMs = Number(process.env.ROUND_SECONDS || 180) * 1000;
const plantMs = 5000, removeMs = 5000, defuseMs = 25000, freeMs = 3000, followLagMs = 1200;
const interactRange = 2.5;
const objectiveSites = { press: { x: 0, y: 7.25, z: -55.5 }, bathroom: { x: -81, y: .12, z: -47 } };
const roundEndSeconds = 6;
const matchOverSeconds = 8;
const roundsToWin = 2;
const operatorIds = new Set(["mr-m", "mr-l", "ms-c", "ms-a", "hallway-monitor", "skanska", "custom"]);
const operatorKits = {
  "mr-m": { primary: "vector", secondary: "p45", gadget: "drone", equipment: "flash" },
  "mr-l": { primary: "hammer", secondary: "rattler", gadget: "medkit", equipment: "smoke" },
  "ms-c": { primary: "mk18", secondary: "p45", gadget: "shield", equipment: "frag" },
  "ms-a": { primary: "vector", secondary: "rattler", gadget: "medkit", equipment: "flash" },
  "hallway-monitor": { primary: "longwatch", secondary: "magnum", gadget: "camera-drone", equipment: "smoke" },
  "skanska": { primary: "hammer", secondary: "sledgehammer", gadget: "steel-bars", equipment: "claymore" }
};
const customItems = {
  primary: ["mk18", "vector", "hammer", "longwatch"],
  secondary: ["p45", "rattler", "magnum", "sledgehammer"],
  gadget: ["shield", "drone", "camera-drone", "steel-bars", "medkit"],
  equipment: ["frag", "flash", "smoke", "claymore"]
};
const paintColors = ["#f6df35", "#f04c9b", "#32a6ef", "#70df45", "#f78a30", "#a765e9"];
const validPaint = (color) => paintColors.includes(color) ? color : paintColors[0];
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
    myVote: lobby.ballots.get(member.id) || null,
    ready: lobby.ready.size,
    myReady: lobby.ready.has(member.id)
  }));
}

function enqueueUnit(unit) {
  let lobby = findLobby(unit.mode, unit.members.length);
  if (!lobby) {
    lobby = { id: crypto.randomUUID(), mode: unit.mode, units: [], ballots: new Map(), ready: new Set(), options: playlistMaps[unit.mode], timer: null, deadline: null, baseDeadline: null, fullDeadline: null };
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
    lobby.ready.delete(id);
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
  if (!checkAllReady(lobby)) broadcastLobby(lobby);
}

function checkAllReady(lobby) {
  const members = lobbyMembers(lobby);
  if (lobby.units.length < 2 || !members.length || !members.every((member) => lobby.ready.has(member.id))) return false;
  startLobby(lobby);
  return !lobbies.has(lobby.id);
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

function spawnPoint(team, index, map) {
  if (map === "harbor") return { ...grandCanyon.spawns[team][index % grandCanyon.spawns[team].length] };
  return { x: spawnXs[index % spawnXs.length], y: 1.8, z: team === 1 ? -spawnZ : spawnZ, yaw: team === 1 ? 0 : Math.PI };
}

// Wins are tracked per original team ("group"); clients see them by the side each group currently plays.
function sideWins(match) {
  const first = match.swapped ? 2 : 1;
  return { 1: match.wins[first], 2: match.wins[3 - first] };
}

function publicObjectives(match, now = Date.now()) {
  return match.objectives.map((o) => o.kind === "bomb"
    ? { id: o.id, kind: o.kind, site: o.site, x: o.x, y: o.y, z: o.z, armed: o.armed, defuseMs: o.armed ? Math.max(0, defuseMs - (now - o.armedAt)) : defuseMs, actor: o.actor, progress: o.progress }
    : { id: o.id, kind: o.kind, site: o.site, x: o.x, y: o.y, z: o.z, alive: o.alive, health: o.health, released: o.released, followerId: o.followerId, actor: o.actor, progress: o.progress });
}

function matchInfo(match) {
  const now = Date.now();
  return {
    matchId: match.id,
    mode: match.mode,
    map: match.map,
    round: match.round,
    phase: match.phase,
    phaseMs: Math.max(0, match.phaseEnd - now),
    roundMs: match.phase === "live" ? Math.max(0, match.liveEnd - now) : 0,
    wins: sideWins(match),
    objectives: publicObjectives(match, now),
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

function applyDamage(match, attacker, target, amount) {
  if (match.phase !== "live" || target.health <= 0) return;
  target.health = Math.max(0, target.health - amount);
  if (target.health === 0) {
    attacker.kills++;
    target.deaths++;
    dropLoot(match, target);
  }
  const event = { type: "player_damaged", playerId: target.id, health: target.health, killerId: target.health === 0 ? attacker.id : null, killerKills: attacker.kills, deaths: target.deaths };
  for (const id of match.players) sendPlayer(players.get(id), event);
  checkRound(match);
}

const blastRadius = { frag: 6, claymore: 5 };
const finite = (value, limit) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;

function relayToMatch(match, sender, message) {
  for (const id of match.players) if (id !== sender.id) sendPlayer(players.get(id), { ...message, from: sender.id });
}

function startRound(match, type) {
  match.round++;
  match.drops = new Map();
  match.projectiles = new Map();
  match.tornadoes = new Map();
  match.phase = "prep";
  const objective = objectiveModes.has(match.mode);
  if (objective && match.round > 1) match.swapped = !match.swapped;
  match.phaseEnd = Date.now() + (objective ? objectivePrepSeconds : prepSeconds) * 1000;
  match.liveEnd = 0;
  const slots = { 1: 0, 2: 0 };
  const members = [...match.players].map((id) => players.get(id)).filter(Boolean);
  for (const player of members) {
    player.team = match.swapped ? 3 - player.group : player.group;
    player.interact = null;
    player.health = 100;
    player.medkits = 2;
    player.lastHealAt = 0;
    player.lastShotAt = 0;
    player.droneLock = null;
    player.lastDroneShotAt = 0;
    player.destroyedDrones = new Set();
    player.cameraDroneDestroyed = false;
    player.spawn = spawnPoint(player.team, slots[player.team]++, match.map);
    player.state = { ...player.spawn, pitch: 0, crouched: false, lean: 0, droneState: null };
  }
  match.objectives = buildObjectives(match, members);
  const roster = members.map(({ id, name, team, operatorId }) => ({ id, name, team, operatorId }));
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

function endRound(match, winner, reason) {
  if (match.phase !== "live") return;
  const group = match.swapped ? 3 - winner : winner;
  match.wins[group]++;
  const decided = match.wins[group] >= roundsToWin;
  match.phase = decided ? "over" : "roundEnd";
  match.phaseEnd = Date.now() + (decided ? matchOverSeconds : roundEndSeconds) * 1000;
  for (const id of match.players) sendPlayer(players.get(id), { type: "round_end", winner, wins: sideWins(match), matchWinner: decided ? winner : null, reason, phaseMs: match.phaseEnd - Date.now() });
}

function checkRound(match) {
  if (match.phase !== "live") return;
  const first = teamAlive(match, 1), second = teamAlive(match, 2);
  if (first && second) return;
  const objective = objectiveModes.has(match.mode);
  const winner = first ? 1 : second ? 2 : objective ? 1 : 0;
  if (!winner) return;
  endRound(match, winner, objective ? (winner === 1 ? "All attackers eliminated" : "All defenders eliminated") : "");
}

function buildObjectives(match, members) {
  if (!objectiveModes.has(match.mode)) return [];
  const defenders = members.filter((player) => player.team === 1).length;
  const locations = match.map === "harbor" ? grandCanyon.sites : objectiveSites;
  const available = Object.keys(locations);
  const count = defenders >= 4 ? 2 : 1;
  const sites = [];
  while (sites.length < count) sites.push(available.splice(available.length === count ? 0 : Math.floor(Math.random() * available.length), 1)[0]);
  return sites.map((site) => match.mode === "defuse"
    ? { id: site, kind: "bomb", site, ...locations[site], armed: false, armedAt: 0, actor: null, since: 0, progress: 0 }
    : { id: site, kind: "hostage", site, ...locations[site], alive: true, health: 100, released: false, followerId: null, trail: [], actor: null, since: 0, progress: 0 });
}

function feetY(state) {
  return state.y - (state.crouched ? 1.05 : 1.8);
}

function tickObjectives(match, now) {
  const alive = [...match.players].map((id) => players.get(id)).filter((player) => player && player.health > 0);
  const near = (player, o) => Math.hypot(player.state.x - o.x, player.state.z - o.z) <= interactRange && Math.abs(feetY(player.state) - o.y) < 2.5;
  for (const o of match.objectives) {
    if (match.phase !== "live") return;
    if (o.kind === "bomb") {
      const role = o.armed ? 1 : 2;
      const actor = alive.find((player) => player.team === role && player.interact === o.id && near(player, o));
      if (!actor) { o.actor = null; o.progress = 0; }
      else {
        if (o.actor !== actor.id) { o.actor = actor.id; o.since = now; }
        o.progress = Math.min(1, (now - o.since) / (o.armed ? removeMs : plantMs));
        if (o.progress >= 1) {
          o.armed = !o.armed;
          o.armedAt = now;
          o.actor = null;
          o.progress = 0;
        }
      }
      if (o.armed && now - o.armedAt >= defuseMs) return endRound(match, 2, "Defuser completed");
    } else if (o.alive) {
      if (o.followerId) {
        const follower = players.get(o.followerId);
        if (!follower || follower.matchId !== match.id || follower.health <= 0) { o.followerId = null; o.trail = []; }
        else {
          o.trail.push({ t: now, x: follower.state.x, y: feetY(follower.state), z: follower.state.z });
          let index = -1;
          o.trail.forEach((point, i) => { if (point.t <= now - followLagMs) index = i; });
          if (index > 0) o.trail.splice(0, index);
          if (index >= 0) Object.assign(o, { x: o.trail[0].x, y: o.trail[0].y, z: o.trail[0].z });
        }
      } else {
        const actor = alive.find((player) => player.team === 2 && player.interact === o.id && near(player, o));
        if (!actor) { o.actor = null; o.progress = 0; }
        else {
          if (o.actor !== actor.id) { o.actor = actor.id; o.since = now; }
          o.progress = Math.min(1, (now - o.since) / freeMs);
          if (o.progress >= 1) { o.followerId = actor.id; o.released = true; o.actor = null; o.progress = 0; o.trail = [{ t: now, x: o.x, y: o.y, z: o.z }]; }
        }
      }
      if (o.released && (match.map === "harbor" ? o.x > grandCanyon.barrier + 1 : o.z > 1)) return endRound(match, 2, "Hostage rescued");
    }
  }
}

function hostageHurt(match, attacker, hostage, amount) {
  if (match.phase !== "live" || !hostage.alive) return;
  hostage.health = Math.max(0, hostage.health - amount);
  if (hostage.health > 0) return;
  hostage.alive = false;
  hostage.followerId = null;
  endRound(match, attacker.team === 1 ? 2 : 1, `Team ${attacker.team === 1 ? "defenders" : "attackers"} eliminated the hostage`);
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
  if (match.phase === "live" && objectiveModes.has(match.mode)) {
    tickObjectives(match, now);
    // an armed defuser keeps the round alive past the clock so it cannot be cut short
    if (match.phase === "live" && now >= match.liveEnd && !match.objectives.some((o) => o.armed)) endRound(match, 1, "Time expired");
  }
  if (now < match.phaseEnd) return;
  if (match.phase === "prep") match.phase = "live", match.phaseEnd = Infinity, match.liveEnd = now + roundLiveMs;
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
  const match = { id: crypto.randomUUID(), mode, map, players: new Set(), wins: { 1: 0, 2: 0 }, round: 0, phase: "prep", phaseEnd: 0, swapped: false, liveEnd: 0, objectives: [] };
  teams.forEach((teamUnits, teamIndex) => {
    for (const unit of teamUnits) {
      unit.members.forEach((id) => {
        const player = players.get(id);
        if (!player) return;
        player.matchId = match.id;
        player.lobbyId = null;
        player.queuedMode = null;
        player.team = teamIndex + 1;
        player.group = teamIndex + 1;
        player.interact = null;
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

function uncoveredHeadHit(state, origin, direction) {
  const lean = state.lean || 0, c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  const x = state.x + c * lean * .7, z = state.z - s * lean * .7;
  const base = state.y - Math.abs(lean) * .12 - (state.crouched ? 1.05 : 1.8);
  const head = state.crouched ? [1.27, 1.545] : [1.61, 1.895];
  const helmet = state.crouched ? [1.545, 1.695] : [1.895, 2.045];
  const box = (halfX, halfZ, y0, y1) => ({ x0: x - halfX, x1: x + halfX, z0: z - halfZ, z1: z + halfZ, y0: base + y0, y1: base + y1 });
  const headDistance = rayBox(origin, direction, box(.155, .155, ...head));
  return Number.isFinite(headDistance) &&
    headDistance < rayBox(origin, direction, box(.205, .195, ...helmet)) &&
    headDistance < rayBox(origin, direction, box(.45, .35, .05, head[0]));
}

function shootHostage(match, player, message, now) {
  const state = player.state, lean = state.lean || 0, aim = message.direction || {};
  const length = Math.hypot(aim.x, aim.y, aim.z);
  if (!Number.isFinite(length) || length < .9 || length > 1.1) return;
  const direction = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
  const cosPitch = Math.cos(state.pitch);
  const forward = { x: Math.sin(state.yaw) * cosPitch, y: Math.sin(state.pitch), z: Math.cos(state.yaw) * cosPitch };
  if (direction.x * forward.x + direction.y * forward.y + direction.z * forward.z < Math.cos(.3)) return;
  const origin = { x: state.x + Math.cos(state.yaw) * lean * .7, y: state.y - Math.abs(lean) * .12, z: state.z - Math.sin(state.yaw) * lean * .7 };
  let best = null, bestDistance = Infinity;
  for (const o of match.objectives) {
    if (o.kind !== "hostage" || !o.alive) continue;
    const distance = rayBox(origin, direction, { x0: o.x - .4, x1: o.x + .4, y0: o.y, y1: o.y + 1.9, z0: o.z - .4, z1: o.z + .4 });
    if (distance < bestDistance) { best = o; bestDistance = distance; }
  }
  const damage = Number(message.damage);
  if (!best || bestDistance > 100 || !Number.isFinite(damage)) return;
  player.lastShotAt = now;
  const shieldDistance = hasActiveSniper(player) ? Infinity : nearestShieldHit(match, player, origin, direction, bestDistance);
  if (Number.isFinite(shieldDistance)) return relayShieldImpact(match, player, origin, direction, shieldDistance, true);
  hostageHurt(match, player, best, Math.min(55, Math.max(1, damage)));
}

function shieldHitDistance(state, origin, direction) {
  if (!state?.shieldActive) return Infinity;
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw), lean = state.lean || 0;
  const forward = direction.x * s + direction.z * c;
  if (forward >= -1e-8) return Infinity;
  const dx = origin.x - (state.x + c * lean * .7), dz = origin.z - (state.z - s * lean * .7);
  const t = (.58 - (dx * s + dz * c)) / forward;
  if (t < 0) return Infinity;
  const side = (dx + direction.x * t) * c - (dz + direction.z * t) * s;
  const base = state.y - (state.crouched ? 1.05 : 1.8);
  const height = origin.y + direction.y * t - base;
  return Math.abs(side) <= .68 && height >= (state.crouched ? .05 : .15) && height <= (state.crouched ? 1.7 : 2.02) ? t : Infinity;
}

function shieldBlocks(match, attacker, origin, direction, distance) {
  for (const id of match.players) {
    const holder = players.get(id);
    if (holder && holder.id !== attacker.id && holder.health > 0 && shieldHitDistance(holder.state, origin, direction) <= distance) return true;
  }
  return false;
}

function nearestShieldHit(match, attacker, origin, direction, maxDistance) {
  let distance = maxDistance;
  let hit = false;
  for (const id of match.players) {
    const holder = players.get(id);
    if (!holder || holder.id === attacker.id || holder.health <= 0) continue;
    const candidate = shieldHitDistance(holder.state, origin, direction);
    if (Number.isFinite(candidate) && candidate <= distance) { distance = candidate; hit = true; }
  }
  return hit ? distance : Infinity;
}

function relayShieldImpact(match, player, origin, direction, distance, includeSender = false) {
  const message = { type: "shield_impact", origin: [origin.x, origin.y, origin.z],
    point: [origin.x + direction.x * distance, origin.y + direction.y * distance, origin.z + direction.z * distance] };
  relayToMatch(match, player, message);
  if (includeSender) sendPlayer(player, message);
}

function hasActiveShield(player, state) {
  return !state.droneState && state.activeSlot === "gadget" &&
    (player.operatorId === "ms-c" || (player.operatorId === "custom" && player.customGadget === "shield"));
}

function hasActiveSniper(player) {
  return player.state.activeSlot === "primary" &&
    (player.operatorId === "hallway-monitor" || (player.operatorId === "custom" && player.customPrimary === "longwatch"));
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
  if (message.type === "select_operator") {
    if (!player.matchId && operatorIds.has(message.operatorId)) {
      player.operatorId = message.operatorId;
      if (message.operatorId === "custom" && message.loadout && typeof message.loadout === "object") {
        for (const [slot, allowed] of Object.entries(customItems)) {
          if (allowed.includes(message.loadout[slot])) player.customLoadout[slot] = message.loadout[slot];
        }
        player.customPrimary = player.customLoadout.primary;
        player.customGadget = player.customLoadout.gadget;
      }
    }
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
  if (message.type === "ready") {
    const lobby = lobbies.get(player.lobbyId);
    if (!lobby) return;
    if (message.ready === false) lobby.ready.delete(player.id); else lobby.ready.add(player.id);
    if (!checkAllReady(lobby)) broadcastLobby(lobby);
    return;
  }
  if (message.type === "leave_queue") return removeFromQueue(player);
  if (message.type === "leave_match") return leaveMatch(player);
  if (message.type === "shoot" && player.matchId) {
    const now = Date.now();
    const match = matches.get(player.matchId);
    if (!match || match.phase !== "live" || player.health <= 0) return;
    const kit = player.operatorId === "custom" ? player.customLoadout : operatorKits[player.operatorId];
    const pelletId = player.state.activeSlot === "primary" && kit.primary === "hammer" &&
      typeof message.shotId === "string" && message.shotId.length > 0 && message.shotId.length <= 48 ? message.shotId : null;
    const volley = pelletId && player.shotgunVolley?.id === pelletId && now - player.shotgunVolley.started < 100;
    if (volley ? player.shotgunVolley.count >= 8 : now - player.lastShotAt < 70) return;
    if (message.targetId === "hostage") {
      if (!volley) shootHostage(match, player, message, now);
      return;
    }
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
    if (pelletId) {
      if (volley) player.shotgunVolley.count++;
      else player.shotgunVolley = { id: pelletId, started: now, count: 1 };
    }
    if (!volley) player.lastShotAt = now;
    const shieldDistance = hasActiveSniper(player) ? Infinity : nearestShieldHit(match, player, origin, direction, distance);
    if (Number.isFinite(shieldDistance)) {
      relayShieldImpact(match, player, origin, direction, shieldDistance, true);
      return;
    }
    const instantHeadshot = (player.state.activeSlot === "primary" ||
      (player.state.activeSlot === "secondary" && kit.secondary === "magnum")) &&
      uncoveredHeadHit(target.state, origin, direction);
    if (volley && !instantHeadshot) return;
    applyDamage(match, player, target, instantHeadshot ? target.health : Math.min(55, Math.max(1, damage)));
    return;
  }
  if (message.type === "paint" && player.matchId) {
    const match = matches.get(player.matchId);
    if (!match || match.phase === "over" || player.health <= 0 ||
        !Array.isArray(message.point) || message.point.length !== 3 || !message.point.every(Number.isFinite) ||
        !Array.isArray(message.normal) || message.normal.length !== 3 || !message.normal.every(Number.isFinite) ||
        !paintColors.includes(message.color) || !Number.isFinite(message.size)) return;
    const limit = match.map === "harbor" ? 240 : 150;
    if (message.point.some((v) => Math.abs(v) > limit) || Math.abs(Math.hypot(...message.normal) - 1) > .01) return;
    const target = players.get(String(message.targetId || ""));
    const targetId = target?.matchId === player.matchId && target.state &&
      Math.hypot(target.state.x - message.point[0], target.state.y - message.point[1], target.state.z - message.point[2]) < 3 ? target.id : null;
    const suppliedAnchor = message.targetAnchor;
    const targetAnchor = targetId && Array.isArray(suppliedAnchor) && suppliedAnchor.length === 3 && suppliedAnchor.every(Number.isFinite) &&
      Math.hypot(suppliedAnchor[0] - target.state.x, suppliedAnchor[1] - target.state.y, suppliedAnchor[2] - target.state.z) < 3
      ? suppliedAnchor : targetId ? [target.state.x, target.state.y, target.state.z] : null;
    relayToMatch(match, player, { type: "paint", point: message.point, normal: message.normal, color: message.color,
      size: Math.max(.04, Math.min(.7, message.size)), targetId, targetAnchor });
    return;
  }
  if (message.type === "interact" && player.matchId) {
    player.interact = message.holding === true && typeof message.id === "string" ? message.id.slice(0, 12) : null;
    return;
  }
  if (message.type === "shield_impact" && player.matchId) {
    const match = matches.get(player.matchId), now = Date.now(), aim = message.direction || {};
    if (!match || match.phase !== "live" || player.health <= 0 || hasActiveSniper(player) || now - player.lastShieldImpactAt < 70) return;
    const length = Math.hypot(aim.x, aim.y, aim.z);
    if (!Number.isFinite(length) || length < .9 || length > 1.1) return;
    const direction = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
    const state = player.state, cp = Math.cos(state.pitch);
    if (direction.x * Math.sin(state.yaw) * cp + direction.y * Math.sin(state.pitch) +
        direction.z * Math.cos(state.yaw) * cp < Math.cos(.3)) return;
    const lean = state.lean || 0;
    const origin = { x: state.x + Math.cos(state.yaw) * lean * .7, y: state.y - Math.abs(lean) * .12,
      z: state.z - Math.sin(state.yaw) * lean * .7 };
    const distance = nearestShieldHit(match, player, origin, direction, 100);
    if (!Number.isFinite(distance)) return;
    player.lastShieldImpactAt = now;
    relayShieldImpact(match, player, origin, direction, distance);
    return;
  }
  if (message.type === "drone_hit" && player.matchId) {
    const match = matches.get(player.matchId), now = Date.now();
    const owner = players.get(String(message.ownerId || "")), slot = message.slot;
    if (!match || match.phase !== "live" || player.health <= 0 || !owner || owner.matchId !== player.matchId ||
        owner.team === player.team || owner.health <= 0 || now - player.lastShotAt < 70) return;
    const drone = slot === "camera" ? owner.state.droneState :
      Number.isInteger(slot) ? owner.state.companions?.find((entry) => entry.slot === slot) : null;
    if (!drone) return;
    const aim = message.direction || {}, length = Math.hypot(aim.x, aim.y, aim.z);
    if (!Number.isFinite(length) || length < .9 || length > 1.1) return;
    const direction = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
    const state = player.state, cp = Math.cos(state.pitch), lean = state.lean || 0;
    if (direction.x * Math.sin(state.yaw) * cp + direction.y * Math.sin(state.pitch) +
        direction.z * Math.cos(state.yaw) * cp < Math.cos(.3)) return;
    const origin = { x: state.x + Math.cos(state.yaw) * lean * .7, y: state.y - Math.abs(lean) * .12,
      z: state.z - Math.sin(state.yaw) * lean * .7 };
    const distance = rayBox(origin, direction, { x0: drone.x - .58, x1: drone.x + .58,
      y0: drone.y - .15, y1: drone.y + .3, z0: drone.z - .58, z1: drone.z + .58 });
    if (!Number.isFinite(distance) || distance > 100 || (!hasActiveSniper(player) && shieldBlocks(match, player, origin, direction, distance))) return;
    player.lastShotAt = now;
    if (slot === "camera") { owner.cameraDroneDestroyed = true; owner.state.droneState = null; }
    else {
      owner.destroyedDrones.add(slot);
      owner.state.companions = owner.state.companions.filter((entry) => entry.slot !== slot);
      if (slot === 1) owner.droneLock = null;
    }
    const event = { type: "drone_destroyed", ownerId: owner.id, slot, x: drone.x, y: drone.y, z: drone.z };
    for (const id of match.players) sendPlayer(players.get(id), event);
    return;
  }
  if (message.type === "drone_attack" && player.matchId) {
    const match = matches.get(player.matchId);
    const now = Date.now();
    const target = players.get(String(message.targetId || ""));
    const lock = player.droneLock, drone = player.state?.companions?.find((entry) => entry.slot === 1);
    if (!match || match.phase !== "live" || player.health <= 0 || player.operatorId !== "mr-m" || !drone || !target ||
        target.matchId !== player.matchId || target.team === player.team || target.health <= 0 ||
        !lock || lock.targetId !== target.id || drone.targetId !== target.id || now - lock.since < 2000 ||
        now - lock.lastSeen > 300 || now - player.lastDroneShotAt < 200 ||
        Math.hypot(target.state.x - drone.x, target.state.y - drone.y, target.state.z - drone.z) > 24) return;
    player.lastDroneShotAt = now;
    const aim = { x: target.state.x - drone.x, y: target.state.y - .5 - drone.y, z: target.state.z - drone.z };
    const distance = Math.hypot(aim.x, aim.y, aim.z);
    if (distance <= 0) return;
    const direction = { x: aim.x / distance, y: aim.y / distance, z: aim.z / distance };
    const hit = nearestShieldHit(match, player, drone, direction, distance);
    const end = Number.isFinite(hit) ? hit : distance;
    const shot = { type: "drone_shot", origin: [drone.x, drone.y, drone.z],
      point: [drone.x + direction.x * end, drone.y + direction.y * end, drone.z + direction.z * end], blocked: Number.isFinite(hit),
      paint: validPaint(player.state.dronePaint), targetId: target.id, targetAnchor: [target.state.x, target.state.y, target.state.z] };
    for (const id of match.players) sendPlayer(players.get(id), shot);
    if (Number.isFinite(hit)) return;
    applyDamage(match, player, target, 4);
    return;
  }
  if (message.type === "throw" && player.matchId) {
    const match = matches.get(player.matchId);
    if (!match || match.phase === "over" || player.health <= 0 || !["frag", "flash", "smoke", "claymore"].includes(message.kind)) return;
    const id = String(message.id || "").slice(0, 48);
    if (!id || match.projectiles.has(id) || [...match.projectiles.values()].filter((entry) => entry.owner === player.id).length >= 12) return;
    const tornado = message.kind === "smoke" && player.operatorId === "mr-l";
    const paint = validPaint(message.paint);
    match.projectiles.set(id, { owner: player.id, kind: message.kind, tornado, paint });
    const positionLimit = match.map === "harbor" ? 240 : 150;
    relayToMatch(match, player, { type: "throw", id, kind: message.kind, tornado, paint, x: finite(message.x, positionLimit), y: finite(message.y, 40), z: finite(message.z, positionLimit), vx: finite(message.vx, 40), vy: finite(message.vy, 40), vz: finite(message.vz, 40), fuse: finite(message.fuse, 120), mine: message.mine === true });
    return;
  }
  if (message.type === "explode" && player.matchId) {
    const match = matches.get(player.matchId);
    const projectile = match?.projectiles.get(String(message.id || ""));
    if (!projectile || projectile.owner !== player.id || match.phase === "over") return;
    match.projectiles.delete(String(message.id));
    const positionLimit = match.map === "harbor" ? 240 : 150;
    const x = finite(message.x, positionLimit), y = finite(message.y, 40), z = finite(message.z, positionLimit);
    if (projectile.tornado) match.tornadoes.set(String(message.id), { id: String(message.id), x, y, z, startedAt: Date.now() });
    relayToMatch(match, player, { type: "explosion", id: String(message.id), kind: projectile.kind, tornado: projectile.tornado, paint: projectile.paint, x, y, z });
    const radius = blastRadius[projectile.kind];
    if (!radius || match.phase !== "live") return;
    for (const targetId of [...match.players]) {
      const target = players.get(targetId);
      if (!target || target.team === player.team || target.health <= 0) continue;
      const distance = Math.hypot(target.state.x - x, target.state.y - 1 - y, target.state.z - z);
      if (distance < radius) applyDamage(match, player, target, Math.max(1, Math.round(130 * (1 - distance / radius))));
    }
    for (const hostage of match.objectives) {
      if (hostage.kind !== "hostage" || !hostage.alive) continue;
      const distance = Math.hypot(hostage.x - x, hostage.y + .9 - y, hostage.z - z);
      if (distance < radius) hostageHurt(match, player, hostage, Math.max(1, Math.round(130 * (1 - distance / radius))));
    }
    return;
  }
  if (message.type === "bar" && player.matchId) {
    const match = matches.get(player.matchId);
    if (!match || match.phase === "over" || player.health <= 0 || typeof message.op !== "string") return;
    const id = String(message.id || "").slice(0, 48);
    if (message.op === "place") {
      const fit = message.fit || {};
      if (![0, 2].includes(fit.ax) || !["n", "a0", "a1", "y0", "y1"].every((key) => Number.isFinite(fit[key]))) return;
      relayToMatch(match, player, { type: "bar", op: "place", id, fit: { ax: fit.ax, n: fit.n, a0: fit.a0, a1: fit.a1, y0: fit.y0, y1: fit.y1 } });
    } else if (message.op === "hit") {
      if (!Array.isArray(message.p) || message.p.length !== 3 || !message.p.every(Number.isFinite)) return;
      const src = String(message.src || "").slice(0, 12);
      const paint = src !== "hammer" && paintColors.includes(message.paint) ? message.paint : null;
      relayToMatch(match, player, { type: "bar", op: "hit", id, p: message.p, radius: finite(message.radius, 5), power: finite(message.power, 5000), chip: message.chip === true, src, paint });
    } else if (message.op === "repair" || message.op === "steel") relayToMatch(match, player, { type: "bar", op: message.op, id });
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
    const match = matches.get(player.matchId);
    const locked = match?.phase === "prep";
    const side = (value) => locked ? (player.team === 1 ? Math.min(value, -barrierClampZ) : Math.max(value, barrierClampZ)) : value;
    const positionLimit = match?.map === "harbor" ? 240 : 120;
    const xPosition = (value) => match?.map === "harbor" ? side(number(value, positionLimit)) : number(value, positionLimit);
    const zPosition = (value) => match?.map === "harbor" ? number(value, positionLimit) : side(number(value, positionLimit));
    const body = {
      x: xPosition(state.x),
      y: number(state.y, 30),
      z: zPosition(state.z),
      yaw: number(state.yaw, Math.PI * 4),
      pitch: number(state.pitch, Math.PI / 2),
      crouched: state.crouched === true,
      lean: number(state.lean, 1)
    };
    const companions = [];
    if (player.operatorId === "mr-m" && Array.isArray(state.companions)) {
      const modes = ["scanner", "attacker", "scanner"];
      const seen = new Set();
      for (let i = 0; i < Math.min(state.companions.length, modes.length); i++) {
        const entry = state.companions[i];
        const slot = entry?.slot === undefined ? i : entry.slot;
        if (!entry || !Number.isInteger(slot) || slot < 0 || slot >= modes.length || seen.has(slot) ||
            player.destroyedDrones.has(slot) || entry.mode !== modes[slot] || ![entry.x, entry.y, entry.z, entry.yaw].every(Number.isFinite) ||
            Math.hypot(entry.x - body.x, entry.y - body.y, entry.z - body.z) > 4) continue;
        seen.add(slot);
        const target = slot === 1 ? players.get(String(entry.targetId || "")) : null;
        const targetId = target && target.matchId === player.matchId && target.team !== player.team && target.health > 0 &&
          Math.hypot(entry.x - target.state.x, entry.y - target.state.y, entry.z - target.state.z) <= 24 ? target.id : null;
        companions.push({ x: xPosition(entry.x), y: number(entry.y, 30), z: zPosition(entry.z),
          yaw: number(entry.yaw, Math.PI * 4), mode: modes[slot], slot, targetId });
      }
    }
    const targetId = matches.get(player.matchId)?.phase === "live" ? companions.find((entry) => entry.slot === 1)?.targetId : null;
    if (!targetId) player.droneLock = null;
    else if (!player.droneLock || player.droneLock.targetId !== targetId || now - player.droneLock.lastSeen > 300)
      player.droneLock = { targetId, since: now, lastSeen: now };
    else player.droneLock.lastSeen = now;
    const activeSlot = ["primary", "secondary", "gadget", "equipment"].includes(state.activeSlot) ? state.activeSlot : null;
    player.state = {
      ...body,
      equippedPaint: validPaint(state.equippedPaint),
      sidearmPaint: validPaint(state.sidearmPaint),
      dronePaint: validPaint(state.dronePaint),
      companions,
      droneState: !player.cameraDroneDestroyed && state.droneState && typeof state.droneState === "object" ? {
        x: number(state.droneState.x, positionLimit),
        y: number(state.droneState.y, 30),
        z: number(state.droneState.z, positionLimit),
        yaw: number(state.droneState.yaw, Math.PI * 4),
        pitch: number(state.droneState.pitch, Math.PI / 2),
        mode: ["scanner", "attacker", "camera"].includes(state.droneState.mode) ? state.droneState.mode : null
      } : null,
      activeSlot,
      equippedItem: activeSlot ? (player.operatorId === "custom" ? player.customLoadout : operatorKits[player.operatorId])[activeSlot] : null,
      shieldActive: hasActiveShield(player, state)
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
    operatorId: "mr-m",
    customPrimary: "mk18",
    customGadget: "drone",
    customLoadout: { primary: "mk18", secondary: "p45", gadget: "drone", equipment: "frag" },
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
    lastShieldImpactAt: 0,
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
      operatorId: player.operatorId,
      kills: player.kills,
      deaths: player.deaths,
      health: player.health,
      state: player.state
    }));
    for (const [id, tornado] of match.tornadoes) if (now - tornado.startedAt >= 16000) match.tornadoes.delete(id);
    const tornadoes = [...match.tornadoes.values()].map(({ id, x, y, z, startedAt }) => ({ id, x, y, z, age: (now - startedAt) / 1000 }));
    const snapshot = JSON.stringify({ type: "snapshot", ...matchInfo(match), phaseMs: Number.isFinite(match.phaseEnd) ? Math.max(0, match.phaseEnd - now) : 0, players: roster, tornadoes });
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
