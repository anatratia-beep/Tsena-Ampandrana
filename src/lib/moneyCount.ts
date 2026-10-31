// Argent réellement reçu dans la journée, saisi à la main par le responsable (espèces comptées, MVola / Orange Money /
// Airtel Money vus sur les téléphones de la boutique), pour le comparer aux chiffres calculés par l'application.
// Contrôle seulement : ne change aucun calcul.
import { get, save, type BaseRecord } from './db';
import { audit, currentUser } from './auth';

export type CountField = 'cash' | 'mvola' | 'orange' | 'airtel';
export const COUNT_LABELS: Record<CountField, string> = { cash: 'Espèces', mvola: 'MVola', orange: 'Orange Money', airtel: 'Airtel Money' };
export interface MoneyCount extends BaseRecord {
  date: string; cash?: number; mvola?: number; orange?: number; airtel?: number; byName?: string; at?: string;
  /** Calcul saisi (ex. « =20000+15000+3500 »), gardé pour pouvoir le relire. */
  formulas?: Partial<Record<CountField, string>>;
  /** Solde réellement affiché sur chaque téléphone (MVola / Orange / Airtel), noté à la main (ex. en fin de compte). */
  soldes?: Partial<Record<'mvola' | 'orange' | 'airtel', number>>;
}

/**
 * Montant saisi comme dans Excel : « 20000 », « 20 000 Ar », « =20000+15000+3500 », « 3*5000 », « (20000+5000)-3000 ».
 * Seulement + − × ÷ et parenthèses (pas de code exécuté). undefined si la saisie n'est pas un calcul valide.
 */
export function parseFormula(input: string): number | undefined {
  const t = input.trim().replace(/^=/, '').replace(/ar\b/gi, '').replace(/[\s\u00a0\u202f.,]/g, '').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!t || /[^\d+\-*/()]/.test(t)) return undefined;
  let i = 0;
  const num = (): number => {
    if (t[i] === '(') { i++; const v = sum(); if (t[i] !== ')') throw 0; i++; return v; }
    if (t[i] === '-') { i++; return -num(); }
    if (t[i] === '+') { i++; return num(); }
    const m = /^\d+/.exec(t.slice(i)); if (!m) throw 0; i += m[0].length; return Number(m[0]);
  };
  const prod = (): number => { let v = num(); while (t[i] === '*' || t[i] === '/') { const op = t[i++]; const r = num(); if (op === '/' && r === 0) throw 0; v = op === '*' ? v * r : v / r; } return v; };
  const sum = (): number => { let v = prod(); while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const r = prod(); v = op === '+' ? v + r : v - r; } return v; };
  try { const v = sum(); return i === t.length && isFinite(v) ? Math.round(v) : undefined; } catch { return undefined; }
}


export const moneyCountId = (date: string) => `mc_${date}`;
export const moneyCountOf = (date: string) => get<MoneyCount>('moneyCounts', moneyCountId(date));

/** Enregistre (ou efface avec `null`) le montant réellement reçu pour un moyen de paiement ce jour-là. */
export async function setMoneyCount(date: string, field: CountField, amount: number | null, formula?: string) {
  if (amount != null && (!(amount >= 0) || !isFinite(amount))) throw new Error('Montant invalide.');
  const me = currentUser();
  const formulas = { ...(moneyCountOf(date)?.formulas || {}), [field]: formula && /[+\-*/x×÷()]/i.test(formula.replace(/^=/, '').trim().slice(1)) ? formula.trim() : undefined };
  await save('moneyCounts', { id: moneyCountId(date), date, [field]: amount ?? undefined, formulas, byName: me?.fullName, at: new Date().toISOString() } as Partial<MoneyCount>);
  await audit('Argent reçu (contrôle)', `${date} : ${COUNT_LABELS[field]} ${amount == null ? 'effacé' : `${Math.round(amount).toLocaleString('fr-FR')} Ar`}`, 'moneyCounts', moneyCountId(date), 'medium');
}

/** Enregistre (ou efface avec `null`) le solde lu sur le téléphone ce jour-là. Contrôle seulement : ne change aucun calcul. */
export async function setPhoneSolde(date: string, field: 'mvola' | 'orange' | 'airtel', amount: number | null) {
  if (amount != null && (!(amount >= 0) || !isFinite(amount))) throw new Error('Montant invalide.');
  const me = currentUser();
  const soldes = { ...(moneyCountOf(date)?.soldes || {}), [field]: amount ?? undefined };
  await save('moneyCounts', { id: moneyCountId(date), date, soldes, byName: me?.fullName, at: new Date().toISOString() } as Partial<MoneyCount>);
  await audit('Solde téléphone (contrôle)', `${date} : solde ${COUNT_LABELS[field]} ${amount == null ? 'effacé' : `${Math.round(amount).toLocaleString('fr-FR')} Ar`}`, 'moneyCounts', moneyCountId(date), 'medium');
}
