const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const html = fs.readFileSync("index.html", "utf8");
const serverCode = fs.readFileSync("server.js", "utf8");
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing section: ${start}`);
  return source.slice(first, last);
}

test("tornado current pulls strongly inward with a spiral and respects fade, range and center", () => {
  const context = { Math, SMOKE_LIFE: 16, SMOKE_R: 4.5, tNow: 3 };
  vm.runInNewContext(section(html, "      function moveWithCollision(", "      let running =") +
    section(html, "      const smokeFade =", "      function rechargeGrenades()"), context);
  const sm = { x: 0, z: 0, t0: 0, tornado: true };
  const [vx, vz] = context.tornadoCurrent(sm, 4, 0);
  assert.equal(vx, -8);
  assert.equal(vz, -3.5);
  assert.deepEqual(Array.from(context.tornadoCurrent(sm, 7, 0)), [0, 0]);
  assert.deepEqual(Array.from(context.tornadoCurrent(sm, 0, 0)), [0, 0]);
  assert.deepEqual(Array.from(context.tornadoCurrent({ ...sm, tornado: false }, 4, 0)), [0, 0]);
  context.tNow = 14;
  assert.ok(Math.abs(context.tornadoCurrent(sm, 4, 0)[0] - vx / 2) < 1e-9);
  context.tNow = 16;
  assert.equal(Math.hypot(...context.tornadoCurrent(sm, 4, 0)), 0);
});

test("a drone operator's body is pulled while respecting collision", () => {
  const context = { Math, SMOKE_LIFE: 16, SMOKE_R: 4.5, EYE: 1.8, CROUCH_EYE: 1.05, HL: 50, ZB: 20,
    tNow: 3, smokes: [{ x: 0, z: 0, t0: 0, tornado: true }], drone: { returnTo: { x: 4, y: 1.8, z: 0 } },
    probe: () => 0, barrierOn: () => false, isCanyon: () => false };
  vm.runInNewContext(section(html, "      function moveWithCollision(", "      let running =") +
    section(html, "      const smokeFade =", "      function rechargeGrenades()"), context);
  context.moveDroneOperatorInTornado(.05);
  assert.ok(context.drone.returnTo.x < 4);
  const x = context.drone.returnTo.x;
  context.probe = (px) => px < x ? -1 : 0;
  context.moveDroneOperatorInTornado(.05);
  assert.equal(context.drone.returnTo.x, x);
});

test("strong tornado movement cannot skip through thin walls", () => {
  const context = { Math, probe: (x) => x >= .4 && x <= .65 ? -1 : 0 };
  vm.runInNewContext(section(html, "      function moveWithCollision(", "      let running ="), context);
  const position = { x: 0, z: 0 };
  context.moveWithCollision(position, 1, 0, 0);
  assert.ok(position.x < .4);
});

test("shields intercept shots aimed at other players only when in the shot path", () => {
  const holder = { id: "shield", health: 100, state: { x: 0, y: 1.8, z: 5, yaw: Math.PI, shieldActive: true } };
  const context = { Math, players: new Map([["shield", holder]]) };
  vm.runInNewContext(section(serverCode, "function shieldHitDistance(", "function removePlayer("), context);
  const match = { players: ["shield"] }, attacker = { id: "shooter" }, direction = { x: 0, y: 0, z: 1 };
  assert.equal(context.shieldBlocks(match, attacker, { x: 0, y: 1.5, z: 0 }, direction, 10), true);
  assert.equal(context.shieldBlocks(match, attacker, { x: 1, y: 1.5, z: 0 }, direction, 10), false);
  assert.equal(context.shieldBlocks(match, attacker, { x: 0, y: 1.5, z: 0 }, direction, 3), false);
  holder.health = 0;
  assert.equal(context.shieldBlocks(match, attacker, { x: 0, y: 1.5, z: 0 }, direction, 10), false);
});

test("preset and Custom operators activate only their equipped shield and sniper", () => {
  const context = {};
  vm.runInNewContext(section(serverCode, "function hasActiveShield(", "function removePlayer("), context);
  const gadget = { activeSlot: "gadget" };
  assert.equal(context.hasActiveShield({ operatorId: "ms-c" }, gadget), true);
  assert.equal(context.hasActiveShield({ operatorId: "custom", customGadget: "shield" }, gadget), true);
  assert.equal(context.hasActiveShield({ operatorId: "custom", customGadget: "drone" }, gadget), false);
  assert.equal(context.hasActiveShield({ operatorId: "ms-c" }, { activeSlot: "primary" }), false);
  assert.equal(context.hasActiveShield({ operatorId: "ms-c" }, { ...gadget, droneState: {} }), false);
  assert.equal(context.hasActiveSniper({ operatorId: "hallway-monitor", state: { activeSlot: "primary" } }), true);
  assert.equal(context.hasActiveSniper({ operatorId: "custom", customPrimary: "longwatch", state: { activeSlot: "primary" } }), true);
  assert.equal(context.hasActiveSniper({ operatorId: "custom", customPrimary: "longwatch", state: { activeSlot: "secondary" } }), false);
  assert.equal(context.hasActiveSniper({ operatorId: "ms-a", state: { activeSlot: "primary" } }), false);
});

test("Mr L and Ms C recharge one grenade every 15 seconds up to capacity", () => {
  for (const [operator, id] of [["mr-l", "smoke"], ["ms-c", "frag"]]) {
    const messages = [];
    const context = { selectedOperatorId: operator, charges: { [id]: 0 }, weapons: { [id]: { kind: { uses: 3 } } },
      tNow: 14.99, nextGrenadeRecharge: 15, say: (message) => messages.push(message) };
    vm.runInNewContext(section(html, "      function rechargeGrenades()", "      function setSmoke("), context);
    context.rechargeGrenades();
    assert.equal(context.charges[id], 0);
    for (const [time, expected] of [[15, 1], [29.99, 1], [30, 2], [45, 3], [60, 3]]) {
      context.tNow = time; context.rechargeGrenades(); assert.equal(context.charges[id], expected);
    }
    assert.equal(messages.length, 3);
  }
});

test("client and server shield planes agree for standing, crouching, leaning and rear shots", () => {
  const client = { Math, EYE: 1.8, CROUCH_EYE: 1.05 };
  vm.runInNewContext(section(html, "      function shieldHitDistance(", "      const hudMsg ="), client);
  const server = { Math };
  vm.runInNewContext(section(serverCode, "function shieldHitDistance(", "function shieldBlocks("), server);
  for (const state of [
    { x: 0, y: 1.8, z: 0, yaw: 0, lean: 0, shieldActive: true },
    { x: 1, y: 1.05, z: 2, yaw: Math.PI / 2, lean: .4, crouched: true, shieldActive: true }
  ]) {
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    const cx = state.x + c * (state.lean || 0) * .7, cz = state.z - s * (state.lean || 0) * .7;
    for (const [side, front, expected] of [[0, 3, true], [.8, 3, false], [0, -3, false]]) {
      const origin = [cx + c * side + s * front, state.y - .2, cz - s * side + c * front];
      const direction = front > 0 ? [-s, 0, -c] : [s, 0, c];
      const a = client.shieldHitDistance(state, origin, direction);
      const b = server.shieldHitDistance(state, { x: origin[0], y: origin[1], z: origin[2] },
        { x: direction[0], y: direction[1], z: direction[2] });
      assert.equal(Number.isFinite(a), expected);
      assert.equal(a, b);
    }
  }
});

test("remote operator mesh shows a shield only while shield is active", () => {
  const boxes = [];
  const context = { Math, EYE: 1.8, CROUCH_EYE: 1.05, remoteEquippedItem: (player) => player.state.shieldActive ? "shield" : null,
    qb: (_list, x0, x1, y0, y1, z0, z1, color, transform) =>
    boxes.push({ color, point: transform([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]) }) };
  vm.runInNewContext(section(html, "      function operatorMeshQuads(", "      function droneWorldQuads("), context);
  const player = { state: { x: 0, y: 1.8, z: 0, yaw: 0, shieldActive: false } };
  context.operatorMeshQuads([], player, "#ffffff");
  const baseline = boxes.length;
  player.state.shieldActive = true;
  context.operatorMeshQuads([], player, "#ffffff");
  assert.equal(boxes.length - baseline * 2, 6);
  assert.ok(boxes.slice(-6).every((box) => box.point[2] > .5));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(message);
}

test("multiplayer shields block frontal shots but not Longwatch or grenade blasts", async (t) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), PREP_SECONDS: "0", QUEUE_SECONDS: "1" },
    stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => server.kill("SIGTERM"));
  await waitFor(() => output.includes("listening"), "Server did not start");
  const sockets = [new WebSocket(`ws://127.0.0.1:${port}/ws`), new WebSocket(`ws://127.0.0.1:${port}/ws`)];
  const messages = [[], []];
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  sockets.forEach((socket, i) => socket.on("message", (data) => messages[i].push(JSON.parse(data))));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); })));
  const send = (i, message) => sockets[i].send(JSON.stringify(message));
  send(0, { type: "select_operator", operatorId: "custom", loadout: { primary: "longwatch", secondary: "magnum", gadget: "drone", equipment: "flash" } });
  send(1, { type: "select_operator", operatorId: "custom", loadout: { primary: "mk18", secondary: "rattler", gadget: "shield", equipment: "smoke" } });
  sockets.forEach((_socket, i) => send(i, { type: "queue", mode: "duel" }));
  const match = await waitFor(() => messages[0].find((m) => m.type === "match_found"), "Match did not start");
  const self = messages[0].find((m) => m.type === "welcome").playerId;
  const target = match.players.find((p) => p.id !== self).id;
  await waitFor(() => messages[0].some((m) => m.type === "snapshot" && m.phase === "live"), "Round did not go live");
  const state = (i, slot) => send(i, { type: "state", state: i === 0
    ? { x: 0, y: 1.3, z: 0, yaw: 0, pitch: 0, activeSlot: slot }
    : { x: 0, y: 1.8, z: 10, yaw: Math.PI, pitch: 0, activeSlot: slot } });
  state(0, "secondary"); state(1, "gadget");
  await waitFor(() => messages[0].some((m) => m.type === "snapshot" && m.players.find((p) => p.id === target)?.state.shieldActive), "Shield not synchronized");
  await waitFor(() => messages[1].some((m) => m.type === "snapshot" && m.players.find((p) => p.id === self)?.state.equippedItem === "magnum"), "Custom secondary not synchronized");
  assert.ok(messages[0].some((m) => m.type === "snapshot" && m.players.find((p) => p.id === target)?.state.equippedItem === "shield"));
  const damages = () => messages[0].filter((m) => m.type === "player_damaged" && m.playerId === target);
  const shoot = () => send(0, { type: "shoot", targetId: target, damage: 20, direction: { x: 0, y: 0, z: 1 } });
  shoot(); await sleep(150);
  assert.equal(damages().length, 0);
  const impact = await waitFor(() => messages[1].find((m) => m.type === "shield_impact"), "Server did not relay shield impact");
  assert.ok(Math.abs(impact.point[2] - 9.42) < .001);
  send(0, { type: "shield_impact", direction: { x: 0, y: 0, z: 1 } });
  await waitFor(() => messages[1].filter((m) => m.type === "shield_impact").length === 2, "Shield-only impact was not relayed");
  state(0, "primary"); await sleep(100); shoot();
  await waitFor(() => messages[1].some((m) => m.type === "snapshot" && m.players.find((p) => p.id === self)?.state.equippedItem === "longwatch"), "Custom primary not synchronized");
  await waitFor(() => damages().length === 1, "Longwatch did not penetrate shield");
  assert.equal(damages()[0].health, 80);
  send(0, { type: "throw", id: "blast", kind: "frag", x: 4, y: .8, z: 10, vx: 0, vy: 0, vz: 0, fuse: 1 });
  await waitFor(() => messages[1].some((m) => m.type === "throw" && m.id === "blast"), "Grenade not relayed");
  send(0, { type: "explode", id: "blast", x: 4, y: .8, z: 10 });
  await waitFor(() => damages().length === 2, "Grenade damage missing");
  assert.equal(damages()[1].health, 80 - Math.round(130 * (1 - 4 / 6)));
  send(0, { type: "state", state: { x: 0, y: 1.3, z: 20, yaw: Math.PI, pitch: 0, activeSlot: "secondary" } });
  await sleep(100);
  send(0, { type: "shoot", targetId: target, damage: 20, direction: { x: 0, y: 0, z: -1 } });
  await waitFor(() => damages().length === 3, "Shot from behind shield did not land");
  assert.equal(damages()[2].health, damages()[1].health - 20);
});
