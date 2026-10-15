// Pages attribuées aux vendeurs : chaque vendeur peut être rattaché à une ou plusieurs catégories principales
// (une catégorie = une page Facebook). Il voit alors d'abord ce qui concerne ses pages et ses propres saisies.
import { useState } from 'react';
import { get, useTable } from './db';
import { can, useMe, type User } from './auth';
import type { Category, Product, Variant } from './catalog';

/** Catégorie principale (la plus haute) d'une catégorie. */
export function rootOf(categoryId?: string): string {
  let c = categoryId ? get<Category>('categories', categoryId) : undefined;
  while (c?.parentId) { const up = get<Category>('categories', c.parentId); if (!up) break; c = up; }
  return c?.id ?? '';
}
export const productPage = (productId?: string) => rootOf(productId ? get<Product>('products', productId)?.categoryId : undefined);
export const variantPage = (variantId: string) => productPage(get<Variant>('variants', variantId)?.productId);

export const userPages = (u?: User): string[] => (u?.pageIds || []).filter((id) => { const c = get<Category>('categories', id); return !!c && !c.removed; });
export const pageNames = (ids: string[]) => ids.map((id) => get<Category>('categories', id)?.name).filter(Boolean).join(', ');

/**
 * Vendeur « limité à ses pages » : il a des pages attribuées et n'est ni gérant, ni responsable, ni patron (pas de
 * rapports ni de trésorerie). Il ne voit alors QUE ses pages partout (accueil, commandes, ventes, caisse du jour…),
 * jamais le total de tous les vendeurs, et ne peut pas passer en « Tout voir ».
 */
export function isPageSeller(u?: User): boolean {
  if (!u || !userPages(u).length) return false;
  return !['users.manage', 'handover.receive', 'reports.view', 'treasury.view'].some((p) => can(u, p));
}
/** Pages d'une commande (articles vendus et repris). */
export function orderPagesOf(o: { lines: { variantId: string }[]; returnLines?: { variantId: string }[] }): Set<string> {
  const s = new Set<string>();
  for (const l of o.lines) s.add(variantPage(l.variantId));
  for (const r of o.returnLines || []) s.add(variantPage(r.variantId));
  return s;
}

/**
 * Filtre du vendeur connecté. `on` = le filtre s'applique (le vendeur a des pages, et n'a pas choisi « Tout voir »).
 * Le choix « Tout voir » est propre à chaque écran et revient au filtre à chaque ouverture.
 */
export function useMyScope() {
  const me = useMe();
  useTable('categories');
  const pages = userPages(me);
  useTable('roles');
  const [all, setAll] = useState(false);
  const has = pages.length > 0;
  const strict = isPageSeller(me);
  const on = has && (strict || !all);
  const set = new Set(pages);
  const byMe = (o: { createdBy?: string; createdByName?: string }) => o.createdBy === me.id || (!o.createdBy && o.createdByName === me.fullName);
  return {
    me, pages, has, on, all: strict ? false : all, setAll: strict ? () => {} : setAll, strict, names: pageNames(pages),
    product: (productId?: string) => !on || set.has(productPage(productId)),
    variant: (variantId: string) => !on || set.has(variantPage(variantId)),
    page: (pageId?: string) => !on || set.has(pageId || ''),
    /**
     * Commande à montrer : vendeur limité à ses pages → commandes qui contiennent un article de ses pages (ou saisies
     * par lui) ; sinon, filtre « mes commandes » = saisies par le vendeur connecté.
     */
    mine: (o: { createdBy?: string; createdByName?: string; lines?: { variantId: string }[]; returnLines?: { variantId: string }[] }) => {
      if (!on) return true;
      if (strict && o.lines) { for (const p of orderPagesOf(o as any)) if (set.has(p)) return true; }
      return byMe(o);
    },
  };
}
