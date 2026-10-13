// Versements des vendeurs au responsable (chaque soir).
//
// Chaque vendeur gère sa page : il vend sur place, reçoit l'argent de ses colis quand le livreur revient, et paie
// parfois une petite dépense (taxi, emballage…). Le soir, il remet l'argent au responsable.
// Pour chaque vendeur et chaque jour :
// - ventes par page (même règle que les récapitulatifs : livraisons comptées le jour du départ, retours déduits) ;
// - argent encaissé ce jour-là sur ses commandes, par moyen : espèces, MVola, Orange Money, Airtel Money ;
// - frais de livraison gardés par les livreurs (déjà retirés de l'argent qu'ils rapportent) ;
// - dépenses qu'il a payées avec la caisse ;
// - TOTAL À PAYER = espèces − frais gardés par les livreurs − dépenses.
//   Le mobile money arrive sur les numéros de la boutique : il est affiché pour contrôle, mais pas à remettre.
// Le responsable saisit le montant réellement reçu et valide : le versement est tracé (montant, écart, qui, quand).
import { all, get, getMeta, save, type BaseRecord } from './db';
import { audit, currentUser, roleOf, type User } from './auth';
import { salesLedger } from './analytics';
import { rootOf } from './scope';
import { dayOf, type CashMove } from './money';
import { courierSplit, isPickupZone, isWalkIn, type Order, type PayMethod } from './orders';
import type { Category } from './catalog';
import { COURIER_ROLE, SUPERADMIN_ROLE } from './permissions';

export interface Handover extends BaseRecord {
  userId: string; userName: string; date: string;
  sales: number; perPage: { pageId: string; name: string; sales: number }[];
  cash: number; mvola: number; orange: number; airtel: number;
  fees: number; expenses: number;
  expected: number;        // total à payer calculé au moment de la validation
  amount: number;          // montant réellement remis au responsable
  gap: number;             // amount − expected
  note?: string;
  byId?: string; byName?: string; at: string; device?: string;
  status: 'received' | 'cancelled';
  cancelledBy?: string; cancelledAt?: string; cancelReason?: string;
}

export const handoverId = (userId: string, date: string) => `ho_${userId}_${date}`;
export const handoverOf = (userId: string, date: string) => get<Handover>('handovers', handoverId(userId, date));

/** Commande saisie par ce vendeur. */
export const isMine = (o: Pick<Order, 'createdBy' | 'createdByName'>, u: Pick<User, 'id' | 'fullName'>) => o.createdBy === u.id || (!o.createdBy && !!o.createdByName && o.createdByName === u.fullName);

export interface SellerDay {
  user: User; date: string;
  pages: { pageId: string; name: string; sales: number }[];
  sales: number; orders: number;
  pay: Record<PayMethod, number>;          // encaissé ce jour-là, tous moyens
  shopCash: number; courierCash: number;   // détail des espèces : sur place / rapportées par les livreurs
  fees: number;                            // frais de livraison gardés par les livreurs
  expenses: number; expenseMoves: CashMove[];
  toPay: number;                           // espèces − frais − dépenses
  mobile: number;                          // MVola + Orange + Airtel (sur les numéros de la boutique)
  outParcels: number;                      // colis encore chez les livreurs
  handover?: Handover;
}

const pageLabel = (id: string) => (id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? 'Page supprimée');

/** Feuille du jour d'un vendeur. */
export function sellerDay(u: User, date: string): SellerDay {
  const pages = new Map<string, number>(); const seen = new Set<string>();
  let sales = 0;
  for (const l of salesLedger(date, date)) {
    if (!isMine(l.order, u)) continue;
    const p = rootOf(l.categoryId) || '_';
    pages.set(p, (pages.get(p) ?? 0) + l.amount); sales += l.amount;
    if (l.kind === 'sale') seen.add(l.order.id);
  }
  const pay: Record<PayMethod, number> = { cash: 0, mvola: 0, orange: 0, airtel: 0 };
  let shopCash = 0, courierCash = 0, fees = 0, outParcels = 0;
  for (const o of all<Order>('orders')) {
    if (!isMine(o, u)) continue;
    for (const p of o.payments || []) {
      if (dayOf(p.at) !== date) continue;
      pay[p.method] += p.amount;
      if (p.method === 'cash') { if (p.receivedBy === 'courier') courierCash += p.amount; else shopCash += p.amount; }
    }
    if (o.status === 'out') outParcels++;
    // Le livreur garde ses frais sur l'argent encaissé : ce que le vendeur reçoit est diminué d'autant.
    if (!isWalkIn(o) && o.courierId && !isPickupZone(o.zoneId) && o.returnedAt && dayOf(o.returnedAt) === date && o.feeStatus !== 'paid') fees += courierSplit(o).feeKept;
  }
  const expenseMoves = all<CashMove>('cashMoves').filter((m) => m.type === 'expense' && m.account === 'cash' && m.userName === u.fullName && dayOf(m.at) === date).sort((a, b) => a.at.localeCompare(b.at));
  const expenses = expenseMoves.reduce((t, m) => t - m.amount, 0);
  const list = [...pages.entries()].map(([pageId, s]) => ({ pageId, name: pageLabel(pageId), sales: s })).sort((a, b) => b.sales - a.sales);
  const h = handoverOf(u.id, date);
  return {
    user: u, date, pages: list, sales, orders: seen.size, pay, shopCash, courierCash, fees, expenses, expenseMoves,
    toPay: pay.cash - fees - expenses, mobile: pay.mvola + pay.orange + pay.airtel, outParcels,
    handover: h?.status === 'received' ? h : undefined,
  };
}

const active = (d: SellerDay) => !!(d.sales || d.pay.cash || d.mobile || d.expenses || d.fees || d.handover);

/** Vendeurs concernés : ceux qui vendent (droit « feuille de versement ») et tous ceux qui ont eu une activité ce jour. */
export function sellersOfDay(date: string, includeEmpty = true): SellerDay[] {
  const users = all<User>('users').filter((u) => u.roleId !== SUPERADMIN_ROLE && u.roleId !== COURIER_ROLE);
  const rows = users.map((u) => sellerDay(u, date)).filter((d) => active(d) || (includeEmpty && d.user.active && !!roleOf(d.user)?.permissions.includes('handover.self')));
  return rows.sort((a, b) => Number(!!a.handover) - Number(!!b.handover) || b.toPay - a.toPay || a.user.fullName.localeCompare(b.user.fullName, 'fr'));
}

/** Le responsable valide le versement d'un vendeur pour un jour. Une seule fois par vendeur et par jour. */
export async function receiveHandover(d: SellerDay, amount: number, note?: string) {
  if (!(amount >= 0) || !isFinite(amount)) throw new Error('Montant reçu invalide.');
  const cur = handoverOf(d.user.id, d.date);
  if (cur?.status === 'received') throw new Error(`Déjà reçu le ${new Date(cur.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} par ${cur.byName ?? '?'}.`);
  const me = currentUser();
  const gap = amount - d.toPay;
  await save('handovers', {
    id: handoverId(d.user.id, d.date), userId: d.user.id, userName: d.user.fullName, date: d.date,
    sales: d.sales, perPage: d.pages, cash: d.pay.cash, mvola: d.pay.mvola, orange: d.pay.orange, airtel: d.pay.airtel,
    fees: d.fees, expenses: d.expenses, expected: d.toPay, amount, gap, note: note || undefined,
    byId: me?.id, byName: me?.fullName, at: new Date().toISOString(), device: getMeta('deviceName', '') || undefined,
    status: 'received', cancelledBy: undefined, cancelledAt: undefined, cancelReason: undefined, deleted: false,
  } as Partial<Handover>);
  await audit('Versement vendeur reçu', `${d.user.fullName}, ${d.date} : ${ar(amount)} reçu (à payer ${ar(d.toPay)}${gap ? `, écart ${gap > 0 ? '+' : ''}${ar(gap)}` : ''})`, 'handovers', handoverId(d.user.id, d.date));
}

/** Annule un versement validé par erreur : le vendeur redevient « à recevoir », l'annulation reste tracée. */
export async function cancelHandover(h: Handover, reason: string) {
  const me = currentUser();
  await save('handovers', { id: h.id, status: 'cancelled', cancelledBy: me?.fullName, cancelledAt: new Date().toISOString(), cancelReason: reason });
  await audit('Versement vendeur annulé', `${h.userName}, ${h.date} : ${ar(h.amount)} — ${reason}`, 'handovers', h.id);
}

export const handoverHistory = (userId?: string) => all<Handover>('handovers').filter((h) => !userId || h.userId === userId).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));

/** Le calcul a changé depuis la validation (vente ou dépense ajoutée ensuite). */
export const changedSince = (d: SellerDay) => !!d.handover && Math.round(d.handover.expected) !== Math.round(d.toPay);

const ar = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} Ar`;
