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
    if (d.pf) return `${fmt.pf(d.pf)} · ${fmt.kw(d.power)}`;
    if (d.cooling) return `cools ${fmt.kw(d.cooling)}`;
    if (d.powerCap) return `+${fmt.kw(d.powerCap)}`;
    if (d.seats) return `seats ${d.seats}`;
    if (d.rpBonus) return `+3% research`;
    if (d.decor) return `morale +${d.decor}`;
    return '';
  }

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
        ${meter('Heat vs cooling', v.heat, v.cooling, fmt.kw, 0.85, 'heat')}
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

  function renderTeam(s, v) {
    const free = v.seats - s.staff.length;
    const avg = s.staff.reduce((a, p) => a + p.morale, 0) / Math.max(1, s.staff.length);
    const nextIn = 7 - (s.day - s.candidatesDay);
    const refreshCost = 2000 * (1 + s.officeLevel * 2);
    const staff = s.staff
      .map((p) => {
        const r = D.ROLES[p.role];
        const training = p.trainUntil > s.day;
        const cost = Sim.trainCostFor(p);
        return `<div class="person">
          <span class="role" style="--c:${p.founder ? 'var(--accent)' : r.color}">${r.short}</span>
          <div class="grow">
            <div class="name">${esc(p.name)}${p.founder ? ' <span class="tag">Founder</span>' : ''}</div>
            <div class="sub mono">skill ${p.skill}/10 · ${p.founder ? 'no salary' : money(p.salary) + '/mo'}${training ? ` · training ${p.trainUntil - s.day}d` : ''}</div>
            ${p.founder ? '<div class="bio">Started this in a garage.</div>' : p.bio ? `<div class="bio">${esc(p.bio)}</div>` : ''}
            <div class="mood" title="Morale ${Math.round(p.morale)}%">${bar(p.morale / 100, p.morale < 35 ? 'bad' : p.morale < 55 ? 'warn' : 'ok')}</div>
          </div>
          <div class="actions">
            <button class="btn small" data-act="train" data-id="${p.id}"${disabled(training || p.skill >= 10 || s.cash < cost)}>Train ${money(cost)}</button>
            ${p.founder ? '' : confirmBtn('fire:' + p.id, 'Fire', 'Confirm', 'small ghost')}
          </div>
        </div>`;
      })
      .join('');
    const cands = s.candidates
      .map((c) => {
        const r = D.ROLES[c.role];
        return `<div class="person">
          <span class="role" style="--c:${r.color}">${r.short}</span>
          <div class="grow">
            <div class="name">${esc(c.name)}${c.star ? ' <span class="tag hot">Star</span>' : ''}</div>
            <div class="sub mono">${r.name} · skill ${c.skill}/10 · ${money(c.salary)}/mo</div>
            ${c.bio ? `<div class="bio">${esc(c.bio)}</div>` : ''}
          </div>
          <div class="actions"><button class="btn small primary" data-act="hire" data-id="${c.id}"${disabled(free <= 0 || s.cash < c.salary)}>Hire</button></div>
        </div>`;
      })
      .join('');
    return `
      <section class="card">
        <dl class="kpis">
          <div><dt>People</dt><dd class="mono">${s.staff.length}</dd></div>
          <div><dt>Payroll</dt><dd class="mono">${money(v.payroll)}/mo</dd></div>
          <div><dt>Morale</dt><dd class="mono">${Math.round(avg)}%</dd></div>
          <div><dt>Free desks</dt><dd class="mono${free <= 0 ? ' bad-text' : ''}">${free}</dd></div>
        </dl>
        ${free <= 0 ? '<p class="small lock-note">Every desk is taken. Build desks (Build › Office) to hire more.</p>' : ''}
        <p class="small muted">Comfort items and hype raise morale. Low morale slows work, and unhappy people quit.</p>
      </section>
      <h3 class="section-title">Your team</h3>
      <div class="list">${staff}</div>
      <div class="row between section-title"><h3>Candidates</h3><span class="small muted">new faces in ${nextIn}d</span></div>
      <div class="list">${cands || '<p class="muted small">No one is looking right now.</p>'}</div>
      <div class="row gap"><button class="btn" data-act="refresh"${disabled(s.cash < refreshCost)}>Find more candidates · ${money(refreshCost)}</button></div>
      <p class="small muted">Hiring pays one month of salary as a signing bonus.</p>
      <div class="legend">${Object.values(D.ROLES).map((r) => `<div><span class="role" style="--c:${r.color}">${r.short}</span> <b>${r.name}</b> ${r.desc}</div>`).join('')}</div>`;
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
        <div class="right small"><div class="mono">+${v.rpDay.toFixed(1)}/day</div><div class="muted">${v.boards ? `whiteboards +${Math.round(v.boardBonus * 100)}%` : 'no whiteboards yet'}</div></div></div>
        <p class="small muted">Researchers earn RP every day. Idle compute runs small experiments too.</p>
      </section>
      ${tiers
        .map(
          (tier) => `<h3 class="section-title">${names[tier]}</h3><div class="list">${D.TECHS.filter((t) => t.tier === tier)
            .map((t) => {
              const done = !!s.techs[t.id];
              const reqOk = t.req.every((r) => s.techs[r]);
              const missing = t.req.filter((r) => !s.techs[r]).map((r) => D.TECH_BY_ID[r].name);
              return `<div class="tech${done ? ' done' : ''}${!reqOk ? ' locked' : ''}">
                <div class="grow"><div class="name">${t.name}</div><div class="small muted">${t.desc}</div>
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

  function trainRate(s, v) {
    if (s.training) return v.trainPF * v.trainMult;
    const pf = s.autoAlloc ? Math.max(0, v.effPF - v.need * 1.15) : v.effPF * s.allocTrain;
    return pf * v.trainMult;
  }

  // data sources the player has ticked and actually unlocked
  function cleanData(s) {
    const d = {};
    for (const src of D.DATA_SOURCES) d[src.id] = !!ui.train.data[src.id] && (!src.tech || !!s.techs[src.tech]);
    return d;
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
          <div class="row gap">${confirmBtn('cancel-train', 'Cancel run', 'Confirm: lose progress', 'small ghost')}</div>
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
            <div><dt>Time at current compute</dt><dd class="mono">${days === Infinity ? 'no spare compute' : days > 3650 ? '10+ years' : days + ' days'}</dd></div>
          </dl>
          <button class="btn primary wide" data-act="start-train"${disabled(s.cash < cost)}>Start training · ${money(cost)}</button>
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
        <p class="small muted">Share depends on your flagship's OmniBench score against rivals, plus hype, price and uptime.</p>
      </section>
      <section class="card">
        <label class="slider-label" for="price">Subscription price <b class="mono">$${s.price}/mo</b></label>
        <input id="price" type="range" min="5" max="60" step="1" value="${s.price}" data-input="price">
        <p class="small muted">Each subscriber pays ${money(v.arpu || s.price)}/mo including add-ons. Cheaper plans win more users, and more users need more compute.</p>
      </section>
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
    const warn = v.thermal < 1 ? 'hot' : v.powerFactor < 1 ? 'power' : '';
    set('hud-compute', `<span class="k">Compute</span><span class="v mono${warn ? ' bad-text' : ''}">${fmt.pf(v.effPF)}</span><span class="d mono">${warn === 'hot' ? 'overheating' : warn === 'power' ? 'power limited' : s.training ? 'training' : 'serving'}</span>`);
    set('hud-hype', `<span class="k">Hype</span><span class="v mono">${Math.round(s.hype)}</span>${bar(s.hype / 100, 'accent thin')}`);
    const top = v.topRival;
    set('hud-bench', `<span class="k">OmniBench</span><span class="v mono">${v.flagship ? v.flagship.cap.toFixed(1) : '–'}</span><span class="d mono">top rival ${top ? top.cap.toFixed(1) : '–'}</span>`);
    set('hud-val', `<span class="k">Valuation</span><span class="v mono">${money(v.valuation)}</span><span class="d mono">you own ${fmt.pct(s.equity, 0)}</span>`);

    const alerts = [];
    if (v.thermal < 1) alerts.push(['bad', `Overheating: GPUs throttled to ${fmt.pct(v.thermal)}. Add cooling.`, 'build:cooling']);
    if (v.powerFactor < 1) alerts.push(['warn', `Power limit: GPUs running at ${fmt.pct(v.powerFactor)}. Add power.`, 'build:power']);
    if (v.flagship && v.service < 0.95) alerts.push(['bad', `Serving only ${fmt.pct(v.service)} of users. Add compute or train less.`, 'models']);
    if (s.stats.negDays > 0) alerts.push(['bad', `Out of cash: ${90 - s.stats.negDays} days to bankruptcy.`, 'finance']);
    if (s.offer) alerts.push(['good', `${s.offer.name} term sheet is waiting.`, 'finance']);
    if (!s.training && !s.models.length) alerts.push(['info', 'Start your first training run.', 'models']);
    else if (!v.flagship && s.models.length) alerts.push(['info', 'You have a model. Deploy it to get users.', 'models']);
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
    const desks = s.items.filter((i) => D.ITEMS[i.type].seats).sort((a, b) => a.id - b.id);
    const idx = desks.indexOf(it);
    const p = idx >= 0 ? s.staff[idx] : null;
    const html = `<img src="${AIT.Render.icon(it.type)}" alt="" width="48" height="48">
      <div class="grow"><div class="name">${d.name}</div><div class="small muted">${d.desc}</div>
      ${p ? `<div class="small"><b>${esc(p.name)}</b> · ${D.ROLES[p.role].name} · skill ${p.skill} · morale ${Math.round(p.morale)}%</div>` : d.seats ? '<div class="small muted">Empty desk. Hire someone in Team.</div>' : ''}
      <div class="small mono">${statLine(d)}</div></div>
      <div class="actions"><button class="btn small" data-act="sell-selected">Sell ${money(d.cost * 0.5)}</button><button class="btn small ghost" data-act="close-inspect" aria-label="Close">Close</button></div>`;
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
      <p>This page can't send the report directly here. Copy it and paste it into your chat with Claude.</p>
      <textarea id="report-text" class="report-text" readonly>${esc(text)}</textarea>
      <div class="row gap"><button class="btn primary" data-modal="copy-report">Copy report</button><button class="btn ghost" data-modal="close">Close</button></div>`,
      'menu',
    );
  }

  function showOver(s) {
    const v = Sim.derive(s);
    const win = s.over.win;
    openModal(
      `<div class="eyebrow">${fmt.date(s.day)}</div>
      <h2>${win ? 'You reached AGI first' : 'Game over'}</h2>
      <p>${esc(s.over.text)}</p>
      <dl class="kpis">
        <div><dt>Years played</dt><dd class="mono">${(s.day / 365).toFixed(1)}</dd></div>
        <div><dt>Best OmniBench</dt><dd class="mono">${v.bestCap.toFixed(1)}</dd></div>
        <div><dt>Valuation</dt><dd class="mono">${money(v.valuation)}</dd></div>
        <div><dt>Your stake</dt><dd class="mono">${money(v.netWorth)}</dd></div>
      </dl>
      <div class="row gap">${win ? '<button class="btn" data-modal="sandbox">Keep playing</button>' : ''}<button class="btn" data-modal="send-run">Send this run to Claude</button><button class="btn primary" data-modal="newgame">New game</button></div>`,
      'over ' + (win ? 'good' : 'bad'),
      false,
    );
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
      <p class="small muted">Your mentor, Mira, will show you around once you start.</p>
      <div class="row gap">${canContinue ? '<button class="btn" data-modal="close">Back to my game</button>' : ''}<button class="btn primary" data-modal="start">Open the garage</button></div>`,
      'intro chapter',
      canContinue,
    );
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
      `<div class="eyebrow">Menu</div><h2>${esc(G().s.company)}</h2>
      ${HELP}
      <div class="row gap wrap"><button class="btn" data-modal="mentor-toggle">Mentor tips: ${AIT.Mentor.enabled(G().s) ? 'on' : 'off'}</button><button class="btn" data-modal="mentor-replay">Replay tutorial</button></div>
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
        else if (kind === 'cancel-train') result(A.cancelTraining(s), false);
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
      const it = s.items.find((i) => i.x === x && i.y === y);
      if (!it) return;
      const r = A.sell(s, it.id);
      if (r.ok) {
        AIT.Render.float(x, y, '+' + money(r.msg), '#248a5a');
        sfx('sell');
      } else toast(r.msg, 'warn');
      renderPanel(true);
    },
    select(x, y) {
      const s = G().s;
      const it = s.items.find((i) => i.x === x && i.y === y);
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
      } else if (what === 'start') {
        const company = ($('ng-company').value || '').trim() || 'Nimbus Labs';
        const family = ($('ng-family').value || '').trim().replace(/\s+/g, '') || 'Nova';
        closeModal();
        ui.overShown = false;
        g.newGame(company, family);
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
        const done = () => toast('Copied. Paste it into your chat with Claude.', 'good');
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
