// Codes article (QR) et numéros de série par pièce.
// - Code d'étiquette d'une variante (ex. A00042) : un code court et unique, imprimé en QR sur l'étiquette « article ».
// - Numéro de série (ex. LP1B22-00012) : un par pièce, pour les articles « suivis par numéro de série »
//   (garantie, appareils). Créés à l'entrée en stock, marqués vendus à la sortie (scannés ou, sinon, les plus anciens).
import { all, get, getMeta, nowIso, save, type BaseRecord } from './db';
import { stockOf, type Product, type Variant } from './catalog';

export type SerialStatus = 'stock' | 'sold' | 'out';
export interface Serial extends BaseRecord {
  serial: string;
  variantId: string;
  productId: string;
  status: SerialStatus;
  inAt: string;
  inRef?: string;      // type d'entrée : initial, reception, inventory, generated…
  outAt?: string;
  outRef?: string;     // type de sortie : sale, dispatch, adjust…
  orderId?: string;
  printedAt?: string;
}
export const SERIAL_STATUS: Record<SerialStatus, string> = { stock: 'En stock', sold: 'Vendu', out: 'Sorti (casse, perte…)' };

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
/** Préfixe des numéros de série d'un article : son code, en lettres et chiffres (6 au plus). */
export const serialPrefix = (p?: Product) => (norm(p?.code ?? '').replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SN');

/** Prochain numéro « préfixe-[appareil]00001 » : deux appareils hors ligne ne créent jamais le même. */
function nextSeq(prefix: string, taken: Iterable<string>) {
  const dev = getMeta<string>('deviceCode', '');
  const re = new RegExp(`^${prefix}-${dev}(\\d+)$`);
  let max = 0;
  for (const s of taken) { const m = re.exec(s); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return (n: number) => `${prefix}-${dev}${String(max + n).padStart(5, '0')}`;
}

export const allSerials = () => all<Serial>('serials').filter((s) => !s.deleted);
export const serialsOf = (variantId: string, status?: SerialStatus) =>
  allSerials().filter((s) => s.variantId === variantId && (!status || s.status === status)).sort((a, b) => a.inAt.localeCompare(b.inAt) || a.serial.localeCompare(b.serial));
export function findSerial(code: string) {
  const n = norm(code);
  return get<Serial>('serials', n) ?? allSerials().find((s) => norm(s.serial) === n);
}
export const isTracked = (p?: Product) => !!p?.serialTracked;

/** Crée `n` numéros de série en stock pour une variante. */
export async function createSerials(variantId: string, n: number, inRef: string, at = nowIso()): Promise<string[]> {
  if (n <= 0) return [];
  const v = get<Variant>('variants', variantId);
  const p = v && get<Product>('products', v.productId);
  if (!v || !p) return [];
  const prefix = serialPrefix(p);
  const make = nextSeq(prefix, allSerials().map((s) => s.serial));
  const list = Array.from({ length: n }, (_, i) => make(i + 1));
  await save('serials', list.map((serial) => ({ id: serial, serial, variantId, productId: p.id, status: 'stock' as const, inAt: at, inRef })));
  return list;
}

/** Numéros manquants : stock actuel − numéros en stock (articles suivis seulement). */
export function missingSerials(variantId: string) {
  const v = get<Variant>('variants', variantId);
  if (!v || !isTracked(get<Product>('products', v.productId))) return 0;
  return Math.max(0, Math.floor(stockOf(variantId)) - serialsOf(variantId, 'stock').length);
}
export async function fillMissingSerials(variantIds: string[]) {
  let made = 0;
  for (const id of variantIds) { const n = missingSerials(id); if (n) made += (await createSerials(id, n, 'generated')).length; }
  return made;
}

const IN_TYPES = new Set(['initial', 'reception', 'inventory', 'adjust']);
const OUT_TYPES = new Set(['sale', 'dispatch', 'inventory', 'adjust']);
const BACK_TYPES = new Set(['return', 'delivery_return', 'exchange_in']);

/**
 * Suit les mouvements de stock des articles suivis : entrée → nouveaux numéros, sortie → numéros scannés
 * (m.serials) puis les plus anciens en stock, retour → numéros de la même commande remis en stock.
 * Renvoie les numéros concernés par chaque mouvement (gardés sur le mouvement, pour l'historique).
 */
export interface MoveLike { variantId: string; qty: number; type: string; at?: string; refType?: string; refId?: string; serials?: string[] }
export async function serialsForMoves(moves: MoveLike[]) {
  const updates: Partial<Serial>[] = [];
  const used = new Set<string>();
  for (const m of moves) {
    const v = get<Variant>('variants', m.variantId);
    const p = v && get<Product>('products', v.productId);
    if (!isTracked(p)) continue;
    const at = m.at ?? nowIso();
    if (m.qty > 0 && IN_TYPES.has(m.type)) {
      m.serials = await createSerials(m.variantId, Math.floor(m.qty), m.type, at);
    } else if (m.qty < 0 && OUT_TYPES.has(m.type)) {
      const need = Math.floor(-m.qty);
      const inStock = serialsOf(m.variantId, 'stock').filter((s) => !used.has(s.serial));
      const chosen = (m.serials ?? []).map((c) => inStock.find((s) => norm(s.serial) === norm(c))).filter(Boolean) as Serial[];
      for (const s of inStock) { if (chosen.length >= need) break; if (!chosen.includes(s)) chosen.push(s); }
      const status: SerialStatus = m.type === 'sale' || m.type === 'dispatch' ? 'sold' : 'out';
      for (const s of chosen.slice(0, need)) { used.add(s.serial); updates.push({ id: s.id, status, outAt: at, outRef: m.type, orderId: m.refType === 'order' ? m.refId : undefined }); }
      m.serials = chosen.slice(0, need).map((s) => s.serial);
    } else if (m.qty > 0 && BACK_TYPES.has(m.type)) {
      const back = allSerials().filter((s) => s.variantId === m.variantId && s.status === 'sold' && m.refId && s.orderId === m.refId && !used.has(s.serial));
      const take = back.slice(-Math.floor(m.qty));
      for (const s of take) { used.add(s.serial); updates.push({ id: s.id, status: 'stock', outAt: undefined, outRef: undefined, orderId: undefined }); }
      if (take.length < m.qty) take.push(...(await createSerials(m.variantId, Math.floor(m.qty) - take.length, m.type, at)).map((x) => ({ serial: x }) as Serial));
      m.serials = take.map((s) => s.serial);
    }
  }
  if (updates.length) await save('serials', updates);
}

/** Garantie restante d'une pièce vendue (en jours, négatif si terminée). */
export function warrantyEnd(s: Serial) {
  const p = get<Product>('products', s.productId);
  if (!p?.warrantyMonths || !s.outAt || s.status !== 'sold') return undefined;
  const d = new Date(s.outAt); d.setMonth(d.getMonth() + p.warrantyMonths);
  return d.toISOString();
}

// ---------- Code d'étiquette des variantes ----------
/** Code court d'une variante pour le QR de l'étiquette article (créé la première fois). */
export async function ensureLabelCodes(variantIds: string[]) {
  const dev = getMeta<string>('deviceCode', '');
  const re = new RegExp(`^A${dev}(\\d+)$`);
  let max = 0;
  for (const v of all<Variant>('variants')) { const m = re.exec(String(v.labelCode ?? '')); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  const todo = [...new Set(variantIds)].map((id) => get<Variant>('variants', id)).filter((v): v is Variant => !!v && !v.labelCode);
  if (todo.length) await save('variants', todo.map((v, i) => ({ id: v.id, labelCode: `A${dev}${String(max + i + 1).padStart(5, '0')}` })));
  return variantIds.map((id) => get<Variant>('variants', id)?.labelCode as string);
}
export function findByLabelCode(code: string) {
  const n = norm(code);
  return all<Variant>('variants').find((v) => v.labelCode && norm(v.labelCode) === n);
}

// ---------- Contenu des QR codes ----------
/** Adresse de base de l'application (pour qu'un client qui scanne arrive sur la page de garantie). */
export const appBase = () => (typeof location !== 'undefined' ? location.origin + location.pathname : '');
export const serialQr = (serial: string) => `${appBase()}?s=${encodeURIComponent(serial)}`;
/** Ce qu'un code scanné désigne : un numéro de série, un code d'étiquette, un code article ou SKU. */
export function readScan(raw: string): { serial?: Serial; variant?: Variant; text: string } {
  let text = raw.trim();
  try { const u = new URL(text); const s = u.searchParams.get('s') ?? u.searchParams.get('a'); if (s) text = s; } catch { /* pas une adresse */ }
  const serial = findSerial(text);
  if (serial) return { serial, variant: get<Variant>('variants', serial.variantId), text };
  const variant = findByLabelCode(text);
  if (variant) return { variant, text };
  return { text };
}
