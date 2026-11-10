const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(message);
}

async function startMatch(t, mode, env = {}) {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), OBJECTIVE_PREP_SECONDS: "0", QUEUE_SECONDS: "1", ...env },
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
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); })));
  const send = (index, message) => sockets[index].send(JSON.stringify(message));
  sockets.forEach((_socket, index) => send(index, { type: "queue", mode }));
  const found = await waitFor(() => messages.every((list) => list.some((message) => message.type === "match_found")), "Match did not start", 10000)
    .then(() => messages.map((list) => list.find((message) => message.type === "match_found")));
  // index of the defender (team 1, press box side) and attacker (team 2)
  const defender = found.findIndex((message) => message.team === 1), attacker = 1 - defender;
  const latest = (index) => [...messages[index]].reverse().find((message) => message.type === "snapshot");
  const place = (index, x, y, z) => send(index, { type: "state", state: { x, y: y + 1.8, z, yaw: 0, pitch: 0, activeSlot: "primary" } });
  return { send, messages, found, defender, attacker, latest, place, objective: found[0].objectives[0] };
}

test("defuse: defuser takes 5s to place, can be removed, and the clock ends the round for the defenders", async (t) => {
  const m = await startMatch(t, "defuse", { ROUND_SECONDS: "14" });
  assert.equal(m.found[0].mode, "defuse");
  assert.equal(m.found[0].objectives.length, 1);
  assert.equal(m.found[0].objectives[0].kind, "bomb");
  const o = m.objective;
  await waitFor(() => m.latest(0)?.phase === "live", "Round did not go live");
  const timer = setInterval(() => { m.place(m.attacker, o.x + 1, o.y, o.z); m.place(m.defender, o.x - 1, o.y, o.z - 1); }, 60);
  t.after(() => clearInterval(timer));
  await sleep(200);
  m.send(m.attacker, { type: "interact", holding: true, id: o.id });
  await sleep(2500);
  assert.equal(m.latest(0).objectives[0].armed, false, "armed before 5 seconds");
  assert.ok(m.latest(0).objectives[0].progress > 0.3);
  await waitFor(() => m.latest(0).objectives[0].armed, "Defuser was never placed", 4000);
  m.send(m.attacker, { type: "interact", holding: false, id: o.id });
  // attackers cannot remove their own defuser; only defenders can
  m.send(m.defender, { type: "interact", holding: true, id: o.id });
  await sleep(2500);
  assert.equal(m.latest(0).objectives[0].armed, true);
  await waitFor(() => !m.latest(0).objectives[0].armed, "Defuser was never removed", 4000);
  m.send(m.defender, { type: "interact", holding: false, id: o.id });
  const end = await waitFor(() => m.messages[0].find((message) => message.type === "round_end"), "Round never timed out", 15000);
  assert.equal(end.winner, 1);
  assert.match(end.reason, /Time expired/);
});

test("defuse: attackers win by holding the defuser for 25 seconds", async (t) => {
  const m = await startMatch(t, "defuse");
  const o = m.objective;
  await waitFor(() => m.latest(0)?.phase === "live", "Round did not go live");
  const timer = setInterval(() => { m.place(m.attacker, o.x + 1, o.y, o.z); m.place(m.defender, o.x - 30, o.y, o.z - 30); }, 60);
  t.after(() => clearInterval(timer));
  await sleep(200);
  m.send(m.attacker, { type: "interact", holding: true, id: o.id });
  await waitFor(() => m.latest(0).objectives[0].armed, "Defuser was never placed", 7000);
  m.send(m.attacker, { type: "interact", holding: false, id: o.id });
  const end = await waitFor(() => m.messages[0].find((message) => message.type === "round_end"), "Defuser never completed", 30000);
  assert.equal(end.winner, 2);
});

test("rescue: escorting the hostage past midfield wins; killing it loses the round for the shooter", async (t) => {
  const m = await startMatch(t, "rescue");
  assert.equal(m.found[0].objectives[0].kind, "hostage");
  const o = m.objective;
  await waitFor(() => m.latest(0)?.phase === "live", "Round did not go live");
  let z = o.z;
  const timer = setInterval(() => { m.place(m.attacker, o.x + 1, o.y, z); m.place(m.defender, o.x - 30, o.y, o.z - 30); }, 60);
  t.after(() => clearInterval(timer));
  await sleep(200);
  m.send(m.attacker, { type: "interact", holding: true, id: o.id });
  await waitFor(() => m.latest(0).objectives[0].followerId, "Hostage was never freed", 6000);
  m.send(m.attacker, { type: "interact", holding: false, id: o.id });
  for (let step = 0; step < 40 && !m.messages[0].some((message) => message.type === "round_end"); step++) { z += 2.5; await sleep(100); }
  const end = await waitFor(() => m.messages[0].find((message) => message.type === "round_end"), "Hostage never rescued");
  assert.equal(end.winner, 2);
  assert.match(end.reason, /rescued/);
});

test("rescue: the team that kills the hostage loses immediately", async (t) => {
  const m = await startMatch(t, "rescue");
  const o = m.objective;
  await waitFor(() => m.latest(0)?.phase === "live", "Round did not go live");
  // defender stands south of the hostage and fires north-to-south (yaw 0 faces +z, so stand at -z of it)
  const timer = setInterval(() => { m.place(m.defender, o.x, o.y, o.z - 5); m.place(m.attacker, o.x + 30, o.y, o.z + 30); }, 60);
  t.after(() => clearInterval(timer));
  await sleep(300);
  for (let i = 0; i < 4; i++) { m.send(m.defender, { type: "shoot", targetId: "hostage", damage: 55, direction: { x: 0, y: 0, z: 1 } }); await sleep(120); }
  const end = await waitFor(() => m.messages[0].find((message) => message.type === "round_end"), "Hostage kill did not end the round");
  assert.equal(end.winner, 2);
  assert.match(end.reason, /killed the hostage/);
});
