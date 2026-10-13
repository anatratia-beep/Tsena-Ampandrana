// Synchronisation avec le cloud (Supabase) : envoie les modifications locales,
// récupère celles des autres appareils. Toutes les 15 s, et juste après chaque saisie.
import { useSyncExternalStore } from 'react';
import { all, applyRemote, getMeta, outboxClear, outboxCount, outboxEntries, getRaw, save, setMeta, setWriteHook, type BaseRecord, type SyncConflictLog } from './db';

export interface CloudConfig {
  url: string;
  anonKey: string;
  email: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}
export type SyncState = 'off' | 'offline' | 'syncing' | 'ok' | 'error';
export interface SyncStatus { state: SyncState; pending: number; lastSync?: string; error?: string }

const INTERVAL = 15_000;
let status: SyncStatus = { state: 'off', pending: 0 };
const subs = new Set<() => void>();
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  subs.forEach((f) => f());
}
export const syncStatus = () => status;
export function useSyncStatus() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => status);
}

export const getCloud = () => getMeta<CloudConfig | null>('cloud', null);

async function authRequest(cfg: CloudConfig, grant: 'password' | 'refresh_token', body: object) {
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.msg || json.message || `Erreur ${res.status}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
}

/** Relie cet appareil au cloud avec le compte de la société. */
export async function connectCloud(url: string, anonKey: string, email: string, password: string) {
  const cfg: CloudConfig = { url: url.trim().replace(/\/+$/, ''), anonKey: anonKey.trim(), email: email.trim() };
  const tokens = await authRequest(cfg, 'password', { email: cfg.email, password });
  // Vérifie que la table de synchronisation existe.
  const check = await fetch(`${cfg.url}/rest/v1/records?select=id&limit=1`, { headers: headers({ ...cfg, ...tokens }) });
  if (!check.ok) throw new Error("Connexion réussie, mais la table « records » est introuvable. Exécutez le script SQL d'installation dans Supabase.");
  await setMeta('cloud', { ...cfg, ...tokens });
  await setMeta('lastRev', 0);
  syncNow();
}

export async function disconnectCloud() {
  await setMeta('cloud', null);
  setStatus({ state: 'off', error: undefined });
}

function headers(cfg: CloudConfig) {
  return { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' };
}

async function freshConfig(): Promise<CloudConfig | null> {
  const cfg = getCloud();
  if (!cfg) return null;
  if (cfg.expiresAt && cfg.expiresAt > Date.now()) return cfg;
  const tokens = await authRequest(cfg, 'refresh_token', { refresh_token: cfg.refreshToken });
  const next = { ...cfg, ...tokens };
  await setMeta('cloud', next);
  return next;
}

let running = false;
let again = false;

export async function syncNow(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    const pending = await outboxCount();
    setStatus({ pending });
    if (!getCloud()) { setStatus({ state: 'off' }); return; }
    if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
    setStatus({ state: 'syncing' });
    const cfg = await freshConfig();
    if (!cfg) return;
    const device = getMeta('deviceId', '');
    const conflicts: SyncConflictLog[] = [];
    let sent = 0, received = 0, fixedSkew = 0;

    // 1. Réception des modifications des autres appareils, fusionnées champ par champ avec celles d'ici.
    const pull = async () => {
      let lastRev = getMeta<number>('lastRev', 0);
      // Cloud vidé ou recréé (la numérotation repart de 1) : cet appareil ne recevrait plus rien. On le détecte
      // en comparant avec le dernier numéro du cloud, et on reprend tout depuis le début (la fusion évite les doublons).
      if (lastRev > 0) {
        const top = await fetch(`${cfg.url}/rest/v1/records?select=rev&order=rev.desc&limit=1`, { headers: headers(cfg) });
        if (top.ok) { const [t] = await top.json(); if (!t || t.rev < lastRev) { lastRev = 0; await setMeta('lastRev', 0); } }
      }
      for (;;) {
        const from = Math.max(0, lastRev - 50); // petite marge de sécurité : une fusion déjà faite ne change rien
        const res = await fetch(`${cfg.url}/rest/v1/records?select=tbl,id,data,rev&rev=gt.${from}&order=rev.asc&limit=1000`, { headers: headers(cfg) });
        if (!res.ok) throw new Error(`Réception refusée (${res.status})`);
        const rows: { tbl: string; id: string; data: any; rev: number }[] = await res.json();
        const r = await applyRemote(rows, 'sync');
        received += r.applied;
        conflicts.push(...r.conflicts);
        const maxRev = rows.reduce((m, x) => Math.max(m, x.rev), lastRev);
        const progressed = maxRev > lastRev;
        lastRev = maxRev;
        await setMeta('lastRev', lastRev);
        if (rows.length < 1000 || !progressed) break;
      }
    };

    // 2. Envoi des modifications locales (fusionnées), par paquets. Renvoyer deux fois la même version ne crée
    //    jamais de doublon : chaque enregistrement a un identifiant unique, le cloud le remplace au lieu de l'ajouter.
    const rejected: { tbl: string; id: string }[] = [];
    const push = async () => {
      const entries = await outboxEntries();
      for (let i = 0; i < entries.length; i += 200) {
        const chunk = entries.slice(i, i + 200);
        const rows = chunk
          .map((e) => ({ e, r: getRaw(e.tbl, e.id) }))
          .filter((x) => x.r)
          .map(({ e, r }) => ({ tbl: e.tbl, id: r!.id, data: r, updated_at: r!.updatedAt, device }));
        if (rows.length) {
          const res = await fetch(`${cfg.url}/rest/v1/records?on_conflict=tbl,id&select=tbl,id,updated_at`, {
            method: 'POST',
            headers: { ...headers(cfg), Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(rows),
          });
          if (!res.ok) throw new Error(`Envoi refusé (${res.status}) ${await res.text()}`);
          sent += rows.length;
          // Vérification : le cloud ignore sans rien dire une version qu'il croit plus ancienne que la sienne (heure du
          // téléphone en retard…). Ces fiches ne reviennent pas dans la réponse : on va chercher la version du cloud,
          // on la fusionne avec celle d'ici (les modifications d'ici repartent, plus récentes), et on renvoie.
          let back: unknown = null;
          try { back = await res.json(); } catch { back = null; }
          if (Array.isArray(back)) {
            const ok = new Set(back.filter((b: any) => b && b.tbl).map((b: any) => b.tbl + ':' + b.id));
            for (const r of rows) if (!ok.has(r.tbl + ':' + r.id)) rejected.push({ tbl: r.tbl, id: r.id });
          }
        }
        await outboxClear(chunk); // seulement les entrées qui n'ont pas changé pendant l'envoi
      }
    };

    // Fiches refusées par le cloud (version jugée plus ancienne) : version du cloud reçue et fusionnée avec celle d'ici.
    const reconcile = async () => {
      const list = rejected.splice(0);
      const byTbl = new Map<string, string[]>();
      for (const r of list) byTbl.set(r.tbl, [...new Set([...(byTbl.get(r.tbl) ?? []), r.id])]);
      for (const [tbl, ids] of byTbl) {
        for (let i = 0; i < ids.length; i += 50) {
          const part = ids.slice(i, i + 50).map((x) => `"${x.replace(/"/g, '')}"`).join(',');
          const res = await fetch(`${cfg.url}/rest/v1/records?select=tbl,id,data,rev&tbl=eq.${encodeURIComponent(tbl)}&id=in.(${encodeURIComponent(part)})`, { headers: headers(cfg) });
          if (!res.ok) throw new Error(`Vérification refusée (${res.status})`);
          const rows = await res.json();
          const r = await applyRemote(rows, 'sync');
          received += r.applied; conflicts.push(...r.conflicts);
        }
      }
      fixedSkew += list.length;
    };

    await pull();
    await push();
    if (rejected.length) { await reconcile(); await push(); }
    await pull();                                   // confirme : ce qui revient du cloud est fusionné à nouveau
    if (await outboxCount()) { await push(); if (rejected.length) { await reconcile(); await push(); } await pull(); }

    // 3. Conflits réels (même champ modifié ici hors ligne et sur un autre appareil) : gardés pour vérification.
    if (conflicts.length) {
      const uniq = [...new Map(conflicts.map((c) => [`${c.tbl}|${c.recId}|${c.field}|${c.keptStamp}|${c.lostStamp}`, c])).values()];
      await save('syncConflicts', uniq.map((c) => ({
        id: `cf_${c.tbl}_${c.recId}_${c.field}_${Math.min(c.keptStamp, c.lostStamp)}_${Math.max(c.keptStamp, c.lostStamp)}`, tbl: c.tbl, recId: c.recId, field: c.field, kept: c.kept, lost: c.lost, keptBy: c.keptBy, lostBy: c.lostBy, keptDev: c.keptDev, lostDev: c.lostDev,
        keptAt: new Date(c.keptStamp).toISOString(), lostAt: new Date(c.lostStamp).toISOString(), resolved: false,
      })));
    }
    await ensureDeviceCode();

    if (sent || received || conflicts.length) await logSync({ sent, received, conflicts: conflicts.length });
    setStatus({ state: 'ok', pending: await outboxCount(), lastSync: new Date().toISOString(), error: undefined });
  } catch (e: any) {
    if (navigator.onLine) await logSync({ sent: 0, received: 0, conflicts: 0, error: e?.message ?? String(e) }).catch(() => {});
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e?.message ?? String(e), pending: await outboxCount() });
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 500); }
  }
}

// ---------- Historique de synchronisation (propre à cet appareil, 100 dernières lignes) ----------
export interface SyncLogLine { at: string; sent: number; received: number; conflicts: number; error?: string }
async function logSync(l: Omit<SyncLogLine, 'at'>) {
  const cur = getMeta<SyncLogLine[]>('syncLog', []);
  const last = cur[0];
  if (l.error && last?.error === l.error) return; // même erreur répétée : une seule ligne
  await setMeta('syncLog', [{ at: new Date().toISOString(), ...l }, ...cur].slice(0, 100));
}

let debounce: ReturnType<typeof setTimeout> | undefined;
export function startSync() {
  setWriteHook(() => {
    outboxCount().then((pending) => setStatus({ pending }));
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 1500);
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus({ state: getCloud() ? 'offline' : 'off' }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(syncNow, INTERVAL);
  syncNow();
}

// ---------- Appareils : une lettre par appareil (A, B, C…) pour des numéros uniques même hors ligne ----------
export interface DeviceRec extends BaseRecord { code: string; name?: string; lastSeen?: string }
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const codeAt = (i: number) => (i < LETTERS.length ? LETTERS[i] : LETTERS[Math.floor(i / LETTERS.length) - 1] + LETTERS[i % LETTERS.length]);

export async function ensureDeviceCode() {
  const me = getMeta<string>('deviceId', '');
  if (!me) return;
  let code = getMeta<string>('deviceCode', '');
  const mine = getRaw('devices', me) as DeviceRec | undefined;
  const others = all<DeviceRec>('devices').filter((d) => d.id !== me);
  // Deux appareils reliés au même moment ont pris la même lettre : le plus ancien la garde.
  const clash = code && others.find((d) => d.code === code && (d.createdAt < (mine?.createdAt ?? '9') || (d.createdAt === mine?.createdAt && d.id < me)));
  if (!code || clash) {
    const taken = new Set(others.map((d) => d.code));
    let i = 0; while (taken.has(codeAt(i))) i++;
    code = codeAt(i);
    await setMeta('deviceCode', code);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!mine || mine.deleted || mine.code !== code || mine.name !== getMeta('deviceName', '') || (mine.lastSeen ?? '') < today) {
    await save('devices', { id: me, code, name: getMeta('deviceName', ''), lastSeen: new Date().toISOString() });
  }
}
