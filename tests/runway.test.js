const test = require('node:test');
const assert = require('node:assert/strict');
const AIT = require('./load');
const { DATA: D, Sim } = AIT;
const A = Sim.actions;
const RW = D.RUNWAY;

// a runway game with nothing earning, so tests set the revenue themselves
function runway(seed = 1) {
  const s = Sim.newGame({ seed, mode: 'runway' });
  s.cash = 1e6;
  return s;
}
// run the clock until the quarter ends (the board meeting opens)
function toMeeting(s) {
  for (let i = 0; i < RW.quarterDays + 1 && !s.runway.meeting && !s.over; i++) Sim.tick(s);
  return s.runway.meeting;
}

test('runway: a game starts in Q1 on normal difficulty with the first quota', () => {
  const s = Sim.newGame({ seed: 3, mode: 'runway', difficulty: 'hard' });
  assert.equal(s.difficulty, 'normal');
  assert.deepEqual([s.runway.q, s.runway.strikes, s.runway.booked], [1, 0, 0]);
  const v = Sim.quarterView(s);
  assert.equal(v.quota, RW.quotas[0]);
  assert.equal(v.left, RW.quarterDays);
  assert.equal(Sim.newGame({ seed: 3 }).runway, undefined);
});

test('runway: quotas follow the table, then grow every quarter in endless mode', () => {
  RW.quotas.forEach((q, i) => assert.equal(Sim.quotaFor(i + 1), q));
  assert.equal(Sim.quotaFor(RW.quotas.length + 1), Math.round(RW.quotas.at(-1) * RW.endlessGrowth));
  assert.ok(Sim.quotaFor(RW.quotas.length + 2) > Sim.quotaFor(RW.quotas.length + 1));
});

test('runway: revenue from subscribers is booked against the quarter', () => {
  const s = runway();
  s.runway.booked = 0;
  // a live model with paying subscribers
  A.startTraining(s, 'tiny', { licensed: true });
  for (let i = 0; i < 85 && !s.models.length; i++) Sim.tick(s);
  A.deploy(s, s.models[0].id);
  s.subs = 1000;
  const before = s.runway.booked;
  const v = Sim.derive(s);
  Sim.tick(s);
  assert.ok(s.runway.booked > before, 'nothing was booked');
  assert.ok(Math.abs(s.runway.booked - before - v.subRevenue / 30) < v.subRevenue / 30 * 0.2);
});

test('runway: the quarter ends on day 91 and the clock waits for the board', () => {
  const s = runway();
  const m = toMeeting(s);
  assert.ok(m, 'no board meeting');
  assert.equal(m.q, 1);
  assert.equal(m.how, 'clock');
  assert.equal(s.day, RW.quarterDays);
  const day = s.day;
  Sim.tick(s);
  assert.equal(s.day, day, 'time passed during the meeting');
  assert.ok(A.closeMeeting(s).ok);
  assert.equal(s.runway.q, 2);
  assert.equal(s.runway.start, day);
  Sim.tick(s);
  assert.equal(s.day, day + 1);
});

test('runway: a first miss is a down round, a second gets you fired', () => {
  const s = runway();
  const m1 = toMeeting(s);
  assert.equal(m1.hit, false);
  assert.equal(s.runway.strikes, 1);
  assert.ok(Math.abs(s.equity - (1 - RW.downRound)) < 1e-9);
  assert.equal(s.over, null);
  A.closeMeeting(s);
  const m2 = toMeeting(s);
  assert.equal(m2.end, 'fired');
  assert.ok(s.over && !s.over.win);
  assert.equal(s.over.ending, 'runway');
});

test('runway: hitting the quota keeps the slate clean, and the bell ends a quarter early', () => {
  const s = runway();
  assert.equal(A.ringBell(s).ok, false, 'the bell rang before the quota was met');
  for (let i = 0; i < 20; i++) Sim.tick(s);
  s.runway.booked = RW.quotas[0] + 1;
  assert.ok(A.ringBell(s).ok);
  const m = s.runway.meeting;
  assert.deepEqual([m.hit, m.how, m.left, s.runway.strikes], [true, 'bell', RW.quarterDays - 20, 0]);
  assert.equal(s.equity, 1);
  assert.equal(A.ringBell(s).ok, false, 'rang twice');
});

test('runway: ending a quarter with negative cash ends the run', () => {
  const s = runway();
  s.cash = -5000;
  const m = toMeeting(s);
  assert.equal(m.end, 'broke');
  assert.ok(s.over && !s.over.win);
});

test('runway: clearing Q8 offers an IPO or endless quarters', () => {
  const s = runway();
  s.runway.q = RW.quotas.length;
  s.runway.booked = RW.quotas.at(-1);
  A.ringBell(s);
  assert.equal(s.runway.meeting.ipo, true);
  A.closeMeeting(s, 'ipo');
  assert.ok(s.over && s.over.win);
  assert.equal(s.over.ending, 'ipo');
  assert.equal(Sim.runwayCleared(s), 1);

  const e = runway();
  e.runway.q = RW.quotas.length;
  e.runway.booked = RW.quotas.at(-1);
  A.ringBell(e);
  A.closeMeeting(e, 'endless');
  assert.equal(e.over, null);
  assert.equal(e.runway.endless, true);
  assert.equal(Sim.quarterView(e).quota, Sim.quotaFor(RW.quotas.length + 1));
});

test('runway: the same seed plays out the same quarters', () => {
  const play = () => {
    const s = Sim.newGame({ seed: 42, mode: 'runway' });
    const out = [];
    for (let i = 0; i < 400 && !s.over; i++) {
      if (s.runway.meeting) {
        out.push(`${s.runway.meeting.q}:${s.runway.meeting.booked}`);
        A.closeMeeting(s);
      }
      Sim.tick(s);
    }
    return out.join(',') + '|' + s.day + '|' + Math.round(s.cash);
  };
  assert.equal(play(), play());
});
