# Rastreador de Contrataciones

Aplicación de escritorio para analizar sin conexión las contrataciones públicas de
Argentina. Trae incluidos los datos públicos de compras, obra pública y presupuesto
de todos los ministerios, secretarías y subsecretarías del Estado nacional, los
cruza con el Registro Nacional de Sociedades, los muestra en un grafo 3D de
**organismos**, **empresas** y **contratos**, y señala patrones para revisar.
También **compara el precio pagado por cada ítem con precios de mercado** (ver
[Precios](#precios)). El mismo `web/` corre como app Electron y, si Electron no
está, en una ventana de navegador.

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
primera vez que se abre después. Baja la base de la página (~15 MB, no los 1,1 GB
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
| IPC nacional, nivel general (INDEC) | apis.datos.gob.ar › Series de tiempo | 117 meses (dic-2016 a hoy), para ajustar precios por inflación |
| Precios en surtidor, histórico | datos.gob.ar › Secretaría de Energía | 590 precios: mediana nacional de cada mes de nafta súper y premium, gasoil grado 2 y 3, y GNC |
| Listado de precios de medicamentos (PAMI) | datos.gob.ar › PAMI | precio de venta al público de cada marca: 5 828 precios de 1 349 medicamentos genéricos (droga, concentración y forma), por comprimido, cápsula, ampolla, ml o g |
| Precios promedio al consumidor (INDEC) | datos.gob.ar › Series de tiempo (Ministerio de Economía) | 59 productos de almacén, carnes, verdulería, limpieza e higiene en GBA desde abril de 2016, y 14 de ellos en las otras cinco regiones desde junio de 2017: unos 15 000 precios mensuales |
| Precios Claros (SEPA), minorista y mayorista | datos.gob.ar › Secretaría de Comercio | **no disponible**: su servidor no responde (ver [Precios](#precios)) |

En total: **156 151 contratos**, **9 824 empresas**, **224 organismos** de **24
jurisdicciones**, y 101 166 contratos con personas humanas que se guardan solo como
organismo, fecha y monto. Con la base cargada la app ocupa entre 180 y 270 MB de memoria.

**Renovarla:** `npm run base`. El script (`tools/construir-base.js`) busca los
archivos vigentes con la API de cada catálogo (así toma el registro o el año de
presupuesto nuevos sin tocar nada), los baja a `datos/descargas/` (~1,1 GB, casi
todo el histórico de combustibles), los
procesa con el mismo importador de la app y reescribe `web/data/base.js`. Con los
archivos ya bajados tarda ~2 min 30 s; `npm run base -- --refrescar` los vuelve a bajar.
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
| **Ítems comprados** (CSV o Excel) | cuadros comparativos, órdenes de compra, expedientes | Qué se compró, cantidad y precio unitario, unido a su contrato. Ver [Precios](#precios). |
| **Precios de mercado** (CSV o Excel) | listas de precios, relevamientos, Precios Claros | Precio de un producto en una fecha, minorista o mayorista. |

El registro tiene 1,3 millones de sociedades en 3,1 millones de filas (una por
actividad). Se cruza contra los proveedores **ya cargados** y solo se guarda lo de
ellos, así que va después de las adjudicaciones. Si se importan contratos nuevos
después, **Fuentes** avisa cuántos proveedores quedaron sin cruzar.

Lo importado queda guardado en el equipo (IndexedDB) y se recupera al abrir (~3 s
con la base completa). Importar a mano adjudicaciones, convocatorias y registro
tarda ~22 s.

El lector también entiende CSV exportados de Excel: separados por `;` o tabulación,
en Latin-1 o UTF-8 con o sin BOM, con montos `1.234.567,89` o `1,234,567.89`. Lee
también **Excel (.xlsx)**: cada hoja se trata como un archivo aparte, y las hojas de
instrucciones se saltean.

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

**Precio sobre la referencia.** Un ítem comprado cuyo precio unitario supera en
50 % o más al precio de referencia del mismo producto. Solo cuentan los
emparejamientos automáticos seguros o confirmados a mano, y la referencia tiene que
tener al menos 3 precios. Ver [Precios](#precios).

**Exportar CSV** baja las alertas visibles con su explicación, organismos,
empresas, CUIT y contratos.

## Precios

Compara **el precio unitario pagado por cada ítem** con precios de mercado del mismo
producto. Lo que muestra es la **diferencia con el precio de referencia**, no un
sobreprecio: flete, plazo de pago, marca o requisitos de calidad pueden explicarla.

**De dónde salen los precios pagados.** Los datos públicos de COMPR.AR traen el total
de cada orden de compra, no los renglones con cantidad y precio unitario. Por eso los
ítems **se cargan**: pestaña **Precios › Cargar**, con una planilla CSV o Excel
armada a partir de cuadros comparativos, órdenes de compra o expedientes.
**Planillas modelo** baja las dos planillas en Excel, con una hoja de instrucciones.
Cada ítem se une a su contrato por número de orden de compra o de proceso y toma de
ahí el organismo y la empresa.

**De dónde salen los precios de mercado.** Solo de fuentes públicas oficiales o de lo
que cargue cada uno: la app no estima precios.
- **Medicamentos** (PAMI): el listado de precios de venta al público de cada marca y
  presentación. Se agrupa por droga, concentración y forma (por ejemplo,
  *Enalapril 10 mg comprimidos*) y cada marca queda como un precio de ese producto,
  por comprimido, cápsula, ampolla, ml o g. La referencia es la mediana entre marcas.
  Es precio de farmacia al público: una compra del Estado por volumen debería estar
  por debajo, así que pagar por encima es una señal fuerte. Quedan afuera las
  presentaciones sin concentración o con una forma que no se puede llevar a una
  unidad (aerosoles, kits, tiras reactivas). PAMI publica solo la lista vigente: la
  tarea mensual guarda la lista convertida en `datos/mercado/pami-medicamentos-AAAA-MM.csv`
  y así se arma la historia, desde septiembre de 2026.
- **Alimentos, limpieza e higiene** (INDEC): precios promedio al consumidor de 59
  productos en GBA desde 2016 (pan, harina, arroz, fideos, carnes, pollo, merluza,
  lácteos, huevos, frutas y verduras, aceite, azúcar, yerba, café, bebidas,
  lavandina, detergente, jabones, champú, pañales…) y de 14 de ellos en las otras
  cinco regiones desde 2017. Vienen de los CSV de series de tiempo del Ministerio de
  Economía; la presentación de cada uno (botella de 1,5 l, paquete de 500 g,
  docena) sale del cuadro del INDEC.
- **Combustibles** (Secretaría de Energía): mediana nacional de cada mes de nafta
  súper y premium, gasoil grado 2 y 3, y GNC.
- El **IPC** del INDEC, para el ajuste por inflación.
- **Precios Claros** (SEPA): el script los intenta bajar todos los meses, pero hoy
  su servidor (`datos.produccion.gob.ar`) no responde, así que la base se arma sin
  ellos y **Fuentes** lo muestra. Como Precios Claros publica solo la última semana,
  cuando vuelva a responder la tarea mensual guardará un resumen de cada mes en
  `datos/mercado/`, y así se irá armando la historia.
- Los que cargue cada uno: listas de precios mayoristas, relevamientos,
  cotizaciones, con la planilla modelo de precios de mercado.
- **Informática, insumos médicos, papelería, uniformes:** no hay una fuente pública
  oficial con precios. La API de Mercado Libre pide una cuenta de desarrollador y el
  INDEC no releva esos productos. Por ahora dependen de lo que se cargue o se apruebe
  como aporte.

**Cómo se empareja.** Por descripción: palabras en común (las raras pesan más),
sinónimos frecuentes ("computadora portátil" = notebook, "gas oil" = gasoil,
"comp." = comprimido) y singular/plural. Las medidas que definen el producto
(500 mg, 256 GB, 24", 5 ml) tienen que coincidir: 500 mg no es lo mismo que 250 mg.
Un código de barras igual es un emparejamiento seguro. Con 72 puntos o más, sin
medidas en conflicto y con la misma clase de unidad, el emparejamiento es
**automático**. Entre 40 y 72 queda **para revisar**. En **Precios › Revisar** se
elige el producto correcto o *Ninguno*, y en **Sin par** se busca uno a mano. Lo
confirmado vale para todos los ítems con la misma descripción y queda guardado.
Si el precio pagado da más de 6 veces la referencia (o menos de la sexta parte), casi
siempre es otra unidad (una caja contra un comprimido): el emparejamiento pasa a
**Revisar** en lugar de disparar una alerta.

**Cómo se ajusta.**
- **Unidad:** los dos precios se llevan a la misma unidad comparable (por
  comprimido, por litro, por kilo, por unidad): una caja x 16 son 16 comprimidos.
- **Fecha:** se usan los precios de mercado de los meses más cercanos a la compra
  (hasta 3 meses antes o después; si hay menos de 3 precios, 6, 12 o 24 meses), y se
  llevan a la fecha de la compra con el IPC.
- **IVA:** los precios cargados sin IVA se llevan a precio con IVA (21 %).
- **Volumen:** desde 50 unidades, si hay precios mayoristas, se compara solo con
  esos.

La referencia es la **mediana**, y la ficha muestra también el rango central.
Umbral, IVA, cantidad mayorista y puntaje automático se cambian en **Ajustes ›
Precios**.

**Qué muestra.** La pestaña **Precios** tiene el total comparado y la **diferencia
estimada** (lo pagado por encima de la referencia, ítem por ítem), y un **ranking
por organismo y por empresa**. También lista los ítems ordenados por diferencia. La
**ficha del ítem** explica la cuenta. La **ficha del producto** tiene un gráfico con
los precios de mercado (azul) y los pagados (naranja) en el tiempo, y todas sus
compras. Las fichas de organismo y empresa suman una sección de precios. **Excel**
baja ranking, ítems y una nota de cómo leerlos.

**Proponer para la base compartida.** Lo que carga cada uno queda en su equipo.
**Precios › Proponer** arma un Excel con los ítems, precios y emparejamientos
propios y abre una propuesta en GitHub
([formulario](.github/ISSUE_TEMPLATE/aporte-precios.yml)) para adjuntarlo. La
propuesta es pública. Cuando quien administra el repositorio le pone la etiqueta
**aprobado**, [`.github/workflows/aportes.yml`](.github/workflows/aportes.yml):

1. baja el archivo;
2. lo revisa con `tools/validar-aporte.js`, el mismo lector de la app. Solo acepta
   ítems, precios y equivalencias: nada de contratos ni sociedades, sin datos de
   personas y sin las filas de ejemplo de las planillas modelo;
3. si está bien, lo guarda en `datos/aportes/` y cierra la propuesta; si no, comenta
   qué falla y quita la etiqueta.

Lo aprobado entra en la base de todos en la actualización del 1 de cada mes. Para
revisar un archivo a mano: `node tools/validar-aporte.js archivo.xlsx`.

## Privacidad

- Proveedor con **CUIT de persona humana** (prefijo 20, 23, 24 o 27): la fila se
  descarta. Solo queda organismo, fecha y monto, sin identidad, para que los
  totales de cada organismo cierren.
- En los **ítems comprados** pasa lo mismo: si el proveedor es una persona humana,
  el ítem se guarda sin identidad (solo el precio, la fecha y el organismo).
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
(adjudicaciones, convocatorias, registro, IPC, precios de mercado e ítems comprados
de informática y medicamentos) y los pasa por el mismo importador.
Organismos, empresas, domicilios y montos son inventados; los CUIT usan el rango
`30-00000xxx`, que no se asigna. Trae plantado un caso de cada alerta. Mientras
están cargados, la barra superior dice **DATOS FICTICIOS**, y se borran solos
antes de importar datos reales.

## Estructura

```
tools/construir-base.js  arma la base incluida con los datos publicos (npm run base)
tools/validar-aporte.js  revisa un aporte de precios antes de sumarlo
tools/precios-publicos.js  convierte PAMI e INDEC al formato de precios de mercado
datos/descargas/     archivos publicos bajados por el script (no van en la app empaquetada)
datos/mercado/       resumen mensual de Precios Claros (esa fuente solo publica la ultima semana)
datos/aportes/       aportes de precios aprobados; entran en la base el 1 de cada mes
web/data/            base incluida (base.js) y su resumen (base-meta.js)
electron/main.js     ventana, dialogos de guardado, bloqueo de red, base descargada
electron/actualizador.js  busca y baja la base del mes desde la pagina publicada
.github/workflows/actualizar.yml  tarea mensual: base, pagina y programa para Windows
.github/workflows/aportes.yml     revisa y guarda un aporte de precios al aprobarlo
.github/ISSUE_TEMPLATE/aporte-precios.yml  formulario para proponer un aporte
datos/historial.json registro de cada actualizacion mensual
build/               icono del programa
electron/preload.js  puente seguro (guardar, mostrar en carpeta, abrir fuentes)
web/index.html       la app
web/css/app.css      sistema visual (el mismo lenguaje que Umbra Studio)
web/js/core.js       texto, CUIT, fechas, montos, domicilios, tipo de cambio, ajustes
web/js/reader.js     lectura en streaming: CSV, JSON/OCDS, ZIP, Excel; deteccion de formato
web/js/xlsx.js       escritura de Excel (exportes y planillas modelo)
web/js/model.js      organismos, empresas, contratos, ofertas y presupuesto; importacion, cruce,
                     jerarquia por ministerio, filtros, busqueda, guardado, base incluida
web/js/alerts.js     los cinco patrones
web/js/prices.js     comparacion de precios: emparejamiento, ajustes, referencia, ranking
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
- **Descripción y unidad se leen por separado.** Unidas, "Gasoil grado 2" + "litro"
  se leían como "2 litros" y el ítem no encontraba su producto.
- **La referencia usa los precios cercanos a la compra.** El IPC corrige la
  inflación general, no los cambios de precio relativo: con la mediana de diez años
  ajustada por IPC, la referencia de la nafta súper de agosto de 2024 salía 12 % más
  alta que el precio de surtidor de esos meses.
- **La Secretaría de Energía no sirve https** (redirige a http): el histórico de
  surtidor se baja por http, y se lo resume a la mediana nacional de cada mes y
  producto (de 3,4 millones de registros quedan 590 precios).
- **Los CSV de precios promedio del Ministerio de Economía tienen columnas mal
  rotuladas algunos meses:** de enero a agosto de 2026 *jabón de tocador* y
  *desodorante* venían invertidos, y en febrero de 2026 *lavandina* y *detergente*.
  Se detecta con las series regionales, que traen el producto y la presentación en el
  nombre y repiten los valores de GBA: si un mes no coinciden, se intercambian. Con
  eso, 7 292 de los 7 342 precios de GBA coinciden con el cuadro original del INDEC
  (los otros 50 difieren en centavos, por redondeo, en marzo de 2024).
- **"x 60 ml" no son 60 unidades.** Un jarabe "x 60 ml" se compara por ml, una caja
  "x 30" por comprimido; lo que va después de una barra ("125 mg/5 ml") es
  concentración, no contenido. *Docena* son 12 y *maple* 30.
- **El listado de PAMI trae acentos perdidos** en algunos laboratorios ("Bag¿"): el
  laboratorio se muestra solo si llegó entero; la marca, siempre.
- **Una hoja de Excel con solo el encabezado** se leía mal (sin salto de línea no
  había una fila completa): se agrega el salto al final.
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
- Precios Claros no responde, y no hay fuente pública de precios de informática,
  insumos médicos ni papelería: esos rubros dependen de lo que se cargue o se apruebe
  como aporte.
- Los precios de medicamentos tienen historia recién desde septiembre de 2026: para
  compras anteriores la referencia es la lista actual llevada hacia atrás con el IPC
  general, que no sigue exactamente a los medicamentos.
- Los ítems con precio en dólares se pasan a pesos con el promedio anual del tipo de
  cambio, no con el del día de la compra.
