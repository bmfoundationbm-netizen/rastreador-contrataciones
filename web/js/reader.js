/* ============================================================
   Rastreador de Contrataciones · lector
   Lectura en streaming de CSV, JSON/OCDS y ZIP sin cargar el
   archivo entero en memoria, y deteccion del tipo de archivo
   por sus encabezados.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  // ── ZIP: directorio central + DecompressionStream nativo ──
  // El registro de sociedades pesa ~120 MB comprimido y ~900 MB descomprimido:
  // se descomprime por tramos a medida que se parsea, nunca entero.
  async function zipEntries(file) {
    const size = file.size;
    const tailLen = Math.min(size, 65535 + 22 + 20);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('El ZIP está dañado: no tiene directorio central.');
    let count = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOff = tail.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
        const off = Number(tail.getBigUint64(loc + 8, true));
        const z = new DataView(await file.slice(off, off + 56).arrayBuffer());
        if (z.getUint32(0, true) === 0x06064b50) {
          count = Number(z.getBigUint64(32, true));
          cdSize = Number(z.getBigUint64(40, true));
          cdOff = Number(z.getBigUint64(48, true));
        }
      }
    }
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder('utf-8');
    const out = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true);
      let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      let loff = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      let q = p + 46 + nlen; const xend = q + xlen;
      while (q + 4 <= xend) {
        const id = cd.getUint16(q, true), sz = cd.getUint16(q + 2, true);
        if (id === 0x0001) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(r, true)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(r, true)); r += 8; }
          if (loff === 0xffffffff) { loff = Number(cd.getBigUint64(r, true)); }
        }
        q += 4 + sz;
      }
      p = xend + clen;
      if (name.endsWith('/') || /(^|\/)__MACOSX\//.test(name)) continue;
      out.push({ name, method, csize, usize, loff, encrypted: !!(flags & 1) });
    }
    return out;
  }

  async function zipEntryStream(file, e) {
    if (e.encrypted) throw new Error('El ZIP está protegido con contraseña.');
    const h = new DataView(await file.slice(e.loff, e.loff + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('El ZIP está dañado.');
    const start = e.loff + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const raw = file.slice(start, start + e.csize).stream();
    if (e.method === 0) return raw;
    if (e.method === 8) return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    throw new Error(`Compresión no soportada dentro del ZIP (método ${e.method}).`);
  }

  const DATA_EXT = /\.(csv|txt|tsv|json|jsonl|ndjson)$/i;

  /* Un archivo elegido puede contener varias fuentes (un ZIP con varios CSV).
     Cada fuente sabe abrirse como stream de bytes. */
  async function listSources(file) {
    if (/\.zip$/i.test(file.name)) {
      const entries = (await zipEntries(file)).filter((e) => DATA_EXT.test(e.name));
      if (!entries.length) throw new Error('El ZIP no contiene archivos CSV ni JSON.');
      return entries.map((e) => ({
        name: `${file.name} › ${e.name.split('/').pop()}`, size: e.usize, file,
        open: () => zipEntryStream(file, e)
      }));
    }
    return [{ name: file.name, size: file.size, file, open: async () => file.stream() }];
  }

  // ── texto: BOM, codificacion y decodificacion por tramos ──
  function pickDecoder(sample) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.min(sample.length, 1 << 20)), { stream: true });
      return new TextDecoder('utf-8');
    } catch (e) {
      // Los CSV exportados desde Excel en Windows suelen venir en Latin-1.
      return new TextDecoder('windows-1252');
    }
  }

  async function* textChunks(stream, onBytes) {
    const reader = stream.getReader();
    let dec = null, pending = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let bytes = value;
        if (onBytes) onBytes(bytes.byteLength);
        if (!dec) {
          // Junta al menos 4 bytes para reconocer el BOM.
          if (pending) { const m = new Uint8Array(pending.length + bytes.length); m.set(pending); m.set(bytes, pending.length); bytes = m; pending = null; }
          if (bytes.length < 4) { pending = bytes; continue; }
          if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bytes = bytes.subarray(3); dec = new TextDecoder('utf-8'); }
          else if (bytes[0] === 0xff && bytes[1] === 0xfe) { bytes = bytes.subarray(2); dec = new TextDecoder('utf-16le'); }
          else if (bytes[0] === 0xfe && bytes[1] === 0xff) { bytes = bytes.subarray(2); dec = new TextDecoder('utf-16be'); }
          else dec = pickDecoder(bytes);
        }
        const s = dec.decode(bytes, { stream: true });
        if (s) yield s;
      }
      if (!dec && pending) { dec = new TextDecoder('utf-8'); const s = dec.decode(pending, { stream: true }); if (s) yield s; }
      const tail = dec ? dec.decode() : '';
      if (tail) yield tail;
    } finally {
      try { reader.releaseLock(); } catch (e) { /* ya liberado */ }
    }
  }

  // ── CSV en streaming ────────────────────────────────────
  function detectDelimiter(line) {
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (!q && c in counts) counts[c]++;
    }
    let best = ',', n = -1;
    for (const k in counts) if (counts[k] > n) { n = counts[k]; best = k; }
    return best;
  }

  /* Parser incremental: recibe texto en tramos y emite filas completas.
     Lo que queda de una fila partida entre dos tramos se reprocesa con el siguiente. */
  function makeCSV(onRow) {
    let carry = '', D = -1;
    function parse(buf, final) {
      const n = buf.length;
      let i = 0, rowStart = 0, row = [];
      while (i < n) {
        let c = buf.charCodeAt(i), val;
        if (c === 34) {
          let j = i + 1, seg = j, parts = null;
          for (;;) {
            const qp = buf.indexOf('"', j);
            if (qp < 0) {
              if (!final) return rowStart;
              val = (parts ? parts.join('') : '') + buf.slice(seg); i = n; break;
            }
            if (qp + 1 >= n && !final) return rowStart;
            if (buf.charCodeAt(qp + 1) === 34) { (parts || (parts = [])).push(buf.slice(seg, qp + 1)); j = qp + 2; seg = j; continue; }
            val = parts ? parts.join('') + buf.slice(seg, qp) : buf.slice(seg, qp);
            i = qp + 1;
            // Texto suelto despues de la comilla de cierre: se descarta hasta el separador.
            while (i < n) { c = buf.charCodeAt(i); if (c === D || c === 10 || c === 13) break; i++; }
            if (i >= n && !final) return rowStart;
            break;
          }
        } else {
          let j = i;
          while (j < n) { c = buf.charCodeAt(j); if (c === D || c === 10 || c === 13) break; j++; }
          if (j >= n && !final) return rowStart;
          val = buf.slice(i, j); i = j;
        }
        row.push(val);
        if (i >= n) { onRow(row); row = []; rowStart = n; break; }
        c = buf.charCodeAt(i);
        if (c === D) {
          i++;
          if (i >= n) { if (!final) return rowStart; row.push(''); onRow(row); row = []; rowStart = n; }
          continue;
        }
        if (c === 13) { if (i + 1 >= n && !final) return rowStart; i++; if (buf.charCodeAt(i) === 10) i++; }
        else i++;
        onRow(row); row = []; rowStart = i;
      }
      return n;
    }
    return {
      get delimiter() { return D < 0 ? null : String.fromCharCode(D); },
      push(text) {
        let buf = carry ? carry + text : text;
        if (D < 0) {
          const nl = buf.search(/\r|\n/);
          if (nl < 0 && buf.length < 1 << 20) { carry = buf; return; }
          D = detectDelimiter(nl < 0 ? buf : buf.slice(0, nl)).charCodeAt(0);
        }
        const used = parse(buf, false);
        carry = used < buf.length ? buf.slice(used) : '';
      },
      end() {
        if (D < 0) D = detectDelimiter(carry.split(/\r|\n/)[0] || '').charCodeAt(0);
        if (carry) parse(carry, true);
        carry = '';
      }
    };
  }

  // ── encabezados y tipos de archivo ──────────────────────
  const normHeader = (h) => RC.fold(h).replace(/^﻿/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const PROCESO = ['numero_proceso', 'numero_procedimiento', 'procedimiento_numero', 'nro_proceso', 'nro_procedimiento',
    'idprocedimiento', 'id_procedimiento', 'procedimiento_id', 'proceso_de_seleccion_numero', 'numero_de_proceso',
    'expediente', 'nro_expediente', 'numero_expediente'];
  const FIELDS = {
    contratos: {
      proceso: PROCESO,
      safCode: ['nro_saf', 'numero_saf', 'saf_id', 'saf', 'codigo_saf', 'organismo_codigo_saf', 'nro_organismo', 'codigo_organismo'],
      org: ['descripcion_saf', 'saf_desc', 'organismo', 'organismo_nombre', 'organismo_contratante', 'nombre_organismo', 'descripcion_organismo',
        'jurisdiccion', 'entidad', 'reparticion', 'comprador', 'unidad_compradora', 'buyer_name'],
      uoc: ['descripcion_uoc', 'uoc_desc', 'uoc_descripcion', 'uoc_int', 'unidad_operativa', 'unidad_operativa_de_contrataciones', 'unidad_ejecutora', 'uoc'],
      ptype: ['tipo_de_procedimiento', 'tipo_procedimiento', 'procedimiento', 'tipo_de_contratacion', 'tipo_contratacion',
        'modalidad_de_contratacion', 'procedimiento_de_seleccion'],
      year: ['ejercicio', 'anio', 'ano', 'year'],
      date: ['fecha_de_adjudicacion', 'fecha_adjudicacion', 'isodatetime_fecha_acto', 'fecha_acto', 'fecha_de_perfeccionamiento_oc',
        'fecha_perfeccionamiento_oc', 'contrato_perfeccionamiento_fecha', 'fecha_orden_compra', 'fecha_de_orden_de_compra',
        'fecha_contrato', 'fecha_firma', 'fecha'],
      rubros: ['rubros', 'rubro', 'rubro_de_la_contratacion', 'rubro_contratacion', 'rubro_contratacion_desc', 'rubro_descripcion',
        'categoria', 'rubro_principal'],
      cuit: ['cuit', 'n_cuit', 'cuit_proveedor', 'cuit_nit', 'cuit_adjudicatario', 'nro_cuit', 'numero_cuit', 'cuit_cuil',
        'cuit_contratista', 'contratista_cuit'],
      supplier: ['descripcion_proveedor', 'denominacion', 'proveedor', 'razon_social', 'razon_social_proveedor', 'prov_razon_social',
        'adjudicatario', 'nombre_proveedor', 'proveedor_nombre', 'nombre_adjudicatario', 'contratista', 'contratista_razon_social'],
      doc: ['documento_contractual', 'orden_de_compra', 'nro_orden_compra', 'numero_orden_compra', 'nro_orden_de_compra',
        'numero_contrato', 'contrato_numero', 'nro_contrato', 'contrato'],
      dtype: ['tipo', 'tipo_documento_contractual', 'tipo_de_documento'],
      amount: ['monto', 'monto_adjudicacion', 'monto_adjudicado', 'importe', 'importe_adjudicado', 'monto_total',
        'monto_contrato', 'contrato_monto', 'monto_orden_compra', 'valor', 'total'],
      currency: ['moneda', 'divisa', 'currency', 'tipo_moneda', 'contrato_moneda'],
      objeto: ['objeto', 'objeto_del_proceso', 'objeto_de_la_contratacion', 'descripcion_objeto', 'nombre_del_proceso', 'nombre_obra'],
      // Solo para reconocer obra publica (CONTRAT.AR) y asignarle el rubro.
      obra: ['numero_obra', 'nombre_obra']
    },
    registro: {
      cuit: ['cuit', 'cuit_nit', 'n_cuit', 'cuit_entidad', 'nro_cuit', 'numero_cuit'],
      name: ['razon_social', 'denominacion', 'razon_social_entidad', 'nombre_entidad', 'entidad'],
      fconst: ['fecha_hora_contrato_social', 'fecha_contrato_social', 'fecha_de_contrato_social', 'fecha_constitucion',
        'fecha_de_constitucion', 'fecha_inscripcion_constitucion'],
      tipo: ['tipo_societario', 'descripcion_tipo_societario', 'tipo_de_sociedad', 'tipo_sociedad', 'forma_juridica',
        'tipo_de_personeria', 'tipo_personeria'],
      calle: ['dom_legal_calle', 'domicilio_legal_calle', 'calle_legal', 'calle'],
      numero: ['dom_legal_numero', 'domicilio_legal_numero', 'numero_legal', 'numero', 'altura'],
      piso: ['dom_legal_piso', 'domicilio_legal_piso', 'piso'],
      depto: ['dom_legal_departamento', 'domicilio_legal_departamento', 'departamento', 'depto', 'dpto'],
      localidad: ['dom_legal_localidad', 'domicilio_legal_localidad', 'localidad'],
      provincia: ['dom_legal_provincia', 'domicilio_legal_provincia', 'provincia'],
      cp: ['dom_legal_cp', 'domicilio_legal_cp', 'codigo_postal', 'cp'],
      estadoDom: ['dom_legal_estado_domicilio', 'estado_domicilio_legal'],
      actividad: ['actividad_descripcion', 'actividad_principal', 'descripcion_actividad'],
      actOrden: ['actividad_orden'],
      baja: ['dada_de_baja']
    },
    convocatorias: {
      proceso: PROCESO,
      objeto: ['objeto_del_proceso', 'objeto_del_procedimiento', 'procedimiento_objeto', 'objeto', 'xl_objeto',
        'nombre_del_proceso', 'nombre_del_procedimiento', 'procedimiento_nombre'],
      estimado: ['monto_estimado', 'presupuesto_oficial', 'presupuesto_oficial_monto', 'monto_presupuestado'],
      pub: ['fecha_de_publicacion', 'fecha_publicacion', 'isodate_fecha_publicacion', 'publicacion_contratar_fecha']
    },
    // Ofertas de cada proceso (CONTRAT.AR publica todas, no solo la ganadora).
    ofertas: {
      proceso: PROCESO,
      safCode: ['organismo_codigo_saf', 'nro_saf', 'saf'],
      org: ['organismo_nombre', 'organismo', 'descripcion_saf'],
      cuit: ['oferente_cuit', 'cuit_oferente', 'cuit'],
      supplier: ['oferente_razon_social', 'razon_social_oferente', 'razon_social'],
      amount: ['oferta_monto', 'monto_oferta', 'monto_ofertado'],
      rank: ['orden_merito', 'orden_de_merito'],
      renglon: ['renglon_numero', 'renglon'],
      out: ['desestimada_si_no']
    },
    // Presupuesto abierto (credito anual): organismo (SAF), ministerio, unidades ejecutoras.
    presupuesto: {
      year: ['ejercicio_presupuestario', 'impacto_presupuestario_anio', 'ejercicio'],
      saf: ['servicio_id'],
      safDesc: ['servicio_desc'],
      jur: ['jurisdiccion_desc'],
      sub: ['subjurisdiccion_desc'],
      ent: ['entidad_desc'],
      inciso: ['inciso_id'],
      ue: ['unidad_ejecutora_desc'],
      vig: ['credito_vigente'],
      dev: ['credito_devengado']
    }
  };
  // Columnas que delatan datos de personas: si el archivo no es de contratos o de
  // sociedades, se rechaza entero; si lo es, esas columnas nunca se leen.
  const PERSONAL = new Set(['dni', 'documento', 'nro_documento', 'numero_documento', 'numero_de_documento', 'tipo_documento',
    'apellido', 'apellidos', 'nombres', 'apellido_y_nombre', 'nombre_y_apellido', 'cargo', 'genero', 'sexo', 'fecha_nacimiento',
    'fecha_de_nacimiento', 'cuil', 'socio', 'socios', 'autoridad', 'autoridades', 'director', 'directores', 'integrante',
    'integrantes', 'nacionalidad', 'estado_civil', 'descripcion_cargo', 'tipo_cargo', 'fecha_cargo']);

  const KIND_LABEL = {
    contratos: 'Adjudicaciones / contratos', registro: 'Registro de sociedades', convocatorias: 'Convocatorias',
    ofertas: 'Ofertas', presupuesto: 'Presupuesto', ocds: 'Contrataciones OCDS',
    personas: 'Datos de personas', desconocido: 'Formato no reconocido'
  };

  function mapHeader(kind, header) {
    const H = header.map(normHeader);
    const spec = FIELDS[kind], map = {};
    for (const f in spec) {
      map[f] = -1;
      for (const syn of spec[f]) { const i = H.indexOf(syn); if (i >= 0) { map[f] = i; break; } }
    }
    return map;
  }

  function classify(header) {
    const H = header.map(normHeader);
    const personal = H.filter((h) => PERSONAL.has(h));
    const p = mapHeader('presupuesto', header);
    if (p.saf >= 0 && p.jur >= 0 && p.dev >= 0) return { kind: 'presupuesto', map: p, personal };
    const k = mapHeader('contratos', header);
    if (k.amount >= 0 && (k.cuit >= 0 || k.supplier >= 0) && (k.org >= 0 || k.safCode >= 0 || k.uoc >= 0))
      return { kind: 'contratos', map: k, personal };
    const o = mapHeader('ofertas', header);
    if (o.amount >= 0 && o.proceso >= 0 && (o.cuit >= 0 || o.supplier >= 0)) return { kind: 'ofertas', map: o, personal };
    const r = mapHeader('registro', header);
    const hasPeople = personal.some((h) => h !== 'documento');
    if (r.cuit >= 0 && r.name >= 0 && k.amount < 0) {
      if (hasPeople && r.fconst < 0 && r.tipo < 0) return { kind: 'personas', personal };
      return { kind: 'registro', map: r, personal };
    }
    const c = mapHeader('convocatorias', header);
    if (c.proceso >= 0 && (c.objeto >= 0 || c.estimado >= 0) && k.cuit < 0 && k.supplier < 0)
      return { kind: 'convocatorias', map: c, personal };
    if (personal.length) return { kind: 'personas', personal };
    return { kind: 'desconocido', personal };
  }

  // Lee solo el comienzo de una fuente para saber que es.
  async function sniff(src) {
    const stream = await src.open();
    let text = '';
    const it = textChunks(stream);
    for await (const s of it) { text += s; if (text.length > 1 << 16 || /\r|\n/.test(text.slice(0, 1 << 16)) && text.length > 4096) break; }
    try { await it.return(); } catch (e) { /* cerrado */ }
    try { await stream.cancel(); } catch (e) { /* ya cerrado */ }
    const head = text.replace(/^﻿/, '').trimStart();
    if (head[0] === '{' || head[0] === '[') {
      const firstLine = head.split(/\r?\n/)[0];
      const jsonl = /\.(jsonl|ndjson)$/i.test(src.name) || (head[0] === '{' && /\}\s*$/.test(firstLine) && /\r?\n\s*\{/.test(head));
      const ocds = /"(releases|records|ocid)"\s*:/.test(head);
      return { format: jsonl ? 'jsonl' : 'json', kind: ocds ? 'ocds' : 'json' };
    }
    let header = null;
    const csv = makeCSV((row) => { if (!header && !(row.length === 1 && !row[0])) header = row; });
    csv.push(text.slice(0, Math.max(text.search(/\r?\n/) + 2, 0) || text.length)); csv.end();
    if (!header) return { format: 'csv', kind: 'desconocido', header: [] };
    const cls = classify(header);
    return Object.assign({ format: 'csv', header }, cls);
  }

  /* Recorre una fuente entera. `sink` recibe:
       begin({kind, map, header}) -> false para abortar
       row(fields)                -> filas CSV o JSON plano (arreglo de strings)
       release(obj)               -> releases OCDS
     `onProgress(bytesLeidos)` se llama con frecuencia; el lector cede el hilo
     cada ~30 ms para que la interfaz siga respondiendo. */
  async function read(src, info, sink, onProgress, signal) {
    const stream = await src.open();
    let bytes = 0, last = RC.now();
    const onBytes = (n) => { bytes += n; };
    const breathe = async () => {
      if (RC.now() - last > 30) {
        if (onProgress) onProgress(bytes);
        await RC.tick(); last = RC.now();
        if (signal && signal.aborted) throw new DOMException('Importación cancelada', 'AbortError');
      }
    };

    if (info.format === 'csv') {
      let header = null, ok = true;
      const csv = makeCSV((row) => {
        if (!ok) return;
        if (!header) {
          if (row.length === 1 && !row[0]) return;
          header = row;
          ok = sink.begin({ header, kind: info.kind, map: info.map || classify(header).map }) !== false;
          return;
        }
        if (row.length === 1 && !row[0]) return;
        sink.row(row);
      });
      for await (const s of textChunks(stream, onBytes)) { csv.push(s); if (!ok) break; await breathe(); }
      csv.end();
      if (onProgress) onProgress(bytes);
      return { bytes };
    }

    if (info.format === 'jsonl') {
      let carry = '', started = false;
      const line = (l) => {
        l = l.trim(); if (!l) return;
        let o; try { o = JSON.parse(l); } catch (e) { return; }
        dispatchJSON(o, sink, () => started, (v) => { started = v; });
      };
      for await (const s of textChunks(stream, onBytes)) {
        const buf = carry + s; const parts = buf.split('\n'); carry = parts.pop();
        for (const l of parts) line(l);
        await breathe();
      }
      line(carry);
      if (onProgress) onProgress(bytes);
      return { bytes };
    }

    // JSON completo: los paquetes OCDS y los arreglos de registros planos.
    const chunks = [];
    for await (const s of textChunks(stream, onBytes)) { chunks.push(s); await breathe(); }
    let doc;
    try { doc = JSON.parse(chunks.join('')); } catch (e) { throw new Error('El JSON no se pudo leer: ' + e.message); }
    chunks.length = 0;
    let started = false;
    const items = Array.isArray(doc) ? doc
      : doc.releases ? doc.releases
      : doc.records ? doc.records.map((r) => r.compiledRelease || (r.releases && r.releases[r.releases.length - 1]) || r)
      : doc.result && Array.isArray(doc.result.records) ? doc.result.records
      : doc.data && Array.isArray(doc.data) ? doc.data
      : [doc];
    for (let i = 0; i < items.length; i++) {
      dispatchJSON(items[i], sink, () => started, (v) => { started = v; });
      if ((i & 1023) === 0) await breathe();
    }
    if (onProgress) onProgress(bytes);
    return { bytes };
  }

  // Un objeto JSON: release OCDS o registro plano (se convierte a fila).
  let flatKeys = null;
  function dispatchJSON(o, sink, isStarted, setStarted) {
    if (!o || typeof o !== 'object') return;
    if (o.ocid || o.awards || o.buyer || o.tender) {
      if (!isStarted()) { setStarted(true); if (sink.begin({ kind: 'ocds' }) === false) return; }
      sink.release(o);
      return;
    }
    if (!isStarted()) {
      flatKeys = Object.keys(o);
      const cls = classify(flatKeys);
      setStarted(true);
      if (sink.begin({ header: flatKeys, kind: cls.kind, map: cls.map, personal: cls.personal }) === false) return;
    }
    sink.row(flatKeys.map((k) => o[k] == null ? '' : typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k])));
  }

  RC.reader = { listSources, sniff, read, classify, mapHeader, normHeader, makeCSV, textChunks, FIELDS, KIND_LABEL, PERSONAL };
})(window);
