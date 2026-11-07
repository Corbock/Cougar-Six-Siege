const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message);
}

test("multiplayer attacker requires a continuous lock and limits damage and fire rate", async (t) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), PREP_SECONDS: "0", QUEUE_SECONDS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => server.kill("SIGTERM"));
  await waitFor(() => output.includes("listening"), `Server did not start: ${output}`);

  const sockets = [new WebSocket(`ws://127.0.0.1:${port}/ws`), new WebSocket(`ws://127.0.0.1:${port}/ws`)];
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  const messages = [[], []];
  sockets.forEach((socket, index) => socket.on("message", (data) => messages[index].push(JSON.parse(data))));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  })));
  const send = (index, message) => sockets[index].send(JSON.stringify(message));
  send(0, { type: "select_operator", operatorId: "mr-m" });
  send(1, { type: "select_operator", operatorId: "custom" });
  sockets.forEach((_socket, index) => send(index, { type: "queue", mode: "duel" }));
  const found = await waitFor(() => messages[0].find((message) => message.type === "match_found"), "Match did not start");
  const target = found.players.find((player) => player.operatorId === "custom");
  assert.ok(target);
  await waitFor(() => messages[0].some((message) => message.type === "snapshot" && message.phase === "live"), "Round did not go live");

  let targetId = target.id;
  const sendStates = () => {
    send(0, { type: "state", state: { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, activeSlot: "gadget", companions: [
      { x: 0, y: 3, z: 0, yaw: 0, mode: "scanner" },
      { x: 0, y: 3, z: 1, yaw: 0, mode: "attacker", targetId },
      { x: 1, y: 3, z: 0, yaw: 0, mode: "scanner" }
    ] } });
    send(1, { type: "state", state: { x: 5, y: 1.8, z: 1, yaw: 0, pitch: 0, activeSlot: "primary" } });
  };
  sendStates();
  const stateTimer = setInterval(sendStates, 70);
  t.after(() => clearInterval(stateTimer));
  const attack = () => send(0, { type: "drone_attack", targetId: target.id });
  const damage = () => messages[0].filter((message) => message.type === "player_damaged" && message.playerId === target.id);
  await sleep(300);
  attack();
  await sleep(100);
  assert.equal(damage().length, 0, "A new lock must not damage immediately");
  const snapshot = await waitFor(() => messages[1].find((message) => message.type === "snapshot" &&
    message.players.find((player) => player.operatorId === "mr-m")?.state.companions?.length === 3), "Companions were not synchronized");
  assert.deepEqual(snapshot.players.find((player) => player.operatorId === "mr-m").state.companions.map((entry) => entry.mode), ["scanner", "attacker", "scanner"]);
  await sleep(1800);
  attack();
  await waitFor(() => damage().length === 1, "Locked drone did not fire");
  assert.equal(damage()[0].health, 96);
  assert.ok(messages[0].some((message) => message.type === "drone_shot"));
  await waitFor(() => messages[1].some((message) => message.type === "drone_shot"), "Drone shot was not visible to the target");
  attack();
  await sleep(100);
  assert.equal(damage().length, 1, "Rapid duplicate shot must be rejected");
  await sleep(120);
  attack();
  await waitFor(() => damage().length === 2, "Second shot after cooldown did not land");
  assert.equal(damage()[1].health, 92);

  targetId = null;
  await sleep(150);
  targetId = target.id;
  await sleep(150);
  attack();
  await sleep(100);
  assert.equal(damage().length, 2, "Breaking line of sight must reset the lock");
  await sleep(1900);
  attack();
  await waitFor(() => damage().length === 3, "Drone did not reacquire its target");
  assert.equal(damage()[2].health, 88);

  clearInterval(stateTimer);
  const shooter = found.players.find((player) => player.operatorId === "mr-m");
  const dx = -5, dy = 1.2, dz = 0, distance = Math.hypot(dx, dy, dz);
  await sleep(80);
  send(1, { type: "state", state: { x: 5, y: 1.8, z: 1, yaw: -Math.PI / 2, pitch: Math.atan2(dy, 5), activeSlot: "primary" } });
  await sleep(100);
  send(1, { type: "drone_hit", ownerId: shooter.id, slot: 1, direction: { x: dx / distance, y: dy / distance, z: dz } });
  await waitFor(() => messages[0].some((message) => message.type === "drone_destroyed" && message.slot === 1), "Attacker drone was not destroyed");
  assert.ok(messages[1].some((message) => message.type === "drone_destroyed" && message.slot === 1));
  sendStates();
  await sleep(150);
  const after = messages[1].filter((message) => message.type === "snapshot").at(-1).players.find((player) => player.id === shooter.id);
  assert.deepEqual(after.state.companions.map((entry) => entry.slot), [0, 2]);
  attack();
  await sleep(250);
  assert.equal(damage().length, 3, "Destroyed attacker cannot shoot or respawn from stale state");

  const camera = { x: 4, y: .42, z: 0, yaw: 0, pitch: 0, mode: "camera" };
  await sleep(80);
  send(1, { type: "state", state: { x: 5, y: 1.8, z: 1, yaw: 0, pitch: 0, activeSlot: "gadget", droneState: camera } });
  const cameraDistance = Math.hypot(4, -1.38);
  send(0, { type: "state", state: { x: 0, y: 1.8, z: 0, yaw: Math.PI / 2, pitch: Math.atan2(-1.38, 4), activeSlot: "primary" } });
  await waitFor(() => messages[0].some((message) => message.type === "snapshot" &&
    message.players.find((player) => player.id === target.id)?.state.droneState?.mode === "camera"), "Camera drone was not synchronized");
  send(0, { type: "drone_hit", ownerId: target.id, slot: "camera", direction: { x: 4 / cameraDistance, y: -1.38 / cameraDistance, z: 0 } });
  await waitFor(() => messages[1].some((message) => message.type === "drone_destroyed" && message.slot === "camera"), "Camera drone was not destroyed");
  await sleep(80);
  send(1, { type: "state", state: { x: 5, y: 1.8, z: 1, yaw: 0, pitch: 0, activeSlot: "gadget", droneState: camera } });
  await sleep(120);
  const cameraOwner = messages[0].filter((message) => message.type === "snapshot").at(-1).players.find((player) => player.id === target.id);
  assert.equal(cameraOwner.state.droneState, null);
});
