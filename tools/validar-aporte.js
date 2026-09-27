/* Rastreador de Contrataciones · revision de un aporte de precios
   Uso: node tools/validar-aporte.js archivo.xlsx [otro.csv ...]

   Lee cada archivo con el mismo lector de la app y dice que entraria en la base:
   cuantos items, precios y equivalencias, y que hojas se rechazan. Sale con codigo 1
   si alguna hoja no se reconoce, trae datos de personas o no es de precios.
   El resumen sale en Markdown, para comentarlo en la propuesta de GitHub. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TIPOS = ['items', 'mercado', 'equivalencias'];

function loadApp() {
  globalThis.window = globalThis;
  const JS = path.join(ROOT, 'web', 'js');
  for (const f of ['core.js', 'reader.js', 'xlsx.js', 'model.js']) vm.runInThisContext(fs.readFileSync(path.join(JS, f), 'utf8'), { filename: f });
  return globalThis.RC;
}
async function asFile(p, name) {
  const b = await fs.openAsBlob(p);
  Object.defineProperty(b, 'name', { value: name });
  return b;
}
const n = (v) => Number(v || 0).toLocaleString('es-AR');

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Uso: node tools/validar-aporte.js archivo.xlsx [otro.csv ...]'); process.exit(2); }
  console.warn = () => {};
  const RC = loadApp();
  const lines = [], mal = [];
  for (const p of files) {
    const name = path.basename(p);
    if (!/\.(xlsx|csv)$/i.test(name)) { mal.push(name); lines.push(`- ✗ **${name}**: solo se aceptan planillas .xlsx o .csv.`); continue; }
    const hojas = [];
    const ui = {
      detected() {}, start() {}, progress() {},
      failed(src, e) { hojas.push({ nombre: src.name, error: e.message }); },
      done(src, st) { hojas.push({ nombre: src.name, st }); }
    };
    await RC.model.importFiles([await asFile(p, name)], ui, null, { base: true, solo: TIPOS });
    if (!hojas.length) hojas.push({ nombre: name, error: 'No tiene hojas con datos.' });
    for (const h of hojas) {
      if (h.error) { mal.push(h.nombre); lines.push(`- ✗ **${h.nombre}**: ${h.error}`); continue; }
      const st = h.st;
      const que = st.tipo === 'items' ? `${n(st.aceptados)} ítems comprados`
        : st.tipo === 'mercado' ? `${n(st.aceptados)} precios de mercado`
        : `${n(st.aceptados)} equivalencias`;
      const extra = [];
      if (st.humanas) extra.push(`${n(st.humanas)} con proveedores personas humanas (entran sin identidad)`);
      if (st.duplicados) extra.push(`${n(st.duplicados)} repetidos`);
      if (st.rows > st.aceptados + (st.duplicados || 0)) extra.push(`${n(st.rows - st.aceptados - (st.duplicados || 0))} filas sin datos suficientes`);
      if (!st.aceptados) mal.push(h.nombre);
      lines.push(`- ${st.aceptados ? '✓' : '✗'} **${h.nombre}**: ${que} de ${n(st.rows)} filas${extra.length ? ` · ${extra.join(' · ')}` : ''}.`);
    }
  }
  const DB = RC.model.DB, E = RC.xlsx.EJEMPLO;
  if (DB.items.some((t) => E.docs.includes(t.doc)) || DB.mkt.some((p) => p.codigo === E.codigo)) {
    mal.push('ejemplo');
    lines.push('- ✗ Quedaron las filas de ejemplo de la planilla modelo (datos inventados): hay que borrarlas y volver a adjuntar el archivo.');
  }
  console.log(mal.length ? '**El aporte tiene problemas.** No se sumó a la base.' : '**Aporte revisado.** Entra en la base en la próxima actualización (el 1 de cada mes).');
  console.log('');
  console.log(lines.join('\n'));
  console.log('');
  console.log(`En total: ${n(DB.items.length)} ítems, ${n(DB.obs.prod.length)} precios de ${n(DB.mkt.length)} productos y ${n(DB.eqv.size)} equivalencias.`);
  process.exit(mal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
