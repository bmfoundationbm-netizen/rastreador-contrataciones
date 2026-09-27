/* ============================================================
   Rastreador de Contrataciones · grafo 3D
   Organismos, empresas y contratos como nodos; simulacion de
   fuerzas con arbol octal (Barnes-Hut) y dibujo instanciado:
   tres llamadas de dibujo para los nodos, una para las aristas.

   Un organismo se une a sus contratos y cada contrato a su
   empresa. Si un par organismo-empresa tiene contratos que no
   entran en pantalla, se dibuja ademas una arista agregada.
   ============================================================ */
(function (global) {
  'use strict';
  const RC = global.RC;

  const COL = {
    // Paleta categorica validada (azul, naranja, aqua) para identidad; la forma del
    // nodo repite la informacion (icosaedro, esfera, octaedro).
    org: new THREE.Color('#3987e5'), co: new THREE.Color('#d95926'), k: new THREE.Color('#199e70'),
    dim: new THREE.Color('#1c1f26'), sel: new THREE.Color('#ffffff'),
    eOrgK: new THREE.Color('#1f4f86'), eKCo: new THREE.Color('#6e3417'), eAgg: new THREE.Color('#34373f'),
    eHi: new THREE.Color('#aab3c4'), eDim: new THREE.Color('#15171c')
  };
  const TYPE_NAME = { org: 'Organismo', co: 'Empresa', k: 'Contrato' };
  // Halo de lo senalado: color de estado segun la severidad de la alerta mas fuerte.
  const SEV_COL = {};
  const sevColor = (sev) => { const l = RC.alerts.level(sev); return SEV_COL[l.key] || (SEV_COL[l.key] = new THREE.Color(l.color)); };

  let canvas, wrap, labelsEl, tipEl, renderer, scene, camera, controls, ray;
  const meshes = {}, halo = {};
  let edgeGeo, edgeMesh, selMark;
  let nodes = [], links = [], springs = [], byKey = new Map();
  let alpha = 0, paused = false, dirty = true;
  let sel = null, hov = null, emph = null;     // emph: Set de indices de nodo resaltados
  let flagged = null, lastV = null, lastA = null;
  const pinned = new Map();                     // clave -> motivo; nodos que deben estar aunque no entren por monto
  let onSelect = () => {}, onHover = () => {};
  let fly = null, autoFrame = false;
  const mouse = new THREE.Vector2(), mouseScreen = { x: 0, y: 0 };
  let mouseMoved = false, downAt = null;
  let stats = { org: 0, co: 0, k: 0, totalK: 0, totalCo: 0 };
  let slotNodes = { org: [], co: [], k: [] };
  let haloSet = new Set();

  const key = (t, i) => `${t}:${i}`;

  // ── inicio ──────────────────────────────────────────────
  function init(container) {
    wrap = container;
    canvas = container.querySelector('canvas');
    labelsEl = container.querySelector('.labels');
    tipEl = container.querySelector('.tip');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x08090b, 0.0016);
    camera = new THREE.PerspectiveCamera(50, 1, 0.5, 8000);
    camera.position.set(0, 60, 420);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
    controls.addEventListener('start', () => { fly = null; autoFrame = false; });
    controls.addEventListener('change', () => { dirty = true; });
    ray = new THREE.Raycaster();

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.95));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75); d1.position.set(1, 1.4, 0.8); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x88aaff, 0.25); d2.position.set(-1, -0.6, -0.8); scene.add(d2);

    const geos = {
      org: new THREE.IcosahedronGeometry(1, 0),
      co: new THREE.IcosahedronGeometry(1, 2),
      k: new THREE.OctahedronGeometry(1, 0)
    };
    for (const t of ['org', 'co', 'k']) {
      meshes[t] = makeInstanced(geos[t], new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: t === 'co' ? 0.45 : 0.6, metalness: 0.08, flatShading: t !== 'co'
      }), 256);
      halo[t] = makeInstanced(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending
      }), 64);
      halo[t].raycast = () => {};
    }
    edgeGeo = new THREE.BufferGeometry();
    edgeMesh = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }));
    edgeMesh.frustumCulled = false; edgeMesh.raycast = () => {};
    scene.add(edgeMesh);
    selMark = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }));
    selMark.visible = false; selMark.raycast = () => {};
    scene.add(selMark);

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      mouseScreen.x = e.clientX - r.left; mouseScreen.y = e.clientY - r.top;
      mouseMoved = true;
    });
    canvas.addEventListener('pointerleave', () => { setHover(null); });
    canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5 || e.button !== 0) { downAt = null; return; }
      downAt = null;
      const n = pick();
      if (n) select({ t: n.t, i: n.i }, { from: 'graph' }); else select(null, { from: 'graph' });
    });
    canvas.addEventListener('dblclick', () => { const n = pick(); if (n) focusNode(n, true); });
    new ResizeObserver(resize).observe(wrap);
    resize();
    requestAnimationFrame(frame);
  }

  function makeInstanced(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    // En r128 setColorAt dimensiona el buffer de color con `count`: va antes de ponerlo en cero.
    m.setColorAt(0, COL.k);
    m.count = 0; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    return m;
  }
  function ensureCap(t, n) {
    const m = meshes[t];
    if (n <= m.instanceMatrix.count) return;
    let cap = m.instanceMatrix.count; while (cap < n) cap *= 2;
    scene.remove(m); m.dispose && m.dispose();
    meshes[t] = makeInstanced(m.geometry, m.material, cap);
  }
  function ensureHaloCap(t, n) {
    const m = halo[t];
    if (n <= m.instanceMatrix.count) return;
    let cap = m.instanceMatrix.count; while (cap < n) cap *= 2;
    scene.remove(m);
    halo[t] = makeInstanced(m.geometry, m.material, cap);
    halo[t].raycast = () => {};
  }

  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    dirty = true;
  }

  // ── construccion del grafo a partir de la vista ────────
  function build(V, A) {
    lastV = V; lastA = A;
    flagged = A ? A.flagged : null;
    const DB = RC.model.DB, K = DB.ks, S = RC.settings;
    const old = byKey;
    nodes = []; links = []; springs = []; byKey = new Map();

    const addNode = (t, i, val) => {
      const k = key(t, i);
      let n = byKey.get(k);
      if (n) return n;
      const p = old.get(k);
      n = { t, i, val, r: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, deg: 0, idx: nodes.length, fresh: !p };
      if (p) { n.x = p.x; n.y = p.y; n.z = p.z; }
      nodes.push(n); byKey.set(k, n);
      return n;
    };

    // Empresas: las de mayor monto, las senaladas y las fijadas por la seleccion.
    const coIdx = [];
    for (let c = 0; c < V.coN.length; c++) if (V.coN[c] > 0) coIdx.push(c);
    coIdx.sort((a, b) => V.coSum[b] - V.coSum[a]);
    const coSet = new Set(coIdx.slice(0, S.maxEmpresas));
    if (flagged) {
      // Las senaladas entran aparte, de mayor a menor severidad y con tope.
      const fc = [...flagged.co].filter(([c]) => V.coN[c] > 0 && !coSet.has(c)).sort((a, b) => b[1].sev - a[1].sev).slice(0, 150);
      for (const [c] of fc) coSet.add(c);
    }
    const pinK = new Set();
    for (const [pk] of pinned) {
      const [t, s] = pk.split(':'); const i = +s;
      if (t === 'co' && V.coN[i] > 0) coSet.add(i);
      if (t === 'k') { pinK.add(i); coSet.add(K[i].co); }
    }

    // Contratos: los de mayor monto entre las empresas visibles, mas los senalados y fijados.
    const cand = [];
    for (const i of V.idx) if (coSet.has(K[i].co)) cand.push(i);
    cand.sort((a, b) => V.disp[b] - V.disp[a]);
    const kSet = new Set(cand.slice(0, S.maxContratos));
    if (flagged) {
      const fk = [...flagged.k].filter(([i]) => coSet.has(K[i].co) && inView(V, i) && !kSet.has(i)).sort((a, b) => b[1].sev - a[1].sev).slice(0, 250);
      for (const [i] of fk) kSet.add(i);
    }
    for (const i of pinK) if (inView(V, i)) kSet.add(i);

    for (let o = 0; o < V.orgN.length; o++) if (V.orgN[o] > 0) addNode('org', o, V.orgSum[o] + V.omitSum[o]);
    for (const c of coSet) addNode('co', c, V.coSum[c]);
    const shownPair = new Map();
    for (const i of kSet) {
      const k = K[i];
      const nk = addNode('k', i, V.disp[i]);
      const no = byKey.get(key('org', k.org)), nc = byKey.get(key('co', k.co));
      if (no) link(no, nk, 16, 1, 'ok');
      if (nc) link(nk, nc, 7, 1, 'kc');
      const pk = k.org * 2097152 + k.co;
      shownPair.set(pk, (shownPair.get(pk) || 0) + 1);
    }
    for (const [pk, p] of V.pair) {
      if (!coSet.has(p.co)) continue;
      if ((shownPair.get(pk) || 0) >= p.n) continue;
      const no = byKey.get(key('org', p.org)), nc = byKey.get(key('co', p.co));
      if (no && nc) link(no, nc, 34, 0.5, 'agg');
    }

    // Los organismos de un mismo ministerio se atraen un poco (resorte invisible hacia
    // el mas grande del grupo): el grafo queda ordenado por ministerio sin dibujar nada extra.
    const byJur = new Map();
    for (const n of nodes) {
      if (n.t !== 'org') continue;
      const j = RC.model.DB.orgs[n.i].jur;
      if (!j) continue;
      (byJur.get(j) || byJur.set(j, []).get(j)).push(n);
    }
    for (const g of byJur.values()) {
      g.sort((a, b) => b.val - a.val);
      for (let q = 1; q < g.length; q++) springs.push({ a: g[0], b: g[q], len: 46, w: 0.08 });
    }

    // Tamanios: escala logaritmica dentro de cada tipo.
    for (const t of ['org', 'co', 'k']) {
      let lo = Infinity, hi = -Infinity;
      for (const n of nodes) if (n.t === t && n.val > 0) { const l = Math.log10(n.val); if (l < lo) lo = l; if (l > hi) hi = l; }
      const R = { org: [3.4, 9.5], co: [1.1, 3.8], k: [0.65, 1.9] }[t];
      for (const n of nodes) if (n.t === t) {
        const s = n.val > 0 && hi > lo ? (Math.log10(n.val) - lo) / (hi - lo) : 0.3;
        n.r = R[0] + (R[1] - R[0]) * s;
      }
    }

    // Posicion inicial de los nodos nuevos: cerca de un vecino ya ubicado, o en una esfera.
    const spread = 9 * Math.cbrt(Math.max(1, nodes.length));
    let placed = 0;
    for (const n of nodes) {
      if (!n.fresh) { placed++; continue; }
      const nb = n.links && n.links.find((l) => !(l.a === n ? l.b : l.a).fresh);
      const m = nb ? (nb.a === n ? nb.b : nb.a) : null;
      const rr = m ? 8 + Math.random() * 10 : spread * Math.cbrt(Math.random());
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      n.x = (m ? m.x : 0) + rr * Math.sin(ph) * Math.cos(th);
      n.y = (m ? m.y : 0) + rr * Math.cos(ph) * 0.8;
      n.z = (m ? m.z : 0) + rr * Math.sin(ph) * Math.sin(th);
    }
    alpha = placed > nodes.length * 0.7 ? 0.35 : 1;

    stats = {
      org: nodes.filter((n) => n.t === 'org').length, co: coSet.size, k: kSet.size,
      totalK: V.idx.length, totalCo: coIdx.length
    };
    for (const t of ['org', 'co', 'k']) { ensureCap(t, stats[t] + 1); ensureHaloCap(t, stats[t] + 1); }
    if (sel && !byKey.has(key(sel.t, sel.i))) sel = null;
    // Halo solo para los 80 nodos senalados de mayor severidad: con cientos de alertas,
    // un halo por nodo vuelve ilegible el grafo.
    haloSet = new Set(nodes.filter((n) => flagOf(n)).sort((a, b) => flagOf(b).sev - flagOf(a).sev).slice(0, 80).map((n) => n.idx));
    computeEmphasis();
    writeEdges(true);
    paint();
    if (!old.size || placed === 0) { setTimeout(() => reframe(false), 600); autoFrame = true; }
    dirty = true;
    return stats;
  }
  const inView = (V, i) => V.has[i] === 1;
  function link(a, b, len, w, kind) {
    const l = { a, b, len, w, kind };
    links.push(l); a.deg++; b.deg++;
    (a.links || (a.links = [])).push(l); (b.links || (b.links = [])).push(l);
  }

  // ── simulacion ──────────────────────────────────────────
  function simulate(budget) {
    if (paused || alpha < 0.004) return false;
    const t0 = RC.now();
    let ticks = 0;
    while (RC.now() - t0 < budget && alpha >= 0.004) { step(); ticks++; }
    return ticks > 0;
  }

  function step() {
    const N = nodes.length;
    if (!N) return;
    // 1. repulsion con arbol octal
    const root = buildTree();
    const theta2 = 0.81;
    for (const n of nodes) applyCharge(n, root, theta2);
    // 2. resortes
    for (const l of links) {
      const a = l.a, b = l.b;
      let x = b.x + b.vx - a.x - a.vx, y = b.y + b.vy - a.y - a.vy, z = b.z + b.vz - a.z - a.vz;
      let d = Math.sqrt(x * x + y * y + z * z) || 1e-3;
      const s = l.w / Math.min(a.deg, b.deg);
      const f = (d - l.len - a.r - b.r) / d * alpha * s;
      x *= f; y *= f; z *= f;
      const bias = a.deg / (a.deg + b.deg);
      b.vx -= x * bias; b.vy -= y * bias; b.vz -= z * bias;
      a.vx += x * (1 - bias); a.vy += y * (1 - bias); a.vz += z * (1 - bias);
    }
    for (const l of springs) {
      const a = l.a, b = l.b;
      let x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
      const d = Math.sqrt(x * x + y * y + z * z) || 1e-3;
      const f = (d - l.len) / d * alpha * l.w * 0.5;
      x *= f; y *= f; z *= f;
      b.vx -= x; b.vy -= y; b.vz -= z; a.vx += x; a.vy += y; a.vz += z;
    }
    // 3. gravedad suave hacia el centro (mantiene juntas las componentes sueltas)
    const g = 0.03 * alpha;
    for (const n of nodes) {
      n.vx -= n.x * g; n.vy -= n.y * g * 1.4; n.vz -= n.z * g;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
      n.vx *= 0.58; n.vy *= 0.58; n.vz *= 0.58;
    }
    alpha += (0 - alpha) * 0.0228;
    dirty = true;
  }

  function buildTree() {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
      if (n.z < minZ) minZ = n.z; if (n.z > maxZ) maxZ = n.z;
    }
    const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 1;
    const root = cell((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, half);
    for (const n of nodes) insert(root, n, 0);
    summarize(root);
    return root;
  }
  function cell(cx, cy, cz, h) { return { cx, cy, cz, h, m: 0, x: 0, y: 0, z: 0, kids: null, body: null }; }
  function insert(c, n, depth) {
    if (!c.kids && !c.body) { c.body = n; return; }
    if (!c.kids) {
      if (depth > 24) { (c.extra || (c.extra = [])).push(n); return; }
      c.kids = new Array(8);
      const b = c.body; c.body = null;
      insertKid(c, b, depth);
    }
    insertKid(c, n, depth);
  }
  function insertKid(c, n, depth) {
    const o = (n.x > c.cx ? 1 : 0) | (n.y > c.cy ? 2 : 0) | (n.z > c.cz ? 4 : 0);
    let k = c.kids[o];
    if (!k) { const h = c.h / 2; k = c.kids[o] = cell(c.cx + (o & 1 ? h : -h), c.cy + (o & 2 ? h : -h), c.cz + (o & 4 ? h : -h), h); }
    insert(k, n, depth + 1);
  }
  const charge = (n) => -(n.t === 'org' ? 180 : n.t === 'co' ? 30 : 8) * (0.6 + n.r * 0.25);
  function summarize(c) {
    let m = 0, x = 0, y = 0, z = 0;
    const acc = (n) => { const q = charge(n); m += q; x += n.x * q; y += n.y * q; z += n.z * q; };
    if (c.body) acc(c.body);
    if (c.extra) c.extra.forEach(acc);
    if (c.kids) for (const k of c.kids) if (k) { summarize(k); m += k.m; x += k.x * k.m; y += k.y * k.m; z += k.z * k.m; }
    c.m = m;
    if (m) { c.x = x / m; c.y = y / m; c.z = z / m; }
  }
  function applyCharge(n, c, theta2) {
    if (!c.m) return;
    let dx = c.x - n.x, dy = c.y - n.y, dz = c.z - n.z;
    let d2 = dx * dx + dy * dy + dz * dz;
    const w = c.h * 2;
    if (c.kids && (w * w) / (d2 || 1e-6) >= theta2) {
      for (const k of c.kids) if (k) applyCharge(n, k, theta2);
      if (c.extra) for (const b of c.extra) if (b !== n) pointForce(n, b.x - n.x, b.y - n.y, b.z - n.z, charge(b));
      return;
    }
    if (c.body === n && !c.extra) return;
    if (c.body && !c.kids) {
      if (c.body !== n) pointForce(n, dx, dy, dz, charge(c.body));
      if (c.extra) for (const b of c.extra) if (b !== n) pointForce(n, b.x - n.x, b.y - n.y, b.z - n.z, charge(b));
      return;
    }
    pointForce(n, dx, dy, dz, c.m);
  }
  function pointForce(n, dx, dy, dz, q) {
    let d2 = dx * dx + dy * dy + dz * dz;
    if (d2 === 0) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; dz = (Math.random() - 0.5) * 1e-3; d2 = 1e-6; }
    if (d2 > 640000) return;
    if (d2 < 4) d2 = 4;
    // Cuadrado inverso (3D): la repulsion es local y la nube queda de ~cbrt(Q/g) de radio.
    const f = q * alpha / (d2 * Math.sqrt(d2));
    n.vx += dx * f; n.vy += dy * f; n.vz += dz * f;
  }

  // ── pintura ─────────────────────────────────────────────
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
  function paint() {
    const cnt = { org: 0, co: 0, k: 0 }, hcnt = { org: 0, co: 0, k: 0 };
    slotNodes = { org: [], co: [], k: [] };
    for (const n of nodes) {
      const m = meshes[n.t];
      n.slot = cnt[n.t]++;
      slotNodes[n.t][n.slot] = n;
      const off = emph && !emph.has(n.idx);
      // Lo que queda fuera del resaltado se achica y se apaga: asi no tapa lo que importa.
      tmpP.set(n.x, n.y, n.z); tmpS.setScalar(off ? n.r * 0.4 : n.r);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(n.slot, tmpM);
      const fl = haloSet.has(n.idx) || (emph && !off) ? flagOf(n) : null;
      tmpC.copy(COL[n.t]);
      if (off) tmpC.lerp(COL.dim, 0.86);
      m.setColorAt(n.slot, tmpC);
      if (fl && !off) {
        const h = halo[n.t];
        tmpS.setScalar(n.r * (1.55 + 0.9 * fl.sev));
        tmpM.compose(tmpP, tmpQ, tmpS);
        h.setMatrixAt(hcnt[n.t], tmpM);
        h.setColorAt(hcnt[n.t], sevColor(fl.sev));
        hcnt[n.t]++;
      }
    }
    for (const t of ['org', 'co', 'k']) {
      const m = meshes[t]; m.count = cnt[t]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      const h = halo[t]; h.count = hcnt[t]; h.instanceMatrix.needsUpdate = true; if (h.instanceColor) h.instanceColor.needsUpdate = true;
    }
    const s = sel && byKey.get(key(sel.t, sel.i));
    selMark.visible = !!s;
    if (s) { selMark.position.set(s.x, s.y, s.z); selMark.scale.setScalar(s.r * 1.9 + 0.8); }
  }
  function flagOf(n) {
    if (!flagged) return null;
    return n.t === 'co' ? flagged.co.get(n.i) : n.t === 'k' ? flagged.k.get(n.i) : flagged.org.get(n.i);
  }

  function writeEdges(colors) {
    const L = links.length;
    let pos = edgeGeo.getAttribute('position');
    if (!pos || pos.count < L * 2) {
      const cap = Math.max(64, L * 2);
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      edgeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      pos = edgeGeo.getAttribute('position'); colors = true;
    }
    const P = pos.array;
    for (let j = 0; j < L; j++) {
      const l = links[j], o = j * 6;
      P[o] = l.a.x; P[o + 1] = l.a.y; P[o + 2] = l.a.z; P[o + 3] = l.b.x; P[o + 4] = l.b.y; P[o + 5] = l.b.z;
    }
    pos.needsUpdate = true;
    if (colors) {
      const C = edgeGeo.getAttribute('color').array;
      for (let j = 0; j < L; j++) {
        const l = links[j], o = j * 6;
        let c = l.kind === 'ok' ? COL.eOrgK : l.kind === 'kc' ? COL.eKCo : COL.eAgg;
        if (emph) c = emph.has(l.a.idx) && emph.has(l.b.idx) ? COL.eHi : COL.eDim;
        C[o] = C[o + 3] = c.r; C[o + 1] = C[o + 4] = c.g; C[o + 2] = C[o + 5] = c.b;
      }
      edgeGeo.getAttribute('color').needsUpdate = true;
    }
    edgeGeo.setDrawRange(0, L * 2);
  }

  // ── seleccion y resaltado ───────────────────────────────
  let emphRefs = null;   // resaltado pedido desde afuera (alerta)
  function computeEmphasis() {
    emph = null;
    if (emphRefs) {
      emph = new Set();
      for (const t of ['org', 'co', 'k']) for (const i of emphRefs[t] || []) { const n = byKey.get(key(t, i)); if (n) emph.add(n.idx); }
      if (!emph.size) emph = null;
      return;
    }
    const s = sel && byKey.get(key(sel.t, sel.i));
    if (!s) return;
    emph = new Set([s.idx]);
    for (const l of s.links || []) {
      const m = l.a === s ? l.b : l.a;
      emph.add(m.idx);
      if (m.t === 'k') for (const l2 of m.links || []) emph.add((l2.a === m ? l2.b : l2.a).idx);
    }
  }
  function select(ref, opts) {
    opts = opts || {};
    emphRefs = opts.emphasis || null;
    sel = ref;
    if (ref && !byKey.has(key(ref.t, ref.i)) && lastV) {
      // No estaba en pantalla (fuera del recorte por monto): se fija y se reconstruye.
      pin(ref);
      build(lastV, lastA);
    }
    computeEmphasis(); writeEdges(true); paint(); dirty = true;
    const n = ref && byKey.get(key(ref.t, ref.i));
    if (opts.focus) { if (emph && emph.size > 1) focusSet(emph); else if (n) focusNode(n, false); }
    onSelect(ref, opts);
  }
  function pin(ref) {
    const DB = RC.model.DB;
    pinned.set(key(ref.t, ref.i), 1);
    if (ref.t === 'co' && lastV) {
      // La empresa trae sus contratos mas grandes.
      const ks = lastV.idx.filter((i) => DB.ks[i].co === ref.i).sort((a, b) => lastV.disp[b] - lastV.disp[a]).slice(0, 80);
      for (const i of ks) pinned.set(key('k', i), 1);
    }
    if (pinned.size > 1200) { const first = pinned.keys().next().value; pinned.delete(first); }
  }
  function pinMany(refs) { for (const r of refs) pin(r); if (lastV) build(lastV, lastA); }
  function clearPins() { pinned.clear(); }

  function setHover(n) {
    if (hov === n) return;
    hov = n; dirty = true;
    canvas.style.cursor = n ? 'pointer' : '';
    if (!n) { tipEl.hidden = true; onHover(null); return; }
    onHover({ t: n.t, i: n.i });
  }
  function pick() {
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects([meshes.org, meshes.co, meshes.k], false);
    for (const h of hits) {
      const t = h.object === meshes.org ? 'org' : h.object === meshes.co ? 'co' : 'k';
      const n = slotNodes[t][h.instanceId];
      if (n) return n;
    }
    return null;
  }

  // ── camara ──────────────────────────────────────────────
  function focusNode(n, close) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = close ? Math.max(28, n.r * 12) : Math.max(70, Math.min(260, camera.position.distanceTo(controls.target)));
    fly = { t0: RC.now(), dur: 650, fromT: controls.target.clone(), toT: new THREE.Vector3(n.x, n.y, n.z),
      fromP: camera.position.clone(), toP: new THREE.Vector3(n.x, n.y, n.z).add(dir.multiplyScalar(dist)) };
  }
  // Encuadra un conjunto de nodos (el vecindario resaltado).
  function focusSet(set) {
    const ns = nodes.filter((n) => set.has(n.idx));
    let cx = 0, cy = 0, cz = 0;
    for (const n of ns) { cx += n.x; cy += n.y; cz += n.z; }
    cx /= ns.length; cy /= ns.length; cz /= ns.length;
    const ds = ns.map((n) => Math.hypot(n.x - cx, n.y - cy, n.z - cz) + n.r).sort((a, b) => a - b);
    const r = Math.max(14, ds[Math.floor(ds.length * 0.9)] || 14);
    const dist = r / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.15;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const toT = new THREE.Vector3(cx, cy, cz);
    fly = { t0: RC.now(), dur: 700, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(dir.multiplyScalar(dist)) };
    autoFrame = false;
  }
  function reframe(animated) {
    if (!nodes.length) return;
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; cz += n.z; }
    cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
    const ds = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy, n.z - cz)).sort((a, b) => a - b);
    const r = Math.max(40, ds[Math.floor(ds.length * 0.92)] || 40);
    const dist = r / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.05;
    // Niebla proporcional al tamanio: el lado lejano se apaga a la mitad, el cercano casi nada.
    scene.fog.density = 0.24 / r;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const toT = new THREE.Vector3(cx, cy, cz), toP = toT.clone().add(dir.multiplyScalar(dist));
    if (animated === false) { controls.target.copy(toT); camera.position.copy(toP); dirty = true; return; }
    fly = { t0: RC.now(), dur: 700, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP };
  }

  // ── etiquetas ───────────────────────────────────────────
  const labelPool = [];
  // Mientras se reemplazan los datos (vaciar y cargar la base) el grafo todavia tiene
  // nodos de los datos anteriores: sin entidad, sin rotulo.
  function labelText(n) {
    const DB = RC.model.DB;
    if (n.t === 'org') { const o = DB.orgs[n.i]; return o ? o.name : ''; }
    if (n.t === 'co') { const c = DB.cos[n.i]; return c ? c.label : ''; }
    const k = DB.ks[n.i]; return k ? k.doc || k.proc || 'Contrato' : '';
  }
  function updateLabels() {
    if (!RC.settings.etiquetas) { for (const el of labelPool) el.hidden = true; return; }
    const want = [];
    const seen = new Set();
    const push = (n, cls) => { if (n && !seen.has(n.idx)) { seen.add(n.idx); want.push([n, cls]); } };
    const s = sel && byKey.get(key(sel.t, sel.i));
    push(s, 'sel'); push(hov, 'hov');
    if (emph) {
      const e = nodes.filter((n) => emph.has(n.idx) && n.t !== 'k').sort((a, b) => b.r - a.r).slice(0, 16);
      for (const n of e) push(n, 'nb');
    }
    const orgs = nodes.filter((n) => n.t === 'org' && (!emph || emph.has(n.idx))).sort((a, b) => b.val - a.val).slice(0, emph ? 6 : 14);
    for (const n of orgs) push(n, 'org');
    if (!emph && flagged) {
      const f = nodes.filter((n) => n.t === 'co' && flagged.co.has(n.i)).sort((a, b) => flagged.co.get(b.i).sev - flagged.co.get(a.i).sev).slice(0, 8);
      for (const n of f) push(n, 'flag');
    }
    const w = wrap.clientWidth, h = wrap.clientHeight;
    while (labelPool.length < want.length) { const el = document.createElement('div'); el.className = 'lbl'; labelsEl.appendChild(el); labelPool.push(el); }
    let j = 0;
    const placed = [];
    for (const [n, cls] of want) {
      tmpP.set(n.x, n.y + n.r * 1.25, n.z).project(camera);
      if (tmpP.z > 1 || tmpP.z < -1) continue;
      const x = (tmpP.x * 0.5 + 0.5) * w, y = (-tmpP.y * 0.5 + 0.5) * h;
      if (x < -60 || x > w + 60 || y < -20 || y > h + 20) continue;
      const full = labelText(n);
      if (!full) continue;
      const txt = full.length > 46 ? full.slice(0, 44) + '…' : full;
      // Rotulos por prioridad: uno que se encima con otro ya puesto se omite
      // (el seleccionado y el senalado por el mouse siempre van).
      const bw = txt.length * 6.1 + 12, box = [x - bw / 2, y - 17, x + bw / 2, y];
      if (cls !== 'sel' && cls !== 'hov' && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      const el = labelPool[j++];
      el.hidden = false;
      el.className = `lbl ${n.t} ${cls}`;
      if (el._t !== txt) { el.textContent = txt; el._t = txt; }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (; j < labelPool.length; j++) labelPool[j].hidden = true;
  }
  function updateTip() {
    if (!hov) return;
    const DB = RC.model.DB, V = lastV;
    if (!labelText(hov)) { tipEl.hidden = true; return; }
    let html = `<div class="tt ${hov.t}">${TYPE_NAME[hov.t]}</div><div class="tn">${RC.esc(labelText(hov))}</div>`;
    if (hov.t === 'org' && V) html += `<div class="tm">${RC.money(V.orgSum[hov.i])} · ${RC.int(V.orgN[hov.i])} contratos</div>`;
    if (hov.t === 'co' && V) html += `<div class="tm">${RC.money(V.coSum[hov.i])} · ${RC.int(V.coN[hov.i])} contratos</div>`;
    if (hov.t === 'k') { const k = DB.ks[hov.i]; html += `<div class="tm">${RC.moneyNative(k.amt, k.cur)} · ${RC.fmtDate(k.date)}</div>`; }
    const fl = flagOf(hov);
    if (fl) { const l = RC.alerts.level(fl.sev); html += `<div class="tf" style="--c:${l.color}">${RC.alerts.TYPES[fl.type].label} · severidad ${l.label}</div>`; }
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const w = wrap.clientWidth;
    const x = mouseScreen.x + 16 + 260 > w ? mouseScreen.x - 16 - tipEl.offsetWidth : mouseScreen.x + 16;
    tipEl.style.transform = `translate(${x}px, ${mouseScreen.y + 14}px)`;
  }

  // ── bucle ───────────────────────────────────────────────
  let spin = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (!renderer) return;
    const moved = simulate(9);
    // Cuando el acomodo se asienta se reencuadra una vez, salvo que el usuario ya haya movido la camara.
    if (autoFrame && alpha < 0.08) { autoFrame = false; reframe(true); }
    if (fly) {
      const t = RC.clamp((RC.now() - fly.t0) / fly.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (t >= 1) fly = null;
      dirty = true;
    }
    controls.update();
    if (moved) { paint(); writeEdges(false); }
    if (selMark.visible) { spin += 0.01; selMark.rotation.set(spin * 0.7, spin, 0); dirty = true; }
    if (mouseMoved) {
      mouseMoved = false;
      setHover(pick());
      if (hov) updateTip();
    }
    if (dirty) {
      renderer.render(scene, camera);
      updateLabels();
      if (hov) updateTip();
      dirty = false;
    }
  }

  RC.graph = {
    init, build, select, reframe, pinMany, clearPins,
    focus(ref) { const n = ref && byKey.get(key(ref.t, ref.i)); if (n) focusNode(n, false); },
    setPaused(v) { paused = !!v; if (!paused && alpha < 0.05) alpha = 0.3; },
    reheat() { alpha = Math.max(alpha, 0.5); },
    get paused() { return paused; },
    get alpha() { return alpha; },
    get stats() { return stats; },
    get selected() { return sel; },
    has(ref) { return !!(ref && byKey.has(key(ref.t, ref.i))); },
    onSelect(fn) { onSelect = fn; },
    onHover(fn) { onHover = fn; },
    redraw() { dirty = true; paint(); updateLabels(); },
    snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); }
  };
})(window);
