// API16 home: animated voyages on the map.
// Each crude voyage counted on the Crude flow page (Global Fishing Watch port visits + API16 AIS)
// is replayed along a sea route from its Venezuelan terminal to its U.S. port. A timeline lets the
// visitor play, pause or scrub through the last weeks; clicking a ship opens its card.
(function () {
  const map = window.API16_MAP;
  if (!map || !window.L) return;
  const L = window.L;
  const lang = () => (window.API16_LANG ? window.API16_LANG() : 'en');
  const T = (en, es) => (lang() === 'es' ? es : en);
  const DAY = 864e5;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MES = () => (lang() === 'es' ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  const nf = (d) => new Intl.NumberFormat(lang() === 'es' ? 'es-VE' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const dstr = (ms) => { const d = new Date(ms); return lang() === 'es' ? d.getUTCDate() + ' ' + MES()[d.getUTCMonth()] : MES()[d.getUTCMonth()] + ' ' + d.getUTCDate(); };

  // ---------- geography ----------
  const ORIGIN = {
    lake: [[10.72, -71.6], [11.0, -71.6], [11.85, -71.25], [12.65, -71.25], [14.3, -73.6], [16.6, -77.6]],
    jose: [[10.15, -64.78], [10.85, -64.95], [12.1, -66.6], [14.0, -70.8], [16.6, -77.2]],
    curacao: [[12.18, -69.05], [12.9, -69.6], [14.3, -72.6], [16.6, -77.4]],
    aruba: [[12.43, -69.92], [13.1, -70.4], [14.4, -73.0], [16.6, -77.5]],
    bonaire: [[12.2, -68.42], [12.9, -69.0], [14.3, -72.4], [16.6, -77.3]],
  };
  const GULF_WAY = [[19.2, -82.6], [21.45, -85.7], [23.9, -87.1]];
  const PORTS = [
    [/PORT NECHES|NEDERLAND/, [29.99, -93.95], 'Port Neches'], [/PORT ARTHUR|SABINE/, [29.86, -93.93], 'Port Arthur'],
    [/BEAUMONT/, [30.08, -94.09], 'Beaumont'], [/LAKE CHARLES|CALCASIEU/, [30.2, -93.25], 'Lake Charles'],
    [/HOUSTON|PASADENA|DEER PARK|BAYTOWN/, [29.73, -95.2], 'Houston'], [/TEXAS CITY/, [29.38, -94.9], 'Texas City'],
    [/GALVESTON/, [29.31, -94.79], 'Galveston'], [/FREEPORT/, [28.94, -95.32], 'Freeport'],
    [/CORPUS CHRISTI|INGLESIDE/, [27.82, -97.3], 'Corpus Christi'], [/GOLA/, [28.6, -94.4], 'Galveston lightering'],
    [/LOOP/, [28.88, -90.02], 'LOOP'], [/STEUTSPASS|SOUTH ?WEST PASS|SOUTHWEST PASS/, [28.93, -89.43], 'Southwest Pass'],
    [/NEW ORLEANS|CHALMETTE/, [29.94, -90.0], 'New Orleans'], [/ST\.? JAMES|GRAMERCY|GARYVILLE/, [30.04, -90.75], 'St. James'],
    [/BATON ROUGE/, [30.44, -91.19], 'Baton Rouge'], [/PASCAGOULA/, [30.34, -88.55], 'Pascagoula'], [/MOBILE/, [30.68, -88.04], 'Mobile'],
    [/DELAWARE|PAULSBORO|PHILADELPHIA|MARCUS HOOK/, [39.84, -75.3], 'Delaware River'], [/BAYWAY|LINDEN/, [40.63, -74.21], 'New York Harbor'],
  ];
  const portOf = (name) => { const u = (name || '').toUpperCase(); const p = PORTS.find(([re]) => re.test(u)); return p ? { ll: p[1], name: p[2] } : { ll: [28.7, -93.6], name: name || 'U.S. Gulf' }; };
  const originOf = (v) => {
    const s = (v.from_port || '').toUpperCase(), t = v.terminal || '';
    if (/Lake/.test(t)) return 'lake';
    if (/Jose/.test(t)) return 'jose';
    if (/ARUBA|SAN NICOLAS|ORANJESTAD/.test(s)) return 'aruba';
    if (/BONAIRE|BOPEC|KRALENDIJK/.test(s)) return 'bonaire';
    return 'curacao';
  };
  const okLL = (ll) => Array.isArray(ll) && typeof ll[0] === 'number' && typeof ll[1] === 'number';
  function routeFor(v, dep, arr, track) {
    const p = portOf(v.to_port), dest = okLL(v.to_ll) ? v.to_ll : p.ll;
    const o = ORIGIN[originOf(v)].slice(); if (okLL(v.from_ll)) o[0] = v.from_ll;
    // real route: daily satellite AIS positions between departure and arrival (Global Fishing Watch)
    const tp = (track || []).map(([d, la, lo]) => ({ t: Date.parse(d + 'T12:00:00Z'), ll: [la, lo] })).filter((x) => x.t > dep + 3600e3 && x.t < arr - 3600e3);
    if (tp.length >= 2) {
      const T = [{ t: dep, ll: o[0] }].concat(tp, [{ t: arr, ll: dest }]);
      const r = catmull(T.map((x) => x.ll), 6); r.ts = [];
      for (let i = 0; i < T.length - 1; i++) for (let j = 0; j < 6; j++) r.ts.push(T[i].t + (T[i + 1].t - T[i].t) * j / 6);
      r.ts.push(arr); r.real = true; return r;
    }
    let pts;
    if (p.ll[1] > -82) {                                  // U.S. East Coast: Mona Passage and the Atlantic
      pts = [o[0], o[1], [13.6, -67.4], [17.4, -67.9], [18.6, -67.9], [21.5, -69.5], [28.5, -74.5], [35.6, -74.9], [38.6, -74.6], dest];
    } else {
      const off = [Math.min(dest[0] - 0.9, 28.2), dest[1] + (dest[1] < -96 ? 0.6 : 0)];
      pts = o.concat(GULF_WAY, [off, dest]);
    }
    const r = catmull(pts, 10);
    // estimated route: time spread along the distance, slower near both ends
    r.ts = r.cum.map((c) => { const f = c / (r.len || 1), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; return dep + (arr - dep) * (0.15 * f + 0.85 * e); });
    r.real = false; return r;
  }
  // Catmull-Rom spline through lat/lon points, then cumulative length for even motion
  function catmull(pts, seg) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      for (let j = 0; j < seg; j++) {
        const t = j / seg, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    const cum = [0];
    for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], (out[i][1] - out[i - 1][1]) * Math.cos(out[i][0] * Math.PI / 180)));
    return { pts: out, cum, len: cum[cum.length - 1] };
  }
  function atTime(route, t) {
    const ts = route.ts; let lo = 0, hi = ts.length - 1;
    if (t <= ts[0]) hi = 1; else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } }
    const a = route.pts[lo], b = route.pts[hi], s = ts[hi] > ts[lo] ? Math.max(0, Math.min(1, (t - ts[lo]) / (ts[hi] - ts[lo]))) : 0;
    return { ll: [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s], i: lo, s, hd: Math.atan2(b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)) };
  }
  function at(route, f) {
    const d = Math.max(0, Math.min(1, f)) * route.len, c = route.cum;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m; else hi = m; }
    const a = route.pts[lo], b = route.pts[hi], s = c[hi] > c[lo] ? (d - c[lo]) / (c[hi] - c[lo]) : 0;
    return { ll: [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s], i: lo, s, hd: Math.atan2(b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)) };
  }

  // ---------- data ----------
  let V = [], EV = [], PRICE = {}, t0 = 0, t1 = 0, now = 0;
  const DAYS = 75;
  const getJ = (u) => fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([getJ('tracker/data/flows.json'), getJ('tracker/data/tracks.json')]).then(([F, TR]) => {
    if (!F) return;
    const TRK = (TR && TR.tracks) || {};
    (F.months || []).forEach((m) => { if (m.usd_per_bbl) PRICE[m.month] = m.usd_per_bbl; });
    const lastPrice = Object.keys(PRICE).sort().slice(-1)[0];
    const end = Date.now();
    V = (F.voyages || []).filter((v) => v.arrived).map((v) => {
      const arr = Date.parse(v.arrived);
      let dep = v.left ? Date.parse(v.left) : NaN;
      if (!(dep < arr) || arr - dep > 40 * DAY) dep = arr - 6.5 * DAY;
      const m = v.arrived.slice(0, 7);
      const port = portOf(v.to_port); if (okLL(v.to_ll)) port.ll = v.to_ll;
      return Object.assign({}, v, { dep, arr, route: routeFor(v, dep, arr, TRK[v.mmsi + '|' + v.arrived.slice(0, 10)]), port, usd: (v.est_kbbl || 0) * 1000 * (PRICE[m] || PRICE[lastPrice] || 0) });
    }).filter((v) => v.arr > end - (DAYS + 10) * DAY);
    if (!V.length) return;
    // possible ship-to-ship transfers and AIS gaps during these voyages
    const names = {}; V.forEach((v) => { if (v.vessel_id) names[v.vessel_id] = v.name; });
    EV = ((TR && TR.events) || []).filter((e) => (e.type === 'encounter' || e.type === 'gap') && typeof e.lat === 'number' && typeof e.lon === 'number')
      .map((e) => Object.assign({}, e, { t: Date.parse(e.start), ship: names[e.vessel_id] || e.name }));
    t1 = Math.min(end, Math.max(...V.map((v) => v.arr)) + 2 * DAY);
    t0 = t1 - DAYS * DAY;
    now = reduce ? t1 : t0;
    buildUI(); start();
  }).catch(() => {});

  // ---------- canvas overlay ----------
  const box = map.getContainer();
  const cv = document.createElement('canvas'); cv.className = 'vy-canvas'; box.append(cv);
  const ctx = cv.getContext('2d');
  function size() { const r = box.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = r.width * dpr; cv.height = r.height * dpr; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  window.addEventListener('resize', size); map.on('resize', size); size();
  const px = (ll) => map.latLngToContainerPoint(ll);

  let playing = !reduce, speed = 1, sel = null, hover = null, last = 0;
  const SPAN = 42000;                                     // ms of real time to play the whole window
  function draw() {
    const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
    const delivered = {}; let atSea = 0, seaBbl = 0, totBbl = 0, totUsd = 0;
    // routes travelled so far (faint), ships at sea, arrival pulses
    V.forEach((v) => {
      if (v.arr <= now && v.arr >= t0) {
        totBbl += v.est_kbbl * 1000; totUsd += v.usd;
        delivered[v.port.name] = delivered[v.port.name] || { ll: v.port.ll, bbl: 0 };
        delivered[v.port.name].bbl += v.est_kbbl * 1000;
        const age = (now - v.arr) / DAY;
        if (age < 1.6) { const p = px(v.port.ll), r = 6 + age * 22; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.strokeStyle = 'rgba(226,165,72,' + (0.8 * (1 - age / 1.6)).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.stroke(); }
      }
    });
    Object.values(delivered).forEach((d) => {
      const p = px(d.ll), r = 3 + Math.sqrt(d.bbl / 1e6) * 5;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2); g.addColorStop(0, 'rgba(226,165,72,.55)'); g.addColorStop(1, 'rgba(226,165,72,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, 7); ctx.fill();
    });
    V.forEach((v) => {
      if (!(v.dep <= now && now < v.arr)) { v._p = null; return; }
      atSea++; seaBbl += v.est_kbbl * 1000;
      const q = atTime(v.route, now), p = px(q.ll);
      v._p = p;
      // wake: the last part of the route behind the ship
      ctx.beginPath(); const from = Math.max(0, q.i - 14);
      for (let i = from; i <= q.i; i++) { const a = px(v.route.pts[i]); if (i === from) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y); }
      ctx.lineTo(p.x, p.y);
      const safe = v.confidence === 'high';
      ctx.strokeStyle = safe ? 'rgba(226,165,72,' + (v.route.real ? '.7' : '.4') + ')' : 'rgba(159,177,201,.35)'; ctx.lineWidth = v.route.real ? 2 : 1.4;
      ctx.setLineDash(v.route.real ? [] : [4, 4]); ctx.stroke(); ctx.setLineDash([]);
      // the ship: an elongated hull pointing along the heading, sized by cargo
      const s = 5 + Math.min(5, (v.est_kbbl || 400) / 220), on = v === sel || v === hover;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-q.hd);
      ctx.beginPath(); ctx.moveTo(s * 1.5, 0); ctx.lineTo(s * 0.6, -s * 0.45); ctx.lineTo(-s * 1.1, -s * 0.45); ctx.lineTo(-s * 1.1, s * 0.45); ctx.lineTo(s * 0.6, s * 0.45); ctx.closePath();
      ctx.fillStyle = safe ? '#E2A548' : '#B8C4D6'; ctx.shadowColor = safe ? 'rgba(226,165,72,.9)' : 'rgba(159,177,201,.6)'; ctx.shadowBlur = on ? 16 : 8; ctx.fill();
      if (on) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.restore();
      if (on) { ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.fillStyle = '#fff'; ctx.fillText(v.name || '', p.x + 12, p.y - 10); }
    });
    // events already happened by "now": encounters (possible transfers) and AIS gaps, visible for 20 days
    EV.forEach((e) => {
      if (!(e.t <= now && e.t >= now - 20 * DAY && e.t >= t0)) { e._p = null; return; }
      const p = px([e.lat, e.lon]); e._p = p; const fade = 1 - (now - e.t) / (20 * DAY);
      ctx.save(); ctx.globalAlpha = 0.35 + 0.65 * fade; ctx.translate(p.x, p.y);
      if (e.type === 'encounter') { ctx.rotate(Math.PI / 4); ctx.fillStyle = '#E8684A'; ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(-4.5, -4.5, 9, 9); }
      else { ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.setLineDash([2, 2]); ctx.strokeStyle = '#C9D2DF'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    });
    // HUD values
    if (ui) {
      ui.date.textContent = dstr(now) + ' ' + new Date(now).getUTCFullYear();
      ui.sea.textContent = atSea + ' · ' + nf(1).format(seaBbl / 1e6) + T('M bbl', ' M bbl');
      ui.del.textContent = nf(1).format(totBbl / 1e6) + T('M bbl', ' M bbl');
      ui.usd.textContent = totUsd ? '≈ US$' + (totUsd >= 1e9 ? nf(2).format(totUsd / 1e9) + T(' billion', ' mil millones') : nf(0).format(totUsd / 1e6) + T(' million', ' millones')) : '—';
      ui.range.value = String(Math.round((now - t0) / (t1 - t0) * 1000));
      ui.from.textContent = dstr(t0);
    }
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = last ? Math.min(100, ts - last) : 16; last = ts;
    if (playing) { now += (t1 - t0) * dt / SPAN * speed; if (now >= t1) { now = t1; playing = false; setPlay(); } }
    draw();
  }
  function start() { requestAnimationFrame(loop); }
  map.on('move zoom', () => { if (!playing) draw(); });

  // ---------- interaction ----------
  function nearest(pt) {
    let best = null, bd = 18;
    EV.forEach((e) => { if (!e._p) return; const d = Math.hypot(e._p.x - pt.x, e._p.y - pt.y); if (d < bd) { bd = d; best = e; } });
    V.forEach((v) => { if (!v._p) return; const d = Math.hypot(v._p.x - pt.x, v._p.y - pt.y); if (d < bd) { bd = d; best = v; } });
    return best;
  }
  map.on('mousemove', (e) => { const v = nearest(e.containerPoint); if (v !== hover) { hover = v; box.style.cursor = v ? 'pointer' : ''; } });
  map.on('click', (e) => {
    const v = nearest(e.containerPoint); if (!v) return;
    if (v.type === 'encounter' || v.type === 'gap') { L.popup({ maxWidth: 260, className: 'vy-pop' }).setLatLng([v.lat, v.lon]).setContent(evCard(v)).openOn(map); return; }
    sel = v;
    L.popup({ maxWidth: 290, className: 'vy-pop' }).setLatLng(map.containerPointToLatLng(v._p)).setContent(card(v)).openOn(map);
  });
  map.on('popupclose', () => { sel = null; });
  function evCard(e) {
    const d = document.createElement('div'); d.className = 'pop';
    const h = document.createElement('h4'); h.textContent = e.type === 'encounter' ? T('Ship-to-ship encounter', 'Encuentro barco a barco') : T('AIS switched off', 'AIS apagado'); d.append(h);
    const sub = document.createElement('p'); sub.className = 'sub';
    sub.textContent = (e.ship || '') + (e.type === 'encounter' && e.other_name ? ' + ' + e.other_name : '') + ' · ' + dstr(e.t);
    d.append(sub);
    const f = document.createElement('p'); f.className = 'foot';
    f.textContent = (e.hours ? nf(0).format(e.hours) + ' h · ' : '') + (e.type === 'encounter'
      ? T('Two vessels close together at sea for hours: a possible transfer of cargo.', 'Dos buques juntos en el mar durante horas: posible transbordo de carga.')
      : T('The ship stopped transmitting its position for a while: the route there is not visible.', 'El buque dejó de transmitir su posición por un tiempo: en ese tramo la ruta no se ve.'));
    d.append(f);
    const g = document.createElement('p'); g.className = 'foot'; g.textContent = 'Powered by Global Fishing Watch'; d.append(g);
    return d;
  }
  function card(v) {
    const d = document.createElement('div'); d.className = 'pop';
    const h = document.createElement('h4'); h.textContent = v.name || 'Tanker'; d.append(h);
    const sub = document.createElement('p'); sub.className = 'sub';
    const cls = v.gt ? (v.gt < 35000 ? 'MR' : v.gt < 50000 ? 'LR1' : v.gt < 75000 ? 'Aframax / LR2' : v.gt < 140000 ? 'Suezmax' : 'VLCC') : '';
    sub.textContent = [cls, v.length_m ? Math.round(v.length_m) + ' m' : '', v.imo ? 'IMO ' + v.imo : ''].filter(Boolean).join(' · ');
    d.append(sub);
    const kv = document.createElement('div'); kv.className = 'kv';
    const row = (k, val) => { const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = val; kv.append(a, b); };
    const term = { 'Lake Maracaibo': T('Lake Maracaibo', 'Lago de Maracaibo'), 'Jose / Puerto La Cruz': 'José', 'Caribbean hub': T('Caribbean hub', 'Hub del Caribe') }[v.terminal] || v.terminal;
    row(T('From', 'Desde'), term + (v.dep ? ' · ' + dstr(v.dep) : ''));
    row(T('To', 'Hasta'), v.port.name + ' · ' + dstr(v.arr));
    row(T('Cargo (est.)', 'Carga (est.)'), nf(0).format(v.est_kbbl * 1000) + ' bbl');
    row(T('Range', 'Rango'), nf(0).format(v.est_low) + '–' + nf(0).format(v.est_high) + (lang() === 'es' ? ' mil' : 'k'));
    if (v.usd) row(T('Value at Merey', 'Valor a precio Merey'), '≈ US$' + nf(0).format(v.usd / 1e6) + T(' million', ' millones'));
    row(T('Route', 'Ruta'), v.route.real ? T('Satellite AIS, daily (GFW)', 'AIS satelital, diaria (GFW)') : T('Estimated (typical route)', 'Estimada (ruta típica)'));
    row(T('Confidence', 'Confianza'), v.confidence === 'high' ? T('Safe crude cargo', 'Carga de crudo segura') : T('Possible crude cargo', 'Carga de crudo posible'));
    d.append(kv);
    const f = document.createElement('p'); f.className = 'foot';
    f.textContent = T('Port calls: Global Fishing Watch. Cargo estimated from ship size; checked monthly against EIA.', 'Escalas: Global Fishing Watch. Carga estimada por el tamaño del buque; cotejada cada mes con la EIA.');
    d.append(f);
    const a = document.createElement('a'); a.href = 'flow.html'; a.textContent = T('All voyages on Crude flow →', 'Todos los viajes en Flujo de crudo →'); a.className = 'go'; d.append(a);
    return d;
  }

  // ---------- timeline HUD ----------
  let ui = null;
  function setPlay() { if (ui) { ui.play.textContent = playing ? '❚❚' : '▶'; ui.play.setAttribute('aria-label', playing ? T('Pause', 'Pausar') : T('Play', 'Reproducir')); } }
  function buildUI() {
    const c = L.control({ position: 'bottomleft' });
    c.onAdd = () => {
      const d = L.DomUtil.create('div', 'vy-hud');
      d.innerHTML = '<div class="vy-row"><button type="button" class="vy-play"></button><div class="vy-date"></div><button type="button" class="vy-speed" aria-label="Speed">1×</button></div>' +
        '<input class="vy-range" type="range" min="0" max="1000" value="0" aria-label="Timeline">' +
        '<div class="vy-ends"><span class="vy-from"></span><span class="vy-to"></span></div>' +
        '<div class="vy-leg" style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font:11px var(--mono);color:#9FB1C9"></div>' +
        '<div class="vy-stats"><div><b class="vy-sea"></b><span class="l1"></span></div><div><b class="vy-del"></b><span class="l2"></span></div><div><b class="vy-usd"></b><span class="l3"></span></div></div>';
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      return d;
    };
    c.addTo(map);
    const d = box.querySelector('.vy-hud');
    ui = { play: d.querySelector('.vy-play'), date: d.querySelector('.vy-date'), range: d.querySelector('.vy-range'), sea: d.querySelector('.vy-sea'), del: d.querySelector('.vy-del'), usd: d.querySelector('.vy-usd'), from: d.querySelector('.vy-from'), to: d.querySelector('.vy-to'), speed: d.querySelector('.vy-speed'), root: d };
    labels();
    ui.play.addEventListener('click', () => { if (!playing && now >= t1) now = t0; playing = !playing; setPlay(); });
    ui.speed.addEventListener('click', () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; ui.speed.textContent = speed + '×'; });
    ui.range.addEventListener('input', () => { now = t0 + (t1 - t0) * (+ui.range.value / 1000); playing = false; setPlay(); });
    setPlay();
    // start playing when the map scrolls into view
    if (!reduce) new IntersectionObserver((es) => { if (es[0].isIntersecting && now <= t0 + DAY) { playing = true; setPlay(); } }, { threshold: 0.4 }).observe(box);
  }
  function labels() {
    if (!ui) return;
    ui.root.querySelector('.l1').textContent = T('ships at sea', 'barcos en el mar');
    ui.root.querySelector('.l2').textContent = T('delivered to U.S. ports', 'entregados en puertos de EE. UU.');
    ui.root.querySelector('.l3').textContent = T('at Merey prices', 'a precios Merey');
    const lg = ui.root.querySelector('.vy-leg'); lg.replaceChildren();
    [['<b style="color:#E2A548">━</b>', T('satellite route', 'ruta satelital')], ['<b style="color:#E2A548">┅</b>', T('estimated route', 'ruta estimada')],
     ['<b style="color:#E8684A">◆</b>', T('ship-to-ship', 'barco a barco')], ['<b style="color:#C9D2DF">◌</b>', T('AIS off', 'AIS apagado')]].forEach(([i, t]) => {
      const sp = document.createElement('span'); sp.innerHTML = i + ' '; sp.append(document.createTextNode(t)); lg.append(sp); });
    ui.to.textContent = T('latest', 'último dato');
    setPlay();
  }
  document.addEventListener('api16-lang', () => { labels(); map.closePopup(); });
})();
