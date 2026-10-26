// Étiquettes (QR code + code + nom + prix), pour l'imprimante d'étiquettes Luck Jingle (L12 « MPL12 »…)
// et, à défaut, pour une imprimante à tickets ou la fenêtre d'impression.
import { qrMatrix } from '../qr';

export interface LabelData {
  /** Contenu du QR code (lien de garantie, code d'étiquette…). */
  qr: string;
  /** Code imprimé en gros (numéro de série ou code article). */
  code: string;
  /** Nom de l'article. */
  title: string;
  /** Variante, taille… (facultatif). */
  sub?: string;
  /** Prix affiché (facultatif). */
  price?: string;
}
export interface LabelSize { lengthMm: number; crossMm: number }
export const LABEL_SIZES: Record<string, LabelSize & { label: string }> = {
  '30x15': { lengthMm: 30, crossMm: 15, label: '15 × 30 mm' },
  '40x15': { lengthMm: 40, crossMm: 15, label: '15 × 40 mm' },
  '50x15': { lengthMm: 50, crossMm: 15, label: '15 × 50 mm' },
  '40x12': { lengthMm: 40, crossMm: 12, label: '12 × 40 mm' },
  '40x30': { lengthMm: 40, crossMm: 30, label: '30 × 40 mm' },
};
const DOTS_PER_MM = 8;

/** Coupe un texte trop long pour la largeur (avec « … »). */
function fit(ctx: CanvasRenderingContext2D, s: string, w: number) {
  if (ctx.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
/** Coupe un texte en lignes (au plus `max`). */
function wrap(ctx: CanvasRenderingContext2D, s: string, w: number, max: number) {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const t = cur ? cur + ' ' + word : word;
    if (ctx.measureText(t).width <= w) cur = t;
    else { if (cur) lines.push(cur); cur = word; if (lines.length >= max) break; }
  }
  if (cur && lines.length < max) lines.push(cur);
  if (lines.length === max && words.join(' ').length > lines.join(' ').length) lines[max - 1] = fit(ctx, lines[max - 1] + ' …', w).replace(/ …$/, '…');
  return lines.map((l) => fit(ctx, l, w));
}

const FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

/**
 * Étiquette dessinée « à plat » (longueur × largeur), noir sur blanc, en points d'imprimante.
 * `cross` : largeur imprimable en travers (points), `length` : longueur de l'étiquette (points).
 */
export function drawLabel(label: LabelData, length: number, cross: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = length; cv.height = cross;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, length, cross);
  g.fillStyle = '#000'; g.textBaseline = 'top';
  const pad = Math.max(3, Math.round(cross * 0.05));
  // QR code à gauche, le plus grand possible (1 module de marge blanche)
  const m = qrMatrix(label.qr);
  const box = cross - pad * 2;
  const mod = Math.max(1, Math.floor(box / (m.length + 2)));
  const qs = mod * (m.length + 2);
  const qx = pad, qy = Math.round((cross - qs) / 2);
  m.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect(qx + (x + 1) * mod, qy + (y + 1) * mod, mod, mod); }));
  // Texte à droite
  const tx = qx + qs + pad, tw = length - tx - pad;
  if (tw < 24) return cv;
  const h = cross - pad * 2;
  let y = pad;
  const codeSize = Math.max(10, Math.round(h * 0.24));
  g.font = `bold ${codeSize}px ${FONT}`;
  g.fillText(fit(g, label.code, tw), tx, y); y += codeSize + 2;
  const nameSize = Math.max(9, Math.round(h * 0.17));
  g.font = `bold ${nameSize}px ${FONT}`;
  const left = h - (y - pad) - (label.price ? Math.round(h * 0.24) + 2 : 0);
  const maxLines = Math.max(1, Math.floor(left / (nameSize + 1)) - (label.sub ? 1 : 0));
  for (const l of wrap(g, label.title, tw, maxLines)) { g.fillText(l, tx, y); y += nameSize + 1; }
  if (label.sub) { g.font = `${nameSize}px ${FONT}`; g.fillText(fit(g, label.sub, tw), tx, y); y += nameSize + 1; }
  if (label.price) {
    const ps = Math.max(10, Math.round(h * 0.22));
    g.font = `bold ${ps}px ${FONT}`;
    g.fillText(fit(g, label.price, tw), tx, cross - pad - ps);
  }
  return cv;
}

/** Points noirs d'une image, ligne par ligne (bit de poids fort = point de gauche : GS v 0). */
export function canvasBitsMsb(cv: HTMLCanvasElement, threshold = 150): { bytesPerRow: number; rows: number; data: Uint8Array } {
  const w = cv.width, h = cv.height, bpr = Math.ceil(w / 8);
  const px = cv.getContext('2d')!.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const lum = px[i + 3] < 16 ? 255 : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (lum < threshold) data[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { bytesPerRow: bpr, rows: h, data };
}

/** Étiquette tournée pour une imprimante d'étiquettes : la tête imprime en travers, le papier avance dans la longueur. */
export function labelForHead(label: LabelData, size: LabelSize, headDots: number, flip = false): HTMLCanvasElement {
  const length = Math.round(size.lengthMm * DOTS_PER_MM);
  const cross = Math.min(headDots, Math.round(size.crossMm * DOTS_PER_MM));
  const flat = drawLabel(label, length, cross);
  const cv = document.createElement('canvas');
  cv.width = headDots; cv.height = length;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  const off = Math.round((headDots - cross) / 2); // centré sur la tête
  g.save();
  if (!flip) { g.translate(off + cross, 0); g.rotate(Math.PI / 2); }
  else { g.translate(off, length); g.rotate(-Math.PI / 2); }
  g.drawImage(flat, 0, 0);
  g.restore();
  return cv;
}

// ---------- Imprimante d'étiquettes Luck Jingle (L12 « MPL12_xxxx_BLE », DP-L1…) ----------
export const LUCK_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
export const LUCK_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb';
export const LUCK_NOTIFY = '0000ff01-0000-1000-8000-00805f9b34fb';
/** Noms Bluetooth de ces imprimantes d'étiquettes (ex. « MPL12_1B4A_BLE »). */
export const isLuckName = (name?: string | null) => !!name && /^(MPL\d+|MP_?L\d+|LUCKP|DP[_-]?L\d|L1[1-9]_)/i.test(name.trim());

/**
 * Commandes d'impression d'une série d'étiquettes (protocole Luck Jingle) :
 * activation (10 FF F1 03), réveil (12 octets nuls), noirceur, recherche du début d'étiquette (1F 11 51),
 * chaque étiquette en image (GS v 0) suivie de « étiquette suivante » (1D 0C), fin (1F 11 50, 10 FF F1 45).
 */
export function encodeLuck(images: HTMLCanvasElement[], density: 0 | 1 | 2 = 2): Uint8Array {
  const out: number[] = [0x10, 0xff, 0xf1, 0x03, ...new Array(12).fill(0), 0x10, 0xff, 0x10, 0x00, density, 0x1f, 0x11, 0x51];
  for (const cv of images) {
    const { bytesPerRow, rows, data } = canvasBitsMsb(cv);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8, ...data);
    out.push(0x1d, 0x0c);
  }
  out.push(0x1f, 0x11, 0x50, 0x10, 0xff, 0xf1, 0x45);
  return new Uint8Array(out);
}

/** Étiquettes pour une imprimante à tickets (papier continu) : les unes sous les autres, à plat, séparées par un trait. */
export function labelsOnRoll(labels: LabelData[], widthDots: number, size: LabelSize): HTMLCanvasElement {
  const scale = Math.min(1.5, (widthDots - 16) / (size.lengthMm * DOTS_PER_MM));
  const L = Math.round(size.lengthMm * DOTS_PER_MM * scale), C = Math.round(size.crossMm * DOTS_PER_MM * scale);
  const gap = 24;
  const cv = document.createElement('canvas');
  cv.width = widthDots; cv.height = labels.length * (C + gap);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  labels.forEach((l, i) => {
    const y = i * (C + gap);
    g.drawImage(drawLabel(l, L, C), Math.round((widthDots - L) / 2), y);
    g.fillStyle = '#000';
    for (let x = 8; x < widthDots - 8; x += 12) g.fillRect(x, y + C + gap / 2, 6, 1); // trait pointillé pour couper
  });
  return cv;
}
