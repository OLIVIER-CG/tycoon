/* Tiny synthesized sound effects (WebAudio, no files). Audio starts after the
   first tap, and the mute choice is remembered in this browser. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const KEY = 'ai-boom-tycoon-muted';
  let ctx = null, out = null, muted = false;
  try {
    muted = root.localStorage.getItem(KEY) === '1';
  } catch (e) {
    /* storage unavailable: default to sound on */
  }

  function audio() {
    if (!ctx) {
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      out = ctx.createGain();
      out.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      out.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, o = {}) {
    const c = audio();
    if (!c || muted) return;
    const t = c.currentTime + (o.when || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.06, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  const chord = (notes, gap, dur, o) => notes.forEach((f, i) => tone(f, dur, { ...o, when: i * gap }));

  const SFX = {
    tick: () => tone(1500, 0.03, { gain: 0.02 }),
    place: () => tone(240, 0.1, { type: 'triangle', slide: 120, gain: 0.13 }),
    sell: () => tone(620, 0.09, { type: 'triangle', slide: 300, gain: 0.08 }),
    blip: () => tone(760, 0.08, { gain: 0.05 }),
    mentor: () => chord([587, 880], 0.07, 0.12, { gain: 0.04 }),
    coin: () => {
      tone(988, 0.08, { type: 'square', gain: 0.03 });
      tone(1319, 0.2, { type: 'square', gain: 0.03, when: 0.07 });
    },
    unlock: () => chord([660, 990], 0.1, 0.25, { type: 'triangle', gain: 0.06 }),
    fanfare: () => chord([523, 659, 784, 1047], 0.1, 0.45, { type: 'triangle', gain: 0.06 }),
    chapter: () => chord([392, 523, 659, 784], 0.16, 0.8, { gain: 0.05 }),
    error: () => tone(150, 0.14, { type: 'square', gain: 0.025 }),
  };

  AIT.Sound = {
    play(name) {
      try {
        if (SFX[name]) SFX[name]();
      } catch (e) {
        /* audio can fail in locked-down frames; the game carries on */
      }
    },
    unlock() {
      try {
        audio();
      } catch (e) {
        /* ignore */
      }
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        root.localStorage.setItem(KEY, muted ? '1' : '0');
      } catch (e) {
        /* ignore */
      }
      return muted;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
