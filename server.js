const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const players = new Map();
const parties = new Map();
const queues = { standard: [], ranked: [], defuse: [], rescue: [], duel: [] };
const playlistMaps = {
  standard: ["field", "harbor", "foundry"],
  ranked: ["field", "harbor"],
  defuse: ["field", "foundry"],
  rescue: ["harbor", "foundry"],
  duel: ["field"]
};
const quickMatchPlaylists = ["standard", "defuse", "rescue", "duel"];
const voteSeconds = 15;
const votes = new Map();
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

function cancelVote(vote) {
  clearTimeout(vote.timer);
  votes.delete(vote.id);
  for (const unit of vote.units) {
    unit.members.forEach((id) => { const member = players.get(id); if (member) member.voteId = null; });
    queues[vote.mode].unshift(unit);
    notifyQueue(unit, "searching", { partySize: unit.members.length });
  }
  startMatch(vote.mode);
}

function removeFromQueue(player) {
  const vote = votes.get(player.voteId);
  if (vote) {
    const unit = vote.units.find((entry) => entry.members.includes(player.id));
    unit.members.forEach((id) => {
      const member = players.get(id);
      if (member) { member.queuedMode = null; member.voteId = null; }
    });
    notifyQueue(unit, "cancelled");
    vote.units = vote.units.filter((entry) => entry !== unit);
    cancelVote(vote);
    return;
  }
  for (const mode of Object.keys(queues)) {
    const index = queues[mode].findIndex((unit) => unit.members.includes(player.id));
    if (index < 0) continue;
    const [unit] = queues[mode].splice(index, 1);
    unit.members.forEach((id) => {
      const member = players.get(id);
      if (member) member.queuedMode = null;
    });
    notifyQueue(unit, "cancelled");
  }
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

function leaveMatch(player) {
  if (!player.matchId) return;
  const match = matches.get(player.matchId);
  if (match) {
    match.players.delete(player.id);
    for (const id of match.players) sendPlayer(players.get(id), { type: "player_left", playerId: player.id });
    const minimumPlayers = 2;
    if (match.players.size < minimumPlayers) {
      for (const id of match.players) {
        const remaining = players.get(id);
        if (remaining) {
          remaining.matchId = null;
          remaining.team = null;
          sendPlayer(remaining, { type: "match_ended", reason: "The match ended because there were not enough players." });
        }
      }
      matches.delete(match.id);
    }
  }
  player.matchId = null;
  player.team = null;
}

function findBalancedUnits(mode) {
  const target = mode === "duel" ? 1 : 5;
  const units = queues[mode];

  function search(index, first, second, teamOne, teamTwo) {
    if (first > 0 && second > 0) return [teamOne, teamTwo];
    if (index >= units.length) return null;
    const size = units[index].members.length;
    const assignToSmaller = first <= second;
    const assignments = assignToSmaller ? [1, 2] : [2, 1];
    for (const team of assignments) {
      if (team === 1 && first + size <= target) {
        const result = search(index + 1, first + size, second, [...teamOne, units[index]], teamTwo);
        if (result) return result;
      }
      if (team === 2 && second + size <= target) {
        const result = search(index + 1, first, second + size, teamOne, [...teamTwo, units[index]]);
        if (result) return result;
      }
    }
    return search(index + 1, first, second, teamOne, teamTwo);
  }

  return search(0, 0, 0, [], []);
}

function startMatch(mode) {
  const teams = findBalancedUnits(mode);
  if (!teams) return;
  const selected = [...teams[0], ...teams[1]];
  const selectedSet = new Set(selected);
  queues[mode] = queues[mode].filter((unit) => !selectedSet.has(unit));
  const vote = { id: crypto.randomUUID(), mode, teams, units: selected, options: playlistMaps[mode], ballots: new Map(), deadline: Date.now() + voteSeconds * 1000, timer: null };
  votes.set(vote.id, vote);
  vote.timer = setTimeout(() => resolveVote(vote), voteSeconds * 1000);
  vote.units.forEach((unit) => unit.members.forEach((id) => { players.get(id).voteId = vote.id; }));
  sendVoteUpdate(vote, "map_vote");
}

function voteVoters(vote) {
  return vote.units.flatMap((unit) => unit.members).map((id) => players.get(id)).filter(Boolean);
}

function sendVoteUpdate(vote, type) {
  const tally = Object.fromEntries(vote.options.map((map) => [map, 0]));
  vote.ballots.forEach((map) => { tally[map]++; });
  const voters = voteVoters(vote);
  voters.forEach((voter) => sendPlayer(voter, { type, voteId: vote.id, mode: vote.mode, options: vote.options, tally, voted: vote.ballots.size, total: voters.length, myVote: vote.ballots.get(voter.id) || null, deadline: vote.deadline }));
}

function resolveVote(vote) {
  if (!votes.delete(vote.id)) return;
  clearTimeout(vote.timer);
  const counts = new Map(vote.options.map((map) => [map, 0]));
  vote.ballots.forEach((map) => counts.set(map, counts.get(map) + 1));
  const top = Math.max(...counts.values());
  const winners = vote.options.filter((map) => counts.get(map) === top);
  createMatch(vote.mode, vote.teams, winners[Math.floor(Math.random() * winners.length)]);
}

function createMatch(mode, teams, map) {
  const match = { id: crypto.randomUUID(), mode, map, players: new Set(), createdAt: Date.now() };
  teams.forEach((teamUnits, teamIndex) => {
    const team = teamIndex + 1;
    for (const unit of teamUnits) {
      unit.members.forEach((id) => {
        const player = players.get(id);
        if (!player) return;
        player.matchId = match.id;
        player.voteId = null;
        player.queuedMode = null;
        player.team = team;
        player.kills = 0;
        player.deaths = 0;
        player.health = 100;
        player.deadUntil = 0;
        player.lastShotAt = 0;
        player.state = { x: team === 1 ? -30 : 30, y: 1.8, z: 0, yaw: team === 1 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, crouched: false, lean: 0, droneState: null };
        match.players.add(id);
      });
    }
  });
  matches.set(match.id, match);
  const roster = [...match.players].map((id) => {
    const player = players.get(id);
    return { id: player.id, name: player.name, team: player.team };
  });
  for (const id of match.players) {
    const player = players.get(id);
    sendPlayer(player, { type: "match_found", matchId: match.id, mode, map, team: player.team, players: roster });
  }
}

function chooseQuickMatch(members) {
  const waiting = (mode) => queues[mode].reduce((total, unit) => total + unit.members.length, 0);
  const fits = (mode) => mode === "duel" ? members.length === 1 : members.length <= 5;
  return quickMatchPlaylists.filter(fits).reduce((best, mode) => (waiting(mode) > waiting(best) ? mode : best), "standard");
}

function joinQueue(player, mode) {
  if (mode === "quick") mode = chooseQuickMatch(player.partyCode && parties.get(player.partyCode) ? [...parties.get(player.partyCode).members] : [player.id]);
  if (!(mode in queues)) return sendPlayer(player, { type: "error", message: "Choose a supported playlist." });
  if (player.matchId) return sendPlayer(player, { type: "error", message: "You are already in a match." });
  if (player.queuedMode) return sendPlayer(player, { type: "error", message: "Leave your current queue first." });
  const party = player.partyCode && parties.get(player.partyCode);
  const members = party ? [...party.members] : [player.id];
  if (mode === "duel" && members.length > 1) return sendPlayer(player, { type: "error", message: "1v1 is solo only. Leave your party to queue." });
  if (mode !== "duel" && members.length > 5) return sendPlayer(player, { type: "error", message: "A squad party can have up to five players." });
  if (party && party.leader !== player.id) return sendPlayer(player, { type: "error", message: "Only the party leader can start the queue." });
  if (members.some((id) => !players.has(id) || players.get(id).matchId || players.get(id).queuedMode)) {
    return sendPlayer(player, { type: "error", message: "Every party member must be online and available." });
  }

  const unit = { id: crypto.randomUUID(), members, mode };
  queues[mode].push(unit);
  members.forEach((id) => { players.get(id).queuedMode = mode; });
  notifyQueue(unit, "searching", { partySize: members.length });
  startMatch(mode);
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
    const vote = votes.get(player.voteId);
    const map = String(message.map || "");
    if (!vote || !vote.options.includes(map)) return;
    vote.ballots.set(player.id, map);
    if (vote.ballots.size >= voteVoters(vote).length) resolveVote(vote);
    else sendVoteUpdate(vote, "vote_update");
    return;
  }
  if (message.type === "leave_queue") return removeFromQueue(player);
  if (message.type === "leave_match") return leaveMatch(player);
  if (message.type === "shoot" && player.matchId) {
    const now = Date.now();
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
      target.deadUntil = now + 2500;
    }
    const event = { type: "player_damaged", playerId: target.id, health: target.health, killerId: target.health === 0 ? player.id : null, killerKills: player.kills, deaths: target.deaths };
    for (const id of matches.get(player.matchId)?.players || []) sendPlayer(players.get(id), event);
    return;
  }
  if (message.type === "state" && player.matchId) {
    const now = Date.now();
    if (now - player.lastStateAt < 40) return;
    const state = message.state || {};
    const number = (value, limit) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
    player.state = {
      x: number(state.x, 120),
      y: number(state.y, 30),
      z: number(state.z, 120),
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
    voteId: null,
    matchId: null,
    team: null,
    kills: 0,
    deaths: 0,
    health: 100,
    deadUntil: 0,
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
  for (const match of matches.values()) {
    const now = Date.now();
    for (const id of match.players) {
      const player = players.get(id);
      if (!player || player.health > 0 || !player.deadUntil || now < player.deadUntil) continue;
      player.health = 100;
      player.deadUntil = 0;
      player.state = { x: player.team === 1 ? -30 : 30, y: 1.8, z: (Math.random() - .5) * 4, yaw: player.team === 1 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, crouched: false, lean: 0, droneState: null };
    }
    const roster = [...match.players].map((id) => players.get(id)).filter(Boolean).map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      kills: player.kills,
      deaths: player.deaths,
      health: player.health,
      state: player.state
    }));
    const snapshot = JSON.stringify({ type: "snapshot", matchId: match.id, players: roster });
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
