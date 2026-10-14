// Récap global (comme le cahier « Recette et Dépense » : récap journalier, hebdomadaire, mensuel), automatique :
// pour chaque jour / semaine / mois / année d'une période : CA et produits vendus par page, CA total, dépenses, reste (CA − dépenses),
// versé au patron, boost, coût des articles vendus, bénéfice net, valeur du stock en fin de période.
// Les lignes sont regroupées avec un sous-total (jours → semaine, semaines → mois, mois → année).
import { all, get } from './db';
import { salesLedger } from './analytics';
import { rootOf } from './scope';
import { addDays, dayOf, mondayOf, type CashMove } from './money';
import { variantCost, type Category, type StockMove, type Variant } from './catalog';
import { usdRate } from './payouts';
import type { Payout } from './closed';
import { allDeltas } from './boosts';

export type Gran = 'day' | 'week' | 'month' | 'year';
export const GRAN_LABEL: Record<Gran, string> = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année' };
const FINER: Record<Gran, Gran | null> = { year: 'month', month: 'week', week: 'day', day: null };
export const finer = (g: Gran) => FINER[g];
const pad = (n: number) => String(n).padStart(2, '0');

export interface RecapRow {
  key: string; from: string; to: string; label: string; sub?: string; group: string; groupLabel: string;
  pages: Record<string, number>; pageCost: Record<string, number>; pageBoost: Record<string, number>; pageQty: Record<string, number>; qty: number; revenue: number; orders: number; expenses: number; rest: number; paid: number; boost: number; cost: number; net: number; stock: number;
}
export interface Recap { gran: Gran; from: string; to: string; rows: RecapRow[]; pages: { id: string; name: string }[]; groups: { key: string; label: string; rows: RecapRow[]; total: RecapRow }[]; total: RecapRow }

const frDay = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', o);
export function keyOf(day: string, g: Gran) { return g === 'day' ? day : g === 'week' ? mondayOf(day) : g === 'month' ? day.slice(0, 7) : day.slice(0, 4); }
function rangeOfKey(key: string, g: Gran) {
  if (g === 'day') return { from: key, to: key };
  if (g === 'week') return { from: key, to: addDays(key, 6) };
  if (g === 'month') { const [y, m] = key.split('-').map(Number); return { from: `${key}-01`, to: `${key}-${pad(new Date(y, m, 0).getDate())}` }; }
  return { from: `${key}-01-01`, to: `${key}-12-31` };
}
function labelOf(key: string, g: Gran) {
  if (g === 'day') return { label: frDay(key, { weekday: 'short', day: '2-digit', month: '2-digit' }), sub: undefined };
  if (g === 'week') return { label: `Semaine du ${frDay(key, { day: '2-digit', month: '2-digit' })} au ${frDay(addDays(key, 5), { day: '2-digit', month: '2-digit' })}`, sub: frDay(key, { year: 'numeric' }) };
  if (g === 'month') return { label: frDay(`${key}-01`, { month: 'long', year: 'numeric' }), sub: undefined };
  return { label: `Année ${key}`, sub: undefined };
}
/** Groupe d'une ligne (pour le sous-total) : la semaine d'un jour, le mois d'une semaine, l'année d'un mois. */
function groupOf(key: string, g: Gran, from: string, to: string): { key: string; label: string } {
  if (g === 'day') { const m = mondayOf(key); return { key: m, label: labelOf(m, 'week').label }; }
  if (g === 'week') {
    // Semaine à cheval sur deux mois : le mois qui a le plus de jours (le jeudi), en restant dans la période choisie.
    let pick = addDays(key, 3); if (pick < from) pick = from; if (pick > to) pick = to;
    const k = pick.slice(0, 7); return { key: k, label: labelOf(k, 'month').label };
  }
  if (g === 'month') return { key: key.slice(0, 4), label: key.slice(0, 4) };
  return { key: 'all', label: 'Toutes les années' };
}

/** Première date avec une activité (vente, dépense, mouvement de stock), pour le filtre « Tout ». */
export function firstActivity(): string {
  let min = '';
  const see = (iso?: string) => { if (!iso) return; const d = dayOf(iso); if (d && (!min || d < min)) min = d; };
  for (const o of all<{ createdAt: string }>('orders')) see(o.createdAt);
  for (const m of all<CashMove>('cashMoves')) see(m.at);
  return min || dayOf(new Date().toISOString());
}

const emptyRow = (key: string, from: string, to: string, label: string, group = '', groupLabel = ''): RecapRow => ({ key, from, to, label, group, groupLabel, pages: {}, pageCost: {}, pageBoost: {}, pageQty: {}, qty: 0, revenue: 0, orders: 0, expenses: 0, rest: 0, paid: 0, boost: 0, cost: 0, net: 0, stock: 0 });
function addInto(t: RecapRow, r: RecapRow) {
  for (const [k, v] of Object.entries(r.pages)) t.pages[k] = (t.pages[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.pageCost)) t.pageCost[k] = (t.pageCost[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.pageBoost)) t.pageBoost[k] = (t.pageBoost[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.pageQty)) t.pageQty[k] = (t.pageQty[k] ?? 0) + v;
  t.qty += r.qty; t.revenue += r.revenue; t.orders += r.orders; t.expenses += r.expenses; t.rest += r.rest; t.paid += r.paid; t.boost += r.boost; t.cost += r.cost; t.net += r.net;
}

export function globalRecap(from: string, to: string, gran: Gran): Recap {
  const keys: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const k = keyOf(d, gran); if (keys[keys.length - 1] !== k) keys.push(k); if (keys.length > 800) break; }
  const rows = new Map<string, RecapRow>();
  for (const k of keys) {
    const r = rangeOfKey(k, gran); const g = groupOf(k, gran, from, to); const l = labelOf(k, gran);
    rows.set(k, { ...emptyRow(k, r.from < from ? from : r.from, r.to > to ? to : r.to, l.label, g.key, g.label), sub: l.sub });
  }
  const row = (day: string) => rows.get(keyOf(day, gran));
  // Ventes par page et coût des articles.
  const seenOrders = new Map<string, Set<string>>();
  const pageIds = new Set<string>();
  for (const l of salesLedger(from, to)) {
    const r = row(l.day); if (!r) continue;
    const p = rootOf(l.categoryId) || '_'; pageIds.add(p);
    r.pages[p] = (r.pages[p] ?? 0) + l.amount; r.pageCost[p] = (r.pageCost[p] ?? 0) + l.cost; r.revenue += l.amount; r.cost += l.cost;
    // Produits vendus (pièces) : ventes − articles revenus (retours, refus), par page.
    r.pageQty[p] = (r.pageQty[p] ?? 0) + l.qty; r.qty += l.qty;
    if (l.kind === 'sale') { const s = seenOrders.get(r.key) ?? new Set(); s.add(l.order.id); seenOrders.set(r.key, s); }
  }
  for (const [k, s] of seenOrders) rows.get(k)!.orders = s.size;
  // Dépenses (toutes les dépenses enregistrées, comme le tableau de bord et le rapport au patron).
  for (const m of all<CashMove>('cashMoves')) { if (m.type !== 'expense') continue; const d = dayOf(m.at); if (d < from || d > to) continue; const r = row(d); if (r) r.expenses -= m.amount; }
  // Versements au patron : le jour du versement en vue « Jour », sinon la semaine versée.
  for (const p of all<Payout>('payouts')) { if (p.status !== 'paid') continue; const d = gran === 'day' ? dayOf(p.at) : p.weekStart; if (d < from || d > to) continue; const r = row(d); if (r) r.paid += p.amount; }
  // Boost : dépense du jour = saisie cumulée − saisie précédente (voir readingDelta), convertie en ariary, par page.
  const rate = usdRate();
  for (const x of allDeltas()) {
    if (x.r.date < from || x.r.date > to) continue;
    const r = row(x.r.date); if (!r) continue;
    const v = x.spend * rate; r.boost += v; r.pageBoost[x.r.pageId] = (r.pageBoost[x.r.pageId] ?? 0) + v; pageIds.add(x.r.pageId);
  }
  // Valeur du stock (prix de revient actuel) en fin de période.
  const cost = new Map(all<Variant>('variants').map((v) => [v.id, variantCost(v)]));
  const moves = all<StockMove>('stockMoves').map((m) => ({ d: dayOf(m.at), v: m.qty * (cost.get(m.variantId) ?? 0) })).sort((a, b) => a.d.localeCompare(b.d));
  let acc = 0, i = 0;
  for (const r of rows.values()) { while (i < moves.length && moves[i].d <= r.to) acc += moves[i++].v; r.stock = Math.max(0, acc); }
  for (const r of rows.values()) { r.rest = r.revenue - r.expenses; r.net = r.revenue - r.cost - r.expenses - r.boost; }
  // Colonnes : pages (ordre des pages, sinon alphabétique) ; « Sans page » à la fin si des ventes n'en ont pas.
  // Toutes les pages (catégories principales) en colonnes, même sans vente sur la période — comme le cahier Excel.
  const pages = all<Category>('categories').filter((c) => !c.parentId && !c.removed).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'fr')).map((c) => ({ id: c.id, name: c.name }));
  for (const id of pageIds) if (!pages.some((p) => p.id === id)) pages.push({ id, name: id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? 'Page supprimée' });
  const list = [...rows.values()];
  const groups: Recap['groups'] = [];
  for (const r of list) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== r.group) { g = { key: r.group, label: r.groupLabel, rows: [], total: emptyRow(`t_${r.group}`, r.from, r.to, `Total ${r.groupLabel}`) }; groups.push(g); }
    g.rows.push(r); addInto(g.total, r); g.total.to = r.to; g.total.stock = r.stock;
  }
  const total = emptyRow('total', from, to, 'Total'); for (const r of list) addInto(total, r); total.stock = list[list.length - 1]?.stock ?? 0;
  return { gran, from, to, rows: list, pages, groups, total };
}
export { FINER };
