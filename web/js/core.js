/* ============================================================
   Rastreador de Contrataciones · core
   Utilidades, texto, CUIT, fechas, montos, domicilios,
   tipos de cambio, ajustes y bus de eventos.
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC = global.RC || {};

  // ── utilidades ──────────────────────────────────────────
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const DAY = 86400000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function debounce(fn, ms) {
    let t = 0;
    return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }
  // Ceder el hilo sin el recorte de 4 ms de setTimeout anidado.
  const tick = (() => {
    const ch = new MessageChannel(); const q = [];
    ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();
  const now = () => performance.now();

  // ── bus de eventos ──────────────────────────────────────
  const bus = (() => {
    const map = new Map();
    return {
      on(k, fn) { (map.get(k) || map.set(k, []).get(k)).push(fn); return () => bus.off(k, fn); },
      off(k, fn) { const a = map.get(k); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
      emit(k, d) { const a = map.get(k); if (a) for (const f of a.slice()) { try { f(d); } catch (e) { console.error(k, e); } } }
    };
  })();

  // ── texto ───────────────────────────────────────────────
  // Mayusculas sin tildes ni signos: la forma canonica para comparar.
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9Ñ&]+/g, ' ').trim();
  }
  // Minusculas sin tildes para busqueda.
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  // Limpia un nombre para mostrar: espacios dobles, puntos repetidos, comillas sueltas y
  // caracteres de control C1 (el presupuesto abierto trae algunos por errores de codificacion).
  function tidy(s) {
    return String(s == null ? '' : s).replace(/[\u0080-\u009f“”«»"]+/g, '').replace(/\s+/g, ' ')
      .replace(/\.{2,}/g, '.').replace(/^[\s\-–,;]+|[\s\-–,;]+$/g, '').trim();
  }
  /* Copia propia de un string. Los cortes de un tramo grande de texto (slice) retienen
     el tramo entero en memoria; al guardar miles de numeros de expediente eso retenia
     el archivo completo. Concatenar y recortar fuerza una copia chica e independiente. */
  const own = (s) => s ? (' ' + s).slice(1) : '';
  // Rotulo corto del organismo: "374 - Estado Mayor ..." -> "Estado Mayor ..."
  function orgLabel(s) { return tidy(String(s || '').replace(/^\s*\d+(\/\d+)?\s*-\s*/, '')); }

  // ── CUIT ────────────────────────────────────────────────
  const CUIT_W = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const PREF_JUR = { '30': 1, '33': 1, '34': 1 };
  const PREF_HUM = { '20': 1, '23': 1, '24': 1, '27': 1 };

  function cuitValid(d) {
    if (!/^\d{11}$/.test(d)) return false;
    let s = 0; for (let i = 0; i < 10; i++) s += (d.charCodeAt(i) - 48) * CUIT_W[i];
    const r = 11 - (s % 11);
    if (r === 10) return false;
    return (r === 11 ? 0 : r) === d.charCodeAt(10) - 48;
  }
  const fmtCuit = (d) => d && d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (d || '');

  /* Interpreta el identificador fiscal de un proveedor.
     kind: 'juridica' | 'humana' | 'extranjero' | 'vacio' | 'desconocido'
     En COMPR.AR las filas "SPR" traen el CUIT con el verificador repetido
     dentro del cuerpo (30-707034129-9 en vez de 30-70703412-9): se repara. */
  function parseCuit(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { kind: 'vacio', cuit: null, valid: false, id: '' };
    const m = /^(\d{2})\s*-\s*(\d{9})\s*-\s*(\d)$/.exec(s);
    let d = m && m[2][8] === m[3] ? m[1] + m[2].slice(0, 8) + m[3] : s.replace(/[\s.\-\/]/g, '');
    if (/^\d{11}$/.test(d)) {
      const p = d.slice(0, 2);
      const kind = PREF_JUR[p] ? 'juridica' : PREF_HUM[p] ? 'humana' : 'desconocido';
      return { kind, cuit: d, valid: cuitValid(d), id: d };
    }
    return { kind: 'extranjero', cuit: null, valid: false, id: 'X:' + norm(s).replace(/ /g, '') };
  }

  /* Marcadores de persona juridica en una razon social. Se usan solo cuando
     el identificador no es un CUIT argentino (proveedores del exterior o sin
     identificador): sin marcador, la fila podria ser una persona y se omite. */
  const JUR_TOKENS = new Set(('SA SAU SRL SAS SCA SCS SC SE SH SL SLU SLL SPA SRLTDA LTDA LTD LIMITED INC CORP ' +
    'CORPORATION CO COMPANY GMBH AG KG BV NV LLC LLP LP PLC PTY KFT SPOL SRO OY AB ASA SARL SASU EIRL ' +
    'SPZOO SPZ ZOO DOO AD OOO PJSC JSC SAPEM UTE UT COOPERATIVA COOP ASOCIACION ASSOCIATION FUNDACION ' +
    'FOUNDATION UNIVERSIDAD UNIVERSITY MUNICIPALIDAD INSTITUTO INSTITUTE CONSORCIO FIDEICOMISO BANCO BANK ' +
    'SOCIEDAD COMPANIA CIA EMPRESA GRUPO GROUP HOLDING HOLDINGS INDUSTRIES INDUSTRIAS LABORATORIO LABORATORIOS ' +
    'LABORATORIES SOCIETY SOCIETE GESELLSCHAFT VERLAG TRUST COLEGIO CAMARA FEDERACION FEDERATION').split(' '));

  function nameTokens(name) {
    const raw = norm(name).split(' ').filter(Boolean);
    // "S A U" -> "SAU": une letras sueltas consecutivas (siglas con puntos).
    const out = []; let acc = '';
    for (const t of raw) {
      if (t.length === 1) { acc += t; continue; }
      if (acc) { out.push(acc); acc = ''; }
      out.push(t);
    }
    if (acc) out.push(acc);
    return out;
  }
  function looksJuridica(name) {
    for (const t of nameTokens(name)) {
      if (JUR_TOKENS.has(t)) return true;
      if (/^SA[CIFAMGEYUJN]{1,6}$/.test(t) || /^SRL[A-Z]?$/.test(t)) return true;
    }
    return false;
  }

  /* Entidades cuyo nombre suele ser el de personas: sociedades de hecho (el nombre
     lista a los socios), condominios y sucesiones. Se muestra un rotulo generico. */
  function personalName(name, tipo) {
    const t = ' ' + nameTokens(name).join(' ') + ' ';
    const tt = norm(tipo);
    if (/ SOCIEDAD DE HECHO | SOC DE HECHO | SH | SDH /.test(t) || /DE HECHO|SECCION IV/.test(tt)) return 'Sociedad de hecho';
    if (/ CONDOMINIO | CONDOMINO /.test(t)) return 'Condominio';
    if (/ SUCESION | SUCESORES /.test(t)) return 'Sucesión';
    if (/ Y OTROS | Y OTRAS | Y OTRO | Y OTRA /.test(t)) return 'Entidad colectiva';
    return null;
  }

  // ── fechas ──────────────────────────────────────────────
  const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
    sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  // Devuelve ms UTC del dia (sin hora) o NaN. Acepta los formatos de los datasets:
  // "28/12/2016 04:05:45 p.m.", "2017-02-17 00:00:00", "1912-04-30-10:43", "20240131", ISO,
  // "12-feb-2016" (COMPR.AR anterior) y "20 de SETIEMBRE de 2019".
  function parseDate(s) {
    if (s == null) return NaN;
    if (typeof s === 'number') return s;
    s = String(s).trim();
    let y, m, d, r;
    if ((r = /^(\d{1,2})(?:\s+de\s+|[\-\/ .])([a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa]{3,})\.?(?:\s+de\s+|[\-\/ .])(\d{4})/i.exec(s))) {
      m = MESES[fold(r[2]).slice(0, 3)]; d = +r[1]; y = +r[3];
      if (!m) return NaN;
    }
    else if ((r = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s))) { d = +r[1]; m = +r[2]; y = +r[3]; }
    else if ((r = /^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else return NaN;
    if (y < 1850 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return NaN;
    return Date.UTC(y, m - 1, d);
  }
  const p2 = (n) => String(n).padStart(2, '0');
  function fmtDate(ms) {
    if (!isFinite(ms)) return '—';
    const t = new Date(ms);
    return `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
  }
  const isoDate = (ms) => isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
  const yearOf = (ms) => isFinite(ms) ? new Date(ms).getUTCFullYear() : NaN;
  function fmtAge(days) {
    if (!isFinite(days)) return '—';
    const neg = days < 0; days = Math.abs(days);
    let out;
    if (days < 45) out = `${Math.round(days)} días`;
    else if (days < 365) out = `${Math.round(days / 30.44)} meses`;
    else {
      const yy = Math.floor(days / 365.25), mm = Math.round((days - yy * 365.25) / 30.44);
      out = `${yy} ${yy === 1 ? 'año' : 'años'}` + (mm > 0 && yy < 5 ? ` y ${mm} ${mm === 1 ? 'mes' : 'meses'}` : '');
    }
    return neg ? `${out} antes` : out;
  }

  // "452-0001-LPU17" -> "Licitación Pública". Sirve cuando el archivo no trae el tipo (CONTRAT.AR).
  const PROC_CODE = { LPU: 'Licitación Pública', LPR: 'Licitación Privada', CDI: 'Contratación Directa',
    CPU: 'Concurso Público', CPR: 'Concurso Privado', SPU: 'Subasta Pública', CPS: 'Compulsa de Precios' };
  function ptypeFromCode(proc) {
    const r = /-([A-Z]{3})\d{2}$/.exec(String(proc || '').trim().toUpperCase());
    return r ? PROC_CODE[r[1]] || '' : '';
  }

  // ── montos ──────────────────────────────────────────────
  // "1230000.00", "1,735,400.00", "1.735.400,00", "469450.0", "12,5" -> numero.
  function parseAmount(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().replace(/\s|\$|ARS|USD|U\$S/gi, '');
    if (!s) return NaN;
    let neg = false;
    if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1); }
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (ld >= 0 && s.indexOf('.') !== ld) s = s.replace(/\./g, '');
    const v = Number(s);
    return neg ? -v : v;
  }

  function currencyCode(s) {
    const t = norm(s);
    if (!t || t === 'PESO ARGENTINO' || t === 'ARS' || t === 'PESOS' || t === '$' || t === 'PESO') return 'ARS';
    if (/DOLAR|USD|U S|^US$/.test(t)) return 'USD';
    if (/EURO|EUR/.test(t)) return 'EUR';
    if (/LIBRA|GBP/.test(t)) return 'GBP';
    if (/FRANCO SUIZO|CHF/.test(t)) return 'CHF';
    if (/REAL|BRL/.test(t)) return 'BRL';
    if (/YEN|JPY/.test(t)) return 'JPY';
    return 'OTRA';
  }

  /* Tipo de cambio oficial promedio anual (pesos por dolar, BCRA Com. A 3500),
     aproximado y editable en Ajustes. Solo sirve para sumar contratos de distintos
     anios y monedas en una misma escala; nunca para comparar precios finos. */
  const RATES_DEFAULT = {
    2010: 3.91, 2011: 4.13, 2012: 4.55, 2013: 5.48, 2014: 8.12, 2015: 9.27, 2016: 14.78, 2017: 16.56, 2018: 28.09, 2019: 48.25, 2020: 70.60,
    2021: 95.16, 2022: 130.82, 2023: 296.27, 2024: 915.8, 2025: 1245, 2026: 1450
  };
  // Dolares por unidad de otra moneda.
  const CROSS = { USD: 1, EUR: 1.10, GBP: 1.28, CHF: 1.12, BRL: 0.19, JPY: 0.0068 };

  // ── ajustes (persisten por equipo, con tolerancia a almacenamiento bloqueado) ──
  const SETTINGS_KEY = 'rc.ajustes.v1';
  const DEFAULTS = {
    moneda: 'USD',            // escala de visualizacion: 'USD' (equivalente) o 'ARS' (nominal)
    nuevaMeses: 12,           // "recien creada": antiguedad maxima al adjudicar
    grandePct: 90,            // "contrato grande": percentil del anio
    acaparaShare: 40,         // % del gasto del organismo
    acaparaMinN: 5,           // contratos minimos del organismo
    acaparaMinUSD: 50000,     // gasto minimo del organismo (USD eq.)
    montoZ: 3.5,              // desvio robusto sobre log(monto)
    montoMinGrupo: 20,        // contratos minimos por grupo de comparacion
    estimadoRatio: 200,       // % por encima del monto estimado de la convocatoria (200 = el triple)
    domMin: 2,                // empresas minimas en un mismo domicilio
    domMasivo: 25,            // sociedades del registro a partir de las cuales el domicilio es "masivo"
    maxEmpresas: 300,         // nodos de empresa en el grafo
    maxContratos: 1000,       // nodos de contrato en el grafo
    etiquetas: true,
    rates: null               // sobreescritura de RATES_DEFAULT
  };
  let settings = Object.assign({}, DEFAULTS);
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) Object.assign(settings, JSON.parse(raw)); } catch (e) { /* sin almacenamiento */ }
  function setSettings(patch) {
    Object.assign(settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* sin almacenamiento */ }
    bus.emit('settings', settings);
  }
  const rates = () => Object.assign({}, RATES_DEFAULT, settings.rates || {});
  function usdRate(year) {
    const r = rates();
    if (r[year]) return r[year];
    const ys = Object.keys(r).map(Number).sort((a, b) => a - b);
    if (!ys.length) return NaN;
    if (!isFinite(year) || year > ys[ys.length - 1]) return r[ys[ys.length - 1]];
    return r[ys[0]];
  }
  // Monto en dolares equivalentes. NaN si la moneda no tiene conversion.
  function toUSD(amount, cur, year) {
    if (!isFinite(amount)) return NaN;
    if (cur === 'ARS') return amount / usdRate(year);
    const c = CROSS[cur];
    return c ? amount * c : NaN;
  }
  // Valor en la escala elegida por el usuario a partir de dolares equivalentes.
  const toDisplay = (usd, year) => settings.moneda === 'ARS' ? usd * usdRate(year) : usd;

  // ── formato de montos ───────────────────────────────────
  const NF1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  const NF0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const NF2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function compact(v) {
    const a = Math.abs(v);
    if (!isFinite(v)) return '—';
    if (a >= 1e9) return NF1.format(v / 1e9) + ' mil M';
    if (a >= 1e6) return NF1.format(v / 1e6) + ' M';
    if (a >= 1e4) return NF1.format(v / 1e3) + ' mil';
    return NF0.format(v);
  }
  const unit = () => settings.moneda === 'ARS' ? '$' : 'US$';
  // Monto ya expresado en la escala de visualizacion.
  const money = (v) => isFinite(v) ? `${unit()} ${compact(v)}` : '—';
  const CUR_SYM = { ARS: '$', USD: 'US$', EUR: '€', GBP: '£', CHF: 'CHF', BRL: 'R$', JPY: '¥', OTRA: '' };
  const moneyNative = (v, cur) => isFinite(v) ? `${CUR_SYM[cur] || cur} ${NF2.format(v)}` : '—';
  const int = (n) => NF0.format(n || 0);
  const pct = (x) => isFinite(x) ? `${NF1.format(x * 100)} %` : "—";

  // ── domicilios ──────────────────────────────────────────
  const STREET_STOP = new Set(('AV AVDA AVENIDA CALLE BOULEVARD BV BLVD BOULEVAR PJE PASAJE DIAG DIAGONAL RUTA ' +
    'DE DEL LA LAS LOS EL Y DR DOCTOR GRAL GENERAL TTE TENIENTE CNEL CORONEL PTE PRESIDENTE ING INGENIERO ' +
    'CAP CAPITAN SGTO SARGENTO ALTE ALMIRANTE STA SANTA STO SANTO SAN MTRO MAESTRO PROF N NRO NO').split(' '));
  function locKey(loc, prov) {
    const l = norm(loc), p = norm(prov);
    if (/^(CAPITAL FEDERAL|CABA|C A B A|CIUDAD AUTONOMA( DE)? BUENOS AIRES|CIUDAD DE BUENOS AIRES)$/.test(l) ||
      (!l && /CIUDAD AUTONOMA|CAPITAL FEDERAL|CABA/.test(p))) return 'CABA';
    return l;
  }
  /* Clave de edificio (calle + altura + localidad) y de unidad (+ piso y depto).
     Las palabras de la calle se ordenan y se descartan tratamientos y tipos de via:
     "PERON, JUAN TTE.GRAL." y "TTE GRAL JUAN PERON" dan la misma clave. */
  function addrKeys(a) {
    if (!a) return null;
    const num = String(a.numero || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!num) return null;
    const words = norm(a.calle).split(' ').filter((w) => w && !STREET_STOP.has(w));
    if (!words.length) return null;
    const street = words.sort().join(' ');
    const loc = locKey(a.localidad, a.provincia);
    const bld = `${street}|${num}|${loc}`;
    const piso = norm(a.piso).replace(/^(PISO|P)\s*/, ''), dto = norm(a.depto).replace(/^(DTO|DEPTO|DPTO|OF|OFICINA|UF)\s*/, '');
    return { bld, unit: `${bld}|${piso}|${dto}`, hasUnit: !!(piso || dto) };
  }
  function fmtAddr(a) {
    if (!a) return '';
    const calle = tidy(a.calle);
    let s = [calle, a.numero].filter(Boolean).join(' ');
    const pd = [a.piso && `piso ${a.piso}`, a.depto && `depto ${a.depto}`].filter(Boolean).join(', ');
    if (pd) s += `, ${pd}`;
    const loc = [tidy(a.localidad), tidy(a.provincia)].filter(Boolean);
    if (loc.length === 2 && norm(loc[0]) === norm(loc[1])) loc.pop();
    if (loc.length) s += ` · ${loc.join(', ')}`;
    return s;
  }

  // Hash de 53 bits (cyrb53): cabe exacto en un double y se usa como clave de Map.
  function hash53(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // ── estadistica ─────────────────────────────────────────
  function quantileSorted(arr, q) {
    if (!arr.length) return NaN;
    const pos = (arr.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  }

  // ── guardar archivos (dialogo nativo en Electron, descarga en el navegador) ──
  async function saveText(filename, text, mime) {
    const blob = new Blob(['﻿' + text], { type: mime || 'text/csv;charset=utf-8' });
    if (global.rcDesktop) {
      const p = await global.rcDesktop.saveFile(filename, await blob.arrayBuffer());
      return p;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return filename;
  }
  const csvCell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  Object.assign(RC, {
    clamp, DAY, esc, debounce, tick, now, bus,
    norm, fold, tidy, own, orgLabel,
    cuitValid, fmtCuit, parseCuit, looksJuridica, personalName, nameTokens,
    parseDate, fmtDate, isoDate, yearOf, fmtAge, ptypeFromCode,
    parseAmount, currencyCode, RATES_DEFAULT, CROSS, usdRate, toUSD, toDisplay, rates,
    compact, money, moneyNative, unit, int, pct,
    addrKeys, fmtAddr, locKey, hash53, quantileSorted,
    saveText, csvCell,
    get settings() { return settings; }, DEFAULTS, setSettings
  });
})(window);
