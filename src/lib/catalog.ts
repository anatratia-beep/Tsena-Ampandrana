// Articles, variantes (couleur/taille), mouvements de stock, coût moyen, quantités en arrivage.
import { useMemo } from 'react';
import { all, get, getMeta, newId, nowIso, save, useTable, type BaseRecord , bizNow, workDate } from './db';
import { audit, currentUser } from './auth';

/** Valeur d'une variante de catégorie (ex. « B22 (baïonnette) », code court « B22 »). */
export interface AttrValue { id: string; label: string; code: string; active?: boolean }
/** Variante définie au niveau de la catégorie (ex. Modèle, Type, Puissance, Taille…). */
export interface CatAttr { id: string; name: string; required?: boolean; active?: boolean; values: AttrValue[] }
/** Catégorie = page Facebook. Elle porte ses variantes (sans limite) et un code court (ex. LAMP). */
export interface Category extends BaseRecord {
  name: string; parentId?: string; order?: number; code?: string; attrs?: CatAttr[];
  /** Page (catégorie principale) : ce qui figure en tête des tickets de ses ventes. */
  logo?: string; ticketName?: string; slogan?: string; phone?: string; ticketFooter?: string;
  /** Page supprimée (rangée de côté, restaurable) : cachée des listes, l'historique garde son nom. */
  removed?: boolean; removedAt?: string; removedBy?: string;
}
export interface Product extends BaseRecord {
  code: string;
  name: string;
  categoryId?: string;
  photo?: string;
  priceRetail?: number;
  priceWholesale?: number;
  alertQty?: number;
  link?: string;
  notes?: string;
  active: boolean;
  /** Article rangé avec sa page supprimée (remis en vente si la page est restaurée). */
  removedWithPage?: string;
  /** Valeurs choisies pour les variantes de la catégorie : id de la variante → id de la valeur. */
  attrs?: Record<string, string>;
  /** Lot ou promotion : article sans stock propre qui regroupe d'autres articles (voir lots.ts). */
  kind?: 'lot';
  lot?: import('./lots').LotDef;
  /** Prix par quantité (ex. 3 pièces pour 50 000 Ar). */
  tiers?: import('./lots').PriceTier[];
}
export interface Variant extends BaseRecord {
  productId: string;
  sku: string;
  color?: string;
  size?: string;
  costAvg?: number;
  photo?: string;         // photo propre à la couleur (sinon celle de l'article)
  priceRetail?: number;   // si différent du prix de l'article
  priceWholesale?: number;
  active: boolean;
}
export type MoveType = 'initial' | 'reception' | 'sale' | 'return' | 'adjust' | 'inventory' | 'dispatch' | 'delivery_return' | 'exchange_in';
export interface StockMove extends BaseRecord {
  variantId: string;
  qty: number;          // + entrée, − sortie
  type: MoveType;
  unitCost?: number;
  refType?: string;
  refId?: string;
  reason?: string;
  at: string;
  userId?: string;
  userName?: string;
}

export const MOVE_LABELS: Record<MoveType, string> = {
  initial: 'Stock initial', reception: 'Réception', sale: 'Vente', return: 'Retour client', adjust: 'Ajustement', inventory: 'Inventaire',
  dispatch: 'Sortie livraison', delivery_return: 'Retour de livraison', exchange_in: 'Retour échange',
};
export const ADJUST_REASONS = ['Correction de saisie', 'Casse / abîmé', 'Perte', 'Vol', 'Cadeau / échantillon', 'Usage interne', 'Retour fournisseur', 'Autre'];

// ---------- Formats ----------
export const fmtAr = (n?: number | null) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' Ar');
export const fmtNum = (n?: number | null, d = 0) => (n == null || isNaN(n) ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: d }));
/**
 * Montant en Ariary (pas de centimes) : accepte « 20000 », « 20 000 », « 20.000 », « 20,000 », « 20 000 Ar ».
 * Évite qu'un paiement saisi avec des séparateurs soit ignoré.
 */
export const parseAr = (s: string | number | null | undefined): number | undefined => {
  if (s == null) return undefined;
  if (typeof s === 'number') return isNaN(s) ? undefined : Math.round(s);
  const t = s.replace(/ar\b/i, '').trim();
  const digits = t.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return (t.startsWith('-') ? -1 : 1) * Number(digits);
};
export const parseNum = (s: string | number | null | undefined): number | undefined => {
  if (s == null) return undefined;
  if (typeof s === 'number') return isNaN(s) ? undefined : s;
  const t = s.replace(/\s/g, '').replace(/ /g, '').replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return isNaN(n) ? undefined : n;
};

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
export function sizeRank(s?: string) {
  if (!s) return 999;
  const u = s.toUpperCase().replace('XXXL', '3XL').replace('XXL', '2XL');
  const i = SIZE_ORDER.indexOf(u);
  if (i >= 0) return i;
  const n = /^T?(\d+)/.exec(u);
  return n ? 100 + parseInt(n[1], 10) : 500;
}
export function normSize(s?: string) {
  if (!s) return '';
  const u = s.trim().toUpperCase();
  return u === 'XXL' ? '2XL' : u === 'XXXL' ? '3XL' : u === 'XXXXL' ? '4XL' : u;
}
export function variantLabel(v?: Variant) {
  if (!v) return '';
  const cs = [v.color, v.size].filter(Boolean).join(' · ');
  if (cs) return cs;
  const p = get<Product>('products', v.productId);
  return (p?.attrs && attrSummary(p)) || 'Unique';
}

// ---------- Index calculés (mis en cache tant que les données ne changent pas) ----------
function memoBy<T>(fn: () => T, deps: () => unknown[]) {
  let last: unknown[] | null = null;
  let val: T;
  return () => {
    const d = deps();
    if (!last || d.some((x, i) => x !== last![i])) { val = fn(); last = d; }
    return val;
  };
}

export const stockIndex = memoBy(() => {
  const m = new Map<string, number>();
  for (const mv of all<StockMove>('stockMoves')) m.set(mv.variantId, (m.get(mv.variantId) ?? 0) + mv.qty);
  return m;
}, () => [all('stockMoves')]);

export interface PurchaseLine { id: string; variantId: string; qtyOrdered: number; qtyReceived: number; unitPrice: number }
export interface Purchase extends BaseRecord {
  number: string;
  supplierId?: string;
  orderRef?: string;
  trackingNo?: string;
  link?: string;
  date: string;
  currency: 'RMB' | 'MGA';
  rate: number;
  chinaFees: number;
  discount: number;
  status: PurchaseStatus;
  statusDates?: Partial<Record<PurchaseStatus, string>>;
  lines: PurchaseLine[];
  payments: { id: string; date: string; amount: number; currency: 'RMB' | 'MGA'; method: string; note?: string }[];
  forwarder?: string;
  notes?: string;
}
export type PurchaseStatus = 'ordered' | 'shipped' | 'arrived' | 'partial' | 'received' | 'cancelled';
export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'ok' | 'danger' }> = {
  ordered: { label: 'Commandée', tone: 'neutral' },
  shipped: { label: 'Expédiée de Chine', tone: 'brand' },
  arrived: { label: 'Arrivée à Madagascar', tone: 'warn' },
  partial: { label: 'Reçue en partie', tone: 'warn' },
  received: { label: 'Reçue', tone: 'ok' },
  cancelled: { label: 'Annulée', tone: 'danger' },
};

/** Quantités commandées et pas encore reçues, par variante. */
export const incomingIndex = memoBy(() => {
  const m = new Map<string, number>();
  for (const p of all<Purchase>('purchases')) {
    if (p.status === 'received' || p.status === 'cancelled') continue;
    for (const l of p.lines) {
      const rest = l.qtyOrdered - (l.qtyReceived || 0);
      if (rest > 0) m.set(l.variantId, (m.get(l.variantId) ?? 0) + rest);
    }
  }
  return m;
}, () => [all('purchases')]);

export const variantsByProduct = memoBy(() => {
  const m = new Map<string, Variant[]>();
  for (const v of all<Variant>('variants')) {
    if (!m.has(v.productId)) m.set(v.productId, []);
    m.get(v.productId)!.push(v);
  }
  for (const list of m.values()) list.sort((a, b) => (a.color || '').localeCompare(b.color || '') || sizeRank(a.size) - sizeRank(b.size) || a.sku.localeCompare(b.sku));
  return m;
}, () => [all('variants')]);

export const stockOf = (variantId: string) => stockIndex().get(variantId) ?? 0;
export const incomingOf = (variantId: string) => incomingIndex().get(variantId) ?? 0;
export const productVariants = (productId: string) => variantsByProduct().get(productId) ?? [];
export function productStock(productId: string) {
  return productVariants(productId).reduce((s, v) => s + stockOf(v.id), 0);
}
export function productIncoming(productId: string) {
  return productVariants(productId).reduce((s, v) => s + incomingOf(v.id), 0);
}
export function variantCost(v: Variant) { return v.costAvg ?? 0; }
/** Photo d'une variante : celle de sa couleur si elle en a une, sinon celle de l'article. */
export function photoOf(v?: Variant) {
  if (!v) return undefined;
  if (v.photo) return v.photo;
  // La photo d'une couleur n'est enregistrée qu'une fois (sur une de ses tailles) : on la partage.
  const c = (v.color || '').toLowerCase();
  const sib = c ? productVariants(v.productId).find((x) => x.photo && (x.color || '').toLowerCase() === c) : undefined;
  return sib?.photo || get<Product>('products', v.productId)?.photo;
}
export function variantPrice(v: Variant, p?: Product) { return v.priceRetail ?? p?.priceRetail; }
export function variantWholesale(v: Variant, p?: Product) { return v.priceWholesale ?? p?.priceWholesale; }

/** Hook : rafraîchit le composant quand le catalogue ou le stock change. */
export function useCatalog() {
  const products = useTable<Product>('products');
  const variants = useTable<Variant>('variants');
  const moves = useTable<StockMove>('stockMoves');
  const categories = useTable<Category>('categories');
  const purchases = useTable<Purchase>('purchases');
  return useMemo(() => ({ products, variants, moves, categories, purchases }), [products, variants, moves, categories, purchases]);
}

export function categoryPath(id?: string): string {
  if (!id) return 'Sans catégorie';
  const c = get<Category>('categories', id);
  if (!c) return 'Sans catégorie';
  return c.parentId ? `${categoryPath(c.parentId)} › ${c.name}` : c.name;
}

// ---------- Écritures ----------
export async function addMoves(moves: Omit<StockMove, 'id' | 'createdAt' | 'updatedAt' | 'at'> & { at?: string } | (Omit<StockMove, 'id' | 'createdAt' | 'updatedAt' | 'at'> & { at?: string })[]) {
  const u = currentUser();
  const list = (Array.isArray(moves) ? moves : [moves]).filter((m) => m.qty !== 0 && !!m.variantId);
  if (!list.length) return [];
  return save('stockMoves', list.map((m) => ({ ...m, at: m.at ?? bizNow(), userId: u?.id, userName: u?.fullName })));
}

/** Entrée en stock avec mise à jour du coût moyen pondéré. */
export async function receiveIntoStock(entries: { variantId: string; qty: number; unitCost: number }[], ref: { refType: string; refId: string; at?: string }) {
  const updates: Partial<Variant>[] = [];
  for (const e of entries) {
    if (e.qty <= 0) continue;
    const v = get<Variant>('variants', e.variantId);
    if (!v) continue;
    const before = Math.max(0, stockOf(v.id));
    const old = v.costAvg ?? e.unitCost;
    const avg = before + e.qty > 0 ? (before * old + e.qty * e.unitCost) / (before + e.qty) : e.unitCost;
    updates.push({ id: v.id, costAvg: Math.round(avg * 100) / 100 });
  }
  await addMoves(entries.filter((e) => e.qty > 0).map((e) => ({ variantId: e.variantId, qty: e.qty, type: 'reception' as const, unitCost: e.unitCost, refType: ref.refType, refId: ref.refId, at: ref.at })));
  if (updates.length) await save('variants', updates);
}

/** Trouve ou crée une catégorie par son nom (et sa catégorie parente). */
export async function ensureCategory(name: string, parentId?: string): Promise<string> {
  const clean = name.trim();
  const found = all<Category>('categories').find((c) => c.name.toLowerCase() === clean.toLowerCase() && (c.parentId || undefined) === (parentId || undefined));
  if (found) { if (found.removed) await save('categories', { id: found.id, removed: false }); return found.id; }
  // Identifiant tiré du nom : la même catégorie créée sur deux appareils hors ligne ne fait qu'une.
  const slug = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [c] = await save('categories', { id: `cat_${parentId ? parentId.slice(0, 12) + '_' : ''}${slug(clean) || 'x'}`, name: clean, parentId });
  return c.id;
}

export function findProductByCode(code: string) {
  const n = code.trim().toUpperCase().replace(/\s+/g, '');
  return all<Product>('products').find((p) => p.code.toUpperCase().replace(/\s+/g, '') === n);
}
export function findVariantBySku(sku: string) {
  const n = sku.trim().toUpperCase().replace(/\s+/g, '');
  return all<Variant>('variants').find((v) => v.sku.toUpperCase().replace(/\s+/g, '') === n);
}
export function makeSku(code: string, color?: string, size?: string) {
  return [code, color, size].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Crée un article et ses variantes (couleurs × tailles). */
export async function createProduct(data: Partial<Product> & { code: string; name: string }, combos: { color?: string; size?: string }[]) {
  const [p] = await save('products', { active: true, ...data });
  const list = combos.length ? combos : [{}];
  await save('variants', list.map((c) => ({ productId: p.id, sku: makeSku(data.code, c.color, c.size), color: c.color || undefined, size: normSize(c.size) || undefined, active: true })));
  await audit('Article créé', `${data.code} — ${data.name}`, 'products', p.id);
  return p as Product;
}

/**
 * Prochain numéro (C-0012, V-0005…). Quand l'appareil est relié au cloud, le numéro porte la lettre de
 * l'appareil (C-A0012 sur l'appareil A, C-B0012 sur l'appareil B) : deux vendeurs hors ligne ne peuvent
 * jamais créer le même numéro.
 */
export function nextNumber(prefix: string, table: 'purchases' | 'receptions' | 'orders') {
  const code = getMeta<string>('deviceCode', '');
  const re = new RegExp(`^${prefix}-${code}(\\d+)$`);
  const nums = all(table).map((r: any) => re.exec(String(r.number || ''))).filter(Boolean).map((m) => parseInt(m![1], 10));
  return `${prefix}-${code}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

export const todayYmd = () => {
  const wd = workDate();
  if (wd) return wd;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { newId };

// ---------- Recherche (sans accents, tous les mots) ----------
export const normText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Vrai si tous les mots de la recherche se trouvent dans le texte (accents et majuscules ignorés). */
export function matchQuery(text: string, q: string) {
  // Numéro tapé avec ou sans espaces (« 034 12 » = « 03412 », « +261 34… » = « 034… ») : comparé chiffres contre chiffres.
  const raw = q.trim();
  if (/^[+\d\s.-]+$/.test(raw) && raw.replace(/\D/g, '').length >= 3) {
    let d = raw.replace(/\D/g, ''); if (d.startsWith('261')) d = '0' + d.slice(3);
    const td = text.replace(/[\s.-]/g, '');
    if (td.includes(d) || (d.startsWith('0') && td.includes(d.slice(1)))) return true;
  }
  const words = normText(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = normText(text);
  return words.every((w) => t.includes(w));
}
/**
 * Correspondance exacte : chaque mot cherché est un mot entier du texte (« PH6 » trouve « PH6 », « LAMP-PH6-B22 »,
 * mais pas « PH60 » ni « PH61 »). Les mots de lettres seules (« lampe ») restent cherchés en début de mot.
 */
export function matchExact(text: string, q: string) {
  const words = normText(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = normText(text);
  return words.every((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /\d/.test(w) ? new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(t) : new RegExp(`(^|[^a-z0-9])${esc}`).test(t);
  });
}
/**
 * Recherche avec priorité aux résultats exacts : si des éléments correspondent exactement (« PH6 »), seuls eux sont
 * gardés ; les résultats approchants (« PH60 », « PH61 »…) sont comptés dans `others`, à afficher sur demande.
 */
export function searchItems<T>(items: T[], textOf: (x: T) => string, q: string, showOthers = false): { list: T[]; others: number } {
  if (!q.trim()) return { list: items, others: 0 };
  const loose = items.filter((x) => matchQuery(textOf(x), q));
  const exact = loose.filter((x) => matchExact(textOf(x), q));
  if (!exact.length || exact.length === loose.length) return { list: loose, others: 0 };
  return showOthers ? { list: [...exact, ...loose.filter((x) => !exact.includes(x))], others: 0 } : { list: exact, others: loose.length - exact.length };
}

/** Texte de recherche d'un article : code, nom, valeurs des variantes (libellés et codes), codes des variantes. */
export function productText(p: Product) {
  const parts = [p.code, p.name];
  const cats: Category[] = [];
  let c = p.categoryId ? get<Category>('categories', p.categoryId) : undefined;
  while (c) { cats.push(c); c = c.parentId ? get<Category>('categories', c.parentId) : undefined; }
  parts.push(...cats.map((x) => x.name));
  for (const [aid, vid] of Object.entries(p.attrs ?? {})) {
    for (const k of cats) { const v = k.attrs?.find((a) => a.id === aid)?.values.find((x) => x.id === vid); if (v) { parts.push(v.label, v.code); break; } }
  }
  for (const v of productVariants(p.id)) parts.push(v.sku, v.color || '', v.size || '');
  return parts.join(' ');
}

/** Catégorie (ou catégorie parente) qui porte les variantes d'un article. */
export function attrCategory(categoryId?: string): Category | undefined {
  let c = categoryId ? get<Category>('categories', categoryId) : undefined;
  while (c) { if (c.attrs?.length) return c; c = c.parentId ? get<Category>('categories', c.parentId) : undefined; }
  return undefined;
}
/** Libellés complets des valeurs d'un article : « LP1 (simple batterie) · B22 (baïonnette) · 7 W ». */
export function attrSummary(p: Product, sep = ' · ') {
  const c = attrCategory(p.categoryId);
  if (!c || !p.attrs) return '';
  return (c.attrs ?? []).map((a) => a.values.find((x) => x.id === p.attrs![a.id])?.label).filter(Boolean).join(sep);
}

/** Où un article est utilisé (ventes, commandes, achats, réceptions) : s'il l'est, on ne peut que l'archiver. */
export function articleUsage(productId: string) {
  const vids = new Set(all<Variant>('variants').filter((v) => v.productId === productId).map((v) => v.id));
  const orders = all<any>('orders').filter((o) => (o.lines || []).some((l: any) => vids.has(l.variantId) || l.lotProductId === productId) || (o.returnLines || []).some((l: any) => vids.has(l.variantId))).length;
  const purchases = all<Purchase>('purchases').filter((p) => p.lines.some((l) => vids.has(l.variantId))).length;
  const receptions = all<any>('receptions').filter((r) => (r.items || []).some((i: any) => vids.has(i.variantId))).length;
  const moves = all<StockMove>('stockMoves').filter((m) => vids.has(m.variantId)).length;
  return { orders, purchases, receptions, moves, used: orders + purchases + receptions > 0 };
}
/** Supprime un article jamais vendu ni acheté (ex. article de test), avec sa ligne de stock et ses mouvements de départ. */
export async function deleteArticle(p: Product) {
  const u = articleUsage(p.id);
  if (u.used) throw new Error(`Cet article est utilisé (${[u.orders && `${u.orders} vente(s)/commande(s)`, u.purchases && `${u.purchases} achat(s)`, u.receptions && `${u.receptions} réception(s)`].filter(Boolean).join(', ')}) : vous pouvez seulement l’archiver.`);
  const vs = all<Variant>('variants').filter((v) => v.productId === p.id);
  const vids = new Set(vs.map((v) => v.id));
  const moves = all<StockMove>('stockMoves').filter((m) => vids.has(m.variantId));
  if (moves.length) await save('stockMoves', moves.map((m) => ({ id: m.id, deleted: true })));
  if (vs.length) await save('variants', vs.map((v) => ({ id: v.id, deleted: true })));
  await save('products', { id: p.id, deleted: true });
  await audit('Article supprimé', `${p.code} — ${p.name}${moves.length ? ` (${moves.length} mouvement(s) de stock de départ effacés)` : ''}`, 'products', p.id);
}
/** Recrée la ligne de stock d'un article par variantes (si elle a été supprimée). */
export async function repairArticle(p: Product) {
  await save('variants', { id: `v_${p.id}`, productId: p.id, sku: p.code, active: true, deleted: false });
  await audit('Article réparé', `${p.code} — ligne de stock rétablie`, 'products', p.id);
}
/** Variante utilisée dans une commande, une vente ou un achat. */
export function variantUsed(variantId: string) {
  return all<any>('orders').some((o) => (o.lines || []).some((l: any) => l.variantId === variantId) || (o.returnLines || []).some((l: any) => l.variantId === variantId))
    || all<Purchase>('purchases').some((p) => p.lines.some((l) => l.variantId === variantId));
}
