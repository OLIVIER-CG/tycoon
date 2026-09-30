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
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const place = (s, type, x, y) => {
  const r = A.place(s, type, x, y);
  assert.ok(r.ok, `placing ${type} at ${x},${y}: ${r.msg}`);
  return s.items[s.items.length - 1];
};

test('2×2 items take four tiles and must fit inside the office', () => {
  const s = blank(5);
  const N = D.OFFICES[5].size;
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

test('cooling is building-wide: heat above cooling slows every GPU', () => {
  const s = blank(0);
  for (let x = 0; x < 5; x++) for (let y = 0; y < 2; y++) place(s, 'rig', x, y);
  // 10 rigs make 8 kW; the garage alone removes 5 kW
  let v = Sim.derive(s);
  near(v.heat, 8);
  near(v.cooling, 5);
  near(v.thermal, 5 / 8);
  assert.equal(v.hotItems, 10);
  near(v.effPF, 10 * (5 / 8));

  // where the cooler stands does not matter
  place(s, 'ac', 5, 5);
  v = Sim.derive(s);
  near(v.cooling, 13);
  assert.equal(v.thermal, 1);
  assert.equal(v.hotItems, 0);
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
  const s = blank(2);
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

// a lab with a model and some traction, ready to pitch
function pitchable(seed, subs) {
  const s = blank(1, seed);
  s.cash = 500e3;
  s.models.push({ id: 'm1', name: 'Test', size: 'small', cap: 17, appeal: 1, arpu: 1, infer: 1, day: 0 });
  s.flagshipId = 'm1';
  s.rounds = ['preseed'];
  s.subs = subs;
  return s;
}

test('raising is optional: offices only cost money', () => {
  const s = blank(1);
  s.cash = 1e6;
  assert.equal(s.rounds.length, 0);
  assert.equal(A.moveOffice(s).ok, true);
  assert.equal(s.officeLevel, 2);
  s.cash = 10;
  assert.equal(A.moveOffice(s).msg, 'Not enough cash');
});

test('investor interest decides how many offers you get', () => {
  const hot = pitchable(3, 1500);
  assert.equal(Sim.fundingView(hot, Sim.derive(hot)).label, 'Hot');
  assert.equal(A.pitch(hot).ok, true);
  assert.equal(hot.funding.offers.length, 3);
  assert.equal(new Set(hot.funding.offers.map((o) => o.type)).size, 3, 'three different kinds of investor');

  const cold = pitchable(3, 100);
  assert.equal(Sim.fundingView(cold, Sim.derive(cold)).label, 'Cold');
  assert.equal(A.pitch(cold).ok, true);
  assert.equal(cold.funding.offers.length, 0);
  assert.equal(A.pitch(cold).ok, false, 'investors want to wait after passing');
});

test('accepting an offer closes the round and applies its terms', () => {
  const s = pitchable(4, 1500);
  A.pitch(s);
  const o = s.funding.offers.find((x) => x.type === 'bigtech');
  const cash = s.cash;
  assert.equal(A.acceptOffer(s, o.oid).ok, true);
  assert.equal(s.cash, cash + o.raise);
  assert.ok(Math.abs(s.equity - (1 - o.dilution)) < 1e-9);
  assert.deepEqual(s.rounds, ['preseed', 'seed']);
  assert.equal(s.funding.offers.length, 0);
  assert.ok(s.cloud && s.cloud.pf > 0, 'the Big Tech partner throws in cloud compute');
});

test('walking away makes the next offers smaller', () => {
  const s = pitchable(5, 1500);
  const before = Sim.fundingView(s, Sim.derive(s)).mult;
  A.pitch(s);
  assert.equal(A.walkAway(s).ok, true);
  assert.equal(s.funding.offers.length, 0);
  assert.ok(s.funding.last && s.funding.last.declined);
  const after = Sim.fundingView(s, Sim.derive(s));
  assert.ok(after.mult < before, 'investors remember');
  assert.equal(after.canPitch, false);
  s.day += 31;
  assert.equal(Sim.fundingView(s, Sim.derive(s)).canPitch, true);
});

test('pushing for a better price either works or loses that investor', () => {
  let won = 0, lost = 0;
  for (let seed = 10; seed < 40; seed++) {
    const s = pitchable(seed, 1500);
    A.pitch(s);
    const o = s.funding.offers[0];
    const pre = o.pre, dil = o.dilution;
    const r = A.pushOffer(s, o.oid);
    if (r.ok) {
      won++;
      assert.ok(o.pre > pre && o.dilution < dil);
      assert.equal(A.pushOffer(s, o.oid).ok, false, 'only one push per investor');
    } else {
      lost++;
      assert.ok(!s.funding.offers.includes(o));
    }
  }
  assert.ok(won > 0 && lost > 0);
});

test('version 2 saves migrate their single term sheet', () => {
  const s = pitchable(6, 1500);
  const old = JSON.parse(JSON.stringify(s));
  old.v = 2;
  delete old.funding;
  old.roundCd = 12;
  old.offer = { id: 'seed', name: 'Seed', pre: 5e6, raise: 1e6, dilution: 1 / 6, expires: 20 };
  const m = Sim.migrate(old);
  assert.equal(m.v, Sim.VERSION);
  assert.equal(m.offer, undefined);
  assert.equal(m.funding.cd, 12);
  assert.equal(m.funding.offers.length, 1);
  const g = Object.assign(Sim.newGame(), m);
  assert.equal(A.acceptOffer(g, m.funding.offers[0].oid).ok, true);
  assert.ok(g.rounds.includes('seed'));
});

test('the price curve shows what each price would earn', () => {
  const s = pitchable(7, 1500);
  for (let i = 0; i < 6; i++) A.place(s, 'workstation', i, 0);
  const v = Sim.derive(s);
  const curve = Sim.priceCurve(s, v, [5, 20, 60]);
  assert.equal(curve.length, 3);
  assert.ok(curve[0].share > curve[1].share && curve[1].share > curve[2].share, 'cheaper plans win more of the market');
  for (const p of curve) assert.ok(Math.abs(p.revenue - p.subs * p.price * s.models[0].arpu) < 1e-6);
});

test('the next-run helper only suggests a clear step up that finishes within a year', () => {
  const s = pitchable(8, 1500);
  s.cash = 1e12;
  s.officeLevel = 2;
  s.techs.distributed = 1;
  for (let i = 0; i < 30; i++) A.place(s, 'workstation', i % 10, Math.floor(i / 10));
  for (let i = 0; i < 8; i++) A.place(s, 'ac', i, 5);
  const run = Sim.bestNextRun(s, Sim.derive(s));
  assert.ok(run, 'a Medium model is a step up from a score of 17');
  assert.equal(run.size.id, 'medium');
  assert.ok(run.exp >= 17 + 2 && run.days <= 365);
  s.training = { name: 'x' };
  assert.equal(Sim.bestNextRun(s, Sim.derive(s)), null);
});

test('losing an investor at the table counts as a walk-away', () => {
  for (let seed = 50; seed < 90; seed++) {
    const s = pitchable(seed, 1500);
    A.pitch(s);
    const o = s.funding.offers[0];
    if (A.pushOffer(s, o.oid).ok) continue;
    assert.equal(s.funding.walkaways.length, 1);
    return;
  }
  assert.fail('no push failed in 40 tries');
});

test('version 3 saves move onto the seven San Francisco offices', () => {
  const s = blank(1);
  const old = JSON.parse(JSON.stringify(s));
  old.v = 3;
  old.officeLevel = 3; // the old Tech Campus, 18x18
  delete old.products.voice;
  delete old.products.robots;
  old.chapters = {};
  const m = Sim.migrate(old);
  assert.equal(m.v, Sim.VERSION);
  assert.equal(m.officeLevel, 5);
  assert.ok(D.OFFICES[m.officeLevel].size >= 18, 'every item still fits');
  assert.ok(m.products.voice && m.products.robots);
  assert.ok(m.chapters.presidio != null, 'passed chapters are marked seen');
});

test('the run report includes the new fields', () => {
  const s = blank(1);
  const r = AIT.Report.build(s);
  for (const k of ['mode', 'difficulty', 'playMinutes', 'daysWithoutTraining']) assert.ok(k in r, k);
  assert.ok('alignment' in r.final && 'products' in r.final && 'overheatingGpus' in r.final);
});

test('balance: a good bot reaches AGI before the rivals, in the middle of the 2030s', () => {
  const years = [];
  for (let seed = 1004; seed < 1008; seed++) {
    const s = Sim.newGame({ seed });
    const bot = createBot(AIT);
    while (!s.over && s.day < 365 * 25) {
      bot(s);
      Sim.tick(s);
    }
    if (s.over && s.over.win) years.push(s.day / 365);
  }
  assert.ok(years.length >= 3, `the bot won ${years.length} of 4 games`);
  for (const y of years) assert.ok(y > 11 && y < 18, `won in year ${y.toFixed(1)}; expected 11 to 18`);
});
