'use strict';
/*
 * Portfolio-Performance XML-Parser.
 *
 * Portfolio Performance serialisiert mit XStream. Geteilte Objekte werden nur
 * einmal vollständig geschrieben; alle weiteren Vorkommen sind
 * reference="<relativer XPath>"-Verweise auf das Original. Diese relativen
 * Pfade sind valides XPath – wir lösen sie mit document.evaluate() relativ zum
 * verweisenden Knoten auf.
 *
 * Wertskalierung in Portfolio Performance:
 *   Beträge (amount):  /100      (in EUR-Cent gespeichert)
 *   Stückzahlen:       /1e8
 *   Kurse (quote):     /1e8
 */

const PP = (() => {
  const AMOUNT = 100;
  const SHARE = 1e8;
  const QUOTE = 1e8;

  /* ---- DOM-Helfer ---- */

  function directChildren(node, tag) {
    const out = [];
    if (!node) return out;
    for (const c of node.children) if (c.tagName === tag) out.push(c);
    return out;
  }
  function directChild(node, tag) {
    if (!node) return null;
    for (const c of node.children) if (c.tagName === tag) return c;
    return null;
  }
  function childText(node, tag) {
    const c = directChild(node, tag);
    return c ? c.textContent.trim() : null;
  }
  function childNum(node, tag) {
    const t = childText(node, tag);
    return t == null ? null : Number(t);
  }

  /* ---- Referenzauflösung ---- */

  function resolve(doc, node) {
    let cur = node;
    let guard = 0;
    const seen = new Set();
    while (cur && cur.getAttribute && cur.getAttribute('reference')) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const ref = cur.getAttribute('reference');
      const res = doc.evaluate(ref, cur, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (!res || !res.singleNodeValue) return null;
      cur = res.singleNodeValue;
      if (++guard > 50) break;
    }
    return cur;
  }

  /* ---- Units (Gebühren / Steuern) ---- */

  function parseUnits(txNode) {
    let fee = 0, tax = 0;
    const units = directChild(txNode, 'units');
    if (!units) return { fee, tax };
    for (const u of directChildren(units, 'unit')) {
      const type = u.getAttribute('type');
      const amtEl = directChild(u, 'amount');
      const v = amtEl ? Number(amtEl.getAttribute('amount')) / AMOUNT : 0;
      if (type === 'FEE') fee += v;
      else if (type === 'TAX') tax += v;
    }
    return { fee, tax };
  }

  /* ---- Hauptparser ---- */

  function parse(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    const perr = doc.querySelector('parsererror');
    if (perr) throw new Error('XML konnte nicht gelesen werden: ' + perr.textContent.slice(0, 200));

    const baseCurrency = childText(doc.documentElement, 'baseCurrency') || 'EUR';

    /* Wertpapiere */
    const securities = [];
    const secByNode = new Map();
    for (const s of doc.querySelectorAll('securities > security')) {
      const prices = [];
      const pricesEl = directChild(s, 'prices');
      if (pricesEl) {
        for (const p of directChildren(pricesEl, 'price')) {
          prices.push({ t: p.getAttribute('t'), v: Number(p.getAttribute('v')) / QUOTE });
        }
      }
      // letzter "latest"-Kurs falls vorhanden
      const latestEl = directChild(s, 'latest');
      let latest = null;
      if (latestEl) latest = { t: latestEl.getAttribute('t'), v: Number(latestEl.getAttribute('v')) / QUOTE };

      const sec = {
        uuid: childText(s, 'uuid'),
        name: (childText(s, 'name') || '').trim(),
        isin: childText(s, 'isin') || '',
        wkn: childText(s, 'wkn') || '',
        ticker: (childText(s, 'tickerSymbol') || '').trim(),
        currency: childText(s, 'currencyCode') || baseCurrency,
        feed: childText(s, 'feed') || '',
        isRetired: childText(s, 'isRetired') === 'true',
        prices,
        latest,
        node: s
      };
      securities.push(sec);
      secByNode.set(s, sec);
    }

    const securityForRef = (refEl) => {
      if (!refEl) return null;
      const target = resolve(doc, refEl);
      if (!target) return null;
      return secByNode.get(target) || null;
    };

    /* Konten (Cash) – echte <account>-Knoten (mit <uuid>) einsammeln; die
       obersten Listeneinträge sind teils nur Referenzen auf tief in
       crossEntries serialisierte Konten (z.B. Krypto-Wallets). */
    const accounts = [];
    const seenAcc = new Set();
    for (const a of doc.querySelectorAll('account')) {
      const uuid = childText(a, 'uuid');
      if (!uuid || seenAcc.has(uuid)) continue;
      seenAcc.add(uuid);
      const acc = {
        uuid,
        name: (childText(a, 'name') || '').trim(),
        currency: childText(a, 'currencyCode') || baseCurrency,
        isRetired: childText(a, 'isRetired') === 'true',
        transactions: [],
        node: a
      };
      const txWrap = directChild(a, 'transactions');
      for (const ref of directChildren(txWrap, 'account-transaction')) {
        const t = resolve(doc, ref) || ref;   // Referenz-Stubs auflösen
        const secEl = directChild(t, 'security');
        const sec = secEl ? securityForRef(secEl) : null;
        const { fee, tax } = parseUnits(t);
        acc.transactions.push({
          uuid: childText(t, 'uuid'),
          date: childText(t, 'date'),
          type: childText(t, 'type'),
          amount: (childNum(t, 'amount') || 0) / AMOUNT,
          shares: (childNum(t, 'shares') || 0) / SHARE,
          currency: childText(t, 'currencyCode') || acc.currency,
          security: sec ? sec.uuid : null,
          securityName: sec ? sec.name : null,
          fee, tax,
          account: acc.uuid
        });
      }
      accounts.push(acc);
    }

    /* Depots (Wertpapierbestände) – die echten Knoten sind tief verschachtelt
       (in crossEntries). Wir erkennen sie an einem direkten <uuid>-Kind. */
    const portfolios = [];
    const seenPf = new Set();
    for (const p of doc.querySelectorAll('portfolio')) {
      const uuid = childText(p, 'uuid');
      if (!uuid || seenPf.has(uuid)) continue;
      seenPf.add(uuid);
      const refAccEl = directChild(p, 'referenceAccount');
      const refAcc = refAccEl ? resolve(doc, refAccEl) : null;
      const pf = {
        uuid,
        name: (childText(p, 'name') || '').trim(),
        referenceAccount: refAcc ? childText(refAcc, 'uuid') : null,
        transactions: [],
        node: p
      };
      const txWrap = directChild(p, 'transactions');
      for (const ref of directChildren(txWrap, 'portfolio-transaction')) {
        const t = resolve(doc, ref) || ref;   // Referenz-Stubs auflösen
        const sec = securityForRef(directChild(t, 'security'));
        const { fee, tax } = parseUnits(t);
        pf.transactions.push({
          uuid: childText(t, 'uuid'),
          date: childText(t, 'date'),
          type: childText(t, 'type'),
          amount: (childNum(t, 'amount') || 0) / AMOUNT,
          shares: (childNum(t, 'shares') || 0) / SHARE,
          currency: childText(t, 'currencyCode') || baseCurrency,
          security: sec ? sec.uuid : null,
          securityName: sec ? sec.name : null,
          fee, tax,
          portfolio: uuid,
          node: t
        });
      }
      portfolios.push(pf);
    }

    /* Sparpläne */
    const plans = [];
    const plansWrap = directChild(doc.documentElement, 'plans');
    for (const pl of directChildren(plansWrap, 'investment-plan')) {
      const sec = securityForRef(directChild(pl, 'security'));
      const pfEl = directChild(pl, 'portfolio');
      const pf = pfEl ? resolve(doc, pfEl) : null;
      const accEl = directChild(pl, 'account');
      const acc = accEl ? resolve(doc, accEl) : null;
      plans.push({
        name: (childText(pl, 'name') || '').trim(),
        security: sec ? sec.uuid : null,
        securityName: sec ? sec.name : null,
        portfolio: pf ? childText(pf, 'uuid') : null,
        account: acc ? childText(acc, 'uuid') : null,
        autoGenerate: childText(pl, 'autoGenerate') === 'true',
        start: childText(pl, 'start'),
        interval: childNum(pl, 'interval') || 1,   // Monate
        amount: (childNum(pl, 'amount') || 0) / AMOUNT,
        fees: (childNum(pl, 'fees') || 0) / AMOUNT,
        taxes: (childNum(pl, 'taxes') || 0) / AMOUNT,
        type: childText(pl, 'type')
      });
    }

    /* Taxonomien (z.B. Anlagekategorien) – nur Namen, optional */
    const taxonomies = [];
    const taxWrap = directChild(doc.documentElement, 'taxonomies');
    for (const tx of directChildren(taxWrap, 'taxonomy')) {
      taxonomies.push({ name: (childText(tx, 'name') || '').trim() });
    }

    return { baseCurrency, securities, accounts, portfolios, plans, taxonomies };
  }

  return { parse };
})();

if (typeof module !== 'undefined') module.exports = PP;
