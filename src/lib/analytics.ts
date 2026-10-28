// Analyses : un « journal des ventes » ligne par ligne (même règle que les récapitulatifs), et les agrégats
// pour le tableau de bord et les rapports (période, heure, jour, mois, article, client, vendeur, livreur…).
import { all, get } from './db';
import { productPage } from './scope';
import { stockOf, variantCost, incomingOf, type Category, type Product, type Purchase, type Variant } from './catalog';
import { isPickupZone, isWalkIn, sellingLines, type Courier, type Order } from './orders';
import { dayOf, type CashMove, type FinanceCategory } from './money';
import { purchaseTotalAr, purchasePaid, purchaseTotal } from './purchases';
import { adjustKept, type Adjust } from './lots';

export interface SaleLine {
  at: string; day: string; hour: number;
  kind: 'sale' | 'return';
  order: Order;
  channel: 'shop' | 'online';
  variantId: string; productId: string; categoryId?: string;
  itemProductId?: string; // article réellement sorti du stock (productId = le lot quand il est vendu en lot)
  qty: number;      // négatif pour un retour
  amount: number;   // chiffre d'affaires (négatif pour un retour), remise répartie
  cost: number;     // coût des articles (négatif pour un retour)
  userName?: string; courierId?: string; zoneId?: string; customerId?: string;
}

const costOf = (variantId: string) => { const v = get<Variant>('variants', variantId); return v ? variantCost(v) : 0; };

/** Toutes les lignes de vente et de retour, dans l'ordre chronologique. */
export function salesLedger(from?: string, to?: string): SaleLine[] {
  const inR = (iso?: string) => { if (!iso) return false; const d = dayOf(iso); return (!from || d >= from) && (!to || d <= to); };
  const out: SaleLine[] = [];
  type Over = { productId: string; categoryId?: string } | undefined;
  const push = (o: Order, at: string, kind: SaleLine['kind'], variantId: string, qty: number, amount: number, over?: Over) => {
    if (!qty && !amount) return;
    const v = variantId ? get<Variant>('variants', variantId) : undefined;
    const p = v && get<Product>('products', v.productId);
    const d = new Date(at);
    out.push({
      at, day: dayOf(at), hour: d.getHours(), kind, order: o, channel: isWalkIn(o) || o.pickedUp ? 'shop' : 'online', variantId, productId: over?.productId ?? v?.productId ?? '', categoryId: over ? over.categoryId : p?.categoryId,
      itemProductId: v?.productId, qty, amount, cost: qty * costOf(variantId), userName: o.createdByName, courierId: isPickupZone(o.zoneId) ? undefined : o.courierId, zoneId: o.zoneId, customerId: o.customerId,
    });
  };
  /** Un article vendu dans un lot complet compte pour le lot (meilleures ventes, CA par page). */
  const lotOver = (o: Order, l: { lotKey?: string; lotProductId?: string }): Over => {
    if (!l.lotKey || !l.lotProductId) return undefined;
    const a = (o.adjusts || []).find((x) => x.lotKey === l.lotKey);
    if (a && adjustKept(a, o.lines, o.adjusts || []) === 0) return undefined;
    return { productId: l.lotProductId, categoryId: get<Product>('products', l.lotProductId)?.categoryId };
  };
  const adjOver = (a: Adjust): Over => ({ productId: a.productId, categoryId: get<Product>('products', a.productId)?.categoryId });
  type Row = { variantId: string; qty: number; value: number; over?: Over };
  /** Remise répartie au prorata des montants. */
  const withDiscount = (lines: Row[], discount: number) => {
    const total = lines.reduce((t, l) => t + l.value, 0);
    return lines.map((l) => ({ ...l, value: l.value - (total ? (discount * l.value) / total : 0) }));
  };
  for (const o of all<Order>('orders')) {
    const adj = o.adjusts || [];
    if (isWalkIn(o)) {
      if (o.status === 'cancelled' || !inR(o.createdAt)) continue;
      const rows: Row[] = [
        ...o.lines.map((l) => ({ variantId: l.variantId, qty: l.qtyKept ?? l.qty, value: (l.qtyKept ?? l.qty) * l.unitPrice, over: lotOver(o, l) })),
        ...adj.map((a) => ({ variantId: '', qty: 0, value: adjustKept(a, o.lines, adj) * a.unit, over: adjOver(a) })),
      ];
      for (const l of withDiscount(rows, o.discount || 0)) push(o, o.createdAt, 'sale', l.variantId, l.qty, l.value, l.over);
      continue;
    }
    if (!o.dispatchedAt) continue;
    const nonChoice = withDiscount([
      ...sellingLines(o).map((l) => ({ variantId: l.variantId, qty: l.qty, value: l.qty * l.unitPrice, over: lotOver(o, l) })),
      ...adj.map((a) => ({ variantId: '', qty: 0, value: a.qty * a.unit, over: adjOver(a) })),
    ], o.discount || 0);
    // Une livraison compte le jour du départ. Si elle est annulée ou si des articles reviennent (refus, retour partiel),
    // c'est déduit de ce même jour : la vente d'hier annulée ce matin diminue les ventes d'hier, pas celles d'aujourd'hui.
    if (o.status === 'cancelled') continue;
    const day = o.dispatchedAt;
    if (inR(day)) {
      for (const l of nonChoice) push(o, day, 'sale', l.variantId, l.qty, l.value, l.over);
      if (o.returnedAt) {
        for (const l of o.lines) {
          if (l.isChoice) { if (l.qtyKept) push(o, day, 'sale', l.variantId, l.qtyKept, l.qtyKept * l.unitPrice); }
          else if (l.qtyReturned) push(o, day, 'return', l.variantId, -l.qtyReturned, -l.qtyReturned * l.unitPrice, lotOver(o, l));
        }
        for (const a of adj) { const back = a.qty - adjustKept(a, o.lines, adj); if (back) push(o, day, 'return', '', 0, -back * a.unit, adjOver(a)); }
      }
    }
    // Échange : les articles rendus par le client (achetés un autre jour) comptent le jour de l'échange.
    if (o.returnedAt && inR(o.returnedAt)) for (const rl of o.returnLines || []) push(o, o.returnedAt, 'return', rl.variantId, -rl.qty, -rl.qty * rl.unitPrice);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export interface Kpis { revenue: number; sales: number; returns: number; cost: number; gross: number; margin: number; expenses: number; incomes: number; net: number; orders: number; shopOrders: number; onlineOrders: number; avgBasket: number; pieces: number; returnRate: number }
export function kpis(lines: SaleLine[], from?: string, to?: string): Kpis {
  const sales = lines.filter((l) => l.kind === 'sale').reduce((t, l) => t + l.amount, 0);
  const returns = -lines.filter((l) => l.kind === 'return').reduce((t, l) => t + l.amount, 0);
  const revenue = sales - returns;
  const cost = lines.reduce((t, l) => t + l.cost, 0);
  const saleOrders = new Set(lines.filter((l) => l.kind === 'sale').map((l) => l.order.id));
  const shopOrders = new Set(lines.filter((l) => l.kind === 'sale' && l.channel === 'shop').map((l) => l.order.id)).size;
  const { expenses, incomes } = moneyOut(from, to);
  const gross = revenue - cost;
  return {
    revenue, sales, returns, cost, gross, margin: revenue ? gross / revenue : 0, expenses, incomes, net: gross - expenses + incomes,
    orders: saleOrders.size, shopOrders, onlineOrders: saleOrders.size - shopOrders, avgBasket: saleOrders.size ? sales / saleOrders.size : 0,
    pieces: lines.reduce((t, l) => t + l.qty, 0), returnRate: sales ? returns / sales : 0,
  };
}

export function moneyOut(from?: string, to?: string) {
  let expenses = 0, incomes = 0;
  const byCat = new Map<string, number>();
  const cats = new Map(all<FinanceCategory>('financeCategories').map((c) => [c.id, c.name]));
  for (const m of all<CashMove>('cashMoves')) {
    const d = dayOf(m.at);
    if ((from && d < from) || (to && d > to)) continue;
    if (m.type === 'expense') { expenses -= m.amount; const n = (m.categoryId && cats.get(m.categoryId)) || 'Sans catégorie'; byCat.set(n, (byCat.get(n) ?? 0) - m.amount); }
    if (m.type === 'income') incomes += m.amount;
  }
  return { expenses, incomes, byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]) };
}

// ---------- Découpage dans le temps ----------
export type Bucket = 'hour' | 'day' | 'month';
const pad = (n: number) => String(n).padStart(2, '0');
export function bucketFor(from: string, to: string): Bucket {
  if (from === to) return 'hour';
  const days = (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 864e5;
  return days <= 62 ? 'day' : 'month';
}
export interface Point { key: string; label: string; long: string; revenue: number; gross: number; expenses: number; orders: number }
export function series(lines: SaleLine[], from: string, to: string, bucket: Bucket): Point[] {
  const keys: { key: string; label: string; long: string }[] = [];
  if (bucket === 'hour') for (let h = 6; h <= 21; h++) keys.push({ key: String(h), label: `${h}h`, long: `${h}h – ${h + 1}h` });
  else if (bucket === 'day') {
    for (let d = new Date(`${from}T12:00:00`); dayOf(d.toISOString()) <= to; d.setDate(d.getDate() + 1)) {
      const k = dayOf(d.toISOString());
      keys.push({ key: k, label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), long: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) });
    }
  } else {
    for (let d = new Date(`${from.slice(0, 7)}-01T12:00:00`); `${d.getFullYear()}-${pad(d.getMonth() + 1)}` <= to.slice(0, 7); d.setMonth(d.getMonth() + 1)) {
      keys.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleDateString('fr-FR', { month: 'short' }), long: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) });
    }
  }
  const keyOf = (iso: string, day: string, hour: number) => (bucket === 'hour' ? String(Math.min(21, Math.max(6, hour))) : bucket === 'day' ? day : day.slice(0, 7));
  const m = new Map(keys.map((k) => [k.key, { ...k, revenue: 0, gross: 0, expenses: 0, orders: 0, seen: new Set<string>() }]));
  for (const l of lines) {
    const p = m.get(keyOf(l.at, l.day, l.hour));
    if (!p) continue;
    p.revenue += l.amount; p.gross += l.amount - l.cost;
    if (l.kind === 'sale' && !p.seen.has(l.order.id)) { p.seen.add(l.order.id); p.orders++; }
  }
  for (const mv of all<CashMove>('cashMoves')) {
    if (mv.type !== 'expense') continue;
    const d = dayOf(mv.at);
    if (d < from || d > to) continue;
    const p = m.get(keyOf(mv.at, d, new Date(mv.at).getHours()));
    if (p) p.expenses -= mv.amount;
  }
  return [...m.values()].map(({ seen, ...p }) => p);
}

/** Période précédente de même durée (pour comparer). */
export function previousPeriod(from: string, to: string) {
  const f = new Date(`${from}T12:00:00`), t = new Date(`${to}T12:00:00`);
  const days = Math.round((t.getTime() - f.getTime()) / 864e5) + 1;
  const pf = new Date(f); pf.setDate(pf.getDate() - days);
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  return { from: dayOf(pf.toISOString()), to: dayOf(pt.toISOString()) };
}

// ---------- Regroupements ----------
export interface Group { key: string; label: string; sub?: string; qty: number; revenue: number; cost: number; gross: number; returnsQty: number; returns: number; orders: number }
export function groupBy(lines: SaleLine[], keyOf: (l: SaleLine) => string | undefined, labelOf: (k: string) => { label: string; sub?: string }): Group[] {
  const m = new Map<string, Group & { seen: Set<string> }>();
  for (const l of lines) {
    const k = keyOf(l) ?? '';
    if (!m.has(k)) m.set(k, { key: k, ...labelOf(k), qty: 0, revenue: 0, cost: 0, gross: 0, returnsQty: 0, returns: 0, orders: 0, seen: new Set() });
    const g = m.get(k)!;
    g.qty += l.qty; g.revenue += l.amount; g.cost += l.cost; g.gross += l.amount - l.cost;
    if (l.kind === 'return') { g.returnsQty -= l.qty; g.returns -= l.amount; }
    else if (!g.seen.has(l.order.id)) { g.seen.add(l.order.id); g.orders++; }
  }
  return [...m.values()].map(({ seen, ...g }) => g).sort((a, b) => b.revenue - a.revenue);
}
export const productLabel = (id: string) => { const p = get<Product>('products', id); return { label: p?.name ?? 'Article supprimé', sub: p?.code }; };
export const categoryLabel = (id: string) => ({ label: id ? get<Category>('categories', id)?.name ?? 'Catégorie supprimée' : 'Sans catégorie' });
export const courierLabel = (id: string) => ({ label: id ? get<Courier>('couriers', id)?.name ?? 'Livreur supprimé' : 'Vente sur place / retrait' });

// ---------- Stock ----------
export function stockValue() {
  let pieces = 0, value = 0, retail = 0, incoming = 0;
  for (const v of all<Variant>('variants')) {
    const q = stockOf(v.id);
    const p = get<Product>('products', v.productId);
    if (q > 0) { pieces += q; value += q * variantCost(v); retail += q * (v.priceRetail ?? p?.priceRetail ?? 0); }
    incoming += incomingOf(v.id);
  }
  return { pieces, value, retail, incoming };
}

/** Stock final par page (catégorie racine), pour l'accueil. `keep` : pages à montrer (vendeur limité à ses pages). */
export function stockByPage(keep: (pageId: string) => boolean = () => true) {
  const m = new Map<string, { pageId: string; label: string; pieces: number; value: number; retail: number; refs: number }>();
  for (const v of all<Variant>('variants')) {
    const q = stockOf(v.id);
    if (q <= 0) continue;
    const p = get<Product>('products', v.productId);
    const pageId = productPage(v.productId) || '';
    if (!keep(pageId)) continue;
    const g = m.get(pageId) ?? { pageId, label: pageId ? get<Category>('categories', pageId)?.name ?? '?' : 'Sans page', pieces: 0, value: 0, retail: 0, refs: 0 };
    g.pieces += q; g.value += q * variantCost(v); g.retail += q * (v.priceRetail ?? p?.priceRetail ?? 0); g.refs++;
    m.set(pageId, g);
  }
  return [...m.values()].sort((a, b) => b.pieces - a.pieces);
}

/** Articles en stock qui ne se sont pas vendus depuis N jours. */
export function dormant(days = 60) {
  const since = new Date(); since.setDate(since.getDate() - days);
  const sold = new Set(salesLedger(dayOf(since.toISOString())).filter((l) => l.kind === 'sale').map((l) => l.itemProductId ?? l.productId));
  return all<Product>('products').filter((p) => p.active !== false && p.kind !== 'lot' && !sold.has(p.id))
    .map((p) => {
      const vs = all<Variant>('variants').filter((v) => v.productId === p.id);
      const q = vs.reduce((t, v) => t + Math.max(0, stockOf(v.id)), 0);
      return { p, qty: q, value: vs.reduce((t, v) => t + Math.max(0, stockOf(v.id)) * variantCost(v), 0) };
    })
    .filter((x) => x.qty > 0).sort((a, b) => b.value - a.value);
}

export function pendingPurchases() {
  const list = all<Purchase>('purchases').filter((p) => !['received', 'cancelled'].includes(p.status));
  return {
    count: list.length,
    valueAr: list.reduce((t, p) => t + purchaseTotalAr(p), 0),
    pieces: list.reduce((t, p) => t + p.lines.reduce((s, l) => s + Math.max(0, l.qtyOrdered - (l.qtyReceived || 0)), 0), 0),
    unpaidAr: list.reduce((t, p) => t + Math.max(0, purchaseTotal(p) - purchasePaid(p)) * (p.currency === 'RMB' ? p.rate || 0 : 1), 0),
  };
}
