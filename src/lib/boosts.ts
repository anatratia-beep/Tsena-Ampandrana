// Boosts publicitaires (Facebook / Meta) : suivi quotidien des résultats théoriques (affichés par Meta)
// et des messages réellement reçus sur chaque page, pour mesurer l'efficacité de chaque boost.
//
// Comme dans le cahier Excel « NBR MESSAGE PAR JOUR » :
// - chaque page a des boosts numérotés 1, 2, 3… dans l'ordre où ils apparaissent dans l'Espace Pubs ;
// - chaque jour, le vendeur recopie pour chaque boost actif la dépense cumulée ($) et le nombre cumulé
//   de conversations (messages théoriques) ;
// - les messages théoriques du jour = valeur du jour − valeur précédente (jamais négatif : une valeur
//   inférieure à la précédente est une erreur de saisie et n'est pas acceptée) ;
// - le vendeur compte aussi les messages réellement reçus sur la page (messages physiques).
import { all, get, save, type BaseRecord } from './db';
import { audit, currentUser, type Role, type User } from './auth';
import type { Category } from './catalog';
import { addDays, dayOf } from './money';
import { isWalkIn, type Order } from './orders';
import { variantPage } from './scope';

export interface Boost extends BaseRecord {
  pageId: string;           // catégorie principale = page Facebook
  slot: number;             // n° dans l'ordre de l'Espace Pubs (1 = le premier de la liste)
  label?: string;           // texte de la publicité, pour le reconnaître
  startDate: string;        // date de lancement (AAAA-MM-JJ)
  dailyBudget?: number;     // budget par jour ($)
  status: 'active' | 'paused' | 'stopped';   // « stopped » : ancien arrêt, traité comme une pause
  stoppedOn?: string;       // ancien arrêt : dernier jour actif
  stopReason?: string;
  /** Périodes de pause (dates incluses ; `to` absent = encore en pause). */
  pauses?: { from: string; to?: string }[];
  createdByName?: string;
}
export interface BoostReading extends BaseRecord {
  boostId: string;
  pageId: string;
  date: string;             // jour de la saisie (AAAA-MM-JJ)
  spend: number;            // dépense cumulée depuis le lancement ($)
  messages: number;         // conversations cumulées depuis le lancement (théorique)
  userName?: string;
}
export interface PageMessages extends BaseRecord {
  pageId: string;
  date: string;
  count: number;            // messages réellement reçus ce jour-là sur la page
  userName?: string;
}

export const STOP_REASONS = ['Peu performant', 'Remplacé par un nouveau boost', 'Budget ou durée terminés', 'Arrêté par Meta / refusé', 'Autre'];

// ---------- Pages ----------
/** Pages = catégories principales (sans parent), par ordre alphabétique. */
export function allPages(): Category[] {
  return all<Category>('categories').filter((c) => !c.parentId && !c.removed).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
export const pageName = (id: string) => get<Category>('categories', id)?.name ?? 'Page supprimée';

// ---------- Boosts ----------
export const boostsOf = (pageId: string) => all<Boost>('boosts').filter((b) => b.pageId === pageId);
/** En pause ce jour-là (pause en cours ou passée, ou ancien « arrêt »). */
export function pausedOn(b: Boost, date: string) {
  if (b.status === 'stopped' && b.stoppedOn && date > b.stoppedOn && !(b.pauses ?? []).length) return true;
  return (b.pauses ?? []).some((p) => p.from <= date && (!p.to || date <= p.to));
}
export const isPaused = (b: Boost) => b.status !== 'active';
/** Boost actif ce jour-là : lancé avant ou ce jour, et pas en pause. */
export const activeOn = (b: Boost, date: string) => b.startDate <= date && !pausedOn(b, date);
export const activeBoosts = (pageId: string, date: string) => boostsOf(pageId).filter((b) => activeOn(b, date)).sort((a, b) => a.slot - b.slot);
export const boostName = (b: Boost) => `Boost ${b.slot}${b.label ? ` — ${b.label}` : ''}`;
/** Nouveau boost : à la fin de la liste. */
export function nextSlot(pageId: string) { return boostsOf(pageId).reduce((m, b) => Math.max(m, b.slot), 0) + 1; }
/** Boosts d'une page dans l'ordre d'affichage (les actifs, puis ceux en pause). */
export const orderedBoosts = (pageId: string) => boostsOf(pageId).sort((a, b) => a.slot - b.slot);

export async function createBoost(d: { pageId: string; slot?: number; label?: string; startDate: string; dailyBudget?: number }) {
  const slot = nextSlot(d.pageId);
  const [b] = await save('boosts', { ...d, slot, status: 'active', createdByName: currentUser()?.fullName });
  await audit('Boost', `${pageName(d.pageId)} : nouveau boost n° ${slot}${d.label ? ` (${d.label})` : ''}, lancé le ${d.startDate}`, 'boosts', b.id);
  return b as Boost;
}

/** Modifier un boost (texte, date de lancement, budget). */
export async function updateBoost(b: Boost, patch: Partial<Pick<Boost, 'label' | 'startDate' | 'dailyBudget'>>) {
  await save('boosts', { id: b.id, ...patch });
  await audit('Boost', `${pageName(b.pageId)} : ${boostName(b)} modifié`, 'boosts', b.id);
}
/** Nouvel ordre d'affichage (glisser-déposer) : les numéros deviennent 1, 2, 3… dans cet ordre. */
export async function reorderBoosts(pageId: string, ids: string[]) {
  const updates = ids.map((id, i) => ({ id, slot: i + 1 })).filter((u) => get<Boost>('boosts', u.id)?.slot !== u.slot);
  if (!updates.length) return;
  await save('boosts', updates);
  await audit('Boost', `${pageName(pageId)} : ordre des boosts changé`, 'boosts', ids[0]);
}
/** Mettre en pause : le boost n'est plus demandé à la saisie à partir de demain (la saisie d'aujourd'hui reste possible). */
export async function pauseBoost(b: Boost, today: string, reason?: string) {
  const from = addDays(today, 1);
  await save('boosts', { id: b.id, status: 'paused', pauses: [...(b.pauses ?? []).filter((p) => p.to), { from }], stopReason: reason || undefined });
  await audit('Boost', `${pageName(b.pageId)} : ${boostName(b)} mis en pause${reason ? ` — ${reason}` : ''}`, 'boosts', b.id);
}
/** Reprendre : actif de nouveau à partir d'aujourd'hui. */
export async function resumeBoost(b: Boost, today: string) {
  let pauses = [...(b.pauses ?? [])];
  if (b.status === 'stopped' && b.stoppedOn && !pauses.length) pauses = [{ from: addDays(b.stoppedOn, 1) }];
  pauses = pauses.map((p) => (p.to ? p : { ...p, to: addDays(today, -1) })).filter((p) => !p.to || p.to >= p.from);
  await save('boosts', { id: b.id, status: 'active', pauses, stopReason: undefined });
  await audit('Boost', `${pageName(b.pageId)} : ${boostName(b)} repris`, 'boosts', b.id);
}
/** Supprimer un boost devenu inutile, avec ses saisies. */
export async function deleteBoost(b: Boost) {
  const rs = all<BoostReading>('boostReadings').filter((r) => r.boostId === b.id);
  if (rs.length) await save('boostReadings', rs.map((r) => ({ id: r.id, deleted: true })));
  await save('boosts', { id: b.id, deleted: true });
  await audit('Boost', `${pageName(b.pageId)} : ${boostName(b)} supprimé (${rs.length} saisie(s))`, 'boosts', b.id);
}
// Anciennes fonctions (compatibilité)
export const stopBoost = (b: Boost, on: string, reason: string) => pauseBoost(b, on, reason);
export const restartBoost = (b: Boost) => resumeBoost(b, dayOf(new Date().toISOString()));

// ---------- Saisies ----------
export const readingId = (boostId: string, date: string) => `br_${boostId}_${date}`;
export const pageMsgId = (pageId: string, date: string) => `pm_${pageId}_${date}`;
export const readingsOf = (boostId: string) => all<BoostReading>('boostReadings').filter((r) => r.boostId === boostId).sort((a, b) => a.date.localeCompare(b.date));
export const readingOn = (boostId: string, date: string) => get<BoostReading>('boostReadings', readingId(boostId, date));
export const prevReading = (boostId: string, date: string) => readingsOf(boostId).filter((r) => r.date < date).pop();
export const nextReading = (boostId: string, date: string) => readingsOf(boostId).find((r) => r.date > date);
export const realOn = (pageId: string, date: string) => get<PageMessages>('pageMessages', pageMsgId(pageId, date));

const fmtD = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const n2 = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/**
 * Contrôle d'une saisie : les valeurs cumulées ne baissent jamais.
 * - égale à la précédente : rien de nouveau (0 message ce jour) ;
 * - plus grande : nouveaux messages ;
 * - plus petite : erreur de saisie, l'enregistrement est refusé.
 */
export function checkReading(boostId: string, date: string, spend: number | undefined, messages: number | undefined): string[] {
  const errs: string[] = [];
  if (messages == null || isNaN(messages)) errs.push('Nombre de messages (conversations) à saisir.');
  else if (messages < 0 || !Number.isInteger(messages)) errs.push('Le nombre de messages doit être un nombre entier positif.');
  if (spend != null && (isNaN(spend) || spend < 0)) errs.push('La dépense ne peut pas être négative.');
  const prev = prevReading(boostId, date);
  const next = nextReading(boostId, date);
  if (prev && messages != null && messages < prev.messages) errs.push(`Erreur de saisie : ${messages} messages, alors que le ${fmtD(prev.date)} il y en avait déjà ${prev.messages}. Le total cumulé reste stable ou augmente, il ne baisse jamais.`);
  if (prev && spend != null && spend < prev.spend - 0.001) errs.push(`Erreur de saisie : dépense ${n2(spend)} $, alors que le ${fmtD(prev.date)} elle était déjà de ${n2(prev.spend)} $. La dépense cumulée ne baisse jamais.`);
  if (next && messages != null && messages > next.messages) errs.push(`Incohérent avec le ${fmtD(next.date)} (${next.messages} messages) : une valeur passée ne peut pas dépasser une valeur plus récente.`);
  if (next && spend != null && spend > next.spend + 0.001) errs.push(`Incohérent avec le ${fmtD(next.date)} (${n2(next.spend)} $).`);
  return errs;
}

/** Enregistre la journée d'une page : un résultat par boost actif + les messages réels. Tout ou rien. */
export async function saveDay(pageId: string, date: string, rows: { boostId: string; spend: number; messages: number }[], real: number) {
  const errors = rows.flatMap((r) => checkReading(r.boostId, date, r.spend, r.messages).map((e) => `${boostName(get<Boost>('boosts', r.boostId)!)} : ${e}`));
  if (real == null || isNaN(real) || real < 0 || !Number.isInteger(real)) errors.push('Messages réels reçus : nombre entier à saisir (0 si aucun).');
  if (errors.length) throw new Error(errors.join('\n'));
  const u = currentUser()?.fullName;
  await save('boostReadings', rows.map((r) => ({ id: readingId(r.boostId, date), boostId: r.boostId, pageId, date, spend: r.spend, messages: r.messages, userName: u })));
  await save('pageMessages', { id: pageMsgId(pageId, date), pageId, date, count: real, userName: u });
  const d = dayStats(pageId, date);
  await audit('Boosts — saisie du jour', `${pageName(pageId)} ${date} : ${d.theo} message(s) théorique(s), ${real} réel(s), dépense ${n2(d.spend)} $`, 'pageMessages', pageMsgId(pageId, date));
}

/** Enregistre une case du tableau : conversations cumulées (et dépense cumulée, facultative) d'un boost un jour donné. */
export async function saveReading(boostId: string, date: string, messages: number | undefined, spend?: number) {
  const b = get<Boost>('boosts', boostId);
  if (!b) throw new Error('Boost introuvable.');
  const cur = readingOn(boostId, date);
  if (messages == null && spend == null) {
    if (cur) await save('boostReadings', { id: cur.id, deleted: true });
    return;
  }
  const m = messages ?? cur?.messages ?? prevReading(boostId, date)?.messages ?? 0;
  const sp = spend ?? cur?.spend ?? prevReading(boostId, date)?.spend ?? 0;
  const errs = checkReading(boostId, date, sp, m);
  if (errs.length) throw new Error(errs.join(' '));
  await save('boostReadings', { id: readingId(boostId, date), boostId, pageId: b.pageId, date, spend: sp, messages: m, userName: currentUser()?.fullName });
}
/** Messages réellement comptés sur la page un jour donné (facultatif ; vide = effacer). */
export async function saveReal(pageId: string, date: string, count: number | undefined) {
  const cur = realOn(pageId, date);
  if (count == null) { if (cur) await save('pageMessages', { id: cur.id, deleted: true }); return; }
  if (count < 0 || !Number.isInteger(count)) throw new Error('Nombre entier positif attendu.');
  await save('pageMessages', { id: pageMsgId(pageId, date), pageId, date, count, userName: currentUser()?.fullName });
}

/** Nouveaux messages (conversations) par page sur une période, d'après les saisies des boosts. */
export function messagesByPage(from: string, to: string) {
  const m = new Map<string, number>();
  for (const x of allDeltas()) if (x.r.date >= from && x.r.date <= to) m.set(x.r.pageId, (m.get(x.r.pageId) ?? 0) + x.messages);
  return m;
}

// ---------- Calculs ----------
/**
 * Ce qui est nouveau ce jour-là = chiffre du jour − chiffre de la saisie précédente (ex. hier 20, aujourd'hui 25 → 5).
 * Première saisie d'un boost :
 * - saisie le jour du lancement : tout compte (le boost part de 0) ;
 * - saisie plus tard (boost déjà en cours, suivi commencé en route) : c'est le POINT DE DÉPART, rien n'est compté ce
 *   jour-là, sinon tout le cumul de l'Espace Pubs depuis le lancement serait compté en un seul jour.
 */
export function readingDelta(r: Pick<BoostReading, 'date' | 'spend' | 'messages' | 'boostId'>, prev?: Pick<BoostReading, 'spend' | 'messages'>, boost?: Pick<Boost, 'startDate'>): { messages: number; spend: number; start: boolean } {
  if (prev) return { messages: Math.max(0, r.messages - prev.messages), spend: Math.max(0, r.spend - prev.spend), start: false };
  const b = boost ?? get<Boost>('boosts', r.boostId);
  if (b && r.date > b.startDate) return { messages: 0, spend: 0, start: true };
  return { messages: Math.max(0, r.messages), spend: Math.max(0, r.spend), start: false };
}
/** Nouveaux messages et dépense d'un boost pour un jour saisi (écart avec la saisie précédente). */
export function boostDelta(boostId: string, date: string): { messages: number; spend: number; reading?: BoostReading; first?: boolean; start?: boolean } {
  const r = readingOn(boostId, date);
  if (!r) return { messages: 0, spend: 0 };
  const p = prevReading(boostId, date);
  const d = readingDelta(r, p);
  return { messages: d.messages, spend: d.spend, reading: r, first: !p, start: d.start };
}
/** Pour chaque saisie de toutes les pages : nouveaux messages et dépense ($) du jour. */
export function allDeltas(): { r: BoostReading; messages: number; spend: number; start: boolean }[] {
  const byBoost = new Map<string, BoostReading[]>();
  for (const r of all<BoostReading>('boostReadings')) { if (!byBoost.has(r.boostId)) byBoost.set(r.boostId, []); byBoost.get(r.boostId)!.push(r); }
  const out: { r: BoostReading; messages: number; spend: number; start: boolean }[] = [];
  for (const [id, rs] of byBoost) {
    const b = get<Boost>('boosts', id);
    rs.sort((a, c) => a.date.localeCompare(c.date));
    let prev: { spend: number; messages: number } | undefined;
    for (const r of rs) {
      out.push({ r, ...readingDelta(r, prev, b ?? { startDate: r.date }) });
      prev = { spend: Math.max(prev?.spend ?? 0, r.spend), messages: Math.max(prev?.messages ?? 0, r.messages) };
    }
  }
  return out;
}

/** Commandes en ligne créées ce jour-là contenant au moins un article de la page. */
export function ordersOn(pageId: string, date: string) {
  return all<Order>('orders').filter((o) => !isWalkIn(o) && o.status !== 'cancelled' && dayOf(o.createdAt) === date && o.lines.some((l) => variantPage(l.variantId) === pageId)).length;
}

export interface DayStats { date: string; theo: number; real?: number; gap?: number; spend: number; orders: number; perBoost: Map<string, number>; spendPerBoost: Map<string, number>; starts: Set<string>; missing: number; entered: boolean }
export function dayStats(pageId: string, date: string): DayStats {
  const perBoost = new Map<string, number>(); const spendPerBoost = new Map<string, number>(); const starts = new Set<string>();
  let theo = 0, spend = 0, missing = 0;
  for (const b of boostsOf(pageId)) {
    const d = boostDelta(b.id, date);
    if (d.reading) { perBoost.set(b.id, d.messages); spendPerBoost.set(b.id, d.spend); theo += d.messages; spend += d.spend; if (d.start) starts.add(b.id); }
    else if (activeOn(b, date)) missing++;
  }
  const real = realOn(pageId, date)?.count;
  return { date, theo, real, gap: real == null ? undefined : real - theo, spend, orders: ordersOn(pageId, date), perBoost, spendPerBoost, starts, missing, entered: real != null || perBoost.size > 0 };
}

export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

// ---------- Performance et décision ----------
export type Verdict = 'good' | 'average' | 'bad' | 'new' | 'none';
export const VERDICT: Record<Verdict, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'brand' }> = {
  good: { label: 'Bon', tone: 'ok' }, average: { label: 'Moyen', tone: 'warn' }, bad: { label: 'Faible', tone: 'danger' },
  new: { label: 'Trop récent', tone: 'brand' }, none: { label: 'Pas de saisie', tone: 'neutral' },
};
export interface BoostPerf {
  b: Boost; days: number; readings: number;
  spend: number; messages: number; cost: number | null;          // sur la période
  last3: number; totalSpend: number; totalMessages: number;        // depuis le lancement
  verdict: Verdict; advice: string;
}

/** Performance de chaque boost sur la période [from, to] et avis : bon, moyen, faible. */
export function boostPerformance(from: string, to: string, pageId?: string): BoostPerf[] {
  const list = all<Boost>('boosts').filter((b) => (!pageId || b.pageId === pageId) && b.startDate <= to && (b.status === 'active' || readingsOf(b.id).some((r) => r.date >= from && r.date <= to)));
  const rows: BoostPerf[] = list.map((b) => {
    const rs = readingsOf(b.id);
    let spend = 0, messages = 0, last3 = 0, n = 0;
    const in3 = addDays(to, -2);
    for (const r of rs) {
      if (r.date < from || r.date > to) continue;
      const d = boostDelta(b.id, r.date); n++;
      spend += d.spend; messages += d.messages;
      if (r.date >= in3) last3 += d.messages;
    }
    const lastR = rs.filter((r) => r.date <= to).pop();
    const days = Math.max(1, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${b.startDate}T12:00:00`).getTime()) / 864e5) + 1);
    return { b, days, readings: n, spend, messages, cost: messages ? spend / messages : null, last3, totalSpend: lastR?.spend ?? 0, totalMessages: lastR?.messages ?? 0, verdict: 'none' as Verdict, advice: '' };
  });
  // Référence : coût moyen par message de la page (ou de toutes les pages si la page n'a qu'un boost).
  const avg = (rs: BoostPerf[]) => { const s = rs.reduce((t, r) => t + r.spend, 0), m = rs.reduce((t, r) => t + r.messages, 0); return m ? s / m : null; };
  const global = avg(rows);
  for (const r of rows) {
    const same = rows.filter((x) => x.b.pageId === r.b.pageId);
    const ref = same.length >= 2 ? avg(same) : global;
    if (!r.readings) { r.verdict = 'none'; r.advice = 'Aucun résultat saisi sur la période.'; continue; }
    if (r.readings < 3 && r.days < 4) { r.verdict = 'new'; r.advice = 'Lancé depuis peu : attendre 3 à 4 jours avant de juger.'; continue; }
    if (r.b.status === 'active' && r.last3 === 0 && r.readings >= 3) { r.verdict = 'bad'; r.advice = 'Aucun message depuis 3 jours : à mettre en pause (ou supprimer), et lancer un nouveau boost à la place.'; continue; }
    if (r.cost == null) { r.verdict = r.spend > 0 ? 'bad' : 'none'; r.advice = r.spend > 0 ? 'Des dépenses sans aucun message : à mettre en pause.' : 'Pas de dépense sur la période.'; continue; }
    if (ref == null) { r.verdict = 'average'; r.advice = ''; continue; }
    if (r.cost <= ref * 0.8) { r.verdict = 'good'; r.advice = `Coût par message ${Math.round((1 - r.cost / ref) * 100)} % sous la moyenne : à garder (voire augmenter le budget).`; }
    else if (r.cost >= ref * 1.3) { r.verdict = 'bad'; r.advice = `Coût par message ${Math.round((r.cost / ref - 1) * 100)} % au-dessus de la moyenne : à mettre en pause ou à remplacer.`; }
    else { r.verdict = 'average'; r.advice = 'Dans la moyenne : à surveiller.'; }
  }
  return rows;
}

// ---------- Compte boost du jour : délai, retards, responsables ----------
// Les boosts tournent tous les jours (dimanche compris) : chaque page doit avoir son compte boost de chaque jour.
// Délai : 17 h du lundi au vendredi, 14 h le samedi ; le dimanche (boutique fermée) se saisit au plus tard le lundi à 12 h.
const pad2 = (n: number) => String(n).padStart(2, '0');
export const BOOST_DEADLINE = { week: '17:00', saturday: '14:00', sundayNextDay: '12:00' };
/** Heure limite pour saisir le compte boost du jour `date` (AAAA-MM-JJ). */
export function boostDeadline(date: string): Date {
  const d = new Date(`${date}T12:00:00`);
  const dow = d.getDay();
  if (dow === 0) { const m = addDays(date, 1); return new Date(`${m}T${BOOST_DEADLINE.sundayNextDay}:00`); }
  return new Date(`${date}T${dow === 6 ? BOOST_DEADLINE.saturday : BOOST_DEADLINE.week}:00`);
}
export const deadlineText = (date: string) => { const dl = boostDeadline(date); const same = dayOf(dl.toISOString()) === date; return `${same ? '' : 'lundi '}${pad2(dl.getHours())} h${dl.getMinutes() ? pad2(dl.getMinutes()) : ''}`; };

/** Boosts actifs d'une page sans saisie ce jour-là. */
export const missingBoosts = (pageId: string, date: string) => activeBoosts(pageId, date).filter((b) => !readingOn(b.id, date));
/** Heure de la dernière saisie du compte boost d'une page un jour donné, et par qui. */
export function lastEntry(pageId: string, date: string): { at: string; by?: string } | undefined {
  const rs = all<BoostReading>('boostReadings').filter((r) => r.pageId === pageId && r.date === date);
  const last = rs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return last ? { at: last.updatedAt, by: last.userName } : undefined;
}

/** Personnes chargées du compte boost d'une page : responsables, et vendeurs à qui la page est attribuée. */
export function boostOwners(pageId: string): User[] {
  const roles = new Map(all<Role>('roles').map((r) => [r.id, r]));
  return all<User>('users').filter((u) => u.active && !u.removed && roles.get(u.roleId)?.permissions.includes('boosts.enter') && (u.roleId === 'role-manager' || (u.pageIds ?? []).includes(pageId)));
}

export interface BoostDue { pageId: string; date: string; missing: number; deadline: Date; late: boolean }
/** Comptes boost à faire (pages et jours), des 7 derniers jours, en retard ou bientôt dus. */
export function boostDues(now = new Date(), pageIds?: string[]): BoostDue[] {
  const out: BoostDue[] = [];
  const todayYmd = dayOf(now.toISOString());
  const pages = allPages().filter((p) => !pageIds || pageIds.includes(p.id));
  for (let i = 0; i < 7; i++) {
    const date = addDays(todayYmd, -i);
    const dl = boostDeadline(date);
    for (const p of pages) {
      const miss = missingBoosts(p.id, date);
      if (!miss.length) continue;
      const late = now > dl;
      const soon = !late && dl.getTime() - now.getTime() <= 2 * 3600_000; // rappel 2 h avant
      if (late || soon || i > 0) out.push({ pageId: p.id, date, missing: miss.length, deadline: dl, late });
    }
  }
  return out;
}

/**
 * Trace dans le journal chaque compte boost pas fait à l'heure (une seule fois par page et par jour, même depuis
 * plusieurs appareils : identifiant fixe), pour que le gérant et le super-admin voient qui n'a pas fait le travail.
 */
export async function logMissedBoosts(now = new Date()) {
  const u = currentUser();
  if (!u || !all<Role>('roles').find((r) => r.id === u.roleId)?.permissions.includes('records.correct') && u.roleId !== 'role-superadmin') return;
  for (const d of boostDues(now).filter((x) => x.late)) {
    const id = `audit_boostmiss_${d.pageId}_${d.date}`;
    if (get('audit', id)) continue;
    const owners = boostOwners(d.pageId).map((u) => u.fullName).join(', ') || 'personne n’est désigné';
    await save('audit', { id, at: now.toISOString(), action: 'Compte boost non fait', details: `${pageName(d.pageId)}, ${new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })} : ${d.missing} boost(s) sans saisie à ${deadlineText(d.date)} — à faire par : ${owners}`, entity: 'boosts', entityId: d.pageId, level: 'medium', userId: null, userName: 'Contrôle automatique' });
  }
}
