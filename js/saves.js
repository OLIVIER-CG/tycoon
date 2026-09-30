/* Save slots, kept in this browser. Every run has one autosave that is
   rewritten each month, plus keyframes: one at the start of every chapter
   and one each new year, so a player can go back to an earlier point. When
   storage runs out, the oldest keyframes go first; autosaves go last. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const INDEX = 'ai-boom-tycoon-saves';
  const PREFIX = 'ai-boom-tycoon-save:';
  const LEGACY = 'ai-boom-tycoon-v1'; // the single save slot before v0.3
  const VERSION = '0.3.0';
  const YEARS_KEPT = 4; // yearly keyframes kept per run, on top of chapter ones

  const store = {
    get(k) {
      try {
        return root.localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        root.localStorage.setItem(k, v);
        return true;
      } catch (e) {
        return false; // full, or storage is blocked
      }
    },
    del(k) {
      try {
        root.localStorage.removeItem(k);
      } catch (e) {
        /* nothing to do */
      }
    },
  };

  function readIndex() {
    try {
      const list = JSON.parse(store.get(INDEX) || '[]');
      return Array.isArray(list) ? list.filter((e) => e && e.id) : [];
    } catch (e) {
      return [];
    }
  }
  const writeIndex = (list) => store.set(INDEX, JSON.stringify(list));
  const byAge = (a, b) => String(a.created).localeCompare(String(b.created));
  const runOf = (s) => s.runId || 'run-' + String(s.company || 'lab').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  function entryFor(s, id, kind, label) {
    const office = AIT.DATA.OFFICES[s.officeLevel] || AIT.DATA.OFFICES[0];
    return {
      id,
      runId: runOf(s),
      kind, // auto | milestone | manual
      label: label || '',
      company: String(s.company || 'Your lab'),
      office: office.name,
      officeLevel: s.officeLevel || 0,
      day: s.day || 0,
      playMs: s.playMs || 0,
      created: new Date().toISOString(),
      version: VERSION,
      mode: s.mode || 'standard',
      difficulty: s.difficulty || 'normal',
      over: s.over ? (s.over.win ? 'won' : 'lost') : null,
    };
  }

  // Write one slot. If storage is full, drop the oldest keyframe (from other
  // runs first), then older autosaves of other runs, and try again.
  function put(entry, json) {
    let list = readIndex();
    for (let i = 0; i < 60; i++) {
      if (store.set(PREFIX + entry.id, json)) {
        list = list.filter((e) => e.id !== entry.id);
        list.push(entry);
        writeIndex(list);
        return true;
      }
      const others = list.filter((e) => e.id !== entry.id);
      const victim =
        others.filter((e) => e.kind !== 'auto' && e.runId !== entry.runId).sort(byAge)[0] ||
        others.filter((e) => e.kind !== 'auto').sort(byAge)[0] ||
        others.filter((e) => e.runId !== entry.runId).sort(byAge)[0];
      if (!victim) return false;
      store.del(PREFIX + victim.id);
      list = list.filter((e) => e.id !== victim.id);
      writeIndex(list);
    }
    return false;
  }

  const Saves = {
    VERSION,
    // the one slot every run rewrites each month
    autosave(s, json) {
      return put(entryFor(s, runOf(s) + '-auto', 'auto'), json);
    },
    manual(s, json) {
      return put(entryFor(s, runOf(s) + '-manual', 'manual', 'Saved by hand'), json);
    },
    // tag: 'chapter' keyframes are kept; 'year' ones are trimmed to the last few
    keyframe(s, json, label, tag = 'year') {
      const e = entryFor(s, `${runOf(s)}-k${s.day}`, 'milestone', label);
      e.tag = tag;
      const ok = put(e, json);
      const years = readIndex()
        .filter((x) => x.runId === e.runId && x.kind === 'milestone' && x.tag !== 'chapter')
        .sort((a, b) => b.day - a.day);
      for (const old of years.slice(YEARS_KEPT)) Saves.remove(old.id);
      return ok;
    },
    // newest first, with run groups in the order of their newest save
    list() {
      return readIndex().sort((a, b) => b.day - a.day || byAge(b, a));
    },
    groups() {
      const list = readIndex();
      const runs = new Map();
      for (const e of list) {
        if (!runs.has(e.runId)) runs.set(e.runId, []);
        runs.get(e.runId).push(e);
      }
      const newest = (items) => items.reduce((m, e) => (String(e.created) > m ? String(e.created) : m), '');
      return [...runs.values()]
        .map((items) => items.sort((a, b) => b.day - a.day || (a.kind === 'auto' ? -1 : 1)))
        .sort((a, b) => newest(b).localeCompare(newest(a)));
    },
    latest() {
      const list = readIndex().sort(byAge);
      return list.length ? list[list.length - 1] : null;
    },
    read(id) {
      return store.get(PREFIX + id);
    },
    remove(id) {
      store.del(PREFIX + id);
      writeIndex(readIndex().filter((e) => e.id !== id));
    },
    // bring the pre-v0.3 single save into the slot list once
    migrateLegacy() {
      const raw = store.get(LEGACY);
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (s && typeof s === 'object' && Array.isArray(s.items) && Saves.autosave(s, raw)) store.del(LEGACY);
      } catch (e) {
        /* unreadable: leave it alone */
      }
    },
  };

  AIT.Saves = Saves;
})(typeof window !== 'undefined' ? window : globalThis);
