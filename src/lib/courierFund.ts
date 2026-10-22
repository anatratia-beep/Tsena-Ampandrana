// Caisse frais d'un livreur dont les frais vont à la caisse (ex. Toky) : suivi à part, pour vérifier, sans toucher à la
// caisse ni à la trésorerie. Entrées automatiques = frais facturés de ses livraisons terminées (jour de départ) ;
// mouvements saisis à la main = dépenses (carburant, réparation moto…), sorties d'argent, rectifications (+ / −).
import { all, remove, save } from './db';
import { audit, currentUser } from './auth';
import { dayOf } from './money';
import { isPickupZone, isWalkIn, type Order } from './orders';

export type FundKind = 'expense' | 'out' | 'fix';
export const FUND_KINDS: Record<FundKind, string> = { expense: 'Dépense', out: 'Sortie d’argent', fix: 'Rectification' };
/** amount signé : négatif pour une dépense, une sortie ou une rectification en moins. */
export interface FundMove { id: string; courierId: string; day: string; kind: FundKind; amount: number; label: string; userName?: string; createdAt?: string }

const CLOSED = ['delivered', 'partial', 'refused'];
/** Frais facturés par jour de départ (livraisons terminées), du jour `from` au jour `to` inclus. */
export function fundFees(courierId: string, from: string, to: string) {
  const days = new Map<string, { count: number; fees: number }>();
  for (const o of all<Order>('orders')) {
    if (o.courierId !== courierId || !o.dispatchedAt || !CLOSED.includes(o.status) || isWalkIn(o) || isPickupZone(o.zoneId)) continue;
    const d = dayOf(o.dispatchedAt);
    if (d < from || d > to) continue;
    const fee = o.feeCharged ?? o.deliveryFee ?? 0;
    const e = days.get(d) ?? { count: 0, fees: 0 }; e.count++; e.fees += fee; days.set(d, e);
  }
  return days;
}
export const fundMoves = (courierId: string, from: string, to: string) =>
  all<FundMove>('courierFund').filter((m) => m.courierId === courierId && m.day >= from && m.day <= to).sort((a, b) => a.day.localeCompare(b.day) || (a.createdAt || '').localeCompare(b.createdAt || ''));

/** Lignes du relevé (frais du jour + mouvements), entrées, sorties et solde à la fin de la période (depuis le début). */
export function fundStatement(courierId: string, from: string, to: string) {
  const sum = (f: string, t: string) => { let x = 0; for (const v of fundFees(courierId, f, t).values()) x += v.fees; for (const m of fundMoves(courierId, f, t)) x += m.amount; return x; };
  const start = sum('0000-01-01', prevDay(from));
  const lines: { day: string; label: string; amount: number; move?: FundMove }[] = [];
  for (const [day, v] of fundFees(courierId, from, to)) lines.push({ day, label: `Frais de ${v.count} livraison(s)`, amount: v.fees });
  for (const m of fundMoves(courierId, from, to)) lines.push({ day: m.day, label: `${FUND_KINDS[m.kind]}${m.label ? ` : ${m.label}` : ''}`, amount: m.amount, move: m });
  lines.sort((a, b) => a.day.localeCompare(b.day) || (a.move ? 1 : 0) - (b.move ? 1 : 0));
  const inn = lines.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0), out = lines.filter((l) => l.amount < 0).reduce((t, l) => t - l.amount, 0);
  return { start, lines, in: inn, out, end: start + inn - out };
}
const prevDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function addFundMove(m: Omit<FundMove, 'id' | 'userName'>, courierName: string) {
  await save('courierFund', { ...m, userName: currentUser()?.fullName });
  await audit('Caisse frais livreur', `${courierName} : ${FUND_KINDS[m.kind]} ${m.amount} Ar${m.label ? ` (${m.label})` : ''} le ${m.day}`);
}
export async function removeFundMove(m: FundMove, courierName: string) {
  await remove('courierFund', m.id);
  await audit('Caisse frais livreur', `${courierName} : mouvement supprimé (${FUND_KINDS[m.kind]} ${m.amount} Ar, ${m.day})`);
}
