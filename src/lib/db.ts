// Base de données locale (IndexedDB) : toutes les données vivent sur l'appareil,
// chaque modification est notée dans une "boîte d'envoi" pour la synchronisation cloud.
import { useSyncExternalStore } from 'react';

export const DB_NAME = 'tsena';
export const DB_VERSION = 10;

/** Tables métier synchronisées. Ajouter un nom ici (et augmenter DB_VERSION) crée la table. */
import { META, mergeRecords, observe, sameContent, stampWrite, tick, baseStamp, type Conflict } from './merge';

export const TABLES = ['users', 'roles', 'settings', 'audit', 'categories', 'products', 'variants', 'stockMoves', 'suppliers', 'purchases', 'receptions', 'zones', 'couriers', 'customers', 'orders', 'printStations', 'printJobs', 'cashMoves', 'financeCategories', 'recurring', 'courierSettlements', 'closings', 'boosts', 'boostReadings', 'pageMessages', 'syncConflicts', 'devices', 'payouts', 'prospects', 'handovers'] as const;
export type TableName = (typeof TABLES)[number];

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  [key: string]: any;
}

let idb: IDBDatabase | null = null;
const cache = new Map<string, Map<string, BaseRecord>>();
const listeners = new Map<string, Set<() => void>>();
const snapshots = new Map<string, BaseRecord[]>();
const metaCache = new Map<string, any>();
const metaListeners = new Set<() => void>();

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openDb(): Promise<void> {
  if (idb) return;
  idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('_meta')) db.createObjectStore('_meta');
      if (!db.objectStoreNames.contains('_outbox')) db.createObjectStore('_outbox', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Fermez les autres onglets Trésor en ligne puis rechargez la page.'));
  });
  // Demande au navigateur de ne pas effacer les données en cas de manque de place.
  try { await navigator.storage?.persist?.(); } catch { /* facultatif */ }

  const tx = idb.transaction([...TABLES, '_meta'], 'readonly');
  for (const t of TABLES) {
    const rows = await req(tx.objectStore(t).getAll() as IDBRequest<BaseRecord[]>);
    cache.set(t, new Map(rows.map((r) => [r.id, r])));
    for (const r of rows) observe(baseStamp(r as any)); // l'horloge logique ne revient jamais en arrière
  }
  const metaStore = tx.objectStore('_meta');
  const keys = await req(metaStore.getAllKeys());
  const vals = await req(metaStore.getAll());
  keys.forEach((k, i) => metaCache.set(String(k), vals[i]));
}

let dataVer = 0;
/** Compteur de modifications (toutes tables) : sert à invalider les petits caches de calcul. */
export const dataVersion = () => dataVer;
function notify(table: string) {
  dataVer++;
  snapshots.delete(table);
  listeners.get(table)?.forEach((l) => l());
}

export function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}
export const nowIso = () => new Date().toISOString();

/**
 * Date de saisie : pour des tests ou pour rattraper un cahier, l'admin ou le gérant peut choisir un jour passé.
 * Réglage COMMUN à tous les appareils (enregistrement « settings/workdate », synchronisé) : il reste en place pour
 * tous les utilisateurs jusqu'à ce que l'admin ou le gérant le change. Les opérations (ventes, commandes, livraisons,
 * paiements, stock, dépenses) prennent ce jour, avec l'heure actuelle. La synchronisation garde l'heure réelle.
 */
export interface WorkDateRec extends BaseRecord { date: string | null; byName?: string; at?: string }
export function workDate(): string | null {
  const wd = get<WorkDateRec>('settings', 'workdate')?.date ?? null;
  if (!wd) return null;
  const d = new Date(), real = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return wd >= real ? null : wd;
}
export function bizNow(): string {
  const wd = workDate();
  if (!wd) return nowIso();
  const t = new Date();
  const [y, m, d] = wd.split('-').map(Number);
  return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).toISOString();
}
/** Tables dont la date de création est une date « métier » (suit la date de saisie). */
const BIZ_TABLES = new Set<string>(['orders', 'customers', 'stockMoves', 'cashMoves', 'courierSettlements', 'purchases', 'receptions']);

/** Tous les enregistrements non supprimés d'une table. */
export function all<T extends BaseRecord = BaseRecord>(table: TableName): T[] {
  let snap = snapshots.get(table);
  if (!snap) {
    snap = [...(cache.get(table)?.values() ?? [])].filter((r) => !r.deleted);
    snapshots.set(table, snap);
  }
  return snap as T[];
}
export function get<T extends BaseRecord = BaseRecord>(table: TableName, id: string): T | undefined {
  const r = cache.get(table)?.get(id);
  return r && !r.deleted ? (r as T) : undefined;
}
export function getRaw(table: TableName, id: string) {
  return cache.get(table)?.get(id);
}

/** Écrit un ou plusieurs enregistrements (création ou modification) et les met en file pour la synchro. */
export async function save(table: TableName, records: Partial<BaseRecord> | Partial<BaseRecord>[], opts: { force?: boolean } = {}): Promise<BaseRecord[]> {
  const list = Array.isArray(records) ? records : [records];
  const now = nowIso();
  let stamp = tick();
  // « Ce que je vois est ce que j'enregistre » (fiche Société…) : chaque champ envoyé est horodaté de nouveau,
  // plus récent que toutes les versions déjà connues, même si l'horloge d'un autre appareil était en avance.
  if (opts.force) {
    for (const r of list) { const prev = r.id ? cache.get(table)?.get(r.id) : undefined; for (const v of Object.values((prev as any)?._f ?? {})) if (typeof v === 'number' && v >= stamp) stamp = v + 1; }
    observe(stamp);
  }
  const who = { by: writer.name, dev: getMeta('deviceId', '') || undefined };
  const changed = new Map<string, string[]>();
  const bases = new Map<string, Record<string, number>>();
  const written: BaseRecord[] = list.map((r) => {
    const id = r.id || newId();
    let prev = cache.get(table)?.get(id);
    // Un enregistrement supprimé qu'on enregistre à nouveau (ex. fiche Société après une remise à zéro) est recréé :
    // on repart d'une fiche propre au lieu de compléter l'ancienne, qui resterait marquée « supprimée ».
    let patch: Record<string, any> = { ...r, id };
    if (prev?.deleted && !('deleted' in r)) {
      // Champs de l'ancienne fiche absents de la nouvelle : effacés (horodatés pour gagner sur le cloud).
      for (const k of Object.keys(prev)) if (!(k in patch) && !k.startsWith('_') && !['id', 'createdAt', 'updatedAt'].includes(k)) patch[k] = undefined;
      patch.deleted = false;
    }
    const rec = stampWrite(prev as any, patch, who, stamp) as BaseRecord;
    if (opts.force) for (const k of Object.keys(patch)) if (!META.has(k)) rec._f![k] = stamp;
    rec.createdAt = prev?.createdAt || r.createdAt || (BIZ_TABLES.has(table) ? bizNow() : now);
    const fields = Object.keys(rec._f || {}).filter((k) => rec._f[k] === stamp);
    changed.set(id, fields);
    // Version de départ de chaque champ modifié : sert à reconnaître un vrai conflit à la synchro.
    bases.set(id, Object.fromEntries(fields.map((k) => [k, prev ? (prev._f ? prev._f[k] ?? 0 : baseStamp(prev as any)) : 0])));
    return rec;
  });
  const tx = idb!.transaction([table, '_outbox'], 'readwrite');
  const ob = tx.objectStore('_outbox');
  for (const r of written) {
    tx.objectStore(table).put(r);
    queue(ob, table, r.id, now, changed.get(r.id) ?? [], bases.get(r.id) ?? {});
    cache.get(table)!.set(r.id, r);
  }
  await done(tx);
  notify(table);
  broadcast(table, written.map((r) => r.id));
  writeHook?.();
  return written;
}

/** Met (ou complète) l'entrée de la boîte d'envoi : les champs modifiés localement et pas encore envoyés. */
function queue(ob: IDBObjectStore, tbl: string, id: string, at: string, fields: string[], base: Record<string, number> = {}) {
  const key = tbl + ':' + id;
  const g = ob.get(key);
  g.onsuccess = () => {
    const cur = g.result as OutboxEntry | undefined;
    ob.put({ key, tbl, id, at, fields: [...new Set([...(cur?.fields ?? []), ...fields])], base: { ...base, ...(cur?.base ?? {}) } }); // garde la plus ancienne version de départ
  };
}

/** Qui écrit : nom de l'utilisateur connecté (traçabilité de chaque modification). */
let writerFn: () => string | undefined = () => undefined;
export function setWriter(fn: () => string | undefined) { writerFn = fn; }
const writer = { get name() { try { return writerFn(); } catch { return undefined; } } };

// Plusieurs onglets ouverts sur le même appareil : chacun recharge ce que l'autre vient d'écrire.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tsena-db') : null;
function broadcast(table: string, ids: string[]) { try { channel?.postMessage({ table, ids }); } catch { /* facultatif */ } }
channel?.addEventListener('message', async (ev: MessageEvent) => {
  const { table, ids } = ev.data || {};
  if (!idb || !cache.has(table)) return;
  const tx = idb.transaction(table, 'readonly');
  const store = tx.objectStore(table);
  for (const id of ids as string[]) {
    const r = await req(store.get(id) as IDBRequest<BaseRecord | undefined>);
    if (r) { cache.get(table)!.set(id, r); observe(baseStamp(r as any)); }
  }
  notify(table);
});

let writeHook: (() => void) | null = null;
/** Appelé après chaque écriture locale (utilisé pour déclencher la synchro). */
export function setWriteHook(fn: () => void) { writeHook = fn; }

/** Suppression "douce" : l'enregistrement est marqué supprimé (et synchronisé comme tel). */
export async function remove(table: TableName, id: string) {
  await save(table, { id, deleted: true });
}

export interface OutboxEntry { key: string; tbl: TableName; id: string; at: string; fields?: string[]; base?: Record<string, number> }
export interface SyncConflictLog extends Conflict { tbl: string; recId: string }

/**
 * Applique des données venues d'ailleurs.
 * - mode « seed » (valeurs par défaut au démarrage) : seulement si l'enregistrement n'existe pas encore ici ;
 * - mode « sync » (cloud) : fusion champ par champ avec la version locale. Si la fusion garde des
 *   modifications locales, l'enregistrement repart dans la boîte d'envoi (les appareils convergent tous vers
 *   la même version). Les conflits réels (même champ modifié ici, pas encore envoyé, et ailleurs) sont renvoyés.
 */
export async function applyRemote(rows: { tbl: string; id: string; data: BaseRecord }[], mode: 'seed' | 'sync' = 'seed'): Promise<{ applied: number; conflicts: SyncConflictLog[] }> {
  const res = { applied: 0, conflicts: [] as SyncConflictLog[] };
  if (!rows.length) return res;
  const tables = [...new Set(rows.map((r) => r.tbl))].filter((t) => (TABLES as readonly string[]).includes(t));
  if (!tables.length) return res;
  const pending = mode === 'sync' ? new Map((await outboxEntries()).map((e) => [e.key, e])) : new Map<string, OutboxEntry>();
  const tx = idb!.transaction([...tables, '_outbox'], 'readwrite');
  const outbox = tx.objectStore('_outbox');
  const now = nowIso();
  const touched = new Map<string, string[]>();
  for (const row of rows) {
    if (!tables.includes(row.tbl)) continue;
    const remote = row.data;
    const local = cache.get(row.tbl)!.get(row.id);
    observe(baseStamp(remote as any));
    let next: BaseRecord;
    if (!local) next = remote;
    else if (mode === 'seed') { if (local.updatedAt >= remote.updatedAt) continue; next = remote; }
    else {
      if (sameContent(local as any, remote as any) && baseStamp(local as any) === baseStamp(remote as any)) continue; // déjà à jour
      const key = row.tbl + ':' + row.id;
      const { merged, conflicts } = mergeRecords(local as any, remote as any);
      const mine = pending.get(key);
      if (mine?.fields?.length && !['audit', 'printJobs', 'syncConflicts', 'devices'].includes(row.tbl)) {
        // Vrai conflit : champ modifié ici (pas encore envoyé) ET modifié ailleurs depuis notre version de départ.
        const rStamp = (k: string) => ((remote as any)._f ? (remote as any)._f[k] ?? 0 : baseStamp(remote as any));
        for (const c of conflicts) if (mine.fields.includes(c.field) && rStamp(c.field) > (mine.base?.[c.field] ?? 0)) res.conflicts.push({ ...c, tbl: row.tbl, recId: row.id });
      }
      if (sameContent(merged, remote as any)) {
        next = merged as BaseRecord;
        if (mine) outbox.delete(key); // tout ce qui était en attente est déjà dans le cloud
      } else {
        // La fusion garde des modifications d'ici : elle repart vers le cloud, plus récente que la version reçue.
        const st = tick();
        merged._v = st; merged.updatedAt = new Date(st).toISOString();
        next = merged as BaseRecord;
        queue(outbox, row.tbl, row.id, now, mine?.fields ?? [], mine?.base ?? {});
      }
    }
    tx.objectStore(row.tbl).put(next);
    cache.get(row.tbl)!.set(row.id, next);
    touched.set(row.tbl, [...(touched.get(row.tbl) ?? []), row.id]);
    res.applied++;
  }
  await done(tx);
  tables.forEach(notify);
  touched.forEach((ids, t) => broadcast(t, ids));
  return res;
}

export async function outboxEntries(): Promise<OutboxEntry[]> {
  const tx = idb!.transaction('_outbox', 'readonly');
  return req(tx.objectStore('_outbox').getAll());
}
export async function outboxClear(keys: { key: string; at: string }[]) {
  const tx = idb!.transaction('_outbox', 'readwrite');
  const store = tx.objectStore('_outbox');
  for (const k of keys) {
    const cur = await req(store.get(k.key));
    if (cur && cur.at === k.at) store.delete(k.key); // ne supprime pas si modifié entre-temps
  }
  await done(tx);
}
export async function outboxCount(): Promise<number> {
  const tx = idb!.transaction('_outbox', 'readonly');
  return req(tx.objectStore('_outbox').count());
}

// ---- Méta-données propres à l'appareil (non synchronisées) ----
export function getMeta<T = any>(key: string, fallback?: T): T {
  return metaCache.has(key) ? metaCache.get(key) : (fallback as T);
}
export async function setMeta(key: string, value: any) {
  metaCache.set(key, value);
  const tx = idb!.transaction('_meta', 'readwrite');
  tx.objectStore('_meta').put(value, key);
  await done(tx);
  metaListeners.forEach((l) => l());
}

// ---- Sauvegarde / restauration / remise à zéro ----
export function dumpAll(): Record<string, BaseRecord[]> {
  const out: Record<string, BaseRecord[]> = {};
  for (const t of TABLES) out[t] = [...(cache.get(t)?.values() ?? [])];
  return out;
}

/** Remplace (ou fusionne) le contenu des tables par celui d'une sauvegarde. */
export async function restoreAll(data: Record<string, BaseRecord[]>, mode: 'replace' | 'merge') {
  const tables = TABLES.filter((t) => Array.isArray(data[t]));
  const tx = idb!.transaction([...tables, '_outbox'], 'readwrite');
  const now = nowIso();
  for (const t of tables) {
    const store = tx.objectStore(t);
    if (mode === 'replace') {
      // Les enregistrements absents de la sauvegarde sont marqués supprimés (pour que le cloud suive).
      const keep = new Set(data[t].map((r) => r.id));
      for (const r of cache.get(t)!.values()) {
        if (!keep.has(r.id) && !r.deleted) {
          const del = stampWrite(r as any, { deleted: true }, { by: writer.name, dev: getMeta('deviceId', '') }) as BaseRecord;
          store.put(del);
          cache.get(t)!.set(r.id, del);
          tx.objectStore('_outbox').put({ key: t + ':' + r.id, tbl: t, id: r.id, at: now });
        }
      }
    }
    for (const r of data[t]) {
      // Version restaurée : tous ses champs sont horodatés maintenant, pour qu'elle l'emporte partout.
      const { _f, _v, ...plain } = r as any;
      const rec = stampWrite(undefined, plain, { by: writer.name, dev: getMeta('deviceId', '') }) as BaseRecord;
      rec.createdAt = r.createdAt;
      store.put(rec);
      cache.get(t)!.set(r.id, rec);
      tx.objectStore('_outbox').put({ key: t + ':' + r.id, tbl: t, id: r.id, at: now });
    }
  }
  await done(tx);
  tables.forEach(notify);
}

/** Efface toute la base locale de cet appareil. */
export async function wipeLocal() {
  idb?.close();
  idb = null;
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}

// ---- Hooks React ----
function subscribe(table: string, cb: () => void) {
  if (!listeners.has(table)) listeners.set(table, new Set());
  listeners.get(table)!.add(cb);
  return () => listeners.get(table)!.delete(cb);
}
/** Liste réactive d'une table : le composant se met à jour à chaque changement. */
export function useTable<T extends BaseRecord = BaseRecord>(table: TableName): T[] {
  return useSyncExternalStore((cb) => subscribe(table, cb), () => all<T>(table));
}
export function useMeta<T = any>(key: string, fallback?: T): T {
  return useSyncExternalStore(
    (cb) => { metaListeners.add(cb); return () => metaListeners.delete(cb); },
    () => getMeta(key, fallback)
  );
}

/** Remet tous les enregistrements dans la boîte d'envoi, sans changer leur date (réparation de synchro). */
export async function requeueAll() {
  const tx = idb!.transaction('_outbox', 'readwrite');
  const now = nowIso();
  for (const t of TABLES) for (const r of cache.get(t)!.values()) tx.objectStore('_outbox').put({ key: t + ':' + r.id, tbl: t, id: r.id, at: now });
  await done(tx);
}
