'use strict';
/*
 * Sparplan-Engine.
 *
 * Erzeugt für jeden Sparplan die seit der letzten echten Ausführung fällig
 * gewordenen Käufe automatisch als Transaktionen. Generierte Buchungen werden
 * im Store persistiert (store.bookedPlanTx) und beim Laden ins Datenmodell
 * gemischt – die Original-XML wird NICHT verändert.
 */

const SavingsPlan = (() => {

  function addMonths(date, n) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    // letzten gültigen Tag des Monats beachten
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d;
  }

  function iso(d) { return d.toISOString().slice(0, 10); }

  // alle planmäßigen Termine von start bis heute
  function scheduledDates(plan, today = new Date()) {
    const out = [];
    if (!plan.start) return out;
    let d = new Date(plan.start.slice(0, 10));
    const interval = Math.max(1, plan.interval || 1);
    let guard = 0;
    while (d <= today && guard < 1000) {
      out.push(iso(d));
      d = addMonths(d, interval);
      guard++;
    }
    return out;
  }

  // letzte echte (nicht generierte) BUY-Ausführung dieses Wertpapiers im Depot
  function lastRealExecution(data, plan) {
    let last = null;
    for (const pf of data.portfolios) {
      if (plan.portfolio && pf.uuid !== plan.portfolio) continue;
      for (const t of pf.transactions) {
        if (t._generated) continue;
        if (t.security !== plan.security) continue;
        if (t.type !== 'BUY' && t.type !== 'DELIVERY_INBOUND') continue;
        const day = t.date.slice(0, 10);
        if (!last || day > last) last = day;
      }
    }
    return last;
  }

  function bookedKey(b) { return `${b.planName}|${b.date}`; }

  /*
   * Ermittelt fällige Buchungen, die noch nicht existieren.
   * priceLookup(secUuid, dayStr) -> Kurs (Live für heute, sonst historisch).
   */
  function findDue(data, plans, store, priceLookup, today = new Date()) {
    const bookedSet = new Set((store.bookedPlanTx || []).map(bookedKey));
    const proposals = [];
    for (const plan of plans) {
      if (!plan.autoGenerate) continue;
      if (!plan.security || !plan.portfolio || !plan.account) continue;
      // Native Pläne (backfill) füllen ab Start auf – unabhängig von manuellen Käufen.
      // Import-Pläne (PP) starten nach der letzten echten Ausführung, um Dubletten zu vermeiden.
      const lastReal = plan.backfill ? null : lastRealExecution(data, plan);
      const dates = scheduledDates(plan, today);
      for (const day of dates) {
        if (lastReal && day <= lastReal) continue;       // bereits real ausgeführt
        if (bookedSet.has(`${plan.name}|${day}`)) continue; // schon generiert
        const price = priceLookup(plan.security, day);
        if (!price || price <= 0) continue;
        const net = plan.amount - (plan.fees || 0);
        const shares = net / price;
        proposals.push({
          planName: plan.name,
          date: day,
          security: plan.security,
          securityName: plan.securityName,
          portfolio: plan.portfolio,
          account: plan.account,
          amount: plan.amount,
          fees: plan.fees || 0,
          taxes: plan.taxes || 0,
          shares,
          price,
          currency: 'EUR'
        });
      }
    }
    proposals.sort((a, b) => (a.date < b.date ? -1 : 1));
    return proposals;
  }

  // Eine Liste generierter Buchungen ins Datenmodell mischen (in-memory)
  function applyRecords(data, records) {
    const pfByUuid = new Map(data.portfolios.map(p => [p.uuid, p]));
    const accByUuid = new Map(data.accounts.map(a => [a.uuid, a]));
    let merged = 0;
    for (const b of (records || [])) {
      const pf = pfByUuid.get(b.portfolio);
      const acc = accByUuid.get(b.account);
      if (pf) {
        pf.transactions.push({
          uuid: 'gen-' + bookedKey(b), date: b.date + 'T00:00', type: 'BUY',
          amount: b.amount, shares: b.shares, currency: b.currency || 'EUR',
          security: b.security, securityName: b.securityName,
          fee: b.fees || 0, tax: b.taxes || 0, portfolio: b.portfolio,
          _generated: true, _plan: b.planName
        });
      }
      if (acc) {
        acc.transactions.push({
          uuid: 'genc-' + bookedKey(b), date: b.date + 'T00:00', type: 'BUY',
          amount: b.amount, shares: 0, currency: b.currency || 'EUR',
          security: b.security, securityName: b.securityName,
          fee: b.fees || 0, tax: b.taxes || 0, account: b.account,
          _generated: true, _plan: b.planName
        });
      }
      merged++;
    }
    return merged;
  }

  // Alle persistierten Buchungen mischen
  function merge(data, store) {
    return applyRecords(data, store.bookedPlanTx || []);
  }

  return { scheduledDates, lastRealExecution, findDue, merge, applyRecords, addMonths };
})();

if (typeof module !== 'undefined') module.exports = SavingsPlan;
