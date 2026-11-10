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

  scene.add(new THREE.HemisphereLight(0x5a7aa8, 0x000000, 0.55));
  const key = new THREE.DirectionalLight(0xffd9a6, 2.4); key.position.set(14, 18, 10); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6aa0ff, 0.9); rim.position.set(-16, 6, -12); scene.add(rim);
  const under = new THREE.PointLight(0xc8892b, 18, 40, 2); under.position.set(0, -2, 0); scene.add(under);

  const ship = new THREE.Group(); scene.add(ship);
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.62, metalness: 0.25 }, o));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xe2a548, transparent: true, opacity: 0.28 });
  const add = (geo, mat, x = 0, y = 0, z = 0, edges = false) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); ship.add(m);
    if (edges) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat); e.position.copy(m.position); e.rotation.copy(m.rotation); ship.add(e); }
    return m;
  };

  // 1 unit = 10 m. Aframax: 250 m long, 44 m beam, 21 m moulded depth.
  const L2 = 12.5, B2 = 2.2;
  function outline(scale = 1) {
    const s = new THREE.Shape(), b = B2 * scale;
    s.moveTo(-L2, -b * 0.86); s.lineTo(-L2 + 0.25, -b); s.lineTo(7.6, -b);
    s.quadraticCurveTo(11.6, -b * 0.92, L2, 0);
    s.quadraticCurveTo(11.6, b * 0.92, 7.6, b); s.lineTo(-L2 + 0.25, b); s.lineTo(-L2, b * 0.86); s.closePath();
    return s;
  }
  const extr = (shape, h, bevel = 0.06) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 18 });
    g.rotateX(-Math.PI / 2); return g;
  };
  const WL = 1.45;                                             // laden waterline (~14.5 m draught)
  add(extr(outline(0.94), WL, 0.05), M(0x6b1f1c, { roughness: 0.7 }), 0, 0, 0, true);          // antifouling red
  add(extr(outline(1), 2.1 - WL, 0.04), M(0x10151d, { roughness: 0.5, metalness: 0.35 }), 0, WL, 0, true);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(outline(0.985), 18), M(0x1f2c26, { roughness: 0.85 }));
  deck.rotation.x = -Math.PI / 2; deck.position.y = 2.15; ship.add(deck);
  // forecastle
  const fc = new THREE.Shape(); fc.moveTo(9.2, -1.9); fc.quadraticCurveTo(11.7, -1.7, 12.35, 0); fc.quadraticCurveTo(11.7, 1.7, 9.2, 1.9); fc.closePath();
  add(extr(fc, 0.32, 0.03), M(0x10151d), 0, 2.12, 0, true);

  // accommodation block and bridge at the stern
  const white = M(0xdfe4ea, { roughness: 0.55, metalness: 0.1 });
  add(new THREE.BoxGeometry(2.6, 1.0, 3.7), white, -10.75, 2.65, 0, true);
  add(new THREE.BoxGeometry(2.4, 1.0, 3.4), white, -10.85, 3.65, 0, true);
  add(new THREE.BoxGeometry(2.2, 0.9, 3.1), white, -10.95, 4.6, 0, true);
  add(new THREE.BoxGeometry(1.9, 0.75, 4.4), white, -10.8, 5.42, 0, true);                      // bridge with wings
  const glass = M(0x0a1220, { roughness: 0.15, metalness: 0.6 });
  add(new THREE.BoxGeometry(0.04, 0.28, 4.2), glass, -9.84, 5.5, 0);
  [2.75, 3.75, 4.65].forEach((y, i) => add(new THREE.BoxGeometry(0.04, 0.18, 3.0 - i * 0.3), glass, -9.44 - i * 0.1, y, 0));
  // funnel with the API16 amber band
  const fun = add(new THREE.CylinderGeometry(0.55, 0.62, 1.9, 24), M(0x10151d), -11.75, 6.0, 0, true); fun.scale.z = 0.8;
  const band = add(new THREE.CylinderGeometry(0.565, 0.57, 0.32, 24), M(0xc8892b, { emissive: 0x3a2306, roughness: 0.4 }), -11.75, 6.45, 0); band.scale.z = 0.8;
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), M(0x9aa3ad), -10.6, 6.5, 0);              // radar mast
  add(new THREE.BoxGeometry(0.05, 0.05, 1.1), M(0x9aa3ad), -10.6, 6.9, 0);

  // deck piping, manifold, hose cranes, tank hatches
  const steel = M(0x8f99a5, { roughness: 0.4, metalness: 0.7 });
  [-0.55, -0.2, 0.2, 0.55].forEach((z) => { const g = new THREE.CylinderGeometry(0.05, 0.05, 18.6, 8); g.rotateZ(Math.PI / 2); add(g, steel, -0.2, 2.32, z); });
  [-0.35, 0, 0.35].forEach((x) => { const g = new THREE.CylinderGeometry(0.07, 0.07, 4.0, 10); g.rotateX(Math.PI / 2); add(g, M(0xb98a3a, { metalness: 0.5, roughness: 0.4 }), x, 2.4, 0); });
  [-1, 1].forEach((sz) => {
    add(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 10), M(0xc8892b), 0.9, 3.0, 1.55 * sz);
    const boom = add(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), M(0xc8892b), 0.9, 3.5, 0.9 * sz); boom.rotation.x = 1.05 * sz;
  });
  for (let i = 0; i < 6; i++) [-1, 1].forEach((sz) => add(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16), M(0x26342d), -7.2 + i * 2.9, 2.2, 1.35 * sz));
  const cat = new THREE.BoxGeometry(19.2, 0.06, 0.45); add(cat, M(0x9aa3ad, { metalness: 0.5 }), -0.3, 2.75, 1.0);
  add(new THREE.CylinderGeometry(0.05, 0.08, 2.0, 8), steel, 11.3, 3.3, 0);                     // foremast

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
