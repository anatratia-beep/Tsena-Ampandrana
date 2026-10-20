// Situation par page (accueil) : ventes, argent reçu par moyen de paiement, reste à payer, annulations, échanges et
// livraisons reportées, sur une période. Un vendeur ne voit que ses pages ; le gérant voit toutes les pages.
import { all, get } from './db';
import { salesLedger } from './analytics';
import { rootOf, variantPage } from './scope';
import { addDays, dayOf } from './money';
import type { Order, PayMethod } from './orders';
import type { Category } from './catalog';

export interface PageSit {
  id: string; name: string;
  /** Total des commandes de la période = ventes + annulé + reporté. */
  gross: number;
  /** Ventes (net) = espèces + MVola + Orange + Airtel + reste à payer. */
  sales: number; qty: number; orders: number;
  /** Payé le jour de la vente, par moyen. */
  pay: Record<PayMethod, number>; paid: number;
  /** Reste payé plus tard : 1er paiement du reste (jour de travail suivant la vente), 2ème paiement (jours d'après). */
  later1: number; later2: number;
  /** Reste encore à payer aujourd'hui. */
  rest: number; restN: number;
  cancelled: number; cancelledN: number;
  /** Échanges pris par le client (déjà compris dans les ventes). */
  exchange: number; exchangeN: number;
  reported: number; reportedN: number;
}
const empty = (id: string, name: string): PageSit => ({ id, name, gross: 0, sales: 0, qty: 0, orders: 0, pay: { cash: 0, mvola: 0, orange: 0, airtel: 0 }, paid: 0, later1: 0, later2: 0, rest: 0, restN: 0, cancelled: 0, cancelledN: 0, exchange: 0, exchangeN: 0, reported: 0, reportedN: 0 });
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
/**
 * Jour où l'argent d'un paiement arrive à la boutique : les espèces encaissées par le livreur arrivent le jour où il
 * les verse (règlement) ; tant qu'il ne les a pas versées, elles ne sont pas encore reçues (null).
 */
export function payDay(o: Order, p: { at: string; method: PayMethod; receivedBy?: string }): string | null {
  if (p.method === 'cash' && p.receivedBy === 'courier') return o.courierSettledAt ? dayOf(o.courierSettledAt) : null;
  return dayOf(p.at);
}
/** Jour du 1er paiement du reste : le jour de travail qui suit la vente (le dimanche n'est pas travaillé : samedi → lundi). */
export function firstPayDay(day: string): string {
  const d = addDays(day, 1);
  return new Date(`${d}T12:00:00`).getDay() === 0 ? addDays(d, 1) : d;
}
const itemsValue = (o: Order) => o.lines.reduce((s, l) => s + (l.isChoice ? 0 : l.qty * l.unitPrice), 0) - (o.discount || 0);

/**
 * Situation d'une période, par page (`pages` : pages du vendeur ; vide = toutes) :
 * - Ventes = ce qui est vendu (sur place, livré ; retours déduits ; un échange pris par le client compte comme une vente,
 *   un échange non pris est simplement retiré). Elles se répartissent exactement en espèces + MVola + Orange Money +
 *   Airtel Money (payés le jour de la vente) + 1er paiement du reste + 2ème paiement du reste + reste à payer. 1er paiement :
 *   le jour de travail suivant la vente (samedi → lundi, le dimanche n'est pas travaillé) ; 2ème paiement : les jours d'après.
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
  const byOrder = new Map<string, { o: Order; pages: Map<string, number>; qty: Map<string, number>; day: string }>();
  for (const l of salesLedger(from, to)) {
    const p = rootOf(l.categoryId) || '_';
    let e = byOrder.get(l.order.id); if (!e) { e = { o: l.order, pages: new Map(), qty: new Map(), day: l.day }; byOrder.set(l.order.id, e); }
    if (l.kind === 'sale' && l.day < e.day) e.day = l.day;
    e.pages.set(p, (e.pages.get(p) ?? 0) + l.amount); e.qty.set(p, (e.qty.get(p) ?? 0) + l.qty);
  }
  for (const { o, pages: pg, qty, day } of byOrder.values()) {
    const sold = [...pg.values()].reduce((s, x) => s + x, 0);
    for (const [p, q] of qty) if (keep(p)) row(p).qty += q;
    if (sold <= 0.5) { for (const [p, a] of pg) if (keep(p)) row(p).sales += a; continue; } // retour d'une vente d'un autre jour
    // Paiements de cette vente : ceux du jour de la vente (par moyen), puis le reste payé plus tard
    // (1er paiement : le jour de travail suivant, samedi → lundi ; 2ème paiement : les jours d'après — le reste réglé
    // n'apparaît plus en « reste à payer »). Ce qui dépasse la valeur des articles (frais de livraison) n'est pas compté.
    const byM: Record<PayMethod, number> = { cash: 0, mvola: 0, orange: 0, airtel: 0 };
    let l1 = 0, l2 = 0;
    const p1Day = firstPayDay(day);
    for (const pay of o.payments || []) {
      const d = payDay(o, pay);
      if (!d) continue; // espèces encore chez le livreur : pas encore reçues
      if (d <= day) { byM[pay.method] = (byM[pay.method] ?? 0) + pay.amount; continue; }
      if (d <= p1Day) l1 += pay.amount; else l2 += pay.amount;
    }
    const sameTot = Math.max(0, Object.values(byM).reduce((s, x) => s + x, 0));
    const counted = Math.max(0, Math.min(sameTot + l1 + l2, sold));
    const takeSame = Math.min(sameTot, counted);
    const take1 = Math.min(Math.max(0, l1), counted - takeSame);
    const take2 = Math.max(0, counted - takeSame - take1);
    const isEx = o.kind === 'exchange';
    let mine = false;
    for (const [p, a] of pg) {
      if (!keep(p)) continue; mine = true;
      const f = a / sold; const r = row(p);
      r.sales += a;
      for (const m of Object.keys(byM) as PayMethod[]) { const v = sameTot ? (Math.max(0, byM[m]) / Object.values(byM).reduce((s, x) => s + Math.max(0, x), 0)) * takeSame * f : 0; r.pay[m] += v; r.paid += v; }
      r.later1 += take1 * f; r.later2 += take2 * f; r.paid += (take1 + take2) * f;
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
    total.gross += r.gross; total.sales += r.sales; total.qty += r.qty; total.paid += r.paid; total.rest += r.rest; total.later1 += r.later1; total.later2 += r.later2;
    total.cancelled += r.cancelled; total.exchange += r.exchange; total.reported += r.reported;
    for (const k of Object.keys(r.pay) as PayMethod[]) total.pay[k] += r.pay[k];
  }
  // Une commande sur plusieurs pages ne compte qu'une fois dans les totaux.
  total.orders = uniq.orders.size; total.restN = uniq.rest.size; total.cancelledN = uniq.cancelled.size; total.exchangeN = uniq.exchange.size; total.reportedN = uniq.reported.size;
  return { rows: list, total };
}

export interface RestRow {
  o: Order; day: string; pages: string[]; value: number;
  sameDay: number;
  p1?: { day: string; amount: number }; p2?: { day: string; amount: number; times: number };
  /** Encore à payer aujourd'hui (y compris l'argent encore chez le livreur). */
  rest: number; atCourier: number;
}
/**
 * Restes à payer des ventes de la période (jour de la vente) : payé le jour, 1er paiement du reste, 2ème paiement du reste,
 * reste encore dû. `pages` : limiter aux pages d'un vendeur.
 */
export function restLedger(from: string, to: string, pages?: string[]): RestRow[] {
  const only = pages?.length ? new Set(pages) : null;
  const byOrder = new Map<string, { o: Order; day: string; value: number; pages: Set<string> }>();
  for (const l of salesLedger(from, to)) {
    let e = byOrder.get(l.order.id); if (!e) { e = { o: l.order, day: l.day, value: 0, pages: new Set() }; byOrder.set(l.order.id, e); }
    e.value += l.amount; e.pages.add(rootOf(l.categoryId) || '_');
    if (l.kind === 'sale' && l.day < e.day) e.day = l.day;
  }
  const out: RestRow[] = [];
  for (const { o, day, value, pages: pg } of byOrder.values()) {
    if (value <= 0.5) continue;
    if (only && ![...pg].some((p) => only.has(p))) continue;
    let same = 0, atCourier = 0; const later = new Map<string, number>();
    for (const p of o.payments || []) {
      const d = payDay(o, p);
      if (!d) { atCourier += p.amount; continue; }
      if (d <= day) same += p.amount; else later.set(d, (later.get(d) ?? 0) + p.amount);
    }
    let left = value;
    const sameDay = Math.max(0, Math.min(same, left)); left -= sameDay;
    // 1er paiement du reste = jour de travail suivant la vente (samedi → lundi) ; les jours d'après = 2ème paiement.
    const p1Day = firstPayDay(day);
    const d1 = [...later.keys()].filter((d) => d <= p1Day).sort(), d2 = [...later.keys()].filter((d) => d > p1Day).sort();
    let p1: RestRow['p1'], p2: RestRow['p2'];
    if (d1.length && left > 0.5) { const a = Math.max(0, Math.min(d1.reduce((t, d) => t + later.get(d)!, 0), left)); left -= a; if (a > 0.5) p1 = { day: d1[d1.length - 1], amount: a }; }
    if (d2.length && left > 0.5) { const tot = d2.reduce((t, d) => t + later.get(d)!, 0); const a = Math.max(0, Math.min(tot, left)); left -= a; if (a > 0.5) p2 = { day: d2[d2.length - 1], amount: a, times: d2.length }; }
    if (!p1 && !p2 && left <= 0.5 && sameDay >= value - 0.5) continue; // payé entièrement le jour même : pas de reste
    out.push({ o, day, pages: [...pg], value, sameDay, p1, p2, rest: Math.max(0, left), atCourier: Math.min(Math.max(0, atCourier), Math.max(0, left)) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.o.number || '').localeCompare(b.o.number || ''));
}
