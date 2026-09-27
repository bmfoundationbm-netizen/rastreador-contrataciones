/* Rastreador de Contrataciones · puente seguro entre la app y el sistema */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rcDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  chrome: process.versions.chrome,

  // Devuelve la ruta donde se guardo, o null si el usuario cancelo.
  saveFile: (filename, arrayBuffer) =>
    ipcRenderer.invoke('rc:save', { filename, buffer: new Uint8Array(arrayBuffer) }),

  revealFile: (p) => ipcRenderer.invoke('rc:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('rc:external', url),

  // Actualizacion mensual de la base.
  baseInfo: () => ipcRenderer.invoke('rc:base-info'),
  checkBase: () => ipcRenderer.invoke('rc:base-buscar'),
  onBaseNueva: (fn) => ipcRenderer.on('rc:base-nueva', (_e, meta) => fn(meta))
});
