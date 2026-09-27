/* Rastreador de Contrataciones · actualizacion mensual de la base
   El 1 de cada mes GitHub arma la base con los datos oficiales y la publica en la
   pagina del proyecto. La app la baja una vez por mes: el dia 1 si esta abierta, o
   la primera vez que se abre despues. Solo el proceso principal se conecta, y solo a
   esa pagina; la interfaz sigue sin acceso a la red. */
const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PKG_DATA = path.join(__dirname, '..', 'web', 'data');
const dlDir = () => path.join(app.getPath('userData'), 'base');
const statePath = () => path.join(app.getPath('userData'), 'actualizacion.json');
const UA = 'RastreadorContrataciones (actualizacion mensual)';

// Pagina publicada: la que diga package.json (repository de GitHub) o RC_URL_DATOS para pruebas.
function pageUrl() {
  if (process.env.RC_URL_DATOS) return process.env.RC_URL_DATOS.replace(/\/?$/, '/');
  const pkg = require('../package.json');
  if (pkg.rastreador && pkg.rastreador.pagina) return pkg.rastreador.pagina.replace(/\/?$/, '/');
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
  const m = /github(?:\.com[/:]|:)([^/]+)\/([^/.#]+)/i.exec(repo || '');
  return m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : null;
}

// Lee `window.RC_BASE_META = {...};` sin ejecutar nada.
function parseMeta(txt) {
  const i = txt.indexOf('RC_BASE_META = ');
  if (i < 0) return null;
  try {
    const m = JSON.parse(txt.slice(i + 15).trim().replace(/;\s*$/, ''));
    return m && m.generado ? m : null;
  } catch (e) { return null; }
}
async function readMeta(dir) {
  try { return parseMeta(await fsp.readFile(path.join(dir, 'base-meta.js'), 'utf8')); } catch (e) { return null; }
}

// La base vigente es la mas nueva entre la que vino con la app y la descargada.
async function current() {
  const [pk, dl] = await Promise.all([readMeta(PKG_DATA), readMeta(dlDir())]);
  const dlOk = dl && fs.existsSync(path.join(dlDir(), 'base.js'));
  if (dlOk && (!pk || Date.parse(dl.generado) > Date.parse(pk.generado))) return { meta: dl, dir: dlDir(), descargada: true };
  return { meta: pk, dir: PKG_DATA, descargada: false };
}

/* Momento desde el que toca buscar la base del mes: el 1 a las 06:00 de Argentina
   (09:00 UTC). Antes de esa hora del dia 1 vale el corte del mes anterior. */
function cutoff(now) {
  now = now || new Date();
  let c = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9, 0, 0);
  if (now.getTime() < c) c = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 9, 0, 0);
  return c;
}

async function readState() { try { return JSON.parse(await fsp.readFile(statePath(), 'utf8')); } catch (e) { return {}; } }
async function writeState(s) { await fsp.mkdir(path.dirname(statePath()), { recursive: true }); await fsp.writeFile(statePath(), JSON.stringify(s, null, 1)); }

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', redirect: 'follow' });
  if (!r.ok) throw new Error(`La página respondió ${r.status}.`);
  return Buffer.from(await r.arrayBuffer());
}

/* Consulta la pagina y, si hay una base mas nueva que la vigente, la baja.
   Devuelve { estado: 'nueva' | 'al-dia' | 'sin-pagina' | 'error', meta, mensaje }. */
let running = null;
function check(opts) {
  if (!running) running = doCheck(opts || {}).finally(() => { running = null; });
  return running;
}
async function doCheck(opts) {
  const url = pageUrl();
  const st = await readState();
  st.ultimaConsulta = Date.now();
  if (!url) { await writeState(st); return { estado: 'sin-pagina', mensaje: 'La app no tiene configurada la página del proyecto.' }; }
  try {
    const remote = parseMeta((await get(`${url}data/base-meta.js?t=${Date.now()}`)).toString('utf8'));
    if (!remote) throw new Error('La página no publica una base válida.');
    const cur = await current();
    let nueva = false;
    if (!cur.meta || Date.parse(remote.generado) > Date.parse(cur.meta.generado)) {
      const base = await get(`${url}data/base.js?v=${encodeURIComponent(remote.generado)}`);
      // Verificacion minima: es la base anunciada y no una pagina de error.
      const head = base.subarray(0, 64000).toString('utf8');
      if (base.length < 100000 || !head.includes('window.RC_BASE = ') || !head.includes(`"generado":"${remote.generado}"`))
        throw new Error('La base descargada no coincide con la anunciada.');
      await fsp.mkdir(dlDir(), { recursive: true });
      await fsp.writeFile(path.join(dlDir(), 'base.js.parcial'), base);
      await fsp.rename(path.join(dlDir(), 'base.js.parcial'), path.join(dlDir(), 'base.js'));
      await fsp.writeFile(path.join(dlDir(), 'base-meta.js'), `window.RC_BASE_META = ${JSON.stringify(remote)};\n`);
      nueva = true;
    }
    // El mes queda cubierto solo si la pagina ya tiene la base de este mes: si GitHub
    // todavia no la armo (el dia 1 temprano), se vuelve a probar mas tarde.
    if (Date.parse(remote.generado) >= cutoff() - 36e5) st.ultimoExito = Date.now();
    st.ultimoError = null; st.corte = remote.corte;
    await writeState(st);
    return { estado: nueva ? 'nueva' : 'al-dia', meta: remote };
  } catch (e) {
    st.ultimoError = e.message;
    await writeState(st);
    return { estado: 'error', mensaje: e.message };
  }
}

async function due() {
  const st = await readState();
  return !(st.ultimoExito >= cutoff());
}

async function info() {
  const [cur, st] = await Promise.all([current(), readState()]);
  return { pagina: pageUrl(), meta: cur.meta, descargada: cur.descargada, estado: st };
}

module.exports = { check, due, current, info, cutoff, PKG_DATA };
