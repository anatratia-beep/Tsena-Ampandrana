// Commandes clients, livraisons, livreurs, zones : règles de calcul et actions.
import { all, applyRemote, bizNow, get, newId, save, type BaseRecord } from './db';
import { audit, currentUser } from './auth';
import { addMoves, nextNumber, stockOf, variantLabel, type Product, type StockMove, type Variant } from './catalog';
import { DEFAULT_COMPANY, type Company } from './settings';
import { assertOpenNow } from './closed';
import { adjustsKeptTotal, adjustsTotal, computeAdjusts, type Adjust } from './lots';

export interface Zone extends BaseRecord { name: string; fee: number; order?: number; active: boolean; pickup?: boolean }
/** Zone « Sur boutique » : le client vient chercher, pas de frais ni de livreur. */
export const isPickupZone = (z?: Zone | string) => { const zone = typeof z === 'string' ? get<Zone>('zones', z) : z; return !!zone && (zone.pickup || zone.id === 'zone-retrait'); };
export interface Courier extends BaseRecord { name: string; phone?: string; zoneIds?: string[]; active: boolean; notes?: string; userId?: string; feeClaimAt?: string; removed?: boolean; removedAt?: string; removedBy?: string }
export interface Customer extends BaseRecord { phone?: string; phone2?: string; name?: string; facebook?: string; place?: string; zoneId?: string; notes?: string }

export type OrderStatus = 'new' | 'confirmed' | 'ready' | 'out' | 'delivered' | 'partial' | 'refused' | 'cancelled';
export type PayMethod = 'cash' | 'mvola' | 'orange' | 'airtel';
export const PAY_METHODS: Record<PayMethod, string> = { cash: 'Espèces', mvola: 'MVola', orange: 'Orange Money', airtel: 'Airtel Money' };

export interface OrderLine {
  id: string;
  variantId: string;
  qty: number;
  unitPrice: number;
  priceManual?: boolean;
  isChoice?: boolean;       // envoyé en choix (taille…), pas encore vendu
  wholesale?: boolean;      // prix de gros pour cet article (sinon prix détail)
  qtyKept?: number;         // renseigné au retour du livreur
  qtyReturned?: number;
  /** Article faisant partie d'un lot / d'une promotion (même lotKey = même lot vendu). */
  lotKey?: string;
  lotProductId?: string;
  lotItem?: string;         // élément du lot
  lotPer?: number;          // quantité de cet élément par lot
  lotN?: number;            // nombre de lots
  lotPrice?: number;        // prix d'un lot au moment de la vente
  gift?: boolean;           // offert (promotion)
}
export interface Payment {
  id: string;
  at: string;
  amount: number;
  method: PayMethod;
  ref?: string;
  receivedBy: 'shop' | 'courier';
  courierId?: string;
  note?: string;
  userName?: string;
  /** Corrections faites par l'admin : ancien et nouveau montant, date, utilisateur. */
  edits?: { at: string; user?: string; fromAmount: number; toAmount: number; fromMethod: PayMethod; toMethod: PayMethod; reason?: string }[];
}
export interface Order extends BaseRecord {
  number: string;
  kind: 'order' | 'exchange';
  parentId?: string;              // commande d'origine (échange)
  channel: 'facebook' | 'phone' | 'shop' | 'other';
  customerId?: string;
  phone: string;
  name?: string;
  facebook?: string;              // nom Facebook du client
  zoneId?: string;
  place?: string;
  placeToConfirm?: boolean;
  deliveryFee: number;
  feeCharged?: number;            // frais réellement facturés (au retour)
  wholesale?: 'auto' | 'yes' | 'no';
  wantedDate?: string;
  lines: OrderLine[];
  /** Prix du lot / prix par quantité : différence avec les prix normaux des articles. */
  adjusts?: Adjust[];
  returnLines?: { variantId: string; qty: number; unitPrice: number }[]; // échange : articles repris au client
  credit?: number;                // échange : valeur des articles repris
  discount: number;
  discountPct?: number;           // remise saisie en pourcentage (pour l’affichage)
  payments: Payment[];
  notes?: string;
  status: OrderStatus;
  statusDates?: Partial<Record<OrderStatus, string>>;
  outsideHours?: boolean;
  courierId?: string;
  dispatchedAt?: string;
  returnedAt?: string;
  cashGiven?: number;             // espèces données par le client (vente sur place), pour la monnaie sur le ticket
  courierSettledAt?: string;      // versement du livreur validé (étape 6) : plus de changement de livreur
  feeStatus?: 'kept' | 'paid' | 'deferred'; // frais du livreur : gardés sur le versement, payés à part, ou différés
  feePaidAt?: string; feePaidHow?: string;
  events?: { at: string; text: string; user?: string }[];
  createdBy?: string;
  createdByName?: string;
  /** Vente interne : achat d'un employé, au prix de revient arrondi. */
  internal?: boolean;
  employeeId?: string;
  employeeName?: string;
  /** Prévue en livraison, finalement retirée par le client en boutique : comptée comme vente sur place. */
  pickedUp?: boolean;
  /** Livraisons reportées à la demande du client (au plus 3 fois, ensuite la commande est annulée). */
  reports?: { at: string; to?: string; reason?: string; user?: string; courierId?: string }[];
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'ok' | 'danger' }> = {
  new: { label: 'Enregistrée', tone: 'brand' },
  confirmed: { label: 'Enregistrée', tone: 'brand' },
  ready: { label: 'En attente de livraison', tone: 'warn' },
  out: { label: 'En livraison', tone: 'warn' },
  delivered: { label: 'Livrée', tone: 'ok' },
  partial: { label: 'Livrée en partie', tone: 'ok' },
  refused: { label: 'Refusée', tone: 'danger' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};
export const CHANNELS = { facebook: 'Facebook', phone: 'Téléphone', shop: 'Vente sur place (boutique)', other: 'Autre' };
export const isWalkIn = (o: Pick<Order, 'channel'>) => o.channel === 'shop';
export const isInternal = (o: Pick<Order, 'internal'>) => !!o.internal;
/** Nom affiché : client, sinon téléphone, sinon « Vente sur place ». */
export const orderLabel = (o: Pick<Order, 'name' | 'phone' | 'channel'> & Partial<Pick<Order, 'internal' | 'employeeName' | 'facebook'>>) =>
  o.internal ? `Vente interne · ${o.employeeName || '?'}` : o.name || o.facebook || (o.phone ? fmtPhone(o.phone) : o.channel === 'shop' ? 'Vente sur place' : '—');

/** Prix d'une vente interne : prix de revient arrondi au palier supérieur (1 Ar par défaut, ou 100, 500…). */
export function internalPrice(variantId: string, step = 1) {
  const v = get<Variant>('variants', variantId);
  const cost = v?.costAvg ?? 0;
  if (cost <= 0) return 0;
  const st = step > 0 ? step : 1;
  return Math.ceil(Math.round(cost * 1000) / 1000 / st) * st;
}

// ---------- Téléphones ----------
export function normPhone(p: string) {
  let d = (p || '').replace(/\D/g, '');
  if (d.startsWith('261')) d = '0' + d.slice(3);
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  return d;
}
export function fmtPhone(p?: string) {
  const d = normPhone(p || '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : p || '';
}
/** Identifiant d'un nouveau client tiré de son téléphone : créé hors ligne sur deux appareils, il ne fait qu'un. */
export const customerIdFor = (phone: string) => `cus_${normPhone(phone)}`;
export function findCustomer(phone: string) {
  const n = normPhone(phone);
  if (n.length < 6) return undefined;
  return all<Customer>('customers').find((c) => (c.phone && normPhone(c.phone) === n) || (c.phone2 && normPhone(c.phone2) === n));
}

// ---------- Zones par défaut (identifiants fixes : identiques sur tous les appareils) ----------
const SEED = '2000-01-01T00:00:00.000Z';
const DEFAULT_ZONES = [
  ['zone-retrait', 'Sur boutique (retrait par le client)', 0], ['zone-centre', 'Tana centre-ville', 3000], ['zone-proche', 'Tana périphérie proche', 4000],
  ['zone-peripherie', 'Tana périphérie', 5000], ['zone-loin', 'Tana grande périphérie', 7000], ['zone-province', 'Province (envoi taxi-brousse / coopérative)', 5000],
] as const;
/** Remet les zones par défaut (après une remise à l'état d'origine). */
export async function restoreDefaultZones() {
  await save('zones', DEFAULT_ZONES.map(([id, name, fee], i) => ({ id, name, fee, order: i, active: true, pickup: id === 'zone-retrait' || undefined, deleted: false })));
}
export async function seedZones() {
  await applyRemote(DEFAULT_ZONES.map(([id, name, fee], i) => ({ tbl: 'zones', id, data: { id, name, fee, order: i, active: true, pickup: id === 'zone-retrait' || undefined, createdAt: SEED, updatedAt: SEED } as BaseRecord })));
}

// ---------- Horaires ----------
export function isOutsideHours(d: Date, c: Company) {
  const hours = c.hours ?? DEFAULT_COMPANY.hours!;
  const h = hours[String(d.getDay())];
  if (!h) return true;
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return t < h.open || t >= h.close;
}

// ---------- Montants ----------
export const sellingLines = (o: Order) => o.lines.filter((l) => !l.isChoice);
/** Livraison partie avec des articles « en choix » dont le client n'a pas encore dit ce qu'il garde. */
export const hasPendingChoice = (o: Pick<Order, 'status' | 'lines'>) => o.status === 'out' && o.lines.some((l) => l.isChoice);
export const choiceQty = (o: Pick<Order, 'lines'>) => o.lines.filter((l) => l.isChoice).reduce((s, l) => s + l.qty, 0);
export function itemsTotal(o: Pick<Order, 'lines' | 'adjusts'>) { return o.lines.filter((l) => !l.isChoice).reduce((s, l) => s + l.qty * l.unitPrice, 0) + adjustsTotal(o); }
/** Montant des articles gardés : le prix du lot ne compte que pour les lots complets, le reste au prix normal. */
export function keptTotal(o: Pick<Order, 'lines' | 'adjusts'>) { return o.lines.reduce((s, l) => s + (l.qtyKept ?? (l.isChoice ? 0 : l.qty)) * l.unitPrice, 0) + adjustsKeptTotal(o); }
export const paidTotal = (o: Order) => (o.payments || []).reduce((s, p) => s + p.amount, 0);
const isClosed = (o: Order) => ['delivered', 'partial', 'refused'].includes(o.status);
/** Montant total à payer par le client (articles − remise − reprise + frais). */
export function orderTotal(o: Order) {
  const items = isClosed(o) ? keptTotal(o) : itemsTotal(o);
  const fee = isClosed(o) ? (o.feeCharged ?? o.deliveryFee) : o.deliveryFee;
  return Math.max(0, items - (o.discount || 0)) + (fee || 0);
}
/** Différence pour un échange (positive : le client paie ; négative : on lui rend). */
export function exchangeBalance(o: Order) {
  const items = isClosed(o) ? keptTotal(o) : itemsTotal(o);
  return items - (o.discount || 0) - (o.credit || 0) + (isClosed(o) ? (o.feeCharged ?? o.deliveryFee) : o.deliveryFee);
}
export function remaining(o: Order) {
  const due = o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o);
  return due - paidTotal(o);
}
/**
 * Répartition pour le livreur. Le client paie d'abord les articles, puis les frais.
 * - toCollect : ce que le livreur encaisse pour la boutique (articles, sans ses frais) → à verser ;
 * - feeKept   : frais qu'il encaisse auprès du client et garde ;
 * - feeOwed   : frais déjà payés à la boutique (ex. tout payé par Mobile Money) → à lui reverser en espèces ;
 * - clientPays: total réellement payé par le client au livreur (articles + frais), pour information.
 * Exemple : articles 50 000, frais 3 000, Mobile Money 20 000 → le livreur encaisse 30 000 pour la boutique + 3 000 de frais.
 */
export function courierSplit(o: Order) {
  const closed = ['delivered', 'partial', 'refused'].includes(o.status);
  const fee = closed ? (o.feeCharged ?? o.deliveryFee ?? 0) : (o.deliveryFee || 0);
  const shopPaid = (o.payments || []).filter((p) => p.receivedBy === 'shop').reduce((s, p) => s + p.amount, 0);
  const got = (o.payments || []).filter((p) => p.receivedBy === 'courier' && p.courierId === o.courierId).reduce((s, p) => s + p.amount, 0);
  const itemsDue = Math.max(0, (o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o)) - fee);
  const clientPays = closed ? got : got + Math.max(0, remaining(o));
  const feeFromClient = Math.max(0, fee - Math.max(0, shopPaid - itemsDue));
  const feeKept = Math.min(clientPays, feeFromClient);
  const toCollect = clientPays - feeKept;
  const feeOwed = fee - feeKept;
  return { clientPays, toCollect, fee, feeKept, feeOwed, net: toCollect - feeOwed, closed };
}
/** Commande revenue du livreur (retour confirmé) mais pas encore réglée avec lui. */
export const needsSettlement = (o: Order) => ['delivered', 'partial', 'refused'].includes(o.status) && !!o.courierId && !!o.dispatchedAt && !o.courierSettledAt && !isPickupZone(o.zoneId) && !isWalkIn(o);
export const totalQty = (o: Order) => sellingLines(o).reduce((s, l) => s + l.qty, 0);

/** Prix de gros : automatique à partir du seuil (3 pièces), ou forcé par le vendeur. */
export function useWholesale(o: Pick<Order, 'lines' | 'wholesale'>, minQty: number) {
  if (o.wholesale === 'yes') return true;
  if (o.wholesale === 'no') return false;
  return o.lines.filter((l) => !l.isChoice).reduce((s, l) => s + l.qty, 0) >= minQty;
}
export function linePrice(variantId: string, wholesale: boolean) {
  const v = get<Variant>('variants', variantId);
  const p = v && get<Product>('products', v.productId);
  const retail = v?.priceRetail ?? p?.priceRetail ?? 0;
  const gros = v?.priceWholesale ?? p?.priceWholesale;
  return wholesale && gros ? gros : retail;
}
/** Prix de chaque ligne : détail par défaut, gros si la ligne est cochée « Prix de gros » (article par article). */
export function repriceLines(lines: OrderLine[], _legacy?: boolean) {
  return lines.map((l) => (l.priceManual ? l : { ...l, unitPrice: linePrice(l.variantId, !!l.wholesale) }));
}
/** Prix des lignes + différences « prix du lot » et « prix par quantité ». */
export function priceOrder(lines: OrderLine[]) { const ls = repriceLines(lines); return { lines: ls, adjusts: computeAdjusts(ls) }; }
/** Lignes du même lot sont retirées ensemble. */
export const removeLine = (lines: OrderLine[], l: OrderLine) => lines.filter((x) => (l.lotKey ? x.lotKey !== l.lotKey : x.id !== l.id));
/** Anciennes lignes (prix de gros décidé pour toute la commande) : on retrouve si chaque ligne était au prix de gros. */
export function withLineWholesale(lines: OrderLine[]) {
  return lines.map((l) => (l.wholesale !== undefined ? l : { ...l, wholesale: l.unitPrice !== linePrice(l.variantId, false) && l.unitPrice === linePrice(l.variantId, true) }));
}
/** Remise saisie en Ar ou en % du montant des articles → montant en Ar (arrondi). */
export function discountAr(value: string | number | undefined, unit: 'ar' | 'pct', base: number) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  return unit === 'pct' ? Math.round((base * Math.min(100, n)) / 100) : Math.round(n);
}
/** Quantités demandées au-delà du stock disponible (stock − pièces promises aux autres commandes). */
export function stockShortages(lines: Pick<OrderLine, 'variantId' | 'qty'>[], excludeOrderId?: string) {
  const reserved = reservedIndex(excludeOrderId);
  const want = new Map<string, number>();
  for (const l of lines) if (l.variantId) want.set(l.variantId, (want.get(l.variantId) ?? 0) + (l.qty || 0));
  return [...want.entries()].map(([variantId, qty]) => ({ variantId, qty, available: Math.max(0, availableOf(variantId, reserved)) })).filter((x) => x.qty > x.available);
}

// ---------- Réservations : pièces promises à des commandes pas encore parties ----------
export function reservedIndex(excludeOrderId?: string) {
  const m = new Map<string, number>();
  for (const o of all<Order>('orders')) {
    if (o.id === excludeOrderId || !['new', 'confirmed', 'ready'].includes(o.status)) continue;
    for (const l of o.lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.qty);
  }
  return m;
}
export function availableOf(variantId: string, reserved: Map<string, number>) {
  return stockOf(variantId) - (reserved.get(variantId) ?? 0);
}

// ---------- Actions ----------
async function setStatus(o: Order, status: OrderStatus, extra: Partial<Order> = {}) {
  await save('orders', { id: o.id, status, statusDates: { ...(o.statusDates || {}), [status]: bizNow() }, ...extra });
  await audit(status === 'cancelled' ? 'Commande annulée' : 'Commande', `${o.number} : ${ORDER_STATUS[status].label}${status === 'cancelled' && extra.notes ? ` — ${String(extra.notes).split('\n').pop()}` : ''}`, 'orders', o.id);
}
export const confirmOrder = (o: Order) => setStatus(o, 'confirmed');
export const markReady = (o: Order) => setStatus(o, 'ready');
export const backToPrepare = (o: Order) => setStatus(o, 'confirmed');

/** Remise au livreur : les articles (y compris les choix) quittent la boutique. */
export async function dispatchOrder(o: Order, courierId: string) {
  assertOpenNow('Remise au livreur');
  const at = bizNow();
  await addMoves(o.lines.map((l) => ({ variantId: l.variantId, qty: -l.qty, type: 'dispatch' as const, refType: 'order', refId: o.id, reason: `${o.number}${l.isChoice ? ' (choix)' : ''}`, at })));
  await setStatus(o, 'out', { courierId, dispatchedAt: at });
}

/** Retour du livreur : ce qui est gardé, rendu, l'argent encaissé. */
export async function recordReturn(o: Order, r: { kept: Record<string, number>; feeCharged: number; collected: { amount: number; method: PayMethod; ref?: string }[]; note?: string }) {
  assertOpenNow('Retour du livreur');
  const at = bizNow();
  const lines = o.lines.map((l) => {
    const kept = Math.max(0, Math.min(l.qty, r.kept[l.id] ?? 0));
    return { ...l, qtyKept: kept, qtyReturned: l.qty - kept };
  });
  await addMoves(lines.filter((l) => l.qtyReturned > 0).map((l) => ({
    variantId: l.variantId, qty: l.qtyReturned!, type: 'delivery_return' as const, refType: 'order', refId: o.id,
    reason: `${o.number} — ${l.isChoice ? 'choix non retenu' : 'refusé par le client'}`, at,
  })));
  const u = currentUser();
  const pays: Payment[] = r.collected.filter((c) => c.amount).map((c) => ({ id: newId(), at, amount: c.amount, method: c.method, ref: c.ref, receivedBy: 'courier', courierId: o.courierId, userName: u?.fullName }));
  const keptAny = lines.some((l) => (l.qtyKept ?? 0) > 0);
  const allKept = lines.filter((l) => !l.isChoice).every((l) => (l.qtyKept ?? 0) >= l.qty);
  const status: OrderStatus = !keptAny && !(o.kind === 'exchange' && !o.lines.length) ? 'refused' : allKept ? 'delivered' : 'partial';
  if (o.kind === 'exchange' && o.returnLines?.length && status !== 'refused') {
    await addMoves(o.returnLines.map((rl) => ({ variantId: rl.variantId, qty: rl.qty, type: 'exchange_in' as const, refType: 'order', refId: o.id, reason: `${o.number} — article repris (échange)`, at })));
  }
  await setStatus(o, status, { lines, feeCharged: r.feeCharged, payments: [...(o.payments || []), ...pays], returnedAt: at, notes: r.note ? [o.notes, `Retour : ${r.note}`].filter(Boolean).join('\n') : o.notes });
}

/** Échange traité directement en boutique (sans livraison). */
export async function completeAtShop(o: Order, pay?: { amount: number; method: PayMethod; ref?: string }) {
  assertOpenNow('Échange en boutique');
  const at = bizNow();
  await addMoves([
    ...o.lines.map((l) => ({ variantId: l.variantId, qty: -l.qty, type: 'dispatch' as const, refType: 'order', refId: o.id, reason: `${o.number} — remis en boutique`, at })),
    ...(o.returnLines || []).map((rl) => ({ variantId: rl.variantId, qty: rl.qty, type: 'exchange_in' as const, refType: 'order', refId: o.id, reason: `${o.number} — article repris (échange)`, at })),
  ]);
  const u = currentUser();
  const pays = pay?.amount ? [{ id: newId(), at, amount: pay.amount, method: pay.method, ref: pay.ref, receivedBy: 'shop' as const, userName: u?.fullName }] : [];
  await setStatus(o, 'delivered', { lines: o.lines.map((l) => ({ ...l, qtyKept: l.qty, qtyReturned: 0 })), feeCharged: 0, deliveryFee: 0, payments: [...(o.payments || []), ...pays], returnedAt: at, dispatchedAt: at });
}

/** Retrait en boutique : le client repart avec ses articles et paie sur place. */
export async function handOverAtShop(o: Order, pay?: { amount: number; method: PayMethod; ref?: string }) {
  assertOpenNow('Retrait en boutique');
  if (o.status === 'out') throw new Error('Le colis est chez le livreur : enregistrez d’abord son retour (« Le client vient chercher en boutique »).');
  const at = bizNow();
  // Une commande prévue en livraison devient une vente sur place : plus de livreur ni de frais de livraison.
  if (!isPickupZone(o.zoneId) || o.deliveryFee || o.courierId) {
    o = { ...o, zoneId: 'zone-retrait', deliveryFee: 0, courierId: undefined };
    await save('orders', { id: o.id, zoneId: 'zone-retrait', deliveryFee: 0, courierId: null as unknown as undefined, pickedUp: true, events: [...(o.events || []), { at, text: 'Livraison annulée : le client récupère en boutique (vente sur place)', user: currentUser()?.fullName }] });
  }
  await addMoves(o.lines.filter((l) => !l.isChoice).map((l) => ({ variantId: l.variantId, qty: -l.qty, type: 'dispatch' as const, refType: 'order', refId: o.id, reason: `${o.number} — retiré en boutique`, at })));
  const u = currentUser();
  const pays = pay?.amount ? [{ id: newId(), at, amount: pay.amount, method: pay.method, ref: pay.ref, receivedBy: 'shop' as const, userName: u?.fullName }] : [];
  if (o.kind === 'exchange' && o.returnLines?.length) {
    await addMoves(o.returnLines.map((rl) => ({ variantId: rl.variantId, qty: rl.qty, type: 'exchange_in' as const, refType: 'order', refId: o.id, reason: `${o.number} — article repris (échange)`, at })));
  }
  await setStatus(o, 'delivered', { lines: o.lines.map((l) => ({ ...l, qtyKept: l.isChoice ? 0 : l.qty, qtyReturned: 0 })), feeCharged: 0, payments: [...(o.payments || []), ...pays], returnedAt: at, dispatchedAt: at });
}

/**
 * Colis déjà parti avec le livreur, mais le client vient finalement le chercher en boutique : la livraison est
 * annulée (pas de frais pour le client, pas de dédommagement pour le livreur). Les articles reviennent en boutique,
 * réservés pour le client ; la commande attend le client et deviendra une vente sur place quand il paiera.
 */
export async function cancelDeliveryToShop(o: Order) {
  assertOpenNow('Retour du livreur');
  if (o.status !== 'out') throw new Error('La commande n’est pas en livraison.');
  const at = bizNow();
  await addMoves(o.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, type: 'delivery_return' as const, refType: 'order', refId: o.id, reason: `${o.number} — livraison annulée, retrait en boutique`, at })));
  const courier = get<Courier>('couriers', o.courierId || '')?.name;
  await save('orders', {
    id: o.id, status: 'ready', zoneId: 'zone-retrait', deliveryFee: 0, feeCharged: 0, courierId: null as unknown as undefined, dispatchedAt: null as unknown as undefined, pickedUp: true,
    statusDates: { ...(o.statusDates || {}), ready: at },
    events: [...(o.events || []), { at, text: `Livraison annulée${courier ? ` (rapportée par ${courier})` : ''} : le client vient chercher en boutique`, user: currentUser()?.fullName }],
  });
  await audit('Commande', `${o.number} : livraison annulée, retrait en boutique`, 'orders', o.id);
}

// ---------- Livraison reportée (« à reporter ») ----------
/** Nombre maximum de reports : au-delà, la commande est annulée. */
export const MAX_REPORTS = 3;
export const reportCount = (o: Pick<Order, 'reports'>) => (o.reports || []).length;
export const canPostpone = (o: Order) => !isWalkIn(o) && ['new', 'confirmed', 'ready', 'out'].includes(o.status);
/**
 * Le client demande de reporter la livraison (il n'est pas là, pas d'argent, autre jour…). Si le colis est chez le
 * livreur, il revient en boutique (stock remis, réservé pour le client) ; la commande repasse « en attente de livraison »
 * avec la nouvelle date. Au 3e report atteint, un nouveau report n'est plus possible : il faut annuler.
 */
export async function postponeOrder(o: Order, d: { to?: string; reason?: string }) {
  if (!canPostpone(o)) throw new Error('Cette commande ne peut plus être reportée.');
  if (reportCount(o) >= MAX_REPORTS) throw new Error(`Déjà reportée ${MAX_REPORTS} fois : la commande doit être annulée.`);
  const at = bizNow();
  const u = currentUser();
  const courier = get<Courier>('couriers', o.courierId || '')?.name;
  if (o.status === 'out') {
    assertOpenNow('Retour du livreur');
    await addMoves(o.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, type: 'delivery_return' as const, refType: 'order', refId: o.id, reason: `${o.number} — livraison reportée, colis revenu en boutique`, at })));
  }
  const n = reportCount(o) + 1;
  const toTxt = d.to ? ` au ${new Date(`${d.to}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })}` : '';
  await save('orders', {
    id: o.id, status: o.status === 'out' ? 'ready' : o.status, wantedDate: d.to || o.wantedDate,
    ...(o.status === 'out' ? { courierId: null as unknown as undefined, dispatchedAt: null as unknown as undefined, statusDates: { ...(o.statusDates || {}), ready: at } } : {}),
    reports: [...(o.reports || []), { at, to: d.to, reason: d.reason, user: u?.fullName, courierId: o.courierId }],
    events: [...(o.events || []), { at, text: `Livraison reportée${toTxt} (${n}/${MAX_REPORTS})${d.reason ? ` — ${d.reason}` : ''}${o.status === 'out' ? ` : colis rapporté${courier ? ` par ${courier}` : ''}, articles revenus en boutique` : ''}`, user: u?.fullName }],
  });
  await audit('Commande reportée', `${o.number} : report ${n}/${MAX_REPORTS}${toTxt}${d.reason ? ` — ${d.reason}` : ''}`, 'orders', o.id, 'medium');
}
/** Après 3 reports, le client n'a toujours pas pris sa commande : annulation (stock remis exactement). */
export async function cancelAfterReports(o: Order, reason = '') {
  await cancelOrder(o, `Reportée ${reportCount(o)} fois, le client n’a pas pris la commande${reason ? ` (${reason})` : ''}`);
}

/** Vente sur place (comptoir) : enregistrée et terminée immédiatement. */
export async function createWalkInSale(d: { lines: OrderLine[]; adjusts?: Adjust[]; discount: number; wholesale: Order['wholesale']; phone?: string; name?: string; notes?: string; payments: { amount: number; method: PayMethod; ref?: string }[]; outsideHours: boolean; cashGiven?: number; employee?: { id: string; name: string } }) {
  assertOpenNow('Vente');
  const at = bizNow();
  const u = currentUser();
  const pickup = all<Zone>('zones').find((z) => isPickupZone(z));
  const phone = d.phone ? normPhone(d.phone) : '';
  let customerId: string | undefined;
  if (phone.length >= 9) {
    const c = findCustomer(phone);
    if (c) customerId = c.id;
    else { const [nc] = await save('customers', { id: customerIdFor(phone), phone, name: d.name || undefined }); customerId = nc.id; }
  }
  const internal = !!d.employee;
  const number = nextNumber(internal ? 'VI' : 'V', 'orders');
  const [o] = await save('orders', {
    number, kind: 'order', channel: 'shop', customerId, phone, name: d.name || undefined, zoneId: pickup?.id, deliveryFee: 0, feeCharged: 0,
    wholesale: d.wholesale, lines: d.lines.map((l) => ({ ...l, qtyKept: l.qty, qtyReturned: 0 })), adjusts: d.adjusts?.length ? d.adjusts : undefined, discount: d.discount, notes: d.notes,
    payments: d.payments.filter((p) => p.amount).map((p) => ({ id: newId(), at, amount: p.amount, method: p.method, ref: p.ref, receivedBy: 'shop' as const, userName: u?.fullName })),
    status: 'delivered', statusDates: { delivered: at }, dispatchedAt: at, returnedAt: at, outsideHours: d.outsideHours, cashGiven: d.cashGiven || undefined, createdBy: u?.id, createdByName: u?.fullName,
    ...(internal ? { internal: true, employeeId: d.employee!.id, employeeName: d.employee!.name, wholesale: 'no' as const } : {}),
  });
  await addMoves(d.lines.map((l) => ({ variantId: l.variantId, qty: -l.qty, type: 'sale' as const, refType: 'order', refId: o.id, reason: `${number} — ${internal ? `vente interne (${d.employee!.name})` : 'vente sur place'}`, at })));
  await audit(internal ? 'Vente interne' : 'Vente sur place', `${number} — ${d.lines.reduce((s, l) => s + l.qty, 0)} article(s)${internal ? ` — employé : ${d.employee!.name}` : ''}`, 'orders', o.id);
  // Contrôle : grosse remise ou prix baissé à la main → action importante, à vérifier par le gérant.
  if (!internal) {
    const items = d.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    if (d.discount > 0 && d.discount >= items * 0.2) await audit('Remise importante', `${number} : remise ${d.discount.toLocaleString('fr-FR')} Ar sur ${items.toLocaleString('fr-FR')} Ar (${Math.round((d.discount / Math.max(1, items)) * 100)} %)`, 'orders', o.id, 'high');
    const lowered = d.lines.filter((l) => l.priceManual && l.unitPrice < linePrice(l.variantId, !!l.wholesale));
    if (lowered.length) await audit('Prix baissé à la vente', `${number} : ${lowered.map((l) => `${get<Variant>('variants', l.variantId)?.sku ?? '?'} ${l.unitPrice.toLocaleString('fr-FR')} Ar au lieu de ${linePrice(l.variantId, !!l.wholesale).toLocaleString('fr-FR')} Ar`).join(' ; ')}`, 'orders', o.id, 'high');
  }
  return o as Order;
}

/** Changer de livreur (avant le versement) : la commande, ses frais et l'argent encaissé passent au nouveau livreur. */
export function canReassign(o: Order) {
  return !!o.courierId && !o.courierSettledAt && !['cancelled'].includes(o.status) && !isPickupZone(o.zoneId);
}
export async function reassignCourier(o: Order, newCourierId: string, reason?: string) {
  if (!canReassign(o)) throw new Error('Le versement de ce livreur est déjà validé : la commande ne peut plus changer de livreur.');
  if (newCourierId === o.courierId) return;
  const from = get<Courier>('couriers', o.courierId || '')?.name || '?';
  const to = get<Courier>('couriers', newCourierId)?.name || '?';
  const u = currentUser();
  const payments = (o.payments || []).map((p) => (p.receivedBy === 'courier' && p.courierId === o.courierId ? { ...p, courierId: newCourierId } : p));
  const text = `Livreur changé : ${from} → ${to}${reason ? ` (${reason})` : ''}`;
  await save('orders', { id: o.id, courierId: newCourierId, payments, events: [...(o.events || []), { at: bizNow(), text, user: u?.fullName }] });
  await audit('Changement de livreur', `${o.number} : ${from} → ${to}${reason ? ` — ${reason}` : ''}`, 'orders', o.id);
}

export async function cancelOrder(o: Order, reason: string) {
  // Stock remis exactement : on annule le solde de tous les mouvements déjà faits pour cette commande
  // (sortie au livreur, retours partiels, retrait en boutique…), pas seulement le cas « en livraison ».
  const net = new Map<string, number>();
  for (const m of all<StockMove>('stockMoves')) if (m.refType === 'order' && m.refId === o.id) net.set(m.variantId, (net.get(m.variantId) ?? 0) + m.qty);
  const back = [...net.entries()].filter(([, q]) => q);
  if (back.length) await addMoves(back.map(([variantId, q]) => ({ variantId, qty: -q, type: (o.status === 'out' ? 'delivery_return' : 'return') as StockMove['type'], refType: 'order', refId: o.id, reason: `${o.number} annulée — retour en boutique`, at: bizNow() })));
  await setStatus(o, 'cancelled', { notes: [o.notes, `Annulée : ${reason}`].filter(Boolean).join('\n') });
}

/** Correction d'un paiement (erreur de saisie) par l'admin : tout est gardé dans l'historique. */
export async function editPayment(o: Order, paymentId: string, amount: number, method: PayMethod, reason?: string) {
  const u = currentUser();
  const at = new Date().toISOString(); // heure réelle de la correction
  const old = (o.payments || []).find((p) => p.id === paymentId);
  if (!old) return;
  const payments = o.payments.map((p) => (p.id === paymentId ? { ...p, amount, method, edits: [...(p.edits || []), { at, user: u?.fullName, fromAmount: p.amount, toAmount: amount, fromMethod: p.method, toMethod: method, reason }] } : p));
  const text = `Paiement corrigé : ${old.amount.toLocaleString('fr-FR')} Ar (${PAY_METHODS[old.method]}) → ${amount.toLocaleString('fr-FR')} Ar (${PAY_METHODS[method]})${reason ? ` — ${reason}` : ''}`;
  await save('orders', { id: o.id, payments, events: [...(o.events || []), { at, text, user: u?.fullName }] });
  await audit('Paiement corrigé', `${o.number} : ${text}`, 'orders', o.id);
}

export async function addPayment(o: Order, p: Omit<Payment, 'id' | 'at' | 'userName'>) {
  const pay: Payment = { ...p, id: newId(), at: bizNow(), userName: currentUser()?.fullName };
  await save('orders', { id: o.id, payments: [...(o.payments || []), pay] });
  await audit('Paiement client', `${o.number} : ${pay.amount} Ar (${PAY_METHODS[pay.method]}, ${pay.receivedBy === 'shop' ? 'boutique' : 'livreur'})`, 'orders', o.id);
}

// ---------- Comptes des livreurs ----------
/**
 * Ce que le livreur doit à la boutique = argent encaissé auprès des clients − frais de livraison qu'il a gagnés.
 * (Positif : il doit rendre de l'argent. Négatif : la boutique lui doit ses frais, ex. frais payés par MVola à la boutique.)
 * Les règlements (remises d'argent) arriveront avec la trésorerie (étape 6).
 */
export function courierAccount(courierId: string, from?: string, to?: string) {
  const inRange = (iso?: string) => !!iso && (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
  let collected = 0, fees = 0, deliveries = 0, out = 0, outValue = 0;
  const orders = all<Order>('orders').filter((o) => o.courierId === courierId);
  for (const o of orders) {
    if (o.status === 'out') { out++; outValue += remaining(o); }
    for (const p of o.payments || []) if (p.receivedBy === 'courier' && p.courierId === courierId && inRange(p.at)) collected += p.amount;
    if (['delivered', 'partial', 'refused'].includes(o.status) && inRange(o.returnedAt)) {
      fees += o.feeCharged ?? 0;
      if (o.status !== 'refused') deliveries++;
    }
  }
  return { collected, fees, due: collected - fees, deliveries, out, outValue };
}


// ---------- Recherche partout ----------
/** Tout le texte d'une commande : numéro, client, téléphone, Facebook, lieu, zone, livreur, articles, montants, observations. */
export function orderText(o: Order) {
  const parts: (string | number | undefined)[] = [o.number, o.name, o.facebook, o.phone, fmtPhone(o.phone), o.place, o.notes, ORDER_STATUS[o.status]?.label,
    get<Zone>('zones', o.zoneId || '')?.name, get<Courier>('couriers', o.courierId || '')?.name, orderTotal(o), o.createdByName];
  for (const l of o.lines) { const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId); parts.push(p?.code, p?.name, v ? variantLabel(v) : undefined, v?.sku, l.lotProductId ? get<Product>('products', l.lotProductId)?.name : undefined); }
  return parts.filter((x) => x !== undefined && x !== '').join(' ');
}
/** Tout le texte d'une fiche client. */
export const customerText = (c: Customer) => [c.name, c.facebook, c.phone, c.phone && fmtPhone(c.phone), c.phone2, c.place, get<Zone>('zones', c.zoneId || '')?.name, c.notes].filter(Boolean).join(' ');
/** Fiche client retrouvée par téléphone, sinon par nom Facebook (même orthographe, sans accents ni majuscules). */
export function findCustomerBy(phone?: string, facebook?: string) {
  const byPhone = phone ? findCustomer(phone) : undefined;
  if (byPhone) return byPhone;
  const f = (facebook || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!f) return undefined;
  return all<Customer>('customers').find((c) => (c.facebook || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === f);
}
