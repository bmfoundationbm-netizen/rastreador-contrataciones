/* ============================================================
   Rastreador de Contrataciones · interfaz
   Filtros, busqueda, alertas, fichas de detalle, importacion,
   fuentes y ajustes. Todo dato de los archivos pasa por esc()
   antes de llegar al DOM: son datos de terceros.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = RC.esc;

  const ALL_TYPES = ['nueva', 'acapara', 'monto', 'domicilio'];
  const state = {
    f: { from: NaN, to: NaN, min: NaN, max: NaN, orgs: new Set(), pts: new Set() },
    V: null, A: null,
    types: new Set(ALL_TYPES),
    sel: null, alert: null, alertLimit: 120,
    orgQuery: '', orgOrder: null, open: new Set(), busy: false
  };

  // ── estado ──────────────────────────────────────────────
  function status(msg, busy) {
    const el = $('#statusMsg');
    el.textContent = msg; el.classList.toggle('busy', !!busy);
  }
  function statusData() {
    const DB = RC.model.DB;
    let s = DB.ks.length ? `${RC.int(DB.ks.length)} contratos · ${RC.int(DB.cos.length)} empresas · ${RC.int(DB.orgs.length)} organismos` : 'Sin datos';
    const mem = performance.memory;
    if (mem) s += ` · ${Math.round(mem.usedJSHeapSize / 1048576)} MB`;
    $('#statusData').textContent = s;
  }

  // ── ciclo principal ─────────────────────────────────────
  function refresh() {
    const DB = RC.model.DB;
    const t0 = RC.now();
    $('#empty').hidden = DB.ks.length > 0;
    $('#demoPill').hidden = !DB.demo;
    $('#unitLbl').textContent = RC.unit();
    state.V = RC.model.view(state.f);
    state.A = RC.alerts.compute(state.V);
    if (state.alert && !state.A.byId.has(state.alert)) state.alert = null;
    RC.graph.build(state.V, state.A);
    renderSummary(); renderHud(); renderAlerts(); renderHisto(); renderOrgs(); renderDetail(); statusData();
    if (DB.ks.length) status(`Vista actualizada en ${Math.round(RC.now() - t0)} ms.`);
  }
  const refreshSoon = RC.debounce(refresh, 160);

  // Datos nuevos: se rearman las listas que dependen del conjunto completo.
  function dataChanged() {
    const DB = RC.model.DB;
    if ($('#basePill')) renderBasePill();
    state.orgOrder = null;
    const valid = (s, n) => new Set([...s].filter((i) => i < n));
    state.f.orgs = valid(state.f.orgs, DB.orgs.length);
    state.f.pts = valid(state.f.pts, DB.dict.pt.length);
    // Una seleccion que ya no existe (datos vaciados o reemplazados) se descarta.
    const lim = { org: DB.orgs.length, co: DB.cos.length, k: DB.ks.length, jur: DB.dict.jur.length };
    if (state.sel && !(state.sel.i < lim[state.sel.t])) { state.sel = null; state.alert = null; }
    renderYearChips(); renderAmountChips(); renderPtypes();
    RC.graph.clearPins();
    refresh();
  }

  // ── filtros ─────────────────────────────────────────────
  // Anios con al menos 20 contratos (hay fechas sueltas de 2006 o 2013 en los archivos viejos).
  function yearsInData() {
    const n = new Map();
    for (const k of RC.model.DB.ks) if (isFinite(k.year)) n.set(k.year, (n.get(k.year) || 0) + 1);
    return [...n].filter(([, c]) => c >= 20).map(([y]) => y).sort((a, b) => a - b);
  }
  function renderYearChips() {
    const f = state.f, ys = yearsInData();
    const sel = (y) => isFinite(f.from) && isFinite(f.to) && Date.UTC(y, 0, 1) >= f.from && Date.UTC(y, 11, 31) <= f.to;
    $('#yearChips').innerHTML = (ys.length ? `<span class="chip ${!isFinite(f.from) && !isFinite(f.to) ? 'on' : ''}" data-y="all">Todo</span>` : '') +
      ys.map((y) => `<span class="chip ${sel(y) ? 'on' : ''}" data-y="${y}" title="Clic: solo ${y} · Mayús+clic: extender el rango">${y}</span>`).join('');
    $('#fFrom').value = RC.isoDate(f.from); $('#fTo').value = RC.isoDate(f.to);
  }
  $('#yearChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const f = state.f;
    if (c.dataset.y === 'all') { f.from = NaN; f.to = NaN; }
    else {
      const y = +c.dataset.y, a = Date.UTC(y, 0, 1), b = Date.UTC(y, 11, 31);
      if (e.shiftKey && isFinite(f.from)) { f.from = Math.min(f.from, a); f.to = Math.max(f.to, b); }
      else { f.from = a; f.to = b; }
    }
    renderYearChips(); refreshSoon();
  });
  $('#fFrom').addEventListener('change', (e) => { state.f.from = e.target.value ? Date.parse(e.target.value) : NaN; renderYearChips(); refreshSoon(); });
  $('#fTo').addEventListener('change', (e) => { state.f.to = e.target.value ? Date.parse(e.target.value) : NaN; renderYearChips(); refreshSoon(); });

  // "1,5 M", "200 mil", "3000000" -> numero
  function parseHuman(s) {
    s = String(s || '').trim().toLowerCase().replace(/us\$|\$/g, '').trim();
    if (!s) return NaN;
    const m = /^([\d.,]+)\s*(k|mil|m|mm|millones?|mil m|b)?$/.exec(s);
    if (!m) return NaN;
    const v = RC.parseAmount(m[1]);
    const mult = { k: 1e3, mil: 1e3, m: 1e6, millon: 1e6, millones: 1e6, mm: 1e6, 'mil m': 1e9, b: 1e9 }[m[2] || ''] || 1;
    return v * mult;
  }
  const AMOUNT_PRESETS = [1e4, 1e5, 1e6, 1e7];
  function renderAmountChips() {
    const f = state.f;
    $('#amountChips').innerHTML = AMOUNT_PRESETS.map((v) =>
      `<span class="chip ${f.min === v && !isFinite(f.max) ? 'on' : ''}" data-v="${v}">≥ ${RC.compact(v)}</span>`).join('');
    $('#fMin').value = isFinite(f.min) ? RC.compact(f.min) : '';
    $('#fMax').value = isFinite(f.max) ? RC.compact(f.max) : '';
  }
  $('#amountChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const v = +c.dataset.v;
    if (state.f.min === v && !isFinite(state.f.max)) state.f.min = NaN; else { state.f.min = v; state.f.max = NaN; }
    renderAmountChips(); refreshSoon();
  });
  for (const id of ['fMin', 'fMax']) {
    $('#' + id).addEventListener('change', (e) => {
      const v = parseHuman(e.target.value);
      state.f[id === 'fMin' ? 'min' : 'max'] = isFinite(v) ? v : NaN;
      renderAmountChips(); refreshSoon();
    });
  }

  function renderPtypes() {
    const DB = RC.model.DB, n = new Map();
    for (const k of DB.ks) n.set(k.pt, (n.get(k.pt) || 0) + 1);
    const items = [...n].filter(([pt]) => pt > 0).sort((a, b) => b[1] - a[1]);
    $('#ptypeList').innerHTML = items.length ? items.map(([pt, c]) =>
      `<label class="check"><input type="checkbox" data-pt="${pt}" ${state.f.pts.has(pt) ? 'checked' : ''}>` +
      `<span class="cn">${esc(DB.dict.pt[pt])}</span><span class="cm mono">${RC.int(c)}</span></label>`).join('')
      : '<div class="faint">—</div>';
  }
  $('#ptypeList').addEventListener('change', (e) => {
    const pt = +e.target.dataset.pt;
    if (e.target.checked) state.f.pts.add(pt); else state.f.pts.delete(pt);
    refreshSoon();
  });

  /* Organismos agrupados por ministerio, segun el ultimo presupuesto en que figura cada uno.
     Los ministerios que ya no existen van despues, marcados con el anio hasta el que figuran;
     los compradores fuera del presupuesto nacional (universidades, empresas de servicios
     del sistema anterior, entes) van al final. */
  function orgGroups() {
    if (state.orgOrder) return state.orgOrder;
    const DB = RC.model.DB;
    const tot = new Float64Array(DB.orgs.length);
    for (const k of DB.ks) if (isFinite(k.usd)) tot[k.org] += k.usd;
    let lastYear = -Infinity;
    for (const b of DB.budget.values()) if (b.year > lastYear) lastYear = b.year;
    const groups = new Map();
    for (const o of DB.orgs) {
      if (o.merged !== undefined || !(tot[o.i] > 0 || o.jur)) continue;
      const j = o.jur || 0;
      let g = groups.get(j);
      if (!g) groups.set(j, g = { j, name: j ? DB.dict.jur[j] : 'Otros compradores', orgs: [], tot: 0, until: -Infinity });
      g.orgs.push(o.i); g.tot += tot[o.i];
      if (isFinite(o.bYear)) g.until = Math.max(g.until, o.bYear);
    }
    for (const g of groups.values()) {
      g.orgs.sort((a, b) => tot[b] - tot[a] || DB.orgs[a].name.localeCompare(DB.orgs[b].name));
      g.old = !!g.j && g.until < lastYear;
    }
    state.orgOrder = [...groups.values()].sort((a, b) => (a.j === 0) - (b.j === 0) || (a.old - b.old) || b.tot - a.tot);
    return state.orgOrder;
  }
  function renderOrgs() {
    const DB = RC.model.DB, V = state.V;
    const vsum = (i) => V ? V.orgSum[i] + V.omitSum[i] : 0;
    const groups = orgGroups();
    const q = RC.fold(state.orgQuery).trim();
    const gsum = new Map(groups.map((g) => [g.j, g.orgs.reduce((s, i) => s + vsum(i), 0)]));
    const max = Math.max(1, ...gsum.values());
    let html = '';
    for (const g of groups) {
      const orgs = q && !RC.fold(g.name).includes(q) ? g.orgs.filter((i) => DB.orgs[i]._f.includes(q)) : g.orgs;
      if (!orgs.length) continue;
      const open = !!q || state.open.has(g.j);
      const sel = g.orgs.filter((i) => state.f.orgs.has(i)).length;
      const gv = gsum.get(g.j);
      const label = g.j ? g.name : 'Otros compradores (fuera del presupuesto nacional)';
      html += `<div class="jrow ${gv > 0 ? '' : 'dimmed'}">` +
        `<button class="caret ${open ? 'open' : ''}" data-toggle="${g.j}" title="${open ? 'Cerrar' : 'Ver sus organismos'}">▸</button>` +
        `<input type="checkbox" data-jur="${g.j}" ${sel && sel === g.orgs.length ? 'checked' : ''} data-mixed="${sel && sel < g.orgs.length ? 1 : 0}" title="Filtrar por todos sus organismos">` +
        `<span class="jn" ${g.j ? `data-ref="jur:${g.j}"` : `data-toggle="${g.j}"`} title="${esc(label)}">${esc(label)}</span>` +
        `<span class="om mono">${gv > 0 ? RC.compact(gv) : '—'}</span>` +
        `<span class="jm">${RC.int(g.orgs.length)} ${g.orgs.length === 1 ? 'organismo' : 'organismos'}${g.old ? ` · hasta ${g.until}` : ''}</span>` +
        `<span class="ob"><i style="width:${(100 * gv / max).toFixed(1)}%"></i></span></div>`;
      if (!open) continue;
      const omax = Math.max(1, ...orgs.map(vsum));
      for (const i of orgs.slice(0, 300)) {
        const o = DB.orgs[i], v = vsum(i);
        html += `<div class="orow osub ${v > 0 ? '' : 'dimmed'}">` +
          `<input type="checkbox" data-org="${i}" ${state.f.orgs.has(i) ? 'checked' : ''} title="Filtrar por este organismo">` +
          `<span class="on" data-ref="org:${i}" title="${esc(o.name)}">${esc(o.name)}</span>` +
          `<span class="om mono">${v > 0 ? RC.compact(v) : '—'}</span>` +
          `<span class="ob"><i style="width:${(100 * v / omax).toFixed(1)}%"></i></span></div>`;
      }
    }
    $('#orgList').innerHTML = html || '<div class="faint" style="padding:6px 2px">Sin coincidencias.</div>';
    for (const cb of $$('#orgList input[data-mixed="1"]')) cb.indeterminate = true;
    $('#orgSelCount').textContent = state.f.orgs.size ? `${state.f.orgs.size} elegidos` : '';
  }
  $('#orgList').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.jur !== undefined) {
      const g = orgGroups().find((x) => x.j === +t.dataset.jur);
      for (const i of g.orgs) { if (t.checked) state.f.orgs.add(i); else state.f.orgs.delete(i); }
      renderOrgs(); refreshSoon();
      return;
    }
    const i = +t.dataset.org;
    if (t.checked) state.f.orgs.add(i); else state.f.orgs.delete(i);
    refreshSoon();
  });
  $('#orgList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    const j = +b.dataset.toggle;
    if (state.open.has(j)) state.open.delete(j); else state.open.add(j);
    renderOrgs();
  });
  $('#orgSearch').addEventListener('input', RC.debounce((e) => { state.orgQuery = e.target.value; renderOrgs(); }, 120));
  $('#btnReset').addEventListener('click', () => {
    state.f = { from: NaN, to: NaN, min: NaN, max: NaN, orgs: new Set(), pts: new Set() };
    state.orgQuery = ''; $('#orgSearch').value = '';
    renderYearChips(); renderAmountChips(); renderPtypes(); refresh();
  });

  // ── histograma de montos ────────────────────────────────
  // Una serie (contratos): barras finas color contrato, 2 px de separacion, extremo
  // redondeado arriba; fuera del rango elegido se atenuan. Arrastrar elige un rango.
  let histo = null;
  function renderHisto() {
    const cv = $('#histo'), DB = RC.model.DB, f = state.f;
    const w = cv.clientWidth || 260, h = 64, dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const from = isFinite(f.from) ? f.from : -Infinity, to = isFinite(f.to) ? f.to : Infinity;
    const orgs = f.orgs.size ? f.orgs : null, pts = f.pts.size ? f.pts : null;
    const vals = [];
    for (const k of DB.ks) {
      if (k.date < from || k.date > to || (orgs && !orgs.has(k.org)) || (pts && !pts.has(k.pt))) continue;
      const d = RC.toDisplay(k.usd, k.year);
      if (d > 0) vals.push(Math.log10(d));
    }
    if (!vals.length) { histo = null; $('#histoAxis').innerHTML = ''; return; }
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2; if (hi <= lo) hi = lo + 1;
    const B = 34, bins = new Int32Array(B);
    for (const v of vals) bins[Math.min(B - 1, Math.floor((v - lo) / (hi - lo) * B))]++;
    const mx = Math.max(...bins);
    const bw = w / B, gap = 2, top = 4;
    const minL = isFinite(f.min) ? Math.log10(f.min) : -Infinity, maxL = isFinite(f.max) ? Math.log10(f.max) : Infinity;
    g.fillStyle = '#1a1a21'; g.fillRect(0, h - 1, w, 1);
    for (let i = 0; i < B; i++) {
      if (!bins[i]) continue;
      const a = lo + (hi - lo) * i / B, b = lo + (hi - lo) * (i + 1) / B;
      const inside = b > minL && a < maxL;
      const bh = Math.max(2, (h - top - 1) * Math.sqrt(bins[i] / mx));
      const x = i * bw + gap / 2, bwid = Math.max(1, bw - gap), y = h - 1 - bh, r = Math.min(3, bwid / 2);
      g.fillStyle = inside ? '#199e70' : 'rgba(25,158,112,.28)';
      g.beginPath();
      g.moveTo(x, h - 1); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.lineTo(x + bwid - r, y); g.quadraticCurveTo(x + bwid, y, x + bwid, y + r); g.lineTo(x + bwid, h - 1);
      g.fill();
    }
    histo = { lo, hi, B, bins, w, n: vals.length };
    const tick = (l) => RC.compact(Math.pow(10, l));
    $('#histoAxis').innerHTML = `<span>${tick(lo)}</span><span>${tick((lo + hi) / 2)}</span><span>${tick(hi)}</span>`;
    cv.title = 'Distribución de montos (escala logarítmica). Arrastrá para elegir un rango; clic para quitarlo.';
  }
  {
    const cv = $('#histo'), tip = $('#histoTip');
    let drag = null;
    const binAt = (x) => histo ? RC.clamp(Math.floor(x / histo.w * histo.B), 0, histo.B - 1) : 0;
    const edge = (i) => Math.pow(10, histo.lo + (histo.hi - histo.lo) * i / histo.B);
    cv.addEventListener('pointermove', (e) => {
      if (!histo) return;
      const x = e.offsetX, i = binAt(x);
      tip.hidden = false; tip.style.left = `${x}px`;
      tip.textContent = `${RC.int(histo.bins[i])} contratos · ${RC.money(edge(i))} a ${RC.money(edge(i + 1))}`;
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; });
    cv.addEventListener('pointerdown', (e) => { if (histo) { drag = binAt(e.offsetX); cv.setPointerCapture(e.pointerId); } });
    cv.addEventListener('pointerup', (e) => {
      if (drag === null || !histo) return;
      const j = binAt(e.offsetX), a = Math.min(drag, j), b = Math.max(drag, j);
      drag = null;
      if (a === b) { state.f.min = NaN; state.f.max = NaN; }
      else { state.f.min = edge(a); state.f.max = edge(b + 1); }
      renderAmountChips(); refreshSoon();
    });
  }

  // ── resumen y HUD ───────────────────────────────────────
  function renderSummary() {
    const V = state.V, el = $('#summary');
    if (!V || !RC.model.DB.ks.length) { el.innerHTML = ''; return; }
    let note = '';
    if (V.omitCount) note += `Además hay ${RC.int(V.omitCount)} contratos con personas humanas por ${RC.money(V.omitTotal)}: suman al gasto de cada organismo pero no se muestran.`;
    if (V.sinCambio) note += ` ${RC.int(V.sinCambio)} contratos en monedas sin tipo de cambio no suman.`;
    el.innerHTML =
      `<div class="stat"><div class="sl">Contratos</div><div class="sv">${RC.int(V.idx.length)}</div></div>` +
      `<div class="stat"><div class="sl">Monto adjudicado</div><div class="sv">${RC.money(V.total)}</div></div>` +
      `<div class="stat"><div class="sl">Empresas</div><div class="sv">${RC.int(V.nCos)}</div></div>` +
      `<div class="stat"><div class="sl">Organismos</div><div class="sv">${RC.int(V.nOrgs)}</div></div>` +
      (note ? `<div class="snote">${note}</div>` : '');
  }
  function renderHud() {
    const s = RC.graph.stats;
    if (!RC.model.DB.ks.length) { $('#hud').innerHTML = ''; return; }
    $('#hud').innerHTML =
      `<b>${RC.int(s.org)}</b> organismos · <b>${RC.int(s.co)}</b> de ${RC.int(s.totalCo)} empresas · <b>${RC.int(s.k)}</b> de ${RC.int(s.totalK)} contratos<br>` +
      `clic: ficha · doble clic: acercar · arrastrar: girar · rueda: zoom`;
  }

  // ── alertas ─────────────────────────────────────────────
  function lvlStyle(sev) { const l = RC.alerts.level(sev); return { l, css: `--c:${l.color}` }; }
  function renderAlerts() {
    const A = state.A, T = RC.alerts.TYPES;
    const counts = A ? A.counts : { nueva: 0, acapara: 0, monto: 0, domicilio: 0 };
    $('#alertTypes').innerHTML = ALL_TYPES.map((t) =>
      `<div class="atype ${state.types.has(t) ? 'on' : ''}" data-t="${t}" title="${esc(T[t].label)}"><span class="g">${T[t].glyph}</span>${esc(T[t].short)}<span class="n">${RC.int(counts[t])}</span></div>`).join('');
    const list = A ? A.list.filter((a) => state.types.has(a.type)) : [];
    const total = A ? A.list.length : 0;
    $('#alertCount').textContent = total ? RC.int(total) : '';
    const el = $('#alertList');
    if (!RC.model.DB.ks.length) { el.innerHTML = '<div class="none">Importá datos para ver las alertas.</div>'; $('#alertFoot').textContent = ''; return; }
    if (!list.length) { el.innerHTML = '<div class="none">Ninguna alerta con estos filtros y umbrales.<br>Los umbrales se ajustan en <b>Ajustes</b>.</div>'; $('#alertFoot').textContent = ''; return; }
    el.innerHTML = list.slice(0, state.alertLimit).map((a) => {
      const { l, css } = lvlStyle(a.sev);
      return `<div class="alert ${state.alert === a.id ? 'on' : ''}" data-a="${a.id}" style="${css}">` +
        `<span class="sb"><i style="height:${Math.round(20 + 80 * a.sev)}%"></i></span><div>` +
        `<div class="ah"><span class="g">${T[a.type].glyph}</span>${esc(T[a.type].short)}<span class="lvl">${l.label}</span></div>` +
        `<div class="at">${esc(a.title)}</div><div class="as">${esc(a.sub)}</div></div></div>`;
    }).join('') + (list.length > state.alertLimit ? `<button class="btn sm ghost more" id="btnMoreAlerts">Mostrar ${RC.int(Math.min(120, list.length - state.alertLimit))} más de ${RC.int(list.length - state.alertLimit)}</button>` : '');
    $('#alertFoot').textContent = `${RC.int(list.length)} de ${RC.int(total)}`;
  }
  $('#alertTypes').addEventListener('click', (e) => {
    const c = e.target.closest('.atype'); if (!c) return;
    const t = c.dataset.t;
    if (e.shiftKey || e.ctrlKey) { state.types = new Set([t]); }
    else if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
    state.alertLimit = 120; renderAlerts();
  });
  $('#alertList').addEventListener('click', (e) => {
    if (e.target.id === 'btnMoreAlerts') { state.alertLimit += 120; renderAlerts(); return; }
    const c = e.target.closest('.alert'); if (!c) return;
    const a = state.A.byId.get(c.dataset.a);
    if (a) selectAlert(a);
  });

  function selectAlert(a) {
    state.alert = a.id;
    state.sel = a.focus;
    const refs = [];
    for (const t of ['org', 'co', 'k']) for (const i of a.nodes[t] || []) refs.push({ t, i });
    RC.graph.pinMany(refs);
    RC.graph.select(a.focus, { emphasis: a.nodes, focus: true, from: 'alert' });
    $$('.alert').forEach((el) => el.classList.toggle('on', el.dataset.a === a.id));
    showTab('detalle');
    renderDetail();
  }

  // ── seleccion ───────────────────────────────────────────
  function selectRef(ref, opts) {
    opts = opts || {};
    state.alert = null;
    state.sel = ref;
    if (ref && ref.t === 'jur') {
      // Un ministerio no es un nodo: se resaltan sus organismos, sus contratos y sus proveedores.
      RC.graph.select(null, { emphasis: jurEmphasis(ref.i), focus: opts.focus !== false, from: 'ui' });
    } else {
      RC.graph.select(ref, { focus: opts.focus !== false, from: opts.from || 'ui' });
      if (ref && !RC.graph.has(ref)) status('Ese elemento no está en la vista actual: revisá los filtros.');
    }
    showTab('detalle');
    renderDetail();
  }
  function jurEmphasis(j) {
    const DB = RC.model.DB, V = state.V;
    const orgs = new Set(RC.model.jurOrgs(j).map((o) => o.i));
    const k = [], co = new Set();
    for (const i of V.idx) { const x = DB.ks[i]; if (orgs.has(x.org)) { if (k.length < 1500) k.push(i); co.add(x.co); } }
    return { org: [...orgs], k, co: [...co] };
  }
  RC.graph.onSelect((ref, opts) => {
    if (opts.from !== 'graph') return;
    state.alert = null;
    state.sel = ref;
    if (ref) showTab('detalle');
    renderDetail();
  });
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-ref]');
    if (!r || e.target.closest('input')) return;
    const [t, i] = r.dataset.ref.split(':');
    selectRef({ t, i: +i });
  });

  function showTab(name) {
    $$('#right .tab').forEach((b) => b.classList.toggle('on', b.dataset.pane === name));
    $$('#right .pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
  }
  $$('#right .tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.pane)));

  // ── fichas de detalle ───────────────────────────────────
  function renderDetail() {
    const el = $('#detail'), ref = state.sel, DB = RC.model.DB;
    if (!ref || !DB.ks.length) {
      el.innerHTML = `<div class="none">Elegí un nodo del grafo, una alerta o un resultado de la búsqueda.</div>`;
      return;
    }
    let html = '';
    const a = state.alert && state.A.byId.get(state.alert);
    if (a) html += whyBlock(a, true);
    if (ref.t === 'jur') html += detailJur(ref.i);
    else if (ref.t === 'org') html += detailOrg(ref.i, a);
    else if (ref.t === 'co') html += detailCo(ref.i, a);
    else html += detailK(ref.i, a);
    el.innerHTML = html;
    el.scrollTop = 0;
    const tl = $('.timeline', el);
    if (tl) wireTimeline(tl);
    const bc = $('.bchart', el);
    if (bc) wireBudgetChart(bc);
  }

  function whyBlock(a, withEvidence) {
    const T = RC.alerts.TYPES, { l, css } = lvlStyle(a.sev), DB = RC.model.DB;
    let ev = '';
    if (withEvidence && a.evid && a.evid.length) {
      ev = '<div class="ev rows">' + a.evid.map((e) => {
        if (e.co !== undefined) { const c = DB.cos[e.co]; return `<div class="rowi" data-ref="co:${c.i}"><span class="rn">${esc(c.label)}</span><span class="rv"></span><span class="rs">${esc(e.note)}</span></div>`; }
        const k = DB.ks[e.k];
        return `<div class="rowi" data-ref="k:${k.i}"><span class="rn">${esc(k.doc || k.proc)}</span><span class="rv">${esc(RC.money(RC.toDisplay(k.usd, k.year)))}</span>` +
          `<span class="rs">${esc(DB.orgs[k.org].name)} · ${esc(e.note)}</span></div>`;
      }).join('') + '</div>';
    }
    return `<div class="why" style="${css}"><div class="wh">${T[a.type].glyph} ${esc(T[a.type].label)}<span class="lvl">severidad ${l.label}</span></div>${a.why}${ev}</div>`;
  }
  function nodeAlerts(t, i, skip) {
    if (!state.A) return '';
    const list = state.A.nodeAlerts(t, i).filter((a) => !skip || a.id !== skip.id).slice(0, 6);
    if (!list.length) return '';
    return `<div class="dsec"><h3>Alertas <span class="dim">${list.length}</span></h3>${list.map((a) => whyBlock(a, false)).join('')}</div>`;
  }
  const kindHead = (t, extra) => `<div class="dkind"><span class="sw ${t === 'jur' ? 'org' : t}"></span>${{ jur: 'Ministerio o jurisdicción', org: 'Organismo', co: 'Empresa', k: 'Contrato' }[t]}${extra || ''}</div>`;
  const statBox = (label, value) => `<div class="stat"><div class="sl">${label}</div><div class="sv">${value}</div></div>`;
  const inView = (t, i) => { const V = state.V; return t === 'org' ? V.orgN[i] > 0 : t === 'co' ? V.coN[i] > 0 : V.has[i] === 1; };
  const outNote = (t, i) => inView(t, i) ? '' : `<div class="dsub"><span class="warn">No aparece con los filtros actuales.</span></div>`;

  function kRow(k, sub) {
    const DB = RC.model.DB, fl = state.A && state.A.flagged.k.get(k.i);
    const css = fl ? ` style="--c:${RC.alerts.level(fl.sev).color}"` : '';
    return `<div class="rowi ${fl ? 'flag' : ''}" data-ref="k:${k.i}"${css}><span class="rn">${esc(k.doc || k.proc || 'Contrato')}</span>` +
      `<span class="rv">${esc(RC.money(RC.toDisplay(k.usd, k.year)))}</span><span class="rs">${esc(RC.fmtDate(k.date))} · ${esc(sub)}</span></div>`;
  }

  function detailOrg(i, a) {
    const DB = RC.model.DB, V = state.V, o = DB.orgs[i];
    const ks = V.idx.filter((j) => DB.ks[j].org === i);
    const byCo = new Map();
    for (const j of ks) { const k = DB.ks[j]; byCo.set(k.co, (byCo.get(k.co) || 0) + V.disp[j]); }
    const total = V.orgSum[i] + V.omitSum[i];
    const top = [...byCo].sort((x, y) => y[1] - x[1]);
    let hhi = 0; for (const [, v] of top) hhi += (v / (total || 1)) ** 2;
    const shown = top.slice(0, 8);
    const rest = top.slice(8).reduce((s, [, v]) => s + v, 0);
    const bar = (label, v, ref, cls) => {
      const p = total ? v / total : 0;
      return `<div class="bar ${cls || ''}" ${ref ? `data-ref="${ref}"` : ''}><div class="bl"><span class="bn">${esc(label)}</span>` +
        `<span class="bv">${RC.pct(p)} · ${RC.money(v)}</span></div><div class="bt"><i style="width:${(100 * p).toFixed(1)}%"></i></div></div>`;
    };
    const bars = shown.map(([c, v]) => bar(DB.cos[c].label, v, `co:${c}`)).join('') +
      (rest > 0 ? bar(`Otros ${RC.int(top.length - 8)} proveedores`, rest, null, 'rest') : '') +
      (V.omitSum[i] > 0 ? bar(`Personas humanas (${RC.int(V.omitN[i])} contratos, sin identificar)`, V.omitSum[i], null, 'rest') : '');
    ks.sort((x, y) => V.disp[y] - V.disp[x]);
    return kindHead('org', o.code ? ` · SAF ${esc(o.code)}` : '') +
      `<h2 class="dtitle">${esc(o.name)}</h2>` + dependency(o) + outNote('org', i) +
      `<div class="stats">${statBox('Adjudicado', RC.money(total))}${statBox('Contratos', RC.int(V.orgN[i] + V.omitN[i]))}${statBox('Proveedores', RC.int(byCo.size))}</div>` +
      nodeAlerts('org', i, a) +
      budgetSection([i], RC.model.budgetOf(i)) +
      `<div class="dsec"><h3>A quién le compra <span class="dim">HHI ${Math.round(hhi * 10000)}</span></h3><div class="bars">${bars || '<div class="faint">—</div>'}</div></div>` +
      `<div class="dsec"><h3>Contratos más grandes <span class="dim">${RC.int(ks.length)} con empresas</span></h3><div class="rows">` +
      ks.slice(0, 15).map((j) => kRow(DB.ks[j], DB.cos[DB.ks[j].co].label)).join('') + '</div></div>';
  }

  // Ministerio del que depende el organismo, y sus cambios de dependencia en el tiempo.
  function dependency(o) {
    const DB = RC.model.DB;
    const bs = RC.model.budgetOf(o.i);
    if (!bs.length) return `<div class="dsub">Fuera del presupuesto de la Administración Nacional${o.code ? '' : ' (o sin código de organismo en los datos)'}.</div>`;
    const runs = [];
    for (const b of bs) {
      const r = runs[runs.length - 1];
      if (r && r.j === b.jur) r.to = b.year; else runs.push({ j: b.jur, from: b.year, to: b.year });
    }
    const cur = runs[runs.length - 1];
    let s = `<div class="dsub">Depende de <span class="link" data-ref="jur:${cur.j}">${esc(DB.dict.jur[cur.j])}</span>`;
    const last = bs[bs.length - 1];
    if (DB.dict.sub[last.sub] && DB.dict.sub[last.sub] !== DB.dict.jur[cur.j]) s += ` · ${esc(DB.dict.sub[last.sub])}`;
    if (runs.length > 1) s += `<br><span class="faint">Antes: ${runs.slice(0, -1).reverse().map((r) => `${esc(DB.dict.jur[r.j])} (${r.from === r.to ? r.from : `${r.from}–${r.to}`})`).join(' · ')}</span>`;
    return s + '</div>';
  }

  /* Presupuesto y compras por anio de un conjunto de organismos: devengado en bienes y
     servicios (incisos 2, 3 y 4) contra lo adjudicado. Dos series, en la escala elegida. */
  function budgetSeries(orgIdx) {
    const DB = RC.model.DB, set = new Set(orgIdx), rows = new Map();
    const get = (y) => rows.get(y) || rows.set(y, { y, bs: 0, dev: 0, vig: 0, adj: 0, hasB: false }).get(y);
    for (const i of orgIdx) for (const b of RC.model.budgetOf(i)) {
      const r = get(b.year), rate = RC.usdRate(b.year);
      r.bs += RC.toDisplay(b.devBS / rate, b.year); r.dev += RC.toDisplay(b.dev / rate, b.year); r.vig += RC.toDisplay(b.vig / rate, b.year); r.hasB = true;
    }
    for (const k of DB.ks) if (set.has(k.org) && isFinite(k.year) && isFinite(k.usd)) get(k.year).adj += RC.toDisplay(k.usd, k.year);
    const O = DB.omit;
    for (let q = 0; q < O.org.length; q++) if (set.has(O.org[q]) && isFinite(O.year[q]) && isFinite(O.usd[q])) get(O.year[q]).adj += RC.toDisplay(O.usd[q], O.year[q]);
    return [...rows.values()].filter((r) => r.y >= 2015 && (r.hasB || r.adj > 0)).sort((a, b) => a.y - b.y);
  }
  let chartSeries = [];
  function budgetSection(orgIdx, own) {
    const DB = RC.model.DB, series = budgetSeries(orgIdx);
    if (!series.some((r) => r.hasB)) return '';
    chartSeries = series;
    const W = 340, H = 132, padL = 58, padB = 18, padT = 6, n = series.length;
    const mx = Math.max(1, ...series.map((r) => Math.max(r.bs, r.adj)));
    const slot = (W - padL) / n, bw = Math.min(12, (slot - 6) / 2);
    const y = (v) => padT + (H - padT - padB) * (1 - v / mx);
    const bar = (x, v, fill) => {
      if (!(v > 0)) return '';
      const top = y(v), bot = H - padB, r = Math.min(3, bw / 2, (bot - top) / 2);
      return `<path d="M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bot}Z" fill="${fill}"/>`;
    };
    let g = '';
    for (const f of [0, 0.5, 1]) {
      const yy = y(mx * f);
      g += `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" stroke="#1f1f27"/>` +
        `<text x="${padL - 5}" y="${yy + 3}" fill="#8f8f9c" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono, monospace">${RC.compact(mx * f)}</text>`;
    }
    series.forEach((r, q) => {
      const x0 = padL + q * slot + (slot - (bw * 2 + 2)) / 2;
      g += bar(x0, r.bs, '#3987e5') + bar(x0 + bw + 2, r.adj, '#199e70');
      if (n <= 8 || q % 2 === 0 || q === n - 1)
        g += `<text x="${x0 + bw + 1}" y="${H - 5}" fill="#8f8f9c" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono, monospace">${String(r.y).slice(2)}</text>`;
      g += `<rect x="${padL + q * slot}" y="${padT}" width="${slot}" height="${H - padT - padB}" fill="transparent" data-q="${q}"/>`;
    });
    const last = [...series].reverse().find((r) => r.hasB);
    const ues = new Map();
    for (const b of own) if (b.year === last.y) for (const [u, [dev]] of b.ues) ues.set(u, (ues.get(u) || 0) + dev);
    const ueRows = [...ues].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const rate = RC.usdRate(last.y);
    // Cobertura: cuanto de lo devengado en bienes y servicios aparece como adjudicado en los datos.
    const both = series.filter((r) => r.hasB && r.bs > 0);
    const sBs = both.reduce((s, r) => s + r.bs, 0), sAdj = both.reduce((s, r) => s + r.adj, 0);
    const cov = sBs > 0 ? `<div class="chart-note">Entre ${both[0].y} y ${both[both.length - 1].y}, lo adjudicado en COMPR.AR y CONTRAT.AR equivale al <b>${RC.pct(sAdj / sBs)}</b> de lo devengado en bienes y servicios. ` +
      `El resto se compra por otras vías (convenios, organismos internacionales, cajas chicas) o no se publica en estos sistemas.</div>` : '';
    return `<div class="dsec"><h3>Presupuesto y compras <span class="dim">${RC.unit()} por año</span></h3>` +
      `<div class="stats">${statBox(`Vigente ${last.y}`, RC.money(last.vig))}${statBox(`Devengado ${last.y}`, RC.money(last.dev))}${statBox('Bienes y servicios', RC.money(last.bs))}</div>` +
      `<div class="lgd"><span><i style="background:#3987e5"></i>Devengado en bienes y servicios</span><span><i style="background:#199e70"></i>Adjudicado</span></div>` +
      `<div class="bchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Devengado en bienes y servicios y adjudicado por año">${g}</svg><div class="ttip" hidden></div></div>` +
      cov + `<div class="chart-note">Bienes y servicios son los incisos 2, 3 y 4 del presupuesto. Lo adjudicado en un año se paga a lo largo de varios y las órdenes de compra abiertas son topes: la comparación es orientativa.</div></div>` +
      (ueRows.length ? `<div class="dsec"><h3>Secretarías, subsecretarías y unidades <span class="dim">devengado ${last.y}</span></h3><div class="rows">` +
        ueRows.slice(0, 18).map(([u, v]) => `<div class="rowi nolink"><span class="rn">${esc(u)}</span><span class="rv">${RC.money(RC.toDisplay(v / rate, last.y))}</span></div>`).join('') +
        (ueRows.length > 18 ? `<div class="faint" style="padding:6px 4px">y ${ueRows.length - 18} unidades más</div>` : '') + '</div></div>' : '');
  }
  function wireBudgetChart(el) {
    const tip = $('.ttip', el), svg = $('svg', el);
    svg.addEventListener('pointermove', (e) => {
      const r = e.target.closest('rect[data-q]');
      if (!r) { tip.hidden = true; return; }
      const s = chartSeries[+r.dataset.q], box = el.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${e.clientX - box.left}px`; tip.style.top = `${e.clientY - box.top - 8}px`;
      tip.innerHTML = `<b>${s.y}</b> · bienes y servicios ${RC.money(s.bs)} · adjudicado ${RC.money(s.adj)}`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // Ficha de un ministerio (jurisdiccion): sus organismos, su presupuesto y sus unidades.
  function detailJur(j) {
    const DB = RC.model.DB, V = state.V;
    const orgs = RC.model.jurOrgs(j);
    let adj = 0, n = 0;
    for (const o of orgs) { adj += V.orgSum[o.i] + V.omitSum[o.i]; n += V.orgN[o.i] + V.omitN[o.i]; }
    const withK = orgs.filter((o) => V.orgN[o.i] + V.omitN[o.i] > 0).length;
    const own = orgs.flatMap((o) => RC.model.budgetOf(o.i));
    const lastY = own.reduce((m, b) => Math.max(m, b.year), -Infinity);
    const devLast = new Map(own.filter((b) => b.year === lastY).map((b) => [b.saf, b.dev]));
    const rows = orgs.map((o) => ({ o, v: V.orgSum[o.i] + V.omitSum[o.i], dev: devLast.get(o.code) || 0 }))
      .sort((a, b) => b.v - a.v || b.dev - a.dev);
    const alerts = state.A ? state.A.list.filter((a) => (a.nodes.org || []).some((i) => orgs.some((o) => o.i === i))).slice(0, 6) : [];
    return kindHead('jur') + `<h2 class="dtitle">${esc(DB.dict.jur[j])}</h2>` +
      `<div class="dsub">${RC.int(orgs.length)} organismos según el presupuesto ${isFinite(lastY) ? lastY : ''}; ${RC.int(withK)} con compras en la vista.</div>` +
      `<div class="stats">${statBox('Adjudicado', RC.money(adj))}${statBox('Contratos', RC.int(n))}${statBox('Organismos', RC.int(orgs.length))}</div>` +
      (alerts.length ? `<div class="dsec"><h3>Alertas <span class="dim">${alerts.length} más severas</span></h3>${alerts.map((a) => whyBlock(a, false)).join('')}</div>` : '') +
      budgetSection(orgs.map((o) => o.i), own) +
      `<div class="dsec"><h3>Organismos <span class="dim">adjudicado · devengado ${isFinite(lastY) ? lastY : ''}</span></h3><div class="rows">` +
      rows.map(({ o, v, dev }) => `<div class="rowi" data-ref="org:${o.i}"><span class="rn">${esc(o.name)}</span><span class="rv">${v > 0 ? RC.money(v) : '—'}</span>` +
        `<span class="rs">${dev > 0 ? `devengado ${RC.money(RC.toDisplay(dev / RC.usdRate(lastY), lastY))}` : 'sin presupuesto el último año'}${o.code ? ` · SAF ${esc(o.code)}` : ''}</span></div>`).join('') + '</div></div>';
  }

  // Ofertas de la empresa en obra publica (CONTRAT.AR): en que procesos compitio y contra quien.
  function bidsSection(ci) {
    const DB = RC.model.DB, BI = RC.model.bidIndex(), mine = BI.byCo.get(ci) || [];
    if (!mine.length) return '';
    const B = DB.bids;
    const won = new Set(DB.ks.filter((k) => k.co === ci).map((k) => k.proc));
    const procs = new Map();
    for (const bi of mine) {
      const p = B.proc[bi];
      if (!procs.has(p)) procs.set(p, { p, org: B.org[bi], rank: B.rank[bi], amt: B.amt[bi], rivals: new Set() });
      const e = procs.get(p);
      if (B.rank[bi] && (!e.rank || B.rank[bi] < e.rank)) e.rank = B.rank[bi];
      for (const oi of BI.byProc.get(p) || []) if (B.co[oi] !== ci) e.rivals.add(B.co[oi]);
    }
    const list = [...procs.values()];
    const nWon = list.filter((e) => won.has(e.p)).length;
    return `<div class="dsec"><h3>Ofertas en obra pública <span class="dim">${RC.int(list.length)} procesos · ganó ${RC.int(nWon)}</span></h3><div class="rows">` +
      list.slice(0, 20).map((e) => `<div class="rowi nolink"><span class="rn">${esc(e.p)} · ${esc(DB.orgs[e.org].name)}</span>` +
        `<span class="rv">${won.has(e.p) ? 'ganó' : e.rank ? `${e.rank}.º` : '—'}</span>` +
        `<span class="rs">${e.rivals.size ? `contra ${[...e.rivals].slice(0, 3).map((r) => `<span class="link" data-ref="co:${r}">${esc(DB.cos[r].label)}</span>`).join(', ')}${e.rivals.size > 3 ? ` y ${e.rivals.size - 3} más` : ''}` : 'sin otras ofertas de sociedades'}</span></div>`).join('') +
      '</div></div>';
  }

  function detailCo(i, a) {
    const DB = RC.model.DB, V = state.V, c = DB.cos[i];
    const ks = V.idx.filter((j) => DB.ks[j].co === i).sort((x, y) => DB.ks[y].date - DB.ks[x].date);
    const allKs = DB.ks.filter((k) => k.co === i);
    const byOrg = new Map();
    for (const j of ks) { const k = DB.ks[j]; byOrg.set(k.org, (byOrg.get(k.org) || 0) + V.disp[j]); }
    const now = Date.now();
    const kv = [];
    kv.push(['CUIT', c.cuit ? `<span class="mono">${RC.fmtCuit(c.cuit)}</span>${c.valid ? '' : ' <span class="warn" style="color:var(--s-baja)">dígito verificador inválido</span>'}`
      : c.id.startsWith('X:') ? `<span class="mono">${esc(c.id.slice(2))}</span> <span class="dim">(identificador extranjero)</span>` : '<span class="dim">sin identificador</span>']);
    if (c.tipo) kv.push(['Tipo', esc(c.tipo.charAt(0) + c.tipo.slice(1).toLowerCase())]);
    if (isFinite(c.fconst)) kv.push(['Constitución', `${RC.fmtDate(c.fconst)} <span class="dim">(hace ${RC.fmtAge((now - c.fconst) / RC.DAY)})</span>`]);
    if (c.addr) {
      let d = esc(RC.fmtAddr(c.addr));
      if (c.estadoDom) d += ` <span class="dim">· ${esc(c.estadoDom.toLowerCase())}</span>`;
      kv.push(['Domicilio legal', d]);
    }
    if (c.akeys && c.crowd > 1) {
      const peers = DB.cos.filter((x) => x !== c && x.akeys && x.akeys.bld === c.akeys.bld);
      kv.push(['Mismo domicilio', `${RC.int(c.crowd)} sociedades en el registro` +
        (peers.length ? `; proveedoras: ${peers.slice(0, 6).map((x) => `<span class="link" data-ref="co:${x.i}">${esc(x.label)}</span>`).join(', ')}${peers.length > 6 ? '…' : ''}` : '')]);
    }
    if (c.act) kv.push(['Actividad', esc(c.act)]);
    if (!c.reg && c.kind === 'juridica') kv.push(['Registro', `<span class="dim">${DB.regChecked.has(c.cuit) ? 'no figura en el registro importado' : 'todavía no se cruzó con un registro de sociedades'}</span>`]);
    if (c.redacted) kv.push(['Nombre', `<span class="dim">omitido: en una ${esc(c.redacted.toLowerCase())} el nombre suele ser el de sus integrantes</span>`]);
    const orgs = [...byOrg].sort((x, y) => y[1] - x[1]);
    return kindHead('co') + `<h2 class="dtitle">${esc(c.label)}</h2>` + outNote('co', i) +
      `<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` +
      `<div class="stats">${statBox('Adjudicado', RC.money(V.coSum[i]))}${statBox('Contratos', RC.int(V.coN[i]))}${statBox('Organismos', RC.int(byOrg.size))}</div>` +
      timeline(c, allKs) +
      nodeAlerts('co', i, a) +
      bidsSection(i) +
      (orgs.length ? `<div class="dsec"><h3>Le vende a</h3><div class="rows">${orgs.slice(0, 10).map(([o, v]) =>
        `<div class="rowi" data-ref="org:${o}"><span class="rn">${esc(DB.orgs[o].name)}</span><span class="rv">${RC.money(v)}</span></div>`).join('')}</div></div>` : '') +
      `<div class="dsec"><h3>Contratos <span class="dim">${RC.int(ks.length)} en la vista</span></h3><div class="rows">` +
      ks.slice(0, 25).map((j) => kRow(DB.ks[j], DB.orgs[DB.ks[j].org].name)).join('') + '</div></div>';
  }

  // Linea de tiempo de una empresa: constitucion y contratos (punto = contrato,
  // tamanio = monto). Una sola serie: el color de contrato y el texto en tinta neutra.
  function timeline(c, ks) {
    if (!ks.length) return '';
    const W = 340, H = 74, padL = 6, padR = 6, base = 52;
    let t0 = Math.min(...ks.map((k) => k.date)), t1 = Math.max(...ks.map((k) => k.date));
    if (isFinite(c.fconst)) t0 = Math.min(t0, c.fconst);
    const span = Math.max(t1 - t0, 180 * RC.DAY);
    t0 -= span * 0.04; t1 = t0 + span * 1.08;
    const x = (t) => padL + (W - padL - padR) * (t - t0) / (t1 - t0);
    const maxU = Math.max(...ks.map((k) => k.usd || 0)) || 1;
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    // Marcas por anio; si el periodo es corto, por trimestre.
    const marks = [];
    if (t1 - t0 > 2.5 * 365 * RC.DAY) {
      const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 6));
      for (let y = y0; y <= y1; y += step) marks.push([Date.UTC(y, 0, 1), String(y)]);
    } else {
      const MES = ['ene', 'abr', 'jul', 'oct'];
      for (let y = y0; y <= y1; y++) for (let q = 0; q < 4; q++) marks.push([Date.UTC(y, q * 3, 1), `${MES[q]} ${String(y).slice(2)}`]);
    }
    let ticks = '';
    for (const [t, label] of marks) {
      if (t < t0 || t > t1) continue;
      ticks += `<line x1="${x(t)}" x2="${x(t)}" y1="${base}" y2="${base + 4}" stroke="#2c2c35"/><text x="${x(t)}" y="${base + 16}" fill="#8f8f9c" font-size="10" text-anchor="middle" font-family="IBM Plex Mono, monospace">${label}</text>`;
    }
    let mark = '';
    if (isFinite(c.fconst)) {
      const xc = x(c.fconst);
      mark = `<line x1="${xc}" x2="${xc}" y1="6" y2="${base}" stroke="#e8e8ee" stroke-width="1"/>` +
        `<text x="${Math.min(xc + 4, W - 70)}" y="12" fill="#e8e8ee" font-size="10.5" font-family="IBM Plex Sans, sans-serif">constitución</text>`;
    }
    const sorted = ks.slice().sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 400).reverse();
    const dots = sorted.map((k) => {
      const r = 4 + 6 * Math.sqrt((k.usd || 0) / maxU);
      return `<circle cx="${x(k.date).toFixed(1)}" cy="${(base - 4 - r).toFixed(1)}" r="${r.toFixed(1)}" fill="#199e70" stroke="#0f0f13" stroke-width="2" data-k="${k.i}" style="cursor:pointer"/>`;
    }).join('');
    return `<div class="dsec"><h3>En el tiempo <span class="dim">todos los contratos cargados</span></h3><div class="timeline">` +
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contratos de la empresa a lo largo del tiempo">` +
      `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#2c2c35"/>${ticks}${mark}${dots}</svg><div class="ttip" hidden></div></div></div>`;
  }
  function wireTimeline(tl) {
    const tip = $('.ttip', tl), svg = $('svg', tl), DB = RC.model.DB;
    svg.addEventListener('pointermove', (e) => {
      const d = e.target.closest('circle[data-k]');
      if (!d) { tip.hidden = true; return; }
      const k = DB.ks[+d.dataset.k], r = tl.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top - 8}px`;
      tip.textContent = `${RC.fmtDate(k.date)} · ${RC.moneyNative(k.amt, k.cur)} · ${k.doc || k.proc}`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.addEventListener('click', (e) => { const d = e.target.closest('circle[data-k]'); if (d) selectRef({ t: 'k', i: +d.dataset.k }); });
  }

  function detailK(i, a) {
    const DB = RC.model.DB, V = state.V, k = DB.ks[i], c = DB.cos[k.co], o = DB.orgs[k.org];
    const kv = [];
    kv.push(['Monto', `<span class="mono">${RC.moneyNative(k.amt, k.cur)}</span>` + (k.cur !== 'ARS' || RC.settings.moneda !== 'ARS' ? ` <span class="dim">≈ ${RC.money(RC.toDisplay(k.usd, k.year))}</span>` : '')]);
    kv.push(['Fecha', RC.fmtDate(k.date)]);
    kv.push(['Organismo', `<span class="link" data-ref="org:${o.i}">${esc(o.name)}</span>`]);
    kv.push(['Empresa', `<span class="link" data-ref="co:${c.i}">${esc(c.label)}</span>` + (c.cuit ? ` <span class="dim mono">${RC.fmtCuit(c.cuit)}</span>` : '')]);
    if (k.proc) kv.push(['Proceso', `<span class="mono">${esc(k.proc)}</span>`]);
    if (DB.dict.dt[k.dt]) kv.push(['Documento', esc(DB.dict.dt[k.dt])]);
    if (DB.dict.pt[k.pt]) kv.push(['Procedimiento', esc(DB.dict.pt[k.pt])]);
    if (DB.dict.uoc[k.uoc]) kv.push(['Unidad', esc(DB.dict.uoc[k.uoc])]);
    if (DB.dict.rbs[k.rbs]) kv.push(['Rubros', esc(DB.dict.rbs[k.rbs].split(';').map((s) => s.trim().toLowerCase()).filter(Boolean).join(', '))]);
    const obj = RC.model.objeto(k);
    if (obj) kv.push(['Objeto', esc(obj)]);
    const cv = DB.convoc.get(k.proc);
    if (cv && cv.est > 0) kv.push(['Estimado', `<span class="mono">${RC.moneyNative(cv.est, 'ARS')}</span> <span class="dim">(convocatoria)</span>`]);
    if (isFinite(c.fconst)) {
      const age = (k.date - c.fconst) / RC.DAY;
      kv.push(['Antigüedad', age < 0 ? `<span style="color:var(--s-baja)">adjudicado ${RC.fmtAge(-age)} antes de la constitución</span>` : `la empresa tenía ${RC.fmtAge(age)}`]);
    }
    // Comparacion con el anio y el rubro dentro de la vista.
    let cmp = '';
    if (isFinite(k.usd) && V.has[i]) {
      const same = [], year = [];
      for (const j of V.idx) { const q = DB.ks[j]; if (q.year !== k.year || !isFinite(q.usd)) continue; year.push(q.usd); if (q.rb === k.rb) same.push(q.usd); }
      year.sort((x, y) => x - y); same.sort((x, y) => x - y);
      const rank = year.filter((v) => v <= k.usd).length / year.length;
      const med = RC.quantileSorted(same, 0.5);
      cmp = `<div class="stats">${statBox(`Percentil en ${k.year}`, Math.round(rank * 100))}` +
        `${statBox('Vs. mediana del rubro', same.length >= 5 ? `${(k.usd / med).toFixed(1).replace('.', ',')}×` : '—')}` +
        `${statBox('Contratos del rubro', RC.int(same.length))}</div>`;
    }
    return kindHead('k') + `<h2 class="dtitle">${esc(k.doc || k.proc || 'Contrato')}</h2>` + outNote('k', i) +
      `<dl class="kv">${kv.map(([x, v]) => `<dt>${x}</dt><dd>${v}</dd>`).join('')}</dl>` + cmp + nodeAlerts('k', i, a);
  }

  // ── busqueda ────────────────────────────────────────────
  {
    const q = $('#q'), box = $('#qres');
    let items = [], on = -1;
    const run = RC.debounce(() => {
      const text = q.value;
      if (!text.trim()) { box.hidden = true; return; }
      const r = RC.model.search(text, state.V, 6);
      const DB = RC.model.DB;
      items = [];
      let html = '';
      const sec = (title, arr, row) => { if (!arr.length) return; html += `<div class="qh">${title}</div>`; for (const x of arr) { items.push(row(x)); html += items[items.length - 1].html; } };
      sec('Ministerios', r.jurs, (j) => ({ ref: { t: 'jur', i: j.i }, html: `<div class="qi" data-n="${items.length}"><span class="sw org"></span><span class="qn">${esc(j.name)}</span><span class="qm">ministerio</span></div>` }));
      sec('Organismos', r.orgs, (o) => ({ ref: { t: 'org', i: o.i }, html: `<div class="qi" data-n="${items.length}"><span class="sw org"></span><span class="qn">${esc(o.name)}</span><span class="qm mono">${state.V ? RC.money(state.V.orgSum[o.i]) : ''}</span></div>` }));
      sec('Empresas', r.cos, (c) => ({ ref: { t: 'co', i: c.i }, html: `<div class="qi" data-n="${items.length}"><span class="sw co"></span><span class="qn">${esc(c.label)}</span><span class="qm mono">${c.cuit ? RC.fmtCuit(c.cuit) : ''}</span></div>` }));
      sec('Contratos', r.ks, (k) => ({ ref: { t: 'k', i: k.i }, html: `<div class="qi" data-n="${items.length}"><span class="sw k"></span><span class="qn">${esc(k.doc || k.proc)} · ${esc(DB.cos[k.co].label)}</span><span class="qm mono">${RC.money(RC.toDisplay(k.usd, k.year))}</span></div>` }));
      box.innerHTML = html || `<div class="qe">Sin resultados para “${esc(text)}”.</div>`;
      box.hidden = false; on = items.length ? 0 : -1; mark();
    }, 110);
    const mark = () => $$('.qi', box).forEach((el, j) => el.classList.toggle('on', j === on));
    const choose = (j) => { const it = items[j]; if (!it) return; box.hidden = true; q.blur(); selectRef(it.ref); };
    q.addEventListener('input', run);
    q.addEventListener('focus', () => { if (q.value.trim()) run(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(on); e.preventDefault(); }
      else if (e.key === 'Escape') { box.hidden = true; q.blur(); }
    });
    box.addEventListener('mousedown', (e) => { const it = e.target.closest('.qi'); if (it) { e.preventDefault(); choose(+it.dataset.n); } });
    q.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  }

  // ── modales ─────────────────────────────────────────────
  function modal({ title, body, foot, cls, onClose }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>` +
      `<button class="btn sm ghost x" data-close>Cerrar</button></header><div class="mbody">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div>`;
    const close = () => { if (back.dataset.locked) return; back.remove(); if (onClose) onClose(); };
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    $('#modalRoot').appendChild(back);
    return { el: back, close, lock(v) { if (v) back.dataset.locked = '1'; else delete back.dataset.locked; } };
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((res) => {
      const m = modal({
        title, body: `<p style="margin:0;line-height:1.55">${text}</p>`,
        foot: `<div class="grow"></div><button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'accent'}" data-ok>${esc(okLabel)}</button>`,
        onClose: () => res(false)
      });
      $('[data-ok]', m.el).addEventListener('click', () => { m.el.remove(); res(true); });
    });
  }
  const openExternal = (url) => { if (global.rcDesktop) global.rcDesktop.openExternal(url); else global.open(url, '_blank', 'noopener'); };
  document.addEventListener('click', (e) => { const x = e.target.closest('[data-ext]'); if (x) { e.preventDefault(); openExternal(x.dataset.ext); } });

  const PRIVACY = `<div class="privacy"><b>Sin datos de personas.</b> Las filas cuyo proveedor tiene CUIT de persona humana (20, 23, 24 o 27) no se guardan: ` +
    `solo quedan organismo, fecha y monto, sin identidad, para que los totales cierren. Los proveedores sin CUIT argentino se aceptan solo si la razón social ` +
    `tiene un marcador societario (S.A., S.R.L., Ltd., GmbH…). De sociedades de hecho, condominios y sucesiones se omite el nombre, porque suele ser el de sus integrantes. ` +
    `Del registro se leen solo columnas de la sociedad; los archivos de autoridades, socios o documentos se rechazan.</div>`;

  // ── importacion ─────────────────────────────────────────
  let importing = null;
  function openImport(initialFiles) {
    if (importing) return;
    const B0 = RC.model.DB.base;
    const m = modal({
      title: 'Importar datos', cls: 'wide',
      body: (B0 ? `<p class="dim" style="margin:0 0 10px;line-height:1.5">La app ya trae la <b>base incluida</b> (corte ${esc(RC.fmtDate(Date.parse(B0.corte)))}): ` +
        `${RC.int(B0.totales.contratos)} contratos de ${RC.int(B0.totales.organismos)} organismos. Importar sirve para sumar archivos más nuevos o de otras jurisdicciones.</p>` : '') +
        `<div class="dz" id="dz"><div class="dzi">↓</div><p><b>Arrastrá los archivos acá</b> o <button class="btn sm" id="pick">elegí archivos</button></p>` +
        `<p class="faint">CSV · ZIP · JSON y JSONL en formato OCDS · varios a la vez</p></div><div class="jobs" id="jobs"></div>` +
        `<div class="help"><h4>Qué descargar</h4><ol>` +
        `<li><b>Adjudicaciones de COMPR.AR</b>: en <span class="ext" data-ext="https://datos.gob.ar/dataset/sistema-de-contrataciones-electronicas">datos.gob.ar › Sistema de Contrataciones Electrónicas</span>, el CSV “Adjudicaciones 2016 - 2026” (~90 MB). También sirven los archivos por año y los del sistema anterior.</li>` +
        `<li><b>Registro Nacional de Sociedades</b>: en <span class="ext" data-ext="https://datos.jus.gob.ar/dataset/registro-nacional-de-sociedades">datos.jus.gob.ar › Registro Nacional de Sociedades</span>, el ZIP del año (~120 MB, no hace falta descomprimirlo). Aporta tipo societario, fecha de contrato social y domicilio legal. Se cruza contra los proveedores ya cargados, así que va después de las adjudicaciones; si los elegís juntos, la app los ordena sola.</li>` +
        `<li>Opcional: <b>Convocatorias</b> (objeto y monto estimado de cada proceso) y <b>SIPRO</b> (tipo de personería), del mismo conjunto de COMPR.AR.</li>` +
        `<li>Otras jurisdicciones: cualquier publicación en formato <b>OCDS</b> (JSON o JSONL).</li></ol>${PRIVACY}</div>`,
      foot: `<button class="btn ghost" id="impSample">Cargar ejemplo ficticio</button><div class="grow"></div><button class="btn ghost" id="impCancel" hidden>Cancelar importación</button><button class="btn" data-close>Listo</button>`
    });
    const dz = $('#dz', m.el), jobs = $('#jobs', m.el);
    $('#pick', m.el).addEventListener('click', () => $('#fileInput').click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); run([...e.dataTransfer.files]); });
    $('#impSample', m.el).addEventListener('click', () => loadSample(m));
    const rows = new Map();
    const row = (src) => {
      let el = rows.get(src.name);
      if (!el) {
        el = document.createElement('div'); el.className = 'job';
        el.innerHTML = `<div class="jh"><span class="jn"></span><span class="jk">…</span></div><div class="jp"><i></i></div><div class="jr dim">En espera</div>`;
        $('.jn', el).textContent = src.name;
        jobs.appendChild(el); rows.set(src.name, el);
      }
      return el;
    };
    const ui = {
      detected(src, info) { const el = row(src); $('.jk', el).textContent = RC.reader.KIND_LABEL[info.kind] || info.kind; },
      failed(src, e) {
        const el = row(src); el.classList.add('err');
        $('.jr', el).textContent = e.name === 'AbortError' ? 'Cancelado.' : e.message || String(e);
      },
      start(src) { $('.jr', row(src)).textContent = 'Leyendo…'; },
      progress(src, bytes, st) {
        const el = row(src);
        $('.jp i', el).style.width = `${Math.min(100, 100 * bytes / (src.size || 1)).toFixed(1)}%`;
        $('.jr', el).textContent = `Leyendo… ${RC.int(st.rows)} filas`;
        status(`Importando ${src.name}: ${RC.int(st.rows)} filas`, true);
      },
      done(src, st) {
        const el = row(src); el.classList.add('ok');
        $('.jp i', el).style.width = '100%';
        $('.jk', el).textContent = RC.reader.KIND_LABEL[st.tipo] || st.tipo;
        $('.jr', el).textContent = resultText(st);
      }
    };
    async function run(files) {
      if (!files.length || importing) return;
      const DB = RC.model.DB;
      if (DB.demo && DB.ks.length) {
        const ok = await confirmBox('Hay datos de ejemplo cargados', 'Los datos ficticios de ejemplo se borran antes de importar datos reales.', 'Borrar y seguir');
        if (!ok) return;
        await RC.model.clear();
        await loadBaseUI();
      }
      importing = new AbortController();
      m.lock(true); $('#impCancel', m.el).hidden = false; $('#impSample', m.el).disabled = true;
      status('Importando…', true);
      const t0 = RC.now();
      try {
        const res = await RC.model.importFiles(files, ui, importing.signal);
        if (res.length) { dataChanged(); status(`Importación terminada en ${((RC.now() - t0) / 1000).toFixed(1)} s.`); }
        else status('No se importó nada.');
      } catch (e) { status(`Error al importar: ${e.message}`); console.error(e); }
      finally {
        importing = null; m.lock(false); $('#impCancel', m.el).hidden = true; $('#impSample', m.el).disabled = false;
        const pend = RC.model.pendingRegistry();
        if (pend && RC.model.DB.sources.some((s) => s.tipo === 'registro')) {
          const n = document.createElement('div'); n.className = 'job'; n.innerHTML = `<div class="jr">${RC.int(pend)} proveedores cargados después del registro todavía no tienen datos de sociedad: volvé a importar el registro para completarlos.</div>`;
          jobs.appendChild(n);
        }
      }
    }
    $('#impCancel', m.el).addEventListener('click', () => { if (importing) importing.abort(); });
    pendingRun = run;
    if (initialFiles && initialFiles.length) run(initialFiles);
  }
  let pendingRun = null;
  $('#fileInput').addEventListener('change', (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (pendingRun && $('#dz')) pendingRun(files); else openImport(files);
  });
  function resultText(st) {
    const n = RC.int;
    if (st.tipo === 'registro') return `${n(st.sociedades)} sociedades leídas · ${n(st.cruzadas)} de ${n(st.proveedores)} proveedores encontrados` +
      (st.humanas ? ` · ${n(st.humanas)} filas de personas humanas ignoradas` : '');
    if (st.tipo === 'convocatorias') return `${n(st.aceptados)} procesos con objeto y monto estimado`;
    if (st.tipo === 'presupuesto') return `${n(st.aceptados)} organismo-años de presupuesto`;
    if (st.tipo === 'ofertas') return `${n(st.aceptados)} ofertas de sociedades` + (st.humanas + st.sinMarcador ? ` · ${n(st.humanas + st.sinMarcador)} de personas, sin guardar` : '');
    const parts = [`${n(st.aceptados)} contratos con empresas`];
    if (st.humanas) parts.push(`${n(st.humanas)} con personas humanas (sin identidad)`);
    if (st.sinMarcador) parts.push(`${n(st.sinMarcador)} sin CUIT argentino ni marcador societario (sin identidad)`);
    if (st.duplicados) parts.push(`${n(st.duplicados)} repetidos`);
    if (st.sinMonto) parts.push(`${n(st.sinMonto)} sin monto`);
    return parts.join(' · ');
  }
  async function loadSample(m) {
    const DB = RC.model.DB;
    if (DB.ks.length) {
      const ok = await confirmBox('Reemplazar los datos', 'Los datos de ejemplo reemplazan a los que están cargados. Vas a tener que volver a importar tus archivos.', 'Reemplazar', true);
      if (!ok) return;
    }
    if (m) m.close();
    status('Generando datos de ejemplo…', true);
    await RC.model.clear();
    const noop = () => {};
    await RC.model.importFiles(RC.sample.generate(), { detected: noop, failed: (s, e) => console.error(s.name, e), start: noop, progress: noop, done: noop });
    RC.model.setDemo(true);
    await RC.model.persist();
    dataChanged();
    status('Datos de ejemplo cargados. Son ficticios: organismos, empresas y montos inventados.');
  }

  // ── fuentes ─────────────────────────────────────────────
  function openSources() {
    const DB = RC.model.DB, B = DB.base, M = global.RC_BASE_META;
    const baseTime = B ? Date.parse(B.generado) : -Infinity;
    const baseBlock = B ? `<div class="help" style="margin-top:0"><h4>Base incluida · corte ${esc(RC.fmtDate(Date.parse(B.corte)))}</h4>` +
      `<p style="margin:0 0 8px">${RC.int(B.totales.contratos)} contratos, ${RC.int(B.totales.empresas)} empresas y ${RC.int(B.totales.organismos)} organismos de ${RC.int(B.totales.ministerios)} jurisdicciones; ` +
      `${RC.int(B.totales.ofertas)} ofertas de obra pública y presupuesto por organismo. La arma <span class="mono">npm run base</span> con estos archivos públicos:</p>` +
      `<table class="src"><thead><tr><th>Fuente</th><th>Archivos</th><th>Resultado</th></tr></thead><tbody>` +
      baseGroups(B.fuentes).map((g) => `<tr><td><span class="ext" data-ext="${esc(g.catalogo)}">${esc(g.grupo)}</span></td>` +
        `<td>${g.files.map((f) => esc(f.nombre)).join('<br>')}</td><td>${g.files.map((f) => esc(f.resultado)).join('<br>')}</td></tr>`).join('') +
      `</tbody></table></div>` : M ? `<p class="privacy">Hay una base incluida (corte ${esc(RC.fmtDate(Date.parse(M.corte)))}) que no está cargada.</p>` : '';
    const newer = B && M && Date.parse(M.generado) > baseTime;
    const pub = (B && B.publicacion) || (M && M.publicacion);
    const upd = global.rcDesktop
      ? `<div class="help" style="margin-top:0"><h4>Actualización automática</h4><p style="margin:0 0 6px" id="updInfo">Consultando…</p>` +
        `<button class="btn sm" id="updNow">Buscar ahora</button></div>`
      : pub ? `<div class="help" style="margin-top:0"><h4>Actualización automática</h4><p style="margin:0">Esta página se actualiza sola el 1 de cada mes: GitHub baja los datos oficiales, arma la base y la publica. ` +
        `${pub.portable ? `<span class="ext" data-ext="${esc(pub.portable)}">Programa para Windows</span> (también se actualiza solo) · ` : ''}` +
        `${pub.repo ? `<span class="ext" data-ext="${esc(pub.repo)}">código y registro de actualizaciones</span>` : ''}</p></div>` : '';
    const own = DB.sources.filter((s) => s.fecha > baseTime);
    const rows = own.map((s) => `<tr><td>${esc(s.nombre)}<div class="faint">${esc(RC.reader.KIND_LABEL[s.tipo] || s.tipo)} · ${new Date(s.fecha).toLocaleString('es-AR', { hour12: false })}</div></td><td>${esc(resultText(s))}</td></tr>`).join('');
    const pend = RC.model.pendingRegistry();
    const m = modal({
      title: 'Fuentes y privacidad', cls: 'wide',
      body: (DB.demo ? `<p class="privacy" style="border-color:var(--s-baja)"><b>Datos ficticios.</b> Lo cargado es el ejemplo inventado; nada corresponde a organismos ni empresas reales.</p>` : '') +
        (newer ? `<p class="privacy">Hay una base incluida más nueva (corte ${esc(RC.fmtDate(Date.parse(M.corte)))}).</p>` : '') + upd + baseBlock +
        (rows ? `<div class="help"><h4>Importados en este equipo</h4><table class="src"><thead><tr><th>Archivo</th><th>Resultado</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : B ? '' : '<p class="dim">Todavía no se importó nada.</p>') +
        (pend && DB.ks.length ? `<p class="dim" style="margin-top:12px">${RC.int(pend)} proveedores con CUIT de persona jurídica todavía no se cruzaron con un registro de sociedades.</p>` : '') +
        `<div class="help"><h4>Cómo se guardan</h4><p style="margin:0 0 10px">Los datos procesados quedan en este equipo (en el almacenamiento interno de la app) para no tener que reimportar en cada uso. No se envían a ningún lado.</p>${PRIVACY}</div>`,
      foot: `<button class="btn danger" id="srcClear" ${DB.ks.length || DB.sources.length ? '' : 'disabled'}>Vaciar todos los datos</button>` +
        (M ? `<button class="btn" id="srcBase">${B && !newer ? 'Volver a cargar la base incluida' : 'Cargar la base incluida'}</button>` : '') +
        `<div class="grow"></div><button class="btn" data-close>Cerrar</button>`
    });
    if (global.rcDesktop && $('#updInfo', m.el)) {
      const show = (i, extra) => {
        const st = i.estado || {};
        const when = (t) => t ? new Date(t).toLocaleString('es-AR', { hour12: false }) : 'nunca';
        $('#updInfo', m.el).innerHTML = i.pagina
          ? `El 1 de cada mes la app baja la base nueva de <span class="ext" data-ext="${esc(i.pagina)}">${esc(i.pagina)}</span>. ` +
            `Datos vigentes: al ${i.meta ? esc(fmtCorte(i.meta)) : '—'}${i.descargada ? ' (descargados)' : ' (los que vinieron con la app)'}. ` +
            `Última consulta: ${when(st.ultimaConsulta)}.${st.ultimoError ? ` <span style="color:var(--s-baja)">Último error: ${esc(st.ultimoError)}</span>` : ''}${extra ? ` ${extra}` : ''}`
          : 'Esta copia no tiene configurada la página del proyecto, así que no se actualiza sola.';
      };
      global.rcDesktop.baseInfo().then((i) => show(i));
      $('#updNow', m.el).addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = 'Buscando…';
        const r = await global.rcDesktop.checkBase();
        const i = await global.rcDesktop.baseInfo();
        show(i, r.estado === 'nueva' ? '<b>Se bajó una base nueva.</b>' : r.estado === 'al-dia' ? '<b>Ya está al día.</b>' : '');
        e.target.disabled = false; e.target.textContent = 'Buscar ahora';
      });
    }
    const sb = $('#srcBase', m.el);
    if (sb) sb.addEventListener('click', async () => {
      const ok = await confirmBox('Cargar la base incluida', 'Se reemplazan los datos actuales por la base incluida. Lo que hayas importado aparte hay que volver a importarlo.', 'Cargar');
      if (!ok) return;
      m.close(); await RC.model.clear(); state.sel = null; state.alert = null;
      await loadBaseUI(); dataChanged();
    });
    $('#srcClear', m.el).addEventListener('click', async () => {
      const ok = await confirmBox('Vaciar todos los datos', 'Se borran los contratos, empresas y organismos importados de este equipo. Los archivos originales no se tocan.', 'Vaciar', true);
      if (!ok) return;
      m.close(); await RC.model.clear(); state.sel = null; state.alert = null; dataChanged(); status('Datos borrados.');
    });
  }

  // Las fuentes de la base agrupadas: el presupuesto son doce archivos, uno por anio.
  function baseGroups(fuentes) {
    const out = [];
    for (const f of fuentes) {
      let g = out.find((x) => x.grupo === f.grupo);
      if (!g) out.push(g = { grupo: f.grupo, catalogo: f.catalogo, files: [] });
      g.files.push(f);
    }
    for (const g of out) if (g.files.length > 4 && /^Presupuesto/.test(g.grupo)) {
      const ys = g.files.map((f) => +(/(\d{4})/.exec(f.nombre) || [])[1]).filter(isFinite);
      const tot = g.files.reduce((s, f) => s + (parseInt(String(f.resultado).replace(/\D/g, ''), 10) || 0), 0);
      g.files = [{ nombre: `${g.files.length} archivos, ${Math.min(...ys)}–${Math.max(...ys)}`, resultado: `${RC.int(tot)} organismo-años` }];
    }
    return out;
  }

  // ── ajustes ─────────────────────────────────────────────
  function openSettings() {
    const S = RC.settings, R = RC.rates();
    const num = (key, label, desc, unit) => `<div class="set"><span class="sn">${label}${unit ? ` <span class="faint">(${unit})</span>` : ''}</span><input data-k="${key}" value="${S[key]}" inputmode="decimal"><span class="sd">${desc}</span></div>`;
    const m = modal({
      title: 'Ajustes', cls: 'wide',
      body: `<div class="set-h">Montos</div><div class="set"><span class="sn">Expresar los montos en</span><span class="seg" id="segMon"><button data-v="USD" class="${S.moneda === 'USD' ? 'on' : ''}">US$ equiv.</button><button data-v="ARS" class="${S.moneda === 'ARS' ? 'on' : ''}">$ nominales</button></span>` +
        `<span class="sd">En dólares equivalentes del año de cada contrato se pueden comparar años distintos pese a la inflación. Los pesos nominales mezclan años.</span></div>` +
        `<div class="set-h">Alertas</div>` +
        num('nuevaMeses', 'Empresa recién creada', 'Antigüedad máxima de la sociedad al ganar el contrato.', 'meses') +
        num('grandePct', 'Contrato grande', 'Percentil del monto dentro de su año a partir del cual un contrato cuenta como grande.', 'percentil') +
        num('acaparaShare', 'Proveedor dominante', 'Porción del gasto del organismo que dispara la alerta.', '%') +
        num('acaparaMinN', 'Mínimo de contratos del organismo', 'Organismos con menos contratos no se evalúan.', 'contratos') +
        num('acaparaMinUSD', 'Gasto mínimo del organismo', 'Organismos que gastaron menos no se evalúan.', 'US$') +
        num('montoZ', 'Monto atípico', 'Desvío robusto (mediana y MAD) sobre el logaritmo del monto, dentro del rubro y el año.', 'desvíos') +
        num('montoMinGrupo', 'Contratos para comparar', 'Mínimo de contratos del mismo rubro y año para usar esa comparación.', 'contratos') +
        num('estimadoRatio', 'Sobre lo estimado', 'Cuánto por encima del monto estimado en la convocatoria dispara la alerta.', '%') +
        num('domMin', 'Empresas por domicilio', 'Proveedores en un mismo domicilio legal para señalarlo.', 'empresas') +
        num('domMasivo', 'Domicilio masivo', 'Desde cuántas sociedades inscriptas un domicilio se considera de estudio contable o jurídico (baja la severidad).', 'sociedades') +
        `<div class="set-h">Grafo</div>` +
        num('maxEmpresas', 'Empresas en pantalla', 'Las de mayor monto en la vista; las señaladas se agregan aparte.', 'nodos') +
        `<div class="set-h">Tipo de cambio oficial promedio por año (pesos por dólar)</div>` +
        `<p class="dim" style="margin:0 0 6px;font-size:12px">Valores aproximados del BCRA (Com. A 3500), editables. Solo se usan para llevar montos a una misma escala.</p>` +
        `<div class="rates">${Object.keys(R).sort().map((y) => `<label>${y}<input data-y="${y}" value="${R[y]}" inputmode="decimal"></label>`).join('')}</div>`,
      foot: `<button class="btn ghost" id="setDefaults">Restaurar valores</button><div class="grow"></div><button class="btn ghost" data-close>Cancelar</button><button class="btn accent" id="setSave">Aplicar</button>`
    });
    let moneda = S.moneda;
    $('#segMon', m.el).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; moneda = b.dataset.v; $$('#segMon button', m.el).forEach((x) => x.classList.toggle('on', x === b)); });
    $('#setDefaults', m.el).addEventListener('click', () => {
      $$('[data-k]', m.el).forEach((i) => { i.value = RC.DEFAULTS[i.dataset.k]; });
      $$('[data-y]', m.el).forEach((i) => { i.value = RC.RATES_DEFAULT[i.dataset.y]; });
    });
    $('#setSave', m.el).addEventListener('click', () => {
      const patch = { moneda };
      for (const i of $$('[data-k]', m.el)) { const v = RC.parseAmount(i.value); if (isFinite(v) && v >= 0) patch[i.dataset.k] = v; }
      const rates = {};
      let changed = false;
      for (const i of $$('[data-y]', m.el)) {
        const v = RC.parseAmount(i.value);
        if (isFinite(v) && v > 0) { rates[i.dataset.y] = v; if (v !== RC.rates()[i.dataset.y]) changed = true; }
      }
      patch.rates = rates;
      const monedaChanged = moneda !== S.moneda;
      if (monedaChanged) { state.f.min = NaN; state.f.max = NaN; }
      RC.setSettings(patch);
      if (changed) RC.model.recomputeUSD();
      m.close();
      renderAmountChips(); state.orgOrder = null; refresh();
      status(monedaChanged ? 'Ajustes aplicados. El filtro de monto se quitó porque cambió la escala.' : 'Ajustes aplicados.');
    });
  }

  // ── herramientas del grafo ──────────────────────────────
  $('#btnFrame').addEventListener('click', () => RC.graph.reframe());
  $('#btnPhysics').addEventListener('click', togglePhysics);
  function togglePhysics() {
    RC.graph.setPaused(!RC.graph.paused);
    $('#btnPhysics').textContent = RC.graph.paused ? 'Reanudar' : 'Pausar';
    $('#btnPhysics').classList.toggle('on', RC.graph.paused);
  }
  $('#btnLabels').addEventListener('click', toggleLabels);
  function toggleLabels() {
    RC.setSettings({ etiquetas: !RC.settings.etiquetas });
    $('#btnLabels').classList.toggle('on', !RC.settings.etiquetas);
    RC.graph.redraw();
  }
  $('#density').value = String(RC.settings.maxContratos);
  if (!$('#density').value) { $('#density').value = '1000'; }
  $('#density').addEventListener('change', (e) => { RC.setSettings({ maxContratos: +e.target.value }); refresh(); });
  $('#btnShot').addEventListener('click', async () => {
    const url = RC.graph.snapshot();
    const blob = await (await fetch(url)).blob();
    const name = `grafo-contrataciones-${new Date().toISOString().slice(0, 10)}.png`;
    if (global.rcDesktop) { const p = await global.rcDesktop.saveFile(name, await blob.arrayBuffer()); if (p) status(`Imagen guardada en ${p}`); }
    else { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  });
  $('#btnExportAlerts').addEventListener('click', async () => {
    if (!state.A || !state.A.list.length) return;
    const A = Object.assign({}, state.A, { list: state.A.list.filter((a) => state.types.has(a.type)) });
    const p = await RC.saveText(`alertas-contrataciones-${new Date().toISOString().slice(0, 10)}.csv`, RC.alerts.toCSV(A));
    if (p) status(`Alertas exportadas${global.rcDesktop ? ` en ${p}` : ''}.`);
  });

  $('#btnImport').addEventListener('click', () => openImport());
  $('#btnImport2').addEventListener('click', () => openImport());
  $('#btnSample').addEventListener('click', () => loadSample(null));
  $('#btnSources').addEventListener('click', openSources);
  $('#btnSettings').addEventListener('click', openSettings);

  // Soltar archivos en cualquier parte de la ventana.
  global.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  global.addEventListener('drop', (e) => {
    if (e.target.closest && e.target.closest('#dz')) return;
    e.preventDefault();
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) { if (pendingRun && $('#dz')) pendingRun(files); else openImport(files); }
  });

  // Teclado
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Escape') {
      const back = $('#modalRoot .modal-back');
      if (back && !back.dataset.locked) { $('[data-close]', back).click(); return; }
      if (!typing && state.sel) { state.sel = null; state.alert = null; RC.graph.select(null, { from: 'ui' }); renderDetail(); $$('.alert.on').forEach((x) => x.classList.remove('on')); }
      return;
    }
    if (typing || $('#modalRoot .modal-back')) return;
    if (e.key === '/' || (e.key === 'f' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    else if (e.key === 'f' || e.key === 'F') RC.graph.reframe();
    else if (e.key === ' ') { e.preventDefault(); togglePhysics(); }
    else if (e.key === 'l' || e.key === 'L') toggleLabels();
  });

  global.addEventListener('resize', RC.debounce(renderHisto, 150));

  // ── arranque ────────────────────────────────────────────
  RC.graph.init($('#stage'));
  $('#btnLabels').classList.toggle('on', !RC.settings.etiquetas);
  // Carga la base incluida con un cartel de espera (tarda unos segundos la primera vez).
  async function loadBaseUI() {
    const M = global.RC_BASE_META;
    if (!M) return false;
    const box = $('#loading');
    $('#loadingMsg').textContent = `Corte ${RC.fmtDate(Date.parse(M.corte))}: ${RC.int(M.totales.contratos)} contratos de ${RC.int(M.totales.organismos)} organismos en ${RC.int(M.totales.ministerios)} jurisdicciones.`;
    box.hidden = false;
    try {
      await RC.model.loadBase((msg) => { status(msg, true); $('#loadingStep').textContent = msg; });
      return true;
    } catch (e) { status(e.message); console.error(e); return false; }
    finally { box.hidden = true; }
  }
  // ¿Hay datos importados a mano encima de la base (o datos propios sin base)?
  function ownImports() {
    const DB = RC.model.DB, B = DB.base;
    if (!B) return DB.ks.length > 0 && !DB.demo;
    const t = Date.parse(B.generado);
    return DB.sources.some((s) => s.fecha > t);
  }
  const fmtCorte = (M) => RC.fmtDate(Date.parse(M.corte));

  /* Llega una base mas nueva que la cargada (al abrir, o porque la app la bajo el dia 1).
     Si lo cargado es solo la base (o el ejemplo), se reemplaza sola; si hay datos
     importados a mano encima, se pregunta una sola vez por version. */
  async function offerBase(M) {
    const B = RC.model.DB.base;
    if (!M || (B && Date.parse(M.generado) <= Date.parse(B.generado))) return false;
    if (!ownImports()) {
      await RC.model.clear(); state.sel = null; state.alert = null;
      const ok = await loadBaseUI(); dataChanged();
      return ok;
    }
    let asked = '';
    try { asked = localStorage.getItem('rc.baseAsked') || ''; } catch (e) { /* sin almacenamiento */ }
    if (asked === M.generado) { status(`Hay una base más nueva (datos al ${fmtCorte(M)}): se carga desde Fuentes.`); return false; }
    try { localStorage.setItem('rc.baseAsked', M.generado); } catch (e) { /* sin almacenamiento */ }
    const yes = await confirmBox(B ? 'Hay datos públicos más nuevos' : 'La app trae la base incluida',
      `Datos públicos al ${esc(fmtCorte(M))}: ${RC.int(M.totales.contratos)} contratos de ${RC.int(M.totales.organismos)} organismos en ` +
      `${RC.int(M.totales.ministerios)} jurisdicciones, con presupuesto y ofertas de obra pública. ¿Reemplazar los datos actuales? Lo que hayas importado aparte habría que volver a importarlo.`,
      'Cargar la base');
    if (!yes) { status(`Hay una base más nueva (datos al ${fmtCorte(M)}): se carga desde Fuentes.`); return false; }
    await RC.model.clear(); state.sel = null; state.alert = null;
    const ok = await loadBaseUI(); dataChanged();
    return ok;
  }

  // Fecha de los datos en la barra superior, y descarga del programa en la version web.
  function renderBasePill() {
    const B = RC.model.DB.base, pill = $('#basePill');
    pill.hidden = !B || RC.model.DB.demo;
    if (B) {
      pill.textContent = `DATOS AL ${fmtCorte(B)}`;
      pill.title = global.rcDesktop
        ? 'Datos públicos procesados en este equipo. El 1 de cada mes la app busca la base nueva; la interfaz no se conecta a internet.'
        : 'Datos públicos. Esta página se actualiza sola el 1 de cada mes. Lo que importes se procesa en tu navegador y no sale de tu equipo.';
    }
    const M = global.RC_BASE_META, pub = (B && B.publicacion) || (M && M.publicacion);
    const dl = $('#btnDescarga');
    dl.hidden = !!global.rcDesktop || !(pub && pub.portable);
    if (pub && pub.portable) dl.href = pub.portable;
  }

  (async () => {
    status('Recuperando los datos guardados…', true);
    const ok = await RC.model.restore() && RC.model.DB.ks.length > 0;
    const M = global.RC_BASE_META;
    let loaded = false;
    if (M && (!ok || RC.model.DB.demo)) { if (ok) await RC.model.clear(); loaded = await loadBaseUI(); }
    dataChanged();
    if (ok && M && !loaded) loaded = await offerBase(M);
    if (loaded) status(`Base cargada: datos públicos al ${fmtCorte(RC.model.DB.base)}.`);
    else if (!/más nueva/.test($('#statusMsg').textContent)) status(ok ? 'Datos recuperados de la sesión anterior.' : 'Listo. Importá archivos o probá con el ejemplo ficticio.');
    renderBasePill();
    setInterval(statusData, 5000);
  })();

  // La app de escritorio avisa cuando bajo la base del mes.
  if (global.rcDesktop && global.rcDesktop.onBaseNueva) {
    global.rcDesktop.onBaseNueva(async (meta) => {
      global.RC_BASE_META = meta;
      if (await offerBase(meta)) status(`Base actualizada: datos públicos al ${fmtCorte(meta)}.`);
      renderBasePill();
    });
  }

  RC.ui = { state, refresh, selectRef, selectAlert, openImport, loadSample, loadBaseUI };
})(window);
