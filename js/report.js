/* A compact report of one playthrough, for sending to Claude to analyze. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA, Sim = AIT.Sim;
  const r0 = (x) => Math.round(x);
  const r1 = (x) => Math.round(x * 10) / 10;

  function build(s) {
    if (!s.runId) s.runId = 'run-' + Date.now().toString(36);
    const v = Sim.derive(s);
    const date = (d) => Sim.dateOf(d).toISOString().slice(0, 10);
    const counts = {};
    for (const it of s.items) counts[it.type] = (counts[it.type] || 0) + 1;

    const timeline = [];
    for (const [id, d] of Object.entries(s.goals || {})) timeline.push({ d, what: 'goal: ' + ((D.GOALS.find((g) => g.id === id) || {}).text || id) });
    for (const [id, d] of Object.entries(s.techs || {})) timeline.push({ d, what: 'research: ' + ((D.TECH_BY_ID[id] || {}).name || id) });
    for (const m of s.models) timeline.push({ d: m.day, what: `model: ${m.name} scored ${m.cap}` });
    for (const [id, d] of Object.entries(s.chapters || {})) if (d > 0) timeline.push({ d, what: 'chapter: ' + id });
    for (const e of s.log || []) timeline.push({ d: e.d, what: 'action: ' + describe(e) });
    timeline.sort((a, b) => a.d - b.d);

    return {
      id: s.runId,
      sentAt: new Date().toISOString(),
      company: s.company,
      result: s.over ? { win: s.over.win, text: s.over.text, ending: s.over.ending || null, date: date(s.over.day) } : null,
      mode: s.mode || 'standard',
      difficulty: s.difficulty || 'normal',
      seed: s.seed != null ? s.seed : null,
      inGameDate: date(s.day),
      yearsPlayed: r1(s.day / 365),
      playMinutes: r0((s.playMs || 0) / 60000),
      daysWithoutTraining: s.stats.idleDays || 0,
      final: {
        cash: r0(s.cash),
        daysWithNegativeCash: s.stats.negDays,
        equityPct: r1(s.equity * 100),
        valuation: r0(v.valuation),
        office: v.office.name,
        subscribers: r0(s.subs),
        peakSubscribers: r0(s.stats.peakSubs),
        marketSharePct: r1((s.share || 0) * 100),
        pricePerMonth: s.price,
        hype: r0(s.hype),
        sentiment: r1(s.sentiment),
        monthlyRevenue: r0(v.mrr),
        monthlyCosts: r0(v.burnMonth),
        payroll: r0(v.payroll),
        rent: v.office.rent,
        powerBillMonth: r0(v.powerCostDay * 30),
        computePF: r1(v.effPF),
        rawPF: r1(v.pf),
        powerUsedKw: r1(v.power),
        powerCapKw: r1(v.powerCap),
        heatKw: r1(v.heat),
        coolingKw: r1(v.cooling),
        gpus: v.computeItems,
        overheatingGpus: v.hotItems,
        computeLostToHeatPct: r0((1 - v.thermal) * 100),
        researchersNearWhiteboardPct: (() => {
          const rs = s.staff.filter((p) => p.role === 'researcher');
          return rs.length ? r0((100 * rs.filter((p) => (v.seatInfo.get(p.id) || {}).board > 0).length) / rs.length) : null;
        })(),
        servicePct: r0(v.service * 100),
        researchPoints: r0(s.rp),
        rpPerDay: r1(v.rpDay),
        flagship: v.flagship ? { name: v.flagship.name, score: v.flagship.cap } : null,
        bestScore: v.bestCap,
        training: s.training ? { name: s.training.name, progressPct: r0((s.training.done / s.training.need) * 100) } : null,
        autoAlloc: s.autoAlloc,
        roundsRaised: s.rounds,
        funding: { pitches: s.funding.pitches, walkaways: s.funding.walkaways.length, offersOnTable: s.funding.offers.length },
        contracts: s.contracts.length,
        staff: s.staff.map((p) => ({ role: p.founder ? 'founder' : p.role, skill: p.skill, salary: p.salary, morale: r0(p.morale) })),
        items: counts,
        techs: Object.keys(s.techs),
        alignment: v.alignment,
        products: D.PRODUCTS.map((p) => ({ id: p.id, live: !!(s.products && s.products[p.id] && s.products[p.id].live), price: s.products && s.products[p.id] ? s.products[p.id].price : null, customers: r0((v.products[p.id] || {}).users || 0), revenue: r0((v.products[p.id] || {}).revenue || 0) })),
      },
      rivals: s.rivals.map((r) => ({ name: Sim.RIVAL_BY_ID[r.id].name, score: r.cap, version: r.version })),
      models: s.models.map((m) => ({ name: m.name, score: m.cap, trained: date(m.day), open: !!m.open })),
      monthly: s.history.map((h) => ({
        month: h.label, cash: r0(h.cash), revenue: r0(h.revenue), costs: r0(h.costs), capex: r0(h.capex),
        funding: r0((h.detail && h.detail.funding) || 0), products: r0((h.detail && h.detail.prev) || 0), subs: h.subs, mrr: r0(h.mrr), valuation: r0(h.valuation),
      })),
      timeline: timeline.map((e) => ({ date: date(e.d), what: e.what })),
      news: s.news.map((n) => ({ date: date(n.day), kind: n.kind, text: n.text })),
      mentor: s.mentor ? { tutorialDone: !!s.mentor.done, tutorialStep: s.mentor.step, tipsSeen: Object.keys(s.mentor.seen || {}), off: !!s.mentor.off } : null,
    };
  }

  function describe(e) {
    switch (e.a) {
      case 'buy': return `bought ${e.n} × ${e.t}`;
      case 'sell': return `sold ${e.t}`;
      case 'move': return `moved to ${e.to}`;
      case 'hire': return `hired ${e.role} (skill ${e.skill}, $${e.salary}/mo)`;
      case 'fire': return `fired ${e.role} (skill ${e.skill})`;
      case 'course': return `sent ${e.role} on a course (skill ${e.skill})`;
      case 'train': return `started training ${e.name} (data: ${e.data || 'scraped only'})`;
      case 'cancel': return `cancelled training ${e.name}`;
      case 'deploy': return `deployed ${e.name} (${e.cap})`;
      case 'open': return `open-sourced ${e.name}`;
      case 'price': return `price $${e.from} → $${e.to}`;
      case 'alloc': return e.auto ? 'compute split: auto' : `compute split: manual ${Math.round(e.share * 100)}% training`;
      case 'campaign': return `ran campaign ${e.id}`;
      case 'raise': return `raised ${e.round}${e.investor ? ` from ${e.investor}` : ''}: $${e.raise} at $${e.pre} pre (${e.dil}% dilution)`;
      case 'decline': return `declined ${e.round} term sheet`;
      case 'pitch': return `pitched ${e.round}: ${e.offers} offer${e.offers === 1 ? '' : 's'}`;
      case 'push': return `asked ${e.investor} for a better price: ${e.won ? 'they agreed' : 'they walked away'}`;
      case 'walk': return `walked away from ${e.n} ${e.round} offer${e.n === 1 ? '' : 's'}`;
      case 'choice': return `event ${e.id}: chose "${e.label}"`;
      case 'launch': return `launched product ${e.id}`;
      case 'pprice': return `${e.id} price $${e.from} → $${e.to}`;
      default: return e.a;
    }
  }

  AIT.Report = { build };
})(typeof window !== 'undefined' ? window : globalThis);
