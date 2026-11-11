const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const vm = require("node:vm");
const WebSocket = require("ws");
const map = require("../grand-canyon");

function mapColliders() {
  const colliders = [];
  map.build((x0, x1, y0, y1, z0, z1, _color, _side, noCollide) => {
    if (!noCollide) colliders.push({ x0, x1, y0, y1, z0, z1 });
  }, () => {}, []);
  const addWall = (x, z, along, length) => colliders.push(along === "x"
    ? { x0: x - length / 2, x1: x + length / 2, y0: 0, y1: 2.2, z0: z - .09, z1: z + .09 }
    : { x0: x - .09, x1: x + .09, y0: 0, y1: 2.2, z0: z - length / 2, z1: z + length / 2 });
  for (const { x, z, along, length, corner } of map.cafeteriaBarricades) {
    const center = map.point(x, z);
    addWall(center.x, center.z, along, length);
    if (corner) {
      const leg = length * .6, edge = length / 2 - .09;
      const lx = along === "x" ? center.x + corner[0] * edge : center.x + corner[0] * (leg / 2 - .09);
      const lz = along === "x" ? center.z + corner[1] * (leg / 2 - .09) : center.z + corner[1] * edge;
      addWall(lx, lz, along === "x" ? "z" : "x", leg);
    }
  }
  return colliders;
}

function traversable(colliders, x, z) {
  return !colliders.some((c) => x + .35 > c.x0 && x - .35 < c.x1 && z + .35 > c.z0 &&
    z - .35 < c.z1 && c.y1 > .7 && c.y0 < 1.8);
}

test("Grand Canyon spawns, objective sites, and accessible rooms connect through traversable hallways", () => {
  const colliders = mapColliders();
  for (const spawn of Object.values(map.spawns).flat()) {
    assert.ok(traversable(colliders, spawn.x, spawn.z), `blocked spawn ${JSON.stringify(spawn)}`);
  }
  const step = .6, origin = { x: map.bounds.x0, z: map.bounds.z0 };
  const width = Math.ceil((map.bounds.x1 - map.bounds.x0) / step) + 1;
  const depth = Math.ceil((map.bounds.z1 - map.bounds.z0) / step) + 1;
  const cells = new Uint8Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    cells[z * width + x] = traversable(colliders, origin.x + x * step, origin.z + z * step) ? 1 : 0;
  }
  const toCell = (p) => [Math.round((p.x - origin.x) / step), Math.round((p.z - origin.z) / step)];
  const [sx, sz] = toCell(map.spawns[1][0]), start = sz * width + sx;
  assert.equal(cells[start], 1, "defender starting cell must be clear");
  const queue = [start];
  cells[start] = 2;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], x = cell % width, z = Math.floor(cell / width);
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;
      const next = nz * width + nx;
      if (cells[next] === 1) { cells[next] = 2; queue.push(next); }
    }
  }
  const nearby = (point, distance) => {
    const [cx, cz] = toCell(point), radius = Math.ceil(distance / step);
    for (let z = Math.max(0, cz - radius); z <= Math.min(depth - 1, cz + radius); z++)
      for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++)
        if (cells[z * width + x] === 2 && Math.hypot(origin.x + x * step - point.x, origin.z + z * step - point.z) <= distance) return true;
    return false;
  };
  for (const [team, spawns] of Object.entries(map.spawns)) for (const spawn of spawns) {
    assert.ok(nearby(spawn, .9), `team ${team} spawn is disconnected`);
  }
  for (const [name, site] of Object.entries(map.sites)) {
    assert.ok(name.length <= 12, `objective ${name} exceeds the server's interaction ID limit`);
    assert.ok(traversable(colliders, site.x, site.z), `objective ${name} is blocked`);
    assert.ok(nearby(site, 1.4), `objective ${name} is unreachable`);
  }
  for (const room of map.rooms) {
    const center = map.point((room.x0 + room.x1) / 2, (room.z0 + room.z1) / 2);
    assert.ok(nearby(center, Math.min(room.x1 - room.x0, room.z1 - room.z0) * map.scale * .35), `${room.name} is unreachable`);
    const positions = room.doors ?? [room.doorAt ?? (room.door === "east" ? (room.z0 + room.z1) / 2 : (room.x0 + room.x1) / 2)];
    for (const position of positions) {
      const doorway = room.door === "east" ? map.point(room.x1, position)
        : map.point(position, room.door === "north" ? room.z0 : room.z1);
      assert.ok(traversable(colliders, doorway.x, doorway.z), `${room.name} door at ${position} is blocked`);
      assert.ok(nearby(doorway, 1), `${room.name} door at ${position} is unreachable`);
    }
  }
  for (const [x, z] of [[220, 55], [250, 110], [65, 190], [495, 120], [490, 85], [478, 101]]) {
    const sealed = map.point(x, z);
    assert.equal(traversable(colliders, sealed.x, sealed.z), false, `sealed area at ${x}, ${z} is open`);
  }
});

test("the enlarged map closes narrow gaps while retaining a door-width classroom corridor", () => {
  assert.equal(map.scale, .6);
  assert.deepEqual(map.bounds, { x0: -168, x1: 138, z0: -90, z1: 108.6 });
  const room = (name) => map.rooms.find((entry) => entry.name === name);
  assert.equal(room("A108").x1, room("BATHROOM").x0);
  for (const [upper, lower] of [["A116", "A115"], ["A118", "A117"], ["A120", "A119"], ["A122", "A121"]]) {
    assert.ok(room(lower).z0 - room(upper).z1 - .7 >= 7, `${upper}/${lower} corridor is narrower than a doorway`);
  }
  assert.equal(room("B115").z1, room("A120").z0);
  const colliders = mapColliders();
  for (const [x, z] of [[56, 55], [56, 100], [100, 117], [448, 55], [478, 120]]) {
    const p = map.point(x, z);
    assert.equal(traversable(colliders, p.x, p.z), false, `gap at ${x}, ${z} remains open`);
  }
});

test("doors and classroom signs retain their original world-space widths", () => {
  assert.equal(map.openings.filter((opening) => Math.abs(opening.a1 - opening.a0 - 3) < 1e-8).length, 1);
  assert.equal(map.openings.filter((opening) => Math.abs(opening.a1 - opening.a0 - 2.1) < 1e-8).length, map.openings.length - 1);
  const signs = [];
  map.build((x0, x1, y0, y1, _z0, _z1, color) => {
    if (color === "#69262c" && y0 === 2.65 && y1 === 3.16) signs.push(x1 - x0);
  }, () => {}, []);
  assert.ok(signs.length > 10);
  signs.forEach((width) => assert.ok(Math.abs(width - 3.12) < 1e-8));
});

test("all Grand Canyon openings fit barricades from both sides, but not through cover or beyond reach", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const start = html.indexOf("      const rayBox ="), end = html.indexOf("\n      };", start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(html.slice(start, end + 9) + "\nthis.rayBox = rayBox;", context);
  const colliders = mapColliders();
  const clearance = (origin, direction, max) => Math.min(max, ...colliders.map((box) => context.rayBox(origin, direction, box)));
  for (const opening of map.openings) {
    for (const side of [-1, 1]) {
      const origin = [0, 1.8, 0], direction = [0, 0, 0];
      origin[opening.ax] = opening.n + side * .8;
      origin[opening.ta] = (opening.a0 + opening.a1) / 2;
      direction[opening.ax] = -side;
      const fit = map.findOpening(origin, direction, 4.2, clearance);
      assert.deepEqual(fit, opening, `opening ${JSON.stringify(opening)} from side ${side}`);
      assert.equal(map.findOpening(origin, direction, .5, clearance), null);
      assert.equal(map.findOpening(origin, direction, 4.2, () => .2), null);
    }
  }
  const opening = map.openings[0], origin = [0, 1.8, 0], direction = [0, 0, 0];
  origin[opening.ax] = opening.n + 1;
  origin[opening.ta] = opening.a1 + .2;
  direction[opening.ax] = -1;
  assert.equal(map.findOpening(origin, direction, 4.2, clearance), null);
});

test("placing a Grand Canyon barricade creates and relays the doorway fit", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const start = html.indexOf("      function placeBarricade()"), end = html.indexOf("      function makeBarricade(", start);
  assert.ok(start >= 0 && end > start);
  const opening = map.openings.find((entry) => entry.ax === 2);
  const x = (opening.a0 + opening.a1) / 2, z = opening.n + 2;
  const placed = [], sent = [], notices = [];
  const cam = { x, y: 1.8, z, yaw: Math.PI, pitch: 0 };
  const context = {
    cam, renderCam: cam, GrandCanyon: map, isCanyon: () => true, isDead: () => false,
    aimedBarricade: () => null, aimDir: () => [0, 0, -1], clearance: (_o, _d, max) => max,
    makeBarricade: (fit) => { placed.push(fit); return fit; }, sendMatch: (message) => sent.push(message),
    say: (message) => notices.push(message), barCount: 6, barSeq: 0, multiplayer: { playerId: "test" },
    BAR_TH: .12, R: .35, eyeHeight: 1.8
  };
  vm.runInNewContext(html.slice(start, end), context);
  context.placeBarricade();
  assert.equal(placed.length, 1);
  assert.equal(placed[0].n, opening.n);
  assert.equal(placed[0].a0, opening.a0);
  assert.equal(placed[0].a1, opening.a1);
  assert.equal(sent[0].op, "place");
  assert.equal(sent[0].fit.n, opening.n);
  assert.equal(context.barCount, 5);
  assert.equal(notices[0], "BARRICADE PLACED");
});

test("Grand Canyon furnishings and hallway posters use the requested assets", () => {
  const boxes = [], posters = [];
  map.build((...args) => boxes.push(args), () => {}, [], () => {}, (...args) => posters.push(args));
  assert.ok(boxes.some((box) => box[6] === "@canyon-wood-panels"));
  assert.ok(boxes.some((box) => box[6] === "@canyon-ceiling-tiles"));
  assert.equal(boxes.filter((box) => box[6] === "@wood-boards").length, 20);
  assert.deepEqual(posters.map((entry) => entry[0]), [1, 2, 3, 4, 5]);
  assert.ok(fs.existsSync("assets/tex/canyon-wood-panels.jpg"));
  assert.ok(fs.existsSync("assets/tex/canyon-ceiling-tiles.jpg"));
  const html = fs.readFileSync("index.html", "utf8");
  for (let i = 1; i <= 5; i++) assert.match(html, new RegExp(`canyon-poster-${i}.*Poster_${i}\\.`));
  assert.match(html, /isCanyon\(\) \? GrandCanyon\.findOpening\(o, dr, 4\.2, clearance\)/);
});

test("classroom boards face away from entrances and signs read from the hallway", () => {
  const boxes = [];
  map.build((x0, x1, y0, y1, z0, z1, color) => boxes.push({ x0, x1, y0, y1, z0, z1, color }), () => {}, []);
  const room = (name) => map.rooms.find((entry) => entry.name === name);
  for (const name of ["A103", "A104", "A102"]) {
    const r = room(name);
    const boards = boxes.filter((box) => box.color === "#e1e4dc" &&
      box.x0 >= map.point(r.x0, 0).x && box.x1 <= map.point(r.x1, 0).x &&
      box.z0 >= map.point(0, r.z0).z && box.z1 <= map.point(0, r.z1).z);
    assert.equal(boards.length, 1, `${name} needs one board`);
    const board = boards[0];
    if (r.door === "north") assert.ok(board.z0 > map.point(0, r.z1 - 1).z);
    if (r.door === "south") assert.ok(board.z1 < map.point(0, r.z0 + 1).z);
    if (r.door === "east") assert.ok(board.x1 < map.point(r.x0 + 1, 0).x);
  }
  for (const name of ["A103", "A104"]) {
    const r = room(name), signZ = r.door === "south" ? r.z1 + .25 : r.z0 - .25;
    const pixels = boxes.filter((box) => box.color === "#f5f2e5" && Math.abs(box.y1 - 3.10) < 1e-8 &&
      Math.abs(box.z0 - map.point(0, signZ - .2).z) < 1e-8 &&
      box.x0 >= map.point(r.doorAt - 6, 0).x && box.x1 <= map.point(r.doorAt + 6, 0).x);
    const columns = [1, 1, 0, 1, 2, 0, name === "A103" ? 1 : 2];
    const letters = [0, 1, 2, 2, 2, 3, 3];
    const expected = columns.map((col, i) => {
      const offset = letters[i] * 1.05 + col * .25;
      return map.point(r.door === "south" ? r.doorAt + 2.1 - offset - .2 : r.doorAt - 2.1 + offset, 0).x;
    });
    assert.equal(pixels.length, expected.length, `${name} top glyph row`);
    pixels.forEach((pixel, i) => assert.ok(Math.abs(pixel.x0 - expected[i]) < 1e-8, `${name} glyph ${i} is mirrored`));
  }
});

test("cafeteria glass is emitted separately and remains collision geometry", () => {
  const boxes = [], glass = [];
  map.build((x0, x1, y0, y1, z0, z1, color) => boxes.push({ x0, x1, y0, y1, z0, z1, color }),
    () => {}, [], (x0, x1, y0, y1, z0, z1) => glass.push({ x0, x1, y0, y1, z0, z1 }));
  assert.equal(glass.length, 1);
  const wall = glass[0], middle = map.point(30, 278);
  assert.equal(traversable(glass, middle.x, middle.z), false);
  assert.ok(wall.z0 <= map.point(0, 225).z && wall.z1 >= map.point(0, 331).z);
  assert.equal(boxes.some((box) => box.x0 === wall.x0 && box.x1 === wall.x1 && box.z0 === wall.z0 && box.z1 === wall.z1), false);
  const client = fs.readFileSync("index.html", "utf8");
  assert.match(client, /box\(x0, x1, y0, y1, z0, z1, "#9acbd2"\)/);
  assert.match(client, /gl\.uniform1f\(u\("al"\), \.28\); drawDynamic\(canyonGlass, true\)/);
  assert.match(client, /isCanyon\(\) \? GrandCanyon\.bounds/);
});

test("each marked Grand Canyon site can be selected and has a distinct HUD label", () => {
  const server = fs.readFileSync("server.js", "utf8");
  const start = server.indexOf("function buildObjectives("), end = server.indexOf("function feetY(", start);
  assert.ok(start >= 0 && end > start);
  const math = Object.create(Math);
  const context = { Math: math, objectiveModes: new Set(["defuse", "rescue"]), grandCanyon: map, objectiveSites: {} };
  vm.runInNewContext(server.slice(start, end), context);
  const labels = fs.readFileSync("index.html", "utf8").match(/const siteLabels = (\{[^;]+\});/);
  assert.ok(labels);
  const siteLabels = vm.runInNewContext(`(${labels[1]})`);
  const sites = Object.keys(map.sites);
  sites.forEach((site, i) => {
    math.random = () => (i + .1) / sites.length;
    for (const mode of ["defuse", "rescue"]) {
      const objectives = context.buildObjectives({ mode, map: "harbor" }, [{ team: 1 }]);
      assert.equal(objectives[0].site, site);
      assert.equal(objectives[0].kind, mode === "defuse" ? "bomb" : "hostage");
      assert.equal(typeof siteLabels[site], "string");
    }
  });
  assert.equal(new Set(sites.map((site) => siteLabels[site])).size, sites.length);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message);
}

async function startCanyonMatch(t, mode, prepSeconds, operatorId) {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), QUEUE_SECONDS: "20", OBJECTIVE_PREP_SECONDS: String(prepSeconds) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => server.kill("SIGTERM"));
  await waitFor(() => output.includes("listening"), `Server did not start: ${output}`);
  const sockets = [0, 1].map(() => new WebSocket(`ws://127.0.0.1:${port}/ws`));
  const messages = [[], []];
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  sockets.forEach((socket, i) => socket.on("message", (data) => messages[i].push(JSON.parse(data))));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
    socket.once("open", resolve); socket.once("error", reject);
  })));
  const send = (i, message) => sockets[i].send(JSON.stringify(message));
  if (operatorId) send(0, { type: "select_operator", operatorId });
  sockets.forEach((_socket, i) => send(i, { type: "queue", mode }));
  await waitFor(() => messages.every((list) => list.some((m) => m.type === "lobby_update" && m.total === 2)), "Lobby did not form");
  sockets.forEach((_socket, i) => send(i, { type: "vote_map", map: "harbor" }));
  sockets.forEach((_socket, i) => send(i, { type: "ready" }));
  await waitFor(() => messages.every((list) => list.some((m) => m.type === "match_found")), "Match did not start");
  const found = messages.map((list) => list.find((m) => m.type === "match_found"));
  const defender = found.findIndex((m) => m.team === 1), attacker = 1 - defender;
  const latest = () => [...messages[0]].reverse().find((m) => m.type === "snapshot");
  const place = (i, x, z) => send(i, { type: "state", state: { x, y: 1.8, z, yaw: 0, pitch: 0 } });
  return { found, messages, defender, attacker, latest, send, place };
}

test("scaled-map player, drone, companion and projectile coordinates synchronize at the west edge", async (t) => {
  const match = await startCanyonMatch(t, "defuse", 0, "mr-m");
  await waitFor(() => match.latest()?.phase === "live", "Round did not go live");
  const state = { x: -160, y: 1.8, z: 103, yaw: 0, pitch: 0,
    companions: [{ x: -159, y: 1.8, z: 103, yaw: 0, slot: 0, mode: "scanner" }],
    droneState: { x: -161, y: 2, z: 103, yaw: 0, pitch: 0, mode: "camera" } };
  match.send(0, { type: "state", state });
  const playerId = match.messages[0].find((message) => message.type === "welcome").playerId;
  const player = await waitFor(() => {
    const entry = match.latest()?.players.find((p) => p.id === playerId);
    return entry?.state.x === -160 && entry;
  }, "West-edge player state was clipped");
  assert.equal(player.state.z, 103);
  assert.equal(player.state.companions[0].x, -159);
  assert.equal(player.state.droneState.x, -161);
  match.send(0, { type: "throw", id: "edge", kind: "frag", x: -160, y: 1, z: 103, vx: 0, vy: 0, vz: 0, fuse: 1 });
  const thrown = await waitFor(() => match.messages[1].find((message) => message.type === "throw" && message.id === "edge"), "Throw was not relayed");
  assert.equal(thrown.x, -160);
  assert.equal(thrown.z, 103);
  match.send(0, { type: "explode", id: "edge", x: -160, y: 1, z: 103 });
  const explosion = await waitFor(() => match.messages[1].find((message) => message.type === "explosion" && message.id === "edge"), "Explosion was not relayed");
  assert.equal(explosion.x, -160);
  assert.equal(explosion.z, 103);
});

test("voting for Grand Canyon uses its spawns, objective locations and east-west preparation barrier", async (t) => {
  const match = await startCanyonMatch(t, "defuse", 10);
  assert.equal(match.found[0].map, "harbor");
  assert.deepEqual(match.found[match.defender].spawn, map.spawns[1][0]);
  assert.deepEqual(match.found[match.attacker].spawn, map.spawns[2][0]);
  const objective = match.found[0].objectives[0];
  assert.deepEqual({ x: objective.x, y: objective.y, z: objective.z }, map.sites[objective.site]);
  match.place(match.defender, 10, 12);
  match.place(match.attacker, -10, -12);
  const snapshot = await waitFor(() => {
    const current = match.latest();
    const defender = current?.players.find((player) => player.team === 1);
    const attacker = current?.players.find((player) => player.team === 2);
    return defender?.state.x === -.7 && attacker?.state.x === .7 && current;
  }, "Server did not apply the Grand Canyon preparation barrier");
  assert.equal(snapshot.players.find((player) => player.team === 1).state.z, 12);
  assert.equal(snapshot.players.find((player) => player.team === 2).state.z, -12);
});

test("Grand Canyon hostage rescue completes on the attackers' side of the preparation line", async (t) => {
  const match = await startCanyonMatch(t, "rescue", 0);
  const objective = match.found[0].objectives[0];
  assert.equal(objective.kind, "hostage");
  await waitFor(() => match.latest()?.phase === "live", "Round did not go live");
  let x = objective.x + 1, z = objective.z;
  const timer = setInterval(() => match.place(match.attacker, x, z), 60);
  t.after(() => clearInterval(timer));
  await sleep(200);
  match.send(match.attacker, { type: "interact", holding: true, id: objective.id });
  await waitFor(() => match.latest()?.objectives[0]?.followerId, "Hostage was not freed", 5000);
  match.send(match.attacker, { type: "interact", holding: false, id: objective.id });
  x = 4;
  const end = await waitFor(() => match.messages[0].find((message) => message.type === "round_end"), "Hostage was not rescued", 5000);
  assert.equal(end.winner, 2);
  assert.match(end.reason, /rescued/);
});

test("the defuser can be planted at a Grand Canyon objective", async (t) => {
  const match = await startCanyonMatch(t, "defuse", 0);
  const objective = match.found[0].objectives[0];
  await waitFor(() => match.latest()?.phase === "live", "Round did not go live");
  const timer = setInterval(() => match.place(match.attacker, objective.x + 1, objective.z), 60);
  t.after(() => clearInterval(timer));
  await sleep(200);
  match.send(match.attacker, { type: "interact", holding: true, id: objective.id });
  await waitFor(() => match.latest()?.objectives[0]?.armed, "Defuser could not be planted", 7000);
});
