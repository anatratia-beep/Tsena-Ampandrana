// Langage ESC/POS : celui des imprimantes à tickets (58 mm et 80 mm, Bluetooth ou USB).
import { layout, logoFor, type PrintDoc } from './doc';

export type Charset = 'cp858' | 'wpc1252' | 'ascii';
export const CHARSETS: Record<Charset, string> = {
  cp858: 'PC858 (le plus courant)',
  wpc1252: 'Windows-1252',
  ascii: 'Sans accents (si les autres impriment mal)',
};

// Correspondance des lettres accentuées pour les pages de code PC850/PC858.
const CP858: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, '£': 0x9c, Ø: 0x9d,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, '«': 0xae, '»': 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, Ê: 0xd2, Ë: 0xd3, È: 0xd4, '€': 0xd5,
  Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ó: 0xe0, Ô: 0xe2, Ò: 0xe3, Ú: 0xe9, Û: 0xea, Ù: 0xeb, '°': 0xf8, '·': 0xfa,
};
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»]/g, '"').replace(/€/g, 'EUR').replace(/·/g, '.').replace(/°/g, 'o');

function encodeText(s: string, cs: Charset): number[] {
  const out: number[] = [];
  for (const ch of cs === 'ascii' ? stripAccents(s) : s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (cs === 'cp858' && CP858[ch] != null) out.push(CP858[ch]);
    else if (cs === 'wpc1252' && c <= 0xff) out.push(c);
    else if (cs === 'wpc1252' && ch === '€') out.push(0x80);
    else out.push(...[...stripAccents(ch)].map((x) => (x.charCodeAt(0) < 0x80 ? x.charCodeAt(0) : 0x3f)));
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d;

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

export async function encodeDoc(doc: PrintDoc, o: { cols: number; charset: Charset; cut: boolean; logo?: string | null; copies?: number }): Promise<Uint8Array> {
  const dots = o.cols >= 48 ? 576 : 384;
  const rows = layout(doc, o.cols);
  // Un logo par ligne « logo » : celui de la page si le document en a un, sinon celui de la société.
  const rasters = new Map<string, number[]>();
  for (const r of rows) { const src = r.logo ? logoFor(r, o.logo) : undefined; if (src && !rasters.has(src)) { try { rasters.set(src, await logoRaster(src, dots)); } catch { rasters.set(src, []); } } }
  const one: number[] = [ESC, 0x40]; // initialisation
  const table = o.charset === 'cp858' ? 19 : o.charset === 'wpc1252' ? 16 : 0;
  one.push(ESC, 0x74, table);
  let bold = false, big = false;
  for (const r of rows) {
    if (r.logo) { const src = logoFor(r, o.logo); const logo = src ? rasters.get(src) ?? [] : []; if (logo.length) one.push(ESC, 0x61, 1, ...logo, ESC, 0x61, 0); continue; }
    if (r.qr) {
      const data = [...new TextEncoder().encode(r.qr)];
      const len = data.length + 3;
      one.push(ESC, 0x61, 1);
      one.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // modèle 2
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6);          // taille des points
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);       // correction M
      one.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data);
      one.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, 0x0a); // impression
      one.push(ESC, 0x61, 0);
      continue;
    }
    if (r.cut) { one.push(ESC, 0x64, 4); if (o.cut) one.push(GS, 0x56, 0x42, 0x00); continue; }
    if (!!r.bold !== bold) { bold = !!r.bold; one.push(ESC, 0x45, bold ? 1 : 0); }
    if (!!r.big !== big) { big = !!r.big; one.push(GS, 0x21, big ? 0x11 : 0x00); }
    one.push(...encodeText(r.s.replace(/\s+$/, ''), o.charset), 0x0a);
  }
  if (bold) one.push(ESC, 0x45, 0);
  if (big) one.push(GS, 0x21, 0);
  one.push(ESC, 0x64, 3);
  if (o.cut) one.push(GS, 0x56, 0x42, 0x00);
  const all: number[] = [];
  for (let i = 0; i < Math.max(1, o.copies ?? 1); i++) all.push(...one);
  return new Uint8Array(all);
}
