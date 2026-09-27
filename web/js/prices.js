/* ============================================================
   Rastreador de Contrataciones · precios
   Compara el precio unitario pagado en cada item comprado con
   precios de mercado del mismo producto:
     1. empareja por descripcion y cantidades, con un puntaje;
        lo dudoso queda pendiente de revision;
     2. lleva los dos precios a la misma unidad (por comprimido,
        por litro...), a la fecha de la compra (IPC) y con IVA;
     3. compara contra la mediana de mercado de los meses mas
        cercanos a la compra (mayorista si la compra es grande).
   Lo que se afirma es "diferencia con el precio de referencia",
   no sobreprecio: flete, plazo de pago, marca o calidad pueden
   explicarla.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  // ── cantidades dentro de una descripcion ────────────────
  const UNITS = [
    [/^(mcg|µg|ug)$/, 'mg', 0.001], [/^mg$/, 'mg', 1], [/^ui$/, 'ui', 1],
    [/^(g|gr|grs|gramos?)$/, 'g', 1], [/^(kg|kgs|kilos?)$/, 'g', 1000],
    [/^(ml|cc|cm3)$/, 'ml', 1], [/^(l|lt|lts|litros?)$/, 'ml', 1000],
    [/^(gb)$/, 'gb', 1], [/^(tb)$/, 'gb', 1024], [/^(mb)$/, 'gb', 1 / 1024],
    [/^(ghz)$/, 'ghz', 1], [/^(mhz)$/, 'ghz', 0.001],
    [/^(w|watts?)$/, 'w', 1], [/^(kw)$/, 'w', 1000],
    [/^(pulgadas?|pulg|")$/, 'in', 1],
    [/^(comprimidos?|comp|caps|capsulas?|tabletas?|grageas?|sobres?|ampollas?|frascos?|unidades?|u|uds?|hojas?|rollos?|pares|resmas?|cajas?)$/, 'n', 1]
  ];
  // Dimensiones que describen al producto: si difieren, no es el mismo (500 mg no es 250 mg).
  const IDENTITY = ['mg', 'ui', 'g', 'ml', 'gb', 'ghz', 'w', 'in'];

  function measures(text) {
    const out = {};
    const s = RC.fold(text || '').replace(/(\d),(\d)/g, '$1.$2');
    const add = (dim, v) => { if (isFinite(v) && v > 0) (out[dim] || (out[dim] = [])).push(v); };
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*("|[a-zµ]+\d*)/g)) {
      const unit = m[2];
      for (const [re, dim, f] of UNITS) if (re.test(unit)) { add(dim, parseFloat(m[1]) * f); break; }
    }
    // Envases: "x 16", "x16", "caja x 16", "pack de 6".
    for (const m of s.matchAll(/(?:\bx|\bpor|\bpack de|\bcaja de|\bcaja x)\s*(\d+)\b/g)) add('n', parseFloat(m[1]));
    return out;
  }
  // Sinonimos frecuentes en compras de informatica y salud: se unifican antes de comparar.
  const SYN = [
    [/\b(computadora|pc|equipo) portatil\b|\blaptop\b|\bportatil\b/g, 'notebook'],
    [/\b(unidad|disco) de estado solido\b|\bdisco solido\b/g, 'ssd'],
    [/\bdisco rigido\b/g, 'hdd'],
    [/\bmonocromatic[ao]s?\b/g, 'monocromo'],
    [/\bcomp\b|\bcomprimidos?\b/g, 'comprimido'],
    [/\bcaps\b|\bcapsulas?\b/g, 'capsula'],
    [/\bamp\b|\bampollas?\b/g, 'ampolla'],
    [/\bgas ?oil\b|\bdiesel\b/g, 'gasoil']
  ];
  const STOP = new Set(('de del la las los el y e en para con por x a al sin tipo marca modelo unidad unidades un una ' +
    'cada c u uds caja cajas envase presentacion articulo producto provision adquisicion compra').split(' '));
  function tokens(text) {
    let s = RC.fold(text || '').replace(/(\d),(\d)/g, '$1.$2')
      .replace(/(\d+(?:\.\d+)?)\s*("|[a-zµ]+\d*)/g, ' ');           // las cantidades van aparte
    for (const [re, to] of SYN) s = s.replace(re, to);
    const out = new Set();
    for (let w of s.split(/[^a-z0-9ñ]+/)) {
      if (!w || STOP.has(w) || (w.length < 2 && !/\d/.test(w))) continue;
      // Plural a singular: "descartables" -> "descartable", "monitores" -> "monitor", "unidades" -> "unidad".
      if (w.length > 4 && /bles$/.test(w)) w = w.slice(0, -1);
      else if (w.length > 4 && /[rlnd]es$/.test(w)) w = w.slice(0, -2);
      else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
      out.add(w);
    }
    return [...out];
  }

  /* A que cantidad de "unidades comparables" se refiere un precio: una caja x 16 son 16
     comprimidos; un bidon de 5 L son 5000 ml; si no se sabe, 1. */
  function scaleOf(desc, unit) {
    const u = RC.fold(unit || '').trim(), mu = measures(unit), md = measures(desc);
    const n = (mu.n && Math.max(...mu.n)) || (md.n && Math.max(...md.n));
    if (n > 1) return { dim: 'n', v: n };
    if (mu.ml) return { dim: 'ml', v: mu.ml[0] };
    if (mu.g) return { dim: 'g', v: mu.g[0] };
    if (/^(l|lt|lts|litros?)$/.test(u)) return { dim: 'ml', v: 1000 };
    if (/^(kg|kilos?)$/.test(u)) return { dim: 'g', v: 1000 };
    if (/^(m3|metros? cubicos?)$/.test(u)) return { dim: 'm3', v: 1 };
    // Sin unidad explicita: el contenido de la descripcion ("aceite 1.5 l") es el envase.
    if (!u || /^(unidad|u|un|unid|uds?|c u|envase|botella|bidon|paquete)$/.test(u)) {
      if (md.ml && !md.mg) return { dim: 'ml', v: Math.max(...md.ml) };
      if (md.g && !md.mg) return { dim: 'g', v: Math.max(...md.g) };
    }
    return { dim: 'n', v: 1 };
  }

  // ── indice de productos de mercado ──────────────────────
  let cache = null;
  function index() {
    const DB = RC.model.DB;
    if (cache && cache.ver === DB.ver && cache.nm === DB.mkt.length) return cache;
    const prods = DB.mkt.map((p) => {
      const text = `${p.desc} ; ${p.unit}`;   // separados: "grado 2" + "litro" no son 2 litros
      return { p, tok: tokens(text), mea: measures(text), scale: scaleOf(p.desc, p.unit), marca: RC.norm(p.marca), code: String(p.codigo || '').replace(/\D/g, '') };
    });
    const df = new Map(), post = new Map(), byCode = new Map();
    prods.forEach((q, j) => {
      for (const t of q.tok) { df.set(t, (df.get(t) || 0) + 1); (post.get(t) || post.set(t, []).get(t)).push(j); }
      if (q.code.length >= 8) byCode.set(q.code, j);
    });
    const N = Math.max(1, prods.length);
    const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + N / n)]));
    const obsBy = new Map(), O = DB.obs;
    for (let q = 0; q < O.prod.length; q++) (obsBy.get(O.prod[q]) || obsBy.set(O.prod[q], []).get(O.prod[q])).push(q);
    cache = { ver: DB.ver, nm: DB.mkt.length, prods, idf, post, byCode, obsBy, rows: null, sig: '' };
    return cache;
  }

  function score(it, q, idf) {
    if (it.code.length >= 8 && it.code === q.code) return { s: 1, conflict: false };
    const w = (t) => idf.get(t) || Math.log(2);
    const B = new Set(q.tok);
    let inter = 0, sa = 0, sb = 0;
    for (const t of it.tok) { const x = w(t); sa += x; if (B.has(t)) inter += x; }
    for (const t of q.tok) sb += w(t);
    if (!sa || !sb || !inter) return { s: 0, conflict: false };
    const prec = inter / sb, rec = inter / sa;
    let s = 2 * prec * rec / (prec + rec), conflict = false;
    for (const dim of IDENTITY) {
      const a = it.mea[dim], b = q.mea[dim];
      if (!a || !b) continue;
      if (a.some((x) => b.some((y) => Math.abs(x - y) <= 0.03 * Math.max(x, y)))) s += 0.08;
      else { s *= 0.45; conflict = true; }
    }
    if (it.marca && q.marca && it.marca === q.marca) s += 0.05;
    return { s: Math.min(1, s), conflict };
  }

  // ── IPC y montos ────────────────────────────────────────
  const ym = (ms) => RC.isoDate(ms).slice(0, 7);
  function ipcAt(ms) {
    const I = RC.model.DB.ipc;
    if (!I.size || !isFinite(ms)) return NaN;
    const k = ym(ms);
    if (I.has(k)) return I.get(k);
    const keys = [...I.keys()].sort();
    return I.get(k < keys[0] ? keys[0] : keys[keys.length - 1]);
  }
  // Factor para llevar un precio de la fecha `from` a la fecha `to`.
  function ipcFactor(from, to) {
    const a = ipcAt(from), b = ipcAt(to);
    return a > 0 && b > 0 ? b / a : 1;
  }
  const toARS = (v, cur, year) => cur === 'ARS' ? v : RC.toUSD(v, cur, year) * RC.usdRate(year);

  /* Analisis completo de los items: emparejamiento, referencia y diferencia.
     Se recalcula solo cuando cambian los datos, los ajustes o las confirmaciones. */
  function analyze() {
    const DB = RC.model.DB, S = RC.settings, X = index();
    const sig = [DB.ver, DB.items.length, DB.obs.prod.length, DB.eqv.size, S.precioIva, S.precioMayorista, S.precioAuto, JSON.stringify(S.rates || {})].join('|');
    if (X.rows && X.sig === sig) return X;
    const iva = 1 + (S.precioIva || 21) / 100, O = DB.obs;
    const rows = [];
    for (const t of DB.items) {
      const text = `${t.desc} ; ${t.unit}`;
      const it = { tok: tokens(text), mea: measures(text), marca: RC.norm(t.marca), code: String(t.codigo || '').replace(/\D/g, '') };
      const scale = scaleOf(t.desc, t.unit);
      // candidatos: productos que comparten alguna palabra poco comun, o el mismo codigo
      const cand = new Map();
      if (it.code.length >= 8 && X.byCode.has(it.code)) cand.set(X.byCode.get(it.code), 1e9);
      for (const tk of it.tok) {
        const L = X.post.get(tk);
        if (!L || L.length > 4000) continue;
        const wt = X.idf.get(tk);
        for (const j of L) cand.set(j, (cand.get(j) || 0) + wt);
      }
      const top = [...cand].sort((a, b) => b[1] - a[1]).slice(0, 150)
        .map(([j]) => Object.assign({ j }, score(it, X.prods[j], X.idf)))
        .filter((c) => c.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 5);
      const row = { t, scale, cands: top, m: -1, s: 0, estado: 'sin-par', nota: '' };
      const ov = DB.eqv.get(t.key);
      if (ov && ov.estado === 'rechazado') row.estado = 'rechazado';
      else if (ov && ov.estado === 'confirmado' && DB.mktByKey.has(ov.prod)) { row.m = DB.mktByKey.get(ov.prod).i; row.s = 1; row.estado = 'confirmado'; }
      else if (top.length) {
        const b = top[0], q = X.prods[b.j];
        const sameDim = q.scale.dim === scale.dim;
        if (b.s >= (S.precioAuto || 72) / 100 && !b.conflict && sameDim) { row.m = b.j; row.s = b.s; row.estado = 'auto'; }
        else if (b.s >= 0.4) { row.estado = 'pendiente'; row.nota = !sameDim ? 'Las unidades no coinciden: revisá si el precio de mercado es por la misma cantidad.' : b.conflict ? 'Las cantidades de la descripción no coinciden.' : ''; }
      }
      if (row.m >= 0) reference(row, X, iva, O, S);
      rows.push(row);
    }
    X.rows = rows; X.sig = sig;
    X.byProd = new Map();
    rows.forEach((r, q) => { if (r.m >= 0) (X.byProd.get(r.m) || X.byProd.set(r.m, []).get(r.m)).push(q); });
    return X;
  }

  function reference(row, X, iva, O, S) {
    const t = row.t, q = X.prods[row.m];
    const obs = X.obsBy.get(row.m) || [];
    if (!obs.length) { row.nota = 'El producto no tiene precios de mercado cargados.'; return; }
    const big = t.qty >= (S.precioMayorista || 50);
    let pool = obs;
    if (big && obs.some((o) => O.tipo[o] === 'may')) { pool = obs.filter((o) => O.tipo[o] === 'may'); row.mayorista = true; }
    const when = isFinite(t.date) ? t.date : Math.max(...pool.map((o) => O.date[o]));
    // Los precios mas cercanos a la compra: el IPC corrige la inflacion general, no los
    // cambios de precio relativo (el combustible puede subir mas o menos que el resto).
    row.ventana = 0;
    for (const m of [3, 6, 12, 24]) {
      const near = pool.filter((o) => Math.abs(O.date[o] - when) <= m * 31 * RC.DAY);
      if (near.length >= 3) { pool = near; row.ventana = m; break; }
    }
    const vals = pool.map((o) => O.price[o] * (O.iva[o] ? 1 : iva) / q.scale.v * ipcFactor(O.date[o], when)).filter((v) => v > 0).sort((a, b) => a - b);
    if (!vals.length) return;
    row.ref = RC.quantileSorted(vals, 0.5); row.lo = RC.quantileSorted(vals, 0.25); row.hi = RC.quantileSorted(vals, 0.75); row.n = vals.length;
    row.fuentes = [...new Set(pool.map((o) => RC.model.DB.dict.fte[O.fuente[o]]))];
    row.ajIpc = pool.length ? ipcFactor(O.date[pool[pool.length - 1]], when) : 1;
    const paidARS = toARS(t.price, t.cur, t.year) * (t.iva ? 1 : iva);
    row.unitPaid = paidARS / row.scale.v;
    row.diff = row.unitPaid / row.ref - 1;
    row.units = t.qty * row.scale.v;
    row.excessARS = Math.max(0, row.unitPaid - row.ref) * row.units;
    row.paidARS = row.unitPaid * row.units;
    row.refARS = row.ref * row.units;
  }

  const ventanaTxt = (r) => r.ventana ? ` de hasta ${r.ventana} meses antes o después de la compra` : '';

  // ── vista filtrada ──────────────────────────────────────
  function inView(t, V) {
    const f = (V && V.f) || {};
    if (isFinite(f.from) && !(t.date >= f.from)) return false;
    if (isFinite(f.to) && !(t.date <= f.to)) return false;
    if (f.orgs && f.orgs.size && !f.orgs.has(t.org)) return false;
    return true;
  }
  // Monto en pesos del anio del item -> escala de visualizacion.
  const disp = (ars, year) => RC.toDisplay(ars / RC.usdRate(year), year);
  const yearOf = (t) => isFinite(t.year) ? t.year : new Date().getUTCFullYear();

  function summary(V) {
    const X = analyze(), S = RC.settings, thr = (S.precioUmbral || 50) / 100;
    const rows = X.rows.filter((r) => inView(r.t, V));
    const cmp = rows.filter((r) => r.ref > 0);
    const out = {
      items: rows.length, comparados: cmp.length,
      pendientes: rows.filter((r) => r.estado === 'pendiente').length,
      sinPar: rows.filter((r) => r.estado === 'sin-par').length,
      arriba: cmp.filter((r) => r.diff >= thr).length,
      exceso: cmp.reduce((s, r) => s + disp(r.excessARS, yearOf(r.t)), 0),
      pagado: cmp.reduce((s, r) => s + disp(r.paidARS, yearOf(r.t)), 0),
      productos: RC.model.DB.mkt.length, observaciones: RC.model.DB.obs.prod.length
    };
    return out;
  }

  // Ranking por organismo o por empresa: diferencia estimada en la escala elegida.
  function ranking(V, by) {
    const X = analyze(), S = RC.settings, thr = (S.precioUmbral || 50) / 100;
    const acc = new Map();
    for (const r of X.rows) {
      if (!(r.ref > 0) || !inView(r.t, V)) continue;
      const id = by === 'co' ? r.t.co : r.t.org;
      if (id < 0) continue;
      let a = acc.get(id);
      if (!a) acc.set(id, a = { id, exceso: 0, pagado: 0, ref: 0, n: 0, arriba: 0 });
      const y = yearOf(r.t);
      a.exceso += disp(r.excessARS, y); a.pagado += disp(r.paidARS, y); a.ref += disp(r.refARS, y);
      a.n++; if (r.diff >= thr) a.arriba++;
    }
    return [...acc.values()].map((a) => Object.assign(a, { diff: a.ref > 0 ? a.pagado / a.ref - 1 : NaN }))
      .sort((a, b) => b.exceso - a.exceso);
  }

  // Alertas de precio (se suman a las otras cuatro).
  function alerts(V) {
    const X = analyze(), S = RC.settings, DB = RC.model.DB, thr = (S.precioUmbral || 50) / 100;
    const out = [];
    for (const r of X.rows) {
      if (!(r.ref > 0) || r.diff < thr || !inView(r.t, V) || (r.estado !== 'auto' && r.estado !== 'confirmado')) continue;
      const t = r.t, y = yearOf(t), q = DB.mkt[r.m];
      const org = t.org >= 0 ? DB.orgs[t.org].name : 'organismo sin identificar';
      const sev = RC.clamp(0.3 + 0.35 * Math.log2(1 + r.diff) / 2 + (r.estado === 'confirmado' ? 0.15 : 0) + Math.min(0.2, Math.log10(1 + disp(r.excessARS, y) / 1000) / 15), 0, 1);
      const per = r.scale.dim === 'n' && r.scale.v > 1 ? 'por unidad' : r.scale.dim === 'ml' ? 'por litro' : r.scale.dim === 'g' ? 'por kilo' : '';
      const k = r.scale.dim === 'ml' || r.scale.dim === 'g' ? 1000 : 1;
      out.push({
        type: 'precio', sev, key: `i${t.i}`, item: t.i,
        focus: { t: 'item', i: t.i },
        nodes: { org: t.org >= 0 ? [t.org] : [], co: t.co >= 0 ? [t.co] : [], k: t.k >= 0 ? [t.k] : [] },
        title: t.desc,
        sub: `${RC.pct(r.diff)} sobre la referencia · ${RC.money(disp(r.excessARS, y))} de diferencia estimada · ${org}`,
        why: `Se pagó <b>${RC.moneyNative(r.unitPaid * k, 'ARS')}</b> ${per} contra una referencia de <b>${RC.moneyNative(r.ref * k, 'ARS')}</b> ` +
          `(mediana de ${r.n} ${r.n === 1 ? 'precio' : 'precios'}${r.mayorista ? ' mayoristas' : ''} de <i>${RC.esc(q.desc)}</i>${ventanaTxt(r)}, llevados a la fecha de la compra con el IPC y con IVA). ` +
          `Diferencia: <b>${RC.pct(r.diff)}</b>, unos <b>${RC.money(disp(r.excessARS, y))}</b> en ${RC.int(t.qty)} × ${RC.esc(t.unit || 'unidad')}. ` +
          `Emparejamiento ${r.estado === 'confirmado' ? 'confirmado a mano' : `automático (puntaje ${Math.round(r.s * 100)})`}. ` +
          `Es una diferencia con el precio de referencia, no necesariamente un sobreprecio: flete, plazo de pago, marca o requisitos de calidad pueden explicarla.`,
        evid: t.k >= 0 ? [{ k: t.k, note: RC.fmtDate(t.date) }] : [], excess: r.excessARS
      });
    }
    return out;
  }

  // Serie de precios de mercado de un producto (para la ficha).
  function series(m) {
    const X = analyze(), O = RC.model.DB.obs, q = X.prods[m];
    return (X.obsBy.get(m) || []).map((o) => ({ date: O.date[o], price: O.price[o] / q.scale.v, tipo: O.tipo[o], fuente: RC.model.DB.dict.fte[O.fuente[o]] }))
      .sort((a, b) => a.date - b.date);
  }

  // Busqueda de productos para emparejar a mano.
  function searchProducts(text, limit) {
    const X = index(), tk = tokens(text);
    if (!tk.length) return [];
    const it = { tok: tk, mea: measures(text), marca: '', code: String(text).replace(/\D/g, '') };
    const cand = new Map();
    for (const t of tk) for (const j of (X.post.get(t) || []).slice(0, 4000)) cand.set(j, (cand.get(j) || 0) + (X.idf.get(t) || 0));
    return [...cand].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([j]) => Object.assign({ j }, score(it, X.prods[j], X.idf)))
      .sort((a, b) => b.s - a.s).slice(0, limit || 8);
  }

  RC.prices = { ventanaTxt, analyze, summary, ranking, alerts, series, searchProducts, measures, tokens, scaleOf, ipcFactor, disp, inView };
})(window);
