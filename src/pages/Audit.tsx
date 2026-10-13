// Journal d'activité : qui a fait quoi, quand (date et heure), sur quel appareil. Chaque action a une importance
// (Important / Moyen / Simple). Les actions importantes (annulation, correction, suppression, restauration, mot de
// passe, droits…) sont « à vérifier » : le super-admin ou le gérant les marque vérifiées ou suspectes, avec une note.
import { useMemo, useState } from 'react';
import { AUDIT_LEVEL, levelOf, reviewAudit, useCan, type AuditLevel, type User } from '../lib/auth';
import { useTable } from '../lib/db';
import { Badge, Button, Empty, Modal, PageHead, TextField, fmtDateTime, toast } from '../ui/kit';
import { PeriodPicker, inPeriod, type Period, defaultPeriod } from '../ui/period';
import { exportTables, type Col } from '../ui/table';

const TONE: Record<AuditLevel, 'danger' | 'warn' | 'neutral'> = { high: 'danger', medium: 'warn', low: 'neutral' };
const LINK: Record<string, string> = { orders: '#/commandes/', receptions: '#/receptions/', purchases: '#/achats/', products: '#/articles/' };

export function AuditPage() {
  const can = useCan();
  const rows = useTable('audit');
  const users = useTable<User>('users');
  const canReview = can('records.correct');
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [level, setLevel] = useState<'' | AuditLevel>('');
  const [todoOnly, setTodoOnly] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [review, setReview] = useState<any | null>(null);
  const actions = useMemo(() => [...new Set(rows.map((r) => r.action))].sort(), [rows]);
  const lv = (r: any): AuditLevel => r.level ?? levelOf(r.action);
  const todo = rows.filter((r) => r.review === 'todo');
  const suspects = rows.filter((r) => r.review === 'suspect');

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows
      .filter((r) => todoOnly ? r.review === 'todo' || r.review === 'suspect' : inPeriod(r.at, period))
      .filter((r) => !userId || r.userId === userId)
      .filter((r) => !action || r.action === action)
      .filter((r) => !level || lv(r) === level)
      .filter((r) => !n || `${r.details} ${r.userName} ${r.action}`.toLowerCase().includes(n))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [rows, period, userId, action, level, q, todoOnly]);

  const cols: Col<any>[] = [
    { key: 'd', label: 'Date et heure', value: (r) => new Date(r.at).toLocaleString('fr-FR'), width: 20 },
    { key: 'u', label: 'Utilisateur', value: (r) => r.userName, width: 18 }, { key: 'ro', label: 'Rôle', value: (r) => r.role ?? '', width: 14 },
    { key: 'l', label: 'Importance', value: (r) => AUDIT_LEVEL[lv(r)], width: 11 }, { key: 'a', label: 'Action', value: (r) => r.action, width: 24 },
    { key: 't', label: 'Détails', value: (r) => r.details, width: 60 }, { key: 'v', label: 'Vérification', value: (r) => (r.review === 'ok' ? `Vérifié par ${r.reviewBy}` : r.review === 'suspect' ? `SUSPECT (${r.reviewBy}) ${r.reviewNote ?? ''}` : r.review === 'todo' ? 'À vérifier' : ''), width: 24 },
    { key: 'dv', label: 'Appareil', value: (r) => r.device || '', width: 16 },
  ];

  return (
    <>
      <PageHead title="Journal d'activité" subtitle={`${list.length} action${list.length > 1 ? 's' : ''}${todoOnly ? ' à vérifier' : ' sur la période'}`} />
      {canReview && (todo.length > 0 || suspects.length > 0 || todoOnly) && (
        <div className={`notice ${todo.length ? 'notice-danger' : ''}`}>
          <span style={{ flex: 1 }}><strong>{todo.length} action(s) importante(s) à vérifier</strong>{suspects.length ? ` · ${suspects.length} marquée(s) suspecte(s)` : ''}. Annulations, corrections, suppressions, restaurations, mots de passe et droits : regardez qui l’a fait et pourquoi.</span>
          <Button variant={todoOnly ? 'primary' : 'ghost'} onClick={() => setTodoOnly(!todoOnly)}>{todoOnly ? 'Tout le journal' : 'Voir à vérifier'}</Button>
        </div>
      )}
      <div className="card stack">
        {!todoOnly && <PeriodPicker value={period} onChange={setPeriod} />}
        <div className="row">
          <div className="field" style={{ flex: '1 1 200px' }}>
            <input aria-label="Rechercher" placeholder="Rechercher dans le journal" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 1 190px' }}>
            <select aria-label="Utilisateur" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Tous les utilisateurs</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.removed ? ' (supprimé)' : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 160px' }}>
            <select aria-label="Importance" value={level} onChange={(e) => setLevel(e.target.value as any)}>
              <option value="">Toutes importances</option><option value="high">Important</option><option value="medium">Moyen</option><option value="low">Simple</option>
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 200px' }}>
            <select aria-label="Type d'action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Toutes les actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <Button variant="ghost" icon="download" onClick={() => exportTables(`journal_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Journal', cols, rows: list }])}>Excel</Button>
        </div>
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title={todoOnly ? 'Rien à vérifier' : 'Aucune action sur cette période'} /> : (
          <div className="table-wrap">
            <table className="table audit-table">
              <thead><tr><th>Date et heure</th><th>Utilisateur</th><th>Importance</th><th>Action</th><th>Détails</th><th>Vérification</th><th>Appareil</th></tr></thead>
              <tbody>
                {list.slice(0, limit).map((r) => (
                  <tr key={r.id} className={r.review === 'todo' ? 'is-todo' : r.review === 'suspect' ? 'is-suspect' : ''}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</td>
                    <td>{r.userName}{r.role ? <div className="small muted">{r.role}</div> : null}</td>
                    <td><Badge tone={TONE[lv(r)]}>{AUDIT_LEVEL[lv(r)]}</Badge></td>
                    <td><strong>{r.action}</strong></td>
                    <td>{r.details}{r.entity && LINK[r.entity] && r.entityId ? <> · <a href={LINK[r.entity] + r.entityId}>ouvrir</a></> : null}</td>
                    <td>{r.review === 'ok' ? <span className="small pos">✓ {r.reviewBy}<br />{fmtDateTime(r.reviewAt)}</span>
                      : r.review === 'suspect' ? <span className="small neg"><strong>Suspect</strong> · {r.reviewBy}{r.reviewNote ? <><br />{r.reviewNote}</> : null}</span>
                      : r.review === 'todo' ? (canReview ? <Button variant="ghost" className="btn-sm" onClick={() => setReview(r)}>Vérifier</Button> : <Badge tone="danger">À vérifier</Badge>) : <span className="muted">—</span>}</td>
                    <td className="muted">{r.device || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.length > limit && <button className="btn btn-ghost" onClick={() => setLimit(limit + 200)}>Afficher plus ({list.length - limit} restantes)</button>}
      {review && <ReviewModal r={review} onClose={() => setReview(null)} />}
    </>
  );
}

function ReviewModal({ r, onClose }: { r: any; onClose: () => void }) {
  const [note, setNote] = useState('');
  const go = async (s: 'ok' | 'suspect') => { await reviewAudit(r.id, s, note.trim()); toast(s === 'ok' ? 'Action vérifiée' : 'Action marquée suspecte'); onClose(); };
  return (
    <Modal title="Vérifier une action importante" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Plus tard</Button><Button variant="danger" onClick={() => go('suspect')}>Suspect</Button><Button onClick={() => go('ok')}>Vérifié, c’est normal</Button></>}>
      <div className="stack">
        <p><strong>{r.action}</strong> — {fmtDateTime(r.at)} par <strong>{r.userName}</strong>{r.role ? ` (${r.role})` : ''}{r.device ? ` sur ${r.device}` : ''}</p>
        <p>{r.details}</p>
        <TextField label="Note (facultatif)" value={note} onChange={setNote} placeholder="ex. confirmé avec le vendeur, erreur de saisie réelle" />
      </div>
    </Modal>
  );
}
