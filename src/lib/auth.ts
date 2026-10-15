// Comptes, connexion, mots de passe, questions secrètes et journal d'activité.
import { all, applyRemote, get, getMeta, save, setMeta, setWriter, useMeta, useTable, type BaseRecord } from './db';
import { hashSecret, normalizeAnswer, verifySecret } from './crypto';
import { DEFAULT_ROLES, PERMISSIONS, SUPERADMIN_ROLE } from './permissions';

export interface User extends BaseRecord {
  username: string;
  fullName: string;
  roleId: string;
  phone?: string;
  email?: string;
  active: boolean;
  passwordHash: string;
  mustChangePassword?: boolean;
  secretQuestion?: string;
  secretAnswerHash?: string;
  /** Pages (catégories principales) attribuées au vendeur : il voit d'abord ce qui les concerne. */
  pageIds?: string[];
  /** Rôle Livreur : sa fiche livreur (colis, compte). */
  courierId?: string;
  /** Compte supprimé : plus d'accès, caché des listes ; son nom reste dans l'historique (ventes, versements…). */
  removed?: boolean; removedAt?: string; removedBy?: string;
}
export interface Role extends BaseRecord {
  name: string;
  description?: string;
  permissions: string[];
  permsCatalog?: string[];
  locked?: boolean;
  system?: boolean;
  /** Mises à jour uniques déjà appliquées à ce rôle. */
  migrations?: string[];
}

export const SUPERADMIN_ID = 'user-superadmin';
const SEED_TIME = '2000-01-01T00:00:00.000Z';

export const SECRET_QUESTIONS = [
  'Quel est le nom de votre premier instituteur ou institutrice ?',
  'Dans quel quartier avez-vous grandi ?',
  'Quel est le prénom de votre grand-mère maternelle ?',
  'Quel était le nom de votre école primaire ?',
  'Quel est votre plat malgache préféré ?',
  'Quel est le surnom que vous donnait votre famille ?',
  'Dans quelle ville est né votre père ?',
  'Quel était le nom de votre premier animal de compagnie ?',
  'Quel est le prénom de votre meilleur ami d’enfance ?',
  'Quelle était la marque de votre premier téléphone ?',
];

/** Crée le super-admin et les rôles de départ s'ils n'existent pas encore sur cet appareil. */
export async function seedAccounts() {
  const roles = DEFAULT_ROLES.map((r) => ({
    tbl: 'roles', id: r.id,
    data: { ...r, permsCatalog: PERMISSIONS.map((p) => p.key), createdAt: SEED_TIME, updatedAt: SEED_TIME } as BaseRecord,
  }));
  const superAdmin = {
    tbl: 'users', id: SUPERADMIN_ID,
    data: {
      id: SUPERADMIN_ID, username: 'super-adm', fullName: 'Super-admin', roleId: SUPERADMIN_ROLE, active: true,
      passwordHash: await hashSecret('anosy'), mustChangePassword: true, createdAt: SEED_TIME, updatedAt: SEED_TIME,
    } as BaseRecord,
  };
  await applyRemote([...roles, superAdmin]);

  // Nouveaux droits ajoutés par une mise à jour : on les donne aux rôles de départ qui doivent les avoir.
  const keys = PERMISSIONS.map((p) => p.key);
  const updates: Partial<Role>[] = [];
  for (const role of all<Role>('roles')) {
    const known = new Set(role.permsCatalog ?? keys);
    const fresh = keys.filter((k) => !known.has(k));
    if (!fresh.length && role.permsCatalog) continue;
    const def = DEFAULT_ROLES.find((d) => d.id === role.id);
    const add = fresh.filter((k) => role.locked || def?.permissions.includes(k));
    updates.push({ id: role.id, permissions: [...new Set([...role.permissions, ...add])], permsCatalog: keys });
  }
  if (updates.length) await save('roles', updates);

  // Mise à jour unique : le vendeur peut de nouveau remettre ses commandes au livreur (« En attente de livraison »).
  // Une seule fois : si l'admin retire ensuite ce droit au rôle Vendeur, il n'est pas redonné.
  const seller = get<Role>('roles', 'role-seller');
  if (seller && !(seller.migrations ?? []).includes('dispatch-to-seller')) {
    await save('roles', { id: seller.id, permissions: [...new Set([...seller.permissions, 'orders.dispatch'])], migrations: [...(seller.migrations ?? []), 'dispatch-to-seller'] });
  }
  // Mise à jour unique : le menu « Livraisons » revient pour le responsable et le vendeur (le vendeur n'y voit que ses
  // pages) ; le responsable assigne les livreurs. Si l'admin retire ensuite ces droits, ils ne
  // sont pas redonnés.
  for (const [id, add] of [['role-manager', ['deliveries.menu', 'orders.dispatch', 'deliveries.manage', 'couriers.view']], ['role-seller', ['deliveries.menu']]] as const) {
    const r = get<Role>('roles', id);
    if (r && !(r.migrations ?? []).includes('deliveries-menu-back')) await save('roles', { id, permissions: [...new Set([...r.permissions, ...add])], migrations: [...(r.migrations ?? []), 'deliveries-menu-back'] });
  }
  // Mise à jour unique : seul le responsable remet les commandes au livreur ; le vendeur ne le peut plus.
  const sel = get<Role>('roles', 'role-seller');
  if (sel && !(sel.migrations ?? []).includes('dispatch-manager-only')) await save('roles', { id: sel.id, permissions: sel.permissions.filter((p) => p !== 'orders.dispatch'), migrations: [...(sel.migrations ?? []), 'dispatch-manager-only'] });
}

// ---- Session ----
interface Session { userId: string; at: string }

export function currentUser(): User | undefined {
  const s = getMeta<Session | null>('session', null);
  return s ? get<User>('users', s.userId) : undefined;
}
// Chaque modification enregistrée garde le nom de la personne qui l'a faite (traçabilité de la synchro).
setWriter(() => currentUser()?.fullName);
export function useCurrentUser(): User | undefined {
  const s = useMeta<Session | null>('session', null);
  useTable('users');
  const u = s ? get<User>('users', s.userId) : undefined;
  return u && u.active ? u : undefined;
}
/** Utilisateur connecté pour les écrans internes : garde le dernier connu pendant la déconnexion (évite un écran blanc). */
let lastUser: User | undefined;
export function useMe(): User {
  const u = useCurrentUser();
  if (u) lastUser = u;
  return (u ?? lastUser)!;
}
export function roleOf(user?: User): Role | undefined {
  return user ? get<Role>('roles', user.roleId) : undefined;
}
/** Seuls le super-admin et le gérant gèrent leur propre mot de passe ; les autres reçoivent le leur du gérant. */
export function managesOwnPassword(user?: User): boolean {
  return !!user && (user.roleId === SUPERADMIN_ROLE || user.roleId === 'role-admin');
}

export function can(user: User | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.roleId === SUPERADMIN_ROLE) return true;
  return !!roleOf(user)?.permissions.includes(perm);
}
export function useCan() {
  const user = useCurrentUser();
  useTable('roles');
  return (perm: string) => can(user, perm);
}

export const normUsername = (s: string) => s.trim().toLowerCase();
export function findUser(username: string): User | undefined {
  const n = normUsername(username);
  return all<User>('users').find((u) => u.username === n && !u.removed);
}

/**
 * Supprimer un compte (vendeur, responsable, livreur…) : il ne peut plus se connecter et disparaît des listes.
 * Ses ventes, ses versements et le journal gardent son nom. Son identifiant est libéré pour un nouveau compte.
 */
export async function removeUser(u: User) {
  const me = currentUser();
  if (u.id === SUPERADMIN_ID || u.roleId === SUPERADMIN_ROLE) throw new Error('Le compte super-admin ne peut pas être supprimé.');
  if (u.id === me?.id) throw new Error('Vous ne pouvez pas supprimer votre propre compte.');
  await save('users', { id: u.id, active: false, removed: true, removedAt: new Date().toISOString(), removedBy: me?.fullName, username: `${u.username}~supprime-${u.id.slice(0, 6)}` });
  await audit('Utilisateur supprimé', `${u.fullName} (${u.username}, ${roleOf(u)?.name ?? '?'})`, 'users', u.id);
}

const LOCK_AFTER = 5;
const LOCK_MINUTES = 5;

export async function login(username: string, password: string): Promise<User> {
  const user = findUser(username);
  const fails = getMeta<Record<string, { n: number; until?: number }>>('loginFails', {});
  const f = fails[normUsername(username)];
  if (f?.until && f.until > Date.now()) {
    const min = Math.ceil((f.until - Date.now()) / 60000);
    throw new Error(`Trop d'essais. Réessayez dans ${min} min, ou demandez à l'admin.`);
  }
  if (!user || !(await verifySecret(password, user.passwordHash))) {
    const n = (f?.n ?? 0) + 1;
    await setMeta('loginFails', { ...fails, [normUsername(username)]: { n, until: n >= LOCK_AFTER ? Date.now() + LOCK_MINUTES * 60000 : undefined } });
    throw new Error("Nom d'utilisateur ou mot de passe incorrect.");
  }
  if (!user.active) throw new Error("Ce compte est désactivé. Contactez l'admin.");
  await setMeta('loginFails', { ...fails, [user.username]: { n: 0 } });
  await setMeta('setupSkipped', false);
  await setMeta('session', { userId: user.id, at: new Date().toISOString() });
  await setMeta('lastActivity', Date.now());
  await audit('Connexion', `${user.fullName} s'est connecté(e)`);
  if (location.hash && location.hash !== '#/') location.hash = '/';
  return user;
}

export async function logout() {
  try { (await import('../ui/kit')).clearKept(); } catch { /* rien */ }
  const u = currentUser();
  if (u) await audit('Déconnexion', `${u.fullName} s'est déconnecté(e)`);
  await setMeta('session', null);
  location.hash = '/';
}

export function checkPasswordStrength(pwd: string): string | null {
  if (pwd.length < 6) return 'Au moins 6 caractères.';
  if (!/[0-9]/.test(pwd) || !/[a-zA-Z]/.test(pwd)) return 'Mélangez lettres et chiffres.';
  if (['anosy', '123456', 'azerty', 'password', 'motdepasse'].includes(pwd.toLowerCase())) return 'Ce mot de passe est trop connu.';
  return null;
}

export async function setPassword(userId: string, pwd: string, opts: { mustChange?: boolean; reason: string }) {
  await save('users', { id: userId, passwordHash: await hashSecret(pwd), mustChangePassword: !!opts.mustChange });
  const u = get<User>('users', userId);
  await audit('Mot de passe', `${opts.reason} — ${u?.fullName ?? userId}`, 'users', userId);
}

export async function setSecretQuestion(userId: string, question: string, answer: string) {
  await save('users', { id: userId, secretQuestion: question, secretAnswerHash: await hashSecret(normalizeAnswer(answer)) });
}

export async function checkSecretAnswer(user: User, answer: string) {
  return verifySecret(normalizeAnswer(answer), user.secretAnswerHash);
}

// ---- Journal d'activité ----
/**
 * Importance d'une action : « high » (à vérifier par le super-admin ou le gérant, avec alerte), « medium », « low ».
 * Donnée par l'appelant, sinon déduite du nom de l'action.
 */
export type AuditLevel = 'high' | 'medium' | 'low';
export const AUDIT_LEVEL: Record<AuditLevel, string> = { high: 'Important', medium: 'Moyen', low: 'Simple' };
export function levelOf(action: string): AuditLevel {
  const a = action.toLowerCase();
  if (/annul|supprim|corrig|restaur|réinitialis|remise à zéro|mot de passe|rôle|droits|effac|prix modifi|date de saisie|remise importante|prix baissé/.test(a)) return 'high';
  if (/inventaire|ajust|modifi|annulée|changement|paiement|dépense|versement|réception|retour|clôture|utilisateur/.test(a)) return 'medium';
  return 'low';
}
export async function audit(action: string, details: string, entity?: string, entityId?: string, level?: AuditLevel) {
  const u = currentUser();
  const lv = level ?? levelOf(action);
  await save('audit', {
    at: new Date().toISOString(), action, details, entity, entityId, level: lv, review: lv === 'high' ? 'todo' : undefined,
    userId: u?.id ?? null, userName: u?.fullName ?? '—', role: roleOf(u)?.name, device: getMeta('deviceName', ''),
  });
}
/** Le super-admin ou le gérant marque une action importante comme vérifiée (ou suspecte), avec une note. */
export async function reviewAudit(id: string, status: 'ok' | 'suspect', note?: string) {
  const u = currentUser();
  await save('audit', { id, review: status, reviewBy: u?.fullName, reviewAt: new Date().toISOString(), reviewNote: note || undefined });
}
