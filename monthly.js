// API16: how much Venezuelan crude reached the U.S. each month, at a glance.
// One row per month: barrels (official where published), value, and the tankers API16 counted.
// Used on the home page and on the Crude flow page: <div data-api16-months></div>
(function () {
  const boxes = [...document.querySelectorAll('[data-api16-months]')];
  if (!boxes.length) return;
  const st = document.createElement('style');
  st.textContent = `
  .mo-box { display: grid; gap: 10px; }
  .mo-head { display: grid; gap: 2px; }
  .mo-k { font: 500 12px var(--mono, monospace); letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
  .mo-t { font: 700 clamp(28px, 5vw, 44px)/1.05 var(--display, sans-serif); letter-spacing: -.01em; }
  .mo-s { font: 500 14px var(--mono, monospace); color: #E2A548; }
  .mo-list { display: grid; gap: 6px; margin-top: 6px; }
  .mo-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) minmax(0, 290px); align-items: center; gap: 12px; }
  .mo-m { font: 600 13px var(--mono, monospace); opacity: .8; }
  .mo-bar { height: 22px; border-radius: 5px; background: rgba(127,140,160,.16); overflow: hidden; }
  .mo-bar i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg, #C8892B, #E2A548); }
  .mo-row.partial .mo-bar i { background: repeating-linear-gradient(135deg, #C8892B 0 6px, rgba(226,165,72,.55) 6px 12px); }
  .mo-v { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .mo-v b { font: 700 16px var(--mono, monospace); white-space: nowrap; }
  .mo-v small { font-size: 12px; opacity: .72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mo-note { font-size: 11px; opacity: .6; margin: 4px 0 0; }
  @media (max-width: 560px) { .mo-row { grid-template-columns: 34px minmax(0, 1fr); row-gap: 2px; } .mo-v { grid-column: 2; } .mo-bar { height: 16px; } }`;
  document.head.append(st);
  const lang = () => (window.API16_LANG ? window.API16_LANG() : (document.documentElement.lang || 'en')).slice(0, 2);
  const T = (en, es) => (lang() === 'es' ? es : en);
  const MES = () => (lang() === 'es' ? ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  const nf = (d) => new Intl.NumberFormat(lang() === 'es' ? 'es-VE' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const usd = (v) => (v >= 1e9 ? 'US$' + nf(2).format(v / 1e9) + T(' B', ' mil M') : 'US$' + nf(0).format(v / 1e6) + ' M');
  const get = (p) => fetch(p + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let rows = null;

  Promise.all([get('tracker/data/eia_imports_monthly.json'), get('tracker/data/census_ports.json'), get('tracker/data/eia_imports_weekly.json'),
    get('data/merey_brent_monthly.json'), get('tracker/data/flows.json')]).then(([E, C, W, M, F]) => {
    const year = new Date().getUTCFullYear(), nowM = new Date().toISOString().slice(0, 7);
    const eia = {}; ((E && E.rows) || []).forEach((r) => { eia[r.period] = r; });
    const cus = {}; ((C && C.monthly) || []).forEach((r) => { cus[r.month] = r; });
    const mer = {}; (M || []).forEach((r) => { if (r.merey) mer[r.month] = r.merey; });
    const lastMer = Object.keys(mer).sort().slice(-1)[0];
    const ships = {}; ((F && F.voyages) || []).forEach((v) => { const m = (v.arrived || '').slice(0, 7); if (m) ships[m] = (ships[m] || 0) + 1; });
    rows = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = year + '-' + String(mo).padStart(2, '0'); if (m > nowM) break;
      const days = new Date(Date.UTC(year, mo, 0)).getUTCDate();
      let bbl = null, src = '', value = null;
      if (eia[m]) { bbl = eia[m].kbbl * 1000; src = 'EIA'; }
      else if (cus[m] && cus[m].est_bbl) { bbl = cus[m].est_bbl; src = T('U.S. customs', 'Aduana EE. UU.'); }
      else {
        const wk = ((W && W.rows) || []).filter((w) => (w.week_ending || '').slice(0, 7) === m);
        if (wk.length) { const avg = wk.reduce((a, w) => a + w.kbd, 0) / wk.length; const d = m === nowM ? new Date().getUTCDate() : days; bbl = avg * 1000 * d; src = T('EIA weekly', 'EIA semanal'); }
      }
      if (cus[m] && cus[m].value_usd && (src === 'EIA' || src.indexOf('ustoms') > 0 || src.indexOf('duana') > 0)) value = cus[m].value_usd * (bbl / (cus[m].est_bbl || bbl));
      else if (bbl) value = bbl * (mer[m] || mer[lastMer] || 0);
      rows.push({ m, mo, bbl, src, value, ships: ships[m] || 0, partial: m === nowM, est: !cus[m] });
    }
    render();
  });

  function render() {
    if (!rows) return;
    const max = Math.max(...rows.map((r) => r.bbl || 0)) || 1;
    const tot = rows.reduce((a, r) => a + (r.bbl || 0), 0), totV = rows.reduce((a, r) => a + (r.value || 0), 0), totS = rows.reduce((a, r) => a + r.ships, 0);
    boxes.forEach((box) => {
      box.replaceChildren();
      box.classList.add('mo-box');
      const h = document.createElement('div'); h.className = 'mo-head';
      h.innerHTML = '<span class="mo-k"></span><b class="mo-t"></b><span class="mo-s"></span>';
      h.querySelector('.mo-k').textContent = T('Arrived in the U.S., month by month · ', 'Llegó a EE. UU., mes a mes · ') + new Date().getUTCFullYear();
      h.querySelector('.mo-t').textContent = '≈ ' + nf(1).format(tot / 1e6) + T('M barrels', ' M barriles');
      h.querySelector('.mo-s').textContent = '≈ ' + usd(totV) + ' · ' + totS + T(' tanker voyages counted', ' viajes de tanqueros contados');
      box.append(h);
      const list = document.createElement('div'); list.className = 'mo-list';
      rows.forEach((r) => {
        const row = document.createElement('div'); row.className = 'mo-row' + (r.partial ? ' partial' : '');
        const lab = document.createElement('span'); lab.className = 'mo-m'; lab.textContent = MES()[r.mo - 1];
        const bar = document.createElement('span'); bar.className = 'mo-bar'; const fill = document.createElement('i');
        fill.style.width = r.bbl ? Math.max(2, (r.bbl / max) * 100).toFixed(1) + '%' : '0'; bar.append(fill);
        const val = document.createElement('span'); val.className = 'mo-v';
        const b = document.createElement('b'); b.textContent = r.bbl ? nf(1).format(r.bbl / 1e6) + ' M' : '—';
        const s = document.createElement('small');
        s.textContent = [r.value ? (r.est ? '≈ ' : '') + usd(r.value) : '', r.ships ? r.ships + T(' ships', ' barcos') : '', r.partial ? T('so far', 'en curso') : ''].filter(Boolean).join(' · ');
        val.append(b, s);
        row.title = r.src ? T('Source: ', 'Fuente: ') + r.src : '';
        row.append(lab, bar, val); list.append(row);
      });
      box.append(list);
      const n = document.createElement('p'); n.className = 'mo-note';
      n.textContent = T('Barrels: EIA monthly where published, then U.S. customs, then the EIA weekly average. Value: U.S. customs declared value, or barrels × OPEC Merey (≈). Ships: voyages API16 counted (Global Fishing Watch).',
        'Barriles: EIA mensual donde ya salió; si no, aduana de EE. UU.; si no, promedio semanal de la EIA. Valor: valor declarado en aduana, o barriles × Merey OPEP (≈). Barcos: viajes que contó API16 (Global Fishing Watch).');
      box.append(n);
    });
  }
  document.addEventListener('api16-lang', render);
  window.API16_MONTHS_RENDER = render;
})();
