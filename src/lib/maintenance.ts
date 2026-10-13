// Outils : réinitialisation par e-mail, sauvegardes automatiques avec conservation, effacement des données de test,
// vérification de la cohérence, export complet en Excel, code PIN de déverrouillage.
import { all, get, getMeta, save, setMeta, TABLES, type BaseRecord, type TableName } from './db';
import { audit, currentUser, managesOwnPassword, type User } from './auth';
import { hashSecret, verifySecret } from './crypto';
import { getCloud, syncNow } from './sync';
import { addMoves, stockOf, type Product, type Variant } from './catalog';
import { remaining, type Courier, type Order } from './orders';
import { cloudBackup, downloadBackup } from './backup';
import { writeXlsx, downloadBlob, type Cell } from './xlsx';
import { LOGO, PHOTO, RECEIPT, compressPhoto, photoBytes, tooHeavy } from './images';

// ---------- Mot de passe oublié : lien envoyé à l'e-mail du compte cloud de la société ----------
export const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(6, b.length)) + c);
export const appUrl = () => location.origin + location.pathname;

export async function sendResetLink(user: User) {
  const cfg = getCloud();
  if (!cfg) throw new Error("Cet appareil n'est pas relié au cloud : utilisez la question secrète ou demandez au super-admin.");
  if (!navigator.onLine) throw new Error('Pas de connexion Internet.');
  const res = await fetch(`${cfg.url}/auth/v1/otp?redirect_to=${encodeURIComponent(appUrl())}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, create_user: false }),
  });
  if (res.status === 429) throw new Error('Trop de demandes d’e-mail : attendez une heure puis réessayez (limite du cloud).');
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.msg || j.error_description || `Envoi impossible (erreur ${res.status}).`); }
  await setMeta('pendingReset', { userId: user.id, at: Date.now() });
  await audit('Mot de passe', `Lien de réinitialisation envoyé par e-mail pour ${user.fullName}`, 'users', user.id);
}

/**
 * Au démarrage : si on arrive depuis le lien de l'e-mail, l'adresse contient #access_token=…
 * On vérifie auprès du cloud que c'est bien le compte de la société, puis on autorise le changement de mot de passe.
 */
export async function consumeEmailLink(): Promise<void> {
  const h = location.hash;
  if (!/access_token=|error_description=/.test(h)) return;
  const params = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (params.get('error') || params.get('error_description')) {
    const expired = /expired|invalid/i.test(params.get('error_code') || params.get('error_description') || '');
    await setMeta('resetError', expired ? 'Le lien a expiré ou a déjà servi. Demandez un nouveau lien.' : (params.get('error_description') || 'Lien refusé.'));
    return;
  }
  const cfg = getCloud();
  if (!cfg) { await setMeta('resetError', "Ouvrez le lien sur un appareil déjà relié au cloud de la société (où Trésor en ligne est installé)."); return; }
  const token = params.get('access_token')!;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` } });
    const u = await res.json();
    if (!res.ok || String(u.email).toLowerCase() !== cfg.email.toLowerCase()) throw new Error('Lien non valable pour cette société.');
    const expires = Number(params.get('expires_in') || 3600);
    await setMeta('cloud', { ...cfg, accessToken: token, refreshToken: params.get('refresh_token') || cfg.refreshToken, expiresAt: Date.now() + (expires - 60) * 1000 });
    await setMeta('resetGranted', { at: Date.now() });
    await setMeta('resetError', null);
  } catch (e: any) {
    await setMeta('resetError', e?.message ?? 'Vérification impossible.');
  }
}
export const resetGrantedValid = () => { const g = getMeta<{ at: number } | null>('resetGranted', null); return !!g && Date.now() - g.at < 30 * 60_000; };
export async function resetByEmail(userId: string, pwd: string) {
  if (!resetGrantedValid()) throw new Error('Le lien a expiré : recommencez.');
  const u = get<User>('users', userId);
  if (!u || !managesOwnPassword(u)) throw new Error('Compte non autorisé.');
  await save('users', { id: userId, passwordHash: await hashSecret(pwd), mustChangePassword: false });
  await audit('Mot de passe', `Réinitialisé par lien e-mail — ${u.fullName}`, 'users', userId);
  await setMeta('resetGranted', null);
  await setMeta('pendingReset', null);
  syncNow();
}

// ---------- Code PIN (propre à l'appareil) ----------
export const pinsOf = () => getMeta<Record<string, string>>('pins', {});
export const hasPin = (userId: string) => !!pinsOf()[userId];
export async function setPin(userId: string, pin: string | null) {
  const p = { ...pinsOf() };
  if (pin) p[userId] = await hashSecret(pin); else delete p[userId];
  await setMeta('pins', p);
  await audit('Code PIN', pin ? 'Code PIN défini sur cet appareil' : 'Code PIN retiré de cet appareil', 'users', userId);
}
export async function checkPin(userId: string, pin: string) {
  const h = pinsOf()[userId];
  return !!h && verifySecret(pin, h);
}

// ---------- Sauvegardes automatiques dans le cloud, avec conservation ----------
type CloudRow = { id: string; created_at: string; label: string };
async function cloudReq(path: string, init: RequestInit = {}) {
  const cfg = getCloud();
  if (!cfg) throw new Error('Pas de cloud');
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { ...init, headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Cloud : erreur ${res.status}`);
  return res;
}
export const KEEP = { daily: 7, weekly: 5, monthly: 12 };

/** Une copie par jour (faite par un appareil d'admin) ; elle compte aussi comme hebdomadaire / mensuelle si besoin. */
export async function autoBackups() {
  const u = currentUser();
  if (!u || !getCloud() || !navigator.onLine) return;
  if (!['role-admin', 'role-superadmin'].includes(u.roleId)) return;
  const last = getMeta<string | null>('lastAutoBackup', null);
  if (last && Date.now() - new Date(last).getTime() < 20 * 3600 * 1000) return;
  try {
    await syncNow();
    const rows: CloudRow[] = await (await cloudReq('backups?select=id,created_at,label&order=created_at.desc&limit=300')).json();
    const now = new Date();
    const auto = rows.filter((r) => (r.label || '').startsWith('Automatique'));
    const lastDaily = auto[0];
    if (lastDaily && now.getTime() - new Date(lastDaily.created_at).getTime() < 20 * 3600 * 1000) { await setMeta('lastAutoBackup', lastDaily.created_at); return; }
    const kinds = ['quotidienne'];
    if (!auto.some((r) => r.label.includes('hebdomadaire') && now.getTime() - new Date(r.created_at).getTime() < 6.5 * 864e5)) kinds.push('hebdomadaire');
    const ym = now.toISOString().slice(0, 7);
    if (!auto.some((r) => r.label.includes('mensuelle') && r.created_at.slice(0, 7) === ym)) kinds.push('mensuelle');
    await cloudBackup(`Automatique — ${kinds.join(' + ')}`, { auto: true });
    await setMeta('lastAutoBackup', now.toISOString());
    await setMeta('autoBackupSkip', null);
    await pruneBackups();
  } catch (e: any) { await setMeta('autoBackupSkip', { at: new Date().toISOString(), why: e?.message ?? String(e) }); /* réessaiera dans une heure */ }
}

/** Garde les 7 dernières quotidiennes, 5 hebdomadaires, 12 mensuelles ; les sauvegardes manuelles ne sont jamais effacées. */
export async function pruneBackups() {
  const rows: CloudRow[] = await (await cloudReq('backups?select=id,created_at,label&order=created_at.desc&limit=500')).json();
  const auto = rows.filter((r) => (r.label || '').startsWith('Automatique'));
  const keep = new Set<string>();
  auto.slice(0, KEEP.daily).forEach((r) => keep.add(r.id));
  auto.filter((r) => r.label.includes('hebdomadaire')).slice(0, KEEP.weekly).forEach((r) => keep.add(r.id));
  auto.filter((r) => r.label.includes('mensuelle')).slice(0, KEEP.monthly).forEach((r) => keep.add(r.id));
  const drop = auto.filter((r) => !keep.has(r.id));
  for (const r of drop) await cloudReq(`backups?id=eq.${r.id}`, { method: 'DELETE' });
  return drop.length;
}
export async function deleteCloudBackup(id: string, label: string) {
  await cloudReq(`backups?id=eq.${id}`, { method: 'DELETE' });
  await audit('Sauvegarde', `Copie cloud supprimée (${label})`);
}

// ---------- Effacer les données de test (en gardant paramètres, comptes et rôles) ----------
export const DATA_GROUPS: { key: string; label: string; tables: TableName[]; needs?: string[]; default?: boolean }[] = [
  { key: 'sales', label: 'Ventes, commandes, livraisons et clients à suivre', tables: ['orders', 'prospects'], default: true },
  { key: 'customers', label: 'Clients', tables: ['customers'], default: true },
  { key: 'money', label: 'Trésorerie : dépenses, revenus, virements, versements des livreurs, des vendeurs et au patron', tables: ['cashMoves', 'courierSettlements', 'closings', 'payouts', 'handovers'], default: true },
  { key: 'stock', label: 'Mouvements de stock (le stock de chaque article revient à 0)', tables: ['stockMoves'], default: true },
  { key: 'purchases', label: 'Achats Chine et réceptions', tables: ['purchases', 'receptions'], default: true },
  { key: 'print', label: 'Historique des impressions', tables: ['printJobs'], default: true },
  { key: 'inventories', label: 'Inventaires : fiches de comptage et historique', tables: ['inventories'], default: true },
  { key: 'boosts', label: 'Boosts publicitaires : boosts, résultats saisis et messages réels', tables: ['boosts', 'boostReadings', 'pageMessages'], default: true },
  { key: 'catalog', label: 'Articles (et lots)', tables: ['products', 'variants'], needs: ['sales', 'stock', 'purchases'] },
  { key: 'categories', label: 'Pages (catégories) et leurs variantes', tables: ['categories'], needs: ['catalog', 'boosts'] },
  { key: 'suppliers', label: 'Fournisseurs', tables: ['suppliers'], needs: ['purchases'] },
  { key: 'couriers', label: 'Fiches livreurs', tables: ['couriers'], needs: ['sales', 'money'] },
  { key: 'audit', label: "Journal d'activité et conflits de synchronisation", tables: ['audit', 'syncConflicts'] },
];
export const KEPT_LABEL = 'Toujours gardés : paramètres de la société, utilisateurs et mots de passe, rôles, zones de livraison, catégories de dépenses, opérations récurrentes, imprimantes.';

export async function clearData(keys: string[]) {
  await downloadBackup();
  if (getCloud()) { try { await cloudBackup('Avant effacement des données de test'); } catch { /* le fichier suffit */ } }
  const groups = DATA_GROUPS.filter((g) => keys.includes(g.key));
  let n = 0;
  for (const g of groups) for (const t of g.tables) {
    const rows = all(t);
    for (let i = 0; i < rows.length; i += 300) await save(t, rows.slice(i, i + 300).map((r) => ({ id: r.id, deleted: true })));
    n += rows.length;
  }
  await audit('Effacement des données', `${groups.map((g) => g.label).join(' ; ')} — ${n} enregistrement(s)`);
  syncNow();
  return n;
}

// ---------- Vérification de la cohérence ----------
export interface Issue { key: string; title: string; detail: string; items: string[]; level: 'ok' | 'info' | 'warn'; fixLabel?: string; fix?: () => Promise<void> }
export function checkData(): Issue[] {
  const issues: Issue[] = [];
  const variants = all<Variant>('variants');
  const products = all<Product>('products');
  const orders = all<Order>('orders');
  const vname = (v?: Variant) => { const p = v && get<Product>('products', v.productId); return `${p?.code ?? '?'} ${p?.name ?? ''} ${[v?.color, v?.size].filter(Boolean).join(' ')}`.trim(); };

  const neg = variants.filter((v) => stockOf(v.id) < 0);
  issues.push({ key: 'neg', title: 'Stock négatif', level: neg.length ? 'warn' : 'ok', detail: neg.length ? 'Plus de pièces vendues que de pièces en stock : souvent un stock de départ ou une réception oubliés.' : 'Aucun article en stock négatif.',
    items: neg.map((v) => `${vname(v)} : ${stockOf(v.id)}`), fixLabel: 'Remettre ces stocks à 0 (ajustement tracé)',
    fix: neg.length ? async () => { await addMoves(neg.map((v) => ({ variantId: v.id, qty: -stockOf(v.id), type: 'adjust' as const, reason: 'Correction automatique : stock négatif remis à 0' }))); await audit('Vérification', `${neg.length} stock(s) négatif(s) remis à 0`); } : undefined });

  const orphanV = variants.filter((v) => !get('products', v.productId));
  issues.push({ key: 'orphan', title: 'Variantes sans article', level: orphanV.length ? 'warn' : 'ok', detail: orphanV.length ? 'Tailles/couleurs dont l’article a été supprimé.' : 'Toutes les variantes ont leur article.',
    items: orphanV.map((v) => v.sku), fixLabel: 'Supprimer ces variantes', fix: orphanV.length ? async () => { await save('variants', orphanV.map((v) => ({ id: v.id, deleted: true }))); } : undefined });

  const noVar = products.filter((p) => p.kind !== 'lot' && !p.deleted && !variants.some((v) => v.productId === p.id));
  issues.push({ key: 'novar', title: 'Articles sans taille ni couleur', level: noVar.length ? 'info' : 'ok', detail: noVar.length ? 'Ces articles ne peuvent pas être vendus : ouvrez-les et ajoutez au moins une variante.' : 'Tous les articles sont vendables.', items: noVar.map((p) => `${p.code} ${p.name}`) });

  const noCost = variants.filter((v) => get('products', v.productId) && stockOf(v.id) > 0 && !v.costAvg);
  issues.push({ key: 'nocost', title: 'Articles en stock sans coût de revient', level: noCost.length ? 'info' : 'ok', detail: noCost.length ? 'Le bénéfice de ces articles sera surestimé : indiquez leur coût (import Excel ou réception).' : 'Tous les articles en stock ont un coût.', items: noCost.map((v) => vname(v)) });

  const badLines = orders.filter((o) => o.status !== 'cancelled' && o.lines.some((l) => !get('variants', l.variantId)));
  issues.push({ key: 'lines', title: 'Commandes avec un article supprimé', level: badLines.length ? 'info' : 'ok', detail: badLines.length ? 'Ces commandes restent valables, mais l’article n’existe plus dans le catalogue.' : 'Aucune.', items: badLines.map((o) => o.number) });

  const outNoCourier = orders.filter((o) => o.status === 'out' && (!o.courierId || !get<Courier>('couriers', o.courierId)));
  issues.push({ key: 'nocourier', title: 'Commandes en livraison sans livreur', level: outNoCourier.length ? 'warn' : 'ok', detail: outNoCourier.length ? 'Ouvrez-les et utilisez « Changer » pour leur attribuer un livreur.' : 'Toutes les livraisons en cours ont un livreur.', items: outNoCourier.map((o) => o.number) });

  const over = orders.filter((o) => o.status !== 'cancelled' && remaining(o) < 0);
  issues.push({ key: 'over', title: 'Clients ayant trop payé', level: over.length ? 'info' : 'ok', detail: over.length ? 'Ouvrez la commande et utilisez « Rendre l’argent au client », ou corrigez le paiement.' : 'Aucun trop-perçu.', items: over.map((o) => `${o.number} : ${(-remaining(o)).toLocaleString('fr-FR')} Ar`) });

  const unpaid = orders.filter((o) => ['delivered', 'partial'].includes(o.status) && remaining(o) > 0);
  issues.push({ key: 'unpaid', title: 'Commandes livrées pas entièrement payées', level: unpaid.length ? 'info' : 'ok', detail: unpaid.length ? 'Reste à encaisser sur des commandes terminées.' : 'Toutes les commandes livrées sont payées.', items: unpaid.map((o) => `${o.number} : ${remaining(o).toLocaleString('fr-FR')} Ar`) });

  const seen = new Map<string, number>();
  for (const o of orders) seen.set(o.number, (seen.get(o.number) ?? 0) + 1);
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  issues.push({ key: 'dup', title: 'Numéros de commande en double', level: dup.length ? 'info' : 'ok', detail: dup.length ? 'Arrive si deux appareils hors ligne créent une commande en même temps. Sans gravité : les commandes restent distinctes.' : 'Aucun doublon.', items: dup.map(([n, c]) => `${n} (×${c})`) });

  return issues;
}

export function tableCounts() {
  return TABLES.map((t) => ({ t, n: all(t).length }));
}

// ---------- Export complet en Excel ----------
const SHEET_NAMES: Partial<Record<TableName, string>> = {
  products: 'Articles', variants: 'Variantes', categories: 'Catégories', stockMoves: 'Mouvements stock', orders: 'Commandes', customers: 'Clients', couriers: 'Livreurs',
  zones: 'Zones', purchases: 'Achats', receptions: 'Réceptions', suppliers: 'Fournisseurs', cashMoves: 'Trésorerie', courierSettlements: 'Versements livreurs',
  financeCategories: 'Catégories dépenses', recurring: 'Récurrentes', boosts: 'Boosts', boostReadings: 'Résultats boosts', pageMessages: 'Messages réels', payouts: 'Versements patron', handovers: 'Versements vendeurs', inventories: 'Inventaires', users: 'Utilisateurs', roles: 'Rôles', audit: 'Journal', settings: 'Paramètres',
};
const HIDDEN = new Set(['passwordHash', 'secretAnswerHash', 'photo', 'logo', 'deleted']);
export async function exportAllExcel() {
  const sheets = (Object.keys(SHEET_NAMES) as TableName[]).map((t) => {
    const rows = all<BaseRecord>(t);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !HIDDEN.has(k));
    return {
      name: SHEET_NAMES[t]!, columns: keys.map((k) => ({ header: k, width: k === 'id' ? 12 : 18 })),
      rows: rows.map((r) => keys.map((k) => { const v = (r as any)[k]; return (v == null ? null : typeof v === 'object' ? JSON.stringify(v).slice(0, 32000) : v) as Cell; })),
    };
  });
  const blob = await writeXlsx(sheets);
  downloadBlob(blob, `Tresor-en-ligne-export-complet-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await audit('Export', 'Export complet des données en Excel');
}

// ---------- Optimiser les photos déjà enregistrées ----------
// ---------- Photos : toutes ramenées à la norme (images.ts) pour ne pas alourdir la base ----------
type PhotoJob = { table: TableName; id: string; field: string; photo: string; norm: { max: number; targetBytes: number } };
function photoJobs(): PhotoJob[] {
  const jobs: PhotoJob[] = [];
  for (const p of all<Product>('products')) if (tooHeavy(p.photo, PHOTO.targetBytes)) jobs.push({ table: 'products', id: p.id, field: 'photo', photo: p.photo!, norm: PHOTO });
  for (const v of all<Variant>('variants')) if (tooHeavy(v.photo, PHOTO.targetBytes)) jobs.push({ table: 'variants', id: v.id, field: 'photo', photo: v.photo!, norm: PHOTO });
  for (const m of all<BaseRecord>('cashMoves')) if (tooHeavy(m.photo, RECEIPT.targetBytes)) jobs.push({ table: 'cashMoves', id: m.id, field: 'photo', photo: m.photo, norm: RECEIPT });
  // Logos : un PNG léger (dessin avec transparence) est gardé tel quel ; seul un logo lourd est converti.
  for (const c of all<BaseRecord>('categories')) if (tooHeavy(c.logo, LOGO.targetBytes, true)) jobs.push({ table: 'categories', id: c.id, field: 'logo', photo: c.logo, norm: LOGO });
  const co = get<BaseRecord>('settings', 'company');
  if (co && tooHeavy(co.logo, LOGO.targetBytes, true)) jobs.push({ table: 'settings', id: 'company', field: 'logo', photo: co.logo, norm: LOGO });
  return jobs;
}
export function photoStats() {
  const list = [...all<Product>('products').map((p) => p.photo), ...all<Variant>('variants').map((v) => v.photo), ...all<BaseRecord>('cashMoves').map((m) => m.photo), ...all<BaseRecord>('categories').map((c) => c.logo)].filter((x) => typeof x === 'string' && x.startsWith('data:image')) as string[];
  const bytes = list.reduce((t, p) => t + photoBytes(p), 0);
  return { count: list.length, bytes, heavy: photoJobs().length };
}
export async function optimizePhotos(onProgress?: (done: number, total: number) => void, limit = Infinity) {
  const todo = photoJobs().slice(0, limit);
  let before = 0, after = 0, done = 0;
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    try {
      const np = await compressPhoto(t.photo, t.norm);
      if (photoBytes(np) < photoBytes(t.photo) * 0.9 || !t.photo.startsWith('data:image/jpeg')) { before += photoBytes(t.photo); after += photoBytes(np); await save(t.table, { id: t.id, [t.field]: np }); done++; }
    } catch { /* photo illisible : laissée telle quelle */ }
    onProgress?.(i + 1, todo.length);
  }
  if (done) await audit('Photos', `${done} photo(s) ramenée(s) à la norme : ${Math.round(before / 1024)} Ko → ${Math.round(after / 1024)} Ko`, undefined, undefined, 'low');
  return { count: done, before, after };
}
/** Une fois par jour, sur l'appareil d'un admin : les photos trop lourdes (anciennes, importées…) sont réduites. */
export async function autoOptimizePhotos() {
  const u = currentUser();
  if (!u || !['role-admin', 'role-superadmin'].includes(u.roleId)) return;
  const last = getMeta<string | null>('lastPhotoOptim', null);
  if (last && Date.now() - new Date(last).getTime() < 20 * 3600 * 1000) return;
  await setMeta('lastPhotoOptim', new Date().toISOString());
  try { await optimizePhotos(undefined, 150); } catch { /* réessaiera demain */ }
}
