// Inventaires : comptage physique, enregistrement d'une « fiche d'inventaire » (qui, quand, quelle page, chaque ligne
// comptée avec le stock théorique, le compté et l'écart), historique filtrable, export / import Excel au format du
// fichier « Articles et stock », annulation par le super-admin ou le gérant, et détail des mouvements d'un article
// pour comprendre un écart entre stock réel et stock théorique.
import { all, get, getMeta, save, setMeta, type BaseRecord } from './db';
import { audit, currentUser } from './auth';
import { addMoves, categoryPath, nextNumber, stockOf, variantCost, variantLabel, MOVE_LABELS, type Product, type StockMove, type Variant } from './catalog';
import { rootOf } from './scope';
import { normHeader, writeXlsx, type Sheet } from './xlsx';
import { netMoves } from './corrections';
import type { Order } from './orders';

export interface InventoryLine { variantId: string; sku: string; name: string; pageId: string; theo: number; counted: number; delta: number; unitCost: number }
export interface Inventory extends BaseRecord {
  number: string;          // INV-0001
  at: string;              // date et heure de validation
  byId?: string; byName?: string;
  pageIds: string[];       // pages comptées (vide = toutes)
  note?: string;
  lines: InventoryLine[];  // toutes les lignes comptées (justes et avec écart)
  counted: number; gaps: number; pcsGap: number; valueGap: number;
  source?: 'screen' | 'excel';
  status: 'done' | 'cancelled';
  cancelledBy?: string; cancelledAt?: string; cancelReason?: string;
}

// ---------- Brouillon (comptage en cours, gardé sur l'appareil) ----------
const DRAFT = 'inventoryDraft';
export const loadDraft = (): Record<string, string> => getMeta(DRAFT, {}) ?? {};
export const saveDraft = (d: Record<string, string>) => setMeta(DRAFT, d);

export const productOfVariant = (v: Variant) => get<Product>('products', v.productId);
export const fullName = (v: Variant) => { const p = productOfVariant(v); const l = variantLabel(v); return `${p?.name ?? '?'}${l && l !== 'Unique' && !p?.attrs ? ' — ' + l : ''}`; };

/** Valide un inventaire : enregistre la fiche et corrige le stock des écarts. */
export async function validateInventory(counts: { variantId: string; counted: number }[], opts: { pageIds: string[]; note?: string; source?: 'screen' | 'excel' }) {
  const u = currentUser();
  const lines: InventoryLine[] = counts.map(({ variantId, counted }) => {
    const v = get<Variant>('variants', variantId)!;
    const theo = stockOf(variantId);
    return { variantId, sku: v.sku, name: fullName(v), pageId: rootOf(productOfVariant(v)?.categoryId) || '', theo, counted, delta: counted - theo, unitCost: variantCost(v) };
  });
  if (!lines.length) throw new Error('Aucune ligne comptée.');
  const gapsL = lines.filter((l) => l.delta !== 0);
  const at = new Date().toISOString();
  const [inv] = await save('inventories', {
    number: nextNumber('INV', 'inventories'), at, byId: u?.id, byName: u?.fullName, pageIds: opts.pageIds, note: opts.note || undefined, lines,
    counted: lines.length, gaps: gapsL.length, pcsGap: gapsL.reduce((s, l) => s + l.delta, 0), valueGap: gapsL.reduce((s, l) => s + l.delta * l.unitCost, 0), source: opts.source ?? 'screen', status: 'done',
  } as Partial<Inventory>);
  await addMoves(gapsL.map((l) => ({ variantId: l.variantId, qty: l.delta, type: 'inventory' as const, unitCost: l.unitCost, refType: 'inventory', refId: inv.id, reason: `${(inv as Inventory).number} : théorique ${l.theo}, compté ${l.counted}`, at })));
  const big = Math.abs(gapsL.reduce((s, l) => s + l.delta * l.unitCost, 0));
  await audit('Inventaire', `${(inv as Inventory).number} : ${lines.length} ligne(s) comptée(s), ${gapsL.length} écart(s), ${gapsL.reduce((s, l) => s + l.delta, 0)} pièce(s), valeur ${Math.round(gapsL.reduce((s, l) => s + l.delta * l.unitCost, 0)).toLocaleString('fr-FR')} Ar`, 'inventories', inv.id, big >= 100000 ? 'high' : gapsL.length ? 'medium' : 'low');
  return inv as Inventory;
}

/** Annule un inventaire validé par erreur : le stock revient exactement à ce qu'il était avant. */
export async function cancelInventory(inv: Inventory, reason: string) {
  if (inv.status === 'cancelled') throw new Error('Inventaire déjà annulé.');
  const net = netMoves('inventory', inv.id);
  const at = new Date().toISOString();
  await addMoves([...net.entries()].map(([variantId, q]) => ({ variantId, qty: -q, type: 'adjust' as const, refType: 'inventory', refId: inv.id, reason: `${inv.number} annulé (${reason})`, at })));
  await save('inventories', { id: inv.id, status: 'cancelled', cancelledBy: currentUser()?.fullName, cancelledAt: at, cancelReason: reason });
  await audit('Inventaire annulé', `${inv.number} — ${reason} : stock remis comme avant`, 'inventories', inv.id, 'high');
}

export const inventories = () => all<Inventory>('inventories').sort((a, b) => b.at.localeCompare(a.at));

/** Dernier inventaire validé qui a compté cette variante (avant une date). */
export function lastCount(variantId: string, before?: string): { inv: Inventory; line: InventoryLine } | undefined {
  for (const inv of inventories()) {
    if (inv.status !== 'done' || (before && inv.at >= before)) continue;
    const line = inv.lines.find((l) => l.variantId === variantId);
    if (line) return { inv, line };
  }
  return undefined;
}

/**
 * Pour comprendre un écart : tous les mouvements de l'article depuis son dernier comptage (ou depuis le début),
 * avec la vente / commande liée, et le stock après chaque mouvement.
 */
export function variantHistory(variantId: string, until?: string) {
  const prev = lastCount(variantId, until);
  const from = prev?.inv.at;
  const moves = all<StockMove>('stockMoves').filter((m) => m.variantId === variantId && (!until || m.at <= until)).sort((a, b) => a.at.localeCompare(b.at));
  let stock = 0;
  const rows: { m: StockMove; after: number; label: string; order?: Order }[] = [];
  for (const m of moves) {
    stock += m.qty;
    if (from && m.at <= from) continue;
    const order = m.refType === 'order' && m.refId ? get<Order>('orders', m.refId) : undefined;
    rows.push({ m, after: stock, label: MOVE_LABELS[m.type] ?? m.type, order });
  }
  const sold = rows.filter((r) => r.m.qty < 0 && ['sale', 'dispatch'].includes(r.m.type)).reduce((s, r) => s - r.m.qty, 0);
  const back = rows.filter((r) => r.m.qty > 0 && ['delivery_return', 'return', 'exchange_in'].includes(r.m.type)).reduce((s, r) => s + r.m.qty, 0);
  const inQ = rows.filter((r) => r.m.qty > 0 && ['reception', 'initial'].includes(r.m.type)).reduce((s, r) => s + r.m.qty, 0);
  const adj = rows.filter((r) => ['adjust', 'inventory'].includes(r.m.type)).reduce((s, r) => s + r.m.qty, 0);
  return { prev, rows: rows.reverse(), sold, back, inQ, adj, stock };
}

// ---------- Excel ----------
/** Colonnes communes avec le fichier « Articles et stock » : le fichier exporté peut être réimporté. */
const COLS = [
  { header: 'Catégorie', width: 22 }, { header: 'Code article', width: 16 }, { header: "Nom de l'article", width: 34 }, { header: 'Couleur', width: 12 }, { header: 'Taille', width: 8 },
  { header: 'Code variante', width: 22 }, { header: 'Stock', width: 9, number: true, input: true },
];
const rowOf = (variantId: string, stock: number | '', extra: (string | number)[] = []) => {
  const v = get<Variant>('variants', variantId); const p = v && productOfVariant(v);
  return [categoryPath(p?.categoryId), p?.code ?? '', p?.name ?? '', v?.color ?? '', v?.size ?? '', v?.sku ?? '', stock, ...extra];
};

/** Feuille de comptage (à imprimer ou remplir dans Excel) : colonne « Stock » vide à remplir. */
export async function countSheet(variantIds: string[], withTheo: boolean) {
  return writeXlsx([{
    name: 'Inventaire', columns: [...COLS, ...(withTheo ? [{ header: 'Stock théorique', width: 14, number: true }] : [])],
    rows: variantIds.map((id) => rowOf(id, '', withTheo ? [stockOf(id)] : [])),
  }, { name: "Mode d'emploi", columns: [], rows: [], notes: ['#Feuille de comptage — inventaire', 'Remplissez la colonne « Stock » avec la quantité comptée. Laissez vide ce qui n’a pas été compté.', 'Puis, dans Trésor en ligne : Stock → Inventaire → « Importer le comptage (Excel) ».', 'Ne changez pas le « Code variante » : c’est lui qui retrouve l’article.'] }]);
}

/** Export d'un inventaire validé : même colonnes que l'import articles et stock (Stock = compté), plus le détail. */
export async function inventoryWorkbook(inv: Inventory) {
  return writeXlsx([{
    name: inv.number, columns: [...COLS, { header: 'Stock théorique', width: 14, number: true }, { header: 'Écart', width: 9, number: true }, { header: 'Coût unitaire (Ar)', width: 14, number: true }, { header: 'Valeur écart (Ar)', width: 15, number: true }],
    rows: inv.lines.map((l) => rowOf(l.variantId, l.counted, [l.theo, l.delta, Math.round(l.unitCost), Math.round(l.delta * l.unitCost)])),
  }, { name: 'Informations', columns: [], rows: [], notes: [
    `#${inv.number} — inventaire du ${new Date(inv.at).toLocaleString('fr-FR')}`, `Fait par : ${inv.byName ?? '?'}`, `Lignes comptées : ${inv.counted} · écarts : ${inv.gaps} · pièces : ${inv.pcsGap} · valeur : ${Math.round(inv.valueGap).toLocaleString('fr-FR')} Ar`,
    inv.status === 'cancelled' ? `ANNULÉ le ${new Date(inv.cancelledAt!).toLocaleString('fr-FR')} par ${inv.cancelledBy} : ${inv.cancelReason}` : 'Validé.',
    'La colonne « Stock » est la quantité comptée : ce fichier peut être réimporté (Stock → Inventaire → Importer) pour refaire le même comptage.',
  ] }]);
}

/** Lit un fichier de comptage : « Code variante » (ou « Code article ») + « Stock » (ou « Compté »). */
export function readCounts(sheets: Sheet[]): { counts: { variantId: string; counted: number }[]; unknown: string[]; empty: number } {
  const bySku = new Map(all<Variant>('variants').filter((v) => v.active !== false).map((v) => [normHeader(v.sku), v.id]));
  const byCode = new Map<string, string>();
  for (const p of all<Product>('products')) { const vs = all<Variant>('variants').filter((v) => v.productId === p.id); if (vs.length === 1) byCode.set(normHeader(p.code), vs[0].id); }
  for (const s of sheets) {
    for (let r = 0; r < Math.min(12, s.rows.length); r++) {
      const h = (s.rows[r] || []).map((c) => normHeader(c));
      const cSku = h.findIndex((x) => x === 'code variante' || x === 'reference variante');
      const cCode = h.findIndex((x) => x === 'code article' || x === 'code');
      const cQty = h.findIndex((x) => x === 'stock' || x === 'compte' || x === 'quantite comptee' || x === 'stock compte');
      if (cQty < 0 || (cSku < 0 && cCode < 0)) continue;
      const counts: { variantId: string; counted: number }[] = []; const unknown: string[] = []; let empty = 0;
      for (const row of s.rows.slice(r + 1)) {
        const raw = row?.[cQty];
        if (raw == null || String(raw).trim() === '') { if ((row ?? []).some((c) => c != null && String(c).trim())) empty++; continue; }
        const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
        if (!isFinite(n)) continue;
        const key = cSku >= 0 && row[cSku] != null && String(row[cSku]).trim() ? normHeader(row[cSku]) : cCode >= 0 ? normHeader(row[cCode]) : '';
        const id = bySku.get(key) ?? byCode.get(key);
        if (id) counts.push({ variantId: id, counted: Math.round(n) }); else if (key) unknown.push(String(cSku >= 0 ? row[cSku] ?? row[cCode] : row[cCode]));
      }
      return { counts, unknown, empty };
    }
  }
  throw new Error('Colonnes introuvables : il faut « Code variante » (ou « Code article ») et « Stock » (quantité comptée).');
}
