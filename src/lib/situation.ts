// Situation par page (accueil) : ventes, argent reçu par moyen de paiement, reste à payer, annulations, échanges et
// livraisons reportées, sur une période. Un vendeur ne voit que ses pages ; le gérant voit toutes les pages.
import { all, get } from './db';
import { salesLedger } from './analytics';
import { rootOf, variantPage } from './scope';
import { dayOf } from './money';
import { isWalkIn, remaining, type Order, type PayMethod } from './orders';
import type { Category } from './catalog';

export interface PageSit {
  id: string; name: string;
  sales: number; qty: number; orders: number;
  pay: Record<PayMethod, number>; paid: number;
  rest: number; restN: number;
  cancelled: number; cancelledN: number;
  exchange: number; exchangeN: number;
  reported: number;
}
const empty = (id: string, name: string): PageSit => ({ id, name, sales: 0, qty: 0, orders: 0, pay: { cash: 0, mvola: 0, orange: 0, airtel: 0 }, paid: 0, rest: 0, restN: 0, cancelled: 0, cancelledN: 0, exchange: 0, exchangeN: 0, reported: 0 });
const inRange = (iso: string | undefined, from: string, to: string) => { if (!iso) return false; const d = dayOf(iso); return d >= from && d <= to; };

/** Part de chaque page dans une commande (valeur des articles) : sert à répartir paiements, reste, annulations. */
export function orderShares(o: Order): Map<string, number> {
  const v = new Map<string, number>();
  for (const l of o.lines) { const p = variantPage(l.variantId) || '_'; v.set(p, (v.get(p) ?? 0) + Math.max(0, l.qty * l.unitPrice) || 0.0001); }
  for (const r of o.returnLines || []) { const p = variantPage(r.variantId) || '_'; if (!v.has(p)) v.set(p, 0.0001); }
  if (!v.size) v.set('_', 1);
  const tot = [...v.values()].reduce((s, x) => s + x, 0) || 1;
  return new Map([...v.entries()].map(([k, x]) => [k, x / tot]));
}
const saleDay = (o: Order) => (isWalkIn(o) ? o.createdAt : o.returnedAt || o.dispatchedAt || o.createdAt);

/**
 * `pages` : pages à afficher (vendeur) ; vide = toutes. Les montants d'une commande à plusieurs pages sont répartis
 * selon la valeur des articles de chaque page.
 */
export function situation(from: string, to: string, pages?: string[]) {
  const only = pages?.length ? new Set(pages) : null;
  const rows = new Map<string, PageSit>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) { r = empty(id, id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? 'Page supprimée'); rows.set(id, r); }
    return r;
  };
  const keep = (id: string) => !only || only.has(id);
  // Ventes (CA net des retours) et pièces
  const seen = new Map<string, Set<string>>();
  for (const l of salesLedger(from, to)) {
    const p = rootOf(l.categoryId) || '_'; if (!keep(p)) continue;
    const r = row(p); r.sales += l.amount; r.qty += l.qty;
    if (l.kind === 'sale') { const s = seen.get(p) ?? new Set(); s.add(l.order.id); seen.set(p, s); }
  }
  for (const [p, s] of seen) row(p).orders = s.size;
  const uniq = { rest: new Set<string>(), cancelled: new Set<string>(), exchange: new Set<string>(), orders: new Set<string>() };
  for (const s of seen.values()) for (const id of s) uniq.orders.add(id);
  const anyKept = (sh: Map<string, number>) => [...sh.keys()].some(keep);
  for (const o of all<Order>('orders')) {
    const sh = orderShares(o);
    // Argent reçu dans la période, par moyen (paiements négatifs = argent rendu)
    for (const pay of o.payments || []) {
      if (!inRange(pay.at, from, to)) continue;
      for (const [p, f] of sh) { if (!keep(p)) continue; const r = row(p); const v = pay.amount * f; r.pay[pay.method] = (r.pay[pay.method] ?? 0) + v; r.paid += v; }
    }
    // Reste à payer par les clients : ventes de la période pas encore payées entièrement
    if (['delivered', 'partial'].includes(o.status) && inRange(saleDay(o), from, to)) {
      const rest = remaining(o);
      if (rest > 0.5 && anyKept(sh)) uniq.rest.add(o.id);
      if (rest > 0.5) for (const [p, f] of sh) { if (!keep(p)) continue; const r = row(p); r.rest += rest * f; r.restN++; }
    }
    // Annulations de la période
    if (o.status === 'cancelled' && inRange(o.statusDates?.cancelled || o.updatedAt, from, to)) {
      const val = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      if (anyKept(sh)) uniq.cancelled.add(o.id);
      for (const [p, f] of sh) { if (!keep(p)) continue; const r = row(p); r.cancelled += val * f; r.cancelledN++; }
    }
    // Échanges créés dans la période
    if (o.kind === 'exchange' && o.status !== 'cancelled' && inRange(o.createdAt, from, to)) {
      const val = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      if (anyKept(sh)) uniq.exchange.add(o.id);
      for (const [p, f] of sh) { if (!keep(p)) continue; const r = row(p); r.exchange += val * f; r.exchangeN++; }
    }
    // Livraisons reportées dans la période
    const rep = (o.reports || []).filter((x) => inRange(x.at, from, to)).length;
    if (rep) for (const [p] of sh) { if (keep(p)) row(p).reported += rep; }
  }
  const order = new Map(all<Category>('categories').filter((c) => !c.parentId).map((c) => [c.id, c.order ?? 999]));
  const list = [...rows.values()].filter((r) => r.sales || r.paid || r.rest || r.cancelledN || r.exchangeN || r.reported)
    .sort((a, b) => b.sales - a.sales || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const total = empty('total', 'Total');
  for (const r of list) {
    total.sales += r.sales; total.qty += r.qty; total.orders += r.orders; total.paid += r.paid; total.rest += r.rest; total.restN += r.restN;
    total.cancelled += r.cancelled; total.cancelledN += r.cancelledN; total.exchange += r.exchange; total.exchangeN += r.exchangeN; total.reported += r.reported;
    for (const k of Object.keys(r.pay) as PayMethod[]) total.pay[k] += r.pay[k];
  }
  // Une commande sur plusieurs pages ne compte qu'une fois dans les totaux.
  total.orders = uniq.orders.size; total.restN = uniq.rest.size; total.cancelledN = uniq.cancelled.size; total.exchangeN = uniq.exchange.size;
  return { rows: list, total };
}
