// Boutique en ligne (site des clients) : réglages modifiables depuis Tsena, comme l'administration d'une boutique Shopify.
// Enregistrés dans la table « settings » (synchronisée) :
//   settings/webshop          → réglages communs (mentions légales, carte bancaire, textes)
//   settings/webshop:<pageId> → réglages d'une page (publiée, textes d'accueil, photo, couleur, Facebook…)
// Le site les lit à chaque visite : une modification enregistrée ici s'affiche sur le site dès la synchronisation.
import { get, save, useTable, type BaseRecord } from './db';
import { audit } from './auth';

export const SHOP_URL = 'https://anatratia-beep.github.io/Tsena-Ampandrana/boutique/';
export const shopUrlOf = (code?: string, id?: string) => `${SHOP_URL}?page=${encodeURIComponent(String(code || id || '').toLowerCase())}`;

export type CardMode = 'off' | 'test' | 'on';
export interface WebShopGlobal extends BaseRecord {
  cardMode?: CardMode;
  cardMin?: number;
  company?: string; email?: string; nif?: string; stat?: string;
  returnDays?: number;
  cardEntity?: string;
  announce?: string;        // bandeau du haut, une phrase par ligne (vide = automatique)
  termsExtra?: string;      // conditions particulières ajoutées aux CGV
  about?: string;           // texte « À propos » (vide = pas de page)
  deliveryNote?: string;    // précisions sur la livraison (délais, province…)
}
export interface WebShopPage extends BaseRecord {
  published?: boolean;      // false = page absente du site
  title?: string;           // titre d'accueil (vide = nom de la page)
  tagline?: string;         // phrase d'accueil (vide = slogan de la page)
  hero?: string;            // photo d'accueil (data URL)
  accent?: string;          // couleur
  facebook?: string; messenger?: string; pixel?: string;
  card?: boolean;           // paiement par carte accepté sur cette page (si activé globalement)
  announce?: string;        // bandeau propre à la page (vide = bandeau commun)
}

export const globalId = 'webshop';
export const pageSettingsId = (pageId: string) => `webshop:${pageId}`;

export function useWebShop() {
  useTable('settings');
  return {
    global: (get<WebShopGlobal>('settings', globalId) ?? { id: globalId }) as WebShopGlobal,
    page: (pageId: string) => (get<WebShopPage>('settings', pageSettingsId(pageId)) ?? { id: pageSettingsId(pageId) }) as WebShopPage,
  };
}

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v])) as T;

export async function saveWebShopGlobal(patch: Partial<WebShopGlobal>) {
  await save('settings', { id: globalId, ...clean(patch) }, { force: true });
  await audit('Boutique en ligne', 'Réglages communs du site modifiés', 'settings', globalId);
}
export async function saveWebShopPage(pageId: string, pageName: string, patch: Partial<WebShopPage>) {
  await save('settings', { id: pageSettingsId(pageId), ...clean(patch) }, { force: true });
  await audit('Boutique en ligne', `Page « ${pageName} » du site modifiée${patch.published === false ? ' (masquée)' : ''}`, 'settings', pageSettingsId(pageId));
}

/** Photo d'accueil : réduite (1200 px, ~150 Ko) pour un chargement rapide. */
export function resizeHero(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/jpeg', 0.82);
      for (const q of [0.74, 0.66, 0.58]) { if ((out.length - out.indexOf(',')) * 0.75 <= 160_000) break; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src);
      resolve(out);
    };
    img.onerror = () => reject(new Error('Image illisible. Choisissez un fichier PNG ou JPG.'));
    img.src = URL.createObjectURL(file);
  });
}
