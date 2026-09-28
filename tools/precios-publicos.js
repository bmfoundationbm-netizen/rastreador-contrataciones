/* Rastreador de Contrataciones · precios de mercado publicos
   Convierte fuentes oficiales al formato de "precios de mercado" de la app
   (producto, unidad, precio, fecha, fuente, tipo, provincia, iva_incluido, rubro):

   - PAMI, listado de precios de medicamentos: precio de venta al publico de cada
     marca y presentacion. Se agrupa por droga, concentracion y forma (el producto
     generico) y cada marca queda como un precio de ese producto, por comprimido,
     capsula, ampolla, ml o g. Solo publica la lista vigente: la historia se arma
     guardando un resumen por mes en datos/mercado.
   - INDEC, precios promedio al consumidor: 59 productos de alimentos, limpieza e
     higiene en GBA desde 2016 y 14 de ellos en las otras cinco regiones desde 2017,
     en los CSV del Ministerio de Economia (series de tiempo). */
'use strict';
const fs = require('fs');

// ── utilidades ────────────────────────────────────────────
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const HEAD = ['producto', 'unidad', 'precio', 'fecha', 'fuente', 'tipo', 'provincia', 'iva_incluido', 'rubro'];
const line = (a) => a.map(q).join(',');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function readCsv(p, enc, sep) {
  const t = new TextDecoder(enc || 'utf-8').decode(fs.readFileSync(p)).replace(/^﻿/, '');
  return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep || ','));
}

// ── PAMI ──────────────────────────────────────────────────
/* Formas farmaceuticas de la columna PRESENTACION ("16 mg comp.x 30", "125 mg/5 ml
   jbe.x 60 ml"). El orden importa: las variantes van antes que la forma general.
   `u` es la unidad del precio: una unidad de la forma, o 1 ml / 1 g. */
const FORMAS = [
  [/comp\.?\s*(lib\.?\s*(prol|modif)|acc\.?\s*prol)/, 'comprimidos de liberación prolongada', 'comprimido'],
  [/c[aá]ps\.?\s*lib\.?\s*prol/, 'cápsulas de liberación prolongada', 'cápsula'],
  [/comp\.?\s*mast/, 'comprimidos masticables', 'comprimido'],
  [/comp\.?\s*subl/, 'comprimidos sublinguales', 'comprimido'],
  [/comp\.?\s*dispers/, 'comprimidos dispersables', 'comprimido'],
  [/comp\.?\s*eferv/, 'comprimidos efervescentes', 'comprimido'],
  [/\bcomp\b|comp\.|\bgrag|\btab\b|\btab\./, 'comprimidos', 'comprimido'],
  [/c[aá]ps/, 'cápsulas', 'cápsula'],
  [/jga\.?\s*prell/, 'jeringas prellenadas', 'jeringa prellenada'],
  [/iny\.?\s*f\.?\s*a\b|iny\.?\s*f\.?\s*a\.|(^|\s)f\.\s*a\./, 'frasco ampolla', 'frasco ampolla'],
  [/iny\.?\s*a\.|(^|\s)a\.$|\bamp\b|amp\./, 'ampollas', 'ampolla'],
  [/sol\.?\s*oft|gts\.?\s*oft|colirio/, 'colirio', 'ml'],
  [/susp\.?\s*oft/, 'suspensión oftálmica', 'ml'],
  [/jbe/, 'jarabe', 'ml'],
  [/susp/, 'suspensión oral', 'ml'],
  [/sol\.?\s*oral/, 'solución oral', 'ml'],
  [/\bgts\b|gts\./, 'gotas', 'ml'],
  [/(^|\s)cr\.|\bcrema\b/, 'crema', 'g'],
  [/\bung/, 'ungüento', 'g'],
  [/\bgel\b/, 'gel', 'g'],
  [/[oó]v\./, 'óvulos', 'óvulo'],
  [/\bsup\.|\bsup\b/, 'supositorios', 'supositorio'],
  [/parches?/, 'parches', 'parche'],
  [/\bsob\.|\bsobres\b/, 'sobres', 'sobre']
];
function parsePresentacion(pres) {
  const p = fold(pres).replace(/\s+/g, ' ').trim();
  // Envase al final: "x 30", "x 60 ml", "x 30 g". Lo que no tenga esa forma se saltea.
  const m = /^(.*?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|g)?\s*$/.exec(p);
  if (!m) return null;
  const head = m[1], n = parseFloat(m[2].replace(',', '.')), envU = m[3] || '';
  const f = FORMAS.find(([re]) => re.test(head));
  if (!f || !(n > 0)) return null;
  const [re, forma, u] = f;
  const at = head.search(re);
  // Concentracion: lo que va antes de la forma, si empieza con un numero ("16 mg", "125 mg/5 ml").
  const conc = head.slice(0, Math.max(0, at)).replace(/\b(ad|ped|iv|im|sc|oral)\.?\s*$/i, '').trim();
  if (!/^\d/.test(conc)) return null;
  if ((u === 'ml' || u === 'g') !== !!envU) return null;          // un jarabe x 60 ml, un comprimido x 30
  if (envU && envU !== u) return null;
  return { conc, forma, u, n };
}
function adaptarPami(src, dest) {
  const rows = readCsv(src, 'latin1', ';');
  const H = rows[0].map((h) => fold(h).trim());
  const col = (re) => H.findIndex((h) => re.test(h));
  const cDroga = col(/principio activo/), cMarca = col(/marca/), cPres = col(/presentacion/), cLab = col(/laboratorio/), cPvp = col(/^pvp/);
  if ([cDroga, cMarca, cPres, cPvp].some((c) => c < 0)) throw new Error('El listado de PAMI cambió de columnas');
  const fm = /(\d{2})\/(\d{2})\/(\d{4})/.exec(H[cPvp]);
  if (!fm) throw new Error('No encuentro la fecha de los precios en el encabezado de PAMI');
  const fecha = `${fm[3]}-${fm[2]}-${fm[1]}`;
  const out = [line(HEAD)], genericos = new Set();
  let salteadas = 0;
  for (const r of rows.slice(1)) {
    const droga = (r[cDroga] || '').trim(), pres = (r[cPres] || '').trim();
    const pvp = parseFloat(String(r[cPvp] || '').replace(/[^\d.]/g, ''));
    const pp = droga && pres && pvp > 0 ? parsePresentacion(pres) : null;
    if (!pp) { salteadas++; continue; }
    const producto = `${cap(droga)} ${pp.conc} ${pp.forma}`.replace(/\s+/g, ' ');
    const unidad = pp.u === 'ml' ? '1 ml' : pp.u === 'g' ? '1 g' : pp.u;
    genericos.add(producto + '|' + unidad);
    out.push(line([producto, unidad, (pvp / pp.n).toFixed(4), fecha,
      // El listado trae algunos acentos perdidos ("Bag¿"): el laboratorio va solo si llego entero.
      `PAMI, precio de venta al público: ${(r[cMarca] || '').replace(/¿/g, '').trim()}${cLab >= 0 && r[cLab] && !/¿/.test(r[cLab]) ? ` (${r[cLab].trim()})` : ''}`,
      'minorista', '', 'sí', 'Medicamentos']));
  }
  fs.writeFileSync(dest, out.join('\n') + '\n');
  return { fecha, precios: out.length - 1, productos: genericos.size, salteadas,
    nota: `${n(rows.length - 1)} presentaciones: ${n(out.length - 1)} precios de ${n(genericos.size)} productos genéricos (${n(salteadas)} sin forma o concentración reconocible)` };
}

// ── INDEC ─────────────────────────────────────────────────
/* Nombre y presentacion de cada serie de GBA, tomados del cuadro del INDEC "Precios al
   consumidor de una seleccion de productos" (sh_ipc_precios_promedio.xls). La clave es
   el nombre de la columna en el CSV del Ministerio de Economia. */
const INDEC_GBA = {
  pan_frances_flauta: ['Pan francés tipo flauta', 'kg'], pan_mesa: ['Pan de mesa', '390 g'],
  galletitas_dulces_envasadas: ['Galletitas dulces envasadas sin relleno', '150 g'], galletitas_agua_envasadas: ['Galletitas de agua envasadas', '250 g'],
  harina_trigo_comun: ['Harina de trigo común 000', 'kg'], arroz_blanco_simple: ['Arroz blanco simple', 'kg'], fideos_secos: ['Fideos secos tipo guisero', '500 g'],
  asado: ['Asado (carne)', 'kg'], carne_picada_comun: ['Carne picada común', 'kg'], paleta: ['Paleta (carne)', 'kg'], cuadril: ['Cuadril (carne)', 'kg'],
  nalga: ['Nalga (carne)', 'kg'], hamburguesas_congeladas: ['Hamburguesas congeladas', 'envase x 4 unidades'], pollo_entero: ['Pollo entero', 'kg'],
  filet_merluza_fresco: ['Filet de merluza fresco', 'kg'], salchicha_viena: ['Salchichas tipo viena', 'envase x 6 unidades'], jamon_cocido: ['Jamón cocido', 'kg'],
  salchichon: ['Salchichón', 'kg'], salame: ['Salame', 'kg'], aceite_girasol: ['Aceite de girasol', 'botella 1,5 l'],
  leche_fresca_entera_sachet: ['Leche fresca entera en sachet', 'litro'], leche_polvo_entera: ['Leche en polvo entera', '800 g'],
  queso_cremoso: ['Queso cremoso', 'kg'], queso_pate_grass: ['Queso pategrás', 'kg'], queso_sardo: ['Queso sardo', 'kg'], manteca: ['Manteca', '200 g'],
  yogur_firme: ['Yogur firme', '195 cc'], dulce_leche: ['Dulce de leche', '400 g'], huevos_gallina: ['Huevos de gallina', 'docena'],
  manzana_deliciosa: ['Manzana deliciosa', 'kg'], limon: ['Limón', 'kg'], naranja: ['Naranja', 'kg'], banana: ['Banana', 'kg'], batata: ['Batata', 'kg'],
  papa: ['Papa', 'kg'], cebolla: ['Cebolla', 'kg'], lechuga: ['Lechuga', 'kg'], tomate_redondo: ['Tomate redondo', 'kg'], zapallo: ['Zapallo anco', 'kg'],
  tomate_entero_conserva: ['Tomate entero en conserva', 'lata 230 g'], arvejas_secas_remojadas: ['Arvejas secas remojadas', 'lata 220 g'],
  azucar: ['Azúcar', 'kg'], sal_fina: ['Sal fina', '500 g'], polvo_flan: ['Polvo para flan', '8 porciones'], gaseosa_base_cola: ['Gaseosa base cola', '1,5 l'],
  agua_sin_gas: ['Agua sin gas', '1,5 l'], cerveza_botella: ['Cerveza en botella', 'litro'], vino_comun: ['Vino común', 'litro'],
  cafe_molido: ['Café molido', '500 g'], yerba_mate: ['Yerba mate', '500 g'], jabon_polvo_ropa: ['Jabón en polvo para ropa', '800 g'],
  detergente_liquido: ['Detergente líquido', '750 cc'], jabon_pan: ['Jabón en pan', '200 g'], lavandina: ['Lavandina', '1000 cc'], algodon: ['Algodón', '100 g'],
  champu: ['Champú', '400 cc'], jabon_tocador: ['Jabón de tocador', '125 g'], desodorante: ['Desodorante', '150 cc'],
  paniales_descartables: ['Pañales descartables', 'paquete x 10 unidades']
};
const REGIONES = { gba: 'GBA', pampeana: 'Pampeana', nea: 'Noreste', noa: 'Noroeste', cuyo: 'Cuyo', patagonia: 'Patagonia' };
const RUBRO = (name) => /jab[oó]n|detergente|lavandina|champ|desodorante|algod|pa[nñ]al/i.test(name) ? 'Limpieza e higiene' : 'Alimentos y bebidas';

// Tabla de series: { columna: [valores por fila] }, con la columna de fechas aparte.
function series(p) {
  const rows = readCsv(p);
  const H = rows[0].map((h) => h.trim());
  const t = rows.slice(1).map((r) => r[0]);
  const cols = {};
  H.forEach((h, j) => { if (j) cols[h] = rows.slice(1).map((r) => (r[j] === '' || r[j] == null ? NaN : parseFloat(r[j]))); });
  return { t, cols };
}
const cerca = (a, b) => isFinite(a) && isFinite(b) && Math.abs(a - b) < 0.011;
const pareceDe = (nombre, slug) => fold(nombre).replace(/\(.*\)/, '').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).every((w) => slug.includes(w));
// Producto de GBA que corresponde a una serie regional ("pan_frances_kg" -> pan frances tipo flauta).
function productoDe(slug) {
  const hits = Object.keys(INDEC_GBA).filter((k) => pareceDe(INDEC_GBA[k][0], slug));
  return hits.length === 1 ? hits[0] : null;
}

/* Valores de GBA por producto. Los CSV del Ministerio a veces rotulan mal una columna
   algunos meses (de enero a agosto de 2026, jabon de tocador y desodorante venian
   invertidos). Las series regionales traen el producto y la presentacion en el nombre y
   su serie de GBA repite los mismos valores: mes a mes, si el valor de un producto no
   coincide con su serie regional y el de otro producto si, se intercambian. */
function valoresGba(gba, reg) {
  const V = {};
  for (const c of Object.keys(gba.cols)) {
    const slug = c.replace(/^ipc_2016_/, '');
    if (INDEC_GBA[slug]) V[slug] = gba.cols[c].slice();
  }
  const fila = new Map(gba.t.map((t, i) => [t, i]));
  const arreglos = new Map();
  for (const rc of Object.keys(reg.cols).filter((c) => c.startsWith('gba_'))) {
    const e = productoDe(rc.slice(4));
    if (!e || !V[e]) continue;
    reg.cols[rc].forEach((y, j) => {
      const i = fila.get(reg.t[j]);
      if (i === undefined || !isFinite(y) || cerca(V[e][i], y)) return;
      const otros = Object.keys(V).filter((k) => k !== e && cerca(V[k][i], y));
      if (otros.length !== 1) return;
      const d = otros[0];
      [V[e][i], V[d][i]] = [V[d][i], V[e][i]];
      const k = `${INDEC_GBA[e][0]} y ${INDEC_GBA[d][0]}`;
      arreglos.set(k, (arreglos.get(k) || []).concat(gba.t[i].slice(0, 7)));
    });
  }
  const avisos = [...arreglos].map(([k, m]) => `${k} venían invertidos en ${m.length === 1 ? m[0] : `${m[0]} a ${m[m.length - 1]}`}: corregido con la serie regional`);
  return { V, avisos };
}
const fechaSerie = (t) => t.slice(0, 7) + '-15';            // precio promedio del mes: mitad de mes

function adaptarIndecGba(src, dest, regPath) {
  const gba = series(src), reg = regPath ? series(regPath) : { t: [], cols: {} };
  const { V, avisos } = valoresGba(gba, reg);
  if (!regPath) avisos.push('sin la serie regional no se pudo verificar el rótulo de cada columna');
  const out = [line(HEAD)], prods = new Set();
  for (const [slug, vals] of Object.entries(V)) {
    const [nombre, unidad] = INDEC_GBA[slug];
    vals.forEach((v, i) => {
      if (!(v > 0)) return;
      prods.add(nombre);
      out.push(line([nombre, unidad, v.toFixed(2), fechaSerie(gba.t[i]), 'INDEC, precio promedio al consumidor (GBA)', 'minorista', 'GBA', 'sí', RUBRO(nombre)]));
    });
  }
  fs.writeFileSync(dest, out.join('\n') + '\n');
  return { precios: out.length - 1, productos: prods.size, avisos,
    nota: `${n(out.length - 1)} precios mensuales de ${prods.size} productos${avisos.length ? ` · ${avisos.join('; ')}` : ''}` };
}
function adaptarIndecRegiones(src, dest) {
  const reg = series(src);
  const out = [line(HEAD)], prods = new Set(), sin = [];
  const slugs = new Set(Object.keys(reg.cols).map((c) => c.replace(/^[a-z]+_/, '')));
  for (const slug of slugs) {
    const e = productoDe(slug);
    if (!e) { sin.push(slug); continue; }
    const [nombre, unidad] = INDEC_GBA[e];
    for (const [key, region] of Object.entries(REGIONES)) {
      if (key === 'gba') continue;                        // GBA ya viene de la otra serie
      const v = reg.cols[`${key}_${slug}`];
      if (!v) continue;
      v.forEach((x, i) => {
        if (!(x > 0)) return;
        prods.add(nombre);
        out.push(line([nombre, unidad, x.toFixed(2), fechaSerie(reg.t[i]), `INDEC, precio promedio al consumidor (región ${region})`, 'minorista', region, 'sí', RUBRO(nombre)]));
      });
    }
  }
  fs.writeFileSync(dest, out.join('\n') + '\n');
  return { precios: out.length - 1, productos: prods.size,
    nota: `${n(out.length - 1)} precios mensuales de ${prods.size} productos en 5 regiones${sin.length ? ` · sin identificar: ${sin.join(', ')}` : ''}` };
}
const n = (v) => Number(v).toLocaleString('es-AR');

module.exports = { adaptarPami, adaptarIndecGba, adaptarIndecRegiones, parsePresentacion };
