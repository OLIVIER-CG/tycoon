/* Game state and the daily simulation. No DOM access, so it also runs in Node
   (see tools/simulate.js). */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA;

  const DAY_MS = 86400000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sat = (x, k) => 1 - Math.exp(-x / k);
  const round1 = (x) => Math.round(x * 10) / 10;
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
  const RIVAL_BY_ID = Object.fromEntries(D.RIVALS.map((r) => [r.id, r]));

  const hooks = { toast: null, month: null, over: null };

  const dateOf = (day) => new Date(D.START_DATE + day * DAY_MS);
  const monthKey = (day) => {
    const d = dateOf(day);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const emptyMonth = () => ({ rev: 0, crev: 0, salaries: 0, rent: 0, power: 0, marketing: 0, capex: 0, data: 0, other: 0, funding: 0 });

  function news(s, text, kind = 'info', toast = false) {
    s.news.unshift({ day: s.day, text, kind });
    if (s.news.length > 80) s.news.length = 80;
    if (toast && hooks.toast) hooks.toast(text, kind);
  }

  function addItem(s, type, x, y) {
    const it = { id: s.nextId++, type, x, y };
    s.items.push(it);
    return it;
  }

  function newGame(opts = {}) {
    const s = {
      v: 1,
      company: opts.company || 'Nimbus Labs',
      family: opts.family || 'Nova',
      day: 0,
      cash: 75000,
      equity: 1,
      officeLevel: 0,
      items: [],
      nextId: 1,
      staff: [],
      candidates: [],
      candidatesDay: 0,
      rp: 0,
      techs: {},
      models: [],
      flagshipId: null,
      training: null,
      modelCounter: 0,
      autoAlloc: true,
      allocTrain: 0.8,
      price: 20,
      subs: 0,
      share: 0,
      targetSubs: 0,
      hype: 5,
      sentiment: 1,
      rivals: D.RIVALS.map((r) => ({
        id: r.id, cap: r.cap0, version: Math.max(1, Math.round(r.cap0 / 9)), progress: 0,
        nextRelease: randi(40, 150), hype: 45,
      })),
      effects: [],
      contracts: [],
      cloud: null,
      campaignCd: {},
      rounds: [],
      roundCd: 0,
      offer: null,
      history: [],
      month: emptyMonth(),
      monthKey: monthKey(0),
      goals: {},
      news: [],
      events: [],
      eventCd: {},
      flags: {},
      stats: { negDays: 0, peakSubs: 0, peakMrr: 0 },
      over: null,
    };
    addItem(s, 'desk', 2, 3);
    addItem(s, 'rig', 4, 1);
    addItem(s, 'fan', 5, 1);
    addItem(s, 'plant', 0, 5);
    s.staff.push({ id: 'founder', name: opts.founder || 'You', role: 'researcher', skill: 3, salary: 0, morale: 100, founder: true, trainUntil: 0, perk: 0 });
    refreshCandidates(s);
    news(s, `${s.company} opens for business in a garage. The AI boom is just getting started.`, 'good');
    return s;
  }

  // ---------- modifiers ----------

  function effectMult(s, kind) {
    let m = 1;
    for (const e of s.effects) if (e.kind === kind && e.until > s.day) m *= e.mult;
    return m;
  }

  function addEffect(s, kind, mult, days, label) {
    s.effects.push({ kind, mult, until: s.day + days, label });
  }

  function techTotals(s) {
    const t = { train: 0, infer: 0, appeal: 0, cap: 0, arpu: 0, safety: 1 };
    for (const tech of D.TECHS) {
      if (!s.techs[tech.id]) continue;
      t.train += tech.train || 0;
      t.infer += tech.infer || 0;
      t.appeal += tech.appeal || 0;
      t.cap += tech.cap || 0;
      t.arpu += tech.arpu || 0;
      if (tech.safety) t.safety *= 1 - tech.safety;
    }
    return t;
  }

  const flagship = (s) => s.models.find((m) => m.id === s.flagshipId) || null;
  const bestCap = (s) => s.models.reduce((a, m) => Math.max(a, m.cap), 0);
  const topRival = (s, includeOpen = true) =>
    s.rivals.reduce((best, r) => (!includeOpen && RIVAL_BY_ID[r.id].open) || (best && best.cap >= r.cap) ? best : r, null);

  function marketSize(s) {
    const yr = s.day / 365;
    return Math.min(2.5e9, 40000 * Math.exp(1.15 * yr)) * Math.sqrt(s.sentiment) * effectMult(s, 'market');
  }

  function attract(cap, appeal, hype, priceF, service, brand) {
    return Math.pow(Math.max(cap, 0.1) / 10, 3.2) * appeal * (0.6 + (0.8 * hype) / 100) * priceF * service * brand;
  }

  const rivalAppeal = (s) => 1 + Math.min(0.8, (s.day / 365) * 0.1);

  // Wages climb over time as the talent war heats up.
  function salaryFor(role, skill, sentiment = 1, day = 0) {
    const war = 1 + (day / 365) * 0.12;
    return Math.round((D.ROLES[role].base * Math.pow(skill, 1.7) * (0.85 + 0.25 * sentiment) * war) / 100) * 100;
  }

  function itemCost(s, type) {
    const d = D.ITEMS[type];
    return Math.round(d.cost * (d.cat === 'compute' ? effectMult(s, 'hwPrice') : 1));
  }

  function itemLocked(s, type) {
    const d = D.ITEMS[type];
    if (d.tech && !s.techs[d.tech]) return `Research ${D.TECH_BY_ID[d.tech].name}`;
    if (d.minOffice && s.officeLevel < d.minOffice) return `Needs ${D.OFFICES[d.minOffice].name}`;
    return null;
  }

  // ---------- derived numbers ----------

  function derive(s) {
    const office = D.OFFICES[s.officeLevel];
    const v = { office, pf: 0, power: 0, powerCap: office.power, cooling: office.cooling, heat: 0, seats: 0, decor: 0, boards: 0, counts: {}, hwValue: 0 };
    for (const it of s.items) {
      const d = D.ITEMS[it.type];
      v.counts[it.type] = (v.counts[it.type] || 0) + 1;
      v.pf += d.pf || 0;
      v.power += d.power || 0;
      v.powerCap += d.powerCap || 0;
      v.cooling += d.cooling || 0;
      if (!d.cooling) v.heat += d.power || 0;
      v.seats += d.seats || 0;
      v.decor += d.decor || 0;
      if (d.rpBonus) v.boards++;
      v.hwValue += d.cost * 0.5;
    }
    v.cooling *= effectMult(s, 'cooling');
    v.powerFactor = v.power > v.powerCap ? v.powerCap / v.power : 1;
    const heatNow = v.heat * v.powerFactor;
    v.thermal = heatNow > v.cooling ? Math.max(0.3, v.cooling / heatNow) : 1;
    v.cloudPF = s.cloud && s.cloud.until > s.day ? s.cloud.pf : 0;
    v.computeMult = effectMult(s, 'compute');
    v.effPF = v.pf * v.powerFactor * v.thermal * v.computeMult + v.cloudPF;

    let R = 0, E = 0, G = 0, S = 0, rpStaff = 0, payroll = 0;
    for (const p of s.staff) {
      payroll += p.salary;
      if (p.trainUntil > s.day) continue;
      const prod = 0.7 + (0.5 * p.morale) / 100;
      const k = p.skill * prod;
      if (p.role === 'researcher') {
        R += k;
        rpStaff += Math.pow(p.skill, 1.25) * 0.3 * prod;
      } else if (p.role === 'engineer') E += k;
      else if (p.role === 'growth') G += k;
      else S += k;
    }
    Object.assign(v, { R, E, G, S, payroll, staffCount: s.staff.length });

    const t = techTotals(s);
    v.tech = t;
    v.trainMult = (1 + 0.6 * sat(E, 20)) * (1 + t.train);
    v.inferEff = (1 + sat(E, 25)) * (1 + t.infer);
    v.growthMult = 1 + sat(G, 15);
    v.brand = 1 + 0.35 * sat(G, 20);
    v.scandalMult = Math.exp(-S / 12) * t.safety;
    v.researchQ = 1 + 0.08 * sat(R, 40);
    v.boardBonus = Math.min(0.3, v.boards * 0.03);
    v.rpMult = (1 + v.boardBonus) * (1 + 0.08 * Math.log10(1 + v.effPF));
    v.rpStaff = rpStaff * v.rpMult;

    const fm = flagship(s);
    v.flagship = fm;
    v.serveNeed = fm ? (s.subs * fm.infer) / (2000 * v.inferEff) : 0;
    v.contractPF = s.contracts.reduce((a, c) => a + c.pf, 0);
    v.need = v.serveNeed + v.contractPF;
    if (s.training) {
      v.inferPF = s.autoAlloc ? Math.min(v.effPF, v.need * 1.15) : v.effPF * (1 - s.allocTrain);
      v.trainPF = v.effPF - v.inferPF;
    } else {
      v.inferPF = v.effPF;
      v.trainPF = 0;
    }
    v.service = v.need > 0 ? Math.min(1, v.inferPF / v.need) : 1;
    v.idlePF = Math.max(0, v.inferPF - v.need);
    v.rpCompute = 0.25 * Math.log2(1 + v.idlePF);
    v.rpDay = v.rpStaff + v.rpCompute;

    v.arpu = fm ? s.price * fm.arpu : 0;
    v.subRevenue = s.subs * v.arpu;
    v.contractRevenue = s.contracts.reduce((a, c) => a + c.monthly, 0);
    v.mrr = v.subRevenue + v.contractRevenue;
    v.powerCostDay = Math.min(v.power, v.powerCap) * 2.88 * effectMult(s, 'energy');
    v.burnMonth = v.payroll + office.rent + v.powerCostDay * 30;
    v.profitMonth = v.mrr - v.burnMonth;
    v.bestCap = bestCap(s);
    v.topRival = topRival(s);
    v.market = marketSize(s);
    v.valuation = valuation(s, v);
    v.netWorth = v.valuation * s.equity;
    return v;
  }

  function valuation(s, v) {
    // Revenue multiple, plus option value on the market scaled by your lead over rivals.
    const S = s.sentiment, h = s.hype / 100;
    const top = v.topRival ? v.topRival.cap : 30;
    const lead = Math.pow(Math.min(1.5, v.bestCap / top), 2);
    const revPart = v.mrr * 12 * 8 * S * (0.7 + 0.6 * h);
    const capPart = v.market * 60 * lead * S * (0.6 + 0.8 * h);
    const team = 2e6 + s.staff.reduce((a, p) => a + p.skill, 0) * 1e5;
    return revPart + capPart + team + v.hwValue;
  }

  // ---------- staff ----------

  function makeCandidate(s, role, skill) {
    return {
      id: 'c' + s.nextId++,
      name: `${pick(D.FIRST_NAMES)} ${pick(D.LAST_NAMES)}`,
      role,
      skill,
      salary: salaryFor(role, skill, s.sentiment, s.day),
      bio: AIT.FLAVOR ? AIT.FLAVOR.bio(role) : '',
    };
  }

  function refreshCandidates(s) {
    const prestige = clamp(bestCap(s) / 14 + s.hype / 35 + s.officeLevel * 0.7 + (s.flags.openBonus || 0), 0, 7);
    const n = 4 + Math.min(2, s.officeLevel);
    const roles = ['researcher', 'researcher', 'engineer', 'engineer', 'growth', 'safety'];
    s.candidates = [];
    for (let i = 0; i < n; i++) {
      const role = i < 2 ? ['researcher', 'engineer'][i] : pick(roles);
      const skill = clamp(Math.round(1.5 + prestige + gauss()), 1, 10);
      s.candidates.push(makeCandidate(s, role, skill));
    }
    s.candidatesDay = s.day;
  }

  function staffDaily(s, v) {
    const decorBonus = Math.min(25, (12 * v.decor) / Math.max(1, s.staff.length));
    const hypeBonus = Math.min(8, s.hype / 10);
    for (const p of [...s.staff]) {
      if (p.founder) {
        p.morale = 100;
      } else {
        p.perk = Math.max(0, (p.perk || 0) - 0.03);
        const target = 45 + decorBonus + hypeBonus + p.perk + (s.cash < 0 ? -20 : 0);
        p.morale = clamp(p.morale + (target - p.morale) * 0.03, 0, 100);
      }
      if (p.trainUntil && p.trainUntil === s.day) {
        p.skill = Math.min(10, p.skill + 1);
        if (!p.founder) p.salary = Math.max(p.salary, salaryFor(p.role, p.skill, s.sentiment, s.day));
        news(s, `${p.name} finished training and is now skill ${p.skill}.`, 'good', true);
      }
      if (!p.founder && p.morale < 25 && Math.random() < 0.01) {
        s.staff = s.staff.filter((x) => x !== p);
        news(s, `${p.name} quit. Morale was too low. Add comfort items or pay more.`, 'bad', true);
      }
    }
  }

  // ---------- rivals and market ----------

  function updateRivals(s, v) {
    const closed = s.rivals.filter((r) => !RIVAL_BY_ID[r.id].open);
    for (const r of s.rivals) {
      const def = RIVAL_BY_ID[r.id];
      const push = v.bestCap > r.cap + 4 ? 1.15 : 1;
      r.progress += (def.pace / 365) * push * (0.85 + 0.15 * s.sentiment);
      r.hype += (45 - r.hype) * 0.01;
      if (s.day < r.nextRelease) continue;
      const target = def.cap0 + (100 - def.cap0) * Math.pow(Math.min(1, r.progress / 9.5), 0.85);
      let cap = Math.max(r.cap + 0.3, target + rand(-1.5, 1.2));
      if (def.open) cap = Math.min(cap, Math.max(...closed.map((c) => c.cap)) - 3, 95);
      cap = Math.min(100, cap);
      if (cap <= r.cap) {
        r.nextRelease = s.day + randi(30, 60);
        continue;
      }
      r.cap = cap >= 99.9 ? 100 : round1(cap);
      r.version++;
      r.hype = Math.min(100, r.hype + 20);
      r.nextRelease = s.day + (def.open ? randi(50, 120) : randi(80, 170));
      const beat = v.flagship && r.cap > v.flagship.cap ? ' It beats your flagship.' : '';
      const line = AIT.FLAVOR ? ' ' + AIT.FLAVOR.pick(AIT.FLAVOR.RIVAL_LINES[r.id]) : '';
      news(s, `${def.name} releases ${def.model}-${r.version}, scoring ${r.cap.toFixed(1)} on OmniBench.${beat || line}`, beat ? 'warn' : 'info', !!beat);
      if (!def.open && r.cap >= 100) {
        endGame(s, false, `${def.name} announced AGI first. The race is over.`);
        return;
      }
    }
  }

  function updateMarket(s, v) {
    const fm = v.flagship;
    if (!fm) {
      s.subs *= 0.9;
      s.share = 0;
      s.targetSubs = 0;
      return;
    }
    const priceF = Math.pow(20 / s.price, 1.1);
    const you = attract(fm.cap, fm.appeal, s.hype, priceF, Math.pow(v.service, 1.5), v.brand);
    let total = you;
    for (const r of s.rivals) {
      const def = RIVAL_BY_ID[r.id];
      total += attract(r.cap, rivalAppeal(s), r.hype, 1, 1, 1) * (def.open ? 0.45 : 1);
    }
    s.share = you / total;
    s.targetSubs = v.market * s.share;
    if (s.subs < s.targetSubs) s.subs += (s.targetSubs - s.subs) * 0.03 * v.growthMult + 1;
    else s.subs -= (s.subs - s.targetSubs) * 0.04;
    if (v.service < 0.8 && s.subs > 50) {
      s.hype = Math.max(0, s.hype - 0.3);
      if (s.day - (s.flags.capacityNews || -99) > 30) {
        s.flags.capacityNews = s.day;
        news(s, 'Users are hitting "at capacity" errors. Add compute or lower the training share.', 'bad', true);
      }
    }
    s.subs = Math.max(0, Math.min(s.subs, s.targetSubs * 1.5 + 10));
  }

  function contractsDaily(s, v) {
    for (const c of [...s.contracts]) {
      if (v.service >= 0.75) {
        s.cash += c.monthly / 30;
        s.month.crev += c.monthly / 30;
      } else if (++c.strikes >= 10) {
        s.contracts = s.contracts.filter((x) => x !== c);
        s.hype = Math.max(0, s.hype - 4);
        news(s, `${c.client} cancelled its contract after repeated outages.`, 'bad', true);
        continue;
      }
      if (s.day >= c.until) {
        s.contracts = s.contracts.filter((x) => x !== c);
        news(s, `Your contract with ${c.client} has ended.`, 'info');
      }
    }
  }

  // ---------- training ----------

  function expectedCap(s, sizeId, data, v) {
    const size = D.SIZE_BY_ID[sizeId];
    if (size.id === 'agi') return 100;
    let dataQ = 1;
    for (const src of D.DATA_SOURCES) if (data[src.id]) dataQ += src.q;
    if (s.flags.dataDeal) dataQ += 0.02;
    const t = v.tech;
    const capMult = 1 + t.cap + (s.techs.data_flywheel ? 0.06 * sat(s.subs, 5e6) : 0);
    return Math.min(99, size.base * dataQ * capMult * v.researchQ);
  }

  function trainingCost(s, sizeId, data) {
    const size = D.SIZE_BY_ID[sizeId];
    if (size.fixedCost) return size.fixedCost;
    let c = 0;
    for (const src of D.DATA_SOURCES) if (data[src.id]) c += size.data[src.id];
    return c;
  }

  function trainDaily(s, v) {
    const job = s.training;
    const gain = v.trainPF * v.trainMult;
    job.done += gain;
    let spike = false;
    if (gain > 0 && Math.random() < 0.006 * (1 - 0.6 * sat(v.E, 20))) {
      job.done = Math.max(0, job.done - job.need * rand(0.02, 0.05));
      spike = true;
      news(s, `Loss spike during the ${job.name} run. Rolled back to the last checkpoint.`, 'warn', true);
    }
    const p = Math.min(1, job.done / job.need);
    const lf = 3.3 - job.exp * 0.02;
    const loss = lf + (11 - lf) * Math.pow(1 - p, 1.6) + rand(-0.05, 0.05) * (1 - p * 0.7) + (spike ? 1.2 : 0);
    job.loss.push(round1(loss * 10) / 10);
    if (job.loss.length > 160) job.loss = job.loss.filter((_, i) => i % 2 === 0);
    if (job.done >= job.need) finishTraining(s, v);
  }

  function finishTraining(s, v) {
    const job = s.training;
    const size = D.SIZE_BY_ID[job.size];
    const t = v.tech;
    let cap = expectedCap(s, job.size, job.data, v) * rand(0.96, 1.04);
    cap = size.id === 'agi' ? 100 : Math.min(99, round1(cap));
    if (s.flags.dataDeal) s.flags.dataDeal = false;
    const m = {
      id: 'm' + s.nextId++,
      name: job.name,
      size: size.id,
      cap,
      appeal: 1 + t.appeal,
      arpu: 1 + t.arpu,
      infer: size.infer,
      day: s.day,
      open: false,
      scraped: !job.data.licensed,
      human: !!job.data.human,
    };
    s.models.push(m);
    s.training = null;
    s.reveal = m.id; // the UI shows a launch reveal for this model
    news(s, `${m.name} finished training. OmniBench score: ${cap.toFixed(1)}.`, 'good');
    if (size.id === 'agi') {
      endGame(s, true, `${m.name} is the first artificial general intelligence. ${s.company} won the race.`);
    }
  }

  // ---------- events ----------

  function maybeEvent(s, v) {
    // a quiet first month and a half so new players can find their feet
    if (s.day < 45 || s.events.length || Math.random() > 1 / 18) return;
    const pool = [];
    let total = 0;
    for (const ev of AIT.EVENTS) {
      if ((s.eventCd[ev.id] || 0) > s.day || (ev.modal && s.day < 75)) continue;
      const w = ev.weight(s, v);
      if (w > 0) {
        pool.push([ev, w]);
        total += w;
      }
    }
    if (!pool.length) return;
    let r = Math.random() * total;
    let ev = pool[0][0];
    for (const [e, w] of pool) {
      if ((r -= w) <= 0) {
        ev = e;
        break;
      }
    }
    s.eventCd[ev.id] = s.day + ev.cd;
    const params = ev.make ? ev.make(s, v) : {};
    if (ev.modal) {
      s.events.push({ id: ev.id, params });
    } else {
      const text = ev.run(s, v, params);
      if (text) news(s, text, ev.kind || 'info', true);
    }
  }

  function eventView(s) {
    const pending = s.events[0];
    if (!pending) return null;
    const ev = AIT.EVENTS.find((e) => e.id === pending.id);
    const v = derive(s);
    return {
      title: ev.title(s, pending.params, v),
      body: ev.body(s, pending.params, v),
      kind: ev.kind || 'info',
      choices: ev.choices(s, pending.params, v).map((c) => ({ label: c.label, note: c.note || '' })),
    };
  }

  function resolveEvent(s, idx) {
    const pending = s.events.shift();
    if (!pending) return;
    const ev = AIT.EVENTS.find((e) => e.id === pending.id);
    const v = derive(s);
    const choice = ev.choices(s, pending.params, v)[idx];
    const text = choice.run(s, pending.params, v);
    if (text) news(s, text, choice.kind || 'info', true);
  }

  // ---------- goals, months, endings ----------

  function checkGoals(s) {
    for (const g of D.GOALS) {
      if (s.goals[g.id] || !g.check(s)) continue;
      s.goals[g.id] = s.day;
      const r = g.reward || {};
      const bits = [];
      if (r.cash) {
        s.cash += r.cash;
        s.month.other -= r.cash;
        bits.push('+$' + r.cash.toLocaleString('en-US'));
      }
      if (r.hype) {
        s.hype = Math.min(100, s.hype + r.hype);
        bits.push(`+${r.hype} hype`);
      }
      if (r.rp) {
        s.rp += r.rp;
        bits.push(`+${r.rp} RP`);
      }
      news(s, `Goal complete: ${g.text}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`, 'goal', true);
    }
  }

  function closeMonth(s, v) {
    const m = s.month;
    const d = dateOf(s.day - 1);
    s.history.push({
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear(),
      cash: s.cash,
      revenue: m.rev + m.crev,
      costs: m.salaries + m.rent + m.power + m.marketing + m.data,
      capex: m.capex,
      subs: Math.round(s.subs),
      valuation: v.valuation,
      mrr: v.mrr,
      detail: { ...m },
    });
    if (s.history.length > 120) s.history.shift();
    s.month = emptyMonth();
    s.monthKey = monthKey(s.day);
    if (hooks.month) hooks.month(s);
  }

  function endGame(s, win, text) {
    if (s.over) return;
    s.over = { win, text, day: s.day };
    news(s, text, win ? 'goal' : 'bad');
    if (hooks.over) hooks.over(s);
  }

  // ---------- the daily tick ----------

  function tick(s) {
    if (s.over && !s.over.sandbox) return;
    s.day++;
    s.effects = s.effects.filter((e) => e.until > s.day);
    let v = derive(s);

    const trend = 1.05 + 0.12 * Math.sin(s.day / 300);
    s.sentiment = clamp(s.sentiment + (trend - s.sentiment) * 0.01 + rand(-0.012, 0.012), 0.45, 1.8);

    if (s.training) trainDaily(s, v);
    updateRivals(s, v);
    if (s.over && !s.over.sandbox) return;
    updateMarket(s, v);

    const rev = v.subRevenue / 30;
    s.cash += rev;
    s.month.rev += rev;
    contractsDaily(s, v);

    s.rp += v.rpDay;

    const pay = v.payroll / 30, rent = v.office.rent / 30, power = v.powerCostDay;
    s.cash -= pay + rent + power;
    s.month.salaries += pay;
    s.month.rent += rent;
    s.month.power += power;

    s.hype = clamp(s.hype + (5 - s.hype) * 0.012 * (1 - 0.4 * sat(v.G, 15)), 0, 100);

    staffDaily(s, v);
    if (s.day - s.candidatesDay >= 7) refreshCandidates(s);
    if (s.offer && s.day > s.offer.expires) {
      news(s, `The ${s.offer.name} term sheet expired.`, 'warn');
      s.offer = null;
    }

    v = derive(s);
    if (v.flagship && v.flagship.cap > (v.topRival ? v.topRival.cap : 0)) s.flags.wasSota = true;
    s.stats.peakSubs = Math.max(s.stats.peakSubs, s.subs);
    s.stats.peakMrr = Math.max(s.stats.peakMrr, v.mrr);

    maybeEvent(s, v);
    checkGoals(s);
    if (monthKey(s.day) !== s.monthKey) closeMonth(s, v);

    if (s.cash < 0) {
      s.stats.negDays++;
      if (s.stats.negDays === 1) news(s, 'You are out of cash. Raise money or cut costs within 90 days.', 'bad', true);
      if (s.stats.negDays === 75) news(s, '15 days until bankruptcy.', 'bad', true);
      if (s.stats.negDays >= 90) endGame(s, false, `${s.company} ran out of money and shut down.`);
    } else {
      s.stats.negDays = 0;
    }
  }

  // ---------- player actions (each returns { ok, msg }) ----------

  const ok = (msg) => ({ ok: true, msg });
  const no = (msg) => ({ ok: false, msg });

  const A = {
    place(s, type, x, y) {
      const size = D.OFFICES[s.officeLevel].size;
      if (x < 0 || y < 0 || x >= size || y >= size) return no('Outside the office');
      if (s.items.some((i) => i.x === x && i.y === y)) return no('That tile is taken');
      const lock = itemLocked(s, type);
      if (lock) return no(lock);
      const cost = itemCost(s, type);
      if (s.cash < cost) return no('Not enough cash');
      s.cash -= cost;
      s.month.capex += cost;
      addItem(s, type, x, y);
      return ok(cost);
    },

    sell(s, id) {
      const it = s.items.find((i) => i.id === id);
      if (!it) return no('Nothing there');
      const d = D.ITEMS[it.type];
      if (d.seats) {
        const seats = s.items.reduce((a, i) => a + (D.ITEMS[i.type].seats || 0), 0);
        if (seats - d.seats < s.staff.length) return no('Someone sits here. Fire them or build another desk first.');
      }
      const refund = Math.round(d.cost * 0.5);
      s.items = s.items.filter((i) => i !== it);
      s.cash += refund;
      s.month.capex -= refund;
      return ok(refund);
    },

    moveOffice(s) {
      const next = D.OFFICES[s.officeLevel + 1];
      if (!next) return no('You already own the biggest campus');
      if (next.round && !s.rounds.includes(next.round)) return no(`The landlord wants to see your ${D.ROUNDS.find((r) => r.id === next.round).name} first`);
      if (s.cash < next.moveCost) return no('Not enough cash');
      s.cash -= next.moveCost;
      s.month.capex += next.moveCost;
      s.officeLevel++;
      news(s, `${s.company} moves into a ${next.name}.`, 'good', true);
      return ok();
    },

    hire(s, id) {
      const c = s.candidates.find((x) => x.id === id);
      if (!c) return no('Candidate is gone');
      const seats = s.items.reduce((a, i) => a + (D.ITEMS[i.type].seats || 0), 0);
      if (s.staff.length >= seats) return no('No free desk. Build a desk first.');
      if (s.cash < c.salary) return no('Not enough cash for the signing bonus');
      s.cash -= c.salary;
      s.month.salaries += c.salary;
      s.candidates = s.candidates.filter((x) => x !== c);
      s.staff.push({ id: 's' + s.nextId++, name: c.name, role: c.role, skill: c.skill, salary: c.salary, bio: c.bio || '', morale: 70, trainUntil: 0, perk: 0 });
      return ok(`${c.name} joined as ${D.ROLES[c.role].name}`);
    },

    fire(s, id) {
      const p = s.staff.find((x) => x.id === id);
      if (!p || p.founder) return no('You cannot fire yourself');
      if (s.cash < p.salary) return no('Not enough cash for severance');
      s.cash -= p.salary;
      s.month.salaries += p.salary;
      s.staff = s.staff.filter((x) => x !== p);
      for (const q of s.staff) if (!q.founder) q.morale = Math.max(0, q.morale - 4);
      return ok(`${p.name} was let go`);
    },

    train(s, id) {
      const p = s.staff.find((x) => x.id === id);
      if (!p) return no('Nobody by that name');
      if (p.skill >= 10) return no('Already at max skill');
      if (p.trainUntil > s.day) return no('Already in training');
      const cost = trainCostFor(p);
      if (s.cash < cost) return no('Not enough cash');
      s.cash -= cost;
      s.month.other += cost;
      p.trainUntil = s.day + 14;
      return ok(`${p.name} is off to a 14-day course`);
    },

    refreshCandidates(s) {
      const cost = 2000 * (1 + s.officeLevel * 2);
      if (s.cash < cost) return no('Not enough cash');
      s.cash -= cost;
      s.month.other += cost;
      refreshCandidates(s);
      return ok('New candidates are in');
    },

    research(s, id) {
      const t = D.TECH_BY_ID[id];
      if (s.techs[id]) return no('Already researched');
      if (!t.req.every((r) => s.techs[r])) return no('Research the prerequisites first');
      if (s.rp < t.cost) return no('Not enough research points');
      s.rp -= t.cost;
      s.techs[id] = s.day;
      news(s, `Research complete: ${t.name}.`, 'good', true);
      return ok();
    },

    startTraining(s, sizeId, data) {
      if (s.training) return no('A training run is already going');
      const size = D.SIZE_BY_ID[sizeId];
      if (size.tech && !s.techs[size.tech]) return no(`Research ${D.TECH_BY_ID[size.tech].name} first`);
      const clean = {};
      for (const src of D.DATA_SOURCES) clean[src.id] = !!data[src.id] && (!src.tech || !!s.techs[src.tech]);
      if (size.id === 'agi') for (const k in clean) clean[k] = true;
      const cost = trainingCost(s, sizeId, clean);
      if (s.cash < cost) return no('Not enough cash for the data');
      s.cash -= cost;
      s.month.data += cost;
      const v = derive(s);
      const n = s.modelCounter + 1;
      s.modelCounter = n;
      s.training = {
        size: sizeId,
        data: clean,
        need: size.pfdays,
        done: 0,
        start: s.day,
        name: size.id === 'agi' ? `${s.family}-Ω` : `${s.family}-${n} ${size.name}`,
        exp: expectedCap(s, sizeId, clean, v),
        loss: [],
      };
      return ok(`Training ${s.training.name}`);
    },

    cancelTraining(s) {
      if (!s.training) return no('No training run');
      news(s, `Training of ${s.training.name} was cancelled.`, 'warn');
      s.training = null;
      return ok();
    },

    deploy(s, id) {
      const m = s.models.find((x) => x.id === id);
      if (!m) return no('Model not found');
      const prev = flagship(s);
      s.flagshipId = m.id;
      const top = topRival(s);
      let gain = clamp((m.cap - (prev ? prev.cap : 0)) * 1.2, 0, 20);
      let msg = `${m.name} is live`;
      if (top && m.cap > top.cap) {
        gain += 12;
        s.flags.wasSota = true;
        msg = `${m.name} is live and tops the OmniBench leaderboard`;
      }
      s.hype = Math.min(100, s.hype + gain);
      s.flags.lastDeploy = s.day;
      news(s, msg + '.', 'good');
      return ok(msg);
    },

    openSource(s, id) {
      const m = s.models.find((x) => x.id === id);
      if (!m || m.open) return no('Already open');
      if (m.id === s.flagshipId) return no('Deploy a different flagship first');
      if (m.size === 'agi') return no('Absolutely not');
      m.open = true;
      const gain = Math.min(12, m.cap * 0.25);
      s.hype = Math.min(100, s.hype + gain);
      s.flags.openBonus = Math.min(1.5, (s.flags.openBonus || 0) + 0.3);
      const open = s.rivals.find((r) => RIVAL_BY_ID[r.id].open);
      open.cap = Math.max(open.cap, round1(m.cap - 1));
      news(s, `${s.company} releases the weights of ${m.name}. Developers cheer.`, 'good');
      return ok(`${m.name} is now open source`);
    },

    setPrice(s, p) {
      s.price = clamp(Math.round(p), 5, 60);
      return ok();
    },

    setAlloc(s, auto, share) {
      s.autoAlloc = !!auto;
      if (share != null) s.allocTrain = clamp(share, 0, 1);
      return ok();
    },

    campaign(s, id) {
      const c = D.CAMPAIGNS.find((x) => x.id === id);
      if ((c.minOffice || 0) > s.officeLevel) return no(`Needs ${D.OFFICES[c.minOffice].name}`);
      if ((s.campaignCd[id] || 0) > s.day) return no('On cooldown');
      if (s.cash < c.cost) return no('Not enough cash');
      s.cash -= c.cost;
      s.month.marketing += c.cost;
      const v = derive(s);
      const boost = c.deployBoost && s.flags.lastDeploy != null && s.day - s.flags.lastDeploy <= 30 ? 1.6 : 1;
      const gain = c.hype * (1 - s.hype / 120) * boost * (1 + 0.3 * sat(v.G, 15));
      s.hype = Math.min(100, s.hype + gain);
      s.campaignCd[id] = s.day + c.cd;
      return ok(`${c.name}: +${gain.toFixed(1)} hype`);
    },

    pitch(s) {
      const round = D.ROUNDS[s.rounds.length];
      if (!round) return no('No more rounds to raise');
      if (s.offer) return no('You already have a term sheet');
      if (s.roundCd > s.day) return no(`Investors want to wait ${s.roundCd - s.day} more days`);
      const v = derive(s);
      if (!round.req(s, v)) return no(`Not yet: ${round.reqText}`);
      const pre = v.valuation * rand(0.9, 1.15);
      const raise = Math.max(round.min, (pre * round.dil) / (1 - round.dil));
      s.offer = { id: round.id, name: round.name, pre, raise, dilution: raise / (pre + raise), expires: s.day + 14 };
      return ok(`Term sheet received for your ${round.name}`);
    },

    acceptOffer(s) {
      const o = s.offer;
      if (!o) return no('No offer');
      s.cash += o.raise;
      s.month.funding += o.raise;
      s.equity *= 1 - o.dilution;
      s.rounds.push(o.id);
      s.offer = null;
      s.hype = Math.min(100, s.hype + 4);
      if (o.id === 'ipo') s.flags.public = true;
      news(s, `${s.company} closes its ${o.name}.`, 'good', true);
      return ok();
    },

    declineOffer(s) {
      if (!s.offer) return no('No offer');
      s.offer = null;
      s.roundCd = s.day + 30;
      return ok('Offer declined. Investors will listen again in 30 days.');
    },

    sandbox(s) {
      if (s.over) s.over.sandbox = true;
      return ok();
    },
  };

  const trainCostFor = (p) => Math.max(2000, Math.round((p.salary || 6000) * 1.5));

  AIT.Sim = {
    newGame, tick, derive, actions: A, hooks, news, addEffect, effectMult, itemCost, itemLocked,
    expectedCap, trainingCost, salaryFor, trainCostFor, eventView, resolveEvent, endGame, makeCandidate,
    dateOf, flagship, topRival, marketSize, techTotals, refreshCandidates,
    util: { clamp, rand, randi, pick, sat, round1 },
    RIVAL_BY_ID,
  };
})(typeof window !== 'undefined' ? window : globalThis);
