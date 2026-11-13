const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
function section(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing ${start}`);
  return html.slice(first, last);
}

test("each unique match victory grants and saves exactly one Armory Pack", () => {
  const context = {};
  const award = section("    function awardMatchPack(matchId) {", "    packOpenButton.addEventListener");
  vm.runInNewContext(`
    let packs = 0;
    const rewardedMatches = new Set();
    let saves = 0, renders = 0, notices = 0;
    const saveArmory = () => saves++;
    const renderArmory = () => renders++;
    const showToast = () => notices++;
    ${award}
    globalThis.award = awardMatchPack;
    globalThis.state = () => ({ packs, rewarded: [...rewardedMatches], saves, renders, notices });
  `, context);

  context.award("match-1");
  context.award("match-1");
  context.award("match-2");
  context.award("");

  assert.deepEqual({ ...context.state(), rewarded: [...context.state().rewarded] }, {
    packs: 2, rewarded: ["match-1", "match-2"], saves: 2, renders: 2, notices: 2
  });
});

test("pack reward pool excludes only camos already unlocked from packs", () => {
  const context = {
    packPairs: ["mk18:night-digital", "mk18:ember", "vector:night-digital"],
    skins: [{ id: "night-digital" }, { id: "ember" }],
    ownedWraps: new Set(["mk18:night-digital", "vector:night-digital"]),
    skinUnlockKey: (weaponId, skinId) => `${weaponId}:${skinId}`,
    skinUnlocked: (skin, weaponId) => context.ownedWraps.has(`${weaponId}:${skin.id}`)
  };
  const pool = section("    function packRewardPool() {", "    function openArmoryPack()");
  vm.runInNewContext(`${pool}\nglobalThis.getPool = packRewardPool;`, context);
  assert.deepEqual([...context.getPool()], ["mk18:ember"]);
});

test("unowned camos stay hidden until a pack unlocks them for that weapon", () => {
  const context = {
    skins: [{ id: "night-digital" }, { id: "ember" }],
    ownedWraps: new Set(),
    skinUnlockKey: (weaponId, skinId) => `${weaponId}:${skinId}`
  };
  const helpers = section("    const skinUnlocked =", "    const weaponName =");
  vm.runInNewContext(`${helpers}\nglobalThis.available = unlockedWeaponSkins;`, context);
  assert.deepEqual([...context.available("mk18")], []);

  context.ownedWraps.add("mk18:ember");
  assert.deepEqual([...context.available("mk18")].map((skin) => skin.id), ["ember"]);
  assert.deepEqual([...context.available("vector")], []);
});

test("opening a pack stages the reveal and displays the unlocked camo preview", () => {
  const timers = [];
  const fields = {
    "#pack-reward-type": { textContent: "" },
    "#pack-reward-name": { textContent: "" },
    "#pack-reward-detail": { textContent: "" }
  };
  const reward = { hidden: true };
  const context = {
    packs: 1, packOpening: false, packPairs: ["mk18:tiger-stripe"],
    packWeapons: [{ id: "mk18" }], skins: [{ id: "tiger-stripe", name: "Tiger Stripe", src: "assets/skin-tiger-stripe.jpg" }],
    ownedWraps: new Set(), usage: {}, hitsWith: () => 0, skinUnlockKey: (weapon, skin) => `${weapon}:${skin}`,
    skinUnlocked: () => false, weaponName: () => "MK18", packRewardPool: () => ["mk18:tiger-stripe"],
    packReward: reward, packRewardSwatch: { style: {}, firstElementChild: { textContent: "" } },
    packStage: { className: "" }, packStageState: { textContent: "" }, packStatusText: "",
    saveArmory() {}, renderArmory() {}, playPackSound() {},
    packOpenButton: { disabled: false, textContent: "" },
    document: { querySelector: (selector) => fields[selector] },
    window: { AudioContext: null, matchMedia: () => ({ matches: false }) },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    Math
  };
  const open = section("    function openArmoryPack() {", "    function awardMatchPack(matchId) {");
  vm.runInNewContext(`${open}\nglobalThis.open = openArmoryPack;`, context);

  context.open();
  assert.equal(context.packs, 0);
  assert.equal(context.packStage.className, "pack-stage opening");
  assert.equal(context.packStageState.textContent, "AUTHENTICATING");
  assert.equal(context.packOpening, true);
  assert.equal(timers.at(-1).delay, 2250);

  timers.at(-1).callback();
  assert.equal(context.packStage.className, "pack-stage revealed");
  assert.equal(context.packStageState.textContent, "UNLOCKED");
  assert.equal(context.packOpening, false);
  assert.equal(reward.hidden, false);
  assert.equal(fields["#pack-reward-name"].textContent, "Tiger Stripe");
  assert.equal(context.packRewardSwatch.style.backgroundImage, 'url("assets/skin-tiger-stripe.jpg")');
  assert.equal(context.packRewardSwatch.firstElementChild.textContent, "WEAPON CAMO");

  context.packs = 1;
  context.window.matchMedia = () => ({ matches: true });
  timers.length = 0;
  context.open();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 80);
  timers[0].callback();
  assert.equal(context.packOpening, false);
});
