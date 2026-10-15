// Articles en double : le même article créé deux fois (souvent un import dans la mauvaise page, ex. « PH6 » dans la page
// Boxer homme alors qu'il est dans Pyjamas homme). Repérés par la même photo et la même taille / dernière valeur, dans des
// pages différentes. On choisit l'article à garder ; les autres sont archivés : stock remis à 0 (ou ajouté à l'article
// gardé), plus en vente ni dans les recherches. Ventes et historique gardent tout.
import { all, get, save } from './db';
import { audit } from './auth';
import { addMoves, normText, productStock, productVariants, stockOf, type Product, type StockMove } from './catalog';
import { rootOf } from './scope';
import { pointBefore } from './restorePoints';

export interface DupGroup { key: string; items: Product[]; pages: string[] }

const lastToken = (name: string) => normText(name).trim().split(/\s+/).pop() ?? '';
const photoKey = (p: Product) => (p.photo ? `${p.photo.length}:${p.photo.slice(-80)}` : '');

/** Groupes d'articles probablement en double (au moins deux pages différentes, ou même nom dans la même page). */
export function findDuplicates(): DupGroup[] {
  const groups = new Map<string, Product[]>();
  for (const p of all<Product>('products')) {
    if (p.active === false || p.kind === 'lot') continue;
    const ph = photoKey(p);
    const keys = ph ? [`ph|${ph}|${lastToken(p.name)}`] : [];
    keys.push(`nm|${normText(p.name).replace(/\s+/g, ' ').trim()}`);
    for (const k of keys) { if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); }
  }
  const out: DupGroup[] = []; const seen = new Set<string>();
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const pages = [...new Set(items.map((p) => rootOf(p.categoryId)))];
    const sameName = key.startsWith('nm|');
    if (!sameName && pages.length < 2) continue;              // même photo dans une seule page : autres tailles, normal
    const sig = items.map((p) => p.id).sort().join(',');
    if (seen.has(sig)) continue; seen.add(sig);
    out.push({ key, items: items.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true })), pages });
  }
  return out.sort((a, b) => a.items[0].name.localeCompare(b.items[0].name, 'fr', { numeric: true }));
}

// ---------- Avant un import : l'article existe-t-il déjà ailleurs ? ----------
// Un même article ne doit pas être créé une deuxième fois parce que le fichier est lu dans une autre page,
// ou une fois en « article simple » (code PH6) et une fois en « article de page » (Modèle PH6, Taille L).
export interface Twin { id: string; name: string; code: string; page: string }
const normName = (s?: string) => normText(s ?? '').replace(/[^a-z0-9]+/g, ' ').trim();
const normCode = (s?: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

/**
 * Prépare la recherche (une fois par fichier) puis répond pour chaque nouvel article :
 * - même nom qu'un article d'une AUTRE page (dans la même page, l'article est reconnu par ses valeurs) ;
 * - article simple dont le code est la valeur d'un article de page (ex. code PH6 ↔ Modèle PH6), dans les deux sens.
 */
export function twinFinder() {
  const pageName = (catId?: string) => get<{ name: string }>('categories', rootOf(catId))?.name ?? 'sans page';
  const byName = new Map<string, Product[]>();
  const simpleByCode = new Map<string, Product>();
  const pageByValueCode = new Map<string, Product>();
  for (const p of all<Product>('products')) {
    if (p.active === false || p.kind === 'lot') continue;
    const n = normName(p.name);
    if (n.length >= 3) { if (!byName.has(n)) byName.set(n, []); byName.get(n)!.push(p); }
    if (!p.attrs) { const c = normCode(p.code); if (c.length >= 3 && !simpleByCode.has(c)) simpleByCode.set(c, p); continue; }
    const cat = get<{ attrs?: { id: string; values: { id: string; code: string }[] }[] }>('categories', p.categoryId || '');
    for (const a of cat?.attrs ?? []) {
      const v = a.values.find((x) => x.id === p.attrs![a.id]);
      const c = normCode(v?.code);
      if (c.length >= 3 && !pageByValueCode.has(c)) pageByValueCode.set(c, p);
    }
  }
  const twin = (p?: Product): Twin | undefined => (p ? { id: p.id, name: p.name, code: p.code, page: pageName(p.categoryId) } : undefined);
  return {
    /** Nouvel article d'une page (valeurs choisies). */
    forPageArticle(catId: string, name: string, valueCodes: string[]): Twin | undefined {
      const root = rootOf(catId);
      const sameName = (byName.get(normName(name)) ?? []).find((p) => !(p.attrs && rootOf(p.categoryId) === root));
      if (sameName) return twin(sameName);
      for (const c of valueCodes) { const p = simpleByCode.get(normCode(c)); if (p) return twin(p); }
      return undefined;
    },
    /** Nouvel article simple (code modèle, ex. PH6). */
    forSimpleArticle(code: string): Twin | undefined {
      return twin(pageByValueCode.get(normCode(code)));
    },
  };
}

/** Ventes / commandes où un article apparaît (pour choisir lequel garder). */
export function usesOf(p: Product) {
  const vids = new Set(productVariants(p.id).map((v) => v.id));
  return all<{ lines?: { variantId: string }[] }>('orders').filter((o) => (o.lines || []).some((l) => vids.has(l.variantId))).length;
}

/** Garde `keep`, archive les autres du groupe. `moveStock` : leur stock est ajouté à l'article gardé. */
export async function resolveDuplicates(keep: Product, others: Product[], moveStock: boolean) {
  await pointBefore(`doublons de ${keep.code}`);
  const keepV = productVariants(keep.id)[0];
  const before = new Map(others.map((o) => [o.id, productStock(o.id)]));
  const at = new Date().toISOString();
  const moves: Omit<StockMove, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (const o of others) {
    for (const v of productVariants(o.id)) {
      const q = stockOf(v.id);
      if (!q) continue;
      moves.push({ variantId: v.id, qty: -q, type: 'adjust', refType: 'adjust', reason: `Doublon de ${keep.code} archivé${moveStock ? ' (stock transféré)' : ' (stock remis à 0)'}`, at });
      if (moveStock && keepV) moves.push({ variantId: keepV.id, qty: q, type: 'adjust', refType: 'adjust', reason: `Stock repris du doublon ${o.code}`, at });
    }
  }
  if (moves.length) await addMoves(moves);
  await save('products', others.map((o) => ({ id: o.id, active: false, duplicateOf: keep.id })));
  await audit('Doublons archivés', `Gardé ${keep.code} (${get<{ name: string }>('categories', rootOf(keep.categoryId))?.name ?? '?'}) ; archivé(s) : ${others.map((o) => `${o.code} (stock ${before.get(o.id)})`).join(', ')}${moveStock ? ' — stock transféré' : ' — stock remis à 0'}`, 'products', keep.id, 'high');
}
