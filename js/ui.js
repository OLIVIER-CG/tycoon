/* DOM interface: status bar, screen rail and panel, build dock, overlays and modals. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA, Sim = AIT.Sim, A = Sim.actions, Progress = AIT.Progress, F = AIT.FLAVOR;
  const sfx = (name) => AIT.Sound && AIT.Sound.play(name);

  // ---------- formatting ----------
  const scaled = (a, units, small) => {
    for (const [u, s] of units) {
      if (a >= u) {
        const x = a / u;
        return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + s;
      }
    }
    return small(a);
  };
  const fmt = (AIT.fmt = {
    money(n) {
      const sign = n < 0 ? '-' : '';
      return sign + '$' + scaled(Math.abs(n), [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']], (a) => Math.round(a).toString());
    },
    num(n) {
      return scaled(Math.abs(n), [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']], (a) => Math.round(a).toString());
    },
    pf(n) {
      if (n < 1000) return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' PF';
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + ' EF';
      return (n / 1e6).toFixed(2) + ' ZF';
    },
    pfdays: (n) => fmt.num(n) + ' PF-days',
    kw(n) {
      if (n < 1000) return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' kW';
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + ' MW';
      return (n / 1e6).toFixed(2) + ' GW';
    },
    date: (day) => Sim.dateOf(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    pct: (x, dp = 0) => (x * 100).toFixed(dp) + '%',
    // real time spent playing
    dur(ms) {
      const min = Math.round((ms || 0) / 60000);
      if (min < 1) return '&lt;1 min'; // always inserted as HTML
      if (min < 60) return min + ' min';
      return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
    },
  });
  const money = fmt.money;
  const an = (w) => (/^(?:[AEIOU]|XL)/i.test(w) ? 'an' : 'a');
  // "Treasure Island" is both the office and the place; say it once
  const where = (o, sep = ' · ') => (o.name === o.place ? esc(o.name) : `${esc(o.name)}${sep}${esc(o.place)}`);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pctTxt = (x) => {
    const p = Math.abs(x * 100);
    return (p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%';
  };
  const days = (n) => (n === Infinity ? 'never' : n > 3650 ? '10+ years' : Math.ceil(n) + ' days');

  const ui = {
    screen: 'hq',
    winOpen: false,
    winBuilt: null,
    title: false,
    titlePanel: null,
    saveSel: null,
    lastList: [],
    buildCat: 'compute',
    train: { size: null, data: { licensed: true, synthetic: true, human: true } },
    techFilter: 'all',
    tabs: {},
    trayOpen: false,
    helpOpen: {},
    openTiers: {},
    techSel: null,
    teamFilter: 'all',
    newsFilter: 'all',
    expanded: {},
    confirm: null,
    lastHtml: '',
    lastDock: '',
    interacting: false,
    lastPanel: 0,
    lastHud: 0,
    modal: null,
    overShown: false,
    placeWarnAt: 0,
    chapters: [],
    ng: { mode: 'standard', difficulty: 'normal' },
    resumeSpeed: null,
    fbDraft: '',
    notifOpen: false,
  };
  const $ = (id) => document.getElementById(id);
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  const G = () => AIT.game;
  // Compare with the markup we last wrote, not el.innerHTML: the browser
  // re-serializes it (<path/> becomes <path></path>), so that check always
  // failed, rebuilt the rail every frame and swallowed clicks mid-press.
  const written = new WeakMap();
  const set = (id, html) => {
    const el = $(id);
    if (!el || written.get(el) === html) return;
    el.innerHTML = html;
    written.set(el, html);
  };

  // ---------- small building blocks ----------
  const bar = (r, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, r * 100)).toFixed(1)}%"></i></div>`;
  function meter(label, used, cap, f, warnAt = 0.85, coach = '') {
    const r = cap > 0 ? used / cap : used > 0 ? 2 : 0;
    const cls = r > 1 ? 'bad' : r > warnAt ? 'warn' : 'ok';
    return `<div class="meter ${cls}"${coach ? ` data-coach="${coach}"` : ''}><div class="meter-top"><span>${label}</span><span class="mono">${f(used)} / ${f(cap)}</span></div>${bar(r)}</div>`;
  }
  const disabled = (b) => (b ? ' disabled' : '');
  const confirmBtn = (key, label, confirmLabel, cls = '') =>
    `<button class="btn ${cls}${ui.confirm === key ? ' danger' : ''}" data-act="confirm" data-key="${key}">${ui.confirm === key ? confirmLabel : label}</button>`;
  const kpi = (k, v, d = '', cls = '') => `<div class="kpi"><div class="k">${k}</div><div class="v mono ${cls}">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;

  function sparkline(values, w, h, cls = '') {
    if (values.length < 2) return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((y, i) => [(i / (values.length - 1)) * w, h - 4 - ((y - min) / span) * (h - 10)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${h - 4}" x2="${w}" y2="${h - 4}" class="axis"/>
      <path d="${line} L${w} ${h - 4} L0 ${h - 4} Z" class="area"/>
      <path d="${line}" class="line"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" class="end"/>
    </svg>`;
  }

  // Revenue at every price, with your price and the best one marked. All marks share one scale.
  function priceChart(points, current, unit = '') {
    if (points.length < 2) return '';
    const W = 360, H = 132, L = 10, R = 10, T = 16, B = 22;
    const xs = points.map((p) => p.price), ys = points.map((p) => p.revenue);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), yMax = Math.max(...ys) * 1.12 || 1;
    const X = (p) => L + ((p - x0) / (x1 - x0)) * (W - L - R);
    const Y = (r) => H - B - (r / yMax) * (H - T - B);
    const line = points.map((p, i) => (i ? 'L' : 'M') + X(p.price).toFixed(1) + ' ' + Y(p.revenue).toFixed(1)).join(' ');
    const best = points.reduce((a, p) => (p.revenue > a.revenue ? p : a));
    const now = points.reduce((a, p) => (Math.abs(p.price - current) < Math.abs(a.price - current) ? p : a));
    const ticks = [x0, Math.round((x0 + x1) / 2), x1];
    const nowRight = X(now.price) > W * 0.62;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue at each price">
      <line class="grid" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <line class="grid" x1="${L}" x2="${W - R}" y1="${Y(best.revenue).toFixed(1)}" y2="${Y(best.revenue).toFixed(1)}"/>
      <path class="area" d="${line} L${X(x1).toFixed(1)} ${H - B} L${X(x0).toFixed(1)} ${H - B} Z"/>
      <path class="line" d="${line}"/>
      <line class="now" x1="${X(now.price).toFixed(1)}" x2="${X(now.price).toFixed(1)}" y1="${T - 4}" y2="${H - B}"/>
      <circle class="best-dot" cx="${X(best.price).toFixed(1)}" cy="${Y(best.revenue).toFixed(1)}" r="4"/>
      <circle class="now-dot" cx="${X(now.price).toFixed(1)}" cy="${Y(now.revenue).toFixed(1)}" r="4"/>
      <text class="label-now" x="${(X(now.price) + (nowRight ? -6 : 6)).toFixed(1)}" y="${T + 2}" text-anchor="${nowRight ? 'end' : 'start'}">you $${now.price}${unit}</text>
      ${ticks.map((t) => `<text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${t === x0 ? 'start' : t === x1 ? 'end' : 'middle'}">$${t}</text>`).join('')}
      <text x="${W - R}" y="${(Y(best.revenue) - 5).toFixed(1)}" text-anchor="end">${money(best.revenue)}/mo</text>
    </svg>`;
  }

  function statLine(d) {
    const big = d.size > 1 ? ` · ${d.size}×${d.size}` : '';
    if (d.pf) return `${fmt.pf(d.pf)} · ${fmt.kw(d.power)}${big}`;
    if (d.cooling) return `cools ${fmt.kw(d.cooling)}${big}`;
    if (d.powerCap) return `+${fmt.kw(d.powerCap)}${big}`;
    if (d.seats) return `seats ${d.seats}`;
    if (d.rpBonus) return `+${Math.round(d.rpBonus * 100)}% RP · reach ${d.radius}`;
    if (d.decor) return `comfort +${d.decor} · reach ${d.radius}`;
    return '';
  }

  // every technology the AGI Blueprint depends on, directly or not
  const AGI_PATH = (() => {
    const need = new Set();
    const walk = (id) => {
      if (need.has(id)) return;
      need.add(id);
      D.TECH_BY_ID[id].req.forEach(walk);
    };
    walk('agi_theory');
    return need;
  })();
  const ROLE_VAR = { researcher: 'var(--role-res)', engineer: 'var(--role-eng)', growth: 'var(--role-grw)', safety: 'var(--role-saf)' };
  const roleColor = (p) => (p.founder ? 'var(--bridge)' : ROLE_VAR[p.role]);

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    hq: svg('<path d="M4 20V9.5l8-5.5 8 5.5V20"/><path d="M9.5 20v-5.5h5V20"/><path d="M3 20h18"/>'),
    build: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13.5v6M13.5 16.5h6"/>'),
    team: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.8 14.3a4.5 4.5 0 0 1 5.2 4.4"/>'),
    research: svg('<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'),
    models: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/><circle cx="12" cy="12" r="2.2"/>'),
    market: svg('<path d="M4 19.5h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M14 7h4v4"/>'),
    finance: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>'),
    race: svg('<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.2 4 2.2 4h-11"/>'),
  };
  // left toolbar: build, sell, real estate
  const TOOL_ICON = {
    compute: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 10.5h7"/><circle cx="12" cy="16" r="1.4" fill="currentColor"/>'),
    sell: svg('<path d="M3.5 12.5l8-8h8v8l-8 8z"/><circle cx="15.5" cy="8.5" r="1.6"/>'),
    build: svg('<path d="M14.5 4.5l5 5-2.5 2.5-5-5z" fill="currentColor"/><path d="M12 7l-8.5 8.5a1.8 1.8 0 0 0 2.5 2.5L14.5 9.5"/>'),
    building: svg('<path d="M4 21V6l8-3v18"/><path d="M12 9l8 3v9"/><path d="M7 9h2M7 12.5h2M7 16h2M15 14.5h2M15 18h2"/><path d="M2.5 21h19"/>'),
  };
  // bottom bar
  const STAT_ICON = {
    people: svg('<circle cx="9" cy="8" r="3.2" fill="currentColor"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0z" fill="currentColor"/><circle cx="17" cy="9" r="2.4" fill="currentColor"/><path d="M14.8 14.2a4.6 4.6 0 0 1 6.2 4.4v.9h-5.2" fill="currentColor"/>'),
    subs: svg('<circle cx="12" cy="8" r="3.5" fill="currentColor"/><path d="M5 20a7 7 0 0 1 14 0z" fill="currentColor"/>'),
    compute: TOOL_ICON.compute,
    wallet: svg('<rect x="3" y="6.5" width="18" height="13" rx="2.5" fill="currentColor"/><path d="M5 6.5l10-3 1.5 3" /><rect x="14.5" y="11" width="6.5" height="4.5" rx="1.5" fill="var(--hud)" stroke="none"/>'),
  };
  const CAT_VAR = { compute: 'var(--cat-compute)', cooling: 'var(--cat-cooling)', power: 'var(--cat-power)', office: 'var(--cat-office)', comfort: 'var(--cat-comfort)' };
  const CAMP_ICON = {
    thread: svg('<path d="M4 5h16v11H10l-6 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    influencer: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
    launch: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 8.5l5 2.5-5 2.5z" fill="currentColor"/><path d="M8 20.5h8"/>'),
    billboard: svg('<rect x="3" y="4" width="18" height="10" rx="1.5"/><path d="M8 14v7M16 14v7M6 21h12"/>'),
    keynote: svg('<circle cx="12" cy="7" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4"/><path d="M3 21h18"/>'),
    bigad: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 3l4 3 4-3"/><path d="M7 21h10"/>'),
  };

  // ---------- toasts ----------
  function toast(text, kind = 'info') {
    const box = $('toasts');
    if (!box) return;
    ui.lastPanel = 0; // something happened; refresh the panel on the next frame
    if (kind === 'unlock' || kind === 'goal') sfx('unlock');
    else if (kind === 'bad') sfx('error');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 2) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------- what deserves attention, most urgent first ----------
  // Each: { kind: bad|warn|good|info, text, go, cta }
  const cheapestTech = (s) => D.TECHS.filter((t) => !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];
  function suggestions(s, v) {
    const out = [];
    const add = (kind, text, go, cta) => out.push({ kind, text, go, cta });
    const fm = v.flagship;
    if (s.stats.negDays > 0) add('bad', `Out of cash: ${90 - s.stats.negDays} days before the company folds.`, 'finance', 'Money');
    if (v.thermal < 1) add(v.thermal < 0.9 ? 'bad' : 'warn', `Too hot: every GPU runs at ${fmt.pct(v.thermal)}. Add cooling.`, 'build:cooling', 'Cooling');
    if (v.powerFactor < 1) add('warn', `Power limit: GPUs run at ${fmt.pct(v.powerFactor)}. Add power.`, 'build:power', 'Power');
    if (fm && v.service < 0.95) add('bad', `Only ${fmt.pct(v.service)} of users get served. Add GPUs or train less.`, 'models', 'Models');
    if (s.funding.offers.length) add('good', `${s.funding.offers.length} term sheet${s.funding.offers.length === 1 ? ' is' : 's are'} waiting, ${s.funding.offers[0].expires - s.day} days left.`, 'finance:funding', 'Review');
    if (!s.training && !s.models.length) add('info', 'Train your first model in Models.', 'models:train', 'Models');
    else if (!fm && s.models.length) add('info', 'Deploy your model so people can subscribe.', 'models:library', 'Deploy');
    else if (fm) {
      const best = s.models.slice().sort((a, b) => b.cap - a.cap)[0];
      if (best && best.cap > fm.cap + 0.5) add('info', `${best.name} (${best.cap.toFixed(1)}) beats your live model.`, 'models:library', 'Deploy');
      else if (!s.training) {
        const run = Sim.bestNextRun(s, v);
        if (run) add(v.idleDays > 20 ? 'warn' : 'info', `Train ${an(run.size.name)} ${run.size.name} model: about ${Math.round(run.exp)} (yours ${fm.cap.toFixed(0)}), ${run.days} days, ${money(run.cost)} of data.`, 'models:run', 'Train');
        else {
          // nothing better finishes within a year: say what is in the way
          const size = D.MODEL_SIZES.find((m) => !m.fixedCost && m.base > fm.cap + 2);
          if (size && size.tech && !s.techs[size.tech]) add('info', `${size.name} models need ${D.TECH_BY_ID[size.tech].name} from R&D.`, 'research', 'R&D');
          else if (size) {
            const days = Math.round(size.pfdays / Math.max(0.01, trainRate(s, v)));
            const nextOffice = D.OFFICES[s.officeLevel + 1];
            const faster = nextOffice && Object.values(D.ITEMS).find((d) => d.pf && d.minOffice === s.officeLevel + 1);
            add(
              v.idleDays > 20 ? 'warn' : 'info',
              `${an(size.name) === 'an' ? 'An' : 'A'} ${size.name} model would take ${days > 3650 ? 'over ten years' : days.toLocaleString('en-US') + ' days'} on your compute. ${faster ? `Add GPUs, or move to ${nextOffice.place} for ${faster.name}s.` : 'Add GPUs to train it within a year.'}`,
              faster ? 'hq:office' : 'build:compute',
              faster ? 'Offices' : 'GPUs',
            );
          }
        }
      }
    }
    const t = cheapestTech(s);
    if (t && s.rp >= t.cost && Progress.has(s, 'tab:research')) add('info', `You can afford ${t.name} (${t.cost.toLocaleString('en-US')} RP).`, 'research', 'R&D');
    if (Progress.has(s, 'cat:office') && s.staff.length >= v.seats && s.cash > 25000) add('info', 'Every desk is taken. Build a desk to hire more.', 'build:office', 'Desks');
    const fv = Sim.fundingView(s, v);
    if (fv.canPitch && fv.fit >= 1 && Progress.has(s, 'tab:finance')) add('good', `Investors are keen on your ${fv.round.name}. Raising is optional.`, 'finance:funding', 'Pitch');
    const next = D.OFFICES[s.officeLevel + 1];
    // suggest a move when the building is filling up, or when it can't train anything better
    const outgrown = v.power > v.powerCap * 0.6 || (fm && !s.training && !Sim.bestNextRun(s, v));
    if (next && Progress.has(s, 'office:next') && s.cash >= next.moveCost * 1.5 && outgrown) add('info', `You can afford the ${next.name} in ${next.place}.`, 'hq:office', 'Look');
    const pd = fm && D.PRODUCTS.find((p) => s.techs[p.tech] && !s.products[p.id].live && s.cash > p.launch * 2);
    if (pd) add('info', `${pd.name} is ready to launch.`, 'market:products', 'Launch');
    if (fm && Progress.has(s, 'tab:market') && s.subs > 200) {
      const curve = Sim.priceCurve(s, v, [s.price, ...priceSteps(5, 60)]);
      const best = curve.slice(1).reduce((a, p) => (p.revenue > a.revenue ? p : a));
      if (best.revenue > curve[0].revenue * 1.2) add('info', `At $${best.price} a month, subscriptions would earn about ${pctTxt(best.revenue / curve[0].revenue - 1)} more.`, 'market:pricing', 'Price');
    }
    const team = s.staff.filter((p) => !p.founder);
    if (team.length >= 2 && team.reduce((a, p) => a + p.morale, 0) / team.length < 45) add('warn', 'Your team is unhappy. Comfort items near their desks help.', 'build:comfort', 'Comfort');
    return out;
  }
  const priceSteps = (a, b, step = 1) => {
    const out = [];
    for (let p = a; p <= b; p += step) out.push(p);
    return out;
  };

  // ---------- windows ----------
  // Each window has tabs, a line of help and four numbers along the bottom.
  const SCREENS = {
    hq: {
      name: 'Company', icon: ICON.hq, render: renderHQ,
      tabs: [['overview', 'Overview'], ['office', 'Real estate'], ['goals', 'Goals']],
      help: 'Your company at a glance. Next steps lists what needs you, with a button that takes you there. Real estate is where you move to a bigger office.',
      stats: (s, v) => [['Cash', money(s.cash)], ['Profit', `${v.profitMonth >= 0 ? '+' : ''}${money(v.profitMonth)}/mo`], ['Valuation', money(v.valuation)], ['Goals', `${Object.keys(s.goals).length} / ${D.GOALS.length}`]],
    },
    team: {
      name: 'Team', icon: ICON.team, render: renderTeam,
      tabs: [['staff', 'Staff'], ['hire', 'Hiring']],
      help: 'Researchers earn research points, engineers speed up training and serving, growth staff win users and safety staff prevent scandals. Everyone needs a desk. Tap a person to see what they add.',
      stats: (s, v) => {
        const team = s.staff.filter((p) => !p.founder);
        const avg = team.length ? team.reduce((a, p) => a + p.morale, 0) / team.length : 100;
        return [['People', s.staff.length], ['Payroll', money(v.payroll) + '/mo'], ['Morale', Math.round(avg) + '%'], ['Free desks', Math.max(0, v.seats - s.staff.length)]];
      },
    },
    research: {
      name: 'Research', icon: ICON.research, render: renderResearch,
      tabs: [['avail', 'Available'], ['all', 'All technologies'], ['path', 'Path to AGI']],
      help: 'Spend research points on technology. It unlocks bigger models, faster hardware, new products and better offices. A blue dot marks the path to the AGI Blueprint.',
      stats: (s, v) => [['Research points', Math.floor(s.rp).toLocaleString('en-US')], ['Per day', '+' + v.rpDay.toFixed(1)], ['Researched', `${Object.keys(s.techs).length} / ${D.TECHS.length}`], ['Path to AGI', `${[...AGI_PATH].filter((id) => s.techs[id]).length} / ${AGI_PATH.size}`]],
    },
    models: {
      name: 'Models', icon: ICON.models, render: renderModels,
      tabs: [['train', 'Train'], ['library', 'Library'], ['compute', 'Compute split']],
      help: 'Pick a model size and training data, then spend compute on it. Runs are measured in PF-days. Deploy the best model so people can subscribe.',
      stats: (s, v) => [['Live model', v.flagship ? v.flagship.cap.toFixed(1) : '–'], ['Top rival', v.topRival ? v.topRival.cap.toFixed(1) : '–'], ['Compute', fmt.pf(v.effPF)], ['Training', s.training ? fmt.pct(s.training.done / s.training.need) : 'idle']],
    },
    market: {
      name: 'Market', icon: ICON.market, render: renderMarket,
      tabs: [['pricing', 'Pricing'], ['marketing', 'Marketing'], ['products', 'Products'], ['deals', 'Deals']],
      help: 'Set your price with the revenue chart, see what decides your share against the leader, run campaigns for hype and launch new products.',
      stats: (s, v) => [['Subscribers', fmt.num(s.subs)], ['Market share', fmt.pct(s.share || 0, 1)], ['Revenue', money(v.mrr) + '/mo'], ['Hype', Math.round(s.hype) + ' / 100']],
    },
    finance: {
      name: 'Money', icon: ICON.finance, render: renderFinance,
      tabs: [['overview', 'Overview'], ['funding', 'Funding']],
      help: 'Raising money is optional: you sell part of the company for cash to grow faster. The part you keep is your score at the end.',
      stats: (s, v) => [['Cash', money(s.cash)], ['Profit', `${v.profitMonth >= 0 ? '+' : ''}${money(v.profitMonth)}/mo`], ['Valuation', money(v.valuation)], ['Your stake', `${fmt.pct(s.equity, 1)} · ${money(v.netWorth)}`]],
    },
    race: {
      name: 'The race', icon: ICON.race, render: renderRace,
      tabs: [['board', 'Leaderboard'], ['alignment', 'Alignment'], ['news', 'News']],
      help: 'The first lab to 100 on OmniBench builds AGI and wins. Alignment decides how the world greets it.',
      stats: (s, v) => {
        const lead = Math.max(v.bestCap, v.topRival ? v.topRival.cap : 0);
        return [['Your best', v.bestCap.toFixed(1)], ['Leader', lead.toFixed(1)], ['Alignment', v.alignment.total + ' / 100'], ['Year', (s.day / 365 + 1).toFixed(0)]];
      },
    },
  };
  const screenOpen = (s, id) => id === 'hq' || Progress.has(s, 'tab:' + id);
  const tabOf = (id) => {
    const sc = SCREENS[id];
    if (!sc.tabs.some(([t]) => t === ui.tabs[id])) ui.tabs[id] = sc.tabs[0][0];
    return ui.tabs[id];
  };

  // office pictures are drawn once per office and company name
  const previews = new Map();
  const preview = (level, name) => {
    const key = level + '|' + name;
    if (!previews.has(key)) previews.set(key, AIT.Render.officePreview(level, name));
    return previews.get(key);
  };

  function renderHQ(s, v, tab) {
    if (tab === 'office') return renderOffice(s, v);
    if (tab === 'goals') return renderGoals(s);
    const chapter = F.CHAPTERS.slice().reverse().find((c) => s.chapters && s.chapters[c.id] != null) || F.CHAPTERS[0];
    const net = v.burnMonth - v.mrr;
    const runway = net <= 0 ? 'profitable' : Math.max(0, s.cash) / net > 36 ? '3+ years' : Math.floor(Math.max(0, s.cash) / net) + ' months';
    const list = suggestions(s, v);
    const rows = list.length
      ? `<div class="list">${list
          .slice(0, 6)
          .map((x) => `<div class="item-row sugg-row ${x.kind}"><span class="dotmark"></span><span class="grow text">${esc(x.text)}</span><button class="btn small" data-go="${x.go}">${x.cta}</button></div>`)
          .join('')}</div>`
      : '<div class="empty">Nothing needs you right now. Speed up time or plan your next move.</div>';
    const fm = v.flagship, top = v.topRival;
    const t = s.training;
    const training = t
      ? `<div class="stack tight"><div class="row between"><b>${esc(t.name)}</b><span class="mono small">${fmt.pct(t.done / t.need)}</span></div>${bar(t.done / t.need, 'blue')}<div class="small muted">Expected score about ${t.exp.toFixed(0)}.</div></div>`
      : (() => {
          const run = fm && Sim.bestNextRun(s, v);
          return run
            ? `<div class="row between gap"><div class="small">${an(run.size.name) === 'an' ? 'An' : 'A'} <b>${run.size.name}</b> run would score about <b>${Math.round(run.exp)}</b> in ${run.days} days for ${money(run.cost)} of data.</div><button class="btn small primary" data-go="models:run">Plan it</button></div>`
            : `<div class="small muted">Nothing is training. Idle GPUs only earn a trickle of research.</div>`;
        })();
    const raceRows = [
      { name: s.company, cap: fm ? fm.cap : 0, color: 'var(--bridge)' },
      ...(top ? [{ name: Sim.RIVAL_BY_ID[top.id].name, cap: top.cap, color: Sim.RIVAL_BY_ID[top.id].color }] : []),
    ];
    const hist = s.history.slice(-24);
    const goal = D.GOALS.find((g) => !s.goals[g.id]);
    return `
      <div class="hq-hero">
        <img src="${preview(s.officeLevel, s.company)}" alt="">
        <div class="grow">
          <div class="eyebrow">Chapter ${chapter.num} · ${esc(chapter.title)}</div>
          <div class="big">${esc(s.company)}</div>
          <div class="small">${where(v.office, ', ')} · ${fmt.date(s.day)} · ${s.staff.length} ${s.staff.length === 1 ? 'person' : 'people'} · ${esc(modeLabel(s))}</div>
        </div>
      </div>
      <div class="cols wide-left">
        <div class="stack">
          <div class="section-label"><h3>Next steps</h3><span class="tag">${list.length} open</span></div>
          ${rows}
          <section class="card"><div class="card-head"><h3>Training</h3><button class="btn small ghost" data-go="models">Models</button></div>${training}</section>
        </div>
        <div class="stack">
          <div class="kpis">
            ${kpi('Cash lasts', runway, `${money(v.mrr)} in, ${money(v.burnMonth)} out`)}
            ${kpi('Subscribers', fmt.num(s.subs), `${fmt.pct(s.share || 0, 1)} share`)}
          </div>
          ${fm ? `<section class="card"><div class="card-head"><h3>The race</h3><span class="tiny faint">first to 100 wins</span></div><div class="race-mini">${raceRows.map((r) => `<div class="race-line"><span class="nm">${esc(r.name)}</span><span class="track"><i style="width:${r.cap}%;background:${r.color}"></i></span><span class="mono small">${r.cap.toFixed(1)}</span></div>`).join('')}</div></section>` : ''}
          ${hist.length >= 2 ? `<section class="card"><div class="card-head"><h3>Last ${hist.length} months</h3></div><div class="kpis"><div><div class="eyebrow">Cash</div>${sparkline(hist.map((h) => h.cash), 160, 60)}</div><div><div class="eyebrow">Subscribers</div>${sparkline(hist.map((h) => h.subs), 160, 60, 'bay')}</div></div></section>` : ''}
          ${goal ? `<section class="card"><div class="card-head"><div><div class="eyebrow">Goal ${Object.keys(s.goals).length + 1} of ${D.GOALS.length}</div><h3>${goal.text}</h3></div></div><div class="small muted">${goal.hint}</div></section>` : ''}
        </div>
      </div>`;
  }

  function renderGoals(s) {
    const next = D.GOALS.find((g) => !s.goals[g.id]);
    return `<ol class="goal-list">${D.GOALS.map((g, i) => {
      const done = s.goals[g.id] != null;
      return `<li class="${done ? 'done' : g === next ? 'now' : ''}"><span class="n">${done ? '✓' : i + 1}</span><div><div><b>${g.text}</b></div><div class="h">${done ? 'Done ' + fmt.date(s.goals[g.id]) : g.hint}</div></div></li>`;
    }).join('')}</ol>
      <p class="note">Each goal pays a small reward when you reach it. They follow the story from the garage to AGI.</p>`;
  }

  // Real estate: the office you have, the next one, and the whole city
  function heatBlock(s, v) {
    return `${meter('Heat vs cooling', v.heat, v.cooling, fmt.kw, 0.85, 'heat')}
      ${v.thermal < 1 ? `<div class="callout bad"><b>Too hot: every GPU runs at ${fmt.pct(v.thermal)} speed.</b>Add cooling: Build › Cooling. Where it stands doesn't matter.</div>` : ''}`;
  }
  function renderOffice(s, v) {
    const o = v.office, next = D.OFFICES[s.officeLevel + 1];
    let nextHtml = next ? '' : '<section class="card"><p class="note">You own the whole island. There is nowhere bigger to go.</p></section>';
    if (next && Progress.has(s, 'office:next')) {
      const after = s.cash - next.moveCost;
      const net = v.burnMonth - v.rent + next.rent - v.mrr;
      const note = s.cash < next.moveCost ? `You need ${money(next.moveCost - s.cash)} more. Earn it, or raise it in Money.` : net <= 0 ? 'You would still turn a profit after the move.' : `After the move your cash would last about ${Math.max(0, Math.floor(after / net))} months at the new rent.`;
      const risky = s.cash >= next.moveCost && net > 0 && after / net < 6;
      nextHtml = `
        <section class="card accent">
          <div class="row between"><div><div class="eyebrow">Next office · ${esc(next.place)}</div><div class="place" style="font:800 21px/1.15 var(--display)">${esc(next.name)}</div></div><span class="tag">${next.size}×${next.size}</span></div>
          <p class="note">${esc(next.blurb)}</p>
          <dl class="kv"><div><dt>Power</dt><dd>${fmt.kw(next.power)}</dd></div><div><dt>Building cooling</dt><dd>${fmt.kw(next.cooling)}</dd></div><div><dt>Rent</dt><dd>${money(next.rent)}/mo</dd></div><div><dt>Move</dt><dd>${money(next.moveCost)}</dd></div></dl>
          <div class="callout ${risky ? 'warn' : ''}">${note}</div>
          <button class="btn ${ui.confirm === 'move' ? 'danger' : 'primary'} wide" data-act="confirm" data-key="move"${disabled(s.cash < next.moveCost)}>${ui.confirm === 'move' ? `Confirm: move for ${money(next.moveCost)}` : `Move to ${esc(next.place)} · ${money(next.moveCost)}`}</button>
        </section>`;
    } else if (next) {
      nextHtml = `
        <section class="card">
          <div class="row between"><div><div class="eyebrow">Next office · ${esc(next.place)}</div><div class="place" style="font:800 21px/1.15 var(--display)">${esc(next.name)}</div></div><span class="tag">Not yet</span></div>
          <p class="note">${esc(next.blurb)}</p>
          <div class="callout">${esc(Progress.officeWhy(s))}</div>
        </section>`;
    }
    const estate = D.OFFICES.map((x, i) => {
      const cls = i === s.officeLevel ? 'here' : i === s.officeLevel + 1 ? 'next' : i > s.officeLevel ? 'future' : '';
      const status = i === s.officeLevel ? '<span class="tag ok">You are here</span>' : i < s.officeLevel ? '<span class="tag">Moved out</span>' : i === s.officeLevel + 1 ? '<span class="tag accent">Next</span>' : '<span class="tag">Later</span>';
      return `<div class="estate-card ${cls}"><img src="${preview(i, s.company)}" alt="" loading="lazy"><div class="in"><div class="row between"><span class="nm">${esc(x.name)}</span>${status}</div><div class="tiny muted">${esc(x.place)} · ${x.size}×${x.size} · ${fmt.kw(x.power)}</div><div class="tiny muted">${x.rent ? money(x.rent) + '/mo rent' : 'no rent'}${x.moveCost ? ' · ' + money(x.moveCost) + ' to move' : ''}</div></div></div>`;
    }).join('');
    return `
      <div class="cols">
        <section class="card office-card">
          <div class="row between"><div><div class="eyebrow">You are here · ${esc(o.place)}</div><div class="place">${esc(o.name)}</div></div><span class="tag">${o.size}×${o.size}</span></div>
          <p class="note">${esc(o.blurb)}</p>
          ${meter('Power draw', v.power, v.powerCap, fmt.kw)}
          ${heatBlock(s, v)}
          ${Progress.has(s, 'cat:office') ? meter('Desks used', s.staff.length, v.seats, (n) => n, 1.01) : ''}
          <dl class="kv"><div><dt>Usable compute</dt><dd>${fmt.pf(v.effPF)}</dd></div><div><dt>Raw compute</dt><dd>${fmt.pf(v.pf)}</dd></div><div><dt>Rent</dt><dd>${money(v.rent)}/mo</dd></div><div><dt>Power bill</dt><dd>${money(v.powerCostDay * 30)}/mo</dd></div></dl>
        </section>
        ${nextHtml}
      </div>
      <div class="section-label" style="--cat:var(--cat-office)"><h3>The city</h3><span class="tiny">${s.officeLevel + 1} of ${D.OFFICES.length}</span></div>
      <div class="estate">${estate}</div>`;
  }

  // the build tray: the shelf of one category, opened from the left toolbar
  function renderDock(s) {
    const v = Sim.derive(s);
    const cats = D.ITEM_CATS.filter((c) => Progress.has(s, 'cat:' + c.id));
    if (!cats.some((c) => c.id === ui.buildCat)) ui.buildCat = 'compute';
    const all = Object.entries(D.ITEMS).filter(([, d]) => d.cat === ui.buildCat);
    const locked = all.filter(([t]) => Sim.itemLocked(s, t));
    const items = all.filter(([t]) => !Sim.itemLocked(s, t) || t === (locked[0] && locked[0][0]));
    const tool = AIT.Render.tool;
    const mini = (label, used, cap, f, coach = '') => {
      const r = cap > 0 ? used / cap : used > 0 ? 2 : 0;
      return `<div class="dock-meter ${r > 1 ? 'bad' : ''}"${coach ? ` data-coach="${coach}"` : ''}><div class="top"><span>${label}</span><b>${f(used)} / ${f(cap)}</b></div>${bar(Math.min(1, r), r > 1 ? 'bad' : r > 0.85 ? 'warn' : 'ok')}</div>`;
    };
    return `
      <div class="dock-bar">
        <div class="dock-cats" role="tablist" aria-label="Item category">${cats.map((x) => `<button class="dock-cat${x.id === ui.buildCat ? ' on' : ''}" role="tab" aria-selected="${x.id === ui.buildCat}" data-act="cat" data-cat="${x.id}" data-id="${x.id}">${x.name}</button>`).join('')}</div>
        <div class="dock-meters">
          ${mini('Power', v.power, v.powerCap, fmt.kw)}
          ${mini('Heat', v.heat, v.cooling, fmt.kw, 'heat')}
          ${Progress.has(s, 'cat:office') ? mini('Desks', s.staff.length, v.seats, (n) => n) : ''}
        </div>
        ${locked.length > 1 ? `<span class="tiny" style="color:var(--hud-ink-2)">+${locked.length - 1} more later</span>` : ''}
        <button class="dock-x" data-act="close-tray" aria-label="Close">×</button>
      </div>
      <div class="dock-items">
        ${items
          .map(([type, d]) => {
            const lock = Sim.itemLocked(s, type);
            const cost = Sim.itemCost(s, type);
            const sel = tool && tool.mode === 'place' && tool.type === type;
            return `<button class="dock-item${sel ? ' on' : ''}${lock ? ' locked' : ''}" style="--cat:${CAT_VAR[d.cat]}" data-act="tool" data-id="${type}" data-item="${type}" title="${esc(d.desc)}">
              ${lock ? '<span class="tag accent next-tag">Next</span>' : ''}
              <img src="${AIT.Render.icon(type)}" alt="" width="56" height="56">
              <span class="nm">${d.name}</span>
              <span class="st">${statLine(d)}</span>
              ${lock ? `<span class="lk">${lock}</span>` : `<span class="pr${s.cash < cost ? ' short' : ''}">${money(cost)}${cost !== d.cost ? '*' : ''}</span>`}
            </button>`;
          })
          .join('')}
      </div>`;
  }

  // the left toolbar: build, sell and real estate. Categories are tabs on the build shelf.
  function renderTools(s) {
    const tool = AIT.Render.tool;
    const selling = !!(tool && tool.mode === 'sell');
    const html = `<button class="tool-btn${ui.trayOpen && !selling ? ' on' : ''}" data-act="build" aria-label="Build">${TOOL_ICON.build}<span class="lbl">Build</span></button>
      <button class="tool-btn sell${selling ? ' on' : ''}" data-act="sellmode" aria-label="Sell items">${TOOL_ICON.sell}<span class="lbl">${selling ? 'Selling: tap an item' : 'Sell'}</span></button>
      ${Progress.has(s, 'office:next') || s.officeLevel > 0 ? `<button class="tool-btn" data-go="hq:office" aria-label="Real estate">${TOOL_ICON.building}<span class="lbl">Real estate</span></button>` : ''}`;
    set('tools', html);
  }

  // Team: what everyone adds, and who to hire next
  function describeImpact(s, v, role, imp, adding, salary, founder) {
    const who = founder ? 'you' : 'them';
    const effects = [];
    let now = '';
    let verdict = null;
    if (role === 'researcher') {
      effects.push(`+${imp.rp.toFixed(1)} RP/day`);
      if (imp.quality >= 0.001) effects.push(`+${pctTxt(imp.quality)} model quality`);
      const t = cheapestTech(s);
      if (t && s.rp < t.cost && v.rpDay > 0) {
        const other = adding ? v.rpDay + imp.rp : Math.max(0.01, v.rpDay - imp.rp);
        const need = t.cost - s.rp;
        const diff = Math.round(Math.abs(need / v.rpDay - need / other));
        now = adding ? `Gets you to ${t.name} about ${diff} days sooner.` : `Without ${who}, ${t.name} arrives ${diff} days later.`;
      } else now = 'Research points unlock bigger models and better hardware.';
    } else if (role === 'engineer') {
      effects.push(`+${pctTxt(imp.train)} training speed`, `+${pctTxt(imp.infer)} users per GPU`);
      if (s.training && v.trainPF > 0) {
        const left = s.training.need - s.training.done;
        const rate = v.trainPF * v.trainMult;
        const other = adding ? rate * (1 + imp.train) : rate / (1 + imp.train);
        const diff = Math.round(Math.abs(left / rate - left / other));
        now = adding ? `Your current run would finish about ${diff} days sooner.` : `Without them, your current run takes ${diff} days longer.`;
      } else if (v.flagship) now = 'Lets the same GPUs serve more users. Helps most while you train.';
      else {
        now = 'Only helps once you are training or serving a model.';
        verdict = ['warn', 'Not useful yet'];
      }
    } else if (role === 'growth') {
      effects.push(`+${pctTxt(imp.brand)} market share`, `users arrive ${pctTxt(imp.growth)} faster`);
      if (v.flagship) {
        const sh = s.share || 0;
        const you = adding ? sh * (1 + imp.brand) : sh / (1 + imp.brand);
        const sh2 = you / (you + (1 - sh));
        const subs = Math.abs(sh2 - sh) * v.market;
        const rev = subs * v.arpu;
        now = `About ${fmt.num(subs)} subscribers (${money(rev)}/mo) with your current model.`;
        verdict = rev >= salary ? ['ok', 'Pays for themselves'] : ['warn', 'Earns less than their salary'];
      } else {
        now = 'Only helps once a model is live.';
        verdict = ['warn', 'Not useful yet'];
      }
    } else if (role === 'safety') {
      effects.push(`−${pctTxt(imp.scandal)} scandal risk`, 'raises alignment');
      now = v.flagship ? 'Fewer jailbreak scandals, and a better ending if you reach AGI.' : 'Matters once a model is live.';
      if (!v.flagship) verdict = ['warn', 'Not useful yet'];
    }
    return { effects, now, verdict };
  }
  const fxList = (d) => `<div class="fx-list">${d.effects.map((e) => `<span class="fx">${e}</span>`).join('')}</div>`;
  const skillDots = (n) => `<span class="skill" title="Skill ${n} of 10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const moodBar = (m) => `<span class="mini-bar" title="Morale ${Math.round(m)}%"><i style="width:${Math.round(m)}%;background:${m < 35 ? 'var(--bad)' : m < 55 ? 'var(--warn)' : 'var(--good)'}"></i></span>`;

  function hireAdvice(s, v) {
    if (!v.flagship) return 'No model is live yet. Researchers and engineers help you build one. Growth and safety staff can wait.';
    const f = Sim.shareFactors(s, v);
    if (f && f.model.mult < 0.3) return `Your model trails ${f.rival} (${f.model.you.toFixed(1)} vs ${f.model.them.toFixed(1)}). Researchers, engineers and GPUs matter more than growth staff right now.`;
    if (v.payroll > Math.max(v.mrr, 1) * 2 && s.cash < v.burnMonth * 6) return 'Payroll is already well above revenue. Hire only when it clearly pays off.';
    return 'Growth staff pay off once your model is competitive. Engineers help most while you train.';
  }

  function renderTeam(s, v, tab) {
    const free = v.seats - s.staff.length;
    const team = s.staff.filter((p) => !p.founder);
    const avg = team.length ? team.reduce((a, p) => a + p.morale, 0) / team.length : 100;
    const mood = Sim.moraleTarget(s, v);
    const nextIn = 7 - (s.day - s.candidatesDay);
    const refreshCost = 2000 * (1 + s.officeLevel * 2);
    const counts = { researcher: 0, engineer: 0, growth: 0, safety: 0 };
    for (const p of s.staff) counts[p.role]++;
    const roles = [
      ['researcher', 'Research', `${v.rpStaff.toFixed(1)} RP/day`],
      ['engineer', 'Engineering', v.E > 0 ? `training +${pctTxt(v.trainMult / (1 + v.tech.train) - 1)}` : 'none yet'],
      ['growth', 'Growth', v.G > 0 ? `share +${pctTxt(v.brand - 1)}` : 'none yet'],
      ['safety', 'Safety', v.S > 0 ? `scandals −${pctTxt(1 - Math.exp(-v.S / 12))}` : 'none yet'],
    ];
    const filter = ui.teamFilter;
    const shown = s.staff.filter((p) => filter === 'all' || p.role === filter);
    const staff = shown
      .map((p) => {
        const r = D.ROLES[p.role];
        const away = p.trainUntil > s.day;
        const open = !!ui.expanded[p.id];
        const d = describeImpact(s, v, p.role, Sim.impact(s, v, { remove: p.id }), false, p.salary, p.founder);
        const cost = Sim.trainCostFor(p);
        return `<div class="item-row clickable${open ? ' expanded' : ''}" data-act="expand" data-id="${p.id}">
          <span class="role-badge" style="--c:${roleColor(p)}">${p.founder ? 'YOU' : r.short}</span>
          <div class="grow">
            <div class="row between"><span class="title">${esc(p.name)}</span><span class="small mono">${p.founder ? 'founder' : money(p.salary) + '/mo'}</span></div>
            <div class="sub row wrap" style="gap:8px">${skillDots(p.skill)} ${moodBar(p.morale)} <span>${away ? `on a course, ${p.trainUntil - s.day}d left` : d.effects.join(' · ')}</span></div>
            ${open ? `<div class="detail">
              <div class="small">${d.now}${d.verdict ? ` <span class="tag ${d.verdict[0]}">${d.verdict[1]}</span>` : ''}</div>
              ${p.bio ? `<div class="small muted">${esc(p.bio)}</div>` : ''}
              <div class="row wrap" style="gap:6px"><button class="btn small" data-act="train" data-id="${p.id}"${disabled(away || p.skill >= 10 || s.cash < cost)}>Send on a course · ${money(cost)}</button>${p.founder ? '' : confirmBtn('fire:' + p.id, 'Let go', 'Confirm', 'small ghost')}</div>
            </div>` : ''}
          </div>
        </div>`;
      })
      .join('');
    const cands = s.candidates
      .map((c) => {
        const r = D.ROLES[c.role];
        const d = describeImpact(s, v, c.role, Sim.impact(s, v, { add: c }), true, c.salary);
        return `<div class="cand">
          <div class="row"><span class="role-badge" style="--c:${ROLE_VAR[c.role]}">${r.short}</span>
            <div class="grow"><div class="row between"><span class="title" style="font-weight:700">${esc(c.name)}${c.star ? ' <span class="tag accent">Star</span>' : ''}</span><span class="mono small">${money(c.salary)}/mo</span></div>
            <div class="small muted row" style="gap:8px">${r.name} ${skillDots(c.skill)}</div></div></div>
          ${c.bio ? `<div class="bio">${esc(c.bio)}</div>` : ''}
          ${fxList(d)}
          <div class="small">${d.now}${d.verdict ? ` <span class="tag ${d.verdict[0]}">${d.verdict[1]}</span>` : ''}</div>
          <button class="btn primary" data-act="hire" data-id="${c.id}"${disabled(free <= 0 || s.cash < c.salary)}>${free <= 0 ? 'No free desk' : `Hire · ${money(c.salary)} signing bonus`}</button>
        </div>`;
      })
      .join('');
    if (tab === 'hire')
      return `
      <div class="row between wrap"><div class="callout grow">${hireAdvice(s, v)}</div>
        <div class="stack tight" style="align-items:flex-end"><button class="btn" data-act="refresh"${disabled(s.cash < refreshCost)}>Find more candidates · ${money(refreshCost)}</button><span class="tiny faint">New faces in ${nextIn} days · ${free} free desk${free === 1 ? '' : 's'}</span></div></div>
      ${free <= 0 ? '<div class="callout warn">Every desk is taken. Build a desk (Build › Office) before you hire.</div>' : ''}
      <div class="cand-grid">${cands || '<div class="empty">No one is looking right now.</div>'}</div>
      <p class="note">Hiring pays one month of salary as a signing bonus. Everyone needs a desk.</p>`;
    return `
      <div class="cols">
        <section class="card">
          <div class="card-head"><h3>What your team does</h3></div>
          <div class="role-grid">${roles.map(([id, n, t]) => `<div class="role-cell"><span class="role-badge" style="--c:${ROLE_VAR[id]}">${D.ROLES[id].short}</span><div><div class="t">${n} · ${counts[id]}</div><div class="d">${t}</div></div></div>`).join('')}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Morale</h3><span class="tag ${avg < 35 ? 'bad' : avg < 55 ? 'warn' : 'ok'}">${Math.round(avg)}%</span></div>
          ${team.length ? `<div class="meter ${avg < 35 ? 'bad' : avg < 55 ? 'warn' : 'ok'}"><div class="meter-top"><span>Now ${Math.round(avg)}%</span><span class="mono">heading to ${Math.round(mood.total)}%</span></div>${bar(avg / 100)}</div>
          <div class="small muted">Base 45 · comfort +${Math.round(mood.comfort)} · hype +${Math.round(mood.hype)}${mood.broke ? ' · no cash −20' : ''}. People work at ${Math.round((0.7 + (0.5 * avg) / 100) * 100)}% speed and may quit below 25%. Comfort items near desks help.</div>` : '<p class="note">Hire your first person to see morale here.</p>'}
        </section>
      </div>
      <div class="chips" role="group" aria-label="Filter by role">${[['all', 'All', s.staff.length], ['researcher', 'Research', counts.researcher], ['engineer', 'Engineering', counts.engineer], ['growth', 'Growth', counts.growth], ['safety', 'Safety', counts.safety]].map(([id, n, c]) => `<button class="chip${filter === id ? ' on' : ''}" data-act="team-filter" data-id="${id}">${n}<span class="n">${c}</span></button>`).join('')}</div>
      <div class="list">${staff || '<div class="empty">Nobody in this role yet.</div>'}</div>`;
  }

  // Research: every technology as a tile, grouped by tier
  function renderResearch(s, v, tab) {
    const reachable = D.TECHS.filter((t) => s.techs[t.id] || t.req.every((r) => s.techs[r]));
    const maxTier = Math.max(1, ...reachable.map((t) => t.tier));
    const names = { 1: 'Foundations', 2: 'Scaling up', 3: 'Serious lab', 4: 'Big league', 5: 'Frontier', 6: 'Giants', 7: 'Endgame' };
    const all = [...AGI_PATH];
    const done = all.filter((id) => s.techs[id]).length;
    const nextPath = D.TECHS.filter((t) => AGI_PATH.has(t.id) && !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];
    const filter = tab;
    const visible = (t) => {
      const avail = !s.techs[t.id] && t.req.every((r) => s.techs[r]);
      if (filter === 'avail') return avail;
      if (filter === 'path') return AGI_PATH.has(t.id);
      if (filter === 'done') return !!s.techs[t.id];
      return true;
    };
    const tiers = [1, 2, 3, 4, 5, 6, 7].filter((t) => t <= maxTier);
    const hidden = D.TECHS.filter((t) => t.tier > maxTier).length;
    const tile = (t) => {
      const isDone = !!s.techs[t.id];
      const reqOk = t.req.every((r) => s.techs[r]);
      const ready = !isDone && reqOk && s.rp >= t.cost;
      const sel = ui.techSel === t.id;
      const missing = t.req.filter((r) => !s.techs[r]).map((r) => D.TECH_BY_ID[r].name);
      const cls = ['tech', isDone ? 'done' : ready ? 'ready' : !reqOk ? 'locked' : '', AGI_PATH.has(t.id) ? 'path' : '', sel ? 'sel' : ''].join(' ');
      return `<div class="${cls}" data-act="tech" data-id="${t.id}" role="button" tabindex="0" aria-expanded="${sel}">
        <span class="nm">${t.name}</span>
        <span class="cost">${isDone ? 'Done' : t.cost.toLocaleString('en-US') + ' RP'}</span>
        ${!isDone && reqOk && !ready ? bar(Math.min(1, s.rp / t.cost), 'thin') : ''}
        ${sel ? `<span class="desc">${t.desc}</span>
          ${AGI_PATH.has(t.id) ? '<span class="tag info">On the path to AGI</span>' : ''}
          ${!reqOk ? `<span class="small warn-text">Needs ${missing.join(', ')}</span>` : ''}
          ${!isDone ? `<button class="btn small${ready ? ' primary' : ''}" data-act="research" data-id="${t.id}"${disabled(!ready)}>${ready ? `Research for ${t.cost.toLocaleString('en-US')} RP` : reqOk ? `${Math.ceil(Math.max(0, t.cost - s.rp) / Math.max(0.01, v.rpDay))} more days of research` : 'Locked'}</button>` : ''}` : ''}
      </div>`;
    };
    const sections = tiers
      .map((tier) => {
        const list = D.TECHS.filter((t) => t.tier === tier && visible(t));
        if (!list.length) return '';
        const doneN = D.TECHS.filter((t) => t.tier === tier && s.techs[t.id]).length;
        const total = D.TECHS.filter((t) => t.tier === tier).length;
        // finished tiers fold into one line so the open work stays near the top
        if (filter === 'all' && doneN === total && !ui.openTiers[tier])
          return `<button class="tier-done" data-act="open-tier" data-id="${tier}" aria-expanded="false"><span class="row"><b>Tier ${tier} · ${names[tier]}</b><span class="tag good">All ${total} done</span></span><span class="tiny faint">${list.map((t) => t.name).join(' · ')}</span></button>`;
        return `<div class="tier-head"><h3>Tier ${tier} · ${names[tier]}</h3><span class="tiny faint">${doneN}/${total}</span></div><div class="tech-grid">${list.map(tile).join('')}</div>`;
      })
      .join('');
    const sources = `<div class="align-parts"><span>people +${v.rpStaff.toFixed(1)}/day</span><span>idle GPUs +${v.rpCompute.toFixed(1)}/day</span><span>${v.boards ? `whiteboards +${Math.round(v.boardBonus * 100)}%` : 'no whiteboards yet'}</span>${v.tech.rp ? `<span>your models +${Math.round(v.tech.rp * 100)}%</span>` : ''}</div>`;
    const top =
      filter === 'path'
        ? `<div class="callout"><div class="row between"><b>${done === all.length ? 'The AGI Blueprint is yours. Start the AGI Project in Models.' : nextPath ? `Next on the path: ${nextPath.name}` : 'Every technology here leads to the AGI Blueprint.'}</b><span class="tag info">${done} of ${all.length}</span></div>${bar(done / all.length, 'info')}</div>`
        : `<div class="row between wrap">${sources}${filter === 'avail' ? '<span class="tiny faint">Tap a technology to read what it does.</span>' : ''}</div>`;
    return `${top}
      ${sections || `<div class="empty">${filter === 'avail' ? 'Nothing to research right now. Earn more research points or finish what it needs first.' : 'Nothing matches yet.'}</div>`}
      ${hidden ? `<p class="note">${hidden} more technologies appear as you get further.</p>` : ''}`;
  }

  // Models: train the next one, split compute, and manage the library
  function trainPF(s, v) {
    if (s.training) return v.trainPF;
    return s.autoAlloc ? Math.max(0, v.effPF - v.need * 1.15) : v.effPF * s.allocTrain;
  }
  const trainRate = (s, v) => trainPF(s, v) * v.trainMult;
  function cleanData(s) {
    const d = {};
    for (const src of D.DATA_SOURCES) d[src.id] = !!ui.train.data[src.id] && (!src.tech || !!s.techs[src.tech]);
    return d;
  }
  function planner(s, v, size) {
    const target = size.id === 'agi' ? 300 : 150;
    const needPF = size.pfdays / target / v.trainMult;
    const have = trainPF(s, v);
    if (have >= needPF) return `<div class="callout good">You have enough compute to finish ${an(size.name)} ${size.name} in under ${target} days.</div>`;
    const open = Object.keys(D.ITEMS).filter((t) => D.ITEMS[t].pf && !Sim.itemLocked(s, t));
    const best = open.sort((a, b) => D.ITEMS[b].pf - D.ITEMS[a].pf)[0];
    const d = D.ITEMS[best];
    const n = Math.ceil((needPF - have) / (d.pf * (v.computeMult || 1)));
    const power = n * d.power;
    const spare = Math.max(0, v.powerCap - v.power);
    const tooBig = n * (d.size || 1) ** 2 > 0.6 * v.office.size ** 2;
    return `<div class="callout"><div class="eyebrow">Planner</div>To finish ${an(size.name)} ${size.name} in ${target} days you need about <b class="mono">${fmt.pf(needPF)}</b> for training; you have <b class="mono">${fmt.pf(have)}</b>. That is roughly <b>${n.toLocaleString('en-US')} more ${d.name}${n === 1 ? '' : 's'}</b> (${money(Sim.itemCost(s, best) * n)}), drawing ${fmt.kw(power)}${power > spare ? `; you have ${fmt.kw(spare)} of power to spare` : ''}, plus about ${fmt.kw(power)} more cooling.${tooBig ? ' That will not fit here: a bigger office holds faster hardware.' : ''}</div>`;
  }
  function dataAdvice(s, size, cost) {
    const on = D.DATA_SOURCES.filter((src) => ui.train.data[src.id] && (!src.tech || s.techs[src.tech]));
    const drop = on.slice().sort((a, b) => size.data[b.id] - size.data[a.id]).find((src) => cost - size.data[src.id] <= s.cash);
    if (drop) return `Untick ${drop.name} to save ${money(size.data[drop.id])}.`;
    const cheapest = on.slice().sort((a, b) => size.data[a.id] - size.data[b.id])[0];
    if (cheapest && size.data[cheapest.id] <= s.cash) return `${cheapest.name} alone costs ${money(size.data[cheapest.id])}.`;
    return 'With no data ticked the run is free, but scraped data risks copyright lawsuits.';
  }

  function renderModels(s, v, tab) {
    const unlocked = D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech]);
    const nextSize = D.MODEL_SIZES.find((m) => m.tech && !s.techs[m.tech]);
    if (!ui.train.size || !unlocked.some((m) => m.id === ui.train.size)) {
      const run = Sim.bestNextRun(s, v);
      ui.train.size = run ? run.size.id : unlocked[unlocked.length - 1].id;
    }
    const size = D.SIZE_BY_ID[ui.train.size];
    const rate = trainRate(s, v);
    const top = v.topRival, fm = v.flagship;
    let job;
    if (s.training) {
      const t = s.training;
      const p = t.done / t.need;
      const eta = rate > 0 ? Math.ceil((t.need - t.done) / rate) : Infinity;
      job = `
        <section class="card accent">
          <div class="row between"><div><div class="eyebrow">Training now</div><h3>${esc(t.name)}</h3></div><span class="tag accent">about ${t.exp.toFixed(0)}</span></div>
          <div class="loss">${sparkline(t.loss, 320, 84)}<span class="loss-label mono">loss ${t.loss.length ? t.loss[t.loss.length - 1].toFixed(2) : '11.00'}</span></div>
          ${bar(p, 'accent')}
          <div class="row between small mono"><span>${fmt.pct(p, 1)} of ${fmt.pfdays(t.need)}</span><span>${eta === Infinity ? 'stalled: no compute for training' : `about ${eta} days left`}</span></div>
          <div class="row">${confirmBtn('cancel-train', 'Cancel run (half the data cost back)', 'Confirm: lose all progress', 'small ghost')}</div>
        </section>`;
    } else {
      const data = cleanData(s);
      const cost = Sim.trainingCost(s, size.id, data);
      const exp = Sim.expectedCap(s, size.id, size.id === 'agi' ? {} : data, v);
      const d = rate > 0 ? Math.ceil(size.pfdays / rate) : Infinity;
      const tooSlow = d > 365;
      const compare = [
        { name: 'This run', cap: exp, color: 'var(--bridge)', txt: `${(exp * 0.96).toFixed(0)}–${Math.min(size.id === 'agi' ? 100 : 99, exp * 1.04).toFixed(0)}` },
        ...(fm ? [{ name: 'Your model', cap: fm.cap, color: 'var(--ink-3)', txt: fm.cap.toFixed(1) }] : []),
        ...(top ? [{ name: 'Top rival', cap: top.cap, color: Sim.RIVAL_BY_ID[top.id].color, txt: top.cap.toFixed(1) }] : []),
      ];
      job = `
        <div class="cols">
        <section class="card">
          <div class="card-head"><h3>New training run</h3><span class="tiny faint">${fmt.num(rate)} PF-days a day</span></div>
          <div class="ladder" role="group" aria-label="Model size">${D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech] || m === nextSize).map((m) => {
            const locked = m.tech && !s.techs[m.tech];
            return `<button class="size${m.id === size.id ? ' on' : ''}${locked ? ' locked' : ''}" data-act="pick-size" data-id="${m.id}"${disabled(locked)}><b>${m.name}</b><span>${m.params}</span><span>${locked ? D.TECH_BY_ID[m.tech].name : fmt.pfdays(m.pfdays)}</span></button>`;
          }).join('')}</div>
          ${size.id === 'agi' ? `<p class="note">The AGI Project uses every data source there is. Budget ${money(size.fixedCost)}. Switch the compute split to Manual while it runs.</p>` : `<div class="data-row">${D.DATA_SOURCES.filter((src) => !src.tech || s.techs[src.tech]).map((src) => {
            const on = !!ui.train.data[src.id];
            return `<button class="data${on ? ' on' : ''}" data-act="pick-data" data-id="${src.id}" aria-pressed="${on}"><span class="check" aria-hidden="true"></span><span class="grow"><b>${src.name}</b> <span class="mono tiny">+${Math.round(src.q * 100)}% quality</span><br><span class="tiny muted">${src.desc}</span></span><span class="mono small">${money(size.data[src.id])}</span></button>`;
          }).join('')}</div>`}
          ${!ui.train.data.licensed && size.id !== 'agi' ? '<div class="callout warn">Without licensed data you risk copyright lawsuits.</div>' : ''}
        </section>
        <section class="card">
          <div class="card-head"><h3>${esc(size.name)} · expected score</h3><span class="tag accent">${size.params}</span></div>
          <div class="compare">${compare.map((r) => `<div class="race-line"><span class="nm">${r.name}</span><span class="track"><i style="width:${r.cap}%;background:${r.color}"></i></span><span class="mono small">${r.txt}</span></div>`).join('')}</div>
          <dl class="kv"><div><dt>Time at current compute</dt><dd class="${tooSlow ? 'bad-text' : d > 150 ? 'warn-text' : ''}">${d === Infinity ? 'no spare compute' : days(d)}</dd></div><div><dt>Data cost</dt><dd class="${s.cash < cost ? 'bad-text' : ''}">${money(cost)}</dd></div></dl>
          ${fm && size.id !== 'agi' && exp <= fm.cap + 0.5 ? `<div class="callout warn"><b>This won't beat your live model.</b>${esc(size.name)} scores about ${exp.toFixed(1)} and ${esc(fm.name)} already has ${fm.cap.toFixed(1)}. Retraining the same size barely helps: a bigger model needs more compute and research.</div>` : ''}
          ${planner(s, v, size)}
          ${tooSlow ? `<div class="callout bad">Too slow to start: ${d === Infinity ? 'you have no spare compute' : `it would take ${days(d)}`}. Add GPUs in Build, or pick a smaller model.</div>` : ''}
          ${s.cash < cost && !tooSlow ? `<div class="callout bad">Not enough cash for this data (${money(cost)}). ${dataAdvice(s, size, cost)}</div>` : ''}
          <button class="btn primary wide" data-act="start-train"${disabled(s.cash < cost || tooSlow)}>Start training · ${money(cost)}</button>
        </section>
        </div>`;
    }
    const alloc = !fm ? '' : `
      <section class="card">
        <div class="row between"><div><div class="eyebrow">Compute split</div><h3 class="mono">${fmt.pf(v.effPF)}</h3></div>
          <div class="seg" role="group" aria-label="Split mode"><button class="${s.autoAlloc ? 'on' : ''}" data-act="alloc-auto">Auto</button><button class="${s.autoAlloc ? '' : 'on'}" data-act="alloc-manual">Manual</button></div></div>
        ${s.autoAlloc ? '<p class="note">Auto serves your users first and trains with whatever is left.</p>' : `<label class="small" for="alloc">Training share <b class="mono">${Math.round(s.allocTrain * 100)}%</b></label><input id="alloc" type="range" min="0" max="100" step="5" value="${Math.round(s.allocTrain * 100)}" data-input="alloc">`}
        <dl class="kv"><div><dt>Serving needs</dt><dd>${fmt.pf(v.need)}</dd></div><div><dt>Serving gets</dt><dd>${fmt.pf(v.inferPF)}</dd></div><div><dt>Training gets</dt><dd>${fmt.pf(v.trainPF)}</dd></div><div><dt>Users served</dt><dd class="${v.service < 0.95 ? 'bad-text' : ''}">${fmt.pct(v.service)}</dd></div></dl>
      </section>`;
    const models = s.models
      .slice()
      .reverse()
      .map((m) => {
        const live = m.id === s.flagshipId;
        return `<div class="item-row">
          <div class="grow"><div class="row between"><span class="title">${esc(m.name)}</span><span>${live ? '<span class="tag ok">Live</span>' : ''}${m.open ? ' <span class="tag">Open weights</span>' : ''}</span></div>
          <div class="model-score">${bar(m.cap / 100, 'accent thin')}<span class="mono small">${m.cap.toFixed(1)}</span></div>
          <div class="tiny faint">Trained ${fmt.date(m.day)} · appeal ×${m.appeal.toFixed(2)}</div></div>
          ${live ? '' : `<div class="actions"><button class="btn small primary" data-act="deploy" data-id="${m.id}">Deploy</button>${m.open || m.size === 'agi' ? '' : confirmBtn('open:' + m.id, 'Open-source', 'Confirm', 'small ghost')}</div>`}
        </div>`;
      })
      .join('');
    if (tab === 'library')
      return `<div class="list">${models || '<div class="empty">No models yet. Start with a Tiny run: a few gaming rigs are enough.</div>'}</div>
      <p class="note">Deploying a better model boosts hype, and beating every rival boosts it more. Open-sourcing an old model earns hype and draws talent, but it also helps the free alternatives.</p>`;
    if (tab === 'compute')
      return alloc
        ? `<div class="cols">${alloc}<section class="card"><h3>How the split works</h3><p class="note">Every GPU either serves your users or trains the next model. Users who can't be served get "at capacity" errors and leave. Auto serves everyone first and trains with whatever is left. Manual lets you starve serving for a faster run, which the AGI Project needs.</p></section></div>`
        : '<div class="empty">Deploy a model first. Until then every GPU trains.</div>';
    return job;
  }

  // Market: price with a revenue preview, what decides share, products and marketing
  function shareCard(s, v) {
    const f = Sim.shareFactors(s, v);
    if (!f) return '';
    const rows = [
      ['Model score', `${f.model.you.toFixed(1)} vs ${f.model.them.toFixed(1)}`, f.model.mult, 'Train a bigger model.'],
      ['Features', `×${f.features.you.toFixed(2)} vs ×${f.features.them.toFixed(2)}`, f.features.mult, 'Research RLHF, Long Context and Multimodal, then train again.'],
      ['Hype', `${Math.round(f.hype.you)} vs ${Math.round(f.hype.them)}`, f.hype.mult, 'Run a campaign or ship a better model.'],
      ['Price', `$${f.price.you} vs $${f.price.them}`, f.price.mult, 'A lower price wins users, but see the revenue chart first.'],
      ['Uptime', fmt.pct(f.uptime.you), f.uptime.mult, 'Add GPUs or lower the training share.'],
    ];
    const worst = rows.reduce((a, r) => (r[2] < a[2] ? r : a));
    const chip = (name, m) => (name === 'Uptime' ? (m >= 0.99 ? ['ok', 'Full'] : m >= 0.8 ? ['warn', 'Dropping'] : ['bad', 'Failing']) : m >= 1.05 ? ['ok', 'Ahead'] : m >= 0.9 ? ['', 'Even'] : m >= 0.5 ? ['warn', 'Behind'] : ['bad', 'Far behind']);
    return `<section class="card">
      <div class="card-head"><h3>What decides your share</h3><span class="tiny faint">vs ${esc(f.rival)}</span></div>
      <div>${rows.map((r) => {
        const [cls, txt] = chip(r[0], r[2]);
        return `<div class="factor${r === worst && worst[2] < 0.9 ? ' worst' : ''}"><span class="f-name">${r[0]}</span><span class="mono small">${r[1]}</span><span class="tag ${cls}">${txt}</span></div>`;
      }).join('')}</div>
      ${worst[2] < 0.9 ? `<p class="note"><b>Biggest drag: ${worst[0].toLowerCase()}.</b> ${worst[3]}</p>` : '<p class="note"><b>You are competitive.</b> Keep your model ahead and your hype up.</p>'}
    </section>`;
  }

  function priceCard(s, v) {
    const fm = v.flagship;
    const curve = Sim.priceCurve(s, v, priceSteps(5, 60));
    const now = Sim.priceCurve(s, v, [s.price])[0];
    const best = curve.reduce((a, p) => (p.revenue > a.revenue ? p : a));
    const perUser = fm.infer / (2000 * v.inferEff);
    const gain = now.revenue > 0 ? best.revenue / now.revenue - 1 : 0;
    return `<section class="card">
      <div class="row between"><label class="eyebrow" for="price">Subscription price</label><b class="mono" id="price-label">$${s.price}/mo</b></div>
      <input id="price" type="range" min="5" max="60" step="1" value="${s.price}" data-input="price">
      ${priceChart(curve, s.price)}
      <dl class="kv">
        <div><dt>At your price</dt><dd>${fmt.num(now.subs)} subs · ${money(now.revenue)}/mo</dd></div>
        <div><dt>Best price now</dt><dd class="${gain > 0.05 ? 'ok-text' : ''}">$${best.price} · ${money(best.revenue)}/mo</dd></div>
      </dl>
      <p class="note">The chart shows where subscribers would settle at each price, everything else equal. Cheaper plans win share, but once you lead the market each extra user is worth less than the price you give up. Serving ${fmt.num(now.subs)} users needs about ${fmt.pf(now.subs * perUser)} of compute.</p>
    </section>`;
  }

  function renderProducts(s, v) {
    const open = D.PRODUCTS.filter((p) => s.techs[p.tech]);
    if (!open.length) return '';
    const teaser = D.PRODUCTS.find((p) => !s.techs[p.tech]);
    const cards = open
      .map((pd) => {
        const st = s.products[pd.id], pv = v.products[pd.id];
        const step = pd.maxPrice >= 3000 ? 250 : pd.maxPrice >= 300 ? 10 : 1;
        if (!st.live) {
          return `<section class="card"><div class="row between"><h3>${pd.name}</h3><span class="tag">Ready</span></div>
            <p class="note">${pd.desc}</p>
            <div class="tiny faint mono">from $${pd.price.toLocaleString('en-US')}/mo · about ${fmt.num(v.market * pd.market)} potential customers</div>
            <button class="btn primary" data-act="launch" data-id="${pd.id}"${disabled(s.cash < pd.launch || !v.flagship)}>Launch · ${money(pd.launch)}</button></section>`;
        }
        const curve = Sim.productCurve(s, v, pd, priceSteps(pd.minPrice, pd.maxPrice, step));
        const best = curve.length ? curve.reduce((a, p) => (p.revenue > a.revenue ? p : a)) : null;
        return `<section class="card">
          <div class="row between"><h3>${pd.name} <span class="tag ok">Live</span></h3><span class="mono small">${money(pv.revenue)}/mo</span></div>
          <dl class="kv"><div><dt>Customers</dt><dd>${fmt.num(pv.users)} → ${fmt.num(pv.target)}</dd></div><div><dt>Share</dt><dd>${fmt.pct(pv.share, 1)}</dd></div><div><dt>Compute</dt><dd>${fmt.pf(pv.need)}</dd></div><div><dt>Best price now</dt><dd>${best ? '$' + best.price.toLocaleString('en-US') : '–'}</dd></div></dl>
          <div class="row between"><label class="small" for="pp-${pd.id}">Price</label><b class="mono small">$${st.price.toLocaleString('en-US')}/mo</b></div>
          <input id="pp-${pd.id}" type="range" min="${pd.minPrice}" max="${pd.maxPrice}" step="${step}" value="${st.price}" data-input="pprice" data-id="${pd.id}">
        </section>`;
      })
      .join('');
    return `<div class="cols three">${cards}</div>
      <p class="note">Every product runs on your live model and on the same GPUs as chat.${teaser ? ` Next: ${teaser.name}, after ${D.TECH_BY_ID[teaser.tech].name}.` : ''}</p>`;
  }

  // Marketing works like E-Shop's: campaigns fill slots, show how long they
  // have left, and can renew themselves.
  function renderMarketing(s, v) {
    const slots = Sim.campaignSlots(s);
    const active = Sim.activeCampaigns(s);
    const renew = s.autoRenew || {};
    const running = active
      .map((c) => {
        const end = s.campaignCd[c.id];
        const left = end - s.day;
        const p = 1 - left / c.cd;
        return `<div class="slot">
          <span class="ic">${CAMP_ICON[c.id] || CAMP_ICON.thread}</span>
          <div class="grow"><div class="nm">${esc(c.name)}</div>${bar(p, 'blue')}<div class="meta"><span>${c.cost ? money(c.cost) : 'Free'}</span><span>${left} day${left === 1 ? '' : 's'}</span></div></div>
          <label class="renew"><input type="checkbox" data-input="renew" data-id="${c.id}"${renew[c.id] ? ' checked' : ''}> Auto renew</label>
          <button class="stop" data-act="stop-camp" data-id="${c.id}" aria-label="Stop ${esc(c.name)}" title="Stop and free the slot">×</button>
        </div>`;
      })
      .join('');
    const empty = Array.from({ length: Math.max(0, slots - active.length) }, () => '<div class="slot empty-slot" data-act="scroll-camps" role="button" aria-label="Start a campaign">+</div>').join('');
    const bigger = D.CAMPAIGN_SLOTS.findIndex((n) => n > slots);
    const available = D.CAMPAIGNS.filter((c) => (c.minOffice || 0) <= s.officeLevel);
    const lockedCamps = D.CAMPAIGNS.filter((c) => (c.minOffice || 0) > s.officeLevel);
    const full = active.length >= slots;
    const cards = available
      .map((c) => {
        const cd = (s.campaignCd[c.id] || 0) - s.day;
        const isOn = active.some((x) => x.id === c.id);
        const state = isOn ? '<span class="tag info">Running</span>' : cd > 0 ? `<span class="tag">Ready in ${cd}d</span>` : '';
        return `<div class="camp"><div class="row between"><span class="nm">${esc(c.name)}</span>${state}</div><span class="small muted">${c.desc}</span><span class="tiny">+${c.hype} hype · runs ${c.cd} days</span>
          <button class="btn small${isOn || cd > 0 || full ? '' : ' primary'}" data-act="campaign" data-id="${c.id}"${disabled(isOn || cd > 0 || full || s.cash < c.cost)}>${full && !isOn ? 'No free slot' : `Start · ${c.cost ? money(c.cost) : 'free'}`}</button></div>`;
      })
      .join('');
    const lifetime = s.log.filter((e) => e.a === 'campaign').length;
    return `
      <div class="section-label" style="--cat:#cde5f6"><h3>Current campaigns</h3><span class="tiny">${active.length} of ${slots} slots${bigger > 0 ? ` · ${D.CAMPAIGN_SLOTS[bigger]} in ${esc(D.OFFICES[bigger].place)}` : ''}</span></div>
      <div class="slots">${running}${empty}</div>
      <div class="section-label" id="camps" style="--cat:var(--cat-comfort)"><h3>New campaigns</h3><span class="tiny">${lifetime} run so far${lockedCamps.length ? ` · ${lockedCamps.length} more in bigger offices` : ''}</span></div>
      <div class="camp-grid">${cards}</div>
      <p class="note">Campaigns add hype when they start, and hype fades every day. Auto renew starts a finished campaign again as long as you keep twice its cost in the bank.</p>`;
  }

  function renderMarket(s, v, tab) {
    const fm = v.flagship;
    if (tab === 'marketing') return renderMarketing(s, v);
    if (tab === 'products') return renderProducts(s, v) || `<div class="empty">No products yet. ${D.PRODUCTS[0].name} unlocks with ${D.TECH_BY_ID[D.PRODUCTS[0].tech].name} in R&D.</div>`;
    if (tab === 'deals') {
      const contracts = s.contracts
        .map((c) => `<div class="item-row"><div class="grow"><div class="title">${esc(c.client)}</div><div class="sub">${money(c.monthly)}/mo · ${fmt.pf(c.pf)} reserved · ends in ${Math.max(0, c.until - s.day)} days${c.strikes ? ` · ${c.strikes} outage strikes` : ''}</div></div><span class="tag ok">${money(c.monthly)}/mo</span></div>`)
        .join('');
      return `<div class="list">${contracts || '<div class="empty">No contracts yet. Companies call once your model can write code or is good enough.</div>'}</div>
        <p class="note">Enterprise deals pay every month but reserve compute. If they get less than 75% of it for too long, the client walks away.</p>`;
    }
    if (!fm) return '<div class="empty">Deploy a model to start selling subscriptions.</div>';
    return `
      <div class="cols">
        ${priceCard(s, v)}
        <div class="stack">
          ${shareCard(s, v)}
          <div class="kpis">
            ${kpi('Heading to', fmt.num(s.targetSubs), 'subscribers')}
            ${kpi('Paying market', fmt.num(v.market), 'people')}
            ${kpi('Users served', fmt.pct(v.service), esc(fm.name), v.service < 0.95 ? 'bad-text' : '')}
          </div>
        </div>
      </div>`;
  }

  // Money: cash, funding and last month's books
  const HAVE = {
    preseed: (s) => `${s.models.length} model${s.models.length === 1 ? '' : 's'}`,
    seed: (s) => `${fmt.num(s.subs)} subscribers`,
    a: (s, v) => `OmniBench ${v.bestCap.toFixed(1)} and ${money(v.mrr)} a month`,
    b: (s, v) => `OmniBench ${v.bestCap.toFixed(1)} and ${money(v.mrr)} a month`,
    c: (s, v) => `OmniBench ${v.bestCap.toFixed(1)}`,
    d: (s, v) => `OmniBench ${v.bestCap.toFixed(1)}`,
    e: (s, v) => `OmniBench ${v.bestCap.toFixed(1)}`,
    ipo: (s, v) => `OmniBench ${v.bestCap.toFixed(1)} and a ${money(v.valuation)} valuation`,
  };
  const INTEREST_CLS = { Hot: 'ok', Warm: 'ok', Cool: 'warn', Cold: 'bad' };
  const INTEREST_TXT = { Hot: 'Expect three competing offers.', Warm: 'Expect two offers, a little below your valuation.', Cool: 'Expect one small offer at a low price.', Cold: 'Investors will most likely pass for now.' };

  function renderFunding(s, v) {
    const f = s.funding;
    const fv = Sim.fundingView(s, v);
    const raised = s.log.filter((e) => e.a === 'raise');
    const history = raised.length
      ? `<div class="list">${raised.map((e) => `<div class="item-row"><div class="grow"><div class="title">${esc(e.round)}${e.investor ? ` · ${esc(e.investor)}` : ''}</div><div class="sub">${money(e.raise)} at ${money(e.pre)} before the money · ${e.dil}% of the company</div></div><span class="tag ok">Raised</span></div>`).join('')}</div>`
      : '';
    if (f.offers.length) {
      const cards = f.offers
        .map((o) => {
          const inv = D.INVESTORS.find((i) => i.id === o.type);
          const odds = Sim.pushOdds(s, v, o);
          return `<section class="card accent offer">
            <div class="eyebrow">${esc(o.kind)} · ${esc(o.name)}</div>
            <h3>${esc(o.investor)}</h3>
            <p class="price-line"><b class="mono">${money(o.raise)}</b> for <b class="mono">${fmt.pct(o.dilution, 1)}</b> of the company</p>
            <dl class="kv"><div><dt>Values you at</dt><dd>${money(o.pre)}</dd></div><div><dt>You would own</dt><dd>${fmt.pct(s.equity * (1 - o.dilution), 1)}</dd></div></dl>
            ${inv ? `<p class="note">${inv.perkText}</p>` : ''}
            <div class="row wrap" style="gap:8px"><button class="btn primary" data-act="accept" data-id="${o.oid}">Take the deal</button>${o.pushed ? '<span class="tag">Final offer</span>' : `<button class="btn" data-act="push" data-id="${o.oid}">Ask for 20% more · ${fmt.pct(odds)} chance</button>`}</div>
          </section>`;
        })
        .join('');
      return `<div class="section-label"><h3>Term sheets</h3><span class="tag">${f.offers[0].expires - s.day}d left</span></div>
        ${cards}
        <button class="btn ghost" data-act="walk">Walk away from all of them</button>
        <p class="note">Asking for more works more often when you don't need the money. If the investor leaves the table it counts as a walk-away, and each walk-away cuts your next offers by 10% for six months.</p>`;
    }
    if (!fv.round) return `<div class="section-label"><h3>Funding</h3></div>${history}<p class="note">You are a public company. There is nothing left to raise.</p>`;
    const r = fv.round;
    const typical = Math.max(r.min, (v.valuation * r.dil) / (1 - r.dil));
    const factors = [];
    if (fv.runway < 3) factors.push(['bad', 'You are nearly out of cash, and investors can tell: offers come in 25% lower.']);
    else if (fv.runway < 6) factors.push(['warn', 'Under 6 months of cash left: offers come in 10% lower.']);
    else if (fv.runway >= 12) factors.push(['ok', fv.runway === Infinity ? 'You are profitable, so you can drive a hard bargain.' : 'Over a year of cash: you can drive a hard bargain.']);
    if (fv.recent) factors.push(['warn', `${fv.recent} walk-away${fv.recent === 1 ? '' : 's'} in the last six months: offers are ${Math.min(3, fv.recent) * 10}% lower for now.`]);
    if (f.last) factors.push(['', `Last time (${fmt.date(f.last.day)}), the best ${esc(f.last.round)} offer was ${money(f.last.raise)} at ${money(f.last.pre)}.`]);
    return `<div class="section-label"><h3>Funding</h3><span class="tag">optional</span></div>
      <section class="card">
        <div class="row between"><div><div class="eyebrow">Next stage</div><h3>${r.name}</h3></div><span class="tag ${INTEREST_CLS[fv.label]}">${fv.label} interest</span></div>
        ${bar(Math.min(1, fv.fit), INTEREST_CLS[fv.label])}
        <p class="note">Investors want to see ${r.wantText}. You have ${HAVE[r.id](s, v)}. ${INTEREST_TXT[fv.label]}</p>
        <dl class="kv"><div><dt>Typical check</dt><dd>${money(typical)} for ~${fmt.pct(r.dil)}</dd></div><div><dt>Your valuation</dt><dd>${money(v.valuation)}</dd></div><div><dt>Cash lasts</dt><dd>${fv.runway === Infinity ? 'profitable' : fv.runway > 36 ? '3+ years' : Math.floor(fv.runway) + ' months'}</dd></div><div><dt>You own</dt><dd>${fmt.pct(s.equity, 1)}</dd></div></dl>
        ${factors.length ? `<ul class="factors-list">${factors.map(([k, t]) => `<li class="${k ? k + '-text' : 'muted'}">${t}</li>`).join('')}</ul>` : ''}
        <button class="btn${fv.canPitch && fv.fit >= 0.3 ? ' primary' : ''} wide" data-act="pitch"${disabled(!fv.canPitch)}>${fv.canPitch ? `Pitch your ${r.name}` : esc(fv.why)}</button>
        <p class="note">You never have to raise. Money now means a smaller slice later, and the slice you keep is your score at the end.</p>
      </section>
      ${history}`;
  }

  function renderFinance(s, v, tab) {
    const last = s.history[s.history.length - 1];
    const hist = s.history.slice(-36);
    const pl = last
      ? `<table class="pl"><caption class="eyebrow" style="text-align:left;padding-bottom:6px">${last.label}</caption>
          <tr><th>Subscriptions</th><td>${money(last.detail.rev)}</td></tr>
          <tr><th>Enterprise</th><td>${money(last.detail.crev)}</td></tr>
          ${last.detail.prev ? `<tr><th>Products</th><td>${money(last.detail.prev)}</td></tr>` : ''}
          <tr><th>Salaries</th><td class="neg">${money(-last.detail.salaries)}</td></tr>
          <tr><th>Rent</th><td class="neg">${money(-last.detail.rent)}</td></tr>
          <tr><th>Power</th><td class="neg">${money(-last.detail.power)}</td></tr>
          <tr><th>Marketing</th><td class="neg">${money(-last.detail.marketing)}</td></tr>
          <tr><th>Training data</th><td class="neg">${money(-last.detail.data)}</td></tr>
          <tr><th>Other</th><td class="neg">${money(-last.detail.other)}</td></tr>
          <tr><th>Hardware and moves</th><td class="neg">${money(-last.detail.capex)}</td></tr>
          <tr><th>Funding</th><td>${money(last.detail.funding)}</td></tr>
        </table>`
      : '<p class="note">Your first monthly report arrives at the end of the month.</p>';
    if (tab === 'funding') return renderFunding(s, v);
    const chart = (title, key, cls) => `<section class="card"><div class="card-head"><h3>${title}</h3><span class="tiny faint">last ${hist.length} months · ${money(Math.min(...hist.map((h) => h[key])))} to ${money(Math.max(...hist.map((h) => h[key])))}</span></div>${sparkline(hist.map((h) => h[key]), 360, 90, cls)}</section>`;
    return `
      ${s.funding.offers.length ? `<div class="callout good"><div class="row between"><b>${s.funding.offers.length} term sheet${s.funding.offers.length === 1 ? ' is' : 's are'} waiting, ${s.funding.offers[0].expires - s.day} days left.</b><button class="btn small primary" data-act="tab" data-id="funding">Review</button></div></div>` : ''}
      <div class="cols">
        <div class="stack">
          ${hist.length >= 2 ? chart('Cash', 'cash', '') + chart('Revenue', 'revenue', 'bay') : '<div class="empty">Charts appear after your first two months.</div>'}
        </div>
        <section class="card">${pl}</section>
      </div>`;
  }

  // Race: the leaderboard, alignment and the news
  const ENDINGS = {
    aligned: ['Trusted', 'If you reached AGI today, the world would trust it.'],
    uneasy: ['Uneasy', 'If you reached AGI today, regulators and the public would be nervous about it.'],
    reckless: ['Reckless', 'If you reached AGI today, nobody would be sure what you had built. Including you.'],
  };
  function alignmentCard(s, v) {
    const a = v.alignment;
    const [name, text] = ENDINGS[a.ending];
    const sign = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
    return `<section class="card">
      <div class="row between"><h3>Alignment</h3><span class="tag ${a.ending === 'aligned' ? 'ok' : a.ending === 'uneasy' ? 'warn' : 'bad'}">${a.total}/100 · ${name}</span></div>
      ${bar(a.total / 100, a.ending === 'aligned' ? 'ok' : a.ending === 'uneasy' ? 'warn' : 'bad')}
      <div class="align-parts"><span>base ${a.base}</span><span>safety research ${sign(a.research)}</span><span>safety team ${sign(a.team)}</span><span class="${a.choices < 0 ? 'bad-text' : ''}">your choices ${sign(a.choices)}</span>${a.data ? `<span>human feedback ${sign(a.data)}</span>` : ''}</div>
      <p class="note">${text} 70 or more counts as aligned, under 40 as reckless. Safety staff, safety research and honest answers in a crisis raise it.</p>
    </section>`;
  }
  function renderRace(s, v, tab) {
    const fm = v.flagship;
    const bestModel = s.models.slice().sort((a, b) => b.cap - a.cap)[0];
    const rows = [
      { name: s.company, model: bestModel ? bestModel.name : 'no model yet', cap: bestModel ? bestModel.cap : 0, color: 'var(--bridge)', you: true },
      ...s.rivals.map((r) => {
        const d = Sim.RIVAL_BY_ID[r.id];
        return { name: d.name, model: `${d.model}-${r.version}`, cap: r.cap, color: d.color, blurb: d.blurb };
      }),
    ].sort((a, b) => b.cap - a.cap);
    const filters = { all: () => true, rivals: (n) => /releases|rival|Collective|Embarcadero|Twin Peaks|Peninsula|Telegraph/.test(n.text), you: (n) => n.text.includes(s.company) || n.kind === 'goal', bad: (n) => n.kind === 'bad' || n.kind === 'warn' };
    const news = s.news
      .filter(filters[ui.newsFilter] || filters.all)
      .slice(0, 40)
      .map((n) => `<li class="kind-${n.kind}"><span class="mono tiny faint">${fmt.date(n.day)}</span><span>${esc(n.text)}</span></li>`)
      .join('');
    if (tab === 'alignment') return fm ? `<div class="cols">${alignmentCard(s, v)}<section class="card"><h3>What counts</h3><p class="note">Safety researchers and safety research raise alignment. So do honest answers in a crisis: patching a jailbreak instead of calling it a feature, testifying instead of hiring lobbyists. Human feedback data helps a little. The score decides your ending if you reach AGI first.</p></section></div>` : '<div class="empty">Alignment starts to matter once a model is live.</div>';
    if (tab === 'news')
      return `<div class="chips" role="group" aria-label="Filter news">${[['all', 'All'], ['you', 'Your lab'], ['rivals', 'Rivals'], ['bad', 'Warnings']].map(([id, n]) => `<button class="chip${ui.newsFilter === id ? ' on' : ''}" data-act="news-filter" data-id="${id}">${n}</button>`).join('')}</div>
      <section class="card"><ul class="news-list">${news || '<li><span></span><span class="muted">Nothing here yet.</span></li>'}</ul></section>`;
    return `
      <section class="card">
        <div class="card-head"><h3>OmniBench leaderboard</h3><span class="tiny faint">first to 100 builds AGI</span></div>
        <div class="board">${rows
          .map((r, i) => `<div class="lb${r.you ? ' you' : ''}"><span class="rank">${i + 1}</span><div class="grow"><div class="row between"><span class="name">${esc(r.name)}</span><span class="mono" style="font-weight:800;font-size:17px">${r.cap.toFixed(1)}</span></div><div class="lb-bar"><i style="width:${r.cap}%;background:${r.color}"></i><span class="agi-mark" title="AGI at 100"></span></div><div class="small muted">${esc(r.model)}${r.blurb ? ' · ' + esc(r.blurb) : ''}</div></div></div>`)
          .join('')}</div>
        ${fm ? '' : '<p class="note">Deploy a model to compete for users.</p>'}
      </section>`;
  }

  // ---------- the HUD: top-left bar, window buttons, bottom stats ----------
  // Chips are built once and only their insides change, so a click that
  // lands while the numbers tick still hits the button.
  function statChips(container, chips) {
    const el = $(container);
    const key = chips.map((c) => c.id).join(',');
    if (el.dataset.key !== key) {
      el.innerHTML = chips.map((c) => `<button class="stat" id="st-${c.id}" data-go="${c.go}"></button>`).join('');
      el.dataset.key = key;
    }
    for (const c of chips) {
      const b = $('st-' + c.id);
      const cls = 'stat' + (c.cls ? ' ' + c.cls : '');
      if (b.className !== cls) b.className = cls;
      if (b.title !== c.title) {
        b.title = c.title;
        b.setAttribute('aria-label', c.title);
      }
      set('st-' + c.id, c.html);
    }
  }

  function renderTop(s, v) {
    set('co-name', esc(s.company));
    set('date', fmt.date(s.day).toUpperCase());
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === G().speed));
    const has = (id) => Progress.has(s, id);
    const team = s.staff.filter((p) => !p.founder);
    const avg = team.length ? team.reduce((a, p) => a + p.morale, 0) / team.length : 100;
    // five numbers, quiet unless something is wrong; the rest lives in the windows
    const left = [];
    if (has('tab:team')) left.push({ id: 'staff', go: 'team', cls: avg < 40 ? 'warn' : '', title: `${s.staff.length} people · morale ${Math.round(avg)}%`, html: `${STAT_ICON.people}<span class="v">${s.staff.length}</span>` });
    if (has('hud:subs')) left.push({ id: 'subs', go: 'market', title: `${fmt.num(s.subs)} subscribers · ${fmt.pct(s.share || 0, 1)} market share`, html: `${STAT_ICON.subs}<span class="v">${fmt.num(s.subs)}</span>` });
    const hot = v.thermal < 0.99 || v.powerFactor < 1;
    left.push({ id: 'compute', go: 'build:compute', cls: hot ? 'bad' : '', title: `${fmt.pf(v.effPF)} usable compute${v.thermal < 0.99 ? ` · too hot, GPUs at ${fmt.pct(v.thermal)}` : v.powerFactor < 1 ? ' · short of power' : ''}`, html: `${STAT_ICON.compute}<span class="v">${fmt.pf(v.effPF)}</span>` });
    statChips('stats-left', left);
    const right = [];
    right.push({ id: 'profit', go: 'finance', cls: v.profitMonth < 0 ? 'neg' : '', title: `Profit ${money(v.profitMonth)} a month · revenue ${money(v.mrr)}`, html: `<span class="k">Profit</span><span class="v">${v.profitMonth >= 0 ? '+' : ''}${money(v.profitMonth)}/mo</span>` });
    right.push({ id: 'cash', go: 'finance', cls: 'cash' + (s.cash < 0 ? ' bad' : ''), title: `Cash ${money(s.cash)}`, html: `${STAT_ICON.wallet}<span class="v">${money(s.cash)}</span>` });
    statChips('stats-right', right);
  }

  function renderRail(s, list) {
    const attn = new Set((list || ui.lastList || []).filter((x) => x.kind !== 'info').map((x) => x.go.split(':')[0]));
    const html = Object.entries(SCREENS)
      .filter(([id]) => id !== 'hq' && screenOpen(s, id))
      .map(([id, sc]) => {
        const dot = Progress.isNewTab(s, id) ? '<span class="dot new" title="New"></span>' : attn.has(id) ? '<span class="dot"></span>' : '';
        return `<button class="win-btn" data-screen="${id}" aria-label="${sc.name}" aria-current="${ui.winOpen && ui.screen === id}">${sc.icon}<span class="lbl">${sc.name}</span>${dot}</button>`;
      })
      .join('');
    set('rail', html);
    const co = $('company-btn');
    const cur = String(ui.winOpen && ui.screen === 'hq');
    if (co.getAttribute('aria-current') !== cur) co.setAttribute('aria-current', cur);
  }

  // ---------- windows ----------
  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function tabDots(s, v, id) {
    if (id === 'finance') return { funding: s.funding.offers.length > 0 || (Sim.fundingView(s, v).canPitch && Sim.fundingView(s, v).fit >= 1) };
    if (id === 'research') {
      const t = cheapestTech(s);
      return { avail: !!(t && s.rp >= t.cost) };
    }
    if (id === 'models') return { library: s.models.some((m) => v.flagship && m.cap > v.flagship.cap + 0.5) };
    if (id === 'market') return { marketing: Sim.activeCampaigns(s).length < Sim.campaignSlots(s) && (s.campaignCd.thread || 0) <= s.day };
    return {};
  }
  function winSub(s, v) {
    return {
      hq: `${esc(s.company)} · ${where(v.office)}`,
      team: `${s.staff.length} ${s.staff.length === 1 ? 'person' : 'people'}`,
      research: `${Math.floor(s.rp).toLocaleString('en-US')} RP to spend`,
      models: v.flagship ? `live: ${esc(v.flagship.name)}` : 'no model live yet',
      market: `${fmt.num(s.subs)} subscribers at $${s.price}/mo`,
      finance: `${money(s.cash)} in the bank`,
      race: v.topRival ? `leader at ${Math.max(v.topRival.cap, v.bestCap).toFixed(1)}` : '',
    }[ui.screen];
  }
  function renderPanel(force) {
    const g = G();
    if (!g || !g.s) return;
    const s = g.s;
    Progress.ensure(s, Sim.derive(s));
    if (ui.winOpen && !screenOpen(s, ui.screen)) ui.winOpen = false;
    renderRail(s);
    const root = $('win-root');
    root.hidden = !ui.winOpen;
    document.body.classList.toggle('win-open', !!ui.winOpen);
    if (!ui.winOpen) {
      if (ui.winBuilt) {
        root.innerHTML = '';
        ui.winBuilt = null;
      }
      renderDockIfNeeded(s);
      return;
    }
    if (!force && ui.interacting) return;
    const v = Sim.derive(s);
    const sc = SCREENS[ui.screen];
    const tab = tabOf(ui.screen);
    if (ui.winBuilt !== ui.screen) {
      root.innerHTML = `<div class="win-scrim" data-win="close"></div>
        <div class="win" role="dialog" aria-labelledby="win-title">
          <header class="win-bar">${sc.icon}<h2 id="win-title">${sc.name}</h2><span class="sub" id="win-sub"></span><button class="win-help-btn" data-win="help" aria-label="What is this?" aria-expanded="false">?</button><button class="win-x" data-win="close" aria-label="Close">${X_ICON}</button></header>
          <div class="win-tabs" id="win-tabs" role="tablist"></div>
          <div class="win-help" id="win-help" hidden></div>
          <div class="win-body" id="win-body"></div>
          <footer class="win-stats" id="win-stats"></footer>
        </div>`;
      ui.winBuilt = ui.screen;
      ui.lastHtml = '';
    }
    set('win-sub', winSub(s, v) || '');
    const dots = tabDots(s, v, ui.screen);
    set('win-tabs', sc.tabs.map(([id, n]) => `<button class="win-tab${id === tab ? ' on' : ''}" role="tab" aria-selected="${id === tab}" data-act="tab" data-id="${id}">${n}${dots[id] && id !== tab ? '<span class="dot"></span>' : ''}</button>`).join(''));
    const help = $('win-help');
    help.hidden = !ui.helpOpen[ui.screen];
    set('win-help', sc.help);
    root.querySelector('.win-help-btn').setAttribute('aria-expanded', String(!!ui.helpOpen[ui.screen]));
    const html = sc.render(s, v, tab);
    if (html !== ui.lastHtml) {
      $('win-body').innerHTML = html;
      ui.lastHtml = html;
    }
    set('win-stats', sc.stats(s, v).map(([k, val]) => `<div class="ws"><div class="k">${k}</div><div class="v">${val}</div></div>`).join(''));
    renderDockIfNeeded(s);
  }

  function renderDockIfNeeded(s) {
    const tool = AIT.Render.tool;
    const show = !ui.winOpen && (ui.trayOpen || !!(tool && tool.mode === 'place'));
    const dock = $('dock');
    dock.hidden = !show;
    if (show) {
      const html = renderDock(s);
      if (html !== ui.lastDock) {
        const scroll = dock.querySelector('.dock-items');
        const x = scroll ? scroll.scrollLeft : 0;
        dock.innerHTML = html;
        ui.lastDock = html;
        const again = dock.querySelector('.dock-items');
        if (again) again.scrollLeft = x;
      }
    } else ui.lastDock = '';
    $('stage').style.setProperty('--dock-h', show ? dock.offsetHeight + 'px' : '0px');
  }

  // ---------- over the world: goal tracker, warnings, notifications ----------
  function renderAdvisor(s, v, list) {
    const tutorial = AIT.Mentor.tutorialActive(s);
    if (tutorial || (isPhone() && (ui.trayOpen || AIT.Render.tool))) return set('advisor', '');
    // just the next milestone; everything else that needs you is under the bell
    const goal = D.GOALS.find((g) => !s.goals[g.id]);
    const el = $('advisor');
    const tip = goal ? goal.hint : '';
    if (el.title !== tip) el.title = tip;
    set('advisor', goal ? `<div class="eyebrow">Next milestone · ${Object.keys(s.goals).length + 1} of ${D.GOALS.length}</div><div class="goal-text">${goal.text}</div>` : '<div class="eyebrow">All milestones done</div><div class="goal-text">You built the future.</div>');
  }

  function renderBanner(list) {
    const el = $('banner');
    const b = list.find((x) => x.kind === 'bad');
    el.hidden = !b;
    if (!b) return;
    el.className = b.kind;
    set('banner', `<span>${esc(b.text)}</span><button class="btn small" data-go="${b.go}">${b.cta}</button>`);
  }

  function renderNotif(s, list) {
    const n = list.filter((x) => x.kind !== 'info').length;
    const badge = $('notif-count');
    badge.hidden = !n;
    badge.textContent = n;
    $('notif-btn').setAttribute('aria-expanded', ui.notifOpen);
    const panel = $('notif-panel');
    panel.hidden = !ui.notifOpen;
    if (!ui.notifOpen) return;
    set(
      'notif-panel',
      `<div class="np-head"><h3>Notifications</h3><button class="win-x" data-notif="close" aria-label="Close">${X_ICON}</button></div>
      <div class="np-body">
      ${list.length ? `<div class="list">${list.map((x) => `<div class="item-row sugg-row ${x.kind}"><span class="dotmark"></span><span class="grow text">${esc(x.text)}</span><button class="btn small" data-go="${x.go}">${x.cta}</button></div>`).join('')}</div>` : '<div class="empty">All clear.</div>'}
      <div class="eyebrow">Recent news</div>
      <ul class="news-list">${s.news.slice(0, 12).map((x) => `<li class="kind-${x.kind}"><span class="tiny faint">${fmt.date(x.day)}</span><span>${esc(x.text)}</span></li>`).join('')}</ul>
      </div>`,
    );
  }

  function renderStage(s, v, list) {
    renderAdvisor(s, v, list);
    renderBanner(list);
    renderNotif(s, list);
    const tool = AIT.Render.tool;
    set('toolbar', tool ? `<span>${tool.mode === 'sell' ? 'Selling: tap an item to get half its price back' : `Placing ${D.ITEMS[tool.type].name} · ${money(Sim.itemCost(s, tool.type))} each`}</span><button class="btn small" data-act="notool">Done</button>` : '');
    $('toolbar').hidden = !tool;
  }

  function renderInspect(s) {
    const box = $('inspect');
    const id = AIT.Render.selected;
    const it = id && s.items.find((i) => i.id === id);
    if (!it) {
      box.hidden = true;
      return;
    }
    const d = D.ITEMS[it.type];
    const v = Sim.derive(s);
    let p = null;
    for (const [pid, desk] of Sim.seating(s)) if (desk.id === it.id) p = s.staff.find((x) => x.id === pid);
    const notes = [];
    if (p) {
      const seat = v.seatInfo.get(p.id) || { board: 0, comfort: 0 };
      notes.push(`<b>${esc(p.name)}</b> · ${p.founder ? 'Founder' : D.ROLES[p.role].name} · skill ${p.skill} · morale ${Math.round(p.morale)}%`);
      notes.push(`Adds ${describeImpact(s, v, p.role, Sim.impact(s, v, { remove: p.id }), false, p.salary).effects.join(' · ')}`);
      notes.push(`Comfort here +${Math.round(seat.comfort)}${p.role === 'researcher' ? ` · whiteboards +${Math.round(seat.board * 100)}% research` : ''}`);
    } else if (d.seats) notes.push('<span class="muted">Empty desk. Hire someone in Team.</span>');
    if (d.pf) notes.push(v.thermal < 1 ? `<span class="bad-text">The office is too hot: running at ${fmt.pct(v.thermal)} speed.</span> Add cooling.` : '<span class="ok-text">Running at full speed.</span>');
    if (d.cooling) notes.push(`The office makes ${fmt.kw(v.heat)} of heat and can remove ${fmt.kw(v.cooling)}.`);
    if (d.rpBonus) {
      const n = s.staff.filter((x) => x.role === 'researcher' && v.seatInfo.get(x.id) && v.seatInfo.get(x.id).desk && Sim.gap(it, v.seatInfo.get(x.id).desk) <= d.radius).length;
      notes.push(`${n} researcher${n === 1 ? '' : 's'} within ${d.radius} tiles`);
    }
    if (d.decor) {
      const n = s.staff.filter((x) => v.seatInfo.get(x.id) && v.seatInfo.get(x.id).desk && Sim.gap(it, v.seatInfo.get(x.id).desk) <= d.radius).length;
      notes.push(`${n} desk${n === 1 ? '' : 's'} within ${d.radius} tiles`);
    }
    const html = `<img src="${AIT.Render.icon(it.type)}" alt="" width="48" height="48">
      <div class="grow stack tight"><div class="name">${d.name}</div><div class="small muted">${d.desc}</div>
      ${notes.map((n) => `<div class="small">${n}</div>`).join('')}
      <div class="tiny mono faint">${statLine(d)}${it.legacy ? ' · old model (¼ size)' : ''}</div></div>
      <div class="actions"><button class="btn small" data-act="sell-selected">Sell ${money(Sim.stat(it, 'cost') * 0.5)}</button><button class="btn small ghost" data-act="close-inspect" aria-label="Close">Close</button></div>`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    box.hidden = false;
  }

  // ---------- modals ----------
  function openModal(html, kind = '', dismissable = true) {
    const rootEl = $('modal-root');
    rootEl.innerHTML = `<div class="backdrop"${dismissable ? ' data-modal="close"' : ''}></div><div class="modal ${kind}" role="dialog" aria-modal="true">${html}</div>`;
    rootEl.hidden = false;
    ui.modal = kind || 'modal';
    const first = rootEl.querySelector('input, textarea:not([readonly]), button:not(.x)');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    const rootEl = $('modal-root');
    const draft = $('feedback-text');
    if (draft) ui.fbDraft = draft.value; // keep unsent feedback if the modal is dismissed
    rootEl.innerHTML = '';
    rootEl.hidden = true;
    ui.modal = null;
    // a snapshot paused the game; pick up at the speed the player had
    if (ui.resumeSpeed != null) {
      G().setSpeed(ui.resumeSpeed);
      ui.resumeSpeed = null;
    }
  }

  function showEvent(s) {
    const ev = Sim.eventView(s);
    if (!ev) return;
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · Decision needed</div>
      <h2>${esc(ev.title)}</h2>
      <p>${esc(ev.body)}</p>
      <div class="choices">${ev.choices.map((c, i) => `<button class="choice" data-modal="choice" data-i="${i}"><b>${esc(c.label)}</b><span>${esc(c.note)}</span></button>`).join('')}</div>`,
      'event ' + ev.kind,
      false,
    );
  }

  // sending runs and snapshots to Claude
  let dbPromise = null;
  const getDb = () => {
    if (!dbPromise) {
      const c = window.claude;
      dbPromise = c && typeof c.use === 'function' ? c.use('db').catch(() => null) : Promise.resolve(null);
    }
    return dbPromise;
  };
  async function sendReport(report, button, sentMsg) {
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    const db = await getDb();
    if (db) {
      try {
        await db.doc('runs/' + report.id).set(report);
        closeModal();
        toast(sentMsg, 'good');
        return;
      } catch (e) {
        /* fall back to copying */
      }
    }
    showCopy(JSON.stringify(report));
  }
  const sendRun = (button) => sendReport(AIT.Report.build(G().s), button, 'Run sent. Tell Claude in the chat that it is there.');
  const FEEDBACK_TAGS = ['Confusing', 'Too slow', 'Too hard', 'Too easy', 'Bug', 'Fun'];
  function showFeedback() {
    const g = G(), s = g.s;
    if (ui.resumeSpeed == null) ui.resumeSpeed = g.speed;
    g.setSpeed(0);
    openModal(
      `<div class="eyebrow">Snapshot</div>
      <h2>Tell Claude what's going on</h2>
      <p class="small muted">Sends ${esc(s.company)} as it stands on ${fmt.date(s.day)}: ${(s.day / 365).toFixed(1)} years in, ${fmt.dur(s.playMs)} played, with every action and month so far.</p>
      <div class="field"><label for="feedback-text">What do you think? What's confusing, fun, broken or too slow?</label>
      <textarea id="feedback-text" rows="5" maxlength="4000" placeholder="Optional">${esc(ui.fbDraft)}</textarea></div>
      <div class="chips" role="group" aria-label="Quick tags">${FEEDBACK_TAGS.map((t) => `<button class="chip" data-modal="fb-tag" aria-pressed="false">${t}</button>`).join('')}</div>
      <div class="row gap"><button class="btn primary" data-modal="send-snapshot">Send snapshot</button><button class="btn ghost" data-modal="close">Cancel</button></div>`,
      'menu feedback',
    );
  }
  async function sendSnapshot(button) {
    const s = G().s;
    const text = $('feedback-text').value.trim();
    const tags = [...document.querySelectorAll('#modal-root .chip.on')].map((b) => b.textContent);
    const base = AIT.Report.build(s);
    const id = s.runId + '-snap-' + Date.now().toString(36);
    const feedback = (tags.length ? `[${tags.join(', ')}] ` : '') + text;
    // feedback first so it reads at the top; a unique id so snapshots never overwrite each other
    const report = Object.assign({ id, runId: s.runId, snapshot: true, feedback: feedback.trim(), feedbackTags: tags, ui: { screen: ui.screen, speedBefore: ui.resumeSpeed } }, base, { id, sentAt: new Date().toISOString() });
    await sendReport(report, button, "Snapshot sent. Tell Claude in the chat that it's there.");
    ui.fbDraft = '';
  }
  function showCopy(text) {
    openModal(
      `<div class="eyebrow">Run report</div>
      <h2>Copy this for Claude</h2>
      <p>This copy of the game can't send the report on its own. Copy it and paste it into a chat with Claude, or send it to whoever shared the game with you.</p>
      <textarea id="report-text" class="report-text" readonly>${esc(text)}</textarea>
      <div class="row gap"><button class="btn primary" data-modal="copy-report">Copy report</button><button class="btn ghost" data-modal="close">Close</button></div>`,
      'menu',
    );
  }

  const ENDING_TITLES = { aligned: 'AGI, done right', uneasy: 'AGI, with questions', reckless: 'AGI, at any cost' };
  const dailySeed = (d = new Date()) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const dailyLabel = (seed) => (seed ? String(seed).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '');
  const modeLabel = (s) => [s.mode === 'daily' ? `Daily challenge ${dailyLabel(s.seed)}` : s.mode === 'sandbox' ? 'Sandbox' : null, s.mode === 'daily' ? null : D.DIFFICULTY[s.difficulty || 'normal'].name].filter(Boolean).join(' · ');

  function showOver(s) {
    const v = Sim.derive(s);
    const win = s.over.win;
    const title = win ? ENDING_TITLES[s.over.ending] || 'You reached AGI first' : /money/.test(s.over.text) ? 'Out of money' : 'Beaten to AGI';
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · ${esc(modeLabel(s))}</div>
      <h2 class="chapter-title">${title}</h2>
      <p>${esc(s.over.text)}</p>
      <div class="kpis three">
        ${kpi('Years', (s.day / 365).toFixed(1))}${kpi('Played', fmt.dur(s.playMs))}${kpi('Best score', v.bestCap.toFixed(1))}
        ${kpi('Alignment', v.alignment.total + '/100')}${kpi('Valuation', money(v.valuation))}${kpi('Your stake', money(v.netWorth))}
      </div>
      ${s.mode === 'daily' ? '<div id="daily-board" class="daily-board small muted">Loading today\'s results…</div>' : ''}
      <div class="row gap wrap">${win ? '<button class="btn" data-modal="sandbox">Keep playing</button>' : ''}<button class="btn" data-modal="send-run">Send this run to Claude</button><button class="btn primary" data-modal="newgame">New game</button></div>`,
      'over ' + (win ? 'good' : 'bad'),
      false,
    );
    if (s.mode === 'daily') submitDaily(s, v).then(() => showDailyBoard(s));
  }

  const DAILY_KEY = 'ai-boom-tycoon-daily';
  const dailyScore = (r) => (r.win ? 1e6 - r.day : r.bestCap * 100 + Math.log10(1 + r.valuation));
  const dailyLine = (r) => (r.win ? `AGI on ${fmt.date(r.day)}` : `best score ${r.bestCap.toFixed(1)}`);
  function readLocalDaily() {
    try {
      return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }
  async function submitDaily(s, v) {
    const entry = { seed: s.seed, company: String(s.company).slice(0, 24), win: !!s.over.win, day: s.day, bestCap: v.bestCap, valuation: Math.round(v.valuation), ending: s.over.ending || null, at: new Date().toISOString() };
    const local = readLocalDaily();
    if (!local[s.seed] || dailyScore(entry) > dailyScore(local[s.seed])) {
      local[s.seed] = entry;
      try {
        localStorage.setItem(DAILY_KEY, JSON.stringify(local));
      } catch (e) {
        /* storage unavailable */
      }
    }
    const db = await getDb();
    if (!db || s.flags.dailySent) return;
    try {
      await db.doc('daily/' + s.seed + '-' + s.runId).set(entry);
      s.flags.dailySent = true;
    } catch (e) {
      /* viewers without write access still see their local best */
    }
  }
  async function showDailyBoard(s) {
    const box = $('daily-board');
    if (!box) return;
    let rows = [];
    const db = await getDb();
    if (db) {
      try {
        const snap = await db.collection('daily').where('seed', '==', s.seed).limit(500).get();
        rows = snap.docs.map((d) => d.data()).filter((r) => r && typeof r.day === 'number');
      } catch (e) {
        rows = [];
      }
    }
    const mine = readLocalDaily()[s.seed];
    if (!rows.length) {
      box.innerHTML = mine ? `Your best today: <b>${esc(dailyLine(mine))}</b>. Come back tomorrow for a new seed.` : '';
      return;
    }
    rows.sort((a, b) => dailyScore(b) - dailyScore(a));
    const you = rows.findIndex((r) => r.company === s.company && r.day === s.day);
    box.innerHTML = `<div class="eyebrow">Today's leaderboard · ${rows.length} run${rows.length === 1 ? '' : 's'}</div><ol class="daily-list">${rows
      .slice(0, 8)
      .map((r, i) => `<li class="${i === you ? 'you' : ''}"><span>${esc(r.company)}</span><span class="mono">${esc(dailyLine(r))}</span></li>`)
      .join('')}</ol>${you >= 8 ? `<p>You placed #${you + 1}.</p>` : ''}`;
  }

  // achievements, kept per browser
  const ACH_KEY = 'ai-boom-tycoon-achievements';
  let achGot = null;
  function achievements() {
    if (!achGot) {
      try {
        achGot = JSON.parse(localStorage.getItem(ACH_KEY) || '{}');
      } catch (e) {
        achGot = {};
      }
    }
    return achGot;
  }
  function checkAchievements(s, v) {
    if (s.mode === 'sandbox') return;
    const got = achievements();
    const fresh = D.ACHIEVEMENTS.filter((a) => !got[a.id] && a.check(s, v));
    if (!fresh.length) return;
    for (const a of fresh) got[a.id] = new Date().toISOString().slice(0, 10);
    try {
      localStorage.setItem(ACH_KEY, JSON.stringify(got));
    } catch (e) {
      /* storage unavailable */
    }
    // one toast, however many arrive at once
    toast(fresh.length === 1 ? `Achievement: ${fresh[0].name}` : `${fresh.length} achievements unlocked`, 'goal');
  }
  function showAchievements() {
    const got = achievements();
    const n = D.ACHIEVEMENTS.filter((a) => got[a.id]).length;
    openModal(
      `<div class="eyebrow">Achievements · ${n} of ${D.ACHIEVEMENTS.length}</div><h2>Trophy shelf</h2>
      <ul class="ach-list">${D.ACHIEVEMENTS.map((a) => `<li class="${got[a.id] ? 'got' : ''}"><b>${a.name}</b><span class="small muted">${a.desc}</span>${got[a.id] ? `<span class="mono tiny">${got[a.id]}</span>` : ''}</li>`).join('')}</ul>
      <p class="note">Achievements are saved in this browser. Sandbox games do not count.</p>
      <div class="row gap"><button class="btn" data-modal="menu">Back</button><button class="btn primary" data-modal="close">Resume</button></div>`,
      'menu',
    );
  }

  function showAgiReady(s) {
    const v = Sim.derive(s);
    const size = D.SIZE_BY_ID.agi;
    const rate = Math.max(0, v.effPF * 0.75) * v.trainMult;
    const d = rate > 0 ? Math.ceil(size.pfdays / rate) : Infinity;
    const top = v.topRival;
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · Research complete</div>
      <h2 class="chapter-title">The AGI Blueprint is done</h2>
      <p>Your researchers know how to build it. Now you have to do it, before ${top ? esc(Sim.RIVAL_BY_ID[top.id].name) + ' (at ' + top.cap.toFixed(1) + ')' : 'anyone else'} gets to 100.</p>
      <div class="kpis">
        ${kpi('Compute needed', fmt.pfdays(size.pfdays))}${kpi('Budget', money(size.fixedCost), '', s.cash < size.fixedCost ? 'bad-text' : '')}
        ${kpi('At 75% of your compute', days(d))}${kpi('Alignment', `${v.alignment.total}/100`, ENDINGS[v.alignment.ending][0])}
      </div>
      <p class="note">Start the AGI Project in Models. Switch the compute split to Manual while it runs, or serving users will starve the run.${d > 365 ? ' At your current compute it would take too long: build more hardware first.' : ''}</p>
      <div class="row gap"><button class="btn ghost" data-modal="close">Later</button><button class="btn primary" data-modal="agi-go">Open Models</button></div>`,
      'chapter',
      false,
    );
    sfx('chapter');
    AIT.Render.celebrate();
  }

  const HELP = `
    <ol class="help">
      <li><b>Build.</b> Pick a category in the toolbar on the left, then place GPUs, cooling, power and desks. Keep heat below cooling or every GPU slows down.</li>
      <li><b>Train.</b> Spend compute (PF-days) on models. Bigger models score higher on OmniBench.</li>
      <li><b>Deploy.</b> Your live model wins subscribers against rivals. Price, hype and uptime matter too.</li>
      <li><b>Grow.</b> Hire, research and move across the city from the Outer Sunset to Treasure Island. Raising money is optional.</li>
      <li><b>Win.</b> Research the AGI Blueprint and finish the AGI Project before any rival reaches 100.</li>
    </ol>
    <p class="note">The round buttons at the top open your windows; the company button at the bottom opens your headquarters, with what needs you next. Keys: Space pauses, 1–3 set speed, Esc closes and cancels placing. Scroll or pinch to zoom, drag to pan.</p>`;

  function newGameNote() {
    if (ui.ng.mode === 'daily') return `Today's seed is ${dailyLabel(dailySeed())}: everyone gets the same candidates, events and rival moves. Normal difficulty. Your result goes on today's leaderboard.`;
    if (ui.ng.mode === 'sandbox') return 'Start with $10M, no bankruptcy, and rivals that never quite reach AGI. Achievements are off.';
    return D.DIFFICULTY[ui.ng.difficulty].desc;
  }
  function showNewGame(canContinue) {
    const ch = F.CHAPTERS[0];
    openModal(
      `<div class="chapter-art"><img src="${AIT.Render.officePreview(0, 'Your lab')}" alt=""></div>
      <div class="eyebrow">Chapter ${ch.num}</div>
      <h2 class="chapter-title">${ch.title}</h2>
      <p>${typeof ch.text === 'function' ? ch.text({ rounds: [], subs: 0 }) : ch.text}</p>
      <div class="field"><label for="ng-company">Name your company</label><input id="ng-company" maxlength="24" value="Fogline Labs" autocomplete="off"></div>
      <div class="field"><label for="ng-family">Name your models</label><input id="ng-family" maxlength="12" value="Karl" autocomplete="off"></div>
      <div class="field"><span class="label">Game</span><div class="seg wide" role="group" aria-label="Game mode">${[['standard', 'Standard'], ['daily', 'Daily'], ['sandbox', 'Sandbox']].map(([id, n]) => `<button class="${ui.ng.mode === id ? 'on' : ''}" data-modal="ng-mode" data-id="${id}">${n}</button>`).join('')}</div></div>
      <div class="field" id="ng-diff-field"${ui.ng.mode === 'standard' ? '' : ' hidden'}><span class="label">Difficulty</span><div class="seg wide" role="group" aria-label="Difficulty">${Object.entries(D.DIFFICULTY).map(([id, d]) => `<button class="${ui.ng.difficulty === id ? 'on' : ''}" data-modal="ng-diff" data-id="${id}">${d.name}</button>`).join('')}</div></div>
      <p class="note" id="ng-note">${newGameNote()}</p>
      <p class="note">Your mentor, Mira, will show you around once you start.</p>
      <div class="row gap">${canContinue ? '<button class="btn" data-modal="close">Back</button>' : ''}<button class="btn primary" data-modal="start">Open the garage</button></div>`,
      'intro chapter',
      canContinue,
    );
  }

  function showChapter(s, ch) {
    openModal(
      `<div class="chapter-art"><img src="${AIT.Render.officePreview(s.officeLevel, s.company)}" alt=""></div>
      <div class="eyebrow">Chapter ${ch.num} of ${F.CHAPTERS.length}</div>
      <h2 class="chapter-title">${ch.title}</h2>
      <p>${typeof ch.text === 'function' ? ch.text(s) : ch.text}</p>
      <div class="eyebrow">What's new</div>
      <ul class="chapter-new">${(typeof ch.news === 'function' ? ch.news(s) : ch.news).map((n) => `<li>${n}</li>`).join('')}</ul>
      <div class="row gap"><button class="btn primary" data-modal="close">Let's go</button></div>`,
      'chapter',
      false,
    );
    sfx('chapter');
    AIT.Render.celebrate();
    G().keyframe(`Chapter ${ch.num}`, 'chapter'); // a save to come back to
  }

  // The moment a model finishes: the score counts up, the leaderboard shows
  // where it lands, and the internet has opinions.
  function showReveal(s, m) {
    const v = Sim.derive(s);
    const rivals = s.rivals.map((r) => ({ name: Sim.RIVAL_BY_ID[r.id].name, cap: r.cap, color: Sim.RIVAL_BY_ID[r.id].color }));
    const top = rivals.reduce((a, r) => (r.cap > a.cap ? r : a), rivals[0]);
    const rows = rivals.concat([{ name: s.company, cap: m.cap, color: 'var(--bridge)', you: true }]).sort((a, b) => b.cap - a.cap);
    const rank = rows.findIndex((r) => r.you) + 1;
    const ratio = m.cap / top.cap;
    const tier = m.cap > top.cap ? 'sota' : ratio >= 0.9 ? 'close' : ratio >= 0.6 ? 'mid' : 'low';
    const verdict = { sota: 'New state of the art. You are number one.', close: 'Within striking distance of the leaders.', mid: 'A solid model. The big labs are still ahead.', low: "Small, but it's yours. Everyone starts somewhere." }[tier];
    const fm = v.flagship;
    const better = !fm || m.cap > fm.cap;
    const short = m.name.split(' ')[0];
    const pool = F.REACTIONS[tier].slice().sort(() => Math.random() - 0.5).slice(0, 2);
    const reacts = pool.map(([h, t]) => [h, t.replace(/{m}/g, short).replace(/{c}/g, s.company).replace(/{r}/g, top.name)]);
    openModal(
      `<div class="eyebrow">Training complete · ${fmt.date(s.day)}</div>
      <h2>${esc(m.name)}</h2>
      <div class="reveal-score"><span class="reveal-num" data-to="${m.cap}">0.0</span><span class="reveal-unit">OmniBench<br><b class="mono">#${rank} of ${rows.length}</b></span></div>
      <p class="reveal-verdict ${tier}">${verdict}${!better ? ` It does not beat ${esc(fm.name)} (${fm.cap.toFixed(1)}).` : ''}</p>
      <div class="reveal-board">${rows.map((r) => `<div class="rb${r.you ? ' you' : ''}"><span>${esc(r.name)}</span><span class="rb-bar"><i style="width:${r.cap}%;background:${r.color}"></i></span><span class="mono small">${r.cap.toFixed(1)}</span></div>`).join('')}</div>
      <div class="reactions">${reacts.map(([h, t]) => `<div class="post"><span class="post-handle mono">${esc(h)}</span><span>${esc(t)}</span></div>`).join('')}</div>
      <div class="row gap">${
        better
          ? `<button class="btn primary" data-modal="reveal-deploy" data-id="${m.id}">Deploy ${esc(short)}</button><button class="btn ghost" data-modal="close">Not now</button>`
          : `<button class="btn primary" data-modal="close">Keep ${esc(fm.name.split(' ')[0])}</button><button class="btn ghost" data-modal="reveal-deploy" data-id="${m.id}">Deploy anyway</button>`
      }</div>`,
      'reveal ' + tier,
      false,
    );
    const num = document.querySelector('.reveal-num');
    const to = m.cap, t0 = performance.now(), dur = reducedMotion() ? 0 : 1400;
    const step = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      if (num.isConnected) num.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(1);
      if (k < 1 && num.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    sfx('fanfare');
    if (better) AIT.Render.celebrate();
  }

  // ---------- title screen, menu, saves, options ----------
  const LOGO = `<svg class="logo" viewBox="0 0 720 370" role="img" aria-label="AI Boom Tycoon">
    <defs>
      <linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe46b"/><stop offset=".55" stop-color="#ffb52a"/><stop offset="1" stop-color="#f2661c"/></linearGradient>
      <linearGradient id="lg-teal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ff8ef"/><stop offset="1" stop-color="#19b0c4"/></linearGradient>
      <linearGradient id="lg-arrow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1aa7b8"/><stop offset="1" stop-color="#5fe6e0"/></linearGradient>
    </defs>
    <g fill="none" stroke="#c7432a" stroke-width="5" stroke-linecap="round" opacity=".9">
      <path d="M20 250 Q95 150 150 70"/><path d="M150 70 Q360 250 570 70"/><path d="M570 70 Q625 150 700 250"/>
      <path d="M205 118v70M260 152v60M315 170v60M405 170v60M460 152v60M515 118v70" stroke-width="2.5"/>
    </g>
    <g fill="#d94b2b" stroke="#14202c" stroke-width="4">
      <path d="M138 64h24v200h-24z"/><path d="M558 64h24v200h-24z"/>
      <path d="M132 64h36v10h-36zM132 118h36v8h-36zM132 170h36v8h-36zM552 64h36v10h-36zM552 118h36v8h-36zM552 170h36v8h-36z"/>
    </g>
    <g stroke="#14202c" stroke-width="5" stroke-linejoin="round">
      <path d="M318 96L232 26l-12 30-26-8 24 60z" fill="url(#lg-arrow)"/>
      <path d="M402 96l86-70 12 30 26-8-24 60z" fill="url(#lg-arrow)"/>
      <rect x="318" y="30" width="84" height="84" rx="14" fill="#17303f"/>
      <path d="M330 22v10M346 22v10M362 22v10M378 22v10M394 22v10M330 112v10M346 112v10M362 112v10M378 112v10M394 112v10M310 44h10M310 60h10M310 76h10M310 92h10M400 44h10M400 60h10M400 76h10M400 92h10" stroke="#5fe6e0" stroke-width="4" stroke-linecap="round"/>
      <path d="M366 44l-20 32h15l-6 26 22-35h-15z" fill="url(#lg-gold)" stroke-width="3.5"/>
    </g>
    <g font-family="Lilita One, Arial Black, Impact, sans-serif" text-anchor="middle" stroke-linejoin="round">
      <text x="380" y="342" font-size="100" fill="#0c141c" stroke="#0c141c" stroke-width="16" transform="translate(0 9)">TYCOON</text>
      <text x="380" y="342" font-size="100" fill="url(#lg-teal)" stroke="#14202c" stroke-width="14" paint-order="stroke">TYCOON</text>
      <text x="360" y="252" font-size="152" fill="#0c141c" stroke="#0c141c" stroke-width="18" transform="translate(0 11)">AI BOOM</text>
      <text x="360" y="252" font-size="152" fill="url(#lg-gold)" stroke="#14202c" stroke-width="16" paint-order="stroke">AI BOOM</text>
    </g>
    <g fill="#fff">
      <path d="M118 150l4 11 11 4-11 4-4 11-4-11-11-4 11-4z"/><path d="M612 120l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path d="M548 300l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path d="M250 290l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z"/>
    </g>
  </svg>`;

  const KIND_LABEL = { auto: 'Auto save', milestone: 'Milestone', manual: 'Saved by hand' };
  const playClock = (ms) => {
    const t = Math.floor((ms || 0) / 1000);
    return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const created = (iso) => new Date(iso).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
  const SAVE_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="4" width="4" height="25" rx="1" fill="currentColor"/><rect x="21" y="4" width="4" height="25" rx="1" fill="currentColor"/><path d="M2 20 Q9 9 9 9 Q16 17 23 9 Q23 9 30 20" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="2" y="19" width="28" height="3" fill="currentColor"/></svg>';

  function savesList() {
    const groups = AIT.Saves.groups();
    if (!groups.length) return '<div class="empty" style="background:transparent;color:var(--hud-ink-2);border-color:var(--hud-4)">No saved games yet.</div>';
    if (!ui.saveSel || !groups.some((g) => g.some((e) => e.id === ui.saveSel))) ui.saveSel = groups[0][0].id;
    return `<div class="saves" role="listbox" aria-label="Saved games">${groups
      .map(
        (g) => `<div class="save-group"><span class="caret">▲</span>${esc(g[0].company)}<span class="tiny" style="color:var(--hud-ink-3);font-weight:600;margin-left:auto">${esc(D.DIFFICULTY[g[0].difficulty] ? (g[0].mode === 'standard' ? D.DIFFICULTY[g[0].difficulty].name : g[0].mode === 'daily' ? 'Daily' : 'Sandbox') : '')}${g[0].over ? ' · ' + (g[0].over === 'won' ? 'won' : 'lost') : ''}</span></div>
        ${g
          .map(
            (e) => `<button class="save-row${e.id === ui.saveSel ? ' on' : ''}" role="option" aria-selected="${e.id === ui.saveSel}" data-title="pick-save" data-id="${e.id}">
              <span class="ic">${SAVE_ICON}</span>
              <span style="min-width:0"><span class="t" style="display:block">${esc(e.office)}</span><span class="d" style="display:block">${fmt.date(e.day)}</span><span class="kind ${e.kind}" style="display:block">${KIND_LABEL[e.kind] || e.kind}${e.kind === 'milestone' && e.label ? ' · ' + esc(e.label) : ''}</span></span>
              <span class="r">Created: ${created(e.created)}<br>Time played: ${playClock(e.playMs)}<br><span class="ver">v${esc(e.version || '')}</span></span>
            </button>`,
          )
          .join('')}`,
      )
      .join('')}</div>`;
  }

  // in the title screen, sub-panels replace the menu; in game they open as a dialog
  function titlePanel(kind) {
    ui.titlePanel = kind;
    renderTitle();
  }
  function optionsHtml(s) {
    const on = (b) => (b ? 'on' : '');
    return `<div class="stack">
      <div class="opt-row"><span>Sound effects</span><div class="seg"><button class="${on(!AIT.Sound.muted)}" data-opt="sound" data-v="1">On</button><button class="${on(AIT.Sound.muted)}" data-opt="sound" data-v="0">Off</button></div></div>
      <div class="opt-row"><span>Music</span><div class="seg"><button class="${on(AIT.Sound.music)}" data-opt="music" data-v="1">On</button><button class="${on(!AIT.Sound.music)}" data-opt="music" data-v="0">Off</button></div></div>
      ${s ? `<div class="opt-row"><span>Mentor tips</span><div class="seg"><button class="${on(AIT.Mentor.enabled(s))}" data-opt="mentor" data-v="1">On</button><button class="${on(!AIT.Mentor.enabled(s))}" data-opt="mentor" data-v="0">Off</button></div></div>
      <div class="opt-row"><span>Tutorial</span><button class="btn small" data-opt="replay">Replay it</button></div>` : ''}
    </div>`;
  }
  const CREDITS = `<div class="credits stack">
      <p><b>AI Boom Tycoon</b> is a small management game about building an AI lab in San Francisco, from a garage in the Outer Sunset to Treasure Island.</p>
      <p>Inspired by the office-building loop of <b>E-Shop Tycoon</b>. Designed and built with Claude, playtested by Olivier.</p>
      <p>Every lab, investor and person in it is made up. Karl the Fog is real.</p>
      <p>Type: Lilita One and Saira Semi Condensed, from Google Fonts. Sound and music are synthesized in your browser.</p>
    </div>`;

  function renderTitle() {
    const el = $('title');
    document.body.classList.toggle('title-on', !!ui.title);
    if (!ui.title) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const last = AIT.Saves.latest();
    const k = ui.titlePanel;
    let body;
    if (k === 'load') {
      body = `<div class="title-panel panel-dark"><h2>Load game</h2>${savesList()}
        <div class="dark-actions"><button class="btn go" data-title="load-save"${disabled(!AIT.Saves.list().length)}>Load game</button>${ui.confirm === 'delete-save' ? '<button class="btn danger" data-title="really-delete">Yes, delete it</button>' : `<button class="btn danger" data-title="delete-save"${disabled(!AIT.Saves.list().length)}>Delete</button>`}</div>
        <button class="menu-item" data-title="back">Back</button></div>`;
    } else if (k === 'options') {
      body = `<div class="title-panel panel-dark"><h2>Options</h2>${optionsHtml(null)}<button class="menu-item" data-title="back">Back</button></div>`;
    } else if (k === 'credits') {
      body = `<div class="title-panel panel-dark"><h2>Credits</h2>${CREDITS}<button class="menu-item" data-title="back">Back</button></div>`;
    } else {
      body = `<nav class="title-menu" aria-label="Main menu">
        <button class="menu-item" data-title="continue"${disabled(!last)}>Continue${last ? `<span class="sub">${esc(last.company)} · ${esc(last.office)} · ${fmt.date(last.day)}</span>` : ''}</button>
        <button class="menu-item" data-title="new">New game</button>
        <button class="menu-item" data-title="load"${disabled(!last)}>Load game</button>
        <button class="menu-item" data-title="options">Options</button>
        <button class="menu-item" data-title="credits">Credits</button>
      </nav>`;
    }
    el.innerHTML = `${k ? '' : LOGO}${body}<div class="title-foot">v${AIT.Saves.VERSION} · San Francisco, 2023</div>`;
    const first = el.querySelector('.menu-item:not(:disabled), .save-row.on');
    if (first && !k) first.focus({ preventScroll: true });
  }
  function showTitle() {
    closeModal();
    ui.winOpen = false;
    ui.trayOpen = false;
    ui.title = true;
    ui.titlePanel = null;
    ui.confirm = null;
    AIT.Render.setTool(null);
    AIT.Mentor.reset();
    renderPanel(true);
    renderTitle();
  }
  function hideTitle() {
    ui.title = false;
    ui.titlePanel = null;
    renderTitle();
  }

  function showMenu() {
    const s = G().s;
    openModal(
      `<div class="eyebrow">${esc(modeLabel(s))} · played ${fmt.dur(s.playMs)}</div><h2>${esc(s.company)}</h2>
      <div class="menu-list">
        <button class="menu-item" data-modal="close">Resume</button>
        <button class="menu-item" data-modal="save">Save game<span class="sub">The game also saves itself every month</span></button>
        <button class="menu-item" data-modal="load">Load game</button>
        <button class="menu-item" data-modal="options">Options</button>
        <button class="menu-item" data-modal="help">How to play</button>
        <button class="menu-item" data-modal="achievements">Achievements · ${D.ACHIEVEMENTS.filter((a) => achievements()[a.id]).length}/${D.ACHIEVEMENTS.length}</button>
        <button class="menu-item" data-modal="feedback">Send snapshot + feedback</button>
        <button class="menu-item danger" data-modal="main-menu">Main menu</button>
      </div>`,
      'menu dark',
    );
  }
  function showLoad() {
    openModal(
      `<h2 style="text-transform:uppercase;letter-spacing:.05em">Load game</h2>${savesList()}
      <div class="dark-actions"><button class="btn go" data-modal="load-save"${disabled(!AIT.Saves.list().length)}>Load game</button>${ui.confirm === 'delete-save' ? '<button class="btn danger" data-modal="really-delete">Yes, delete it</button>' : `<button class="btn danger" data-modal="delete-save"${disabled(!AIT.Saves.list().length)}>Delete</button>`}</div>
      <button class="menu-item" data-modal="menu">Back</button>`,
      'menu dark wide',
    );
  }
  function showOptions() {
    openModal(`<h2 style="text-transform:uppercase;letter-spacing:.05em">Options</h2>${optionsHtml(G().s)}<button class="menu-item" data-modal="menu">Back</button>`, 'menu dark');
  }
  function showHelp() {
    openModal(`<h2 style="text-transform:uppercase;letter-spacing:.05em">How to play</h2>${HELP}<button class="menu-item" data-modal="menu">Back</button>`, 'menu dark');
  }
  function applyOption(opt, val) {
    const s = G().s;
    if (opt === 'sound' && AIT.Sound.muted === val) AIT.Sound.toggle();
    else if (opt === 'music' && AIT.Sound.music !== val) {
      AIT.Sound.unlock();
      AIT.Sound.toggleMusic();
    } else if (opt === 'mentor') AIT.Mentor.setEnabled(s, val);
    else if (opt === 'replay') {
      AIT.Mentor.replay(s);
      closeModal();
      return;
    }
    paintMute();
    if (ui.title) renderTitle();
    else showOptions();
  }
  function paintMute() {
    const mute = $('mute-btn'); // optional: sound lives in Options
    if (!mute) return;
    mute.classList.toggle('off', AIT.Sound.muted);
    mute.setAttribute('aria-label', AIT.Sound.muted ? 'Turn sound on' : 'Mute sound');
    mute.title = mute.getAttribute('aria-label');
  }
  function loadSave(id) {
    if (!G().loadSlot(id)) {
      toast('That save could not be read.', 'bad');
      return false;
    }
    closeModal();
    hideTitle();
    ui.winOpen = false;
    ui.trayOpen = false;
    ui.chapters = [];
    renderPanel(true);
    toast(`Loaded ${G().s.company}, ${fmt.date(G().s.day)}.`, 'good');
    return true;
  }

  // ---------- actions ----------
  function result(r, okMsg) {
    if (!r.ok) toast(r.msg, 'warn');
    else if (okMsg !== false && (okMsg || typeof r.msg === 'string')) toast(okMsg || r.msg, 'good');
    renderPanel(true);
    return r.ok;
  }

  function act(name, el) {
    const s = G().s;
    const id = el.dataset.id;
    switch (name) {
      case 'cat':
        ui.buildCat = id;
        ui.trayOpen = true;
        ui.winOpen = false;
        if (AIT.Render.tool && (AIT.Render.tool.mode === 'sell' || D.ITEMS[AIT.Render.tool.type].cat !== id)) AIT.Render.setTool(null);
        break;
      case 'build':
        ui.trayOpen = !ui.trayOpen || !!(AIT.Render.tool && AIT.Render.tool.mode === 'sell');
        ui.winOpen = false;
        if (!ui.trayOpen || (AIT.Render.tool && AIT.Render.tool.mode === 'sell')) AIT.Render.setTool(null);
        break;
      case 'close-tray':
        ui.trayOpen = false;
        AIT.Render.setTool(null);
        break;
      case 'tab':
        ui.tabs[ui.screen] = id;
        ui.confirm = null;
        if ($('win-body')) $('win-body').scrollTop = 0;
        break;
      case 'stop-camp':
        result(A.stopCampaign(s, id), false);
        break;
      case 'scroll-camps': {
        const el = $('camps');
        if (el) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      case 'tool':
        if (el.classList.contains('locked')) {
          toast(Sim.itemLocked(s, id), 'warn');
          break;
        }
        AIT.Render.setTool(AIT.Render.tool && AIT.Render.tool.type === id ? null : { mode: 'place', type: id });
        break;
      case 'sellmode':
        AIT.Render.setTool(AIT.Render.tool && AIT.Render.tool.mode === 'sell' ? null : { mode: 'sell' });
        ui.trayOpen = false;
        ui.winOpen = false;
        break;
      case 'notool':
        AIT.Render.setTool(null);
        break;
      case 'move':
        if (result(A.moveOffice(s), false)) AIT.Render.fit(D.OFFICES[s.officeLevel].size);
        break;
      case 'hire':
        if (result(A.hire(s, id))) sfx('blip');
        break;
      case 'train':
        result(A.train(s, id));
        break;
      case 'refresh':
        result(A.refreshCandidates(s));
        break;
      case 'expand':
        ui.expanded[id] = !ui.expanded[id];
        break;
      case 'team-filter':
        ui.teamFilter = id;
        break;
      case 'tech':
        ui.techSel = ui.techSel === id ? null : id;
        break;
      case 'tech-filter':
        ui.techFilter = id;
        break;
      case 'open-tier':
        ui.openTiers[id] = true;
        break;
      case 'news-filter':
        ui.newsFilter = id;
        break;
      case 'research':
        if (result(A.research(s, id), false)) {
          sfx('unlock');
          ui.techSel = null;
        }
        break;
      case 'pick-size':
        ui.train.size = id;
        break;
      case 'pick-data':
        ui.train.data[id] = !ui.train.data[id];
        break;
      case 'start-train':
        result(A.startTraining(s, ui.train.size, ui.train.data));
        break;
      case 'deploy':
        if (result(A.deploy(s, id))) sfx('coin');
        break;
      case 'alloc-auto':
        A.setAlloc(s, true);
        break;
      case 'alloc-manual':
        A.setAlloc(s, false);
        break;
      case 'campaign':
        result(A.campaign(s, id));
        break;
      case 'launch':
        if (result(A.launchProduct(s, id), false)) {
          sfx('fanfare');
          AIT.Render.celebrate();
        }
        break;
      case 'pitch': {
        const r = A.pitch(s);
        toast(r.msg, r.ok && s.funding.offers.length ? 'good' : 'warn');
        break;
      }
      case 'accept':
        if (result(A.acceptOffer(s, id), false)) {
          sfx('coin');
          AIT.Render.celebrate();
        }
        break;
      case 'push': {
        const r = A.pushOffer(s, id);
        toast(r.msg, r.ok ? 'good' : 'warn');
        sfx(r.ok ? 'coin' : 'error');
        break;
      }
      case 'walk':
        result(A.walkAway(s));
        break;
      case 'confirm': {
        const key = el.dataset.key;
        if (ui.confirm !== key) {
          ui.confirm = key;
          clearTimeout(ui.confirmT);
          ui.confirmT = setTimeout(() => {
            ui.confirm = null;
            renderPanel(true);
          }, 3500);
          break;
        }
        ui.confirm = null;
        const [kind, arg] = key.split(':');
        if (kind === 'move') {
          // close the window so you land in the new office, not on the next Move button
          if (result(A.moveOffice(s), false)) {
            AIT.Render.fit(D.OFFICES[s.officeLevel].size);
            ui.winOpen = false;
          }
        } else if (kind === 'fire') result(A.fire(s, arg));
        else if (kind === 'open') result(A.openSource(s, arg));
        else if (kind === 'cancel-train') result(A.cancelTraining(s));
        break;
      }
      case 'sell-selected': {
        const it = s.items.find((i) => i.id === AIT.Render.selected);
        if (it) {
          const r = A.sell(s, it.id);
          if (r.ok) {
            AIT.Render.float(it.x, it.y, '+' + money(r.msg), '#248a5a');
            AIT.Render.selected = null;
          } else toast(r.msg, 'warn');
        }
        break;
      }
      case 'close-inspect':
        AIT.Render.selected = null;
        break;
    }
    renderPanel(true);
    renderInspect(s);
  }

  // open a window, optionally on a tab
  function openWindow(id, tab) {
    const s = G().s;
    if (!SCREENS[id] || !screenOpen(s, id)) return;
    if (tab && SCREENS[id].tabs.some(([t]) => t === tab)) ui.tabs[id] = tab;
    ui.screen = id;
    ui.winOpen = true;
    ui.trayOpen = false;
    ui.confirm = null;
    ui.notifOpen = false;
    AIT.Render.setTool(null);
    Progress.seeTab(s, id);
    if (ui.winBuilt === id && $('win-body')) $('win-body').scrollTop = 0;
    renderPanel(true);
  }
  function closeWindow() {
    ui.winOpen = false;
    ui.confirm = null;
    renderPanel(true);
  }
  const setScreen = (id) => openWindow(id);

  // go somewhere: 'team', 'finance:funding', 'build:cooling' (a build shelf), 'models:run'
  function goTo(target) {
    const [screen, sub, size] = target.split(':');
    if (screen === 'models' && size) ui.train.size = size; // 'models:train:small' opens Train on that size
    ui.notifOpen = false;
    if (screen === 'build') {
      if (!sub) return openWindow('hq', 'office');
      ui.buildCat = sub;
      ui.trayOpen = true;
      ui.winOpen = false;
      renderPanel(true);
      return;
    }
    if (screen === 'models' && sub === 'run') {
      // open the planner on the suggested run, with every data source it assumed
      const s = G().s;
      ui.train.size = null;
      for (const src of D.DATA_SOURCES) ui.train.data[src.id] = !src.tech || !!s.techs[src.tech];
      return openWindow('models', 'train');
    }
    openWindow(screen, sub);
  }

  // canvas callbacks
  const canvasCb = {
    place(x, y) {
      const s = G().s;
      const tool = AIT.Render.tool;
      if (!tool) return;
      const r = A.place(s, tool.type, x, y);
      if (r.ok) {
        AIT.Render.float(x, y, '-' + money(r.msg), '#cf3f35');
        sfx('place');
        renderPanel(true);
      } else if (r.msg !== 'That tile is taken' && r.msg !== 'Outside the office') {
        const now = performance.now();
        if (now - ui.placeWarnAt > 1200) {
          ui.placeWarnAt = now;
          toast(r.msg, 'warn');
        }
      }
    },
    sell(x, y) {
      const s = G().s;
      const it = Sim.itemAt(s, x, y);
      if (!it) return;
      const r = A.sell(s, it.id);
      if (r.ok) {
        AIT.Render.float(it.x, it.y, '+' + money(r.msg), '#248a5a');
        sfx('sell');
      } else toast(r.msg, 'warn');
      renderPanel(true);
    },
    select(x, y) {
      const s = G().s;
      const it = Sim.itemAt(s, x, y);
      AIT.Render.selected = it ? it.id : null;
      renderInspect(s);
    },
    cancel() {
      AIT.Render.setTool(null);
      renderPanel(true);
    },
  };

  // ---------- init ----------
  function init() {
    const clickAct = (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        sfx('tick');
        goTo(go.dataset.go);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      act(b.dataset.act, b);
    };
    // window buttons toggle their window
    const toggleWindow = (id) => {
      sfx('tick');
      if (ui.winOpen && ui.screen === id) closeWindow();
      else openWindow(id);
    };
    $('rail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-screen]');
      if (b) toggleWindow(b.dataset.screen);
    });
    $('company-btn').addEventListener('click', () => toggleWindow('hq'));

    const win = $('win-root');
    win.addEventListener('click', (e) => {
      const w = e.target.closest('[data-win]');
      if (w) {
        if (w.dataset.win === 'close') closeWindow();
        else if (w.dataset.win === 'help') {
          ui.helpOpen[ui.screen] = !ui.helpOpen[ui.screen];
          renderPanel(true);
        }
        return;
      }
      clickAct(e);
    });
    win.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) {
        e.preventDefault();
        act(e.target.dataset.act, e.target);
      }
    });
    win.addEventListener('input', (e) => {
      const el = e.target;
      const s = G().s;
      if (el.dataset.input === 'price') {
        A.setPrice(s, Number(el.value));
        const lab = $('price-label');
        if (lab) lab.textContent = `$${s.price}/mo`;
      } else if (el.dataset.input === 'pprice') {
        A.setProductPrice(s, el.dataset.id, Number(el.value));
        const lab = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (lab) lab.textContent = `$${s.products[el.dataset.id].price.toLocaleString('en-US')}/mo`;
      } else if (el.dataset.input === 'alloc') {
        A.setAlloc(s, false, Number(el.value) / 100);
        const lab = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (lab) lab.textContent = `${el.value}%`;
      } else if (el.dataset.input === 'renew') {
        A.setAutoRenew(s, el.dataset.id, el.checked);
        renderPanel(true);
      }
    });
    // don't redraw the window under a finger or a dragged slider
    win.addEventListener('pointerdown', () => (ui.interacting = true));
    const release = () => {
      if (!ui.interacting) return;
      setTimeout(() => {
        ui.interacting = false;
        renderPanel(true);
      }, 150);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    for (const id of ['dock', 'tools', 'toolbar', 'inspect', 'advisor', 'banner', 'notif-panel', 'hud-bottom']) $(id).addEventListener('click', clickAct);
    $('notif-panel').addEventListener('click', (e) => {
      if (e.target.closest('[data-notif="close"]')) {
        ui.notifOpen = false;
        renderNotif(G().s, ui.lastList || []);
      }
    });
    $('notif-btn').addEventListener('click', () => {
      ui.notifOpen = !ui.notifOpen;
      renderNotif(G().s, ui.lastList || []);
    });
    $('speed').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (b) G().setSpeed(Number(b.dataset.speed));
    });
    const mute = $('mute-btn');
    paintMute();
    if (mute)
      mute.addEventListener('click', () => {
        AIT.Sound.toggle();
        paintMute();
        sfx('tick');
      });
    window.addEventListener('pointerdown', () => AIT.Sound.unlock(), { once: true });
    $('menu-btn').addEventListener('click', () => {
      ui.confirm = null;
      showMenu();
    });
    $('feedback-btn').addEventListener('click', () => showFeedback());
    document.querySelectorAll('[data-zoom]').forEach((b) =>
      b.addEventListener('click', () => {
        const z = b.dataset.zoom;
        if (z === 'fit') AIT.Render.fit(D.OFFICES[G().s.officeLevel].size);
        else AIT.Render.zoomBy(z === 'in' ? 1.25 : 0.8);
      }),
    );

    // the title screen
    $('title').addEventListener('click', (e) => {
      const b = e.target.closest('[data-title], [data-opt]');
      if (!b || b.disabled) return;
      sfx('tick');
      if (b.dataset.opt) return applyOption(b.dataset.opt, b.dataset.v === '1');
      const what = b.dataset.title;
      if (what === 'continue') {
        const last = AIT.Saves.latest();
        if (last) loadSave(last.id);
      } else if (what === 'new') showNewGame(true);
      else if (what === 'load' || what === 'options' || what === 'credits') {
        ui.confirm = null;
        titlePanel(what);
      } else if (what === 'back') titlePanel(null);
      else if (what === 'pick-save') {
        ui.saveSel = b.dataset.id;
        ui.confirm = null;
        renderTitle();
      } else if (what === 'load-save' && ui.saveSel) loadSave(ui.saveSel);
      else if (what === 'delete-save') {
        ui.confirm = 'delete-save';
        renderTitle();
      } else if (what === 'really-delete' && ui.saveSel) {
        AIT.Saves.remove(ui.saveSel);
        ui.saveSel = null;
        ui.confirm = null;
        renderTitle();
      }
    });
    $('title').addEventListener('dblclick', (e) => {
      const b = e.target.closest('[data-title="pick-save"]');
      if (b) loadSave(b.dataset.id);
    });

    $('modal-root').addEventListener('click', (e) => {
      const b = e.target.closest('[data-modal], [data-opt]');
      if (!b) return;
      const g = G();
      if (b.dataset.opt) return applyOption(b.dataset.opt, b.dataset.v === '1');
      const what = b.dataset.modal;
      if (what === 'close') closeModal();
      else if (what === 'choice') {
        Sim.resolveEvent(g.s, Number(b.dataset.i));
        closeModal();
        renderPanel(true);
      } else if (what === 'ng-mode' || what === 'ng-diff') {
        if (what === 'ng-mode') ui.ng.mode = b.dataset.id;
        else ui.ng.difficulty = b.dataset.id;
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        $('ng-diff-field').hidden = ui.ng.mode !== 'standard';
        $('ng-note').textContent = newGameNote();
      } else if (what === 'start') {
        const company = ($('ng-company').value || '').trim() || 'Fogline Labs';
        const family = ($('ng-family').value || '').trim().replace(/\s+/g, '') || 'Karl';
        const opts = { mode: ui.ng.mode, difficulty: ui.ng.mode === 'standard' ? ui.ng.difficulty : 'normal' };
        if (opts.mode === 'daily') opts.seed = dailySeed();
        closeModal();
        hideTitle();
        ui.overShown = false;
        ui.winOpen = false;
        ui.trayOpen = false;
        ui.chapters = [];
        g.newGame(company, family, opts);
      } else if (what === 'save') {
        const saved = g.saveManual();
        toast(saved ? 'Game saved' : 'Could not save: browser storage is full or blocked.', saved ? 'good' : 'bad');
        closeModal();
      } else if (what === 'load') {
        ui.confirm = null;
        showLoad();
      } else if (what === 'pick-save') {
        ui.saveSel = b.dataset.id;
        ui.confirm = null;
        showLoad();
      } else if (what === 'load-save' && ui.saveSel) loadSave(ui.saveSel);
      else if (what === 'delete-save') {
        ui.confirm = 'delete-save';
        showLoad();
      } else if (what === 'really-delete' && ui.saveSel) {
        AIT.Saves.remove(ui.saveSel);
        ui.saveSel = null;
        ui.confirm = null;
        showLoad();
      } else if (what === 'options') showOptions();
      else if (what === 'help') showHelp();
      else if (what === 'main-menu') {
        g.save();
        showTitle();
      } else if (what === 'newgame') {
        showNewGame(false);
      } else if (what === 'send-run') {
        sendRun(b);
      } else if (what === 'feedback') {
        showFeedback();
      } else if (what === 'fb-tag') {
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', b.classList.contains('on'));
      } else if (what === 'send-snapshot') {
        sendSnapshot(b);
      } else if (what === 'copy-report') {
        const ta = $('report-text');
        const done = () => toast('Copied. Paste it into a chat with Claude.', 'good');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(done, () => {
            ta.focus();
            ta.select();
            toast('Select all and copy the text by hand.', 'warn');
          });
        } else {
          ta.focus();
          ta.select();
        }
      } else if (what === 'reveal-deploy') {
        const r = A.deploy(g.s, b.dataset.id);
        closeModal();
        if (r.ok) {
          sfx('coin');
          toast(r.msg, 'good');
        }
        renderPanel(true);
      } else if (what === 'achievements') showAchievements();
      else if (what === 'menu') showMenu();
      else if (what === 'agi-go') {
        closeModal();
        ui.train.size = 'agi';
        goTo('models:train');
      } else if (what === 'sandbox') {
        A.sandbox(g.s);
        closeModal();
      }
    });
    $('modal-root').addEventListener('dblclick', (e) => {
      const b = e.target.closest('[data-modal="pick-save"]');
      if (b) loadSave(b.dataset.id);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key !== 'Escape' && (e.target.closest('#modal-root') || ui.title)) return; // Space presses the focused button
      const g = G();
      if (e.key === 'Escape') {
        if (ui.title) {
          if (ui.titlePanel) titlePanel(null);
          return;
        }
        if (ui.modal) {
          if (!String(ui.modal).startsWith('event') && !String(ui.modal).startsWith('over')) closeModal();
          return;
        }
        if (AIT.Render.tool) AIT.Render.setTool(null);
        else if (ui.winOpen) ui.winOpen = false;
        else if (ui.trayOpen) ui.trayOpen = false;
        ui.notifOpen = false;
        AIT.Render.selected = null;
        renderPanel(true);
        renderInspect(g.s);
      } else if (e.key === ' ') {
        e.preventDefault();
        g.setSpeed(g.speed ? 0 : g.lastSpeed || 1);
      } else if (['1', '2', '3'].includes(e.key)) {
        g.setSpeed(Number(e.key));
      }
    });
  }

  function frame(now) {
    const g = G();
    const s = g.s;
    if (!ui.modal && !ui.title) {
      if (s.reveal) {
        const m = s.models.find((x) => x.id === s.reveal);
        s.reveal = null;
        if (m) showReveal(s, m);
      } else if (ui.chapters.length) showChapter(s, ui.chapters.shift());
      else if (s.events.length) showEvent(s);
      else if (s.techs.agi_theory && !s.flags.agiPrompted && !s.over) {
        s.flags.agiPrompted = true;
        showAgiReady(s);
      } else if (s.over && !s.over.sandbox && !ui.overShown) {
        ui.overShown = true;
        showOver(s);
      }
    }
    AIT.Mentor.frame(now);
    if (now - ui.lastHud > 150) {
      ui.lastHud = now;
      const v = Sim.derive(s);
      if (!ui.title) {
        const got = Progress.check(s, v);
        // during the checklist the yellow dots say it; Mira's list leads the way
        if (!AIT.Mentor.tutorialActive(s)) for (const n of got.notes) toast(n, 'unlock');
        if (got.chapter) ui.chapters.push(got.chapter);
      }
      const list = suggestions(s, v);
      ui.lastList = list;
      renderTop(s, v);
      renderRail(s, list);
      renderTools(s);
      renderStage(s, v, list);
      renderInspect(s);
      renderDockIfNeeded(s);
      if (!ui.title) checkAchievements(s, v);
      AIT.Mentor.check(s, v, !!ui.modal || ui.title);
    }
    if (now - ui.lastPanel > 400) {
      ui.lastPanel = now;
      renderPanel(false);
    }
  }

  AIT.UI = {
    init, frame, toast, renderPanel, canvasCb, showNewGame, showTitle, closeModal, goTo,
    isBlocking: () => !!ui.modal || ui.title || AIT.Mentor.blocking(),
    resetOver: () => (ui.overShown = false),
    openScreen: (id) => openWindow(id),
    closeWindow,
  };
})(window);
