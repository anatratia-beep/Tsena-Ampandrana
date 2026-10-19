// Rapport au patron : résultat, CA par page, stock (début, entrées, fin, sorties) et stock par page, sur une période
// (jour, semaine du lundi au samedi, mois, année, ou dates libres). Sert aussi au texte WhatsApp et au PDF A4.
import { all, get } from './db';
import { variantCost, type Category, type Product, type StockMove, type Variant } from './catalog';
import { moneyOut, salesLedger } from './analytics';
import { rootOf } from './scope';
import { addDays, dayOf, mondayOf, today } from './money';
import { grid, usdRate } from './payouts';
import { courierSplit, isPickupZone, type Order } from './orders';

export type PKind = 'day' | 'week' | 'month' | 'year' | 'custom';
export const PKIND: Record<PKind, string> = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année', custom: 'Période' };
const pad = (n: number) => String(n).padStart(2, '0');
const fr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const frs = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Période contenant la date `anchor`. Semaine : du lundi au samedi (le dimanche est compté s'il y a eu des ventes). */
export function periodOf(kind: PKind, anchor: string, custom?: { from: string; to: string }): { from: string; to: string; label: string } {
  if (kind === 'custom' && custom) return { ...custom, label: `Du ${frs(custom.from)} au ${frs(custom.to)}` };
  if (kind === 'week') {
    const mon = mondayOf(anchor), sat = addDays(mon, 5), sun = addDays(mon, 6);
    return { from: mon, to: sun, label: `Semaine du lundi ${frs(mon)} au samedi ${frs(sat)}` };
  }
  if (kind === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}`, label: new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  }
  if (kind === 'year') { const y = anchor.slice(0, 4); return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Année ${y}` }; }
  return { from: anchor, to: anchor, label: fr(anchor) };
}
/** Période précédente / suivante (‹ ›). */
export function shiftAnchor(kind: PKind, anchor: string, dir: -1 | 1, custom?: { from: string; to: string }) {
  if (kind === 'day') return { anchor: addDays(anchor, dir) };
  if (kind === 'week') return { anchor: addDays(anchor, 7 * dir) };
  if (kind === 'month') { const [y, m] = anchor.split('-').map(Number); const d = new Date(y, m - 1 + dir, 1); return { anchor: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }; }
  if (kind === 'year') return { anchor: `${Number(anchor.slice(0, 4)) + dir}-01-01` };
  if (custom) { const len = Math.round((Date.parse(custom.to) - Date.parse(custom.from)) / 86400_000) + 1; return { anchor, custom: { from: addDays(custom.from, len * dir), to: addDays(custom.to, len * dir) } }; }
  return { anchor };
}

const pageName = (id: string) => (id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? 'Page supprimée');
const pageOfVariant = (vid: string) => { const v = get<Variant>('variants', vid); return rootOf(get<Product>('products', v?.productId || '')?.categoryId) || '_'; };

export interface PageRow { id: string; name: string; revenue: number; qty: number; cost: number; boost: number; profit: number; share: number }
export interface StockRow { id: string; name: string; start: number; in: number; end: number; out: number; pieces: number }
export interface Report {
  from: string; to: string; days: number;
  revenue: number; expenses: number; rest: number; cost: number; boostUsd: number; boost: number; netNoBoost: number; net: number; orders: number; pieces: number;
  pages: PageRow[];
  stock: { start: number; in: number; end: number; out: number; sold: number; other: number };
  stockPages: StockRow[];
  cash: CashToBoss;
}

/** Espèces à verser au patron sur la période (même règle que les versements des vendeurs, tous vendeurs confondus). */
export interface CashToBoss { received: number; fees: number; expenses: number; mobile: number; toPay: number }

/**
 * Espèces encaissées (sur place le jour du paiement ; par les livreurs le jour où ils les rapportent)
 * − frais de livraison gardés par les livreurs − dépenses payées avec la caisse commune (« Caisse espèces »).
 * Le mobile money arrive sur les numéros de la boutique : affiché pour info, pas à verser.
 */
export function cashToBoss(from: string, to: string): CashToBoss {
  const inP = (iso?: string) => { if (!iso) return false; const d = dayOf(iso); return d >= from && d <= to; };
  let received = 0, fees = 0, mobile = 0;
  for (const o of all<Order>('orders')) {
    for (const p of o.payments || []) {
      if (p.method === 'cash' && p.receivedBy === 'courier') continue;
      if (!inP(p.at)) continue;
      if (p.method === 'cash') received += p.amount; else mobile += p.amount;
    }
    if (inP(o.courierSettledAt)) {
      received += (o.payments || []).filter((p) => p.method === 'cash' && p.receivedBy === 'courier').reduce((t, p) => t + p.amount, 0);
      if (!isPickupZone(o.zoneId) && o.feeStatus !== 'paid') fees += courierSplit(o).feeKept;
    }
  }
  const expenses = grid(from, to).expensesTotal;
  return { received, fees, expenses, mobile, toPay: received - fees - expenses };
}

/** Valeur du stock (au prix de revient) à la fin d'une journée, par page, et entrées pendant la période. */
function stockFigures(from: string, to: string) {
  const moves = all<StockMove>('stockMoves');
  const qStart = new Map<string, number>(), qEnd = new Map<string, number>(), qIn = new Map<string, number>();
  for (const m of moves) {
    const local = dayOf(m.at);
    if (local <= addDays(from, -1)) qStart.set(m.variantId, (qStart.get(m.variantId) ?? 0) + m.qty);
    if (local <= to) qEnd.set(m.variantId, (qEnd.get(m.variantId) ?? 0) + m.qty);
    if (local >= from && local <= to && m.qty > 0 && ['initial', 'reception', 'adjust', 'inventory'].includes(m.type)) qIn.set(m.variantId, (qIn.get(m.variantId) ?? 0) + m.qty);
  }
  const rows = new Map<string, StockRow>();
  for (const v of all<Variant>('variants')) {
    const c = variantCost(v);
    const s = Math.max(0, qStart.get(v.id) ?? 0), e = Math.max(0, qEnd.get(v.id) ?? 0), i = qIn.get(v.id) ?? 0;
    if (!s && !e && !i) continue;
    const pid = pageOfVariant(v.id);
    const r = rows.get(pid) ?? { id: pid, name: pageName(pid), start: 0, in: 0, end: 0, out: 0, pieces: 0 };
    r.start += s * c; r.end += e * c; r.in += i * c; r.pieces += e;
    rows.set(pid, r);
  }
  const list = [...rows.values()].map((r) => ({ ...r, out: r.start + r.in - r.end })).filter((r) => r.start > 0 || r.end > 0).sort((a, b) => b.end - a.end);
  const sum = (k: keyof StockRow) => list.reduce((t, r) => t + (r[k] as number), 0);
  return { rows: list, start: sum('start'), in: sum('in'), end: sum('end'), out: sum('out') };
}

export function bossReport(from: string, to: string): Report {
  const lines = salesLedger(from, to);
  const g = grid(from, to);
  const rate = usdRate();
  const byPage = new Map<string, PageRow>();
  for (const l of lines) {
    const id = rootOf(l.categoryId) || '_';
    const r = byPage.get(id) ?? { id, name: pageName(id), revenue: 0, qty: 0, cost: 0, boost: 0, profit: 0, share: 0 };
    r.revenue += l.amount; r.qty += l.qty; r.cost += l.cost;
    byPage.set(id, r);
  }
  for (const [pid, usd] of Object.entries(g.boostUsd)) { const r = byPage.get(pid); if (r) r.boost += usd * rate; }
  const revenue = lines.reduce((t, l) => t + l.amount, 0);
  const cost = lines.reduce((t, l) => t + l.cost, 0);
  const boostUsd = Object.values(g.boostUsd).reduce((t, v) => t + v, 0);
  const boost = Math.round(boostUsd * rate);
  const { expenses } = moneyOut(from, to);
  const pages = [...byPage.values()].filter((r) => Math.round(r.revenue) !== 0).map((r) => ({ ...r, profit: r.revenue - r.cost - r.boost, share: revenue ? r.revenue / revenue : 0 })).sort((a, b) => b.revenue - a.revenue);
  const st = stockFigures(from, to);
  const netNoBoost = revenue - cost - expenses;
  return {
    from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1,
    revenue, expenses, rest: revenue - expenses, cost, boostUsd, boost, netNoBoost, net: netNoBoost - boost,
    orders: new Set(lines.filter((l) => l.kind === 'sale').map((l) => l.order.id)).size, pieces: lines.reduce((t, l) => t + l.qty, 0),
    pages, stock: { start: st.start, in: st.in, end: st.end, out: st.out, sold: cost, other: st.out - cost }, stockPages: st.rows,
    cash: cashToBoss(from, to),
  };
}

/** Le dimanche n'est affiché que s'il y a eu des ventes ce jour-là. */
export const sundaySales = (r: Report) => salesLedger(r.to, r.to).length > 0;

const ar = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} Ar`;
/** Texte court pour WhatsApp. */
export function reportText(kind: PKind, label: string, r: Report, company: string) {
  const out = [`*${company} — Rapport ${kind === 'day' ? 'du jour' : kind === 'week' ? 'de la semaine' : kind === 'month' ? 'du mois' : kind === 'year' ? "de l'année" : 'de la période'}*`, label, ''];
  out.push(`CA : ${ar(r.revenue)}`, `Dépenses : ${ar(r.expenses)}`, `Reste : ${ar(r.rest)}`, `*Espèces à verser : ${ar(r.cash.toPay)}*`);
  if (kind === 'day') out.push(`Bénéfice net (sans boost) : ${ar(r.netNoBoost)}`);
  else out.push(`Boost Facebook : ${ar(r.boost)}`, `Coût des articles vendus : ${ar(r.cost)}`, `*Bénéfice net : ${ar(r.net)}*`);
  if (r.pages.length) { out.push('', '*CA par page*'); for (const p of r.pages) out.push(`• ${p.name} : ${ar(p.revenue)} (${p.qty} pcs)`); }
  if (kind !== 'day' && r.stockPages.length) {
    out.push('', '*Stock (prix de revient)*', `Début : ${ar(r.stock.start)}`, `+ Entrées : ${ar(r.stock.in)}`, `Fin : ${ar(r.stock.end)}`, `= Sorti : ${ar(r.stock.out)} (vendu ${ar(r.stock.sold)})`);
    for (const p of r.stockPages) out.push(`• ${p.name} : ${ar(p.end)} (${p.pieces} pcs)`);
  }
  return out.join('\n');
}
export const todayYmd = today;
