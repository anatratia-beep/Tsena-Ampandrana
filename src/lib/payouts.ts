// Tableau de la semaine (comme le cahier « Recette et Dépense ») et versement de la semaine au patron.
//
// Semaine = lundi → samedi. Montant à verser = total des ventes de la semaine − total des dépenses de la caisse commune
// (compte « Caisse espèces » : une seule caisse pour tous les vendeurs).
// Le gérant vérifie le détail, saisit le montant réellement remis, valide : la semaine est clôturée (identifiant
// unique par semaine : impossible de la verser deux fois, même depuis deux appareils), le versement est tracé
// (période, montant, date, gérant, appareil) et gardé dans l'historique.
import { all, get, getMeta, save, type BaseRecord } from './db';
import { audit, currentUser } from './auth';
import { salesLedger } from './analytics';
import { rootOf } from './scope';
import { addDays, dayOf, type AccountId, type CashMove, type FinanceCategory } from './money';
import { variantLabel, type Category, type Product, type Variant } from './catalog';
import { hasPendingChoice, orderLabel, type Order } from './orders';
import { allDeltas } from './boosts';
import { payoutId, type Payout } from './closed';
import { DEFAULT_COMPANY, type Company } from './settings';

export const weekOf = (monday: string) => ({ start: monday, end: addDays(monday, 5), days: Array.from({ length: 6 }, (_, i) => addDays(monday, i)) });
export const usdRate = () => (get<Company>('settings', 'company')?.usdRate ?? DEFAULT_COMPANY.usdRate ?? 4700);

export interface PageCol { id: string; name: string }
export interface Grid {
  from: string; to: string; days: string[];
  pages: PageCol[];
  sales: Record<string, Record<string, number>>;        // jour → page → ventes nettes
  cost: Record<string, number>;                           // page → coût des articles vendus
  boostUsd: Record<string, number>;                       // page → dépense boost ($)
  expensesByDay: Record<string, number>;
  expenseMoves: CashMove[];
  salesTotal: number; expensesTotal: number; rest: number;
  pageTotals: Record<string, number>;
  dayTotals: Record<string, number>;
}

/** Ventes par page et par jour, dépenses, boost, sur une période (jours inclus). */
export function grid(from: string, to: string): Grid {
  const days: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const sales: Grid['sales'] = Object.fromEntries(days.map((d) => [d, {}]));
  const cost: Record<string, number> = {};
  const seen = new Set<string>();
  for (const l of salesLedger(from, to)) {
    const page = rootOf(l.categoryId) || '_';
    seen.add(page);
    sales[l.day][page] = (sales[l.day][page] ?? 0) + l.amount;
    cost[page] = (cost[page] ?? 0) + l.cost;
  }
  const boostUsd: Record<string, number> = {};
  // Dépense cumulée : la dépense du jour = saisie du jour − saisie précédente (voir readingDelta).
  for (const x of allDeltas()) if (x.r.date >= from && x.r.date <= to) { boostUsd[x.r.pageId] = (boostUsd[x.r.pageId] ?? 0) + x.spend; seen.add(x.r.pageId); }
  const expenseMoves = all<CashMove>('cashMoves').filter((m) => m.type === 'expense' && m.account === 'cash' && dayOf(m.at) >= from && dayOf(m.at) <= to).sort((a, b) => a.at.localeCompare(b.at));
  const expensesByDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const m of expenseMoves) expensesByDay[dayOf(m.at)] = (expensesByDay[dayOf(m.at)] ?? 0) - m.amount;
  // Colonnes : toutes les pages (catégories principales), dans l'ordre alphabétique ; « Sans page » à la fin si besoin.
  const pages: PageCol[] = all<Category>('categories').filter((c) => !c.parentId && (!c.removed || seen.has(c.id))).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => ({ id: c.id, name: c.name }));
  if (seen.has('_')) pages.push({ id: '_', name: 'Sans page' });
  const pageTotals = Object.fromEntries(pages.map((p) => [p.id, days.reduce((t, d) => t + (sales[d][p.id] ?? 0), 0)]));
  const dayTotals = Object.fromEntries(days.map((d) => [d, Object.values(sales[d]).reduce((t, v) => t + v, 0)]));
  const salesTotal = Object.values(dayTotals).reduce((t, v) => t + v, 0);
  const expensesTotal = Object.values(expensesByDay).reduce((t, v) => t + v, 0);
  return { from, to, days, pages, sales, cost, boostUsd, expensesByDay, expenseMoves, salesTotal, expensesTotal, rest: salesTotal - expensesTotal, pageTotals, dayTotals };
}

export const payoutOf = (monday: string) => get<Payout>('payouts', payoutId(monday));
export const payouts = () => all<Payout>('payouts').sort((a, b) => b.weekStart.localeCompare(a.weekStart));

/** Valide le versement de la semaine. Refusé si la semaine est déjà versée ou pas encore terminée. */
export async function validatePayout(monday: string, amount: number, account: AccountId, note?: string) {
  const w = weekOf(monday);
  const existing = payoutOf(monday);
  if (existing?.status === 'paid') throw new Error(`Cette semaine a déjà été versée le ${existing.at.slice(0, 10)} par ${existing.byName ?? '?'}.`);
  const todayYmd = dayOf(new Date().toISOString());
  if (w.end > todayYmd) throw new Error('La semaine n’est pas terminée : le versement se fait à partir du samedi soir.');
  if (!(amount >= 0)) throw new Error('Montant versé invalide.');
  const g = grid(w.start, w.end);
  const u = currentUser();
  const expected = g.salesTotal - g.expensesTotal;
  const at = new Date().toISOString();
  const label = `Versement au patron — semaine du ${fr(w.start)} au ${fr(w.end)}`;
  const [mv] = await save('cashMoves', { id: `pomv_${monday}`, deleted: false, at, account, amount: -amount, type: 'owner_out', label, note, refType: 'payouts', refId: payoutId(monday), userName: u?.fullName });
  await save('payouts', {
    id: payoutId(monday), weekStart: w.start, weekEnd: w.end, sales: g.salesTotal, expenses: g.expensesTotal, expected, amount, account, gap: amount - expected, note,
    byId: u?.id, byName: u?.fullName, at, device: getMeta('deviceName', '') || undefined,
    perPage: g.pages.map((p) => ({ pageId: p.id, name: p.name, sales: g.pageTotals[p.id] ?? 0 })).filter((p) => p.sales),
    expenseIds: g.expenseMoves.map((m) => m.id), moveId: mv.id, status: 'paid', cancelledBy: undefined, cancelledAt: undefined, cancelReason: undefined,
  } as Partial<Payout>);
  await audit('Versement de la semaine', `${label} : ${amount.toLocaleString('fr-FR')} Ar remis (attendu ${expected.toLocaleString('fr-FR')} Ar${amount !== expected ? `, écart ${(amount - expected).toLocaleString('fr-FR')} Ar` : ''})`, 'payouts', payoutId(monday));
}

/** Annule un versement (erreur de saisie) : la semaine est rouverte, l'annulation reste dans l'historique. */
export async function cancelPayout(p: Payout, reason: string) {
  const u = currentUser();
  if (p.moveId) await save('cashMoves', { id: p.moveId, deleted: true });
  await save('payouts', { id: p.id, status: 'cancelled', cancelledBy: u?.fullName, cancelledAt: new Date().toISOString(), cancelReason: reason });
  await audit('Versement annulé', `Semaine du ${fr(p.weekStart)} au ${fr(p.weekEnd)} : ${p.amount.toLocaleString('fr-FR')} Ar — ${reason}`, 'payouts', p.id);
}

export const catName = (id?: string) => (id ? get<FinanceCategory>('financeCategories', id)?.name : undefined);
const fr = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Semaines terminées (lundi → samedi) avec ventes ou dépenses et sans versement validé (les 12 dernières). */
export function unpaidWeeks(todayYmd: string, mondayOf: (d: string) => string): { monday: string; expected: number }[] {
  const out: { monday: string; expected: number }[] = [];
  let mon = mondayOf(todayYmd);
  if (addDays(mon, 5) > todayYmd) mon = addDays(mon, -7);
  for (let i = 0; i < 12; i++, mon = addDays(mon, -7)) {
    if (payoutOf(mon)?.status === 'paid') continue;
    const g = grid(mon, addDays(mon, 5));
    if (g.salesTotal || g.expensesTotal) out.push({ monday: mon, expected: g.rest });
  }
  return out;
}

export interface MonthRow { key: string; label: string; from: string; to: string; pages: Record<string, number>; sales: number; expenses: number; rest: number; paid: number; boostAr: number; cost: number; profit: number; weeks: number }
/** Récapitulatif mensuel (comme l'onglet « RECAP MENSUEL ») : les n derniers mois, le plus récent en premier. */
export function monthly(n: number, todayYmd: string): { rows: MonthRow[]; pages: PageCol[] } {
  const rate = usdRate();
  const [y0, m0] = todayYmd.split('-').map(Number);
  const rows: MonthRow[] = [];
  const pageIds = new Map<string, string>();
  const paidList = payouts().filter((p) => p.status === 'paid');
  for (let i = 0; i < n; i++) {
    const d = new Date(y0, m0 - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const from = `${key}-01`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const to = `${key}-${String(last).padStart(2, '0')}`;
    const g = grid(from, to < todayYmd ? to : todayYmd);
    for (const p of g.pages) if (g.pageTotals[p.id] || g.boostUsd[p.id]) pageIds.set(p.id, p.name);
    const boostAr = Object.values(g.boostUsd).reduce((t, v) => t + v, 0) * rate;
    const cost = Object.values(g.cost).reduce((t, v) => t + v, 0);
    const paid = paidList.filter((p) => p.weekStart >= from && p.weekStart <= to);
    rows.push({
      key, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), from, to, pages: g.pageTotals, sales: g.salesTotal, expenses: g.expensesTotal, rest: g.rest,
      paid: paid.reduce((t, p) => t + p.amount, 0), weeks: paid.length, boostAr, cost, profit: g.salesTotal - cost - boostAr - g.expensesTotal,
    });
  }
  const pages = [...pageIds.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.id === '_' ? 1 : b.id === '_' ? -1 : a.name.localeCompare(b.name, 'fr')));
  return { rows, pages };
}

/** Récapitulatif global du jour (tous les vendeurs, caisse commune) à envoyer par WhatsApp. */
export function dayRecap(ymd: string, only?: { pages: string[]; userName?: string }) {
  const g = grid(ymd, ymd);
  let shop = 0, online = 0; const shopN = new Set<string>(), onlineN = new Set<string>();
  const set = only?.pages.length ? new Set(only.pages) : null;
  for (const l of salesLedger(ymd, ymd)) {
    if (set && !set.has(rootOf(l.categoryId) || '')) continue;
    if (l.channel === 'shop') { shop += l.amount; shopN.add(l.order.id); } else { online += l.amount; onlineN.add(l.order.id); }
  }
  const pages = g.pages.filter((p) => g.pageTotals[p.id] && (!set || set.has(p.id))).sort((a, b) => (g.pageTotals[b.id] ?? 0) - (g.pageTotals[a.id] ?? 0));
  if (set) {
    // Vendeur limité à ses pages : seulement ses pages et les dépenses qu'il a saisies lui-même.
    const expenseMoves = g.expenseMoves.filter((m) => m.userName && m.userName === only!.userName);
    const sales = pages.reduce((t, p) => t + (g.pageTotals[p.id] ?? 0), 0);
    const expenses = expenseMoves.reduce((t, m) => t - m.amount, 0);
    return { g: { ...g, expenseMoves }, pages, shop, online, shopCount: shopN.size, onlineCount: onlineN.size, sales, expenses, net: sales - expenses, mine: true };
  }
  return { g, pages, shop, online, shopCount: shopN.size, onlineCount: onlineN.size, sales: g.salesTotal, expenses: g.expensesTotal, net: g.rest, mine: false };
}
const ar = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} Ar`;
export function dayRecapText(ymd: string, companyName: string, sender?: string, only?: { pages: string[]; userName?: string }) {
  const r = dayRecap(ymd, only);
  const date = new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const L: string[] = [];
  L.push(`*${companyName}*`, `*Récapitulatif du ${date}*`, r.mine ? `_Mes pages${sender ? ` (${sender})` : ''}_` : '_Global : tous les vendeurs, caisse commune_', '');
  L.push('*Ventes par page*');
  if (!r.pages.length) L.push('• Aucune vente');
  for (const p of r.pages) L.push(`• ${p.name} : ${ar(r.g.pageTotals[p.id])}`);
  L.push(`*TOTAL DES VENTES : ${ar(r.sales)}*`, `  (sur place : ${ar(r.shop)} · ${r.shopCount} vente(s) ; livraisons : ${ar(r.online)} · ${r.onlineCount} commande(s))`, '');
  L.push(r.mine ? '*Mes dépenses (caisse commune)*' : '*Dépenses de la caisse commune*');
  if (!r.g.expenseMoves.length) L.push('• Aucune dépense');
  for (const m of r.g.expenseMoves) L.push(`• ${m.label || catName(m.categoryId) || 'Dépense'}${m.label && catName(m.categoryId) ? ` (${catName(m.categoryId)})` : ''} : ${ar(-m.amount)}${m.userName ? ` — ${m.userName}` : ''}`);
  L.push(`*TOTAL DES DÉPENSES : ${ar(r.expenses)}*`, '');
  L.push(`*MONTANT NET DU JOUR : ${ar(r.net)}*`, '_(total des ventes − dépenses de la caisse commune)_');
  if (sender) L.push('', `Envoyé par ${sender} le ${new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
  return L.join('\n');
}

export interface ReviewRow { key: string; at: string; number: string; orderId: string; kind: 'shop' | 'online' | 'return'; who: string; pages: string[]; items: string[]; qty: number; amount: number; seller?: string }
/** Aperçu détaillé du jour pour la vérification avant envoi : une ligne par vente / livraison / retour. */
export function dayReview(ymd: string, pages?: string[]) {
  const rows = new Map<string, ReviewRow>();
  const set = pages?.length ? new Set(pages) : null;
  for (const l of salesLedger(ymd, ymd)) {
    if (set && !set.has(rootOf(l.categoryId) || '')) continue;
    const kind: ReviewRow['kind'] = l.kind === 'return' ? 'return' : l.channel === 'shop' ? 'shop' : 'online';
    const key = `${l.order.id}|${kind}|${l.at}`;
    let r = rows.get(key);
    if (!r) { r = { key, at: l.at, number: l.order.number, orderId: l.order.id, kind, who: orderLabel(l.order), pages: [], items: [], qty: 0, amount: 0, seller: l.order.createdByName }; rows.set(key, r); }
    const v = get<Variant>('variants', l.variantId); const prod = v && get<Product>('products', v.productId);
    const page = get<Category>('categories', rootOf(l.categoryId) || '')?.name ?? 'Sans page';
    if (!r.pages.includes(page)) r.pages.push(page);
    r.items.push(`${Math.abs(l.qty)} × ${prod?.name ?? 'article ?'}${v && !prod?.attrs && variantLabel(v) !== 'Unique' ? ` ${variantLabel(v)}` : ''}`.trim());
    r.qty += l.qty; r.amount += l.amount;
  }
  const list = [...rows.values()].sort((a, b) => a.at.localeCompare(b.at));
  // Points d'attention : ce qui pourrait manquer ou fausser les totaux.
  const orders = all<Order>('orders');
  const warnings: string[] = [];
  const out = orders.filter((o) => o.status === 'out');
  const pend = out.filter((o) => hasPendingChoice(o));
  if (out.length) warnings.push(`${out.length} livraison(s) encore chez les livreurs (pas encore confirmées livrées ou refusées) : leurs retours éventuels ne sont pas encore déduits.`);
  if (pend.length) warnings.push(`${pend.length} livraison(s) avec un « choix à préciser » : le choix gardé par le client n’est pas encore compté.`);
  const ready = orders.filter((o) => (o.status === 'confirmed' || o.status === 'ready') && dayOf(o.createdAt) <= ymd);
  if (ready.length) warnings.push(`${ready.length} commande(s) confirmée(s) ou prête(s) pas encore remise(s) au livreur : elles ne sont pas dans les ventes du jour.`);
  if (list.some((r) => r.pages.includes('Sans page'))) warnings.push('Des ventes concernent un article sans page (catégorie) : elles sont comptées dans « Sans page ».');
  const zero = list.filter((r) => r.kind !== 'return' && r.amount <= 0);
  if (zero.length) warnings.push(`${zero.length} vente(s) à 0 Ar ou moins : vérifiez les prix ou les remises (${zero.map((r) => r.number).join(', ')}).`);
  return { rows: list, warnings };
}
