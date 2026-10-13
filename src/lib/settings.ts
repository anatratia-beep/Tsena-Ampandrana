// Paramètres de la société (partagés par tous les appareils) et apparence (propre à l'appareil).
import { useEffect } from 'react';
import { get, useMeta, useTable, type BaseRecord } from './db';

export interface Company extends BaseRecord {
  name: string;
  slogan?: string;
  logo?: string; // image en data URL
  brandColor: string;
  phone?: string;
  address?: string;
  nif?: string;
  stat?: string;
  ticketFooter?: string;
  managerPhone?: string; // WhatsApp du gérant (récapitulatif du jour envoyé par les vendeurs)
  bossPhone?: string;   // WhatsApp du patron (récapitulatif)
  bossEmail?: string;
  autoLockMinutes: number;
  wholesaleMinQty?: number;
  usdRate?: number;          // taux du dollar (Ar) pour convertir la dépense des boosts
  targetDay?: number;        // objectif de chiffre d'affaires par jour (Ar)
  targetMonth?: number;      // objectif de chiffre d'affaires par mois (Ar)
  internalRounding?: number; // vente interne : prix de revient arrondi au palier supérieur (1, 100, 500… Ar)
  hours?: Record<string, { open: string; close: string } | null>; // clé 0 = dimanche … 6 = samedi
  /** Compte boost : heure limite par jour ouvert (clé 0…6) ; vide = heure de fermeture. */
  boostDeadlines?: Record<string, string>;
  /** Jour fermé (dimanche) : le compte boost se fait le jour ouvert suivant, avant cette heure. */
  boostClosedNext?: string;
}

export const DEFAULT_COMPANY: Company = {
  id: 'company', name: 'Ma boutique', brandColor: '#5B3DB0', autoLockMinutes: 30, wholesaleMinQty: 3, internalRounding: 1, usdRate: 4700,
  hours: { 1: { open: '08:00', close: '17:00' }, 2: { open: '08:00', close: '17:00' }, 3: { open: '08:00', close: '17:00' }, 4: { open: '08:00', close: '17:00' }, 5: { open: '08:00', close: '17:00' }, 6: { open: '08:00', close: '14:00' }, 0: null },
  ticketFooter: 'Misaotra tompoko ! Merci de votre visite.', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
};

export const BRAND_SWATCHES = [
  { name: 'Lavande', hex: '#5B3DB0' },
  { name: 'Ravinala', hex: '#17695A' },
  { name: 'Océan', hex: '#1D5FA8' },
  { name: 'Indigo', hex: '#4B3FA6' },
  { name: 'Prune', hex: '#8A2E6B' },
  { name: 'Latérite', hex: '#B5402A' },
  { name: 'Safran', hex: '#B87A0E' },
  { name: 'Forêt', hex: '#2F6B2A' },
  { name: 'Ardoise', hex: '#3C4A57' },
];

export function useCompany(): Company {
  useTable('settings');
  return { ...DEFAULT_COMPANY, ...(get<Company>('settings', 'company') ?? {}) };
}

export type ThemeMode = 'auto' | 'light' | 'dark';

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function mix(hex: string, with_: string, amount: number) {
  const a = hexToRgb(hex), b = hexToRgb(with_);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

/** Applique le thème et la couleur de la société à toute l'interface. */
export function useApplyAppearance() {
  const company = useCompany();
  const theme = useMeta<ThemeMode>('theme', 'auto');
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      const brand = company.brandColor || DEFAULT_COMPANY.brandColor;
      const brandUi = dark ? mix(brand, '#ffffff', 0.28) : brand;
      root.style.setProperty('--brand', brandUi);
      root.style.setProperty('--brand-ink', luminance(brandUi) > 0.4 ? '#14201C' : '#FFFFFF');
      root.style.setProperty('--brand-soft', dark ? mix(brand, '#0F1517', 0.72) : mix(brand, '#ffffff', 0.88));
      // Thème « Lamba » : menu sombre teinté de la couleur de la société, reflet soyeux, dégradés de marque.
      root.style.setProperty('--brand-deep', mix(brand, '#0E0822', 0.38));
      root.style.setProperty('--brand-tint', dark ? mix(brand, '#15112A', 0.8) : mix(brand, '#ffffff', 0.92));
      // Thème « Lavande » : menu dans un ton riche de la couleur de la société (violet par défaut).
      root.style.setProperty('--nav-bg', mix(brand, '#0E0822', 0.38));
      root.style.setProperty('--nav-bg-2', mix(brand, '#ffffff', 0.04));
      root.style.setProperty('--nav-glow', mix(brand, '#ffffff', 0.35));
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mix(brand, '#0E0822', 0.38));
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [company.brandColor, theme]);
  useEffect(() => { document.title = company.name || 'Trésor en ligne'; }, [company.name]);
}

/** Réduit une image (logo) pour la stocker légèrement. */
export function resizeImage(file: File, max = 256, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const ctx = c.getContext('2d')!;
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); }
      let out = c.toDataURL(type, 0.72);
      // Logo trop lourd en PNG (photo plutôt que dessin) : enregistré en JPEG léger, comme les photos.
      if (type === 'image/png' && (out.length - out.indexOf(',')) * 0.75 > 40_000) {
        const ctx2 = c.getContext('2d')!; ctx2.globalCompositeOperation = 'destination-over'; ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, c.width, c.height);
        for (const q of [0.82, 0.72, 0.62]) { out = c.toDataURL('image/jpeg', q); if ((out.length - out.indexOf(',')) * 0.75 <= 40_000) break; }
      }
      resolve(out);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("Image illisible. Choisissez un fichier PNG ou JPG."));
    img.src = URL.createObjectURL(file);
  });
}
