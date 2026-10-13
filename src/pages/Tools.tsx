// Paramètres → Outils (admin) : vérification de la cohérence, export complet, espace utilisé.
// Paramètres → Système (super-admin) : effacer les données de test.
import { useEffect, useMemo, useState } from 'react';
import { currentUser, useCan } from '../lib/auth';
import { get, save, useTable, workDate, type WorkDateRec } from '../lib/db';
import { audit } from '../lib/auth';
import { DATA_GROUPS, KEPT_LABEL, checkData, clearData, exportAllExcel, optimizePhotos, photoStats, tableCounts, type Issue } from '../lib/maintenance';
import { Help, Badge, Button, Confirm, TextField, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

const TABLE_LABELS: Record<string, string> = {
  users: 'Utilisateurs', roles: 'Rôles', settings: 'Paramètres', audit: 'Journal', categories: 'Catégories', products: 'Articles', variants: 'Variantes', stockMoves: 'Mouvements de stock',
  suppliers: 'Fournisseurs', purchases: 'Achats', receptions: 'Réceptions', zones: 'Zones', couriers: 'Livreurs', customers: 'Clients', orders: 'Commandes et ventes',
  printStations: "Postes d'impression", printJobs: 'Impressions', cashMoves: 'Mouvements de trésorerie', financeCategories: 'Catégories de dépenses', recurring: 'Opérations récurrentes',
  courierSettlements: 'Versements livreurs', closings: 'Anciennes clôtures', boosts: 'Boosts publicitaires', syncConflicts: 'Conflits de synchronisation', devices: 'Appareils reliés', payouts: 'Versements au patron', boostReadings: 'Résultats des boosts', pageMessages: 'Messages réels par page',
};

export function ToolsTab() {
  const can = useCan();
  const o = useTable('orders'); const v = useTable('variants'); const m = useTable('stockMoves'); const p = useTable('products');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState('');
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const counts = useMemo(() => tableCounts(), [o, v, m, p]);
  useEffect(() => { (navigator.storage?.estimate?.() as Promise<any> | undefined)?.then((e) => e && setUsage({ used: e.usage || 0, quota: e.quota || 0 })).catch(() => {}); }, []);
  const run = () => setIssues(checkData());
  useEffect(() => { if (issues) run(); }, [o, v, m, p]);
  const problems = issues?.filter((i) => i.level !== 'ok').length ?? 0;
  const mb = (n: number) => (n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
  return (
    <div className="stack">
      <WorkDateCard />
      <div className="card stack">
        <div className="row-between">
          <div><h3>Vérifier les données</h3><Help>Recalcule le stock à partir de tous les mouvements et cherche les incohérences (stock négatif, commandes sans livreur, trop-perçus…). Rien n’est modifié sans votre accord.</Help></div>
          <Button icon="search" onClick={run}>{issues ? 'Vérifier à nouveau' : 'Lancer la vérification'}</Button>
        </div>
        {issues && <p><Badge tone={problems ? 'warn' : 'ok'}>{problems ? `${problems} point(s) à regarder` : 'Tout est en ordre'}</Badge> <span className="small muted">Stock recalculé à partir de {m.length.toLocaleString('fr-FR')} mouvement(s).</span></p>}
        {issues && (
          <ul className="list">
            {issues.map((i) => (
              <li key={i.key} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span style={{ color: i.level === 'ok' ? 'var(--ok)' : i.level === 'warn' ? 'var(--danger)' : 'var(--gold)', marginTop: 2 }}><Icon name={i.level === 'ok' ? 'check' : 'alert'} /></span>
                <div className="list-item-main">
                  <span className="list-item-title">{i.title}{i.items.length ? ` (${i.items.length})` : ''}</span>
                  <p className="small muted">{i.detail}</p>
                  {i.items.length > 0 && <details><summary className="small">Voir la liste</summary><p className="small" style={{ whiteSpace: 'pre-line' }}>{i.items.slice(0, 100).join('\n')}{i.items.length > 100 ? `\n… et ${i.items.length - 100} autre(s)` : ''}</p></details>}
                </div>
                {i.fix && can('stock.adjust') && <Button variant="ghost" busy={busy === i.key} onClick={async () => { setBusy(i.key); try { await i.fix!(); toast('Correction faite'); run(); } finally { setBusy(''); } }}>{i.fixLabel}</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {can('catalog.edit') && <PhotosCard />}

      {can('backup.manage') && (
        <div className="card stack">
          <div><h3>Exporter toutes les données en Excel</h3><Help>Un classeur avec une feuille par type de données (articles, commandes, trésorerie…), pour vos archives ou votre comptable. Les mots de passe et les photos ne sont pas exportés.</Help></div>
          <div><Button variant="ghost" icon="download" busy={busy === 'xls'} onClick={async () => { setBusy('xls'); try { await exportAllExcel(); } finally { setBusy(''); } }}>Exporter en Excel</Button></div>
        </div>
      )}

      <div className="card stack-s">
        <h3>Données sur cet appareil</h3>
        {usage && <p className="small">Espace utilisé : <strong>{mb(usage.used)}</strong>{usage.quota ? ` sur ${mb(usage.quota)} disponibles` : ''}.</p>}
        <div className="table-wrap"><table className="kv-table"><tbody>
          {counts.filter((c) => c.n).map((c) => <tr key={c.t}><td>{TABLE_LABELS[c.t] ?? c.t}</td><td>{c.n.toLocaleString('fr-FR')}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}

/** Super-admin : effacer les données de test en gardant les réglages. */
export function ClearDataCard() {
  const [sel, setSel] = useState<string[]>(DATA_GROUPS.filter((g) => g.default).map((g) => g.key));
  const [open, setOpen] = useState(false);
  // « Efface aussi » en chaîne : ex. Pages → Articles → Ventes, Stock, Achats.
  const needsAll = (k: string, seen = new Set<string>()): string[] => { for (const n of DATA_GROUPS.find((x) => x.key === k)?.needs ?? []) if (!seen.has(n)) { seen.add(n); needsAll(n, seen); } return [...seen]; };
  const toggle = (k: string) => {
    if (sel.includes(k)) setSel(sel.filter((x) => x !== k && !needsAll(x).includes(k)));
    else setSel([...new Set([...sel, k, ...needsAll(k)])]);
  };
  return (
    <div className="card stack" style={{ borderColor: 'var(--gold)' }}>
      <div><h3>Effacer les données de test</h3><Help>Pour repartir de zéro après les essais, sans refaire les réglages. Une sauvegarde est faite juste avant (fichier + cloud). L’effacement est envoyé à tous les appareils reliés.</Help></div>
      <div className="stack-s">
        {DATA_GROUPS.map((g) => (
          <label key={g.key} className="row" style={{ gap: 10, alignItems: 'center' }}>
            <input type="checkbox" className="perm-check" checked={sel.includes(g.key)} onChange={() => toggle(g.key)} />
            <span>{g.label}{g.needs ? <span className="small muted"> (efface aussi : {g.needs.map((n) => DATA_GROUPS.find((d) => d.key === n)!.label.split(/[ ,:]/)[0].toLowerCase()).join(', ')})</span> : null}</span>
          </label>
        ))}
      </div>
      <p className="small">{KEPT_LABEL}</p>
      <div><Button variant="danger" icon="trash" disabled={!sel.length} onClick={() => setOpen(true)}>Effacer la sélection</Button></div>
      {open && <Confirm title="Effacer les données sélectionnées ?" danger confirmLabel="Effacer" typeToConfirm="EFFACER" onClose={() => setOpen(false)}
        message={<div className="stack-s"><p>Seront effacés : <strong>{DATA_GROUPS.filter((g) => sel.includes(g.key)).map((g) => g.label).join(' ; ')}</strong>.</p><p className="small muted">Un fichier de sauvegarde va être téléchargé avant l’effacement.</p></div>}
        onConfirm={async () => { const n = await clearData(sel); toast(`${n.toLocaleString('fr-FR')} enregistrement(s) effacé(s)`); }} />}
    </div>
  );
}

const realToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Date de saisie commune à tous les appareils (enregistrée dans les paramètres synchronisés). */
async function setWorkDate(d: string | null) {
  const u = currentUser();
  await save('settings', { id: 'workdate', date: d, byName: u?.fullName, at: new Date().toISOString() });
  await audit('Date de saisie', d ? `Date de saisie commune fixée au ${d} pour tous les appareils` : 'Retour à la date du jour pour tous les appareils');
  toast(d ? `Tous les appareils saisiront à la date du ${longDay(d)}` : 'Retour à la date du jour pour tous les appareils');
}

/** Choisir une date passée pour les saisies (tests ou rattrapage d'un cahier) — pour tous les utilisateurs. */
function WorkDateCard() {
  useTable('settings');
  const rec = get<WorkDateRec>('settings', 'workdate');
  const active = workDate();
  const [d, setD] = useState(active ?? '');
  const [ask, setAsk] = useState(false);
  return (
    <div className="card stack" style={active ? { borderColor: 'var(--gold)' } : undefined}>
      <div><h3>Date de saisie (tous les appareils)</h3>
        <p className="small muted">Pour faire des essais avec des dates passées, ou pour rattraper les ventes d’un cahier : choisissez un jour passé. La date s’applique à <strong>tous les utilisateurs et tous les appareils</strong> reliés au cloud (dès leur synchronisation) et reste en place jusqu’à ce que l’admin ou le gérant la change ou revienne à aujourd’hui. Tout ce qui est saisi (ventes sur place, commandes, livraisons, retours, paiements, versements, dépenses, mouvements de stock) prend ce jour, à l’heure actuelle.</p></div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ maxWidth: 220 }}><TextField label="Saisir à la date du" type="date" required value={d} max={realToday()} onChange={setD} /></div>
        <Button disabled={!d || d >= realToday() || d === active} onClick={() => setAsk(true)}>Appliquer à tous</Button>
        {active && <Button variant="ghost" onClick={async () => { await setWorkDate(null); setD(''); }}>Revenir à aujourd’hui (tous)</Button>}
      </div>
      {ask && <Confirm title="Changer la date de saisie de tous les appareils ?" danger confirmLabel="Appliquer à tous" onClose={() => setAsk(false)} onConfirm={() => setWorkDate(d)}
        message={<p>À partir de maintenant, <strong>tous les utilisateurs</strong> enregistreront leurs ventes, livraisons, dépenses et mouvements de stock à la date du <strong>{d ? longDay(d) : ''}</strong>, jusqu’à ce que vous reveniez à aujourd’hui. À n’utiliser que pour des essais ou pour rattraper un cahier.</p>} />}
      {active && <p><Badge tone="warn">En cours : saisies datées du {longDay(active)}</Badge>{rec?.byName ? <span className="small muted"> — fixée par {rec.byName}{rec.at ? ` le ${new Date(rec.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span> : null}</p>}
    </div>
  );
}

/** Bandeau visible sur toutes les pages, pour tous les utilisateurs, tant qu'une date passée est utilisée. */
export function WorkDateBanner() {
  useTable('settings');
  const can = useCan();
  const active = workDate();
  const rec = get<WorkDateRec>('settings', 'workdate');
  if (!active) return null;
  return (
    <div className="notice workdate-banner"><Icon name="alert" />
      <span style={{ flex: 1 }}><strong>Saisies datées du {longDay(active)}</strong> — date fixée{rec?.byName ? ` par ${rec.byName}` : ''} pour tous les appareils : tout ce que vous enregistrez prend cette date.</span>
      {can('users.manage') && <Button variant="ghost" onClick={() => setWorkDate(null)}>Revenir à aujourd’hui (tous)</Button>}
    </div>
  );
}

function PhotosCard() {
  useTable('products'); useTable('variants'); useTable('cashMoves'); useTable('categories');
  const st = photoStats();
  const [prog, setProg] = useState('');
  const ko = (b: number) => Math.round(b / 1024).toLocaleString('fr-FR') + ' Ko';
  return (
    <div className="card stack">
      <div><h3>Photos et logos</h3>
        <Help>Norme appliquée à chaque image avant d’être enregistrée : photo d’article 600 px / ~50 Ko (bien reconnaissable), photo de reçu 1000 px / ~110 Ko (texte lisible), logo 256 px / ~40 Ko. Les images plus anciennes ou trop lourdes sont réduites automatiquement une fois par jour par l’appareil d’un admin ; ce bouton le fait tout de suite.</Help></div>
      <p className="small">{st.count} photo(s) · {ko(st.bytes)} au total{st.count ? ` · moyenne ${ko(st.bytes / st.count)}` : ''}{st.heavy ? ` · ${st.heavy} à optimiser` : ' · toutes optimisées'}</p>
      <div className="row" style={{ alignItems: 'center' }}>
        <Button variant="ghost" icon="refresh" disabled={!st.heavy || !!prog} onClick={async () => {
          const r = await optimizePhotos((d, t) => setProg(`${d} / ${t}`));
          setProg(''); toast(r.count ? `${r.count} photo(s) optimisée(s) : ${ko(r.before)} → ${ko(r.after)}` : 'Rien à optimiser');
        }}>Optimiser les photos</Button>
        {prog && <span className="small muted">{prog}…</span>}
      </div>
    </div>
  );
}
