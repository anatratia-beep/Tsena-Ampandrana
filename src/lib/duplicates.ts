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
