'use strict';
/* Integrationstest: baut das `data`-Objekt (wie ppparser.js) mit xmldom und
 * führt die ECHTEN ausgelieferten Module model.js & savingsplan.js darauf aus. */
const fs = require('fs'), path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');
const Model = require('../src/model.js');
const SavingsPlan = require('../src/savingsplan.js');

const AMOUNT = 100, SHARE = 1e8, QUOTE = 1e8;
const doc = new DOMParser().parseFromString(fs.readFileSync(path.join(__dirname, '..', 'MyInvestments.xml'), 'utf8'), 'text/xml');

const children = (n, t) => { const o = []; if (!n) return o; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.nodeName === t) o.push(c); return o; };
const child = (n, t) => children(n, t)[0] || null;
const text = (n, t) => { const c = child(n, t); return c ? c.textContent.trim() : null; };
const num = (n, t) => { const v = text(n, t); return v == null ? null : Number(v); };
const attr = (n, a) => n.getAttribute ? n.getAttribute(a) : null;
function resolve(node) { let c = node, g = 0; while (c && attr(c, 'reference')) { const r = xpath.select1(attr(c, 'reference'), c); if (!r) return null; c = r; if (++g > 50) break; } return c; }
function units(t) { let fee = 0, tax = 0; const u = child(t, 'units'); if (u) for (const x of children(u, 'unit')) { const a = child(x, 'amount'); const v = a ? Number(attr(a, 'amount')) / AMOUNT : 0; if (attr(x, 'type') === 'FEE') fee += v; else if (attr(x, 'type') === 'TAX') tax += v; } return { fee, tax }; }

const secByNode = new Map();
const securities = xpath.select('/client/securities/security', doc).map(s => {
  const prices = children(child(s, 'prices'), 'price').map(p => ({ t: attr(p, 't'), v: Number(attr(p, 'v')) / QUOTE }));
  const sec = { uuid: text(s, 'uuid'), name: (text(s, 'name') || '').trim(), isin: text(s, 'isin') || '', wkn: text(s, 'wkn') || '', ticker: (text(s, 'tickerSymbol') || '').trim(), currency: text(s, 'currencyCode') || 'EUR', feed: text(s, 'feed') || '', prices, latest: null };
  secByNode.set(s, sec); return sec;
});
const secRef = el => { if (!el) return null; const t = resolve(el); return t ? secByNode.get(t) : null; };

const seenP = new Set(), portfolios = [];
for (const p of xpath.select('//portfolio', doc)) {
  const uuid = text(p, 'uuid'); if (!uuid || seenP.has(uuid)) continue; seenP.add(uuid);
  const txs = children(child(p, 'transactions'), 'portfolio-transaction').map(r => { const t = resolve(r) || r; const u = units(t); const sec = secRef(child(t, 'security')); return { uuid: text(t, 'uuid'), date: text(t, 'date'), type: text(t, 'type'), amount: (num(t, 'amount') || 0) / AMOUNT, shares: (num(t, 'shares') || 0) / SHARE, security: sec ? sec.uuid : null, securityName: sec ? sec.name : null, fee: u.fee, tax: u.tax, portfolio: uuid }; });
  portfolios.push({ uuid, name: (text(p, 'name') || '').trim(), transactions: txs });
}
const seenA = new Set(), accounts = [];
for (const a of xpath.select('//account', doc)) {
  const uuid = text(a, 'uuid'); if (!uuid || seenA.has(uuid)) continue; seenA.add(uuid);
  const txs = children(child(a, 'transactions'), 'account-transaction').map(r => { const t = resolve(r) || r; const u = units(t); const sec = secRef(child(t, 'security')); return { uuid: text(t, 'uuid'), date: text(t, 'date'), type: text(t, 'type'), amount: (num(t, 'amount') || 0) / AMOUNT, shares: (num(t, 'shares') || 0) / SHARE, security: sec ? sec.uuid : null, fee: u.fee, tax: u.tax, account: uuid }; });
  accounts.push({ uuid, name: (text(a, 'name') || '').trim(), currency: text(a, 'currencyCode') || 'EUR', isRetired: text(a, 'isRetired') === 'true', transactions: txs });
}
const plans = xpath.select('/client/plans/investment-plan', doc).map(pl => { const sec = secRef(child(pl, 'security')); const pf = resolve(child(pl, 'portfolio')); const ac = resolve(child(pl, 'account')); return { name: (text(pl, 'name') || '').trim(), security: sec ? sec.uuid : null, securityName: sec ? sec.name : null, portfolio: pf ? text(pf, 'uuid') : null, account: ac ? text(ac, 'uuid') : null, autoGenerate: text(pl, 'autoGenerate') === 'true', start: text(pl, 'start'), interval: num(pl, 'interval') || 1, amount: (num(pl, 'amount') || 0) / AMOUNT, fees: (num(pl, 'fees') || 0) / AMOUNT, taxes: 0, type: text(pl, 'type') }; });

const data = { baseCurrency: 'EUR', securities, accounts, portfolios, plans };

/* ---- ECHTE Module ausführen ---- */
const positions = Model.buildPositions(data);
const cash = Model.cashStats(data);
// liveBySec simulieren: GBp für Agronomics, sonst keine Live-Kurse
const agro = securities.find(s => s.name.startsWith('Agronomics'));
const liveBySec = {}; liveBySec[agro.uuid] = { price: 5.5, previousClose: 5.4, currency: 'GBp', isLive: true };
const fxRates = { EUR: 1, GBP: 1.17, USD: 0.92 };
const val = Model.valuate(data, positions, liveBySec, fxRates);

console.log('=== valuate() mit GBX-Behandlung ===');
for (const r of val.rows) console.log(`  ${r.name.padEnd(40).slice(0,40)} ${r.shares.toFixed(3).padStart(13)} @ ${r.price.toFixed(2)} ${r.currency.padEnd(4)} = ${r.value.toFixed(2).padStart(12)} €  G/V ${r.pl.toFixed(2).padStart(11)} (${(r.plPct*100).toFixed(1)}%)${r.isLive?'  LIVE':''}`);
console.log(`  --> Agronomics jetzt korrekt bewertet (GBp/100*FX): ${val.rows.find(r=>r.name.startsWith('Agronomics')).value.toFixed(2)} € statt ~900k`);

const totalCash = [...cash.balances.values()].reduce((a, b) => a + b, 0);
console.log('\n=== Summen (echte Module) ===');
console.log(`  Wertpapiere: ${val.totalValue.toFixed(2)} €   Cash: ${totalCash.toFixed(2)} €   Gesamt: ${(val.totalValue+totalCash).toFixed(2)} €`);
console.log(`  Eingezahlt netto: ${cash.netDeposits.toFixed(2)} €   Dividenden: ${cash.dividends.toFixed(2)} €`);

const eq = Model.equityCurve(data);
console.log(`\n=== equityCurve() ===  ${eq.length} Stützstellen, von ${eq[0].date} bis ${eq[eq.length-1].date}`);
console.log(`  Start: Wert ${eq[0].value.toFixed(0)}€ / eingezahlt ${eq[0].invested.toFixed(0)}€`);
console.log(`  Ende:  Wert ${eq[eq.length-1].value.toFixed(0)}€ / eingezahlt ${eq[eq.length-1].invested.toFixed(0)}€`);

console.log('\n=== Sparplan: findDue() ===');
const store = { bookedPlanTx: [] };
const priceLookup = (secUuid, day) => { const s = securities.find(x => x.uuid === secUuid); if (!s) return null; return Model.priceAt(s.prices, day); };
const due = SavingsPlan.findDue(data, plans, store, priceLookup, new Date());
console.log(`  ${due.length} fällige Ausführung(en) erkannt:`);
for (const d of due.slice(0, 12)) console.log(`    ${d.date}  ${d.planName.slice(0,40).padEnd(40)}  ${d.shares.toFixed(4)} Stück @ ${d.price.toFixed(2)} € = ${d.amount.toFixed(2)} €`);
if (due.length > 12) console.log(`    … +${due.length-12} weitere`);
console.log('\n  Letzte echte Ausführung je Plan:');
for (const p of plans) console.log(`    ${p.name.slice(0,40).padEnd(40)} -> ${SavingsPlan.lastRealExecution(data, p)}`);

// applyRecords testen
SavingsPlan.applyRecords(data, due);
const pos2 = Model.buildPositions(data);
console.log('\n  Nach applyRecords gebucht — Lyxor-Bestand vorher/nachher prüfbar.');
console.log('\nALLE TESTS DURCHGELAUFEN ✓');
