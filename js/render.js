/* Isometric office renderer and canvas input (place, sell, select, pan, zoom). */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});
  const D = AIT.DATA;
  const TW = 64, TH = 32, WALL_H = 86, SLAB = 14;

  const R = (AIT.Render = { cam: { x: 0, y: 0, z: 1 }, hover: null, tool: null, selected: null });

  let cv, ctx, dpr = 1, W = 0, H = 0, cb = {}, bgPattern = null, lastSize = 0;
  let particles = [];

  // ---------- color helpers ----------
  const shadeCache = new Map();
  function mix(hex, amt) {
    const key = hex + amt;
    let out = shadeCache.get(key);
    if (out) return out;
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round(r + (t - r) * p);
    g = Math.round(g + (t - g) * p);
    b = Math.round(b + (t - b) * p);
    out = `rgb(${r},${g},${b})`;
    shadeCache.set(key, out);
    return out;
  }
  const hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967295;
  };

  // ---------- geometry ----------
  const P = (cx, cy, u, v, z) => [cx + ((u - v) * TW) / 2, cy + ((u + v) * TH) / 2 - z];
  const tileCenter = (gx, gy) => [((gx - gy) * TW) / 2, ((gx + gy) * TH) / 2 + TH / 2];

  function poly(pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  // A box with footprint a x b (tile units) centered at (u0, v0), height h, lifted by z0.
  function prism(cx, cy, u0, v0, a, b, h, z0, col, topCol) {
    const u1 = u0 - a / 2, u2 = u0 + a / 2, v1 = v0 - b / 2, v2 = v0 + b / 2;
    const L = P(cx, cy, u1, v2, z0), F = P(cx, cy, u2, v2, z0), Rr = P(cx, cy, u2, v1, z0);
    const Lt = P(cx, cy, u1, v2, z0 + h), Ft = P(cx, cy, u2, v2, z0 + h), Rt = P(cx, cy, u2, v1, z0 + h), Bt = P(cx, cy, u1, v1, z0 + h);
    poly([L, F, Ft, Lt], mix(col, -0.02));
    poly([F, Rr, Rt, Ft], mix(col, -0.22));
    poly([Bt, Rt, Ft, Lt], topCol || mix(col, 0.16));
    return { u1, u2, v1, v2, z0, h };
  }
  // point on the left (front-left) face: s in 0..1 along u, z height above base
  const onL = (cx, cy, pr, s, z) => P(cx, cy, pr.u1 + (pr.u2 - pr.u1) * s, pr.v2, pr.z0 + z);
  // point on the right (front-right) face: s in 0..1 along v (front to back)
  const onR = (cx, cy, pr, s, z) => P(cx, cy, pr.u2, pr.v2 - (pr.v2 - pr.v1) * s, pr.z0 + z);
  const onTop = (cx, cy, pr, su, sv) => P(cx, cy, pr.u1 + (pr.u2 - pr.u1) * su, pr.v1 + (pr.v2 - pr.v1) * sv, pr.z0 + pr.h);

  function dot(x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function cyl(cx, cy, u0, v0, r, h, z0, col) {
    const [x, y] = P(cx, cy, u0, v0, z0);
    const rx = r * TW * 0.7, ry = rx * 0.5;
    const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
    g.addColorStop(0, mix(col, 0.05));
    g.addColorStop(0.6, mix(col, -0.1));
    g.addColorStop(1, mix(col, -0.3));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(x - rx, y - h);
    ctx.ellipse(x, y - h, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mix(col, 0.2);
    ctx.beginPath();
    ctx.ellipse(x, y - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    return { x, y: y - h, rx, ry };
  }

  function fanBlades(x, y, rx, ry, t, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const a = t * 9 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * rx * 0.85, y + Math.sin(a) * ry * 0.85);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // ---------- people ----------
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#9b6440', '#6f4428'];
  const HAIR = ['#2a211c', '#4a3223', '#8a5a2b', '#c9a15a', '#1d1d24', '#a8432d', '#d8d3cc'];

  function person(x, y, shirt, id, t, busy) {
    const h1 = hash(id), h2 = hash(id + 'h');
    if (t < life.celebrateUntil) y -= Math.abs(Math.sin(t * 9 + h1 * 5)) * 7;
    const bob = Math.sin(t * (busy ? 5 : 2) + h1 * 10) * (busy ? 0.6 : 0.9);
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(x, y - 10, 7, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(shirt, -0.25);
    ctx.beginPath();
    ctx.ellipse(x + 2.5, y - 9, 4, 8, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    dot(x, y - 23 + bob, 5.4, SKIN[Math.floor(h1 * SKIN.length)]);
    ctx.fillStyle = HAIR[Math.floor(h2 * HAIR.length)];
    ctx.beginPath();
    ctx.arc(x, y - 24.2 + bob, 5.6, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
  }

  // ---------- item art ----------
  const LED_ON = { train: '#ff8a3d', serve: '#3fc6ff', idle: '#6fe39b', hot: '#ff4d4d' };

  function ledRows(cx, cy, pr, rows, cols, t, seed, mode, face = 'L', margin = 0.12) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = margin + ((1 - margin * 2) * (c + 0.5)) / cols;
        const z = pr.h * (0.15 + (0.75 * (r + 0.5)) / rows);
        const [x, y] = face === 'L' ? onL(cx, cy, pr, s, z) : onR(cx, cy, pr, s, z);
        const on = Math.sin(t * (3 + ((r * 7 + c * 13 + seed) % 5)) + r * 1.7 + c * 2.3 + seed) > -0.2;
        dot(x, y, 1.1, on ? LED_ON[mode] : '#2c333c');
      }
    }
  }

  const ART = {
    desk(cx, cy, it, t, ctxInfo) {
      const p = ctxInfo.deskStaff.get(it.id);
      if (p && !(ctxInfo.walking && ctxInfo.walking.has(p.id))) {
        const [px, py] = P(cx, cy, -0.05, -0.38, 0);
        person(px, py, p.founder ? '#ef5f24' : D.ROLES[p.role].color, p.id, t, !!ctxInfo.training);
      }
      const d = prism(cx, cy, 0, 0.05, 0.86, 0.5, 13, 0, '#b8895c', '#d3a677');
      // monitor (we see its back)
      prism(cx, cy, 0.02, -0.08, 0.36, 0.06, 13, 13, '#2b3038');
      const [mx, my] = P(cx, cy, 0.02, -0.11, 25.5);
      ctx.fillStyle = p ? 'rgba(120,200,255,0.55)' : 'rgba(120,140,160,0.35)';
      ctx.fillRect(mx - 7, my - 1, 14, 1.5);
      // mug
      const [gx, gy] = onTop(cx, cy, d, 0.82, 0.7);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(gx - 1.8, gy - 4, 3.6, 4);
    },
    whiteboard(cx, cy, it, t) {
      prism(cx, cy, -0.3, 0, 0.05, 0.05, 8, 0, '#8f959c');
      prism(cx, cy, 0.3, 0, 0.05, 0.05, 8, 0, '#8f959c');
      const pr = prism(cx, cy, 0, 0, 0.9, 0.06, 30, 8, '#c9ced3', '#dfe3e6');
      const pts = [[0.12, 0.7], [0.3, 0.55], [0.42, 0.62], [0.6, 0.35], [0.8, 0.28]];
      ctx.strokeStyle = '#3a6ea5';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      pts.forEach(([s, z], i) => {
        const [x, y] = onL(cx, cy, pr, s, z * pr.h);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = '#cf3f35';
      ctx.beginPath();
      const [a1, b1] = onL(cx, cy, pr, 0.15, pr.h * 0.3), [a2, b2] = onL(cx, cy, pr, 0.45, pr.h * 0.3);
      ctx.moveTo(a1, b1);
      ctx.lineTo(a2, b2);
      ctx.stroke();
      ctx.lineWidth = 1;
    },
    rig(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.36, 0.52, 30, 0, '#23272f');
      const hue = (t * 40 + it.id * 50) % 360;
      const a = onR(cx, cy, pr, 0.15, 6), b = onR(cx, cy, pr, 0.85, 6), c = onR(cx, cy, pr, 0.85, 26), d = onR(cx, cy, pr, 0.15, 26);
      poly([a, b, c, d], `hsla(${hue},85%,60%,${info.mode === 'idle' ? 0.35 : 0.75})`);
      ledRows(cx, cy, pr, 1, 2, t, it.id, info.mode);
    },
    workstation(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.5, 0.62, 34, 0, '#3b414b');
      ledRows(cx, cy, pr, 4, 2, t, it.id, info.mode);
      const a = onR(cx, cy, pr, 0.2, 8), b = onR(cx, cy, pr, 0.8, 8), c = onR(cx, cy, pr, 0.8, 28), d = onR(cx, cy, pr, 0.2, 28);
      poly([a, b, c, d], '#2a2f37');
    },
    server(cx, cy, it, t, info) {
      prism(cx, cy, 0, 0, 0.82, 0.82, 4, 0, '#2f343c');
      const pr = prism(cx, cy, 0, 0, 0.8, 0.8, 24, 4, '#56606b');
      ledRows(cx, cy, pr, 3, 6, t, it.id, info.mode);
      ledRows(cx, cy, pr, 3, 6, t, it.id + 3, info.mode, 'R');
    },
    rack(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.84, 0.84, 64, 0, '#1f242c');
      ledRows(cx, cy, pr, 9, 5, t, it.id, info.mode);
      ledRows(cx, cy, pr, 9, 3, t, it.id + 7, info.mode, 'R', 0.2);
    },
    superpod(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.9, 0.9, 74, 0, '#15181e');
      ledRows(cx, cy, pr, 10, 6, t, it.id, info.mode);
      const glow = 0.55 + 0.35 * Math.sin(t * 2 + it.id);
      const a = onTop(cx, cy, pr, 0.1, 0.1), b = onTop(cx, cy, pr, 0.9, 0.1), c = onTop(cx, cy, pr, 0.9, 0.9), d = onTop(cx, cy, pr, 0.1, 0.9);
      poly([a, b, c, d], `rgba(239,95,36,${glow})`);
      const l1 = onL(cx, cy, pr, 0, pr.h - 4), l2 = onL(cx, cy, pr, 1, pr.h - 4), r2 = onR(cx, cy, pr, 1, pr.h - 4);
      ctx.strokeStyle = `rgba(255,138,61,${glow})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l1[0], l1[1]);
      ctx.lineTo(l2[0], l2[1]);
      ctx.lineTo(r2[0], r2[1]);
      ctx.stroke();
      ctx.lineWidth = 1;
    },
    wafer(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.92, 0.92, 26, 0, '#2a2e35');
      ledRows(cx, cy, pr, 2, 8, t, it.id, info.mode);
      const chip = prism(cx, cy, 0, 0, 0.62, 0.62, 5, 26, '#39414c');
      const a = onTop(cx, cy, chip, 0, 0), b = onTop(cx, cy, chip, 1, 0), c = onTop(cx, cy, chip, 1, 1), d = onTop(cx, cy, chip, 0, 1);
      const g = ctx.createLinearGradient(d[0], d[1], b[0], b[1]);
      const sh = (t * 30 + it.id * 40) % 360;
      g.addColorStop(0, `hsl(${sh},60%,55%)`);
      g.addColorStop(0.5, `hsl(${(sh + 60) % 360},70%,65%)`);
      g.addColorStop(1, `hsl(${(sh + 120) % 360},60%,50%)`);
      poly([a, b, c, d], g);
      ctx.strokeStyle = 'rgba(20,24,30,0.35)';
      for (let i = 1; i < 4; i++) {
        const p1 = onTop(cx, cy, chip, i / 4, 0), p2 = onTop(cx, cy, chip, i / 4, 1), q1 = onTop(cx, cy, chip, 0, i / 4), q2 = onTop(cx, cy, chip, 1, i / 4);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.moveTo(q1[0], q1[1]);
        ctx.lineTo(q2[0], q2[1]);
        ctx.stroke();
      }
    },
    fan(cx, cy, it, t) {
      prism(cx, cy, 0, 0, 0.3, 0.3, 3, 0, '#8d949b');
      const [x, y] = P(cx, cy, 0, 0, 3);
      ctx.strokeStyle = '#8d949b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 16);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#e9ecef';
      ctx.beginPath();
      ctx.ellipse(x, y - 24, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9aa2aa';
      ctx.stroke();
      fanBlades(x, y - 24, 7, 8, t, '#7b848d');
    },
    ac(cx, cy, it, t) {
      const pr = prism(cx, cy, 0, 0, 0.7, 0.48, 20, 0, '#e3e8eb');
      ctx.strokeStyle = '#b3bcc3';
      for (let i = 1; i < 5; i++) {
        const a = onL(cx, cy, pr, 0.1, (pr.h * i) / 5), b = onL(cx, cy, pr, 0.9, (pr.h * i) / 5);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      const [x, y] = onTop(cx, cy, pr, 0.5, 0.5);
      ctx.fillStyle = '#9fb0bb';
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      fanBlades(x, y, 7, 3.5, t, '#5d6b75');
    },
    chiller(cx, cy, it, t) {
      const pr = prism(cx, cy, 0, 0, 0.88, 0.88, 26, 0, '#d6e1e7');
      for (const [su, sv] of [[0.3, 0.3], [0.7, 0.7]]) {
        const [x, y] = onTop(cx, cy, pr, su, sv);
        ctx.fillStyle = '#6f8796';
        ctx.beginPath();
        ctx.ellipse(x, y, 9, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        fanBlades(x, y, 8, 4, t * 1.3, '#c6d3da');
      }
      ctx.strokeStyle = '#a9bac4';
      for (let i = 1; i < 6; i++) {
        const a = onL(cx, cy, pr, i / 6, 3), b = onL(cx, cy, pr, i / 6, pr.h - 3);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    },
    liquid(cx, cy, it, t) {
      prism(cx, cy, 0, 0, 0.9, 0.9, 4, 0, '#4d5a66');
      cyl(cx, cy, -0.18, -0.18, 0.2, 34, 4, '#3f8fc0');
      cyl(cx, cy, 0.2, 0.2, 0.2, 30, 4, '#3f8fc0');
      const [x1, y1] = P(cx, cy, -0.18, -0.18, 24), [x2, y2] = P(cx, cy, 0.2, 0.2, 20);
      ctx.strokeStyle = '#9fd6f2';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.lineWidth = 1;
      const f = (t * 0.8 + it.id * 0.3) % 1;
      dot(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 1.6, '#e6f7ff');
    },
    immersion(cx, cy, it, t) {
      const pr = prism(cx, cy, 0, 0, 0.94, 0.94, 22, 0, '#2d3a45');
      const a = onTop(cx, cy, pr, 0.08, 0.08), b = onTop(cx, cy, pr, 0.92, 0.08), c = onTop(cx, cy, pr, 0.92, 0.92), d = onTop(cx, cy, pr, 0.08, 0.92);
      poly([a, b, c, d], '#57c7e3');
      for (let i = 0; i < 3; i++) {
        const [x, y] = onTop(cx, cy, pr, 0.3 + i * 0.2, 0.5 + 0.2 * Math.sin(t + i));
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.ellipse(x, y, 4 + ((t * 3 + i) % 3), 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    battery(cx, cy, it) {
      const pr = prism(cx, cy, 0, 0, 0.62, 0.5, 38, 0, '#5d6d62');
      for (let i = 0; i < 4; i++) {
        const a = onL(cx, cy, pr, 0.2, 6 + i * 7), b = onL(cx, cy, pr, 0.8, 6 + i * 7);
        ctx.strokeStyle = i < 3 ? '#8fe0a0' : '#44534a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    },
    substation(cx, cy, it) {
      const base = prism(cx, cy, 0, 0, 0.92, 0.92, 6, 0, '#9aa1a8');
      const a = onL(cx, cy, base, 0, 3), b = onL(cx, cy, base, 1, 3);
      ctx.strokeStyle = '#e9b21b';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      const tr = prism(cx, cy, -0.15, -0.1, 0.4, 0.4, 22, 6, '#6c7680');
      for (let i = 0; i < 4; i++) {
        const p1 = onL(cx, cy, tr, 0.15 + i * 0.23, 3), p2 = onL(cx, cy, tr, 0.15 + i * 0.23, tr.h - 3);
        ctx.strokeStyle = '#4f5861';
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }
      cyl(cx, cy, 0.25, 0.22, 0.07, 26, 6, '#c6ccd2');
      cyl(cx, cy, 0.25, -0.1, 0.07, 26, 6, '#c6ccd2');
    },
    turbine(cx, cy, it, t) {
      prism(cx, cy, 0, 0, 0.92, 0.92, 5, 0, '#7d858d');
      cyl(cx, cy, 0.05, 0.05, 0.34, 30, 5, '#b7bec5');
      const top = cyl(cx, cy, -0.22, -0.22, 0.09, 48, 5, '#8d959d');
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + i / 3) % 1;
        ctx.fillStyle = `rgba(230,233,236,${0.5 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(top.x + k * 6, top.y - 6 - k * 22, 4 + k * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    smr(cx, cy, it, t) {
      prism(cx, cy, 0, 0, 0.94, 0.94, 6, 0, '#8a9299');
      const c = cyl(cx, cy, 0, 0, 0.38, 26, 6, '#eef1f3');
      ctx.fillStyle = '#e1e6ea';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.rx * 0.8, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = `rgba(63,198,255,${0.5 + 0.4 * Math.sin(t * 2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 10, c.rx * 0.98, c.ry * 0.98, 0, 0, Math.PI);
      ctx.stroke();
      ctx.lineWidth = 1;
    },
    plant(cx, cy, it, t) {
      prism(cx, cy, 0, 0, 0.3, 0.3, 11, 0, '#c1683f');
      const [x, y] = P(cx, cy, 0, 0, 11);
      const sway = Math.sin(t * 1.3 + it.id) * 1.2;
      for (const [dx, dy, r, c] of [[-5, -8, 6.5, '#3f8f5f'], [5, -9, 6, '#4aa36c'], [0, -15, 7, '#57b279'], [sway, -21, 5, '#6cc28b']]) dot(x + dx + sway * 0.4, y + dy, r, c);
    },
    coffee(cx, cy, it, t) {
      const pr = prism(cx, cy, 0, 0, 0.36, 0.32, 20, 0, '#c9cfd4');
      const a = onL(cx, cy, pr, 0.2, 4), b = onL(cx, cy, pr, 0.8, 4), c = onL(cx, cy, pr, 0.8, 14), d = onL(cx, cy, pr, 0.2, 14);
      poly([a, b, c, d], '#2b3038');
      const [x, y] = onTop(cx, cy, pr, 0.5, 0.5);
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.5 + i * 0.5 + it.id * 0.1) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(x + Math.sin(k * 6 + i) * 2, y - 4 - k * 14, 2 + k * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    couch(cx, cy) {
      prism(cx, cy, 0, 0.05, 0.9, 0.46, 8, 0, '#4f6d8f');
      prism(cx, cy, 0, -0.2, 0.9, 0.12, 12, 8, '#45617f');
      prism(cx, cy, -0.4, 0.02, 0.1, 0.5, 8, 8, '#45617f');
      prism(cx, cy, 0.4, 0.02, 0.1, 0.5, 8, 8, '#45617f');
    },
    arcade(cx, cy, it, t) {
      const pr = prism(cx, cy, 0, 0, 0.46, 0.46, 42, 0, '#5a3c8c');
      const a = onL(cx, cy, pr, 0.15, 22), b = onL(cx, cy, pr, 0.85, 22), c = onL(cx, cy, pr, 0.85, 36), d = onL(cx, cy, pr, 0.15, 36);
      poly([a, b, c, d], `hsl(${(t * 60) % 360},70%,55%)`);
      const [x, y] = onL(cx, cy, pr, 0.4, 16);
      dot(x, y, 1.6, '#ff4d6d');
      dot(x + 5, y - 2, 1.6, '#ffd23f');
    },
    nap_pod(cx, cy) {
      const pr = prism(cx, cy, 0, 0, 0.9, 0.5, 6, 0, '#b9c1c8');
      const [x, y] = onTop(cx, cy, pr, 0.5, 0.5);
      ctx.fillStyle = '#f2f4f5';
      ctx.beginPath();
      ctx.ellipse(x, y - 8, 22, 12, -0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#34495e';
      ctx.beginPath();
      ctx.ellipse(x - 6, y - 10, 9, 5.5, -0.46, 0, Math.PI * 2);
      ctx.fill();
    },
  };


  // ---------- office life: people walk, talk and celebrate ----------
  const life = { walkers: new Map(), nextWalk: 3, nextQuip: 4, bubbles: [], celebrateUntil: 0, confetti: [], wantCelebrate: false };
  const HANGOUT = {
    coffee: 'break', couch: 'break', arcade: 'break', nap_pod: 'break', plant: 'break',
    whiteboard: 'researcher', rig: 'engineer', workstation: 'engineer', server: 'engineer', rack: 'engineer', superpod: 'engineer', wafer: 'engineer',
  };
  const WALK_SPEED = 1.6; // tiles per second
  const quips = () => AIT.FLAVOR.QUIPS;
  const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function shirtOf(p) {
    return p.founder ? '#ef5f24' : D.ROLES[p.role].color;
  }

  function findPath(N, blocked, start, goals) {
    const key = (x, y) => x + ',' + y;
    const prev = new Map([[key(start[0], start[1]), null]]);
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (goals.has(key(cur[0], cur[1]))) {
        const path = [];
        for (let c = cur; c; c = prev.get(key(c[0], c[1]))) path.unshift(c);
        return path;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur[0] + dx, ny = cur[1] + dy, k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || prev.has(k) || blocked.has(k)) continue;
        prev.set(k, cur);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  const freeNeighbors = (N, blocked, x, y) =>
    [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !blocked.has(a + ',' + b));

  function startWalk(s, N, desk, p) {
    const blocked = new Set(s.items.map((i) => i.x + ',' + i.y));
    const home = freeNeighbors(N, blocked, desk.x, desk.y)[0];
    if (!home) return;
    const want = p.founder ? 'break' : p.role;
    const spots = s.items.filter((i) => HANGOUT[i.type] === 'break' || HANGOUT[i.type] === want);
    if (!spots.length) return;
    const target = pickOne(spots);
    const goals = new Set(freeNeighbors(N, blocked, target.x, target.y).map(([a, b]) => a + ',' + b));
    if (!goals.size) return;
    const path = findPath(N, blocked, home, goals);
    if (!path) return;
    const seat = [desk.x + 0.5, desk.y + 0.12];
    const pts = [seat].concat(path.map(([a, b]) => [a + 0.5, b + 0.5]));
    const say = HANGOUT[target.type] === 'break' ? pickOne(quips().break) : pickOne(quips()[want] || quips().break);
    life.walkers.set(p.id, { id: p.id, deskId: desk.id, shirt: shirtOf(p), pts, seg: 0, k: 0, phase: 'out', hang: 0, say });
  }

  function walkerPos(w) {
    const a = w.pts[w.seg], b = w.pts[Math.min(w.seg + 1, w.pts.length - 1)];
    return [a[0] + (b[0] - a[0]) * w.k, a[1] + (b[1] - a[1]) * w.k];
  }

  function updateLife(t, dt, s, v, running, N, desks, deskStaff) {
    if (life.wantCelebrate) {
      life.wantCelebrate = false;
      life.celebrateUntil = t + 2.4;
      spawnConfetti(N);
      const people = s.staff.slice().sort(() => Math.random() - 0.5).slice(0, 2);
      people.forEach((p, i) => life.bubbles.push({ who: p.id, text: pickOne(quips().celebrate), until: t + 2.6 + i * 0.4 }));
    }
    // drop walkers whose desk or person is gone
    for (const [id, w] of life.walkers) {
      const d = desks.find((x) => x.id === w.deskId);
      if (!d || !deskStaff.get(d.id) || deskStaff.get(d.id).id !== id) life.walkers.delete(id);
    }
    if (!running) return;
    for (const w of life.walkers.values()) {
      if (w.phase === 'hang') {
        w.hang -= dt;
        if (w.hang <= 0) {
          w.pts = w.pts.slice().reverse();
          w.seg = 0;
          w.k = 0;
          w.phase = 'back';
        }
        continue;
      }
      const a = w.pts[w.seg], b = w.pts[w.seg + 1];
      if (!b) {
        if (w.phase === 'out') {
          w.phase = 'hang';
          w.hang = 2.5 + Math.random() * 2.5;
          life.bubbles.push({ who: w.id, text: w.say, until: t + 2.6 });
        } else life.walkers.delete(w.id);
        continue;
      }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.01;
      w.k += (WALK_SPEED * dt) / len;
      while (w.k >= 1 && w.pts[w.seg + 1]) {
        w.k -= 1;
        w.seg++;
        if (!w.pts[w.seg + 1]) {
          w.k = 0;
          break;
        }
      }
    }
    // somebody gets up now and then
    life.nextWalk -= dt;
    const seated = desks.filter((d) => deskStaff.get(d.id) && !life.walkers.has(deskStaff.get(d.id).id));
    if (life.nextWalk <= 0 && seated.length && life.walkers.size < Math.max(1, Math.floor(s.staff.length / 4))) {
      life.nextWalk = 3 + Math.random() * 5;
      const d = pickOne(seated);
      startWalk(s, N, d, deskStaff.get(d.id));
    }
    // and somebody says something
    life.nextQuip -= dt;
    if (life.nextQuip <= 0 && seated.length && life.bubbles.length < 2) {
      life.nextQuip = 5 + Math.random() * 5;
      const d = pickOne(seated);
      life.bubbles.push({ who: deskStaff.get(d.id).id, text: chooseQuip(s, v, deskStaff.get(d.id)), until: t + 3.2 });
    }
  }

  function chooseQuip(s, v, p) {
    const Q = quips();
    const pools = [p.founder ? Q.founder : Q[p.role], p.founder ? Q.founder : Q[p.role]];
    if (v.thermal < 1) pools.push(Q.hot, Q.hot, Q.hot);
    if (s.cash < 0) pools.push(Q.broke, Q.broke, Q.broke);
    if (v.flagship && v.service < 0.85) pools.push(Q.capacity, Q.capacity);
    if (s.training) pools.push(Q.training, Q.training);
    if (!s.models.length) pools.push(Q.nomodel);
    if (v.flagship) pools.push(Q.live);
    if (v.flagship && v.topRival) pools.push(v.flagship.cap > v.topRival.cap ? Q.ahead : Q.behind);
    return pickOne(pickOne(pools));
  }

  function drawWalker(w, t) {
    const [wx, wy] = walkerPos(w);
    const [x, y] = P(0, 0, wx, wy, 0);
    const moving = w.phase !== 'hang';
    const stride = moving ? Math.sin(t * 12 + hash(w.id) * 6) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d3440';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 2.2, y - 9);
    ctx.lineTo(x - 2.2 - stride * 2.6, y - 1);
    ctx.moveTo(x + 2.2, y - 9);
    ctx.lineTo(x + 2.2 + stride * 2.6, y - 1);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    person(x, y - 7, w.shirt, w.id, t, false);
  }

  function headOf(id, desks, deskStaff) {
    const w = life.walkers.get(id);
    if (w) {
      const [wx, wy] = walkerPos(w);
      const [x, y] = P(0, 0, wx, wy, 0);
      return [x, y - 40];
    }
    const d = desks.find((k) => deskStaff.get(k.id) && deskStaff.get(k.id).id === id);
    if (!d) return null;
    const [cx, cy] = tileCenter(d.x, d.y);
    const [x, y] = P(cx, cy, -0.05, -0.38, 0);
    return [x, y - 32];
  }

  function wrap(text, max) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > max && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBubbles(t, desks, deskStaff) {
    life.bubbles = life.bubbles.filter((b) => b.until > t);
    ctx.font = '700 11px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of life.bubbles) {
      const at = headOf(b.who, desks, deskStaff);
      if (!at) continue;
      const lines = wrap(b.text, 130);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const h = lines.length * 14 + 10;
      const fade = Math.min(1, (b.until - t) * 3);
      const [x, y] = at;
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(28,35,44,0.18)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h - 7, w, h, 8);
      else ctx.rect(x - w / 2, y - h - 7, w, h);
      ctx.moveTo(x - 5, y - 7);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 5, y - 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1c232c';
      lines.forEach((l, i) => ctx.fillText(l, x, y - h - 7 + 12 + i * 14));
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  const CONFETTI = ['#ef5f24', '#ffb000', '#2e9b67', '#4a63d8', '#d0469a', '#3fc6ff'];
  function spawnConfetti(N) {
    for (let i = 0; i < 90; i++) {
      const [x, y] = P(0, 0, Math.random() * N, Math.random() * N, 0);
      life.confetti.push({ x, y: y - 120 - Math.random() * 80, vx: (Math.random() - 0.5) * 40, vy: Math.random() * 30, r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, c: pickOne(CONFETTI), life: 0, max: 2.2 + Math.random() });
    }
  }

  function drawConfetti(t, dt) {
    for (const c of life.confetti) {
      c.life += dt;
      c.vy += 160 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.r += c.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - c.life / c.max);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.r);
      ctx.fillStyle = c.c;
      ctx.fillRect(-3, -1.5, 6, 3);
      ctx.restore();
    }
    life.confetti = life.confetti.filter((c) => c.life < c.max);
  }

  R.lifeStats = () => ({ walkers: life.walkers.size, bubbles: life.bubbles.length });

  R.celebrate = function () {
    life.wantCelebrate = true;
  };

  // ---------- office shell ----------
  function drawSlab(N, office) {
    const e = N;
    const back = P(0, 0, 0, 0, 0), right = P(0, 0, e, 0, 0), front = P(0, 0, e, e, 0), left = P(0, 0, 0, e, 0);
    ctx.save();
    ctx.shadowColor = 'rgba(40,52,64,0.22)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    poly([back, right, front, left], office.floorB);
    ctx.restore();
    poly([left, front, [front[0], front[1] + SLAB], [left[0], left[1] + SLAB]], mix(office.trim, 0.1));
    poly([front, right, [right[0], right[1] + SLAB], [front[0], front[1] + SLAB]], mix(office.trim, -0.15));
  }

  function drawFloor(N, office) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const a = P(0, 0, x, y, 0), b = P(0, 0, x + 1, y, 0), c = P(0, 0, x + 1, y + 1, 0), d = P(0, 0, x, y + 1, 0);
        poly([a, b, c, d], (x + y) % 2 ? office.floorA : office.floorB);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      let p = P(0, 0, i, 0, 0), q = P(0, 0, i, N, 0);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      p = P(0, 0, 0, i, 0);
      q = P(0, 0, N, i, 0);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
  }

  // quad on a back wall: axis 'x' runs along gy=0, 'y' along gx=0. s in tiles, z in px.
  function wallQuad(axis, s1, s2, z1, z2, fill) {
    const W1 = axis === 'x' ? P(0, 0, s1, 0, z1) : P(0, 0, 0, s1, z1);
    const W2 = axis === 'x' ? P(0, 0, s2, 0, z1) : P(0, 0, 0, s2, z1);
    const W3 = axis === 'x' ? P(0, 0, s2, 0, z2) : P(0, 0, 0, s2, z2);
    const W4 = axis === 'x' ? P(0, 0, s1, 0, z2) : P(0, 0, 0, s1, z2);
    poly([W1, W2, W3, W4], fill);
  }

  function drawWalls(N, office, level, company, t) {
    const h = WALL_H;
    wallQuad('y', 0, N, 0, h, office.wall);
    wallQuad('x', 0, N, 0, h, office.wallSide);
    // wall thickness: top caps and the two exposed ends
    const th = 0.16;
    poly([P(0, 0, 0, 0, h), P(0, 0, 0, N, h), P(0, 0, -th, N, h), P(0, 0, -th, -th, h)], office.trim);
    poly([P(0, 0, 0, 0, h), P(0, 0, N, 0, h), P(0, 0, N, -th, h), P(0, 0, -th, -th, h)], mix(office.trim, -0.1));
    poly([P(0, 0, -th, N, 0), P(0, 0, 0, N, 0), P(0, 0, 0, N, h), P(0, 0, -th, N, h)], mix(office.trim, 0.12));
    poly([P(0, 0, N, 0, 0), P(0, 0, N, -th, 0), P(0, 0, N, -th, h), P(0, 0, N, 0, h)], mix(office.trim, -0.2));
    // baseboards
    wallQuad('y', 0, N, 0, 4, mix(office.trim, 0.1));
    wallQuad('x', 0, N, 0, 4, mix(office.trim, -0.05));

    if (level === 0) {
      // garage door on the right wall, pegboard and window on the left
      wallQuad('x', N * 0.35, N * 0.9, 0, h * 0.78, '#e2ddd3');
      for (let i = 1; i < 8; i++) wallQuad('x', N * 0.35, N * 0.9, (h * 0.78 * i) / 8, (h * 0.78 * i) / 8 + 1.2, '#b8b2a6');
      wallQuad('y', N * 0.15, N * 0.45, h * 0.45, h * 0.8, '#9fc4d8');
      wallQuad('y', N * 0.6, N * 0.9, h * 0.3, h * 0.62, '#a78b64');
    } else if (level === 1) {
      for (let z = 8; z < h - 4; z += 8) {
        wallQuad('y', 0, N, z, z + 1, 'rgba(0,0,0,0.08)');
        wallQuad('x', 0, N, z, z + 1, 'rgba(0,0,0,0.08)');
      }
      for (let i = 0; i < 3; i++) {
        const s = N * (0.12 + i * 0.3);
        wallQuad('y', s, s + N * 0.18, h * 0.25, h * 0.85, '#aac9d8');
        wallQuad('y', s + N * 0.085, s + N * 0.095, h * 0.25, h * 0.85, '#6b4a39');
      }
    } else if (level === 2 || level === 3) {
      const glass = level === 2 ? 'rgba(170,215,235,0.85)' : 'rgba(185,220,232,0.9)';
      for (let i = 0; i < N; i += 2) {
        wallQuad('y', i + 0.15, i + 1.85, h * 0.18, h * 0.9, glass);
        if (i < N * 0.45) wallQuad('x', i + 0.15, i + 1.85, h * 0.18, h * 0.9, glass);
      }
      if (level === 3) wallQuad('x', N * 0.55, N * 0.95, h * 0.2, h * 0.5, '#6f8a5e');
    } else {
      for (let i = 0; i < N; i += 1.5) {
        wallQuad('y', i, i + 0.08, 0, h, 'rgba(0,0,0,0.12)');
        wallQuad('x', i, i + 0.08, 0, h, 'rgba(0,0,0,0.12)');
      }
      const pulse = 0.4 + 0.3 * Math.sin(t * 1.5);
      wallQuad('y', 0, N, h * 0.9, h * 0.93, `rgba(239,95,36,${pulse})`);
      wallQuad('x', 0, N, h * 0.9, h * 0.93, `rgba(239,95,36,${pulse})`);
    }

    // company name on the right wall
    if (level >= 1) {
      const start = level === 3 ? N * 0.1 : N * 0.08;
      const [x0, y0] = P(0, 0, start, 0, level >= 2 ? h * 0.96 - 18 : h * 0.18);
      ctx.save();
      ctx.transform(0.894, 0.447, 0, 1, x0, y0);
      ctx.font = `700 ${level >= 3 ? 15 : 12}px Unbounded, "Arial Black", sans-serif`;
      ctx.fillStyle = level === 1 ? 'rgba(255,240,225,0.85)' : level === 4 ? '#f4f6f8' : '#24303b';
      ctx.textBaseline = 'top';
      ctx.fillText(company.toUpperCase(), 0, 0);
      ctx.restore();
    }
  }

  // ---------- background ----------
  function makePattern() {
    const c = document.createElement('canvas');
    c.width = c.height = 22 * dpr;
    const g = c.getContext('2d');
    g.fillStyle = '#cdd5da';
    g.beginPath();
    g.arc(11 * dpr, 11 * dpr, 1.1 * dpr, 0, Math.PI * 2);
    g.fill();
    bgPattern = ctx.createPattern(c, 'repeat');
  }

  // ---------- public API ----------
  R.init = function (canvas, callbacks) {
    cv = canvas;
    ctx = cv.getContext('2d');
    cb = callbacks;
    R.resize();
    bindInput();
  };

  R.resize = function () {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    makePattern();
    if (lastSize) R.fit(lastSize);
  };

  R.fit = function (N) {
    lastSize = N;
    const w = N * TW + 60, h = N * TH + WALL_H + SLAB + 60;
    const z = Math.max(0.3, Math.min(1.6, Math.min(W / w, H / h)));
    R.cam.z = z;
    R.cam.x = W / 2;
    R.cam.y = H / 2 - ((N * TH) / 2) * z + ((WALL_H - SLAB) / 2) * z;
  };

  R.zoomBy = function (f, sx = W / 2, sy = H / 2) {
    const c = R.cam;
    const nz = Math.max(0.25, Math.min(2.5, c.z * f));
    c.x = sx - ((sx - c.x) * nz) / c.z;
    c.y = sy - ((sy - c.y) * nz) / c.z;
    c.z = nz;
  };

  R.setTool = function (tool) {
    R.tool = tool;
    if (tool) R.selected = null;
  };

  R.float = function (gx, gy, text, color, big) {
    const [x, y] = tileCenter(gx, gy);
    particles.push({ x, y: y - 30, text, color, life: 0, max: big ? 1.8 : 1.3, big });
  };

  function screenToTile(mx, my) {
    const wx = (mx - R.cam.x) / R.cam.z, wy = (my - R.cam.y) / R.cam.z;
    const a = wy / (TH / 2), b = wx / (TW / 2);
    return { x: Math.floor((a + b) / 2), y: Math.floor((a - b) / 2) };
  }

  function itemAt(s, x, y) {
    return s.items.find((i) => i.x === x && i.y === y) || null;
  }

  // ---------- drawing ----------
  R.draw = function (t, dt, s, v, running) {
    if (!ctx) return;
    const office = D.OFFICES[s.officeLevel];
    const N = office.size;
    if (N !== lastSize) R.fit(N);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#dfe5e8';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = bgPattern;
    ctx.fillRect(0, 0, W, H);

    const z = R.cam.z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * R.cam.x, dpr * R.cam.y);
    drawSlab(N, office);
    drawFloor(N, office);
    drawWalls(N, office, s.officeLevel, s.company, t);

    const h = R.hover;
    const inside = h && h.x >= 0 && h.y >= 0 && h.x < N && h.y < N;
    const hoverItem = inside ? itemAt(s, h.x, h.y) : null;
    const tileFill = (x, y, fill, stroke) => {
      const pts = [P(0, 0, x, y, 0), P(0, 0, x + 1, y, 0), P(0, 0, x + 1, y + 1, 0), P(0, 0, x, y + 1, 0)];
      ctx.lineWidth = 2 / z;
      poly(pts, fill, stroke);
      ctx.lineWidth = 1;
    };
    if (R.selected) {
      const it = s.items.find((i) => i.id === R.selected);
      if (it) tileFill(it.x, it.y, 'rgba(239,95,36,0.18)', '#ef5f24');
      else R.selected = null;
    }
    let ghost = null;
    if (inside && R.tool && R.tool.mode === 'place') {
      const okTile = !hoverItem && !AIT.Sim.itemLocked(s, R.tool.type) && s.cash >= AIT.Sim.itemCost(s, R.tool.type);
      tileFill(h.x, h.y, okTile ? 'rgba(46,155,103,0.25)' : 'rgba(207,63,53,0.25)', okTile ? '#2e9b67' : '#cf3f35');
      if (!hoverItem) ghost = { id: -1, type: R.tool.type, x: h.x, y: h.y, ghost: true };
    } else if (inside && R.tool && R.tool.mode === 'sell') {
      tileFill(h.x, h.y, hoverItem ? 'rgba(207,63,53,0.28)' : 'rgba(0,0,0,0.05)', hoverItem ? '#cf3f35' : 'rgba(0,0,0,0.2)');
    } else if (inside && !R.tool) {
      tileFill(h.x, h.y, 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.8)');
    }

    // who sits where
    const desks = s.items.filter((i) => D.ITEMS[i.type].seats).sort((a, b) => a.id - b.id);
    const deskStaff = new Map();
    s.staff.forEach((p, i) => {
      if (desks[i]) deskStaff.set(desks[i].id, p);
    });
    const mode = v.thermal < 0.8 ? 'hot' : s.training && v.trainPF > 0 ? 'train' : v.flagship ? 'serve' : 'idle';
    const info = { deskStaff, training: !!s.training, mode };

    updateLife(t, dt, s, v, running, N, desks, deskStaff);
    info.walking = new Set(life.walkers.keys());
    const list = ghost ? s.items.concat([ghost]) : s.items;
    const drawables = list.map((it) => ({ it, k: it.x + it.y + 1, kx: it.x }));
    for (const w of life.walkers.values()) {
      const [wx, wy] = walkerPos(w);
      drawables.push({ w, k: wx + wy + 0.05, kx: wx });
    }
    drawables.sort((a, b) => a.k - b.k || a.kx - b.kx);
    const sorted = drawables;
    const hot = v.thermal < 1;
    const brown = v.powerFactor < 1;
    for (const d of sorted) {
      if (d.w) {
        drawWalker(d.w, t);
        continue;
      }
      const it = d.it;
      const [cx, cy] = tileCenter(it.x, it.y);
      const art = ART[it.type];
      if (!art) continue;
      ctx.save();
      if (it.ghost) ctx.globalAlpha = 0.55;
      else if (brown && D.ITEMS[it.type].cat === 'compute' && Math.sin(t * 20 + it.id) > 0.6) ctx.globalAlpha = 0.75;
      art(cx, cy, it, t, info);
      ctx.restore();
      if (hot && D.ITEMS[it.type].cat === 'compute' && !it.ghost) {
        const a = 0.25 + 0.2 * Math.sin(t * 4 + it.id);
        ctx.fillStyle = `rgba(255,70,50,${a})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 20, 20, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawConfetti(t, dt);
    drawBubbles(t, desks, deskStaff);

    for (const p of particles) {
      p.life += dt;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.font = `${p.big ? 700 : 600} ${p.big ? 15 : 11}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      const y = p.y - k * 28;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    particles = particles.filter((p) => p.life < p.max);
  };

  // item icons for the build menu
  const iconCache = {};
  R.icon = function (type) {
    if (iconCache[type]) return iconCache[type];
    const c = document.createElement('canvas');
    const S = 2;
    c.width = 76 * S;
    c.height = 76 * S;
    const prev = ctx;
    ctx = c.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const pts = [P(38, 52, -0.5, -0.5, 0), P(38, 52, 0.5, -0.5, 0), P(38, 52, 0.5, 0.5, 0), P(38, 52, -0.5, 0.5, 0)];
    poly(pts, 'rgba(28,35,44,0.07)');
    const dummy = { deskStaff: new Map(), training: false, mode: 'serve' };
    ART[type](38, 52, { id: 3, type, x: 0, y: 0 }, 1.2, dummy);
    iconCache[type] = c.toDataURL();
    ctx = prev;
    return iconCache[type];
  };


  // small picture of an office for chapter cards
  const previewCache = {};
  R.officePreview = function (level, company) {
    const key = level + '|' + company;
    if (previewCache[key]) return previewCache[key];
    const office = D.OFFICES[level], N = office.size;
    const PW = 440, PH = 220, S = 2;
    const c = document.createElement('canvas');
    c.width = PW * S;
    c.height = PH * S;
    const prev = ctx;
    ctx = c.getContext('2d');
    const z = Math.min(PW / (N * TW + 40), PH / (N * TH + WALL_H + SLAB + 30));
    ctx.setTransform(S * z, 0, 0, S * z, (S * PW) / 2, S * (PH / 2 - ((N * TH) / 2) * z + ((WALL_H - SLAB) / 2) * z));
    drawSlab(N, office);
    drawFloor(N, office);
    drawWalls(N, office, level, company, 1);
    const sig = ['rig', 'workstation', 'server', 'rack', 'wafer'][level];
    const props = [];
    const roles = ['researcher', 'engineer', 'growth', 'safety'];
    const staff = new Map();
    for (let y = 1; y < Math.max(2, Math.floor(N / 2)); y += 1) for (let x = Math.ceil(N / 2); x < N - 1; x++) props.push({ id: props.length + 1, type: sig, x, y });
    for (let y = Math.ceil(N / 2); y < N - 1; y += 2) {
      for (let x = 1; x < Math.floor(N / 2); x += 2) {
        const it = { id: 1000 + props.length, type: 'desk', x, y };
        staff.set(it.id, { id: 'pv' + it.id, role: roles[props.length % 4] });
        props.push(it);
      }
    }
    props.push({ id: 5000, type: 'plant', x: 0, y: N - 1 });
    if (level >= 1) props.push({ id: 5001, type: 'coffee', x: 0, y: Math.floor(N / 2) });
    const info = { deskStaff: staff, training: false, mode: 'serve' };
    props.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    for (const it of props) {
      const [cx, cy] = tileCenter(it.x, it.y);
      ART[it.type](cx, cy, it, 1.2, info);
    }
    previewCache[key] = c.toDataURL();
    ctx = prev;
    return previewCache[key];
  };

  // ---------- input ----------
  function bindInput() {
    const pointers = new Map();
    let down = null, pinch = null, lastPaint = null;

    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const tryPlace = (tile) => {
      const key = tile.x + ',' + tile.y;
      if (key === lastPaint) return;
      lastPaint = key;
      cb.place(tile.x, tile.y);
    };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: R.cam.z };
        down = null;
        return;
      }
      down = { ...p, cx: R.cam.x, cy: R.cam.y, moved: false, button: e.button, touch: e.pointerType !== 'mouse' };
      lastPaint = null;
      R.hover = screenToTile(p.x, p.y);
      if (R.tool && R.tool.mode === 'place' && !down.touch && e.button === 0) {
        down.painting = true;
        tryPlace(R.hover);
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        R.zoomBy((pinch.z * d) / pinch.d / R.cam.z, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      if (e.pointerType === 'mouse' || down) R.hover = screenToTile(p.x, p.y);
      if (!down) return;
      if (Math.hypot(p.x - down.x, p.y - down.y) > 6) down.moved = true;
      if (down.painting) {
        tryPlace(R.hover);
      } else if (down.moved) {
        R.cam.x = down.cx + (p.x - down.x);
        R.cam.y = down.cy + (p.y - down.y);
        cv.style.cursor = 'grabbing';
      }
    });

    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      cv.style.cursor = '';
      if (!down) return;
      const d = down;
      down = null;
      if (d.moved || d.painting) return;
      const tile = screenToTile(d.x, d.y);
      if (R.tool && R.tool.mode === 'place') cb.place(tile.x, tile.y);
      else if (R.tool && R.tool.mode === 'sell') cb.sell(tile.x, tile.y);
      else cb.select(tile.x, tile.y);
      if (d.touch) R.hover = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !down) R.hover = null;
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (R.tool && cb.cancel) cb.cancel();
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = pos(e);
        R.zoomBy(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      },
      { passive: false },
    );
  }
})(typeof window !== 'undefined' ? window : globalThis);
