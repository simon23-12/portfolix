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
  privacy: false
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
    const res = await window.portfolix.loadXml();
    if (!res || res.needsFile || !res.xml) { showOnboarding(); return; }
    bootWithXml(res);
  } catch (err) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--down);max-width:600px;text-align:center;padding:30px">Fehler beim Laden:<br><br>${esc(err.message || String(err))}</div>`;
    console.error(err);
  }
}

function bootWithXml(res) {
  State.data = PP.parse(res.xml);
  document.getElementById('dataPath').textContent = res.path || '';
  SavingsPlan.merge(State.data, State.store);
  recompute();
  renderAll();
  document.getElementById('loading').style.display = 'none';
  refreshQuotes();
}

function showOnboarding() {
  const el = document.getElementById('loading');
  el.style.display = 'grid';
  el.innerHTML = `<div class="onboard">
    <div class="logo">P</div>
    <h2>Willkommen bei Portfolix</h2>
    <p>Wähle deine <b>Portfolio-Performance-Datei</b> (<code>.xml</code>), um dein Depot, deine Trades und Sparpläne auszuwerten. Deine Daten bleiben lokal auf deinem Rechner.</p>
    <button class="btn primary" id="onboardPick">Portfolio-Performance-Datei wählen…</button>
    <p style="margin-top:18px;font-size:12px">Exportieren in Portfolio Performance: <i>Datei → Speichern unter</i> bzw. die vorhandene <code>.xml</code> verwenden.</p>
  </div>`;
  document.getElementById('onboardPick').addEventListener('click', async () => {
    const r = await window.portfolix.pickXml();
    if (r && r.xml) { State.liveBySec = {}; el.innerHTML = '<div class="spinner"></div>'; bootWithXml(r); }
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

function renderDashPositions() {
  const rows = State.val.rows;
  if (!rows.length) { document.getElementById('dashPositions').innerHTML = '<div class="empty">Keine offenen Positionen.</div>'; return; }
  document.getElementById('dashPositions').innerHTML = positionsTable(rows, rows[0].value);
}

function renderSecurities() {
  const rows = State.val.rows;
  const maxV = rows.length ? rows[0].value : 1;
  let html = positionsTable(rows, maxV);
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

function applyTxFilter() {
  const q = document.getElementById('txSearch').value.toLowerCase();
  const type = document.getElementById('txType').value;
  const scope = document.getElementById('txScope').value;
  let rows = _txCache.filter(t =>
    (!type || t.type === type) &&
    (!scope || t.scope === scope) &&
    (!q || (t.securityName || '').toLowerCase().includes(q) || (t.container || '').toLowerCase().includes(q)));
  document.getElementById('txCount').textContent = `${rows.length} Transaktionen`;
  const shown = rows.slice(0, 800);
  document.getElementById('txTable').innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Typ</th><th>Wertpapier / Konto</th><th>Stück</th><th>Betrag</th><th>Gebühr</th><th>Ort</th></tr></thead><tbody>
    ${shown.map(t => `<tr>
      <td style="text-align:left;font-family:var(--mono)">${dateDE(t.date)}</td>
      <td style="text-align:left">${txTag(t)}${t._generated ? ' <span class="tag gen">auto</span>' : ''}</td>
      <td style="text-align:left">${esc(t.securityName || '—')}</td>
      <td>${t.shares ? shares(t.shares) : '–'}</td>
      <td>${eur(t.amount)}</td>
      <td class="muted">${t.fee ? eur(t.fee) : '–'}</td>
      <td style="text-align:left" class="muted">${esc(t.container)}</td>
    </tr>`).join('')}
    </tbody></table>${rows.length > 800 ? `<div class="empty">… ${rows.length - 800} weitere ausgeblendet (Filter nutzen)</div>` : ''}`;
}

/* ---- Sparpläne ---- */
function renderPlans() {
  const cont = document.getElementById('plansContainer');
  if (!State.data.plans.length) { cont.innerHTML = '<div class="panel"><div class="empty">Keine Sparpläne in der Datei.</div></div>'; return; }
  const today = new Date();
  cont.innerHTML = State.data.plans.map((plan, idx) => {
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
  document.getElementById('accountsTable').innerHTML = `
    <table><thead><tr><th>Konto</th><th>Buchungen</th><th>Saldo</th></tr></thead><tbody>
    ${accs.map(a => `<tr><td><div class="asset-cell"><div class="asset-ico" style="background:#5d6878">€</div><div><div class="asset-name">${esc(a.name)}</div><div class="asset-meta">${esc(a.currency)}${a.retired ? ' · stillgelegt' : ''}</div></div></div></td><td class="muted">${a.count}</td><td class="${cls(a.balance)}">${eur(a.balance)}</td></tr>`).join('')}
    </tbody></table>
    <h2 style="margin-top:22px">Depots</h2>
    <table><thead><tr><th>Depot</th><th>Transaktionen</th></tr></thead><tbody>
    ${pfs.map(p => `<tr><td><div class="asset-cell"><div class="asset-ico" style="background:${colorFor(p.name)}">◆</div><span class="asset-name">${esc(p.name)}</span></div></td><td class="muted">${p.count}</td></tr>`).join('')}
    </tbody></table>`;
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
document.getElementById('updateInstall').addEventListener('click', () => window.portfolix.installUpdate());
document.getElementById('updateDismiss').addEventListener('click', () => { document.getElementById('updateBar').hidden = true; });
document.getElementById('changeFile').addEventListener('click', async (e) => {
  e.preventDefault();
  const res = await window.portfolix.pickXml();
  if (res && res.xml) { State.liveBySec = {}; bootWithXml(res); }
});

init();
