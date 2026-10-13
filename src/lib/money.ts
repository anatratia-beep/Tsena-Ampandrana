// Trésorerie : comptes (caisse, mobile money, banque), mouvements, dépenses et revenus, règlements des
// livreurs, chiffres d'une journée et clôture (« Z de caisse »).
import { all, applyRemote, bizNow, dataVersion, get, newId, nowIso, remove, save, workDate, type BaseRecord } from './db';
import { audit, currentUser, type User } from './auth';
import { assertOpenAt } from './closed';
import { variantCost, type Variant } from './catalog';
import { adjustsKeptTotal, adjustsTotal } from './lots';
import { courierSplit, isPickupZone, isWalkIn, itemsTotal, keptTotal, recordReturn, remaining, sellingLines, type Courier, type Order, type PayMethod } from './orders';

// ---------- Comptes ----------
export type AccountId = PayMethod | 'bank';
export const ACCOUNTS: Record<AccountId, string> = { cash: 'Caisse espèces', mvola: 'MVola', orange: 'Orange Money', airtel: 'Airtel Money', bank: 'Banque' };
export const ACCOUNT_IDS = Object.keys(ACCOUNTS) as AccountId[];

export type MoveType = 'opening' | 'expense' | 'income' | 'transfer' | 'owner_in' | 'owner_out' | 'courier_settlement' | 'purchase' | 'gap';
export const MOVE_TYPES: Record<MoveType, string> = {
  opening: 'Solde de départ', expense: 'Dépense', income: 'Autre revenu', transfer: 'Virement entre comptes', owner_in: 'Apport du gérant',
  owner_out: 'Retrait du gérant', courier_settlement: 'Règlement livreur', purchase: 'Paiement fournisseur (Chine)', gap: 'Écart de clôture',
};
export interface CashMove extends BaseRecord {
  at: string;            // date et heure de l'opération
  account: AccountId;
  amount: number;        // + entrée, − sortie
  type: MoveType;
  categoryId?: string;
  label?: string;
  note?: string;
  photo?: string;        // photo du reçu
  transferId?: string;   // les deux lignes d'un virement
  recurringId?: string;
  period?: string;       // échéance d'une charge fixe (AAAA-MM, AAAA, ou AAAA-MM-JJ)
  typeId?: string;       // type de dépense (courante, charge fixe, exceptionnelle…)
  refType?: string;
  refId?: string;
  userName?: string;
}
/** kind 'etype' = type de dépense (Dépense courante, Charge fixe…). */
export interface FinanceCategory extends BaseRecord {
  kind: 'expense' | 'income' | 'etype'; name: string; order?: number; active: boolean;
  rhythm?: Rhythm;      // dépense : à quel rythme elle revient
  fixedAmount?: boolean; // dépense : toujours le même montant (loyer, salaire…) → charge fixe avec rappel
}
/** Rythme habituel d'une catégorie de dépense : décide de son type (courante, charge fixe, exceptionnelle). */
export type Rhythm = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'occasional';
export const RHYTHMS: Record<Rhythm, string> = { daily: 'Chaque jour (ou presque)', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année', occasional: 'De temps en temps, imprévu' };
const DEFAULT_HABIT: Record<string, [Rhythm, boolean]> = {
  'fc-loyer': ['monthly', true], 'fc-salaires': ['monthly', true], 'fc-jirama': ['monthly', false], 'fc-internet': ['monthly', false],
  'fc-transport': ['daily', false], 'fc-pub': ['weekly', false], 'fc-emballage': ['weekly', false], 'fc-transit': ['occasional', false],
  'fc-entretien': ['occasional', false], 'fc-impots': ['yearly', false], 'fc-frais-mm': ['daily', false], 'fc-divers': ['occasional', false],
};
/** Rythme et montant (fixe ou variable) d'une catégorie ; les catégories d'origine ont des valeurs par défaut. */
export function catHabit(c?: FinanceCategory): { rhythm: Rhythm; fixed: boolean } {
  const d = (c && DEFAULT_HABIT[c.id]) || ['occasional', false];
  return { rhythm: c?.rhythm ?? d[0], fixed: c?.fixedAmount ?? (c?.rhythm ? false : d[1]) };
}
/** Type déduit : imprévu → exceptionnelle ; revient régulièrement avec le même montant → charge fixe ; sinon → courante. */
export function typeForCat(c?: FinanceCategory): string {
  const h = catHabit(c);
  return h.rhythm === 'occasional' ? 'et-exception' : h.fixed ? 'et-fixe' : 'et-courante';
}
export const habitText = (c?: FinanceCategory) => { const h = catHabit(c); return h.rhythm === 'occasional' ? RHYTHMS.occasional : `${RHYTHMS[h.rhythm]} · montant ${h.fixed ? 'fixe' : 'variable'}`; };
export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export const FREQS: Record<Freq, string> = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
export const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export interface Recurring extends BaseRecord {
  kind: 'expense' | 'income'; label: string; categoryId: string; account: AccountId; amount: number;
  day: number;            // jour du mois (mensuel, annuel)
  startMonth: string;     // AAAA-MM : début
  freq?: Freq;            // mensuel par défaut
  weekday?: number;       // hebdomadaire : 0 = dimanche … 6 = samedi
  month?: number;         // annuel : 1 … 12
  time?: string;          // HH:MM : heure du rappel (notification)
  typeId?: string;        // type de dépense (Charge fixe par défaut)
  active: boolean; skipped?: string[];
}
export interface CourierSettlement extends BaseRecord { courierId: string; at: string; amount: number; account: AccountId; balanceBefore: number; orderIds: string[]; note?: string; userName?: string }
// ---------- Dates (heure de Madagascar = heure de l'appareil) ----------
const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const today = () => workDate() ?? dayOf(new Date().toISOString());
/** Fin de journée locale (pour les soldes « au soir du … »). */
export const endOf = (ymd: string) => new Date(`${ymd}T23:59:59.999`).toISOString();
/** Heure pour une opération saisie à une date : maintenant si c'est aujourd'hui, sinon midi ce jour-là. */
export const atFor = (ymd: string) => (ymd === today() ? bizNow() : new Date(`${ymd}T12:00:00`).toISOString());

// ---------- Catégories par défaut (identifiants fixes, identiques sur tous les appareils) ----------
const SEED = '2000-01-01T00:00:00.000Z';
const DEFAULT_CATS: [string, 'expense' | 'income' | 'etype', string][] = [
  ['fc-loyer', 'expense', 'Loyer'], ['fc-salaires', 'expense', 'Salaires'], ['fc-jirama', 'expense', 'Électricité et eau (JIRAMA)'],
  ['fc-internet', 'expense', 'Internet et crédit téléphone'], ['fc-transport', 'expense', 'Carburant et transport'], ['fc-pub', 'expense', 'Publicité Facebook'],
  ['fc-emballage', 'expense', 'Emballage'], ['fc-transit', 'expense', 'Transit et dédouanement'], ['fc-entretien', 'expense', 'Entretien et réparations'],
  ['fc-impots', 'expense', 'Impôts et taxes'], ['fc-frais-mm', 'expense', 'Frais Mobile Money'], ['fc-divers', 'expense', 'Dépenses diverses'],
  ['et-courante', 'etype', 'Dépense courante'], ['et-fixe', 'etype', 'Charge fixe'], ['et-exception', 'etype', 'Dépense exceptionnelle'],
  ['fc-location', 'income', 'Location'], ['fc-prestations', 'income', 'Prestations'], ['fc-commissions', 'income', 'Commissions'], ['fc-autres', 'income', 'Autres revenus'],
];
/** Remet les catégories de dépenses et revenus par défaut (après une remise à l'état d'origine). */
export async function restoreDefaultFinance() {
  await save('financeCategories', DEFAULT_CATS.map(([id, kind, name], i) => ({ id, kind, name, order: i, active: true, deleted: false })));
}
export async function seedFinance() {
  await applyRemote(DEFAULT_CATS.map(([id, kind, name], i) => ({ tbl: 'financeCategories', id, data: { id, kind, name, order: i, active: true, createdAt: SEED, updatedAt: SEED } as BaseRecord })));
}

// ---------- Soldes ----------
const ACCOUNT_OF_METHOD: Record<PayMethod, AccountId> = { cash: 'cash', mvola: 'mvola', orange: 'orange', airtel: 'airtel' };
/** Argent reçu (ou rendu) directement par la boutique, compte par compte. */
function shopPayments(until?: string) {
  const out: { at: string; account: AccountId; amount: number; order: Order }[] = [];
  for (const o of all<Order>('orders')) for (const p of o.payments || []) {
    if (p.receivedBy !== 'shop' || (until && p.at > until)) continue;
    out.push({ at: p.at, account: ACCOUNT_OF_METHOD[p.method], amount: p.amount, order: o });
  }
  return out;
}
export function balances(until?: string): Record<AccountId, number> {
  const b = Object.fromEntries(ACCOUNT_IDS.map((a) => [a, 0])) as Record<AccountId, number>;
  for (const p of shopPayments(until)) b[p.account] += p.amount;
  for (const m of all<CashMove>('cashMoves')) if (!until || m.at <= until) b[m.account] = (b[m.account] || 0) + m.amount;
  return b;
}

/** Toutes les entrées et sorties d'argent (ventes comprises) pour l'historique d'un compte. */
export interface Flow { id: string; at: string; account: AccountId; amount: number; label: string; detail?: string; move?: CashMove; orderId?: string }
export function flows(from?: string, to?: string, account?: AccountId): Flow[] {
  const inR = (iso: string) => (!from || dayOf(iso) >= from) && (!to || dayOf(iso) <= to);
  const list: Flow[] = [];
  for (const o of all<Order>('orders')) for (const p of o.payments || []) {
    if (p.receivedBy !== 'shop' || !inR(p.at)) continue;
    const acc = ACCOUNT_OF_METHOD[p.method];
    if (account && acc !== account) continue;
    list.push({ id: p.id, at: p.at, account: acc, amount: p.amount, label: p.amount < 0 ? `Remboursement ${o.number}` : `${o.internal ? 'Vente interne' : isWalkIn(o) ? 'Vente' : 'Paiement'} ${o.number}`, detail: [o.name, p.ref, p.userName].filter(Boolean).join(' · '), orderId: o.id });
  }
  const cats = new Map(all<FinanceCategory>('financeCategories').map((c) => [c.id, c.name]));
  for (const m of all<CashMove>('cashMoves')) {
    if (!inR(m.at) || (account && m.account !== account)) continue;
    list.push({ id: m.id, at: m.at, account: m.account, amount: m.amount, label: m.label || (m.categoryId && cats.get(m.categoryId)) || MOVE_TYPES[m.type], detail: [m.categoryId && m.label ? cats.get(m.categoryId) : MOVE_TYPES[m.type], m.note, m.userName].filter(Boolean).join(' · '), move: m });
  }
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- Opérations ----------
const who = () => currentUser()?.fullName;
export async function addMove(m: Omit<CashMove, 'id' | 'createdAt' | 'updatedAt' | 'userName'>) {
  if (m.type === 'expense' || m.type === 'income') assertOpenAt(m.at, m.type === 'expense' ? 'Dépense' : 'Revenu');
  const [r] = await save('cashMoves', { ...m, userName: who() });
  await audit(MOVE_TYPES[m.type], `${ACCOUNTS[m.account]} : ${m.amount > 0 ? '+' : ''}${m.amount} Ar${m.label ? ' — ' + m.label : ''}`, 'cashMoves', r.id);
  return r as CashMove;
}
export async function addTransfer(from: AccountId, to: AccountId, amount: number, at: string, note?: string, fee = 0) {
  const transferId = newId();
  const label = `${ACCOUNTS[from]} → ${ACCOUNTS[to]}`;
  await save('cashMoves', [
    { at, account: from, amount: -amount, type: 'transfer', transferId, label, note, userName: who() },
    { at, account: to, amount, type: 'transfer', transferId, label, note, userName: who() },
    ...(fee ? [{ at, account: from, amount: -fee, type: 'expense', categoryId: 'fc-frais-mm', label: `Frais de retrait ${ACCOUNTS[from]}`, transferId, userName: who() }] : []),
  ]);
  await audit('Virement entre comptes', `${label} : ${amount} Ar${fee ? ` (frais ${fee} Ar)` : ''}`, 'cashMoves', transferId);
}
export async function deleteMove(m: CashMove) {
  if (m.refType === 'purchases' || (m.type === 'purchase' && m.refId)) throw new Error('Ce mouvement est un paiement de commande Chine : supprimez-le depuis la commande (Achats), pour que la commande et la trésorerie restent d’accord.');
  if (m.type === 'courier_settlement') throw new Error('Ce mouvement est un versement de livreur : il ne se supprime pas depuis la trésorerie.');
  if (m.refType === 'payouts') throw new Error('Ce mouvement est un versement de la semaine : annulez-le depuis Récapitulatif → Semaine → Historique des versements.');
  if (m.type === 'expense' || m.type === 'income') assertOpenAt(m.at, 'Suppression');
  const linked = m.transferId ? all<CashMove>('cashMoves').filter((x) => x.transferId === m.transferId) : [m];
  for (const x of linked) await remove('cashMoves', x.id);
  await audit('Opération supprimée', `${MOVE_TYPES[m.type]} ${m.amount} Ar (${ACCOUNTS[m.account]})${m.label ? ' — ' + m.label : ''}`, 'cashMoves', m.id);
}

// ---------- Opérations récurrentes (loyer, salaires…) ----------
const monthsBetween = (start: string, end: string) => {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
};
/** Échéances d'une charge fixe jusqu'à un jour donné (AAAA-MM-JJ). */
export function occurrences(r: Recurring, until: string): { period: string; date: string }[] {
  const freq = r.freq ?? 'monthly';
  const start = `${r.startMonth}-01`;
  const out: { period: string; date: string }[] = [];
  if (freq === 'monthly') {
    for (const period of monthsBetween(r.startMonth, until.slice(0, 7))) {
      const [y, m] = period.split('-').map(Number);
      out.push({ period, date: `${period}-${pad(Math.min(r.day, new Date(y, m, 0).getDate()))}` });
    }
  } else if (freq === 'yearly') {
    for (let y = Number(r.startMonth.slice(0, 4)); y <= Number(until.slice(0, 4)); y++) {
      const m = r.month ?? 1;
      out.push({ period: String(y), date: `${y}-${pad(m)}-${pad(Math.min(r.day, new Date(y, m, 0).getDate()))}` });
    }
  } else {
    const d = new Date(`${start}T12:00:00`);
    if (freq === 'weekly') while (d.getDay() !== (r.weekday ?? 1)) d.setDate(d.getDate() + 1);
    const limit = new Date(`${until}T12:00:00`); limit.setDate(limit.getDate() - (freq === 'daily' ? 31 : 7 * 26)); // pas plus loin que 1 mois / 6 mois en arrière
    for (; dayOf(d.toISOString()) <= until; d.setDate(d.getDate() + (freq === 'daily' ? 1 : 7))) {
      if (d < limit) continue;
      const ymd = dayOf(d.toISOString());
      out.push({ period: ymd, date: ymd });
    }
  }
  return out.filter((o) => o.date >= start);
}
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** Échéances arrivées (jour et heure) et pas encore payées ni ignorées. */
export function dueRecurring(kind?: 'expense' | 'income'): { r: Recurring; period: string; date: string }[] {
  const t = today();
  const moves = all<CashMove>('cashMoves');
  const out: { r: Recurring; period: string; date: string }[] = [];
  for (const r of all<Recurring>('recurring')) {
    if (!r.active || (kind && r.kind !== kind)) continue;
    for (const o of occurrences(r, t)) {
      if (o.date > t || (o.date === t && r.time && hhmm() < r.time) || r.skipped?.includes(o.period)) continue;
      if (moves.some((x) => x.recurringId === r.id && x.period === o.period)) continue;
      out.push({ r, ...o });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
/** Prochaine échéance (pour l'affichage). */
export function nextOccurrence(r: Recurring): string | undefined {
  const t = today();
  const far = addDays(t, 400);
  return occurrences(r, far).find((o) => o.date >= t && !r.skipped?.includes(o.period))?.date;
}
export function recurringText(r: Recurring) {
  const f = r.freq ?? 'monthly';
  const when = f === 'monthly' ? `le ${r.day} de chaque mois` : f === 'weekly' ? `chaque ${WEEKDAYS[r.weekday ?? 1]}` : f === 'daily' ? 'chaque jour' : `chaque année le ${r.day}/${pad(r.month ?? 1)}`;
  return `${when}${r.time ? ` à ${r.time}` : ''}`;
}
export async function confirmRecurring(d: { r: Recurring; period: string; date: string }, amount: number, account: AccountId) {
  await addMove({ at: atFor(d.date), account, amount: d.r.kind === 'expense' ? -amount : amount, type: d.r.kind, categoryId: d.r.categoryId, label: d.r.label, recurringId: d.r.id, period: d.period, typeId: d.r.kind === 'expense' ? d.r.typeId ?? 'et-fixe' : undefined });
}
export async function skipRecurring(d: { r: Recurring; period: string }) {
  await save('recurring', { id: d.r.id, skipped: [...(d.r.skipped || []), d.period] });
}

// ---------- Livreurs : compte et versements ----------
const CLOSED = ['delivered', 'partial', 'refused'];
/**
 * Ce qu'une livraison doit rapporter à la boutique par le livreur : argent encaissé auprès du client − frais du livreur.
 * Commande encore dehors : ce qu'il doit encaisser (reste à payer, frais compris) − ses frais prévus.
 */
export function deliveryNet(o: Order) {
  const x = courierSplit(o);
  return { collect: x.toCollect, clientPays: x.clientPays, fee: x.fee, feeOwed: x.feeOwed, net: x.net, done: x.closed };
}

/**
 * Compte d'un livreur. Seules les livraisons cochées au moment du versement sont réglées ;
 * les autres restent « en attente » et passent automatiquement au versement suivant.
 * carry = reste dû sur les versements précédents (+ : le livreur doit encore, − : la boutique lui doit).
 */
export function courierBalance(courierId: string, until?: string) {
  let carry = 0, pendingNet = 0, pendingCollect = 0, pendingFeeOwed = 0, outOrders = 0, outPieces = 0, collected = 0, fees = 0, settled = 0;
  const pending: Order[] = [];
  for (const o of all<Order>('orders')) {
    if (o.courierId !== courierId || o.status === 'cancelled' || !o.dispatchedAt || isPickupZone(o.zoneId)) continue;
    if (until && o.dispatchedAt > until) continue;
    const d = deliveryNet(o);
    const settledThen = o.courierSettledAt && (!until || o.courierSettledAt <= until);
    if (settledThen) carry += d.net;
    else { pending.push(o); pendingNet += d.net; pendingCollect += d.collect; pendingFeeOwed += d.feeOwed; }
    if (o.status === 'out') { outOrders++; outPieces += o.lines.reduce((t, l) => t + l.qty, 0); }
    if (d.done) { collected += d.collect; fees += d.fee; }
  }
  for (const s of all<CourierSettlement>('courierSettlements')) if (s.courierId === courierId && (!until || s.at <= until)) settled += s.amount;
  carry -= settled;
  return { carry, pendingNet, pendingCollect, pendingFeeOwed, due: carry + pendingNet, pending: pending.sort((a, b) => (a.dispatchedAt || '').localeCompare(b.dispatchedAt || '')), outOrders, outPieces, collected, fees, settled };
}

/**
 * Versement d'un livreur : seules les livraisons cochées sont réglées. Une commande cochée encore « en livraison »
 * (sans articles en choix) est marquée livrée : le client a payé au livreur tout ce qui restait.
 * amount + : le livreur remet l'argent ; − : la boutique lui verse ses frais.
 */
export async function settleCourier(c: Courier, orderIds: string[], amount: number, account: AccountId, note?: string) {
  const blocked = orderIds.map((id) => get<Order>('orders', id)).filter((o): o is Order => !!o && o.status === 'out' && o.lines.some((l) => l.isChoice));
  if (blocked.length) throw new Error(`Choix du client à préciser avant le versement : ${blocked.map((o) => o.number).join(', ')}`);
  for (const id of orderIds) {
    const o = get<Order>('orders', id);
    if (o && o.status === 'out' && !o.lines.some((l) => l.isChoice)) {
      await recordReturn(o, { kept: Object.fromEntries(o.lines.map((l) => [l.id, l.qty])), feeCharged: o.deliveryFee || 0, collected: remaining(o) > 0 ? [{ amount: remaining(o), method: 'cash' }] : [], note: 'Livrée (cochée au versement)' });
    }
  }
  const before = courierBalance(c.id);
  const checked = orderIds.map((id) => get<Order>('orders', id)!).filter(Boolean);
  const expected = before.carry + checked.reduce((t, o) => t + deliveryNet(o).net, 0);
  const at = bizNow();
  const [s] = await save('courierSettlements', { courierId: c.id, at, amount, account, balanceBefore: expected, orderIds, note, userName: who() });
  if (amount) await save('cashMoves', { at, account, amount, type: 'courier_settlement', label: `${amount > 0 ? 'Versement de' : 'Frais versés à'} ${c.name}`, note, refType: 'courierSettlements', refId: s.id, userName: who() });
  // Les commandes réglées ne peuvent plus changer de livreur.
  if (orderIds.length) await save('orders', orderIds.map((id) => ({ id, courierSettledAt: at })));
  await audit('Versement livreur', `${c.name} : ${amount >= 0 ? 'remis ' + amount : 'versé ' + -amount} Ar (${ACCOUNTS[account]}) — attendu ${expected} Ar, ${orderIds.length} livraison(s) cochée(s)`, 'courierSettlements', s.id);
  return s as CourierSettlement;
}

/** Ce qui empêche de supprimer un livreur : colis encore chez lui, argent pas réglé, frais encore dus. */
export function courierRemovalBlockers(courierId: string): string[] {
  const b = courierBalance(courierId);
  const out: string[] = [];
  if (b.outOrders) out.push(`${b.outOrders} colis encore en livraison chez lui : faites d’abord le retour du livreur.`);
  if (Math.round(b.due) > 0) out.push(`Il doit encore ${Math.round(b.due).toLocaleString('fr-FR')} Ar à la boutique : faites d’abord son règlement.`);
  if (Math.round(b.due) < 0) out.push(`La boutique lui doit encore ${Math.round(-b.due).toLocaleString('fr-FR')} Ar (frais) : payez-le d’abord.`);
  const waiting = all<Order>('orders').filter((o) => o.courierId === courierId && (o.status === 'confirmed' || o.status === 'ready' || o.status === 'new')).length;
  if (waiting) out.push(`${waiting} commande(s) en attente lui sont déjà attribuées : changez de livreur d’abord.`);
  return out;
}
/**
 * Supprimer un livreur : il disparaît des listes et ne peut plus recevoir de colis. Ses anciennes livraisons et ses
 * règlements gardent son nom. Son compte de connexion (rôle Livreur), s'il en a un, est supprimé aussi.
 */
export async function removeCourier(c: Courier) {
  const blockers = courierRemovalBlockers(c.id);
  if (blockers.length) throw new Error(blockers.join(' '));
  const me = currentUser();
  await save('couriers', { id: c.id, active: false, removed: true, removedAt: new Date().toISOString(), removedBy: me?.fullName });
  const linked = all<User>('users').filter((u) => u.courierId === c.id && !u.removed);
  for (const u of linked) await save('users', { id: u.id, active: false, removed: true, removedAt: new Date().toISOString(), removedBy: me?.fullName, username: `${u.username}~supprime-${u.id.slice(0, 6)}` });
  await audit('Livreur supprimé', `${c.name}${linked.length ? ` (et son accès : ${linked.map((u) => u.username).join(', ')})` : ''}`, 'couriers', c.id);
}

// ---------- Récapitulatif d'une journée ou d'une semaine ----------
export interface DeliveryRow { o: Order; courierId: string; value: number; collect: number; clientPays: number; fee: number; feeOwed: number; net: number; done: boolean; settled: boolean }
export interface CourierRow { courierId: string; name: string; count: number; value: number; collect: number; clientPays: number; fees: number; feeOwed: number; net: number; delivered: number; refused: number; out: number; paidIn: number; carry: number; pending: number; balance: number }
export interface Report {
  from: string; to: string;
  sales: { count: number; amount: number; shopCount: number; shopAmount: number; onlineCount: number; onlineAmount: number; internalCount: number; internalAmount: number };
  returns: { count: number; amount: number };
  netSales: number; cost: number; grossProfit: number;
  walkIns: Order[];
  deliveries: DeliveryRow[];
  couriers: CourierRow[];
  expenses: number; expensesByCat: { name: string; amount: number }[]; expenseMoves: CashMove[];
  incomes: number; otherMoves: CashMove[];
  receipts: Record<AccountId, number>;        // reçu directement par la boutique (ventes sur place, acomptes, mobile money…)
  fromCouriers: Record<AccountId, number>;    // versements des livreurs
  collectedByCouriers: number;
  courierFees: number;
  courierDue: number;                          // total à verser par les livreurs en fin de période
  balancesEnd: Record<AccountId, number>;
}
/** Compatibilité : ancien nom. */
export type DayStats = Report;

const costOf = (variantId: string) => { const v = get<Variant>('variants', variantId); return v ? variantCost(v) : 0; };

/**
 * Règle de comptage : les articles partis avec un livreur (hors « choix ») sont vendus le jour du départ.
 * Ce qui revient ensuite est un « retour » le jour du retour ; les choix gardés sont vendus le jour du retour.
 */
export function report(from: string, to: string): Report {
  const z = () => Object.fromEntries(ACCOUNT_IDS.map((a) => [a, 0])) as Record<AccountId, number>;
  const inR = (iso?: string) => { if (!iso) return false; const d = dayOf(iso); return d >= from && d <= to; };
  const s: Report = {
    from, to, sales: { count: 0, amount: 0, shopCount: 0, shopAmount: 0, onlineCount: 0, onlineAmount: 0, internalCount: 0, internalAmount: 0 }, returns: { count: 0, amount: 0 },
    netSales: 0, cost: 0, grossProfit: 0, walkIns: [], deliveries: [], couriers: [], expenses: 0, expensesByCat: [], expenseMoves: [], incomes: 0, otherMoves: [],
    receipts: z(), fromCouriers: z(), collectedByCouriers: 0, courierFees: 0, courierDue: 0, balancesEnd: z(),
  };
  const addSale = (o: Order, amount: number, cost: number, count: boolean) => {
    s.sales.amount += amount; s.cost += cost;
    if (o.internal) { s.sales.internalAmount += amount; if (count) s.sales.internalCount++; }
    if (isWalkIn(o) || o.pickedUp) { s.sales.shopAmount += amount; if (count) s.sales.shopCount++; } else { s.sales.onlineAmount += amount; if (count) s.sales.onlineCount++; }
    if (count) s.sales.count++;
  };
  for (const o of all<Order>('orders')) {
    if (isWalkIn(o)) {
      if (o.status !== 'cancelled' && inR(o.createdAt)) { addSale(o, keptTotal(o) - (o.discount || 0), o.lines.reduce((t, l) => t + (l.qtyKept ?? l.qty) * costOf(l.variantId), 0), true); s.walkIns.push(o); }
      continue;
    }
    if (!o.dispatchedAt) continue;
    const nonChoice = sellingLines(o);
    if (inR(o.dispatchedAt)) {
      const value = itemsTotal(o) - (o.discount || 0);
      addSale(o, value, nonChoice.reduce((t, l) => t + l.qty * costOf(l.variantId), 0), true);
      if (o.pickedUp && o.status !== 'cancelled') s.walkIns.push(o);
      else if (o.status !== 'cancelled') { const d = deliveryNet(o); s.deliveries.push({ o, courierId: isPickupZone(o.zoneId) ? '' : o.courierId || '', value, ...d, settled: !!o.courierSettledAt }); }
    }
    const back = o.status === 'cancelled' ? o.statusDates?.cancelled : o.returnedAt;
    if (inR(back)) {
      let ret = 0, retCost = 0;
      if (o.status === 'cancelled') { ret = itemsTotal(o) - (o.discount || 0); retCost = nonChoice.reduce((t, l) => t + l.qty * costOf(l.variantId), 0); }
      else {
        for (const l of o.lines) {
          if (l.isChoice) { const k = l.qtyKept ?? 0; if (k) addSale(o, k * l.unitPrice, k * costOf(l.variantId), false); }
          else { const r = l.qtyReturned ?? 0; ret += r * l.unitPrice; retCost += r * costOf(l.variantId); }
        }
        ret += adjustsTotal(o) - adjustsKeptTotal(o); // lot devenu incomplet : prix normal pour ce qui est gardé
        for (const rl of o.returnLines || []) { ret += rl.qty * rl.unitPrice; retCost += rl.qty * costOf(rl.variantId); }
        if (o.credit && !(o.returnLines || []).length) ret += o.credit;
        s.courierFees += o.feeCharged ?? 0;
      }
      if (ret) { s.returns.amount += ret; s.cost -= retCost; s.returns.count++; }
    }
  }
  s.netSales = s.sales.amount - s.returns.amount;
  s.grossProfit = s.netSales - s.cost;

  for (const o of all<Order>('orders')) for (const p of o.payments || []) {
    if (!inR(p.at)) continue;
    if (p.receivedBy === 'shop') s.receipts[ACCOUNT_OF_METHOD[p.method]] += p.amount;
    else s.collectedByCouriers += p.amount;
  }
  const cats = new Map(all<FinanceCategory>('financeCategories').map((c) => [c.id, c.name]));
  const byCat = new Map<string, number>();
  const paidIn = new Map<string, number>();
  for (const st of all<CourierSettlement>('courierSettlements')) if (inR(st.at)) paidIn.set(st.courierId, (paidIn.get(st.courierId) ?? 0) + st.amount);
  for (const m of all<CashMove>('cashMoves').sort((a, b) => a.at.localeCompare(b.at))) {
    if (!inR(m.at)) continue;
    if (m.type === 'expense') { s.expenses += -m.amount; s.expenseMoves.push(m); const n = (m.categoryId && cats.get(m.categoryId)) || 'Sans catégorie'; byCat.set(n, (byCat.get(n) ?? 0) - m.amount); }
    else if (m.type === 'courier_settlement') { if (m.amount > 0) s.fromCouriers[m.account] += m.amount; }
    else { if (m.type === 'income') s.incomes += m.amount; if (!(m.type === 'transfer' && m.amount > 0)) s.otherMoves.push(m); }
  }
  s.expensesByCat = [...byCat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const end = endOf(to);
  for (const c of all<Courier>('couriers')) {
    const mine = s.deliveries.filter((d) => d.courierId === c.id);
    const b = courierBalance(c.id, end);
    if (!mine.length && !b.due && !paidIn.get(c.id) && !b.outOrders) continue;
    s.couriers.push({
      courierId: c.id, name: c.name, count: mine.length, value: mine.reduce((t, d) => t + d.value, 0), collect: mine.reduce((t, d) => t + d.collect, 0),
      clientPays: mine.reduce((t, d) => t + d.clientPays, 0), fees: mine.reduce((t, d) => t + d.fee, 0), feeOwed: mine.reduce((t, d) => t + d.feeOwed, 0), net: mine.reduce((t, d) => t + d.net, 0),
      delivered: mine.filter((d) => ['delivered', 'partial'].includes(d.o.status)).length, refused: mine.filter((d) => d.o.status === 'refused').length, out: mine.filter((d) => d.o.status === 'out').length,
      paidIn: paidIn.get(c.id) ?? 0, carry: b.carry, pending: b.pendingNet, balance: b.due,
    });
    s.courierDue += Math.max(0, b.due);
  }
  s.couriers.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  s.balancesEnd = balances(end);
  return s;
}
export const dayStats = (date: string) => report(date, date);

/** Lundi de la semaine d'une date (AAAA-MM-JJ). */
export function mondayOf(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d.toISOString());
}
export function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n); return dayOf(d.toISOString()); }

// ---------- Frais de livraison du livreur, commande par commande ----------
export type FeeState = 'none' | 'pending' | 'kept' | 'paid' | 'deferred' | 'settled';
export const FEE_STATE: Record<FeeState, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  none: { label: 'Pas de frais', tone: 'neutral' }, pending: { label: 'Pas encore réglés', tone: 'warn' }, kept: { label: 'Gardés par le livreur', tone: 'ok' },
  paid: { label: 'Payés au livreur', tone: 'ok' }, deferred: { label: 'Différés : à payer', tone: 'danger' }, settled: { label: 'Réglés', tone: 'ok' },
};
/** État noté sur la commande (anciennes commandes : retrouvé par la note du versement). */
function rawFeeState(o: Order): FeeState {
  if (!o.courierId || isPickupZone(o.zoneId) || !o.dispatchedAt) return 'none';
  if (!courierSplit(o).fee) return 'none';
  if (o.feeStatus) return o.feeStatus;
  if (!o.courierSettledAt) return 'pending';
  const s = all<CourierSettlement>('courierSettlements').find((x) => x.orderIds?.includes(o.id));
  const n = (s?.note || '').toLowerCase();
  return /différ|plus tard/.test(n) ? 'deferred' : /payés à part/.test(n) ? 'paid' : 'kept';
}
/**
 * Commandes dont les frais sont vraiment encore dus au livreur : on part de ce que la boutique lui doit réellement
 * (solde de son compte) et on l'attribue aux frais notés « différés », des plus récents aux plus anciens.
 * Ainsi l'état affiché ne contredit jamais le compte (ex. livreur qui a finalement gardé ses frais).
 */
const defCache = new Map<string, { v: number; list: Order[] }>();
export function deferredOrders(courierId: string): Order[] {
  const c = defCache.get(courierId);
  if (c && c.v === dataVersion()) return c.list;
  const list = computeDeferred(courierId);
  defCache.set(courierId, { v: dataVersion(), list });
  return list;
}
function computeDeferred(courierId: string): Order[] {
  const owed = Math.max(0, -courierBalance(courierId).carry);
  const flagged = all<Order>('orders').filter((o) => o.courierId === courierId && rawFeeState(o) === 'deferred').sort((a, b) => (b.courierSettledAt || '').localeCompare(a.courierSettledAt || ''));
  const out: Order[] = []; let left = owed;
  for (const o of flagged) { const f = courierSplit(o).fee; if (f <= left + 0.5) { out.push(o); left -= f; } }
  return out;
}
export const deferredTotal = (courierId: string) => deferredOrders(courierId).reduce((t, o) => t + courierSplit(o).fee, 0);
export function feeState(o: Order): FeeState {
  const r = rawFeeState(o);
  if (r !== 'deferred') return r;
  return deferredOrders(o.courierId!).some((x) => x.id === o.id) ? 'deferred' : 'settled';
}
/** Payer des frais différés au livreur : enregistre le paiement et marque les commandes concernées (les plus anciennes d'abord). */
export async function payDeferredFees(c: Courier, amount: number, account: AccountId, only?: Order[]) {
  const list = (only ?? deferredOrders(c.id)).sort((a, b) => (a.courierSettledAt || '').localeCompare(b.courierSettledAt || ''));
  await settleCourier(c, [], -amount, account, `Frais de livraison différés payés${list.length ? ' : ' + list.map((o) => o.number).join(', ') : ''}`);
  let left = amount; const at = bizNow();
  for (const o of list) {
    const f = courierSplit(o).fee; if (left + 0.5 < f) break;
    left -= f;
    await save('orders', { id: o.id, feeStatus: 'paid', feePaidAt: at, feePaidHow: ACCOUNTS[account] });
  }
}
