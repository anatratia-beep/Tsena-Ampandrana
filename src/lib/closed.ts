// Semaines clôturées par un versement au patron : on ne peut plus y ajouter ni y supprimer de dépense ou de vente
// sur place (le montant versé ne doit plus changer après coup).
import { all, bizNow, get, type BaseRecord } from './db';

export interface Payout extends BaseRecord {
  weekStart: string;       // lundi (AAAA-MM-JJ)
  weekEnd: string;         // samedi
  sales: number;           // total des ventes de la semaine (retours déduits)
  expenses: number;        // total des dépenses de la semaine
  expected: number;        // ventes − dépenses
  amount: number;          // montant réellement remis au patron
  account: string;         // compte d'où sort l'argent (caisse espèces par défaut)
  gap: number;             // montant remis − montant attendu
  note?: string;
  byId?: string; byName?: string; at: string; device?: string;
  perPage: { pageId: string; name: string; sales: number }[];
  expenseIds: string[];
  moveId?: string;         // mouvement de trésorerie « versement au patron »
  status: 'paid' | 'cancelled';
  cancelledBy?: string; cancelledAt?: string; cancelReason?: string;
}

export const payoutId = (monday: string) => `po_${monday}`;
const mondayOfYmd = (ymd: string) => { const d = new Date(`${ymd}T12:00:00`); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Versement validé couvrant ce jour (lundi → samedi), s'il y en a un. */
export function closedBy(ymd: string): Payout | undefined {
  if (!ymd) return undefined;
  const p = all<Payout>('payouts').find((x) => x.id === payoutId(mondayOfYmd(ymd)) && x.status === 'paid');
  return p && ymd >= p.weekStart && ymd <= p.weekEnd ? p : undefined;
}
/**
 * Dépense espèces du lundi (sauf frais de livraison) : comptée dans la semaine précédente, clôturée le samedi et
 * versée au patron le mardi — sauf si cette semaine était déjà versée quand la dépense a été saisie.
 * Renvoie le lundi de la semaine où la dépense compte pour le versement au patron.
 */
export function expenseWeek(m: { type: string; account: string; at: string; createdAt?: string; label?: string; categoryId?: string }): string {
  const day = localDay(m.at); const mon = mondayOfYmd(day);
  if (m.type !== 'expense' || m.account !== 'cash' || day !== mon) return mon;
  const cat = m.categoryId ? get<{ name?: string }>('financeCategories', m.categoryId)?.name ?? '' : '';
  if (/livr/i.test(`${m.label ?? ''} ${cat}`)) return mon;
  const d = new Date(`${mon}T12:00:00`); d.setDate(d.getDate() - 7);
  const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const p = all<Payout>('payouts').find((x) => x.id === payoutId(prev) && x.status === 'paid');
  return p && p.at <= (m.createdAt || m.at) ? mon : prev;
}
/** Jour où compte une dépense pour le versement au patron : le samedi précédent pour une dépense du lundi reportée. */
export function expenseDay(m: Parameters<typeof expenseWeek>[0]): string {
  const day = localDay(m.at); const w = expenseWeek(m);
  if (w === mondayOfYmd(day)) return day;
  const d = new Date(`${w}T12:00:00`); d.setDate(d.getDate() + 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Dépense : refusée si la semaine où elle compte (voir expenseWeek) est clôturée. */
export function assertExpenseOpen(m: Parameters<typeof expenseWeek>[0], what: string) {
  assertOpen(localDay(m.at), what);
  const w = expenseWeek(m); if (w !== mondayOfYmd(localDay(m.at))) assertOpen(w, what);
}
export function assertOpen(ymd: string, what: string) {
  const p = closedBy(ymd);
  if (p) throw new Error(`${what} impossible : la semaine du ${fr(p.weekStart)} au ${fr(p.weekEnd)} est clôturée (versement au patron validé le ${fr(p.at.slice(0, 10))} par ${p.byName ?? '?'}).`);
}
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Refuse une opération datée d'aujourd'hui (date de travail) si la semaine est déjà versée. */
export const assertOpenNow = (what: string) => assertOpen(localDay(bizNow()), what);
export const assertOpenAt = (iso: string, what: string) => assertOpen(localDay(iso), what);
const fr = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
