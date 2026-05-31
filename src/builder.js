'use strict';
/*
 * Builder – erzeugt und bearbeitet ein "natives" Portfolio (ohne Portfolio-
 * Performance-XML). Das Ergebnis hat exakt dieselbe Struktur wie das von
 * ppparser.parse() gelieferte `data`-Objekt, damit Model/Charts/Sparplan-Engine
 * unverändert funktionieren. Alle Funktionen sind rein (kein DOM) → headless testbar.
 *
 * Cash-Modell: Ein "Kauf" bucht standardmäßig zusätzlich eine Einzahlung in
 * gleicher Höhe (frisches Kapital), damit „Eingezahlt" und „Gesamtvermögen"
 * stimmen. Verkäufe erhöhen den Cash-Bestand (Erlös).
 */

const Builder = (() => {

  // Asset-Typen
  const TYPE = {
    AKTIE: { label: 'Aktie', tradeable: true },
    ETF: { label: 'ETF', tradeable: true },
    KRYPTO: { label: 'Krypto / Coin', tradeable: true, hintSymbol: 'z.B. BTC-EUR, ETH-EUR' },
    NFT: { label: 'NFT', manual: true },
    KRYPTO_SONST: { label: 'Krypto (sonstiges)', manual: true },
    IMMOBILIE: { label: 'Immobilie', manual: true },
    ROHSTOFF: { label: 'Rohstoff / Edelmetall', tradeable: true, hintSymbol: 'z.B. GC=F (Gold)' },
    SONSTIGES: { label: 'Sonstiges', manual: true }
  };
  const isManual = (t) => !!(TYPE[t] && TYPE[t].manual);
  const isTradeable = (t) => !!(TYPE[t] && TYPE[t].tradeable);

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const dayOf = (d) => (d || '').slice(0, 10);
  const stamp = (d) => dayOf(d) + 'T00:00';

  function createPortfolio({ baseCurrency = 'EUR', startDate = null, assetTypes = [] } = {}) {
    const accUuid = uuid(), pfUuid = uuid();
    return {
      baseCurrency,
      securities: [],
      accounts: [{ uuid: accUuid, name: 'Verrechnungskonto', currency: baseCurrency, isRetired: false, kind: 'CASH', transactions: [] }],
      portfolios: [{ uuid: pfUuid, name: 'Mein Depot', referenceAccount: accUuid, transactions: [] }],
      plans: [],
      meta: { createdAt: new Date().toISOString(), startDate: dayOf(startDate), assetTypes, native: true }
    };
  }

  function defaultAccount(data) { return data.accounts.find(a => a.kind !== 'TAGESGELD') || data.accounts[0]; }
  function defaultPortfolio(data) { return data.portfolios[0]; }

  function addAccount(data, { name, currency = 'EUR', kind = 'CASH' }) {
    const acc = { uuid: uuid(), name: name || 'Konto', currency, isRetired: false, kind, transactions: [] };
    data.accounts.push(acc);
    return acc;
  }

  function addSecurity(data, { name, type = 'AKTIE', isin = '', ticker = '', currency = null }) {
    const sec = {
      uuid: uuid(), name: (name || '').trim(), isin: isin.trim(), wkn: '', ticker: (ticker || '').trim(),
      currency: currency || data.baseCurrency, feed: isTradeable(type) ? 'YAHOO' : '', isRetired: false,
      prices: [], type, manual: isManual(type)
    };
    data.securities.push(sec);
    return sec;
  }

  // Manuellen Wertpunkt setzen (Kauf/Wertanpassung bei Immobilie, NFT, …)
  function setManualValue(data, secUuid, date, value) {
    const sec = data.securities.find(s => s.uuid === secUuid);
    if (!sec) return;
    const t = dayOf(date);
    const i = sec.prices.findIndex(p => p.t === t);
    if (i >= 0) sec.prices[i].v = value;
    else sec.prices.push({ t, v: value });
    sec.prices.sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  }

  function addCashTx(data, accUuid, { type, date, amount, security = null, securityName = null, group = null }) {
    const acc = data.accounts.find(a => a.uuid === accUuid);
    if (!acc) return null;
    const tx = { uuid: uuid(), date: stamp(date), type, amount: round2(amount), shares: 0, currency: acc.currency, security, securityName, fee: 0, tax: 0, account: accUuid };
    if (group) tx.group = group;
    acc.transactions.push(tx);
    return tx;
  }

  /*
   * Trade buchen (Kauf/Verkauf eines handelbaren oder manuellen Assets).
   * BUY:  amount = shares*price + fee  (Bruttokauf)
   * SELL: amount = shares*price - fee  (Nettoerlös)
   */
  function addTrade(data, { secUuid, portfolioUuid, accountUuid, kind, date, shares, price, fee = 0, fundWithDeposit = true, group = null }) {
    const sec = data.securities.find(s => s.uuid === secUuid);
    const pf = portfolioUuid ? data.portfolios.find(p => p.uuid === portfolioUuid) : defaultPortfolio(data);
    const accUuid = accountUuid || (pf && pf.referenceAccount) || defaultAccount(data).uuid;
    if (!sec || !pf) return null;
    const grp = group || uuid();
    const gross = shares * price;
    const amount = kind === 'BUY' ? gross + fee : gross - fee;

    const pTx = { uuid: uuid(), date: stamp(date), type: kind, amount: round2(amount), shares, currency: sec.currency, security: secUuid, securityName: sec.name, fee: round2(fee), tax: 0, portfolio: pf.uuid, group: grp };
    pf.transactions.push(pTx);

    if (kind === 'BUY') {
      if (fundWithDeposit) addCashTx(data, accUuid, { type: 'DEPOSIT', date, amount, group: grp });
      addCashTx(data, accUuid, { type: 'BUY', date, amount, security: secUuid, securityName: sec.name, group: grp });
    } else {
      addCashTx(data, accUuid, { type: 'SELL', date, amount, security: secUuid, securityName: sec.name, group: grp });
    }
    // Manuelles Asset: Kaufpreis als Wertpunkt hinterlegen
    if (sec.manual && kind === 'BUY') setManualValue(data, secUuid, date, price);
    return pTx;
  }

  // Löschen
  function removeGroup(data, group) {
    let n = 0;
    for (const pf of data.portfolios) { const b = pf.transactions.length; pf.transactions = pf.transactions.filter(t => t.group !== group); n += b - pf.transactions.length; }
    for (const a of data.accounts) { const b = a.transactions.length; a.transactions = a.transactions.filter(t => t.group !== group); n += b - a.transactions.length; }
    return n;
  }
  function removeByUuid(data, txUuid) {
    let n = 0;
    for (const pf of data.portfolios) { const b = pf.transactions.length; pf.transactions = pf.transactions.filter(t => t.uuid !== txUuid); n += b - pf.transactions.length; }
    for (const a of data.accounts) { const b = a.transactions.length; a.transactions = a.transactions.filter(t => t.uuid !== txUuid); n += b - a.transactions.length; }
    return n;
  }

  function addPlan(data, { name, secUuid, portfolioUuid, accountUuid, amount, fees = 0, interval = 1, start, autoGenerate = true }) {
    const sec = data.securities.find(s => s.uuid === secUuid);
    const pf = portfolioUuid ? data.portfolios.find(p => p.uuid === portfolioUuid) : defaultPortfolio(data);
    const accUuid = accountUuid || (pf && pf.referenceAccount) || defaultAccount(data).uuid;
    const plan = {
      name: (name || (sec ? sec.name : 'Sparplan')).trim(), security: secUuid, securityName: sec ? sec.name : null,
      portfolio: pf ? pf.uuid : null, account: accUuid, autoGenerate: !!autoGenerate,
      start: stamp(start), interval: Math.max(1, interval), amount: round2(amount), fees: round2(fees), taxes: 0,
      type: 'PURCHASE_OR_DELIVERY', backfill: true
    };
    data.plans.push(plan);
    return plan;
  }

  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  // Serialisierbare Kopie (entfernt evtl. DOM-Referenzen aus Import-Daten)
  function serializable(data) {
    return JSON.parse(JSON.stringify(data, (k, v) => (k === 'node' ? undefined : v)));
  }

  return {
    TYPE, isManual, isTradeable, uuid,
    createPortfolio, addAccount, addSecurity, setManualValue, addCashTx, addTrade, addPlan,
    removeGroup, removeByUuid, defaultAccount, defaultPortfolio, serializable
  };
})();

if (typeof module !== 'undefined') module.exports = Builder;
