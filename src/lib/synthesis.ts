// Tableau de synthèse d'une journée (comme le cahier Excel des ventes) :
// montant « sans retour » (ce qui est parti ce jour-là) et « avec retour » (corrigé par les retours constatés
// au versement des livreurs, même les jours suivants), par livreur et par catégorie (page).
import { adjustKept } from './lots';
import { all, get } from './db';
import type { Category, Product, Variant } from './catalog';
import { courierSplit, exchangeBalance, isPickupZone, isWalkIn, orderTotal, remaining, type Courier, type Order } from './orders';
import { dayOf } from './money';

/** fees = feesCash + feesMvola : frais gardés par le livreur sur ce que le client lui a payé (espèces) et frais payés à la
 *  boutique (MVola…), que l'entreprise doit lui payer. */
export interface SynthCourier { id: string; name: string; count: number; fees: number; feesCash: number; feesMvola: number; feesFund: number; returns: number; pending: number; sans: number; avec: number }
export interface SynthCategory { id: string; name: string; sellers: string[]; sans: number; avec: number }
export interface Synthesis {
  date: string;
  walk: { count: number; sans: number; avec: number };
  internal: { count: number; amount: number };
  deliv: { count: number; sans: number; avec: number; pending: number; returns: number };
  pickup: { count: number; sans: number; avec: number };
  total: { sans: number; avec: number; diff: number };
  couriers: SynthCourier[];
  categories: SynthCategory[];
  fees: number;
  feesCash: number; feesMvola: number;
  /** Frais des livreurs « frais pour la caisse » (ex. Toky) : vont dans leur caisse frais, pas au livreur. Ils sont aussi
   *  comptés dans feesCash / feesMvola (comme pour les autres livreurs), mais pas dans fees. */
  feesFund: number;
  corrected: boolean;       // des retours ont été constatés après ce jour
  lastUpdate?: string;      // dernière mise à jour par un retour
}

/** Catégorie « page » : la catégorie principale de l'article (la plus haute). */
function rootCategory(variantId: string): { id: string; name: string } {
  const v = get<Variant>('variants', variantId);
  const p = v && get<Product>('products', v.productId);
  let c = p?.categoryId ? get<Category>('categories', p.categoryId) : undefined;
  while (c?.parentId) { const up = get<Category>('categories', c.parentId); if (!up) break; c = up; }
  return c ? { id: c.id, name: c.name } : { id: '', name: 'Sans catégorie' };
}

const CLOSED = ['delivered', 'partial', 'refused'];

/** Frais d'un livreur « frais pour la caisse » (ex. Toky) répartis comme pour les autres livreurs : payés en espèces au
 *  livreur, ou déjà payés à la boutique (MVola / Orange Money). Même règle que courierSplit (articles d'abord, puis frais). */
function fundSplit(o: Order, charged: number) {
  if (!charged) return { cash: 0, mvola: 0 };
  const shopPaid = (o.payments || []).filter((p) => p.receivedBy === 'shop').reduce((t, p) => t + p.amount, 0);
  const got = (o.payments || []).filter((p) => p.receivedBy === 'courier' && p.courierId === o.courierId).reduce((t, p) => t + p.amount, 0);
  const itemsDue = Math.max(0, (o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o)) - charged);
  const clientPays = CLOSED.includes(o.status) ? got : got + Math.max(0, remaining(o));
  const cash = Math.min(clientPays, Math.max(0, charged - Math.max(0, shopPaid - itemsDue)));
  return { cash, mvola: charged - cash };
}

/** Valeurs d'une commande, ligne par ligne (remise répartie), sans retour et avec retour. */
function orderLines(o: Order) {
  const closed = CLOSED.includes(o.status) || isWalkIn(o);
  const adj = o.adjusts || [];
  // Prix du lot / par quantité : rattaché à un article du lot (pour la page).
  const sansLines = [...o.lines.filter((l) => !l.isChoice).map((l) => ({ variantId: l.variantId, value: l.qty * l.unitPrice })),
    ...adj.map((a) => ({ variantId: a.refVariantId || '', value: a.qty * a.unit }))];
  const avecLines = o.status === 'cancelled' ? [] : closed
    ? [...o.lines.map((l) => ({ variantId: l.variantId, value: (l.qtyKept ?? (l.isChoice ? 0 : l.qty)) * l.unitPrice })),
      ...adj.map((a) => ({ variantId: a.refVariantId || '', value: adjustKept(a, o.lines, adj) * a.unit }))]
    : sansLines;
  const spread = (lines: { variantId: string; value: number }[]) => {
    const t = lines.reduce((s, l) => s + l.value, 0);
    const disc = Math.min(o.discount || 0, t);
    return lines.map((l) => ({ ...l, value: l.value - (t ? (disc * l.value) / t : 0) }));
  };
  return { sans: spread(sansLines), avec: spread(avecLines), pending: !closed && o.status !== 'cancelled' };
}

export function daySynthesis(date: string): Synthesis {
  const s: Synthesis = {
    date, walk: { count: 0, sans: 0, avec: 0 }, internal: { count: 0, amount: 0 }, deliv: { count: 0, sans: 0, avec: 0, pending: 0, returns: 0 }, pickup: { count: 0, sans: 0, avec: 0 },
    total: { sans: 0, avec: 0, diff: 0 }, couriers: [], categories: [], fees: 0, feesCash: 0, feesMvola: 0, feesFund: 0, corrected: false,
  };
  const couriers = new Map<string, SynthCourier>();
  const cats = new Map<string, SynthCategory & { sellerSet: Set<string> }>();
  const cat = (variantId: string) => {
    const c = rootCategory(variantId);
    if (!cats.has(c.id)) cats.set(c.id, { id: c.id, name: c.name, sellers: [], sellerSet: new Set(), sans: 0, avec: 0 });
    return cats.get(c.id)!;
  };
  for (const o of all<Order>('orders')) {
    const walk = isWalkIn(o);
    const day = walk ? dayOf(o.createdAt) : o.dispatchedAt ? dayOf(o.dispatchedAt) : '';
    if (day !== date) continue;
    if (walk && o.status === 'cancelled') continue;
    const x = orderLines(o);
    const sans = x.sans.reduce((t, l) => t + l.value, 0);
    const avec = x.avec.reduce((t, l) => t + l.value, 0);
    for (const l of x.sans) { const c = cat(l.variantId); c.sans += l.value; if (o.createdByName) c.sellerSet.add(o.createdByName); }
    for (const l of x.avec) cat(l.variantId).avec += l.value;
    const hadReturn = o.status === 'cancelled' || o.status === 'refused' || o.lines.some((l) => !l.isChoice && (l.qtyReturned ?? 0) > 0);
    const back = o.status === 'cancelled' ? o.statusDates?.cancelled : o.returnedAt;
    if (back && dayOf(back) > date && avec !== sans) { s.corrected = true; if (!s.lastUpdate || back > s.lastUpdate) s.lastUpdate = back; }
    if (walk) { s.walk.count++; s.walk.sans += sans; s.walk.avec += avec; if (o.internal) { s.internal.count++; s.internal.amount += avec; } continue; }
    if (isPickupZone(o.zoneId)) { s.pickup.count++; s.pickup.sans += sans; s.pickup.avec += avec; continue; }
    s.deliv.count++; s.deliv.sans += sans; s.deliv.avec += avec;
    if (x.pending) s.deliv.pending++;
    if (hadReturn) s.deliv.returns++;
    const id = o.courierId || '';
    if (!couriers.has(id)) couriers.set(id, { id, name: get<Courier>('couriers', id)?.name ?? 'Sans livreur', count: 0, fees: 0, feesCash: 0, feesMvola: 0, feesFund: 0, returns: 0, pending: 0, sans: 0, avec: 0 });
    const c = couriers.get(id)!;
    const sp = o.status === 'cancelled' ? null : courierSplit(o);
    const feeFund = sp ? sp.shopFee : 0, fs = sp ? fundSplit(o, feeFund) : { cash: 0, mvola: 0 };
    const fee = sp ? sp.fee : 0, feeCash = (sp ? sp.feeKept : 0) + fs.cash, feeMvola = (sp ? sp.feeOwed : 0) + fs.mvola;
    c.count++; c.fees += fee; c.feesCash += feeCash; c.feesMvola += feeMvola; c.feesFund += feeFund; c.sans += sans; c.avec += avec;
    if (x.pending) c.pending++;
    if (hadReturn) c.returns++;
    s.fees += fee; s.feesCash += feeCash; s.feesMvola += feeMvola; s.feesFund += feeFund;
  }
  s.total.sans = s.walk.sans + s.deliv.sans + s.pickup.sans;
  s.total.avec = s.walk.avec + s.deliv.avec + s.pickup.avec;
  s.total.diff = s.total.sans - s.total.avec;
  s.couriers = [...couriers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  s.categories = [...cats.values()].map(({ sellerSet, ...c }) => ({ ...c, sellers: [...sellerSet] })).sort((a, b) => b.sans - a.sans);
  return s;
}
