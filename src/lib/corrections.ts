// Corrections d'erreurs de saisie (super-admin et gérant) : annuler une vente ou une commande déjà terminée,
// corriger les quantités et prix d'une vente sur place, annuler une réception ou un mouvement de stock.
//
// Règle du stock : on ne recalcule jamais « à la main ». On additionne tous les mouvements déjà enregistrés pour
// l'opération, puis on ajoute le mouvement inverse exact. Le stock revient donc exactement à ce qu'il était, quel que
// soit le chemin suivi (vente sur place, livraison, retour, choix gardés, échange…). Tout reste dans l'historique.
import { all, bizNow, get, newId, save } from './db';
import { audit, currentUser } from './auth';
import { addMoves, type StockMove } from './catalog';
import { assertOpenAt } from './closed';
import { isWalkIn, type Order, type OrderLine, type PayMethod, type Payment } from './orders';
import type { Purchase, Reception } from './purchases';
import type { PurchaseStatus } from './catalog';
import { pointBefore } from './restorePoints';

/** Statut d'un achat après annulation d'une réception. */
function statusAfterReceptionLines(prev: PurchaseStatus, lines: Purchase['lines']): PurchaseStatus {
  if (lines.every((l) => (l.qtyReceived || 0) >= l.qtyOrdered)) return 'received';
  if (lines.some((l) => (l.qtyReceived || 0) > 0)) return 'partial';
  return prev === 'received' || prev === 'partial' ? 'arrived' : prev;
}

/** Solde des mouvements de stock d'une opération, par variante (− : sorti du stock, + : entré). */
export function netMoves(refType: string, refId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of all<StockMove>('stockMoves')) if (x.refType === refType && x.refId === refId) m.set(x.variantId, (m.get(x.variantId) ?? 0) + x.qty);
  for (const [k, v] of m) if (!v) m.delete(k);
  return m;
}

/** Remet le stock comme avant l'opération : un mouvement inverse par variante. */
async function reverseStock(refType: string, refId: string, label: string) {
  const net = netMoves(refType, refId);
  const at = bizNow();
  await addMoves([...net.entries()].map(([variantId, q]) => ({ variantId, qty: -q, type: (-q > 0 ? 'return' : 'adjust') as StockMove['type'], refType, refId, reason: `${label} — stock remis comme avant`, at })));
  return [...net.values()].reduce((s, q) => s + Math.abs(q), 0);
}

const shopPaid = (o: Order) => (o.payments || []).filter((p) => p.receivedBy === 'shop').reduce((s, p) => s + p.amount, 0);
const paid = (o: Order) => (o.payments || []).reduce((s, p) => s + p.amount, 0);
const dayIso = (o: Order) => (isWalkIn(o) ? o.createdAt : o.dispatchedAt || o.createdAt);

/**
 * Annule une vente ou une commande, quel que soit son état (même terminée) : stock remis exactement, et, si demandé,
 * l'argent reçu est rendu (paiement négatif, même moyen). Refusé si la semaine de la vente est déjà versée au patron.
 */
export async function voidOrder(o: Order, reason: string, refund?: { amount: number; method: PayMethod }) {
  if (o.status === 'cancelled') throw new Error('Cette commande est déjà annulée.');
  assertOpenAt(dayIso(o), 'Annulation');
  await pointBefore(`annulation de ${o.number}`);
  const pcs = await reverseStock('order', o.id, `${o.number} annulée (${reason})`);
  const at = bizNow();
  const u = currentUser();
  const pays: Payment[] = refund && refund.amount > 0 ? [{ id: newId(), at, amount: -refund.amount, method: refund.method, receivedBy: 'shop', note: `Annulation ${o.number}`, userName: u?.fullName }] : [];
  await save('orders', {
    id: o.id, status: 'cancelled', statusDates: { ...(o.statusDates || {}), cancelled: at }, payments: [...(o.payments || []), ...pays],
    notes: [o.notes, `Annulée : ${reason}`].filter(Boolean).join('\n'),
    events: [...(o.events || []), { at, text: `Annulée (${reason}) : ${pcs} pièce(s) remises en stock${pays.length ? `, ${refund!.amount.toLocaleString('fr-FR')} Ar rendus` : ''}`, user: u?.fullName }],
  });
  await audit('Vente annulée', `${o.number} — ${reason} : ${pcs} pièce(s) remises en stock${pays.length ? `, ${refund!.amount.toLocaleString('fr-FR')} Ar rendus au client` : ''}`, 'orders', o.id);
}
export const refundSuggested = (o: Order) => Math.max(0, isWalkIn(o) ? shopPaid(o) : paid(o));

/**
 * Corrige une vente sur place (quantités, prix, articles retirés) : le stock suit exactement la nouvelle vente.
 * La différence d'argent est enregistrée (rendue au client ou payée en plus) si demandé.
 */
export async function correctWalkInSale(o: Order, lines: OrderLine[], discount: number, reason: string, settle?: { amount: number; method: PayMethod }) {
  if (!isWalkIn(o)) throw new Error('Seules les ventes sur place se corrigent ici.');
  if (o.status === 'cancelled') throw new Error('Vente annulée.');
  assertOpenAt(o.createdAt, 'Correction');
  if (!lines.length) throw new Error('Il reste au moins un article : pour tout enlever, annulez la vente.');
  await pointBefore(`correction de ${o.number}`);
  const at = bizNow();
  const u = currentUser();
  const want = new Map<string, number>();
  for (const l of lines) want.set(l.variantId, (want.get(l.variantId) ?? 0) - l.qty);
  const now = netMoves('order', o.id);
  const ids = new Set([...want.keys(), ...now.keys()]);
  const moves = [...ids].map((variantId) => ({ variantId, qty: (want.get(variantId) ?? 0) - (now.get(variantId) ?? 0) })).filter((m) => m.qty);
  await addMoves(moves.map((m) => ({ ...m, type: (m.qty > 0 ? 'return' : 'sale') as StockMove['type'], refType: 'order', refId: o.id, reason: `${o.number} corrigée (${reason})`, at })));
  const fixed = lines.map((l) => ({ ...l, qtyKept: l.qty, qtyReturned: 0 }));
  const pays: Payment[] = settle && settle.amount ? [{ id: newId(), at, amount: settle.amount, method: settle.method, receivedBy: 'shop', note: `Correction ${o.number}`, userName: u?.fullName }] : [];
  const before = o.lines.map((l) => `${l.qty}×${l.unitPrice.toLocaleString('fr-FR')}`).join(', ');
  const after = fixed.map((l) => `${l.qty}×${l.unitPrice.toLocaleString('fr-FR')}`).join(', ');
  await save('orders', {
    id: o.id, lines: fixed, adjusts: undefined, discount, payments: [...(o.payments || []), ...pays],
    events: [...(o.events || []), { at, text: `Vente corrigée (${reason}) : ${before} → ${after}${o.discount !== discount ? ` ; remise ${o.discount} → ${discount}` : ''}`, user: u?.fullName }],
  });
  await audit('Vente corrigée', `${o.number} — ${reason} : ${before} → ${after}${pays.length ? ` ; ${settle!.amount > 0 ? 'payé en plus' : 'rendu'} ${Math.abs(settle!.amount).toLocaleString('fr-FR')} Ar` : ''}`, 'orders', o.id);
}

/** Annule une réception (erreur de saisie) : stock retiré exactement, quantités reçues des achats remises. */
export async function cancelReception(r: Reception & { cancelled?: boolean }, reason: string) {
  if (r.cancelled) throw new Error('Réception déjà annulée.');
  await pointBefore(`annulation de ${r.number}`);
  const pcs = await reverseStock('reception', r.id, `${r.number} annulée (${reason})`);
  for (const pid of r.purchaseIds) {
    const p = get<Purchase>('purchases', pid); if (!p) continue;
    const lines = p.lines.map((l) => { const got = r.items.filter((i) => i.purchaseId === pid && i.lineId === l.id).reduce((s, i) => s + i.qty, 0); return got ? { ...l, qtyReceived: Math.max(0, (l.qtyReceived || 0) - got) } : l; });
    await save('purchases', { id: p.id, lines, status: statusAfterReceptionLines(p.status, lines) });
  }
  await save('receptions', { id: r.id, cancelled: true, cancelledAt: new Date().toISOString(), cancelledBy: currentUser()?.fullName, cancelReason: reason });
  await audit('Réception annulée', `${r.number} — ${reason} : ${pcs} pièce(s) retirées du stock`, 'receptions', r.id);
}

/** Annule un mouvement de stock saisi à la main (ajustement, inventaire, stock initial) : mouvement inverse. */
export async function cancelMove(m: StockMove, reason: string) {
  if (m.refType && !['inventory', 'adjust'].includes(m.refType)) throw new Error('Ce mouvement vient d’une vente, d’une livraison ou d’une réception : corrigez ou annulez cette opération à la place.');
  if (all<StockMove>('stockMoves').some((x) => x.refType === 'cancel' && x.refId === m.id)) throw new Error('Ce mouvement est déjà annulé.');
  await pointBefore('annulation d’un mouvement de stock');
  await addMoves({ variantId: m.variantId, qty: -m.qty, type: 'adjust', refType: 'cancel', refId: m.id, reason: `Annulation du mouvement du ${new Date(m.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (${reason})`, at: bizNow() });
  await audit('Mouvement de stock annulé', `${m.qty > 0 ? '+' : ''}${m.qty} (${m.reason ?? m.type}) — ${reason}`, 'stockMoves', m.id);
}
export const isMoveCancelled = (m: StockMove) => all<StockMove>('stockMoves').some((x) => x.refType === 'cancel' && x.refId === m.id);
