/* Boot, save/load and the main loop. */
(function (root) {
  const AIT = root.AIT;
  const { Sim, Render, UI, Saves, DATA: D } = AIT;
  const SPEEDS = [0, 1, 3, 8]; // in-game days per real second

  const game = (AIT.game = {
    s: null,
    speed: 1,
    lastSpeed: 1,
    setSpeed(n) {
      if (n > 0) this.lastSpeed = n;
      this.speed = n;
    },
    newGame(company, family, opts = {}) {
      this.s = Sim.newGame(Object.assign({ company, family }, opts));
      Render.selected = null;
      Render.setTool(null);
      Render.fit(D.OFFICES[0].size);
      UI.resetOver();
      AIT.Mentor.reset();
      this.setSpeed(1);
      this.save();
      UI.renderPanel(true);
    },
    json() {
      this.s.rng = Sim.rngState(); // keeps a daily-seed game on the same dice after a reload
      return JSON.stringify(this.s);
    },
    // storage can be unavailable; the game still runs, it just won't remember
    save() {
      return Saves.autosave(this.s, this.json());
    },
    saveManual() {
      return Saves.manual(this.s, this.json());
    },
    keyframe(label, tag) {
      return Saves.keyframe(this.s, this.json(), label, tag);
    },
    // load a save slot; false if it is missing or unreadable
    loadSlot(id) {
      let s = null;
      try {
        s = hydrate(JSON.parse(Saves.read(id)));
      } catch (e) {
        s = null;
      }
      if (!s) return false;
      this.s = s;
      Render.selected = null;
      Render.setTool(null);
      Render.fit(D.OFFICES[s.officeLevel].size);
      UI.resetOver();
      AIT.Mentor.reset();
      this.setSpeed(1);
      UI.renderPanel(true);
      return true;
    },
  });

  // Old saves are upgraded step by step; saves from a newer version are ignored.
  function hydrate(obj) {
    if (!obj || typeof obj.v !== 'number' || obj.v > Sim.VERSION || !Array.isArray(obj.items)) return null;
    const s = Object.assign(Sim.newGame(), Sim.migrate(obj));
    if (typeof s.rng === 'number') Sim.seed(s.rng);
    return s;
  }

  Sim.hooks.toast = (text, kind) => UI.toast(text, kind);
  Sim.hooks.month = () => {
    game.save();
    // a keyframe every new year, so players can go back
    const d = Sim.dateOf(game.s.day);
    if (d.getUTCMonth() === 0 && game.s.day > 1) game.keyframe(`New year ${d.getUTCFullYear()}`, 'year');
  };
  Sim.hooks.over = () => game.save();

  let last = performance.now();
  let acc = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = game.s;
    const blocked = UI.isBlocking() || s.events.length > 0 || (s.over && !s.over.sandbox);
    const running = !blocked && game.speed > 0;
    // real play time: only while the page is open and visible, and the run is not over
    if (!document.hidden && !(s.over && !s.over.sandbox)) s.playMs = (s.playMs || 0) + dt * 1000;
    if (running) {
      acc += dt * SPEEDS[game.speed];
      let n = 0;
      while (acc >= 1 && n < 10) {
        Sim.tick(s);
        acc -= 1;
        n++;
        if (s.events.length || (s.over && !s.over.sandbox)) {
          acc = 0;
          break;
        }
      }
    }
    Render.draw(now / 1000, dt, s, Sim.derive(s), running);
    UI.frame(now);
    requestAnimationFrame(loop);
  }

  function start(data) {
    const canvas = document.getElementById('view');
    Render.init(canvas, UI.canvasCb);
    UI.init();
    AIT.Mentor.init();
    let restored = null;
    try {
      restored = data && data.save ? hydrate(JSON.parse(data.save)) : null;
    } catch (e) {
      restored = null;
    }
    Saves.migrateLegacy();
    // behind the title screen: the latest save's office, or a fresh garage
    let s = restored;
    if (!s) {
      const last = Saves.latest();
      try {
        s = last ? hydrate(JSON.parse(Saves.read(last.id))) : null;
      } catch (e) {
        s = null;
      }
    }
    game.s = s || Sim.newGame();
    if (restored && typeof data.speed === 'number') game.speed = data.speed;
    Render.fit(D.OFFICES[game.s.officeLevel].size);
    UI.renderPanel(true);
    if (!restored) UI.showTitle(); // a live reload of the artifact drops you straight back in

    new ResizeObserver(() => Render.resize()).observe(document.getElementById('stage'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) game.save();
    });
    const hot = root.claude && root.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => ({ save: JSON.stringify(game.s), speed: game.speed }));
    requestAnimationFrame(loop);
  }

  const hot = root.claude && root.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})(window);
