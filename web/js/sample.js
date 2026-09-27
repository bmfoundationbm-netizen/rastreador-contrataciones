/* ============================================================
   Rastreador de Contrataciones · datos de ejemplo
   Genera archivos FICTICIOS con el mismo formato que los reales
   (adjudicaciones de COMPR.AR, convocatorias y el Registro
   Nacional de Sociedades) y los pasa por el importador comun.
   Organismos, empresas, CUIT y domicilios son inventados; los
   CUIT usan el rango 30-00000xxx, que no se asigna.
   Trae plantado un caso de cada alerta para poder probarlas.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const ORGS = [
    [971, 'Ministerio de Ejemplo de Infraestructura'], [972, 'Agencia Ficticia de Salud'],
    [973, 'Secretaría Modelo de Transporte'], [974, 'Instituto Imaginario de Estadística'],
    [975, 'Dirección Ficticia de Vialidad'], [976, 'Ente Demostrativo de Energía'],
    [977, 'Ministerio de Ejemplo de Educación'], [978, 'Servicio Ficticio de Parques'],
    [979, 'Organismo Modelo de Aguas'], [980, 'Secretaría Ficticia de Cultura'],
    [981, 'Hospital Imaginario del Sur'], [982, 'Universidad de Muestra']
  ];
  const RUBROS = [
    ['CONSTRUCCION;', 90000], ['INFORMATICA;', 18000], ['LIBRERIA PAP. Y UTILES OFICINA;', 2500], ['ALIMENTOS;', 9000],
    ['MANT. REPARACION Y LIMPIEZA;', 12000], ['PROD. MEDICO/FARMACEUTICOS/LAB;', 15000], ['SERV. PROFESIONAL Y COMERCIAL;', 20000],
    ['VIGILANCIA Y SEGURIDAD;', 30000], ['COMBUSTIBLES Y LUBRICANTES;', 25000], ['EQUIPOS;', 22000]
  ];
  const TIPOS = ['Licitacion Pública', 'Licitacion Privada', 'Contratación Directa', 'Contratación Directa', 'Licitacion Privada'];
  const SYL = ['ta', 'ven', 'ro', 'qui', 'mar', 'sel', 'do', 'lin', 'bra', 'cor', 'nu', 'fe', 'zan', 'pel', 'tri', 'gu', 'mo', 'ral', 'vi', 'lor', 'ten', 'bal'];
  const PRE = ['', '', '', 'Construcciones ', 'Servicios ', 'Logística ', 'Insumos ', 'Tecnología ', 'Grupo '];
  const SUF = [['S.A.', 'SOCIEDAD ANONIMA'], ['S.R.L.', 'SOCIEDAD DE RESPONSABILIDAD LIMITADA'], ['S.A.S.', 'SOCIEDAD POR ACCIONES SIMPLIFICADA'],
    ['S.R.L.', 'SOCIEDAD DE RESPONSABILIDAD LIMITADA'], ['S.A.', 'SOCIEDAD ANONIMA']];
  const CALLES = ['Calle Ejemplo', 'Av. Imaginaria', 'Pasaje Ficticio', 'Calle Muestra', 'Av. del Modelo', 'Calle Supuesta', 'Bv. Inventado'];
  const LOCS = [['CAPITAL FEDERAL', 'CIUDAD AUTONOMA BUENOS AIRES'], ['LA PLATA', 'BUENOS AIRES'], ['ROSARIO', 'SANTA FE'],
    ['CORDOBA', 'CORDOBA'], ['MENDOZA', 'MENDOZA'], ['NEUQUEN', 'NEUQUEN']];

  function cuitFor(n) {
    for (let b = n; ; b += 7919) {
      const body = '30' + String(b).padStart(8, '0');
      let s = 0; const W = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      for (let i = 0; i < 10; i++) s += (+body[i]) * W[i];
      const r = 11 - (s % 11);
      if (r === 10) continue;
      return body + (r === 11 ? 0 : r);
    }
  }
  const fmtC = (c) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
  const p2 = (n) => String(n).padStart(2, '0');
  const dmy = (t) => { const d = new Date(t); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} 11:30:00 a.m.`; };
  const ymd = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-00:00`; };
  const cell = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const line = (arr) => arr.map(cell).join(',');

  function generate() {
    const R = rng(20260927);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const between = (a, b) => a + (b - a) * R();
    const logn = (median, sigma) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(R() || 1e-9)) * Math.cos(2 * Math.PI * R()));
    const rate = (y) => RC.RATES_DEFAULT[y] || 1450;

    // ── empresas ──
    const cos = [];
    const used = new Set();
    function company(opts) {
      let name;
      do {
        const n = 2 + (R() < 0.35 ? 1 : 0);
        let w = ''; for (let i = 0; i < n; i++) w += pick(SYL);
        name = pick(PRE) + w[0].toUpperCase() + w.slice(1);
      } while (used.has(name));
      used.add(name);
      const suf = opts.suf || pick(SUF);
      const c = Object.assign({
        cuit: cuitFor(100 + cos.length * 37), name: `${name} ${suf[0]}`, tipo: suf[1],
        fconst: Date.UTC(1978 + Math.floor(R() * 42), Math.floor(R() * 12), 1 + Math.floor(R() * 27)),
        addr: [pick(CALLES), String(100 + Math.floor(R() * 4800)), R() < 0.4 ? String(1 + Math.floor(R() * 12)) : '', R() < 0.3 ? pick(['A', 'B', 'C', '4']) : '', pick(LOCS)],
        rubros: [pick(RUBROS), pick(RUBROS)], weight: 0.3 + R() * 2
      }, opts);
      cos.push(c);
      return c;
    }
    for (let i = 0; i < 64; i++) company({});
    // Casos plantados.
    const nueva1 = company({ fconst: Date.UTC(2025, 2, 10), rubros: [RUBROS[0], RUBROS[0]], weight: 0, suf: SUF[2] });
    const nueva2 = company({ fconst: Date.UTC(2023, 10, 20), rubros: [RUBROS[1], RUBROS[1]], weight: 0 });
    const dominante = company({ rubros: [RUBROS[4], RUBROS[4]], weight: 0 });
    const domAddr = ['Av. Siempreviva', '742', '3', 'B', LOCS[0]];
    const dom = [0, 1, 2, 3].map(() => company({ addr: domAddr.slice(), rubros: [RUBROS[6], RUBROS[9]], weight: 0.4 }));
    const masAddr = ['Calle Ficticia', '100', '', '', LOCS[0]];
    const mas = [0, 1].map(() => company({ addr: masAddr.slice(), weight: 0.6 }));
    const sh = company({ name: 'Fulano Ejemplo y Mengano Muestra S.H.', tipo: 'SOCIEDAD DE HECHO', weight: 0.5 });
    const sinRegistro = company({ weight: 0.5 });

    // ── adjudicaciones ──
    const H = ['Numero_Proceso', 'Nro_SAF', 'Descripcion_SAF', 'Nro_UOC', 'Descripcion_UOC', 'Unidad_Ejecutora', 'Tipo_de_Procedimiento', 'Modalidad',
      'Apartado_Directa', 'Ejercicio', 'Fecha_de_Adjudicacion', 'Rubros', 'CUIT', 'Descripcion_Proveedor', 'Documento_Contractual', 'Tipo', 'Monto',
      'Moneda', 'Tipo_de_Operacion', 'Fecha_de_perfeccionamiento_OC'];
    const rows = [line(H)];
    const conv = [line(['Numero_Proceso', 'Nro_SAF', 'Descripcion_SAF', 'Tipo_de_Procedimiento', 'Ejercicio', 'Fecha_de_Publicacion', 'Objeto_del_Proceso', 'Monto_Estimado'])];
    const seq = {};
    const OBJ = { 'CONSTRUCCION;': 'Obra de refacción', 'INFORMATICA;': 'Adquisición de equipamiento informático', 'LIBRERIA PAP. Y UTILES OFICINA;': 'Compra de útiles de oficina',
      'ALIMENTOS;': 'Provisión de alimentos', 'MANT. REPARACION Y LIMPIEZA;': 'Servicio de limpieza integral', 'PROD. MEDICO/FARMACEUTICOS/LAB;': 'Insumos médicos',
      'SERV. PROFESIONAL Y COMERCIAL;': 'Consultoría', 'VIGILANCIA Y SEGURIDAD;': 'Servicio de vigilancia', 'COMBUSTIBLES Y LUBRICANTES;': 'Provisión de combustible', 'EQUIPOS;': 'Adquisición de equipos' };
    function proc(org, year, tipo, rubro, date, est) {
      const code = { 'Licitacion Pública': 'LPU', 'Licitacion Privada': 'LPR', 'Contratación Directa': 'CDI' }[tipo];
      const k = `${org[0]}-${year}`; seq[k] = (seq[k] || 0) + 1;
      const id = `${org[0] - 900}-${String(seq[k]).padStart(4, '0')}-${code}${String(year).slice(2)}`;
      conv.push(line([id, org[0], `${org[0]} - ${org[1]}`, tipo, year, dmy(date - 40 * RC.DAY), `${OBJ[rubro]} para ${org[1]}`, est ? est.toFixed(2) : '']));
      return id;
    }
    let oc = 0;
    const firmados = [];   // contratos con empresas, para colgarles items de ejemplo
    function adj(org, pid, tipo, year, date, rubro, sup, amt, cur, dt) {
      oc++;
      const persona = sup === 'persona';
      if (!persona && cur !== 'USD' && !dt) firmados.push({ doc: `${org[0] - 900}-${String(1000 + oc).slice(-4)}-OC${String(year).slice(2)}`, pid, date, year, rubro, sup });
      rows.push(line([pid, org[0], `${org[0]} - ${org[1]}`, org[0] - 900, `${org[0] - 900}/000 - Dirección de Administración`,
        `${org[0] - 900}/000 - Dirección de Administración`, tipo, 'Sin Modalidad', tipo === 'Contratación Directa' ? 'Apartado 1: Compulsa Abreviada Por Monto' : '',
        year, dmy(date), rubro, persona ? fmtC('20' + String(10000000 + Math.floor(R() * 29999999)) + '5') : fmtC(sup.cuit),
        persona ? 'PROVEEDOR PERSONA HUMANA (EJEMPLO)' : sup.name, `${org[0] - 900}-${String(1000 + oc).slice(-4)}-OC${String(year).slice(2)}`,
        dt || 'Original', amt.toFixed(2), cur === 'USD' ? 'Dolar Estadounidense' : 'Peso Argentino', 'Proceso de Compra', dmy(date)]));
    }
    const orgW = ORGS.map(() => 0.4 + R() * 1.6);
    const regular = cos.filter((c) => c.weight > 0);
    const totalW = regular.reduce((s, c) => s + c.weight, 0);
    const pickCo = () => { let x = R() * totalW; for (const c of regular) { x -= c.weight; if (x <= 0) return c; } return regular[0]; };

    for (let year = 2019; year <= 2026; year++) {
      const nProc = year === 2026 ? 150 : 240;
      for (let p = 0; p < nProc; p++) {
        const oi = Math.floor(R() * ORGS.length);
        if (R() > orgW[oi] / 2) continue;
        const org = ORGS[oi];
        const co0 = pickCo();
        const rubro = pick(co0.rubros);
        const tipo = pick(TIPOS);
        const month = year === 2026 ? Math.floor(R() * 8) : Math.floor(R() * 12);
        const date = Date.UTC(year, month, 1 + Math.floor(R() * 27));
        const usd = logn(rubro[1], 0.8);
        const pid = proc(org, year, tipo, rubro[0], date, usd * rate(year) * between(0.9, 1.25));
        const nAdj = R() < 0.25 ? 2 : 1;
        for (let a = 0; a < nAdj; a++) {
          const sup = R() < 0.16 ? 'persona' : a === 0 ? co0 : pickCo();
          const cur = R() < 0.05 ? 'USD' : 'ARS';
          const amount = (usd / nAdj) * between(0.85, 1.1) * (cur === 'USD' ? 1 : rate(year));
          adj(org, pid, tipo, year, date, rubro[0], sup, amount, cur);
          if (R() < 0.06 && sup !== 'persona' && date + 200 * RC.DAY < Date.UTC(2026, 8, 1)) adj(org, pid, tipo, year, date + 200 * RC.DAY, rubro[0], sup, amount * between(0.1, 0.3), cur, 'Ampliación');
        }
      }
    }

    // 1. Empresas recien creadas con contratos grandes.
    const vial = ORGS[4];
    [[2025, 4, 18], [2025, 6, 2], [2025, 8, 14]].forEach(([y, m, d], i) => {
      const date = Date.UTC(y, m, d);
      const pid = proc(vial, y, 'Licitacion Pública', RUBROS[0][0], date, 2.1e6 * rate(y));
      adj(vial, pid, 'Licitacion Pública', y, date, RUBROS[0][0], nueva1, (1.8e6 + i * 0.4e6) * rate(y), 'ARS');
    });
    {
      const org = ORGS[1], date = Date.UTC(2024, 1, 12);
      const pid = proc(org, 2024, 'Contratación Directa', RUBROS[1][0], date, 0.6e6 * rate(2024));
      adj(org, pid, 'Contratación Directa', 2024, date, RUBROS[1][0], nueva2, 0.62e6 * rate(2024), 'ARS');
    }
    // 2. Un proveedor que acapara las compras de un organismo.
    const aguas = ORGS[8];
    for (let year = 2022; year <= 2025; year++) for (let j = 0; j < 7; j++) {
      const date = Date.UTC(year, 1 + j, 10);
      const pid = proc(aguas, year, pick(TIPOS), RUBROS[4][0], date, 0);
      adj(aguas, pid, 'Contratación Directa', year, date, RUBROS[4][0], dominante, logn(90000, 0.4) * rate(year), 'ARS');
    }
    // 3. Montos fuera de lo normal: utiles de oficina a 60 veces la mediana, y un proceso tres veces sobre lo estimado.
    {
      const org = ORGS[9], date = Date.UTC(2023, 7, 22);
      const pid = proc(org, 2023, 'Contratación Directa', RUBROS[2][0], date, 170000 * rate(2023));
      adj(org, pid, 'Contratación Directa', 2023, date, RUBROS[2][0], pickCo(), 160000 * rate(2023), 'ARS');
      const org2 = ORGS[6], date2 = Date.UTC(2024, 9, 3);
      const pid2 = proc(org2, 2024, 'Licitacion Privada', RUBROS[3][0], date2, 12000 * rate(2024));
      adj(org2, pid2, 'Licitacion Privada', 2024, date2, RUBROS[3][0], pickCo(), 38000 * rate(2024), 'ARS');
    }
    // 4. Empresas en el mismo domicilio que se presentan en los mismos procesos.
    const transp = ORGS[2];
    for (let j = 0; j < 6; j++) {
      const year = 2021 + Math.floor(j / 2), date = Date.UTC(year, 3 + j, 5);
      const pid = proc(transp, year, 'Licitacion Privada', RUBROS[6][0], date, 60000 * rate(year));
      adj(transp, pid, 'Licitacion Privada', year, date, RUBROS[6][0], dom[j % 3], logn(55000, 0.3) * rate(year), 'ARS');
      if (j % 2 === 0) adj(transp, pid, 'Licitacion Privada', year, date, RUBROS[6][0], dom[(j + 1) % 3], logn(20000, 0.3) * rate(year), 'ARS');
    }

    // ── registro de sociedades (formato RNS) ──
    const RH = ['cuit', 'razon_social', 'fecha_hora_contrato_social', 'tipo_societario', 'fecha_hora_actualizacion', 'numero_inscripcion',
      'dom_fiscal_provincia', 'dom_fiscal_localidad', 'dom_fiscal_calle', 'dom_fiscal_numero', 'dom_fiscal_piso', 'dom_fiscal_departamento', 'dom_fiscal_cp',
      'dom_fiscal_estado_domicilio', 'dom_legal_provincia', 'dom_legal_localidad', 'dom_legal_calle', 'dom_legal_numero', 'dom_legal_piso',
      'dom_legal_departamento', 'dom_legal_cp', 'dom_legal_estado_domicilio', 'actividad_codigo', 'actividad_descripcion', 'actividad_orden',
      'actividad_estado', 'actividad_vigencia'];
    const reg = [line(RH)];
    const ACT = { 'CONSTRUCCION;': 'Construcción de edificios', 'INFORMATICA;': 'Servicios de informática', 'LIBRERIA PAP. Y UTILES OFICINA;': 'Venta de artículos de librería',
      'ALIMENTOS;': 'Venta al por mayor de alimentos', 'MANT. REPARACION Y LIMPIEZA;': 'Servicios de limpieza', 'PROD. MEDICO/FARMACEUTICOS/LAB;': 'Venta de productos médicos',
      'SERV. PROFESIONAL Y COMERCIAL;': 'Servicios de consultoría', 'VIGILANCIA Y SEGURIDAD;': 'Servicios de seguridad', 'COMBUSTIBLES Y LUBRICANTES;': 'Venta de combustibles', 'EQUIPOS;': 'Venta de equipos' };
    function regRow(c) {
      const [calle, num, piso, dto, loc] = c.addr;
      const acts = [c.rubros[0][0], c.rubros[1][0]].filter((v, i, a) => a.indexOf(v) === i);
      acts.forEach((r, i) => reg.push(line([c.cuit, c.name.toUpperCase(), ymd(c.fconst), c.tipo, '2026-05-01-10:00', '', loc[1], loc[0], calle.toUpperCase(), num, piso, dto, 1000 + (+num % 800),
        'DECLARADO', loc[1], loc[0], calle.toUpperCase(), num, piso, dto, 1000 + (+num % 800), 'DECLARADO', 100000 + i, ACT[r] || 'Servicios', i + 1, 'AC', 'S'])));
    }
    for (const c of cos) if (c !== sinRegistro) regRow(c);
    // Domicilio masivo: 40 sociedades mas (que no son proveedoras) en el mismo edificio.
    for (let i = 0; i < 40; i++) {
      const c = { cuit: cuitFor(90000 + i * 13), name: `Sociedad Vecina ${i + 1} S.A.`, tipo: 'SOCIEDAD ANONIMA', fconst: Date.UTC(2010 + (i % 12), i % 12, 1),
        addr: masAddr.slice(), rubros: [RUBROS[6], RUBROS[6]] };
      regRow(c);
    }

    // ── precios de ejemplo: items comprados, precios de mercado e IPC (todo inventado) ──
    // Generador aparte, para no alterar el resto del ejemplo.
    const P = rng(4242);
    const between2 = (a, b) => a + (b - a) * P();
    const PROD = [
      { r: 'INFORMATICA', d: 'Notebook 15,6" Intel Core i5 8 GB RAM 256 GB SSD', u: 'unidad', usd: 750,
        v: ['NOTEBOOK 15.6 PULGADAS CORE I5 8GB 256GB SSD', 'Computadora portátil i5 15,6" 8 GB 256 GB SSD'] },
      { r: 'INFORMATICA', d: 'Monitor LED 24" Full HD', u: 'unidad', usd: 160, v: ['MONITOR 24 PULGADAS LED FULL HD', 'Monitor LED 24" 1920x1080'] },
      { r: 'INFORMATICA', d: 'Impresora láser monocromo 40 ppm', u: 'unidad', usd: 380, v: ['IMPRESORA LASER MONOCROMATICA 40 PPM'] },
      { r: 'INFORMATICA', d: 'Disco sólido SSD 1 TB', u: 'unidad', usd: 90, v: ['DISCO SSD 1TB', 'Unidad de estado sólido 1 TB'] },
      { r: 'PROD. MEDICO/FARMACEUTICOS/LAB', d: 'Amoxicilina 500 mg comprimidos', u: 'caja x 16', usd: 4.5,
        v: ['AMOXICILINA 500MG COMP', 'Amoxicilina comprimidos 500 mg'] },
      { r: 'PROD. MEDICO/FARMACEUTICOS/LAB', d: 'Ibuprofeno 400 mg comprimidos', u: 'caja x 20', usd: 3, v: ['IBUPROFENO 400 MG COMPRIMIDOS'] },
      { r: 'PROD. MEDICO/FARMACEUTICOS/LAB', d: 'Guantes de látex descartables talle M', u: 'caja x 100', usd: 9, v: ['GUANTES LATEX DESCARTABLES TALLE M'] },
      { r: 'PROD. MEDICO/FARMACEUTICOS/LAB', d: 'Jeringa descartable 5 ml', u: 'caja x 100', usd: 14, v: ['JERINGAS DESCARTABLES 5ML'] }
    ];
    // IPC de ejemplo: sigue al tipo de cambio de cada anio, interpolado mes a mes.
    const ipcRows = ['indice_tiempo,148.3_INIVELNAL_DICI_M_26'];
    const ipc = new Map();
    for (let y = 2015; y <= 2026; y++) for (let m = 0; m < 12; m++) {
      if (y === 2026 && m > 7) break;
      const a = rate(y), b = rate(Math.min(2026, y + 1)), v = 100 * (a + (b - a) * m / 12) / rate(2016);
      ipc.set(`${y}-${p2(m + 1)}`, v);
      ipcRows.push(`${y}-${p2(m + 1)}-01,${v.toFixed(4)}`);
    }
    const ipcAt = (t) => { const d = new Date(t); return ipc.get(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`) || ipc.get('2026-08'); };
    const mktPrice = (pr, t) => pr.usd * rate(2024) * ipcAt(t) / ipcAt(Date.UTC(2024, 6, 1));
    const mercado = [line(['producto', 'unidad', 'precio', 'fecha', 'fuente', 'tipo', 'provincia', 'iva_incluido', 'rubro'])];
    for (const pr of PROD) for (let y = 2019; y <= 2026; y++) for (const m of [2, 5, 8, 11]) {
      if (y === 2026 && m > 8) continue;
      if (P() < 0.35) continue;
      const t = Date.UTC(y, m - 1, 10), may = P() < 0.5;
      mercado.push(line([pr.d, pr.u, (mktPrice(pr, t) * (may ? 0.86 : 1) * between2(0.93, 1.08)).toFixed(2), `10/${p2(m)}/${y}`,
        may ? 'Lista mayorista de ejemplo' : 'Relevamiento minorista de ejemplo', may ? 'mayorista' : 'minorista', 'CABA', 'sí',
        /INFOR/.test(pr.r) ? 'Informática' : 'Medicamentos e insumos']));
    }
    const items = [line(['orden_de_compra', 'proceso', 'fecha', 'renglon', 'descripcion', 'cantidad', 'unidad', 'precio_unitario', 'iva_incluido', 'cuit_proveedor'])];
    const aptos = firmados.filter((c) => /INFORMATICA|MEDICO/.test(c.rubro) && c.year >= 2019);
    aptos.forEach((c) => {
      const pool = PROD.filter((pr) => pr.r.slice(0, 5) === c.rubro.slice(0, 5));
      const k = 1 + (P() < 0.4 ? 1 : 0);
      for (let j = 0; j < k; j++) {
        const pr = pool[Math.floor(P() * pool.length)];
        // Casi siempre cerca del mercado; algunos muy por encima (los casos a detectar).
        const f = P() < 0.12 ? between2(1.8, 3.2) : between2(0.9, 1.25);
        const desc = P() < 0.6 ? pr.v[Math.floor(P() * pr.v.length)] : pr.d;
        const qty = /caja/.test(pr.u) ? Math.round(between2(40, 900)) : Math.round(between2(2, 60));
        items.push(line([c.doc, c.pid, dmy(c.date).slice(0, 10), j + 1, desc, qty, pr.u, (mktPrice(pr, c.date) * f).toFixed(2), 'sí', fmtC(c.sup.cuit)]));
      }
    });
    // Un item sin par claro en el mercado (27" no es 24"): queda para revisar.
    if (aptos.length) items.push(line([aptos[0].doc, aptos[0].pid, dmy(aptos[0].date).slice(0, 10), 9, 'Monitor LED 27" 2K', 4, 'unidad',
      (mktPrice(PROD[1], aptos[0].date) * 1.9).toFixed(2), 'sí', fmtC(aptos[0].sup.cuit)]));

    const file = (parts, name) => new File([parts.join('\r\n') + '\r\n'], name, { type: 'text/csv' });
    return [
      file(conv, 'convocatorias-EJEMPLO-ficticio.csv'),
      file(rows, 'adjudicaciones-EJEMPLO-ficticio.csv'),
      file(reg, 'registro-sociedades-EJEMPLO-ficticio.csv'),
      file(ipcRows, 'ipc-EJEMPLO-ficticio.csv'),
      file(mercado, 'precios-mercado-EJEMPLO-ficticio.csv'),
      file(items, 'items-comprados-EJEMPLO-ficticio.csv')
    ];
  }

  RC.sample = { generate };
})(window);
