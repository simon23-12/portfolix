'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const DEFAULT_XML = path.join(__dirname, 'MyInvestments.xml');
const STORE_FILE = path.join(app.getPath('userData'), 'portfolix-store.json');
const CONFIG_FILE = path.join(app.getPath('userData'), 'portfolix-config.json');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0e1116',
    title: 'Portfolix',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* ------------------------------ Auto-Update ------------------------------- */
// Läuft nur in der gepackten App (nicht in `npm start`). Liest den Update-Feed
// aus der in package.json hinterlegten GitHub-Publish-Konfiguration.

function sendUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', payload);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info && info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info && info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String(err && err.message || err) }));
  // kurz verzögert prüfen, damit das Fenster zuerst lädt
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  // stündlich erneut prüfen, solange die App läuft
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { state: 'dev' };
  try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; }
  catch (e) { return { state: 'error', message: String(e && e.message || e) }; }
});

ipcMain.handle('update:install', async () => {
  // Beendet die App und installiert das geladene Update.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});

ipcMain.handle('app:version', async () => app.getVersion());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ----------------------------- config helpers ----------------------------- */

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { xmlPath: DEFAULT_XML };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

/* --------------------------------- IPC ------------------------------------ */

ipcMain.handle('data:loadXml', async () => {
  const cfg = readConfig();
  // 1) zuletzt gewählte Datei  2) Entwicklungs-Datei neben der App
  const candidates = [cfg.xmlPath, DEFAULT_XML].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return { xml: fs.readFileSync(p, 'utf8'), path: p };
    } catch { /* nächste Kandidatin */ }
  }
  // keine Datei vorhanden -> Onboarding im Renderer
  return { needsFile: true };
});

ipcMain.handle('data:pickXml', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Portfolio-Performance Datei wählen',
    filters: [{ name: 'Portfolio Performance', extensions: ['xml'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const xmlPath = res.filePaths[0];
  const cfg = readConfig();
  cfg.xmlPath = xmlPath;
  writeConfig(cfg);
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return { xml, path: xmlPath };
});

ipcMain.handle('store:load', async () => {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { bookedPlanTx: [], lastRun: {} };
  }
});

ipcMain.handle('store:save', async (_e, store) => {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  return true;
});

ipcMain.handle('app:paths', async () => {
  return { store: STORE_FILE, config: CONFIG_FILE, xml: readConfig().xmlPath || DEFAULT_XML };
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  await shell.openExternal(url);
});

/* --------------------------- Yahoo Finance quotes -------------------------- */
// Fetched in the main process to avoid CORS restrictions in the renderer.

async function yahooQuote(symbols) {
  const out = {};
  // chart endpoint per symbol – robust and gives currency + regularMarketPrice.
  await Promise.all(symbols.map(async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Portfolix/1.0' }
      });
      if (!resp.ok) { out[sym] = { error: `HTTP ${resp.status}` }; return; }
      const json = await resp.json();
      const r = json && json.chart && json.chart.result && json.chart.result[0];
      if (!r || !r.meta) { out[sym] = { error: 'no data' }; return; }
      const m = r.meta;
      out[sym] = {
        price: m.regularMarketPrice,
        previousClose: m.chartPreviousClose ?? m.previousClose,
        currency: m.currency,
        exchange: m.exchangeName,
        symbol: m.symbol,
        time: m.regularMarketTime
      };
    } catch (err) {
      out[sym] = { error: String(err && err.message || err) };
    }
  }));
  return out;
}

ipcMain.handle('quotes:fetch', async (_e, symbols) => {
  if (!Array.isArray(symbols) || !symbols.length) return {};
  return yahooQuote(symbols);
});

// Historical daily closes for a symbol (for live chart fallback / sparkline)
ipcMain.handle('quotes:history', async (_e, { symbol, range = '1mo', interval = '1d' }) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Portfolix/1.0' } });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const json = await resp.json();
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    if (!r) return { error: 'no data' };
    const ts = r.timestamp || [];
    const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
    const points = ts.map((t, i) => ({ t: t * 1000, c: closes[i] })).filter(p => p.c != null);
    return { points, currency: r.meta && r.meta.currency };
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
});
