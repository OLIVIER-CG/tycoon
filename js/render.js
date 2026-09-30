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
    out = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); // hex, so shades can be shaded again
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
        const on = Math.sin(t * (0.5 + ((r * 7 + c * 13 + seed) % 5) * 0.15) + r * 1.7 + c * 2.3 + seed) > -0.6;
        dot(x, y, 1.1, on ? LED_ON[mode] : '#2c333c');
      }
    }
  }

  function line(x1, y1, x2, y2, col, w) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // a polyline through points given as [u, v, z] in tile space
  function strokeUVZ(cx, cy, pts, col, w) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([u, v, z], i) => {
      const [x, y] = P(cx, cy, u, v, z);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  function ellipse(x, y, rx, ry, col, rot = 0) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  function steam(x, y, t, seed, n = 2, rise = 14) {
    for (let i = 0; i < n; i++) {
      const k = (t * 0.5 + i / n + seed * 0.1) % 1;
      ctx.fillStyle = `rgba(255,255,255,${(0.55 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(k * 6 + i) * 2, y - 3 - k * rise, 1.6 + k * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Standing desks: about half are raised, and whoever sits there stands.
  // per-item dice that stay put (item ids are small integers, which FNV spreads poorly)
  const idHash = (id, salt) => nh(((typeof id === 'number' ? id : Math.floor(hash(String(id)) * 1e9)) * 7919 + salt * 104729) | 0);
  const deskStands = (id) => idHash(id, 1) < 0.5;
  const STICKERS = ['#ef5f24', '#3fc6ff', '#ffd23f', '#6fe39b', '#d0469a'];

  // one bike parked along u at depth v, wheels in the u-z plane
  function bike(cx, cy, v, col, basket) {
    const R = 0.19, rz = 7;
    for (const hu of [-0.27, 0.27]) {
      const pts = [];
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        pts.push([hu + R * Math.cos(a), v, rz + rz * Math.sin(a)]);
      }
      strokeUVZ(cx, cy, pts, '#2a2e33', 1.8);
      const [hx, hy] = P(cx, cy, hu, v, rz);
      dot(hx, hy, 1, '#9aa3ab');
    }
    const rear = [-0.27, v, rz], bb = [-0.03, v, 6], seat = [-0.12, v, 18.5], head = [0.17, v, 18], front = [0.27, v, rz];
    strokeUVZ(cx, cy, [rear, bb, seat, rear], col, 1.6);
    strokeUVZ(cx, cy, [bb, head, seat], col, 1.6);
    strokeUVZ(cx, cy, [head, front], mix(col, -0.25), 1.4);
    strokeUVZ(cx, cy, [[-0.17, v, 20.5], [-0.07, v, 20.5]], '#2a2e33', 2.4);
    strokeUVZ(cx, cy, [[0.17, v - 0.08, 22], [0.16, v, 21.5], [0.17, v + 0.08, 22]], '#2a2e33', 1.5);
    if (basket) prism(cx, cy, 0.3, v, 0.13, 0.16, 6, 16, '#b88a4e', '#8f6534');
  }
  function staple(cx, cy, v) {
    const pts = [[-0.22, v, 0], [-0.22, v, 13]];
    for (let i = 1; i < 8; i++) {
      const a = Math.PI - (i / 8) * Math.PI;
      pts.push([0.22 * Math.cos(a), v, 13 + 5 * Math.sin(a)]);
    }
    pts.push([0.22, v, 13], [0.22, v, 0]);
    strokeUVZ(cx, cy, pts, '#8d959d', 2.6);
    strokeUVZ(cx, cy, pts, '#c9d0d6', 0.9);
  }

  // succulent rosette: rings of pointed leaves, outer ring first
  function rosette(x, y, R, seed) {
    const rings = [[R, 9, '#6f9f82', 0], [R * 0.74, 8, '#86b596', 2.2], [R * 0.5, 7, '#9fc9aa', 4.2], [R * 0.26, 5, '#bfe0c5', 5.6]];
    rings.forEach(([r, n, col, lift], ri) => {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + ri * 0.35 + seed;
        ctx.save();
        ctx.translate(x, y - lift);
        ctx.scale(1, 0.55);
        ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 0.5, -r * 0.34, r, 0);
        ctx.quadraticCurveTo(r * 0.5, r * 0.34, 0, 0);
        ctx.fill();
        ctx.strokeStyle = mix(col, -0.22);
        ctx.lineWidth = 0.6;
        ctx.stroke();
        if (ri === 0) {
          ctx.fillStyle = '#d98ba0';
          ctx.beginPath();
          ctx.arc(r * 0.92, 0, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
  }

  function beanbag(cx, cy, u, v, col, lean) {
    const [x, y] = P(cx, cy, u, v, 0);
    ellipse(x, y + 1, 13, 5.5, 'rgba(0,0,0,0.13)');
    const g = ctx.createRadialGradient(x - 4, y - 15, 1, x, y - 8, 17);
    g.addColorStop(0, mix(col, 0.3));
    g.addColorStop(0.55, col);
    g.addColorStop(1, mix(col, -0.28));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 1);
    ctx.bezierCurveTo(x - 15, y - 12, x - 8 + lean, y - 23, x + 1 + lean, y - 22);
    ctx.bezierCurveTo(x + 11 + lean, y - 21, x + 15, y - 11, x + 13, y - 1);
    ctx.bezierCurveTo(x + 9, y + 3.5, x - 9, y + 3.5, x - 13, y - 1);
    ctx.fill();
    ellipse(x - 2 - lean * 0.3, y - 9, 7.5, 3.4, mix(col, -0.2));
    ellipse(x - 2.5 - lean * 0.3, y - 10, 6, 2.2, mix(col, -0.08));
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x - 3 + lean, y - 13, 8, Math.PI * 1.1, Math.PI * 1.5);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  const ART = {
    desk(cx, cy, it, t, ctxInfo) {
      const stand = deskStands(it.id);
      const top = stand ? 22 : 13;
      const p = ctxInfo.deskStaff.get(it.id);
      if (p && !(ctxInfo.walking && ctxInfo.walking.has(p.id))) {
        const [px, py] = P(cx, cy, -0.05, -0.38, 0);
        const shirt = p.founder ? '#ef5f24' : D.ROLES[p.role].color;
        if (stand) {
          ctx.strokeStyle = '#2d3440';
          ctx.lineWidth = 2.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px - 2.2, py - 10);
          ctx.lineTo(px - 2.4, py - 1);
          ctx.moveTo(px + 2.2, py - 10);
          ctx.lineTo(px + 2.4, py - 1);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.lineCap = 'butt';
          person(px, py - 9, shirt, p.id, t, !!ctxInfo.training);
        } else person(px, py, shirt, p.id, t, !!ctxInfo.training);
      }
      // T-legs, a crossbar and a thin oak top
      const leg = '#3a3f47';
      for (const u of [-0.36, 0.36]) {
        prism(cx, cy, u, 0.05, 0.08, 0.46, 2, 0, leg);
        prism(cx, cy, u, 0.05, 0.06, 0.07, top - 2, 2, '#4a5059');
      }
      prism(cx, cy, 0, -0.02, 0.66, 0.05, 2.5, top - 5, leg);
      const d = prism(cx, cy, 0, 0.05, 0.9, 0.52, 2.6, top, '#c99f70', '#e6cda3');
      const [kx, ky] = onL(cx, cy, d, 0.8, 1.3);
      ctx.fillStyle = '#2b3038';
      ctx.fillRect(kx - 3, ky - 1.2, 6, 2.4);
      dot(kx + 1.5, ky, 0.7, '#3fc6ff');
      // monitor on a short stand (we see its back, with a sticker)
      prism(cx, cy, 0.02, -0.1, 0.05, 0.05, 4, top + 2.6, '#3a3f47');
      const mon = prism(cx, cy, 0.02, -0.1, 0.42, 0.05, 12, top + 6, '#2b3038');
      const sx = onL(cx, cy, mon, 0.3, 6.5);
      dot(sx[0], sx[1], 1.5, STICKERS[Math.floor(idHash(it.id, 2) * STICKERS.length)]);
      const g1 = P(cx, cy, mon.u1, mon.v1, mon.z0 + mon.h + 0.4), g2 = P(cx, cy, mon.u2, mon.v1, mon.z0 + mon.h + 0.4);
      line(g1[0], g1[1], g2[0], g2[1], p ? 'rgba(120,200,255,0.7)' : 'rgba(120,140,160,0.4)', 1.5);
      // reusable cup
      const [gx, gy] = onTop(cx, cy, d, 0.84, 0.72);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(gx - 1.8, gy - 4.5, 3.6, 4.5);
      ctx.fillStyle = '#e8743b';
      ctx.fillRect(gx - 1.8, gy - 3, 3.6, 1.3);
    },
    whiteboard(cx, cy, it, t) {
      const q = (s, z) => P(cx, cy, -0.42 + 0.84 * s, 0.02, z);
      for (const u of [-0.45, 0.45]) {
        prism(cx, cy, u, 0.02, 0.07, 0.36, 2, 0, '#8f979f');
        prism(cx, cy, u, 0.02, 0.035, 0.035, 44, 2, '#b7bec5');
      }
      const pane = [q(0, 12), q(1, 12), q(1, 43), q(0, 43)];
      poly(pane, 'rgba(208,234,242,0.5)', 'rgba(125,175,192,0.9)');
      // half-erased equations
      const scrib = (pts, col, w = 1.1) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        pts.forEach(([s, z], i) => {
          const [x, y] = q(s, 12 + z * 31);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      };
      scrib([[0.1, 0.72], [0.28, 0.56], [0.4, 0.64], [0.58, 0.36], [0.78, 0.3]], '#2f64a8');
      scrib([[0.12, 0.28], [0.44, 0.28]], '#cf3f35');
      scrib([[0.56, 0.78], [0.9, 0.78], [0.9, 0.58], [0.56, 0.58], [0.56, 0.78]], '#2e9b67', 0.9);
      scrib([[0.62, 0.7], [0.7, 0.66], [0.78, 0.7], [0.84, 0.66]], '#2e9b67', 0.8);
      scrib([[0.12, 0.88], [0.2, 0.84], [0.3, 0.88]], 'rgba(40,48,58,0.35)', 0.8);
      ctx.lineWidth = 1;
      poly([q(0.06, 12), q(0.14, 12), q(0.34, 43), q(0.26, 43)], 'rgba(255,255,255,0.38)');
      const ledge = prism(cx, cy, 0, 0.06, 0.8, 0.06, 1.5, 11, '#c6ccd2');
      ['#2f64a8', '#cf3f35', '#2e9b67'].forEach((c, i) => {
        const [x, y] = onTop(cx, cy, ledge, 0.2 + i * 0.12, 0.5);
        ctx.fillStyle = c;
        ctx.fillRect(x - 2.2, y - 1.4, 4.4, 1.6);
      });
    },
    rig(cx, cy, it, t, info) {
      const pr = prism(cx, cy, 0, 0, 0.36, 0.52, 30, 0, '#23272f');
      // a calm, steady screen: one hue, a touch lighter or darker per rig
      const a = onR(cx, cy, pr, 0.15, 6), b = onR(cx, cy, pr, 0.85, 6), c = onR(cx, cy, pr, 0.85, 26), d = onR(cx, cy, pr, 0.15, 26);
      poly([a, b, c, d], `hsla(193,42%,${50 + (it.id % 3) * 5}%,${info.mode === 'idle' ? 0.3 : 0.7})`);
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
      const sh = 196 + (it.id % 4) * 5;
      g.addColorStop(0, `hsl(${sh},35%,48%)`);
      g.addColorStop(0.5, `hsl(${sh + 12},40%,60%)`);
      g.addColorStop(1, `hsl(${sh},35%,44%)`);
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
    plant(cx, cy, it) {
      // succulent in a white pot on a little three-legged stand
      const [x0, y0] = P(cx, cy, 0, 0, 0);
      ctx.strokeStyle = '#9c6b43';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const [dx, dy] of [[-7, 1], [7, 1], [1, 5]]) {
        ctx.moveTo(x0 + dx * 0.45, y0 - 9);
        ctx.lineTo(x0 + dx, y0 + dy - 2);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
      ellipse(x0, y0 - 9, 8, 4, '#b98555');
      const pot = cyl(cx, cy, 0, 0, 0.17, 11, 9, '#ece7df');
      ctx.fillStyle = '#d8d1c6';
      ctx.fillRect(pot.x - pot.rx, pot.y + 5, pot.rx * 2, 1.4);
      ellipse(pot.x, pot.y, pot.rx * 0.84, pot.ry * 0.8, '#5b4636');
      rosette(pot.x, pot.y - 0.5, 14, it.id * 0.7);
    },
    bikes(cx, cy) {
      prism(cx, cy, 0, 0, 0.1, 0.9, 1.5, 0, '#7d858d');
      staple(cx, cy, -0.34);
      bike(cx, cy, -0.2, '#2a9d8f', false);
      staple(cx, cy, 0.06);
      bike(cx, cy, 0.2, '#e8743b', true);
    },
    coffee(cx, cy, it, t) {
      // walnut counter with a gooseneck kettle and two pour-over cones
      const pr = prism(cx, cy, 0, 0.06, 0.9, 0.5, 19, 0, '#6e4b38', '#e2cfb1');
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      for (let i = 1; i < 7; i++) {
        const a = onL(cx, cy, pr, i / 7, 2), b = onL(cx, cy, pr, i / 7, 17);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      // kettle
      const [kx, ky] = onTop(cx, cy, pr, 0.2, 0.55);
      ellipse(kx, ky, 5, 2.4, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = '#2d2f33';
      ctx.beginPath();
      ctx.moveTo(kx - 5, ky - 1);
      ctx.bezierCurveTo(kx - 5.5, ky - 8, kx - 3, ky - 10, kx, ky - 10);
      ctx.bezierCurveTo(kx + 3, ky - 10, kx + 5.5, ky - 8, kx + 5, ky - 1);
      ctx.closePath();
      ctx.fill();
      ellipse(kx, ky - 10, 3, 1.1, '#46494f');
      dot(kx, ky - 11.2, 0.9, '#8d949b');
      ctx.strokeStyle = '#2d2f33';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(kx - 4, ky - 3);
      ctx.bezierCurveTo(kx - 8, ky - 3, kx - 8, ky - 9, kx - 11, ky - 11);
      ctx.moveTo(kx + 4.6, ky - 8);
      ctx.bezierCurveTo(kx + 8.5, ky - 8, kx + 8.5, ky - 2, kx + 4.6, ky - 2.5);
      ctx.stroke();
      ctx.lineWidth = 1;
      steam(kx - 11, ky - 11, t, it.id, 2, 10);
      // drippers over glass carafes
      for (const [su, sv] of [[0.55, 0.38], [0.8, 0.62]]) {
        const [x, y] = onTop(cx, cy, pr, su, sv);
        ellipse(x, y, 4.2, 2, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = 'rgba(205,225,230,0.75)';
        ctx.fillRect(x - 3.4, y - 7, 6.8, 7);
        ctx.fillStyle = '#6b4630';
        ctx.fillRect(x - 3.4, y - 3, 6.8, 3);
        ellipse(x, y - 7, 3.4, 1.4, 'rgba(230,240,242,0.9)');
        ctx.fillStyle = '#f4f1ea';
        ctx.beginPath();
        ctx.moveTo(x - 1.6, y - 7.5);
        ctx.lineTo(x - 4.6, y - 14);
        ctx.lineTo(x + 4.6, y - 14);
        ctx.lineTo(x + 1.6, y - 7.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d9d3c7';
        ctx.fillRect(x + 1.8, y - 13.5, 2.2, 5.5);
        ellipse(x, y - 14, 4.6, 1.7, '#e8e2d6');
        ellipse(x, y - 14, 3.4, 1.1, '#7a5238');
      }
    },
    couch(cx, cy) {
      beanbag(cx, cy, 0.18, -0.2, '#2f8f9d', 2);
      beanbag(cx, cy, -0.16, 0.2, '#e8a33d', -2);
    },
    dog(cx, cy, it, t) {
      // Sourdough on a round bed, tail going
      const [ox, oy] = P(cx, cy, 0.34, -0.36, 0);
      ellipse(ox, oy, 4, 2, '#8d959d');
      ellipse(ox, oy - 1, 3.2, 1.4, '#b7bec5');
      ellipse(ox, oy - 1.1, 2.2, 0.9, '#5c4636');
      const bed = cyl(cx, cy, -0.02, 0.06, 0.37, 5, 0, '#b8553f');
      ellipse(bed.x, bed.y + 0.4, bed.rx * 0.8, bed.ry * 0.74, '#e8d6b6');
      ctx.strokeStyle = 'rgba(184,85,63,0.35)';
      ctx.beginPath();
      ctx.ellipse(bed.x, bed.y + 0.4, bed.rx * 0.55, bed.ry * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      const [tbx, tby] = P(cx, cy, -0.34, 0.36, 2.2);
      dot(tbx, tby, 2.2, '#c9dc4a');
      const fur = '#d9ab6c', furD = '#b8864b', furL = '#f4e2c3';
      const x = bed.x + 1, y = bed.y + 1;
      const wag = Math.sin(t * 7 + it.id) * (calm() ? 0 : 1);
      ctx.strokeStyle = furD;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 5);
      ctx.quadraticCurveTo(x + 14 + wag, y - 7, x + 13 + wag * 3.5, y - 14);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1;
      ellipse(x + 3.5, y - 6, 8.5, 6.5, fur);
      ellipse(x + 6, y - 2, 4, 2.2, furL);
      ellipse(x - 2, y - 12.5, 6, 8.5, fur);
      ellipse(x - 3.6, y - 11.5, 3, 5.6, furL);
      ctx.fillStyle = fur;
      ctx.fillRect(x - 6.4, y - 9, 2.6, 8);
      ctx.fillStyle = furD;
      ctx.fillRect(x - 2.6, y - 9, 2.6, 8);
      ellipse(x - 5.1, y - 1, 2, 1.2, furL);
      ellipse(x - 1.3, y - 1, 2, 1.2, furL);
      ctx.fillStyle = '#e8743b';
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 18.5);
      ctx.lineTo(x + 2, y - 18.5);
      ctx.lineTo(x - 4, y - 13.2);
      ctx.closePath();
      ctx.fill();
      dot(x - 3, y - 23.5, 6.2, fur);
      ellipse(x + 2, y - 22.5, 2.3, 4.6, furD, 0.35);
      ellipse(x - 7.2, y - 21.5, 3.8, 2.8, furL);
      dot(x - 10.4, y - 22.2, 1.3, '#2b2220');
      dot(x - 4.8, y - 25, 1.1, '#2b2220');
      ellipse(x - 1.4, y - 27.8, 2.2, 1.4, furD, -0.5);
    },
    kombucha(cx, cy, it) {
      // stainless kegerator with a four-tap tower
      const pr = prism(cx, cy, 0, 0.02, 0.6, 0.56, 31, 0, '#bcc3c9', '#d8dde1');
      poly([onL(cx, cy, pr, 0.08, 3), onL(cx, cy, pr, 0.92, 3), onL(cx, cy, pr, 0.92, 28), onL(cx, cy, pr, 0.08, 28)], '#aab2b9');
      const h1 = onL(cx, cy, pr, 0.84, 10), h2 = onL(cx, cy, pr, 0.84, 24);
      line(h1[0], h1[1], h2[0], h2[1], '#6b747c', 1.8);
      poly([onL(cx, cy, pr, 0.16, 17), onL(cx, cy, pr, 0.66, 17), onL(cx, cy, pr, 0.66, 25), onL(cx, cy, pr, 0.16, 25)], '#2f3a36');
      const FLAV = ['#f2c14e', '#e0567a', '#a58be0', '#7cc36a'];
      FLAV.forEach((c, i) => {
        const [x, y] = onL(cx, cy, pr, 0.22 + i * 0.12, 21);
        dot(x, y, 1.2, c);
      });
      prism(cx, cy, 0, 0.27, 0.46, 0.1, 1.5, 31, '#5c656d');
      prism(cx, cy, 0, 0.04, 0.07, 0.07, 10, 31, '#d7dde1');
      const bar = prism(cx, cy, 0, 0.1, 0.5, 0.08, 5, 41, '#e1e6ea');
      FLAV.forEach((c, i) => {
        const [x, y] = onL(cx, cy, bar, 0.13 + i * 0.25, 2.5);
        line(x, y + 1, x, y + 4, '#6b747c', 1.4);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - 0.6, y - 10);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
        dot(x - 0.6, y - 10.5, 1.8, mix(c, -0.15));
      });
      const [gx, gy] = onTop(cx, cy, pr, 0.18, 0.25);
      ctx.fillStyle = 'rgba(225,160,70,0.85)';
      ctx.fillRect(gx - 1.8, gy - 6, 3.6, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(gx - 1.8, gy - 6, 3.6, 1.2);
    },
    arcade(cx, cy, it, t) {
      // pinball machine: legs, a sloped playfield and a lit backbox
      const cab = '#3b2d6e', side = '#2b2153';
      for (const [u, v] of [[-0.17, -0.36], [0.17, -0.36], [-0.17, 0.34], [0.17, 0.34]]) prism(cx, cy, u, v, 0.05, 0.05, 16, 0, '#1f1f24');
      const u1 = -0.2, u2 = 0.2, v1 = -0.42, v2 = 0.4, zb = 16, zf = 24, zk = 29;
      poly([P(cx, cy, u1, v2, zb), P(cx, cy, u2, v2, zb), P(cx, cy, u2, v2, zf), P(cx, cy, u1, v2, zf)], cab);
      poly([P(cx, cy, u2, v2, zb), P(cx, cy, u2, v1, zb), P(cx, cy, u2, v1, zk), P(cx, cy, u2, v2, zf)], side);
      const s1 = P(cx, cy, u2, v2 - 0.1, zb + 4), s2 = P(cx, cy, u2, v1 + 0.08, zb + 7);
      line(s1[0], s1[1], s2[0], s2[1], '#ff4fa3', 1.6);
      const cd = [P(cx, cy, -0.08, v2, zb + 1.5), P(cx, cy, 0.08, v2, zb + 1.5), P(cx, cy, 0.08, v2, zf - 1.5), P(cx, cy, -0.08, v2, zf - 1.5)];
      poly(cd, '#23252b');
      dot((cd[0][0] + cd[2][0]) / 2 - 1.5, (cd[0][1] + cd[2][1]) / 2, 0.8, '#ff8a3d');
      dot((cd[0][0] + cd[2][0]) / 2 + 1.5, (cd[0][1] + cd[2][1]) / 2, 0.8, '#ff8a3d');
      const pf = (su, sv) => P(cx, cy, u1 + (u2 - u1) * su, v1 + (v2 - v1) * sv, zk + (zf - zk) * sv);
      poly([pf(0, 0), pf(1, 0), pf(1, 1), pf(0, 1)], '#4a3a8a');
      poly([pf(0.1, 0.05), pf(0.9, 0.05), pf(0.9, 0.95), pf(0.1, 0.95)], '#1d2350');
      [[0.35, 0.25, '#ff4d6d'], [0.65, 0.3, '#ffd23f'], [0.5, 0.45, '#3fc6ff']].forEach(([su, sv, c]) => {
        const [x, y] = pf(su, sv);
        dot(x, y, 1.9, c);
      });
      const f1 = pf(0.3, 0.86), f2 = pf(0.46, 0.9), f3 = pf(0.7, 0.86), f4 = pf(0.54, 0.9);
      line(f1[0], f1[1], f2[0], f2[1], '#f4f1ea', 1.4);
      line(f3[0], f3[1], f4[0], f4[1], '#f4f1ea', 1.4);
      const k = (Math.sin(t * 2.3 + it.id) + 1) / 2, j = (Math.sin(t * 3.7 + it.id * 2) + 1) / 2;
      const [bx, by] = pf(0.25 + 0.5 * j, 0.2 + 0.6 * k);
      dot(bx, by, 1.3, '#e9eef2');
      poly([pf(0.02, 0.02), pf(0.2, 0.02), pf(0.5, 0.98), pf(0.32, 0.98)], 'rgba(255,255,255,0.12)');
      const bb = prism(cx, cy, 0, -0.37, 0.4, 0.1, 25, zk, cab);
      const g = [onL(cx, cy, bb, 0.1, 4), onL(cx, cy, bb, 0.9, 4), onL(cx, cy, bb, 0.9, 22), onL(cx, cy, bb, 0.1, 22)];
      const hue = 24 + (it.id % 3) * 12;
      const lg = ctx.createLinearGradient(g[3][0], g[3][1], g[1][0], g[1][1]);
      lg.addColorStop(0, `hsl(${hue},55%,58%)`);
      lg.addColorStop(1, `hsl(${hue + 20},50%,50%)`);
      poly(g, lg);
      poly([onL(cx, cy, bb, 0.2, 5.5), onL(cx, cy, bb, 0.8, 5.5), onL(cx, cy, bb, 0.8, 9.5), onL(cx, cy, bb, 0.2, 9.5)], '#1a1410');
      for (let i = 0; i < 5; i++) {
        const [x, y] = onL(cx, cy, bb, 0.28 + i * 0.11, 7.5);
        dot(x, y, 0.7, '#ff9a3d');
      }
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
    coffee: 'break', couch: 'break', arcade: 'break', nap_pod: 'break', plant: 'break', bikes: 'break', dog: 'break', kombucha: 'break',
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
  // free tiles next to any tile of an item's footprint
  function around(N, blocked, it) {
    const n = AIT.Sim.sizeOf(it), out = new Map();
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) for (const t of freeNeighbors(N, blocked, it.x + dx, it.y + dy)) out.set(t[0] + ',' + t[1], t);
    return [...out.values()];
  }

  function startWalk(s, N, desk, p) {
    const blocked = AIT.Sim.occupied(s);
    const home = freeNeighbors(N, blocked, desk.x, desk.y)[0];
    if (!home) return;
    const want = p.founder ? 'break' : p.role;
    const spots = s.items.filter((i) => HANGOUT[i.type] === 'break' || HANGOUT[i.type] === want);
    if (!spots.length) return;
    const target = pickOne(spots);
    const goals = new Set(around(N, blocked, target).map(([a, b]) => a + ',' + b));
    if (!goals.size) return;
    const path = findPath(N, blocked, home, goals);
    if (!path) return;
    const seat = [desk.x + 0.5, desk.y + 0.12];
    const pts = [seat].concat(path.map(([a, b]) => [a + 0.5, b + 0.5]));
    const say = target.type === 'dog' && quips().dog ? pickOne(quips().dog) : HANGOUT[target.type] === 'break' ? pickOne(quips().break) : pickOne(quips()[want] || quips().break);
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
      const people = s.staff.slice().sort(() => Math.random() - 0.5).slice(0, 1);
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
          if (Math.random() < 0.35 && life.bubbles.length < 1) life.bubbles.push({ who: w.id, text: w.say, until: t + 2.6 });
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
    if (life.nextWalk <= 0 && seated.length && life.walkers.size < Math.min(4, Math.max(1, Math.floor(s.staff.length / 8)))) {
      life.nextWalk = 3 + Math.random() * 5;
      const d = pickOne(seated);
      startWalk(s, N, d, deskStaff.get(d.id));
    }
    // and somebody says something
    life.nextQuip -= dt;
    if (life.nextQuip <= 0 && seated.length && life.bubbles.length < 1) {
      life.nextQuip = 12 + Math.random() * 10;
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
    return [x, y - (deskStands(d.id) ? 41 : 32)];
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
    for (let i = 0; i < 45; i++) {
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
    ctx.shadowColor = stageDark ? 'rgba(0,0,0,0.5)' : 'rgba(40,52,64,0.22)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    poly([back, right, front, left], office.floorB);
    ctx.restore();
    poly([left, front, [front[0], front[1] + SLAB], [left[0], left[1] + SLAB]], mix(office.trim, 0.1));
    poly([front, right, [right[0], right[1] + SLAB], [front[0], front[1] + SLAB]], mix(office.trim, -0.15));
    if (stageDark) {
      // a faint rim so dark trims don't melt into a dark stage
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      ctx.lineTo(left[0], left[1] + SLAB);
      ctx.lineTo(front[0], front[1] + SLAB);
      ctx.lineTo(right[0], right[1] + SLAB);
      ctx.lineTo(right[0], right[1]);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
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

  // The two back walls are drawn in a flat 2D frame sheared onto the wall, so
  // windows, frames, bricks and the views outside are plain rectangles.
  // Units: a runs left to right on screen (WU per tile), b runs down from the
  // wall top (b = WALL_H is the floor). Both walls share one panorama: the left
  // wall ('y', gx = 0) covers a = 0..L from its front end to the back corner and
  // the right wall ('x', gy = 0) continues with a = L..2L.
  const WU = Math.hypot(TW / 2, TH / 2);
  const BH = WALL_H;
  const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const calm = () => !!(reduceMotion && reduceMotion.matches);

  function wallFrame(axis, N) {
    if (axis === 'y') {
      const [x, y] = P(0, 0, 0, N, BH);
      ctx.transform(TW / 2 / WU, -TH / 2 / WU, 0, 1, x, y);
    } else {
      const [x, y] = P(0, 0, 0, 0, BH);
      ctx.transform(TW / 2 / WU, TH / 2 / WU, 0, 1, x, y);
      ctx.translate(-N * WU, 0);
    }
  }

  // cheap integer hash for scenery that must not flicker
  const nh = (n) => {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  // the right wall catches less light: wall-surface colours go through tn()
  let wallShade = 0;
  const tn = (c) => (wallShade ? mix(c, -wallShade) : c);

  function rect(a, b, w, h, col) {
    ctx.fillStyle = col;
    ctx.fillRect(a, b, w, h);
  }
  function vgrad(b0, b1, stops) {
    const g = ctx.createLinearGradient(0, b0, 0, b1);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  }
  // soft round blob (fog, clouds, glow); rgb as 'r,g,b'
  function blob(a, b, rx, ry, rgb, alpha) {
    ctx.save();
    ctx.translate(a, b);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb},${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function ridge(A0, A1, base, amp, seed, col, step = 6) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(A0 - step, BH);
    for (let a = A0 - step; a <= A1 + step; a += step) {
      ctx.lineTo(a, base - amp * (0.55 + 0.3 * Math.sin(a * 0.011 + seed) + 0.15 * Math.sin(a * 0.037 + seed * 2.3)));
    }
    ctx.lineTo(A1 + step, BH);
    ctx.closePath();
    ctx.fill();
  }
  // windows `w` tiles wide every `step` tiles, centred between tiles `from` and `to` of a wall
  function winRow(base, from, to, w, step, b1, b2) {
    if (to - from < w) return [];
    const n = Math.floor((to - from - w) / step + 1e-6) + 1;
    const start = from + (to - from - ((n - 1) * step + w)) / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = start + i * step;
      out.push({ a1: base + s * WU, a2: base + (s + w) * WU, b1, b2 });
    }
    return out;
  }
  // a panorama position that shows through a window: `a` itself inside a wide pane, else the nearest window centre
  function anchor(wins, a) {
    let best = a, d = Infinity;
    for (const w of wins) {
      if (a >= w.a1 + 12 && a <= w.a2 - 12) return a;
      const c = (w.a1 + w.a2) / 2;
      if (Math.abs(c - a) < d) {
        d = Math.abs(c - a);
        best = c;
      }
    }
    return best;
  }
  const midOf = (w) => (w.a1 + w.a2) / 2;

  function frameRect(w, t, col) {
    const W = w.a2 - w.a1, H = w.b2 - w.b1;
    rect(w.a1 - t, w.b1 - t, W + 2 * t, t, col);
    rect(w.a1 - t, w.b2, W + 2 * t, t, col);
    rect(w.a1 - t, w.b1, t, H, col);
    rect(w.a2, w.b1, t, H, col);
  }
  function bars(w, cols, rows, t, col) {
    const W = w.a2 - w.a1, H = w.b2 - w.b1;
    for (let i = 1; i < cols; i++) rect(w.a1 + (W * i) / cols - t / 2, w.b1, t, H, col);
    for (let j = 1; j < rows; j++) rect(w.a1, w.b1 + (H * j) / rows - t / 2, W, t, col);
  }
  function sheen(w, alpha, tint) {
    const W = w.a2 - w.a1, H = w.b2 - w.b1;
    if (tint) rect(w.a1, w.b1, W, H, tint);
    const step = Math.max(H * 2.4, 70);
    for (let a = w.a1 - H * 0.6 + ((w.a1 * 0.37) % 23); a < w.a2; a += step) {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(a + H * 0.7, w.b1);
      ctx.lineTo(a + H * 0.7 + 11, w.b1);
      ctx.lineTo(a + 11, w.b2);
      ctx.lineTo(a, w.b2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.moveTo(a + H * 0.7 + 16, w.b1);
      ctx.lineTo(a + H * 0.7 + 20, w.b1);
      ctx.lineTo(a + 20, w.b2);
      ctx.lineTo(a + 16, w.b2);
      ctx.fill();
    }
  }

  const SIGN_FONT = 'Unbounded, "Arial Black", sans-serif';
  // sets ctx.font to the largest size (up to maxH) at which text fits maxW
  function fitText(text, maxW, maxH, weight = 700, family = SIGN_FONT) {
    let size = maxH;
    ctx.font = `${weight} ${size}px ${family}`;
    const w = ctx.measureText(text).width;
    if (w > maxW) {
      size = Math.max(5, (size * maxW) / w);
      ctx.font = `${weight} ${size}px ${family}`;
    }
    return size;
  }
  function signText(text, ar, o) {
    const w = ar.a2 - ar.a1, h = ar.b2 - ar.b1;
    const maxW = w * (o.fit || 0.86), maxH = h * (o.size || 0.6), weight = o.weight || 700, font = o.font || SIGN_FONT;
    let lines = [text];
    let size = fitText(text, maxW, maxH, weight, font);
    // long names read better on two lines than squeezed onto one
    const words = text.split(' ');
    if (size < maxH * 0.6 && words.length > 1) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const two = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
        const sz = Math.min(...two.map((l) => fitText(l, maxW, Math.min(maxH * 0.62, h * 0.42), weight, font)));
        if (!best || sz > best.sz) best = { two, sz };
      }
      if (best.sz > size * 1.15) {
        lines = best.two;
        size = best.sz;
      }
    }
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = (ar.a1 + ar.a2) / 2, y0 = (ar.b1 + ar.b2) / 2 + size * 0.05 - ((lines.length - 1) * size * 1.1) / 2;
    lines.forEach((l, i) => {
      const y = y0 + i * size * 1.1;
      if (o.glow) {
        ctx.strokeStyle = o.glow;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1.5, size * 0.3);
        ctx.strokeText(l, x, y, w * 0.95);
        ctx.lineJoin = 'miter';
      }
      ctx.fillStyle = o.color;
      ctx.fillText(l, x, y, w * 0.95);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 1;
  }

  // ---------- views out of the windows ----------
  const PASTEL = ['#f4b8c5', '#b9e2d0', '#f6e3a1', '#b8d4f0', '#d9c6ea', '#f7c9a4', '#cfe7ad', '#f2d0e4'];

  // A suspension bridge. towers: panorama positions. deck, top, base in wall units.
  function suspension(o, t) {
    const { towers, deck, top, from, to } = o;
    for (const a of towers) (o.gg ? ggTower : bayTower)(a, top, o.base, deck, o);
    rect(from, deck, to - from, 2.4, o.deckCol);
    rect(from, deck + 2.4, to - from, 1.8, o.trussCol);
    const spans = [];
    if (towers.length) {
      spans.push([o.cableFrom != null ? o.cableFrom : from, deck - 0.5, towers[0], top, true]);
      for (let i = 0; i < towers.length - 1; i++) spans.push([towers[i], top, towers[i + 1], top, false]);
      spans.push([towers[towers.length - 1], top, o.cableTo != null ? o.cableTo : to, deck - 0.5, true]);
    }
    const lights = [];
    ctx.strokeStyle = o.hangCol;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    for (const [a1, b1, a2, b2, side] of spans) {
      const c = side ? deck - 0.5 : 2 * (deck - 3) - top;
      for (let a = a1 + 4; a < a2 - 1; a += 4.5) {
        const k = (a - a1) / (a2 - a1);
        const b = (1 - k) * (1 - k) * b1 + 2 * k * (1 - k) * c + k * k * b2;
        if (deck - b > 1) {
          ctx.moveTo(a, b);
          ctx.lineTo(a, deck);
        }
        lights.push(a, b);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = o.cableCol;
    ctx.lineWidth = o.cableW || 1.1;
    ctx.beginPath();
    for (const [a1, b1, a2, b2, side] of spans) {
      const c = side ? deck - 0.5 : 2 * (deck - 3) - top;
      ctx.moveTo(a1, b1);
      ctx.quadraticCurveTo((a1 + a2) / 2, c, a2, b2);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    if (o.lights) {
      for (let i = 0; i < lights.length; i += 2) {
        const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + lights[i] * 0.21);
        ctx.fillStyle = `rgba(${o.lights},${(o.lightA * tw).toFixed(3)})`;
        ctx.fillRect(lights[i] - 0.6, lights[i + 1] - 0.6, 1.2, 1.2);
      }
    }
  }
  function bayTower(a, top, base, deck, o) {
    const c = o.towerCol;
    rect(a - 6, top, 2.4, base - top, c);
    rect(a + 3.6, top, 2.4, base - top, c);
    rect(a + 4.8, top, 1.2, base - top, mix(c, -0.22));
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let b = top + 3; b < deck - 4; b += 7) {
      ctx.moveTo(a - 3.6, b);
      ctx.lineTo(a + 3.6, b + 7);
      ctx.moveTo(a + 3.6, b);
      ctx.lineTo(a - 3.6, b + 7);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    rect(a - 6.6, top - 1.6, 13.2, 2.2, c);
    rect(a - 3.6, deck + 5, 7.2, 1.5, c);
  }
  function ggTower(a, top, base, deck, o) {
    const c = '#c0362c', d = '#94281f';
    const hgt = base - top;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const b1 = top + (hgt * k) / 3, b2 = top + (hgt * (k + 1)) / 3, w = 3 + k * 0.9;
        const x = side < 0 ? a - 8 - k * 0.45 : a + 8 + k * 0.45 - w;
        rect(x, b1, w, b2 - b1 + 0.3, c);
        rect(side < 0 ? x + w - 0.9 : x, b1, 0.9, b2 - b1 + 0.3, d);
      }
    }
    rect(a - 8, top, 16, 2.6, c);
    for (const f of [0.3, 0.56, 0.82]) rect(a - 7.2, top + (deck - top) * f, 14.4, 1.7, c);
    rect(a - 8.4, deck + 4, 16.8, 1.6, d);
  }
  function eucalyptus(a, base, hgt, seed, t) {
    const lean = (nh(seed) - 0.5) * 12, sway = Math.sin(t * 0.6 + seed) * 1.2;
    ctx.strokeStyle = '#cdc2aa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a, base);
    ctx.quadraticCurveTo(a + lean * 0.2, base - hgt * 0.55, a + lean + sway, base - hgt);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(a + lean * 0.35, base - hgt * 0.55);
    ctx.lineTo(a + lean * 0.35 + 9, base - hgt * 0.72);
    ctx.moveTo(a + lean * 0.5, base - hgt * 0.68);
    ctx.lineTo(a + lean * 0.5 - 8, base - hgt * 0.84);
    ctx.stroke();
    ctx.lineWidth = 1;
    const cols = ['#5b7862', '#6d8b72', '#83a087', '#4f6b57'];
    for (let i = 0; i < 9; i++) {
      const k1 = nh(seed * 31 + i), k2 = nh(seed * 57 + i * 7);
      const fa = a + lean * (0.45 + 0.55 * k2) + (k1 - 0.5) * 26 + sway;
      const fb = base - hgt * (0.6 + 0.42 * k2);
      ctx.fillStyle = cols[i % 4];
      ctx.beginPath();
      ctx.ellipse(fa, fb, 7 + k1 * 6, 3.6 + k2 * 2.6, (k1 - 0.5) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function palm(a, base, hgt, t) {
    ctx.strokeStyle = '#8a6d4d';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a, base);
    ctx.quadraticCurveTo(a + 2, base - hgt * 0.5, a + 1, base - hgt);
    ctx.stroke();
    ctx.strokeStyle = '#3f7a45';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const s = Math.sin(t * 0.8 + a) * 0.6;
    for (const [dx, dy] of [[-7, 3], [7, 3], [-5, -2], [5, -2], [0, -4], [-8, 6], [8, 6]]) {
      ctx.moveTo(a + 1, base - hgt);
      ctx.quadraticCurveTo(a + 1 + dx * 0.6 + s, base - hgt + dy * 0.2 - 2, a + 1 + dx + s, base - hgt + dy);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // rows of towers; lit adds window lights (dusk)
  function towers(A0, A1, o, t) {
    let a = o.start, i = 0;
    while (a < A1) {
      const k1 = nh(o.seed + i * 3), k2 = nh(o.seed + i * 3 + 1), k3 = nh(o.seed + i * 3 + 2);
      const w = o.wMin + k1 * (o.wMax - o.wMin);
      const env = o.env ? o.env(a + w / 2) : 1;
      const top = o.base - (o.hMin + k2 * (o.hMax - o.hMin)) * env;
      if (a + w > A0 && top < o.base - 2) {
        const col = o.cols[Math.floor(k3 * o.cols.length)];
        rect(a, top, w, BH - top, col);
        rect(a + w * 0.72, top, w * 0.28, BH - top, mix(col, -0.12));
        if (k3 > 0.55 && w > 14) {
          rect(a + w * 0.2, top - 5, w * 0.6, 5, col);
          if (k1 > 0.5) rect(a + w * 0.48, top - 13, 0.8, 8, col);
        }
        if (o.lit) {
          ctx.fillStyle = o.lit;
          ctx.beginPath();
          for (let bb = top + 3; bb < o.litTo; bb += 3.6) {
            for (let aa = a + 1.5; aa < a + w - 2; aa += 3) {
              const r = nh(((aa * 7) | 0) * 131 + ((bb * 5) | 0) * 71 + o.seed);
              if (r < 0.3) ctx.rect(aa, bb, 1.3, 1.5);
            }
          }
          ctx.fill();
        } else if (o.grid) {
          ctx.fillStyle = o.grid;
          for (let bb = top + 3; bb < BH; bb += 3.5) ctx.fillRect(a + 1, bb, w - 2, 0.7);
        }
      }
      a += w + o.gMin + k2 * (o.gMax - o.gMin);
      i++;
    }
  }
  function pyramid(a, tip, base, lit) {
    const w = (base - tip) * 0.21;
    ctx.fillStyle = lit ? '#2f3552' : '#ece9e1';
    ctx.beginPath();
    ctx.moveTo(a, tip);
    ctx.lineTo(a + w, base);
    ctx.lineTo(a - w, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lit ? '#262b45' : '#cfccc3';
    ctx.beginPath();
    ctx.moveTo(a, tip);
    ctx.lineTo(a + w, base);
    ctx.lineTo(a, base);
    ctx.closePath();
    ctx.fill();
    const wy = tip + (base - tip) * 0.38, ww = (wy - tip) * 0.21;
    rect(a - ww - 2.4, wy, 2.4, 9, lit ? '#2f3552' : '#e4e1d8');
    rect(a + ww, wy, 2.4, 9, lit ? '#262b45' : '#c7c4bb');
    rect(a - 0.4, tip - 6, 0.8, 6, lit ? '#2f3552' : '#d8d5cc');
    if (lit) {
      ctx.fillStyle = 'rgba(255,217,138,0.8)';
      for (let b = tip + 10; b < base - 2; b += 3.2) {
        const hw = ((b - tip) * 0.21) * 0.8;
        for (let x = a - hw; x < a + hw; x += 2.6) if (nh(((x * 5) | 0) * 17 + ((b * 3) | 0)) < 0.35) ctx.fillRect(x, b, 1, 1.3);
      }
    }
  }
  function saleTower(a, top, lit, t) {
    const w = 11;
    ctx.fillStyle = lit ? '#30365a' : '#d3d8dc';
    ctx.beginPath();
    ctx.moveTo(a - w, BH);
    ctx.lineTo(a - w, top + 14);
    ctx.quadraticCurveTo(a - w, top, a, top - 1);
    ctx.quadraticCurveTo(a + w, top, a + w, top + 14);
    ctx.lineTo(a + w, BH);
    ctx.closePath();
    ctx.fill();
    rect(a + w * 0.35, top + 8, w * 0.65, BH - top - 8, lit ? '#282d4c' : '#bfc5ca');
    if (lit) {
      const glow = 0.75 + 0.25 * Math.sin(t * 0.7);
      blob(a, top + 7, 14, 10, '255,236,200', 0.35 * glow);
      ctx.fillStyle = `rgba(255,244,222,${0.9 * glow})`;
      for (let b = top + 3; b < top + 13; b += 2.4) ctx.fillRect(a - w + 2 + (b - top < 6 ? 3 : 0), b, 2 * w - 4 - (b - top < 6 ? 6 : 0), 1);
      ctx.fillStyle = 'rgba(255,217,138,0.75)';
      for (let b = top + 17; b < BH; b += 3.4) for (let x = a - w + 1.5; x < a + w - 1.5; x += 2.8) if (nh(((x * 3) | 0) * 29 + ((b * 7) | 0)) < 0.3) ctx.fillRect(x, b, 1.1, 1.4);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let b = top + 3; b < top + 13; b += 2.4) ctx.fillRect(a - w + 2, b, 2 * w - 4, 0.8);
      ctx.fillStyle = 'rgba(80,96,110,0.18)';
      for (let x = a - w + 2.5; x < a + w; x += 3.5) ctx.fillRect(x, top + 16, 0.7, BH - top - 16);
    }
  }
  function sutro(a, top, base) {
    ctx.strokeStyle = '#c1564a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(a - 6, base);
    ctx.lineTo(a - 1.4, top + 5);
    ctx.moveTo(a + 6, base);
    ctx.lineTo(a + 1.4, top + 5);
    ctx.moveTo(a, base);
    ctx.lineTo(a, top + 5);
    for (let b = base - 6; b > top + 7; b -= 6) {
      const k = (base - b) / (base - top - 5), hw = 6 - k * 4.6;
      ctx.moveTo(a - hw, b);
      ctx.lineTo(a + hw, b);
    }
    for (const dx of [-1.8, 0, 1.8]) {
      ctx.moveTo(a + dx, top + 5);
      ctx.lineTo(a + dx, top);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    rect(a - 3, top + 4.5, 6, 1.4, '#f2f0ea');
  }

  const VIEWS = {
    ocean(e, A0, A1) {
      const W = A1 - A0, t = e.t;
      rect(A0, 0, W, 35, vgrad(0, 35, ['#a9bcc7', '#dde4e3']));
      blob(A0 + W / 2, 31, W * 0.75, 5, '238,241,241', 0.85);
      rect(A0, 34, W, 10, vgrad(34, 44, ['#66837e', '#89a098']));
      if (A0 < e.L && e.wins.y.length) {
        const s = midOf(e.wins.y[0]) + 9;
        rect(s - 8, 32.4, 16, 1.4, '#56636a');
        rect(s - 6, 31.2, 10, 1.3, '#a0705a');
        rect(s + 4.5, 29.8, 2, 2.8, '#e3e6e7');
        const g = midOf(e.wins.y[0]) - 10, f = Math.sin(t * 5) * 0.8;
        ctx.strokeStyle = '#5a646a';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (const [ga, gb] of [[g, 25], [g + 7, 27.5]]) {
          ctx.moveTo(ga - 2.2, gb - 0.8 + f);
          ctx.lineTo(ga, gb);
          ctx.lineTo(ga + 2.2, gb - 0.8 + f);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(246,249,247,0.85)';
      ctx.lineWidth = 0.9;
      for (let r = 0; r < 3; r++) {
        const bb = 37 + r * 2.4, off = (t * (2 + r)) % 36;
        ctx.beginPath();
        for (let a = A0 - 36 + off; a < A1; a += 36) {
          ctx.moveTo(a, bb);
          ctx.quadraticCurveTo(a + 9, bb - 1.1, a + 20 + r * 3, bb);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      rect(A0, 43.3, W, 1.6, 'rgba(250,250,245,0.85)');
      rect(A0, 44.9, W, BH - 44.9, vgrad(45, 70, ['#d9d0b6', '#c7ba98']));
      for (let i = 0; i < 3; i++) {
        const a = A0 + ((t * (3 + i) + i * 97) % (W + 140)) - 70;
        blob(a, 28 + i * 6, 55, 6, '242,245,245', 0.55);
      }
    },
    victorians(e, A0, A1) {
      const W = A1 - A0, t = e.t;
      rect(A0, 0, W, BH, vgrad(0, 46, ['#8fc0e0', '#e5eff2']));
      ridge(A0, A1, 36, 10, 2.1, '#a8b9a9');
      if (A0 < e.L && e.wins.y.length) sutro(midOf(e.wins.y[Math.floor(e.wins.y.length / 2)]) + 6, 8, 36);
      blob(A0 + W * 0.3 + Math.sin(t * 0.05) * 20, 20, 40, 5, '255,255,255', 0.5);
      let a = -24;
      for (let i = 0; a < A1; i++) {
        const k1 = nh(i * 7 + 1), k2 = nh(i * 7 + 2), k3 = nh(i * 7 + 3);
        const w = 38 + Math.floor(k1 * 14);
        if (a + w > A0) {
          const col = PASTEL[(i * 3 + Math.floor(k2 * 3)) % PASTEL.length], trim = '#fbf8f1';
          const top = 30 + k3 * 8;
          rect(a, top, w - 1.4, BH - top, col);
          if (k1 > 0.42) {
            ctx.fillStyle = mix(col, -0.12);
            ctx.beginPath();
            ctx.moveTo(a - 1.2, top + 0.5);
            ctx.lineTo(a + w / 2 - 0.7, top - 11);
            ctx.lineTo(a + w - 0.2, top + 0.5);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = trim;
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.lineWidth = 1;
            dot(a + w / 2 - 0.7, top - 3.6, 2, trim);
            dot(a + w / 2 - 0.7, top - 3.6, 1.2, '#51627a');
          } else {
            rect(a - 1.2, top - 5, w + 1, 5, trim);
            for (let x = a + 1.5; x < a + w - 2; x += 6) rect(x, top, 1.6, 2.2, trim);
          }
          const bx = a + w * 0.16, bw = w * 0.68;
          rect(bx, top + 8, bw, 24, trim);
          rect(bx + 1.6, top + 10, bw * 0.24, 20, '#56687f');
          rect(bx + bw * 0.3, top + 10, bw * 0.4, 20, '#4b5d75');
          rect(bx + bw * 0.76 - 1.6, top + 10, bw * 0.24, 20, '#43546b');
          rect(bx + 1.6, top + 18, bw - 3.2, 1.2, trim);
          rect(bx - 1.5, top + 31.5, bw + 3, 2, trim);
          rect(a, top + 40, w - 1.4, 1.6, trim);
        }
        a += w;
      }
      // utility poles and wires in front
      const pole = 150;
      for (let p = Math.floor(A0 / pole) * pole + 40; p < A1 + pole; p += pole) {
        ctx.strokeStyle = 'rgba(40,40,44,0.55)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (const dy of [0, 2.4]) {
          ctx.moveTo(p - pole, 15 + dy);
          ctx.quadraticCurveTo(p - pole / 2, 21 + dy, p, 15 + dy);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        rect(p - 1, 12, 2, BH - 12, '#6b5443');
        rect(p - 5, 14, 10, 1.2, '#6b5443');
      }
    },
    baybridge(e, A0, A1) {
      const W = A1 - A0, t = e.t, L = e.L;
      rect(A0, 0, W, BH, vgrad(0, 54, ['#84b1d4', '#ece4d2']));
      blob(A0 + W * 0.4, 18, 50, 6, '255,255,255', 0.55);
      ridge(A0, A1, 55, 9, 0.7, '#94a6a4');
      rect(A0, 54, W, BH - 54, vgrad(54, 86, ['#5d899b', '#3c677b']));
      ctx.fillStyle = 'rgba(235,245,250,0.35)';
      for (let i = 0; i < 40; i++) {
        const a = A0 + nh(i + 11) * W, b = 57 + nh(i + 29) * 22;
        ctx.fillRect(a + ((t * 1.5 + i * 3) % 6), b, 4 + nh(i) * 5, 0.6);
      }
      // Yerba Buena Island where the span lands
      ctx.fillStyle = '#6f8a64';
      ctx.beginPath();
      ctx.moveTo(L * 1.2, 55);
      ctx.quadraticCurveTo(L * 1.42, 34, L * 1.7, 55);
      ctx.fill();
      const wy = e.wins.y;
      const tw = wy.length >= 3 ? [midOf(wy[0]), midOf(wy[Math.floor(wy.length / 2)]), midOf(wy[wy.length - 1])] : wy.map(midOf);
      suspension({ towers: tw, deck: 45, top: 14, base: 58, from: -10, to: L * 1.36, cableTo: L * 1.08, towerCol: '#b9c2c8', deckCol: '#8f989f', trussCol: '#6f787f', cableCol: '#a9b3ba', hangCol: 'rgba(150,160,168,0.7)', lights: '255,244,210', lightA: 0.9 }, t);
      // SoMa rooftops and water towers
      let a = -30;
      for (let i = 0; a < A1; i++) {
        const k1 = nh(i * 5 + 77), k2 = nh(i * 5 + 78);
        const w = 26 + k1 * 30, top = 64 + k2 * 10;
        if (a + w > A0) {
          const col = ['#6c5b52', '#7b6a5f', '#5f534c', '#86746a'][i % 4];
          rect(a, top, w, BH - top, col);
          rect(a, top, w, 1.4, mix(col, 0.18));
          if (k1 > 0.55) {
            const x = a + w * 0.3;
            rect(x, top - 5, 0.8, 5, '#3f3833');
            rect(x + 6, top - 5, 0.8, 5, '#3f3833');
            rect(x - 1, top - 14, 9, 9, '#7a5a3e');
            ctx.fillStyle = '#5e4430';
            ctx.beginPath();
            ctx.moveTo(x - 1.5, top - 14);
            ctx.lineTo(x + 3.5, top - 18);
            ctx.lineTo(x + 8.5, top - 14);
            ctx.fill();
          }
        }
        a += w + 2;
      }
    },
    ballpark(e, A0, A1) {
      const W = A1 - A0, t = e.t, L = e.L;
      rect(A0, 0, W, BH, vgrad(0, 48, ['#73abd7', '#d9e9ef']));
      blob(A0 + W * 0.25 + Math.sin(t * 0.04) * 30, 14, 60, 6, '255,255,255', 0.6);
      blob(A0 + W * 0.7, 22, 45, 5, '255,255,255', 0.45);
      ridge(A0, A1, 48, 7, 3.3, '#a7b7ba');
      rect(A0, 47, W, BH - 47, vgrad(47, 86, ['#5790a7', '#2c627c']));
      ctx.fillStyle = 'rgba(235,245,250,0.3)';
      for (let i = 0; i < 50; i++) {
        const a = A0 + nh(i + 5) * W, b = 50 + nh(i + 61) * 32;
        ctx.fillRect(a + ((t * 1.2 + i * 2) % 5), b, 3 + nh(i + 2) * 6, 0.6);
      }
      if (A1 > L) {
        // across the bay: the port cranes and the Bay Bridge far off
        rect(L, 46, L, 2, '#8e9a93');
        for (const f of [0.7, 0.77, 0.84, 0.91]) {
          const a = L + f * L;
          ctx.strokeStyle = '#eef0f1';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a - 4, 47);
          ctx.lineTo(a - 3, 37);
          ctx.moveTo(a + 4, 47);
          ctx.lineTo(a + 3, 37);
          ctx.moveTo(a - 5, 37);
          ctx.lineTo(a + 5, 37);
          ctx.moveTo(a - 14, 35.5);
          ctx.lineTo(a + 7, 35.5);
          ctx.moveTo(a - 3, 37);
          ctx.lineTo(a, 32);
          ctx.lineTo(a + 3, 37);
          ctx.stroke();
          ctx.lineWidth = 1;
          rect(a - 4.5, 40, 9, 1, '#d24a3b');
        }
        const b0 = L + 0.36 * L, b1 = L + 0.64 * L;
        suspension({ towers: [b0 + (b1 - b0) * 0.3, b0 + (b1 - b0) * 0.7], deck: 42, top: 33, base: 47, from: b0, to: b1, towerCol: '#aab4ba', deckCol: '#9aa4ab', trussCol: '#86919a', cableCol: '#9aa5ad', cableW: 0.7, hangCol: 'rgba(160,170,178,0.45)' }, t);
        for (let i = 0; i < 3; i++) {
          const sa = L + (0.42 + i * 0.19) * L + Math.sin(t * 0.07 + i) * 12, sb = 55 + i * 6;
          ctx.fillStyle = '#f7f7f2';
          ctx.beginPath();
          ctx.moveTo(sa, sb - 9);
          ctx.lineTo(sa, sb);
          ctx.lineTo(sa + 6, sb);
          ctx.closePath();
          ctx.fill();
          rect(sa - 3, sb, 10, 1.4, '#3c4d5c');
        }
        const fa = L + 0.4 * L + ((t * 2) % (0.5 * L));
        rect(fa - 7, 60, 14, 2.2, '#f2f2ee');
        rect(fa - 4, 58, 8, 2, '#f2f2ee');
        rect(fa - 7, 62, 14, 0.8, '#2c3e50');
      }
      if (A0 < L) {
        // the ballpark across the cove: seating bowl, brick arches, light towers
        const s1 = 0.2 * L, s2 = 0.78 * L;
        for (let i = 0; i < 5; i++) {
          const a = s1 + ((s2 - s1) * (i + 0.5)) / 5;
          rect(a - 0.9, 8, 1.8, 26, '#3a4843');
          rect(a - 7, 4, 14, 7.5, '#3c4a45');
          ctx.fillStyle = '#fffbe6';
          for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) ctx.fillRect(a - 6 + c * 2.5, 5 + r * 2.2, 1.5, 1.4);
        }
        ctx.fillStyle = '#2f5d52';
        ctx.beginPath();
        ctx.moveTo(s1 + 4, 42);
        ctx.lineTo(s1 + 14, 31);
        ctx.lineTo(s2 - 14, 31);
        ctx.lineTo(s2 - 4, 42);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let b = 33; b < 42; b += 2.1) ctx.fillRect(s1 + 12, b, s2 - s1 - 24, 0.6);
        const sb = s1 + (s2 - s1) * 0.12;
        rect(sb, 21, 26, 11, '#24332e');
        ctx.fillStyle = '#ffd98a';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if (nh(r * 9 + c + 60) < 0.6) ctx.fillRect(sb + 2 + c * 3, 23 + r * 2.8, 1.6, 1.4);
        rect(s1, 41, s2 - s1, 18, '#a24e37');
        rect(s1, 40, s2 - s1, 2, '#2f4f45');
        ctx.fillStyle = '#6e2f22';
        for (let row = 0; row < 2; row++) {
          for (let a = s1 + 3; a < s2 - 5; a += 7) {
            const b = 44 + row * 7;
            ctx.beginPath();
            ctx.moveTo(a, b + 5);
            ctx.lineTo(a, b + 1.8);
            ctx.arc(a + 1.9, b + 1.8, 1.9, Math.PI, 0);
            ctx.lineTo(a + 3.8, b + 5);
            ctx.fill();
          }
        }
        rect(s1 - 6, 58.5, s2 - s1 + 12, 2, '#9aa19c');
        for (let i = 0; i < 5; i++) palm(s1 + 6 + (i * (s2 - s1 - 12)) / 4, 59, 13, t);
        for (let i = 0; i < 7; i++) {
          const a = s1 + 10 + nh(i + 300) * (s2 - s1 - 20), b = 66 + nh(i + 400) * 14;
          ctx.fillStyle = ['#ffd23f', '#ef5f24', '#f4f1ea'][i % 3];
          ctx.beginPath();
          ctx.ellipse(a + Math.sin(t * 0.1 + i) * 3, b + Math.sin(t * 0.8 + i) * 0.3, 2.6, 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    skyline(e, A0, A1) {
      const W = A1 - A0, t = e.t, L = e.L;
      rect(A0, 0, W, BH, vgrad(0, 62, ['#477fbd', '#c5dcec']));
      ridge(A0, A1, 54, 7, 1.4, '#a4b6c4');
      towers(A0, A1, { start: -20, seed: 900, wMin: 14, wMax: 26, gMin: 2, gMax: 9, base: 62, hMin: 8, hMax: 28, cols: ['#8e9cad', '#9eabba', '#a9b3bf', '#8392a3'], grid: 'rgba(255,255,255,0.14)' }, t);
      if (A0 < L) pyramid(anchor(e.wins.y, 0.5 * L), 6, 72, false);
      if (A1 > L) saleTower(anchor(e.wins.x, L + 0.68 * L), 5, false, t);
      towers(A0, A1, { start: -8, seed: 400, wMin: 16, wMax: 30, gMin: 10, gMax: 30, base: 74, hMin: 10, hMax: 26, cols: ['#5f7185', '#6b7d90', '#56687b', '#74869a'], grid: 'rgba(255,255,255,0.12)' }, t);
      rect(A0, 60, W, BH - 60, vgrad(58, 74, ['rgba(238,243,247,0)', 'rgba(238,243,247,0.95)']));
      for (let i = 0; i < 9; i++) {
        const a = A0 + ((nh(i + 50) * W + t * (1.5 + nh(i) * 2)) % (W + 120)) - 60;
        blob(a, 60 + nh(i + 70) * 12, 38 + nh(i + 80) * 30, 6 + nh(i + 90) * 4, '244,247,250', 0.9);
      }
    },
    goldengate(e, A0, A1) {
      const W = A1 - A0, t = e.t, L = e.L;
      rect(A0, 0, W, BH, vgrad(0, 52, ['#95c0dc', '#e6edeb']));
      ridge(A0, A1, 50, 20, 4.2, '#8f9c78');
      ridge(A0, A1, 53, 12, 1.1, '#7a8c62');
      rect(A0, 52, W, BH - 52, vgrad(52, 86, ['#56859b', '#3b687e']));
      ctx.fillStyle = 'rgba(235,245,250,0.3)';
      for (let i = 0; i < 40; i++) {
        const a = A0 + nh(i + 15) * W, b = 55 + nh(i + 25) * 26;
        ctx.fillRect(a + ((t * 1.3 + i * 2) % 5), b, 3 + nh(i + 9) * 6, 0.6);
      }
      if (A0 < L) {
        const wy = e.wins.y;
        let tw;
        if (wy.length >= 3) tw = [midOf(wy[Math.round((wy.length - 1) * 0.25)]), midOf(wy[Math.round((wy.length - 1) * 0.72)])];
        else tw = [anchor(wy, 0.3 * L), anchor(wy, 0.75 * L)];
        if (tw[1] - tw[0] < 60) tw = [tw[0]];
        suspension({ towers: tw, deck: 45, top: 9, base: 58, from: -10, to: L * 1.02, gg: true, deckCol: '#b8352b', trussCol: '#8c2921', cableCol: '#b83229', cableW: 1.4, hangCol: 'rgba(184,50,41,0.55)' }, t);
        tw.forEach((a, i) => {
          blob(a + Math.sin(t * 0.15 + i) * 8, 27, 34, 6.5, '247,248,248', 0.8);
          blob(a - 10 + Math.sin(t * 0.1 + i * 2) * 10, 52, 44, 5, '247,248,248', 0.7);
        });
        for (let i = 0; i < 3; i++) blob(A0 + ((t * 2.5 + i * 170) % (W + 160)) - 80, 40 + i * 3, 60, 5, '246,247,247', 0.55);
      }
      if (A1 > L) {
        const a = anchor(e.wins.x, L + 0.55 * L);
        ctx.fillStyle = '#86806f';
        ctx.beginPath();
        ctx.moveTo(a - 16, 58);
        ctx.quadraticCurveTo(a - 12, 51, a - 2, 50.5);
        ctx.lineTo(a + 10, 51);
        ctx.quadraticCurveTo(a + 15, 53, a + 17, 58);
        ctx.fill();
        rect(a - 8, 47.5, 14, 3.6, '#e9e4d6');
        rect(a - 3, 45.5, 6, 2, '#ddd7c8');
        rect(a + 8, 43, 1.8, 8, '#f3efe4');
      }
      // eucalyptus in front of the windows
      const trees = e.treeSpots || [];
      trees.forEach(([a, h], i) => {
        if (a > A0 - 30 && a < A1 + 30) eucalyptus(a, BH + 4, h, i + 3, t);
      });
    },
    citywater(e, A0, A1) {
      const W = A1 - A0, t = e.t, L = e.L;
      rect(A0, 0, W, BH, vgrad(0, 52, ['#1c264d', '#433b6e', '#b45f5c', '#f0a45c']));
      for (let i = 0; i < 26; i++) {
        const a = A0 + nh(i + 700) * W, b = 2 + nh(i + 800) * 16;
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.35 * Math.sin(t * 1.5 + i * 2)).toFixed(3)})`;
        ctx.fillRect(a, b, 0.9, 0.9);
      }
      ridge(A0, A1, 50, 9, 0.4, '#3b3558');
      if (A0 < L) {
        const env = (a) => Math.max(0.12, Math.exp(-Math.pow((a - 0.55 * L) / (0.26 * L), 2)));
        towers(A0, A1, { start: -10, seed: 1200, wMin: 10, wMax: 22, gMin: 1, gMax: 5, base: 51, hMin: 6, hMax: 34, env, cols: ['#2d3150', '#343859', '#282c48', '#3a3e60'], lit: 'rgba(255,217,138,0.8)', litTo: 50 }, t);
        pyramid(anchor(e.wins.y, 0.48 * L), 10, 51, true);
        const on = Math.sin(t * 3) > 0 ? 0.95 : 0.3;
        dot(anchor(e.wins.y, 0.48 * L), 3.8, 1.1, `rgba(255,60,50,${on})`);
        saleTower(anchor(e.wins.y, 0.6 * L), 4, true, t);
      }
      rect(A0, 50, W, BH - 50, vgrad(50, 86, ['#2a3052', '#131a33']));
      for (let i = 0; i < 70; i++) {
        const a = A0 + nh(i + 900) * W, b = 52 + nh(i + 950) * 30;
        const al = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7));
        ctx.fillStyle = (i % 3 ? 'rgba(255,200,120,' : 'rgba(255,150,90,') + al.toFixed(3) + ')';
        ctx.fillRect(a, b, 3 + nh(i + 990) * 9, 0.7);
      }
      if (A1 > L) {
        ctx.fillStyle = '#262a45';
        ctx.beginPath();
        ctx.moveTo(L * 1.78, 51);
        ctx.quadraticCurveTo(L * 1.92, 30, L * 2.05, 51);
        ctx.fill();
        const wx = e.wins.x[0];
        const lo = wx ? wx.a1 : L * 1.2, hi = wx ? wx.a2 : L * 1.95, span = hi - lo;
        const tw = [0.14, 0.36, 0.6, 0.8].map((f) => lo + f * span);
        suspension({ towers: tw, deck: 42, top: 13, base: 54, from: L * 0.95, to: L * 1.86, towerCol: '#3a4062', deckCol: '#2e3352', trussCol: '#23273f', cableCol: '#4a5176', hangCol: 'rgba(80,88,120,0.6)', lights: '255,250,235', lightA: 0.95 }, t);
        for (let i = 0; i < 16; i++) {
          const k = ((i / 16 + t * 0.012 * (i % 2 ? 1 : -1)) % 1 + 1) % 1;
          ctx.fillStyle = i % 2 ? 'rgba(255,90,70,0.9)' : 'rgba(255,248,225,0.9)';
          ctx.fillRect(L * 0.95 + k * (L * 0.91), 42.4 + (i % 2) * 1, 1.2, 0.8);
        }
      }
    },
    fallback(e, A0, A1) {
      rect(A0, 0, A1 - A0, BH, vgrad(0, 60, ['#8fbde0', '#e3edf0']));
      ridge(A0, A1, 56, 10, 1, '#9fb0b4');
    },
  };

  // ---------- one shell per office: window layout, frames, walls and signage ----------
  const SHELLS = {
    sunset: {
      windows: ({ L }) => ({
        y: [{ a1: 0.57 * L, a2: 0.81 * L, b1: 22, b2: 50 }],
        x: [0, 1, 2, 3].map((i) => {
          const d0 = L + 0.29 * L, dw = 0.62 * L / 4;
          return { a1: d0 + i * dw + 4, a2: d0 + (i + 1) * dw - 4, b1: 30, b2: 36 };
        }),
      }),
      texture(e, axis, A0) {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for (let b = 6, r = 0; b < BH - 4; b += 8, r++) {
          ctx.fillRect(A0, b, e.L, 0.6);
          for (let a = A0 + (r % 2) * 9; a < A0 + e.L; a += 18) ctx.fillRect(a, b, 0.6, 8);
        }
      },
      under(e, axis) {
        const L = e.L;
        if (axis === 'x') {
          const d0 = L + 0.27 * L, dw = 0.66 * L;
          rect(d0 - 3, 23, dw + 6, 63, tn('#8b8579'));
          rect(d0, 26, dw, 60, tn('#e8e3d8'));
          for (let b = 38; b < 86; b += 12) {
            rect(d0, b - 0.8, dw, 0.8, tn('#b5ae9f'));
            rect(d0, b, dw, 0.8, tn('#f6f3ec'));
          }
          rect(d0 + dw / 2 - 5, 78, 10, 1.8, '#6c675e');
        } else {
          const p0 = 0.07 * L, pw = 0.3 * L;
          rect(p0, 25, pw, 27, '#b58d5c');
          ctx.fillStyle = '#8a6a42';
          for (let b = 28; b < 51; b += 4) for (let a = p0 + 3; a < p0 + pw - 1; a += 4) ctx.fillRect(a, b, 0.9, 0.9);
          rect(p0 + pw * 0.14, 30, 1.6, 14, '#5b5f66');
          rect(p0 + pw * 0.14 - 3, 29, 7.6, 3, '#5b5f66');
          rect(p0 + pw * 0.36, 31, 1.5, 11, '#e8743b');
          rect(p0 + pw * 0.36 + 0.4, 42, 0.7, 5, '#9aa2aa');
          ctx.strokeStyle = '#e8743b';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p0 + pw * 0.62, 38, 5, 0, Math.PI * 2);
          ctx.arc(p0 + pw * 0.62, 38, 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#6f757c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p0 + pw * 0.84, 30);
          ctx.lineTo(p0 + pw * 0.84, 46);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      },
      glass: (w) => sheen(w, 0.2, 'rgba(210,214,212,0.1)'),
      frame(w, axis) {
        if (axis === 'y') {
          frameRect(w, 2.4, '#f3f1ec');
          bars(w, 2, 2, 1.3, '#f3f1ec');
          rect(w.a1 - 4, w.b2 + 2.4, w.a2 - w.a1 + 8, 2, '#d5d0c6');
        } else frameRect(w, 1.1, tn('#bdb6a8'));
      },
      over(e, axis) {
        const L = e.L;
        if (axis === 'y') {
          // a longboard leaning on the wall
          const a = 0.46 * L;
          ctx.save();
          ctx.translate(a, 53);
          ctx.rotate(-0.07);
          ellipse(0, 0, 6.2, 33, '#f3eee2');
          rect(-0.6, -32, 1.2, 64, '#2f8f9d');
          ctx.restore();
        } else {
          const a = L + 0.07 * L;
          rect(a, 32, 0.13 * L, 17, tn('#a9adb0'));
          rect(a + 1.2, 33.2, 0.13 * L - 2.4, 14.6, tn('#b9bdc0'));
          rect(a + 0.065 * L - 1.5, 38, 3, 5, '#f2c14e');
        }
      },
      sign: {
        area: ({ L }) => ({ a1: L + 0.3 * L, a2: L + 0.9 * L, b1: 7, b2: 21 }),
        draw(e, ar, text) {
          ctx.fillStyle = '#f6f1e4';
          ctx.beginPath();
          ctx.moveTo(ar.a1, ar.b1);
          ctx.lineTo(ar.a2, ar.b1);
          ctx.lineTo(ar.a2, ar.b2);
          ctx.quadraticCurveTo((ar.a1 + ar.a2) / 2, ar.b2 + 2, ar.a1, ar.b2);
          ctx.fill();
          rect(ar.a1 - 1, ar.b1 - 1, 5, 2.4, 'rgba(200,190,160,0.9)');
          rect(ar.a2 - 4, ar.b1 - 1, 5, 2.4, 'rgba(200,190,160,0.9)');
          signText(text, ar, { color: '#2c3a6b', size: 0.66 });
        },
      },
    },
    mission: {
      windows({ N, L }) {
        const w = 0.95, gap = 0.28, span = 3 * w + 2 * gap;
        const s0 = Math.max(0.4, Math.min(N - 0.4 - span, 0.56 * N - span / 2));
        const y = [0, 1, 2].map((i) => ({ a1: (s0 + i * (w + gap)) * WU, a2: (s0 + i * (w + gap) + w) * WU, b1: 13, b2: 59 }));
        return { y, x: winRow(L, 0.56 * N, N - 0.3, 0.95, 1.9, 13, 59) };
      },
      texture(e, axis, A0) {
        const trim = e.office.trim, L = e.L;
        rect(A0, 0, L, 4, tn(trim));
        rect(A0, 4, L, 1.2, tn(mix(trim, -0.18)));
        rect(A0, 8.5, L, 1.1, tn(trim));
        rect(A0, 63, L, 19, tn(mix(trim, -0.05)));
        rect(A0, 62, L, 2.2, tn(trim));
        ctx.strokeStyle = tn(mix(trim, -0.16));
        ctx.lineWidth = 0.8;
        for (let a = A0 + 3; a < A0 + L - 8; a += WU * 0.75) ctx.strokeRect(a, 66.5, WU * 0.75 - 6, 12);
        ctx.lineWidth = 1;
      },
      glass: (w) => sheen(w, 0.16),
      frame(w) {
        const tc = tn('#f7f2e6'), sh = tn('#d6cdbb'), W = w.a2 - w.a1;
        frameRect(w, 3.4, tc);
        rect(w.a1, (w.b1 + w.b2) / 2 - 1.4, W, 2.8, tc);
        rect(w.a1 + W / 2 - 0.6, w.b1, 1.2, (w.b2 - w.b1) / 2, tc);
        rect(w.a1 - 6, w.b1 - 8, W + 12, 4.4, tc);
        rect(w.a1 - 4.5, w.b1 - 3.6, W + 9, 0.9, sh);
        rect(w.a1 - 5, w.b2 + 3.4, W + 10, 2.6, tc);
        rect(w.a1 - 4, w.b2 + 6, W + 8, 0.9, sh);
      },
      sign: {
        area: ({ N, L }) => ({ a1: L + 0.45 * WU, a2: L + (0.56 * N - 0.45) * WU, b1: 26, b2: 44 }),
        draw(e, ar, text) {
          rect(ar.a1 - 1.6, ar.b1 - 1.6, ar.a2 - ar.a1 + 3.2, ar.b2 - ar.b1 + 3.2, tn('#c9a54c'));
          rect(ar.a1, ar.b1, ar.a2 - ar.a1, ar.b2 - ar.b1, tn('#2f4a3a'));
          signText(text, ar, { color: '#ecd9a0', size: 0.56 });
        },
      },
    },
    soma: {
      windows: ({ N, L }) => ({ y: winRow(0, 0.4, N - 0.4, 2, 3, 15, 70), x: winRow(L, 0.46 * N, N - 0.4, 2, 3, 15, 70) }),
      texture(e, axis, A0) {
        const L = e.L, base = axis === 'y' ? e.office.wall : e.office.wallSide, rowH = 5.2, bw = 12.5;
        ctx.fillStyle = mix(base, -0.13);
        for (let r = 0, b = 0; b < BH; r++, b += rowH) {
          const off = (r % 2) * bw * 0.5;
          for (let i = 0, a = A0 - off; a < A0 + L; i++, a += bw) if (nh(r * 977 + i * 131 + (axis === 'y' ? 0 : 5)) < 0.16) ctx.fillRect(a + 0.5, b + 0.5, bw - 1, rowH - 1);
        }
        ctx.fillStyle = mix(base, 0.08);
        for (let r = 0, b = 0; b < BH; r++, b += rowH) {
          const off = (r % 2) * bw * 0.5;
          for (let i = 0, a = A0 - off; a < A0 + L; i++, a += bw) if (nh(r * 571 + i * 313 + 9 + (axis === 'y' ? 0 : 5)) < 0.1) ctx.fillRect(a + 0.5, b + 0.5, bw - 1, rowH - 1);
        }
        ctx.fillStyle = 'rgba(232,214,196,0.32)';
        for (let r = 0, b = 0; b < BH; r++, b += rowH) {
          ctx.fillRect(A0, b, L, 0.7);
          const off = (r % 2) * bw * 0.5;
          for (let a = A0 - off; a < A0 + L; a += bw) if (a > A0) ctx.fillRect(a, b, 0.7, rowH);
        }
        rect(A0, 0, L, 5, tn('#393c40'));
        rect(A0, 5, L, 0.9, tn('#2a2c2f'));
      },
      glass: (w) => sheen(w, 0.14, 'rgba(225,232,228,0.08)'),
      frame(w) {
        const c = tn('#2d3134'), W = w.a2 - w.a1, H = w.b2 - w.b1;
        frameRect(w, 3, c);
        bars(w, Math.max(2, Math.round(W / 17)), 5, 1.2, c);
        rect(w.a1, w.b1 + H * 0.6 - 1.1, W, 2.2, c);
        rect(w.a1 - 4, w.b2 + 3, W + 8, 3, tn('#8f8a84'));
      },
      over(e, axis, A0) {
        if (axis !== 'x') return;
        const L = e.L;
        rect(A0, 6.5, L, 7, vgrad(6.5, 13.5, ['#dfe3e6', '#a2a9af']));
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let a = A0 + 20; a < A0 + L; a += 34) ctx.fillRect(a, 6.5, 0.8, 7);
      },
      sign: {
        area: ({ N, L }) => ({ a1: L + 0.4 * WU, a2: L + (0.46 * N - 0.5) * WU, b1: 22, b2: 46 }),
        draw(e, ar, text) {
          ctx.strokeStyle = 'rgba(244,236,220,0.8)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(ar.a1, ar.b1, ar.a2 - ar.a1, ar.b2 - ar.b1);
          ctx.lineWidth = 1;
          signText(text, ar, { color: 'rgba(246,238,222,0.9)', size: 0.5 });
        },
      },
    },
    missionbay: {
      windows: ({ N, L }) => ({ y: [{ a1: 0.12 * WU, a2: L - 0.12 * WU, b1: 6, b2: 82 }], x: [{ a1: L + 0.36 * L, a2: 2 * L - 0.12 * WU, b1: 6, b2: 82 }] }),
      under(e, axis) {
        if (axis !== 'x') return;
        const L = e.L, a1 = L + 0.5 * WU, a2 = L + 0.36 * L - 0.7 * WU;
        rect(a1, 42, a2 - a1, 34, '#4f7a45');
        const g = ['#5f8f4f', '#6fa35b', '#86b86b', '#4a7440', '#9cc77a'];
        for (let i = 0; i < 45; i++) {
          const a = a1 + 2 + nh(i + 3000) * (a2 - a1 - 4), b = 44 + nh(i + 3100) * 30;
          dot(a, b, 1.6 + nh(i + 3200) * 2.2, g[i % 5]);
        }
        rect(a1 - 1.5, 40.5, a2 - a1 + 3, 1.5, tn('#50707f'));
        rect(a1 - 1.5, 76, a2 - a1 + 3, 1.5, tn('#50707f'));
      },
      glass: (w) => sheen(w, 0.12, 'rgba(200,230,240,0.07)'),
      frame(w) {
        const c = tn('#5d7b88');
        frameRect(w, 2.4, c);
        bars(w, Math.max(1, Math.round((w.a2 - w.a1) / (1.4 * WU))), 1, 1.8, c);
        rect(w.a1, 19, w.a2 - w.a1, 1.5, c);
      },
      sign: {
        area: ({ L }) => ({ a1: L + 0.5 * WU, a2: L + 0.36 * L - 0.7 * WU, b1: 14, b2: 34 }),
        draw(e, ar, text) {
          rect(ar.a1, ar.b1, ar.a2 - ar.a1, ar.b2 - ar.b1, tn('#eef3f4'));
          rect(ar.a1, ar.b1, 3, ar.b2 - ar.b1, e.office.trim);
          signText(text, { a1: ar.a1 + 3, a2: ar.a2, b1: ar.b1, b2: ar.b2 }, { color: '#24303b', size: 0.52 });
        },
      },
    },
    fidi: {
      windows: ({ L }) => ({ y: [{ a1: 0.1 * WU, a2: L - 0.1 * WU, b1: 9, b2: 80 }], x: [{ a1: L + 0.34 * L, a2: 2 * L - 0.1 * WU, b1: 9, b2: 80 }] }),
      texture(e, axis, A0) {
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        for (let a = A0 + WU * 1.5; a < A0 + e.L; a += WU * 1.5) ctx.fillRect(a, 0, 0.9, BH);
      },
      glass: (w) => sheen(w, 0.1, 'rgba(14,28,44,0.3)'),
      frame(w) {
        const c = tn('#1f262d');
        frameRect(w, 3, c);
        bars(w, Math.max(1, Math.round((w.a2 - w.a1) / WU)), 1, 2.2, c);
        rect(w.a1 - 3, w.b1 - 4.6, w.a2 - w.a1 + 6, 1.1, '#b8962e');
      },
      sign: {
        area: ({ L }) => ({ a1: L + 0.5 * WU, a2: L + 0.34 * L - 0.6 * WU, b1: 22, b2: 56 }),
        draw(e, ar, text) {
          signText(text, ar, { color: '#dcb955', size: 0.5 });
          rect(ar.a1 + 4, ar.b2 + 2, ar.a2 - ar.a1 - 8, 0.9, '#b8962e');
        },
      },
    },
    presidio: {
      windows: ({ N, L }) => ({ y: winRow(0, 0.5, N - 0.5, 1.3, 2.3, 14, 62), x: winRow(L, 0.33 * N, N - 0.5, 1.3, 2.3, 14, 62) }),
      texture(e, axis, A0) {
        const L = e.L;
        rect(A0, 68, L, 14, tn(mix(e.office.wall, -0.05)));
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let a = A0 + 3; a < A0 + L; a += 3.2) ctx.fillRect(a, 68, 0.6, 14);
        rect(A0, 66.5, L, 2.2, tn(e.office.trim));
        rect(A0, 0, L, 3, tn(mix(e.office.wall, -0.08)));
      },
      glass: (w) => sheen(w, 0.15),
      frame(w) {
        const wood = tn('#8b5e3c'), W = w.a2 - w.a1;
        frameRect(w, 3.4, wood);
        bars(w, 3, 4, 1.1, wood);
        rect(w.a1, (w.b1 + w.b2) / 2 - 1.3, W, 2.6, wood);
        rect(w.a1 - 5, w.b2 + 3.4, W + 10, 3, tn('#9c6c47'));
      },
      sign: {
        area: ({ N, L }) => ({ a1: L + 0.5 * WU, a2: L + (0.33 * N - 0.3) * WU, b1: 21, b2: 49 }),
        draw(e, ar, text) {
          rect(ar.a1 - 1.5, ar.b1 - 1.5, ar.a2 - ar.a1 + 3, ar.b2 - ar.b1 + 3, tn('#e9e1cc'));
          rect(ar.a1, ar.b1, ar.a2 - ar.a1, ar.b2 - ar.b1, tn(e.office.trim));
          signText(text, ar, { color: '#f4eedd', size: 0.54 });
        },
      },
    },
    treasure: {
      windows: ({ L }) => ({ y: [{ a1: 0.1 * WU, a2: L - 0.1 * WU, b1: 4, b2: 83 }], x: [{ a1: L + 0.27 * L, a2: 2 * L - 0.1 * WU, b1: 4, b2: 83 }] }),
      glass: (w) => sheen(w, 0.08, 'rgba(20,26,48,0.1)'),
      frame(w) {
        const c = tn('#3a4450'), W = w.a2 - w.a1, H = w.b2 - w.b1;
        frameRect(w, 2.4, c);
        bars(w, Math.max(1, Math.round(W / (2 * WU))), 1, 1.5, c);
        const cols = Math.round(W / (6.5 * WU));
        for (let i = 1; i < cols; i++) rect(w.a1 + (W * i) / cols - 3, w.b1, 6, H, tn('#5e6a75'));
        rect(w.a1, w.b1 - 2.6, W, 1.2, '#c0362c');
      },
      sign: {
        area: ({ L }) => ({ a1: L + 0.5 * WU, a2: L + 0.27 * L - 0.6 * WU, b1: 20, b2: 60 }),
        draw(e, ar, text) {
          signText(text, ar, { color: '#ff7a4d', glow: 'rgba(255,110,60,0.25)', size: 0.5 });
          rect(ar.a1 + 4, ar.b2 + 3, ar.a2 - ar.a1 - 8, 1, '#c0362c');
        },
      },
    },
    fallback: {
      windows: ({ N, L }) => ({ y: winRow(0, 0.5, N - 0.5, 1.6, 2.6, 14, 64), x: winRow(L, 0.4 * N, N - 0.5, 1.6, 2.6, 14, 64) }),
      glass: (w) => sheen(w, 0.15),
      frame(w) {
        frameRect(w, 2.6, tn('#e8ecef'));
        bars(w, 2, 1, 1.4, tn('#e8ecef'));
      },
      sign: {
        area: ({ N, L }) => ({ a1: L + 0.5 * WU, a2: L + (0.4 * N - 0.4) * WU, b1: 24, b2: 44 }),
        draw(e, ar, text) {
          signText(text, ar, { color: '#24303b', size: 0.55 });
        },
      },
    },
  };
  const SHELL_BY_VIEW = { ocean: 'sunset', victorians: 'mission', baybridge: 'soma', ballpark: 'missionbay', skyline: 'fidi', goldengate: 'presidio', citywater: 'treasure' };
  const shellOf = (office) => SHELLS[office.id] || SHELLS[SHELL_BY_VIEW[office.view]] || SHELLS.fallback;

  // everything on one back wall, in its wall frame
  function paintWall(axis, e, shell, view, fogAmt) {
    const { N, L, office, company } = e, h = BH;
    const A0 = axis === 'y' ? 0 : L;
    wallShade = axis === 'x' ? 0.07 : 0;
    rect(A0, 0, L, h, axis === 'y' ? office.wall : office.wallSide);
    if (shell.texture) shell.texture(e, axis, A0);
    if (shell.under) shell.under(e, axis, A0);
    const wins = e.wins[axis] || [];
    if (wins.length) {
      ctx.save();
      ctx.beginPath();
      for (const w of wins) ctx.rect(w.a1, w.b1, w.a2 - w.a1, w.b2 - w.b1);
      ctx.clip();
      view(e, A0, A0 + L);
      if (fogAmt > 0.01) rect(A0, 0, L, h, `rgba(232,236,238,${(0.55 * fogAmt).toFixed(3)})`);
      for (const w of wins) shell.glass(w, axis);
      ctx.restore();
      for (const w of wins) shell.frame(w, axis);
    }
    if (shell.over) shell.over(e, axis, A0);
    if (axis === 'x' && shell.sign && company) {
      const ar = shell.sign.area({ N, L });
      if (ar && ar.a2 - ar.a1 > 24) shell.sign.draw(e, ar, company.toUpperCase());
    }
    rect(A0, h - 4, L, 4, axis === 'y' ? mix(office.trim, 0.1) : mix(office.trim, -0.05));
    wallShade = 0;
  }

  // The main view keeps each wall as a picture at about screen resolution and
  // repaints it a few times a second (for twinkling lights and drifting fog),
  // so a frame costs one drawImage per wall instead of hundreds of shapes.
  const wallCache = {};
  const WALL_REPAINT = 0.15;
  function wallLayer(axis, e, shell, view, fogAmt, t, scale) {
    const L = e.L, A0 = axis === 'y' ? 0 : L;
    const k = Math.min(Math.pow(2, Math.ceil(Math.log2(Math.max(0.25, scale * 1.15)) * 4) / 4), 4096 / L, 1024 / BH);
    const key = [e.office.id, e.N, e.company, k, Math.round(fogAmt * 20)].join('|');
    let c = wallCache[axis];
    if (!c) c = wallCache[axis] = { cv: document.createElement('canvas'), key: '', at: -1e9 };
    // the two walls take turns so their repaints land on different frames
    const due = !calm() && t - c.at >= WALL_REPAINT && (axis === 'y' ? Math.floor(t / (WALL_REPAINT / 2)) % 2 === 0 : Math.floor(t / (WALL_REPAINT / 2)) % 2 === 1);
    if (c.key !== key || due || t < c.at || t - c.at > WALL_REPAINT * 3) {
      const w = Math.ceil(L * k), h = Math.ceil(BH * k);
      if (c.cv.width !== w || c.cv.height !== h) {
        c.cv.width = w;
        c.cv.height = h;
      }
      const prev = ctx;
      ctx = c.cv.getContext('2d');
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.setTransform(k, 0, 0, k, -A0 * k, 0);
        paintWall(axis, e, shell, view, fogAmt);
      } finally {
        ctx = prev;
      }
      c.key = key;
      c.at = t;
    }
    ctx.drawImage(c.cv, A0, 0, L, BH);
  }

  // scale: device pixels per world unit for the cached main view; omit to paint directly
  function drawWalls(N, office, company, t, fogAmt, scale) {
    const h = WALL_H, L = N * WU;
    const shell = shellOf(office);
    const view = VIEWS[office.view] || VIEWS.fallback;
    const e = { N, L, office, company, t: calm() ? 0 : t, wins: shell.windows({ N, L }) };
    if (office.view === 'goldengate') {
      // eucalyptus between the windows: a few on the left wall, a grove on the right
      e.treeSpots = [];
      for (const [wins, lo, n] of [[e.wins.y, 0, 3], [e.wins.x, L, 5]]) {
        for (let i = 0; i < n; i++) {
          const w = wins[Math.floor(((i + 0.5) / n) * wins.length)];
          if (!w || (lo === 0 && i === 1)) continue;
          e.treeSpots.push([i % 2 ? w.a2 - 6 : w.a1 + 6, 58 + nh(i * 13 + lo) * 22]);
        }
      }
    }
    for (const axis of ['y', 'x']) {
      ctx.save();
      wallFrame(axis, N);
      if (scale) wallLayer(axis, e, shell, view, fogAmt, t, scale);
      else paintWall(axis, e, shell, view, fogAmt);
      ctx.restore();
    }
    // wall thickness: top caps and the two exposed ends
    const th = 0.16;
    poly([P(0, 0, 0, 0, h), P(0, 0, 0, N, h), P(0, 0, -th, N, h), P(0, 0, -th, -th, h)], office.trim);
    poly([P(0, 0, 0, 0, h), P(0, 0, N, 0, h), P(0, 0, N, -th, h), P(0, 0, -th, -th, h)], mix(office.trim, -0.1));
    poly([P(0, 0, -th, N, 0), P(0, 0, 0, N, 0), P(0, 0, 0, N, h), P(0, 0, -th, N, h)], mix(office.trim, 0.12));
    poly([P(0, 0, N, 0, 0), P(0, 0, N, -th, 0), P(0, 0, N, -th, h), P(0, 0, N, 0, h)], mix(office.trim, -0.2));
  }

  // ---------- fog rolling through the office ----------
  const fog = { amt: 0 };
  function fogTarget(s, office, t) {
    if ((s.effects || []).some((ef) => ef.label === 'Fog' && ef.until > s.day)) return 1;
    if (office.id === 'sunset' || office.view === 'ocean') {
      // the Outer Sunset gets a faint wisp now and then
      const k = 0.6 * Math.sin(t * 0.045) + 0.4 * Math.sin(t * 0.019 + 1.3);
      return k > 0.2 ? 0.28 * Math.min(1, (k - 0.2) / 0.35) : 0;
    }
    return 0;
  }
  const FOG_PHASE = [0.5, 0.33, 0.66, 0.44];
  function drawFog(N, amt, t) {
    if (amt < 0.01) return;
    const h = WALL_H, span = N * TW, tt = calm() ? 0 : t;
    const pts = [P(0, 0, 0, N, h), P(0, 0, 0, 0, h), P(0, 0, N, 0, h), P(0, 0, N, 0, -SLAB), P(0, 0, N, N, -SLAB), P(0, 0, 0, N, -SLAB)];
    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    for (let i = 0; i < 4; i++) {
      const rx = span * (0.34 + 0.08 * (i % 2)), ry = N * TH * 0.1 + 16;
      const half = span / 2 + rx, period = 2 * half;
      const x = ((((tt * (5 + i * 2.2) + FOG_PHASE[i] * period) % period) + period) % period) - half;
      const y = N * TH * (0.1 + i * 0.25) - h * 0.3;
      blob(x, y, rx, ry, '238,242,244', (0.3 + 0.08 * (i % 2)) * amt);
    }
    ctx.restore();
  }

  // ---------- background ----------
  // The stage follows the page theme through --stage-bg and --stage-grid.
  const STAGE_BG = '#dfe5e8', STAGE_GRID = '#cdd5da';
  let stageBg = STAGE_BG, stageGrid = STAGE_GRID, stageDark = false, themeAt = -1e9;
  function luminance(col) {
    ctx.fillStyle = '#000';
    ctx.fillStyle = col;
    const v = String(ctx.fillStyle);
    let r = 0, g = 0, b = 0;
    if (v[0] === '#') {
      const n = parseInt(v.slice(1, 7), 16);
      r = n >> 16;
      g = (n >> 8) & 255;
      b = n & 255;
    } else {
      const m = v.match(/[\d.]+/g) || [];
      [r, g, b] = m.map(Number);
    }
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function readTheme(force) {
    if (!ctx) return;
    let bg = '', grid = '';
    try {
      const cs = getComputedStyle(document.documentElement);
      bg = cs.getPropertyValue('--stage-bg').trim();
      grid = cs.getPropertyValue('--stage-grid').trim();
    } catch (err) {
      /* no DOM styles */
    }
    bg = bg || STAGE_BG;
    grid = grid || STAGE_GRID;
    if (!force && bg === stageBg && grid === stageGrid && bgPattern) return;
    stageBg = bg;
    stageGrid = grid;
    stageDark = luminance(bg) < 0.4;
    makePattern();
  }
  function makePattern() {
    const c = document.createElement('canvas');
    c.width = c.height = 22 * dpr;
    const g = c.getContext('2d');
    g.fillStyle = stageGrid;
    g.beginPath();
    g.arc(11 * dpr, 11 * dpr, 1.1 * dpr, 0, Math.PI * 2);
    g.fill();
    bgPattern = /^(transparent|none|rgba\([^)]*,\s*0\))$/.test(stageGrid) ? null : ctx.createPattern(c, 'repeat');
  }

  // ---------- public API ----------
  R.init = function (canvas, callbacks) {
    cv = canvas;
    ctx = cv.getContext('2d');
    cb = callbacks;
    R.resize();
    bindInput();
    // follow theme switches right away; draw() also re-reads every couple of seconds
    const onTheme = () => readTheme();
    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
      else if (mq.addListener) mq.addListener(onTheme);
    } catch (err) {
      /* no matchMedia */
    }
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(onTheme);
      for (const el of [document.documentElement, document.body]) if (el) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
  };

  R.resize = function () {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    readTheme(true);
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

  const itemAt = (s, x, y) => AIT.Sim.itemAt(s, x, y);

  // what a placed item reaches: boards help researchers, comfort helps desks
  const RANGE_COL = { office: ['rgba(255,176,0,0.10)', 'rgba(214,140,0,0.8)'], comfort: ['rgba(46,155,103,0.10)', 'rgba(46,155,103,0.8)'] };
  const rangeOf = (type) => D.ITEMS[type].radius || 0;

  // ---------- drawing ----------
  R.draw = function (t, dt, s, v, running) {
    if (!ctx) return;
    const office = D.OFFICES[s.officeLevel];
    const N = office.size;
    if (N !== lastSize) R.fit(N);

    if (t - themeAt > 2 || t < themeAt) {
      themeAt = t;
      readTheme();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = stageBg;
    ctx.fillRect(0, 0, W, H);
    if (bgPattern) {
      ctx.fillStyle = bgPattern;
      ctx.fillRect(0, 0, W, H);
    }

    const fogWant = fogTarget(s, office, t);
    fog.amt += (fogWant - fog.amt) * Math.min(1, Math.max(0, dt || 0) * 0.6);
    if (Math.abs(fogWant - fog.amt) < 0.002) fog.amt = fogWant;

    const z = R.cam.z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * R.cam.x, dpr * R.cam.y);
    drawSlab(N, office);
    drawFloor(N, office);
    drawWalls(N, office, s.company, t, fog.amt, z * dpr);

    const h = R.hover;
    const inside = h && h.x >= 0 && h.y >= 0 && h.x < N && h.y < N;
    const hoverItem = inside ? itemAt(s, h.x, h.y) : null;
    // a filled rectangle of tiles on the floor, clipped to the office
    const rectFill = (x, y, w, hgt, fill, stroke, dash) => {
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(N, x + w), y1 = Math.min(N, y + hgt);
      if (x1 <= x0 || y1 <= y0) return;
      const pts = [P(0, 0, x0, y0, 0), P(0, 0, x1, y0, 0), P(0, 0, x1, y1, 0), P(0, 0, x0, y1, 0)];
      ctx.lineWidth = 2 / z;
      if (dash) ctx.setLineDash([6 / z, 4 / z]);
      poly(pts, fill, stroke);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    const footFill = (it, fill, stroke) => {
      const n = it.legacy ? 1 : D.ITEMS[it.type].size || 1;
      rectFill(it.x, it.y, n, n, fill, stroke);
    };
    const rangeFill = (it, strong) => {
      const r = rangeOf(it.type), n = it.legacy ? 1 : D.ITEMS[it.type].size || 1;
      const col = RANGE_COL[D.ITEMS[it.type].cat] || RANGE_COL.comfort;
      if (r) rectFill(it.x - r, it.y - r, n + 2 * r, n + 2 * r, strong ? col[0].replace('0.10', '0.16') : col[0], col[1], true);
    };
    let ghost = null;
    const tool = R.tool;
    if (tool && tool.mode === 'place') {
      // placing a desk shows where boards and comfort items already reach
      if (tool.type === 'desk') for (const it of s.items) if (D.ITEMS[it.type].rpBonus || D.ITEMS[it.type].decor) rangeFill(it, false);
    }
    if (R.selected) {
      const it = s.items.find((i) => i.id === R.selected);
      if (it) {
        rangeFill(it, true);
        footFill(it, 'rgba(239,95,36,0.18)', '#ef5f24');
      } else R.selected = null;
    }
    if (inside && tool && tool.mode === 'place') {
      const why = AIT.Sim.canPlace(s, tool.type, h.x, h.y);
      const okTile = !why && !AIT.Sim.itemLocked(s, tool.type) && s.cash >= AIT.Sim.itemCost(s, tool.type);
      const g = { id: -1, type: tool.type, x: h.x, y: h.y, ghost: true };
      rangeFill(g, true);
      footFill(g, okTile ? 'rgba(46,155,103,0.25)' : 'rgba(207,63,53,0.25)', okTile ? '#2e9b67' : '#cf3f35');
      if (!why) ghost = g;
    } else if (inside && tool && tool.mode === 'sell') {
      if (hoverItem) footFill(hoverItem, 'rgba(207,63,53,0.28)', '#cf3f35');
      else rectFill(h.x, h.y, 1, 1, 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.2)');
    } else if (inside && !tool) {
      if (hoverItem) footFill(hoverItem, 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.8)');
      else rectFill(h.x, h.y, 1, 1, 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.8)');
    }

    // who sits where
    const desks = s.items.filter((i) => D.ITEMS[i.type].seats).sort((a, b) => a.id - b.id);
    const deskStaff = new Map();
    for (const [pid, desk] of AIT.Sim.seating(s)) deskStaff.set(desk.id, s.staff.find((p) => p.id === pid));
    const mode = s.training && v.trainPF > 0 ? 'train' : v.flagship ? 'serve' : 'idle';
    const info = { deskStaff, training: !!s.training, mode };
    const hotInfo = Object.assign({}, info, { mode: 'hot' });

    updateLife(t, dt, s, v, running, N, desks, deskStaff);
    info.walking = new Set(life.walkers.keys());
    const list = ghost ? s.items.concat([ghost]) : s.items;
    // depth: the centre of each footprint, so 2×2 items sort with their neighbours
    const drawables = list.map((it) => {
      const n = it.legacy ? 1 : D.ITEMS[it.type].size || 1;
      return { it, n, k: it.x + it.y + n, kx: it.x };
    });
    for (const w of life.walkers.values()) {
      const [wx, wy] = walkerPos(w);
      drawables.push({ w, k: wx + wy + 0.05, kx: wx });
    }
    drawables.sort((a, b) => a.k - b.k || a.kx - b.kx);
    const sorted = drawables;
    const brown = v.powerFactor < 1;
    for (const d of sorted) {
      if (d.w) {
        drawWalker(d.w, t);
        continue;
      }
      const it = d.it;
      const art = ART[it.type];
      if (!art) continue;
      // big items are drawn at double size around the centre of their footprint
      const [cx, cy] = d.n > 1 ? P(0, 0, it.x + d.n / 2, it.y + d.n / 2, 0) : tileCenter(it.x, it.y);
      const heat = it.ghost ? 1 : v.itemHeat.get(it.id);
      ctx.save();
      if (it.ghost) ctx.globalAlpha = 0.55;
      else if (brown && D.ITEMS[it.type].cat === 'compute' && Math.sin(t * 20 + it.id) > 0.6) ctx.globalAlpha = 0.75;
      if (d.n > 1) {
        ctx.translate(cx, cy);
        ctx.scale(d.n, d.n);
        art(0, 0, it, t, heat != null && heat < 0.8 ? hotInfo : info);
      } else art(cx, cy, it, t, heat != null && heat < 0.8 ? hotInfo : info);
      ctx.restore();
      if (heat != null && heat < 1) {
        // the hotter the GPU, the stronger the glow
        const a = (0.15 + 0.45 * (1 - heat)) * (0.75 + 0.25 * Math.sin(t * 4 + it.id));
        ctx.fillStyle = `rgba(255,70,50,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 20 * d.n, 20 * d.n, 12 * d.n, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawFog(N, fog.amt, t);
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
    // draw on a roomy scratch canvas, then shrink tall items so nothing gets cut off
    const S = 2, B = 76 * S, big = document.createElement('canvas');
    big.width = big.height = B * 3;
    const prev = ctx;
    ctx = big.getContext('2d');
    ctx.setTransform(S, 0, 0, S, B, B);
    const pts = [P(38, 52, -0.5, -0.5, 0), P(38, 52, 0.5, -0.5, 0), P(38, 52, 0.5, 0.5, 0), P(38, 52, -0.5, 0.5, 0)];
    poly(pts, 'rgba(28,35,44,0.07)');
    const dummy = { deskStaff: new Map(), training: false, mode: 'serve' };
    try {
      if (ART[type]) ART[type](38, 52, { id: 3, type, x: 0, y: 0 }, 1.2, dummy);
    } finally {
      ctx = prev;
    }
    const c = document.createElement('canvas');
    c.width = c.height = B;
    const g = c.getContext('2d');
    let x0 = B, y0 = B, x1 = 2 * B, y1 = 2 * B;
    try {
      const px = big.getContext('2d').getImageData(0, 0, big.width, big.height).data, n = big.width;
      let minX = n, minY = n, maxX = -1, maxY = -1;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (px[(y * n + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const pad = 3 * S;
      if (maxX >= 0 && (minX < B + pad || maxX > 2 * B - pad || minY < B + pad || maxY > 2 * B - pad)) {
        const w = maxX - minX + 1, h = maxY - minY + 1;
        const k = Math.min(1, (B - 2 * pad) / w, (B - 2 * pad) / h);
        const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;
        x0 = cxm - B / 2 / k;
        x1 = cxm + B / 2 / k;
        y0 = cym - B / 2 / k;
        y1 = cym + B / 2 / k;
      }
    } catch (err) {
      /* fall back to the plain frame */
    }
    g.drawImage(big, x0, y0, x1 - x0, y1 - y0, 0, 0, B, B);
    iconCache[type] = c.toDataURL();
    return iconCache[type];
  };

  // small picture of an office for chapter cards
  const previewCache = {};
  const PREVIEW_SIG = ['rig', 'workstation', 'workstation', 'server', 'rack', 'superpod', 'wafer'];
  const PREVIEW_PROPS = [['bikes', 'couch'], ['dog', 'coffee'], ['kombucha', 'couch'], ['nap_pod', 'coffee'], ['arcade', 'kombucha'], ['dog', 'bikes'], ['kombucha', 'arcade']];
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
    try {
      const z = Math.min(PW / (N * TW + 40), PH / (N * TH + WALL_H + SLAB + 30));
      ctx.setTransform(S * z, 0, 0, S * z, (S * PW) / 2, S * (PH / 2 - ((N * TH) / 2) * z + ((WALL_H - SLAB) / 2) * z));
      drawSlab(N, office);
      drawFloor(N, office);
      drawWalls(N, office, company, 1, 0);
      const sig = PREVIEW_SIG[Math.min(level, PREVIEW_SIG.length - 1)];
      const n = D.ITEMS[sig].size || 1;
      const props = [];
      const roles = ['researcher', 'engineer', 'growth', 'safety'];
      const staff = new Map();
      for (let y = 1; y + n - 1 < Math.max(2, Math.floor(N / 2)); y += n) for (let x = Math.ceil(N / 2); x + n - 1 < N - 1; x += n) props.push({ id: props.length + 1, type: sig, x, y, n });
      for (let y = Math.ceil(N / 2); y < N - 1; y += 2) {
        for (let x = 1; x < Math.floor(N / 2); x += 2) {
          const it = { id: 1000 + props.length, type: 'desk', x, y };
          staff.set(it.id, { id: 'pv' + it.id, role: roles[props.length % 4] });
          props.push(it);
        }
      }
      props.push({ id: 5000, type: 'plant', x: 0, y: N - 1 });
      const extra = PREVIEW_PROPS[Math.min(level, PREVIEW_PROPS.length - 1)];
      props.push({ id: 5001, type: extra[0], x: 0, y: Math.floor(N / 2) });
      if (Math.floor(N / 2) - 2 >= 0) props.push({ id: 5002, type: extra[1], x: 0, y: Math.floor(N / 2) - 2 });
      const info = { deskStaff: staff, training: false, mode: 'serve' };
      const depth = (it) => it.x + it.y + (it.n || 1);
      props.sort((a, b) => depth(a) - depth(b) || a.x - b.x);
      for (const it of props) {
        if (it.n > 1) {
          const [cx, cy] = P(0, 0, it.x + it.n / 2, it.y + it.n / 2, 0);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(it.n, it.n);
          ART[it.type](0, 0, it, 1.2, info);
          ctx.restore();
        } else {
          const [cx, cy] = tileCenter(it.x, it.y);
          ART[it.type](cx, cy, it, 1.2, info);
        }
      }
    } finally {
      ctx = prev;
    }
    previewCache[key] = c.toDataURL();
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
