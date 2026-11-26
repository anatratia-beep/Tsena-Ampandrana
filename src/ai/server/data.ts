// Données de l'application pour l'assistant : lues dans le cloud (vue ai.data), TOUJOURS avec le rôle Postgres
// « ai_reader » dans une transaction en lecture seule. Gardées en mémoire et mises à jour par différence (numéro
// « rev »), comme la synchronisation des appareils : chaque question ne relit que ce qui a changé.
import { get, memClear, memPut } from '../../lib/db';
import { DEFAULT_ROLES, SUPERADMIN_ROLE } from '../../lib/permissions';

/** Connexion Postgres (postgres.js). */
export type Sql = any;

let lastRev = 0;
let lastCheck = 0;
let running: Promise<void> | null = null;
const FRESH_MS = 3000;

/** Exécute `fn` en lecture seule, avec le rôle ai_reader, délai maximal 10 s. */
export async function readOnly<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin('read only', async (tx: Sql) => {
    await tx`set local role ai_reader`;
    await tx`set local statement_timeout = '10s'`;
    await tx`set local search_path = ai, public`;
    return fn(tx);
  });
}

/** Met à jour les données en mémoire (rien à faire si elles ont moins de 3 s). */
export function refresh(sql: Sql): Promise<void> {
  if (Date.now() - lastCheck < FRESH_MS) return Promise.resolve();
  running ??= (async () => {
    try {
      await readOnly(sql, async (tx) => {
        const [top] = await tx`select coalesce(max(rev), 0)::bigint as rev from ai.data`;
        // Cloud vidé ou recréé : on recharge tout.
        if (Number(top.rev) < lastRev) { memClear(); lastRev = 0; }
        for (;;) {
          const rows = await tx`select tbl, id, data, rev from ai.data where rev > ${lastRev} order by rev limit 5000`;
          if (!rows.length) break;
          memPut(rows.map((r: any) => ({ tbl: r.tbl, id: r.id, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data })));
          lastRev = Number(rows[rows.length - 1].rev);
          if (rows.length < 5000) break;
        }
      });
      ensureDefaults();
      lastCheck = Date.now();
    } finally { running = null; }
  })();
  return running;
}

/**
 * Rôles de départ et super-admin : créés sur chaque appareil au démarrage, ils n'arrivent dans le cloud qu'après une
 * modification. S'ils manquent, on prend les mêmes valeurs de départ que l'application.
 */
function ensureDefaults() {
  const rows: { tbl: string; id: string; data: any }[] = [];
  for (const r of DEFAULT_ROLES) {
    const cur = get('roles', r.id) as any;
    if (!cur || !Array.isArray(cur.permissions)) rows.push({ tbl: 'roles', id: r.id, data: { ...r, ...(cur ?? {}), permissions: cur?.permissions ?? r.permissions } });
  }
  if (!get('users', 'user-superadmin')) rows.push({ tbl: 'users', id: 'user-superadmin', data: { username: 'super-adm', fullName: 'Super-admin', roleId: SUPERADMIN_ROLE, active: true } });
  if (rows.length) memPut(rows);
}

// ---------- Requête SQL de secours ----------
const FORBIDDEN = /\b(insert|update|delete|merge|upsert|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|cluster|reindex|lock|set|reset|refresh|listen|notify|unlisten|prepare|execute|deallocate|declare|fetch|move|close|comment|security|import|load|discard|checkpoint|begin|commit|rollback|savepoint|release|into)\b/i;
const DANGER_FN = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink\w*|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|set_config|current_setting|pg_reload_conf|txid_\w+|nextval|setval)\s*\(/i;

/** Vérifie qu'une requête est une simple lecture (SELECT ou WITH … SELECT). Renvoie le texte nettoyé, ou une erreur. */
export function checkSelect(q: string): { ok: true; sql: string } | { ok: false; error: string } {
  let s = String(q ?? '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, error: 'requête vide' };
  if (s.length > 4000) return { ok: false, error: 'requête trop longue' };
  // Texte sans les chaînes, identifiants entre guillemets et commentaires, pour l'analyse.
  const bare = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/\$\w*\$/.test(bare)) return { ok: false, error: 'chaînes $$ interdites' };
  if (bare.includes(';')) return { ok: false, error: 'une seule requête à la fois' };
  if (!/^\s*\(?\s*(select|with)\b/i.test(bare)) return { ok: false, error: 'seules les requêtes SELECT (ou WITH … SELECT) sont autorisées' };
  const bad = bare.match(FORBIDDEN);
  if (bad) return { ok: false, error: `mot interdit : ${bad[0]}` };
  const fn = bare.match(DANGER_FN);
  if (fn) return { ok: false, error: `fonction interdite : ${fn[0]}` };
  return { ok: true, sql: s };
}

/** Exécute une requête de lecture : au plus 200 lignes, 10 s, rôle ai_reader, transaction en lecture seule. */
export async function runSelect(sql: Sql, q: string) {
  const c = checkSelect(q);
  if (!c.ok) return { erreur: c.error };
  try {
    const rows: any[] = await readOnly<any[]>(sql, (tx) => tx.unsafe(`select * from (${c.sql}) as _q limit 201`));
    const list = [...rows].slice(0, 200).map((r: any) => ({ ...r }));
    return { lignes: list.length, tronque: rows.length > 200 || undefined, resultat: list };
  } catch (e: any) {
    return { erreur: String(e?.message ?? e).slice(0, 300) };
  }
}
