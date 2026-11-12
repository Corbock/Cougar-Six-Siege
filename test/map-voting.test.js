const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const maps = ["field", "harbor", "foundry"];
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

test("the play menu enables every listed map for every multiplayer mode", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const start = html.indexOf("    const multiplayerMaps ="), end = html.indexOf("    const selection =", start);
  assert.ok(start >= 0 && end > start);
  const catalog = vm.runInNewContext(html.slice(start, end) + "\ncatalogs.PLAY");
  assert.deepEqual(Array.from(catalog.maps, (map) => map.id), maps);
  for (const mode of catalog.modes) assert.deepEqual(Array.from(mode.maps), maps, mode.id);
});

test("every map can be voted for in each matchmaking mode and selected for a match", async (t) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), QUEUE_SECONDS: "30" },
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
  for (const [mode, winner] of [["quick", "foundry"], ["ranked", "foundry"], ["defuse", "harbor"], ["rescue", "field"], ["duel", "harbor"]]) {
    let start = messages[0].length;
    send(0, { type: "queue", mode });
    const lobby = await waitFor(() => messages[0].slice(start).find((m) => m.type === "lobby_update"), `No ${mode} lobby`);
    assert.deepEqual(lobby.options, maps, mode);
    for (const map of maps) {
      start = messages[0].length;
      send(0, { type: "vote_map", map });
      const vote = await waitFor(() => messages[0].slice(start).find((m) => m.type === "lobby_update" && m.myVote === map), `${mode} rejected ${map}`);
      assert.equal(vote.tally[map], 1);
    }
    start = messages[0].length;
    send(1, { type: "queue", mode });
    await waitFor(() => messages[0].slice(start).find((m) => m.type === "lobby_update" && m.total === 2), `Second player did not join ${mode}`);
    start = messages[0].length;
    send(0, { type: "vote_map", map: winner });
    send(1, { type: "vote_map", map: winner });
    send(0, { type: "ready" });
    send(1, { type: "ready" });
    const found = await waitFor(() => messages[0].slice(start).find((m) => m.type === "match_found"), `${mode} match did not start`);
    assert.equal(found.map, winner, mode);
    const secondStart = messages[1].length;
    send(0, { type: "leave_match" });
    await waitFor(() => messages[1].slice(secondStart).find((m) => m.type === "match_ended"), `${mode} match did not close`);
  }
});
