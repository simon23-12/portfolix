'use strict';
/* Eigenständiger Verifizierer: bildet die Parser-/Berechnungslogik mit
 * xmldom + xpath nach, um die Zahlen aus MyInvestments.xml zu prüfen. */
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

const AMOUNT = 100, SHARE = 1e8, QUOTE = 1e8;
const xml = fs.readFileSync(path.join(__dirname, '..', 'MyInvestments.xml'), 'utf8');
const doc = new DOMParser().parseFromString(xml, 'text/xml');

function children(node, tag) {
  const out = [];
  if (!node) return out;
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.nodeName === tag) out.push(c);
  return out;
}
function child(node, tag) { return children(node, tag)[0] || null; }
function text(node, tag) { const c = child(node, tag); return c ? c.textContent.trim() : null; }
function num(node, tag) { const t = text(node, tag); return t == null ? null : Number(t); }
function attr(node, name) { return node.getAttribute ? node.getAttribute(name) : null; }

function resolve(node) {
  let cur = node, guard = 0;
  while (cur && attr(cur, 'reference')) {
    const ref = attr(cur, 'reference');
    const r = xpath.select1(ref, cur);
    if (!r) return null;
    cur = r;
    if (++guard > 50) break;
  }
  return cur;
}

// Wertpapiere
const securitiesRoot = xpath.select("/client/securities/security", doc);
const secByNode = new Map();
const securities = securitiesRoot.map(s => {
  const prices = children(child(s, 'prices'), 'price').map(p => ({ t: attr(p, 't'), v: Number(attr(p, 'v')) / QUOTE }));
  const sec = { uuid: text(s, 'uuid'), name: (text(s, 'name') || '').trim(), isin: text(s, 'isin'), ticker: (text(s, 'tickerSymbol') || '').trim(), currency: text(s, 'currencyCode'), prices };
  secByNode.set(s, sec);
  return sec;
});
function secForRef(refEl) { if (!refEl) return null; const t = resolve(refEl); return t ? secByNode.get(t) : null; }

// Depots – echte <portfolio>-Knoten (mit uuid) einsammeln, Tx-Einträge auflösen
const seen = new Set();
const portfolios = [];
for (const p of xpath.select("//portfolio", doc)) {
  const uuid = text(p, 'uuid');
  if (!uuid || seen.has(uuid)) continue;
  seen.add(uuid);
  const txs = children(child(p, 'transactions'), 'portfolio-transaction').map(ref => {
    const t = resolve(ref);
    const units = child(t, 'units');
    let fee = 0;
    if (units) for (const u of children(units, 'unit')) { const a = child(u, 'amount'); if (attr(u, 'type') === 'FEE' && a) fee += Number(attr(a, 'amount')) / AMOUNT; }
    return { type: text(t, 'type'), date: text(t, 'date'), amount: (num(t, 'amount') || 0) / AMOUNT, shares: (num(t, 'shares') || 0) / SHARE, security: (secForRef(child(t, 'security')) || {}).uuid, fee };
  });
  portfolios.push({ uuid, name: (text(p, 'name') || '').trim(), transactions: txs });
}

// Konten – echte <account>-Knoten (mit uuid) einsammeln, Tx-Einträge auflösen
const seenA = new Set();
const accounts = [];
for (const a of xpath.select("//account", doc)) {
  const uuid = text(a, 'uuid');
  if (!uuid || seenA.has(uuid)) continue;
  seenA.add(uuid);
  const txs = children(child(a, 'transactions'), 'account-transaction').map(ref => {
    const t = resolve(ref);
    return { type: text(t, 'type'), date: text(t, 'date'), amount: (num(t, 'amount') || 0) / AMOUNT };
  });
  accounts.push({ name: (text(a, 'name') || '').trim(), currency: text(a, 'currencyCode'), transactions: txs });
}

// Pläne
const plans = xpath.select("/client/plans/investment-plan", doc).map(pl => ({
  name: (text(pl, 'name') || '').trim(), security: (secForRef(child(pl, 'security')) || {}).uuid,
  start: text(pl, 'start'), interval: num(pl, 'interval'), amount: (num(pl, 'amount') || 0) / AMOUNT, autoGenerate: text(pl, 'autoGenerate')
}));

// Positionen
const SHARE_SIGN = { BUY: 1, DELIVERY_INBOUND: 1, TRANSFER_IN: 1, SELL: -1, DELIVERY_OUTBOUND: -1, TRANSFER_OUT: -1 };
const CASH_SIGN = { DEPOSIT: 1, REMOVAL: -1, DIVIDENDS: 1, INTEREST: 1, FEES: -1, TAXES: -1, TAX_REFUND: 1, BUY: -1, SELL: 1, TRANSFER_IN: 1, TRANSFER_OUT: -1 };
const allTx = [];
for (const pf of portfolios) for (const t of pf.transactions) allTx.push(t);
allTx.sort((a, b) => a.date < b.date ? -1 : 1);
const pos = new Map();
for (const t of allTx) {
  const sign = SHARE_SIGN[t.type]; if (sign == null || !t.security) continue;
  let p = pos.get(t.security) || { shares: 0, cost: 0, realized: 0 };
  if (sign > 0) { p.shares += t.shares; p.cost += t.amount; }
  else { const avg = p.shares > 0 ? p.cost / p.shares : 0; const co = avg * t.shares; p.realized += t.amount - co; p.cost -= co; p.shares -= t.shares; if (p.shares < 1e-6) { p.shares = 0; p.cost = 0; } }
  pos.set(t.security, p);
}

console.log('=== WERTPAPIERE ===');
securities.forEach(s => console.log(`  ${s.name.padEnd(45).slice(0,45)} ${(s.isin||'').padEnd(13)} ${(s.ticker||'').padEnd(8)} ${s.prices.length} Kurse, letzter ${s.prices.length?s.prices[s.prices.length-1].v.toFixed(2):'-'} ${s.currency}`));

console.log('\n=== OFFENE POSITIONEN (letzter gespeicherter Kurs) ===');
let totV = 0, totC = 0;
const byUuid = new Map(securities.map(s => [s.uuid, s]));
for (const [uuid, p] of [...pos].sort((a,b)=>b[1].shares-a[1].shares)) {
  if (p.shares <= 0) continue;
  const s = byUuid.get(uuid); const lp = s.prices.length ? s.prices[s.prices.length-1].v : 0;
  const val = p.shares * lp; totV += val; totC += p.cost;
  console.log(`  ${s.name.padEnd(40).slice(0,40)} ${p.shares.toFixed(4).padStart(14)} Stk  Wert ${val.toFixed(2).padStart(12)}€  Kosten ${p.cost.toFixed(2).padStart(11)}€  G/V ${(val-p.cost).toFixed(2).padStart(11)}€`);
}
console.log('\n=== GESCHLOSSEN (realisiert) ===');
for (const [uuid,p] of pos) if (p.shares<=0 && Math.abs(p.realized)>0.01) console.log(`  ${byUuid.get(uuid).name.padEnd(40).slice(0,40)} realisiert ${p.realized.toFixed(2)}€`);

console.log('\n=== KONTEN ===');
let totCash = 0, deposits = 0, removals = 0, dividends = 0;
for (const a of accounts) {
  let bal = 0;
  for (const t of a.transactions) { bal += (CASH_SIGN[t.type]||0)*t.amount; if(t.type==='DEPOSIT')deposits+=t.amount; if(t.type==='REMOVAL')removals+=t.amount; if(t.type==='DIVIDENDS')dividends+=t.amount; }
  totCash += bal;
  console.log(`  ${a.name.padEnd(20)} ${a.transactions.length} Buchungen  Saldo ${bal.toFixed(2)} ${a.currency}`);
}

console.log('\n=== SPARPLÄNE ===');
plans.forEach(p => console.log(`  ${p.name.padEnd(45).slice(0,45)} ab ${p.start}  alle ${p.interval} Mon  ${p.amount.toFixed(2)}€  auto=${p.autoGenerate}  sec=${p.security?'ok':'FEHLT'}`));

console.log('\n=== SUMMEN ===');
console.log(`  Wertpapiere (letzte Kurse): ${totV.toFixed(2)} €`);
console.log(`  Cash gesamt:                ${totCash.toFixed(2)} €`);
console.log(`  Gesamtvermögen:             ${(totV+totCash).toFixed(2)} €`);
console.log(`  Eingezahlt (netto):         ${(deposits-removals).toFixed(2)} €  (Ein ${deposits.toFixed(2)} / Aus ${removals.toFixed(2)})`);
console.log(`  Dividenden gesamt:          ${dividends.toFixed(2)} €`);
console.log(`  Kostenbasis offen:          ${totC.toFixed(2)} €`);
console.log(`  Buchgewinn offen:           ${(totV-totC).toFixed(2)} €`);
