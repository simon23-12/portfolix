'use strict';
/* Headless-Test: natives Portfolio via Builder erstellen und mit den echten
 * Berechnungen (model.js) + Sparplan-Engine prüfen. */
const Builder = require('../src/builder.js');
const Model = require('../src/model.js');
const SavingsPlan = require('../src/savingsplan.js');

function assert(cond, msg) { if (!cond) { console.error('  ✗ FEHLER:', msg); process.exitCode = 1; } else console.log('  ✓', msg); }
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;

const data = Builder.createPortfolio({ startDate: '2022-01-01', assetTypes: ['AKTIE', 'ETF', 'IMMOBILIE'] });
console.log('Portfolio angelegt:', data.accounts[0].name, '/', data.portfolios[0].name);

// 1) ETF-Kauf (handelbar) – frisches Kapital
const etf = Builder.addSecurity(data, { name: 'Vanguard FTSE All-World', type: 'ETF', isin: 'IE00BK5BQT80', ticker: 'VWCE.DE' });
Builder.addTrade(data, { secUuid: etf.uuid, kind: 'BUY', date: '2022-02-01', shares: 10, price: 90, fee: 1 });
Builder.addTrade(data, { secUuid: etf.uuid, kind: 'BUY', date: '2022-06-01', shares: 5, price: 100, fee: 1 });

// 2) Aktie kaufen und teilweise verkaufen
const aktie = Builder.addSecurity(data, { name: 'Apple', type: 'AKTIE', isin: 'US0378331005', ticker: 'AAPL' });
Builder.addTrade(data, { secUuid: aktie.uuid, kind: 'BUY', date: '2022-03-01', shares: 20, price: 50, fee: 0 });
Builder.addTrade(data, { secUuid: aktie.uuid, kind: 'SELL', date: '2023-03-01', shares: 10, price: 80, fee: 0 });

// 3) Immobilie (manuell) – Anschaffung + Wertanpassung
const haus = Builder.addSecurity(data, { name: 'ETW Berlin', type: 'IMMOBILIE' });
Builder.addTrade(data, { secUuid: haus.uuid, kind: 'BUY', date: '2022-01-15', shares: 1, price: 300000, fee: 0 });
Builder.setManualValue(data, haus.uuid, '2026-01-01', 360000);

// 4) Sparplan definieren (monatlich 100€) ab 2024-01-05
Builder.addPlan(data, { secUuid: etf.uuid, amount: 100, fees: 0, interval: 1, start: '2024-01-05', autoGenerate: true });

// aktuelle Kurse simulieren (Live)
const live = {};
live[etf.uuid] = { price: 120, currency: 'EUR', isLive: true };
live[aktie.uuid] = { price: 90, currency: 'EUR', isLive: true };
// Immobilie nutzt letzten manuellen Wert (kein Live)

const positions = Model.buildPositions(data);
const cash = Model.cashStats(data);
const val = Model.valuate(data, positions, live, { EUR: 1 });

console.log('\nPositionen:');
for (const r of val.rows) console.log(`  ${r.name.padEnd(26)} ${r.shares.toFixed(2).padStart(8)} Stk  Wert ${r.value.toFixed(2).padStart(11)}  Kosten ${r.cost.toFixed(2).padStart(11)}  G/V ${r.pl.toFixed(2).padStart(10)}`);

const etfRow = val.rows.find(r => r.uuid === etf.uuid);
const akRow = val.rows.find(r => r.uuid === aktie.uuid);
const hausRow = val.rows.find(r => r.uuid === haus.uuid);

console.log('\nPrüfungen:');
assert(near(etfRow.shares, 15), 'ETF Bestand = 15 Stück');
assert(near(etfRow.cost, 901 + 501), 'ETF Kostenbasis = 1402 € (inkl. Gebühren)');
assert(near(etfRow.value, 15 * 120), 'ETF Wert = 1800 € (Live 120 €)');
assert(near(akRow.shares, 10), 'Apple Restbestand = 10 Stück (20 - 10 verkauft)');
assert(near(akRow.cost, 500), 'Apple Restkostenbasis = 500 € (Ø 25 € × 10 reicht? avg 50 → 500)');
assert(near(positions.get(aktie.uuid).realized, 10 * 80 - 10 * 50), 'Apple realisiert = +300 €');
assert(near(hausRow.value, 360000), 'Immobilie Wert = 360.000 € (manueller Wert)');
assert(near(hausRow.cost, 300000), 'Immobilie Kosten = 300.000 €');

const totalCash = [...cash.balances.values()].reduce((a, b) => a + b, 0);
// Cash: jede BUY-Einzahlung deckt den Kauf (netto 0), Verkauf bringt Erlös rein
const sellProceeds = 10 * 80; // 800
assert(near(totalCash, sellProceeds), `Cash = 800 € (nur Verkaufserlös), ist ${totalCash.toFixed(2)}`);

// Eingezahlt = Summe aller Käufe (Deposits)
const expectedInvested = (901 + 501) + (20 * 50) + 300000;
assert(near(cash.netDeposits, expectedInvested), `Eingezahlt netto = ${expectedInvested} €, ist ${cash.netDeposits.toFixed(2)}`);

// Sparplan-Fälligkeit ab 2024-01-05 bis heute, ETF, sollte viele Raten ergeben
const priceLookup = (s, day) => (s === etf.uuid ? 100 : 0);
const due = SavingsPlan.findDue(data, data.plans, { bookedPlanTx: [] }, priceLookup, new Date('2024-04-10'));
console.log('\nSparplan fällige Raten bis 2024-04-10:', due.length, '(erwartet 4: Jan,Feb,Mär,Apr)');
assert(due.length === 4, 'Sparplan erkennt 4 fällige Raten');

// Equity-Kurve baut auf
const eq = Model.equityCurve(data, { EUR: 1 });
assert(eq.length > 10 && eq[eq.length - 1].invested > 300000, 'Equity-Kurve hat Stützstellen & investiertes Kapital');

// Serialisierbarkeit (Persistenz)
const json = JSON.stringify(Builder.serializable(data));
assert(json.length > 100 && !json.includes('"node"'), 'Portfolio ist serialisierbar (keine DOM-Referenzen)');

// --- Bearbeiten / Löschen ---
console.log('\nLöschen (Gruppen):');
const d2 = Builder.createPortfolio({});
const s2 = Builder.addSecurity(d2, { name: 'Test ETF', type: 'ETF' });
const tr = Builder.addTrade(d2, { secUuid: s2.uuid, kind: 'BUY', date: '2023-01-01', shares: 10, price: 100, fee: 5 });
let p2 = Model.buildPositions(d2), c2 = Model.cashStats(d2);
assert(near(p2.get(s2.uuid).shares, 10), 'vor Löschen: 10 Stück');
assert(near(c2.netDeposits, 1005), 'vor Löschen: 1005 € eingezahlt');
const removed = Builder.removeGroup(d2, tr.group);
assert(removed === 3, 'removeGroup entfernt 3 Datensätze (Depot + Cash + Einzahlung), ist ' + removed);
p2 = Model.buildPositions(d2); c2 = Model.cashStats(d2);
assert(!p2.get(s2.uuid) || p2.get(s2.uuid).shares === 0, 'nach Löschen: keine Position mehr');
assert(near(c2.netDeposits, 0), 'nach Löschen: 0 € eingezahlt');

// Einzelne Cash-Buchung löschen
const dep = Builder.addCashTx(d2, Builder.defaultAccount(d2).uuid, { type: 'DEPOSIT', date: '2023-01-01', amount: 500 });
assert(near(Model.cashStats(d2).netDeposits, 500), 'Einzahlung gebucht: 500 €');
Builder.removeByUuid(d2, dep.uuid);
assert(near(Model.cashStats(d2).netDeposits, 0), 'Einzahlung gelöscht: 0 €');

console.log('\n' + (process.exitCode ? '✗ TESTS FEHLGESCHLAGEN' : '✓ ALLE BUILDER-TESTS BESTANDEN'));
