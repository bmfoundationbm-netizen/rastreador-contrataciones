/* ============================================================
   Rastreador de Contrataciones · alertas
   Cuatro patrones sobre la vista filtrada. Cada alerta explica
   por que salto y con que datos; ninguna es una acusacion: son
   puntos de partida para revisar el expediente.

   Todas las comparaciones de monto se hacen en dolares
   equivalentes del anio del contrato, para que la inflacion no
   convierta cualquier contrato reciente en "grande".
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  // El tipo se distingue por rotulo y glifo; el color queda para la severidad.
  const TYPES = {
    nueva: { label: 'Empresa recién creada', short: 'Recién creada', glyph: '◷' },
    acapara: { label: 'Proveedor dominante', short: 'Dominante', glyph: '◔' },
    monto: { label: 'Monto fuera de lo normal', short: 'Monto atípico', glyph: '▲' },
    domicilio: { label: 'Domicilio legal compartido', short: 'Mismo domicilio', glyph: '⌂' }
  };
  // Paleta de estado (fija): siempre acompaniada del rotulo de texto.
  const LEVELS = [
    { key: 'alta', label: 'alta', min: 0.75, color: '#d03b3b' },
    { key: 'media', label: 'media', min: 0.5, color: '#ec835a' },
    { key: 'baja', label: 'baja', min: 0, color: '#fab219' }
  ];
  const level = (sev) => LEVELS.find((l) => sev >= l.min) || LEVELS[2];
  const NOT_BASE = /AMPLIACI|PRORROGA|PRÓRROGA/i;

  function upperBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; }
  const median = (a) => RC.quantileSorted(a, 0.5);

  function compute(V) {
    const S = RC.settings, DB = RC.model.DB, K = DB.ks, C = DB.cos, O = DB.orgs;
    const list = [];
    // El id sale del contenido (tipo + a quien senala): una alerta que sobrevive a un
    // cambio de filtros conserva su id y sigue seleccionada; una que no, se descarta.
    const add = (a, key) => { a.id = `${a.type}:${key}`; list.push(a); };
    const disp = (k) => RC.toDisplay(k.usd, k.year);
    // Contratos visibles de cada empresa (evita recorrer la vista entera por alerta).
    const coKs = new Map();
    for (const i of V.idx) { const c = K[i].co; const a = coKs.get(c); if (a) a.push(i); else coKs.set(c, [i]); }

    // ── 1. empresa recien creada con contrato grande ──────
    {
      const byYear = new Map();
      for (const i of V.idx) { const k = K[i]; if (isFinite(k.usd)) { let a = byYear.get(k.year); if (!a) byYear.set(k.year, a = []); a.push(k.usd); } }
      const thr = new Map();
      for (const [y, a] of byYear) { a.sort((x, z) => x - z); thr.set(y, a.length >= 30 ? RC.quantileSorted(a, S.grandePct / 100) : Infinity); }
      const limit = S.nuevaMeses * 30.44;
      const per = new Map();
      for (const i of V.idx) {
        const k = K[i], c = C[k.co];
        if (!isFinite(c.fconst) || !isFinite(k.usd)) continue;
        const age = (k.date - c.fconst) / RC.DAY;
        // Mas de 90 dias antes de la constitucion no es una empresa nueva: es una fecha
        // de registro posterior (transformacion, reinscripcion) o un error de carga.
        if (age > limit || age < -90) continue;
        if (!(k.usd >= thr.get(k.year))) continue;
        const arr = byYear.get(k.year);
        const rank = upperBound(arr, k.usd) / arr.length;
        let e = per.get(c.i);
        if (!e) per.set(c.i, e = { ks: [], minAge: Infinity, maxRank: 0, sum: 0, before: 0, orgs: new Set() });
        e.ks.push({ k, age, rank }); e.minAge = Math.min(e.minAge, age); e.maxRank = Math.max(e.maxRank, rank);
        e.sum += disp(k); e.orgs.add(k.org); if (age < 0) e.before++;
      }
      const p = S.grandePct / 100;
      for (const [ci, e] of per) {
        const c = C[ci];
        e.ks.sort((a, b) => b.k.usd - a.k.usd);
        let sev = 0.4 + 0.35 * (1 - RC.clamp(e.minAge, 0, limit) / limit) + 0.25 * RC.clamp((e.maxRank - p) / Math.max(1e-9, 1 - p), 0, 1);
        if (e.before) sev = Math.max(sev, 0.75);
        const n = e.ks.length;
        const edad = e.minAge < 0 ? `${RC.fmtAge(-e.minAge)} antes de constituirse` : `con ${RC.fmtAge(e.minAge)} de vida`;
        add({
          type: 'nueva', sev: RC.clamp(sev, 0, 1), focus: { t: 'co', i: ci },
          nodes: { org: [...e.orgs], co: [ci], k: e.ks.slice(0, 60).map((x) => x.k.i) },
          title: c.label,
          sub: `${n === 1 ? `1 contrato grande ${edad}` : `${n} contratos grandes · el primero ${edad}`} · ${RC.money(e.sum)}`,
          why: `Constituida el <b>${RC.fmtDate(c.fconst)}</b>${c.tipo ? ` (${RC.esc(c.tipo.toLowerCase())})` : ''}. ` +
            `Ganó ${n === 1 ? 'un contrato' : `${n} contratos`} que ${n === 1 ? 'está' : 'están'} en el ${Math.round(S.grandePct)} % superior de su año ` +
            `cuando tenía menos de ${S.nuevaMeses} meses.` +
            (e.before ? ` <b>${e.before === 1 ? 'Uno está fechado' : `${e.before} están fechados`} antes de la constitución</b>: puede ser un error de carga o una sociedad que operaba antes de inscribirse.` : ''),
          evid: e.ks.slice(0, 12).map((x) => ({ k: x.k.i, note: `${x.age < 0 ? '−' : ''}${RC.fmtAge(Math.abs(x.age))} · percentil ${Math.round(x.rank * 100)}` }))
        }, `co${ci}`);
      }
    }

    // ── 2. proveedor que acapara las compras de un organismo ──
    {
      const orgUSD = new Float64Array(O.length), orgN = new Int32Array(O.length);
      const pairs = new Map();
      for (const i of V.idx) {
        const k = K[i]; if (!isFinite(k.usd)) continue;
        orgUSD[k.org] += k.usd; orgN[k.org]++;
        let m = pairs.get(k.org); if (!m) pairs.set(k.org, m = new Map());
        const e = m.get(k.co); if (e) { e.usd += k.usd; e.n++; } else m.set(k.co, { usd: k.usd, n: 1 });
      }
      // Gasto con personas humanas (sin identidad): suma al total del organismo.
      const Om = DB.omit, from = V.f.from, to = V.f.to, orgsF = V.f.orgs && V.f.orgs.size ? V.f.orgs : null;
      const omitUSD = new Float64Array(O.length);
      for (let i = 0; i < Om.org.length; i++) {
        if (!(Om.date[i] >= (isFinite(from) ? from : -Infinity) && Om.date[i] <= (isFinite(to) ? to : Infinity))) continue;
        if (orgsF && !orgsF.has(Om.org[i])) continue;
        if (isFinite(Om.usd[i])) omitUSD[Om.org[i]] += Om.usd[i];
      }
      const thr = S.acaparaShare / 100;
      for (const [oi, m] of pairs) {
        if (orgN[oi] < S.acaparaMinN) continue;
        const total = orgUSD[oi] + omitUSD[oi];
        if (total < S.acaparaMinUSD) continue;
        let top = null, topCo = -1, hhi = 0;
        for (const [ci, e] of m) { const s = e.usd / total; hhi += s * s; if (!top || e.usd > top.usd) { top = e; topCo = ci; } }
        const share = top.usd / total;
        if (share < thr) continue;
        const nShare = top.n / orgN[oi];
        let sev = 0.35 + 0.65 * RC.clamp((share - thr) / Math.max(1e-9, 1 - thr), 0, 1);
        sev *= 0.6 + 0.4 * RC.clamp(Math.log10(total / S.acaparaMinUSD) / 3, 0, 1);
        // Un solo contrato enorme pesa menos que un proveedor que gana una y otra vez.
        sev *= 0.55 + 0.45 * RC.clamp(nShare / thr, 0, 1);
        const ks = (coKs.get(topCo) || []).map((i) => K[i]).filter((k) => k.org === oi);
        ks.sort((a, b) => (b.usd || 0) - (a.usd || 0));
        const c = C[topCo], o = O[oi];
        add({
          type: 'acapara', sev: RC.clamp(sev, 0, 1), focus: { t: 'co', i: topCo },
          nodes: { org: [oi], co: [topCo], k: ks.slice(0, 60).map((k) => k.i) },
          title: `${c.label} → ${o.name}`,
          sub: `${RC.pct(share)} del gasto · ${top.n} de ${orgN[oi]} contratos · ${m.size} proveedores`,
          why: `En el período filtrado, <b>${RC.esc(c.label)}</b> se lleva el <b>${RC.pct(share)}</b> de lo que ${RC.esc(o.name)} ` +
            `adjudicó (en dólares equivalentes${omitUSD[oi] ? ', contando lo adjudicado a personas humanas' : ''}), ` +
            `con ${top.n} de sus ${orgN[oi]} contratos (${RC.pct(nShare)}). ` +
            `Índice de concentración HHI del organismo: <b>${Math.round(hhi * 10000)}</b> (más de 2500 se considera muy concentrado).`,
          evid: ks.slice(0, 12).map((k) => ({ k: k.i, note: RC.fmtDate(k.date) })),
          org: oi, share, hhi
        }, `${oi}-${topCo}`);
      }
    }

    // ── 3. montos fuera de lo normal ──────────────────────
    {
      // Grupo de comparacion, del mas fino al mas grueso: misma combinacion de rubros y
      // anio; mismo rubro principal y anio; todo el anio. Se usa el primero con datos suficientes.
      const combos = new Map(), groups = new Map(), years = new Map();
      const push = (m, key, l) => { const g = m.get(key); if (g) g.push(l); else m.set(key, [l]); };
      for (const i of V.idx) {
        const k = K[i]; if (!(k.usd > 1)) continue;
        const l = Math.log(k.usd), y = k.year & 4095;
        push(combos, k.rbs * 4096 + y, l); push(groups, k.rb * 4096 + y, l); push(years, k.year, l);
      }
      const stat = (a) => {
        const s = Float64Array.from(a).sort(); const med = median(s);
        const dev = s.map((x) => Math.abs(x - med)).sort();
        return { med, mad: median(dev) * 1.4826, n: s.length };
      };
      const cs = new Map(), gs = new Map(), ys = new Map();
      for (const [key, a] of combos) if (a.length >= S.montoMinGrupo) cs.set(key, stat(a));
      for (const [key, a] of groups) if (a.length >= S.montoMinGrupo) gs.set(key, stat(a));
      for (const [y, a] of years) if (a.length >= Math.max(50, S.montoMinGrupo)) ys.set(y, stat(a));
      for (const i of V.idx) {
        const k = K[i]; if (!(k.usd > 1)) continue;
        const y = k.year & 4095;
        let st = cs.get(k.rbs * 4096 + y), scope = 'rubro';
        if (!st || !(st.mad > 0.05)) st = gs.get(k.rb * 4096 + y);
        if (!st || !(st.mad > 0.05)) { st = ys.get(k.year); scope = 'año'; }
        if (!st || !(st.mad > 0.05)) continue;
        const z = (Math.log(k.usd) - st.med) / st.mad;
        if (z < S.montoZ) continue;
        const ratio = Math.exp(Math.log(k.usd) - st.med);
        const rub = DB.dict.rb[k.rb] || 'sin rubro';
        const c = C[k.co], o = O[k.org];
        add({
          type: 'monto', sev: RC.clamp(0.3 + 0.7 * (z - S.montoZ) / 4, 0, 1), focus: { t: 'k', i: k.i },
          nodes: { org: [k.org], co: [k.co], k: [k.i] },
          title: `${k.doc || k.proc || 'Contrato'} · ${RC.money(disp(k))}`,
          sub: `${formatX(ratio)} la mediana ${scope === 'rubro' ? `de ${rub.toLowerCase()}` : 'del año'} en ${k.year} · ${c.label}`,
          why: `Monto <b>${RC.moneyNative(k.amt, k.cur)}</b>, ${formatX(ratio)} la mediana de ${st.n} contratos ` +
            `${scope === 'rubro' ? `del rubro <b>${RC.esc(rub.toLowerCase())}</b>` : 'de todos los rubros'} en ${k.year}. ` +
            `Desvío robusto sobre el logaritmo del monto: <b>${z.toFixed(1)}</b> (umbral ${S.montoZ}). ` +
            `Adjudicó ${RC.esc(o.name)}.`,
          evid: [{ k: k.i, note: `z ${z.toFixed(1)}` }], z
        }, `k${k.i}`);
      }

      // Adjudicado muy por encima del monto estimado en la convocatoria (si se cargaron convocatorias).
      if (DB.convoc.size) {
        const byProc = new Map();
        for (const i of V.idx) {
          const k = K[i]; if (!k.proc || NOT_BASE.test(DB.dict.dt[k.dt])) continue;
          let e = byProc.get(k.proc); if (!e) byProc.set(k.proc, e = { ks: [], ars: 0, other: false });
          e.ks.push(k); if (k.cur === 'ARS') e.ars += k.amt; else e.other = true;
        }
        const lim = 1 + S.estimadoRatio / 100;
        for (const [proc, e] of byProc) {
          const cv = DB.convoc.get(proc);
          if (!cv || !(cv.est >= 1000) || e.other) continue;
          const r = e.ars / cv.est;
          // Mas de 10 veces no es sobreprecio: es un estimado de relleno ($ 1, $ 0,12) o un error de
          // unidad (precio unitario contra total). En los datos reales el 99 % queda por debajo de 3.
          if (r < lim || r > 10) continue;
          e.ks.sort((a, b) => b.amt - a.amt);
          const k0 = e.ks[0], o = O[k0.org];
          add({
            type: 'monto', sev: RC.clamp(0.25 + 0.2 * Math.log2(r / lim), 0, 0.6), focus: { t: 'k', i: k0.i },
            nodes: { org: [k0.org], co: [...new Set(e.ks.map((k) => k.co))], k: e.ks.slice(0, 60).map((k) => k.i) },
            title: `${proc} · ${formatX(r)} lo estimado`,
            sub: `Adjudicado ${RC.moneyNative(e.ars, 'ARS')} contra ${RC.moneyNative(cv.est, 'ARS')} estimados · ${o.name}`,
            why: `La convocatoria del proceso <b>${RC.esc(proc)}</b> estimó ${RC.moneyNative(cv.est, 'ARS')}; ` +
              `se adjudicaron <b>${RC.moneyNative(e.ars, 'ARS')}</b> (${formatX(r)}) sin contar ampliaciones ni prórrogas. ` +
              `Con inflación alta, parte de la diferencia puede ser el tiempo entre la publicación y la adjudicación.`,
            evid: e.ks.slice(0, 12).map((k) => ({ k: k.i, note: RC.fmtDate(k.date) })), sub2: 'estimado'
          }, `p${proc}`);
        }
      }
    }

    // ── 4. varias empresas en el mismo domicilio legal ────
    {
      const byBld = new Map();
      for (const c of C) {
        if (!c.akeys || !V.coN[c.i]) continue;
        let g = byBld.get(c.akeys.bld); if (!g) byBld.set(c.akeys.bld, g = []); g.push(c);
      }
      if (byBld.size) {
        const orgsOf = new Map();
        for (const [, p] of V.pair) { let s = orgsOf.get(p.co); if (!s) orgsOf.set(p.co, s = new Set()); s.add(p.org); }
        for (const [, g] of byBld) {
          if (g.length < S.domMin) continue;
          const units = new Map();
          for (const c of g) if (c.akeys.hasUnit) units.set(c.akeys.unit, (units.get(c.akeys.unit) || 0) + 1);
          const sameUnit = Math.max(0, ...units.values());
          const orgCount = new Map();
          for (const c of g) for (const o of orgsOf.get(c.i) || []) orgCount.set(o, (orgCount.get(o) || 0) + 1);
          const shared = [...orgCount].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([o]) => o);
          const crowd = Math.max(...g.map((c) => c.crowd || 0));
          const masivo = crowd >= S.domMasivo;
          // Procesos (obra publica, CONTRAT.AR) en los que al menos dos del grupo ofertaron
          // como competidoras: la senal mas fuerte de este patron.
          const BI = RC.model.bidIndex(), inProc = new Map();
          for (const c of g) for (const bi of BI.byCo.get(c.i) || []) {
            const p = DB.bids.proc[bi];
            (inProc.get(p) || inProc.set(p, new Set()).get(p)).add(c.i);
          }
          const coBid = [...inProc].filter(([, s]) => s.size >= 2).map(([p]) => p);
          let sev = 0.3 + Math.min(0.2, 0.08 * (g.length - 2)) + (sameUnit >= 2 ? 0.2 : 0) + (shared.length ? 0.25 : 0) + (coBid.length ? 0.3 : 0);
          if (masivo) sev *= 0.45;
          g.sort((a, b) => V.coSum[b.i] - V.coSum[a.i]);
          const sum = g.reduce((s, c) => s + V.coSum[c.i], 0);
          const addr = RC.fmtAddr(g[0].addr);
          const ks = [];
          if (shared.length) { const sh = new Set(shared); for (const c of g) for (const i of coKs.get(c.i) || []) if (sh.has(K[i].org)) ks.push(i); }
          add({
            type: 'domicilio', sev: RC.clamp(sev, 0, 1), focus: { t: 'co', i: g[0].i },
            nodes: { org: shared.slice(0, 20), co: g.map((c) => c.i), k: ks.slice(0, 80) },
            // El titulo nombra el edificio; piso y departamento de cada una van en la evidencia.
            title: `${g.length} proveedores en ${RC.tidy(g[0].addr.calle)} ${g[0].addr.numero}`,
            sub: `${g.slice(0, 3).map((c) => c.label).join(' · ')}${g.length > 3 ? ` y ${g.length - 3} más` : ''}`,
            why: `Comparten el domicilio legal <b>${RC.esc(addr)}</b> según el registro de sociedades` +
              (sameUnit >= 2 ? `; <b>${sameUnit} declaran el mismo piso y departamento</b>` : '') + '. ' +
              (shared.length ? `<b>${shared.length === 1 ? 'Le venden al mismo organismo' : `Le venden a los mismos ${shared.length} organismos`}</b> ` +
                `(${shared.slice(0, 3).map((o) => RC.esc(O[o].name)).join('; ')}${shared.length > 3 ? '…' : ''}). ` : '') +
              (coBid.length ? `<b>Se presentaron como competidoras en ${coBid.length === 1 ? 'un proceso' : `${coBid.length} procesos`} de obra pública</b> ` +
                `(${coBid.slice(0, 3).map(RC.esc).join(', ')}${coBid.length > 3 ? '…' : ''}). ` : '') +
              `Entre todas suman ${RC.money(sum)}. ` +
              (masivo ? `Ojo: en ese edificio hay <b>${RC.int(crowd)} sociedades</b> inscriptas; suele ser un estudio contable o jurídico que presta su domicilio.`
                : crowd > g.length ? `En el registro hay ${RC.int(crowd)} sociedades con ese domicilio.` : ''),
            evid: g.slice(0, 12).map((c) => ({ co: c.i, note: `${RC.money(V.coSum[c.i])}${c.addr && (c.addr.piso || c.addr.depto) ? ` · ${[c.addr.piso && `p. ${c.addr.piso}`, c.addr.depto && `d. ${c.addr.depto}`].filter(Boolean).join(' ')}` : ''}` })),
            crowd, masivo, coBid
          }, `d${RC.hash53(g[0].akeys.bld)}`);
        }
      }
    }

    list.sort((a, b) => b.sev - a.sev);
    const counts = { nueva: 0, acapara: 0, monto: 0, domicilio: 0 };
    const flagged = { org: new Map(), co: new Map(), k: new Map() };
    const mark = (m, i, a) => { const p = m.get(i); if (!p || p.sev < a.sev) m.set(i, a); };
    const byId = new Map();
    for (const a of list) {
      counts[a.type]++; byId.set(a.id, a);
      if (a.focus.t === 'co') mark(flagged.co, a.focus.i, a);
      if (a.focus.t === 'k') mark(flagged.k, a.focus.i, a);
      if (a.type === 'acapara') { mark(flagged.org, a.org, a); for (const i of a.nodes.co) mark(flagged.co, i, a); }
      if (a.type === 'domicilio') for (const i of a.nodes.co) mark(flagged.co, i, a);
      if (a.type === 'nueva') for (const i of a.nodes.k) mark(flagged.k, i, a);
    }
    const nodeAlerts = (t, i) => list.filter((a) => (a.nodes[t] || []).includes(i) || (a.focus.t === t && a.focus.i === i));
    return { list, counts, flagged, byId, nodeAlerts };
  }

  function formatX(r) {
    if (r >= 10) return `${Math.round(r)} veces`;
    return `${r.toFixed(1).replace('.', ',')} veces`;
  }

  // CSV de alertas para compartir. Solo datos de organismos y sociedades.
  function toCSV(A) {
    const DB = RC.model.DB, K = DB.ks, C = DB.cos, O = DB.orgs;
    const head = ['tipo', 'severidad', 'nivel', 'titulo', 'detalle', 'explicacion', 'organismos', 'empresas', 'cuits', 'contratos'];
    const strip = (h) => String(h).replace(/<[^>]+>/g, '');
    const rows = A.list.map((a) => [
      TYPES[a.type].label, a.sev.toFixed(2), level(a.sev).label, a.title, a.sub, strip(a.why),
      (a.nodes.org || []).map((i) => O[i].name).join(' | '),
      (a.nodes.co || []).map((i) => C[i].label).join(' | '),
      (a.nodes.co || []).map((i) => C[i].cuit ? RC.fmtCuit(C[i].cuit) : '').join(' | '),
      (a.nodes.k || []).slice(0, 30).map((i) => K[i].doc || K[i].proc).join(' | ')
    ]);
    return [head, ...rows].map((r) => r.map(RC.csvCell).join(',')).join('\r\n');
  }

  RC.alerts = { compute, toCSV, TYPES, LEVELS, level };
})(window);
