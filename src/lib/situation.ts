// Situation par page (accueil) : ventes, argent reçu par moyen de paiement, reste à payer, annulations, échanges et
// livraisons reportées, sur une période. Un vendeur ne voit que ses pages ; le gérant voit toutes les pages.
import { all, get } from './db';
import { salesLedger } from './analytics';
import { rootOf, variantPage } from './scope';
import { dayOf } from './money';
import type { Order, PayMethod } from './orders';
import type { Category } from './catalog';

export interface PageSit {
  id: string; name: string;
  /** Total des commandes de la période = ventes + annulé + reporté. */
  gross: number;
  /** Ventes (net) = espèces + MVola + Orange + Airtel + reste à payer. */
  sales: number; qty: number; orders: number;
  pay: Record<PayMethod, number>; paid: number;
  rest: number; restN: number;
  cancelled: number; cancelledN: number;
  /** Échanges pris par le client (déjà compris dans les ventes). */
  exchange: number; exchangeN: number;
  reported: number; reportedN: number;
}
const empty = (id: string, name: string): PageSit => ({ id, name, gross: 0, sales: 0, qty: 0, orders: 0, pay: { cash: 0, mvola: 0, orange: 0, airtel: 0 }, paid: 0, rest: 0, restN: 0, cancelled: 0, cancelledN: 0, exchange: 0, exchangeN: 0, reported: 0, reportedN: 0 });
const inRange = (iso: string | undefined, from: string, to: string) => { if (!iso) return false; const d = dayOf(iso); return d >= from && d <= to; };

/** Part de chaque page dans une commande (valeur des articles) : sert à répartir annulations et reports. */
export function orderShares(o: Order): Map<string, number> {
  const v = new Map<string, number>();
  for (const l of o.lines) { const p = variantPage(l.variantId) || '_'; v.set(p, (v.get(p) ?? 0) + Math.max(0, l.qty * l.unitPrice) || 0.0001); }
  for (const r of o.returnLines || []) { const p = variantPage(r.variantId) || '_'; if (!v.has(p)) v.set(p, 0.0001); }
  if (!v.size) v.set('_', 1);
  const tot = [...v.values()].reduce((s, x) => s + x, 0) || 1;
  return new Map([...v.entries()].map(([k, x]) => [k, x / tot]));
}
const itemsValue = (o: Order) => o.lines.reduce((s, l) => s + (l.isChoice ? 0 : l.qty * l.unitPrice), 0) - (o.discount || 0);

/**
 * Situation d'une période, par page (`pages` : pages du vendeur ; vide = toutes) :
 * - Ventes = ce qui est vendu (sur place, livré ; retours déduits ; un échange pris par le client compte comme une vente,
 *   un échange non pris est simplement retiré). Elles se répartissent exactement en espèces + MVola + Orange Money +
 *   Airtel Money (paiements de ces ventes, quel que soit le jour du paiement) + reste à payer.
 * - Annulé : commandes de la période annulées (retirées du total).
 * - Reporté : livraisons reportées ce jour-là (retirées du total ; la commande passe à la date du report).
 * - Total des commandes = ventes + annulé + reporté.
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
  const uniq = { orders: new Set<string>(), rest: new Set<string>(), cancelled: new Set<string>(), exchange: new Set<string>(), reported: new Set<string>() };
  // 1. Ventes de la période, par commande et par page (registre des ventes : sorties, ventes sur place, retours)
  const byOrder = new Map<string, { o: Order; pages: Map<string, number>; qty: Map<string, number> }>();
  for (const l of salesLedger(from, to)) {
    const p = rootOf(l.categoryId) || '_';
    let e = byOrder.get(l.order.id); if (!e) { e = { o: l.order, pages: new Map(), qty: new Map() }; byOrder.set(l.order.id, e); }
    e.pages.set(p, (e.pages.get(p) ?? 0) + l.amount); e.qty.set(p, (e.qty.get(p) ?? 0) + l.qty);
  }
  for (const { o, pages: pg, qty } of byOrder.values()) {
    const sold = [...pg.values()].reduce((s, x) => s + x, 0);
    for (const [p, q] of qty) if (keep(p)) row(p).qty += q;
    if (sold <= 0.5) { for (const [p, a] of pg) if (keep(p)) row(p).sales += a; continue; } // retour d'une vente d'un autre jour
    // Paiements de cette vente, répartis par moyen ; ce qui dépasse la valeur des articles (frais de livraison) n'est pas compté.
    const byM: Record<PayMethod, number> = { cash: 0, mvola: 0, orange: 0, airtel: 0 };
    for (const pay of o.payments || []) byM[pay.method] = (byM[pay.method] ?? 0) + pay.amount;
    const paidAll = Math.max(0, Object.values(byM).reduce((s, x) => s + x, 0));
    const counted = Math.min(paidAll, sold);
    const isEx = o.kind === 'exchange';
    let mine = false;
    for (const [p, a] of pg) {
      if (!keep(p)) continue; mine = true;
      const f = a / sold; const r = row(p);
      r.sales += a;
      for (const m of Object.keys(byM) as PayMethod[]) { const v = paidAll ? (byM[m] / paidAll) * counted * f : 0; r.pay[m] += v; r.paid += v; }
      const rest = (sold - counted) * f; if (rest > 0.5) { r.rest += rest; r.restN++; }
      if (isEx) { r.exchange += a; r.exchangeN++; }
      r.orders++;
    }
    if (mine) { uniq.orders.add(o.id); if (sold - counted > 0.5) uniq.rest.add(o.id); if (isEx) uniq.exchange.add(o.id); }
  }
  for (const o of all<Order>('orders')) {
    const sh = orderShares(o);
    const val = Math.max(0, itemsValue(o));
    // 2. Annulé : commandes de la période qui ont été annulées
    if (o.status === 'cancelled' && inRange(o.createdAt, from, to)) {
      let mine = false;
      for (const [p, f] of sh) { if (!keep(p)) continue; mine = true; const r = row(p); r.cancelled += val * f; r.cancelledN++; }
      if (mine) uniq.cancelled.add(o.id);
    }
    // 3. Reporté : la livraison devait se faire ce jour-là et a été reportée (une fois par commande sur la période ;
    //    une commande finalement annulée compte seulement dans « annulé »). La commande passe à sa nouvelle date.
    if (o.status !== 'cancelled' && (o.reports || []).some((rep) => inRange(rep.at, from, to)) && !byOrder.has(o.id)) {
      let mine = false;
      for (const [p, f] of sh) { if (!keep(p)) continue; mine = true; const r = row(p); r.reported += val * f; r.reportedN++; }
      if (mine) uniq.reported.add(o.id);
    }
  }
  const order = new Map(all<Category>('categories').filter((c) => !c.parentId).map((c) => [c.id, c.order ?? 999]));
  for (const r of rows.values()) r.gross = r.sales + r.cancelled + r.reported;
  const list = [...rows.values()].filter((r) => r.gross || r.qty || r.cancelledN || r.reportedN)
    .sort((a, b) => b.gross - a.gross || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const total = empty('total', 'Total');
  for (const r of list) {
    total.gross += r.gross; total.sales += r.sales; total.qty += r.qty; total.paid += r.paid; total.rest += r.rest;
    total.cancelled += r.cancelled; total.exchange += r.exchange; total.reported += r.reported;
    for (const k of Object.keys(r.pay) as PayMethod[]) total.pay[k] += r.pay[k];
  }
  // Une commande sur plusieurs pages ne compte qu'une fois dans les totaux.
  total.orders = uniq.orders.size; total.restN = uniq.rest.size; total.cancelledN = uniq.cancelled.size; total.exchangeN = uniq.exchange.size; total.reportedN = uniq.reported.size;
  return { rows: list, total };
}
