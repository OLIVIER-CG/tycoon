#!/usr/bin/env node
/* Headless balance check. A bot plays the game many times and reports when it
   hits each milestone. Usage: node tools/simulate.js [runs] [--verbose] [--difficulty=hard] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createBot } = require('./bot');

for (const f of ['data.js', 'flavor.js', 'events.js', 'sim.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const AIT = globalThis.AIT;
const { DATA: D, Sim } = AIT;

const runs = parseInt(process.argv[2], 10) || 20;
const verbose = process.argv.includes('--verbose');
const diffArg = process.argv.find((a) => a.startsWith('--difficulty='));
const difficulty = diffArg ? diffArg.split('=')[1] : 'normal';
const yr = (day) => (day / 365).toFixed(1);
const M = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : n.toFixed(0));

const results = [];
for (let r = 0; r < runs; r++) {
  const s = Sim.newGame({ seed: 1000 + r, difficulty });
  const bot = createBot(AIT);
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
    console.log(events.filter((e) => !/ train (Tiny|Small|Medium|Large|Ultra) /.test(e)).join('\n'));
    for (const h of s.history.filter((_, i) => i % 6 === 5)) console.log(`${h.label}: cash ${M(h.cash)} rev ${M(h.revenue)} costs ${M(h.costs)} capex ${M(h.capex)} subs ${M(h.subs)} val ${M(h.valuation)}`);
  }
  const res = s.over ? (s.over.win ? 'WIN ' : 'LOSE') : 'TIME';
  console.log(`run ${r + 1}: ${res} y${yr(s.day)} | ${s.over ? s.over.ending || s.over.text.slice(0, 50) : ''} | office ${s.officeLevel} staff ${s.staff.length} best ${v.bestCap.toFixed(1)} rival ${v.topRival.cap} subs ${M(s.subs)} align ${v.alignment.total} hot ${v.hotItems}/${v.computeItems} idle ${Math.round((100 * (s.stats.idleDays || 0)) / s.day)}%`);
}

console.log('\nMedian year each goal was reached:');
for (const g of D.GOALS) {
  const days = results.map((r) => r.marks[g.id]).filter((d) => d != null).sort((a, b) => a - b);
  const med = days.length ? yr(days[Math.floor(days.length / 2)]) : '-';
  console.log(`  ${g.text.padEnd(40)} ${String(med).padStart(5)}  (${days.length}/${runs})`);
}
const wins = results.filter((r) => r.s.over && r.s.over.win);
const winYears = wins.map((r) => r.s.day / 365).sort((a, b) => a - b);
console.log(`\nWins: ${wins.length}/${runs}${winYears.length ? ` · median win year ${winYears[Math.floor(winYears.length / 2)].toFixed(1)}` : ''}`);
