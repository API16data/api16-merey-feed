// API16 home: scroll-driven 3D tanker on a black stage.
// The ship is built from simple shapes (no external model); its rotation and the camera follow the
// scroll position of #stage. Text steps fade in and out at the side, with live figures from the feed.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('stage-c');
const stepsBox = document.getElementById('st-steps');
const prog = document.querySelector('#stage .st-prog i');
const hint = document.querySelector('#stage .st-hint');
const lang = () => (window.API16_LANG ? window.API16_LANG() : (document.documentElement.lang || 'en'));
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- live figures ----------
const LIVEV = { merey: null, mereyDate: null, flowMonth: null };
const getJ = (p) => fetch(p + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
Promise.all([getJ('tracker/data/spot_prices_daily.json'), getJ('data/merey_brent_monthly.json'), getJ('tracker/data/flows.json')]).then(([S, M, F]) => {
  const rows = (S && S.rows) || [];
  const last = rows[rows.length - 1];
  const opec = (M || []).filter((m) => m.merey && m.brent).slice(-1)[0];
  if (last && opec) { LIVEV.merey = last.brent - (opec.brent - opec.merey); LIVEV.mereyDate = last.date; }
  else if (opec) { LIVEV.merey = opec.merey; LIVEV.mereyDate = opec.month; }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const done = ((F && F.months) || []).filter((m) => m.month < thisMonth && m.official_kbd);
  LIVEV.flowMonth = done[done.length - 1] || null;
  renderSteps();
});

// ---------- text steps ----------
const MES = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
function steps() {
  const es = lang() === 'es';
  const nf = (d) => new Intl.NumberFormat(es ? 'es-VE' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const mr = LIVEV.merey;
  const cargoUsd = mr ? 'US$' + nf(0).format(650000 * mr / 1e6) + (es ? ' millones' : ' million') : (es ? 'decenas de millones de US$' : 'tens of millions of US$');
  const fm = LIVEV.flowMonth;
  const fmName = fm ? MES[es ? 'es' : 'en'][+fm.month.slice(5, 7) - 1] + ' ' + fm.month.slice(0, 4) : '';
  const n = fm ? fm.high_n + fm.possible_n : null;
  const kbd = fm ? fm.with_possible_kbd : null;
  const cov = fm && fm.coverage_with_possible ? Math.round(fm.coverage_with_possible * 100) : null;
  return [
    { k: es ? 'API16 · DATOS ABIERTOS' : 'API16 · OPEN DATA', h: es ? 'Crudo venezolano, barco por barco.' : 'Venezuelan crude, ship by ship.',
      t: es ? ['Cada tanquero de Venezuela a refinerías de EE. UU.', 'cotejado con la EIA y la aduana de EE. UU.'] : ['Every tanker from Venezuela to U.S. refineries,', 'checked against EIA and U.S. customs.'] },
    { k: es ? '01 · EL BUQUE' : '01 · THE SHIP', h: es ? 'Tanquero Aframax' : 'Aframax tanker',
      t: es ? ['250 m × 44 m · ~115.000 t de peso muerto', 'El caballo de batalla de la ruta José → Golfo de EE. UU.'] : ['250 m × 44 m · ~115,000 t deadweight', 'Workhorse of the José → U.S. Gulf route'] },
    { k: es ? '02 · LA CARGA' : '02 · THE CARGO', h: es ? '≈ 650.000 barriles de Merey 16' : '≈ 650,000 barrels of Merey 16',
      t: es ? ['16° API · extrapesado del Orinoco (8–9°) + nafta', 'Se mide por calado: más hundido, más barriles'] : ['16° API · Orinoco extra-heavy (8–9°) + naphtha', 'Measured by draught: the deeper the hull, the more barrels'] },
    { k: es ? '03 · EL VIAJE' : '03 · THE VOYAGE', h: es ? '≈ 6 días al Golfo de EE. UU.' : '≈ 6 days to the U.S. Gulf',
      t: es ? ['José → canal de Yucatán → Texas / Luisiana', 'Flete ≈ US$5 por barril'] : ['José → Yucatán Channel → Texas / Louisiana', 'Freight ≈ US$5 per barrel'] },
    { k: es ? '04 · EL VALOR' : '04 · THE VALUE', h: '≈ ' + cargoUsd + (es ? ' por carga' : ' per cargo'),
      t: mr ? [(es ? 'Merey hoy ≈ US$' : 'Merey today ≈ US$') + nf(2).format(mr) + (es ? ' = Brent − descuento OPEP' : ' = Brent − OPEC discount'), es ? 'Se actualiza a diario con los precios spot de la EIA' : 'Updated daily from EIA spot prices']
        : [es ? 'Brent − descuento OPEP' : 'Brent − OPEC discount', es ? 'Se actualiza a diario' : 'Updated daily'] },
    { k: (es ? '05 · ' : '05 · ') + (fm ? fmName.toUpperCase() : (es ? 'ESTE MES' : 'THIS MONTH')),
      h: fm ? n + (es ? ' viajes · ' : ' voyages · ') + nf(0).format(kbd) + (es ? ' mil b/d' : 'k b/d') : (es ? 'Contados uno por uno' : 'Counted one by one'),
      t: [cov ? cov + (es ? '% de la cifra oficial de la EIA' : '% of the official EIA figure') : (es ? 'Frente a la cifra oficial de la EIA' : 'Against the official EIA figure'), es ? 'Sigue bajando para verlos navegar ↓' : 'Keep scrolling to watch them sail ↓'] },
  ];
}
let stepEls = [];
function renderSteps() {
  stepsBox.replaceChildren();
  stepEls = steps().map((s, i) => {
    const d = document.createElement('div'); d.className = 'st'; d.dataset.i = i;
    const a = document.createElement('div'); a.className = 'st-a';
    const k = document.createElement('p'); k.className = 'st-k'; k.textContent = s.k;
    const h = document.createElement(i === 0 ? 'h1' : 'h2'); h.className = 'st-h'; h.textContent = s.h;
    a.append(k, h);
    const b = document.createElement('div'); b.className = 'st-b';
    s.t.forEach((line) => { const p = document.createElement('p'); p.textContent = line; b.append(p); });
    d.append(a, b); stepsBox.append(d); return d;
  });
  update(true);
}
document.addEventListener('api16-lang', renderSteps);

// ---------- scroll progress ----------
let P = 0;
function progress() {
  const r = stage.getBoundingClientRect();
  const total = r.height - window.innerHeight;
  return Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1)));
}
function update() {
  P = progress();
  const N = stepEls.length || 6;
  stepEls.forEach((el, i) => {
    const c = (i + 0.5) / N, half = 0.5 / N;
    const d = Math.abs(P - c) / half;                  // 0 at the centre of its slot, 1 at the edges
    let o = Math.max(0, Math.min(1, (0.92 - d) / 0.32));
    if (i === 0 && P < c) o = 1;                        // the first step is visible from the start
    if (i === N - 1 && P > c) o = 1;
    el.style.opacity = o.toFixed(3);
    el.style.transform = 'translateY(' + ((P - c) * -60).toFixed(1) + 'px)';
    el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
  });
  if (prog) prog.style.transform = 'scaleX(' + P.toFixed(4) + ')';
  if (hint) hint.style.opacity = P < 0.02 ? '1' : '0';
}
window.addEventListener('scroll', update, { passive: true });
window.addEventListener('resize', () => { update(); resize(); });
renderSteps();

// ---------- 3D scene ----------
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
catch (e) { canvas.style.display = 'none'; stage.classList.add('no-gl'); }

if (renderer) {
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 60, 150);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 400);

  // light: warm key, cool rim, soft fill, plus a studio-like environment for reflections
  scene.add(new THREE.HemisphereLight(0x6f8fbf, 0x050608, 0.45));
  const key = new THREE.DirectionalLight(0xffdcb0, 2.6); key.position.set(14, 18, 12); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 1.1); rim.position.set(-18, 8, -14); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-6, 4, 16); scene.add(fill);
  const under = new THREE.PointLight(0xc8892b, 14, 40, 2); under.position.set(0, -2, 0); scene.add(under);
  {
    const ec = document.createElement('canvas'); ec.width = 16; ec.height = 256; const g2 = ec.getContext('2d');
    const gr0 = g2.createLinearGradient(0, 0, 0, 256);
    gr0.addColorStop(0, '#9fb3cf'); gr0.addColorStop(0.45, '#2a3646'); gr0.addColorStop(0.52, '#c8892b'); gr0.addColorStop(0.56, '#151a22'); gr0.addColorStop(1, '#000');
    g2.fillStyle = gr0; g2.fillRect(0, 0, 16, 256);
    const et = new THREE.CanvasTexture(ec); et.colorSpace = THREE.SRGBColorSpace;
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: et, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.04).texture; pm.dispose();
  }

  const ship = new THREE.Group(); scene.add(ship);
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.7 }, o));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xe2a548, transparent: true, opacity: 0.16 });
  const add = (geo, mat, x = 0, y = 0, z = 0, edges = false) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); ship.add(m);
    if (edges) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat); e.position.copy(m.position); e.rotation.copy(m.rotation); ship.add(e); }
    return m;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---- lofted hull. 1 unit = 10 m. Aframax: 250 m long, 44 m beam, 21 m depth ----
  const B2 = 2.2, D = 2.1, WL = 1.45, R = 0.45;                 // half beam, depth, laden waterline, bilge radius
  const sternX = (y) => -12.45 + 0.12 * (y / D);
  const stemX = (y) => 11.9 + 0.62 * clamp((y - 0.95) / 1.6, 0, 1) + 0.5 * Math.exp(-Math.pow((y - 0.5) / 0.26, 2));   // raked stem + bulb
  const deckY = (x) => D + 0.05 + 0.42 * Math.pow(clamp((x - 7.5) / 5, 0, 1), 2) + 0.06 * Math.pow(clamp((-9 - x) / 3.5, 0, 1), 2);
  function halfB(x, y) {
    let b = y < R ? (B2 - R) + Math.sqrt(Math.max(0, R * R - (R - y) * (R - y))) : B2;   // round bilge, flat bottom
    const sx = stemX(Math.min(y, D)), tx = sternX(y);
    if (x > 4.5) { const t = clamp((x - 4.5) / (sx - 4.5), 0, 1); b *= 1 - Math.pow(t, 1.55 + 1.5 * (y / D));      // fine waterlines, flare near deck
      const bulb = 0.34 * Math.exp(-Math.pow((y - 0.5) / 0.3, 2)) * sm(0.7, 0.96, t) * Math.sqrt(Math.max(0, 1 - Math.pow(clamp((t - 0.9) / 0.1, 0, 1), 2)));
      b = Math.max(b, bulb); }
    if (x < -7.5) { const s = clamp((-7.5 - x) / (-7.5 - tx), 0, 1);
      b *= y < WL ? 1 - 0.88 * Math.pow(s, 1.7) * Math.pow(1 - y / WL, 0.55) : 1 - 0.07 * s; }                 // run aft, wide transom
    return Math.max(0.0, b);
  }
  const NI = 120, NJ = 18;
  const pos = [], col = [], idx = [];
  const cRed = new THREE.Color(0x7a2420), cBoot = new THREE.Color(0x0b0d10), cHull = new THREE.Color(0x1b2533), cMark = new THREE.Color(0xd9dde3);
  const grid = [];                                                // grid[side][i][j] -> vertex index
  [1, -1].forEach((side, si) => {
    grid[si] = [];
    for (let i = 0; i <= NI; i++) {
      grid[si][i] = [];
      for (let j = 0; j <= NJ; j++) {
        const u = i / NI, f = j / NJ;
        const xm = sternX(0) + u * (stemX(0.9) - sternX(0));
        const top = deckY(xm);
        const y = top * (1 - Math.cos(f * Math.PI / 2));          // denser near the keel and bilge
        const x = sternX(y) + u * (stemX(Math.min(y, D)) - sternX(y));
        const b = halfB(x, y);
        grid[si][i][j] = pos.length / 3; pos.push(x, y, side * b);
        const c = y < WL - 0.03 ? cRed : y < WL + 0.14 ? cBoot : cHull;
        const mark = (Math.abs(y - WL) < 0.02 && x > -8 && x < 6) ? cMark : c;        // a thin load-line mark
        col.push(mark.r, mark.g, mark.b);
      }
    }
  });
  for (let si = 0; si < 2; si++) for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
    const a = grid[si][i][j], b = grid[si][i + 1][j], c = grid[si][i + 1][j + 1], d = grid[si][i][j + 1];
    if (si === 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  for (let i = 0; i < NI; i++) { const a = grid[0][i][0], b = grid[0][i + 1][0], c = grid[1][i + 1][0], d = grid[1][i][0]; idx.push(a, d, b, b, d, c); }  // flat bottom
  const hullG = new THREE.BufferGeometry();
  hullG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hullG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hullG.setIndex(idx); hullG.computeVertexNormals();
  ship.add(new THREE.Mesh(hullG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35, envMapIntensity: 0.9, side: THREE.DoubleSide })));
  // transom (flat stern) and deck
  { const sh = new THREE.Shape(); const L = grid[0][0], Rr = grid[1][0];
    sh.moveTo(pos[L[0] * 3 + 2], pos[L[0] * 3 + 1]); L.forEach((k) => sh.lineTo(pos[k * 3 + 2], pos[k * 3 + 1]));
    Rr.slice().reverse().forEach((k) => sh.lineTo(pos[k * 3 + 2], pos[k * 3 + 1]));
    const g = new THREE.ShapeGeometry(sh); g.rotateY(-Math.PI / 2); const m = add(g, M(0x1b2533, { side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 }), sternX(1) + 0.005, 0, 0); m.scale.x = -1; }
  { const dp = [], di = []; for (let i = 0; i <= NI; i++) { const a = grid[0][i][NJ], b = grid[1][i][NJ]; dp.push(pos[a * 3], pos[a * 3 + 1] + 0.004, pos[a * 3 + 2] * 0.995, pos[b * 3], pos[b * 3 + 1] + 0.004, pos[b * 3 + 2] * 0.995); }
    for (let i = 0; i < NI; i++) { const a = 2 * i, b = 2 * i + 1, c = 2 * i + 2, d = 2 * i + 3; di.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); g.setIndex(di); g.computeVertexNormals();
    ship.add(new THREE.Mesh(g, M(0x2d4a3a, { roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide })));
    // railing along the deck edge
    [0, 1].forEach((si) => { const pts = grid[si].map((col2) => { const k = col2[NJ]; return new THREE.Vector3(pos[k * 3], pos[k * 3 + 1] + 0.12, pos[k * 3 + 2] * 0.99); });
      ship.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xc9d2df, transparent: true, opacity: 0.55 }))); }); }
  // name on the bow, both sides
  { const nc = document.createElement('canvas'); nc.width = 512; nc.height = 96; const g3 = nc.getContext('2d');
    g3.fillStyle = '#e9edf1'; g3.font = '700 64px Montserrat, Arial, sans-serif'; g3.textBaseline = 'middle'; g3.fillText('API16 MEREY', 8, 50);
    const nt = new THREE.CanvasTexture(nc); nt.colorSpace = THREE.SRGBColorSpace;
    const nm = new THREE.MeshBasicMaterial({ map: nt, transparent: true, depthWrite: false });
    [1, -1].forEach((sd) => { const x = 6.4, y = 1.8, z = sd * (halfB(x, y) + 0.03); const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), nm); p.position.set(x, y, z); p.rotation.y = sd > 0 ? 0.08 : Math.PI - 0.08; ship.add(p); }); }

  // ---- accommodation, bridge, funnel, lifeboat ----
  const white = M(0xe8ecf0, { roughness: 0.5, metalness: 0.08 });
  const glass = M(0x08101c, { roughness: 0.1, metalness: 0.8, envMapIntensity: 1.2 });
  const yd = deckY(-10.6);
  const tiers = [[2.7, 3.8, 0.0], [2.55, 3.55, 0.6], [2.4, 3.3, 1.2], [2.2, 3.05, 1.8]];
  tiers.forEach(([lx, lz, y0], i) => {
    add(new THREE.BoxGeometry(lx, 0.6, lz), white, -10.75 - i * 0.04, yd + y0 + 0.3, 0, true);
    add(new THREE.BoxGeometry(0.02, 0.2, lz - 0.4), glass, -10.75 - i * 0.04 + lx / 2 + 0.01, yd + y0 + 0.45, 0);                 // front windows
    [1, -1].forEach((sd) => add(new THREE.BoxGeometry(lx - 0.5, 0.16, 0.02), glass, -10.8 - i * 0.04, yd + y0 + 0.45, sd * (lz / 2 + 0.01)));   // side windows
  });
  const by = yd + 2.4;
  add(new THREE.BoxGeometry(1.9, 0.62, 4.5), white, -10.35, by + 0.31, 0, true);                                    // wheelhouse with wings
  add(new THREE.BoxGeometry(0.03, 0.3, 4.3), glass, -9.39, by + 0.36, 0);
  add(new THREE.BoxGeometry(2.0, 0.05, 4.6), M(0x9aa3ad), -10.35, by + 0.65, 0);                                    // roof
  add(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), M(0xc9d2df), -10.6, by + 1.4, 0);                          // radar mast
  [0.95, 1.35].forEach((h, i) => add(new THREE.BoxGeometry(0.06, 0.04, 1.2 - i * 0.4), M(0xc9d2df), -10.6, by + h, 0));
  [-0.5, 0.5].forEach((z) => add(new THREE.SphereGeometry(0.09, 12, 8), white, -10.4, by + 0.78, z));               // satellite domes
  // funnel: tapered, dark, with the API16 amber band
  const fun = add(new THREE.CylinderGeometry(0.48, 0.62, 1.7, 32), M(0x141b26, { roughness: 0.45, metalness: 0.4 }), -12.05, yd + 2.85, 0, true);
  fun.scale.z = 0.72; fun.rotation.z = 0.08;
  const band = add(new THREE.CylinderGeometry(0.5, 0.53, 0.3, 32), M(0xc8892b, { emissive: 0x3a2306, roughness: 0.35, metalness: 0.3 }), -12.08, yd + 3.25, 0);
  band.scale.z = 0.73; band.rotation.z = 0.08;
  add(new THREE.CylinderGeometry(0.485, 0.485, 0.1, 32), M(0x050608), -12.12, yd + 3.68, 0).scale.z = 0.72;
  // free-fall lifeboat on the stern ramp, and rescue boats at the sides
  const lb = add(new THREE.CapsuleGeometry(0.17, 0.62, 6, 14), M(0xf06a1a, { roughness: 0.45 }), -12.25, yd + 1.05, 0); lb.rotation.z = Math.PI / 2 - 0.55;
  [1, -1].forEach((sd) => { const rb = add(new THREE.CapsuleGeometry(0.1, 0.36, 4, 10), M(0xf06a1a), -10.3, yd + 1.2, sd * 2.0); rb.rotation.z = Math.PI / 2; });

  // ---- cargo deck: pipelines, manifold, cranes, catwalk, hatches, mooring winches ----
  const steel = M(0xb7c0ca, { roughness: 0.35, metalness: 0.75 });
  const yD = (x) => deckY(x) + 0.02;
  [-0.6, -0.3, 0.3, 0.6].forEach((z) => { const g = new THREE.CylinderGeometry(0.045, 0.045, 18.8, 10); g.rotateZ(Math.PI / 2); add(g, steel, -0.3, yD(0) + 0.14, z); });
  [-0.35, 0, 0.35].forEach((x) => { const g = new THREE.CylinderGeometry(0.06, 0.06, 4.1, 10); g.rotateX(Math.PI / 2); add(g, M(0xd9a13d, { metalness: 0.5, roughness: 0.35 }), x, yD(0) + 0.22, 0); });
  [-1, 1].forEach((sd) => {
    add(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 12), M(0xe2a548, { roughness: 0.4 }), 1.0, yD(1) + 0.75, 1.6 * sd);
    const boom = add(new THREE.CylinderGeometry(0.045, 0.045, 2.3, 10), M(0xe2a548), 1.0, yD(1) + 1.3, 0.95 * sd); boom.rotation.x = 1.08 * sd;
  });
  for (let i = 0; i < 7; i++) [-1, 1].forEach((sd) => add(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 18), M(0x3b5a49, { roughness: 0.7 }), -7.6 + i * 2.6, yD(0) + 0.05, 1.3 * sd));
  const cat = add(new THREE.BoxGeometry(19.6, 0.04, 0.4), M(0xc9d2df, { metalness: 0.4 }), -0.4, yD(0) + 0.52, 1.0);
  for (let i = 0; i < 14; i++) add(new THREE.BoxGeometry(0.04, 0.5, 0.04), M(0x9aa3ad), -9.6 + i * 1.45, yD(0) + 0.26, 1.0);
  [[10.9, 0.9], [10.9, -0.9], [-9.0, 1.4], [-9.0, -1.4]].forEach(([x, z]) => { const g = new THREE.CylinderGeometry(0.13, 0.13, 0.32, 14); g.rotateX(Math.PI / 2); add(g, M(0x2f3b48, { metalness: 0.5 }), x, yD(x) + 0.16, z); });
  add(new THREE.CylinderGeometry(0.04, 0.07, 1.8, 10), steel, 11.4, yD(11.4) + 0.9, 0);                            // foremast
  add(new THREE.BoxGeometry(0.5, 0.25, 1.4), M(0x2f3b48, { metalness: 0.5 }), 11.7, yD(11.7) + 0.12, 0);         // windlass

  // water: translucent technical disc with rings, at the waterline
  const tc = document.createElement('canvas'); tc.width = tc.height = 1024; const x2 = tc.getContext('2d');
  const gr = x2.createRadialGradient(512, 512, 30, 512, 512, 512);
  gr.addColorStop(0, 'rgba(22,55,95,0.55)'); gr.addColorStop(0.6, 'rgba(12,30,55,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x2.fillStyle = gr; x2.fillRect(0, 0, 1024, 1024);
  x2.strokeStyle = 'rgba(226,165,72,0.18)'; x2.lineWidth = 2;
  for (let r = 80; r < 512; r += 72) { x2.beginPath(); x2.arc(512, 512, r, 0, Math.PI * 2); x2.stroke(); }
  x2.strokeStyle = 'rgba(159,177,201,0.12)'; x2.beginPath(); x2.moveTo(0, 512); x2.lineTo(1024, 512); x2.moveTo(512, 0); x2.lineTo(512, 1024); x2.stroke();
  const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace;
  const water = new THREE.Mesh(new THREE.CircleGeometry(34, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WL; scene.add(water);
  ship.position.y = -WL;                                       // put the waterline at y = 0
  water.position.y = 0;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.API16_STAGE_RESIZE = resize;
  resize();

  // camera choreography, eased towards the scroll target
  const cur = { rot: -0.5, el: 0.2, dist: 1, lift: 0 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  let visible = true;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(stage);
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = clock.getElapsedTime();
    const target = {
      rot: -0.55 + P * Math.PI * 1.7,
      el: lerp(0.16, 0.42, smooth(0.15, 0.45, P)) + 0.9 * smooth(0.8, 1, P),
      dist: lerp(1, 0.86, smooth(0.25, 0.42, P)) * lerp(1, 1.08, smooth(0.5, 0.7, P)) * lerp(1, 1.6, smooth(0.82, 1, P)),
      lift: smooth(0.86, 1, P),
    };
    const k = reduce ? 1 : 0.08;
    for (const key2 in cur) cur[key2] = lerp(cur[key2], target[key2], k);
    // fit the ship to the screen: wide screens see it side-on, phones see more of it
    const fitW = camera.aspect < 0.8 ? 29 : 48;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const base = Math.max(fitW / 2 / Math.tan(hfov / 2), 42);
    const d = base * cur.dist;
    camera.position.set(Math.cos(cur.el) * d * 0.0 + 0, Math.sin(cur.el) * d, Math.cos(cur.el) * d);
    // on wide screens the ship sits right of centre, leaving the left column for text
    const off = camera.aspect > 1.1 ? -5 : 0;
    camera.lookAt(off, 1.2 + cur.lift * 3, 0);
    scene.fog.near = d * 0.85; scene.fog.far = d * 2.4;
    ship.rotation.y = cur.rot;
    ship.position.y = -WL + (reduce ? 0 : Math.sin(t * 0.8) * 0.06);
    ship.rotation.z = reduce ? 0 : Math.sin(t * 0.6) * 0.008;
    water.rotation.z = cur.rot * 0.15;
    renderer.render(scene, camera);
  }
  frame();
}
function resize() { if (window.API16_STAGE_RESIZE) window.API16_STAGE_RESIZE(); }
