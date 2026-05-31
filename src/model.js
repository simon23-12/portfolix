'use strict';
/*
 * Domänenmodell & Berechnungen für Portfolix.
 * Eingabe: das von ppparser.parse() erzeugte Objekt.
 */

const Model = (() => {

  // Vorzeichen der Cash-Bewegung je Kontotransaktionstyp
  const CASH_SIGN = {
    DEPOSIT: 1, REMOVAL: -1,
    DIVIDENDS: 1, INTEREST: 1, INTEREST_CHARGE: -1,
    FEES: -1, FEES_REFUND: 1,
    TAXES: -1, TAX_REFUND: 1,
    BUY: -1, SELL: 1,
    TRANSFER_IN: 1, TRANSFER_OUT: -1
  };

  // Effekt auf die Stückzahl je Depottransaktionstyp
  const SHARE_SIGN = {
    BUY: 1, DELIVERY_INBOUND: 1, TRANSFER_IN: 1,
    SELL: -1, DELIVERY_OUTBOUND: -1, TRANSFER_OUT: -1
  };

  // Standard-Yahoo-Symbol je nach ISIN/Name, falls Ticker nicht Yahoo-tauglich.
  const SYMBOL_BY_ISIN = {
    'IE00BK5BQT80': 'VWCE.DE',   // Vanguard FTSE All-World Acc
    'IE00B3RBWM25': 'VWRL.AS',   // Vanguard FTSE All-World Dist
    'US88160R1014': 'TSLA',
    'US5949724083': 'MSTR',
    'DE000A1JXC94': 'HMEM.MI',
    'IE00BK1PV551': 'XDWL.DE',
    'LU1681038243': 'ANX.DE',    // Amundi Nasdaq-100
    'LU1829220216': 'LYPS.DE',   // Lyxor (Annäherung – ggf. anpassen)
    'IM00B6QH1J21': 'ANIC.L'
  };
  const SYMBOL_BY_NAME = {
    'Bitcoin': 'BTC-EUR',
    'Ethereum': 'ETH-EUR'
  };

  function yahooSymbol(sec, overrides) {
    if (overrides && overrides[sec.uuid]) return overrides[sec.uuid];
    if (SYMBOL_BY_NAME[sec.name && sec.name.trim()]) return SYMBOL_BY_NAME[sec.name.trim()];
    if (sec.isin && SYMBOL_BY_ISIN[sec.isin]) return SYMBOL_BY_ISIN[sec.isin];
    const t = (sec.ticker || '').trim();
    return t || null;
  }

  // Umrechnungsfaktor einer Wertpapierwährung nach EUR.
  // Wichtig: GBp/GBX (Pence) VOR GBP prüfen – 'GBp'.toUpperCase() === 'GBP'!
  function curFactor(cur, fxRates) {
    if (!cur) return 1;
    const raw = cur, u = cur.toUpperCase();
    if (u === 'EUR') return 1;
    if (raw === 'GBp' || u === 'GBX' || u === 'GBP PENCE') return (fxRates['GBP'] || 1.15) / 100;
    if (u === 'GBP') return fxRates['GBP'] || 1.15;
    return fxRates[u] || 1;
  }

  function dnum(dstr) {
    // "2018-08-19T00:06" -> Date
    return new Date(dstr);
  }
  function dayKey(dstr) { return (dstr || '').slice(0, 10); }

  // Letzter Kurs <= date (Datums-String YYYY-MM-DD). prices ist nach t sortiert.
  function priceAt(prices, dayStr) {
    if (!prices.length) return null;
    let lo = 0, hi = prices.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (prices[mid].t <= dayStr) { ans = prices[mid].v; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans != null ? ans : prices[0].v;
  }
  function lastPrice(prices) { return prices.length ? prices[prices.length - 1].v : null; }

  /* ---- Positionen je Wertpapier (Durchschnittskosten) ---- */

  function buildPositions(data) {
    const bySec = new Map();
    const allPfTx = [];
    for (const pf of data.portfolios) for (const t of pf.transactions) allPfTx.push(t);
    allPfTx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const t of allPfTx) {
      if (!t.security) continue;
      const sign = SHARE_SIGN[t.type];
      if (sign == null) continue;
      let pos = bySec.get(t.security);
      if (!pos) {
        pos = { security: t.security, shares: 0, cost: 0, realized: 0, fees: 0, taxes: 0, buys: 0, sells: 0, firstDate: t.date, lastDate: t.date };
        bySec.set(t.security, pos);
      }
      pos.lastDate = t.date;
      pos.fees += t.fee || 0;
      pos.taxes += t.tax || 0;
      if (sign > 0) {
        pos.shares += t.shares;
        pos.cost += t.amount;          // amount enthält Gebühren (Bruttokauf)
        pos.buys += t.amount;
      } else {
        const avg = pos.shares > 0 ? pos.cost / pos.shares : 0;
        const costOut = avg * t.shares;
        pos.realized += (t.amount - costOut); // amount = Nettoerlös
        pos.cost -= costOut;
        pos.shares -= t.shares;
        pos.sells += t.amount;
        if (pos.shares < 1e-6) { pos.shares = 0; pos.cost = 0; }
      }
    }
    return bySec;
  }

  /* ---- Cash-Salden & Kapitalflüsse ---- */

  function cashStats(data) {
    const balances = new Map();   // accountUuid -> balance
    let deposits = 0, removals = 0, dividends = 0, taxes = 0, interest = 0;
    for (const acc of data.accounts) {
      let bal = 0;
      for (const t of acc.transactions) {
        const sign = CASH_SIGN[t.type] ?? 0;
        bal += sign * t.amount;
        if (t.type === 'DEPOSIT') deposits += t.amount;
        else if (t.type === 'REMOVAL') removals += t.amount;
        else if (t.type === 'DIVIDENDS') dividends += t.amount;
        else if (t.type === 'TAXES') taxes += t.amount;
        else if (t.type === 'INTEREST') interest += t.amount;
      }
      balances.set(acc.uuid, bal);
    }
    return { balances, deposits, removals, dividends, taxes, interest, netDeposits: deposits - removals };
  }

  /* ---- Bewertung mit Live-/Letztkursen ---- */

  function valuate(data, positions, liveBySec, fxRates) {
    // liveBySec: secUuid -> { price, currency, isLive }
    // fxRates: currency -> Faktor in EUR (z.B. USD->EUR ~0.92)
    const secByUuid = new Map(data.securities.map(s => [s.uuid, s]));
    const rows = [];
    let totalValue = 0, totalCost = 0;
    for (const [uuid, pos] of positions) {
      if (pos.shares <= 0) continue;
      const sec = secByUuid.get(uuid);
      if (!sec) continue;
      const live = liveBySec && liveBySec[uuid];
      let priceNative = live && live.price != null ? live.price : lastPrice(sec.prices);
      const isLive = !!(live && live.price != null);
      const cur = (live && live.currency) || sec.currency || data.baseCurrency;
      const fx = curFactor(cur, fxRates);
      const valueEur = (priceNative || 0) * pos.shares * fx;
      const cost = pos.cost;
      const pl = valueEur - cost;
      totalValue += valueEur;
      totalCost += cost;
      rows.push({
        uuid, name: sec.name, isin: sec.isin, ticker: sec.ticker, currency: cur,
        shares: pos.shares, price: priceNative, isLive,
        value: valueEur, cost, avgCost: pos.shares ? cost / pos.shares : 0,
        pl, plPct: cost ? pl / cost : 0,
        realized: pos.realized, fees: pos.fees, dividends: 0,
        previousClose: live ? live.previousClose : null,
        dayChangePct: (live && live.price != null && live.previousClose) ? (live.price - live.previousClose) / live.previousClose : null
      });
    }
    rows.sort((a, b) => b.value - a.value);
    return { rows, totalValue, totalCost };
  }

  /* ---- Historische Wertkurve (aus gespeicherten Kursen) ---- */

  function equityCurve(data, fxRates = { EUR: 1 }) {
    const secByUuid = new Map(data.securities.map(s => [s.uuid, s]));
    const facByUuid = new Map(data.securities.map(s => [s.uuid, curFactor(s.currency, fxRates)]));
    // alle relevanten Tx zeitlich
    const pfTx = [];
    for (const pf of data.portfolios) for (const t of pf.transactions) if (SHARE_SIGN[t.type] != null && t.security) pfTx.push(t);
    pfTx.sort((a, b) => (a.date < b.date ? -1 : 1));
    const accTx = [];
    for (const acc of data.accounts) for (const t of acc.transactions) accTx.push(t);
    accTx.sort((a, b) => (a.date < b.date ? -1 : 1));

    if (!pfTx.length && !accTx.length) return [];
    const startStr = (pfTx[0] ? pfTx[0].date : accTx[0].date).slice(0, 10);
    const start = new Date(startStr);
    const end = new Date();

    // monatliche Stützstellen
    const axis = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const d = (last <= end ? last : end);
      axis.push(d.toISOString().slice(0, 10));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    if (axis[axis.length - 1] !== end.toISOString().slice(0, 10)) axis.push(end.toISOString().slice(0, 10));

    let pi = 0, ai = 0;
    const sharesBySec = new Map();
    let cash = 0, invested = 0;
    const series = [];
    for (const day of axis) {
      while (pi < pfTx.length && pfTx[pi].date.slice(0, 10) <= day) {
        const t = pfTx[pi]; const sign = SHARE_SIGN[t.type];
        sharesBySec.set(t.security, (sharesBySec.get(t.security) || 0) + sign * t.shares);
        pi++;
      }
      while (ai < accTx.length && accTx[ai].date.slice(0, 10) <= day) {
        const t = accTx[ai]; const sign = CASH_SIGN[t.type] ?? 0;
        cash += sign * t.amount;
        if (t.type === 'DEPOSIT') invested += t.amount;
        else if (t.type === 'REMOVAL') invested -= t.amount;
        ai++;
      }
      let secVal = 0;
      for (const [uuid, sh] of sharesBySec) {
        if (sh <= 1e-6) continue;
        const sec = secByUuid.get(uuid);
        if (!sec) continue;
        const p = priceAt(sec.prices, day);
        if (p != null) secVal += sh * p * (facByUuid.get(uuid) || 1);
      }
      series.push({ date: day, value: secVal + cash, invested, securities: secVal, cash });
    }
    return series;
  }

  /* ---- Hilfen für UI ---- */

  function flattenTransactions(data) {
    const out = [];
    for (const acc of data.accounts) {
      for (const t of acc.transactions) {
        out.push({ ...t, scope: 'Konto', container: acc.name, kind: t.type });
      }
    }
    for (const pf of data.portfolios) {
      for (const t of pf.transactions) {
        out.push({ ...t, scope: 'Depot', container: pf.name, kind: t.type });
      }
    }
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // neueste zuerst
    return out;
  }

  return {
    CASH_SIGN, SHARE_SIGN, yahooSymbol,
    buildPositions, cashStats, valuate, equityCurve, flattenTransactions,
    priceAt, lastPrice, dnum, dayKey
  };
})();

if (typeof module !== 'undefined') module.exports = Model;
