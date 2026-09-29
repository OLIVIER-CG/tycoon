const test = require('node:test');
const assert = require('node:assert/strict');
const AIT = require('./load');
const { createBot } = require('../tools/bot');
const { DATA: D, Sim } = AIT;
const A = Sim.actions;

// an empty office with plenty of money, so tests only see what they place
function blank(level = 0, seed = 1) {
  const s = Sim.newGame({ seed });
  s.items = [];
  s.cash = 1e12;
  s.officeLevel = level;
  return s;
}
const place = (s, type, x, y) => {
  const r = A.place(s, type, x, y);
  assert.ok(r.ok, `placing ${type} at ${x},${y}: ${r.msg}`);
  return s.items[s.items.length - 1];
};

test('2×2 items take four tiles and must fit inside the office', () => {
  const s = blank(3);
  const N = D.OFFICES[3].size;
  assert.equal(Sim.canPlace(s, 'turbine', N - 1, 0), 'Outside the office');
  const t = place(s, 'turbine', 2, 2);
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) assert.equal(Sim.itemAt(s, x, y), t);
  assert.equal(Sim.itemAt(s, 4, 2), null);
  assert.equal(Sim.canPlace(s, 'desk', 3, 3), 'That tile is taken');
  assert.equal(Sim.canPlace(s, 'turbine', 1, 1), 'That tile is taken');
  assert.equal(Sim.canPlace(s, 'turbine', 4, 2), null);
});

test('gap measures tiles between footprints', () => {
  const big = { type: 'turbine', x: 2, y: 2 };
  assert.equal(Sim.gap(big, { type: 'desk', x: 4, y: 3 }), 1);
  assert.equal(Sim.gap(big, { type: 'desk', x: 6, y: 6 }), 3);
  assert.equal(Sim.gap(big, { type: 'desk', x: 3, y: 3 }), 0);
});

test('coolers only cool GPUs within their reach', () => {
  const s = blank(0);
  for (let x = 0; x < 5; x++) for (let y = 0; y < 2; y++) place(s, 'rig', x, y);
  // 10 rigs make 8 kW; the garage alone removes 5 kW
  let v = Sim.derive(s);
  assert.equal(v.hotItems, 10);
  assert.ok(v.thermal < 0.7);

  const far = place(s, 'ac', 5, 5);
  v = Sim.derive(s);
  assert.equal(v.coolers.get(far.id).gpus, 0, 'an AC four rows away reaches nothing');
  assert.equal(v.hotItems, 10);

  A.sell(s, far.id);
  const near = place(s, 'ac', 2, 2);
  v = Sim.derive(s);
  assert.equal(v.coolers.get(near.id).gpus, 10);
  assert.equal(v.hotItems, 0);
  assert.equal(v.thermal, 1);
});

test('a cooler is shared by every GPU in its reach', () => {
  const s = blank(1);
  place(s, 'fan', 0, 0);
  place(s, 'workstation', 1, 0);
  let v = Sim.derive(s);
  const one = v.itemHeat.get(s.items[1].id);
  for (let i = 0; i < 12; i++) place(s, 'workstation', 1 + (i % 4), 1 + Math.floor(i / 4));
  v = Sim.derive(s);
  assert.ok(v.itemHeat.get(s.items[1].id) < one, 'more GPUs nearby means less cooling each');
});

test('whiteboards help researchers within 2 tiles of their desk', () => {
  const s = blank(1);
  place(s, 'desk', 0, 0); // the founder, a researcher, sits here
  place(s, 'whiteboard', 2, 0);
  let v = Sim.derive(s);
  assert.equal(v.seatInfo.get('founder').board, 0.08);
  place(s, 'whiteboard', 5, 5);
  v = Sim.derive(s);
  assert.equal(v.seatInfo.get('founder').board, 0.08, 'a board far away adds nothing');
  const rpBefore = v.rpStaff;
  place(s, 'whiteboard', 0, 2);
  v = Sim.derive(s);
  assert.equal(v.seatInfo.get('founder').board, 0.16);
  assert.ok(v.rpStaff > rpBefore);
});

test('comfort items only count for desks within 3 tiles', () => {
  const s = blank(1);
  place(s, 'desk', 0, 0);
  place(s, 'coffee', 3, 0);
  let v = Sim.derive(s);
  assert.equal(v.seatInfo.get('founder').comfort, 16);
  place(s, 'arcade', 8, 8);
  v = Sim.derive(s);
  assert.equal(v.seatInfo.get('founder').comfort, 16);
});

test('version 1 saves migrate: old 2×2 items become quarter-size legacy items', () => {
  const s = blank(3);
  const old = JSON.parse(JSON.stringify(s));
  old.v = 1;
  delete old.products;
  delete old.mode;
  delete old.difficulty;
  delete old.playMs;
  old.items = [{ id: 1, type: 'superpod', x: 0, y: 0 }, { id: 2, type: 'rack', x: 1, y: 0 }];
  const m = Sim.migrate(old);
  assert.equal(m.v, Sim.VERSION);
  assert.equal(m.items[0].legacy, true);
  assert.equal(m.items[1].legacy, undefined);
  assert.equal(Sim.sizeOf(m.items[0]), 1);
  assert.equal(Sim.stat(m.items[0], 'pf'), D.ITEMS.superpod.pf / 4);
  assert.deepEqual(Object.keys(m.products), D.PRODUCTS.map((p) => p.id));
  assert.equal(m.mode, 'standard');
  assert.equal(m.difficulty, 'normal');
  const v = Sim.derive(Object.assign(Sim.newGame(), m));
  assert.equal(v.pf, D.ITEMS.superpod.pf / 4 + D.ITEMS.rack.pf);
});

test('the same seed plays out the same way', () => {
  const run = () => {
    const s = Sim.newGame({ seed: 20260101, mode: 'daily' });
    const bot = createBot(AIT);
    while (s.day < 400 && !s.over) {
      bot(s);
      Sim.tick(s);
    }
    return JSON.stringify({ cash: s.cash, subs: s.subs, rivals: s.rivals, models: s.models.map((m) => m.cap), staff: s.staff.map((p) => [p.role, p.skill, p.salary]) });
  };
  assert.equal(run(), run());
});

test('products need their research and a live model, then earn money', () => {
  const s = blank(2);
  assert.equal(A.launchProduct(s, 'api').ok, false);
  s.techs.code_models = 1;
  assert.equal(A.launchProduct(s, 'api').ok, false, 'no model deployed yet');
  s.models.push({ id: 'm1', name: 'Test', size: 'medium', cap: 40, appeal: 1, arpu: 1, infer: 1, day: 0 });
  s.flagshipId = 'm1';
  const cash = s.cash;
  assert.equal(A.launchProduct(s, 'api').ok, true);
  assert.equal(s.cash, cash - D.PRODUCTS[0].launch);
  for (let i = 0; i < 60; i++) Sim.tick(s);
  const v = Sim.derive(s);
  assert.ok(v.products.api.users > 0);
  assert.ok(v.products.api.revenue > 0);
  assert.equal(A.setProductPrice(s, 'api', 99999).ok, true);
  assert.equal(s.products.api.price, D.PRODUCTS[0].maxPrice);
});

test('alignment decides the ending', () => {
  const s = blank(2);
  let a = Sim.alignment(s, Sim.derive(s));
  assert.equal(a.ending, 'reckless');
  Object.assign(s.techs, { rlhf: 1, constitutional: 1, interpretability: 1 });
  a = Sim.alignment(s, Sim.derive(s));
  assert.equal(a.ending, 'uneasy');
  Sim.align(s, 30);
  a = Sim.alignment(s, Sim.derive(s));
  assert.equal(a.ending, 'aligned');
  Sim.align(s, 999);
  assert.equal(s.flags.align, 30, 'choices are capped');
});

test('harder difficulty speeds rivals up', () => {
  const progress = (difficulty) => {
    const s = Sim.newGame({ seed: 7, difficulty });
    for (let i = 0; i < 365; i++) Sim.tick(s);
    return s.rivals.reduce((a, r) => a + r.progress, 0);
  };
  const [relaxed, normal, hard] = ['relaxed', 'normal', 'hard'].map(progress);
  assert.ok(relaxed < normal && normal < hard);
  assert.equal(Sim.newGame({ difficulty: 'hard' }).cash, D.DIFFICULTY.hard.cash);
  assert.equal(Sim.newGame({ mode: 'sandbox' }).cash, 10e6);
});

test('the run report includes the new fields', () => {
  const s = blank(1);
  const r = AIT.Report.build(s);
  for (const k of ['mode', 'difficulty', 'playMinutes', 'daysWithoutTraining']) assert.ok(k in r, k);
  assert.ok('alignment' in r.final && 'products' in r.final && 'overheatingGpus' in r.final);
});

test('balance: a good bot reaches AGI before the rivals', () => {
  const s = Sim.newGame({ seed: 1000 });
  const bot = createBot(AIT);
  while (!s.over && s.day < 365 * 10) {
    bot(s);
    Sim.tick(s);
  }
  assert.ok(s.over && s.over.win, s.over ? s.over.text : 'still playing after 10 years');
  const years = s.day / 365;
  assert.ok(years > 5 && years < 8.5, `won in year ${years.toFixed(1)}; expected 5 to 8.5`);
});
