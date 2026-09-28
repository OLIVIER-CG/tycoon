/* Boot, save/load and the main loop. */
(function (root) {
  const AIT = root.AIT;
  const { Sim, Render, UI, DATA: D } = AIT;
  const KEY = 'ai-boom-tycoon-v1';
  const SPEEDS = [0, 1, 3, 8]; // in-game days per real second

  const game = (AIT.game = {
    s: null,
    speed: 1,
    lastSpeed: 1,
    setSpeed(n) {
      if (n > 0) this.lastSpeed = n;
      this.speed = n;
    },
    newGame(company, family) {
      this.s = Sim.newGame({ company, family });
      Render.selected = null;
      Render.setTool(null);
      Render.fit(D.OFFICES[0].size);
      UI.resetOver();
      AIT.Mentor.reset();
      this.setSpeed(1);
      this.save();
      UI.renderPanel(true);
    },
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.s));
      } catch (e) {
        /* storage can be unavailable; the game still runs */
      }
    },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
  });

  function hydrate(obj) {
    if (!obj || obj.v !== 1 || !Array.isArray(obj.items)) return null;
    return Object.assign(Sim.newGame(), obj);
  }

  Sim.hooks.toast = (text, kind) => UI.toast(text, kind);
  Sim.hooks.month = () => game.save();
  Sim.hooks.over = () => game.save();

  let last = performance.now();
  let acc = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = game.s;
    const blocked = UI.isBlocking() || s.events.length > 0 || (s.over && !s.over.sandbox);
    const running = !blocked && game.speed > 0;
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
    const s = restored || hydrate(game.load());
    game.s = s || Sim.newGame();
    if (restored && typeof data.speed === 'number') game.speed = data.speed;
    Render.fit(D.OFFICES[game.s.officeLevel].size);
    UI.renderPanel(true);
    if (!s) UI.showNewGame(false);
    else if (!restored) UI.toast(`Welcome back to ${game.s.company}.`, 'good');

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
