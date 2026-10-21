// Rectifier une annulation : une commande (ou vente sur place) annulée par erreur est rouverte avec ce qui a vraiment été
// livré et ce qui a vraiment été annulé, sans tout ressaisir.
//
// Règle du stock (comme les corrections) : on additionne les mouvements déjà enregistrés pour la commande et on ajoute
// seulement la différence avec ce qui doit être sorti (articles livrés). Les mouvements ont un identifiant fixe par
// rectification : refaite deux fois (double clic, deux appareils hors ligne), elle ne retire pas deux fois le stock.
// Les paiements ne sont jamais touchés ici (« Modifier paiement » sert à les corriger) : le reste à payer et les rapports
// (Accueil, Situation par page, À verser au patron) se recalculent seuls à partir de la commande rectifiée.
import { all, bizNow, get, save, type BaseRecord } from './db';
import { audit, can, currentUser, type User } from './auth';
import { SUPERADMIN_ROLE } from './permissions';
import { type StockMove } from './catalog';
import { closedBy } from './closed';
import { netMoves } from './corrections';
import { isWalkIn, keptTotal, ORDER_STATUS, PAY_METHODS, orderTotal, paidTotal, type Order, type OrderLine, type OrderStatus, type PayMethod, type Payment } from './orders';
import { pointBefore } from './restorePoints';

/** Ce que le vendeur indique : pièces livrées (gardées par le client) par ligne, frais facturés, motif. */
export interface RectifyInput {
  kept: Record<string, number>; feeCharged: number; reason: string;
  /** Argent reçu du client pour les articles livrés (comme au retour du livreur) : non enregistré à cause de l'annulation. */
  collected?: { amount: number; method: PayMethod; ref?: string; receivedBy: 'shop' | 'courier' };
}
/**
 * Dates de comptabilisation choisies par le super-admin (AAAA-MM-JJ), même si la semaine est déjà clôturée :
 * saleDay = jour où la vente compte (départ du colis), payDay = jour où l'argent reçu compte. Sans choix : jour de vente
 * d'origine et aujourd'hui pour l'argent.
 */
export interface RectifyDates { saleDay?: string; payDay?: string }
/** Demande envoyée au super-admin quand la semaine est déjà clôturée. */
export interface RectifyRequest extends RectifyInput { at: string; byId?: string; byName?: string }
/** Historique d'une rectification : avant / après, stock bougé, qui l'a demandée et validée. */
export interface Rectification {
  at: string; user?: string; userId?: string; reason: string;
  before: { status: OrderStatus; total: number };
  after: { status: OrderStatus; total: number; kept: { lineId: string; kept: number; qty: number }[]; feeCharged: number };
  stock: { variantId: string; qty: number }[];
  requestedBy?: string; requestedAt?: string; approvedBy?: string;
  /** Dates d'origine et dates choisies (comptabilisation), et semaine(s) déjà clôturée(s) touchée(s). */
  dates?: { saleFrom?: string; saleTo?: string; payDay?: string; closed?: string[] };
}

export const isSuper = (u?: User) => u?.roleId === SUPERADMIN_ROLE;
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Jour de la vente (celui des rapports) : création pour une vente sur place, départ avec le livreur sinon. */
const saleIso = (o: Order) => (isWalkIn(o) ? o.createdAt : o.dispatchedAt || o.statusDates?.cancelled || o.createdAt);
/** Semaine de la vente déjà clôturée (versement au patron validé) ? */
export const rectifyClosed = (o: Order) => closedBy(localDay(saleIso(o)));

/** Qui a annulé : noté sur la commande depuis cette version, sinon retrouvé dans le journal d'activité. */
export function cancelledBy(o: Order): { id?: string; name?: string } {
  if (o.cancelledById || o.cancelledByName) return { id: o.cancelledById, name: o.cancelledByName };
  const a = all<BaseRecord & { entityId?: string; action: string; at: string; userId?: string | null; userName?: string }>('audit')
    .filter((x) => x.entityId === o.id && ['Commande annulée', 'Vente annulée'].includes(x.action))
    .sort((x, y) => y.at.localeCompare(x.at))[0];
  return a ? { id: a.userId ?? undefined, name: a.userName } : { id: o.createdBy, name: o.createdByName };
}

/**
 * Droit de rectifier : le vendeur qui a annulé (ou le gérant, droit « Corriger les erreurs ») le fait directement tant
 * que la semaine n'est pas clôturée ; après la clôture, il envoie une demande que le super-admin valide.
 */
export function rectifyRight(o: Order, u = currentUser()): { mode: 'direct' | 'request' | 'none'; why?: string } {
  if (o.status !== 'cancelled') return { mode: 'none', why: 'La commande n’est pas annulée.' };
  if (o.kind === 'exchange') return { mode: 'none', why: 'Un échange annulé ne se rectifie pas : refaites l’échange depuis la commande d’origine.' };
  if (!u) return { mode: 'none' };
  if (isSuper(u)) return { mode: 'direct' };
  const mine = cancelledBy(o).id === u.id || can(u, 'records.correct');
  if (!mine) return { mode: 'none', why: `Seul le vendeur qui a annulé (${cancelledBy(o).name || '?'}), le gérant ou le super-admin peut rectifier cette annulation.` };
  if (rectifyClosed(o)) return { mode: 'request', why: 'La semaine de cette vente est clôturée (versement au patron validé) : la rectification doit être validée par le super-admin.' };
  return { mode: 'direct' };
}

/** Commande telle qu'elle sera après rectification (aperçu et enregistrement), et mouvements de stock à ajouter. */
export function planRectify(o: Order, r: Pick<RectifyInput, 'kept' | 'feeCharged'>) {
  const lines: OrderLine[] = o.lines.map((l) => {
    const kept = Math.max(0, Math.min(l.qty, Math.round(r.kept[l.id] ?? 0)));
    return { ...l, qtyKept: kept, qtyReturned: l.qty - kept };
  });
  const keptAny = lines.some((l) => (l.qtyKept ?? 0) > 0);
  const allKept = lines.filter((l) => !l.isChoice).every((l) => (l.qtyKept ?? 0) >= l.qty);
  const status: OrderStatus = allKept ? 'delivered' : 'partial';
  // Stock : seules les pièces livrées restent sorties ; le reste est en boutique.
  const want = new Map<string, number>();
  for (const l of lines) want.set(l.variantId, (want.get(l.variantId) ?? 0) - (l.qtyKept ?? 0));
  const now = netMoves('order', o.id);
  const stock = [...new Set([...want.keys(), ...now.keys()])].map((variantId) => ({ variantId, qty: (want.get(variantId) ?? 0) - (now.get(variantId) ?? 0) })).filter((m) => m.qty);
  const after = { ...o, status, lines, feeCharged: isWalkIn(o) ? 0 : Math.max(0, r.feeCharged || 0) } as Order;
  const total = orderTotal(after);
  return { lines, status, keptAny, stock, after, total, items: keptTotal(after), paid: paidTotal(o), rest: total - paidTotal(o) };
}

/** Motif par défaut : le motif n'est pas obligatoire (tout est déjà dans l'historique : qui, quand, quoi). */
const DEFAULT_REASON = 'Annulée par erreur';

const inFlight = new Set<string>();

const ymdOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Même heure locale, autre jour. */
const onDay = (iso: string, ymd: string) => { const d = new Date(iso); const [y, m, dd] = ymd.split('-').map(Number); d.setFullYear(y, m - 1, dd); return d.toISOString(); };
const frDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const c0 = (r: RectifyInput) => !!r.collected && r.collected.amount > 0;
const isYmd = (x?: string) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
/** Jour où la vente compte aujourd'hui (pour pré-remplir la date de comptabilisation). */
export const rectifySaleDay = (o: Order) => ymdOf(saleIso(o));

async function apply(o: Order, r: RectifyInput, req?: RectifyRequest, dates?: RectifyDates) {
  if (inFlight.has(o.id)) throw new Error('Rectification déjà en cours.');
  inFlight.add(o.id);
  try {
    // Toujours repartir de la commande enregistrée : si elle a déjà été rectifiée (autre appareil, double clic), on s'arrête.
    const fresh = get<Order>('orders', o.id);
    if (!fresh || fresh.status !== 'cancelled') throw new Error('Cette commande n’est plus annulée : elle a déjà été rectifiée.');
    const reason = r.reason.trim() || DEFAULT_REASON;
    if (dates && (dates.saleDay || dates.payDay) && !isSuper(currentUser())) throw new Error('Seul le super-admin peut choisir la date de comptabilisation.');
    if (dates?.saleDay && !isYmd(dates.saleDay)) throw new Error('Date de la vente invalide.');
    if (dates?.payDay && !isYmd(dates.payDay)) throw new Error('Date du paiement invalide.');
    const plan = planRectify(fresh, r);
    if (!plan.keptAny) throw new Error('Indiquez au moins un article livré : si rien n’a été livré, l’annulation est juste.');
    await pointBefore(`rectification de l’annulation de ${fresh.number}`);
    const at = bizNow();
    const u = currentUser();
    const n = (fresh.rectifications || []).length + 1;
    const walkIn = isWalkIn(fresh);
    // Identifiant fixe par commande, rectification et article : jamais deux fois le même mouvement de stock.
    await save('stockMoves', plan.stock.map((m) => ({
      id: `rect-${fresh.id}-${n}-${m.variantId}`, variantId: m.variantId, qty: m.qty,
      type: (m.qty < 0 ? (walkIn ? 'sale' : 'dispatch') : walkIn ? 'return' : 'delivery_return') as StockMove['type'],
      refType: 'order', refId: fresh.id, reason: `${fresh.number} — annulation rectifiée (${m.qty < 0 ? 'livré' : 'annulé, remis en stock'})`, at, userId: u?.id, userName: u?.fullName,
    })));
    const cancelAt = fresh.statusDates?.cancelled || at;
    const origDispatch = fresh.dispatchedAt || (walkIn ? fresh.createdAt : cancelAt);
    const origReturn = fresh.returnedAt || (walkIn ? fresh.createdAt : cancelAt);
    // Date de comptabilisation choisie par le super-admin : la vente compte ce jour-là (départ et retour déplacés, mêmes
    // heures) ; la date d'origine reste dans l'historique. Une vente sur place garde sa date (date de création, fixe).
    const moveSale = !!dates?.saleDay && !walkIn && dates.saleDay !== ymdOf(origDispatch);
    const dispatchedAt = moveSale ? onDay(origDispatch, dates!.saleDay!) : origDispatch;
    const returnedAt = moveSale ? onDay(origReturn, dates!.saleDay!) : origReturn;
    const payAt = dates?.payDay && dates.payDay !== ymdOf(at) ? onDay(at, dates.payDay) : at;
    // Semaines déjà versées au patron touchées par la rectification : gardées comme trace (correction après clôture).
    const closed = [...new Set([ymdOf(origDispatch), ymdOf(dispatchedAt), ...(c0(r) ? [ymdOf(payAt)] : [])].map((d) => closedBy(d)).filter(Boolean).map((p) => `${p!.weekStart} → ${p!.weekEnd}`))];
    const beforeTotal = orderTotal(fresh);
    // Argent encaissé pour les articles livrés : daté d'aujourd'hui (reçu maintenant) : pour une vente d'un jour passé, il
    // compte en « 1er / 2ème paiement du reste » et s'ajoute aux espèces à verser du jour. Identifiant fixe : jamais deux fois.
    const c = r.collected;
    const byCourier = c?.receivedBy === 'courier' && !!fresh.courierId && !walkIn;
    const pay: Payment[] = c && c.amount > 0 ? [{
      id: `rect-pay-${fresh.id}-${n}`, at: payAt, amount: Math.round(c.amount), method: c.method, ref: c.ref?.trim() || undefined,
      receivedBy: byCourier ? 'courier' : 'shop', ...(byCourier ? { courierId: fresh.courierId } : {}), userName: u?.fullName, note: 'Encaissé — annulation rectifiée',
    }] : [];
    const payments = [...(fresh.payments || []).filter((x) => !pay.some((y) => y.id === x.id)), ...pay];
    const rec: Rectification = {
      at, user: u?.fullName, userId: u?.id, reason,
      before: { status: 'cancelled', total: beforeTotal },
      after: { status: plan.status, total: plan.total, kept: plan.lines.map((l) => ({ lineId: l.id, kept: l.qtyKept ?? 0, qty: l.qty })), feeCharged: plan.after.feeCharged ?? 0 },
      stock: plan.stock,
      ...(req ? { requestedBy: req.byName, requestedAt: req.at, approvedBy: u?.fullName } : {}),
      ...(moveSale || payAt !== at || closed.length ? { dates: { saleFrom: ymdOf(origDispatch), saleTo: ymdOf(dispatchedAt), payDay: pay.length ? ymdOf(payAt) : undefined, closed: closed.length ? closed : undefined } } : {}),
    };
    const kept = plan.lines.reduce((t, l) => t + (l.qtyKept ?? 0), 0), back = plan.lines.reduce((t, l) => t + (l.qtyReturned ?? 0), 0);
    const text = `Annulation rectifiée${req ? ` (demandée par ${req.byName || '?'}, validée par le super-admin)` : ''} : ${kept} pièce(s) livrée(s), ${back} annulée(s) — ${ORDER_STATUS[plan.status].label}, total ${plan.total.toLocaleString('fr-FR')} Ar${pay.length ? `, encaissé ${pay[0].amount.toLocaleString('fr-FR')} Ar (${PAY_METHODS[pay[0].method]}, ${byCourier ? 'livreur' : 'boutique'}${payAt !== at ? `, compté le ${frDay(ymdOf(payAt))}` : ''})` : ''}${moveSale ? ` — vente comptée le ${frDay(ymdOf(dispatchedAt))} (au lieu du ${frDay(ymdOf(origDispatch))})` : ''}${closed.length ? ` — après clôture (semaine ${closed.join(', ')})` : ''} — ${reason}`;
    await save('orders', {
      id: fresh.id, status: plan.status, lines: plan.lines, feeCharged: plan.after.feeCharged, dispatchedAt, returnedAt, payments,
      statusDates: { ...(fresh.statusDates || {}), [plan.status]: at },
      rectifications: [...(fresh.rectifications || []), rec], rectifyRequest: null as unknown as undefined,
      notes: [fresh.notes, `Annulation rectifiée : ${reason}`].filter(Boolean).join('\n'),
      events: [...(fresh.events || []), { at, text, user: u?.fullName }],
    });
    await audit(closed.length ? 'Annulation rectifiée après clôture' : 'Annulation rectifiée', `${fresh.number} — ${text}`, 'orders', fresh.id, 'high');
  } finally { inFlight.delete(o.id); }
}

/** Rectifie tout de suite (vendeur avant la clôture, gérant, super-admin). */
export async function rectifyCancellation(o: Order, r: RectifyInput, dates?: RectifyDates) {
  const right = rectifyRight(o);
  if (right.mode !== 'direct') throw new Error(right.why || 'Vous ne pouvez pas rectifier cette annulation.');
  await apply(o, r, undefined, dates);
}

/** Après la clôture : la demande attend la validation du super-admin (rien ne bouge avant). */
export async function requestRectify(o: Order, r: RectifyInput) {
  const right = rectifyRight(o);
  if (right.mode === 'none') throw new Error(right.why || 'Vous ne pouvez pas rectifier cette annulation.');
  if (!planRectify(o, r).keptAny) throw new Error('Indiquez au moins un article livré : si rien n’a été livré, l’annulation est juste.');
  const u = currentUser();
  const at = bizNow();
  const req: RectifyRequest = { kept: r.kept, feeCharged: r.feeCharged, reason: r.reason.trim() || DEFAULT_REASON, ...(r.collected?.amount ? { collected: r.collected } : {}), at, byId: u?.id, byName: u?.fullName };
  await save('orders', { id: o.id, rectifyRequest: req, events: [...(o.events || []), { at, text: `Rectification de l’annulation demandée (à valider par le super-admin) — ${req.reason}`, user: u?.fullName }] });
  await audit('Rectification demandée', `${o.number} — ${req.reason}`, 'orders', o.id, 'high');
}

/** Le super-admin valide la demande : la rectification est faite telle que demandée. */
export async function approveRectify(o: Order, dates?: RectifyDates) {
  if (!isSuper(currentUser())) throw new Error('Seul le super-admin peut valider cette rectification.');
  const req = o.rectifyRequest;
  if (!req) throw new Error('Aucune demande de rectification.');
  await apply(o, req, req, dates);
}

export async function rejectRectify(o: Order, why: string) {
  if (!isSuper(currentUser())) throw new Error('Seul le super-admin peut refuser cette rectification.');
  const at = bizNow();
  const u = currentUser();
  await save('orders', { id: o.id, rectifyRequest: null as unknown as undefined, events: [...(o.events || []), { at, text: `Rectification refusée par le super-admin${why ? ` — ${why}` : ''}`, user: u?.fullName }] });
  await audit('Rectification refusée', `${o.number}${why ? ` — ${why}` : ''}`, 'orders', o.id);
}
