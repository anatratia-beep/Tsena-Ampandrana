// Outils (function calling) de l'assistant IA : LECTURE SEULE, sur les vraies données de l'application.
// Chaque outil réutilise les calculs de l'application (mêmes chiffres que les écrans) et applique les mêmes droits :
// un utilisateur n'obtient que ce qu'il peut déjà voir (rôle, droits, « pages » du vendeur, livreur limité à ses colis).
import { all, get, memSetMeta } from '../../lib/db';
import { can, roleOf, type Role, type User } from '../../lib/auth';
import { SUPERADMIN_ROLE } from '../../lib/permissions';
import { isPageManager, isPageSeller, orderPagesOf, rootOf, userPages } from '../../lib/scope';
import { groupBy, kpis, moneyOut, previousPeriod, salesLedger, stockValue, type SaleLine } from '../../lib/analytics';
import { coverage } from '../../lib/insights';
import { incomingOf, productVariants, stockOf, variantCost, PURCHASE_STATUS, type Category, type Product, type Purchase, type Variant } from '../../lib/catalog';
import { CHANNELS, ORDER_STATUS, PAY_METHODS, orderTotal, paidTotal, remaining, unpaidOf, isWalkIn, type Courier, type Customer, type Order } from '../../lib/orders';
import { ACCOUNTS, ACCOUNT_IDS, MOVE_TYPES, addDays, balances, dayOf, mondayOf, report, today, type CashMove, type FinanceCategory } from '../../lib/money';
import { isMine, sellersOfDay, type Handover } from '../../lib/handovers';
import { purchasePaid, purchaseQty, purchaseReceivedQty, purchaseTotalAr, type Supplier } from '../../lib/purchases';
import { runSelect, type Sql } from './data';

// ---------- Contexte de l'utilisateur ----------
export interface Ctx {
  user: User;
  can: (p: string) => boolean;
  /** Vendeur ou responsable limité à ses pages (comme dans l'application, sans « Tout voir »). */
  locked: boolean;
  pages: Set<string>;
  /** Livreur : ne voit que ses colis et son compte. */
  courierOnly: boolean;
  sql?: Sql;
}
export function ctxFor(user: User, sql?: Sql): Ctx {
  memSetMeta('session', { userId: user.id, at: new Date().toISOString() });
  const c = (p: string) => can(user, p);
  const locked = isPageSeller(user) || isPageManager(user);
  const courierOnly = c('courier.self') && !['orders.create', 'deliveries.menu', 'dashboard.view', 'reports.view'].some(c);
  return { user, can: c, locked, pages: new Set(userPages(user)), courierOnly, sql };
}
export const roleNames = (u: User) => [roleOf(u)?.name, ...(u.extraRoleIds ?? []).map((id) => get<Role>('roles', id)?.name)].filter(Boolean).join(' + ');
export const isAdmin = (u: User) => u.roleId === SUPERADMIN_ROLE || can(u, 'settings.company');

const anyOf = (...p: string[]) => (c: Ctx) => p.some((x) => c.can(x));
const r0 = (n: number) => Math.round(n || 0);
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Date et heure à Madagascar, « AAAA-MM-JJ HH:MM ». */
const when = (iso?: string) => { if (!iso) return undefined; const d = new Date(iso); return `${dayOf(iso)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const pageName = (id: string) => (id ? get<Category>('categories', id)?.name ?? '?' : 'Sans page');
const allPages = () => all<Category>('categories').filter((c) => !c.parentId && !c.removed);
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Page choisie par son nom (filtre), en respectant les pages autorisées. */
function pageFilter(c: Ctx, name?: string): { ok: (pageId: string) => boolean; error?: string; label?: string } {
  const allowed = (id: string) => !c.locked || c.pages.has(id);
  if (!name) return { ok: allowed };
  const n = norm(name);
  const hit = allPages().filter((p) => norm(p.name) === n || norm(p.code) === n)[0] ?? allPages().find((p) => norm(p.name).includes(n));
  if (!hit) return { ok: () => false, error: `page « ${name} » introuvable. Pages : ${allPages().filter((p) => allowed(p.id)).map((p) => p.name).join(', ')}` };
  if (!allowed(hit.id)) return { ok: () => false, error: `vous n'avez pas accès à la page « ${hit.name} »` };
  return { ok: (id) => id === hit.id, label: hit.name };
}

// ---------- Périodes ----------
const PERIODES = ['aujourdhui', 'hier', 'cette_semaine', 'semaine_derniere', 'ce_mois', 'mois_dernier', '7_derniers_jours', '30_derniers_jours', 'cette_annee', 'personnalisee'] as const;
type Periode = (typeof PERIODES)[number];
const ymdOk = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function period(a: { periode?: Periode; du?: string; au?: string }, def: Periode = 'aujourdhui') {
  const t = today();
  let p = (a.periode || def) as Periode;
  if ((ymdOk(a.du) || ymdOk(a.au)) && !a.periode) p = 'personnalisee';
  const monthStart = (d: string) => d.slice(0, 7) + '-01';
  const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);
  let from = t, to = t, label = "aujourd'hui";
  switch (p) {
    case 'hier': from = to = addDays(t, -1); label = 'hier'; break;
    case 'cette_semaine': from = mondayOf(t); label = 'cette semaine (depuis lundi)'; break;
    case 'semaine_derniere': from = addDays(mondayOf(t), -7); to = addDays(mondayOf(t), -1); label = 'la semaine dernière'; break;
    case 'ce_mois': from = monthStart(t); label = 'ce mois-ci'; break;
    case 'mois_dernier': { const m = monthStart(addDays(monthStart(t), -1)); from = m; to = monthEnd(m); label = 'le mois dernier'; break; }
    case '7_derniers_jours': from = addDays(t, -6); label = 'les 7 derniers jours'; break;
    case '30_derniers_jours': from = addDays(t, -29); label = 'les 30 derniers jours'; break;
    case 'cette_annee': from = t.slice(0, 4) + '-01-01'; label = 'cette année'; break;
    case 'personnalisee': from = ymdOk(a.du) ? a.du! : t; to = ymdOk(a.au) ? a.au! : from; if (to < from) [from, to] = [to, from]; label = from === to ? `le ${from}` : `du ${from} au ${to}`; break;
  }
  return { from, to, label };
}
/**
 * Période de comparaison : même jours de la semaine précédente (semaine), même jours du mois précédent (mois),
 * même période de l'année précédente (année) ; sinon la période juste avant, de même durée.
 */
function comparePeriod(periode: string | undefined, from: string, to: string) {
  const shiftMonth = (d: string, n: number) => {
    const [y, m, day] = d.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return `${first.getUTCFullYear()}-${pad2(first.getUTCMonth() + 1)}-${pad2(Math.min(day, last))}`;
  };
  if (periode === 'cette_semaine' || periode === 'semaine_derniere') return { from: addDays(from, -7), to: addDays(to, -7) };
  if (periode === 'ce_mois') return { from: shiftMonth(from, -1), to: shiftMonth(to, -1) };
  if (periode === 'mois_dernier') { const f = shiftMonth(from, -1); return { from: f, to: addDays(shiftMonth(f, 1), -1) }; }
  if (periode === 'cette_annee') return { from: `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`, to: `${Number(to.slice(0, 4)) - 1}${to.slice(4)}` };
  return previousPeriod(from, to);
}
const periodProps = {
  periode: { type: 'string', enum: PERIODES, description: "Période. « cette_semaine » = depuis lundi jusqu'à aujourd'hui. « personnalisee » : utiliser du/au." },
  du: { type: 'string', description: 'Date de début AAAA-MM-JJ (période personnalisée).' },
  au: { type: 'string', description: 'Date de fin AAAA-MM-JJ, incluse (période personnalisée).' },
};

// ---------- Ventes (même journal que les tableaux de bord et rapports) ----------
function ledger(c: Ctx, from: string, to: string, pageOk: (id: string) => boolean): SaleLine[] {
  return salesLedger(from, to).filter((l) => {
    if (c.courierOnly) return false;
    return pageOk(rootOf(l.categoryId));
  });
}
function salesSummary(c: Ctx, lines: SaleLine[], from: string, to: string) {
  const k = kpis(lines);
  const out: Record<string, unknown> = {
    chiffre_affaires_net: r0(k.revenue), ventes_brutes: r0(k.sales), retours: r0(k.returns), nb_ventes: k.orders,
    sur_place: k.shopOrders, en_ligne_livraison: k.onlineOrders, panier_moyen: r0(k.avgBasket), pieces_vendues: r0(k.pieces),
  };
  if (c.can('costs.view')) Object.assign(out, { cout_des_articles: r0(k.cost), marge_brute: r0(k.gross), taux_marge_pct: Math.round(k.margin * 1000) / 10 });
  if (c.can('costs.view') && c.can('treasury.view') && !c.locked) {
    const m = moneyOut(from, to);
    Object.assign(out, { depenses: r0(m.expenses), autres_revenus: r0(m.incomes), benefice_net: r0(k.gross - m.expenses + m.incomes) });
  }
  return out;
}
const evol = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

// ---------- Définition des outils ----------
interface Tool {
  name: string; description: string;
  parameters: Record<string, unknown>;
  allowed: (c: Ctx) => boolean;
  run: (a: any, c: Ctx) => unknown | Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'ventes_resume',
    description: "Chiffre d'affaires et nombre de ventes sur une période (ventes sur place + livraisons, retours déduits, mêmes règles que le tableau de bord), avec comparaison automatique à la période précédente de même durée (ex. cette semaine vs la semaine dernière à la même date). Option : une seule page.",
    parameters: { type: 'object', properties: { ...periodProps, page: { type: 'string', description: 'Nom de la page (catégorie principale) pour filtrer, facultatif.' }, comparer: { type: 'boolean', description: 'Comparer à la période précédente (vrai par défaut).' } } },
    allowed: anyOf('dashboard.view', 'reports.view', 'orders.create', 'pos.sell'),
    run: (a, c) => {
      const p = period(a); const pf = pageFilter(c, a.page); if (pf.error) return { erreur: pf.error };
      const out: Record<string, unknown> = { periode: p, page: pf.label, ...salesSummary(c, ledger(c, p.from, p.to, pf.ok), p.from, p.to) };
      if (a.comparer !== false) {
        const q = comparePeriod(a.periode, p.from, p.to);
        const k = kpis(ledger(c, q.from, q.to, pf.ok));
        out.periode_precedente = { du: q.from, au: q.to, chiffre_affaires_net: r0(k.revenue), nb_ventes: k.orders, evolution_ca_pct: evol(out.chiffre_affaires_net as number, k.revenue), evolution_nb_ventes_pct: evol(out.nb_ventes as number, k.orders) };
      }
      if (c.locked) out.note = `Limité à vos pages : ${[...c.pages].map(pageName).join(', ')}`;
      return out;
    },
  },
  {
    name: 'ventes_detail',
    description: "Ventes d'une période réparties par : jour, page, vendeur (qui a saisi), canal (sur place / en ligne), heure, livreur, client ou zone. Pour comparer des jours, des pages ou des vendeurs.",
    parameters: { type: 'object', required: ['par'], properties: { ...periodProps, par: { type: 'string', enum: ['jour', 'page', 'vendeur', 'canal', 'heure', 'livreur', 'client', 'zone'] }, page: { type: 'string', description: 'Filtrer sur une page, facultatif.' }, limite: { type: 'integer', description: 'Nombre de lignes (défaut 31, max 62).' } } },
    allowed: anyOf('dashboard.view', 'reports.view', 'orders.create', 'pos.sell'),
    run: (a, c) => {
      const p = period(a, 'cette_semaine'); const pf = pageFilter(c, a.page); if (pf.error) return { erreur: pf.error };
      const lines = ledger(c, p.from, p.to, pf.ok);
      const lab = (fn: (k: string) => string) => (k: string) => ({ label: fn(k) });
      const by: Record<string, [(l: SaleLine) => string | undefined, (k: string) => { label: string }]> = {
        jour: [(l) => l.day, lab((k) => k)],
        page: [(l) => rootOf(l.categoryId), lab(pageName)],
        vendeur: [(l) => l.userName || '?', lab((k) => k)],
        canal: [(l) => l.channel, lab((k) => (k === 'shop' ? 'Sur place / retrait boutique' : 'En ligne (livraison)'))],
        heure: [(l) => String(l.hour).padStart(2, '0') + 'h', lab((k) => k)],
        livreur: [(l) => l.courierId || '', lab((k) => (k ? get<Courier>('couriers', k)?.name ?? '?' : 'Sans livreur (sur place / retrait)'))],
        client: [(l) => l.customerId || l.order.phone || '', lab((k) => { const cu = get<Customer>('customers', k); return cu?.name || cu?.phone || k || 'Client de passage'; })],
        zone: [(l) => l.zoneId || '', lab((k) => (k ? (get('zones', k) as any)?.name ?? '?' : 'Sans zone'))],
      };
      const sel = by[a.par]; if (!sel) return { erreur: 'paramètre « par » invalide' };
      let g = groupBy(lines, sel[0], sel[1]);
      if (a.par === 'jour' || a.par === 'heure') g = g.sort((x, y) => x.key.localeCompare(y.key));
      const lim = Math.min(62, Math.max(1, a.limite || 31));
      const costs = c.can('costs.view');
      return {
        periode: p, page: pf.label, total_ca: r0(lines.reduce((t, l) => t + l.amount, 0)),
        lignes: g.slice(0, lim).map((x) => ({ [a.par]: x.label, ca: r0(x.revenue), nb_ventes: x.orders, pieces: r0(x.qty), ...(x.returns ? { retours: r0(x.returns) } : {}), ...(costs ? { marge: r0(x.gross) } : {}) })),
        ...(g.length > lim ? { autres_lignes: g.length - lim } : {}),
      };
    },
  },
  {
    name: 'meilleurs_articles',
    description: 'Articles les plus vendus (ou les moins vendus) sur une période, par quantité ou par montant, retours déduits. Option : une seule page.',
    parameters: { type: 'object', properties: { ...periodProps, tri: { type: 'string', enum: ['quantite', 'montant'], description: 'Défaut : quantite.' }, ordre: { type: 'string', enum: ['plus_vendus', 'moins_vendus'] }, page: { type: 'string' }, limite: { type: 'integer', description: 'Défaut 10, max 30.' } } },
    allowed: anyOf('dashboard.view', 'reports.view', 'orders.create', 'pos.sell'),
    run: (a, c) => {
      const p = period(a, 'ce_mois'); const pf = pageFilter(c, a.page); if (pf.error) return { erreur: pf.error };
      const g = groupBy(ledger(c, p.from, p.to, pf.ok).filter((l) => l.productId), (l) => l.productId, (k) => { const pr = get<Product>('products', k); return { label: pr?.name ?? 'Article supprimé', sub: pr?.code }; });
      const key = a.tri === 'montant' ? 'revenue' : 'qty';
      g.sort((x, y) => (a.ordre === 'moins_vendus' ? x[key] - y[key] : y[key] - x[key]));
      const lim = Math.min(30, Math.max(1, a.limite || 10));
      const costs = c.can('costs.view');
      return {
        periode: p, page: pf.label, nb_articles_vendus: g.length,
        articles: g.slice(0, lim).map((x, i) => ({ rang: i + 1, article: x.label, code: x.sub, page: pageName(rootOf(get<Product>('products', x.key)?.categoryId)), quantite: r0(x.qty), ca: r0(x.revenue), ...(x.returnsQty ? { retours_qte: x.returnsQty } : {}), ...(costs ? { marge: r0(x.gross) } : {}), stock_actuel: productVariants(x.key).reduce((s, v) => s + stockOf(v.id), 0) })),
      };
    },
  },
  {
    name: 'stock_articles',
    description: "Stock actuel des articles (pièces en stock, seuil d'alerte, quantités en commande chez le fournisseur, prix). Filtres : recherche par nom/code, page, « alerte » (stock ≤ seuil d'alerte), « rupture » (stock ≤ 0), « bientot_rupture » (fin de stock prévue sous 14 jours au rythme des ventes des 30 derniers jours, ou stock ≤ seuil). Sans filtre : résumé du stock.",
    parameters: { type: 'object', properties: { filtre: { type: 'string', enum: ['tous', 'alerte', 'rupture', 'bientot_rupture'] }, recherche: { type: 'string', description: 'Nom, code article ou code variante (SKU).' }, page: { type: 'string' }, limite: { type: 'integer', description: 'Défaut 20, max 50.' } } },
    allowed: anyOf('catalog.view'),
    run: (a, c) => {
      const pf = pageFilter(c, a.page); if (pf.error) return { erreur: pf.error };
      const costs = c.can('costs.view');
      const cov = new Map(coverage(14).map((x) => [x.product.id, x]));
      const q = norm(a.recherche);
      const rows = all<Product>('products').filter((p) => p.active !== false && p.kind !== 'lot' && pf.ok(rootOf(p.categoryId))).filter((p) => {
        if (!q) return true;
        return norm(p.name).includes(q) || norm(p.code) === q || productVariants(p.id).some((v) => norm(v.sku) === q || norm(v.labelCode) === q);
      }).map((p) => {
        const vs = productVariants(p.id).filter((v) => v.active !== false);
        const stock = vs.reduce((s, v) => s + stockOf(v.id), 0);
        const cv = cov.get(p.id);
        return { p, vs, stock, alert: p.alertQty ?? 0, incoming: vs.reduce((s, v) => s + incomingOf(v.id), 0), cv };
      });
      const f = a.filtre || (q ? 'tous' : '');
      if (!f) {
        const sv = stockValue();
        const alerts = rows.filter((r) => r.stock <= r.alert && r.stock > 0).length;
        return { resume: { articles: rows.length, pieces_en_stock: rows.reduce((t, r) => t + Math.max(0, r.stock), 0), en_alerte: alerts, en_rupture: rows.filter((r) => r.stock <= 0).length, ...(costs && !c.locked ? { valeur_stock_cout: r0(sv.value), valeur_stock_prix_detail: r0(sv.retail) } : {}) }, conseil: 'Utiliser filtre=alerte, rupture ou bientot_rupture pour la liste.' };
      }
      let list = rows;
      if (f === 'alerte') list = rows.filter((r) => r.stock <= r.alert);
      if (f === 'rupture') list = rows.filter((r) => r.stock <= 0);
      if (f === 'bientot_rupture') list = rows.filter((r) => r.cv || (r.stock <= r.alert && r.stock > 0));
      list.sort((x, y) => (x.cv?.days ?? (x.stock <= 0 ? -1 : 999)) - (y.cv?.days ?? (y.stock <= 0 ? -1 : 999)) || x.stock - y.stock);
      const lim = Math.min(50, Math.max(1, a.limite || 20));
      return {
        filtre: f, nb: list.length,
        articles: list.slice(0, lim).map((r) => ({
          article: r.p.name, code: r.p.code, page: pageName(rootOf(r.p.categoryId)), stock: r.stock, seuil_alerte: r.alert,
          ...(r.incoming ? { en_commande: r.incoming } : {}),
          ...(r.cv ? { ventes_par_jour: Math.round(r.cv.perDay * 10) / 10, jours_restants: Math.round(r.cv.days * 10) / 10 } : {}),
          prix_detail: r.p.priceRetail, ...(r.p.priceWholesale && r.p.priceWholesale !== r.p.priceRetail ? { prix_gros: r.p.priceWholesale } : {}),
          ...(costs && r.vs[0] ? { cout_moyen: r0(variantCost(r.vs[0])) } : {}),
          ...(r.vs.length > 1 && r.vs.length <= 8 ? { variantes: r.vs.map((v) => `${[v.color, v.size].filter(Boolean).join(' ') || v.sku}: ${stockOf(v.id)}`).join(' ; ') } : {}),
        })),
        ...(list.length > lim ? { autres: list.length - lim } : {}),
      };
    },
  },
  {
    name: 'commandes',
    description: "Liste et comptage des commandes clients (livraisons et ventes sur place) : filtres période (date de saisie), statut, canal, recherche (numéro, nom, téléphone, Facebook), livreur. Statut « impayees » = reste à encaisser. Donne le nombre par statut et les commandes (max 30).",
    parameters: { type: 'object', properties: { ...periodProps, statut: { type: 'string', enum: [...Object.keys(ORDER_STATUS), 'impayees', 'tous'] }, canal: { type: 'string', enum: Object.keys(CHANNELS) }, recherche: { type: 'string' }, livreur: { type: 'string', description: 'Nom du livreur.' }, limite: { type: 'integer', description: 'Défaut 15, max 30.' } } },
    allowed: anyOf('orders.create', 'orders.prepare', 'deliveries.menu', 'courier.self', 'reports.view'),
    run: (a, c) => {
      const p = period(a, a.recherche ? 'cette_annee' : '30_derniers_jours');
      const q = norm(a.recherche);
      const cour = a.livreur ? all<Courier>('couriers').find((x) => norm(x.name).includes(norm(a.livreur))) : undefined;
      if (a.livreur && !cour) return { erreur: `livreur « ${a.livreur} » introuvable` };
      let list = all<Order>('orders').filter((o) => visibleOrder(c, o)).filter((o) => { const d = dayOf(o.createdAt); return d >= p.from && d <= p.to; });
      if (q) list = list.filter((o) => norm(o.number).includes(q) || norm(o.name).includes(q) || norm(o.facebook).includes(q) || norm(o.phone).replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'));
      if (a.canal) list = list.filter((o) => o.channel === a.canal);
      if (cour) list = list.filter((o) => o.courierId === cour.id);
      const counts: Record<string, number> = {};
      for (const o of list) { const l = ORDER_STATUS[o.status]?.label ?? o.status; counts[l] = (counts[l] ?? 0) + 1; }
      if (a.statut === 'impayees') list = list.filter((o) => !!unpaidOf(o));
      else if (a.statut && a.statut !== 'tous') list = list.filter((o) => o.status === a.statut || (a.statut === 'new' && o.status === 'confirmed'));
      list.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      const lim = Math.min(30, Math.max(1, a.limite || 15));
      return {
        periode: p, nb: list.length, par_statut: counts,
        ...(a.statut === 'impayees' ? { total_reste_a_encaisser: r0(list.reduce((t, o) => t + (unpaidOf(o)?.amount ?? 0), 0)) } : {}),
        commandes: list.slice(0, lim).map((o) => orderRow(o)),
        ...(list.length > lim ? { autres: list.length - lim } : {}),
      };
    },
  },
  {
    name: 'detail_commande',
    description: "Détail d'une commande par son numéro : client, articles, montants, paiements, statut et historique.",
    parameters: { type: 'object', required: ['numero'], properties: { numero: { type: 'string' } } },
    allowed: anyOf('orders.create', 'orders.prepare', 'deliveries.menu', 'courier.self', 'reports.view'),
    run: (a, c) => {
      const n = norm(a.numero);
      const o = all<Order>('orders').find((x) => norm(x.number) === n) ?? all<Order>('orders').find((x) => norm(x.number).endsWith(n));
      if (!o || !visibleOrder(c, o)) return { erreur: `commande « ${a.numero} » introuvable (ou pas dans vos accès)` };
      const vname = (id: string) => { const v = get<Variant>('variants', id); const p = v && get<Product>('products', v.productId); return [p?.name ?? '?', v?.color, v?.size].filter(Boolean).join(' '); };
      return {
        ...orderRow(o), telephone: o.phone, lieu: o.place, zone: o.zoneId ? (get('zones', o.zoneId) as any)?.name : undefined, frais_livraison: o.deliveryFee, remise: o.discount || undefined,
        articles: o.lines.map((l) => ({ article: vname(l.variantId), qte: l.qty, prix: l.unitPrice, ...(l.isChoice ? { en_choix: true } : {}), ...(l.qtyKept != null ? { gardes: l.qtyKept } : {}), ...(l.qtyReturned ? { rendus: l.qtyReturned } : {}) })),
        paiements: (o.payments || []).map((pm) => ({ date: when(pm.at), montant: pm.amount, moyen: PAY_METHODS[pm.method] ?? pm.method, recu_par: pm.receivedBy === 'shop' ? 'boutique' : 'livreur' })),
        deja_paye: r0(paidTotal(o)), notes: o.notes || undefined,
        historique: (o.events || []).slice(-6).map((e) => `${when(e.at)} ${e.text}${e.user ? ' (' + e.user + ')' : ''}`),
      };
    },
  },
  {
    name: 'livreurs',
    description: "Livraisons par livreur sur une période (date de départ) : colis partis, livrés, refusés, encore en livraison, montant encaissé, frais de livraison gagnés, argent à verser à la boutique.",
    parameters: { type: 'object', properties: { ...periodProps } },
    allowed: anyOf('couriers.view', 'deliveries.menu', 'courier.self'),
    run: (a, c) => {
      const p = period(a);
      const r = report(p.from, p.to);
      let rows = r.couriers;
      if (c.courierOnly || !anyOf('couriers.view', 'deliveries.menu')(c)) rows = rows.filter((x) => x.courierId === c.user.courierId);
      return {
        periode: p,
        livreurs: rows.map((x) => ({ livreur: x.name, colis: x.count, livres: x.delivered, refuses: x.refused, en_livraison: x.out, valeur_colis: r0(x.value), encaisse: r0(x.collect), frais_gagnes: r0(x.fees), deja_verse: r0(x.paidIn), reste_a_verser: r0(x.balance) })),
      };
    },
  },
  {
    name: 'depenses',
    description: "Dépenses (et autres revenus) d'une période : total, par catégorie, et les opérations (date, montant, catégorie, libellé, compte, saisi par).",
    parameters: { type: 'object', properties: { ...periodProps, categorie: { type: 'string', description: 'Filtrer sur une catégorie de dépense.' }, limite: { type: 'integer', description: 'Opérations listées (défaut 15, max 40).' } } },
    allowed: anyOf('treasury.view', 'expenses.manage'),
    run: (a, c) => {
      const p = period(a, 'ce_mois');
      const cats = new Map(all<FinanceCategory>('financeCategories').map((x) => [x.id, x.name]));
      let moves = all<CashMove>('cashMoves').filter((m) => m.type === 'expense' && dayOf(m.at) >= p.from && dayOf(m.at) <= p.to);
      if (a.categorie) moves = moves.filter((m) => norm(cats.get(m.categoryId || '')).includes(norm(a.categorie)));
      const by = new Map<string, number>();
      for (const m of moves) { const n = cats.get(m.categoryId || '') || 'Sans catégorie'; by.set(n, (by.get(n) ?? 0) - m.amount); }
      const lim = Math.min(40, Math.max(1, a.limite || 15));
      const mo = moneyOut(p.from, p.to);
      return {
        periode: p, total_depenses: r0(moves.reduce((t, m) => t - m.amount, 0)), ...(a.categorie ? {} : { autres_revenus: r0(mo.incomes) }),
        par_categorie: [...by.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ categorie: k, montant: r0(v) })),
        operations: moves.sort((x, y) => y.at.localeCompare(x.at)).slice(0, lim).map((m) => ({ date: dayOf(m.at), montant: r0(-m.amount), categorie: cats.get(m.categoryId || ''), libelle: m.label, compte: ACCOUNTS[m.account] ?? m.account, par: m.userName })),
        ...(moves.length > lim ? { autres_operations: moves.length - lim } : {}),
      };
    },
  },
  {
    name: 'tresorerie',
    description: "Soldes actuels des comptes d'argent (caisse espèces, MVola, Orange Money, Airtel Money, banque, Stripe) et entrées/sorties d'une période par compte.",
    parameters: { type: 'object', properties: { ...periodProps } },
    allowed: anyOf('treasury.view'),
    run: (a) => {
      const b = balances();
      const p = period(a);
      const r = report(p.from, p.to);
      return {
        soldes_actuels: Object.fromEntries(ACCOUNT_IDS.map((k) => [ACCOUNTS[k], r0(b[k])])), total: r0(ACCOUNT_IDS.reduce((t, k) => t + b[k], 0)),
        periode: p, recu_par_la_boutique: Object.fromEntries(ACCOUNT_IDS.filter((k) => r.receipts[k]).map((k) => [ACCOUNTS[k], r0(r.receipts[k])])),
        verse_par_les_livreurs: Object.fromEntries(ACCOUNT_IDS.filter((k) => r.fromCouriers[k]).map((k) => [ACCOUNTS[k], r0(r.fromCouriers[k])])),
        depenses: r0(r.expenses), argent_encore_chez_les_livreurs: r0(r.courierDue),
      };
    },
  },
  {
    name: 'activite_utilisateurs',
    description: "Heures de travail ESTIMÉES de chaque utilisateur par jour, d'après le journal d'activité et les saisies (il n'y a pas de pointage dans le logiciel) : première et dernière action, durée entre les deux, nombre d'actions, connexions. Option : un seul utilisateur.",
    parameters: { type: 'object', properties: { ...periodProps, utilisateur: { type: 'string', description: "Nom ou identifiant de l'utilisateur." } } },
    allowed: () => true,
    run: (a, c) => {
      const p = period(a);
      const everyone = c.can('audit.view') || c.can('users.manage');
      const users = all<User>('users').filter((u) => !u.removed);
      let target: User[] = everyone ? users : [c.user];
      if (a.utilisateur) { const n = norm(a.utilisateur); target = target.filter((u) => norm(u.fullName).includes(n) || norm(u.username) === n); if (!target.length) return { erreur: everyone ? `utilisateur « ${a.utilisateur} » introuvable` : 'vous ne pouvez voir que votre propre activité' }; }
      const ids = new Map(target.map((u) => [u.id, u]));
      const byName = new Map(target.map((u) => [u.fullName, u]));
      type Acc = { first: string; last: string; n: number; logins: number; logouts: number };
      const acc = new Map<string, Acc>();
      const add = (u: User | undefined, at: string | undefined, kind?: 'in' | 'out') => {
        if (!u || !at) return; const d = dayOf(at); if (d < p.from || d > p.to) return;
        const k = u.id + '|' + d; const x = acc.get(k) ?? { first: at, last: at, n: 0, logins: 0, logouts: 0 };
        if (at < x.first) x.first = at; if (at > x.last) x.last = at; x.n++;
        if (kind === 'in') x.logins++; if (kind === 'out') x.logouts++;
        acc.set(k, x);
      };
      for (const e of all<any>('audit')) add(ids.get(e.userId) ?? byName.get(e.userName), e.at, e.action === 'Connexion' ? 'in' : e.action === 'Déconnexion' ? 'out' : undefined);
      for (const o of all<Order>('orders')) add(ids.get(o.createdBy || '') ?? byName.get(o.createdByName || ''), o.createdAt);
      const hm = (iso: string) => when(iso)!.slice(11);
      const rows = [...acc.entries()].map(([k, x]) => {
        const [uid, d] = k.split('|'); const u = ids.get(uid)!;
        const min = Math.round((new Date(x.last).getTime() - new Date(x.first).getTime()) / 60000);
        return { jour: d, utilisateur: u.fullName, role: roleNames(u), premiere_action: hm(x.first), derniere_action: hm(x.last), duree: `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`, nb_actions: x.n, connexions: x.logins };
      }).sort((x, y) => x.jour.localeCompare(y.jour) || x.utilisateur.localeCompare(y.utilisateur, 'fr'));
      const idle = p.from === p.to ? target.filter((u) => u.active && !rows.some((r) => r.utilisateur === u.fullName)).map((u) => u.fullName) : undefined;
      return { periode: p, note: "Estimation : durée entre la première et la dernière action enregistrée de la journée (pas de pointage dans le logiciel).", lignes: rows.slice(0, 80), ...(idle?.length ? { sans_activite: idle } : {}) };
    },
  },
  {
    name: 'utilisateurs',
    description: "Liste des utilisateurs du logiciel : nom, identifiant, rôle(s), actif ou non, pages attribuées.",
    parameters: { type: 'object', properties: { inclure_inactifs: { type: 'boolean' } } },
    allowed: () => true,
    run: (a, c) => {
      const everyone = c.can('users.manage') || c.can('audit.view');
      const list = (everyone ? all<User>('users') : [c.user]).filter((u) => !u.removed && (a.inclure_inactifs || u.active));
      return { utilisateurs: list.map((u) => ({ nom: u.fullName, identifiant: u.username, role: roleNames(u), actif: u.active, ...(userPages(u).length ? { pages: userPages(u).map(pageName).join(', ') } : {}) })), ...(everyone ? {} : { note: 'Vous ne voyez que votre propre compte.' }) };
    },
  },
  {
    name: 'versements_vendeurs',
    description: "Versements des vendeurs au responsable : pour un jour, ce que chaque vendeur doit remettre (ventes, espèces, mobile money, frais livreurs, dépenses, total à remettre) et s'il l'a remis ; pour une période, les versements validés (attendu, remis, écart).",
    parameters: { type: 'object', properties: { ...periodProps } },
    allowed: anyOf('handover.receive', 'handover.self', 'treasury.view'),
    run: (a, c) => {
      const p = period(a);
      const everyone = c.can('handover.receive') || c.can('treasury.view');
      if (p.from === p.to) {
        const days = sellersOfDay(p.from, false).filter((d) => everyone || d.user.id === c.user.id);
        return { jour: p.from, vendeurs: days.map((d) => ({ vendeur: d.user.fullName, ventes: r0(d.sales), commandes: d.orders, especes: r0(d.pay.cash), mobile_money: r0(d.mobile), frais_livreurs: r0(d.fees), depenses: r0(d.expenses), a_remettre: r0(d.toPay), colis_chez_livreurs: d.outParcels, ...(d.handover && d.handover.status === 'received' ? { remis: r0(d.handover.amount), ecart: r0(d.handover.gap), recu_par: d.handover.byName } : { remis: 'pas encore' }) })) };
      }
      const list = all<Handover>('handovers').filter((h) => h.date >= p.from && h.date <= p.to && h.status === 'received' && (everyone || h.userId === c.user.id));
      return { periode: p, nb: list.length, total_remis: r0(list.reduce((t, h) => t + h.amount, 0)), total_ecarts: r0(list.reduce((t, h) => t + h.gap, 0)), versements: list.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 40).map((h) => ({ date: h.date, vendeur: h.userName, attendu: r0(h.expected), remis: r0(h.amount), ecart: r0(h.gap), recu_par: h.byName })) };
    },
  },
  {
    name: 'clients',
    description: 'Clients : meilleurs clients sur une période (montant acheté, nombre de commandes) ou recherche d’un client par nom / téléphone / Facebook.',
    parameters: { type: 'object', properties: { ...periodProps, recherche: { type: 'string' }, limite: { type: 'integer', description: 'Défaut 10, max 30.' } } },
    allowed: anyOf('orders.create', 'reports.view'),
    run: (a, c) => {
      const lim = Math.min(30, Math.max(1, a.limite || 10));
      if (a.recherche) {
        const q = norm(a.recherche); const qd = q.replace(/\D/g, '');
        const list = all<Customer>('customers').filter((cu) => norm(cu.name).includes(q) || norm(cu.facebook).includes(q) || (qd.length >= 4 && norm(cu.phone).replace(/\D/g, '').includes(qd)));
        return { clients: list.slice(0, lim).map((cu) => { const os = all<Order>('orders').filter((o) => o.customerId === cu.id && o.status !== 'cancelled' && visibleOrder(c, o)); return { nom: cu.name, telephone: cu.phone, facebook: cu.facebook, lieu: cu.place, nb_commandes: os.length, derniere_commande: dayOf(os.map((o) => o.createdAt).sort().pop()) }; }) };
      }
      const p = period(a, 'ce_mois');
      const g = groupBy(ledger(c, p.from, p.to, pageFilter(c).ok).filter((l) => !isWalkIn(l.order) || l.customerId), (l) => l.customerId || l.order.phone || '', (k) => { const cu = get<Customer>('customers', k); return { label: cu?.name || cu?.facebook || k || 'Client de passage', sub: cu?.phone }; });
      return { periode: p, clients: g.filter((x) => x.key).slice(0, lim).map((x, i) => ({ rang: i + 1, client: x.label, telephone: x.sub, montant: r0(x.revenue), commandes: x.orders })) };
    },
  },
  {
    name: 'achats_fournisseurs',
    description: 'Achats chez les fournisseurs (Chine) : commandes fournisseur avec statut (commandée, expédiée, arrivée, reçue…), quantités commandées et reçues, montant et paiements.',
    parameters: { type: 'object', properties: { statut: { type: 'string', enum: [...Object.keys(PURCHASE_STATUS), 'en_cours', 'tous'], description: 'en_cours = pas encore reçues (défaut).' }, limite: { type: 'integer' } } },
    allowed: anyOf('purchases.manage', 'purchases.receive'),
    run: (a, c) => {
      const money = c.can('purchases.manage');
      const st = a.statut || 'en_cours';
      const list = all<Purchase>('purchases').filter((p) => (st === 'tous' ? true : st === 'en_cours' ? !['received', 'cancelled'].includes(p.status) : p.status === st)).sort((x, y) => y.date.localeCompare(x.date));
      const lim = Math.min(30, Math.max(1, a.limite || 15));
      return { nb: list.length, achats: list.slice(0, lim).map((p) => ({ numero: p.number, date: p.date, fournisseur: p.supplierId ? get<Supplier>('suppliers', p.supplierId)?.name : undefined, statut: PURCHASE_STATUS[p.status]?.label ?? p.status, pieces_commandees: purchaseQty(p), pieces_recues: purchaseReceivedQty(p), ...(money ? { montant_ar: r0(purchaseTotalAr(p)), paye: `${r0(purchasePaid(p))} ${p.currency}` } : {}) })) };
    },
  },
  {
    name: 'requete_sql',
    description: "SECOURS uniquement si aucun autre outil ne convient : requête SQL en LECTURE SEULE (SELECT ou WITH) sur la vue ai.data(tbl text, id text, rev bigint, updated_at timestamptz, data jsonb). Chaque ligne = une fiche ; tbl = nom de la table (orders, products, variants, stockMoves, customers, couriers, cashMoves, users, roles, categories, handovers, purchases, audit, boosts…). Champs dans data, ex. data->>'status', (data->>'qty')::numeric, ai.ts(data->>'createdAt') pour une date. Ignorer les fiches où data->>'deleted' = 'true'. 200 lignes max, 10 s max. Attention : ne tient PAS compte des pages du vendeur ; préférer les autres outils.",
    parameters: { type: 'object', required: ['requete'], properties: { requete: { type: 'string', description: 'Requête SELECT unique, sans point-virgule.' }, objectif: { type: 'string', description: 'Ce que la requête cherche (une phrase).' } } },
    allowed: (c) => !c.locked && c.can('reports.view') && (c.can('audit.view') || c.can('users.manage')),
    run: async (a, c) => (c.sql ? runSelect(c.sql, a.requete) : { erreur: 'base indisponible' }),
  },
];

/** Commande que l'utilisateur peut voir (mêmes règles que l'écran « Commandes clients »). */
function visibleOrder(c: Ctx, o: Order) {
  if (c.courierOnly) return !!c.user.courierId && o.courierId === c.user.courierId;
  if (!c.locked) return true;
  for (const p of orderPagesOf(o)) if (c.pages.has(p)) return true;
  return isMine(o, c.user);
}
function orderRow(o: Order) {
  const un = unpaidOf(o);
  return {
    numero: o.number, date: when(o.createdAt), client: o.name || o.facebook || o.phone || (isWalkIn(o) ? 'Client de passage' : '?'),
    statut: ORDER_STATUS[o.status]?.label ?? o.status, canal: (CHANNELS as any)[o.channel] ?? o.channel, montant: r0(orderTotal(o)),
    ...(un ? { reste_a_encaisser: r0(un.amount), ou: un.why === 'out' ? 'colis en livraison' : un.why === 'courier' ? 'argent chez le livreur' : 'client doit encore' } : {}),
    ...(o.courierId ? { livreur: get<Courier>('couriers', o.courierId)?.name } : {}),
    vendeur: o.createdByName,
  };
}

// ---------- Accès pour la fonction cloud ----------
export function toolsFor(c: Ctx) {
  return TOOLS.filter((t) => t.allowed(c)).map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
export const TOOL_LABELS: Record<string, string> = {
  ventes_resume: 'Calcul des ventes', ventes_detail: 'Détail des ventes', meilleurs_articles: 'Articles les plus vendus', stock_articles: 'Lecture du stock',
  commandes: 'Recherche des commandes', detail_commande: 'Lecture de la commande', livreurs: 'Comptes des livreurs', depenses: 'Lecture des dépenses',
  tresorerie: 'Lecture de la trésorerie', activite_utilisateurs: 'Lecture du journal d’activité', utilisateurs: 'Liste des utilisateurs',
  versements_vendeurs: 'Versements des vendeurs', clients: 'Recherche des clients', achats_fournisseurs: 'Achats fournisseurs', requete_sql: 'Requête en lecture seule',
};
/** Résultat d'outil au plus ≈ 1 000 tokens : réponses rapides (limite de 150 s de la fonction cloud). */
const MAX_RESULT = 3500;
/** Exécute un appel d'outil : vérifie le droit, lance, renvoie un JSON compact (tronqué si trop gros). */
export async function runTool(c: Ctx, name: string, rawArgs: string): Promise<string> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return JSON.stringify({ erreur: `outil inconnu : ${name}` });
  if (!t.allowed(c)) return JSON.stringify({ erreur: "accès refusé : l'utilisateur n'a pas le droit de voir ces données dans le logiciel" });
  let args: any = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return JSON.stringify({ erreur: 'arguments JSON invalides' }); }
  memSetMeta('session', { userId: c.user.id, at: new Date().toISOString() });
  let res: unknown;
  try { res = await t.run(args ?? {}, c); } catch (e: any) { res = { erreur: `échec du calcul : ${String(e?.message ?? e).slice(0, 200)}` }; }
  let s = JSON.stringify(res, (_k, v) => (v === undefined || v === null || v === '' ? undefined : v));
  if (s.length > MAX_RESULT) s = s.slice(0, MAX_RESULT) + '… [résultat tronqué : demander moins de lignes]';
  return s;
}
export const allToolNames = () => TOOLS.map((t) => t.name);
export const toolDocs = () => TOOLS.map((t) => ({ name: t.name, description: t.description }));
