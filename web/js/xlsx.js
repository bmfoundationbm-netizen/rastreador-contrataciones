/* ============================================================
   Rastreador de Contrataciones · Excel
   Escribe .xlsx (varias hojas, encabezado fijo, fechas, montos y
   porcentajes con formato) sin librerias: un ZIP sin compresion
   con el XML minimo que Excel, LibreOffice y Google Sheets abren.
   La lectura de .xlsx esta en reader.js.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;
  const enc = new TextEncoder();

  // ── ZIP sin compresion ──────────────────────────────────
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function zipStore(files) {
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data), n = data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const cd = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cd, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ── libro ───────────────────────────────────────────────
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // Estilos: 0 normal, 1 encabezado, 2 fecha, 3 monto, 4 porcentaje, 5 entero.
  const STYLE = { text: 0, date: 2, money: 3, pct: 4, int: 5, num: 3 };
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/></patternFill></fill></fills>' +
    '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="6"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/></cellXfs></styleSheet>';

  function sheetXml(sh) {
    const cols = sh.cols;
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 16}" customWidth="1"/>`).join('') + '</cols><sheetData>';
    out += '<row r="1">' + cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${x(c.h)}</t></is></c>`).join('') + '</row>';
    sh.rows.forEach((row, ri) => {
      const r = ri + 2;
      out += `<row r="${r}">`;
      row.forEach((v, ci) => {
        if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) return;
        const type = (cols[ci] && cols[ci].type) || 'text', ref = colName(ci) + r;
        if (type === 'date' && typeof v === 'number') out += `<c r="${ref}" s="2"><v>${Math.floor((v - Date.UTC(1899, 11, 30)) / 864e5)}</v></c>`;
        else if (typeof v === 'number') out += `<c r="${ref}" s="${STYLE[type] || 3}"><v>${v}</v></c>`;
        else out += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
      });
      out += '</row>';
    });
    return out + '</sheetData></worksheet>';
  }

  /* sheets: [{ name, cols: [{ h, w, type: 'text'|'date'|'money'|'pct'|'int'|'num' }], rows: [[...]] }]
     Las fechas van como ms UTC; los porcentajes como fraccion (0,5 = 50 %). */
  function book(sheets) {
    const safe = sheets.map((s, i) => Object.assign({}, s, { name: String(s.name).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || `Hoja ${i + 1}` }));
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        safe.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        safe.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        safe.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    safe.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
    return zipStore(files);
  }

  // ── planillas modelo ────────────────────────────────────
  const d = (y, m, dd) => Date.UTC(y, m - 1, dd);
  function templateItems() {
    return book([
      { name: 'Ítems comprados', cols: [
        { h: 'orden_de_compra', w: 18 }, { h: 'proceso', w: 18 }, { h: 'organismo', w: 30 }, { h: 'cuit_proveedor', w: 16 },
        { h: 'proveedor', w: 28 }, { h: 'fecha', w: 12, type: 'date' }, { h: 'renglon', w: 9, type: 'int' },
        { h: 'descripcion', w: 48 }, { h: 'cantidad', w: 10, type: 'num' }, { h: 'unidad', w: 16 },
        { h: 'precio_unitario', w: 16, type: 'money' }, { h: 'moneda', w: 9 }, { h: 'iva_incluido', w: 12 },
        { h: 'marca', w: 16 }, { h: 'codigo', w: 16 }, { h: 'rubro', w: 18 }],
        rows: [
          ['46-1234-OC24', '46-0321-LPU24', 'Dirección Nacional de Vialidad', '30-00000108-9', 'Ejemplo Informática S.A.', d(2024, 5, 14), 1,
            'Notebook 15,6" Intel Core i5 8 GB RAM 256 GB SSD', 20, 'unidad', 1250000, 'ARS', 'sí', 'Marca X', '', 'Informática'],
          ['66-0456-OC25', '66-0102-CDI25', 'Hospital Nacional Ejemplo', '30-00000211-5', 'Ejemplo Farma S.R.L.', d(2025, 3, 3), 2,
            'Amoxicilina 500 mg comprimidos', 1600, 'caja x 16', 5200, 'ARS', 'sí', '', '7790000000001', 'Medicamentos']
        ] },
      { name: 'Instrucciones', cols: [{ h: 'Columna', w: 22 }, { h: 'Qué poner', w: 100 }], rows: [
        ['Filas de ejemplo', 'Las dos filas de la primera hoja son de ejemplo, con datos inventados: borralas antes de cargar la planilla.'],
        ['orden_de_compra', 'Número de la orden de compra o documento contractual (así se une con el contrato de COMPR.AR). Si no está, alcanza con el proceso.'],
        ['proceso', 'Número de proceso (por ejemplo 46-0321-LPU24).'],
        ['organismo / proveedor', 'Solo si no hay orden de compra ni proceso: la app los toma del contrato cuando puede unirlo.'],
        ['cuit_proveedor', 'CUIT de la empresa. Los CUIT de personas humanas (20, 23, 24, 27) se descartan: se guarda el precio sin identidad.'],
        ['fecha', 'Fecha de adjudicación u orden de compra (dd/mm/aaaa). Sirve para ajustar por inflación.'],
        ['descripcion', 'Lo más completa posible: producto, concentración o capacidad, presentación ("Amoxicilina 500 mg comprimidos").'],
        ['cantidad y unidad', 'Cantidad adjudicada y en qué unidad se contó ("unidad", "caja x 16", "litro", "resma").'],
        ['precio_unitario', 'Precio de una unidad de las contadas en "cantidad". Si solo tenés el total, poné la columna precio_total.'],
        ['iva_incluido', '"sí" o "no". En las compras del Estado suele estar incluido.'],
        ['codigo', 'Opcional: código de barras (EAN) o código del catálogo del Estado. Hace el emparejamiento exacto.'],
        ['Datos personales', 'No cargues nombres de personas, DNI ni datos de contacto.']
      ] }
    ]);
  }
  function templateMercado() {
    return book([
      { name: 'Precios de mercado', cols: [
        { h: 'producto', w: 48 }, { h: 'unidad', w: 16 }, { h: 'precio', w: 14, type: 'money' }, { h: 'fecha', w: 12, type: 'date' },
        { h: 'fuente', w: 26 }, { h: 'tipo', w: 12 }, { h: 'provincia', w: 18 }, { h: 'iva_incluido', w: 12 },
        { h: 'marca', w: 16 }, { h: 'codigo', w: 16 }, { h: 'rubro', w: 18 }],
        rows: [
          ['Notebook 15,6" Intel Core i5 8 GB RAM 256 GB SSD', 'unidad', 890000, d(2024, 5, 10), 'Lista de precios mayorista', 'mayorista', 'CABA', 'sí', 'Marca X', '', 'Informática'],
          ['Amoxicilina 500 mg comprimidos', 'caja x 16', 4100, d(2025, 3, 1), 'Farmacia (relevamiento)', 'minorista', 'Buenos Aires', 'sí', '', '7790000000001', 'Medicamentos']
        ] },
      { name: 'Instrucciones', cols: [{ h: 'Columna', w: 22 }, { h: 'Qué poner', w: 100 }], rows: [
        ['Filas de ejemplo', 'Las dos filas de la primera hoja son de ejemplo, con precios inventados: borralas antes de cargar la planilla.'],
        ['producto', 'Descripción del producto, lo más parecida posible a como figura en las compras.'],
        ['unidad', 'A qué corresponde el precio ("unidad", "caja x 16", "litro").'],
        ['precio', 'Precio de esa unidad, en pesos.'],
        ['fecha', 'Fecha del precio (dd/mm/aaaa). Sirve para ajustarlo por inflación a la fecha de cada compra.'],
        ['fuente', 'De dónde sale: comercio, lista de precios, cotización, sitio web. Sin nombres de personas.'],
        ['tipo', '"mayorista" o "minorista". Para compras grandes se compara con precios mayoristas.'],
        ['iva_incluido', '"sí" o "no".'],
        ['codigo', 'Opcional: código de barras (EAN).']
      ] }
    ]);
  }

  // Marcas de las filas de ejemplo, para avisar si quedaron en un aporte.
  const EJEMPLO = { docs: ['46-1234-OC24', '66-0456-OC25'], codigo: '7790000000001' };

  RC.xlsx = { book, zipStore, crc32, templateItems, templateMercado, EJEMPLO };
})(window);
