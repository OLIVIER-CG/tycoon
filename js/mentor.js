/* The mentor: a scripted tutorial for the first minutes, then a small set of
   hand-written tips that each appear once, only when they are relevant, with
   a cooldown between them. The game pauses while she is talking. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA, Sim = AIT.Sim;

  const NAME = 'Mira Castell';
  const TIP_COOLDOWN_MS = 45000; // real time between non-urgent tips
  const TIP_COOLDOWN_DAYS = 20; // and in-game days
  const TYPE_CPS = 70; // typewriter speed, characters per second

  const count = (s, t) => s.items.filter((i) => i.type === t).length;
  const money = (n) => AIT.fmt.money(n);
  const seats = (s) => s.items.reduce((a, i) => a + (D.ITEMS[i.type].seats || 0), 0);
  const cheapestTech = (s) =>
    D.TECHS.filter((t) => !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];
  const lastModelDay = (s) => s.models.reduce((a, m) => Math.max(a, m.day), -1);

  // ---------- the tutorial ----------
  // Steps without `done` are read-only (the game pauses). Steps with `done`
  // wait for the player to act; the game keeps running.
  const TUTORIAL = [
    {
      id: 'hello',
      lines: [
        "Hi, I'm Mira. I started two AI labs back when nobody believed in scaling. Your investors asked me to keep an eye on you.",
        'Here is the whole game in one sentence: turn compute into smarter models, turn models into money, and reach AGI before the other labs do.',
      ],
    },
    {
      id: 'garage',
      lines: [
        'This garage is your company. The black tower by the wall is a gaming rig. It gives you 1 PF of compute, one petaFLOP per second.',
        "One rig can't train anything useful yet. Let's fix that.",
      ],
    },
    {
      id: 'rigs',
      lines: ['Open Build, pick Gaming Rig, then tap three empty floor tiles. On a computer you can drag across tiles to place several at once.'],
      task: 'Place 3 more Gaming Rigs',
      progress: (s) => `${Math.min(3, Math.max(0, count(s, 'rig') - 1))}/3`,
      done: (s) => count(s, 'rig') >= 4,
      after: () => AIT.Render.setTool(null),
      go: 'build:compute',
      highlight: ['#tabs [data-tab="build"]', '.chip[data-id="compute"]', '.item[data-id="rig"]'],
    },
    {
      id: 'heat',
      lines: [
        'Good. Every GPU turns power into heat. Keep an eye on the Heat vs cooling bar in Build.',
        'If heat goes above cooling, your GPUs slow down, and running hot for long can start a fire. Box fans and AC units are cheap insurance.',
      ],
      go: 'build:cooling',
      highlight: ['[data-coach="heat"]'],
    },
    {
      id: 'train',
      lines: ['Now the fun part. Open Models and start a Tiny training run. Licensed data costs a little, but it keeps the lawyers away.'],
      task: 'Start training a Tiny model',
      done: (s) => !!s.training || s.models.length > 0,
      go: 'models',
      highlight: ['#tabs [data-tab="models"]', '[data-act="start-train"]'],
    },
    {
      id: 'wait',
      lines: ['Training is measured in PF-days, and a Tiny model needs 60. Press 3× at the top to speed up time, and watch the loss curve drop.'],
      task: 'Wait for your model to finish',
      progress: (s) => (s.training ? `${Math.floor((s.training.done / s.training.need) * 100)}%` : ''),
      done: (s) => s.models.length > 0,
      highlight: ['#speed'],
    },
    {
      id: 'deploy',
      lines: ['Your first model! It scores around 8 on OmniBench. The big labs sit near 25, but everyone starts somewhere. Press Deploy so people can subscribe.'],
      task: 'Deploy your model',
      done: (s) => !!s.flagshipId,
      go: 'models',
      highlight: ['#tabs [data-tab="models"]', '[data-act="deploy"]'],
    },
    {
      id: 'subs',
      lines: [
        "You're live. Subscribers pay $20 a month. How many you get depends on your OmniBench score against rivals, your hype and your price.",
        'Every subscriber also needs compute. The Auto split in Models serves them first and trains with whatever is left.',
      ],
      highlight: ['#hud-subs'],
    },
    {
      id: 'raise',
      lines: ['A real model means investors will take your call. Open Finance, pitch investors, then accept the term sheet.'],
      task: 'Raise your Pre-seed round',
      done: (s) => s.rounds.includes('preseed'),
      go: 'finance',
      highlight: ['#tabs [data-tab="finance"]', '[data-act="pitch"]', '[data-act="accept"]'],
    },
    {
      id: 'hire',
      lines: ['Money is for people and GPUs. Build a desk from Build › Office, then hire a researcher from Team. Researchers earn research points.'],
      task: 'Hire your first employee',
      done: (s) => s.staff.length >= 2,
      go: (s) => (seats(s) > s.staff.length ? 'team' : 'build:office'),
      highlight: (s) =>
        seats(s) > s.staff.length
          ? ['#tabs [data-tab="team"]', '[data-act="hire"]']
          : ['#tabs [data-tab="build"]', '.chip[data-id="office"]', '.item[data-id="desk"]'],
    },
    {
      id: 'research',
      lines: [
        'Research points unlock bigger models and better hardware. Scaling Laws comes first and unlocks Small models, but a Small model needs about 6,000 PF-days. A garage cannot do that. Raise money, move to the Loft and fill it with workstations first.',
        "That's the basics. The card in the top-left always shows your next goal, and I'll drop in when something important comes up. Go build something.",
      ],
      go: 'research',
      highlight: ['#tabs [data-tab="research"]'],
    },
  ];

  // ---------- tips, in priority order ----------
  // Each shows at most once per game. Urgent tips skip the cooldown.
  const TIPS = [
    {
      id: 'broke', urgent: true,
      when: (s) => s.stats.negDays > 0,
      lines: ["You're out of cash. You have 90 days before the company folds. Sell hardware you don't need, let someone go, or raise money in Finance."],
      go: 'finance',
    },
    {
      id: 'overheat', urgent: true,
      when: (s, v) => v.thermal < 1 && v.pf > 0,
      lines: ["It's getting hot in here. Heat is above your cooling, so your GPUs are throttling. Add fans, AC units or chillers from Build › Cooling before something catches fire."],
      go: 'build:cooling',
      highlight: ['[data-coach="heat"]', '.chip[data-id="cooling"]'],
    },
    {
      id: 'cut_costs', urgent: true,
      when: (s) => s.stats.negDays >= 20,
      lines: ["Still no cash after 20 days. To survive, get your costs below your revenue. Each person's card in Team shows what they add, so let go of whoever adds least. You can also sell hardware in Build for half its price."],
      go: 'team',
    },
    {
      id: 'slow_run', urgent: true,
      when: (s, v) => s.training && v.trainPF * v.trainMult > 0 && (s.training.need - s.training.done) / (v.trainPF * v.trainMult) > 180,
      lines: (s, v) => [`Careful: at your current compute, ${s.training.name} needs another ${Math.round((s.training.need - s.training.done) / (v.trainPF * v.trainMult))} days. Buy more GPUs to speed it up, or cancel now and get half the data cost back.`],
      go: 'models',
    },
    {
      id: 'capacity', urgent: true,
      when: (s, v) => v.flagship && v.service < 0.85 && s.subs > 100,
      lines: ['Users are getting "at capacity" errors, and they will leave. Buy more GPUs, or lower the training share in Models so serving gets more compute.'],
      go: 'models',
    },
    {
      id: 'power',
      when: (s, v) => v.powerFactor < 1,
      lines: ["You're drawing more power than the building can supply, so every GPU slows down. Battery walls add a little capacity. Bigger offices and substations add a lot."],
      go: 'build:power',
    },
    {
      id: 'runway',
      when: (s, v) => s.day > 30 && v.profitMonth < 0 && s.cash > 0 && s.cash < -v.profitMonth * 3,
      lines: (s, v) => [`Quick check on your runway. At this burn rate you have about ${Math.max(1, Math.round(s.cash / -v.profitMonth))} months of cash. Raise your next round or trim costs before it gets tight.`],
      go: 'finance',
    },
    {
      id: 'overhired',
      when: (s, v) => s.staff.length >= 3 && v.payroll > Math.max(v.mrr, 1000) * 2.5 && s.cash < v.payroll * 8,
      lines: (s, v) => [`Your payroll is ${money(v.payroll)} a month and revenue is ${money(v.mrr)}. Hire when there is work waiting: GPUs to train on, or research you need. The Team tab shows what each person adds.`],
      go: 'team',
    },
    {
      id: 'offer',
      when: (s) => !!s.offer,
      lines: ['You have a term sheet. Dilution is the share of the company you give up. Take the money if you need it. Declining makes investors wait 30 days.'],
      go: 'finance',
    },
    {
      id: 'first_hire',
      when: (s) => s.staff.length >= 2,
      lines: ['Welcome to management. Every card in Team now shows what that person adds, and candidates show what they would add before you hire them. Growth staff only pay off once your model can compete.'],
      go: 'team',
    },
    {
      id: 'desks',
      when: (s, v) => s.staff.length >= 2 && v.seats <= s.staff.length && s.cash > 50000,
      lines: ["Every desk is taken, so you can't hire anyone else. Desks are cheap. Find them in Build › Office."],
      go: 'build:office',
    },
    {
      id: 'loft',
      when: (s) => s.officeLevel === 0 && s.rounds.includes('preseed') && s.cash > 70000,
      lines: ["The garage is nearly out of power. The Downtown Loft has eight times the power and room for 4-GPU workstations. You'll find it at the top of Build."],
      go: 'build',
    },
    {
      id: 'morale',
      when: (s) => {
        const team = s.staff.filter((p) => !p.founder);
        return team.length >= 2 && team.reduce((a, p) => a + p.morale, 0) / team.length < 45;
      },
      lines: ['Your team is unhappy. Low morale slows work, and people quit below 25%. Coffee machines, couches and arcade cabinets help, and so does hype.'],
      go: 'build:comfort',
    },
    {
      id: 'idle_rp',
      when: (s) => {
        const t = cheapestTech(s);
        return s.day > 40 && t && s.rp >= t.cost * 1.5;
      },
      lines: ["You have research points sitting unused. Spend them in R&D. New tech is what unlocks bigger models and better hardware."],
      go: 'research',
    },
    {
      id: 'idle_gpu',
      when: (s) => !s.training && s.models.length > 0 && s.day - lastModelDay(s) > 30 && s.cash > 20000,
      lines: ["Your GPUs aren't training anything. Idle compute only earns a trickle of research. Start another run in Models."],
      go: 'models',
    },
    {
      id: 'series_a',
      when: (s) => s.officeLevel >= 1 && !s.rounds.includes('a') && s.models.some((m) => m.size === 'small'),
      lines: ['Next milestone: a Series A. It needs an OmniBench score of 25, or $150k a month in revenue. A Medium model gets you there. Distributed Training unlocks it.'],
      go: 'finance',
    },
    {
      id: 'hype',
      when: (s, v) => v.flagship && s.day > 90 && s.hype < 12,
      lines: ['Hype fades every day, and it drives both users and valuation. Campaigns in Market bring it back. The hype thread is free.'],
      go: 'market',
    },
    {
      id: 'price',
      when: (s) => s.subs > 5000,
      lines: ['You can change your subscription price in Market. Cheaper plans win more users, but each one earns less and needs compute.'],
      go: 'market',
    },
    {
      id: 'sota',
      when: (s) => !!s.flags.wasSota,
      lines: ["You're number one on OmniBench. Enjoy it for a minute. Rivals release new models every few months, so keep a training run going."],
      go: 'race',
    },
    {
      id: 'contract',
      when: (s) => s.contracts.length > 0,
      lines: ['Enterprise deals pay well, but they reserve compute. If service drops below 75% for too long, the client walks away.'],
      go: 'market',
    },
    {
      id: 'floor',
      when: (s) => s.officeLevel >= 2,
      lines: ['Welcome to the Office Floor. 8-GPU Servers live here, and Substations add power when you outgrow the building.'],
      go: 'build:compute',
    },
    {
      id: 'train_staff',
      when: (s) => s.day > 200 && s.staff.length >= 4,
      lines: ['You can send people on courses from Team. Each course adds a skill level, and higher skill means more output from the same desk.'],
      go: 'team',
    },
    {
      id: 'open_source',
      when: (s) => s.models.length >= 3 && s.models.some((m) => m.id !== s.flagshipId && !m.open && m.size !== 'agi'),
      lines: ["Models you've replaced can be open-sourced from the model library. It's a quick hype boost and draws better candidates, but it also helps the free competitors."],
      go: 'models',
    },
    {
      id: 'campus',
      when: (s) => s.officeLevel >= 3,
      lines: ['A campus means GPU racks, gas turbines and chillers. Plan for Liquid Cooling and Custom Silicon in R&D. You will need both.'],
      go: 'research',
    },
    {
      id: 'race',
      when: (s, v) => v.topRival && v.topRival.cap >= 75,
      lines: (s, v) => [`The race is getting close. ${Sim.RIVAL_BY_ID[v.topRival.id].name} is at ${v.topRival.cap.toFixed(0)} on OmniBench, and the first lab to 100 wins. Make sure the AGI Blueprint is on your research path.`],
      go: 'race',
    },
    {
      id: 'hyperscale',
      when: (s) => s.officeLevel >= 4,
      lines: ['The Hyperscale Campus. Wafer-scale engines, immersion tanks and modular reactors are your endgame hardware.'],
      go: 'build:compute',
    },
    {
      id: 'agi', urgent: true,
      when: (s) => !!s.techs.agi_theory,
      lines: [
        'The AGI Project is unlocked. It needs 500 million PF-days and $1.5B.',
        'Switch the compute split to Manual in Models while it runs. Otherwise serving your users will starve the training run.',
      ],
      go: 'models',
    },
  ];

  // ---------- state ----------
  const m = { el: null, style: null, cur: null, page: 0, shown: 0, typeStart: 0, minimized: false, autoMin: false, lastClosedAt: -1e9, lastClosedDay: -1e9, completing: 0, hlKey: '' };
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensure(s) {
    if (!s.mentor) s.mentor = { step: 0, done: s.day > 60, seen: {}, off: false };
    return s.mentor;
  }

  const linesOf = (s, v) => {
    const l = m.cur.def.lines;
    return typeof l === 'function' ? l(s, v) : l;
  };
  const resolve = (x, s) => (typeof x === 'function' ? x(s) : x);
  const lastPage = () => m.page >= m.cur.lines.length - 1;
  const isTaskPage = () => m.cur && m.cur.kind === 'tut' && m.cur.def.done && lastPage();

  // ---------- rendering ----------
  const FACE = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="#fde6da"/>
    <path d="M10 66c2-15 11-21 22-21s20 6 22 21z" fill="#2f4858"/>
    <path d="M26 45l6 8 6-8z" fill="#f7f8f5"/>
    <circle cx="32" cy="29" r="12" fill="#c68863"/>
    <path d="M19 28c0-10 6-15 13-15s13 5 13 15c-3-5-7-7.5-13-7.5S22 23 19 28z" fill="#d8d3cc"/>
    <circle cx="32" cy="13" r="5.5" fill="#d8d3cc"/>
    <circle cx="27" cy="30" r="3.4" fill="none" stroke="#1c232c" stroke-width="1.5"/>
    <circle cx="37" cy="30" r="3.4" fill="none" stroke="#1c232c" stroke-width="1.5"/>
    <path d="M30.4 30h3.2" stroke="#1c232c" stroke-width="1.5"/>
    <path d="M28.3 36.2c2.2 1.7 5.2 1.7 7.4 0" stroke="#7a3e22" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>`;

  function build() {
    m.el.innerHTML = `
      <button class="m-face" data-m="expand" aria-label="Open ${NAME}'s message">${FACE}</button>
      <div class="m-body">
        <div class="m-head"><b>${NAME}</b><span class="eyebrow m-label"></span><button class="m-min" data-m="min" aria-label="Minimize">–</button></div>
        <p class="m-text" data-m="finish"></p>
        <div class="m-task" data-m="expand"><span class="m-check" aria-hidden="true"></span><span class="m-task-t"></span><span class="m-task-p mono"></span></div>
        <div class="m-actions"></div>
      </div>`;
  }

  function renderPage(s) {
    const c = m.cur;
    const el = m.el;
    const tut = c.kind === 'tut';
    el.hidden = false;
    el.classList.toggle('tip', !tut);
    el.querySelector('.m-label').textContent = tut ? `Tutorial ${ensure(s).step + 1} of ${TUTORIAL.length}` : 'Tip';
    m.shown = reduced() ? Infinity : 0;
    m.typeStart = performance.now();
    el.querySelector('.m-text').textContent = reduced() ? c.lines[m.page] : '';
    const task = isTaskPage();
    const taskEl = el.querySelector('.m-task');
    taskEl.hidden = !task;
    taskEl.classList.remove('done');
    if (task) el.querySelector('.m-task-t').textContent = c.def.task;
    const go = resolve(c.def.go, s);
    const btns = [];
    if (tut) btns.push('<button class="btn ghost small" data-m="skip">Skip tutorial</button>');
    if (go && (task || !tut)) btns.push('<button class="btn small" data-m="show">Show me</button>');
    if (!task) btns.push(`<button class="btn primary small" data-m="next">${lastPage() ? (tut ? 'Continue' : 'Got it') : 'Next'}</button>`);
    el.querySelector('.m-actions').innerHTML = btns.join('');
    applyMinimized();
  }

  function applyMinimized() {
    m.el.classList.toggle('min', m.minimized);
    if (m.cur && !isTaskPage()) {
      // a minimized message collapses to a small "tap to read" pill
      const taskEl = m.el.querySelector('.m-task');
      taskEl.hidden = !m.minimized;
      m.el.querySelector('.m-task-t').textContent = 'Mira has something to tell you';
      m.el.querySelector('.m-task-p').textContent = '';
    }
    const stage = document.getElementById('stage');
    if (stage) stage.style.setProperty('--mentor-h', m.cur && !m.minimized ? m.el.offsetHeight + 10 + 'px' : '0px');
  }

  function setHighlight(list) {
    const key = list.join(',');
    if (key === m.hlKey) return;
    m.hlKey = key;
    m.style.textContent = list.length ? `${key} { outline: 3px solid var(--accent) !important; outline-offset: -3px; animation: coach 1.1s ease-in-out infinite; }` : '';
  }

  function open(s, v, kind, def) {
    m.cur = { kind, def, lines: [] };
    m.cur.lines = linesOf(s, v);
    m.page = 0;
    m.minimized = false;
    m.autoMin = false;
    m.completing = 0;
    renderPage(s);
    if (AIT.Sound) AIT.Sound.play('mentor');
    // read-only tutorial steps bring the thing they talk about into view
    if (kind === 'tut' && !def.done && def.go) AIT.UI.goTo(resolve(def.go, s));
  }

  function close(s) {
    m.cur = null;
    m.el.hidden = true;
    m.lastClosedAt = performance.now();
    m.lastClosedDay = s.day;
    setHighlight([]);
    applyMinimized();
  }

  function advanceTutorial(s, v) {
    const st = ensure(s);
    st.step++;
    const next = TUTORIAL[st.step];
    if (!next) {
      st.done = true;
      close(s);
      return;
    }
    if (next.done && next.done(s, v)) return advanceTutorial(s, v);
    open(s, v, 'tut', next);
  }

  // ---------- controls ----------
  function next() {
    const g = AIT.game;
    if (!m.cur) return;
    const full = m.cur.lines[m.page];
    if (m.shown < full.length) {
      m.shown = Infinity;
      m.el.querySelector('.m-text').textContent = full;
      return;
    }
    if (!lastPage()) {
      m.page++;
      renderPage(g.s);
      return;
    }
    if (m.cur.kind === 'tut') advanceTutorial(g.s, Sim.derive(g.s));
    else close(g.s);
  }

  function onClick(e) {
    const b = e.target.closest('[data-m]');
    if (!b || !m.cur) return;
    const g = AIT.game;
    const what = b.dataset.m;
    if (what === 'next') next();
    else if (what === 'finish') {
      if (m.shown < m.cur.lines[m.page].length) next();
    } else if (what === 'min') {
      m.minimized = true;
      applyMinimized();
    } else if (what === 'expand') {
      if (m.minimized) {
        m.minimized = false;
        applyMinimized();
      }
    } else if (what === 'skip') {
      ensure(g.s).done = true;
      close(g.s);
    } else if (what === 'show') {
      const go = resolve(m.cur.def.go, g.s);
      if (go) AIT.UI.goTo(go);
      if (m.cur.kind === 'tip' && !isTaskPage()) close(g.s);
    }
  }

  // ---------- per-frame and periodic updates ----------
  function frame(now) {
    if (!m.cur || m.minimized) return;
    const full = m.cur.lines[m.page];
    if (m.shown >= full.length) return;
    const n = Math.floor(((now - m.typeStart) / 1000) * TYPE_CPS);
    if (n > m.shown) {
      m.shown = n;
      m.el.querySelector('.m-text').textContent = full.slice(0, n);
    }
  }

  function check(s, v, blocked) {
    const st = ensure(s);
    if (m.cur) {
      const def = m.cur.def;
      if (isTaskPage()) {
        if (def.progress) m.el.querySelector('.m-task-p').textContent = def.progress(s);
        if (!m.completing && def.done(s, v)) {
          m.completing = performance.now();
          m.el.querySelector('.m-task').classList.add('done');
          if (def.after) def.after(s);
          if (m.minimized) {
            m.minimized = false;
            applyMinimized();
          }
        } else if (m.completing && performance.now() - m.completing > 900) {
          advanceTutorial(s, v);
          return;
        }
        // keep the office visible while the player places things
        const placing = !!(AIT.Render.tool && AIT.Render.tool.mode === 'place');
        if (placing !== m.autoMin) {
          m.autoMin = placing;
          m.minimized = placing;
          applyMinimized();
        }
      }
      const hl = def.highlight ? resolve(def.highlight, s) : [];
      setHighlight(m.cur.kind === 'tut' && def.done && !lastPage() ? [] : hl);
      return;
    }
    if (blocked || st.off || (s.over && !s.over.sandbox)) return;

    if (!st.done) {
      const def = TUTORIAL[st.step];
      if (!def) {
        st.done = true;
        return;
      }
      if (def.done && def.done(s, v)) {
        st.step++;
        return;
      }
      open(s, v, 'tut', def);
      return;
    }

    const now = performance.now();
    const cooling = now - m.lastClosedAt < TIP_COOLDOWN_MS || s.day - m.lastClosedDay < TIP_COOLDOWN_DAYS;
    for (const tip of TIPS) {
      if (st.seen[tip.id] != null || (cooling && !tip.urgent) || !tip.when(s, v)) continue;
      st.seen[tip.id] = s.day;
      open(s, v, 'tip', tip);
      return;
    }
  }

  AIT.Mentor = {
    init() {
      m.el = document.getElementById('mentor');
      m.style = document.getElementById('coach-style');
      build();
      m.el.addEventListener('click', onClick);
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !m.cur || m.minimized || isTaskPage() || e.target.matches('input, textarea, button')) return;
        e.preventDefault();
        next();
      });
    },
    frame,
    check,
    // true while she is talking and the game should wait
    blocking: () => !!m.cur && !m.minimized && !isTaskPage(),
    reset() {
      if (m.cur) {
        m.cur = null;
        m.el.hidden = true;
      }
      setHighlight([]);
      m.lastClosedAt = -1e9;
      m.lastClosedDay = -1e9;
      applyMinimized();
    },
    enabled: (s) => !ensure(s).off,
    tutorialActive: (s) => !ensure(s).done && !ensure(s).off,
    setEnabled(s, on) {
      ensure(s).off = !on;
      if (!on && m.cur && m.cur.kind === 'tip') close(s);
    },
    replay(s) {
      const st = ensure(s);
      st.step = 0;
      st.done = false;
      st.off = false;
      AIT.Mentor.reset();
    },
    TUTORIAL,
    TIPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
