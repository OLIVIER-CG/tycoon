/* A reasonable, placement-aware bot. Used by tools/simulate.js for balance
   checks and by the test suite. It plays through the same actions a player
   uses, so it only ever sees what the rules allow. */
const COMPUTE = ['rig', 'workstation', 'server', 'rack', 'superpod', 'wafer'];
const COOLING = ['fan', 'ac', 'chiller', 'liquid', 'immersion'];
const POWER = ['battery', 'substation', 'turbine', 'smr'];
const STAFF_TARGET = [3, 8, 20, 40, 70];
const TECH_PRIORITY = ['scaling_laws', 'flash_attention', 'rlhf', 'distributed', 'quantization', 'code_models', 'synthetic_data', 'moe', 'long_context', 'liquid_cooling', 'distillation', 'constitutional', 'multimodal', 'custom_silicon', 'frontier_scaling', 'reasoning', 'speculative', 'agents', 'immersion', 'interpretability', 'ultrascale', 'wafer_scale', 'self_improvement', 'agi_theory', 'nuclear', 'data_flywheel'];

function createBot(AIT) {
  const { DATA: D, Sim } = AIT;
  const A = Sim.actions;
  const best = (s, list) => list.filter((t) => !Sim.itemLocked(s, t)).slice(-1)[0];
  // strongest compute the budget covers; skip tiers far below the best unlocked one
  const affordableCompute = (s, budget) => {
    const open = COMPUTE.filter((t) => !Sim.itemLocked(s, t));
    const topPf = D.ITEMS[open[open.length - 1]].pf;
    return open.filter((t) => D.ITEMS[t].pf * 20 >= topPf && Sim.itemCost(s, t) <= budget).slice(-1)[0];
  };
  const N = (s) => D.OFFICES[s.officeLevel].size;

  // nearest free anchor tile to (cx, cy) that fits the item
  function nearest(s, type, cx, cy) {
    const occ = Sim.occupied(s);
    const n = N(s);
    let bestTile = null, bestD = Infinity;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d >= bestD || Sim.canPlace(s, type, x, y, occ)) continue;
        bestD = d;
        bestTile = [x, y];
      }
    }
    return bestTile;
  }

  const centroid = (items, fallback) => {
    if (!items.length) return fallback;
    const sx = items.reduce((a, i) => a + i.x, 0), sy = items.reduce((a, i) => a + i.y, 0);
    return [Math.round(sx / items.length), Math.round(sy / items.length)];
  };
  const computeSpot = (s) => [N(s) - 2, 1];
  const deskSpot = (s) => centroid(s.items.filter((i) => i.type === 'desk'), [1, N(s) - 2]);

  // try an item on a tile without paying for it
  function tryItem(s, type, x, y) {
    s.items.push({ id: -1, type, x, y });
    const v = Sim.derive(s);
    s.items.pop();
    return v;
  }

  // nearest tile to (cx, cy) where a new GPU adds most of its compute after heat
  function coolSpot(s, type, [cx, cy]) {
    const occ = Sim.occupied(s);
    const n = N(s), base = Sim.derive(s).effPF, want = D.ITEMS[type].pf * 0.85;
    const tiles = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!Sim.canPlace(s, type, x, y, occ)) tiles.push([x, y, Math.abs(x - cx) + Math.abs(y - cy)]);
    tiles.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of tiles.slice(0, 40)) if (tryItem(s, type, x, y).effPF - base >= want) return [x, y];
    return null;
  }

  // free tile near the compute corner whose cooling radius covers the most open floor
  function openSpot(s, type) {
    const occ = Sim.occupied(s);
    const n = N(s), [cx, cy] = computeSpot(s), r = D.ITEMS[type].radius || 1;
    let bestTile = null, bestScore = -Infinity;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (Sim.canPlace(s, type, x, y, occ)) continue;
        let free = 0;
        for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (xx >= 0 && yy >= 0 && xx < n && yy < n && !occ.has(xx + ',' + yy)) free++;
        const score = free - 0.5 * (Math.abs(x - cx) + Math.abs(y - cy));
        if (score > bestScore) {
          bestScore = score;
          bestTile = [x, y];
        }
      }
    }
    return bestTile;
  }

  function placeAt(s, type, spot) {
    let t = nearest(s, type, spot[0], spot[1]);
    if (!t) {
      // make room by selling the weakest compute item
      const weak = s.items.filter((i) => COMPUTE.includes(i.type)).sort((a, b) => Sim.stat(a, 'pf') - Sim.stat(b, 'pf'))[0];
      if (!weak || (COMPUTE.includes(type) && Sim.stat(weak, 'pf') * 4 >= D.ITEMS[type].pf)) return false;
      A.sell(s, weak.id);
      t = nearest(s, type, spot[0], spot[1]);
    }
    return !!t && A.place(s, type, t[0], t[1]).ok;
  }

  // put a cooler within range of the hottest GPU, or report that there is no room
  function coolHottest(s, v) {
    let hot = null, f = 1;
    for (const it of s.items) {
      const h = v.itemHeat.get(it.id);
      if (h != null && h < f) {
        f = h;
        hot = it;
      }
    }
    if (!hot) return false;
    const c = best(s, COOLING);
    if (s.cash < Sim.itemCost(s, c)) return false;
    const r = D.ITEMS[c].radius || 1, n = D.ITEMS[c].size || 1, hs = Sim.sizeOf(hot);
    const occ = Sim.occupied(s);
    let spot = null, bestD = Infinity;
    for (let x = hot.x - r - n + 1; x <= hot.x + hs + r - 1; x++) {
      for (let y = hot.y - r - n + 1; y <= hot.y + hs + r - 1; y++) {
        if (Sim.canPlace(s, c, x, y, occ)) continue;
        const d = Sim.gap({ type: c, x, y }, hot);
        if (d <= r && d < bestD) {
          bestD = d;
          spot = [x, y];
        }
      }
    }
    return !!spot && A.place(s, c, spot[0], spot[1]).ok;
  }

  return function step(s, log = () => {}) {
    while (s.events.length) {
      const { id, params } = s.events[0];
      const choice = { data_deal: params.cost < s.cash * 0.2 ? 0 : 1, price_war: s.cash > params.cost * 4 ? 1 : 2 }[id] || 0;
      Sim.resolveEvent(s, choice);
    }
    let v = Sim.derive(s);

    for (const id of TECH_PRIORITY) {
      const t = D.TECH_BY_ID[id];
      if (s.techs[id] || !t.req.every((r) => s.techs[r])) continue;
      if (s.rp >= t.cost) {
        A.research(s, id);
        log(`research ${t.name}`);
      }
      break;
    }

    const top = s.models.slice().sort((a, b) => b.cap - a.cap)[0];
    if (top && top.id !== s.flagshipId) {
      A.deploy(s, top.id);
      log(`deploy ${top.name} cap ${top.cap}`);
    }

    for (const pd of D.PRODUCTS) {
      const st = s.products[pd.id];
      if (!st.live && s.techs[pd.tech] && s.flagshipId && s.cash > pd.launch * 3 && A.launchProduct(s, pd.id).ok) log(`launch ${pd.name}`);
    }

    if (!s.training) {
      const sizes = D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech]).reverse();
      for (const size of sizes) {
        const rate = Math.max(0.01, (v.effPF - v.need * 1.15) * v.trainMult);
        const days = size.pfdays / rate;
        const flagCap = v.flagship ? v.flagship.cap : 0;
        if (size.id === 'agi') {
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
        if (Sim.trainingCost(s, size.id, data) > s.cash * 0.5) continue;
        if (A.startTraining(s, size.id, data).ok) log(`train ${size.name} (${days.toFixed(0)}d)`);
        break;
      }
    }

    if (s.offer) {
      log(`raise ${s.offer.name}`);
      A.acceptOffer(s);
    } else if (D.ROUNDS[s.rounds.length] && D.ROUNDS[s.rounds.length].req(s, v)) A.pitch(s);

    v = Sim.derive(s);
    const reserve = Math.max(0, v.burnMonth - v.mrr) * 4 + v.burnMonth + 5000;

    const next = D.OFFICES[s.officeLevel + 1];
    if (next && s.cash > next.moveCost + reserve + next.rent * 6 && v.power > v.office.power * 0.6) {
      if (A.moveOffice(s).ok) log(`move to ${next.name}`);
    }

    if (s.staff.length < STAFF_TARGET[s.officeLevel] && s.cash > reserve * 1.5) {
      if (v.seats <= s.staff.length) placeAt(s, 'desk', deskSpot(s));
      const need = { researcher: 0.45, engineer: 0.3, growth: 0.15, safety: 0.1 };
      const have = {};
      for (const p of s.staff) have[p.role] = (have[p.role] || 0) + 1;
      const cand = s.candidates.slice().sort((a, b) => need[b.role] * s.staff.length - (have[b.role] || 0) - (need[a.role] * s.staff.length - (have[a.role] || 0)) || b.skill - a.skill)[0];
      if (cand && s.cash > cand.salary * 8) A.hire(s, cand.id);
    }
    v = Sim.derive(s);
    const mood = Sim.moraleTarget(s, v);
    if (s.staff.length > 1 && mood.comfort < 16 && s.cash > reserve) placeAt(s, s.officeLevel >= 1 ? 'coffee' : 'plant', deskSpot(s));
    if (s.officeLevel >= 1 && v.boardBonus < 0.3 && v.boards < 12 && s.cash > reserve * 2) placeAt(s, 'whiteboard', deskSpot(s));

    for (let i = 0; i < 6 && v.hotItems > 0; i++) {
      if (!coolHottest(s, v)) break;
      v = Sim.derive(s);
    }
    if (v.power > v.powerCap * 0.92) {
      const p = best(s, POWER);
      if (p && s.cash > Sim.itemCost(s, p) + reserve) placeAt(s, p, [N(s) - 2, N(s) - 2]);
    }

    for (let i = 0; i < 20; i++) {
      v = Sim.derive(s);
      const c = affordableCompute(s, s.cash - reserve);
      if (!c) break;
      if (v.power + D.ITEMS[c].power > v.powerCap) break;
      let spot = coolSpot(s, c, computeSpot(s));
      if (!spot) {
        // swap out old, weak hardware before building more cooling
        const weak = s.items.filter((it) => (COMPUTE.includes(it.type) && Sim.stat(it, 'pf') * 6 < D.ITEMS[c].pf) || it.type === 'fan');
        weak.sort((a, b) => Sim.stat(a, 'pf') - Sim.stat(b, 'pf'));
        for (const it of weak.slice(0, 4)) A.sell(s, it.id);
        if (weak.length) spot = coolSpot(s, c, computeSpot(s));
      }
      if (!spot) {
        // no cooled room left: add the best cooler where it covers the most open floor
        const cool = best(s, COOLING);
        if (s.cash < Sim.itemCost(s, cool) + Sim.itemCost(s, c) + reserve) break;
        const cs = openSpot(s, cool);
        if (!cs || !A.place(s, cool, cs[0], cs[1]).ok) break;
        spot = coolSpot(s, c, cs);
        if (!spot) break;
      }
      if (!A.place(s, c, spot[0], spot[1]).ok) break;
    }

    if ((s.campaignCd.thread || 0) <= s.day) A.campaign(s, 'thread');
    for (const c of D.CAMPAIGNS.slice(1)) if ((s.campaignCd[c.id] || 0) <= s.day && s.cash > c.cost * 30) A.campaign(s, c.id);
  };
}

module.exports = { createBot };
