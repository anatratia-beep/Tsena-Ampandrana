// Pages (catégories) et leurs variantes libres, articles = une combinaison de valeurs, modèle Excel par catégorie.
//
// Une catégorie (= une page Facebook) porte autant de variantes que nécessaire (Modèle, Type, Puissance, Taille…),
// chacune avec ses valeurs : libellé complet (« B22 (baïonnette) ») et code court (« B22 »).
// Un article = une valeur par variante. Son nom se forme avec les codes (« LP1 B22 7W »), son code avec le code de
// la page devant (« LAMP-LP1-B22-7W »). Son identifiant est tiré de la combinaison : le même article créé sur deux
// appareils hors ligne ne fait qu'un.
import { all, get, save } from './db';
import { audit } from './auth';
import { pointBefore } from './restorePoints';
import {
  addMoves, attrCategory, normText, productVariants, stockOf,
  type AttrValue, type CatAttr, type Category, type Product, type Variant,
} from './catalog';
import { colLetter, normHeader, writeXlsx, type Cell, type OutSheet, type Sheet } from './xlsx';

export const shortId = () => Math.random().toString(36).slice(2, 7);
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Code court proposé pour une page : 4 premières lettres (« Lampe rechargeable » → LAMP). */
export function suggestCatCode(name: string) {
  const w = strip(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return 'ART';
  if (w.length === 1) return w[0].slice(0, 4);
  return (w[0].slice(0, 3) + w.slice(1).map((x) => x[0]).join('')).slice(0, 5);
}

/**
 * Code court proposé pour une valeur, qui garde un sens :
 * « LP1 (simple batterie) » → LP1 · « 7 W » / « 7 watts » → 7W · « 2 ans » → 2A · « Bleu marine » → BLM · « Rouge » → ROU.
 */
export function suggestCode(label: string, taken: string[] = []) {
  const clean = strip(label).replace(/\(.*?\)/g, ' ').replace(/[—–-].*$/, ' ').trim();
  const up = clean.toUpperCase();
  let code = '';
  const num = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]{1,6})?\b/.exec(clean);
  const first = up.split(/\s+/)[0] ?? '';
  if (num) {
    const unit = (num[2] || '').toUpperCase();
    const u = unit.startsWith('WATT') ? 'W' : unit.startsWith('AN') ? 'A' : unit.startsWith('MOIS') ? 'M' : unit.startsWith('LITRE') ? 'L' : unit.slice(0, 2);
    code = num[1].replace(',', '.') + u;
  } else if (/\d/.test(first) || (first.length <= 4 && /^[A-Z0-9]+$/.test(first) && first === strip(clean.split(/\s+/)[0] ?? ''))) {
    code = first;
  } else {
    const w = up.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    code = w.length > 1 ? (w[0].slice(0, 2) + w.slice(1).map((x) => x[0]).join('')).slice(0, 4) : (w[0] ?? 'X').slice(0, 3);
  }
  code = code.replace(/[^A-Z0-9.]/gi, '').toUpperCase() || 'X';
  let out = code, i = 2;
  const set = new Set(taken.map((t) => t.toUpperCase()));
  while (set.has(out)) out = `${code}${i++}`;
  return out;
}

/** Modèles de variantes proposés à la création d'une page (on garde ce qu'on veut, tout reste modifiable). */
export const ATTR_PRESETS: { key: string; label: string; attrs: { name: string; values: string[] }[] }[] = [
  { key: 'vet', label: 'Vêtements', attrs: [{ name: 'Modèle', values: [] }, { name: 'Taille', values: ['S', 'M', 'L', 'XL', '2XL', '3XL'] }, { name: 'Couleur', values: ['Noir', 'Blanc', 'Rouge', 'Bleu'] }] },
  { key: 'enf', label: 'Vêtements enfant', attrs: [{ name: 'Modèle', values: [] }, { name: 'Âge', values: ['2 ans', '4 ans', '6 ans', '8 ans', '10 ans', '12 ans'] }, { name: 'Couleur', values: [] }] },
  { key: 'cha', label: 'Chaussures', attrs: [{ name: 'Modèle', values: [] }, { name: 'Pointure', values: ['36', '37', '38', '39', '40', '41', '42', '43', '44'] }, { name: 'Couleur', values: [] }] },
  { key: 'ele', label: 'Électrique / lampes', attrs: [{ name: 'Modèle', values: [] }, { name: 'Type', values: ['E27 (à vis)', 'B22 (baïonnette)'] }, { name: 'Puissance', values: ['7 W', '12 W', '20 W', '30 W'] }] },
  { key: 'acc', label: 'Accessoires / bijoux', attrs: [{ name: 'Modèle', values: [] }, { name: 'Couleur', values: [] }, { name: 'Matière', values: [] }] },
  { key: 'vide', label: 'Vide (je crée tout)', attrs: [] },
];
/** Variantes courantes proposées en un clic dans l'éditeur. */
export const ATTR_SUGGESTIONS = ['Modèle', 'Type', 'Taille', 'Couleur', 'Âge', 'Pointure', 'Puissance', 'Matière', 'Contenance', 'Motif', 'Saison', 'Lot'];

export function makeAttr(name: string, labels: string[] = []): CatAttr {
  const values: AttrValue[] = [];
  for (const l of labels) values.push({ id: shortId(), label: l, code: suggestCode(l, values.map((v) => v.code)) });
  return { id: shortId(), name, required: true, active: true, values };
}

export const activeAttrs = (c?: Category) => (c?.attrs ?? []).filter((a) => a.active !== false);
export const activeValues = (a: CatAttr) => a.values.filter((v) => v.active !== false);
export type Selection = Record<string, string>; // id variante → id valeur

/** Nombre d'articles qui utilisent une valeur (ou une variante, si valueId est omis). */
export function usageOf(catId: string, attrId: string, valueId?: string) {
  return all<Product>('products').filter((p) => p.categoryId === catId && p.attrs && (valueId ? p.attrs[attrId] === valueId : p.attrs[attrId])).length;
}

/** Nom, code et libellé complet d'un article à partir des valeurs choisies. */
export function articleParts(cat: Category, sel: Selection) {
  const parts: { attr: CatAttr; value?: AttrValue }[] = (cat.attrs ?? []).filter((a) => a.active !== false || sel[a.id]).map((a) => ({ attr: a, value: a.values.find((v) => v.id === sel[a.id]) }));
  const chosen = parts.filter((p) => p.value);
  const missing = parts.filter((p) => !p.value && p.attr.required !== false && p.attr.active !== false).map((p) => p.attr.name);
  const name = chosen.map((p) => p.value!.code).join(' ');
  const code = [cat.code || suggestCatCode(cat.name), ...chosen.map((p) => p.value!.code)].join('-');
  const label = chosen.map((p) => p.value!.label).join(', ');
  return { name, code, label, missing };
}

const hash = (s: string) => { let h = 5381; for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36); };
/** Identifiant fixe de l'article pour une combinaison (identique sur tous les appareils). */
export function articleId(catId: string, sel: Selection) {
  const key = Object.keys(sel).sort().map((k) => `${k}=${sel[k]}`).join('&');
  return `art_${hash(catId)}_${hash(key)}${key.length.toString(36)}`;
}
export function findArticle(catId: string, sel: Selection): Product | undefined {
  const byId = get<Product>('products', articleId(catId, sel));
  if (byId) return byId;
  const keys = Object.keys(sel).filter((k) => sel[k]);
  return all<Product>('products').find((p) => p.categoryId === catId && p.attrs && keys.length === Object.keys(p.attrs).filter((k) => p.attrs![k]).length && keys.every((k) => p.attrs![k] === sel[k]));
}

/** Toutes les combinaisons des valeurs cochées (une liste de valeurs par variante ; une variante facultative peut rester vide). */
export function combinations(cat: Category, picked: Record<string, string[]>): Selection[] {
  let out: Selection[] = [{}];
  for (const a of activeAttrs(cat)) {
    const vals = picked[a.id] ?? [];
    if (!vals.length) { if (a.required !== false) return []; continue; }
    out = out.flatMap((s) => vals.map((v) => ({ ...s, [a.id]: v })));
  }
  return out;
}

export interface ArticleInput { sel: Selection; name?: string; cost?: number; retail?: number; wholesale?: number; stock?: number; alertQty?: number; photo?: string }

/**
 * Crée ou met à jour des articles d'une page. Nouvel article : article + sa ligne de stock + stock de départ.
 * Article existant : prix et coût mis à jour ; si un stock est donné, le stock est remis à cette quantité (inventaire).
 */
export async function saveArticles(cat: Category, rows: ArticleInput[], reason = 'Saisie') {
  if (reason.startsWith('Import')) await pointBefore(`import Excel (${cat.name})`);
  let created = 0, updated = 0;
  const products: Partial<Product>[] = [];
  const variants: Partial<Variant>[] = [];
  const moves: { variantId: string; qty: number; type: 'initial' | 'inventory'; unitCost?: number; reason: string }[] = [];
  for (const r of rows) {
    const parts = articleParts(cat, r.sel);
    const existing = findArticle(cat.id, r.sel);
    if (existing) {
      const v = productVariants(existing.id)[0];
      products.push({ id: existing.id, ...(r.retail != null ? { priceRetail: r.retail } : {}), ...(r.wholesale != null ? { priceWholesale: r.wholesale } : {}), ...(r.alertQty != null ? { alertQty: r.alertQty } : {}), ...(r.name ? { name: r.name } : {}), ...(r.photo ? { photo: r.photo } : {}), active: true });
      if (v) {
        if (r.cost != null) variants.push({ id: v.id, costAvg: r.cost });
        if (r.stock != null) { const d = r.stock - stockOf(v.id); if (d) moves.push({ variantId: v.id, qty: d, type: 'inventory', unitCost: r.cost ?? v.costAvg, reason: `${reason} : stock remis à ${r.stock}` }); }
      }
      updated++;
    } else {
      const id = articleId(cat.id, r.sel);
      const vid = `v_${id}`;
      products.push({ id, code: parts.code, name: r.name?.trim() || parts.name, categoryId: cat.id, attrs: r.sel, priceRetail: r.retail, priceWholesale: r.wholesale ?? r.retail, alertQty: r.alertQty ?? 3, photo: r.photo, active: true });
      variants.push({ id: vid, productId: id, sku: parts.code, costAvg: r.cost, active: true });
      if (r.stock) moves.push({ variantId: vid, qty: r.stock, type: 'initial', unitCost: r.cost, reason: `${reason} : stock de départ` });
      created++;
    }
  }
  if (products.length) await save('products', products);
  if (variants.length) await save('variants', variants);
  if (moves.length) await addMoves(moves);
  await audit('Articles', `${cat.name} : ${created} article(s) créé(s), ${updated} mis à jour (${reason})`, 'categories', cat.id);
  return { created, updated };
}

// ---------- Modèle Excel par page ----------
const MARK = 'tsena-categorie:';
export const FIXED = ['Nom de l’article (facultatif)', 'Prix de revient (Ar)', 'PV détail (Ar)', 'PV gros (Ar)', 'Stock', 'Alerte stock bas'];
export const PHOTO_COL = 'Photo (image collée dans la ligne, facultatif)';

/** Fichier Excel propre à une page : une colonne par variante (liste déroulante), puis prix et stock. Les articles existants sont déjà remplis. */
export async function categoryTemplate(cat: Category) {
  const attrs = activeAttrs(cat);
  const arts = all<Product>('products').filter((p) => p.categoryId === cat.id && p.attrs && p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const rows: Cell[][] = arts.map((p) => {
    const v = productVariants(p.id)[0];
    return [...attrs.map((a) => a.values.find((x) => x.id === p.attrs![a.id])?.label ?? ''), p.name, v?.costAvg ?? null, p.priceRetail ?? null, p.priceWholesale ?? null, v ? stockOf(v.id) : null, p.alertQty ?? null];
  });
  const maxRows = Math.max(500, rows.length + 300);
  const lists: OutSheet['lists'] = attrs.map((a, i) => {
    const n = activeValues(a).length;
    const col = colLetter(i);
    return { col: i, rows: maxRows, formula: `Listes!$${col}$2:$${col}$${Math.max(2, n + 1)}` };
  });
  const listRows: Cell[][] = [];
  const longest = Math.max(0, ...attrs.map((a) => activeValues(a).length));
  for (let r = 0; r < longest; r++) listRows.push(attrs.map((a) => activeValues(a)[r] ? activeValues(a)[r].label : null));
  const sheets: OutSheet[] = [
    { name: 'Articles', columns: [...attrs.map((a) => ({ header: a.name + (a.required === false ? ' (facultatif)' : ''), width: 22, input: true })), ...FIXED.map((h, i) => ({ header: h, width: i === 0 ? 24 : 15, input: true, number: i > 0 })), { header: PHOTO_COL, width: 22, input: true }], rows, lists },
    { name: 'Listes', columns: attrs.map((a) => ({ header: a.name, width: 24 })), rows: listRows },
    { name: "Mode d'emploi", columns: [], rows: [], notes: [
      `#Page « ${cat.name} » — fichier d'import Trésor en ligne`,
      'Une ligne = un article. Pour chaque variante, choisissez la valeur dans la liste déroulante (ou tapez le libellé ou le code court).',
      'Les articles déjà enregistrés sont pré-remplis : modifiez leurs prix ou leur stock, et ajoutez de nouvelles lignes en dessous.',
      'Nom de l’article : laissez vide, il sera fait avec les codes courts (ex. LP1 B22 7W).',
      'Photo : collez l’image de l’article dans sa ligne (colonne Photo de préférence). Une image posée sur plusieurs lignes fusionnées sert à toutes ces lignes. Sans image, la photo actuelle de l’article est gardée.',
      'Prix et stock en chiffres, sans espace ni « Ar ». Stock = quantité que vous avez aujourd’hui (pour un article existant, le stock est remis à cette quantité).',
      'Une valeur qui manque dans la liste : ajoutez-la d’abord dans Trésor en ligne (Articles et stock → Pages et variantes), puis téléchargez de nouveau ce fichier.',
      'Ne changez pas les titres des colonnes et ne supprimez pas les onglets.',
    ] },
    { name: 'tsena', columns: [], rows: [], notes: [`${MARK}${cat.id}`], hidden: true },
  ];
  return writeXlsx(sheets);
}

/** Page visée par un fichier modèle (onglet caché « tsena »). */
export function templateCategory(sheets: Sheet[]): Category | undefined {
  const s = sheets.find((x) => x.name === 'tsena');
  const cell = String(s?.rows?.[0]?.[0] ?? '');
  if (!cell.startsWith(MARK)) return undefined;
  return get<Category>('categories', cell.slice(MARK.length));
}

export interface ImportRow { line: number; input?: ArticleInput; errors: string[]; name: string; label: string; exists: boolean; current?: number; photo?: Blob }
const num = (v: Cell): number | undefined | null => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[\s ]/g, '').replace(/ar$/i, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

/** Lit et contrôle le fichier ligne par ligne, sans rien enregistrer. */
export function parseCategoryFile(cat: Category, sheets: Sheet[], opts: { allowNoPrice?: boolean } = {}): ImportRow[] {
  const sh = sheets.find((x) => x.name === 'Articles') ?? sheets[0];
  const head = (sh.rows[0] ?? []).map((h) => normHeader(h).replace(/ facultatif$/, ''));
  const attrs = activeAttrs(cat);
  const colOf = (label: string) => head.indexOf(normHeader(label).replace(/ facultatif$/, ''));
  const aCols = attrs.map((a) => colOf(a.name));
  const fCols = FIXED.map((h) => colOf(h));
  const out: ImportRow[] = [];
  const seen = new Map<string, number>();
  // Photos : image ancrée dans la ligne (ou sur des lignes fusionnées : elle sert à toutes).
  const photoOf = new Map<number, Blob>();
  for (const im of sh.images ?? []) {
    const m = (sh.merges ?? []).find((g) => im.row >= g.r1 && im.row <= g.r2 && im.col >= g.c1 && im.col <= g.c2);
    for (let r = m ? m.r1 : im.row; r <= (m ? m.r2 : im.row); r++) if (!photoOf.has(r)) photoOf.set(r, im.blob);
  }
  const find = (a: CatAttr, raw: string) => {
    const n = normText(raw).replace(/\s+/g, ' ').trim();
    return a.values.find((v) => normText(v.label).trim() === n) ?? a.values.find((v) => normText(v.code) === n.replace(/\s/g, ''));
  };
  for (let r = 1; r < sh.rows.length; r++) {
    const row = sh.rows[r] ?? [];
    if (!row.some((c) => c != null && String(c).trim() !== '')) continue;
    const errors: string[] = [];
    const sel: Selection = {};
    attrs.forEach((a, i) => {
      if (aCols[i] < 0) { errors.push(`Colonne « ${a.name} » introuvable`); return; }
      const raw = String(row[aCols[i]] ?? '').trim();
      if (!raw) { if (a.required !== false) errors.push(`${a.name} manquant`); return; }
      const v = find(a, raw);
      if (!v) errors.push(`${a.name} « ${raw} » inconnu (valeurs : ${activeValues(a).map((x) => x.code).slice(0, 12).join(', ')}${activeValues(a).length > 12 ? '…' : ''})`);
      else { if (v.active === false) errors.push(`${a.name} « ${raw} » est désactivé`); sel[a.id] = v.id; }
    });
    const vals = fCols.map((c) => (c >= 0 ? row[c] : null));
    const name = String(vals[0] ?? '').trim();
    const [cost, retail, wholesale, stock, alertQty] = vals.slice(1).map(num);
    const labels = ['Prix de revient', 'PV détail', 'PV gros', 'Stock', 'Alerte stock bas'];
    [cost, retail, wholesale, stock, alertQty].forEach((v, i) => { if (v === null) errors.push(`${labels[i]} : « ${vals[i + 1]} » n’est pas un nombre`); else if (v != null && v < 0) errors.push(`${labels[i]} négatif`); });
    const parts = articleParts(cat, sel);
    const key = articleId(cat.id, sel);
    if (!errors.length) { if (seen.has(key)) errors.push(`Même article que la ligne ${seen.get(key)}`); else seen.set(key, r + 1); }
    const existing = errors.length ? undefined : findArticle(cat.id, sel);
    if (!errors.length && !existing && retail == null && !opts.allowNoPrice) errors.push('PV détail manquant pour un nouvel article');
    const v = existing ? productVariants(existing.id)[0] : undefined;
    out.push({
      line: r + 1, errors, name: name || existing?.name || parts.name, label: parts.label, exists: !!existing, current: v ? stockOf(v.id) : undefined, photo: photoOf.get(r),
      input: errors.length ? undefined : { sel, name: name || undefined, cost: cost ?? undefined, retail: retail ?? undefined, wholesale: wholesale ?? undefined, stock: stock ?? undefined, alertQty: alertQty ?? undefined },
    });
  }
  return out;
}

/** Article d'une page avec valeurs (utilisé pour l'affichage). */
export const isAttrArticle = (p?: Product) => !!(p?.attrs && attrCategory(p.categoryId));

/** Articles « frères » : même page, une seule variante différente (ex. les autres tailles du même modèle). */
export function siblingsOf(p: Product): Product[] {
  if (!p.attrs) return [];
  const keys = Object.keys(p.attrs);
  // Un article à une seule variante (ex. modèle K9) n'a pas de voisins : les autres modèles ne sont pas des « choix ».
  if (keys.length < 2) return [];
  // La première variante de la page (le modèle, ex. PH6) reste la même : seules les autres changent (taille, couleur…).
  const order = (attrCategory(p.categoryId)?.attrs ?? []).map((a) => a.id).filter((id) => keys.includes(id));
  const model = order[0] ?? keys[0];
  return all<Product>('products').filter((x) => x.id !== p.id && x.active !== false && x.categoryId === p.categoryId && x.attrs
    && keys.length === Object.keys(x.attrs).length && x.attrs[model] === p.attrs![model] && keys.filter((k) => x.attrs![k] !== p.attrs![k]).length === 1)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
}
