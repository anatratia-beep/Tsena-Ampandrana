// Rapport du jour de chaque vendeur au patron, limité à ses pages : ventes et argent reçu par moyen de paiement,
// annulé, reporté, articles vendus, commandes en cours, stock restant, remarques. Envoyé par WhatsApp ; une copie est
// gardée (table dayReports) pour que le patron voie qui a envoyé son rapport, et quoi.
import { all, get, save } from './db';
import { salesLedger } from './analytics';
import { situation, type PageSit } from './situation';
import { orderPagesOf, rootOf, userPages, variantPage } from './scope';
import { dayOf } from './money';
import { variantLabel, type Category, type Product, type StockMove, type Variant } from './catalog';
import { isWalkIn, type Order } from './orders';
import type { User } from './auth';
import type { BaseRecord } from './db';

export interface DayReportRec extends BaseRecord {
  userId: string; userName: string; date: string; pageIds: string[];
  text: string; note?: string; sentAt: string;
  sales: number; qty: number; cash: number; mobile: number; rest: number;
}
export const dayReportId = (userId: string, date: string) => `dr_${userId}_${date}`;
export const sentReport = (userId: string, date: string) => get<DayReportRec>('dayReports', dayReportId(userId, date));

export interface SoldItem { key: string; name: string; page: string; qty: number; amount: number }
export interface DayReport {
  date: string; pageIds: string[]; pageNames: string[];
  sit: { rows: PageSit[]; total: PageSit };
  items: SoldItem[];
  open: { recorded: number; waiting: number; out: number; recordedV: number; waitingV: number; outV: number; created: number };
  stock: { id: string; name: string; pieces: number }[];
}

const pname = (id: string) => (id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? 'Page supprimée');
const itemsValue = (o: Order) => o.lines.reduce((s, l) => s + (l.isChoice ? 0 : l.qty * l.unitPrice), 0) - (o.discount || 0);

/** Pages du rapport : celles du vendeur ; s'il n'en a pas, toutes les pages. */
export function reportPages(u?: User): string[] {
  const mine = userPages(u);
  if (mine.length) return mine;
  return all<Category>('categories').filter((c) => !c.parentId && !c.removed).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).map((c) => c.id);
}

export function dayReport(date: string, pageIds: string[]): DayReport {
  const keep = new Set(pageIds);
  const sit = situation(date, date, pageIds);
  // Articles vendus (retours déduits)
  const items = new Map<string, SoldItem>();
  for (const l of salesLedger(date, date)) {
    const pg = rootOf(l.categoryId) || '_';
    if (!keep.has(pg)) continue;
    const v = get<Variant>('variants', l.variantId);
    const p = get<Product>('products', l.productId);
    const key = l.productId === v?.productId ? l.variantId : l.productId;
    const lbl = l.productId === v?.productId ? variantLabel(v) : '';
    const name = `${p?.name ?? 'Article supprimé'}${lbl && lbl !== 'Unique' ? ` (${lbl})` : ''}`;
    const it = items.get(key) ?? { key, name, page: pname(pg), qty: 0, amount: 0 };
    it.qty += l.qty; it.amount += l.amount;
    items.set(key, it);
  }
  // Commandes en cours sur ces pages (état au moment du rapport) et commandes reçues ce jour
  const open = { recorded: 0, waiting: 0, out: 0, recordedV: 0, waitingV: 0, outV: 0, created: 0 };
  for (const o of all<Order>('orders')) {
    if (isWalkIn(o)) continue;
    let mine = false;
    for (const p of orderPagesOf(o)) if (keep.has(p)) { mine = true; break; }
    if (!mine) continue;
    const val = Math.max(0, itemsValue(o));
    if (o.createdAt && dayOf(o.createdAt) === date) open.created++;
    if (o.status === 'new' || o.status === 'confirmed') { open.recorded++; open.recordedV += val; }
    else if (o.status === 'ready') { open.waiting++; open.waitingV += val; }
    else if (o.status === 'out') { open.out++; open.outV += val; }
  }
  // Stock restant (pièces) par page à la fin de la journée
  const pcs = new Map<string, number>();
  for (const m of all<StockMove>('stockMoves')) {
    if (dayOf(m.at) > date) continue;
    const pg = variantPage(m.variantId);
    if (!keep.has(pg)) continue;
    pcs.set(m.variantId, (pcs.get(m.variantId) ?? 0) + m.qty);
  }
  const byPage = new Map<string, number>();
  for (const [vid, q] of pcs) { if (q <= 0) continue; const pg = variantPage(vid); byPage.set(pg, (byPage.get(pg) ?? 0) + q); }
  return {
    date, pageIds, pageNames: pageIds.map(pname),
    sit,
    items: [...items.values()].filter((i) => i.qty || Math.round(i.amount)).sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    open,
    stock: pageIds.map((id) => ({ id, name: pname(id), pieces: byPage.get(id) ?? 0 })),
  };
}

const ar = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} Ar`;
const frDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Texte WhatsApp du rapport. */
export function dayReportText(r: DayReport, who: string, company: string, note?: string): string {
  const T = r.sit.total;
  const out = [`*${company} — Rapport du jour de ${who}*`, frDay(r.date), `Pages : ${r.pageNames.join(', ') || '—'}`, ''];
  out.push(`*Ventes : ${ar(T.sales)}*`, `${T.orders} vente(s) · ${T.qty} pièce(s)`);
  out.push(`Espèces : ${ar(T.pay.cash)}`, `MVola : ${ar(T.pay.mvola)}`);
  if (Math.round(T.pay.orange)) out.push(`Orange Money : ${ar(T.pay.orange)}`);
  if (Math.round(T.pay.airtel)) out.push(`Airtel Money : ${ar(T.pay.airtel)}`);
  out.push(`Reste à payer : ${ar(T.rest)}${T.restN ? ` (${T.restN} commande(s))` : ''}`);
  if (T.cancelledN) out.push(`Annulé : ${ar(T.cancelled)} (${T.cancelledN} commande(s))`);
  if (T.reportedN) out.push(`Reporté : ${ar(T.reported)} (${T.reportedN} commande(s))`);
  if (r.sit.rows.length > 1) { out.push('', '*Par page*'); for (const p of r.sit.rows) out.push(`• ${p.name} : ${ar(p.sales)} (${p.qty} pcs)`); }
  if (r.items.length) { out.push('', '*Articles vendus*'); for (const i of r.items) out.push(`• ${i.name} × ${i.qty} = ${ar(i.amount)}`); }
  const o = r.open;
  out.push('', '*Commandes*', `Reçues aujourd'hui : ${o.created}`, `Enregistrées (à préparer) : ${o.recorded}`, `En attente de livraison : ${o.waiting}`, `En livraison : ${o.out}`);
  out.push('', '*Stock restant*'); for (const s of r.stock) out.push(`• ${s.name} : ${s.pieces} pcs`);
  if (note?.trim()) out.push('', '*Remarques*', note.trim());
  return out.join('\n');
}

export async function saveDayReport(u: User, r: DayReport, text: string, note: string) {
  const T = r.sit.total;
  await save('dayReports', {
    id: dayReportId(u.id, r.date), userId: u.id, userName: u.fullName, date: r.date, pageIds: r.pageIds, text, note: note.trim() || undefined,
    sentAt: new Date().toISOString(), sales: Math.round(T.sales), qty: T.qty, cash: Math.round(T.pay.cash),
    mobile: Math.round(T.pay.mvola + T.pay.orange + T.pay.airtel), rest: Math.round(T.rest),
  } as Partial<DayReportRec>);
}
