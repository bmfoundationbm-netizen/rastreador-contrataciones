# Rastreador de Contrataciones

Aplicación de escritorio para analizar sin conexión las contrataciones públicas de
Argentina. Trae incluidos los datos públicos de compras, obra pública y presupuesto
de todos los ministerios, secretarías y subsecretarías del Estado nacional, los
cruza con el Registro Nacional de Sociedades, los muestra en un grafo 3D de
**organismos**, **empresas** y **contratos**, y señala patrones para revisar. El
mismo `web/` corre como app Electron y, si Electron no está, en una ventana de
navegador.

No guarda datos de personas humanas: ni DNI, ni socios, ni directores (ver
[Privacidad](#privacidad)).

---

## Cómo se comparte

- **Página web:** <https://bmfoundationbm-netizen.github.io/rastreador-contrataciones/> — se abre en cualquier navegador, sin instalar nada.
  También funciona en celular, con el grafo arriba y los paneles abajo.
- **Programa para Windows:** desde la página (botón *Programa para Windows*) o desde
  [las versiones del repositorio](https://github.com/bmfoundationbm-netizen/rastreador-contrataciones/releases/latest). Hay una versión
  *portable* (un solo `.exe`, no se instala) y un *instalador*. Como no está firmado,
  Windows muestra "editor desconocido" la primera vez: *Más información → Ejecutar
  de todas formas*.

## Actualización mensual

El **1 de cada mes a las 06:00** (hora de Argentina) GitHub corre
[`.github/workflows/actualizar.yml`](.github/workflows/actualizar.yml), que:

1. baja los datos oficiales y arma la base con `tools/construir-base.js`;
2. publica la página con la base nueva;
3. arma el programa para Windows con esa base y lo publica como versión nueva;
4. anota la actualización en [`datos/historial.json`](datos/historial.json). Ese
   commit además evita que GitHub apague la tarea: lo hace si un repositorio pasa 60
   días sin actividad.

No depende de que ninguna computadora esté prendida. También se puede correr a mano
(*Actions → Actualizar datos y publicar → Run workflow*) y corre sola cuando cambia el
código. Si una fuente oficial falla, la tarea falla, GitHub avisa por mail y la página
sigue con los datos del mes anterior.

**Cada programa instalado se actualiza solo:** el día 1 si está abierto, o la
primera vez que se abre después. Baja la base de la página (~15 MB, no los 370 MB
originales), la verifica y la usa en lugar de la que traía. Si no importaste nada
encima, la carga sin preguntar. Si importaste archivos propios, pregunta una vez antes
de reemplazarlos. **Fuentes** muestra la última consulta y tiene un botón para buscar
la actualización a mano. Esa es la única conexión del programa: la hace el proceso
principal, solo hacia la página del proyecto; la interfaz sigue sin acceso a la red.

La página web hace lo mismo: cada visitante ve la base del mes, y lo que haya
importado por su cuenta queda solo en su navegador.

## Cómo se abre en esta computadora

- **Doble clic en `launch.vbs`.** Usa Electron si está instalado; si no, abre la
  app en Chrome, Edge o Brave en modo aplicación.
- **`npm start`** desde la carpeta del proyecto.
- **`npm run dist:win`** arma el instalador y la versión portable en `dist/`.

Electron 44 ya no baja su binario al instalar: lo baja la primera vez que arranca.
Ya quedó bajado en `node_modules/electron/dist`.

> Si `npm start` arranca como si fuera Node (`Cannot find module 'electron'`), la
> terminal tiene la variable `ELECTRON_RUN_AS_NODE` puesta. Pasa en las terminales
> que abren algunas extensiones de VS Code. Con `launch.vbs` no ocurre.

## La base incluida

La app viene con los datos ya procesados en `web/data/base.js` (14 MB) y los carga
sola la primera vez que se abre (~4 s). Corte actual: **27/09/2026**.

| Qué | Fuente | Qué quedó |
|---|---|---|
| Adjudicaciones de COMPR.AR 2016-2026, más los anuales 2018-2020 como complemento | datos.gob.ar › Sistema de Contrataciones Electrónicas | 133 330 contratos con sociedades |
| Adjudicaciones del sistema anterior 2015-2017 | mismo conjunto | 22 432 contratos con sociedades |
| Convocatorias 2016-2026 y del sistema anterior 2015-2017 | mismo conjunto | 190 461 procesos con objeto y monto estimado |
| Obra pública de CONTRAT.AR: contratos, procedimientos y **ofertas** | datos.gob.ar › Procesos de Contratación de la Obra Pública | 389 contratos, 482 procesos, 639 ofertas |
| SIPRO (proveedores) | datos.gob.ar › Sistema de Contrataciones Electrónicas | tipo de personería |
| Registro Nacional de Sociedades 2026 y su registro de asociaciones sin fines de lucro | datos.jus.gob.ar › Registro Nacional de Sociedades | 9 005 de 9 505 proveedores cruzados |
| Presupuesto abierto, crédito anual 2015-2026 | presupuestoabierto.gob.ar | 1 493 organismo-años: ministerio, crédito, devengado, unidades ejecutoras |

En total: **156 151 contratos**, **9 824 empresas**, **224 organismos** de **24
jurisdicciones**, y 101 166 contratos con personas humanas que se guardan solo como
organismo, fecha y monto. Con la base cargada la app ocupa entre 180 y 270 MB de memoria.

**Renovarla:** `npm run base`. El script (`tools/construir-base.js`) busca los
archivos vigentes con la API de cada catálogo (así toma el registro o el año de
presupuesto nuevos sin tocar nada), los baja a `datos/descargas/` (~370 MB), los
procesa con el mismo importador de la app y reescribe `web/data/base.js`. Con los
archivos ya bajados tarda ~90 s; `npm run base -- --refrescar` los vuelve a bajar.
La app en sí nunca se conecta: el script es una herramienta aparte.

Cuando una app que ya tenía datos encuentra una base más nueva, pregunta una vez si
reemplazarlos. Si lo guardado era el ejemplo ficticio, lo reemplaza sin preguntar.
**Fuentes** muestra cada archivo con su enlace y lo que aportó, y permite volver a
cargar la base.

**Lo que quedó afuera, y por qué:**

- *Estructura orgánica vigente (Mapa del Estado):* el CSV está detrás de un control
  anti-bots y la única versión descargable es de 2019. La jerarquía sale del
  presupuesto, que se actualiza cada semana.
- *Obras del Decreto 1169/2018 (CONTRAT.AR histórico):* no trae el monto adjudicado,
  solo el presupuesto oficial y lo certificado.
- *Compras COVID de la ONC:* son enlaces a PDF y planillas sueltas, no datos.
- *ACUMAR y Superintendencia de Servicios de Salud:* publican llamados sin
  adjudicatario ni monto; ACUMAR además compra por COMPR.AR y ya está incluida.
- *PAMI:* no es un ministerio y publica planillas XLSX mes a mes.
- *COMPR.AR anuales 2016 y 2017:* traen la unidad de compras en las columnas de SAF;
  sus documentos ya están en el consolidado.
- Todo lo que tenga datos de personas (autoridades, funcionarios, nóminas): ver
  [Privacidad](#privacidad).

## Sumar archivos

Además de la base, **Importar** (o arrastrar archivos a la ventana) suma datos más
nuevos o de otras jurisdicciones. Se pueden elegir varios a la vez: la app detecta qué
es cada uno por sus columnas y los procesa en el orden correcto.

| Archivo | Dónde | Qué aporta |
|---|---|---|
| **Adjudicaciones 2016 - 2026** (CSV, ~90 MB) | [datos.gob.ar › Sistema de Contrataciones Electrónicas](https://datos.gob.ar/dataset/sistema-de-contrataciones-electronicas) | Organismo (SAF), proveedor, CUIT, monto, moneda, fecha, rubros, procedimiento. Sirven también los CSV por año y los del sistema anterior (*legacy*). |
| **Registro Nacional de Sociedades** (ZIP, ~120 MB) | [datos.jus.gob.ar › Registro Nacional de Sociedades](https://datos.jus.gob.ar/dataset/registro-nacional-de-sociedades) | Tipo societario, fecha de contrato social, domicilio legal, actividad. **No hace falta descomprimirlo.** |
| Convocatorias 2016 - 2026 (opcional) | mismo conjunto de COMPR.AR | Objeto del proceso (se vuelve buscable) y monto estimado. |
| SIPRO (opcional) | mismo conjunto de COMPR.AR | Tipo de personería de los proveedores que no están en el registro. |
| CONTRAT.AR: contratos, procedimientos, ofertas | datos.gob.ar › Obra Pública | Obra pública, presupuesto oficial y todas las ofertas. |
| Presupuesto abierto, crédito anual (ZIP) | presupuestoabierto.gob.ar | Ministerio de cada organismo, crédito y devengado, unidades ejecutoras. |
| Cualquier publicación **OCDS** (JSON o JSONL) | otras jurisdicciones | Comprador, proveedores, adjudicaciones y contratos. |

El registro tiene 1,3 millones de sociedades en 3,1 millones de filas (una por
actividad). Se cruza contra los proveedores **ya cargados** y solo se guarda lo de
ellos, así que va después de las adjudicaciones. Si se importan contratos nuevos
después, **Fuentes** avisa cuántos proveedores quedaron sin cruzar.

Lo importado queda guardado en el equipo (IndexedDB) y se recupera al abrir (~3 s
con la base completa). Importar a mano adjudicaciones, convocatorias y registro
tarda ~22 s.

El lector también entiende CSV exportados de Excel: separados por `;` o tabulación,
en Latin-1 o UTF-8 con o sin BOM, con montos `1.234.567,89` o `1,234,567.89`.

## Qué muestra

**Grafo 3D** — un organismo se une a sus contratos y cada contrato a su empresa.
Cada tipo tiene color y forma propios: organismo azul (icosaedro), empresa naranja
(esfera), contrato aqua (octaedro). El tamaño es el monto, en escala logarítmica.
Los colores salen de la paleta categórica validada para daltonismo, y la forma
repite la información.

No se dibujan los 132 000 contratos: entran las **300 empresas** de mayor monto
en la vista, sus **1 000 contratos** más grandes (el selector *Contratos* lo cambia)
y, aparte, las empresas y contratos señalados por alertas. Si un par
organismo-empresa tiene contratos que quedaron afuera, una arista gris los une
igual. Seleccionar algo que no está en pantalla lo trae.

- Clic: ficha · doble clic: acercar · arrastrar: girar · rueda: zoom.
- Al elegir un nodo o una alerta, lo que no tiene que ver se achica y se apaga.
- `/` busca, `F` encuadra, `Espacio` pausa el acomodo, `L` rótulos, `Esc` suelta.

**Filtros** — período (con atajos por año; Mayús+clic extiende el rango), monto por
contrato (a mano, con atajos, o arrastrando sobre el histograma), tipo de
procedimiento y **ministerios y organismos**. Todo —grafo, alertas, totales— se
recalcula sobre la vista filtrada.

**Ministerios, secretarías y subsecretarías** — los organismos van agrupados por el
ministerio (jurisdicción) del último presupuesto en que figuran: por ejemplo,
Capital Humano agrupa a la Secretaría de Educación, la Secretaría de Niñez, ANSES y
la Secretaría de Trabajo. Los ministerios que ya no existen van después, con el año
hasta el que figuran; al final, los compradores fuera del presupuesto nacional
(universidades, empresas de servicios que publicaban en el sistema anterior, entes
como INCAA o ACUMAR). Tildar un ministerio filtra todos sus organismos; en el grafo,
los organismos de un mismo ministerio se atraen y quedan cerca.

**Búsqueda** — organismo, razón social, CUIT (con o sin guiones), número de
proceso o de orden de compra, y el objeto del proceso si se cargaron convocatorias.

**Fichas** — el **ministerio** muestra sus organismos con lo adjudicado y lo
devengado, su presupuesto año por año y sus alertas más severas. El **organismo**
muestra de qué ministerio depende (y de cuáles dependió antes), a quién le compra
(con índice HHI de concentración), el gasto con personas humanas como una sola
barra sin identificar, sus contratos más grandes y **presupuesto y compras**: el
devengado en bienes y servicios (incisos 2, 3 y 4) contra lo adjudicado, año por
año, con el porcentaje que cubren los datos de compras, y las **secretarías,
subsecretarías y unidades** que ejecutan su presupuesto. La **empresa** suma sus
ofertas en obra pública: en qué procesos se presentó, en qué puesto quedó y contra
quién. La **empresa** muestra CUIT (y si el dígito
verificador no cierra), tipo, fecha de constitución, domicilio legal, cuántas
sociedades comparten ese domicilio y cuáles son proveedoras, y una línea de tiempo
con la constitución y cada contrato. El **contrato** muestra el percentil de su
monto en el año y la relación con la mediana de su rubro.

## Alertas

Son **patrones para revisar, no pruebas de irregularidad**. Cada una explica qué la
disparó, con los datos. Los umbrales se cambian en **Ajustes**. La severidad
(alta, media, baja) va siempre con rótulo; en el grafo se ve como un halo en los 80
nodos más severos.

Todos los montos se comparan en **dólares equivalentes del año del contrato**: con
la inflación argentina, comparar pesos nominales de años distintos convertiría
cualquier contrato reciente en "grande".

**Empresa recién creada con contrato grande.** Contratos que están en el 10 %
superior de su año (percentil 90) adjudicados a una sociedad con menos de 12 meses
desde su contrato social. También señala los fechados hasta 90 días *antes* de la
constitución. Más de 90 días antes no es una empresa nueva: es una reinscripción o
un error de carga, y se descarta (con los datos reales aparecían casos de 5 años).

**Proveedor dominante.** Un proveedor se lleva el 40 % o más de lo que adjudicó un
organismo (con al menos 5 contratos y US$ 50 000 en el período). El total incluye
lo adjudicado a personas humanas, sin identificarlas, para que la proporción sea
honesta. La severidad baja cuando la porción viene de un único contrato enorme y
no de ganar una y otra vez.

**Monto fuera de lo normal.** Dos criterios:
1. Desvío robusto (mediana y MAD) sobre el logaritmo del monto, a partir de 3,5.
   Se compara con la misma combinación de rubros y año; si hay menos de 20
   contratos, con el rubro principal y año; si no, con todo el año.
2. Si se cargaron convocatorias: lo adjudicado (sin ampliaciones ni prórrogas)
   triplica el monto estimado. Se descartan estimados de menos de $ 1 000 y
   relaciones de más de 10 veces: en los datos reales hay estimados de relleno
   ($ 1,00 o $ 0,12) y precios unitarios contra totales, y el 99 % de los procesos
   queda por debajo de 2,9 veces. Por la inflación entre publicación y
   adjudicación, este criterio llega como mucho a severidad media.

**Varias empresas en el mismo domicilio legal.** Dos o más proveedores con el
mismo edificio (calle, altura y localidad; el orden de las palabras y los
tratamientos como "Av." o "Gral." no importan). Sube si declaran además el mismo
piso y departamento, si le venden al mismo organismo, y sobre todo si **se
presentaron como competidoras en la misma licitación** de obra pública (CONTRAT.AR
es la única fuente que publica todas las ofertas; con los datos reales ya aparece
un caso: tres empresas del mismo domicilio en tres procesos). Baja mucho si en ese
edificio hay 25 sociedades o más inscriptas: suele ser un estudio contable o
jurídico que presta el domicilio (en Buenos Aires hay direcciones con más de 800).

**Exportar CSV** baja las alertas visibles con su explicación, organismos,
empresas, CUIT y contratos.

## Privacidad

- Proveedor con **CUIT de persona humana** (prefijo 20, 23, 24 o 27): la fila se
  descarta. Solo queda organismo, fecha y monto, sin identidad, para que los
  totales de cada organismo cierren.
- Proveedor **sin CUIT argentino** (del exterior o vacío): se acepta solo si la
  razón social tiene un marcador societario (S.A., S.R.L., Ltd., GmbH, SpA,
  cooperativa…). Sin marcador podría ser una persona, y se trata igual que arriba.
- **Sociedades de hecho, condominios y sucesiones**: se omite el nombre, porque
  suele ser el de sus integrantes ("Fulano y Mengano S.H."). Queda el CUIT, que es
  de la entidad.
- Del registro se leen **solo columnas de la sociedad**. Un archivo con columnas de
  personas (DNI, apellido, cargo, socios, autoridades…) que no sea de contratos o de
  sociedades se rechaza entero.
- Las filas de persona humana del registro y del SIPRO se ignoran.
- La app no se conecta a nada: Electron bloquea toda petición de red, la página
  tiene una CSP sin orígenes externos y las fuentes van incluidas.

Con los datos reales: 72 398 de 205 299 adjudicaciones eran de personas humanas
y no se guardaron; 191 más no tenían CUIT argentino ni marcador societario.

## Tipo de cambio

Tabla de promedios anuales del dólar oficial (BCRA, Com. A 3500), **aproximados**
y editables en **Ajustes**. Solo sirven para llevar montos de distintos años y
monedas a una misma escala. **El valor de 2026 es una estimación mía**: conviene
corregirlo con el dato oficial. Euro, libra, franco suizo, real y yen se pasan por
un cruce fijo contra el dólar. Los montos en otras monedas no suman y se avisan.

En **Ajustes** también se elige ver los montos en dólares equivalentes (por
defecto) o en pesos nominales.

## Datos de ejemplo

**Probar con datos ficticios** genera archivos con el mismo formato que los reales
(adjudicaciones, convocatorias y registro) y los pasa por el mismo importador.
Organismos, empresas, domicilios y montos son inventados; los CUIT usan el rango
`30-00000xxx`, que no se asigna. Trae plantado un caso de cada alerta. Mientras
están cargados, la barra superior dice **DATOS FICTICIOS**, y se borran solos
antes de importar datos reales.

## Estructura

```
tools/construir-base.js  arma la base incluida con los datos publicos (npm run base)
datos/descargas/     archivos publicos bajados por el script (no van en la app empaquetada)
web/data/            base incluida (base.js) y su resumen (base-meta.js)
electron/main.js     ventana, dialogos de guardado, bloqueo de red, base descargada
electron/actualizador.js  busca y baja la base del mes desde la pagina publicada
.github/workflows/actualizar.yml  tarea mensual: base, pagina y programa para Windows
datos/historial.json registro de cada actualizacion mensual
build/               icono del programa
electron/preload.js  puente seguro (guardar, mostrar en carpeta, abrir fuentes)
web/index.html       la app
web/css/app.css      sistema visual (el mismo lenguaje que Umbra Studio)
web/js/core.js       texto, CUIT, fechas, montos, domicilios, tipo de cambio, ajustes
web/js/reader.js     lectura en streaming: CSV, JSON/OCDS, ZIP; deteccion de formato
web/js/model.js      organismos, empresas, contratos, ofertas y presupuesto; importacion, cruce,
                     jerarquia por ministerio, filtros, busqueda, guardado, base incluida
web/js/alerts.js     los cuatro patrones
web/js/graph.js      grafo 3D: fuerzas con arbol octal y dibujo instanciado
web/js/sample.js     generador de datos ficticios
web/js/ui.js         interfaz
web/vendor/          three.js r128 y OrbitControls (los mismos de Umbra), fuentes IBM Plex
launch.vbs           lanzador
```

Las librerías van vendorizadas, como en Umbra: la app funciona sin red.

## Decisiones no obvias

- **El ZIP se lee por tramos.** Se ubica el directorio central al final del archivo
  y cada entrada se descomprime con `DecompressionStream('deflate-raw')` mientras
  se parsea. Los 907 MB del registro nunca están enteros en memoria.
- **Los CUIT de las filas "SPR" vienen rotos en COMPR.AR**: `30-707034129-9` en vez
  de `30-70703412-9` (el verificador repetido dentro del cuerpo). Son 52 000 filas;
  se reparan antes de clasificar.
- **Copias propias de los strings.** Un `slice` de un tramo grande de texto retiene
  el tramo entero; guardar miles de números de expediente retenía el archivo
  completo. `RC.own()` fuerza una copia chica; con eso, las 205 000 adjudicaciones
  quedan en ~130 MB.
- **`Int16Array` guarda `NaN` como 0**: al recuperar, un año 0 vuelve a ser "sin año".
- **En three r128, `setColorAt` dimensiona el buffer con `count`.** Hay que llamarlo
  antes de poner `count = 0`, o todos los nodos salen negros.
- **Repulsión de cuadrado inverso.** Con la ley de d3 (fuerza ∝ 1/d) la nube de
  2 000 nodos se abría tanto que los nodos no se veían; con 1/d² queda compacta y
  se distinguen los grupos por organismo.
- **Los anuales 2016 y 2017 de COMPR.AR traen la unidad de compras donde debería ir
  el SAF** (23 en vez de 301). Importados tal cual duplicaban ~3 400 contratos bajo
  organismos inexistentes. Los anuales se usan solo desde 2018, en *modo
  complemento*: un documento que ya está en el consolidado (aunque con otro monto u
  organismo) se descarta; solo entran los que faltan.
- **La deduplicación cuenta repeticiones.** Los archivos viejos no traen número de
  documento, y dos renglones iguales del mismo proceso son dos adjudicaciones: solo se
  descarta la n-ésima repetición si ya había n iguales de antes.
- **Organismos sin código de SAF** (sistema anterior) se unen a su SAF por nombre,
  tolerando abreviaturas ("ADM. NACIONAL DE LAB. E INST. DE SALUD" → ANLIS Malbrán):
  una palabra abreviada vale si es el comienzo de la completa, y se exige que casi
  todo coincida en los dos sentidos. Así se ubicaron unos 30 organismos del sistema
  anterior; cada organismo toma el nombre de su último presupuesto.
- **Los montos del presupuesto se leen estrictos** (coma decimal, sin miles): la
  lectura general tomaría "100,123" como cien mil.
- **En la base incluida los `NaN` viajan como `null`** (JSON), e `isFinite(null)` da
  `true`: al cargar se normalizan, o una fecha desconocida pasaría por 1970.
- **Los IDs de alerta salen del contenido** (tipo + a quién señala), así una alerta
  elegida sobrevive a un cambio de filtros o se descarta; con IDs secuenciales la
  ficha mostraba otra alerta.

## Pendientes

- Los programas no están firmados digitalmente (Windows avisa "editor desconocido").
  Firmarlos requiere un certificado de firma de código, que es pago.
- Las provincias y municipios no están en la base: se pueden sumar con **Importar**
  si publican en OCDS o CSV con columnas reconocibles.
- En OCDS, una adjudicación con varios proveedores reparte el monto en partes
  iguales.
- Los domicilios de la IGJ no traen CUIT (se enlazan por número correlativo) y no
  se cruzan; el registro nacional ya trae el domicilio legal.
- La fecha de preinscripción del SIPRO no es la de constitución y no se usa.
