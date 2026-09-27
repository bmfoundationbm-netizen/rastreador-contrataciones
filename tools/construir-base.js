#!/usr/bin/env node
/* ============================================================
   Rastreador de Contrataciones · construir la base incluida
   Baja los datos publicos de contrataciones y presupuesto del
   Estado nacional, los procesa con el mismo importador de la
   app (web/js) y escribe web/data/base.js, que la app carga
   sola la primera vez que se abre.

   Uso:  npm run base                 usa lo ya bajado en datos/descargas
         npm run base -- --refrescar  vuelve a bajar todo

   Las URL se resuelven con la API de cada catalogo (CKAN), asi
   que el script sigue andando cuando publican archivos nuevos.
   La app en si nunca se conecta: esto es una herramienta aparte.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..');
const DL = path.join(ROOT, 'datos', 'descargas');
const OUT = path.join(ROOT, 'web', 'data');
const REFRESCAR = process.argv.includes('--refrescar');
const UA = 'RastreadorContrataciones/1.0 (datos abiertos; uso sin fines de lucro)';

const GOB = 'https://datos.gob.ar', JUS = 'https://datos.jus.gob.ar';
const COMPRAR = 'sistema-de-contrataciones-electronicas';
const CONTRATAR = 'procesos-de-contratacion-de-la-obra-publica-gestionados-en-la-plataforma-contratar';
const RNS = 'registro-nacional-de-sociedades';
const PRESUPUESTO = (y) => `https://dgsiaf-repo.mecon.gob.ar/repository/pa/datasets/${y}/credito-anual-${y}.zip`;

/* Fuentes en el orden en que se importan (el registro va al final: se cruza contra los
   proveedores y oferentes ya cargados). `complemento`: solo agrega documentos que no esten. */
const FUENTES = [
  { grupo: 'Presupuesto abierto (crédito anual)', anios: [2015, new Date().getFullYear()], presupuesto: true,
    catalogo: 'https://www.presupuestoabierto.gob.ar/sici/datos-abiertos' },
  { grupo: 'COMPR.AR · convocatorias', ckan: [GOB, COMPRAR, /^Convocatorias 2016 ?- ?20\d\d$/i] },
  { grupo: 'COMPR.AR · convocatorias (sistema anterior)', ckan: [GOB, COMPRAR, /^Convocatorias 20(15|16|17)( \(sistema legacy\))?$/i], varias: true, soloLegacy: true },
  { grupo: 'CONTRAT.AR · procedimientos de obra pública', ckan: [GOB, CONTRATAR, /^Procedimientos$/i] },
  { grupo: 'COMPR.AR · adjudicaciones', ckan: [GOB, COMPRAR, /^Adjudicaciones 2016 ?- ?20\d\d$/i] },
  // Los anuales 2016 y 2017 traen la unidad de compras en las columnas de SAF: solo desde 2018.
  { grupo: 'COMPR.AR · adjudicaciones por año (complemento)', ckan: [GOB, COMPRAR, /^Adjudicaciones\. Documentos Contractuales 20(1[89]|[2-9]\d)$/i], varias: true, complemento: true },
  { grupo: 'COMPR.AR · adjudicaciones (sistema anterior)', ckan: [GOB, COMPRAR, /^Adjudicaciones\. Documentos Contractuales 20\d\d \(sistema legacy\)$/i], varias: true },
  { grupo: 'CONTRAT.AR · contratos de obra pública', ckan: [GOB, CONTRATAR, /^Contratos$/i] },
  { grupo: 'CONTRAT.AR · ofertas de obra pública', ckan: [GOB, CONTRATAR, /^Ofertas$/i] },
  { grupo: 'COMPR.AR · SIPRO (proveedores)', ckan: [GOB, COMPRAR, /^SIPRO 2016 ?- ?20\d\d$/i] },
  { grupo: 'Registro Nacional de Sociedades', ckan: [JUS, RNS, /^Registro Nacional de Sociedades - +(20\d\d)$/i], ultimo: true },
  { grupo: 'Registro Nacional de Sociedades · asociaciones sin fines de lucro', ckan: [JUS, RNS, /^Registro Nacional de Sociedades - Asociaciones sin fines de lucro - (20\d\d)$/i], ultimo: true }
];

// ── utilidades ────────────────────────────────────────────
const log = (...a) => console.log(...a);
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function ckanResources(base, pkg) {
  const d = await getJSON(`${base}/api/3/action/package_show?id=${pkg}`);
  return { resources: d.result.resources, landing: `${base}/dataset/${pkg}` };
}
async function download(url, file) {
  const dest = path.join(DL, file);
  if (!REFRESCAR && fs.existsSync(dest) && fs.statSync(dest).size > 0) return { dest, cached: true, bytes: fs.statSync(dest).size };
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} al bajar ${url}`);
  const tmp = dest + '.parcial';
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return { dest, cached: false, bytes: fs.statSync(dest).size };
}
const fileName = (url) => decodeURIComponent(url.split('?')[0].split('/').pop());

// ── 1. resolver y bajar ───────────────────────────────────
async function resolve() {
  const cache = new Map();
  const items = [];
  for (const F of FUENTES) {
    if (F.presupuesto) {
      for (let y = F.anios[0]; y <= F.anios[1]; y++) items.push({ F, url: PRESUPUESTO(y), nombre: `Presupuesto abierto ${y}`, catalogo: F.catalogo, opcional: y === F.anios[1] });
      continue;
    }
    const [base, pkg, re] = F.ckan;
    const key = base + pkg;
    if (!cache.has(key)) cache.set(key, await ckanResources(base, pkg));
    const { resources, landing } = cache.get(key);
    let hits = resources.filter((r) => re.test((r.name || '').trim()) && /csv|zip/i.test(r.format || fileName(r.url)));
    if (F.soloLegacy) hits = hits.filter((r) => /legacy/i.test(r.name) || /2015/.test(r.name));
    if (F.ultimo) {
      hits.sort((a, b) => +(re.exec(b.name.trim())[1]) - +(re.exec(a.name.trim())[1]));
      hits = hits.slice(0, 1);
    }
    if (!hits.length) { log(`  ! sin recurso para "${F.grupo}"`); continue; }
    for (const r of hits) items.push({ F, url: r.url.replace(/^http:/, 'https:'), nombre: r.name.trim(), catalogo: landing });
  }
  return items;
}

// ── 2. cargar el importador de la app en Node ─────────────
function loadApp() {
  globalThis.window = globalThis;
  const JS = path.join(ROOT, 'web', 'js');
  for (const f of ['core.js', 'reader.js', 'model.js']) vm.runInThisContext(fs.readFileSync(path.join(JS, f), 'utf8'), { filename: f });
  return globalThis.RC;
}
async function asFile(p, name) {
  const b = await fs.openAsBlob(p);
  Object.defineProperty(b, 'name', { value: name });
  return b;
}

(async () => {
  fs.mkdirSync(DL, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  log('Resolviendo fuentes en los catálogos…');
  const items = await resolve();
  log(`${items.length} archivos.`);
  for (const it of items) {
    // El nombre local lleva el anio para no pisar archivos que se llaman igual en distintos anios.
    it.file = fileName(it.url);
    try {
      const d = await download(it.url, it.file);
      it.dest = d.dest; it.bytes = d.bytes;
      log(`  ${d.cached ? '·' : '↓'} ${it.nombre.padEnd(62)} ${mb(d.bytes)}`);
    } catch (e) {
      if (it.opcional) { log(`  - ${it.nombre}: todavía no publicado (${e.message})`); continue; }
      throw e;
    }
  }

  const RC = loadApp();
  const warn = console.warn; console.warn = () => {};        // sin IndexedDB en Node: el guardado se omite
  const fuentes = [];
  for (const it of items) {
    if (!it.dest) continue;
    const t = Date.now();
    let st = null, err = null;
    const ui = { detected() {}, start() {}, progress() {}, failed(_s, e) { err = e; }, done(_s, s) { st = s; } };
    await RC.model.importFiles([await asFile(it.dest, it.file)], ui, null, { complemento: !!it.F.complemento });
    const res = st ? resumen(st) : `error: ${err && err.message}`;
    log(`  ${err ? '✗' : '✓'} ${it.nombre.padEnd(62)} ${((Date.now() - t) / 1000).toFixed(1).padStart(5)} s  ${res}`);
    fuentes.push({ grupo: it.F.grupo, nombre: it.nombre, url: it.url, catalogo: it.catalogo, archivo: it.file, bytes: it.bytes,
      tipo: st ? st.tipo : null, resultado: res, error: err ? err.message : null });
  }
  console.warn = warn;

  const DB = RC.model.DB;
  const hoy = new Date().toISOString().slice(0, 10);
  const jurs = new Set(DB.orgs.filter((o) => o.jur && o.merged === undefined).map((o) => o.jur));
  const meta = {
    version: 1, corte: hoy, generado: new Date().toISOString(), publicacion: publicacion(),
    totales: {
      contratos: DB.ks.length, empresas: DB.cos.length, organismos: DB.orgs.filter((o) => o.merged === undefined).length,
      ministerios: jurs.size, ofertas: DB.bids.proc.length, presupuesto: DB.budget.size,
      personasOmitidas: DB.omit.org.length
    },
    fuentes
  };
  DB.base = meta;
  const snap = RC.model.snapshot();
  const json = JSON.stringify(snap, (_k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v);
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  const head = `/* Base incluida del Rastreador de Contrataciones (${hoy}). La genera tools/construir-base.js; no editar a mano. */\n`;
  fs.writeFileSync(path.join(OUT, 'base.js'), head + 'window.RC_BASE = ' + JSON.stringify({ meta, data: gz.toString('base64') }) + ';\n');
  fs.writeFileSync(path.join(OUT, 'base-meta.js'), head + 'window.RC_BASE_META = ' + JSON.stringify(meta) + ';\n');

  // En GitHub Actions se deja registro de cada actualizacion: ademas de servir de historial,
  // ese commit mensual evita que GitHub desactive la tarea programada por inactividad.
  if (process.env.GITHUB_ACTIONS) {
    const hist = path.join(ROOT, 'datos', 'historial.json');
    let h = [];
    try { h = JSON.parse(fs.readFileSync(hist, 'utf8')); } catch (e) { /* primera vez */ }
    h.push({ corte: meta.corte, generado: meta.generado, totales: meta.totales,
      errores: fuentes.filter((f) => f.error).map((f) => `${f.nombre}: ${f.error}`) });
    fs.writeFileSync(hist, JSON.stringify(h, null, 1) + '\n');
  }

  log('');
  log(`Base escrita: web/data/base.js (${mb(fs.statSync(path.join(OUT, 'base.js')).size)}; JSON sin comprimir ${mb(json.length)})`);
  log(`  ${meta.totales.contratos} contratos · ${meta.totales.empresas} empresas · ${meta.totales.organismos} organismos en ${meta.totales.ministerios} jurisdicciones`);
  log(`  ${meta.totales.ofertas} ofertas · ${meta.totales.presupuesto} organismo-años de presupuesto · ${meta.totales.personasOmitidas} contratos con personas humanas sin identidad`);
  log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  process.exit(0);
})().catch((e) => { console.error('\nNo se pudo construir la base:', e.message); process.exit(1); });

/* Donde se publica: la pagina de GitHub Pages y la descarga del programa para Windows.
   Sale de GITHUB_REPOSITORY (en GitHub Actions) o del campo "repository" de package.json. */
function publicacion() {
  let repo = process.env.RC_REPO || process.env.GITHUB_REPOSITORY || '';
  if (!repo) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
    const m = /github(?:\.com[/:]|:)([^/]+)\/([^/.#]+)/i.exec(r || '');
    if (m) repo = `${m[1]}/${m[2]}`;
  }
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  const gh = `https://github.com/${owner}/${name}`;
  return {
    pagina: `https://${owner.toLowerCase()}.github.io/${name}/`, repo: gh,
    portable: `${gh}/releases/latest/download/Rastreador-Contrataciones-portable.exe`,
    instalador: `${gh}/releases/latest/download/Rastreador-Contrataciones-instalador.exe`
  };
}

function resumen(st) {
  const n = (x) => x.toLocaleString('es-AR');
  if (st.tipo === 'presupuesto') return `${n(st.aceptados)} organismo-años`;
  if (st.tipo === 'registro') return `${n(st.sociedades)} sociedades, ${n(st.cruzadas)} de ${n(st.proveedores)} proveedores cruzados`;
  if (st.tipo === 'convocatorias') return `${n(st.aceptados)} procesos`;
  if (st.tipo === 'ofertas') return `${n(st.aceptados)} ofertas de sociedades (${n(st.humanas + st.sinMarcador)} de personas, sin guardar)`;
  return `${n(st.aceptados)} contratos, ${n(st.humanas + st.sinMarcador)} con personas (sin identidad)` + (st.duplicados ? `, ${n(st.duplicados)} ya estaban` : '');
}
