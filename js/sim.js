/* Game state and the daily simulation. No DOM access, so it also runs in Node
   (see tools/simulate.js). */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA;

  const DAY_MS = 86400000;

  // Seedable randomness (mulberry32), so tests and the daily challenge can
  // replay the same run. Visual randomness elsewhere keeps using Math.random.
  let rngState = (Math.random() * 4294967296) >>> 0;
  function random() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const seed = (n) => (rngState = n >>> 0);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const sat = (x, k) => 1 - Math.exp(-x / k);
  const money = (n) => (AIT.fmt ? AIT.fmt.money(n) : '$' + Math.round(n));
  const round1 = (x) => Math.round(x * 10) / 10;
  const gauss = () => (random() + random() + random() - 1.5) * 1.4;
  const RIVAL_BY_ID = Object.fromEntries(D.RIVALS.map((r) => [r.id, r]));

  const hooks = { toast: null, month: null, over: null };
  const VERSION = 4;

  // ---------- footprints and seats ----------
  const sizeOf = (it) => (it.legacy ? 1 : D.ITEMS[it.type].size || 1);
  // Items bought before 2x2 hardware existed keep their old, quarter-size stats.
  const stat = (it, key) => (D.ITEMS[it.type][key] || 0) * (it.legacy ? 0.25 : 1);
  const covers = (it, x, y) => {
    const n = sizeOf(it);
    return x >= it.x && y >= it.y && x < it.x + n && y < it.y + n;
  };
  const itemAt = (s, x, y) => s.items.find((it) => covers(it, x, y)) || null;
  function occupied(s) {
    const set = new Set();
    for (const it of s.items) {
      const n = sizeOf(it);
      for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) set.add(it.x + dx + ',' + (it.y + dy));
    }
    return set;
  }
  // Tiles between two footprints: 1 means next to each other, 0 means overlapping.
  function gap(a, b) {
    const na = sizeOf(a), nb = sizeOf(b);
    const dx = Math.max(0, b.x - (a.x + na - 1), a.x - (b.x + nb - 1));
    const dy = Math.max(0, b.y - (a.y + na - 1), a.y - (b.y + nb - 1));
    return Math.max(dx, dy);
  }
  function canPlace(s, type, x, y, occ) {
    const N = D.OFFICES[s.officeLevel].size;
    const n = D.ITEMS[type].size || 1;
    if (x < 0 || y < 0 || x + n > N || y + n > N) return 'Outside the office';
    occ = occ || occupied(s);
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) if (occ.has(x + dx + ',' + (y + dy))) return 'That tile is taken';
    return null;
  }
  // Staff sit at desks in hiring order.
  function seating(s) {
    const desks = s.items.filter((i) => D.ITEMS[i.type].seats).sort((a, b) => a.id - b.id);
    const map = new Map();
    s.staff.forEach((p, i) => {
      if (desks[i]) map.set(p.id, desks[i]);
    });
    return map;
  }
  const fundingDefaults = () => ({ offers: [], cd: 0, walkaways: [], last: null, pitches: 0 });
  const productDefaults = () => Object.fromEntries(D.PRODUCTS.map((p) => [p.id, { live: false, price: p.price, users: 0, share: 0, target: 0 }]));

  function migrate(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    obj.v = obj.v || 1;
    if (obj.v < 2) {
      for (const it of obj.items || []) if ((D.ITEMS[it.type] || {}).size === 2) it.legacy = true;
      obj.products = obj.products || productDefaults();
      obj.mode = obj.mode || 'standard';
      obj.difficulty = obj.difficulty || 'normal';
      obj.playMs = obj.playMs || 0;
      obj.v = 2;
    }
    if (obj.v < 3) {
      // one term sheet at a time became several competing ones
      const f = fundingDefaults();
      f.cd = obj.roundCd || 0;
      if (obj.offer) f.offers.push(Object.assign({ oid: 'o1', investor: 'Your investors', kind: 'Investors', type: 'vc', round: obj.offer.id, perk: null, pushed: true }, obj.offer));
      obj.funding = f;
      delete obj.offer;
      delete obj.roundCd;
      obj.v = 3;
    }
    if (obj.v < 4) {
      // v0.2 moved to seven San Francisco offices; old offices map onto the closest new one
      // (each new office is at least as big as the old one, so every item still fits)
      obj.officeLevel = [0, 2, 3, 5, 6][obj.officeLevel] != null ? [0, 2, 3, 5, 6][obj.officeLevel] : obj.officeLevel;
      obj.products = Object.assign(productDefaults(), obj.products || {});
      // chapters the lab has already passed stay quiet instead of all opening at once
      if (AIT.FLAVOR && obj.chapters) for (const c of AIT.FLAVOR.CHAPTERS) if (c.when(obj)) obj.chapters[c.id] = obj.chapters[c.id] != null ? obj.chapters[c.id] : obj.day;
      obj.v = 4;
    }
    return obj;
  }

  const dateOf = (day) => new Date(D.START_DATE + day * DAY_MS);
  const monthKey = (day) => {
    const d = dateOf(day);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  const emptyMonth = () => ({ rev: 0, crev: 0, prev: 0, salaries: 0, rent: 0, power: 0, marketing: 0, capex: 0, data: 0, other: 0, funding: 0 });

  function news(s, text, kind = 'info', toast = false) {
    s.news.unshift({ day: s.day, text, kind });
    if (s.news.length > 80) s.news.length = 80;
    if (toast && hooks.toast) hooks.toast(text, kind);
  }

  // a journal of the player's decisions, used for run reports
  function log(s, a, extra = {}) {
    if (!s.log) s.log = [];
    const last = s.log[s.log.length - 1];
    if (last && last.a === a && last.d === s.day && a === 'buy' && last.t === extra.t) {
      last.n++;
      return;
    }
    if (last && last.a === a && (a === 'price' || (a === 'pprice' && last.id === extra.id)) && s.day - last.d < 3) {
      last.to = extra.to;
      last.d = s.day;
      return;
    }
    s.log.push({ d: s.day, a, ...extra });
    if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
  }

  function addItem(s, type, x, y) {
    const it = { id: s.nextId++, type, x, y };
    s.items.push(it);
    return it;
  }

  function newGame(opts = {}) {
    const mode = opts.mode || 'standard';
    const difficulty = mode === 'daily' || mode === 'runway' ? 'normal' : opts.difficulty || 'normal';
    seed(opts.seed != null ? opts.seed : Math.random() * 4294967296);
    const s = {
      v: VERSION,
      mode,
      difficulty,
      seed: opts.seed != null ? opts.seed : null,
      playMs: 0,
      products: productDefaults(),
      runId: 'run-' + Date.now().toString(36),
      log: [],
      company: opts.company || 'Fogline Labs',
      family: opts.family || 'Karl',
      day: 0,
      cash: mode === 'sandbox' ? 10e6 : D.DIFFICULTY[difficulty].cash,
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
      autoRenew: {},
      campaignStopped: {},
      rounds: [],
      funding: fundingDefaults(),
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
    if (mode === 'runway') s.runway = { q: 1, start: 0, booked: 0, strikes: 0, history: [], meeting: null, endless: false };
    return s;
  }

  // ---------- Runway: quarters, quotas and the board ----------

  const RW = D.RUNWAY;
  function quotaFor(q) {
    if (q <= RW.quotas.length) return RW.quotas[q - 1];
    return Math.round(RW.quotas.at(-1) * Math.pow(RW.endlessGrowth, q - RW.quotas.length));
  }

  // where the current quarter stands: days, booked revenue and where it is heading
  function quarterView(s, v) {
    const r = s.runway;
    if (!r) return null;
    const quota = quotaFor(r.q);
    const elapsed = s.day - r.start;
    const left = Math.max(0, RW.quarterDays - elapsed);
    const daily = (v || derive(s)).mrr / 30;
    const projected = r.booked + daily * left;
    return { q: r.q, quota, booked: r.booked, elapsed, left, days: RW.quarterDays, projected, hit: r.booked >= quota, onPace: projected >= quota, strikes: r.strikes, ipoQuarter: r.q === RW.quotas.length };
  }

  // the quarter ends on its last day, or early when the player rings the bell
  function endQuarter(s, how) {
    const r = s.runway;
    const view = quarterView(s);
    const rec = { q: r.q, quota: view.quota, booked: Math.round(r.booked), hit: view.hit, left: view.left, how, day: s.day, cash: Math.round(s.cash), equity: s.equity };
    if (!rec.hit) {
      r.strikes++;
      if (r.strikes < RW.strikes) {
        s.equity *= 1 - RW.downRound;
        rec.equity = s.equity;
        news(s, `${s.company} missed its Q${rec.q} quota. The board forced a down round.`, 'bad', true);
      }
    } else news(s, `${s.company} beat its Q${rec.q} quota: ${Math.round((rec.booked / rec.quota) * 100)}% of target.`, 'good');
    rec.strikes = r.strikes;
    r.history.push(rec);
    log(s, 'quarter', { q: rec.q, hit: rec.hit, booked: rec.booked, quota: rec.quota, how });
    if (s.cash < 0) {
      rec.end = 'broke';
      endGame(s, false, `${s.company} ended Q${rec.q} out of cash, and the board shut it down.`, 'runway');
    } else if (r.strikes >= RW.strikes) {
      rec.end = 'fired';
      endGame(s, false, `After a second missed quota in Q${rec.q}, the board replaced you as CEO.`, 'runway');
    } else if (rec.hit && rec.q === RW.quotas.length && !r.endless) rec.ipo = true;
    r.meeting = rec;
    // the next quarter starts now; the clock waits until the meeting is closed
    r.q++;
    r.start = s.day;
    r.booked = 0;
  }

  // what counts as a run's result: quarters cleared, then valuation
  const runwayCleared = (s) => (s.runway ? s.runway.history.filter((h) => h.hit).length : 0);

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
    const t = { train: 0, infer: 0, appeal: 0, cap: 0, arpu: 0, rp: 0, safety: 1 };
    for (const tech of D.TECHS) {
      if (!s.techs[tech.id]) continue;
      t.train += tech.train || 0;
      t.infer += tech.infer || 0;
      t.appeal += tech.appeal || 0;
      t.cap += tech.cap || 0;
      t.arpu += tech.arpu || 0;
      t.rp += tech.rp || 0;
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
    const T = D.TUNING;
    return Math.min(T.marketCap, T.marketStart * Math.exp(T.marketRate * yr)) * Math.sqrt(s.sentiment) * effectMult(s, 'market');
  }

  function attract(cap, appeal, hype, priceF, service, brand) {
    return Math.pow(Math.max(cap, 0.1) / 10, 3.2) * appeal * (0.6 + (0.8 * hype) / 100) * priceF * service * brand;
  }

  const rivalAppeal = (s) => 1 + Math.min(0.8, (s.day / 365) * 0.1);
  // how strongly the rival labs pull users, the other side of every share calculation
  function rivalPull(s) {
    let total = 0;
    for (const r of s.rivals) total += attract(r.cap, rivalAppeal(s), r.hype, 1, 1, 1) * (RIVAL_BY_ID[r.id].open ? 0.45 : 1) * rivalBoost(s, r);
    return total;
  }

  // Where subscribers and revenue would settle at other prices, all else equal.
  function priceCurve(s, v, prices) {
    const fm = v.flagship;
    if (!fm) return [];
    const others = rivalPull(s);
    return prices.map((price) => {
      const you = attract(fm.cap, fm.appeal, s.hype, Math.pow(20 / price, 1.1), Math.pow(v.service, 1.5), v.brand);
      const share = you / (you + others);
      const subs = v.market * share;
      return { price, share, subs, revenue: subs * price * fm.arpu };
    });
  }

  // The same for one of the extra products.
  function productCurve(s, v, pd, prices) {
    const fm = v.flagship;
    if (!fm) return [];
    const others = rivalPull(s);
    return prices.map((price) => {
      const mine = attract(fm.cap, fm.appeal, s.hype, Math.pow(pd.price / price, 1.1), Math.pow(v.service, 1.5), v.brand);
      const share = mine / (mine + others);
      const users = v.market * pd.market * share;
      return { price, share, subs: users, revenue: users * price };
    });
  }
  const rivalBoost = (s, r) => (r.boost && r.boost.until > s.day ? r.boost.mult : 1);

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
    const v = { office, pf: 0, power: 0, powerCap: office.power, cooling: 0, heat: 0, seats: 0, decor: 0, boards: 0, counts: {}, hwValue: 0, computeItems: 0, hotItems: 0 };
    const sources = [], coolers = [], boards = [], comforts = [];
    for (const it of s.items) {
      const d = D.ITEMS[it.type];
      v.counts[it.type] = (v.counts[it.type] || 0) + 1;
      const pf = stat(it, 'pf'), power = stat(it, 'power');
      v.pf += pf;
      v.power += power;
      v.powerCap += stat(it, 'powerCap');
      v.seats += d.seats || 0;
      v.decor += d.decor || 0;
      v.hwValue += stat(it, 'cost') * 0.5;
      if (pf) {
        sources.push({ it, pf, heat: power });
      }
      if (d.cooling) coolers.push({ it, cap: stat(it, 'cooling') });
      if (d.rpBonus) boards.push(it);
      if (d.decor) comforts.push(it);
    }
    v.boards = boards.length;
    v.computeItems = sources.length;
    v.powerFactor = v.power > v.powerCap ? v.powerCap / v.power : 1;

    // Heat is simple: every GPU adds heat, every cooler (and the building
    // itself) removes some. If heat beats cooling, all GPUs slow down together.
    let totalHeat = 0;
    for (const src of sources) totalHeat += src.heat * v.powerFactor;
    const coolCap = (office.cooling + coolers.reduce((a, c) => a + c.cap, 0)) * effectMult(s, 'cooling');
    v.heat = totalHeat;
    v.cooling = coolCap;
    v.thermal = totalHeat > coolCap ? Math.max(0.3, coolCap / totalHeat) : 1;
    v.itemHeat = new Map();
    for (const src of sources) v.itemHeat.set(src.it.id, v.thermal);
    if (v.thermal < 1) v.hotItems = sources.length;
    const pfCool = v.pf * v.thermal;
    v.cloudPF = s.cloud && s.cloud.until > s.day ? s.cloud.pf : 0;
    v.computeMult = effectMult(s, 'compute');
    v.effPF = pfCool * v.powerFactor * v.computeMult + v.cloudPF;

    // Where people sit matters: whiteboards help nearby researchers and comfort
    // items lift the mood of nearby desks.
    const boardAt = (desk) => (desk ? Math.min(0.4, boards.filter((b) => gap(b, desk) <= 2).length * 0.08) : 0);
    const comfortAt = (desk) => (desk ? Math.min(25, 4 * comforts.reduce((a, c) => a + (gap(c, desk) <= 3 ? D.ITEMS[c.type].decor : 0), 0)) : 0);
    const seats = seating(s);
    v.seatInfo = new Map();
    for (const p of s.staff) {
      const desk = seats.get(p.id);
      v.seatInfo.set(p.id, { desk, board: boardAt(desk), comfort: comfortAt(desk) });
    }
    const taken = new Set([...seats.values()].map((d) => d.id));
    const freeDesks = s.items.filter((i) => D.ITEMS[i.type].seats && !taken.has(i.id));
    v.newHireSeat = { board: Math.max(0, ...freeDesks.map(boardAt)), comfort: Math.max(0, ...freeDesks.map(comfortAt)) };
    v.boardAt = boardAt;
    v.comfortAt = comfortAt;

    const team = teamTotals(s.staff, s.day, v.seatInfo, null, s.officeLevel === 0);
    const payroll = s.staff.reduce((a, p) => a + p.salary, 0);
    Object.assign(v, { R: team.R, E: team.E, G: team.G, S: team.S, payroll, staffCount: s.staff.length });

    const t = techTotals(s);
    v.tech = t;
    const fx = teamEffects(team, t);
    v.trainMult = fx.train;
    v.inferEff = fx.infer;
    v.growthMult = fx.growth;
    v.brand = fx.brand;
    v.scandalMult = fx.scandal;
    v.researchQ = fx.quality;
    const researchers = s.staff.filter((p) => p.role === 'researcher');
    v.boardBonus = researchers.length ? researchers.reduce((a, p) => a + v.seatInfo.get(p.id).board, 0) / researchers.length : 0;
    // more compute and your own research tools both speed up the lab
    v.rpMult = (1 + 0.08 * Math.log10(1 + v.effPF)) * (1 + v.tech.rp);
    v.rpStaff = team.rp * v.rpMult;

    const fm = flagship(s);
    v.flagship = fm;
    v.products = {};
    let prodNeed = 0, prodRevenue = 0;
    for (const pd of D.PRODUCTS) {
      const st = s.products[pd.id] || { users: 0, price: pd.price };
      const live = !!(st.live && fm);
      const need = live ? (st.users * fm.infer * pd.infer) / (2000 * v.inferEff) : 0;
      const revenue = live ? st.users * st.price : 0;
      prodNeed += need;
      prodRevenue += revenue;
      v.products[pd.id] = { live, users: st.users, price: st.price, revenue, need, target: st.target || 0, share: st.share || 0 };
    }
    v.chatNeed = fm ? (s.subs * fm.infer) / (2000 * v.inferEff) : 0;
    v.serveNeed = v.chatNeed + prodNeed;
    v.productRevenue = prodRevenue;
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
    v.mrr = v.subRevenue + v.contractRevenue + v.productRevenue;
    v.powerCostDay = Math.min(v.power, v.powerCap) * 2.88 * effectMult(s, 'energy');
    v.rent = office.rent * effectMult(s, 'rent');
    v.burnMonth = v.payroll + v.rent + v.powerCostDay * 30;
    v.profitMonth = v.mrr - v.burnMonth;
    v.bestCap = bestCap(s);
    v.topRival = topRival(s);
    v.market = marketSize(s);
    v.valuation = valuation(s, v);
    v.netWorth = v.valuation * s.equity;
    v.alignment = alignment(s, v);
    v.idleDays = !s.training && s.models.length ? s.day - (s.flags.lastTrainEnd != null ? s.flags.lastTrainEnd : lastModelDay(s)) : 0;
    return v;
  }

  const lastModelDay = (s) => s.models.reduce((a, m) => Math.max(a, m.day), 0);

  // Alignment: how much the world trusts what you are building. It decides the ending.
  function alignment(s, v) {
    const parts = {
      base: 10,
      research: (s.techs.rlhf ? 5 : 0) + (s.techs.constitutional ? 15 : 0) + (s.techs.interpretability ? 20 : 0) + (s.techs.superalignment ? 10 : 0),
      team: Math.round(30 * sat(v.S, 20)),
      choices: clamp(Math.round(s.flags.align || 0), -30, 30),
      data: v.flagship && v.flagship.human ? 5 : 0,
    };
    parts.total = clamp(parts.base + parts.research + parts.team + parts.choices + parts.data, 0, 100);
    parts.ending = parts.total >= 70 ? 'aligned' : parts.total >= 40 ? 'uneasy' : 'reckless';
    return parts;
  }
  const align = (s, d) => (s.flags.align = clamp((s.flags.align || 0) + d, -30, 30));

  // ---------- what the team adds ----------

  // garage: in the garage the founder also runs the company, so only half
  // their day goes to research
  function teamTotals(staff, day, seatInfo, newSeat, garage) {
    const t = { R: 0, E: 0, G: 0, S: 0, rp: 0 };
    for (const p of staff) {
      if (p.trainUntil > day) continue;
      const prod = 0.7 + (0.5 * p.morale) / 100;
      const k = p.skill * prod;
      const seat = (seatInfo && seatInfo.get(p.id)) || newSeat || { board: 0 };
      if (p.role === 'researcher') {
        t.R += k;
        t.rp += Math.pow(p.skill, 1.25) * 0.3 * D.TUNING.rpRate * prod * (1 + seat.board) * (p.founder && garage ? 0.5 : 1);
      } else if (p.role === 'engineer') t.E += k;
      else if (p.role === 'growth') t.G += k;
      else t.S += k;
    }
    return t;
  }

  function teamEffects(team, tech) {
    return {
      train: (1 + 0.6 * sat(team.E, 20)) * (1 + tech.train),
      infer: (1 + sat(team.E, 25)) * (1 + tech.infer),
      growth: 1 + sat(team.G, 15),
      brand: 1 + 0.35 * sat(team.G, 20),
      scandal: Math.exp(-team.S / 12) * tech.safety,
      quality: 1 + 0.08 * sat(team.R, 40),
      rp: team.rp,
    };
  }

  // What one person adds: pass { remove: staffId } for someone on the team,
  // or { add: candidate } for someone you might hire.
  function impact(s, v, change) {
    const base = teamEffects(teamTotals(s.staff, s.day, v.seatInfo, null, s.officeLevel === 0), v.tech);
    let staff = s.staff;
    if (change.remove) staff = staff.filter((p) => p.id !== change.remove);
    if (change.add) staff = staff.concat([{ ...change.add, morale: 70, trainUntil: 0 }]);
    const alt = teamEffects(teamTotals(staff, s.day, v.seatInfo, v.newHireSeat, s.officeLevel === 0), v.tech);
    const [a, b] = change.remove ? [base, alt] : [alt, base];
    return {
      rp: (a.rp - b.rp) * v.rpMult,
      train: a.train / b.train - 1,
      infer: a.infer / b.infer - 1,
      brand: a.brand / b.brand - 1,
      growth: a.growth / b.growth - 1,
      scandal: 1 - a.scandal / b.scandal,
      quality: a.quality / b.quality - 1,
    };
  }

  // Where morale is heading, and why.
  function moraleTarget(s, v, p) {
    const team = s.staff.filter((q) => !q.founder);
    const comfortOf = (q) => (v.seatInfo.get(q.id) || {}).comfort || 0;
    const parts = {
      base: 45,
      comfort: p ? comfortOf(p) : team.length ? team.reduce((a, q) => a + comfortOf(q), 0) / team.length : 0,
      hype: Math.min(8, s.hype / 10),
      broke: s.cash < 0 ? -20 : 0,
    };
    parts.total = parts.base + parts.comfort + parts.hype + parts.broke;
    return parts;
  }

  // The factors behind your market share, each compared with the leading rival.
  function shareFactors(s, v) {
    const fm = v.flagship;
    if (!fm) return null;
    const top = s.rivals.filter((r) => !RIVAL_BY_ID[r.id].open).reduce((a, r) => (r.cap > a.cap ? r : a));
    return {
      rival: RIVAL_BY_ID[top.id].name,
      model: { you: fm.cap, them: top.cap, mult: Math.pow(fm.cap / top.cap, 3.2) },
      features: { you: fm.appeal, them: rivalAppeal(s), mult: fm.appeal / rivalAppeal(s) },
      hype: { you: s.hype, them: top.hype, mult: (0.6 + (0.8 * s.hype) / 100) / (0.6 + (0.8 * top.hype) / 100) },
      price: { you: s.price, them: 20, mult: Math.pow(20 / s.price, 1.1) },
      uptime: { you: v.service, mult: Math.pow(v.service, 1.5) },
      growth: { mult: v.brand },
    };
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

  // The most useful run you could start now: a clear step up that finishes within a year.
  function bestNextRun(s, v) {
    if (s.training) return null;
    const fmCap = v.flagship ? v.flagship.cap : 0;
    const rate = Math.max(0, s.autoAlloc ? v.effPF - v.need * 1.15 : v.effPF * s.allocTrain) * v.trainMult;
    const data = {};
    for (const src of D.DATA_SOURCES) data[src.id] = !src.tech || !!s.techs[src.tech];
    let best = null;
    for (const size of D.MODEL_SIZES) {
      if (size.id === 'agi' || (size.tech && !s.techs[size.tech])) continue;
      const exp = expectedCap(s, size.id, data, v);
      const days = rate > 0 ? size.pfdays / rate : Infinity;
      if (exp < fmCap + 2 || days > 365) continue;
      if (!best || exp > best.exp) best = { size, exp, days: Math.ceil(days), cost: trainingCost(s, size.id, data) };
    }
    return best;
  }

  // ---------- funding ----------

  // How keen investors are on your next round, and why.
  function fundingView(s, v) {
    const f = s.funding;
    const round = D.ROUNDS[s.rounds.length] || null;
    const net = v.burnMonth - v.mrr;
    const runway = net <= 0 ? Infinity : Math.max(0, s.cash) / net;
    const recent = f.walkaways.filter((d) => s.day - d < 180).length;
    const out = { round, runway, recent, fit: 0, label: 'Cold', canPitch: false, why: '', base: 0, mult: 1 };
    if (!round) return out;
    out.fit = clamp(round.want(s, v) || 0, 0, 1.5);
    out.label = out.fit >= 1 ? 'Hot' : out.fit >= 0.6 ? 'Warm' : out.fit >= 0.3 ? 'Cool' : 'Cold';
    // investors pay more when you do not need them, and less when you keep walking away
    const need = runway < 3 ? 0.75 : runway < 6 ? 0.9 : runway >= 12 ? 1.05 : 1;
    out.mult = clamp(0.6 + 0.4 * out.fit, 0.6, 1.2) * need * (1 - 0.1 * Math.min(3, recent));
    out.base = v.valuation * out.mult;
    if (!s.models.length) out.why = 'Train a model first. Investors want to see something work.';
    else if (f.cd > s.day) out.why = `You can pitch again in ${f.cd - s.day} days`;
    else if (f.offers.length) out.why = 'You have term sheets on the table';
    else out.canPitch = true;
    return out;
  }

  function pushOdds(s, v, o) {
    const fv = fundingView(s, v);
    const inv = D.INVESTORS.find((i) => i.id === o.type) || { push: 0 };
    const leverage = fv.runway >= 12 ? 0.15 : fv.runway < 3 ? -0.2 : 0;
    return clamp(0.5 + 0.25 * (Math.min(fv.fit, 1.4) - 1) + leverage + inv.push, 0.15, 0.85);
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
    const prestige = clamp(bestCap(s) / 14 + s.hype / 35 + s.officeLevel * 0.5 + (s.flags.openBonus || 0), 0, 7);
    const n = 4 + Math.min(3, Math.floor((s.officeLevel + 1) / 2));
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
    for (const p of [...s.staff]) {
      if (p.founder) {
        p.morale = 100;
      } else {
        p.perk = Math.max(0, (p.perk || 0) - 0.03);
        const target = moraleTarget(s, v, p).total + p.perk;
        p.morale = clamp(p.morale + (target - p.morale) * 0.03, 0, 100);
      }
      if (p.trainUntil && p.trainUntil === s.day) {
        p.skill = Math.min(10, p.skill + 1);
        if (!p.founder) p.salary = Math.max(p.salary, salaryFor(p.role, p.skill, s.sentiment, s.day));
        news(s, `${p.name} finished training and is now skill ${p.skill}.`, 'good', true);
      }
      if (!p.founder && p.morale < 25 && random() < 0.01) {
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
      const pace = def.pace * D.DIFFICULTY[s.difficulty || 'normal'].pace;
      r.progress += (pace / 365) * push * (0.85 + 0.15 * s.sentiment);
      r.hype += (45 - r.hype) * 0.01;
      if (s.day < r.nextRelease) continue;
      const target = def.cap0 + (100 - def.cap0) * Math.pow(Math.min(1, r.progress / D.TUNING.rivalYears), 0.85);
      let cap = Math.max(r.cap + 0.3, target + rand(-1.5, 1.2));
      if (def.open) cap = Math.min(cap, Math.max(...closed.map((c) => c.cap)) - 3, 95);
      cap = Math.min(s.mode === 'sandbox' ? 99.4 : 100, cap);
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
    const you = attract(fm.cap, fm.appeal, s.hype, Math.pow(20 / s.price, 1.1), Math.pow(v.service, 1.5), v.brand);
    const total = you + rivalPull(s);
    s.share = you / total;
    // the other products compete against the same rivals
    for (const pd of D.PRODUCTS) {
      const st = s.products[pd.id];
      if (!st || !st.live) continue;
      const mine = attract(fm.cap, fm.appeal, s.hype, Math.pow(pd.price / st.price, 1.1), Math.pow(v.service, 1.5), v.brand);
      st.share = mine / (total - you + mine);
      st.target = v.market * pd.market * st.share;
      if (st.users < st.target) st.users += (st.target - st.users) * 0.03 * v.growthMult + 0.2;
      else st.users -= (st.users - st.target) * 0.04;
      st.users = Math.max(0, st.users);
    }
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
        if (s.runway) s.runway.booked += c.monthly / 30;
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
    if (gain > 0 && random() < 0.006 * (1 - 0.6 * sat(v.E, 20))) {
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
    s.flags.lastTrainEnd = s.day;
    s.reveal = m.id; // the UI shows a launch reveal for this model
    news(s, `${m.name} finished training. OmniBench score: ${cap.toFixed(1)}.`, 'good');
    if (size.id === 'agi') {
      const al = alignment(s, v);
      const text = {
        aligned: `${m.name} is the first artificial general intelligence, and the world trusts it. ${s.company} won the race the right way.`,
        uneasy: `${m.name} is the first artificial general intelligence. ${s.company} won the race, but regulators and the public are uneasy about what comes next.`,
        reckless: `${m.name} is the first artificial general intelligence. ${s.company} won the race, and nobody, including you, is sure what you have built.`,
      }[al.ending];
      checkGoals(s);
      endGame(s, true, text, al.ending);
    }
  }

  // ---------- events ----------

  function maybeEvent(s, v) {
    // a quiet first month and a half so new players can find their feet
    if (s.day < 45 || s.events.length || random() > 1 / 18) return;
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
    let r = random() * total;
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
    log(s, 'choice', { id: ev.id, label: choice.label });
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
      revenue: m.rev + m.crev + (m.prev || 0),
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

  function endGame(s, win, text, ending) {
    if (s.over) return;
    s.over = { win, text, day: s.day, ending: ending || null };
    news(s, text, win ? 'goal' : 'bad');
    if (hooks.over) hooks.over(s);
  }

  // ---------- the daily tick ----------

  function tick(s) {
    if (s.over && !s.over.sandbox) return;
    if (s.runway && s.runway.meeting) return; // the board is meeting
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
    s.cash += v.productRevenue / 30;
    s.month.prev += v.productRevenue / 30;
    if (s.runway) s.runway.booked += (v.subRevenue + v.productRevenue) / 30;
    if (!s.training && s.models.length) s.stats.idleDays = (s.stats.idleDays || 0) + 1;
    contractsDaily(s, v);

    s.rp += v.rpDay;

    const pay = v.payroll / 30, rent = v.rent / 30, power = v.powerCostDay;
    s.cash -= pay + rent + power;
    s.month.salaries += pay;
    s.month.rent += rent;
    s.month.power += power;

    s.hype = clamp(s.hype + (5 - s.hype) * 0.012 * (1 - 0.4 * sat(v.G, 15)), 0, 100);
    renewCampaigns(s);

    staffDaily(s, v);
    if (s.day - s.candidatesDay >= 7) refreshCandidates(s);
    const f = s.funding;
    if (f.offers.length && s.day > f.offers[0].expires) {
      news(s, `Your ${f.offers[0].name} term sheets expired.`, 'warn');
      f.offers = [];
      f.cd = s.day + 30;
    }

    v = derive(s);
    if (v.flagship && v.flagship.cap > (v.topRival ? v.topRival.cap : 0)) s.flags.wasSota = true;
    s.stats.peakSubs = Math.max(s.stats.peakSubs, s.subs);
    s.stats.peakMrr = Math.max(s.stats.peakMrr, v.mrr);

    maybeEvent(s, v);
    checkGoals(s);
    if (monthKey(s.day) !== s.monthKey) closeMonth(s, v);

    if (s.cash < 0 && s.mode !== 'sandbox') {
      s.stats.negDays++;
      if (s.runway) {
        // on Runway the board only looks at the books when the quarter ends
        if (s.stats.negDays === 1) news(s, 'You are out of cash. Be back above zero when the quarter ends, or the board shuts you down.', 'bad', true);
      } else {
        if (s.stats.negDays === 1) news(s, 'You are out of cash. Raise money or cut costs within 90 days.', 'bad', true);
        if (s.stats.negDays === 75) news(s, '15 days until bankruptcy.', 'bad', true);
        if (s.stats.negDays >= 90) endGame(s, false, `${s.company} ran out of money and shut down.`);
      }
    } else {
      if (s.stats.negDays > 0 && s.cash >= 0) s.flags.recovered = true;
      s.stats.negDays = 0;
    }
    if (s.runway && !s.over && s.day - s.runway.start >= RW.quarterDays) endQuarter(s, 'clock');
  }

  // campaigns run for their cooldown and hold a marketing slot meanwhile
  const campaignSlots = (s) => D.CAMPAIGN_SLOTS[Math.min(s.officeLevel, D.CAMPAIGN_SLOTS.length - 1)];
  // a stopped campaign gives its slot back but can't be rerun before it would have ended
  const activeCampaigns = (s) => D.CAMPAIGNS.filter((c) => (s.campaignCd[c.id] || 0) > s.day && !(s.campaignStopped && s.campaignStopped[c.id] === s.campaignCd[c.id]));
  // auto-renew restarts a finished campaign, as long as it leaves twice its cost in the bank
  function renewCampaigns(s) {
    const on = s.autoRenew || {};
    for (const c of D.CAMPAIGNS) {
      if (!on[c.id] || (s.campaignCd[c.id] || 0) > s.day) continue;
      if (s.cash < c.cost * 2 || activeCampaigns(s).length >= campaignSlots(s)) continue;
      const r = A.campaign(s, c.id);
      if (r.ok) s.log[s.log.length - 1].auto = true;
    }
  }

  // ---------- player actions (each returns { ok, msg }) ----------

  const ok = (msg) => ({ ok: true, msg });
  const no = (msg) => ({ ok: false, msg });

  const A = {
    place(s, type, x, y) {
      const blocked = canPlace(s, type, x, y);
      if (blocked) return no(blocked);
      const lock = itemLocked(s, type);
      if (lock) return no(lock);
      const cost = itemCost(s, type);
      if (s.cash < cost) return no('Not enough cash');
      s.cash -= cost;
      s.month.capex += cost;
      addItem(s, type, x, y);
      log(s, 'buy', { t: type, n: 1 });
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
      const refund = Math.round(stat(it, 'cost') * 0.5);
      s.items = s.items.filter((i) => i !== it);
      s.cash += refund;
      s.month.capex -= refund;
      log(s, 'sell', { t: it.type });
      return ok(refund);
    },

    moveOffice(s) {
      const next = D.OFFICES[s.officeLevel + 1];
      if (!next) return no('You already own the biggest campus');
      if (s.cash < next.moveCost) return no('Not enough cash');
      s.cash -= next.moveCost;
      s.month.capex += next.moveCost;
      s.officeLevel++;
      log(s, 'move', { to: next.name });
      news(s, `${s.company} moves to ${next.place}.`, 'good', true);
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
      log(s, 'hire', { role: c.role, skill: c.skill, salary: c.salary });
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
      log(s, 'fire', { role: p.role, skill: p.skill });
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
      log(s, 'course', { role: p.founder ? 'founder' : p.role, skill: p.skill });
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
      const paid = cost;
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
        cost: paid,
      };
      log(s, 'train', { name: s.training.name, data: Object.keys(clean).filter((k) => clean[k]).join('+') });
      return ok(`Training ${s.training.name}`);
    },

    cancelTraining(s) {
      if (!s.training) return no('No training run');
      const refund = Math.round((s.training.cost || 0) / 2);
      s.cash += refund;
      s.month.data -= refund;
      news(s, `Training of ${s.training.name} was cancelled.${refund ? ' Half the data cost came back.' : ''}`, 'warn');
      log(s, 'cancel', { name: s.training.name });
      s.training = null;
      s.flags.lastTrainEnd = s.day;
      return ok(refund ? `Run cancelled. ${refund.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} of the data cost refunded.` : 'Run cancelled.');
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
        // the leading lab answers
        const rival = s.rivals.filter((r) => !RIVAL_BY_ID[r.id].open).reduce((a, r) => (r.cap > a.cap ? r : a));
        if (s.day - (s.flags.lastCounter || -999) > 120) {
          s.flags.lastCounter = s.day;
          rival.nextRelease = Math.min(rival.nextRelease, s.day + randi(20, 45));
          rival.progress += 0.04;
          news(s, `${RIVAL_BY_ID[rival.id].name} is rushing out a response to ${m.name}.`, 'warn', true);
        }
      }
      s.hype = Math.min(100, s.hype + gain);
      s.flags.lastDeploy = s.day;
      log(s, 'deploy', { name: m.name, cap: m.cap });
      news(s, msg + '.', 'good');
      return ok(msg);
    },

    openSource(s, id) {
      const m = s.models.find((x) => x.id === id);
      if (!m || m.open) return no('Already open');
      if (m.id === s.flagshipId) return no('Deploy a different flagship first');
      if (m.size === 'agi') return no('Absolutely not');
      m.open = true;
      log(s, 'open', { name: m.name });
      const gain = Math.min(12, m.cap * 0.25);
      s.hype = Math.min(100, s.hype + gain);
      s.flags.openBonus = Math.min(1.5, (s.flags.openBonus || 0) + 0.3);
      const open = s.rivals.find((r) => RIVAL_BY_ID[r.id].open);
      open.cap = Math.max(open.cap, round1(m.cap - 1));
      news(s, `${s.company} releases the weights of ${m.name}. Developers cheer.`, 'good');
      return ok(`${m.name} is now open source`);
    },

    setPrice(s, p) {
      const from = s.price;
      s.price = clamp(Math.round(p), 5, 60);
      if (s.price !== from) log(s, 'price', { from, to: s.price });
      return ok();
    },

    setAlloc(s, auto, share) {
      const before = s.autoAlloc + ':' + s.allocTrain;
      s.autoAlloc = !!auto;
      if (share != null) s.allocTrain = clamp(share, 0, 1);
      if (before !== s.autoAlloc + ':' + s.allocTrain) {
        const last = s.log && s.log[s.log.length - 1];
        if (last && last.a === 'alloc' && last.d === s.day) s.log.pop();
        log(s, 'alloc', { auto: s.autoAlloc, share: s.allocTrain });
      }
      return ok();
    },

    campaign(s, id) {
      const c = D.CAMPAIGNS.find((x) => x.id === id);
      if ((c.minOffice || 0) > s.officeLevel) return no(`Needs ${D.OFFICES[c.minOffice].name}`);
      const left = (s.campaignCd[id] || 0) - s.day;
      if (left > 0) return no(activeCampaigns(s).some((x) => x.id === id) ? 'Already running' : `Ready again in ${left} days`);
      if (activeCampaigns(s).length >= campaignSlots(s)) return no('Every marketing slot is busy');
      if (s.cash < c.cost) return no('Not enough cash');
      s.cash -= c.cost;
      s.month.marketing += c.cost;
      const v = derive(s);
      const boost = c.deployBoost && s.flags.lastDeploy != null && s.day - s.flags.lastDeploy <= 30 ? 1.6 : 1;
      const gain = c.hype * (1 - s.hype / 120) * boost * (1 + 0.3 * sat(v.G, 15));
      s.hype = Math.min(100, s.hype + gain);
      s.campaignCd[id] = s.day + c.cd;
      log(s, 'campaign', { id });
      return ok(`${c.name}: +${gain.toFixed(1)} hype`);
    },

    setAutoRenew(s, id, on) {
      if (!D.CAMPAIGNS.some((c) => c.id === id)) return no('Unknown campaign');
      s.autoRenew = s.autoRenew || {};
      s.autoRenew[id] = !!on;
      return ok();
    },

    // free the slot now and stop renewing; the hype already gained stays
    stopCampaign(s, id) {
      if (!activeCampaigns(s).some((c) => c.id === id)) return no('Not running');
      s.campaignStopped = s.campaignStopped || {};
      s.campaignStopped[id] = s.campaignCd[id];
      if (s.autoRenew) s.autoRenew[id] = false;
      return ok();
    },

    // Pitching brings back up to three competing term sheets, or none if
    // investors are not interested yet.
    pitch(s) {
      const f = s.funding;
      const v = derive(s);
      const fv = fundingView(s, v);
      if (!fv.round) return no('There is nothing left to raise');
      if (f.offers.length) return no('You already have term sheets on the table');
      if (!fv.canPitch) return no(fv.why);
      f.pitches++;
      const n = fv.fit >= 1 ? 3 : fv.fit >= 0.6 ? 2 : fv.fit >= 0.3 ? 1 : 0;
      if (!n) {
        f.cd = s.day + 30;
        log(s, 'pitch', { round: fv.round.name, offers: 0 });
        return ok(`Investors passed on your ${fv.round.name}. They want to see ${fv.round.wantText}.`);
      }
      // a cool reception only gets the friendliest fund, and a smaller check
      const types = n === 1 ? [D.INVESTORS[1]] : D.INVESTORS.slice().sort(() => random() - 0.5).slice(0, n);
      f.offers = types.map((inv, i) => {
        const pre = fv.base * rand(inv.val[0], inv.val[1]);
        const typical = Math.max(fv.round.min, (pre * fv.round.dil) / (1 - fv.round.dil));
        const raise = typical * rand(inv.size[0], inv.size[1]) * (n === 1 ? 0.5 : 1);
        return {
          oid: 'o' + s.nextId++, type: inv.id, kind: inv.kind, investor: pick(inv.names), perk: inv.perk,
          round: fv.round.id, name: fv.round.name, pre, raise, dilution: raise / (pre + raise), pushed: false, expires: s.day + 14,
        };
      });
      log(s, 'pitch', { round: fv.round.name, offers: n });
      return ok(`${n} term sheet${n === 1 ? '' : 's'} for your ${fv.round.name}`);
    },

    acceptOffer(s, oid) {
      const f = s.funding;
      const o = f.offers.find((x) => x.oid === oid) || (oid == null && f.offers[0]);
      if (!o) return no('That offer is gone');
      s.cash += o.raise;
      s.month.funding += o.raise;
      s.equity *= 1 - o.dilution;
      s.rounds.push(o.round);
      s.hype = Math.min(100, s.hype + 4);
      if (o.perk === 'hype') s.hype = Math.min(100, s.hype + 12);
      if (o.perk === 'cloud') {
        const pf = Math.max(20, derive(s).effPF * 0.3);
        s.cloud = { pf: Math.max(pf, s.cloud && s.cloud.until > s.day ? s.cloud.pf : 0), until: s.day + 365 };
      }
      if (o.round === 'ipo') s.flags.public = true;
      log(s, 'raise', { round: o.name, investor: o.investor, raise: Math.round(o.raise), pre: Math.round(o.pre), dil: Math.round(o.dilution * 1000) / 10 });
      f.last = { day: s.day, round: o.name, raise: o.raise, pre: o.pre };
      f.offers = [];
      f.walkaways = [];
      news(s, `${s.company} closes its ${o.name}, led by ${o.investor}.`, 'good', true);
      return ok();
    },

    // Ask for a higher valuation. It works more often when you do not need the money.
    pushOffer(s, oid) {
      const f = s.funding;
      const o = f.offers.find((x) => x.oid === oid);
      if (!o) return no('That offer is gone');
      if (o.pushed) return no('You already pushed this investor');
      const odds = pushOdds(s, derive(s), o);
      o.pushed = true;
      if (random() < odds) {
        o.pre *= 1.2;
        o.dilution = o.raise / (o.pre + o.raise);
        log(s, 'push', { investor: o.investor, won: true });
        return ok(`${o.investor} agreed: now ${money(o.pre)} before the money, ${(o.dilution * 100).toFixed(1)}% of the company.`);
      }
      f.offers = f.offers.filter((x) => x !== o);
      f.walkaways.push(s.day); // investors talk: losing one at the table costs you like walking away
      log(s, 'push', { investor: o.investor, won: false });
      if (!f.offers.length) f.cd = s.day + 30;
      news(s, `${o.investor} walked away from the table.`, 'warn');
      return no(`${o.investor} walked away.`);
    },

    // Turn down every offer. Investors remember for a while.
    walkAway(s) {
      const f = s.funding;
      if (!f.offers.length) return no('No offers to turn down');
      const best = f.offers.reduce((a, o) => (o.raise > a.raise ? o : a));
      f.last = { day: s.day, round: best.name, raise: best.raise, pre: best.pre, declined: true };
      log(s, 'walk', { round: best.name, n: f.offers.length });
      f.offers = [];
      f.walkaways.push(s.day);
      f.cd = s.day + 30;
      return ok('You walked away. Investors will take your call again in 30 days.');
    },

    sandbox(s) {
      if (s.over) s.over.sandbox = true;
      return ok();
    },

    // Runway: end the quarter early once its quota is met
    ringBell(s) {
      const r = s.runway;
      if (!r || r.meeting || s.over) return no('No quarter is running');
      if (r.booked < quotaFor(r.q)) return no('The quota is not met yet');
      endQuarter(s, 'bell');
      return ok();
    },

    // Runway: leave the board meeting. After Q8, 'ipo' ends the run with an IPO
    // and 'endless' keeps going with quotas that grow every quarter.
    closeMeeting(s, choice) {
      const r = s.runway;
      if (!r || !r.meeting) return no('No meeting');
      const m = r.meeting;
      r.meeting = null;
      if (m.ipo) {
        if (choice === 'endless') {
          r.endless = true;
          news(s, `${s.company} stays private and keeps growing.`, 'good', true);
        } else endGame(s, true, `${s.company} rang the opening bell after ${m.q} quarters. You took it public.`, 'ipo');
      }
      return ok();
    },

    launchProduct(s, id) {
      const pd = D.PRODUCTS.find((p) => p.id === id);
      const st = s.products[id];
      if (!pd || !st) return no('Unknown product');
      if (st.live) return no('Already live');
      if (!s.techs[pd.tech]) return no(`Research ${D.TECH_BY_ID[pd.tech].name} first`);
      if (!s.flagshipId) return no('Deploy a model first');
      if (s.cash < pd.launch) return no('Not enough cash');
      s.cash -= pd.launch;
      s.month.marketing += pd.launch;
      st.live = true;
      s.hype = Math.min(100, s.hype + 5);
      log(s, 'launch', { id });
      news(s, `${s.company} launches ${pd.name}.`, 'good', true);
      return ok(`${pd.name} is live`);
    },

    setProductPrice(s, id, price) {
      const pd = D.PRODUCTS.find((p) => p.id === id);
      const st = s.products[id];
      if (!pd || !st) return no('Unknown product');
      const from = st.price;
      st.price = clamp(Math.round(price), pd.minPrice, pd.maxPrice);
      if (st.price !== from) log(s, 'pprice', { id, from, to: st.price });
      return ok();
    },
  };

  const trainCostFor = (p) => Math.max(2000, Math.round((p.salary || 6000) * 1.5));

  AIT.Sim = {
    newGame, tick, derive, actions: A, campaignSlots, activeCampaigns, fundingView, pushOdds, priceCurve, productCurve, bestNextRun, impact, moraleTarget, shareFactors, migrate, VERSION, align, alignment,
    sizeOf, stat, itemAt, occupied, canPlace, gap, seating, rivalBoost, hooks, news, addEffect, effectMult, itemCost, itemLocked,
    expectedCap, trainingCost, salaryFor, trainCostFor, eventView, resolveEvent, endGame, makeCandidate,
    dateOf, flagship, topRival, marketSize, techTotals, refreshCandidates, quotaFor, quarterView, runwayCleared,
    util: { clamp, rand, randi, pick, sat, round1, random },
    seed,
    rngState: () => rngState,
    RIVAL_BY_ID,
  };
})(typeof window !== 'undefined' ? window : globalThis);
