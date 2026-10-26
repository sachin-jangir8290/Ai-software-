const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nova', { ask: (payload) => ipcRenderer.invoke('ai:ask', payload),
  onOpenTab: (fn) => ipcRenderer.on('open-tab', (_e, url) => fn(url)) });
