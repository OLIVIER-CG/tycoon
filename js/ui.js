/* DOM user interface: HUD, side panel tabs, modals, toasts and the inspector. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA, Sim = AIT.Sim, A = Sim.actions, Progress = AIT.Progress, F = AIT.FLAVOR;
  const sfx = (name) => AIT.Sound && AIT.Sound.play(name);

  // ---------- formatting ----------
  const scaled = (a, units, suffixFirst) => {
    for (const [u, s] of units) {
      if (a >= u) {
        const x = a / u;
        return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + s;
      }
    }
    return suffixFirst(a);
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
    pfdays(n) {
      return fmt.num(n) + ' PF-days';
    },
    kw(n) {
      if (n < 1000) return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' kW';
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + ' MW';
      return (n / 1e6).toFixed(2) + ' GW';
    },
    date(day) {
      return Sim.dateOf(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    },
    pct(x, dp = 0) {
      return (x * 100).toFixed(dp) + '%';
    },
    // real time spent playing
    dur(ms) {
      const min = Math.round((ms || 0) / 60000);
      if (min < 1) return 'under a minute';
      if (min < 60) return min + ' min';
      return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
    },
  });
  const money = fmt.money;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const ui = {
    tab: 'build',
    buildCat: 'compute',
    train: { size: null, data: { licensed: true, synthetic: true, human: true } },
    confirm: null,
    lastHtml: '',
    interacting: false,
    lastPanel: 0,
    lastHud: 0,
    modal: null,
    overShown: false,
    placeWarnAt: 0,
    chapters: [],
    ng: { mode: 'standard', difficulty: 'normal' },
  };
  const $ = (id) => document.getElementById(id);
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const G = () => AIT.game;

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
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4800);
    setTimeout(() => el.remove(), 5400);
  }

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

  function sparkline(values, w, h, cls) {
    if (values.length < 2) return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
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

  function statLine(d) {
    const big = d.size > 1 ? ` · ${d.size}×${d.size}` : '';
    if (d.pf) return `${fmt.pf(d.pf)} · ${fmt.kw(d.power)}${big}`;
    if (d.cooling) return `${fmt.kw(d.cooling)} · reach ${d.radius}${big}`;
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

  // ---------- tabs ----------
  const TABS = {
    build: { name: 'Build', render: renderBuild },
    team: { name: 'Team', render: renderTeam },
    research: { name: 'R&D', render: renderResearch },
    models: { name: 'Models', render: renderModels },
    market: { name: 'Market', render: renderMarket },
    finance: { name: 'Finance', render: renderFinance },
    race: { name: 'Race', render: renderRace },
  };

  function renderBuild(s, v) {
    const o = v.office, next = D.OFFICES[s.officeLevel + 1];
    let nextHtml = next ? '' : '<p class="muted small">You own the biggest campus there is.</p>';
    if (next && Progress.has(s, 'office:next')) {
      const round = next.round && D.ROUNDS.find((r) => r.id === next.round);
      const gated = round && !s.rounds.includes(next.round);
      nextHtml = `
        <div class="next-office">
          <div class="row between"><div><div class="eyebrow">Next office</div><h4>${next.name}</h4></div><span class="tag mono">${next.size}×${next.size}</span></div>
          <p class="small muted">${next.blurb}</p>
          <dl class="kv small"><div><dt>Power</dt><dd class="mono">${fmt.kw(next.power)}</dd></div><div><dt>Cooling</dt><dd class="mono">${fmt.kw(next.cooling)}</dd></div><div><dt>Rent</dt><dd class="mono">${money(next.rent)}/mo</dd></div></dl>
          ${gated ? `<p class="lock-note">Requires your ${round.name}</p>` : `<button class="btn primary wide" data-act="move"${disabled(s.cash < next.moveCost)}>Move for ${money(next.moveCost)}</button>`}
        </div>`;
    }
    const cats = D.ITEM_CATS.filter((c) => Progress.has(s, 'cat:' + c.id));
    if (!cats.some((c) => c.id === ui.buildCat)) ui.buildCat = 'compute';
    // show what you can buy, plus one teaser of what comes next
    const all = Object.entries(D.ITEMS).filter(([, d]) => d.cat === ui.buildCat);
    const locked = all.filter(([t]) => Sim.itemLocked(s, t));
    const items = all.filter(([t]) => !Sim.itemLocked(s, t) || t === (locked[0] && locked[0][0]));
    const tool = AIT.Render.tool;
    return `
      <section class="card">
        <div class="row between"><div><div class="eyebrow">Your office</div><h3>${o.name}</h3></div><span class="tag mono">${o.size}×${o.size}</span></div>
        ${meter('Power draw', v.power, v.powerCap, fmt.kw)}
        ${heatBlock(s, v)}
        ${Progress.has(s, 'cat:office') ? meter('Desks used', s.staff.length, v.seats, (n) => n, 1.01) : ''}
        <p class="small muted">Compute ${fmt.pf(v.effPF)} usable of ${fmt.pf(v.pf)} · rent ${money(o.rent)}/mo · power bill ${money(v.powerCostDay * 30)}/mo</p>
        ${nextHtml}
      </section>
      <div class="chips" role="group" aria-label="Item category">${cats.map((c) => `<button class="chip${ui.buildCat === c.id ? ' on' : ''}" data-act="cat" data-id="${c.id}">${c.name}</button>`).join('')}</div>
      <div class="items">
        ${items
          .map(([type, d]) => {
            const lock = Sim.itemLocked(s, type);
            const cost = Sim.itemCost(s, type);
            const sel = tool && tool.mode === 'place' && tool.type === type;
            return `<button class="item${sel ? ' on' : ''}${lock ? ' locked' : ''}" data-act="tool" data-id="${type}" title="${esc(d.desc)}">
              ${lock ? '<span class="item-next">Next</span>' : ''}
              <img src="${AIT.Render.icon(type)}" alt="" width="56" height="56">
              <span class="item-name">${d.name}</span>
              <span class="item-stat mono">${statLine(d)}</span>
              ${lock ? `<span class="item-lock">${lock}</span>` : `<span class="item-price mono${s.cash < cost ? ' short' : ''}">${money(cost)}${cost !== d.cost ? ' *' : ''}</span>`}
            </button>`;
          })
          .join('')}
      </div>
      <div class="row gap">
        <button class="btn${tool && tool.mode === 'sell' ? ' danger' : ''}" data-act="sellmode">${tool && tool.mode === 'sell' ? 'Selling: tap items' : 'Sell items (50% back)'}</button>
        ${tool ? '<button class="btn ghost" data-act="notool">Done</button>' : ''}
      </div>
      <p class="small muted">${locked.length > 1 ? `${locked.length - 1} more to discover as you grow. ` : ''}${Object.keys(D.ITEMS).some((t) => Sim.itemCost(s, t) !== D.ITEMS[t].cost) ? '* Hardware prices are moving with the market right now.' : ''}</p>`;
  }

  // Heat is local, so show how many GPUs are too hot rather than one total.
  function heatBlock(s, v) {
    const n = v.computeItems, hot = v.hotItems;
    const cls = hot === 0 ? 'ok' : v.thermal < 0.85 ? 'bad' : 'warn';
    const txt = !n ? 'No GPUs yet' : hot === 0 ? `All ${n} cool` : `${hot} of ${n} overheating`;
    const lost = v.pf > 0 ? 1 - v.thermal : 0;
    return `<div class="meter ${cls}" data-coach="heat"><div class="meter-top"><span>GPU heat</span><span class="mono">${txt}</span></div>${bar(n ? 1 - hot / n : 0)}</div>
      <p class="small muted">${hot ? `Hot GPUs glow red and slow down, costing you ${lost < 0.01 ? 'under 1%' : fmt.pct(lost)} of your compute. ` : ''}Each cooler only reaches GPUs inside its square: place one and the blue square shows where. The building itself cools ${fmt.kw(v.office.cooling)}, shared by every GPU.</p>`;
  }

  // ---------- effects, spelled out ----------
  const pctTxt = (x) => {
    const p = Math.abs(x * 100);
    return (p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%';
  };
  const cheapestTech = (s) => D.TECHS.filter((t) => !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];

  // What one person adds, what it means right now, and whether it pays off.
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
      effects.push(`−${pctTxt(imp.scandal)} scandal risk`);
      now = v.flagship ? 'Fewer jailbreak scandals, and fewer bills to clean them up.' : 'Matters once a model is live.';
      if (!v.flagship) verdict = ['warn', 'Not useful yet'];
    }
    return { effects, now, verdict };
  }

  function impactBlock(d, prefix) {
    return `<div class="impact"><span class="impact-label">${prefix}</span>${d.effects.map((e) => `<span class="fx">${e}</span>`).join('')}</div>
      <div class="impact-now">${d.now}${d.verdict ? ` <span class="tag ${d.verdict[0]}">${d.verdict[1]}</span>` : ''}</div>`;
  }

  function hireAdvice(s, v) {
    if (!v.flagship) return 'No model is live yet. Researchers and engineers help you build one. Growth and safety staff can wait.';
    const f = Sim.shareFactors(s, v);
    if (f && f.model.mult < 0.3) return `Your model trails ${f.rival} (${f.model.you.toFixed(1)} vs ${f.model.them.toFixed(1)}). A better model matters far more than growth staff right now: researchers, engineers and GPUs.`;
    if (v.payroll > Math.max(v.mrr, 1) * 2 && s.cash < v.burnMonth * 6) return 'Payroll is already well above revenue. Hire only when it clearly pays off.';
    return 'Growth staff pay off once your model is competitive. Engineers help most while you train.';
  }

  function renderTeam(s, v) {
    const free = v.seats - s.staff.length;
    const avg = s.staff.reduce((a, p) => a + p.morale, 0) / Math.max(1, s.staff.length);
    const nextIn = 7 - (s.day - s.candidatesDay);
    const refreshCost = 2000 * (1 + s.officeLevel * 2);
    const mood = Sim.moraleTarget(s, v);
    const team = s.staff.filter((p) => !p.founder);
    const teamAvg = team.length ? team.reduce((a, p) => a + p.morale, 0) / team.length : 100;
    const staff = s.staff
      .map((p) => {
        const r = D.ROLES[p.role];
        const training = p.trainUntil > s.day;
        const cost = Sim.trainCostFor(p);
        const d = describeImpact(s, v, p.role, Sim.impact(s, v, { remove: p.id }), false, p.salary, p.founder);
        return `<div class="person">
          <span class="role" style="--c:${p.founder ? 'var(--accent)' : r.color}">${r.short}</span>
          <div class="grow">
            <div class="name">${esc(p.name)}${p.founder ? ' <span class="tag">Founder</span>' : ''}</div>
            <div class="sub mono">skill ${p.skill}/10 · ${p.founder ? 'no salary' : money(p.salary) + '/mo'} · working at ${Math.round((0.7 + (0.5 * p.morale) / 100) * 100)}%</div>
            ${training ? `<div class="impact-now">Away on a course for ${p.trainUntil - s.day} more days, so adding nothing right now.</div>` : impactBlock(d, 'Adds')}
            <div class="mood" title="Morale ${Math.round(p.morale)}%">${bar(p.morale / 100, p.morale < 35 ? 'bad' : p.morale < 55 ? 'warn' : 'ok')}</div>
          </div>
          <div class="actions col">
            <button class="btn small" data-act="train" data-id="${p.id}"${disabled(training || p.skill >= 10 || s.cash < cost)} title="14-day course: +1 skill">Train ${money(cost)}</button>
            ${p.founder ? '' : confirmBtn('fire:' + p.id, 'Fire', 'Confirm', 'small ghost')}
          </div>
        </div>`;
      })
      .join('');
    const cands = s.candidates
      .map((c) => {
        const r = D.ROLES[c.role];
        const d = describeImpact(s, v, c.role, Sim.impact(s, v, { add: c }), true, c.salary);
        return `<div class="person">
          <span class="role" style="--c:${r.color}">${r.short}</span>
          <div class="grow">
            <div class="name">${esc(c.name)}${c.star ? ' <span class="tag hot">Star</span>' : ''}</div>
            <div class="sub mono">${r.name} · skill ${c.skill}/10 · ${money(c.salary)}/mo</div>
            ${c.bio ? `<div class="bio">${esc(c.bio)}</div>` : ''}
            ${impactBlock(d, 'If hired')}
          </div>
          <div class="actions"><button class="btn small primary" data-act="hire" data-id="${c.id}"${disabled(free <= 0 || s.cash < c.salary)}>Hire</button></div>
        </div>`;
      })
      .join('');
    const does = [
      ['Research', `${v.rpStaff.toFixed(1)} RP/day${v.rpCompute > 0.05 ? ` (+${v.rpCompute.toFixed(1)} from idle GPUs)` : ''}`],
      ['Engineering', v.E > 0 ? `training +${pctTxt(v.trainMult / (1 + v.tech.train) - 1)}, users per GPU +${pctTxt(v.inferEff / (1 + v.tech.infer) - 1)}` : 'no engineers'],
      ['Growth', v.G > 0 ? `market share +${pctTxt(v.brand - 1)}, user growth +${pctTxt(v.growthMult - 1)}` : 'no growth staff'],
      ['Safety', v.S > 0 ? `scandal risk −${pctTxt(1 - Math.exp(-v.S / 12))}` : 'no safety staff'],
    ];
    return `
      <section class="card">
        <dl class="kpis">
          <div><dt>People</dt><dd class="mono">${s.staff.length}</dd></div>
          <div><dt>Payroll</dt><dd class="mono${v.payroll > v.mrr && team.length ? ' warn-text' : ''}">${money(v.payroll)}/mo</dd></div>
          <div><dt>Revenue</dt><dd class="mono">${money(v.mrr)}/mo</dd></div>
          <div><dt>Free desks</dt><dd class="mono${free <= 0 ? ' bad-text' : ''}">${free}</dd></div>
        </dl>
        <div class="eyebrow">What your team does</div>
        <dl class="does">${does.map(([k, t]) => `<div><dt>${k}</dt><dd>${t}</dd></div>`).join('')}</dl>
        ${free <= 0 ? '<p class="small lock-note">Every desk is taken. Build desks (Build › Office) to hire more.</p>' : ''}
      </section>
      ${team.length ? `<section class="card">
        <div class="row between"><div class="eyebrow">Morale</div><span class="mono small">${Math.round(teamAvg)}% now · heading to ${Math.round(mood.total)}%</span></div>
        <div class="mood-parts small"><span>base 45</span><span class="${mood.comfort < 8 ? 'warn-text' : ''}">comfort +${Math.round(mood.comfort)}</span><span>hype +${Math.round(mood.hype)}</span>${mood.broke ? '<span class="bad-text">no cash −20</span>' : ''}</div>
        <p class="small muted">At ${Math.round(teamAvg)}% morale people work at ${Math.round((0.7 + (0.5 * teamAvg) / 100) * 100)}% speed. Below 25% they may quit.${mood.comfort < 12 ? ' Comfort items in Build are the cheapest fix: aim for 2 comfort points per person.' : ''}</p>
      </section>` : ''}
      <h3 class="section-title">Your team</h3>
      <div class="list">${staff}</div>
      <div class="row between section-title"><h3>Candidates</h3><span class="small muted">new faces in ${nextIn}d</span></div>
      <p class="small advice">${hireAdvice(s, v)}</p>
      <div class="list">${cands || '<p class="muted small">No one is looking right now.</p>'}</div>
      <div class="row gap"><button class="btn" data-act="refresh"${disabled(s.cash < refreshCost)}>Find more candidates · ${money(refreshCost)}</button></div>
      <p class="small muted">Hiring pays one month of salary as a signing bonus. Everyone needs a desk.</p>`;
  }

  // Share breakdown against the leading rival, with the biggest drag called out.
  function renderShareFactors(s, v) {
    const f = Sim.shareFactors(s, v);
    if (!f) return '';
    const rows = [
      ['Model score', `${f.model.you.toFixed(1)} vs ${f.model.them.toFixed(1)}`, f.model.mult, 'Train a bigger model. That takes more compute and research.'],
      ['Features', `×${f.features.you.toFixed(2)} vs ×${f.features.them.toFixed(2)}`, f.features.mult, 'Research RLHF, Long Context and Multimodal, then train a new model.'],
      ['Hype', `${Math.round(f.hype.you)} vs ${Math.round(f.hype.them)}`, f.hype.mult, 'Run a campaign below or deploy a better model.'],
      ['Price', `$${f.price.you} vs $${f.price.them}`, f.price.mult, 'Lower your price. Each subscriber pays less, but more of them come.'],
      ['Uptime', fmt.pct(f.uptime.you), f.uptime.mult, 'Add GPUs or lower the training share so every user gets served.'],
    ];
    const worst = rows.reduce((a, r) => (r[2] < a[2] ? r : a));
    const chip = (name, m) => {
      if (name === 'Uptime') return m >= 0.99 ? ['ok', 'Full'] : m >= 0.8 ? ['warn', 'Dropping'] : ['bad', 'Failing'];
      return m >= 1.05 ? ['ok', 'Ahead'] : m >= 0.9 ? ['', 'Even'] : m >= 0.5 ? ['warn', 'Behind'] : ['bad', 'Far behind'];
    };
    return `<section class="card">
      <div class="eyebrow">What decides your share · compared with ${esc(f.rival)}</div>
      <div class="factors">${rows
        .map((r) => {
          const [cls, txt] = chip(r[0], r[2]);
          return `<div class="factor${r === worst && worst[2] < 0.9 ? ' worst' : ''}"><span class="f-name">${r[0]}</span><span class="mono small">${r[1]}</span><span class="tag ${cls}">${txt}</span></div>`;
        })
        .join('')}
        <div class="factor"><span class="f-name">Growth team</span><span class="mono small">${v.G > 0 ? '+' + pctTxt(f.growth.mult - 1) : 'none'}</span><span class="tag${v.G > 0 ? ' ok' : ''}">${v.G > 0 ? 'Helping' : 'None'}</span></div>
      </div>
      ${worst[2] < 0.9 ? `<p class="small"><b>Biggest drag: ${worst[0].toLowerCase()}.</b> ${worst[3]}</p>` : '<p class="small"><b>You are competitive.</b> Keep your model ahead and your hype up.</p>'}
      <p class="small muted">OmniBench score counts the most: a 10% higher score wins about 36% more share.</p>
    </section>`;
  }

  function renderResearch(s, v) {
    const reachable = D.TECHS.filter((t) => s.techs[t.id] || t.req.every((r) => s.techs[r]));
    const maxTier = Math.max(1, ...reachable.map((t) => t.tier));
    const tiers = [1, 2, 3, 4, 5].filter((t) => t <= maxTier);
    const hidden = D.TECHS.filter((t) => t.tier > maxTier).length;
    const names = { 1: 'Tier 1 · Foundations', 2: 'Tier 2 · Scaling up', 3: 'Tier 3 · Serious lab', 4: 'Tier 4 · Frontier', 5: 'Tier 5 · The endgame' };
    return `
      <section class="card rp-card">
        <div class="row between"><div><div class="eyebrow">Research points</div><div class="big mono">${Math.floor(s.rp).toLocaleString('en-US')} RP</div></div>
        <div class="right small"><div class="mono">+${v.rpDay.toFixed(1)}/day</div></div></div>
        <div class="mood-parts small"><span>people +${v.rpStaff.toFixed(1)}</span><span>idle GPUs +${v.rpCompute.toFixed(1)}</span><span>${v.boards ? `whiteboards +${Math.round(v.boardBonus * 100)}%` : 'no whiteboards'}</span></div>
        <p class="small muted">Researchers earn most of your RP. Skill counts: a skill-6 researcher makes about 3× what a skill-2 one does. Each whiteboard within 2 tiles of a researcher's desk adds 8% to what that person makes, up to 40%.</p>
      </section>
      ${agiPathCard(s)}
      ${tiers
        .map(
          (tier) => `<h3 class="section-title">${names[tier]}</h3><div class="list">${D.TECHS.filter((t) => t.tier === tier)
            .map((t) => {
              const done = !!s.techs[t.id];
              const reqOk = t.req.every((r) => s.techs[r]);
              const missing = t.req.filter((r) => !s.techs[r]).map((r) => D.TECH_BY_ID[r].name);
              return `<div class="tech${done ? ' done' : ''}${!reqOk ? ' locked' : ''}${AGI_PATH.has(t.id) ? ' agi-path' : ''}">
                <div class="grow"><div class="name">${t.name}${AGI_PATH.has(t.id) && !done ? ' <span class="tag path">Path to AGI</span>' : ''}</div><div class="small muted">${t.desc}</div>
                ${!done && reqOk ? bar(Math.min(1, s.rp / t.cost), 'thin') : ''}
                ${!reqOk ? `<div class="small lock-note">Needs ${missing.join(', ')}</div>` : ''}</div>
                <div class="actions">${done ? '<span class="tag ok">Done</span>' : `<button class="btn small${reqOk && s.rp >= t.cost ? ' primary' : ''}" data-act="research" data-id="${t.id}"${disabled(!reqOk || s.rp < t.cost)}>${t.cost.toLocaleString('en-US')} RP</button>`}</div>
              </div>`;
            })
            .join('')}</div>`,
        )
        .join('')}
      ${hidden ? `<p class="small muted">${hidden} more technologies are waiting further down the road.</p>` : ''}`;
  }

  function agiPathCard(s) {
    const all = [...AGI_PATH];
    const done = all.filter((id) => s.techs[id]).length;
    const next = D.TECHS.filter((t) => AGI_PATH.has(t.id) && !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];
    const left = D.TECHS.filter((t) => AGI_PATH.has(t.id) && !s.techs[t.id]).reduce((a, t) => a + t.cost, 0);
    return `<section class="card agi-card">
      <div class="row between"><div class="eyebrow">Path to AGI</div><span class="mono small">${done} of ${all.length} done</span></div>
      ${bar(done / all.length, 'accent')}
      <p class="small">${done === all.length ? 'The AGI Blueprint is yours. Start the AGI Project in Models.' : `${next ? `Next on the path: <b>${next.name}</b> (${next.cost.toLocaleString('en-US')} RP). ` : ''}About ${left.toLocaleString('en-US')} RP to go.`}</p>
      <p class="small muted">Technologies tagged Path to AGI lead to the AGI Blueprint. The rest make you faster, richer or safer along the way.</p>
    </section>`;
  }

  function trainPF(s, v) {
    if (s.training) return v.trainPF;
    return s.autoAlloc ? Math.max(0, v.effPF - v.need * 1.15) : v.effPF * s.allocTrain;
  }
  const trainRate = (s, v) => trainPF(s, v) * v.trainMult;

  // data sources the player has ticked and actually unlocked
  function cleanData(s) {
    const d = {};
    for (const src of D.DATA_SOURCES) d[src.id] = !!ui.train.data[src.id] && (!src.tech || !!s.techs[src.tech]);
    return d;
  }

  // How much compute a run needs to finish in a sensible time, and what that means in hardware.
  function planner(s, v, size) {
    const days = size.id === 'agi' ? 300 : 150;
    const needPF = size.pfdays / days / v.trainMult;
    const have = trainPF(s, v);
    if (have >= needPF) return `<p class="small ok-text">You have enough compute to finish a ${size.name} in under ${days} days.</p>`;
    const open = Object.keys(D.ITEMS).filter((t) => D.ITEMS[t].pf && !Sim.itemLocked(s, t));
    const best = open.sort((a, b) => D.ITEMS[b].pf - D.ITEMS[a].pf)[0];
    const d = D.ITEMS[best];
    const each = d.pf * (v.computeMult || 1);
    const n = Math.ceil((needPF - have) / each);
    const cost = Sim.itemCost(s, best) * n;
    const power = n * d.power;
    const spare = Math.max(0, v.powerCap - v.power);
    return `<div class="planner small">
      <div class="eyebrow">Planner</div>
      <p>To finish a ${size.name} in ${days} days you need about <b class="mono">${fmt.pf(needPF)}</b> for training. You have <b class="mono">${fmt.pf(have)}</b>.</p>
      <p>That is roughly <b>${n.toLocaleString('en-US')} more ${d.name}${n === 1 ? '' : 's'}</b> (${money(cost)}), drawing ${fmt.kw(power)}${power > spare ? `, and you only have ${fmt.kw(spare)} of power to spare` : ''}. Each one also needs cooling within reach.${n * (d.size || 1) ** 2 > 0.6 * v.office.size ** 2 ? ' That will not fit in this office: a bigger one holds faster hardware.' : ''}</p>
    </div>`;
  }

  function renderModels(s, v) {
    const unlocked = D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech]);
    const nextSize = D.MODEL_SIZES.find((m) => m.tech && !s.techs[m.tech]);
    if (!ui.train.size || !unlocked.some((m) => m.id === ui.train.size)) ui.train.size = unlocked[unlocked.length - 1].id;
    const size = D.SIZE_BY_ID[ui.train.size];
    const rate = trainRate(s, v);
    const top = v.topRival;
    const fm = v.flagship;

    const alloc = !fm ? '' : `
      <section class="card">
        <div class="row between"><div><div class="eyebrow">Compute split</div><h3 class="mono">${fmt.pf(v.effPF)}</h3></div>
          <div class="seg" role="group" aria-label="Allocation mode"><button class="${s.autoAlloc ? 'on' : ''}" data-act="alloc-auto">Auto</button><button class="${s.autoAlloc ? '' : 'on'}" data-act="alloc-manual">Manual</button></div></div>
        ${s.autoAlloc ? '<p class="small muted">Auto keeps users served first and trains with whatever is left.</p>' : `<label class="slider-label small" for="alloc">Training share <b class="mono">${Math.round(s.allocTrain * 100)}%</b></label><input id="alloc" type="range" min="0" max="100" step="5" value="${Math.round(s.allocTrain * 100)}" data-input="alloc">`}
        <dl class="kv small">
          <div><dt>Serving needs</dt><dd class="mono">${fmt.pf(v.need)}</dd></div>
          <div><dt>Serving gets</dt><dd class="mono">${fmt.pf(v.inferPF)}</dd></div>
          <div><dt>Training gets</dt><dd class="mono">${fmt.pf(v.trainPF)}</dd></div>
          <div><dt>Users served</dt><dd class="mono${v.service < 0.95 ? ' bad-text' : ''}">${fmt.pct(v.service)}</dd></div>
        </dl>
      </section>`;

    let job = '';
    if (s.training) {
      const t = s.training;
      const p = t.done / t.need;
      const eta = rate > 0 ? Math.ceil((t.need - t.done) / rate) : Infinity;
      job = `
        <section class="card training">
          <div class="row between"><div><div class="eyebrow">Training now</div><h3>${esc(t.name)}</h3></div><span class="tag mono">~${t.exp.toFixed(0)} OmniBench</span></div>
          <div class="loss">${sparkline(t.loss, 320, 90, 'loss-chart')}<span class="loss-label mono small">loss ${t.loss.length ? t.loss[t.loss.length - 1].toFixed(2) : '11.00'}</span></div>
          ${bar(p, 'accent')}
          <div class="row between small mono"><span>${fmt.pct(p, 1)} · ${fmt.num(t.done)} / ${fmt.pfdays(t.need)}</span><span>${eta === Infinity ? 'stalled, no training compute' : `~${eta} days left`}</span></div>
          <div class="row gap">${confirmBtn('cancel-train', 'Cancel run (half the data cost back)', 'Confirm: lose all progress', 'small ghost')}</div>
        </section>`;
    } else {
      const data = cleanData(s);
      const cost = Sim.trainingCost(s, size.id, data);
      const exp = Sim.expectedCap(s, size.id, size.id === 'agi' ? {} : data, v);
      const days = rate > 0 ? Math.ceil(size.pfdays / rate) : Infinity;
      job = `
        <section class="card">
          <div class="eyebrow">New training run</div>
          <div class="sizes">${D.MODEL_SIZES.filter((m) => !m.tech || s.techs[m.tech] || m === nextSize).map((m) => {
            const locked = m.tech && !s.techs[m.tech];
            return `<button class="size${m.id === size.id ? ' on' : ''}${locked ? ' locked' : ''}" data-act="pick-size" data-id="${m.id}"${disabled(locked)}>
              <b>${m.name}</b><span class="mono small">${m.params}</span><span class="small muted">${locked ? D.TECH_BY_ID[m.tech].name : fmt.pfdays(m.pfdays)}</span></button>`;
          }).join('')}</div>
          ${size.id === 'agi' ? `<p class="small">The AGI Project uses every data source there is. Budget: ${money(size.fixedCost)}.</p>` : `<div class="datas">${D.DATA_SOURCES.filter((src) => !src.tech || s.techs[src.tech]).map((src) => {
            const locked = src.tech && !s.techs[src.tech];
            const on = ui.train.data[src.id] && !locked;
            return `<button class="data${on ? ' on' : ''}${locked ? ' locked' : ''}" data-act="pick-data" data-id="${src.id}"${disabled(locked)} aria-pressed="${on}">
              <span class="check" aria-hidden="true"></span><span class="grow"><b>${src.name}</b> <span class="mono small">+${Math.round(src.q * 100)}% quality</span><br><span class="small muted">${locked ? 'Research ' + D.TECH_BY_ID[src.tech].name : src.desc}</span></span><span class="mono small">${money(size.data[src.id])}</span></button>`;
          }).join('')}</div>`}
          ${!ui.train.data.licensed && size.id !== 'agi' ? '<p class="small warn-text">Without licensed data you risk copyright lawsuits.</p>' : ''}
          <dl class="kv small">
            <div><dt>Expected score</dt><dd class="mono">${(exp * 0.96).toFixed(0)}–${Math.min(size.id === 'agi' ? 100 : 99, exp * 1.04).toFixed(0)}</dd></div>
            <div><dt>Your flagship</dt><dd class="mono">${fm ? fm.cap.toFixed(1) : '–'}</dd></div>
            <div><dt>Top rival</dt><dd class="mono">${top ? top.cap.toFixed(1) : '–'}</dd></div>
            <div><dt>Time at current compute</dt><dd class="mono${days > 365 ? ' bad-text' : days > 150 ? ' warn-text' : ''}">${days === Infinity ? 'no spare compute' : days > 3650 ? '10+ years' : days + ' days'}</dd></div>
          </dl>
          <p class="small muted">Speed: ${fmt.pf(trainPF(s, v))} for training × ${v.trainMult.toFixed(2)} from engineers and research = ${fmt.num(rate)} PF-days a day. This model needs ${fmt.pfdays(size.pfdays)}.</p>
          ${planner(s, v, size)}
          ${days > 365 ? `<p class="lock-note">Too slow to start: ${days === Infinity ? 'you have no spare compute' : `it would take ${days > 3650 ? 'over 10 years' : days + ' days'}`}. Add GPUs in Build › Compute${s.officeLevel === 0 ? ' (a bigger office holds much faster ones)' : ''}, or pick a smaller model.</p>` : days > 150 ? `<p class="small warn-text">This run will take ${days} days. More GPUs would make it much faster.</p>` : ''}
          <button class="btn primary wide" data-act="start-train"${disabled(s.cash < cost || days > 365)}>Start training · ${money(cost)}</button>
        </section>`;
    }

    const models = s.models
      .slice()
      .reverse()
      .map((m) => {
        const live = m.id === s.flagshipId;
        return `<div class="model${live ? ' live' : ''}">
          <div class="grow"><div class="name">${esc(m.name)} ${live ? '<span class="tag ok">Live</span>' : ''}${m.open ? '<span class="tag">Open weights</span>' : ''}</div>
          <div class="score">${bar(m.cap / 100, 'accent thin')}<span class="mono small">${m.cap.toFixed(1)}</span></div>
          <div class="small muted">Trained ${fmt.date(m.day)} · appeal ×${m.appeal.toFixed(2)} · revenue ×${m.arpu.toFixed(2)}</div></div>
          <div class="actions">${live ? '' : `<button class="btn small primary" data-act="deploy" data-id="${m.id}">Deploy</button>${m.open || m.size === 'agi' ? '' : confirmBtn('open:' + m.id, 'Open-source', 'Confirm', 'small ghost')}`}</div>
        </div>`;
      })
      .join('');

    return `${job}${alloc}
      <h3 class="section-title">Model library</h3>
      <div class="list">${models || '<p class="small muted">No models yet. Start with a Tiny run: it only needs a few gaming rigs.</p>'}</div>
      <p class="small muted">Deploying a better model boosts hype. Beating every rival on OmniBench boosts it more. Open-sourcing an old model earns hype and attracts talent, but it also helps the free alternatives.</p>`;
  }

  function renderMarket(s, v) {
    const fm = v.flagship;
    const lockedCamps = D.CAMPAIGNS.filter((c) => (c.minOffice || 0) > s.officeLevel).length;
    const camp = D.CAMPAIGNS.filter((c) => (c.minOffice || 0) <= s.officeLevel).map((c) => {
      const cd = (s.campaignCd[c.id] || 0) - s.day;
      return `<div class="campaign">
        <div class="grow"><div class="name">${c.name}</div><div class="small muted">${c.desc}</div><div class="small mono">+${c.hype} hype · cooldown ${c.cd}d</div></div>
        <div class="actions">${cd > 0 ? `<span class="tag mono">${cd}d</span>` : `<button class="btn small" data-act="campaign" data-id="${c.id}"${disabled(s.cash < c.cost)}>${c.cost ? money(c.cost) : 'Free'}</button>`}</div>
      </div>`;
    }).join('');
    const contracts = s.contracts
      .map((c) => `<div class="person"><div class="grow"><div class="name">${esc(c.client)}</div><div class="sub mono">${money(c.monthly)}/mo · ${fmt.pf(c.pf)} · ends in ${Math.max(0, c.until - s.day)}d${c.strikes ? ` · ${c.strikes} outage strikes` : ''}</div></div></div>`)
      .join('');
    return `
      <section class="card">
        <div class="row between"><div><div class="eyebrow">Subscribers</div><div class="big mono">${fmt.num(s.subs)}</div></div>
        <div class="right small"><div class="mono">heading to ${fmt.num(s.targetSubs)}</div><div class="muted">${fmt.pct(s.share, 1)} market share</div></div></div>
        <dl class="kv small">
          <div><dt>Paying market</dt><dd class="mono">${fmt.num(v.market)} people</dd></div>
          <div><dt>Market mood</dt><dd class="mono">${s.sentiment > 1.25 ? 'Euphoric' : s.sentiment > 1 ? 'Bullish' : s.sentiment > 0.8 ? 'Cautious' : 'Fearful'}</dd></div>
          <div><dt>Users served</dt><dd class="mono${v.service < 0.95 ? ' bad-text' : ''}">${fmt.pct(v.service)}</dd></div>
          <div><dt>Flagship</dt><dd class="mono">${fm ? esc(fm.name) : 'none deployed'}</dd></div>
        </dl>
      </section>
      ${renderShareFactors(s, v)}
      <section class="card">
        <label class="slider-label" for="price">Subscription price <b class="mono">$${s.price}/mo</b></label>
        <input id="price" type="range" min="5" max="60" step="1" value="${s.price}" data-input="price">
        <p class="small muted">Each subscriber pays ${money(v.arpu || s.price)}/mo including add-ons. Cheaper plans win more users, and more users need more compute.</p>
      </section>
      ${renderProducts(s, v)}
      <section class="card">
        <div class="row between"><div class="eyebrow">Hype</div><span class="mono">${Math.round(s.hype)}/100</span></div>
        ${bar(s.hype / 100, 'accent')}
        <p class="small muted">Hype fades every day. Launches, campaigns and viral moments bring it back.</p>
      </section>
      <h3 class="section-title">Marketing</h3>
      <div class="list">${camp}</div>
      ${lockedCamps ? `<p class="small muted">Bigger campaigns open up as your office grows (${lockedCamps} more).</p>` : ''}
      ${s.contracts.length || s.officeLevel >= 2 || s.techs.code_models ? `<h3 class="section-title">Enterprise contracts</h3>
      <div class="list">${contracts || '<p class="small muted">No contracts yet. Companies will reach out once your model can write code or is good enough.</p>'}</div>` : ''}`;
  }

  // Extra product lines: each has its own market, price and compute bill.
  function renderProducts(s, v) {
    const open = D.PRODUCTS.filter((p) => s.techs[p.tech]);
    if (!open.length) return '';
    const teaser = D.PRODUCTS.find((p) => !s.techs[p.tech]);
    const cards = open
      .map((pd) => {
        const st = s.products[pd.id], pv = v.products[pd.id];
        const step = pd.maxPrice >= 300 ? 10 : 1;
        if (!st.live) {
          return `<div class="product">
            <div class="grow"><div class="name">${pd.name}</div><div class="small muted">${pd.desc}</div>
            <div class="small mono">starts at $${pd.price}/mo · ${fmt.num(v.market * pd.market)} potential customers</div></div>
            <div class="actions"><button class="btn small primary" data-act="launch" data-id="${pd.id}"${disabled(s.cash < pd.launch || !v.flagship)}>Launch ${money(pd.launch)}</button></div>
          </div>`;
        }
        return `<div class="product live">
          <div class="row between"><div class="name">${pd.name} <span class="tag ok">Live</span></div><span class="mono small">${money(pv.revenue)}/mo</span></div>
          <dl class="kv small">
            <div><dt>Customers</dt><dd class="mono">${fmt.num(pv.users)} → ${fmt.num(pv.target)}</dd></div>
            <div><dt>Share</dt><dd class="mono">${fmt.pct(pv.share, 1)}</dd></div>
            <div><dt>Compute</dt><dd class="mono">${fmt.pf(pv.need)}</dd></div>
          </dl>
          <label class="slider-label small" for="pp-${pd.id}">Price <b class="mono">$${st.price}/mo</b></label>
          <input id="pp-${pd.id}" type="range" min="${pd.minPrice}" max="${pd.maxPrice}" step="${step}" value="${st.price}" data-input="pprice" data-id="${pd.id}">
        </div>`;
      })
      .join('');
    return `<h3 class="section-title">Products</h3>
      <div class="list">${cards}</div>
      <p class="small muted">Every product runs on your live model, so a better model sells all of them. Their customers need compute too, served from the same GPUs as chat.${teaser ? ` Next: ${teaser.name} (research ${D.TECH_BY_ID[teaser.tech].name}).` : ''}</p>`;
  }

  function renderFinance(s, v) {
    const last = s.history[s.history.length - 1];
    const hist = s.history.slice(-24);
    const next = D.ROUNDS[s.rounds.length];
    const laterRounds = Math.max(0, D.ROUNDS.length - s.rounds.length - 1);
    const rounds = D.ROUNDS.slice(0, s.rounds.length + 1).map((r, i) => {
      const done = s.rounds.includes(r.id);
      const isNext = i === s.rounds.length;
      const met = isNext && r.req(s, v);
      return `<div class="round${done ? ' done' : ''}${isNext ? ' next' : ''}">
        <span class="step mono">${i + 1}</span>
        <div class="grow"><div class="name">${r.name}</div><div class="small muted">${r.reqText}${isNext && !met ? '' : ''}</div></div>
        <div class="actions">${done ? '<span class="tag ok">Raised</span>' : isNext ? `<button class="btn small${met ? ' primary' : ''}" data-act="pitch"${disabled(!met || !!s.offer || s.roundCd > s.day)}>${s.roundCd > s.day ? `Wait ${s.roundCd - s.day}d` : met ? 'Pitch investors' : 'Not yet'}</button>` : ''}</div>
      </div>`;
    }).join('');
    const offer = s.offer
      ? `<section class="card offer">
          <div class="eyebrow">Term sheet · expires in ${s.offer.expires - s.day}d</div>
          <h3>${s.offer.name}: raise ${money(s.offer.raise)}</h3>
          <dl class="kv small"><div><dt>Pre-money valuation</dt><dd class="mono">${money(s.offer.pre)}</dd></div><div><dt>Dilution</dt><dd class="mono">${fmt.pct(s.offer.dilution, 1)}</dd></div><div><dt>Your stake after</dt><dd class="mono">${fmt.pct(s.equity * (1 - s.offer.dilution), 1)}</dd></div></dl>
          <div class="row gap"><button class="btn primary" data-act="accept">Accept</button><button class="btn ghost" data-act="decline">Decline</button></div>
        </section>`
      : '';
    const pl = last
      ? `<table class="pl small"><caption class="eyebrow">${last.label}</caption>
          <tr><th>Subscriptions</th><td class="mono">${money(last.detail.rev)}</td></tr>
          <tr><th>Enterprise</th><td class="mono">${money(last.detail.crev)}</td></tr>
          ${last.detail.prev ? `<tr><th>Products</th><td class="mono">${money(last.detail.prev)}</td></tr>` : ''}
          <tr><th>Salaries</th><td class="mono neg">${money(-last.detail.salaries)}</td></tr>
          <tr><th>Rent</th><td class="mono neg">${money(-last.detail.rent)}</td></tr>
          <tr><th>Power</th><td class="mono neg">${money(-last.detail.power)}</td></tr>
          <tr><th>Marketing</th><td class="mono neg">${money(-last.detail.marketing)}</td></tr>
          <tr><th>Training data</th><td class="mono neg">${money(-last.detail.data)}</td></tr>
          <tr><th>Other</th><td class="mono neg">${money(-last.detail.other)}</td></tr>
          <tr><th>Hardware &amp; moves</th><td class="mono neg">${money(-last.detail.capex)}</td></tr>
          <tr><th>Funding</th><td class="mono">${money(last.detail.funding)}</td></tr>
        </table>`
      : '<p class="small muted">Your first monthly report arrives at the end of the month.</p>';
    return `
      ${offer}
      <section class="card">
        <dl class="kpis">
          <div><dt>Cash</dt><dd class="mono${s.cash < 0 ? ' bad-text' : ''}">${money(s.cash)}</dd></div>
          <div><dt>Revenue</dt><dd class="mono">${money(v.mrr)}/mo</dd></div>
          <div><dt>Running costs</dt><dd class="mono">${money(v.burnMonth)}/mo</dd></div>
          <div><dt>Profit</dt><dd class="mono ${v.profitMonth >= 0 ? 'ok-text' : 'bad-text'}">${money(v.profitMonth)}/mo</dd></div>
          <div><dt>Valuation</dt><dd class="mono">${money(v.valuation)}</dd></div>
          <div><dt>Your stake</dt><dd class="mono">${fmt.pct(s.equity, 1)} · ${money(v.netWorth)}</dd></div>
        </dl>
        <div class="chart-wrap"><div class="eyebrow">Cash, last ${hist.length} months</div>${sparkline(hist.map((h) => h.cash), 320, 70, 'cash-chart')}</div>
      </section>
      <h3 class="section-title">Funding</h3>
      <div class="list rounds">${rounds}</div>
      ${next ? (laterRounds ? `<p class="small muted">${laterRounds} more rounds after this one, all the way to an IPO.</p>` : '') : '<p class="small muted">You are a public company. Keep growing.</p>'}
      <h3 class="section-title">Last month</h3>
      <section class="card">${pl}</section>`;
  }

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
      <div class="row between"><div class="eyebrow">Alignment</div><span class="mono">${a.total}/100 · ${name}</span></div>
      ${bar(a.total / 100, a.ending === 'aligned' ? 'ok' : a.ending === 'uneasy' ? 'warn' : 'bad')}
      <div class="mood-parts small"><span>base ${a.base}</span><span>safety research ${sign(a.research)}</span><span>safety team ${sign(a.team)}</span><span class="${a.choices < 0 ? 'bad-text' : ''}">your choices ${sign(a.choices)}</span>${a.data ? `<span>human feedback ${sign(a.data)}</span>` : ''}</div>
      <p class="small">${text}</p>
      <p class="small muted">70 or more counts as aligned, under 40 as reckless. Safety staff, RLHF, Constitutional AI and Interpretability raise it. So do honest answers when a scandal or a hearing comes up.</p>
    </section>`;
  }

  function renderRace(s, v) {
    const fm = v.flagship;
    const bestModel = s.models.slice().sort((a, b) => b.cap - a.cap)[0];
    const rows = [
      { name: s.company, model: bestModel ? bestModel.name : 'no model yet', cap: bestModel ? bestModel.cap : 0, color: 'var(--accent)', you: true },
      ...s.rivals.map((r) => {
        const d = Sim.RIVAL_BY_ID[r.id];
        return { name: d.name, model: `${d.model}-${r.version}`, cap: r.cap, color: d.color, blurb: d.blurb };
      }),
    ].sort((a, b) => b.cap - a.cap);
    const news = s.news
      .slice(0, 40)
      .map((n) => `<li class="kind-${n.kind}"><span class="mono small muted">${fmt.date(n.day)}</span><span>${esc(n.text)}</span></li>`)
      .join('');
    return `
      <section class="card">
        <div class="eyebrow">OmniBench leaderboard</div>
        <div class="board">${rows
          .map(
            (r, i) => `<div class="lb${r.you ? ' you' : ''}">
              <span class="rank mono">${i + 1}</span>
              <div class="grow"><div class="row between"><span class="name">${esc(r.name)}</span><span class="mono">${r.cap.toFixed(1)}</span></div>
              <div class="lb-bar"><i style="width:${r.cap}%;background:${r.color}"></i><span class="agi-mark" title="AGI at 100"></span></div>
              <div class="small muted">${esc(r.model)}${r.blurb ? ' · ' + r.blurb : ''}</div></div>
            </div>`,
          )
          .join('')}</div>
        <p class="small muted">OmniBench runs from 0 to 100. The first lab to reach 100 builds AGI and wins. ${fm ? '' : 'Deploy a model to compete for users.'}</p>
      </section>
      ${fm ? alignmentCard(s, v) : ''}
      <h3 class="section-title">News</h3>
      <ul class="news">${news}</ul>`;
  }

  // ---------- HUD, alerts, goals, ticker ----------
  function renderHud(s, v) {
    const set = (id, html) => {
      const el = $(id);
      if (el && el.innerHTML !== html) el.innerHTML = html;
    };
    set('co-name', esc(s.company));
    set('date', fmt.date(s.day));
    for (const k of ['cash', 'subs', 'compute', 'hype', 'bench', 'val']) $('hud-' + k).hidden = !Progress.has(s, 'hud:' + k);
    renderTabs(s);
    const perDay = v.profitMonth / 30;
    set('hud-cash', `<span class="k">Cash</span><span class="v mono${s.cash < 0 ? ' bad-text' : ''}">${money(s.cash)}</span><span class="d mono ${perDay >= 0 ? 'ok-text' : 'bad-text'}">${perDay >= 0 ? '+' : ''}${money(perDay)}/day</span>`);
    set('hud-subs', `<span class="k">Subscribers</span><span class="v mono">${fmt.num(s.subs)}</span><span class="d mono">${fmt.pct(s.share, 1)} share</span>`);
    const warn = v.thermal < 0.99 ? 'hot' : v.powerFactor < 1 ? 'power' : '';
    set('hud-compute', `<span class="k">Compute</span><span class="v mono${warn ? ' bad-text' : ''}">${fmt.pf(v.effPF)}</span><span class="d mono">${warn === 'hot' ? 'overheating' : warn === 'power' ? 'power limited' : s.training ? 'training' : 'serving'}</span>`);
    set('hud-hype', `<span class="k">Hype</span><span class="v mono">${Math.round(s.hype)}</span>${bar(s.hype / 100, 'accent thin')}`);
    const top = v.topRival;
    set('hud-bench', `<span class="k">OmniBench</span><span class="v mono">${v.flagship ? v.flagship.cap.toFixed(1) : '–'}</span><span class="d mono">top rival ${top ? top.cap.toFixed(1) : '–'}</span>`);
    set('hud-val', `<span class="k">Valuation</span><span class="v mono">${money(v.valuation)}</span><span class="d mono">you own ${fmt.pct(s.equity, 0)}</span>`);

    const alerts = [];
    if (v.hotItems > 0 && v.thermal < 0.99) alerts.push([v.thermal < 0.9 ? 'bad' : 'warn', `${v.hotItems} GPU${v.hotItems === 1 ? ' is' : 's are'} overheating (−${fmt.pct(1 - v.thermal)} compute). Put cooling next to the red ones.`, 'build:cooling']);
    if (v.powerFactor < 1) alerts.push(['warn', `Power limit: GPUs running at ${fmt.pct(v.powerFactor)}. Add power.`, 'build:power']);
    if (v.flagship && v.service < 0.95) alerts.push(['bad', `Serving only ${fmt.pct(v.service)} of users. Add compute or train less.`, 'models']);
    if (s.stats.negDays > 0) alerts.push(['bad', `Out of cash: ${90 - s.stats.negDays} days to bankruptcy.`, 'finance']);
    if (s.offer) alerts.push(['good', `${s.offer.name} term sheet is waiting.`, 'finance']);
    if (!s.training && !s.models.length) alerts.push(['info', 'Start your first training run.', 'models']);
    else if (!v.flagship && s.models.length) alerts.push(['info', 'You have a model. Deploy it to get users.', 'models']);
    if (v.idleDays > 20 && !s.over) alerts.push(['warn', `Your GPUs have not trained anything for ${v.idleDays} days. Start a run.`, 'models']);
    const nextRound = D.ROUNDS[s.rounds.length];
    if (nextRound && !s.offer && s.roundCd <= s.day && nextRound.req(s, v)) alerts.push(['good', `Investors will take your ${nextRound.name} pitch.`, 'finance']);
    // during the tutorial Mira is the guide, so only real problems show here
    const tutorial = AIT.Mentor.tutorialActive(s);
    const ah = alerts
      .filter(([k]) => !tutorial || k === 'bad' || k === 'warn')
      .map(([k, t, go]) => `<button class="alert ${k}" data-go="${go}">${esc(t)}</button>`)
      .join('');
    set('alerts', ah);
    $('goal-card').hidden = tutorial;

    const goal = D.GOALS.find((g) => !s.goals[g.id]);
    const doneCount = Object.keys(s.goals).length;
    set(
      'goal-card',
      goal
        ? `<div class="eyebrow">Goal ${doneCount + 1} of ${D.GOALS.length}</div><div class="goal-text">${goal.text}</div><div class="small muted">${goal.hint}</div>`
        : `<div class="eyebrow">All goals done</div><div class="goal-text">You built the future.</div>`,
    );

    const tool = AIT.Render.tool;
    set('toolbar', tool ? `<span>${tool.mode === 'sell' ? 'Selling: tap an item to get 50% back' : `Placing ${D.ITEMS[tool.type].name} · ${money(Sim.itemCost(s, tool.type))} each`}</span><button class="btn small" data-act="notool">Done</button>` : '');
    $('toolbar').hidden = !tool;

    const n = s.news[0];
    set('ticker', n ? `<span class="mono tk-date">${fmt.date(n.day)}</span><span class="tk-text kind-${n.kind}">${esc(n.text)}</span>` : '');
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === G().speed));
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
      notes.push(`<b>${esc(p.name)}</b> · ${D.ROLES[p.role].name} · skill ${p.skill} · morale ${Math.round(p.morale)}%`);
      notes.push(`Adds ${describeImpact(s, v, p.role, Sim.impact(s, v, { remove: p.id }), false, p.salary).effects.join(' · ')}`);
      notes.push(`Comfort here +${Math.round(seat.comfort)}${p.role === 'researcher' ? ` · whiteboards +${Math.round(seat.board * 100)}% research` : ''}`);
    } else if (d.seats) notes.push('<span class="muted">Empty desk. Hire someone in Team.</span>');
    const heat = v.itemHeat.get(it.id);
    if (heat != null) notes.push(heat < 1 ? `<span class="bad-text">Overheating: running at ${fmt.pct(heat)} speed.</span> Put a cooler within reach.` : '<span class="ok-text">Running cool.</span>');
    const cool = v.coolers.get(it.id);
    if (cool) notes.push(cool.gpus ? `Cools ${cool.gpus} GPU${cool.gpus === 1 ? '' : 's'} in reach · load ${fmt.pct(cool.load)}${cool.load > 1 ? ' <span class="bad-text">(overloaded: add another cooler nearby)</span>' : ''}` : 'No GPUs in reach. Move it next to your hardware.');
    if (d.rpBonus) {
      const n = s.staff.filter((x) => x.role === 'researcher' && v.seatInfo.get(x.id) && v.seatInfo.get(x.id).desk && Sim.gap(it, v.seatInfo.get(x.id).desk) <= d.radius).length;
      notes.push(`${n} researcher${n === 1 ? '' : 's'} within ${d.radius} tiles`);
    }
    if (d.decor) {
      const n = s.staff.filter((x) => v.seatInfo.get(x.id) && v.seatInfo.get(x.id).desk && Sim.gap(it, v.seatInfo.get(x.id).desk) <= d.radius).length;
      notes.push(`${n} desk${n === 1 ? '' : 's'} within ${d.radius} tiles`);
    }
    const html = `<img src="${AIT.Render.icon(it.type)}" alt="" width="48" height="48">
      <div class="grow"><div class="name">${d.name}</div><div class="small muted">${d.desc}</div>
      ${notes.map((n) => `<div class="small">${n}</div>`).join('')}
      <div class="small mono">${statLine(d)}${it.legacy ? ' · old model (¼ size)' : ''}</div></div>
      <div class="actions"><button class="btn small" data-act="sell-selected">Sell ${money(Sim.stat(it, 'cost') * 0.5)}</button><button class="btn small ghost" data-act="close-inspect" aria-label="Close">Close</button></div>`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    box.hidden = false;
  }

  function renderTabs(s) {
    if (!Progress.has(s, 'tab:' + ui.tab)) ui.tab = 'build';
    const html = Object.entries(TABS)
      .filter(([id]) => Progress.has(s, 'tab:' + id))
      .map(([id, t]) => `<button role="tab" data-tab="${id}" aria-selected="${id === ui.tab}">${t.name}${Progress.isNewTab(s, id) ? '<span class="new-dot" title="New"></span>' : ''}</button>`)
      .join('');
    const el = $('tabs');
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
  }

  function renderPanel(force) {
    const g = G();
    if (!force && ui.interacting) return;
    Progress.ensure(g.s, Sim.derive(g.s));
    renderTabs(g.s);
    const v = Sim.derive(g.s);
    const html = TABS[ui.tab].render(g.s, v);
    if (html !== ui.lastHtml) {
      $('tab-body').innerHTML = html;
      ui.lastHtml = html;
    }
  }

  // ---------- modals ----------
  function openModal(html, kind = '', dismissable = true) {
    const root = $('modal-root');
    root.innerHTML = `<div class="backdrop"${dismissable ? ' data-modal="close"' : ''}></div><div class="modal ${kind}" role="dialog" aria-modal="true">${html}</div>`;
    root.hidden = false;
    ui.modal = kind || 'modal';
    const first = root.querySelector('input, button:not(.x)');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    const root = $('modal-root');
    root.innerHTML = '';
    root.hidden = true;
    ui.modal = null;
  }

  function showEvent(s) {
    const ev = Sim.eventView(s);
    if (!ev) return;
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · Decision needed</div>
      <h2>${esc(ev.title)}</h2>
      <p>${esc(ev.body)}</p>
      <div class="choices">${ev.choices.map((c, i) => `<button class="choice" data-modal="choice" data-i="${i}"><b>${esc(c.label)}</b><span class="small">${esc(c.note)}</span></button>`).join('')}</div>`,
      'event ' + ev.kind,
      false,
    );
  }

  // ---------- sending a run to Claude ----------
  let dbPromise = null;
  const getDb = () => {
    if (!dbPromise) {
      const c = window.claude;
      dbPromise = c && typeof c.use === 'function' ? c.use('db').catch(() => null) : Promise.resolve(null);
    }
    return dbPromise;
  };

  async function sendRun(button) {
    const s = G().s;
    const report = AIT.Report.build(s);
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    const db = await getDb();
    if (db) {
      try {
        await db.doc('runs/' + report.id).set(report);
        closeModal();
        toast('Run sent. Tell Claude in the chat that it is there.', 'good');
        return;
      } catch (e) {
        /* fall back to copying */
      }
    }
    showCopy(JSON.stringify(report));
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
  const modeLabel = (s) => [s.mode === 'daily' ? `Daily challenge ${dailyLabel(s.seed)}` : s.mode === 'sandbox' ? 'Sandbox' : null, s.mode === 'daily' ? null : D.DIFFICULTY[s.difficulty || 'normal'].name].filter(Boolean).join(' · ');

  function showOver(s) {
    const v = Sim.derive(s);
    const win = s.over.win;
    const title = win ? ENDING_TITLES[s.over.ending] || 'You reached AGI first' : /money/.test(s.over.text) ? 'Out of money' : 'Beaten to AGI';
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · ${esc(modeLabel(s))}</div>
      <h2>${title}</h2>
      <p>${esc(s.over.text)}</p>
      <dl class="kpis">
        <div><dt>Years in game</dt><dd class="mono">${(s.day / 365).toFixed(1)}</dd></div>
        <div><dt>Time played</dt><dd class="mono">${fmt.dur(s.playMs)}</dd></div>
        <div><dt>Best OmniBench</dt><dd class="mono">${v.bestCap.toFixed(1)}</dd></div>
        <div><dt>Alignment</dt><dd class="mono">${v.alignment.total}/100</dd></div>
        <div><dt>Valuation</dt><dd class="mono">${money(v.valuation)}</dd></div>
        <div><dt>Your stake</dt><dd class="mono">${money(v.netWorth)}</dd></div>
      </dl>
      ${s.mode === 'daily' ? '<div id="daily-board" class="daily-board small muted">Loading today\'s results…</div>' : ''}
      <div class="row gap wrap">${win ? '<button class="btn" data-modal="sandbox">Keep playing</button>' : ''}<button class="btn" data-modal="send-run">Send this run to Claude</button><button class="btn primary" data-modal="newgame">New game</button></div>`,
      'over ' + (win ? 'good' : 'bad'),
      false,
    );
    if (s.mode === 'daily') submitDaily(s, v).then(() => showDailyBoard(s));
  }

  // ---------- daily challenge: same seed for everyone today ----------
  const dailySeed = (d = new Date()) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const dailyLabel = (seed) => (seed ? String(seed).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '');
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

  // ---------- achievements, kept per browser ----------
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
    for (const a of D.ACHIEVEMENTS) {
      if (got[a.id] || !a.check(s, v)) continue;
      got[a.id] = new Date().toISOString().slice(0, 10);
      try {
        localStorage.setItem(ACH_KEY, JSON.stringify(got));
      } catch (e) {
        /* storage unavailable */
      }
      toast(`Achievement unlocked: ${a.name}`, 'goal');
    }
  }
  function showAchievements() {
    const got = achievements();
    const n = D.ACHIEVEMENTS.filter((a) => got[a.id]).length;
    openModal(
      `<div class="eyebrow">Achievements · ${n} of ${D.ACHIEVEMENTS.length}</div><h2>Trophy shelf</h2>
      <ul class="ach-list">${D.ACHIEVEMENTS.map((a) => `<li class="${got[a.id] ? 'got' : ''}"><b>${a.name}</b><span class="small muted">${a.desc}</span>${got[a.id] ? `<span class="mono small">${got[a.id]}</span>` : ''}</li>`).join('')}</ul>
      <p class="small muted">Achievements are saved in this browser. Sandbox games do not count.</p>
      <div class="row gap"><button class="btn" data-modal="menu">Back</button><button class="btn primary" data-modal="close">Resume</button></div>`,
      'menu',
    );
  }

  // ---------- the moment the AGI Blueprint lands ----------
  function showAgiReady(s) {
    const v = Sim.derive(s);
    const size = D.SIZE_BY_ID.agi;
    const rate = Math.max(0, v.effPF * 0.75) * v.trainMult;
    const days = rate > 0 ? Math.ceil(size.pfdays / rate) : Infinity;
    const top = v.topRival;
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)} · Research complete</div>
      <h2 class="chapter-title">The AGI Blueprint is done</h2>
      <p>Your researchers know how to build it. Now you have to actually do it, before ${top ? esc(Sim.RIVAL_BY_ID[top.id].name) + ' (at ' + top.cap.toFixed(1) + ')' : 'anyone else'} gets to 100.</p>
      <dl class="kpis">
        <div><dt>Compute needed</dt><dd class="mono">${fmt.pfdays(size.pfdays)}</dd></div>
        <div><dt>Budget</dt><dd class="mono${s.cash < size.fixedCost ? ' bad-text' : ''}">${money(size.fixedCost)}</dd></div>
        <div><dt>At 75% of your compute</dt><dd class="mono">${days === Infinity ? 'no compute' : days > 3650 ? '10+ years' : days + ' days'}</dd></div>
        <div><dt>Alignment</dt><dd class="mono">${v.alignment.total}/100 · ${ENDINGS[v.alignment.ending][0]}</dd></div>
      </dl>
      <p class="small">Start the AGI Project in Models. Switch the compute split to Manual while it runs, or serving your users will starve the training run. ${days > 365 ? 'At your current compute it would take too long: build more hardware first.' : ''}</p>
      <div class="row gap"><button class="btn ghost" data-modal="close">Later</button><button class="btn primary" data-modal="agi-go">Open Models</button></div>`,
      'chapter reveal sota',
      false,
    );
    sfx('chapter');
    AIT.Render.celebrate();
  }

  const HELP = `
    <ol class="help">
      <li><b>Build.</b> Place GPUs, cooling and power in your office. Overheating throttles GPUs and can start fires.</li>
      <li><b>Train.</b> Spend compute (PF-days) to train models. Bigger models score higher on OmniBench.</li>
      <li><b>Deploy.</b> Your live model wins subscribers based on its score against rivals, your hype and your price.</li>
      <li><b>Serve.</b> Subscribers need compute too. Keep them served or they leave.</li>
      <li><b>Grow.</b> Hire researchers for RP, raise funding rounds, and move to bigger offices.</li>
      <li><b>Win.</b> Research the AGI Blueprint and finish the AGI Project before any rival reaches 100.</li>
    </ol>
    <p class="small muted">Keys: Space pauses, 1–3 set speed, Esc cancels placing. Right-click also cancels. Scroll or pinch to zoom, drag to pan.</p>`;

  function showNewGame(canContinue) {
    const ch = F.CHAPTERS[0];
    openModal(
      `<div class="chapter-art"><img src="${AIT.Render.officePreview(0, 'Your lab')}" alt=""></div>
      <div class="eyebrow">Chapter ${ch.num}</div>
      <h2 class="chapter-title">${ch.title}</h2>
      <p>${ch.text}</p>
      <div class="field"><label for="ng-company">Name your company</label><input id="ng-company" maxlength="24" value="Nimbus Labs" autocomplete="off"></div>
      <div class="field"><label for="ng-family">Name your models</label><input id="ng-family" maxlength="12" value="Nova" autocomplete="off"></div>
      <div class="field"><span class="label">Game</span><div class="seg wide" role="group" aria-label="Game mode">${[['standard', 'Standard'], ['daily', 'Daily'], ['sandbox', 'Sandbox']].map(([id, n]) => `<button class="${ui.ng.mode === id ? 'on' : ''}" data-modal="ng-mode" data-id="${id}">${n}</button>`).join('')}</div></div>
      <div class="field" id="ng-diff-field"${ui.ng.mode === 'standard' ? '' : ' hidden'}><span class="label">Difficulty</span><div class="seg wide" role="group" aria-label="Difficulty">${Object.entries(D.DIFFICULTY).map(([id, d]) => `<button class="${ui.ng.difficulty === id ? 'on' : ''}" data-modal="ng-diff" data-id="${id}">${d.name}</button>`).join('')}</div></div>
      <p class="small muted" id="ng-note">${newGameNote()}</p>
      <p class="small muted">Your mentor, Mira, will show you around once you start.</p>
      <div class="row gap">${canContinue ? '<button class="btn" data-modal="close">Back to my game</button>' : ''}<button class="btn primary" data-modal="start">Open the garage</button></div>`,
      'intro chapter',
      canContinue,
    );
  }

  function newGameNote() {
    if (ui.ng.mode === 'daily') return `Today's seed is ${dailyLabel(dailySeed())}: everyone gets the same candidates, events and rival moves. Normal difficulty. Your result goes on today's leaderboard.`;
    if (ui.ng.mode === 'sandbox') return 'Start with $10M, no bankruptcy, and rivals that never quite reach AGI. Build whatever you like. Achievements are off.';
    return D.DIFFICULTY[ui.ng.difficulty].desc;
  }

  function showChapter(s, ch) {
    openModal(
      `<div class="chapter-art"><img src="${AIT.Render.officePreview(s.officeLevel, s.company)}" alt=""></div>
      <div class="eyebrow">Chapter ${ch.num} of ${F.CHAPTERS.length}</div>
      <h2 class="chapter-title">${ch.title}</h2>
      <p>${ch.text}</p>
      <div class="eyebrow">What's new</div>
      <ul class="chapter-new">${ch.news.map((n) => `<li>${n}</li>`).join('')}</ul>
      <div class="row gap"><button class="btn primary" data-modal="close">Let's go</button></div>`,
      'chapter',
      false,
    );
    sfx('chapter');
    AIT.Render.celebrate();
  }

  // The moment a model finishes: the score counts up, the leaderboard shows
  // where it lands, and the internet has opinions.
  function showReveal(s, m) {
    const v = Sim.derive(s);
    const rivals = s.rivals.map((r) => ({ name: Sim.RIVAL_BY_ID[r.id].name, cap: r.cap, color: Sim.RIVAL_BY_ID[r.id].color }));
    const top = rivals.reduce((a, r) => (r.cap > a.cap ? r : a), rivals[0]);
    const rows = rivals.concat([{ name: s.company, cap: m.cap, color: 'var(--accent)', you: true }]).sort((a, b) => b.cap - a.cap);
    const rank = rows.findIndex((r) => r.you) + 1;
    const ratio = m.cap / top.cap;
    const tier = m.cap > top.cap ? 'sota' : ratio >= 0.9 ? 'close' : ratio >= 0.6 ? 'mid' : 'low';
    const verdict = {
      sota: 'New state of the art. You are number one.',
      close: 'Within striking distance of the leaders.',
      mid: 'A solid model. The big labs are still ahead.',
      low: "Small, but it's yours. Everyone starts somewhere.",
    }[tier];
    const fm = v.flagship;
    const better = !fm || m.cap > fm.cap;
    const short = m.name.split(' ')[0];
    const pool = F.REACTIONS[tier].slice().sort(() => Math.random() - 0.5).slice(0, 2);
    const reacts = pool.map(([h, t]) => [h, t.replace(/{m}/g, short).replace(/{c}/g, s.company).replace(/{r}/g, top.name)]);
    openModal(
      `<div class="eyebrow">Training complete · ${fmt.date(s.day)}</div>
      <h2>${esc(m.name)}</h2>
      <div class="reveal-score"><span class="reveal-num mono" data-to="${m.cap}">0.0</span><span class="reveal-unit">OmniBench<br><b class="mono">#${rank} of ${rows.length}</b></span></div>
      <p class="reveal-verdict ${tier}">${verdict}${!better ? ` It does not beat ${esc(fm.name)} (${fm.cap.toFixed(1)}).` : ''}</p>
      <div class="reveal-board">${rows
        .map((r) => `<div class="rb${r.you ? ' you' : ''}"><span class="rb-name">${esc(r.name)}</span><span class="rb-bar"><i style="width:${r.cap}%;background:${r.color}"></i></span><span class="mono small">${r.cap.toFixed(1)}</span></div>`)
        .join('')}</div>
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
      const eased = 1 - Math.pow(1 - k, 3);
      if (num.isConnected) num.textContent = (to * eased).toFixed(1);
      if (k < 1 && num.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    sfx('fanfare');
    if (better) AIT.Render.celebrate();
  }

  function showMenu() {
    openModal(
      `<div class="eyebrow">Menu · ${esc(modeLabel(G().s))} · played ${fmt.dur(G().s.playMs)}</div><h2>${esc(G().s.company)}</h2>
      ${HELP}
      <div class="row gap wrap"><button class="btn" data-modal="mentor-toggle">Mentor tips: ${AIT.Mentor.enabled(G().s) ? 'on' : 'off'}</button><button class="btn" data-modal="mentor-replay">Replay tutorial</button><button class="btn" data-modal="music-toggle">Music: ${AIT.Sound.music ? 'on' : 'off'}</button></div>
      <div class="row gap wrap"><button class="btn" data-modal="achievements">Achievements · ${D.ACHIEVEMENTS.filter((a) => achievements()[a.id]).length}/${D.ACHIEVEMENTS.length}</button></div>
      <div class="row gap wrap"><button class="btn" data-modal="send-run">Send this run to Claude</button></div>
      <div class="row gap wrap"><button class="btn" data-modal="save">Save now</button><button class="btn" data-modal="close">Resume</button>${ui.confirm === 'newgame' ? '<button class="btn danger" data-modal="really-new">Yes, start over</button>' : '<button class="btn ghost" data-modal="ask-new">New game</button>'}</div>
      <p class="small muted">The game saves itself every month in this browser.</p>`,
      'menu',
    );
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
        break;
      case 'tool':
        if (el.classList.contains('locked')) {
          toast(Sim.itemLocked(s, id), 'warn');
          break;
        }
        AIT.Render.setTool(AIT.Render.tool && AIT.Render.tool.type === id ? null : { mode: 'place', type: id });
        break;
      case 'sellmode':
        AIT.Render.setTool(AIT.Render.tool && AIT.Render.tool.mode === 'sell' ? null : { mode: 'sell' });
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
      case 'research':
        if (result(A.research(s, id), false)) sfx('unlock');
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
      case 'pitch':
        result(A.pitch(s));
        break;
      case 'accept':
        if (result(A.acceptOffer(s), false)) {
          sfx('coin');
          AIT.Render.celebrate();
        }
        break;
      case 'decline':
        result(A.declineOffer(s));
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
        if (kind === 'fire') result(A.fire(s, arg));
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

  function goTo(target) {
    const [tab, cat] = target.split(':');
    ui.tab = tab;
    Progress.seeTab(G().s, tab);
    if (cat) ui.buildCat = cat;
    renderPanel(true);
    const panel = $('panel');
    panel.classList.add('open');
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
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      const panel = $('panel');
      if (ui.tab === b.dataset.tab && panel.classList.contains('open') && window.matchMedia('(max-width: 820px)').matches) {
        panel.classList.remove('open');
        return;
      }
      ui.tab = b.dataset.tab;
      ui.confirm = null;
      Progress.seeTab(G().s, ui.tab);
      sfx('tick');
      panel.classList.add('open');
      $('tab-body').scrollTop = 0;
      renderPanel(true);
    });

    const body = $('tab-body');
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      act(b.dataset.act, b);
    });
    body.addEventListener('input', (e) => {
      const el = e.target;
      const s = G().s;
      if (el.dataset.input === 'price') {
        A.setPrice(s, Number(el.value));
        const lab = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (lab) lab.textContent = `$${s.price}/mo`;
      } else if (el.dataset.input === 'pprice') {
        A.setProductPrice(s, el.dataset.id, Number(el.value));
        const lab = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (lab) lab.textContent = `$${s.products[el.dataset.id].price}/mo`;
      } else if (el.dataset.input === 'alloc') {
        A.setAlloc(s, false, Number(el.value) / 100);
        const lab = el.previousElementSibling && el.previousElementSibling.querySelector('b');
        if (lab) lab.textContent = `${el.value}%`;
      }
    });
    const panel = $('panel');
    panel.addEventListener('pointerdown', () => (ui.interacting = true));
    const release = () => {
      if (!ui.interacting) return;
      setTimeout(() => (ui.interacting = false), 120);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    $('panel-handle').addEventListener('click', () => panel.classList.toggle('open'));

    $('toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act, b);
    });
    $('inspect').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) act(b.dataset.act, b);
    });
    $('alerts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) goTo(b.dataset.go);
    });
    $('ticker').addEventListener('click', () => goTo('race'));
    $('speed').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (b) G().setSpeed(Number(b.dataset.speed));
    });
    const mute = $('mute-btn');
    const paintMute = () => {
      mute.classList.toggle('off', AIT.Sound.muted);
      mute.setAttribute('aria-label', AIT.Sound.muted ? 'Turn sound on' : 'Mute sound');
      mute.title = mute.getAttribute('aria-label');
    };
    paintMute();
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
    document.querySelectorAll('[data-zoom]').forEach((b) =>
      b.addEventListener('click', () => {
        const z = b.dataset.zoom;
        if (z === 'fit') AIT.Render.fit(D.OFFICES[G().s.officeLevel].size);
        else AIT.Render.zoomBy(z === 'in' ? 1.25 : 0.8);
      }),
    );

    $('modal-root').addEventListener('click', (e) => {
      const b = e.target.closest('[data-modal]');
      if (!b) return;
      const g = G();
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
        const company = ($('ng-company').value || '').trim() || 'Nimbus Labs';
        const family = ($('ng-family').value || '').trim().replace(/\s+/g, '') || 'Nova';
        const opts = { mode: ui.ng.mode, difficulty: ui.ng.mode === 'standard' ? ui.ng.difficulty : 'normal' };
        if (opts.mode === 'daily') opts.seed = dailySeed();
        closeModal();
        ui.overShown = false;
        g.newGame(company, family, opts);
      } else if (what === 'save') {
        g.save();
        toast('Game saved', 'good');
        closeModal();
      } else if (what === 'ask-new') {
        ui.confirm = 'newgame';
        showMenu();
      } else if (what === 'really-new' || what === 'newgame') {
        ui.confirm = null;
        showNewGame(false);
      } else if (what === 'send-run') {
        sendRun(b);
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
      } else if (what === 'music-toggle') {
        AIT.Sound.unlock();
        AIT.Sound.toggleMusic();
        showMenu();
      } else if (what === 'achievements') {
        showAchievements();
      } else if (what === 'menu') {
        showMenu();
      } else if (what === 'agi-go') {
        closeModal();
        ui.train.size = 'agi';
        goTo('models');
      } else if (what === 'mentor-toggle') {
        AIT.Mentor.setEnabled(g.s, !AIT.Mentor.enabled(g.s));
        showMenu();
      } else if (what === 'mentor-replay') {
        AIT.Mentor.replay(g.s);
        closeModal();
      } else if (what === 'sandbox') {
        A.sandbox(g.s);
        closeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      const g = G();
      if (e.key === 'Escape') {
        if (ui.modal && !String(ui.modal).startsWith('event') && !String(ui.modal).startsWith('over')) closeModal();
        AIT.Render.setTool(null);
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
    if (!ui.modal) {
      if (s.reveal) {
        const m = s.models.find((x) => x.id === s.reveal);
        s.reveal = null;
        if (m) showReveal(s, m);
      } else if (ui.chapters.length) showChapter(s, ui.chapters.shift());
      else if (s.events.length) showEvent(s);
      else if (s.techs.agi_theory && !s.flags.agiPrompted && !s.over) {
        s.flags.agiPrompted = true;
        showAgiReady(s);
      }
      else if (s.over && !s.over.sandbox && !ui.overShown) {
        ui.overShown = true;
        showOver(s);
      }
    }
    AIT.Mentor.frame(now);
    if (now - ui.lastHud > 150) {
      ui.lastHud = now;
      const v = Sim.derive(s);
      const got = Progress.check(s, v);
      for (const n of got.notes) toast(n, 'unlock');
      if (got.chapter) ui.chapters.push(got.chapter);
      renderHud(s, v);
      renderInspect(s);
      checkAchievements(s, v);
      AIT.Mentor.check(s, v, !!ui.modal);
    }
    if (now - ui.lastPanel > 400) {
      ui.lastPanel = now;
      renderPanel(false);
    }
  }

  AIT.UI = {
    init, frame, toast, renderPanel, canvasCb, showNewGame, closeModal,
    goTo,
    isBlocking: () => !!ui.modal || AIT.Mentor.blocking(),
    resetOver: () => (ui.overShown = false),
  };
})(typeof window !== 'undefined' ? window : globalThis);
