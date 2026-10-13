// Supprimer une page (catégorie principale) sans rien perdre : la page et ses articles sont rangés de côté
// (« supprimés »), plus proposés à la vente ni dans les listes, mais toutes les ventes, le stock, les boosts et
// l'historique gardent leur nom et leurs chiffres. Une page supprimée peut être restaurée à tout moment.
import { all, get, save } from './db';
import { audit, currentUser } from './auth';
import { productVariants, stockOf, variantCost, type Category, type Product, type Variant } from './catalog';
import { rootOf } from './scope';
import type { Order } from './orders';
import { pointBefore } from './restorePoints';

/** La page et toutes ses sous-catégories. */
function familyOf(pageId: string): string[] {
  return all<Category>('categories').filter((c) => c.id === pageId || rootOf(c.id) === pageId).map((c) => c.id);
}
const productsOf = (pageId: string) => { const fam = new Set(familyOf(pageId)); return all<Product>('products').filter((p) => p.categoryId && fam.has(p.categoryId)); };

export interface PageRemovalInfo { articles: number; stockPcs: number; stockValue: number; pending: string[] }
/** Ce qu'il faut savoir avant de supprimer : articles, stock restant, commandes pas encore terminées. */
export function pageRemovalInfo(pageId: string): PageRemovalInfo {
  const prods = productsOf(pageId).filter((p) => p.active !== false);
  const pids = new Set(productsOf(pageId).map((p) => p.id));
  let stockPcs = 0, stockValue = 0;
  for (const p of prods) {
    for (const v of productVariants(p.id) as Variant[]) {
      const q = Math.max(0, stockOf(v.id));
      stockPcs += q; stockValue += q * variantCost(v);
    }
  }
  const vids = new Set(all<Variant>('variants').filter((v) => pids.has(v.productId)).map((v) => v.id));
  const pending = all<Order>('orders').filter((o) => ['new', 'confirmed', 'ready', 'out'].includes(o.status) && o.lines.some((l) => vids.has(l.variantId))).map((o) => o.number);
  return { articles: prods.length, stockPcs, stockValue, pending };
}

export async function removePage(pageId: string) {
  const c = get<Category>('categories', pageId);
  if (!c) throw new Error('Page introuvable.');
  const info = pageRemovalInfo(pageId);
  if (info.pending.length) throw new Error(`Des commandes pas encore terminées contiennent des articles de cette page : ${info.pending.slice(0, 8).join(', ')}${info.pending.length > 8 ? '…' : ''}. Terminez-les ou annulez-les d’abord.`);
  await pointBefore(`suppression de la page ${c.name}`);
  const me = currentUser()?.fullName; const at = new Date().toISOString();
  const prods = productsOf(pageId).filter((p) => p.active !== false);
  if (prods.length) await save('products', prods.map((p) => ({ id: p.id, active: false, removedWithPage: pageId })));
  await save('categories', familyOf(pageId).map((id) => ({ id, removed: true, removedAt: at, removedBy: me })));
  await audit('Page supprimée', `${c.name} : ${prods.length} article(s) rangés avec elle${info.stockPcs ? `, ${info.stockPcs} pièce(s) en stock` : ''} — restaurable`, 'categories', pageId);
}

export async function restorePage(pageId: string) {
  const c = get<Category>('categories', pageId);
  if (!c) throw new Error('Page introuvable.');
  await save('categories', familyOf(pageId).map((id) => ({ id, removed: false, removedAt: undefined, removedBy: undefined })));
  const prods = all<Product>('products').filter((p) => p.removedWithPage === pageId);
  if (prods.length) await save('products', prods.map((p) => ({ id: p.id, active: true, removedWithPage: undefined })));
  await audit('Page restaurée', `${c.name} : ${prods.length} article(s) remis en vente`, 'categories', pageId);
}
