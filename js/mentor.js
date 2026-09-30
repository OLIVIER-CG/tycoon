/* The mentor: a checklist that carries a new player through the first ten
   minutes, then a small set of hand-written tips that each appear once, only
   when they are relevant, with a cooldown between them. The game pauses while
   she is talking, but never for the checklist. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA, Sim = AIT.Sim;

  const NAME = 'Mira Castell';
  const TIP_COOLDOWN_MS = 45000; // real time between non-urgent tips at 1×, shorter at higher speeds
  const TIP_COOLDOWN_MIN_MS = 8000;
  const TIP_COOLDOWN_DAYS = 20; // and in-game days
  const SPEED_DAYS = [0, 1, 3, 8]; // days per second at each speed, as in main.js
  const TYPE_CPS = 70; // typewriter speed, characters per second

  const count = (s, t) => s.items.filter((i) => i.type === t).length;
  const money = (n) => AIT.fmt.money(n);
  const kw = (n) => AIT.fmt.kw(n);
  const seats = (s) => s.items.reduce((a, i) => a + (D.ITEMS[i.type].seats || 0), 0);
  const cheapestTech = (s) =>
    D.TECHS.filter((t) => !s.techs[t.id] && t.req.every((r) => s.techs[r])).sort((a, b) => a.cost - b.cost)[0];
  const lastModelDay = (s) => s.models.reduce((a, m) => Math.max(a, m.day), -1);

  // ---------- the first ten minutes: Mira's checklist ----------
  // Four acts take a new player from one gaming PC to a Small model in the
  // Mission. Each objective is one line of instructions with live progress, a
  // Show me button and a highlight on the thing to press. Objectives tick off
  // the moment they are done (or are skipped if already done), the game never
  // pauses for them, and Mira only speaks at the very start and the very end.
  const trainRate = (s, v) => Math.max(0.01, (s.training ? v.trainPF : s.autoAlloc ? Math.max(0, v.effPF - v.need * 1.15) : v.effPF * s.allocTrain) * v.trainMult);
  const smallDays = (s, v) => Math.ceil(D.SIZE_BY_ID.small.pfdays / trainRate(s, v));
  const trainPct = (s) => (s.training ? [s.training.done, s.training.need, `${Math.floor((s.training.done / s.training.need) * 100)}%`] : null);
  const hasSize = (s, id) => s.models.some((m) => m.size === id) || (s.training && s.training.size === id);
  // days a Small run may take once the lab is set up; a smaller raise buys fewer GPUs,
  // so the target is fixed when the objective starts, from the cash on hand
  const smallTarget = (s) => (s.mentor && s.mentor.smallTarget) || 120;
  const roomFor = (s, type) => {
    const n = D.OFFICES[s.officeLevel].size, occ = Sim.occupied(s);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!Sim.canPlace(s, type, x, y, occ)) return true;
    return false;
  };
  const noRoom = ' No free floor? Sell a GPU with the tag tool in the toolbar, then add the AC.';

  const ACTS = {
    garage: { n: 1, title: 'The garage', quote: 'One gaming PC and a lot of fog. Let’s turn this into a lab.' },
    money: { n: 2, title: 'First believers', quote: 'A working model means investors will take your call.' },
    move: { n: 3, title: 'Moving out', quote: 'A garage can’t train anything bigger. The Mission can.' },
    small: { n: 4, title: 'A real model', quote: 'Now train something people will actually pay for.' },
  };

  const TUTORIAL = [
    {
      id: 'rigs', act: 'garage',
      title: 'Build 3 more gaming rigs',
      how: 'Open Compute in the build toolbar on the left, pick Gaming Rig, then tap empty floor. Drag to place a row.',
      go: 'build:compute',
      highlight: ['#tools [data-cat="compute"]', '#dock [data-item="rig"]'],
      progress: (s) => [Math.min(3, count(s, 'rig') - 1), 3],
      done: (s) => count(s, 'rig') >= 4 || s.officeLevel > 0,
    },
    {
      id: 'train', act: 'garage',
      title: 'Train your first model',
      how: 'Open Models with the round button at the top. Tiny with licensed data is ready: press Start training.',
      go: 'models:train:tiny',
      highlight: ['#rail [data-screen="models"]', '[data-act="start-train"]'],
      done: (s) => !!s.training || s.models.length > 0,
    },
    {
      id: 'speed', act: 'garage',
      title: 'Speed up time',
      how: 'Training is measured in days. Press one of the fast-forward buttons at the top left. Space pauses.',
      highlight: ['#speed'],
      progress: trainPct,
      done: (s) => (AIT.game && AIT.game.speed >= 2) || s.models.length > 0,
    },
    {
      id: 'deploy', act: 'garage',
      title: 'Put your model online',
      how: 'When training finishes, press Deploy so people can subscribe at $20 a month.',
      go: 'models:library',
      highlight: ['[data-modal="reveal-deploy"]', '[data-act="deploy"]'],
      progress: trainPct,
      done: (s) => !!s.flagshipId,
    },
    {
      id: 'raise', act: 'money',
      title: 'Raise a pre-seed round',
      how: 'Open Money › Funding and pitch. Take the offer you like: you sell a small slice of the company for cash to grow.',
      go: 'finance:funding',
      highlight: ['#rail [data-screen="finance"]', '[data-act="pitch"]', '[data-act="accept"]'],
      done: (s) => s.rounds.length > 0,
      skip: 'Raising is optional, but a garage can’t pay for the next step on its own.',
    },
    {
      id: 'research', act: 'money',
      title: 'Research Scaling Laws',
      how: 'Research points pile up on their own. Spend 20 in R&D: Scaling Laws unlocks Small models.',
      go: 'research:avail',
      highlight: ['#rail [data-screen="research"]', '.tech[data-id="scaling_laws"]', '[data-act="research"][data-id="scaling_laws"]'],
      progress: (s) => [Math.min(20, Math.floor(s.rp)), 20, s.rp >= 20 ? 'ready' : `${Math.floor(s.rp)} / 20 RP`],
      done: (s) => !!s.techs.scaling_laws,
    },
    {
      id: 'move', act: 'move',
      title: 'Move to the Mission',
      how: 'Open Real estate at the bottom of the build toolbar and move into the Victorian flat: more power, and room for workstations.',
      go: 'hq:office',
      highlight: ['#tools [data-go="hq:office"]', '[data-key="move"]'],
      progress: (s) => (s.officeLevel ? null : [Math.min(s.cash, D.OFFICES[1].moveCost), D.OFFICES[1].moveCost, s.cash >= D.OFFICES[1].moveCost ? 'you can afford it' : `${money(s.cash)} of ${money(D.OFFICES[1].moveCost)}`]),
      done: (s) => s.officeLevel >= 1,
    },
    {
      id: 'compute', act: 'move',
      title: (s) => `Get a Small run under ${smallTarget(s)} days`,
      start: (s, v, st) => (st.smallTarget = s.cash >= 380e3 ? 120 : 180),
      // while the GPUs are throttled by heat, more GPUs won't help: point at cooling instead
      how: (s, v) => (v.heat > v.cooling ? `Your GPUs are overheating and run at ${Math.round(v.thermal * 100)}% speed: ${kw(v.heat)} of heat, ${kw(v.cooling)} of cooling. More GPUs won't help until you add AC units from the Cooling shelf.${roomFor(s, 'ac') ? '' : noRoom}` : 'A Small model needs 6,000 PF-days. Fill the flat with 4-GPU workstations until it fits. Keep about $60k for its training data.'),
      go: (s, v) => (v.heat > v.cooling ? 'build:cooling' : 'build:compute'),
      highlight: (s, v) => (v.heat > v.cooling ? ['#tools [data-cat="cooling"]', '[data-coach="heat"]', '#dock [data-item="ac"]'] : ['#tools [data-cat="compute"]', '#dock [data-item="workstation"]']),
      progress: (s, v) => {
        const d = smallDays(s, v);
        return [Math.min(1, smallTarget(s) / d), 1, d > 3650 ? 'Small: over 10 years' : `Small: ${d.toLocaleString('en-US')} days`];
      },
      done: (s, v) => smallDays(s, v) <= smallTarget(s) || hasSize(s, 'small'),
    },
    {
      id: 'cool', act: 'move',
      title: 'Keep it cool',
      how: (s) => 'GPUs turn power into heat. Add AC units until heat is below cooling. It doesn’t matter where they stand.' + (roomFor(s, 'ac') ? '' : noRoom),
      go: 'build:cooling',
      highlight: ['#tools [data-cat="cooling"]', '[data-coach="heat"]', '#dock [data-item="ac"]'],
      when: (s, v) => v.heat > v.cooling, // only when it is needed
      progress: (s, v) => [Math.min(v.cooling, v.heat), v.heat, `${kw(v.heat)} heat · ${kw(v.cooling)} cooling`],
      done: (s, v) => v.heat <= v.cooling,
    },
    {
      id: 'small', act: 'small',
      title: 'Train a Small model',
      how: 'In Models, pick Small. Licensed data is enough for now. It scores about twice your Tiny.',
      go: 'models:train:small',
      highlight: ['#rail [data-screen="models"]', '[data-act="pick-size"][data-id="small"]', '[data-act="start-train"]'],
      done: (s) => hasSize(s, 'small') || s.models.some((m) => m.cap > 14),
    },
    {
      id: 'campaign', act: 'small',
      title: 'Run a hype campaign',
      how: 'Hype brings subscribers and fades every day. Start the free Cryptic Hype Thread in Market › Marketing.',
      go: 'market:marketing',
      highlight: ['#rail [data-screen="market"]', '[data-act="campaign"][data-id="thread"]'],
      when: (s) => AIT.Progress.has(s, 'tab:market'),
      done: (s) => s.log.some((e) => e.a === 'campaign'),
    },
    {
      id: 'ship', act: 'small',
      title: 'Ship the Small model',
      how: 'Let it train. 8× is fine while you wait. Then deploy it: your score roughly doubles.',
      highlight: ['#speed', '[data-modal="reveal-deploy"]', '[data-act="deploy"]'],
      progress: trainPct,
      done: (s) => !!(s.flagshipId && s.models.find((m) => m.id === s.flagshipId && m.cap > 14)),
    },
    {
      id: 'hire', act: 'small',
      title: 'Hire a researcher',
      // a researcher costs $7-19k a month: only once the lab can carry it for most of a year
      when: (s, v) => v.profitMonth >= 15000 || s.cash >= 9 * Math.max(15000, 15000 - v.profitMonth),
      how: (s) => (seats(s) > s.staff.length ? 'Revenue is growing. Open Team › Hiring and hire a researcher: they earn research points every day.' : 'Everyone needs a desk. Build a standing desk from the Office shelf, then hire in Team › Hiring.'),
      go: (s) => (seats(s) > s.staff.length ? 'team:hire' : 'build:office'),
      highlight: (s) => (seats(s) > s.staff.length ? ['#rail [data-screen="team"]', '[data-act="hire"]'] : ['#tools [data-cat="office"]', '#dock [data-item="desk"]']),
      done: (s) => s.staff.length >= 2,
    },
  ];
  const INTRO = "Hi, I'm Mira. I've started two AI labs, back when nobody believed in scaling. Your job: turn this garage into a lab and beat the big Bay Area labs to AGI. I'll keep a checklist at the top right. Do what it says, and press Show me whenever you're lost.";
  const OUTRO = "Your first real model is live and the garage is behind you. From here the milestone card at the top right points the way, and I'll speak up when something needs you. Good luck out there.";

  // ---------- tips, in priority order ----------
  // Each shows at most once per game. Urgent tips skip the cooldown.
  const TIPS = [
    {
      id: 'broke', urgent: true,
      when: (s) => s.stats.negDays > 0,
      lines: ["You're out of cash. You have 90 days before the company folds. Sell hardware you don't need, let someone go, or raise money in Money."],
      go: 'finance',
    },
    {
      id: 'overheat', urgent: true,
      when: (s, v) => v.thermal < 0.97,
      lines: (s, v) => [`It's getting hot in here. Your GPUs make ${kw(v.heat)} of heat and you can only remove ${kw(v.cooling)}, so everything runs at ${Math.round(v.thermal * 100)}% speed. Add fans or AC units from the Cooling shelf in the build toolbar.`],
      go: 'build:cooling',
      highlight: ['[data-coach="heat"]', '#tools [data-cat="cooling"]'],
    },
    {
      id: 'cut_costs', urgent: true,
      when: (s) => s.stats.negDays >= 20,
      lines: ["Still no cash after 20 days. To survive, get your costs below your revenue. Each person's card in Team shows what they add, so let go of whoever adds least. You can also sell hardware in Build for half its price."],
      go: 'team',
    },
    {
      id: 'slow_run', urgent: true, persist: 7, // a quake or a hot spell shouldn't trigger it
      when: (s, v) => s.training && v.trainPF * v.trainMult > 0 && (s.training.need - s.training.done) / (v.trainPF * v.trainMult) > 180,
      lines: (s, v) => [`Careful: at your current compute, ${s.training.name} needs another ${Math.round((s.training.need - s.training.done) / (v.trainPF * v.trainMult))} days. Buy more GPUs to speed it up, or cancel now and get half the data cost back.`],
      go: 'models',
    },
    {
      id: 'capacity', urgent: true, persist: 5,
      when: (s, v) => v.flagship && v.service < 0.85 && s.subs > 100,
      lines: ['Users are getting "at capacity" errors, and they will leave. Buy more GPUs, or lower the training share in Models so serving gets more compute.'],
      go: 'models',
    },
    {
      id: 'power',
      when: (s, v) => v.powerFactor < 1,
      lines: ["You're drawing more power than the building can supply, so every GPU slows down. Battery walls add a little capacity. Bigger offices and substations add a lot. PG&E is not coming to save you."],
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
      lines: (s, v) => [`Your payroll is ${money(v.payroll)} a month and revenue is ${money(v.mrr)}. Hire when there is work waiting: GPUs to train on, or research you need. Team shows what each person adds.`],
      go: 'team',
    },
    {
      id: 'offer',
      when: (s) => s.funding.offers.length > 0,
      lines: ['Term sheets are in from Sand Hill Road. Each investor wants something different: a famous VC brings hype, a Big Tech partner throws in free compute, a friendly fund takes less of the company. Pushing for a better price works more often when you have plenty of cash left, but the investor may walk, and walking away cools the next pitch.'],
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
      lines: ["Every desk is taken, so you can't hire anyone else. Standing desks are cheap. Find them on the Office shelf in the build toolbar."],
      go: 'build:office',
    },
    {
      id: 'loft',
      when: (s) => s.officeLevel === 0 && s.models.length > 0 && s.cash > 30000,
      lines: ["The garage is nearly out of power. The Victorian flat in the Mission has three times the power and room for 4-GPU workstations. Open Real estate from the build toolbar on the left."],
      go: 'build',
    },
    {
      id: 'morale',
      when: (s) => {
        const team = s.staff.filter((p) => !p.founder);
        return team.length >= 2 && team.reduce((a, p) => a + p.morale, 0) / team.length < 45;
      },
      lines: ['Your team is unhappy. Low morale slows work, and people quit below 25%. A pour-over bar, bean bags, a pinball machine or an office dog near their desks helps, and so does hype. They are on the Comfort shelf.'],
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
      // only when a clearly better model is within reach, or the nudge is noise
      when: (s, v) => !s.training && s.models.length > 0 && s.day - lastModelDay(s) > 30 && !!Sim.bestNextRun(s, v),
      lines: (s, v) => {
        const run = Sim.bestNextRun(s, v);
        return [`Your GPUs aren't training anything, and ${run.size.name === 'XL' || /^[AEIOU]/.test(run.size.name) ? 'an' : 'a'} ${run.size.name} run would score about ${Math.round(run.exp)} in ${run.days} days. Idle compute only earns a trickle of research.`];
      },
      go: 'models:run',
    },
    {
      id: 'series_a',
      when: (s) => s.officeLevel === 2 && s.models.some((m) => m.size === 'small'),
      lines: ['Mission Bay costs $1.2M to move into and $100k a month. You can save that up from revenue or raise a Series A. Investors pay the most once you reach OmniBench 28 or $150k a month, and a Medium model gets you there.'],
      go: 'finance',
    },
    {
      id: 'hype',
      when: (s, v) => v.flagship && s.day > 90 && s.hype < 12,
      lines: ['Hype fades every day, and it drives both users and valuation. Campaigns in Market bring it back. A launch thread is free.'],
      go: 'market',
    },
    {
      id: 'price',
      when: (s) => s.subs > 5000,
      lines: ['You can change your subscription price in Market. The chart there shows what each price would earn before you commit. Cheaper plans win more users, but each one earns less and needs compute.'],
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
      when: (s) => s.officeLevel >= 3,
      lines: ['Welcome to Mission Bay. 8-GPU Servers and chillers fit here, and substations add power when you outgrow the building.'],
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
      when: (s) => s.officeLevel >= 4,
      lines: ['A tower on Montgomery Street means GPU racks. Plan for Liquid Cooling and Custom Silicon in R&D: the SuperPods in the Presidio need both.'],
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
      when: (s) => s.officeLevel >= 5,
      lines: ['The Presidio. SuperPods, gas turbines and wafer-scale engines are your endgame hardware. After this there is only Treasure Island.'],
      go: 'build:compute',
    },
    {
      id: 'boards',
      when: (s, v) => v.boards > 0 && s.staff.some((p) => p.role === 'researcher' && v.seatInfo.get(p.id) && !v.seatInfo.get(p.id).board),
      lines: ['Whiteboards only help researchers who sit within 2 tiles of one. Put them between the research desks. Select a whiteboard to see its reach.'],
      go: 'build:office',
    },
    {
      id: 'product',
      when: (s) => !!s.flagshipId && D.PRODUCTS.some((p) => s.techs[p.tech] && !s.products[p.id].live && s.cash > p.launch * 2),
      lines: (s) => {
        const p = D.PRODUCTS.find((x) => s.techs[x.tech] && !s.products[x.id].live && s.cash > x.launch * 2);
        return [`You can now sell more than a chat app. ${p.name} is ready to launch from Market. It has its own customers and its own price, and it shares your model's score with the rivals.`];
      },
      go: 'market',
    },
    {
      id: 'alignment',
      when: (s, v) => !!s.techs.constitutional || (v.topRival && v.topRival.cap >= 55),
      lines: ['People are starting to ask whether your models are safe. The Race screen shows your alignment score. Safety staff, safety research and your choices in a crisis all count, and they decide how the world reacts if you reach AGI.'],
      go: 'race',
    },
  ];

  // ---------- state ----------
  const m = {
    el: null, card: null, style: null, cur: null, page: 0, shown: 0, typeStart: 0, minimized: false,
    lastClosedAt: -1e9, lastClosedDay: -1e9, hlKey: '', cardKey: '', cardMin: false, flashAt: 0, seenStep: -1,
  };
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sfx = (n) => AIT.Sound && AIT.Sound.play(n);

  function ensure(s) {
    if (!s.mentor) s.mentor = { step: 0, done: s.day > 60, seen: {}, off: false };
    const st = s.mentor;
    // v2 is the checklist. Anyone mid-way through the old tutorial restarts the
    // checklist, which skips what they have already done.
    if (st.v !== 2) {
      st.v = 2;
      if (!st.done) st.step = 0;
      st.intro = st.intro || s.day > 0 || !!st.done;
      st.completed = st.completed || {};
    }
    st.completed = st.completed || {};
    return st;
  }
  const active = (st) => !st.done && !st.off;
  const resolve = (x, s, v) => (typeof x === 'function' ? x(s, v || Sim.derive(s)) : x);
  const lastPage = () => m.page >= m.cur.lines.length - 1;

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
        <div class="m-task" data-m="expand" hidden><span class="m-check" aria-hidden="true"></span><span class="m-task-t">Mira has something to tell you</span></div>
        <div class="m-actions"></div>
      </div>`;
  }

  // Mira's speech bubble: the welcome, the send-off and tips
  function renderPage(s) {
    const c = m.cur;
    const el = m.el;
    el.hidden = false;
    el.classList.toggle('tip', c.kind === 'tip');
    el.querySelector('.m-label').textContent = c.kind === 'tip' ? 'Tip' : c.kind === 'intro' ? 'Welcome' : 'Checklist done';
    m.shown = reduced() ? Infinity : 0;
    m.typeStart = performance.now();
    el.querySelector('.m-text').textContent = reduced() ? c.lines[m.page] : '';
    const go = resolve(c.def.go, s);
    const btns = [];
    if (c.kind === 'intro') btns.push('<button class="btn ghost small" data-m="skip">I know the game</button>');
    if (go && c.kind === 'tip') btns.push('<button class="btn small" data-m="show">Show me</button>');
    btns.push(`<button class="btn primary small" data-m="next">${!lastPage() ? 'Next' : c.kind === 'intro' ? 'Let’s go' : 'Got it'}</button>`);
    el.querySelector('.m-actions').innerHTML = btns.join('');
    applyMinimized();
  }

  function applyMinimized() {
    m.el.classList.toggle('min', m.minimized);
    const taskEl = m.el.querySelector('.m-task');
    if (taskEl) taskEl.hidden = !(m.cur && m.minimized);
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
    m.cur = { kind, def, lines: typeof def.lines === 'function' ? def.lines(s, v) : def.lines };
    m.page = 0;
    m.minimized = false;
    renderPage(s);
    sfx('mentor');
  }

  function close(s) {
    m.cur = null;
    m.el.hidden = true;
    m.lastClosedAt = performance.now();
    m.lastClosedDay = s.day;
    applyMinimized();
  }

  // ---------- the checklist card ----------
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const visible = (o, s, v) => !o.when || o.when(s, v);

  // move to the next objective; ones already done before they were shown are skipped quietly
  function advanceChecklist(s, v) {
    const st = ensure(s);
    if (m.flashAt) {
      if (performance.now() - m.flashAt < (reduced() ? 250 : 900)) return;
      m.flashAt = 0;
      st.step++;
    }
    for (let guard = 0; guard < TUTORIAL.length + 1; guard++) {
      const o = TUTORIAL[st.step];
      if (!o) {
        st.done = true;
        st.finished = true;
        return;
      }
      if (!visible(o, s, v) && !st.completed[o.id]) {
        st.step++;
        continue;
      }
      if (!st.started) st.started = {};
      if (!st.started[o.id] && o.start) o.start(s, v, st);
      st.started[o.id] = true;
      if (o.done(s, v)) {
        st.completed[o.id] = s.day;
        if (m.seenStep === st.step) {
          m.flashAt = performance.now(); // tick it off where the player can see it
          sfx('unlock');
          return;
        }
        st.step++;
        continue;
      }
      return;
    }
  }

  function renderCard(s, v, blocked) {
    const card = m.card;
    const st = ensure(s);
    const cur = TUTORIAL[st.step];
    const on = active(st) && st.intro && !!cur;
    document.body.classList.toggle('checklist-on', on);
    if (!on) {
      if (!card.hidden) {
        card.hidden = true;
        card.innerHTML = '';
        m.cardKey = '';
      }
      return;
    }
    const act = ACTS[cur.act];
    const inAct = TUTORIAL.map((o, i) => ({ o, i })).filter((x) => x.o.act === cur.act);
    const rows = inAct
      .filter((x) => (x.i < st.step ? !!st.completed[x.o.id] : x.i === st.step || visible(x.o, s, v)))
      .map(({ o, i }) => {
        const title = resolve(o.title, s, v);
        if (i < st.step) return `<li class="done"><span class="ck" aria-hidden="true"></span><span>${esc(title)}</span></li>`;
        if (i > st.step) return `<li class="next"><span class="ck" aria-hidden="true"></span><span>${esc(title)}</span></li>`;
        const how = resolve(o.how, s, v);
        return `<li class="cur${m.flashAt ? ' flash' : ''}"><span class="ck" aria-hidden="true"></span><div class="grow">
          <div class="t">${esc(title)}</div>
          ${m.cardMin ? '' : `<div class="how">${esc(how)}</div>
          ${o.progress ? '<div class="prog"><div class="bar"><i id="obj-bar"></i></div><span id="obj-label"></span></div>' : ''}
          <div class="acts">${o.go ? '<button class="btn small primary" data-m="obj-show">Show me</button>' : ''}${o.skip ? `<button class="obj-link" data-m="obj-skip" title="${esc(o.skip)}">Skip this step</button>` : ''}</div>`}
        </div></li>`;
      })
      .join('');
    const key = [st.step, m.flashAt ? 1 : 0, m.cardMin ? 1 : 0, rows].join('|');
    if (key !== m.cardKey) {
      card.innerHTML = `<div class="obj-head"><span class="obj-face">${FACE}</span><div class="grow"><div class="eyebrow">Checklist · part ${act.n} of 4</div><div class="obj-act">${esc(act.title)}</div></div><button class="obj-min" data-m="obj-min" aria-label="${m.cardMin ? 'Expand' : 'Collapse'} checklist" aria-expanded="${!m.cardMin}">${m.cardMin ? '+' : '–'}</button></div>
        ${m.cardMin ? '' : `<p class="obj-quote">“${esc(act.quote)}”</p>`}
        <ol class="obj-list">${rows}</ol>
        ${m.cardMin ? '' : '<button class="obj-link obj-skipall" data-m="skip">Skip the tutorial</button>'}`;
      m.cardKey = key;
    }
    card.hidden = false;
    // only count an objective as seen once the list has caught up with the game,
    // so loading a save skips finished ones instead of ticking them off one by one
    if (!blocked && m.caughtUp) m.seenStep = st.step;
    // progress changes every day, so it is updated in place
    if (cur.progress && !m.cardMin) {
      const p = cur.progress(s, v);
      const barEl = card.querySelector('#obj-bar'), lab = card.querySelector('#obj-label');
      if (barEl && lab) {
        const r = p ? Math.max(0, Math.min(1, p[0] / (p[1] || 1))) : 0;
        barEl.style.width = (m.flashAt ? 100 : r * 100).toFixed(1) + '%';
        lab.textContent = p ? p[2] || `${Math.floor(p[0])} / ${p[1]}` : 'not started';
      }
    }
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
    close(g.s);
  }

  function skipTutorial(s) {
    const st = ensure(s);
    st.done = true;
    st.intro = true;
    if (m.cur && m.cur.kind === 'intro') close(s);
    setHighlight([]);
    renderCard(s, Sim.derive(s));
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
    } else if (what === 'skip') skipTutorial(g.s);
    else if (what === 'show') {
      const go = resolve(m.cur.def.go, g.s);
      if (go) AIT.UI.goTo(go);
      close(g.s);
    }
  }

  function onCardClick(e) {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const s = AIT.game.s;
    const st = ensure(s);
    const cur = TUTORIAL[st.step];
    const what = b.dataset.m;
    if (what === 'obj-show' && cur) {
      const go = resolve(cur.go, s);
      if (go) AIT.UI.goTo(go);
    } else if (what === 'obj-skip' && cur) {
      st.step++;
      m.flashAt = 0;
    } else if (what === 'obj-min') m.cardMin = !m.cardMin;
    else if (what === 'skip') return skipTutorial(s);
    renderCard(s, Sim.derive(s));
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
    const over = s.over && !s.over.sandbox;
    if (active(st) && st.intro && !blocked) {
      advanceChecklist(s, v);
      m.caughtUp = true;
    }
    renderCard(s, v, blocked);
    // the checklist's highlight shows whenever Mira isn't pointing at something else
    const cur = active(st) && st.intro ? TUTORIAL[st.step] : null;
    if (m.cur) setHighlight(m.cur.def.highlight ? resolve(m.cur.def.highlight, s, v) : cur && cur.highlight ? resolve(cur.highlight, s, v) : []);
    else setHighlight(cur && cur.highlight ? resolve(cur.highlight, s, v) : []);
    if (m.cur || blocked || st.off || over) return;

    if (active(st) && !st.intro) {
      st.intro = true;
      open(s, v, 'intro', { lines: [INTRO] });
      return;
    }
    if (st.done && st.finished && !st.outro) {
      st.outro = true;
      open(s, v, 'outro', { lines: [OUTRO] });
      return;
    }

    const now = performance.now();
    // at 8× the real-time wait alone would skip whole years of tips
    const speed = SPEED_DAYS[(AIT.game && AIT.game.speed) || 1] || 1;
    const waitMs = Math.max(TIP_COOLDOWN_MIN_MS, TIP_COOLDOWN_MS / speed);
    const cooling = now - m.lastClosedAt < waitMs || s.day - m.lastClosedDay < TIP_COOLDOWN_DAYS;
    st.since = st.since || {};
    for (const tip of TIPS) {
      if (st.seen[tip.id] != null) continue;
      const hit = tip.when(s, v);
      // some conditions must hold for a while, so a short blip doesn't set them off
      if (tip.persist) {
        if (!hit) delete st.since[tip.id];
        else if (st.since[tip.id] == null) st.since[tip.id] = s.day;
        if (!hit || s.day - st.since[tip.id] < tip.persist) continue;
      } else if (!hit) continue;
      // during the checklist only urgent tips speak up, and not about what the checklist is explaining
      if ((cooling || active(st)) && !tip.urgent) continue;
      if (tip.id === 'overheat' && active(st) && ['compute', 'cool'].includes((TUTORIAL[st.step] || {}).id)) continue;
      st.seen[tip.id] = s.day;
      open(s, v, 'tip', tip);
      return;
    }
  }

  AIT.Mentor = {
    init() {
      m.el = document.getElementById('mentor');
      m.card = document.getElementById('objectives');
      m.style = document.getElementById('coach-style');
      build();
      m.el.addEventListener('click', onClick);
      m.card.addEventListener('click', onCardClick);
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !m.cur || m.minimized || e.target.matches('input, textarea, button')) return;
        e.preventDefault();
        next();
      });
    },
    frame,
    check,
    // true while she is talking and the game should wait
    blocking: () => !!m.cur && !m.minimized,
    reset() {
      if (m.cur) {
        m.cur = null;
        m.el.hidden = true;
      }
      setHighlight([]);
      m.lastClosedAt = -1e9;
      m.lastClosedDay = -1e9;
      m.flashAt = 0;
      m.seenStep = -1;
      m.caughtUp = false;
      m.cardKey = '';
      if (m.card) {
        m.card.hidden = true;
        m.card.innerHTML = '';
      }
      applyMinimized();
    },
    enabled: (s) => !ensure(s).off,
    tutorialActive: (s) => active(ensure(s)),
    setEnabled(s, on) {
      ensure(s).off = !on;
      if (!on && m.cur && m.cur.kind === 'tip') close(s);
    },
    replay(s) {
      const st = ensure(s);
      Object.assign(st, { step: 0, done: false, off: false, intro: false, outro: false, finished: false, completed: {}, started: {}, smallTarget: null });
      AIT.Mentor.reset();
    },
    TUTORIAL,
    TIPS,
    ACTS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
