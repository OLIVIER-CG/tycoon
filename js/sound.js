/* Tiny synthesized sound effects and a quiet generative music loop (WebAudio,
   no files). Audio starts after the first tap. Mute and music choices are
   remembered in this browser. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const KEY = 'ai-boom-tycoon-muted';
  const MUSIC_KEY = 'ai-boom-tycoon-music';
  let ctx = null, out = null, muted = false, musicOn = true;
  try {
    muted = root.localStorage.getItem(KEY) === '1';
    musicOn = root.localStorage.getItem(MUSIC_KEY) !== '0';
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

  // ---------- music: slow pads and a sparse arpeggio, scheduled a little ahead ----------
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const PROGRESSION = [
    [48, 55, 59, 64], // Cmaj7
    [45, 52, 55, 60], // Am7
    [41, 48, 52, 57], // Fmaj7
    [43, 50, 55, 59], // G
  ];
  const BAR = 4; // seconds per chord
  const music = { bus: null, next: 0, bar: 0, timer: null };

  function voice(freq, t, dur, gain, type) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(1.2, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(music.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function scheduleMusic() {
    if (!ctx || muted || !musicOn || (root.document && root.document.hidden)) return;
    if (!music.bus) {
      music.bus = ctx.createGain();
      music.bus.gain.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      music.bus.connect(lp).connect(out);
    }
    if (music.next < ctx.currentTime) music.next = ctx.currentTime + 0.1;
    while (music.next < ctx.currentTime + 1.5) {
      const t = music.next, notes = PROGRESSION[music.bar % PROGRESSION.length];
      voice(hz(notes[0] - 12), t, BAR + 0.6, 0.02, 'sine');
      for (const n of notes.slice(1)) voice(hz(n), t, BAR + 0.8, 0.008, 'triangle');
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.45) voice(hz(notes[1 + Math.floor(Math.random() * 3)] + 12), t + i * (BAR / 8), 0.9, 0.006, 'sine');
      }
      music.next += BAR;
      music.bar++;
    }
  }

  function startMusic() {
    if (music.timer || !root.setInterval) return;
    music.timer = root.setInterval(() => {
      try {
        scheduleMusic();
      } catch (e) {
        /* audio can fail in locked-down frames */
      }
    }, 500);
  }

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
        startMusic();
      } catch (e) {
        /* ignore */
      }
    },
    get music() {
      return musicOn;
    },
    toggleMusic() {
      musicOn = !musicOn;
      try {
        root.localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0');
      } catch (e) {
        /* ignore */
      }
      if (music.bus && ctx) {
        // fade out whatever is already scheduled
        music.bus.gain.setTargetAtTime(musicOn ? 0.5 : 0.0001, ctx.currentTime, 0.3);
        if (musicOn) music.next = 0;
      }
      return musicOn;
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      if (music.bus && ctx) music.bus.gain.setTargetAtTime(muted || !musicOn ? 0.0001 : 0.5, ctx.currentTime, 0.2);
      try {
        root.localStorage.setItem(KEY, muted ? '1' : '0');
      } catch (e) {
        /* ignore */
      }
      return muted;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
