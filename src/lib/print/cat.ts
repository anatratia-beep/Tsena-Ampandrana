/**
 * Mini imprimantes « Tiny Print » / « iPrint » (X6h, GB01, GT01, MX06…) : imprimantes thermiques 58 mm (384 points)
 * en Bluetooth basse consommation, qui ne parlent pas ESC/POS. Elles n'impriment que des images : le ticket est
 * dessiné, puis envoyé ligne par ligne.
 *
 * Trame : 51 78 <commande> 00 <longueur sur 2 octets> <données> <CRC-8 des données> FF.
 * Service Bluetooth 0xAE30 : écriture sur 0xAE01, l'imprimante demande des pauses sur 0xAE02 (« AE … 10 » : pause,
 * « AE … 00 » : reprise) quand sa mémoire est pleine.
 */

export const CAT_SERVICE = '0000ae30-0000-1000-8000-00805f9b34fb';
export const CAT_WRITE = '0000ae01-0000-1000-8000-00805f9b34fb';
export const CAT_NOTIFY = '0000ae02-0000-1000-8000-00805f9b34fb';
export const CAT_DOTS = 384; // largeur d'impression en points (48 octets par ligne)

/** Noms Bluetooth de ces mini imprimantes (ex. « X6h-5306 », « GB01 », « MX06 »). */
export const isCatName = (name?: string | null) =>
  !!name && /^(X[5-9][a-z]?|GB0[1-4]|GT0[1-9]|MX0[5-9]|MX1[01]|YT0[12]|MXTP-?\d*)([-_ ]|$)/i.test(name.trim());

const CRC = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c; }
  return t;
})();
export function crc8(data: ArrayLike<number>): number { let c = 0; for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff]; return c; }
export function frame(cmd: number, data: ArrayLike<number>): number[] {
  const d = Array.from(data);
  return [0x51, 0x78, cmd, 0x00, d.length & 0xff, d.length >> 8, ...d, crc8(d), 0xff];
}

const LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];
/** Petite demande d'état : sert à vérifier / garder la liaison sans rien imprimer. */
export const catStateFrame = () => new Uint8Array(frame(0xa3, [0x00]));

/** Image noir et blanc → lignes de 48 octets (bit de poids faible = point de gauche). */
export function canvasRows(ctx: CanvasRenderingContext2D, width: number, height: number, threshold = 170): Uint8Array[] {
  const px = ctx.getImageData(0, 0, width, height).data;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(CAT_DOTS / 8);
    for (let x = 0; x < Math.min(width, CAT_DOTS); x++) {
      const i = (y * width + x) * 4;
      const lum = px[i + 3] < 16 ? 255 : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < threshold) row[x >> 3] |= 1 << (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

export interface CatOpts { feedMm?: number; copies?: number; energy?: number; speed?: number }
/** Commandes complètes pour imprimer ces lignes ; l'espace blanc de la fin est une avance du papier, après le dessin. */
export function encodeCat(rows: Uint8Array[], o: CatOpts = {}): Uint8Array {
  const energy = o.energy ?? 0x3000;
  const out: number[] = [];
  out.push(...frame(0xa3, [0x00]));                          // état (réveille l'imprimante)
  out.push(...frame(0xa4, [0x32]));                          // qualité 200 dpi
  out.push(...frame(0xbd, [o.speed ?? 32]));                 // vitesse
  out.push(...frame(0xaf, [energy & 0xff, energy >> 8]));    // chauffe (noirceur)
  out.push(...frame(0xbe, [0x01]));                          // appliquer
  out.push(...frame(0xa9, [0x00]));
  for (let c = 0; c < Math.max(1, o.copies ?? 1); c++) {
    out.push(...frame(0xa6, LATTICE_START));
    // Chaque ligne est envoyée, même blanche : le X6h ignore l'avance du papier (A1) pendant un dessin,
    // et les lignes de texte se superposaient (photo du 26/10 : logo net, texte écrasé).
    for (const r of rows) out.push(...frame(0xa2, r));
    out.push(...frame(0xa6, LATTICE_END));
    let feed = Math.round(Math.max(0, o.feedMm ?? 20) * 8); // 8 lignes par mm
    out.push(...frame(0xbd, [8]));
    while (feed > 0) { const n = Math.min(255, feed); out.push(...frame(0xa1, [n, 0x00])); feed -= n; }
  }
  out.push(...frame(0xa3, [0x00]));
  return new Uint8Array(out);
}
