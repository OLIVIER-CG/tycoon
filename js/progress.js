/* Progressive disclosure. Tabs, HUD stats and build categories appear as the
   player earns them, and each office move opens a new chapter. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});

  // The Mission landlord wants a reason to rent to you: a plan for bigger models
  // (Scaling Laws) and a way to pay (a funding round, real users or savings).
  const missionReady = (s) => !!s.techs.scaling_laws && (s.rounds.length > 0 || s.subs >= 500 || s.cash >= 150e3);

  // msg: a short unlock note. Features without one arrive with a chapter card.
  const FEATURES = [
    { id: 'tab:build', when: () => true },
    { id: 'tab:models', when: () => true },
    { id: 'hud:cash', when: () => true },
    { id: 'hud:compute', when: () => true },
    { id: 'cat:compute', when: () => true },
    { id: 'cat:cooling', when: () => true },
    { id: 'hud:bench', when: (s) => s.models.length > 0 },
    { id: 'tab:race', when: (s) => s.models.length > 0, msg: 'New screen: Race. See how your models rank against the other labs in the Bay.' },
    // investors call once real people use the model, or after a while regardless
    { id: 'tab:finance', when: (s) => s.subs >= 150 || s.rounds.length > 0 || (s.models.length > 0 && s.day >= 150), msg: 'New screen: Money. Investors on Sand Hill Road have heard about you.' },
    { id: 'hud:subs', when: (s) => !!s.flagshipId },
    { id: 'hud:hype', when: (s) => !!s.flagshipId },
    // raising money or finding real users both mean it is time to grow
    { id: 'hud:val', when: (s) => s.rounds.length > 0 || s.subs >= 250 },
    { id: 'tab:team', when: (s) => s.rounds.length > 0 || s.subs >= 250 || s.staff.length > 1 },
    { id: 'cat:office', when: (s) => s.rounds.length > 0 || s.subs >= 250 || s.staff.length > 1 },
    { id: 'office:next', when: (s) => s.officeLevel > 0 || missionReady(s) },
    { id: 'cat:comfort', when: (s) => s.staff.length > 1, msg: 'New in Build: comfort items. Happy people work faster.' },
    { id: 'tab:research', when: (s) => s.staff.length > 1 || s.rp >= AIT.DATA.TECH_BY_ID.scaling_laws.cost, msg: 'New screen: R&D. Spend research points on new technology.' },
    { id: 'tab:market', when: (s) => !!s.flagshipId, msg: 'New screen: Market. Run campaigns and set your price.' },
    { id: 'cat:power', when: (s, v) => s.officeLevel >= 1 || v.power > v.powerCap * 0.8, msg: 'New in Build: power. Add capacity before the lights flicker.' },
  ];

  const P = {
    FEATURES,
    ensure(s, v) {
      if (s.unlocked) return;
      // new games and saves from before this system unlock silently
      s.unlocked = {};
      s.tabSeen = { build: 1, models: 1 };
      s.chapters = {};
      for (const f of FEATURES) if (f.when(s, v)) s.unlocked[f.id] = s.day;
      for (const c of AIT.FLAVOR.CHAPTERS) if (c.when(s)) s.chapters[c.id] = s.day;
      for (const id in s.unlocked) if (id.startsWith('tab:')) s.tabSeen[id.slice(4)] = 1;
    },
    has: (s, id) => !!s.unlocked && s.unlocked[id] != null,
    // why the next office isn't for rent yet, or '' once it is
    officeWhy(s) {
      if (P.has(s, 'office:next') || s.officeLevel > 0 || missionReady(s)) return '';
      if (!s.techs.scaling_laws) return 'Research Scaling Laws first. A bigger lab only makes sense once you can train bigger models.';
      return `The landlord wants proof you can pay the rent: a funding round, 500 subscribers or ${AIT.fmt ? AIT.fmt.money(150e3) : '$150k'} in the bank.`;
    },
    // returns { notes: [msg], chapter } for anything that just unlocked
    check(s, v) {
      P.ensure(s, v);
      const notes = [];
      for (const f of FEATURES) {
        if (s.unlocked[f.id] != null || !f.when(s, v)) continue;
        s.unlocked[f.id] = s.day;
        if (f.msg) notes.push(f.msg);
      }
      let chapter = null;
      for (const c of AIT.FLAVOR.CHAPTERS) {
        if (s.chapters[c.id] != null || !c.when(s)) continue;
        s.chapters[c.id] = s.day;
        chapter = c;
      }
      return { notes, chapter };
    },
    isNewTab: (s, tab) => P.has(s, 'tab:' + tab) && !(s.tabSeen && s.tabSeen[tab]),
    seeTab(s, tab) {
      if (s.tabSeen) s.tabSeen[tab] = 1;
    },
  };

  AIT.Progress = P;
})(typeof window !== 'undefined' ? window : globalThis);
