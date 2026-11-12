const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message);
}

test("paint colors and impacts synchronize, and invalid paint is rejected", async (t) => {
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
  sockets.forEach((_socket, i) => send(i, { type: "queue", mode: "duel" }));
  await waitFor(() => messages[0].some((m) => m.type === "snapshot" && m.phase === "live"), "Round did not go live");
  const shooter = messages[0].find((m) => m.type === "welcome").playerId;
  send(0, { type: "state", state: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "primary",
    equippedPaint: "#32a6ef", dronePaint: "#f04c9b" } });
  const snapshot = await waitFor(() => messages[1].find((m) => m.type === "snapshot" &&
    m.players.find((p) => p.id === shooter)?.state.equippedPaint === "#32a6ef"), "Magazine paint was not synchronized");
  assert.equal(snapshot.players.find((p) => p.id === shooter).state.dronePaint, "#f04c9b");
  send(0, { type: "paint", point: [0, 1, 2], normal: [0, 0, -1], size: .22, color: "#32a6ef" });
  const mark = await waitFor(() => messages[1].find((m) => m.type === "paint"), "Paint impact was not relayed");
  assert.equal(mark.color, "#32a6ef");
  assert.equal(mark.size, .22);
  send(0, { type: "paint", point: [0, 1, 2], normal: [0, 0, -1], size: .22, color: "invalid" });
  await sleep(120);
  assert.equal(messages[1].filter((m) => m.type === "paint").length, 1);
  send(0, { type: "bar", op: "hit", id: "cover", p: [0, 1, 2], radius: .03, power: 20, chip: true, src: "bullet", paint: "#32a6ef" });
  const barHit = await waitFor(() => messages[1].find((m) => m.type === "bar" && m.id === "cover"), "Barricade hit was not relayed");
  assert.equal(barHit.paint, "#32a6ef");
  send(0, { type: "bar", op: "hit", id: "hammer", p: [0, 1, 2], radius: .65, power: 1000, src: "hammer", paint: "#32a6ef" });
  const hammerHit = await waitFor(() => messages[1].find((m) => m.type === "bar" && m.id === "hammer"), "Hammer hit was not relayed");
  assert.equal(hammerHit.paint, null);
  send(0, { type: "throw", id: "paint-frag", kind: "frag", paint: "#f04c9b", x: 0, y: 1, z: 2, vx: 0, vy: 0, vz: 0, fuse: 1 });
  const thrown = await waitFor(() => messages[1].find((m) => m.type === "throw" && m.id === "paint-frag"), "Grenade not relayed");
  assert.equal(thrown.paint, "#f04c9b");
  send(0, { type: "explode", id: "paint-frag", x: 0, y: 1, z: 2 });
  const explosion = await waitFor(() => messages[1].find((m) => m.type === "explosion" && m.id === "paint-frag"), "Explosion not relayed");
  assert.equal(explosion.paint, "#f04c9b");
  const target = messages[1].find((m) => m.type === "welcome").playerId;
  await sleep(60);
  send(1, { type: "state", state: { x: 0, y: 1.8, z: 10, yaw: Math.PI, pitch: 0, activeSlot: "primary" } });
  await waitFor(() => messages[0].some((m) => m.type === "snapshot" && m.players.find((p) => p.id === target)?.state.z === 10), "Target state not synchronized");
  send(0, { type: "paint", point: [0, 1.8, 9.65], normal: [0, 0, -1], size: .11, color: "#32a6ef",
    targetId: target, targetAnchor: [.1, 1.8, 10] });
  const playerMark = await waitFor(() => messages[1].find((m) => m.type === "paint" && m.targetId === target), "Player paint not relayed");
  assert.deepEqual(playerMark.targetAnchor, [.1, 1.8, 10]);
  send(0, { type: "shoot", targetId: target, damage: 1, direction: { x: 0, y: 0, z: 1 } });
  const hit = await waitFor(() => messages[0].find((m) => m.type === "player_damaged" && m.playerId === target), "Headshot not applied");
  assert.equal(hit.health, 0);
});
