const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const html = fs.readFileSync("index.html", "utf8");
function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing ${start}`);
  return html.slice(first, last);
}

function menuSimulation() {
  class Element {
    constructor() { this.hidden = false; this.disabled = false; this.dataset = {}; this.style = {}; this.children = []; this.events = {}; this.attributes = {}; }
    addEventListener(type, handler) { this.events[type] = handler; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    insertBefore(child) { return this.appendChild(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelectorAll(selector) { return selector === "button" ? this.children : this.backButtons || []; }
    focus() {}
    click() { if (!this.disabled) this.events.click?.(); }
  }
  const ids = ["#field-menu", "#field-menu-main", "#field-menu-operator-view", "#field-menu-settings-view", "#field-operator-list",
    "#field-menu-operators", "#field-menu-operator-status", "#field-menu-title", "#field-menu-settings-content", "#field-menu-close",
    "#field-menu-settings", "#field-menu-leave"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements["#field-menu"].hidden = true;
  elements["#field-menu"].backButtons = [new Element(), new Element()];
  const home = new Element(), settingsPanel = new Element(), canvas = new Element(), hint = new Element();
  home.appendChild(settingsPanel);
  const listeners = {}, selection = [], departures = [];
  const context = {
    document: { pointerLockElement: canvas, querySelector: (id) => elements[id], createElement: () => new Element(),
      addEventListener: (type, handler) => { listeners[type] = handler; }, exitPointerLock() { this.pointerLockElement = null; } },
    canvas, hint, settingsPanel, running: true, keys: new Set(["w"]), heldCodes: new Map([["KeyW", "w"]]),
    mouseDown: true, mouseAim: true, recordingKeybind: null,
    multiplayer: { match: { matchId: "match" }, round: { phase: "prep", endsAt: 2000 } },
    performance: { now: () => 1000 }, selectedOperatorId: "mr-m",
    operatorRoster: [{ id: "mr-m", name: "Mr M", ability: "Drone" }, { id: "custom", name: "Custom", ability: "Custom kit" }],
    renderKeybinds() {}, cancelDroneDeploy() {}, recallDrone() {}, refreshWeapons() {}, defending: () => false,
    drone: { active: false, companions: [], tags: new Map(), uses: 3 }, weapons: {}, charges: {}, tNow: 1,
    selectOperator(id) { context.selectedOperatorId = id; selection.push(id); }, close() { departures.push(true); },
    say() {}, loadout: {}, inputKey: (event) => event.key.toLowerCase(), currentKeybinds: {}, isDead: () => false
  };
  const menu = section("      const locked = () => document.pointerLockElement === canvas;", '      canvas.addEventListener("contextmenu"');
  const keyboard = section('      document.addEventListener("keydown", (e) => {\n        if (!running) return;', '      document.addEventListener("keyup"');
  vm.runInNewContext(`${menu}\n${keyboard}\nglobalThis.menuApi = { openMenu, dismissMenu, openOperatorMenu, updateOperatorMenu };`, context);
  const press = (key) => {
    const event = { key, code: key, repeat: false, preventDefault() { this.prevented = true; } };
    listeners.keydown(event);
    return event;
  };
  return { context, elements, press, selection, departures, home, settingsPanel, canvas, hint };
}

test("Tab opens options, Escape dismisses menus, and only Leave exits", () => {
  const sim = menuSimulation();
  const menu = sim.elements["#field-menu"];
  assert.equal(sim.press("Tab").prevented, true);
  assert.equal(menu.hidden, false);
  assert.equal(sim.context.keys.size, 0);
  assert.equal(sim.context.document.pointerLockElement, null);
  sim.elements["#field-menu-settings"].click();
  assert.equal(sim.elements["#field-menu-settings-view"].hidden, false);
  assert.equal(sim.settingsPanel.parentNode, sim.elements["#field-menu-settings-content"]);
  menu.backButtons[1].click();
  assert.equal(sim.elements["#field-menu-main"].hidden, false);
  assert.equal(sim.settingsPanel.parentNode, sim.home);
  sim.elements["#field-menu-operators"].click();
  assert.equal(sim.elements["#field-menu-operator-view"].hidden, false);
  menu.backButtons[0].click();
  assert.equal(sim.elements["#field-menu-main"].hidden, false);
  sim.press("Escape");
  assert.equal(menu.hidden, true);
  sim.press("Escape");
  assert.equal(sim.departures.length, 0);
  sim.press("Tab");
  sim.elements["#field-menu-leave"].click();
  assert.equal(sim.departures.length, 1);
});

test("round operator menu allows preparation choices and locks them once live", () => {
  const sim = menuSimulation();
  sim.context.menuApi.openOperatorMenu();
  assert.equal(sim.elements["#field-menu-operator-view"].hidden, false);
  const buttons = sim.elements["#field-operator-list"].children;
  buttons[1].click();
  assert.deepEqual(sim.selection, ["custom"]);
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  sim.context.multiplayer.round.phase = "live";
  sim.context.menuApi.updateOperatorMenu();
  assert.ok(buttons.every((button) => button.disabled));
  buttons[0].click();
  assert.deepEqual(sim.selection, ["custom"]);
  sim.context.menuApi.dismissMenu();
  sim.context.menuApi.openOperatorMenu();
  assert.equal(sim.elements["#field-menu"].hidden, true);
  assert.match(html, /fieldView\.beginRound\(message\.spawn\);\s*fieldView\.openOperatorMenu\(\);/);
  assert.match(html, /!practice && multiplayer\.match && canChangeOperator\(\)\) openOperatorMenu\(\)/);
});

test("online operator changes propagate during preparation and are rejected live", async (testContext) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(port), PREP_SECONDS: "3", QUEUE_SECONDS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  testContext.after(() => server.kill("SIGTERM"));
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const waitFor = async (predicate, description) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const result = predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${description}: ${output}`);
  };
  await waitFor(() => output.includes("listening"), "Server did not start");
  const sockets = [new WebSocket(`ws://127.0.0.1:${port}/ws`), new WebSocket(`ws://127.0.0.1:${port}/ws`)];
  testContext.after(() => sockets.forEach((socket) => socket.terminate()));
  const messages = [[], []];
  sockets.forEach((socket, index) => socket.on("message", (data) => messages[index].push(JSON.parse(data))));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); })));
  sockets[1].send(JSON.stringify({ type: "select_operator", operatorId: "custom", loadout: { primary: "horn-chopper-2000" } }));
  sockets.forEach((socket) => socket.send(JSON.stringify({ type: "queue", mode: "duel" })));
  const welcome = await waitFor(() => messages[0].find((message) => message.type === "welcome"), "Welcome missing");
  await waitFor(() => messages[0].find((message) => message.type === "match_found"), "Match did not start");
  sockets[0].send(JSON.stringify({ type: "select_operator", operatorId: "pyromaniac" }));
  await waitFor(() => messages[1].some((message) => message.type === "snapshot" && message.phase === "prep" &&
    message.players.some((player) => player.id === welcome.playerId && player.operatorId === "pyromaniac")), "Operator did not propagate");
  const other = await waitFor(() => messages[1].find((message) => message.type === "welcome"), "Second welcome missing");
  sockets[1].send(JSON.stringify({ type: "state", state: { x: 0, y: 1.8, z: 10, yaw: 0, activeSlot: "primary", rotorAngle: 1.25 } }));
  await waitFor(() => messages[0].some((message) => message.type === "snapshot" &&
    message.players.some((player) => player.id === other.playerId && player.state.rotorAngle === 1.25)), "Barrel rotation did not propagate");
  await waitFor(() => messages[0].some((message) => message.type === "snapshot" && message.phase === "live"), "Round did not go live");
  sockets[0].send(JSON.stringify({ type: "select_operator", operatorId: "mr-l" }));
  const rejected = await waitFor(() => messages[0].find((message) => message.type === "operator_rejected"), "Live operator change was not rejected");
  assert.equal(rejected.operatorId, "pyromaniac");
  assert.equal(rejected.loadout.primary, "f451");
});