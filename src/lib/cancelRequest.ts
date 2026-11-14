// Annulation à valider : une commande déjà partie en livraison ou déjà payée (en partie) ne s'annule plus directement
// par le vendeur. Il envoie une demande ; le super-admin, le gérant ou le responsable la valide (annulation faite) ou la
// refuse (rien ne bouge). Évite les annulations par erreur qui faussent le reste à payer et les annulés de la semaine.
import { bizNow, get, save } from './db';
import { audit, currentUser } from './auth';
import { cancelOrder, paidTotal, type CancelRequest, type Order } from './orders';
import { canApproveRectify, cancelledBy } from './rectify';

/** Annulation à faire valider : la commande est en livraison ou le client a déjà payé quelque chose. */
export const cancelNeedsApproval = (o: Order) => o.status === 'out' || paidTotal(o) > 0.5;
/** Peut annuler tout de suite : commande pas encore partie et rien payé, ou super-admin / gérant / responsable. */
export const canCancelDirect = (o: Order) => !cancelNeedsApproval(o) || canApproveRectify();

/** Annule tout de suite si permis, sinon envoie la demande. Renvoie ce qui a été fait. */
export async function cancelOrRequest(o: Order, reason: string): Promise<'done' | 'requested'> {
  if (canCancelDirect(o)) { await cancelOrder(o, reason); return 'done'; }
  await requestCancel(o, reason);
  return 'requested';
}

export async function requestCancel(o: Order, reason: string) {
  if (o.status === 'cancelled') throw new Error('Cette commande est déjà annulée.');
  const u = currentUser();
  const at = bizNow();
  const req: CancelRequest = { at, byId: u?.id, byName: u?.fullName, reason: reason.trim() || 'Sans motif' };
  await save('orders', { id: o.id, cancelRequest: req, events: [...(o.events || []), { at, text: `Annulation demandée (à valider par le gérant ou le responsable) — ${req.reason}`, user: u?.fullName }] });
  await audit('Annulation demandée', `${o.number} — ${req.reason}${paidTotal(o) > 0.5 ? ` — déjà payé ${paidTotal(o).toLocaleString('fr-FR')} Ar` : ''}`, 'orders', o.id, 'high');
}

export async function approveCancel(o: Order) {
  if (!canApproveRectify()) throw new Error('Seuls le super-admin, le gérant ou le responsable peuvent valider une annulation.');
  const fresh = get<Order>('orders', o.id) ?? o;
  const req = fresh.cancelRequest;
  if (!req) throw new Error('Aucune demande d’annulation.');
  if (fresh.status === 'cancelled') { await save('orders', { id: fresh.id, cancelRequest: null as unknown as undefined }); return; }
  const u = currentUser();
  await cancelOrder(fresh, `${req.reason} (demandée par ${req.byName || '?'}, validée par ${u?.fullName || '?'})`);
  // Annulée au nom du vendeur qui l'a demandée : il peut encore « Rectifier une annulation » s'il s'est trompé.
  await save('orders', { id: fresh.id, cancelRequest: null as unknown as undefined, ...(req.byId ? { cancelledById: req.byId, cancelledByName: req.byName } : {}) });
}

export async function rejectCancel(o: Order, why = '') {
  if (!canApproveRectify()) throw new Error('Seuls le super-admin, le gérant ou le responsable peuvent refuser une annulation.');
  const at = bizNow();
  const u = currentUser();
  await save('orders', { id: o.id, cancelRequest: null as unknown as undefined, events: [...(o.events || []), { at, text: `Annulation refusée par ${u?.fullName || '?'}${why ? ` — ${why}` : ''} : la commande continue`, user: u?.fullName }] });
  await audit('Annulation refusée', `${o.number}${why ? ` — ${why}` : ''}`, 'orders', o.id);
}

/** Commandes annulées qui gardent de l'argent payé (ex. payée puis annulée) : à vérifier (rembourser ou rectifier). */
export const cancelledWithPayment = (orders: Order[]) => orders.filter((o) => o.status === 'cancelled' && o.kind !== 'exchange' && paidTotal(o) > 0.5 && !o.paidCancelChecked);
export async function markPaidCancelChecked(o: Order) {
  const u = currentUser();
  await save('orders', { id: o.id, paidCancelChecked: { at: bizNow(), by: u?.fullName } });
  await audit('Annulée avec paiement vérifiée', `${o.number} — payé ${paidTotal(o).toLocaleString('fr-FR')} Ar, annulée par ${cancelledBy(o).name || '?'}`, 'orders', o.id);
}
