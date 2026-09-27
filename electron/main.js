/* Rastreador de Contrataciones · proceso principal de Electron */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL, fileURLToPath } = require('url');
const actualizador = require('./actualizador');

const WEB = path.join(__dirname, '..', 'web', 'index.html');
const BASE_FILES = new Set(['base.js', 'base-meta.js']);
let baseDir = actualizador.PKG_DATA;     // carpeta de la base vigente (la de la app o la descargada)

const FILTERS = {
  csv: [{ name: 'Planilla CSV', extensions: ['csv'] }],
  json: [{ name: 'Datos JSON', extensions: ['json'] }],
  png: [{ name: 'Imagen PNG', extensions: ['png'] }]
};

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 1100, minHeight: 680,
    backgroundColor: '#08090b',
    show: false,
    autoHideMenuBar: true,
    title: 'Rastreador de Contrataciones',
    icon: path.join(__dirname, '..', 'web', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Los archivos que se leen son de terceros: el renderer corre aislado.
      sandbox: true,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadFile(WEB);

  // La app no navega: cualquier enlace externo se abre en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
}

app.whenReady().then(async () => {
  // La interfaz no pide nada a la red: la unica conexion es la actualizacion mensual,
  // que hace este proceso (fuera de la sesion del navegador).
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_d, cb) => cb({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  // La interfaz siempre pide web/data/base.js; si hay una base descargada mas nueva
  // que la que vino con la app, se sirve esa. El resto de los archivos pasa igual.
  const pkgData = path.resolve(actualizador.PKG_DATA).toLowerCase();
  protocol.handle('file', (req) => {
    try {
      const p = fileURLToPath(req.url.split(/[?#]/)[0]);
      if (baseDir !== actualizador.PKG_DATA && BASE_FILES.has(path.basename(p)) && path.dirname(path.resolve(p)).toLowerCase() === pkgData)
        return net.fetch(pathToFileURL(path.join(baseDir, path.basename(p))).href, { bypassCustomProtocolHandlers: true });
    } catch (e) { /* URL rara: se atiende normal */ }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  baseDir = (await actualizador.current()).dir;

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  // Actualizacion mensual: al abrir (si ya paso el 1) y cada 3 horas mientras la app este abierta.
  const tryUpdate = async () => {
    if (!(await actualizador.due())) return;
    const r = await actualizador.check();
    if (r.estado === 'nueva') announce(r.meta);
  };
  setTimeout(tryUpdate, 15000);
  setInterval(tryUpdate, 3 * 3600 * 1000);
});

// Avisa a la interfaz que hay una base nueva lista para cargar.
async function announce(meta) {
  baseDir = (await actualizador.current()).dir;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('rc:base-nueva', meta);
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Guardar un archivo generado por la app (exportes) con el dialogo nativo.
ipcMain.handle('rc:save', async (_e, { filename, buffer }) => {
  const ext = String(filename).split('.').pop().toLowerCase();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Guardar como',
    defaultPath: filename,
    filters: (FILTERS[ext] || []).concat([{ name: 'Todos los archivos', extensions: ['*'] }])
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
});

// Abrir la carpeta que contiene un archivo recien exportado.
ipcMain.handle('rc:reveal', async (_e, p) => { if (p) shell.showItemInFolder(p); return true; });

// Enlaces a las fuentes de datos publicas y a la pagina del proyecto (se abren fuera de la app).
ipcMain.handle('rc:external', async (_e, url) => {
  url = String(url);
  const page = (await actualizador.info()).pagina;
  if (/^https:\/\/(datos\.gob\.ar|datos\.jus\.gob\.ar|comprar\.gob\.ar|www\.presupuestoabierto\.gob\.ar|github\.com)\//i.test(url) ||
    (page && url.startsWith(page))) await shell.openExternal(url);
  return true;
});

// Estado de la actualizacion mensual y busqueda manual (desde Fuentes).
ipcMain.handle('rc:base-info', () => actualizador.info());
ipcMain.handle('rc:base-buscar', async () => {
  const r = await actualizador.check();
  if (r.estado === 'nueva') await announce(r.meta);
  return r;
});
