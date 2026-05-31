'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portfolix', {
  loadXml: () => ipcRenderer.invoke('data:loadXml'),
  pickXml: () => ipcRenderer.invoke('data:pickXml'),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (store) => ipcRenderer.invoke('store:save', store),
  paths: () => ipcRenderer.invoke('app:paths'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  fetchQuotes: (symbols) => ipcRenderer.invoke('quotes:fetch', symbols),
  fetchHistory: (opts) => ipcRenderer.invoke('quotes:history', opts),
  // Auto-Update
  version: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload))
});
