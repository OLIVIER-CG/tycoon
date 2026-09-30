#!/usr/bin/env node
/* Summarizes many run reports (the JSON from "Send this run to Claude").
   Usage: node tools/analyze-runs.js <file-or-folder> [...]
   Each file can hold one report, an array of reports, or one report per line. */
const fs = require('fs');
const path = require('path');

function readReports(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).flatMap((f) => readReports(path.join(p, f)));
  if (!/\.(json|jsonl|txt)$/i.test(p)) return [];
  const text = fs.readFileSync(p, 'utf8').trim();
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
}

const median = (xs) => {
  const a = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '-');
const fmt = (x, dp = 1) => (x == null ? '-' : Number(x).toFixed(dp));

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Usage: node tools/analyze-runs.js <file-or-folder> [...]');
  process.exit(1);
}
const seen = new Set();
const runs = args.flatMap(readReports).filter((r) => r && r.final && !seen.has(r.id) && seen.add(r.id));
if (!runs.length) {
  console.log('No run reports found.');
  process.exit(1);
}

const finished = runs.filter((r) => r.result);
const wins = finished.filter((r) => r.result.win);
const reasons = {};
for (const r of finished.filter((x) => !x.result.win)) {
  const why = /money/i.test(r.result.text) ? 'ran out of money' : /AGI first/i.test(r.result.text) ? 'a rival reached AGI' : 'other';
  reasons[why] = (reasons[why] || 0) + 1;
}
const endings = {};
for (const r of wins) endings[r.result.ending || 'unknown'] = (endings[r.result.ending || 'unknown'] || 0) + 1;
const by = (key) => {
  const out = {};
  for (const r of runs) out[r[key] || 'not recorded'] = (out[r[key] || 'not recorded'] || 0) + 1;
  return Object.entries(out).map(([k, n]) => `${k} ${n}`).join(', ');
};

console.log(`${runs.length} runs (${finished.length} finished, ${runs.length - finished.length} still going)`);
console.log(`Modes: ${by('mode')} · Difficulty: ${by('difficulty')}`);
console.log(`Wins: ${wins.length} of ${finished.length} finished (${pct(wins.length, finished.length)})`);
if (Object.keys(reasons).length) console.log(`Losses: ${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (wins.length) console.log(`Endings: ${Object.entries(endings).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log('');
console.log(`Median in-game years:      ${fmt(median(runs.map((r) => r.yearsPlayed)))}`);
console.log(`Median minutes played:     ${fmt(median(runs.map((r) => r.playMinutes)), 0)}`);
console.log(`Median best OmniBench:     ${fmt(median(runs.map((r) => r.final.bestScore)))}`);
console.log(`Median final office:       ${median(runs.map((r) => ['Garage', 'Downtown Loft', 'Office Floor', 'Tech Campus', 'Hyperscale Campus'].indexOf(r.final.office)))} (0 = garage, 4 = hyperscale)`);

// where people get stuck: the last goal each run reached
const lastGoal = {};
for (const r of runs) {
  const goals = (r.timeline || []).filter((e) => e.what.startsWith('goal: '));
  const g = goals.length ? goals[goals.length - 1].what.slice(6) : '(none)';
  lastGoal[g] = (lastGoal[g] || 0) + 1;
}
console.log('\nLast goal reached:');
for (const [g, n] of Object.entries(lastGoal).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${g}`);

// common trouble signs
const signs = [
  ['went broke at some point', (r) => r.final.daysWithNegativeCash > 0 || (r.monthly || []).some((m) => m.cash < 0)],
  ['GPUs idle 90+ days', (r) => (r.daysWithoutTraining || 0) >= 90],
  ['overheating GPUs at the end', (r) => (r.final.overheatingGpus || 0) > 0],
  ['never hired a safety person', (r) => !(r.final.staff || []).some((p) => p.role === 'safety')],
  ['no whiteboard near any researcher', (r) => r.final.researchersNearWhiteboardPct === 0],
  ['never launched a product', (r) => (r.final.products || []).length && !(r.final.products || []).some((p) => p.live)],
  ['payroll above revenue at the end', (r) => r.final.payroll > r.final.monthlyRevenue],
  ['tutorial not finished', (r) => r.mentor && !r.mentor.tutorialDone],
];
console.log('\nTrouble signs:');
for (const [label, f] of signs) {
  const n = runs.filter((r) => {
    try {
      return f(r);
    } catch (e) {
      return false;
    }
  }).length;
  console.log(`  ${pct(n, runs.length).padStart(4)}  ${label}`);
}

// research order: which technologies players take first
const firsts = {};
for (const r of runs) {
  const techs = (r.timeline || []).filter((e) => e.what.startsWith('research: ')).slice(0, 5).map((e) => e.what.slice(10));
  techs.forEach((t, i) => (firsts[t] = (firsts[t] || 0) + (5 - i)));
}
const top = Object.entries(firsts).sort((a, b) => b[1] - a[1]).slice(0, 6);
if (top.length) console.log(`\nEarly research favorites: ${top.map(([t]) => t).join(', ')}`);
