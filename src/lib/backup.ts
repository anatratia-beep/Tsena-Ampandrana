// Sauvegardes : fichier téléchargeable (chiffré ou non), copies dans le cloud, restauration, remise à zéro.
import { DEFAULT_ROLES, PERMISSIONS } from './permissions';
import { all, get, getRaw, dumpAll, getMeta, restoreAll, save, setMeta, TABLES, type BaseRecord } from './db';
import { decryptText, encryptText, hashSecret, verifySecret } from './crypto';
import { audit, currentUser, SUPERADMIN_ID, type User } from './auth';
import { getCloud, syncNow } from './sync';
import { restoreDefaultZones } from './orders';
import { restoreDefaultFinance } from './money';
import { createRestorePoint } from './restorePoints';

export interface BackupFile {
  app: 'TSENA';
  format: 1;
  createdAt: string;
  createdBy: string;
  company: string;
  encrypted: boolean;
  payload: any;
}

function companyName() {
  return (all('settings').find((s) => s.id === 'company') as any)?.name || 'Trésor en ligne';
}

export async function buildBackup(password?: string): Promise<BackupFile> {
  const data = dumpAll();
  const text = JSON.stringify(data);
  return {
    app: 'TSENA', format: 1, createdAt: new Date().toISOString(),
    createdBy: currentUser()?.fullName ?? '—', company: companyName(),
    encrypted: !!password,
    payload: password ? await encryptText(text, password) : data,
  };
}

export function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function backupFilename(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Tresor-en-ligne-sauvegarde-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}.tsena`;
}

export async function downloadBackup(password?: string) {
  const file = await buildBackup(password);
  downloadJson(file, backupFilename());
  await setMeta('lastFileBackup', file.createdAt);
  await audit('Sauvegarde', `Fichier de sauvegarde téléchargé${password ? ' (chiffré)' : ''}`);
}

// ---------- Mot de passe des sauvegardes : défini une fois, puis confirmé par le mot de passe de connexion ----------
// Le mot de passe des sauvegardes est gardé (synchronisé) uniquement sous forme chiffrée : une copie par personne,
// chiffrée avec SON mot de passe de connexion. Chacun le débloque donc avec son propre mot de passe ; une personne
// qui n'a pas encore sa copie (ou qui a changé de mot de passe de connexion) le saisit une fois.
export interface BackupKey extends BaseRecord { hash: string; wraps: Record<string, { salt: string; iv: string; data: string }>; setByName?: string; setAt?: string }
export const backupKey = () => { const k = get<BackupKey>('settings', 'backupkey'); return k && !k.deleted && k.hash ? k : undefined; };
async function checkLogin(loginPwd: string) {
  const me = currentUser();
  if (!me || !(await verifySecret(loginPwd, (me as any).passwordHash))) throw new Error('Mot de passe de connexion incorrect.');
  return me;
}
export async function setBackupPassword(newPwd: string, loginPwd: string) {
  if (newPwd.length < 6) throw new Error('Mot de passe des sauvegardes : 6 caractères au minimum.');
  const me = await checkLogin(loginPwd);
  await save('settings', { id: 'backupkey', hash: await hashSecret(newPwd), wraps: { [me.id]: await encryptText(newPwd, loginPwd) }, setByName: me.fullName, setAt: new Date().toISOString(), deleted: false });
  await audit('Sauvegarde', 'Mot de passe des sauvegardes défini');
}
/** Donne le mot de passe des sauvegardes après confirmation du mot de passe de connexion. 'NEED' = à saisir une fois. */
export async function unlockBackupPassword(loginPwd: string, backupPwd?: string): Promise<string> {
  const me = await checkLogin(loginPwd);
  const k = backupKey();
  if (!k) throw new Error("Aucun mot de passe des sauvegardes n'est encore défini.");
  const w = k.wraps?.[me.id];
  if (w) { try { return await decryptText(w, loginPwd); } catch { /* mot de passe de connexion changé depuis */ } }
  if (!backupPwd) throw Object.assign(new Error('Saisissez une fois le mot de passe des sauvegardes (donné par l’admin).'), { code: 'NEED' });
  if (!(await verifySecret(backupPwd, k.hash))) throw new Error('Mot de passe des sauvegardes incorrect.');
  await save('settings', { id: 'backupkey', wraps: { ...(k.wraps || {}), [me.id]: await encryptText(backupPwd, loginPwd) } });
  return backupPwd;
}

// ---------- Où va le fichier : dossier choisi (ordinateur), Téléchargements + Partager (téléphone) ----------
export const canPickFolder = () => typeof (window as any).showDirectoryPicker === 'function';
export async function pickBackupFolder() {
  const h = await (window as any).showDirectoryPicker({ id: 'tresor-sauvegardes', mode: 'readwrite' });
  await setMeta('backupDir', h);
  return h.name as string;
}
export const backupFolderName = () => (getMeta<any>('backupDir', null)?.name as string | undefined);
export interface SavedBackup { name: string; where: 'folder' | 'download'; folder?: string; file: File }
/** Fabrique la sauvegarde et l'enregistre : dans le dossier choisi s'il y en a un, sinon dans Téléchargements. */
export async function saveBackupFile(password?: string): Promise<SavedBackup> {
  const b = await buildBackup(password);
  const name = backupFilename();
  const file = new File([JSON.stringify(b)], name, { type: 'application/octet-stream' });
  const dir = getMeta<any>('backupDir', null);
  let res: SavedBackup = { name, where: 'download', file };
  if (dir) {
    try {
      let perm = await dir.queryPermission?.({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await dir.requestPermission?.({ mode: 'readwrite' });
      if (perm === 'granted') {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(file); await w.close();
        res = { name, where: 'folder', folder: dir.name, file };
      }
    } catch { /* dossier inaccessible : on télécharge */ }
  }
  if (res.where === 'download') downloadJson(b, name);
  await setMeta('lastFileBackup', b.createdAt);
  await audit('Sauvegarde', `Fichier de sauvegarde ${res.where === 'folder' ? `enregistré dans le dossier « ${res.folder} »` : 'téléchargé'}${password ? ' (protégé)' : ' (non protégé)'}`);
  return res;
}
export const canShareFile = (f: File) => { try { return !!(navigator as any).canShare?.({ files: [f] }); } catch { return false; } };

export async function readBackup(file: File, password?: string): Promise<{ meta: BackupFile; data: Record<string, BaseRecord[]> }> {
  const meta = JSON.parse(await file.text()) as BackupFile;
  if (meta.app !== 'TSENA') throw new Error("Ce fichier n'est pas une sauvegarde Trésor en ligne.");
  if (meta.encrypted) {
    if (!password) throw new Error('Cette sauvegarde est protégée : saisissez son mot de passe.');
    try { return { meta, data: JSON.parse(await decryptText(meta.payload, password)) }; }
    catch { throw new Error('Mot de passe de la sauvegarde incorrect.'); }
  }
  return { meta, data: meta.payload };
}

export async function restoreBackup(data: Record<string, BaseRecord[]>, mode: 'replace' | 'merge', label: string) {
  // Sécurité : on télécharge d'abord l'état actuel, pour pouvoir revenir en arrière.
  await downloadBackup();
  await createRestorePoint(`Avant restauration de ${label}`);
  await restoreAll(data, mode);
  await audit('Restauration', `${mode === 'replace' ? 'Remplacement' : 'Fusion'} depuis ${label}`);
  syncNow();
}

// ---- Copies dans le cloud ----
async function cloudFetch(path: string, init: RequestInit = {}) {
  await syncNow(); // rafraîchit la connexion
  const cfg = getCloud();
  if (!cfg) throw new Error("Cet appareil n'est pas relié au cloud.");
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${getCloud()!.accessToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Cloud : erreur ${res.status}`);
  return res;
}

export async function cloudBackup(label: string) {
  await cloudFetch('backups', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ label, device: getMeta('deviceName', ''), data: dumpAll() }),
  });
  await setMeta('lastCloudBackup', new Date().toISOString());
  await audit('Sauvegarde', `Copie enregistrée dans le cloud (${label})`);
}

export async function listCloudBackups(): Promise<{ id: string; created_at: string; label: string; device: string }[]> {
  const res = await cloudFetch('backups?select=id,created_at,label,device&order=created_at.desc&limit=200');
  return res.json();
}

export async function fetchCloudBackup(id: string): Promise<Record<string, BaseRecord[]>> {
  const res = await cloudFetch(`backups?select=data&id=eq.${id}`);
  const rows = await res.json();
  if (!rows[0]) throw new Error('Sauvegarde introuvable.');
  return rows[0].data;
}

/** Copie automatique quotidienne dans le cloud (faite par l'appareil d'un admin). */
export async function autoCloudBackup() {
  const u = currentUser();
  if (!u || !getCloud() || !navigator.onLine) return;
  if (!['role-admin', 'role-superadmin'].includes(u.roleId)) return;
  const last = getMeta<string | null>('lastCloudBackup', null);
  if (last && Date.now() - new Date(last).getTime() < 24 * 3600 * 1000) return;
  try { await cloudBackup('Automatique quotidienne'); } catch { /* réessaiera plus tard */ }
}

/** Remet le logiciel à l'état d'origine sur tous les appareils (après une sauvegarde automatique). */
export async function factoryReset() {
  await downloadBackup();
  if (getCloud()) { try { await cloudBackup('Avant remise à zéro'); } catch { /* le fichier local suffit */ } }
  const now = new Date().toISOString();
  const roleIds = new Set(DEFAULT_ROLES.map((r) => r.id));
  for (const t of TABLES) {
    const rows = all(t).filter((r) => !(t === 'users' && r.id === SUPERADMIN_ID) && !(t === 'roles' && roleIds.has(r.id)));
    if (rows.length) await save(t, rows.map((r) => ({ id: r.id, deleted: true, updatedAt: now })));
  }
  await save('roles', DEFAULT_ROLES.map((r) => ({ ...r, permsCatalog: PERMISSIONS.map((p) => p.key), deleted: false })));
  await restoreDefaultZones();
  await restoreDefaultFinance();
  await save('users', {
    id: SUPERADMIN_ID, username: 'super-adm', fullName: 'Super-admin', roleId: 'role-superadmin', active: true,
    passwordHash: await hashSecret('anosy'), mustChangePassword: true, secretQuestion: undefined, secretAnswerHash: undefined, email: undefined, deleted: false,
  } as Partial<User>);
  await audit('Remise à zéro', "Logiciel remis à l'état d'origine");
  await syncNow();
  await setMeta('session', null);
}

/**
 * Réparation après une ancienne remise à l'état d'origine (avant le correctif du 08/10/2026) :
 * zones et catégories par défaut supprimées, fiche Société restée « supprimée » malgré un nouvel enregistrement.
 */
export async function repairAfterReset() {
  const audits = all<BaseRecord & { action: string; entityId?: string; at: string }>('audit');
  const reset = audits.filter((a) => a.action === 'Remise à zéro').map((a) => a.at).sort().pop();
  if (!reset) return;
  if (!all('zones').length) await restoreDefaultZones();
  if (!all('financeCategories').length) await restoreDefaultFinance();
  const company = getRaw('settings', 'company');
  const savedAfter = audits.some((a) => a.action === 'Paramètres' && a.entityId === 'company' && a.at > reset);
  if (company?.deleted && savedAfter) await save('settings', { id: 'company', deleted: false });
}
