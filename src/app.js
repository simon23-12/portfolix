'use strict';
/* Portfolix – Renderer-Hauptlogik */

const State = {
  data: null,
  store: { bookedPlanTx: [], symbolOverrides: {}, lastRun: {} },
  liveBySec: {},      // uuid -> {price, previousClose, currency, isLive}
  fxRates: { EUR: 1 },
  positions: null,
  cash: null,
  val: null,
  equity: [],
  charts: {},
  range: 0,
  privacy: false,
  mode: null   // 'native' | 'import'
};

const MASK = '••••• €';
const MASK_S = '•••';

/* ----------------------------- Formatierung ----------------------------- */
const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nfShares = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
function eur(v) { if (State.privacy) return MASK; return (v == null || isNaN(v)) ? '–' : nf.format(v) + ' €'; }
function eur0(v) { if (State.privacy) return MASK; return (v == null || isNaN(v)) ? '–' : nf0.format(v) + ' €'; }
function pct(v) { return (v == null || isNaN(v)) ? '–' : (v >= 0 ? '+' : '') + nf.format(v * 100) + ' %'; }
function shares(v) { if (State.privacy) return MASK_S; return nfShares.format(v); }
function cls(v) { return v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : ''; }
function sign(v) { return v >= 0 ? '+' : ''; }
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function dateDE(s) { if (!s) return '–'; const d = new Date(s.length <= 10 ? s + 'T00:00' : s); return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

const PALETTE = ['#5b8def', '#7c5cff', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#60a5fa', '#c084fc', '#2dd4bf'];
function colorFor(key) {
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name) {
  const w = name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  if (!w[0]) return '?';
  return (w[0][0] + (w[1] ? w[1][0] : (w[0][1] || ''))).toUpperCase();
}
function assetIcon(name) {
  return `<div class="asset-ico" style="background:${colorFor(name)}">${esc(initials(name))}</div>`;
}

function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 3200);
}

/* ----------------------------- Initialisierung ----------------------------- */
async function init() {
  try {
    State.store = Object.assign({ bookedPlanTx: [], symbolOverrides: {}, lastRun: {} }, await window.portfolix.loadStore());
    if (!State.store.symbolOverrides) State.store.symbolOverrides = {};
    State.privacy = !!State.store.privacy;
    updatePrivacyBtn();
    initUpdates();
    const { mode, nativeExists } = await window.portfolix.getMode();
    if (mode === 'native' && nativeExists) {
      const nd = await window.portfolix.loadPortfolio();
      if (nd) { bootNative(nd); return; }
    }
    if (mode === 'import') {
      const res = await window.portfolix.loadXml();
      if (res && res.xml) { bootWithXml(res); return; }
    }
    showWelcome();
  } catch (err) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--down);max-width:600px;text-align:center;padding:30px">Fehler beim Laden:<br><br>${esc(err.message || String(err))}</div>`;
    console.error(err);
  }
}

function bootWithXml(res) {
  State.mode = 'import';
  window.portfolix.setMode('import');
  State.data = PP.parse(res.xml);
  document.getElementById('dataPath').textContent = res.path || '';
  finishBoot();
}

function bootNative(data) {
  State.mode = 'native';
  State.data = data;
  document.getElementById('dataPath').textContent = 'Eigenes Portfolio';
  finishBoot();
}

function finishBoot() {
  const native = State.mode === 'native';
  document.getElementById('addBtn').hidden = !native;
  document.getElementById('txAddBtn').hidden = !native;
  SavingsPlan.merge(State.data, State.store);
  recompute();
  renderAll();
  document.getElementById('loading').style.display = 'none';
  refreshQuotes();
}

async function persistData() {
  if (State.mode !== 'native') return;
  // generierte Sparplan-Buchungen liegen im Store und werden beim Laden gemischt
  const clone = Builder.serializable(State.data);
  for (const pf of clone.portfolios) pf.transactions = pf.transactions.filter(t => !t._generated);
  for (const a of clone.accounts) a.transactions = a.transactions.filter(t => !t._generated);
  await window.portfolix.savePortfolio(clone);
}

/* ----------------------------- Onboarding / Wizard ----------------------------- */
function showWelcome() {
  const el = document.getElementById('loading');
  el.style.display = 'grid';
  el.innerHTML = `<div class="onboard" style="max-width:640px">
    <div class="logo">P</div>
    <h2>Willkommen bei Portfolix</h2>
    <p>Wie möchtest du starten? Deine Daten bleiben immer lokal auf deinem Rechner.</p>
    <div class="choice-grid">
      <button class="choice" id="choiceNew">
        <div class="ic">✨</div>
        <h4>Neues Portfolio anlegen</h4>
        <p>Bei Null anfangen: Assets wählen und deine Käufe, Verkäufe und Sparpläne rückwirkend eintragen.</p>
      </button>
      <button class="choice" id="choiceImport">
        <div class="ic">📂</div>
        <h4>Portfolio-Performance importieren</h4>
        <p>Du hast bereits eine <code>.xml</code> aus Portfolio Performance? Direkt einlesen und auswerten.</p>
      </button>
    </div>
  </div>`;
  document.getElementById('choiceImport').addEventListener('click', async () => {
    const r = await window.portfolix.pickXml();
    if (r && r.xml) { State.liveBySec = {}; el.innerHTML = '<div class="spinner"></div>'; bootWithXml(r); }
  });
  document.getElementById('choiceNew').addEventListener('click', () => wizardStep1());
}

const WIZARD_TYPES = [
  { key: 'AKTIE', e: '📊', t: 'Aktien', s: 'Einzelaktien' },
  { key: 'ETF', e: '🧺', t: 'ETFs / Fonds', s: 'Indexfonds' },
  { key: 'KRYPTO', e: '₿', t: 'Krypto (Coins)', s: 'BTC, ETH …' },
  { key: 'KRYPTO_SONST', e: '🎨', t: 'Krypto: NFTs / Sonstiges', s: 'manuell bewertet' },
  { key: 'TAGESGELD', e: '🏦', t: 'Tagesgeld / Cash', s: 'Zinskonto' },
  { key: 'IMMOBILIE', e: '🏠', t: 'Immobilien', s: 'manuell bewertet' }
];
const wizardState = { types: new Set(), start: '' };

function wizardStep1() {
  const el = document.getElementById('loading');
  el.innerHTML = `<div class="onboard wizard">
    <div class="steps-dots"><i class="on"></i><i></i></div>
    <h2>Was hältst (oder hieltest) du?</h2>
    <p>Wähle alle Anlageklassen, die du tracken willst – du kannst später jederzeit mehr hinzufügen.</p>
    <div class="type-grid" id="typeGrid">
      ${WIZARD_TYPES.map(x => `<div class="type-card" data-k="${x.key}"><span class="e">${x.e}</span><div class="t"><b>${x.t}</b><span>${x.s}</span></div><span class="chk">✓</span></div>`).join('')}
    </div>
    <div class="modal-foot" style="margin-top:22px">
      <button class="btn" id="wzBack">Zurück</button>
      <button class="btn primary" id="wzNext">Weiter</button>
    </div>
  </div>`;
  el.querySelectorAll('.type-card').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.k;
    if (wizardState.types.has(k)) { wizardState.types.delete(k); c.classList.remove('on'); }
    else { wizardState.types.add(k); c.classList.add('on'); }
  }));
  wizardState.types.forEach(k => { const c = el.querySelector(`[data-k="${k}"]`); if (c) c.classList.add('on'); });
  document.getElementById('wzBack').addEventListener('click', showWelcome);
  document.getElementById('wzNext').addEventListener('click', () => {
    if (!wizardState.types.size) { toast('Bitte mindestens eine Anlageklasse wählen', 'err'); return; }
    wizardStep2();
  });
}

function wizardStep2() {
  const el = document.getElementById('loading');
  const now = new Date();
  const defYear = now.getFullYear() - 1;
  el.innerHTML = `<div class="onboard wizard" style="max-width:520px">
    <div class="steps-dots"><i></i><i class="on"></i></div>
    <h2>Seit wann investierst du?</h2>
    <p>Wichtig für die Wertentwicklung. Du kannst Buchungen später auch früher datieren.</p>
    <div class="field-row" style="max-width:320px;margin:8px auto 0">
      <div class="field"><label>Monat</label><select id="wzMonth">${
        ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
          .map((m, i) => `<option value="${i + 1}" ${i === 0 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Jahr</label><select id="wzYear">${
        Array.from({ length: 26 }, (_, i) => now.getFullYear() - i).map(y => `<option ${y === defYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot" style="margin-top:26px">
      <button class="btn" id="wzBack">Zurück</button>
      <button class="btn primary" id="wzFinish">Portfolio erstellen</button>
    </div>
  </div>`;
  document.getElementById('wzBack').addEventListener('click', wizardStep1);
  document.getElementById('wzFinish').addEventListener('click', async () => {
    const m = String(document.getElementById('wzMonth').value).padStart(2, '0');
    const y = document.getElementById('wzYear').value;
    wizardState.start = `${y}-${m}-01`;
    el.innerHTML = '<div class="spinner"></div>';
    const data = Builder.createPortfolio({ startDate: wizardState.start, assetTypes: [...wizardState.types] });
    // Tagesgeld-Konto anlegen, falls gewählt
    if (wizardState.types.has('TAGESGELD')) Builder.addAccount(data, { name: 'Tagesgeld', currency: 'EUR', kind: 'TAGESGELD' });
    await window.portfolix.setMode('native');
    State.mode = 'native';
    State.data = data;
    await persistData();
    document.getElementById('dataPath').textContent = 'Eigenes Portfolio';
    finishBoot();
    setTimeout(() => { switchView('securities'); toast('Portfolio erstellt – füge jetzt dein erstes Asset hinzu', 'ok'); }, 300);
  });
}

/* ------------------------------ Auto-Update ------------------------------- */
async function initUpdates() {
  try {
    const v = await window.portfolix.version();
    const el = document.getElementById('appVersion');
    if (el) el.textContent = 'Version ' + v;
  } catch { /* egal */ }
  window.portfolix.onUpdateStatus(handleUpdateStatus);
}

function handleUpdateStatus(p) {
  const bar = document.getElementById('updateBar');
  const msg = document.getElementById('updateMsg');
  const installBtn = document.getElementById('updateInstall');
  if (!bar) return;
  switch (p.state) {
    case 'available':
      msg.textContent = `Neue Version ${p.version || ''} verfügbar – wird im Hintergrund geladen…`;
      installBtn.hidden = true; bar.hidden = false; break;
    case 'downloading':
      msg.textContent = `Update wird geladen… ${p.percent != null ? p.percent + ' %' : ''}`;
      installBtn.hidden = true; bar.hidden = false; break;
    case 'ready':
      msg.textContent = `Update ${p.version || ''} ist bereit.`;
      installBtn.hidden = false; bar.hidden = false; break;
    case 'error':
      // still scheitern lassen – kein Banner, nur Log
      console.warn('Update-Fehler:', p.message); break;
    default: break; // checking / none / dev: nichts anzeigen
  }
}

function recompute() {
  State.positions = Model.buildPositions(State.data);
  State.cash = Model.cashStats(State.data);
  State.val = Model.valuate(State.data, State.positions, State.liveBySec, State.fxRates);
  State.equity = Model.equityCurve(State.data, State.fxRates);
}

/* ----------------------------- Kurse aktualisieren ----------------------------- */
async function refreshQuotes() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spin'); btn.disabled = true;
  try {
    // Symbole sammeln (Wertpapiere mit Bestand + Sparplan-Wertpapiere)
    const symMap = new Map();   // symbol -> [secUuid,...]
    for (const sec of State.data.securities) {
      const sym = Model.yahooSymbol(sec, State.store.symbolOverrides);
      if (!sym) continue;
      if (!symMap.has(sym)) symMap.set(sym, []);
      symMap.get(sym).push(sec.uuid);
    }
    const symbols = [...symMap.keys()];
    const quotes = await window.portfolix.fetchQuotes(symbols);

    // Ergebnis auf Wertpapiere mappen
    const live = {};
    const neededCur = new Set();
    for (const [sym, uuids] of symMap) {
      const q = quotes[sym];
      if (!q || q.error || q.price == null) continue;
      for (const u of uuids) live[u] = { price: q.price, previousClose: q.previousClose, currency: q.currency, isLive: true };
      if (q.currency && q.currency.toUpperCase() !== 'EUR') neededCur.add(q.currency.toUpperCase());
    }
    State.liveBySec = live;

    // Native Assets: Kurshistorie nachladen (für die Wertkurve) + heutigen Kurs fortschreiben
    if (State.mode === 'native') await syncNativePrices(symMap, live);

    // FX-Kurse holen (… -> EUR)
    const fxSymbols = [];
    const fxMap = {};
    for (const cur of neededCur) {
      const base = cur === 'GBP PENCE' || cur === 'GBX' ? 'GBP' : cur;
      const fsym = `${base}EUR=X`;
      fxSymbols.push(fsym); fxMap[fsym] = cur;
    }
    if (fxSymbols.length) {
      const fx = await window.portfolix.fetchQuotes(fxSymbols);
      for (const fsym of fxSymbols) {
        const q = fx[fsym];
        if (q && q.price) State.fxRates[fxMap[fsym]] = q.price;
      }
    }

    // Sparpläne: fällige Käufe automatisch buchen
    const booked = autoBookDuePlans();

    State.store.lastRun.quotes = Date.now();
    await window.portfolix.saveStore(State.store);
    await persistData();

    recompute();
    renderAll();

    const liveCount = Object.keys(live).length;
    setLive(liveCount > 0);
    document.getElementById('lastUpdate').innerHTML =
      `Aktualisiert: ${new Date().toLocaleTimeString('de-DE')}<br>${liveCount} Live-Kurse${booked ? ` · ${booked} Sparplan-Käufe gebucht` : ''}`;
    if (booked) toast(`${booked} fällige Sparplan-Ausführung(en) automatisch gebucht`, 'ok');
    else toast(`${liveCount} Live-Kurse geladen`, liveCount ? 'ok' : 'err');
  } catch (err) {
    console.error(err);
    toast('Kurse konnten nicht geladen werden: ' + (err.message || err), 'err');
  } finally {
    btn.classList.remove('spin'); btn.disabled = false;
  }
}

function upsertPrice(sec, day, v) {
  const i = sec.prices.findIndex(p => p.t === day);
  if (i >= 0) sec.prices[i].v = v;
  else { sec.prices.push({ t: day, v }); sec.prices.sort((a, b) => a.t < b.t ? -1 : 1); }
}

// Native Assets: Historie nachladen + heutigen Live-Kurs als Punkt fortschreiben
async function syncNativePrices(symMap, live) {
  const today = todayStr();
  for (const sec of State.data.securities) {
    const l = live[sec.uuid];
    if (l && l.price != null) upsertPrice(sec, today, l.price);
  }
  const need = State.data.securities.filter(s => !s.manual && s.prices.length < 5 && Model.yahooSymbol(s, State.store.symbolOverrides));
  for (const sec of need) {
    const sym = Model.yahooSymbol(sec, State.store.symbolOverrides);
    const res = await window.portfolix.fetchHistory({ symbol: sym, range: 'max', interval: '1wk' });
    if (res && res.points && res.points.length) {
      const map = new Map(sec.prices.map(p => [p.t, p.v]));
      for (const p of res.points) map.set(new Date(p.t).toISOString().slice(0, 10), p.c);
      sec.prices = [...map.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t < b.t ? -1 : 1);
      if (res.currency) sec.currency = res.currency;
    }
  }
}

function setLive(on) {
  const d = document.getElementById('liveDot');
  d.className = 'live-dot' + (on ? ' on' : '');
  d.querySelector('span').textContent = on ? 'Live-Kurse aktiv (Yahoo Finance)' : 'Kurse: lokal gespeichert';
}

function priceLookupEUR(secUuid, day) {
  const sec = State.data.securities.find(s => s.uuid === secUuid);
  if (!sec) return null;
  const today = new Date().toISOString().slice(0, 10);
  const live = State.liveBySec[secUuid];
  if (day >= today && live && live.price != null) {
    const c = (live.currency || 'EUR').toUpperCase();
    return live.price * (c === 'EUR' ? 1 : (State.fxRates[c] || 1));
  }
  const p = Model.priceAt(sec.prices, day);
  const c = (sec.currency || 'EUR').toUpperCase();
  if (p != null) return p * (c === 'EUR' ? 1 : (State.fxRates[c] || 1));
  if (live && live.price != null) return live.price;
  return null;
}

function autoBookDuePlans() {
  const due = SavingsPlan.findDue(State.data, State.data.plans, State.store, priceLookupEUR);
  if (!due.length) return 0;
  State.store.bookedPlanTx.push(...due);
  SavingsPlan.applyRecords(State.data, due);
  return due.length;
}

/* ----------------------------- Rendering ----------------------------- */
function renderAll() {
  renderKPIs();
  renderEquity();
  renderAlloc();
  renderDashPositions();
  renderSecurities();
  renderTransactions();
  renderPlans();
  renderAccounts();
}

function totalCash() {
  let c = 0; for (const [, b] of State.cash.balances) c += b; return c;
}

function renderKPIs() {
  const v = State.val;
  const cash = totalCash();
  const total = v.totalValue + cash;
  const invested = State.cash.netDeposits;
  const pl = total - invested;
  const plPct = invested ? pl / invested : 0;
  const dayChange = v.rows.reduce((a, r) => a + (r.dayChangePct != null ? r.value * r.dayChangePct : 0), 0);
  const dayBase = v.rows.reduce((a, r) => a + (r.dayChangePct != null ? r.value : 0), 0);
  const dayPct = dayBase ? dayChange / dayBase : null;

  const cards = [
    { hero: true, label: 'Gesamtvermögen', value: eur(total),
      delta: `<span class="pill ${cls(pl)}">${sign(pl)}${eur(pl)} · ${pct(plPct)}</span>` },
    { label: 'Wertpapiere', value: eur(v.totalValue),
      delta: dayPct != null ? `<span class="${cls(dayPct)}">${sign(dayChange)}${eur(dayChange)} heute (${pct(dayPct)})</span>` : '<span class="muted">heute –</span>' },
    { label: 'Eingezahlt', value: eur(invested), delta: `<span class="muted">netto seit ${State.equity[0] ? dateDE(State.equity[0].date) : '–'}</span>` },
    { label: 'Gewinn / Verlust', value: `<span class="${cls(pl)}">${sign(pl)}${eur(pl)}</span>`, delta: `<span class="pill ${cls(plPct)}">${pct(plPct)}</span>` },
    { label: 'Dividenden gesamt', value: eur(State.cash.dividends), delta: '<span class="muted">vereinnahmt</span>' },
    { label: 'Liquidität (Cash)', value: eur(cash), delta: `<span class="muted">${State.data.accounts.length} Konten</span>` }
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi ${c.hero ? 'hero' : ''}">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="delta">${c.delta}</div>
    </div>`).join('');
}

function chartBase() {
  Chart.defaults.color = '#97a3b6';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.borderColor = '#1a212b';
}

function renderEquity() {
  chartBase();
  const ctx = document.getElementById('equityChart');
  let series = State.equity;
  if (State.range > 0) series = series.slice(-State.range);
  const labels = series.map(p => p.date);
  const value = series.map(p => p.value);
  const invested = series.map(p => p.invested);

  if (State.charts.equity) State.charts.equity.destroy();
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, 'rgba(91,141,239,.35)');
  grad.addColorStop(1, 'rgba(91,141,239,0)');

  State.charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Depotwert', data: value, borderColor: '#5b8def', backgroundColor: grad, fill: true, tension: .25, pointRadius: 0, borderWidth: 2 },
        { label: 'Eingezahlt', data: invested, borderColor: '#5d6878', borderDash: [5, 5], fill: false, tension: .1, pointRadius: 0, borderWidth: 1.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.parsed.y)}`, title: items => dateDE(items[0].label) } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true, callback: (v, i) => { const d = new Date(labels[i]); return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }); } } },
        y: { grid: { color: '#161b24' }, ticks: { callback: v => State.privacy ? '•••' : nf0.format(v) + ' €' } }
      }
    }
  });
}

function renderAlloc() {
  chartBase();
  const rows = State.val.rows.slice();
  const cash = totalCash();
  const data = rows.map(r => ({ name: r.name, value: r.value, color: colorFor(r.name) }));
  if (cash > 1) data.push({ name: 'Cash', value: cash, color: '#5d6878' });
  const total = data.reduce((a, d) => a + d.value, 0);

  const ctx = document.getElementById('allocChart');
  if (State.charts.alloc) State.charts.alloc.destroy();
  State.charts.alloc = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderColor: '#11161e', borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${eur(c.parsed)} (${nf.format(c.parsed / total * 100)} %)` } } }
    }
  });
  document.getElementById('allocLegend').innerHTML = data.sort((a, b) => b.value - a.value).map(d => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px">
      <span style="width:9px;height:9px;border-radius:50%;background:${d.color}"></span>
      <span style="flex:1">${esc(d.name)}</span>
      <span class="muted" style="font-family:var(--mono)">${nf.format(d.value / total * 100)} %</span>
    </div>`).join('');
}

function positionsTable(rows, maxValue) {
  return `<table>
    <thead><tr>
      <th>Position</th><th>Stück</th><th>Kurs</th><th>Heute</th><th>Wert</th><th>Ø Kaufkurs</th><th>G/V</th><th>Anteil</th>
    </tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td><div class="asset-cell">${assetIcon(r.name)}<div><div class="asset-name">${esc(r.name)}</div><div class="asset-meta">${esc(r.isin || r.ticker || '')}${r.isLive ? ' · <span class="up">live</span>' : ''}</div></div></div></td>
      <td>${shares(r.shares)}</td>
      <td>${nf.format(r.price)} ${r.currency !== 'EUR' ? esc(r.currency) : '€'}</td>
      <td class="${r.dayChangePct != null ? cls(r.dayChangePct) : 'muted'}">${r.dayChangePct != null ? pct(r.dayChangePct) : '–'}</td>
      <td>${eur(r.value)}</td>
      <td class="muted">${eur(r.avgCost)}</td>
      <td class="${cls(r.pl)}">${sign(r.pl)}${eur(r.pl)}<br><span style="font-size:11px">${pct(r.plPct)}</span></td>
      <td><div class="bar" style="width:80px"><span style="width:${Math.max(3, r.value / maxValue * 100)}%"></span></div></td>
    </tr>`).join('')}
    </tbody></table>`;
}

function emptyState(emoji, title, text, kind, btn) {
  return `<div class="empty"><div style="font-size:34px;margin-bottom:10px">${emoji}</div>
    <div style="font-size:16px;color:var(--text);font-weight:600;margin-bottom:6px">${esc(title)}</div>
    <div style="max-width:400px;margin:0 auto 16px">${esc(text)}</div>
    ${State.mode === 'native' && kind ? `<button class="btn primary" onclick="openAdd('${kind}')">${esc(btn)}</button>` : ''}</div>`;
}
function addToolbar(buttons) {
  if (State.mode !== 'native') return '';
  return `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px">${
    buttons.map(b => `<button class="btn sm ${b.primary ? 'primary' : ''}" onclick="openAdd('${b.kind}')">${esc(b.label)}</button>`).join('')}</div>`;
}

function renderDashPositions() {
  const rows = State.val.rows;
  if (!rows.length) {
    document.getElementById('dashPositions').innerHTML = emptyState('📈', 'Noch keine Positionen',
      'Lege dein erstes Asset an und erfasse deine Käufe – manuell oder per Sparplan.', 'asset', 'Asset hinzufügen');
    return;
  }
  document.getElementById('dashPositions').innerHTML = positionsTable(rows, rows[0].value);
}

function renderSecurities() {
  const rows = State.val.rows;
  const maxV = rows.length ? rows[0].value : 1;
  let html = addToolbar([{ kind: 'tx', label: '+ Buchung' }, { kind: 'asset', label: '+ Asset', primary: true }]);
  if (!rows.length) {
    html += emptyState('◆', 'Noch keine Wertpapiere', 'Füge dein erstes Asset hinzu – Aktie, ETF, Krypto, NFT oder z.B. eine Immobilie.', 'asset', 'Asset hinzufügen');
    document.getElementById('securitiesTable').innerHTML = html;
    renderSymbolEditors();
    return;
  }
  html += positionsTable(rows, maxV);
  // verkaufte / leere Positionen mit realisiertem G/V
  const closed = [];
  for (const [uuid, pos] of State.positions) {
    if (pos.shares > 0) continue;
    const sec = State.data.securities.find(s => s.uuid === uuid);
    if (sec && Math.abs(pos.realized) > 0.01) closed.push({ name: sec.name, realized: pos.realized });
  }
  if (closed.length) {
    html += `<h2 style="margin-top:22px">Geschlossene Positionen</h2><table><thead><tr><th>Position</th><th>Realisierter G/V</th></tr></thead><tbody>${
      closed.map(c => `<tr><td><div class="asset-cell">${assetIcon(c.name)}<span class="asset-name">${esc(c.name)}</span></div></td><td class="${cls(c.realized)}">${sign(c.realized)}${eur(c.realized)}</td></tr>`).join('')}</tbody></table>`;
  }
  document.getElementById('securitiesTable').innerHTML = html;
  renderSymbolEditors();
}

function renderSymbolEditors() {
  const el = document.getElementById('symbolEditors');
  if (!el) return;
  el.innerHTML = `<table><thead><tr><th>Wertpapier</th><th>ISIN</th><th>Yahoo-Symbol</th><th>Status</th></tr></thead><tbody>
    ${State.data.securities.map(s => {
      const sym = Model.yahooSymbol(s, State.store.symbolOverrides) || '';
      const live = State.liveBySec[s.uuid];
      const status = live && live.price != null
        ? `<span class="up">● live ${nf.format(live.price)} ${esc(live.currency || '')}</span>`
        : '<span class="muted">○ kein Live-Kurs</span>';
      return `<tr>
        <td><div class="asset-cell">${assetIcon(s.name)}<span class="asset-name" style="font-size:13px">${esc(s.name)}</span></div></td>
        <td class="muted">${esc(s.isin || '–')}</td>
        <td style="text-align:left"><input class="symInput" data-uuid="${s.uuid}" value="${esc(sym)}" style="background:var(--bg-elev);border:1px solid var(--line);color:var(--text);padding:6px 9px;border-radius:6px;font-family:var(--mono);width:140px" /></td>
        <td style="text-align:left">${status}</td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

/* ---- Transaktionen ---- */
let _txCache = null;
function renderTransactions() {
  _txCache = Model.flattenTransactions(State.data);
  const typeSel = document.getElementById('txType');
  if (typeSel.options.length <= 1) {
    const types = [...new Set(_txCache.map(t => t.type))].sort();
    typeSel.innerHTML = '<option value="">Alle Typen</option>' + types.map(t => `<option value="${t}">${TX_LABEL[t] || t}</option>`).join('');
  }
  applyTxFilter();
}

const TX_LABEL = { BUY: 'Kauf', SELL: 'Verkauf', DEPOSIT: 'Einzahlung', REMOVAL: 'Auszahlung', DIVIDENDS: 'Dividende', TAXES: 'Steuern', TAX_REFUND: 'Steuererstattung', INTEREST: 'Zinsen', TRANSFER_IN: 'Übertrag ein', TRANSFER_OUT: 'Übertrag aus', DELIVERY_INBOUND: 'Einlieferung', DELIVERY_OUTBOUND: 'Auslieferung', STOCK_SPLIT: 'Aktiensplit', FEES: 'Gebühren' };
function txTag(t) {
  const k = t.type;
  let c = '';
  if (k === 'BUY' || k === 'DELIVERY_INBOUND' || k === 'TRANSFER_IN') c = 'buy';
  else if (k === 'SELL' || k === 'DELIVERY_OUTBOUND' || k === 'TRANSFER_OUT' || k === 'REMOVAL') c = 'sell';
  else if (k === 'DEPOSIT') c = 'dep';
  else if (k === 'DIVIDENDS') c = 'div';
  return `<span class="tag ${c}">${TX_LABEL[k] || k}</span>`;
}

// Zusammengehörige Buchungen (Kauf = Depot + Cash + Einzahlung) auf eine Zeile reduzieren
function buildTxDisplay() {
  const byGroup = new Map();
  for (const t of _txCache) if (t.group) { if (!byGroup.has(t.group)) byGroup.set(t.group, []); byGroup.get(t.group).push(t); }
  const rep = new Map();
  for (const [g, arr] of byGroup) rep.set(g, arr.find(t => t.scope === 'Depot') || arr.find(t => t.type !== 'DEPOSIT') || arr[0]);
  return _txCache.filter(t => !t.group || rep.get(t.group) === t);
}

function applyTxFilter() {
  const q = document.getElementById('txSearch').value.toLowerCase();
  const type = document.getElementById('txType').value;
  const scope = document.getElementById('txScope').value;
  const editable = State.mode === 'native';
  let rows = buildTxDisplay().filter(t =>
    (!type || t.type === type) &&
    (!scope || t.scope === scope) &&
    (!q || (t.securityName || '').toLowerCase().includes(q) || (t.container || '').toLowerCase().includes(q)));
  document.getElementById('txCount').textContent = `${rows.length} Transaktionen`;
  if (!rows.length) {
    document.getElementById('txTable').innerHTML = _txCache.length
      ? '<div class="empty">Keine Treffer für diesen Filter.</div>'
      : emptyState('≡', 'Noch keine Buchungen', 'Erfasse deinen ersten Kauf, eine Einzahlung oder eine Dividende.', 'tx', 'Buchung erfassen');
    return;
  }
  const shown = rows.slice(0, 800);
  document.getElementById('txTable').innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Typ</th><th>Wertpapier / Konto</th><th>Stück</th><th>Betrag</th><th>Gebühr</th><th>Ort</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${shown.map(t => `<tr>
      <td style="text-align:left;font-family:var(--mono)">${dateDE(t.date)}</td>
      <td style="text-align:left">${txTag(t)}${t._generated ? ' <span class="tag gen">auto</span>' : ''}</td>
      <td style="text-align:left">${esc(t.securityName || '—')}</td>
      <td>${t.shares ? shares(t.shares) : '–'}</td>
      <td>${eur(t.amount)}</td>
      <td class="muted">${t.fee ? eur(t.fee) : '–'}</td>
      <td style="text-align:left" class="muted">${esc(t.container)}</td>
      ${editable ? `<td class="row-actions nowrap">${t._generated
        ? '<span class="muted" style="font-size:11px" title="Automatisch durch Sparplan gebucht">auto</span>'
        : `<button class="iconbtn" title="Bearbeiten" onclick="editTxRow('${t.uuid}')">✎</button><button class="iconbtn del" title="Löschen" onclick="deleteTxRow('${t.uuid}','${t.group || ''}')">🗑</button>`}</td>` : ''}
    </tr>`).join('')}
    </tbody></table>${rows.length > 800 ? `<div class="empty">… ${rows.length - 800} weitere ausgeblendet (Filter nutzen)</div>` : ''}`;
}

/* ---- Sparpläne ---- */
function renderPlans() {
  const cont = document.getElementById('plansContainer');
  const bar = addToolbar([{ kind: 'plan', label: '+ Sparplan', primary: true }]);
  if (!State.data.plans.length) {
    cont.innerHTML = bar + '<div class="panel">' + emptyState('↻', 'Noch keine Sparpläne',
      'Definiere einen Sparplan – Portfolix bucht alle fälligen Raten automatisch und rückwirkend ein.', 'plan', 'Sparplan anlegen') + '</div>';
    return;
  }
  const today = new Date();
  cont.innerHTML = bar + State.data.plans.map((plan, idx) => {
    const sched = SavingsPlan.scheduledDates(plan, today);
    const lastReal = SavingsPlan.lastRealExecution(State.data, plan);
    const booked = State.store.bookedPlanTx.filter(b => b.planName === plan.name);
    // nächster Termin
    let next = null;
    let d = new Date(plan.start.slice(0, 10));
    const ival = Math.max(1, plan.interval);
    while (d <= today) d = SavingsPlan.addMonths(d, ival);
    next = d;
    const intervalTxt = plan.interval === 1 ? 'monatlich' : plan.interval === 3 ? 'quartalsweise' : plan.interval === 12 ? 'jährlich' : `alle ${plan.interval} Monate`;
    const totalInvested = (lastReal ? sched.filter(s => s <= lastReal).length : 0) * plan.amount + booked.length * plan.amount;
    return `<div class="plan-card">
      <div class="plan-head">
        <div>
          <div class="plan-title">${assetIconInline(plan.securityName || plan.name)} ${esc(plan.name)}</div>
          <div class="plan-sub">${esc(plan.securityName || '')} · ${intervalTxt} · ${eur(plan.amount)} ${plan.fees ? `(inkl. ${eur(plan.fees)} Gebühr)` : ''}</div>
        </div>
        <div style="text-align:right">
          <span class="tag ${plan.autoGenerate ? 'buy' : ''}">${plan.autoGenerate ? '⟳ Auto-Buchung aktiv' : 'manuell'}</span>
        </div>
      </div>
      <div class="plan-stats">
        <div class="plan-stat"><div class="k">Start</div><div class="v">${dateDE(plan.start)}</div></div>
        <div class="plan-stat"><div class="k">Letzte Ausführung</div><div class="v">${lastReal ? dateDE(lastReal) : '–'}</div></div>
        <div class="plan-stat"><div class="k">Nächster Termin</div><div class="v">${dateDE(next.toISOString())}</div></div>
        <div class="plan-stat"><div class="k">Autom. gebucht</div><div class="v">${booked.length}</div></div>
      </div>
      ${booked.length ? `<div class="due-list"><div class="muted" style="margin-bottom:6px;font-size:12px">Automatisch eingespeiste Käufe:</div>${
        booked.slice().reverse().slice(0, 8).map(b => `<div class="due-row"><span>${dateDE(b.date)} · ${shares(b.shares)} Stück @ ${nf.format(b.price)} €</span><span class="up">${eur(b.amount)}</span></div>`).join('')
      }${booked.length > 8 ? `<div class="muted" style="font-size:12px;padding-top:6px">… und ${booked.length - 8} weitere</div>` : ''}</div>` : ''}
    </div>`;
  }).join('');
}
function assetIconInline(name) { return `<span class="asset-ico" style="display:inline-grid;width:22px;height:22px;font-size:10px;vertical-align:middle;background:${colorFor(name)}">${esc(initials(name))}</span>`; }

/* ---- Konten ---- */
function renderAccounts() {
  const accs = State.data.accounts.map(a => ({ name: a.name, currency: a.currency, balance: State.cash.balances.get(a.uuid) || 0, retired: a.isRetired, count: a.transactions.length }));
  const pfs = State.data.portfolios.map(p => ({ name: p.name, count: p.transactions.length }));
  document.getElementById('accountsTable').innerHTML = addToolbar([{ kind: 'account', label: '+ Konto' }, { kind: 'tx', label: '+ Buchung', primary: true }]) + `
    <table><thead><tr><th>Konto</th><th>Buchungen</th><th>Saldo</th></tr></thead><tbody>`+`
    ${accs.map(a => `<tr><td><div class="asset-cell"><div class="asset-ico" style="background:#5d6878">€</div><div><div class="asset-name">${esc(a.name)}</div><div class="asset-meta">${esc(a.currency)}${a.retired ? ' · stillgelegt' : ''}</div></div></div></td><td class="muted">${a.count}</td><td class="${cls(a.balance)}">${eur(a.balance)}</td></tr>`).join('')}
    </tbody></table>
    <h2 style="margin-top:22px">Depots</h2>
    <table><thead><tr><th>Depot</th><th>Transaktionen</th></tr></thead><tbody>
    ${pfs.map(p => `<tr><td><div class="asset-cell"><div class="asset-ico" style="background:${colorFor(p.name)}">◆</div><span class="asset-name">${esc(p.name)}</span></div></td><td class="muted">${p.count}</td></tr>`).join('')}
    </tbody></table>`;
}

/* ----------------------------- Editieren (Modals) ----------------------------- */
const pNum = (v) => Number(String(v == null ? '' : v).replace(',', '.').trim()) || 0;

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function openModal(title, bodyHTML, opts = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-ov"><div class="modal ${opts.cls || ''}">
    <div class="modal-head"><h3>${esc(title)}</h3><span class="x" title="Schließen">&times;</span></div>
    <form id="modalForm" autocomplete="off">${bodyHTML}</form></div></div>`;
  root.querySelector('.x').addEventListener('click', closeModal);
  root.querySelector('.modal-ov').addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-ov')) closeModal(); });
  const form = root.querySelector('#modalForm');
  form.addEventListener('submit', (e) => { e.preventDefault(); opts.onSubmit && opts.onSubmit(form); });
  opts.onReady && opts.onReady(form);
  const first = form.querySelector('input,select'); if (first) first.focus();
  return form;
}

function secOptions(sel) {
  return State.data.securities.map(s => `<option value="${s.uuid}" ${s.uuid === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function accountOptions(sel, kind) {
  let accs = State.data.accounts;
  if (kind === 'TAGESGELD') { const t = accs.find(a => a.kind === 'TAGESGELD'); if (t) sel = sel || t.uuid; }
  return accs.map(a => `<option value="${a.uuid}" ${a.uuid === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}
function portfolioOptions(sel) {
  return State.data.portfolios.map(p => `<option value="${p.uuid}" ${p.uuid === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function startStr() { return (State.data.meta && State.data.meta.startDate) || '2020-01-01'; }

async function afterEdit(opts = {}) {
  recompute(); renderAll(); await persistData();
  if (opts.refresh) refreshQuotes();
}

/* --- Asset / Wertpapier anlegen --- */
function modalAddAsset() {
  const typeOpts = Object.entries(Builder.TYPE).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  openModal('Asset hinzufügen', `
    <div class="field"><label>Anlageklasse</label><select name="type">${typeOpts}</select></div>
    <div class="field"><label>Name</label><input name="name" placeholder="z.B. Apple, MSCI World, Bitcoin, ETW Berlin" required></div>
    <div class="field-row">
      <div class="field"><label>ISIN / Kennung (optional)</label><input name="isin" placeholder="z.B. US0378331005"></div>
      <div class="field"><label>Währung</label><input name="currency" value="EUR"></div>
    </div>
    <div class="field" id="symField"><label>Yahoo-Finance-Symbol <span class="hint">für Echtzeitkurse</span></label>
      <input name="symbol" placeholder="z.B. AAPL, VWCE.DE, BTC-EUR"><div class="hint" id="symHint"></div></div>
    <div class="hint" id="manualHint" style="display:none">Manuell bewertetes Asset – den Wert trägst du danach als Buchung „Wertanpassung" ein.</div>
    <div class="modal-foot">
      <button type="button" class="btn" onclick="closeModal()">Abbrechen</button>
      <button type="submit" class="btn primary">Anlegen &amp; Buchung erfassen</button>
    </div>`, {
    onReady(form) {
      const sync = () => {
        const t = form.type.value;
        const tradeable = Builder.isTradeable(t);
        form.querySelector('#symField').style.display = tradeable ? '' : 'none';
        form.querySelector('#manualHint').style.display = tradeable ? 'none' : '';
        form.querySelector('#symHint').textContent = (Builder.TYPE[t] && Builder.TYPE[t].hintSymbol) || '';
      };
      form.type.addEventListener('change', sync); sync();
    },
    onSubmit(form) {
      const type = form.type.value;
      const sec = Builder.addSecurity(State.data, { name: form.elements['name'].value, type, isin: form.isin.value, currency: form.currency.value.trim() || 'EUR' });
      if (Builder.isTradeable(type) && form.symbol.value.trim()) {
        State.store.symbolOverrides[sec.uuid] = form.symbol.value.trim();
        window.portfolix.saveStore(State.store);
      }
      closeModal();
      afterEdit();
      modalAddTx({ preSec: sec.uuid, isNew: true });
    }
  });
}

/* --- Buchung erfassen --- */
const TX_KINDS = [['BUY', 'Kauf'], ['SELL', 'Verkauf'], ['DIVIDENDS', 'Dividende'], ['DEPOSIT', 'Einzahlung'], ['REMOVAL', 'Auszahlung'], ['INTEREST', 'Zinsen'], ['VALUE', 'Wertanpassung']];

function modalAddTx(opts = {}) {
  const pre = opts.prefill || null;
  const preSec = (pre && pre.sec) || opts.preSec || (State.data.securities[0] && State.data.securities[0].uuid);
  const initKind = (pre && pre.kind) || 'BUY';
  openModal(opts.title || 'Buchung erfassen', `
    <div class="field"><label>Art der Buchung</label><div class="seg" id="kindSeg">
      ${TX_KINDS.map(k => `<button type="button" data-k="${k[0]}" class="${k[0] === initKind ? 'on' : ''}">${k[1]}</button>`).join('')}
    </div></div>
    <div id="txBody"></div>
    <div class="modal-foot">
      <button type="button" class="btn" onclick="closeModal()">Abbrechen</button>
      <button type="submit" class="btn primary">${opts.replace ? 'Speichern' : 'Buchen'}</button>
    </div>`, {
    onReady(form) {
      let kind = initKind;
      let firstRender = true;
      const body = form.querySelector('#txBody');
      const render = () => {
        body.innerHTML = txFields(kind, preSec);
        if (firstRender && pre) applyPrefill(form, pre);
        wireCalc(form, kind);
        firstRender = false;
      };
      form.querySelectorAll('#kindSeg button').forEach(b => b.addEventListener('click', () => {
        form.querySelectorAll('#kindSeg button').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); kind = b.dataset.k; render();
      }));
      render();
      form._getKind = () => kind;
      form._replace = opts.replace || null;
    },
    onSubmit(form) { submitTx(form, form._getKind()); }
  });
}

function applyPrefill(form, p) {
  const set = (n, v) => { if (form.elements[n] != null && v != null && v !== '') form.elements[n].value = v; };
  set('sec', p.sec); set('shares', p.shares); set('price', p.price); set('fee', p.fee);
  set('date', p.date); set('amount', p.amount); set('acc', p.acc);
  if (form.elements['fund'] && p.fund != null) form.elements['fund'].checked = !!p.fund;
}

function txFields(kind, preSec) {
  const dateF = `<div class="field"><label>Datum</label><input type="date" name="date" value="${todayStr()}" min="2000-01-01"></div>`;
  const secSel = `<div class="field"><label>Asset</label><select name="sec">${secOptions(preSec)}</select></div>`;
  const acc = (k) => `<div class="field"><label>Konto</label><select name="acc">${accountOptions(null, k)}</select></div>`;
  const pf = State.data.portfolios.length > 1 ? `<div class="field"><label>Depot</label><select name="pf">${portfolioOptions()}</select></div>` : '';
  if (kind === 'BUY' || kind === 'SELL') {
    return `${secSel}${pf}
      <div class="field-row">
        <div class="field"><label>Stück / Anteil</label><input name="shares" inputmode="decimal" placeholder="z.B. 10" value="1"></div>
        <div class="field"><label>Kurs / Preis je Stück (€)</label><input name="price" inputmode="decimal" placeholder="z.B. 95,50"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Gebühr (€)</label><input name="fee" inputmode="decimal" value="0"></div>
        ${dateF}
      </div>
      ${kind === 'BUY' ? `<div class="field field-check"><input type="checkbox" name="fund" id="fund" checked><label for="fund" style="font-weight:500">Betrag wurde frisch eingezahlt (zählt als investiertes Kapital)</label></div>` : ''}
      <div class="calc-line" id="calc"></div>`;
  }
  if (kind === 'DIVIDENDS') {
    return `${secSel}${acc()}
      <div class="field-row"><div class="field"><label>Betrag (€)</label><input name="amount" inputmode="decimal" placeholder="z.B. 42,00"></div>${dateF}</div>`;
  }
  if (kind === 'VALUE') {
    const manualSecs = State.data.securities.filter(s => s.manual);
    const sel = manualSecs.map(s => `<option value="${s.uuid}">${esc(s.name)}</option>`).join('');
    return `<div class="field"><label>Manuelles Asset</label><select name="sec">${sel || '<option value="">— kein manuelles Asset vorhanden —</option>'}</select></div>
      <div class="field-row"><div class="field"><label>Aktueller Wert (€)</label><input name="amount" inputmode="decimal" placeholder="z.B. 360000"></div>${dateF}</div>
      <div class="hint">Setzt den aktuellen Marktwert (z.B. Immobilie, NFT) zum gewählten Datum.</div>`;
  }
  // DEPOSIT / REMOVAL / INTEREST
  return `${acc(kind === 'INTEREST' ? 'TAGESGELD' : null)}
    <div class="field-row"><div class="field"><label>Betrag (€)</label><input name="amount" inputmode="decimal" placeholder="z.B. 1000"></div>${dateF}</div>`;
}

function wireCalc(form, kind) {
  if (kind !== 'BUY' && kind !== 'SELL') return;
  const calc = form.querySelector('#calc'); if (!calc) return;
  const upd = () => {
    const sh = pNum(form.shares.value), pr = pNum(form.price.value), fee = pNum(form.fee.value);
    const gross = sh * pr;
    const total = kind === 'BUY' ? gross + fee : gross - fee;
    calc.textContent = `${kind === 'BUY' ? 'Kaufsumme' : 'Erlös'}: ${nf.format(total)} €  (${nf.format(gross)} € ${kind === 'BUY' ? '+' : '−'} ${nf.format(fee)} € Gebühr)`;
  };
  ['shares', 'price', 'fee'].forEach(n => form[n] && form[n].addEventListener('input', upd)); upd();
}

function submitTx(form, kind) {
  const date = form.date ? form.date.value : todayStr();
  try {
    if (kind === 'BUY' || kind === 'SELL') {
      const secUuid = form.sec.value;
      const shares = pNum(form.shares.value), price = pNum(form.price.value), fee = pNum(form.fee.value);
      if (!secUuid || shares <= 0 || price < 0) { toast('Bitte Asset, Stückzahl und Kurs angeben', 'err'); return; }
      Builder.addTrade(State.data, { secUuid, kind, date, shares, price, fee,
        portfolioUuid: form.pf ? form.pf.value : null,
        fundWithDeposit: form.fund ? form.fund.checked : false });
    } else if (kind === 'DIVIDENDS') {
      const secUuid = form.sec.value; const amount = pNum(form.amount.value);
      const sec = State.data.securities.find(s => s.uuid === secUuid);
      Builder.addCashTx(State.data, form.acc.value, { type: 'DIVIDENDS', date, amount, security: secUuid, securityName: sec ? sec.name : null });
    } else if (kind === 'VALUE') {
      const secUuid = form.sec.value; const amount = pNum(form.amount.value);
      if (!secUuid) { toast('Kein manuelles Asset vorhanden', 'err'); return; }
      Builder.setManualValue(State.data, secUuid, date, amount);
    } else { // DEPOSIT / REMOVAL / INTEREST
      const amount = pNum(form.amount.value);
      if (amount <= 0) { toast('Bitte einen Betrag angeben', 'err'); return; }
      Builder.addCashTx(State.data, form.acc.value, { type: kind, date, amount });
    }
  } catch (e) { toast('Fehler: ' + (e.message || e), 'err'); return; }
  // beim Bearbeiten: alte Buchung(en) entfernen (neue haben eigene IDs)
  const rep = form._replace;
  if (rep) { if (rep.group) Builder.removeGroup(State.data, rep.group); else if (rep.uuid) Builder.removeByUuid(State.data, rep.uuid); }
  closeModal();
  toast(rep ? 'Buchung gespeichert' : 'Buchung erfasst', 'ok');
  afterEdit({ refresh: kind === 'BUY' || kind === 'SELL' });
}

/* --- Buchungen bearbeiten / löschen --- */
function findTxByUuid(txUuid) {
  for (const pf of State.data.portfolios) { const t = pf.transactions.find(x => x.uuid === txUuid); if (t) return { t, scope: 'Depot' }; }
  for (const a of State.data.accounts) { const t = a.transactions.find(x => x.uuid === txUuid); if (t) return { t, scope: 'Konto' }; }
  return null;
}
function groupHasDeposit(group) {
  for (const a of State.data.accounts) if (a.transactions.some(t => t.group === group && t.type === 'DEPOSIT')) return true;
  return false;
}
async function deleteTxRow(txUuid, group) {
  if (!window.confirm('Diese Buchung wirklich löschen?')) return;
  if (group) Builder.removeGroup(State.data, group);
  else Builder.removeByUuid(State.data, txUuid);
  toast('Buchung gelöscht', 'ok');
  afterEdit({ refresh: true });
}
function editTxRow(txUuid) {
  const found = findTxByUuid(txUuid);
  if (!found) return;
  const t = found.t;
  const date = (t.date || '').slice(0, 10);
  if (found.scope === 'Depot' && (t.type === 'BUY' || t.type === 'SELL')) {
    const shares = t.shares || 0, fee = t.fee || 0;
    const price = shares ? (t.type === 'BUY' ? (t.amount - fee) / shares : (t.amount + fee) / shares) : 0;
    modalAddTx({
      title: 'Buchung bearbeiten', replace: { group: t.group },
      prefill: { kind: t.type, sec: t.security, shares: shares, price: Math.round(price * 1e6) / 1e6, fee, date, fund: t.group ? groupHasDeposit(t.group) : false }
    });
  } else {
    // Cash-Buchung (Einzahlung, Dividende, …)
    modalAddTx({
      title: 'Buchung bearbeiten', replace: { uuid: t.uuid },
      prefill: { kind: t.type, sec: t.security, amount: t.amount, acc: t.account, date }
    });
  }
}

/* --- Sparplan anlegen --- */
function modalAddPlan() {
  const tradeables = State.data.securities.filter(s => !s.manual);
  if (!tradeables.length) { toast('Lege zuerst ein handelbares Asset (Aktie/ETF/Krypto) an', 'err'); return; }
  openModal('Sparplan anlegen', `
    <div class="field"><label>Asset</label><select name="sec">${tradeables.map(s => `<option value="${s.uuid}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Sparrate (€)</label><input name="amount" inputmode="decimal" placeholder="z.B. 100"></div>
      <div class="field"><label>Gebühr je Ausführung (€)</label><input name="fees" inputmode="decimal" value="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Intervall</label><select name="interval"><option value="1">monatlich</option><option value="3">quartalsweise</option><option value="6">halbjährlich</option><option value="12">jährlich</option></select></div>
      <div class="field"><label>Start</label><input type="date" name="start" value="${startStr()}"></div>
    </div>
    <div class="field field-check"><input type="checkbox" name="auto" id="auto" checked><label for="auto" style="font-weight:500">Fällige Raten automatisch buchen</label></div>
    <div class="hint">Portfolix bucht beim Aktualisieren alle seit dem Start fälligen Raten rückwirkend zum jeweiligen Kurs.</div>
    <div class="modal-foot">
      <button type="button" class="btn" onclick="closeModal()">Abbrechen</button>
      <button type="submit" class="btn primary">Sparplan anlegen</button>
    </div>`, {
    onSubmit(form) {
      const amount = pNum(form.amount.value);
      if (amount <= 0) { toast('Bitte eine Sparrate angeben', 'err'); return; }
      Builder.addPlan(State.data, {
        secUuid: form.sec.value, amount, fees: pNum(form.fees.value),
        interval: Number(form.interval.value), start: form.start.value, autoGenerate: form.auto.checked
      });
      closeModal(); toast('Sparplan angelegt', 'ok'); afterEdit({ refresh: true });
    }
  });
}

/* --- Konto anlegen --- */
function modalAddAccount() {
  openModal('Konto hinzufügen', `
    <div class="field"><label>Name</label><input name="name" placeholder="z.B. Tagesgeld, Trade Republic" required></div>
    <div class="field-row">
      <div class="field"><label>Art</label><select name="kind"><option value="CASH">Verrechnungskonto</option><option value="TAGESGELD">Tagesgeld / Zinskonto</option></select></div>
      <div class="field"><label>Währung</label><input name="currency" value="EUR"></div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" onclick="closeModal()">Abbrechen</button>
      <button type="submit" class="btn primary">Konto anlegen</button>
    </div>`, {
    onSubmit(form) {
      Builder.addAccount(State.data, { name: form.elements['name'].value, currency: form.currency.value.trim() || 'EUR', kind: form.kind.value });
      closeModal(); toast('Konto angelegt', 'ok'); afterEdit();
    }
  });
}

function openAdd(kind) {
  if (kind === 'asset') modalAddAsset();
  else if (kind === 'tx') modalAddTx();
  else if (kind === 'plan') modalAddPlan();
  else if (kind === 'account') modalAddAccount();
}

/* ----------------------------- Navigation / Events ----------------------------- */
const VIEW_META = {
  dashboard: ['Dashboard', 'Überblick über dein Gesamtvermögen'],
  securities: ['Wertpapiere', 'Bestände, Echtzeitkurse und Performance je Position'],
  transactions: ['Transaktionen', 'Alle Käufe, Verkäufe, Dividenden und Buchungen'],
  plans: ['Sparpläne', 'Automatische Ausführung fälliger Sparplan-Käufe'],
  accounts: ['Konten', 'Salden deiner Konten und Depots']
};
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.getElementById('pageTitle').textContent = VIEW_META[name][0];
  document.getElementById('pageSub').textContent = VIEW_META[name][1];
  if (name === 'dashboard') { renderEquity(); renderAlloc(); }
}

document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => switchView(n.dataset.view)));
document.getElementById('refreshBtn').addEventListener('click', refreshQuotes);
document.getElementById('txSearch').addEventListener('input', applyTxFilter);
document.getElementById('txType').addEventListener('change', applyTxFilter);
document.getElementById('txScope').addEventListener('change', applyTxFilter);
document.querySelectorAll('#rangeChips .chip').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('#rangeChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active'); State.range = Number(c.dataset.range); renderEquity();
}));
function updatePrivacyBtn() {
  document.getElementById('privacyIco').textContent = State.privacy ? '🙉' : '🙈';
  document.getElementById('privacyLbl').textContent = State.privacy ? 'Zahlen anzeigen' : 'Zahlen verbergen';
  document.getElementById('privacyToggle').classList.toggle('primary', State.privacy);
}
async function setPrivacy(on, persist = true) {
  State.privacy = on;
  updatePrivacyBtn();
  renderAll();
  if (persist) { State.store.privacy = on; await window.portfolix.saveStore(State.store); }
}
document.getElementById('privacyToggle').addEventListener('click', () => setPrivacy(!State.privacy));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); setPrivacy(!State.privacy); }
});

document.getElementById('applySymbols').addEventListener('click', async () => {
  document.querySelectorAll('.symInput').forEach(inp => {
    const v = inp.value.trim();
    if (v) State.store.symbolOverrides[inp.dataset.uuid] = v;
    else delete State.store.symbolOverrides[inp.dataset.uuid];
  });
  await window.portfolix.saveStore(State.store);
  toast('Kursquellen gespeichert – lade Kurse…', 'ok');
  refreshQuotes();
});
// "+ Hinzufügen"-Menü
const addBtnEl = document.getElementById('addBtn');
const addMenuEl = document.getElementById('addMenu');
addBtnEl.addEventListener('click', (e) => { e.stopPropagation(); addMenuEl.hidden = !addMenuEl.hidden; });
addMenuEl.querySelectorAll('[data-add]').forEach(it => it.addEventListener('click', () => { addMenuEl.hidden = true; openAdd(it.dataset.add); }));
document.addEventListener('click', (e) => { if (!addMenuEl.hidden && !addMenuEl.contains(e.target) && e.target !== addBtnEl) addMenuEl.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); addMenuEl.hidden = true; } });

document.getElementById('updateInstall').addEventListener('click', () => window.portfolix.installUpdate());
document.getElementById('updateDismiss').addEventListener('click', () => { document.getElementById('updateBar').hidden = true; });
document.getElementById('changeFile').addEventListener('click', async (e) => {
  e.preventDefault();
  const res = await window.portfolix.pickXml();
  if (res && res.xml) { State.liveBySec = {}; bootWithXml(res); }
});

init();
