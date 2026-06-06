'use strict';
/*
 * Headless-UI-Test mit jsdom: lädt die echte index.html + alle Renderer-Skripte,
 * mockt die IPC-Bridge (window.portfolix), Yahoo-Abfragen und Chart, und spielt
 * die echten Flows durch (Wizard, Modals, Buttons, Bearbeiten/Löschen, …).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

let html = read('index.html');
// externe Skripte entfernen – wir injizieren sie inline (ein Block = gemeinsamer Scope)
html = html.replace(/<script src="[^"]*"><\/script>\s*/g, '');

const combined = ['ppparser.js', 'model.js', 'savingsplan.js', 'builder.js', 'app.js'].map(read).join('\n;\n');

const stub = `
window.__test = { store:{bookedPlanTx:[],symbolOverrides:{}}, portfolio:null, mode:null, modeSet:[], quotesAsked:[], historyAsked:[], quoteMap:{} };
window.confirm = function(){ return true; };
window.alert = function(){};
window.Chart = function(){ this.destroy=function(){}; this.update=function(){}; };
window.Chart.defaults = { color:'', font:{}, borderColor:'' };
HTMLCanvasElement.prototype.getContext = function(){ return { createLinearGradient:function(){ return { addColorStop:function(){} }; } }; };
window.portfolix = {
  getMode: async function(){ return { mode: window.__test.mode, nativeExists: !!window.__test.portfolio }; },
  setMode: async function(m){ window.__test.mode=m; window.__test.modeSet.push(m); return true; },
  loadPortfolio: async function(){ return window.__test.portfolio ? { data: window.__test.portfolio, path: window.__test.path } : null; },
  savePortfolio: async function(d){ window.__test.portfolio=d; window.__test.saveCount=(window.__test.saveCount||0)+1; return true; },
  savePortfolioAs: async function(p){ window.__test.portfolio=p.data; window.__test.path='C:\\\\Users\\\\simon\\\\Documents\\\\Portfolix\\\\'+(p.suggestedName||'MeinPortfolio')+'.portfolix.json'; window.__test.mode='native'; window.__test.saveAsCount=(window.__test.saveAsCount||0)+1; return { path: window.__test.path }; },
  openPortfolio: async function(){ return window.__test.portfolio ? { data: window.__test.portfolio, path: window.__test.path } : null; },
  loadStore: async function(){ return window.__test.store; },
  saveStore: async function(s){ window.__test.store=s; return true; },
  loadXml: async function(){ return { needsFile:true }; },
  pickXml: async function(){ return null; },
  paths: async function(){ return {}; },
  openExternal: async function(){},
  version: async function(){ return '1.0.2'; },
  checkUpdate: async function(){ return {state:'none'}; },
  installUpdate: async function(){ return true; },
  onUpdateStatus: function(){},
  fetchQuotes: async function(syms){ window.__test.quotesAsked.push(syms); var out={}; (syms||[]).forEach(function(s){ out[s]= window.__test.quoteMap[s] || {price:100,previousClose:99,currency:'EUR'}; }); return out; },
  fetchHistory: async function(o){ window.__test.historyAsked.push(o); return { points:[{t:Date.now()-86400000*30,c:90},{t:Date.now(),c:100}], currency:'EUR' }; }
};
`;

html = html.replace('</body>', `<script>${stub}</script>\n<script>${combined}</script>\n</body>`);

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://portfolix.local/' });
const win = dom.window;
const doc = win.document;
win.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
win.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason)));

/* ---- Helfer ---- */
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s);
const T = win.__test;
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }
function form() { return $('#modalForm'); }
function setF(name, val) { const f = form(); const el = f.elements[name]; if (!el) throw new Error('Feld fehlt: ' + name); if (el.type === 'checkbox') el.checked = !!val; else el.value = val; el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); }
function submit() { form().dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); }
function click(el) { el.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true })); }
function pf() { return T.portfolio; }
function allPfTx() { return pf().portfolios.reduce((a, p) => a.concat(p.transactions), []); }
function allAccTx() { return pf().accounts.reduce((a, p) => a.concat(p.transactions), []); }

async function run() {
  await tick(60); // init() abwarten

  console.log('\n[1] Erststart / Willkommen');
  ok($('#choiceNew') && $('#choiceImport'), 'Auswahl „Neues Portfolio / Importieren" erscheint');

  console.log('\n[2] Wizard: Anlageklassen + Startdatum');
  click($('#choiceNew')); await tick();
  ok($('#typeGrid'), 'Schritt 1: Anlageklassen-Grid sichtbar');
  ['AKTIE', 'ETF', 'IMMOBILIE'].forEach(k => { const c = doc.querySelector(`.type-card[data-k="${k}"]`); if (c) click(c); });
  ok(doc.querySelectorAll('.type-card.on').length === 3, '3 Anlageklassen ausgewählt');
  click($('#wzNext')); await tick();
  ok($('#wzYear') && $('#wzMonth'), 'Schritt 2: Startdatum-Auswahl sichtbar');
  $('#wzYear').value = '2022'; $('#wzMonth').value = '1';
  click($('#wzFinish')); await tick(420);
  ok(T.mode === 'native', 'Modus auf „native" gesetzt');
  ok(pf() && pf().portfolios.length === 1, 'Depot angelegt');
  ok(pf() && pf().accounts.length >= 1, 'Verrechnungskonto angelegt');
  ok($('#addBtn') && !$('#addBtn').hidden, '„+ Hinzufügen"-Button sichtbar');

  console.log('\n[3] Asset anlegen (ETF) + erster Kauf');
  win.openAdd('asset'); await tick();
  ok(form(), 'Asset-Modal offen');
  setF('type', 'ETF'); setF('name', 'Vanguard All-World'); setF('isin', 'IE00BK5BQT80'); setF('symbol', 'VWCE.DE');
  submit(); await tick(60);
  ok(pf().securities.length === 1 && pf().securities[0].name === 'Vanguard All-World', 'Wertpapier gespeichert');
  ok(T.store.symbolOverrides[pf().securities[0].uuid] === 'VWCE.DE', 'Yahoo-Symbol als Override gespeichert');
  ok(form(), 'Folge-Modal „Buchung erfassen" öffnet automatisch');
  // Kauf erfassen
  setF('shares', '10'); setF('price', '100'); setF('fee', '1'); setF('fund', true);
  submit(); await tick(120);
  const buys = allPfTx().filter(t => t.type === 'BUY');
  ok(buys.length === 1 && Math.abs(buys[0].shares - 10) < 1e-9, 'Kauf gebucht: 10 Stück');
  ok(allAccTx().some(t => t.type === 'DEPOSIT') && allAccTx().some(t => t.type === 'BUY'), 'Cash-Gegenbuchung + Einzahlung erzeugt');
  ok(buys[0].group && allAccTx().filter(t => t.group === buys[0].group).length === 2, 'Buchungen korrekt gruppiert (Depot+Cash+Einzahlung)');

  console.log('\n[4] Echtzeitkurs-Pfad & KPIs');
  await tick(60);
  ok($('#liveDot').className.indexOf('on') >= 0, 'Live-Indikator aktiv nach Kursabruf');
  ok(T.quotesAsked.length > 0 && T.quotesAsked.flat().indexOf('VWCE.DE') >= 0, 'Yahoo-Abfrage mit Symbol VWCE.DE ausgelöst');
  const kpi = $('#kpiGrid').textContent;
  ok(/1\.000/.test(kpi), 'KPI Gesamtwert ≈ 1.000 € (10 × Live 100 €)  [' + kpi.replace(/\s+/g, ' ').slice(0, 60) + ']');
  ok($('#securitiesTable').textContent.includes('Vanguard All-World'), 'Position erscheint in Wertpapier-Tabelle');

  console.log('\n[5] Sparplan anlegen + automatische Buchung');
  win.openAdd('plan'); await tick();
  ok(form(), 'Sparplan-Modal offen');
  setF('amount', '100'); setF('interval', '1'); setF('start', '2024-01-05');
  submit(); await tick(150);
  ok(pf().plans.length === 1, 'Sparplan gespeichert');
  const gen = allPfTx().filter(t => t._generated);
  ok(gen.length > 0, gen.length + ' fällige Sparplan-Raten automatisch in die Portfolio-Datei gebucht');
  ok(pf().accounts.some(a => a.transactions.some(t => t._generated)), 'Cash-Gegenbuchungen der Raten ebenfalls gespeichert');

  console.log('\n[6] Buchung bearbeiten');
  const buyTx = allPfTx().find(t => t.type === 'BUY' && !t._generated);
  win.editTxRow(buyTx.uuid); await tick();
  ok(form() && form().elements['shares'].value == '10', 'Bearbeiten-Modal vorbefüllt (10 Stück)');
  setF('shares', '20'); submit(); await tick(120);
  const buys2 = allPfTx().filter(t => t.type === 'BUY' && !t._generated);
  ok(buys2.length === 1 && Math.abs(buys2[0].shares - 20) < 1e-9, 'Kauf geändert auf 20 Stück (alte Buchung ersetzt)');

  console.log('\n[7] Buchung löschen');
  const before = allPfTx().length + allAccTx().length;
  const delTx = allPfTx().find(t => t.type === 'BUY' && !t._generated);
  win.deleteTxRow(delTx.uuid, delTx.group); await tick(120);
  ok(!allPfTx().some(t => t.uuid === delTx.uuid), 'Kauf gelöscht');
  ok((allPfTx().length + allAccTx().length) < before, 'Zugehörige Gruppen-Buchungen mitgelöscht');

  console.log('\n[8] Cash-Buchung (Einzahlung) über Segment-Umschalter');
  win.openAdd('tx'); await tick();
  const depBtn = doc.querySelector('#kindSeg button[data-k="DEPOSIT"]');
  ok(depBtn, 'Segment „Einzahlung" vorhanden');
  click(depBtn); await tick();
  setF('amount', '500'); submit(); await tick(80);
  ok(allAccTx().some(t => t.type === 'DEPOSIT' && Math.abs(t.amount - 500) < 1e-9), 'Einzahlung 500 € gebucht');

  console.log('\n[9] Konto anlegen');
  const accBefore = pf().accounts.length;
  win.openAdd('account'); await tick();
  setF('name', 'Tagesgeld TR'); setF('kind', 'TAGESGELD'); submit(); await tick(80);
  ok(pf().accounts.length === accBefore + 1, 'Neues Konto angelegt');

  console.log('\n[10] Privatsphäre-Modus');
  await win.setPrivacy(true); await tick();
  ok($('#kpiGrid').textContent.includes('•'), 'Beträge im KPI maskiert (•••)');
  await win.setPrivacy(false); await tick();
  ok(!$('#kpiGrid').textContent.includes('•'), 'Maskierung wieder aufgehoben');

  console.log('\n[11] Navigation durch alle Ansichten');
  for (const v of ['securities', 'transactions', 'plans', 'accounts', 'dashboard']) {
    win.switchView(v); await tick();
    ok($('#view-' + v).classList.contains('active'), 'Ansicht „' + v + '" aktiv');
  }

  console.log('\n[12] Speicherort-Dialog beim Anlegen');
  ok((T.saveAsCount || 0) >= 1, 'Beim Erstellen wurde der Speichern-Dialog (saveAs) aufgerufen');
  ok(/MeinPortfolio/.test($('#dataPath').textContent), 'Portfolio-Name in Seitenleiste angezeigt: ' + $('#dataPath').textContent);

  console.log('\n[13] Neues Portfolio im laufenden Betrieb');
  win.startNewPortfolio(); await tick();
  ok($('#typeGrid'), 'Wizard erscheint erneut für neues Portfolio');
  const saBefore = T.saveAsCount || 0;
  const c2 = doc.querySelector('.type-card[data-k="AKTIE"]'); if (c2) click(c2);
  click($('#wzNext')); await tick();
  $('#wzYear').value = '2023'; click($('#wzFinish')); await tick(440);
  ok((T.saveAsCount || 0) === saBefore + 1, 'Speichern-Dialog für neues Portfolio aufgerufen');
  ok(pf().securities.length === 0, 'Neues Portfolio ist leer (frisch)');

  console.log('\n[14] Portfolio öffnen (Moduswechsel)');
  await win.openPortfolioFile(); await tick(120);
  ok($('#addBtn') && !$('#addBtn').hidden, 'Nach „Öffnen" wieder im nativen Modus');
  ok(!$('#portfolioActions').hidden, '„+ Neu / Öffnen"-Leiste sichtbar');

  console.log('\n[15] Buttons feuern über echten DOM-Klick (CSP-sicher, kein inline onclick)');
  // Inline onclick wird von der CSP (script-src 'self') blockiert -> alle Buttons müssen
  // über data-act + Event-Delegation laufen. Hier echten Klick statt Direktaufruf testen.
  ok(!/\son\w+\s*=\s*["']/.test(doc.body.innerHTML), 'Kein inline-Event-Handler im gerenderten DOM');
  win.switchView('transactions'); await tick();
  const addTxBtn = $('#txAddBtn');
  ok(addTxBtn && !addTxBtn.hidden && addTxBtn.dataset.act === 'add', '„+ Buchung" nutzt data-act (kein onclick)');
  click(addTxBtn); await tick();
  ok(form(), 'Echter Klick auf „+ Buchung" öffnet das Buchungs-Modal');
  const cancel = doc.querySelector('[data-act="close"]');
  ok(cancel, '„Abbrechen" nutzt data-act="close"');
  click(cancel); await tick();
  ok(!form(), 'Echter Klick auf „Abbrechen" schließt das Modal');

  console.log('\n[16] Laufzeitfehler (Exceptions/Rejections im DOM)');
  ok(errors.length === 0, errors.length === 0 ? 'Keine Laufzeitfehler' : (errors.length + ' Fehler: ' + errors.slice(0, 5).join(' | ')));

  console.log(`\n==== Ergebnis: ${pass} bestanden, ${fail} fehlgeschlagen ====`);
  if (errors.length) { console.log('\nGefundene Fehler:'); errors.slice(0, 12).forEach(e => console.log('  • ' + e)); }
  process.exitCode = fail || errors.length ? 1 : 0;
}

run().catch(e => { console.error('Harness-Absturz:', e); process.exitCode = 1; });
