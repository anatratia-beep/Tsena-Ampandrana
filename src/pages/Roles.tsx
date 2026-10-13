// Rôles et matrice des droits : l'admin coche ce que chaque rôle peut faire.
import { Fragment, useState } from 'react';
import { audit, useCurrentUser, type Role, type User, useMe } from '../lib/auth';
import { remove, save, useTable } from '../lib/db';
import { PERMISSIONS, SUPERADMIN_ROLE } from '../lib/permissions';
import { Badge, Button, Confirm, IconButton, Modal, PageHead, SelectField, TextField, toast } from '../ui/kit';

export function RolesPage() {
  const roles = useTable<Role>('roles');
  const users = useTable<User>('users');
  const me = useMe();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const ordered = [...roles].sort((a, b) => Number(!!b.system) - Number(!!a.system) || a.createdAt.localeCompare(b.createdAt));
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];

  async function toggle(role: Role, key: string, on: boolean) {
    if (!on && role.id === me.roleId && key === 'users.manage') {
      toast('Vous ne pouvez pas retirer ce droit à votre propre rôle : vous perdriez l’accès à cette page.', 'error');
      return;
    }
    const permissions = on ? [...new Set([...role.permissions, key])] : role.permissions.filter((k) => k !== key);
    await save('roles', { id: role.id, permissions });
    const label = PERMISSIONS.find((p) => p.key === key)?.label;
    await audit('Droits modifiés', `${role.name} : ${on ? 'peut' : 'ne peut plus'} « ${label} »`, 'roles', role.id);
  }

  return (
    <>
      <PageHead title="Rôles et accès" subtitle="Cochez ce que chaque rôle a le droit de faire. Les changements s'appliquent immédiatement à tous les comptes du rôle."
        actions={<Button icon="plus" onClick={() => setEditing('new')}>Créer un rôle</Button>} />

      <div className="grid-2">
        {ordered.map((r) => {
          const count = users.filter((u) => u.roleId === r.id && !u.removed).length;
          return (
            <div key={r.id} className="card stack-s">
              <div className="row-between" style={{ minHeight: 44 }}>
                <h3>{r.name}</h3>
                <div className="row" style={{ gap: 0 }}>
                  {!r.locked && <IconButton icon="edit" label="Renommer" onClick={() => setEditing(r)} />}
                  {!r.system && <IconButton icon="trash" label="Supprimer" onClick={() => count ? toast(`Ce rôle a encore ${count} utilisateur(s). Changez-leur de rôle d'abord.`, 'error') : setDeleting(r)} />}
                </div>
              </div>
              <p className="small muted">{r.description}</p>
              <div className="row" style={{ gap: 6 }}>
                <Badge>{count} utilisateur{count > 1 ? 's' : ''}</Badge>
                <Badge tone="brand">{r.id === SUPERADMIN_ROLE ? PERMISSIONS.length : r.permissions.length} droits</Badge>
                {r.locked && <Badge tone="warn">Verrouillé</Badge>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card card-flush">
        <div className="table-wrap" style={{ maxHeight: '70vh' }}>
          <table className="table perm-table">
            <thead>
              <tr>
                <th>Droit</th>
                {ordered.map((r) => <th key={r.id}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="perm-group"><td colSpan={ordered.length + 1}>{g}</td></tr>
                  {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                    <tr key={p.key}>
                      <td>{p.label}</td>
                      {ordered.map((r) => {
                        const locked = r.locked || (p.key === 'system.admin');
                        const checked = r.id === SUPERADMIN_ROLE || r.permissions.includes(p.key);
                        return (
                          <td key={r.id}>
                            <input type="checkbox" className="perm-check" checked={checked} disabled={locked}
                              aria-label={`${r.name} — ${p.label}`}
                              onChange={(e) => toggle(r, p.key, e.target.checked)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted">Le droit « Restaurer, réinitialiser, réparer » est réservé au super-admin.</p>

      {editing && <RoleForm role={editing === 'new' ? null : editing} roles={roles} onClose={() => setEditing(null)} />}
      {deleting && <Confirm title="Supprimer le rôle" danger confirmLabel="Supprimer"
        message={<p>Le rôle <strong>{deleting.name}</strong> sera supprimé.</p>}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await remove('roles', deleting.id); await audit('Rôle supprimé', deleting.name, 'roles', deleting.id); toast('Rôle supprimé'); }} />}
    </>
  );
}

function RoleForm({ role, roles, onClose }: { role: Role | null; roles: Role[]; onClose: () => void }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [copyFrom, setCopyFrom] = useState('role-seller');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={role ? 'Modifier le rôle' : 'Nouveau rôle'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button busy={busy} disabled={!name.trim()} onClick={async () => {
          setBusy(true);
          if (role) {
            await save('roles', { id: role.id, name: name.trim(), description: description.trim() });
            await audit('Rôle modifié', name.trim(), 'roles', role.id);
          } else {
            const base = roles.find((r) => r.id === copyFrom);
            const [r] = await save('roles', { name: name.trim(), description: description.trim(), permissions: (base?.permissions ?? []).filter((k) => k !== 'system.admin'), permsCatalog: PERMISSIONS.map((p) => p.key) });
            await audit('Rôle créé', name.trim(), 'roles', r.id);
          }
          toast('Rôle enregistré');
          onClose();
        }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom du rôle" required value={name} onChange={setName} autoFocus placeholder="Exemple : Caissière" />
        <TextField label="Description" value={description} onChange={setDescription} />
        {!role && <SelectField label="Partir des droits de" value={copyFrom} onChange={setCopyFrom}
          options={[{ value: '', label: 'Aucun droit' }, ...roles.filter((r) => r.id !== 'role-superadmin').map((r) => ({ value: r.id, label: r.name }))]} />}
      </div>
    </Modal>
  );
}
