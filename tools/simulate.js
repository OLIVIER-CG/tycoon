#!/usr/bin/env node
/* Headless balance check. A simple bot plays the game many times and reports
   when it hits each milestone. Usage: node tools/simulate.js [runs] [--verbose] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['data.js', 'flavor.js', 'events.js', 'sim.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const { DATA: D, Sim } = globalThis.AIT;
const A = Sim.actions;

const runs = parseInt(process.argv[2], 10) || 20;
const verbose = process.argv.includes('--verbose');
const yr = (day) => (day / 365).toFixed(1);
const M = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : n.toFixed(0));

const COMPUTE = ['rig', 'workstation', 'server', 'rack', 'superpod', 'wafer'];
const COOLING = ['fan', 'ac', 'chiller', 'liquid', 'immersion'];
const POWER = ['battery', 'substation', 'turbine', 'smr'];
const STAFF_TARGET = [3, 8, 20, 40, 70];
const TECH_PRIORITY = ['scaling_laws', 'flash_attention', 'rlhf', 'distributed', 'quantization', 'code_models', 'synthetic_data', 'moe', 'long_context', 'liquid_cooling', 'distillation', 'constitutional', 'multimodal', 'custom_silicon', 'frontier_scaling', 'reasoning', 'speculative', 'agents', 'immersion', 'interpretability', 'ultrascale', 'wafer_scale', 'nuclear', 'self_improvement', 'agi_theory', 'data_flywheel'];

function freeTile(s) {
  const n = D.OFFICES[s.officeLevel].size;
  const taken = new Set(s.items.map((i) => i.x + ',' + i.y));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!taken.has(x + ',' + y)) return [x, y];
  return null;
}

function place(s, type) {
  let t = freeTile(s);
  if (!t) {
    // make room by selling the weakest compute item
    const weak = s.items.filter((i) => COMPUTE.includes(i.type)).sort((a, b) => COMPUTE.indexOf(a.type) - COMPUTE.indexOf(b.type))[0];
    if (!weak || COMPUTE.indexOf(weak.type) >= COMPUTE.indexOf(type)) return false;
    A.sell(s, weak.id);
    t = freeTile(s);
  }
  return A.place(s, type, t[0], t[1]).ok;
}

const best = (s, list) => list.filter((t) => !Sim.itemLocked(s, t)).slice(-1)[0];

function bot(s, log) {
  // events
  while (s.events.length) {
    const { id, params } = s.events[0];
    const choice = { data_deal: params.cost < s.cash * 0.2 ? 0 : 1 }[id] || 0;
    Sim.resolveEvent(s, choice);
  }
  let v = Sim.derive(s);

  // research
  for (const id of TECH_PRIORITY) {
    const t = D.TECH_BY_ID[id];
    if (s.techs[id] || !t.req.every((r) => s.techs[r])) continue;
    if (s.rp >= t.cost) { A.research(s, id); log(`research ${t.name}`); }
    break;
  }

  // deploy best model
  const top = s.models.slice().sort((a, b) => b.cap - a.cap)[0];
  if (top && top.id !== s.flagshipId) { A.deploy(s, top.id); log(`deploy ${top.name} cap ${top.cap}`); }

  // training
  if (!s.training) {
    const sizes = D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech]).reverse();
    for (const size of sizes) {
      const rate = Math.max(0.01, (v.effPF - v.need * 1.15) * v.trainMult);
      const days = size.pfdays / rate;
      const flagCap = v.flagship ? v.flagship.cap : 0;
      if (size.id === 'agi') {
        // the final run is worth degrading service for
        if (s.cash < size.fixedCost * 1.2) continue;
        A.setAlloc(s, false, 0.75);
        A.startTraining(s, 'agi', {});
        log('train AGI Project');
        break;
      }
      if (days > 150) continue;
      const data = {};
      for (const src of D.DATA_SOURCES) data[src.id] = (!src.tech || s.techs[src.tech]) && s.cash > size.data[src.id] * 6;
      if (Sim.expectedCap(s, size.id, data, v) < flagCap + 2) break;
      const cost = Sim.trainingCost(s, size.id, data);
      if (cost > s.cash * 0.5) continue;
      const r = A.startTraining(s, size.id, data);
      if (r.ok) log(`train ${size.name} (${days.toFixed(0)}d)`);
      break;
    }
  }

  // funding
  if (s.offer) { log(`raise ${s.offer.name} ${M(s.offer.raise)} @ ${M(s.offer.pre)}`); A.acceptOffer(s); }
  else if (D.ROUNDS[s.rounds.length] && D.ROUNDS[s.rounds.length].req(s, v)) A.pitch(s);

  v = Sim.derive(s);
  const reserve = v.burnMonth * 4 + 5000;

  // office move
  const next = D.OFFICES[s.officeLevel + 1];
  if (next && s.cash > next.moveCost + reserve + next.rent * 6 && v.power > v.office.power * 0.6) {
    A.moveOffice(s); log(`move to ${next.name}`);
  }

  // desks & staff
  if (s.staff.length < STAFF_TARGET[s.officeLevel] && s.cash > reserve * 1.5) {
    if (v.seats <= s.staff.length) place(s, 'desk');
    const need = { researcher: 0.4, engineer: 0.35, growth: 0.15, safety: 0.1 };
    const have = {};
    for (const p of s.staff) have[p.role] = (have[p.role] || 0) + 1;
    const cand = s.candidates.slice().sort((a, b) => (need[b.role] * s.staff.length - (have[b.role] || 0)) - (need[a.role] * s.staff.length - (have[a.role] || 0)) || b.skill - a.skill)[0];
    if (cand && s.cash > cand.salary * 8) A.hire(s, cand.id);
  }
  if (v.decor < s.staff.length * 2.2 && s.cash > reserve) place(s, s.officeLevel >= 1 ? 'coffee' : 'plant');
  if (s.officeLevel >= 1 && v.boards < 10 && s.cash > reserve * 2) place(s, 'whiteboard');

  // cooling & power
  v = Sim.derive(s);
  if (v.heat > v.cooling * 0.9) {
    const c = best(s, COOLING);
    if (s.cash > Sim.itemCost(s, c)) place(s, c);
  }
  if (v.power > v.powerCap * 0.92) {
    const p = best(s, POWER);
    if (p && s.cash > Sim.itemCost(s, p) + reserve) place(s, p);
  }

  // compute
  for (let i = 0; i < 20; i++) {
    v = Sim.derive(s);
    const c = best(s, COMPUTE);
    const d = D.ITEMS[c];
    const cost = Sim.itemCost(s, c);
    if (s.cash < cost + reserve) break;
    if (v.power + d.power > v.powerCap) break;
    if (v.heat + d.power > v.cooling) {
      const cl = best(s, COOLING);
      if (!place(s, cl)) break;
      continue;
    }
    if (!place(s, c)) break;
  }

  // marketing
  if ((s.campaignCd.thread || 0) <= s.day) A.campaign(s, 'thread');
  for (const c of D.CAMPAIGNS.slice(1)) if ((s.campaignCd[c.id] || 0) <= s.day && s.cash > c.cost * 30) A.campaign(s, c.id);
}

const results = [];
for (let r = 0; r < runs; r++) {
  const s = Sim.newGame();
  const events = [];
  const log = (t) => events.push(`y${yr(s.day)} ${t}`);
  const marks = {};
  while (!s.over && s.day < 365 * 12) {
    bot(s, log);
    Sim.tick(s);
    for (const g of D.GOALS) if (s.goals[g.id] && !marks[g.id]) marks[g.id] = s.day;
  }
  const v = Sim.derive(s);
  results.push({ s, marks, v });
  if (verbose && r === 0) {
    console.log(events.join('\n'));
    for (const h of s.history.filter((_, i) => i % 6 === 5)) console.log(`${h.label}: cash ${M(h.cash)} rev ${M(h.revenue)} costs ${M(h.costs)} capex ${M(h.capex)} subs ${M(h.subs)} val ${M(h.valuation)}`);
  }
  console.log(`run ${r + 1}: ${s.over ? (s.over.win ? 'WIN ' : 'LOSE') : 'TIME'} y${yr(s.day)} | ${s.over ? s.over.text : ''} | office ${s.officeLevel} staff ${s.staff.length} best ${v.bestCap.toFixed(1)} rival ${v.topRival.cap} subs ${M(s.subs)} equity ${(s.equity * 100).toFixed(1)}% val ${M(v.valuation)}`);
}

console.log('\nMedian year each goal was reached:');
for (const g of D.GOALS) {
  const days = results.map((r) => r.marks[g.id]).filter((d) => d != null).sort((a, b) => a - b);
  const med = days.length ? yr(days[Math.floor(days.length / 2)]) : '-';
  console.log(`  ${g.text.padEnd(40)} ${String(med).padStart(5)}  (${days.length}/${runs})`);
}
const wins = results.filter((r) => r.s.over && r.s.over.win).length;
console.log(`\nWins: ${wins}/${runs}`);
