/* ============================================================
   Rastreador de Contrataciones · modelo
   Organismos, empresas y contratos; importacion, cruce con el
   registro de sociedades, filtros, busqueda y persistencia.

   Privacidad: nunca se guarda un dato de persona humana.
   - Proveedores con CUIT de persona humana (20, 23, 24, 27): la fila
     se descarta; solo se conserva organismo, fecha y monto, sin
     identidad, para que los totales del organismo sean correctos.
   - Proveedores sin CUIT argentino (exterior o vacio): se aceptan
     solo si la razon social tiene un marcador societario.
   - Sociedades de hecho, condominios y sucesiones: el nombre suele
     ser el de sus integrantes, asi que se reemplaza por un rotulo.
   - Del registro se leen solo columnas de la sociedad; archivos de
     autoridades, socios o documentos se rechazan enteros.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  // ── estado ──────────────────────────────────────────────
  function empty() {
    return {
      orgs: [], orgByKey: new Map(), orgByName: new Map(),
      cos: [], coById: new Map(),
      ks: [], kSeen: new Map(),
      omit: { org: [], date: [], amt: [], cur: [], year: [], usd: [] },
      dict: { uoc: [''], pt: [''], dt: [''], rb: [''], rbs: [''], jur: [''], sub: [''] },
      dictIdx: { uoc: new Map([['', 0]]), pt: new Map([['', 0]]), dt: new Map([['', 0]]), rb: new Map([['', 0]]), rbs: new Map([['', 0]]),
        jur: new Map([['', 0]]), sub: new Map([['', 0]]) },
      convoc: new Map(),
      // Ofertas de cada proceso (CONTRAT.AR): solo sociedades, igual que los contratos.
      bids: { proc: [], co: [], org: [], amt: [], rank: [] },
      bidSeen: new Set(),
      // Presupuesto abierto: `${saf}|${anio}` -> ministerio, credito, devengado y unidades ejecutoras.
      budget: new Map(),
      regChecked: new Set(),
      sources: [],
      base: null,
      ver: 0,
      demo: false
    };
  }
  let DB = empty();

  function intern(d, s) {
    s = s || '';
    const m = DB.dictIdx[d];
    let i = m.get(s);
    if (i === undefined) { s = RC.own(s); i = DB.dict[d].length; DB.dict[d].push(s); m.set(s, i); }
    return i;
  }

  // ── organismos ──────────────────────────────────────────
  function orgFor(rec) {
    const code = String(rec.safCode || '').trim();
    const rawName = rec.org || rec.uoc || '';
    const name = RC.orgLabel(rawName) || (code ? `SAF ${code}` : 'Organismo sin identificar');
    const nkey = RC.norm(name);
    let key = code ? 'S' + code : null;
    let o = key ? DB.orgByKey.get(key) : null;
    // Los archivos "legacy" no traen codigo de SAF: se enlazan por nombre.
    if (!o && !code) { o = DB.orgByName.get(nkey); key = 'N' + nkey; if (!o) o = DB.orgByKey.get(key); }
    // Un organismo sin codigo que ya se unio a su SAF por nombre deriva al SAF.
    while (o && o.merged !== undefined) o = DB.orgs[o.merged];
    if (!o) {
      o = { i: DB.orgs.length, key: RC.own(key), code: RC.own(code), name: RC.own(name), _f: RC.fold(name) };
      DB.orgs.push(o); DB.orgByKey.set(key, o);
      if (!DB.orgByName.has(nkey)) DB.orgByName.set(nkey, o);
    }
    return o;
  }

  // ── empresas ────────────────────────────────────────────
  function coLabel(c) {
    if (c.redacted) return `${c.redacted} (nombre omitido)`;
    return c.name || (c.cuit ? `CUIT ${RC.fmtCuit(c.cuit)}` : 'Sin nombre');
  }
  function companyFor(id, name) {
    const key = id.id || 'N:' + RC.norm(name);
    let c = DB.coById.get(key);
    if (c) return c;
    const red = RC.personalName(name, '');
    c = {
      i: DB.cos.length, id: key, cuit: id.cuit, valid: id.valid, kind: id.kind,
      name: red ? null : RC.own(name), redacted: red,
      tipo: '', fconst: NaN, addr: null, akeys: null, crowd: 0, act: '', reg: '', estadoDom: ''
    };
    c.label = coLabel(c); c._f = RC.fold(c.label);
    DB.cos.push(c); DB.coById.set(key, c);
    return c;
  }

  // ── contratos ───────────────────────────────────────────
  const NOT_ORIGINAL = /AMPLIACI|PRORROGA|PRÓRROGA|DISMINUC|RENOVACI/i;

  function ingestContract(rec, st) {
    st.rows++;
    const amt = RC.parseAmount(rec.amount);
    if (!isFinite(amt) || amt <= 0) { st.sinMonto++; return; }
    let date = RC.parseDate(rec.date);
    let year = isFinite(date) ? RC.yearOf(date) : parseInt(rec.year, 10);
    if (!isFinite(date) && isFinite(year)) { date = Date.UTC(year, 6, 1); st.fechaAprox++; }
    const cur = RC.currencyCode(rec.currency);
    const usd = RC.toUSD(amt, cur, year);
    const org = orgFor(rec);

    const id = RC.parseCuit(rec.cuit);
    const name = RC.tidy(rec.supplier);
    let ok;
    if (id.kind === 'juridica') ok = true;
    else if (id.kind === 'humana') { ok = false; st.humanas++; }
    else { ok = RC.looksJuridica(name); if (!ok) st.sinMarcador++; }
    if (!ok) {
      const O = DB.omit;
      O.org.push(org.i); O.date.push(date); O.amt.push(amt); O.cur.push(cur); O.year.push(year); O.usd.push(usd);
      return;
    }
    const co = companyFor(id, name);
    const doc = RC.own(RC.tidy(rec.doc)), proc = RC.own(RC.tidy(rec.proceso));
    const dtype = RC.tidy(rec.dtype);
    /* Deduplicacion por conteo: una fila repetida dentro del mismo archivo puede ser otro
       renglon con el mismo monto (los archivos viejos no traen numero de documento), asi que
       solo se descarta la n-esima repeticion si ya habia n iguales de importaciones anteriores. */
    const dedup = `${org.i}|${proc}|${doc}|${co.i}|${dtype}|${amt}|${date}`;
    const tot = DB.kSeen.get(dedup) || 0;
    const here = st._seen || (st._seen = new Map());
    let h = here.get(dedup);
    if (!h) here.set(dedup, h = { m: 0, a: 0 });
    h.m++;
    if (h.m <= tot - h.a) { st.duplicados++; return; }
    // Modo complemento (archivos anuales despues del consolidado): un documento que ya
    // existe, aunque sea con otro monto u organismo, es una version del mismo contrato.
    if (st.complemento && doc && docKeys().has(`${doc}|${co.i}|${dtype}`)) { st.duplicados++; return; }
    h.a++;
    DB.kSeen.set(dedup, tot + 1);
    const rubros = RC.tidy(String(rec.rubros || '').replace(/;\s*$/, ''));
    const rb = rubros.split(';')[0].trim();
    const k = {
      i: DB.ks.length, org: org.i, co: co.i, doc, proc,
      uoc: intern('uoc', RC.orgLabel(rec.uoc)), pt: intern('pt', ptypeLabel(rec.ptype) || RC.ptypeFromCode(proc)), dt: intern('dt', dtype),
      rb: intern('rb', rb), rbs: intern('rbs', rubros),
      date, year, amt, cur, usd, obj: rec.objeto ? RC.own(RC.tidy(rec.objeto).slice(0, 300)) : ''
    };
    if (!isFinite(usd)) st.otraMoneda++;
    DB.ks.push(k);
    st.aceptados++;
  }
  // "Licitación Privada 1/2017" (archivos legacy) -> "Licitación Privada"
  function ptypeLabel(s) {
    s = RC.tidy(s).replace(/\s+\d+\s*\/\s*\d+\s*$/, '');
    const n = RC.norm(s);
    if (/^LICITACION PUBLICA/.test(n)) return 'Licitación Pública';
    if (/^LICITACION PRIVADA/.test(n)) return 'Licitación Privada';
    if (/^CONTRATACION DIRECTA/.test(n)) return 'Contratación Directa';
    if (/^CONCURSO PUBLICO/.test(n)) return 'Concurso Público';
    if (/^CONCURSO PRIVADO/.test(n)) return 'Concurso Privado';
    if (/^SUBASTA/.test(n)) return 'Subasta Pública';
    if (/^COMPULSA/.test(n)) return 'Compulsa de Precios';
    return s;
  }

  // ── OCDS ────────────────────────────────────────────────
  function ingestRelease(r, st) {
    const parties = new Map((r.parties || []).map((p) => [p.id, p]));
    const buyerRef = r.buyer || (r.parties || []).find((p) => (p.roles || []).some((x) => x === 'buyer' || x === 'procuringEntity'));
    const buyer = buyerRef ? Object.assign({}, parties.get(buyerRef.id) || {}, buyerRef) : {};
    const tender = r.tender || {};
    const items = tender.items || [];
    const rubro = (items[0] && items[0].classification && items[0].classification.description) || tender.mainProcurementCategory || '';
    const base = {
      proceso: tender.id || r.ocid, org: buyer.name || '', safCode: '',
      ptype: tender.procurementMethodDetails || tender.procurementMethod || '',
      objeto: tender.title || tender.description || '', rubros: rubro, dtype: 'Original'
    };
    for (const a of r.awards || []) {
      if (a.status && /cancel|unsuccessful/i.test(a.status)) continue;
      const cs = (r.contracts || []).filter((c) => c.awardID === a.id);
      const cv = cs.reduce((s, c) => s + (c.value && isFinite(+c.value.amount) ? +c.value.amount : 0), 0);
      const value = cv || (a.value ? +a.value.amount : NaN);
      const currency = (cs[0] && cs[0].value && cs[0].value.currency) || (a.value && a.value.currency) || 'ARS';
      const date = a.date || (cs[0] && cs[0].dateSigned) || r.date;
      const sups = a.suppliers || [];
      sups.forEach((s, j) => {
        const p = Object.assign({}, parties.get(s.id) || {}, s);
        const raw = (p.identifier && p.identifier.id) || s.id || '';
        const m = /(?:^|\D)(\d{2}-?\d{8}-?\d)(?:\D|$)/.exec(String(raw));
        ingestContract(Object.assign({}, base, {
          cuit: m ? m[1] : raw, supplier: p.name || (p.identifier && p.identifier.legalName) || '',
          amount: value / Math.max(1, sups.length), currency, date,
          doc: ((cs[0] && cs[0].id) || a.id || r.ocid) + (sups.length > 1 ? `#${j + 1}` : '')
        }), st);
      });
    }
  }

  // ── registro de sociedades ──────────────────────────────
  /* El registro nacional trae ~1,3 millones de sociedades y ~3 millones de filas
     (una por actividad). Se guarda solo lo de los proveedores ya cargados; del
     resto se cuenta cuantas sociedades comparten cada domicilio legal, para
     distinguir un domicilio "masivo" (estudio contable, domicilio de constitucion). */
  function registrySink(st, info) {
    const want = new Map();
    for (const c of DB.cos) if (c.cuit && c.kind === 'juridica') want.set(c.cuit, c);
    if (!want.size) throw new Error('Primero importá adjudicaciones: el registro se cruza contra los proveedores ya cargados.');
    const crowd = new Map();
    const hits = [];
    let M = null, prev = '', cur = null, H = null;
    const get = (row, f) => M[f] >= 0 ? (row[M[f]] || '').trim() : '';
    return {
      begin(meta) { M = meta.map; H = meta.header; st.columnasPersonales = (meta.personal || []).length; },
      row(row) {
        st.rows++;
        const cuit = get(row, 'cuit').replace(/\D/g, '');
        if (cuit === prev) {
          // Otra actividad de la misma sociedad: sirve para completar la principal.
          if (cur && !cur.actOk) takeActivity(cur, row);
          return;
        }
        prev = cuit;
        cur = null;
        if (cuit.length !== 11) return;
        const pref = cuit.slice(0, 2);
        if (pref === '20' || pref === '23' || pref === '24' || pref === '27') { st.humanas++; return; }
        const tipo = RC.tidy(get(row, 'tipo'));
        if (/PERSONA F[IÍ]SICA|PERSONA HUMANA/i.test(tipo)) { st.humanas++; return; }
        st.sociedades++;
        const addr = M.calle >= 0 ? {
          calle: get(row, 'calle'), numero: get(row, 'numero'), piso: get(row, 'piso'), depto: get(row, 'depto'),
          localidad: get(row, 'localidad'), provincia: get(row, 'provincia'), cp: get(row, 'cp')
        } : null;
        const ak = addr ? RC.addrKeys(addr) : null;
        if (ak) { const h = RC.hash53(ak.bld); crowd.set(h, (crowd.get(h) || 0) + 1); }
        const c = want.get(cuit);
        if (!c) return;
        if (addr) for (const f in addr) addr[f] = RC.own(addr[f]);
        cur = { c, cuit, tipo: RC.own(tipo), addr, ak, name: RC.own(RC.tidy(get(row, 'name'))), fconst: RC.parseDate(get(row, 'fconst')),
          estadoDom: RC.own(RC.tidy(get(row, 'estadoDom'))), act: '', actOk: false };
        takeActivity(cur, row);
        hits.push(cur);
      },
      end() {
        const src = st.nombre;
        for (const h of hits) {
          const c = h.c;
          const fromRNS = M.fconst >= 0;
          // Un registro con fecha de constitucion manda sobre uno sin ella (SIPRO).
          if (c.reg && c.regHasDate && !fromRNS) { if (!c.tipo) c.tipo = h.tipo; continue; }
          c.reg = src; c.regHasDate = fromRNS;
          if (h.tipo) c.tipo = h.tipo;
          if (isFinite(h.fconst) && h.fconst <= Date.now()) c.fconst = h.fconst;
          if (h.ak) { c.addr = h.addr; c.akeys = h.ak; c.crowd = crowd.get(RC.hash53(h.ak.bld)) || 1; c.estadoDom = h.estadoDom; }
          else if (h.addr && !c.addr) { c.addr = h.addr; }
          if (h.act) c.act = h.act;
          const red = RC.personalName(h.name || c.name || '', h.tipo);
          if (red) { c.redacted = red; c.name = null; }
          else if (h.name && !c.redacted) c.name = h.name;
          c.label = coLabel(c); c._f = RC.fold(c.label);
        }
        for (const cuit of want.keys()) DB.regChecked.add(cuit);
        st.cruzadas = hits.length;
        st.proveedores = want.size;
        crowd.clear();
      }
    };
    function takeActivity(h, row) {
      if (M.actividad < 0) { h.actOk = true; return; }
      const d = RC.tidy(get(row, 'actividad'));
      if (!d) return;
      const ord = get(row, 'actOrden');
      if (!h.act) h.act = RC.own(d);
      if (ord === '1' || M.actOrden < 0) { h.act = RC.own(d); h.actOk = true; }
    }
  }

  // ── convocatorias: objeto y monto estimado por proceso ──
  function convocSink(st) {
    let M = null;
    const get = (row, f) => M[f] >= 0 ? (row[M[f]] || '').trim() : '';
    return {
      begin(meta) { M = meta.map; },
      row(row) {
        st.rows++;
        const proc = RC.tidy(get(row, 'proceso'));
        if (!proc) return;
        const est = RC.parseAmount(get(row, 'estimado'));
        DB.convoc.set(RC.own(proc), { obj: RC.own(RC.tidy(get(row, 'objeto')).slice(0, 300)), est: isFinite(est) ? est : NaN, pub: RC.parseDate(get(row, 'pub')) });
        st.aceptados++;
      },
      end() {}
    };
  }

  // ── ofertas (CONTRAT.AR) ────────────────────────────────
  /* Todas las ofertas de cada proceso, no solo la ganadora. Sirven para ver empresas que
     se presentan como competidoras en el mismo proceso. Las ofertas de personas humanas
     no se guardan de ninguna forma. */
  function bidsSink(st) {
    let M = null;
    const get = (row, f) => M[f] >= 0 ? (row[M[f]] || '').trim() : '';
    return {
      begin(meta) { M = meta.map; },
      row(row) {
        st.rows++;
        const id = RC.parseCuit(get(row, 'cuit'));
        const name = RC.tidy(get(row, 'supplier'));
        let ok;
        if (id.kind === 'juridica') ok = true;
        else if (id.kind === 'humana') { ok = false; st.humanas++; }
        else { ok = RC.looksJuridica(name); if (!ok) st.sinMarcador++; }
        if (!ok) return;
        const proc = RC.own(RC.tidy(get(row, 'proceso')));
        const amt = RC.parseAmount(get(row, 'amount'));
        const co = companyFor(id, name);
        const rank = parseInt(get(row, 'rank'), 10) || 0;
        const key = `${proc}|${co.i}|${amt}|${rank}`;
        if (DB.bidSeen.has(key)) { st.duplicados++; return; }
        DB.bidSeen.add(key);
        const org = orgFor({ safCode: get(row, 'safCode'), org: get(row, 'org') });
        const B = DB.bids;
        B.proc.push(proc); B.co.push(co.i); B.org.push(org.i); B.amt.push(isFinite(amt) ? amt : NaN); B.rank.push(rank);
        st.aceptados++;
      },
      end() {}
    };
  }

  // ── presupuesto abierto ─────────────────────────────────
  /* Credito anual de la Administracion Nacional (presupuestoabierto.gob.ar). De cada
     organismo (SAF) y anio se guarda: ministerio (jurisdiccion), subjurisdiccion, entidad,
     credito vigente y devengado, lo mismo solo para bienes y servicios (incisos 2, 3 y 4:
     lo que se compra), y el devengado de cada unidad ejecutora, que es donde aparecen
     las secretarias y subsecretarias. Los montos vienen en millones de pesos. */
  function budgetSink(st) {
    let M = null;
    const get = (row, f) => M[f] >= 0 ? (row[M[f]] || '').trim() : '';
    const touched = new Set();
    return {
      begin(meta) { M = meta.map; },
      row(row) {
        st.rows++;
        const saf = get(row, 'saf').replace(/\D/g, ''), year = parseInt(get(row, 'year'), 10);
        if (!saf || !isFinite(year)) return;
        const key = `${saf}|${year}`;
        let b = DB.budget.get(key);
        // Reimportar un anio lo reemplaza en vez de sumarlo dos veces.
        if (!b || !touched.has(key)) {
          touched.add(key);
          b = { saf: RC.own(saf), year, jur: intern('jur', RC.tidy(get(row, 'jur'))), sub: intern('sub', RC.tidy(get(row, 'sub'))),
            ent: RC.own(RC.tidy(get(row, 'ent'))), name: RC.own(RC.tidy(get(row, 'safDesc'))),
            vig: 0, dev: 0, vigBS: 0, devBS: 0, ues: new Map() };
          DB.budget.set(key, b);
          st.aceptados++;
        }
        // Formato fijo: coma decimal y sin separador de miles ("112314,626039"). Se lee estricto:
        // la lectura general tomaria "100,123" como cien mil.
        const vig = millones(get(row, 'vig')), dev = millones(get(row, 'dev'));
        if (isFinite(vig)) b.vig += vig;
        if (isFinite(dev)) b.dev += dev;
        const inc = get(row, 'inciso');
        if (inc === '2' || inc === '3' || inc === '4') { if (isFinite(vig)) b.vigBS += vig; if (isFinite(dev)) b.devBS += dev; }
        const ue = RC.tidy(get(row, 'ue'));
        if (ue) {
          let u = b.ues.get(ue);
          if (!u) b.ues.set(RC.own(ue), u = [0, 0]);
          if (isFinite(dev)) u[0] += dev;
          if (isFinite(vig)) u[1] += vig;
        }
      },
      end() {}
    };
  }

  const millones = (s) => { const v = Number(String(s).trim().replace(',', '.')); return s && isFinite(v) ? v * 1e6 : NaN; };

  /* Ubica cada organismo en la estructura del presupuesto: su ministerio segun el ultimo
     anio en que figura, y agrega los organismos que tienen presupuesto pero todavia no
     publicaron compras. Los organismos de archivos sin codigo de SAF (COMPR.AR anterior)
     se unen por nombre a su SAF y sus contratos pasan a el. */
  function linkBudget() {
    if (!DB.budget.size) { for (const o of DB.orgs) { o.jur = 0; o.sub = 0; } return; }
    const latest = new Map(), byName = new Map();
    for (const b of DB.budget.values()) {
      const l = latest.get(b.saf);
      if (!l || b.year > l.year) latest.set(b.saf, b);
      const nk = RC.norm(RC.orgLabel(b.name));
      if (nk && !byName.has(nk)) byName.set(nk, b.saf);
    }
    for (const [saf, b] of latest) if (!DB.orgByKey.get('S' + saf)) orgFor({ safCode: saf, org: b.name });
    const remap = new Map();
    let cands = null;
    for (const o of DB.orgs) {
      if (o.code || o.merged !== undefined) continue;
      let saf = byName.get(RC.norm(o.name));
      if (!saf) {
        // Los archivos viejos abrevian: "ADM. NACIONAL DE LAB. E INST. DE SALUD DR. CARLOS MALBRAN".
        if (!cands) cands = [...byName].map(([n, sf]) => ({ t: orgTokens(n), saf: sf }));
        saf = fuzzySaf(orgTokens(o.name), cands);
      }
      const t = saf && DB.orgByKey.get('S' + saf);
      if (t && t !== o) { remap.set(o.i, t.i); o.merged = t.i; }
    }
    if (remap.size) {
      const re = (i) => { const t = remap.get(i); return t === undefined ? i : t; };
      for (const k of DB.ks) k.org = re(k.org);
      const O = DB.omit.org, B = DB.bids.org;
      for (let i = 0; i < O.length; i++) O[i] = re(O[i]);
      for (let i = 0; i < B.length; i++) B[i] = re(B[i]);
      DB.kSeen = countKeys(DB.ks);
    }
    for (const o of DB.orgs) {
      const b = o.code && latest.get(o.code);
      o.jur = b ? b.jur : 0; o.sub = b ? b.sub : 0; o.ent = b ? b.ent : ''; o.bYear = b ? b.year : NaN;
      // El nombre que vale es el del ultimo presupuesto: los SAF cambian de nombre con cada gestion.
      const nm = b && RC.orgLabel(b.name).replace(/\s*\(Gastos Propios\)\s*$/i, '');
      if (nm && nm !== o.name) { o.name = RC.own(nm); o._f = RC.fold(nm); const nk = RC.norm(nm); if (!DB.orgByName.has(nk)) DB.orgByName.set(nk, o); }
    }
  }
  let docSet = null, docVer = -1;
  function docKeys() {
    if (docSet && docVer === DB.ver) return docSet;
    docSet = new Set(DB.ks.filter((k) => k.doc).map((k) => `${k.doc}|${k.co}|${DB.dict.dt[k.dt]}`));
    docVer = DB.ver;
    return docSet;
  }
  function countKeys(ks) { const m = new Map(); for (const k of ks) { const s = seenKey(k); m.set(s, (m.get(s) || 0) + 1); } return m; }
  const ORG_STOP = new Set('DE DEL LA LAS LOS EL Y E EN PARA A AL GASTOS PROPIOS'.split(' '));
  const ORG_ABBR = { ADM: 'ADMINISTRACION', NAC: 'NACIONAL', LAB: 'LABORATORIOS', INST: 'INSTITUTO', UNIV: 'UNIVERSIDAD',
    COM: 'COMISION', MIN: 'MINISTERIO', SEC: 'SECRETARIA', SUBSEC: 'SUBSECRETARIA', DIR: 'DIRECCION', GRAL: 'GENERAL',
    SERV: 'SERVICIO', FFAA: 'FUERZAS ARMADAS', PFA: 'POLICIA FEDERAL ARGENTINA', GNA: 'GENDARMERIA NACIONAL', PNA: 'PREFECTURA NAVAL' };
  function orgTokens(name) {
    const out = [];
    for (const t of RC.nameTokens(RC.orgLabel(name))) {
      if (ORG_STOP.has(t)) continue;
      for (const x of (ORG_ABBR[t] || t).split(' ')) out.push(x);
    }
    return out;
  }
  // Coincidencia por palabras: una palabra abreviada vale si es el comienzo de la completa.
  // Se exige que casi todo coincida en los dos sentidos y que el mejor candidato sea unico.
  function fuzzySaf(L, cands) {
    if (L.length < 2) return null;
    const hit = (a, b) => a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));
    let best = null, bestScore = 0, tie = false;
    for (const c of cands) {
      const B = c.t;
      if (!B.length) continue;
      const mL = L.filter((a) => B.some((b) => hit(a, b))).length, mB = B.filter((b) => L.some((a) => hit(a, b))).length;
      const sc = Math.min(mL / L.length, mB / B.length);
      if (sc > bestScore + 1e-9) { best = c.saf; bestScore = sc; tie = false; }
      else if (Math.abs(sc - bestScore) < 1e-9 && c.saf !== best) tie = true;
    }
    return bestScore >= 0.8 && !tie ? best : null;
  }
  const seenKey = (k) => `${k.org}|${k.proc}|${k.doc}|${k.co}|${DB.dict.dt[k.dt]}|${k.amt}|${k.date}`;

  // Presupuesto de un organismo, anio por anio.
  function budgetOf(orgIdx) {
    const o = DB.orgs[orgIdx];
    if (!o || !o.code) return [];
    const out = [];
    for (const b of DB.budget.values()) if (b.saf === o.code) out.push(b);
    return out.sort((a, b) => a.year - b.year);
  }
  // Organismos de un ministerio (estructura del ultimo presupuesto cargado).
  const jurOrgs = (j) => DB.orgs.filter((o) => o.jur === j && o.merged === undefined);

  // Indices de ofertas, reconstruidos cuando cambian los datos.
  let bidIdx = null, bidVer = -1;
  function bidIndex() {
    if (bidIdx && bidVer === DB.ver) return bidIdx;
    const byCo = new Map(), byProc = new Map(), B = DB.bids;
    for (let i = 0; i < B.proc.length; i++) {
      (byCo.get(B.co[i]) || byCo.set(B.co[i], []).get(B.co[i])).push(i);
      (byProc.get(B.proc[i]) || byProc.set(B.proc[i], []).get(B.proc[i])).push(i);
    }
    bidVer = DB.ver;
    return (bidIdx = { byCo, byProc });
  }

  // ── importacion ─────────────────────────────────────────
  const ORDER = { presupuesto: 0, convocatorias: 0, contratos: 1, ocds: 1, json: 1, ofertas: 1.5, registro: 2 };

  /* Importa varios archivos. Primero se detecta que es cada uno y se ordenan:
     convocatorias y adjudicaciones antes que el registro, que se cruza contra
     los proveedores ya cargados. `ui` recibe el avance de cada fuente. */
  async function importFiles(files, ui, signal, opts) {
    const jobs = [];
    for (const f of files) {
      try {
        for (const src of await RC.reader.listSources(f)) {
          const info = await RC.reader.sniff(src);
          jobs.push({ src, info });
          ui.detected(src, info);
        }
      } catch (e) { ui.failed({ name: f.name }, e); }
    }
    jobs.sort((a, b) => (ORDER[a.info.kind] ?? 1) - (ORDER[b.info.kind] ?? 1));
    const results = [];
    for (const job of jobs) {
      if (signal && signal.aborted) break;
      try { results.push(await importOne(job.src, job.info, ui, signal, opts)); }
      catch (e) {
        if (e.name === 'AbortError') { ui.failed(job.src, e); break; }
        ui.failed(job.src, e);
      }
    }
    if (results.length) { linkBudget(); recomputeUSD(); DB.ver++; await persist(); RC.bus.emit('data'); }
    return results;
  }

  async function importOne(src, info, ui, signal, opts) {
    const kind = info.kind;
    if (kind === 'personas') throw new Error('El archivo tiene datos de personas (documentos, autoridades o socios). No se importa.');
    if (kind === 'desconocido') throw new Error('No reconozco las columnas. Se esperan adjudicaciones (monto, proveedor, organismo) o un registro de sociedades (CUIT, razón social).');
    const st = {
      nombre: src.name, tipo: kind, rows: 0, aceptados: 0, humanas: 0, sinMarcador: 0, sinMonto: 0,
      duplicados: 0, otraMoneda: 0, fechaAprox: 0, sociedades: 0, cruzadas: 0, fecha: Date.now(),
      complemento: !!(opts && opts.complemento)
    };
    let sink;
    if (kind === 'registro') sink = registrySink(st, info);
    else if (kind === 'convocatorias') sink = convocSink(st);
    else if (kind === 'ofertas') sink = bidsSink(st);
    else if (kind === 'presupuesto') sink = budgetSink(st);
    else {
      // contratos (CSV/JSON plano) u OCDS: la clase real se confirma en begin().
      let M = null, isReg = null, isConv = null;
      const get = (row, f) => M[f] >= 0 ? row[M[f]] : '';
      sink = {
        begin(meta) {
          if (meta.kind === 'ocds') { st.tipo = 'ocds'; return; }
          if (meta.kind === 'registro') { isReg = registrySink(st, info); st.tipo = 'registro'; return isReg.begin(meta); }
          if (meta.kind === 'convocatorias') { isConv = convocSink(st); st.tipo = 'convocatorias'; return isConv.begin(meta); }
          if (meta.kind !== 'contratos') throw new Error(meta.kind === 'personas'
            ? 'El archivo tiene datos de personas. No se importa.' : 'No reconozco las columnas del archivo.');
          M = meta.map; st.tipo = 'contratos';
        },
        row(row) {
          if (isReg) return isReg.row(row);
          if (isConv) return isConv.row(row);
          ingestContract({
            proceso: get(row, 'proceso'), safCode: get(row, 'safCode'), org: get(row, 'org'), uoc: get(row, 'uoc'),
            ptype: get(row, 'ptype'), year: get(row, 'year'), date: get(row, 'date'),
            // CONTRAT.AR no trae rubro: todo lo que tiene numero de obra es obra publica.
            rubros: get(row, 'rubros') || (M.obra >= 0 ? 'OBRA PÚBLICA' : ''),
            cuit: get(row, 'cuit'), supplier: get(row, 'supplier'), doc: get(row, 'doc'), dtype: get(row, 'dtype'),
            amount: get(row, 'amount'), currency: get(row, 'currency'), objeto: get(row, 'objeto')
          }, st);
        },
        release(r) { ingestRelease(r, st); },
        end() { if (isReg) isReg.end(); if (isConv) isConv.end(); }
      };
    }
    ui.start(src, st);
    await RC.reader.read(src, info, sink, (bytes) => ui.progress(src, bytes, st), signal);
    sink.end();
    if (st.tipo === 'contratos' || st.tipo === 'ocds') {
      const hum = st.humanas + st.sinMarcador;
      if (!st.aceptados && !hum) throw new Error('No se encontró ninguna adjudicación con monto válido.');
    }
    DB.sources.push(st);
    ui.done(src, st);
    return st;
  }

  // Los montos en dolares dependen de la tabla de cambio (editable).
  function recomputeUSD() {
    for (const k of DB.ks) k.usd = RC.toUSD(k.amt, k.cur, k.year);
    const O = DB.omit;
    for (let i = 0; i < O.amt.length; i++) O.usd[i] = RC.toUSD(O.amt[i], O.cur[i], O.year[i]);
  }

  // ── vista filtrada ──────────────────────────────────────
  /* f: { from, to (ms), min, max (en la escala de visualizacion), orgs: Set|null, pts: Set|null }
     Devuelve los indices de contratos visibles y los agregados por organismo,
     empresa y par organismo-empresa. Las alertas y el grafo trabajan sobre esto. */
  function view(f) {
    f = f || {};
    const from = isFinite(f.from) ? f.from : -Infinity, to = isFinite(f.to) ? f.to : Infinity;
    const min = isFinite(f.min) ? f.min : -Infinity, max = isFinite(f.max) ? f.max : Infinity;
    const orgs = f.orgs && f.orgs.size ? f.orgs : null, pts = f.pts && f.pts.size ? f.pts : null;
    const nO = DB.orgs.length, nC = DB.cos.length;
    const orgSum = new Float64Array(nO), orgN = new Int32Array(nO), coSum = new Float64Array(nC), coN = new Int32Array(nC);
    const disp = new Float64Array(DB.ks.length), has = new Uint8Array(DB.ks.length);
    const idx = [];
    const pair = new Map();
    let total = 0, sinCambio = 0;
    for (const k of DB.ks) {
      if (k.date < from || k.date > to) continue;
      if (orgs && !orgs.has(k.org)) continue;
      if (pts && !pts.has(k.pt)) continue;
      const d = RC.toDisplay(k.usd, k.year);
      if ((min > -Infinity || max < Infinity) && !(d >= min && d <= max)) continue;
      idx.push(k.i); has[k.i] = 1;
      const v = isFinite(d) ? d : 0;
      if (!isFinite(d)) sinCambio++;
      disp[k.i] = v;
      orgSum[k.org] += v; orgN[k.org]++; coSum[k.co] += v; coN[k.co]++; total += v;
      const pk = k.org * 2097152 + k.co;
      const p = pair.get(pk);
      if (p) { p.sum += v; p.n++; } else pair.set(pk, { org: k.org, co: k.co, sum: v, n: 1 });
    }
    // Contratos con personas humanas: cuentan en el gasto del organismo, sin identidad.
    const O = DB.omit;
    const omitSum = new Float64Array(nO), omitN = new Int32Array(nO);
    let omitTotal = 0, omitCount = 0;
    for (let i = 0; i < O.org.length; i++) {
      const dt = O.date[i];
      if (dt < from || dt > to) continue;
      if (orgs && !orgs.has(O.org[i])) continue;
      const d = RC.toDisplay(O.usd[i], O.year[i]);
      if ((min > -Infinity || max < Infinity) && !(d >= min && d <= max)) continue;
      if (!isFinite(d)) continue;
      omitSum[O.org[i]] += d; omitN[O.org[i]]++; omitTotal += d; omitCount++;
    }
    return { f, idx, disp, has, orgSum, orgN, coSum, coN, pair, total, sinCambio, omitSum, omitN, omitTotal, omitCount,
      nOrgs: orgN.reduce((a, n) => a + (n > 0 ? 1 : 0), 0), nCos: coN.reduce((a, n) => a + (n > 0 ? 1 : 0), 0) };
  }

  // ── busqueda ────────────────────────────────────────────
  function search(q, V, limit) {
    limit = limit || 8;
    const f = RC.fold(q).trim();
    const digits = q.replace(/\D/g, '');
    if (f.length < 2 && digits.length < 4) return { jurs: [], orgs: [], cos: [], ks: [] };
    const rank = (s) => s.startsWith(f) ? 0 : s.indexOf(' ' + f) >= 0 ? 1 : 2;
    const orgs = [], cos = [], ks = [], jurs = [];
    DB.dict.jur.forEach((name, j) => { if (j && RC.fold(name).includes(f)) jurs.push({ i: j, name }); });
    for (const o of DB.orgs) if (o.merged === undefined && (o._f.includes(f) || (digits && o.code === digits))) orgs.push(o);
    for (const c of DB.cos) {
      if (c._f.includes(f) || (digits.length >= 4 && c.cuit && c.cuit.includes(digits))) cos.push(c);
    }
    const byOrg = (a, b) => rank(a._f) - rank(b._f) || (V ? V.orgSum[b.i] - V.orgSum[a.i] : 0);
    const byCo = (a, b) => rank(a._f) - rank(b._f) || (V ? V.coSum[b.i] - V.coSum[a.i] : 0);
    orgs.sort(byOrg); cos.sort(byCo);
    if (f.length >= 3) {
      for (const k of DB.ks) {
        if (ks.length >= 400) break;
        if (k.doc.toLowerCase().includes(f) || k.proc.toLowerCase().includes(f)) { ks.push(k); continue; }
        const obj = objeto(k);
        if (obj && f.length >= 4 && (k._o || (k._o = RC.fold(obj))).includes(f)) ks.push(k);
      }
      ks.sort((a, b) => (b.usd || 0) - (a.usd || 0));
    }
    return { jurs: jurs.slice(0, limit), orgs: orgs.slice(0, limit), cos: cos.slice(0, limit), ks: ks.slice(0, limit),
      total: jurs.length + orgs.length + cos.length + ks.length };
  }

  const objeto = (k) => k.obj || (DB.convoc.get(k.proc) || {}).obj || '';

  // ── persistencia (IndexedDB) ────────────────────────────
  const IDB_NAME = 'rastreador-contrataciones', IDB_STORE = 'estado';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function snapshot() {
    const K = DB.ks, n = K.length;
    const col = {
      org: new Int32Array(n), co: new Int32Array(n), uoc: new Int32Array(n), pt: new Int32Array(n), dt: new Int32Array(n),
      rb: new Int32Array(n), rbs: new Int32Array(n), date: new Float64Array(n), year: new Int16Array(n), amt: new Float64Array(n),
      cur: new Array(n), doc: new Array(n), proc: new Array(n), obj: new Array(n)
    };
    for (let i = 0; i < n; i++) {
      const k = K[i];
      col.org[i] = k.org; col.co[i] = k.co; col.uoc[i] = k.uoc; col.pt[i] = k.pt; col.dt[i] = k.dt; col.rb[i] = k.rb; col.rbs[i] = k.rbs;
      col.date[i] = k.date; col.year[i] = k.year; col.amt[i] = k.amt; col.cur[i] = k.cur; col.doc[i] = k.doc; col.proc[i] = k.proc; col.obj[i] = k.obj;
    }
    const O = DB.omit;
    return {
      v: 1, demo: DB.demo, base: DB.base,
      orgs: DB.orgs.map((o) => o.merged === undefined ? [o.key, o.code, o.name] : [o.key, o.code, o.name, o.merged]),
      cos: DB.cos.map((c) => ({ id: c.id, cuit: c.cuit, valid: c.valid, kind: c.kind, name: c.name, redacted: c.redacted, tipo: c.tipo,
        fconst: c.fconst, addr: c.addr, akeys: c.akeys, crowd: c.crowd, act: c.act, reg: c.reg, regHasDate: !!c.regHasDate, estadoDom: c.estadoDom })),
      ks: col, dict: DB.dict,
      omit: { org: Int32Array.from(O.org), date: Float64Array.from(O.date), amt: Float64Array.from(O.amt), cur: O.cur.slice(), year: Int16Array.from(O.year) },
      convoc: Array.from(DB.convoc, ([p, c]) => [p, c.obj, c.est, c.pub]),
      bids: { proc: DB.bids.proc.slice(), co: Int32Array.from(DB.bids.co), org: Int32Array.from(DB.bids.org),
        amt: Float64Array.from(DB.bids.amt), rank: Int16Array.from(DB.bids.rank) },
      budget: Array.from(DB.budget.values(), (b) => [b.saf, b.year, b.jur, b.sub, b.ent, b.name, b.vig, b.dev, b.vigBS, b.devBS,
        Array.from(b.ues, ([n, u]) => [n, u[0], u[1]])]),
      regChecked: Array.from(DB.regChecked), sources: DB.sources
    };
  }
  function load(s) {
    const D = empty();
    DB = D;
    D.demo = !!s.demo; D.base = s.base || null;
    s.orgs.forEach(([key, code, name, merged], i) => {
      const o = { i, key, code, name, _f: RC.fold(name) };
      if (merged !== undefined && merged !== null) o.merged = merged;
      D.orgs.push(o); D.orgByKey.set(key, o);
      const nk = RC.norm(name); if (!D.orgByName.has(nk)) D.orgByName.set(nk, o);
    });
    s.cos.forEach((c, i) => {
      c.i = i; c.fconst = num(c.fconst); c.label = coLabel(c); c._f = RC.fold(c.label);
      D.cos.push(c); D.coById.set(c.id, c);
    });
    D.dict = Object.assign(empty().dict, s.dict);
    for (const d in D.dict) { const m = new Map(); D.dict[d].forEach((v, i) => m.set(v, i)); D.dictIdx[d] = m; }
    const C = s.ks, n = C.org.length;
    for (let i = 0; i < n; i++) {
      const k = { i, org: C.org[i], co: C.co[i], doc: C.doc[i], proc: C.proc[i], uoc: C.uoc[i], pt: C.pt[i], dt: C.dt[i], rb: C.rb[i], rbs: C.rbs[i],
        // Int16Array guarda NaN como 0: un anio 0 es un anio desconocido.
        date: num(C.date[i]), year: C.year[i] || NaN, amt: num(C.amt[i]), cur: C.cur[i], usd: NaN, obj: C.obj[i] || '' };
      D.ks.push(k);
    }
    D.kSeen = countKeys(D.ks);
    const O = s.omit;
    D.omit = { org: Array.from(O.org), date: Array.from(O.date, num), amt: Array.from(O.amt, num), cur: O.cur.slice(), year: Array.from(O.year, (y) => y || NaN), usd: [] };
    for (const [p, obj, est, pub] of s.convoc) D.convoc.set(p, { obj, est: num(est), pub: num(pub) });
    if (s.bids) {
      const B = s.bids;
      D.bids = { proc: B.proc.slice(), co: Array.from(B.co), org: Array.from(B.org), amt: Array.from(B.amt, num), rank: Array.from(B.rank) };
      for (let i = 0; i < D.bids.proc.length; i++) D.bidSeen.add(`${D.bids.proc[i]}|${D.bids.co[i]}|${D.bids.amt[i]}|${D.bids.rank[i]}`);
    }
    for (const [saf, year, jur, sub, ent, name, vig, dev, vigBS, devBS, ues] of s.budget || []) {
      D.budget.set(`${saf}|${year}`, { saf, year, jur, sub, ent, name, vig: num(vig), dev: num(dev), vigBS: num(vigBS), devBS: num(devBS),
        ues: new Map(ues.map(([n, d, v]) => [n, [num(d), num(v)]])) });
    }
    D.regChecked = new Set(s.regChecked);
    D.sources = s.sources || [];
    linkBudget();
    recomputeUSD();
    D.ver++;
  }
  // En la base incluida los NaN viajan como null (JSON); isFinite(null) da true, asi que se normalizan.
  const num = (v) => v === null || v === undefined ? NaN : v;

  /* Base incluida: web/data/base.js (la arma `npm run base` con los datos publicos) define
     RC_BASE = { meta, data } con el estado ya procesado, comprimido con gzip y en base64.
     Se carga una sola vez; despues queda guardado en el equipo como cualquier importacion. */
  function injectScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => { s.remove(); res(); };
      s.onerror = () => { s.remove(); rej(new Error('No está la base incluida (web/data/base.js). Se arma con npm run base.')); };
      document.head.appendChild(s);
    });
  }
  async function loadBase(onStatus) {
    if (onStatus) onStatus('Leyendo la base incluida…');
    // La version en la URL evita que el navegador use una base vieja guardada en cache.
    const v = global.RC_BASE_META ? `?v=${encodeURIComponent(global.RC_BASE_META.generado)}` : '';
    if (!global.RC_BASE) await injectScript(`data/base.js${v}`);
    const B = global.RC_BASE;
    global.RC_BASE = null;
    if (onStatus) onStatus('Descomprimiendo la base incluida…');
    await RC.tick();
    const b64 = atob(B.data), bin = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bin[i] = b64.charCodeAt(i);
    const txt = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    if (onStatus) onStatus('Preparando organismos, empresas y contratos…');
    await RC.tick();
    load(JSON.parse(txt));
    DB.base = B.meta;
    await persist();
    RC.bus.emit('data');
    return B.meta;
  }
  async function persist() {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(snapshot(), 'db');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
      db.close();
      return true;
    } catch (e) { console.warn('No se pudo guardar el estado', e); return false; }
  }
  async function restore() {
    try {
      const db = await idb();
      const s = await new Promise((res, rej) => {
        const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get('db');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      db.close();
      if (s && s.v === 1) { load(s); return true; }
    } catch (e) { console.warn('No se pudo recuperar el estado', e); }
    return false;
  }
  async function clear() {
    DB = empty();
    try {
      const db = await idb();
      await new Promise((res) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete('db'); tx.oncomplete = res; tx.onerror = res; });
      db.close();
    } catch (e) { /* nada guardado */ }
    RC.bus.emit('data');
  }

  // Proveedores juridicos que todavia no se cruzaron con ningun registro.
  function pendingRegistry() {
    let n = 0;
    for (const c of DB.cos) if (c.cuit && c.kind === 'juridica' && !DB.regChecked.has(c.cuit)) n++;
    return n;
  }

  RC.model = {
    get DB() { return DB; },
    importFiles, view, search, objeto, persist, restore, clear, recomputeUSD, pendingRegistry,
    snapshot, load, loadBase, linkBudget, budgetOf, jurOrgs, bidIndex,
    setDemo(v) { DB.demo = !!v; }
  };
})(window);
