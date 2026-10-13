// Gestion des utilisateurs : seul l'admin crée les comptes et attribue les rôles.
import { useMemo, useState } from 'react';
import { audit, normUsername, removeUser, roleOf, setPassword, SUPERADMIN_ID, useCurrentUser, type Role, type User, useMe } from '../lib/auth';
import { hashSecret } from '../lib/crypto';
import { save, useTable } from '../lib/db';
import { ADMIN_ROLE, SUPERADMIN_ROLE } from '../lib/permissions';
import { Help, Badge, MultiPick, Button, Confirm, Empty, IconButton, Modal, PageHead, PasswordField, SelectField, TextField, Toggle, timeAgo, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { pageNames, userPages } from '../lib/scope';
import type { Category } from '../lib/catalog';
import type { Courier } from '../lib/orders';
import { COURIER_ROLE } from '../lib/permissions';
import { sellerDay } from '../lib/handovers';
import { today } from '../lib/money';
import { fmtAr } from '../lib/catalog';

/** Mot de passe provisoire facile à dicter : 3 lettres + 4 chiffres. */
function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const r = crypto.getRandomValues(new Uint32Array(7));
  return [...r.slice(0, 3)].map((n) => letters[n % letters.length]).join('') + [...r.slice(3)].map((n) => n % 10).join('');
}

export function UsersPage() {
  const me = useMe();
  const users = useTable<User>('users').filter((u) => !u.removed);
  const roles = useTable<Role>('roles');
  const [del, setDel] = useState<User | null>(null);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [shownPwd, setShownPwd] = useState<{ user: User; pwd: string } | null>(null);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users
      .filter((u) => !roleFilter || u.roleId === roleFilter)
      .filter((u) => !n || u.fullName.toLowerCase().includes(n) || u.username.includes(n) || (u.phone || '').includes(n))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
  }, [users, q, roleFilter]);

  const canTouch = (u: User) => u.roleId !== SUPERADMIN_ROLE || me.roleId === SUPERADMIN_ROLE;

  return (
    <>
      <PageHead title="Utilisateurs" subtitle={`${users.filter((u) => u.active).length} comptes actifs`}
        actions={<Button icon="plus" onClick={() => setEditing('new')}>Ajouter un utilisateur</Button>} />
      <div className="row">
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="user-search" className="sr-only">Rechercher</label>
          <input id="user-search" placeholder="Rechercher un nom, un identifiant, un téléphone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 1 220px' }}>
          <select aria-label="Filtrer par rôle" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Tous les rôles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="users" title="Aucun utilisateur trouvé" /> : (
          <ul className="list">
            {list.map((u) => (
              <li key={u.id} className="list-item" style={{ opacity: u.active ? 1 : .6 }}>
                <span className="avatar">{u.fullName.charAt(0).toUpperCase()}</span>
                <div className="list-item-main">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="list-item-title">{u.fullName}</span>
                    {u.id === me.id && <Badge tone="brand">Vous</Badge>}
                    {!u.active && <Badge tone="danger">Désactivé</Badge>}
                    {u.mustChangePassword && u.active && u.roleId === SUPERADMIN_ROLE && <Badge tone="warn">Mot de passe d'origine</Badge>}
                  </div>
                  <p className="small muted">{u.username} · {roleOf(u)?.name ?? 'Rôle inconnu'}{u.phone ? ` · ${u.phone}` : ''}{userPages(u).length ? ` · Pages : ${pageNames(userPages(u))}` : ''}</p>
                </div>
                {canTouch(u) && (
                  <div className="row" style={{ gap: 0 }}>
                    <IconButton icon="key" label="Nouveau mot de passe" onClick={() => setResetFor(u)} />
                    <IconButton icon="edit" label="Modifier" onClick={() => setEditing(u)} />
                    {u.id !== me.id && u.roleId !== SUPERADMIN_ROLE && u.id !== SUPERADMIN_ID && <IconButton icon="trash" label={`Supprimer ${u.fullName}`} onClick={() => setDel(u)} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && <UserForm user={editing === 'new' ? null : editing} me={me} roles={roles} users={users}
        onClose={() => setEditing(null)} onCreated={(user, pwd) => setShownPwd({ user, pwd })} />}

      {del && <DeleteUser u={del} onClose={() => setDel(null)} />}

      {resetFor && <Confirm title="Nouveau mot de passe" confirmLabel="Générer"
        message={<p>Un nouveau mot de passe va être créé pour <strong>{resetFor.fullName}</strong>. L'ancien ne fonctionnera plus.</p>}
        onClose={() => setResetFor(null)}
        onConfirm={async () => {
          const pwd = tempPassword();
          await setPassword(resetFor.id, pwd, { mustChange: false, reason: `Réinitialisé par ${me.fullName}` });
          setShownPwd({ user: resetFor, pwd });
        }} />}

      {shownPwd && (
        <Modal title="Identifiants du compte" onClose={() => setShownPwd(null)} footer={<Button onClick={() => setShownPwd(null)}>C'est noté</Button>}>
          <div className="stack">
            <p>Donnez ces informations à <strong>{shownPwd.user.fullName}</strong>. Le mot de passe ne sera plus affiché ensuite.</p>
            <div className="card" style={{ background: 'var(--surface-2)' }}>
              <p className="small muted">Nom d'utilisateur</p>
              <p className="num" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{shownPwd.user.username}</p>
              <p className="small muted" style={{ marginTop: 10 }}>Mot de passe</p>
              <p className="num" style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '.06em' }}>{shownPwd.pwd}</p>
            </div>
            <Button variant="ghost" icon="check" onClick={() => {
              navigator.clipboard?.writeText(`Identifiant : ${shownPwd.user.username}\nMot de passe : ${shownPwd.pwd}`).then(() => toast('Copié'));
            }}>Copier pour l'envoyer</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function DeleteUser({ u, onClose }: { u: User; onClose: () => void }) {
  useTable('orders'); useTable('cashMoves'); useTable('handovers');
  const d = sellerDay(u, today());
  const owes = !d.handover && Math.round(d.toPay) > 0;
  return (
    <Confirm title={`Supprimer ${u.fullName} ?`} danger confirmLabel="Supprimer le compte" typeToConfirm="SUPPRIMER" onClose={onClose}
      message={<div className="stack-s">
        <p><strong>{u.fullName}</strong> ({roleOf(u)?.name ?? '?'}) ne pourra plus se connecter et disparaîtra des listes. Ses ventes, ses commandes, ses versements et le journal gardent son nom. L’identifiant « {u.username} » redevient libre.</p>
        {owes && <div className="notice"><Icon name="alert" /><span>Il doit encore remettre <strong>{fmtAr(d.toPay)}</strong> au responsable aujourd’hui (Versements vendeurs).</span></div>}
        {u.courierId && <p className="small muted">Sa fiche livreur reste dans Livraisons → Livreurs : supprimez-la là-bas si besoin.</p>}
        <p className="small muted">Pour bloquer l’accès seulement pour un temps, modifiez-le plutôt et décochez « Compte actif ».</p>
      </div>}
      onConfirm={async () => { await removeUser(u); toast(`${u.fullName} supprimé`); }} />
  );
}

function UserForm({ user, me, roles, users, onClose, onCreated }: { user: User | null; me: User; roles: Role[]; users: User[]; onClose: () => void; onCreated: (u: User, pwd: string) => void }) {
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [roleId, setRoleId] = useState(user?.roleId ?? 'role-seller');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [pageIds, setPageIds] = useState<string[]>(user?.pageIds ?? []);
  const couriers = useTable<Courier>('couriers');
  const isCourier = roleId === COURIER_ROLE;
  const freeCouriers = couriers.filter((c) => !c.removed && (c.id === user?.courierId || !users.some((u) => u.courierId === c.id)));
  const [courierId, setCourierId] = useState(user?.courierId ?? '__new');
  const pages = useTable<Category>('categories').filter((c) => !c.parentId && !c.removed).sort((a, b) => a.name.localeCompare(b.name));
  // Mot de passe : visible et modifiable uniquement par le super-admin et le gérant.
  const canSetPwd = me.roleId === SUPERADMIN_ROLE || me.roleId === ADMIN_ROLE;
  const [pwd, setPwd] = useState(user ? '' : tempPassword());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSelf = user?.id === me.id;
  const isSuper = user?.id === SUPERADMIN_ID;
  // Seul le super-admin peut donner le rôle super-admin.
  const roleOptions = roles
    .filter((r) => r.id !== SUPERADMIN_ROLE || me.roleId === SUPERADMIN_ROLE)
    .map((r) => ({ value: r.id, label: r.name }));

  async function submit() {
    setError(null);
    const uname = normUsername(username);
    if (!fullName.trim()) return setError('Indiquez le nom complet.');
    if (!/^[a-z0-9._-]{3,}$/.test(uname)) return setError("Identifiant : au moins 3 caractères, sans espace ni accent (lettres, chiffres, . _ -).");
    if (users.some((u) => u.username === uname && u.id !== user?.id)) return setError('Cet identifiant est déjà utilisé.');
    if (canSetPwd && (!user || pwd) && pwd.trim().length < 4) return setError('Le mot de passe doit avoir au moins 4 caractères.');
    if (canSetPwd && pwd && pwd !== pwd.trim()) return setError('Le mot de passe ne doit pas commencer ni finir par un espace.');
    setBusy(true);
    try {
      let linked: string | undefined = undefined;
      if (isCourier) {
        if (courierId === '__new' || !couriers.some((c) => c.id === courierId)) { const [c] = await save('couriers', { name: fullName.trim(), phone: phone.trim() || undefined, active: true }); linked = c.id; await audit('Livreur ajouté', `${fullName.trim()} (utilisateur)`); }
        else linked = courierId;
      }
      const data = { fullName: fullName.trim(), username: uname, roleId, phone: phone.trim(), email: email.trim(), active, pageIds: isCourier ? [] : pageIds, courierId: linked ?? null as unknown as undefined };
      if (user) {
        await save('users', { id: user.id, ...data });
        if (canSetPwd && pwd) {
          await setPassword(user.id, pwd, { mustChange: false, reason: `Modifié par ${me.fullName}` });
          onCreated({ ...user, ...data } as User, pwd);
        }
        await audit('Utilisateur modifié', `${data.fullName} (${roles.find((r) => r.id === roleId)?.name}${active ? '' : ', désactivé'})`, 'users', user.id);
        toast('Modifications enregistrées');
      } else {
        const finalPwd = canSetPwd ? pwd : tempPassword();
        const [created] = await save('users', { ...data, passwordHash: await hashSecret(finalPwd), mustChangePassword: false });
        await audit('Utilisateur créé', `${data.fullName} — ${roles.find((r) => r.id === roleId)?.name}`, 'users', created.id);
        onCreated(created as User, finalPwd);
      }
      onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={user ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{user ? 'Enregistrer' : 'Créer le compte'}</Button></>}>
      <div className="stack">
        <TextField label="Nom complet" required value={fullName} onChange={setFullName} autoFocus />
        <TextField label="Nom d'utilisateur (identifiant)" required value={username} onChange={setUsername} autoCapitalize="none" disabled={isSuper} hint="Sert à se connecter. Exemple : hery, vendeuse.tiana" />
        <SelectField label="Rôle" value={roleId} onChange={setRoleId} options={roleOptions} hint={roles.find((r) => r.id === roleId)?.description} />
        <TextField label="Téléphone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
        <TextField label="E-mail (facultatif)" value={email} onChange={setEmail} type="email" autoCapitalize="none" />
        {isCourier && (
          <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
            <SelectField label="Fiche livreur" value={courierId} onChange={setCourierId} options={[{ value: '__new', label: '+ Créer sa fiche (même nom et téléphone)' }, ...freeCouriers.map((c) => ({ value: c.id, label: c.name }))]} hint="Le livreur verra seulement ses colis et son compte. Ses livraisons et ses versements sont ceux de cette fiche." />
          </div>
        )}
        {!isCourier && <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Pages attribuées (catégories)</strong>
          <Help>Le vendeur verra d’abord le stock, les articles, ses commandes et ses clients de ces pages. Les livraisons restent visibles par tous. Ne cochez rien pour qu’il voie tout.</Help>
          {pages.length === 0 ? <p className="small muted">Créez d’abord les catégories (une par page) dans Articles.</p> : (
            <MultiPick label="Pages attribuées" values={pageIds} onChange={setPageIds} empty="Aucune page (voit tout)" options={pages.map((c) => ({ value: c.id, label: c.name }))} />
          )}
        </div>}
        {user && !isSelf && !isSuper && <Toggle checked={active} onChange={setActive} label="Compte actif (décochez pour bloquer l'accès)" />}
        {canSetPwd ? (
          <div className="card stack" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <PasswordField label={user ? 'Nouveau mot de passe' : 'Mot de passe'} required={!user} value={pwd} onChange={setPwd} autoComplete="new-password"
                  hint={user ? 'Laissez vide pour ne pas le changer.' : 'Proposé automatiquement, vous pouvez le remplacer.'} />
              </div>
              <Button variant="ghost" type="button" icon="refresh" onClick={() => setPwd(tempPassword())}>Générer</Button>
            </div>
            <p className="small muted">{isSelf ? 'Votre nouveau mot de passe.' : 'C’est ce mot de passe que la personne utilisera pour se connecter. Elle ne peut pas le changer elle-même.'}</p>
          </div>
        ) : (!user && <div className="notice"><Icon name="key" /><span>Un mot de passe provisoire sera créé et affiché après l'enregistrement.</span></div>)}
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
        {user && <p className="small muted">Compte créé {timeAgo(user.createdAt)}.</p>}
      </div>
    </Modal>
  );
}
