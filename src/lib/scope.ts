// Pages attribuées aux vendeurs : chaque vendeur peut être rattaché à une ou plusieurs catégories principales
// (une catégorie = une page Facebook). Il voit alors d'abord ce qui concerne ses pages et ses propres saisies.
import { useState } from 'react';
import { get, useTable } from './db';
import { useMe, type User } from './auth';
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
 * Filtre du vendeur connecté. `on` = le filtre s'applique (le vendeur a des pages, et n'a pas choisi « Tout voir »).
 * Le choix « Tout voir » est propre à chaque écran et revient au filtre à chaque ouverture.
 */
export function useMyScope() {
  const me = useMe();
  useTable('categories');
  const pages = userPages(me);
  const [all, setAll] = useState(false);
  const has = pages.length > 0;
  const on = has && !all;
  const set = new Set(pages);
  return {
    me, pages, has, on, all, setAll, names: pageNames(pages),
    product: (productId?: string) => !on || set.has(productPage(productId)),
    variant: (variantId: string) => !on || set.has(variantPage(variantId)),
    /** Commande saisie par le vendeur connecté. */
    mine: (o: { createdBy?: string; createdByName?: string }) => !on || o.createdBy === me.id || (!o.createdBy && o.createdByName === me.fullName),
  };
}
