// Points de restauration : copies automatiques de toutes les données, gardées sur l'appareil, pour revenir au moment
// d'avant une erreur de manipulation.
// - un point chaque jour (appareil du super-admin ou du gérant) et avant chaque action risquée (annulation, correction,
//   suppression, import, restauration…) ;
// - le super-admin voit, pour chaque point, toutes les actions faites depuis (qui, quoi, quand) et peut y revenir ;
// - le journal d'activité n'est jamais remis en arrière (on garde la trace de tout, y compris de la restauration) ;
// - les photos des articles ne sont pas copiées (trop lourdes) : celles d'aujourd'hui sont gardées.
import { all, dumpAll, getMeta, getRaw, restoreAll, setMeta, type BaseRecord, type TableName } from './db';
import { audit, can, currentUser } from './auth';
import { syncNow } from './sync';

export interface RestorePoint { id: string; at: string; reason: string; byName?: string; counts: Record<string, number>; data: Record<string, BaseRecord[]> }
const KEY = 'restorePoints';
const MAX = 12;
/** Tables jamais remises en arrière : la trace de ce qui s'est passé, les appareils, les impressions. */
const KEEP: TableName[] = ['audit', 'devices', 'syncConflicts', 'printJobs'];
const PHOTO_TABLES = new Set(['products', 'variants']);

export const restorePoints = (): RestorePoint[] => (getMeta<RestorePoint[]>(KEY, []) ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));

function snapshot(): Record<string, BaseRecord[]> {
  const d = dumpAll();
  const out: Record<string, BaseRecord[]> = {};
  for (const [t, rows] of Object.entries(d)) {
    if (KEEP.includes(t as TableName)) continue;
    out[t] = PHOTO_TABLES.has(t) ? rows.map((r) => { if (!(r as any).photo) return r; const { photo, ...rest } = r as any; return rest; }) : rows;
  }
  return out;
}

/** Crée un point de restauration. `minGapMin` : pas de nouveau point si le dernier a moins de N minutes. */
export async function createRestorePoint(reason: string, minGapMin = 0): Promise<RestorePoint | undefined> {
  try {
    const list = restorePoints();
    if (minGapMin && list[0] && Date.now() - new Date(list[0].at).getTime() < minGapMin * 60_000) return undefined;
    const data = snapshot();
    const counts = Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.filter((r) => !r.deleted).length]));
    const p: RestorePoint = { id: `rp_${Date.now()}`, at: new Date().toISOString(), reason, byName: currentUser()?.fullName, counts, data };
    await setMeta(KEY, [p, ...list].slice(0, MAX));
    return p;
  } catch { return undefined; } // manque de place : on continue sans bloquer l'action
}

/** Avant une action risquée : un point (au plus un toutes les 10 minutes). */
export const pointBefore = (what: string) => createRestorePoint(`Avant : ${what}`, 10);

/** Un point par jour, sur l'appareil du super-admin ou du gérant. */
export async function dailyRestorePoint() {
  const u = currentUser();
  if (!u || !(can(u, 'system.admin') || can(u, 'records.correct'))) return;
  const today = new Date().toDateString();
  if (restorePoints().some((p) => new Date(p.at).toDateString() === today)) return;
  await createRestorePoint('Automatique du jour');
}

/** Actions faites depuis un point (ce qui sera perdu si on y revient), de la plus récente à la plus ancienne. */
export function actionsSince(at: string) {
  return all<BaseRecord & { at: string; action: string; details: string; userName?: string; level?: string }>('audit').filter((a) => a.at > at).sort((a, b) => b.at.localeCompare(a.at));
}

/** Revient à un point : toutes les données redeviennent celles de ce moment, sur tous les appareils reliés. */
export async function restoreToPoint(id: string) {
  const p = restorePoints().find((x) => x.id === id);
  if (!p) throw new Error('Point de restauration introuvable.');
  const u = currentUser();
  if (!u || !can(u, 'system.admin')) throw new Error('Seul le super-admin peut revenir à un point de restauration.');
  await createRestorePoint(`Avant de revenir au point du ${new Date(p.at).toLocaleString('fr-FR')}`);
  const lost = actionsSince(p.at).length;
  // Photos : on garde celles d'aujourd'hui (elles ne sont pas dans le point).
  const data: Record<string, BaseRecord[]> = {};
  for (const [t, rows] of Object.entries(p.data)) {
    data[t] = PHOTO_TABLES.has(t) ? rows.map((r) => { const cur = getRaw(t as TableName, r.id) as any; return cur?.photo && !(r as any).photo ? { ...r, photo: cur.photo } : r; }) : rows;
  }
  await restoreAll(data, 'replace');
  await audit('Restauration', `Retour au point du ${new Date(p.at).toLocaleString('fr-FR')} (${p.reason}) : ${lost} action(s) faite(s) depuis sont annulées`, undefined, undefined, 'high');
  syncNow();
}

export async function deleteRestorePoint(id: string) { await setMeta(KEY, restorePoints().filter((p) => p.id !== id)); }
