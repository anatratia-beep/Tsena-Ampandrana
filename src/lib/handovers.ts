// Versements des vendeurs au responsable (chaque soir).
//
// Chaque vendeur gère sa page : il vend sur place, reçoit l'argent de ses colis quand le livreur revient, et paie
// parfois une petite dépense (taxi, emballage…). Le soir, il remet l'argent au responsable.
// Pour chaque vendeur et chaque jour :
// - ventes par page (même règle que les récapitulatifs : livraisons comptées le jour du départ, retours déduits) ;
// - argent encaissé ce jour-là sur ses commandes, par moyen : espèces, MVola, Orange Money, Airtel Money ;
// - frais de livraison gardés par les livreurs (déjà retirés de l'argent qu'ils rapportent) ;
// - dépenses qu'il a payées avec la caisse ;
// - TOTAL À PAYER = espèces − frais gardés par les livreurs (les dépenses sont débitées de la caisse de la boutique).
//   Le mobile money arrive sur les numéros de la boutique : il est affiché pour contrôle, mais pas à remettre.
// Le responsable saisit le montant réellement reçu et valide : le versement est tracé (montant, écart, qui, quand).
import { all, get, getMeta, save, type BaseRecord } from './db';
import { audit, currentUser, roleOf, type User } from './auth';
import { salesLedger } from './analytics';
import { rootOf, variantPage } from './scope';
import { dayOf, type CashMove } from './money';
import { courierSplit, isPickupZone, isWalkIn, unpaidOf, type Order, type PayMethod } from './orders';
import type { Category } from './catalog';
import { COURIER_ROLE, SUPERADMIN_ROLE } from './permissions';
import { firstPayDay } from './situation';

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
  toPay: number;                           // espèces − frais (dépenses : caisse de la boutique)
  mobile: number;                          // MVola + Orange + Airtel (sur les numéros de la boutique)
  outParcels: number;                      // colis encore chez les livreurs
  /** Espèces encaissées ce jour-là pour des ventes des jours précédents (« reste d'hier »). */
  cashOld: number;
  /** Détail des espèces du jour venant de ventes des jours précédents (avant frais livreurs) : 1er paiement du reste
   *  (jour de travail suivant la vente) et 2ème paiement (après). Espèces des ventes du jour = pay.cash − cash1 − cash2. */
  cash1: number; cash2: number;
  /** Ventes pas encore encaissées (à ce jour) : colis en livraison, argent chez le livreur, client qui doit encore. */
  pending: PendingSale[];
  handover?: Handover;
}
export interface PendingSale { o: Order; day: string; amount: number; why: 'out' | 'courier' | 'client' }
/** Jour de la vente : départ avec le livreur, ou date de la vente sur place. */
export const saleDay = (o: Order) => dayOf((isWalkIn(o) || !o.dispatchedAt ? o.createdAt : o.dispatchedAt) || o.createdAt);

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
  const pay: Record<PayMethod, number> = { cash: 0, mvola: 0, orange: 0, airtel: 0, card: 0 };
  let shopCash = 0, courierCash = 0, fees = 0, outParcels = 0, cashOld = 0, cash1 = 0, cash2 = 0;
  const pending: PendingSale[] = [];
  for (const o of all<Order>('orders')) {
    if (!isMine(o, u)) continue;
    const old = saleDay(o) < date;
    const oldCash = (n: number) => { if (!old) return; if (date <= firstPayDay(saleDay(o))) cash1 += n; else cash2 += n; };
    for (const p of o.payments || []) {
      // Espèces encaissées par le livreur : comptées le jour où il les verse (règlement), pas le jour de la livraison.
      if (p.method === 'cash' && p.receivedBy === 'courier') continue;
      if (dayOf(p.at) !== date) continue;
      pay[p.method] += p.amount;
      if (p.method === 'cash') { shopCash += p.amount; if (old) cashOld += p.amount; oldCash(p.amount); }
    }
    if (o.courierSettledAt && dayOf(o.courierSettledAt) === date) {
      const got = (o.payments || []).filter((p) => p.method === 'cash' && p.receivedBy === 'courier').reduce((t, p) => t + p.amount, 0);
      pay.cash += got; courierCash += got; if (old) cashOld += got; oldCash(got);
      // Le livreur garde ses frais sur l'argent encaissé : ce que le vendeur reçoit est diminué d'autant.
      if (!isPickupZone(o.zoneId) && o.feeStatus !== 'paid') { const f = courierSplit(o).feeKept; fees += f; if (old) cashOld -= f; }
    }
    if (o.status === 'out') outParcels++;
    // Ventes pas encore encaissées, jusqu'à ce jour
    if (o.status === 'cancelled' || saleDay(o) > date) continue;
    if (!isWalkIn(o) && !o.dispatchedAt) continue;
    const left = unpaidOf(o); if (left) pending.push({ o, day: saleDay(o), ...left });
  }
  const expenseMoves = all<CashMove>('cashMoves').filter((m) => m.type === 'expense' && m.account === 'cash' && m.userName === u.fullName && dayOf(m.at) === date).sort((a, b) => a.at.localeCompare(b.at));
  const expenses = expenseMoves.reduce((t, m) => t - m.amount, 0);
  const list = [...pages.entries()].map(([pageId, s]) => ({ pageId, name: pageLabel(pageId), sales: s })).sort((a, b) => b.sales - a.sales);
  const h = handoverOf(u.id, date);
  return {
    user: u, date, pages: list, sales, orders: seen.size, pay, shopCash, courierCash, fees, expenses, expenseMoves,
    // Les dépenses sont débitées de la caisse de la boutique, pas du versement du vendeur.
    toPay: pay.cash - fees, mobile: pay.mvola + pay.orange + pay.airtel, outParcels, cashOld, cash1, cash2,
    pending: pending.sort((a, b) => a.day.localeCompare(b.day) || (a.o.number || '').localeCompare(b.o.number || '')),
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

/**
 * Versement du jour par PAGE (au lieu de par vendeur) : mêmes règles que la feuille d'un vendeur (ventes du jour,
 * espèces / mobile money encaissés ce jour, frais gardés par les livreurs, total à payer = espèces − frais), mais
 * regroupées par page. Une commande qui mélange plusieurs pages est répartie au prorata de ses articles.
 * Le montant reçu par page est tracé à part (id « ho_page:… ») : les versements par vendeur ne changent pas.
 */
export interface PageDay extends SellerDay { pageId: string; sellers: string[] }
export const pageKey = (pageId: string) => `page:${pageId}`;

export function pagesOfDay(date: string): PageDay[] {
  const users = all<User>('users').filter((u) => u.roleId !== SUPERADMIN_ROLE && u.roleId !== COURIER_ROLE);
  const ownerOf = (o: Order) => users.find((u) => isMine(o, u));
  const rows = new Map<string, PageDay & { ids: Set<string>; names: Set<string> }>();
  const row = (pageId: string) => {
    let r = rows.get(pageId);
    if (!r) {
      const name = pageLabel(pageId);
      r = { pageId, sellers: [], ids: new Set(), names: new Set(), user: { id: pageKey(pageId), fullName: name } as User, date, pages: [{ pageId, name, sales: 0 }], sales: 0, orders: 0,
        pay: { cash: 0, mvola: 0, orange: 0, airtel: 0, card: 0 }, shopCash: 0, courierCash: 0, fees: 0, expenses: 0, expenseMoves: [], toPay: 0, mobile: 0, outParcels: 0, cashOld: 0, cash1: 0, cash2: 0, pending: [] };
      rows.set(pageId, r);
    }
    return r;
  };
  for (const l of salesLedger(date, date)) {
    const u = ownerOf(l.order); if (!u) continue;
    const r = row(rootOf(l.categoryId) || '_');
    r.sales += l.amount; r.pages[0].sales += l.amount; r.names.add(u.fullName);
    if (l.kind === 'sale') r.ids.add(l.order.id);
  }
  for (const o of all<Order>('orders')) {
    const u = ownerOf(o); if (!u) continue;
    const old = saleDay(o) < date, first = old && date <= firstPayDay(saleDay(o));
    const oldCash = (r: PageDay, n: number) => { if (!old) return; if (first) r.cash1 += n; else r.cash2 += n; };
    const share = pageShare(o);
    const add = (f: (r: PageDay, k: number) => void) => { for (const [p, k] of share) { const r = row(p); f(r, k); rows.get(p)!.names.add(u.fullName); } };
    for (const p of o.payments || []) {
      if (p.method === 'cash' && p.receivedBy === 'courier') continue;
      if (dayOf(p.at) !== date) continue;
      add((r, k) => { r.pay[p.method] += p.amount * k; if (p.method === 'cash') { r.shopCash += p.amount * k; if (old) r.cashOld += p.amount * k; oldCash(r, p.amount * k); } });
    }
    if (o.courierSettledAt && dayOf(o.courierSettledAt) === date) {
      const got = (o.payments || []).filter((p) => p.method === 'cash' && p.receivedBy === 'courier').reduce((t, p) => t + p.amount, 0);
      const f = !isPickupZone(o.zoneId) && o.feeStatus !== 'paid' ? courierSplit(o).feeKept : 0;
      add((r, k) => { r.pay.cash += got * k; r.courierCash += got * k; r.fees += f * k; if (old) r.cashOld += (got - f) * k; oldCash(r, got * k); });
    }
  }
  const list = [...rows.values()].map(({ ids, names, ...r }) => {
    r.orders = ids.size; r.sellers = [...names].sort((a, b) => a.localeCompare(b, 'fr'));
    r.toPay = r.pay.cash - r.fees; r.mobile = r.pay.mvola + r.pay.orange + r.pay.airtel;
    const h = handoverOf(r.user.id, date); r.handover = h?.status === 'received' ? h : undefined;
    return r;
  }).filter((r) => r.sales || r.pay.cash || r.mobile || r.fees || r.handover);
  return list.sort((a, b) => Number(!!a.handover) - Number(!!b.handover) || b.sales - a.sales || a.user.fullName.localeCompare(b.user.fullName, 'fr'));
}

/** Part de chaque page dans une commande (au prorata des articles ; une seule page dans la plupart des cas). */
function pageShare(o: Order): Map<string, number> {
  const w = new Map<string, number>(); let tot = 0;
  for (const l of o.lines || []) { const p = variantPage(l.variantId) || '_'; const v = Math.max(0, (l.unitPrice || 0) * (l.qty || 0)); w.set(p, (w.get(p) ?? 0) + v); tot += v; }
  if (!w.size) w.set('_', 1);
  if (tot <= 0) { const k = 1 / w.size; for (const p of w.keys()) w.set(p, k); return w; }
  for (const [p, v] of w) w.set(p, v / tot);
  return w;
}
