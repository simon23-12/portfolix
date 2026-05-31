'use strict';
/* Live-Test der Echtzeitkurs-Integration gegen den echten Yahoo-Finance-Endpoint
 * (identische Logik wie main.js: yahooQuote + quotes:history). Benötigt Internet. */

async function yahooQuote(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Portfolix/1.0' } });
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  const json = await resp.json();
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.meta) return { error: 'no data' };
  return { price: r.meta.regularMarketPrice, currency: r.meta.currency, prev: r.meta.chartPreviousClose };
}
async function yahooHistory(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=1y`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Portfolix/1.0' } });
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  const json = await resp.json();
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  const ts = (r && r.timestamp) || [];
  const closes = (r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  return { points: ts.map((t, i) => closes[i]).filter(v => v != null).length };
}

const symbols = ['VWCE.DE', 'BTC-EUR', 'AAPL', 'ANIC.L', 'USDEUR=X'];
let pass = 0, fail = 0;

(async () => {
  // Konnektivität prüfen
  try {
    const probe = await yahooQuote('AAPL');
    if (probe.error) { console.log('⚠ Kein Internet/Yahoo nicht erreichbar (' + probe.error + ') – Live-Test übersprungen.'); process.exit(0); }
  } catch (e) {
    console.log('⚠ Kein Internet (' + (e.message || e) + ') – Live-Test übersprungen.'); process.exit(0);
  }

  console.log('Yahoo-Finance Live-Kurse:');
  for (const s of symbols) {
    const q = await yahooQuote(s);
    const good = !q.error && typeof q.price === 'number' && q.price > 0 && q.currency;
    console.log(`  ${good ? '✓' : '✗'} ${s.padEnd(10)} ${good ? q.price + ' ' + q.currency : 'FEHLER: ' + q.error}`);
    good ? pass++ : fail++;
  }
  console.log('\nYahoo-Finance Historie (für Wertkurve):');
  for (const s of ['VWCE.DE', 'BTC-EUR']) {
    const h = await yahooHistory(s);
    const good = !h.error && h.points > 10;
    console.log(`  ${good ? '✓' : '✗'} ${s.padEnd(10)} ${good ? h.points + ' Kurspunkte (1 Jahr)' : 'FEHLER: ' + h.error}`);
    good ? pass++ : fail++;
  }
  console.log(`\n==== Yahoo: ${pass} ok, ${fail} fehlgeschlagen ====`);
  process.exitCode = fail ? 1 : 0;
})();
