// Langage ESC/POS : celui des imprimantes à tickets (58 mm et 80 mm, Bluetooth ou USB).
import { layout, logoFor, type PrintDoc } from './doc';

/**
 * Jeux de caractères (accents). « cp858 » est l'ancien réglage : il est désormais traité comme PC850 (table 2),
 * qui imprime correctement « À », « é »… sur les imprimantes chinoises ; « € » s'écrit alors « EUR ».
 */
export type Charset = 'cp850' | 'cp858' | 'wpc1252' | 'wpc1252cn' | 'ascii';
export const CHARSETS: Record<Charset, string> = {
  cp850: 'A — PC850 (recommandé)',
  cp858: 'B — PC858 (ancien réglage, traité comme PC850)',
  wpc1252: 'C — Windows-1252 (Epson)',
  wpc1252cn: 'D — Windows-1252 (imprimantes 58 mm chinoises)',
  ascii: 'E — Sans accents',
};
/** Jeux proposés dans la liste (« cp858 » seulement s'il est déjà choisi). */
export const charsetOptions = (current?: Charset) => (Object.keys(CHARSETS) as Charset[]).filter((k) => k !== 'cp858' || current === 'cp858');
/** Numéro de table ESC t de chaque jeu. */
export const CHARSET_TABLE: Record<Charset, number> = { cp850: 2, cp858: 2, wpc1252: 16, wpc1252cn: 11, ascii: 0 };

// Correspondance des lettres accentuées pour la page de code PC850.
const CP850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, '£': 0x9c, Ø: 0x9d,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, '«': 0xae, '»': 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, Ê: 0xd2, Ë: 0xd3, È: 0xd4,
  Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ó: 0xe0, Ô: 0xe2, Ò: 0xe3, Ú: 0xe9, Û: 0xea, Ù: 0xeb, '°': 0xf8, '·': 0xfa,
};
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»]/g, '"').replace(/€/g, 'EUR').replace(/·/g, '.').replace(/°/g, 'o');

export function encodeText(s: string, cs: Charset): number[] {
  const out: number[] = [];
  const pc850 = cs === 'cp850' || cs === 'cp858';
  const w1252 = cs === 'wpc1252' || cs === 'wpc1252cn';
  for (const ch of cs === 'ascii' ? stripAccents(s) : s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (pc850 && CP850[ch] != null) out.push(CP850[ch]);
    else if (w1252 && ch === '€') out.push(0x80);
    else if (w1252 && c <= 0xff) out.push(c);
    else out.push(...[...stripAccents(ch)].map((x) => (x.charCodeAt(0) < 0x80 ? x.charCodeAt(0) : 0x3f)));
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d;

/** Avance du papier de `mm` millimètres (ESC J, par tranches de 255 points ; 8 points par mm). */
export function feedBytes(mm: number): number[] {
  const out: number[] = [];
  let dots = Math.round(Math.max(0, mm) * 8);
  while (dots > 0) { const n = Math.min(255, dots); out.push(ESC, 0x4a, n); dots -= n; }
  return out;
}
export const DEFAULT_FEED_MM = 20;

/** Logo de la société converti en image noir et blanc (points de l'imprimante). */
export async function logoRaster(dataUrl: string, dots: number): Promise<number[]> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const maxW = Math.min(dots, Math.round(dots * 0.6));
  const scale = Math.min(maxW / img.width, 160 / img.height, 1.5);
  const w = Math.max(8, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dots; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dots, h);
  ctx.drawImage(img, Math.round((dots - w) / 2), 0, w, h);
  const px = ctx.getImageData(0, 0, dots, h).data;
  const bytesPerRow = dots / 8;
  // Tramage (Floyd-Steinberg) pour garder les nuances du logo.
  const lum = new Float32Array(dots * h);
  for (let i = 0; i < dots * h; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const data: number[] = new Array(bytesPerRow * h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < dots; x++) {
    const i = y * dots + x, old = lum[i], val = old < 128 ? 0 : 255, err = old - val;
    if (val === 0) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    if (x + 1 < dots) lum[i + 1] += (err * 7) / 16;
    if (y + 1 < h) { if (x > 0) lum[i + dots - 1] += (err * 3) / 16; lum[i + dots] += (err * 5) / 16; if (x + 1 < dots) lum[i + dots + 1] += err / 16; }
  }
  return [GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8, ...data];
}

export interface EncodeOpts { cols: number; charset: Charset; cut: boolean; logo?: string | null; copies?: number; feedMm?: number }

export async function encodeDoc(doc: PrintDoc, o: EncodeOpts): Promise<Uint8Array> {
  const dots = o.cols >= 48 ? 576 : 384;
  const rows = layout(doc, o.cols);
  const feed = feedBytes(o.feedMm ?? DEFAULT_FEED_MM);
  // Un logo par ligne « logo » : celui de la page si le document en a un, sinon celui de la société.
  const rasters = new Map<string, number[]>();
  for (const r of rows) { const src = r.logo ? logoFor(r, o.logo) : undefined; if (src && !rasters.has(src)) { try { rasters.set(src, await logoRaster(src, dots)); } catch { rasters.set(src, []); } } }
  const one: number[] = [ESC, 0x40]; // initialisation
  one.push(ESC, 0x74, CHARSET_TABLE[o.charset] ?? 2);
  let bold = false, size = 0;
  const setSize = (n: number) => { if (n !== size) { size = n; one.push(GS, 0x21, n); } };
  for (const r of rows) {
    if (r.logo) { const src = logoFor(r, o.logo); const logo = src ? rasters.get(src) ?? [] : []; if (logo.length) one.push(ESC, 0x61, 1, ...logo, ESC, 0x61, 0); continue; }
    if (r.qr) {
      const data = [...new TextEncoder().encode(r.qr)];
      const len = data.length + 3;
      one.push(ESC, 0x61, 1);
      one.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // modèle 2
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 4);          // taille des points (petit QR)
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);       // correction M
      one.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data);
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, 0x0a); // impression
      one.push(ESC, 0x61, 0);
      continue;
    }
    // Entre deux documents joints : même espace blanc qu'en fin de ticket, puis coupe.
    if (r.cut) { one.push(...feed); if (o.cut) one.push(GS, 0x56, 0x42, 0x00); continue; }
    if (!!r.bold !== bold) { bold = !!r.bold; one.push(ESC, 0x45, bold ? 1 : 0); }
    setSize(r.big ? 0x11 : r.tall ? 0x01 : 0x00);
    one.push(...encodeText(r.s.replace(/\s+$/, ''), o.charset), 0x0a);
  }
  if (bold) one.push(ESC, 0x45, 0);
  setSize(0);
  one.push(...feed); // espace blanc en bas pour déchirer sans couper le texte
  if (o.cut) one.push(GS, 0x56, 0x42, 0x00);
  const all: number[] = [];
  for (let i = 0; i < Math.max(1, o.copies ?? 1); i++) all.push(...one);
  return new Uint8Array(all);
}

/** « Test des accents » : une ligne par jeu (A, C, D), chacune avec sa table, pour choisir la bonne lettre. */
export function accentTestBytes(printerName: string, feedMm = DEFAULT_FEED_MM): Uint8Array {
  const sample = 'é è à ç ê ô û ï É';
  const b: number[] = [ESC, 0x40, ESC, 0x74, 2, ESC, 0x61, 1, ESC, 0x45, 1, ...encodeText('TEST DES ACCENTS', 'ascii'), 0x0a, ESC, 0x45, 0, ...encodeText(printerName, 'ascii'), 0x0a, ESC, 0x61, 0, 0x0a];
  const sets: [string, Charset][] = [['A', 'cp850'], ['C', 'wpc1252'], ['D', 'wpc1252cn']];
  for (const [letter, cs] of sets) {
    b.push(ESC, 0x74, CHARSET_TABLE[cs], ...encodeText(`${letter} : ${sample}`, cs), 0x0a);
  }
  b.push(ESC, 0x74, 0, 0x0a, ...encodeText('Choisissez la lettre dont la ligne', 'ascii'), 0x0a, ...encodeText('est bien imprimee.', 'ascii'), 0x0a);
  b.push(...feedBytes(feedMm));
  return new Uint8Array(b);
}
