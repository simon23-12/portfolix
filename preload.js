'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portfolix', {
  loadXml: () => ipcRenderer.invoke('data:loadXml'),
  pickXml: () => ipcRenderer.invoke('data:pickXml'),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (store) => ipcRenderer.invoke('store:save', store),
  getMode: () => ipcRenderer.invoke('app:getMode'),
  setMode: (mode) => ipcRenderer.invoke('app:setMode', mode),
  loadPortfolio: () => ipcRenderer.invoke('portfolio:load'),
  savePortfolio: (data) => ipcRenderer.invoke('portfolio:save', data),
  savePortfolioAs: (payload) => ipcRenderer.invoke('portfolio:saveAs', payload),
  openPortfolio: () => ipcRenderer.invoke('portfolio:open'),
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
