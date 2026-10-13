// Caisse du jour (vendeurs) : une seule caisse commune pour tous les vendeurs.
// - saisie des dépenses du jour payées avec la caisse commune (compte « Caisse espèces ») ;
// - récapitulatif global du jour (tous les vendeurs) à envoyer par WhatsApp au gérant et au patron.
import { useRef, useState } from 'react';
import { audit, useCan, useCurrentUser } from '../lib/auth';
import { useTable } from '../lib/db';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import { compressPhoto } from '../lib/images';
import { addDays, addMove, atFor, deleteMove, today, type FinanceCategory } from '../lib/money';
import { catName, dayRecap, dayRecapText, dayReview } from '../lib/payouts';
import { closedBy } from '../lib/closed';
import { fmtPhone, normPhone } from '../lib/orders';
import { useCompany } from '../lib/settings';
import { Help, Badge, Button, Confirm, Empty, IconButton, PageHead, SelectField, TextField, fmtDate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import type { CashMove } from '../lib/money';

const wa = (phone: string | undefined, text: string) => {
  const p = normPhone(phone || '');
  return `https://wa.me/${p ? '261' + p.replace(/^0/, '') : ''}?text=${encodeURIComponent(text)}`;
};

export function DayCashPage() {
  const can = useCan();
  const user = useCurrentUser();
  const company = useCompany();
  useTable('orders'); useTable('cashMoves'); useTable('categories'); useTable('products'); useTable('variants'); useTable('payouts');
  const [date, setDate] = useState(today());
  if (!can('cashday.use')) return <Empty icon="lock" title="Accès réservé" />;
  const isToday = date === today();
  const r = dayRecap(date);
  const text = dayRecapText(date, company.name, user?.fullName);
  const longDate = new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHead title="Caisse du jour" subtitle="Une seule caisse commune pour tous les vendeurs : dépenses du jour et récapitulatif global à envoyer" />
      <div className="card row" style={{ alignItems: 'center', gap: 6 }}>
        <IconButton icon="chevronLeft" label="Jour précédent" onClick={() => setDate(addDays(date, -1))} />
        <strong style={{ textTransform: 'capitalize' }}>{longDate}</strong>
        <IconButton icon="chevronRight" label="Jour suivant" disabled={isToday} onClick={() => setDate(addDays(date, 1))} />
        {!isToday && <Button variant="quiet" onClick={() => setDate(today())}>Aujourd’hui</Button>}
      </div>

      <div className="stat-grid">
        <div className="card stat"><span className="small muted">Total des ventes (tous les vendeurs)</span><strong className="stat-value num">{fmtAr(r.sales)}</strong></div>
        <div className="card stat"><span className="small muted">Dépenses de la caisse commune</span><strong className={`stat-value num ${r.expenses ? 'neg' : ''}`}>{fmtAr(r.expenses)}</strong></div>
        <div className="card stat stat-strong"><span className="small muted">Montant net du jour</span><strong className="stat-value num">{fmtAr(r.net)}</strong></div>
      </div>

      <Expenses date={date} moves={r.g.expenseMoves} total={r.expenses} />

      <Review date={date} r={r} text={text} />
    </>
  );
}

function Expenses({ date, moves, total }: { date: string; moves: CashMove[]; total: number }) {
  const can = useCan();
  const user = useCurrentUser();
  const cats = useTable<FinanceCategory>('financeCategories').filter((c) => c.active !== false && c.kind === 'expense').sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('');
  const [label, setLabel] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<CashMove | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const isToday = date === today();
  const closed = closedBy(date);
  const n = parseAr(amount) || 0;
  const catId = cat || (cats.find((c) => c.id === 'fc-divers') ?? cats[0])?.id || '';
  const submit = async () => {
    setBusy(true);
    try {
      await addMove({ at: atFor(date), account: 'cash', amount: -Math.abs(n), type: 'expense', categoryId: catId || undefined, label: label.trim() || undefined, photo });
      toast('Dépense enregistrée dans la caisse commune');
      setAmount(''); setLabel(''); setPhoto(undefined);
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><div><h2>Dépenses de la caisse commune</h2><p className="small muted">Toutes les dépenses payées avec la caisse, quel que soit le vendeur qui les saisit. Elles sont déduites du montant net.</p></div><strong className="num neg">{fmtAr(total)}</strong></div>
      {isToday && !closed && (
        <div className="card-pad stack-s daycash-form">
          <div className="grid-2">
            <TextField label="Montant de la dépense (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
            <SelectField label="Catégorie" value={catId} onChange={setCat} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
          <TextField label="Description (ex. taxi livraison Analakely)" required value={label} onChange={setLabel} />
          <div className="row" style={{ alignItems: 'center' }}>
            <Button variant="ghost" icon="upload" onClick={() => file.current?.click()}>{photo ? 'Changer la photo du reçu' : 'Photo du reçu (facultatif)'}</Button>
            {photo && <><img src={photo} alt="Reçu" style={{ height: 44, borderRadius: 8 }} /><Button variant="quiet" onClick={() => setPhoto(undefined)}>Retirer</Button></>}
            <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await compressPhoto(f, { max: 1000, targetBytes: 110_000 })); } catch (err: any) { toast(err?.message ?? 'Photo illisible', 'error'); } } e.target.value = ''; }} />
            <Button icon="plus" busy={busy} disabled={!n || !label.trim()} onClick={submit} style={{ marginLeft: 'auto' }}>Enregistrer la dépense</Button>
          </div>
          <p className="small muted">Payée depuis : <strong>Caisse espèces (caisse commune)</strong> · saisie par {user?.fullName}</p>
        </div>
      )}
      {closed && <p className="card-pad small"><Badge tone="ok">Semaine clôturée</Badge> Le versement de cette semaine a été validé : plus de dépense possible sur ce jour.</p>}
      {!isToday && !closed && <p className="card-pad small muted">Les dépenses se saisissent le jour même. Pour corriger un autre jour, demandez au gérant (Trésorerie).</p>}
      {moves.length === 0 ? <p className="card-pad small muted">Aucune dépense ce jour.</p> : (
        <ul className="list">{moves.map((m) => {
          const mine = m.userName && m.userName === user?.fullName;
          const canDel = !closed && (can('expenses.manage') || (mine && isToday));
          return (
            <li key={m.id} className="list-item">
              <div className="list-item-main"><span className="list-item-title">{m.label || catName(m.categoryId) || 'Dépense'}</span>
                <p className="small muted">{catName(m.categoryId)}{m.userName ? ` · ${m.userName}` : ''} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}{m.photo ? ' · reçu joint' : ''}</p></div>
              <strong className="num neg">{fmtAr(-m.amount)}</strong>
              {canDel && <IconButton icon="trash" label="Supprimer" onClick={() => setDel(m)} />}
            </li>
          );
        })}</ul>
      )}
      {del && <Confirm title="Supprimer cette dépense ?" danger confirmLabel="Supprimer" message={<p>{del.label} — {fmtAr(-del.amount)}</p>} onConfirm={async () => { await deleteMove(del); toast('Dépense supprimée'); }} onClose={() => setDel(null)} />}
    </div>
  );
}

const KIND = { shop: { label: 'Sur place', tone: 'brand' }, online: { label: 'Livraison', tone: 'neutral' }, return: { label: 'Retour', tone: 'danger' } } as const;
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Aperçu du jour à vérifier, puis envoi WhatsApp (seulement après confirmation de la vérification). */
function Review({ date, r, text }: { date: string; r: ReturnType<typeof dayRecap>; text: string }) {
  const company = useCompany();
  const { rows, warnings } = dayReview(date);
  // Empreinte des chiffres : si une vente ou une dépense change après la vérification, il faut revérifier.
  const sig = `${date}|${rows.length}|${Math.round(r.sales)}|${r.g.expenseMoves.length}|${r.expenses}`;
  const [checks, setChecks] = useState({ sales: false, expenses: false, totals: false });
  const [verified, setVerified] = useState<string | null>(null);
  const ok = verified === sig;
  const allChecked = checks.sales && checks.expenses && checks.totals;
  const stale = verified !== null && verified !== sig;
  const confirm = async () => {
    setVerified(sig);
    await audit('Récapitulatif du jour vérifié', `${fmtDate(date)} : ${rows.length} opération(s) de vente, ventes ${fmtAr(r.sales)}, ${r.g.expenseMoves.length} dépense(s) ${fmtAr(r.expenses)}, net ${fmtAr(r.net)}`);
    toast('Vérification confirmée : vous pouvez envoyer le récapitulatif');
  };
  const sent = (to: string) => { void audit('Récapitulatif du jour envoyé', `${fmtDate(date)} → ${to} : ventes ${fmtAr(r.sales)}, dépenses ${fmtAr(r.expenses)}, net ${fmtAr(r.net)}`); };
  const box = (k: keyof typeof checks, label: string) => (
    <label className="row small review-check"><input type="checkbox" checked={checks[k]} onChange={(e) => { setChecks({ ...checks, [k]: e.target.checked }); setVerified(null); }} /> {label}</label>
  );
  return (
    <>
      <div className="card card-flush">
        <div className="card-pad"><h2>1. Aperçu des ventes du jour <Badge>{rows.length} opération(s)</Badge></h2>
          <Help>Toutes les ventes enregistrées par tous les vendeurs : ventes sur place, colis remis aux livreurs et retours. Vérifiez qu’il ne manque rien et que les montants sont justes.</Help></div>
        {rows.length === 0 ? <p className="card-pad small muted">Aucune vente enregistrée ce jour.</p> : (
          <div className="table-wrap"><table className="table review-table">
            <thead><tr><th>Heure</th><th>N°</th><th>Type</th><th>Client</th><th>Page</th><th>Articles</th><th>Vendeur</th><th className="t-num">Montant</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key}>
                  <td>{hm(x.at)}</td><td><a href={`#/commandes/${x.orderId}`}>{x.number}</a></td>
                  <td><Badge tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Badge></td>
                  <td className="small">{x.who}</td><td className="small">{x.pages.join(', ')}</td>
                  <td className="small">{x.items.join(' ; ')}</td><td className="small">{x.seller ?? '—'}</td>
                  <td className={`t-num ${x.amount < 0 ? 'neg' : ''}`}><strong>{fmtAr(x.amount)}</strong></td>
                </tr>
              ))}
              <tr className="t-total"><td colSpan={7}>Total des ventes (retours déduits)</td><td className="t-num">{fmtAr(r.sales)}</td></tr>
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card card-flush">
        <div className="card-pad"><h2>2. Totaux à transmettre</h2><p className="small muted">Ce sont exactement les montants du message WhatsApp.</p></div>
        <div className="table-wrap"><table className="table">
          <tbody>
            {r.pages.map((p) => <tr key={p.id}><td>Ventes — {p.name}</td><td className="t-num">{fmtAr(r.g.pageTotals[p.id])}</td></tr>)}
            <tr className="t-total"><td>Total des ventes <span className="small muted">(sur place {fmtAr(r.shop)} · livraisons {fmtAr(r.online)})</span></td><td className="t-num">{fmtAr(r.sales)}</td></tr>
            <tr><td>Dépenses de la caisse commune ({r.g.expenseMoves.length})</td><td className="t-num neg">− {fmtAr(r.expenses)}</td></tr>
            <tr className="t-total"><td><strong>Montant net du jour</strong> <span className="small muted">= ventes − dépenses</span></td><td className="t-num"><strong>{fmtAr(r.net)}</strong></td></tr>
          </tbody>
        </table></div>
      </div>

      <div className="card stack-s daycash-send">
        <h2>3. Vérifier puis envoyer</h2>
        {warnings.length > 0 && <div className="notice"><Icon name="alert" /><div className="stack-s"><strong>Points à contrôler avant l’envoi</strong>{warnings.map((w) => <span key={w} className="small">• {w}</span>)}</div></div>}
        {stale && <div className="notice notice-danger"><Icon name="alert" /><span>Les chiffres ont changé depuis votre vérification (vente ou dépense ajoutée, modifiée ou supprimée). Vérifiez à nouveau.</span></div>}
        <div className="stack-s">
          {box('sales', `J’ai vérifié les ${rows.length} vente(s) / retour(s) du tableau 1 : rien ne manque et les montants sont justes.`)}
          {box('expenses', `J’ai vérifié les ${r.g.expenseMoves.length} dépense(s) de la caisse commune : rien ne manque.`)}
          {box('totals', `Je confirme les totaux : ventes ${fmtAr(r.sales)}, dépenses ${fmtAr(r.expenses)}, net ${fmtAr(r.net)}.`)}
        </div>
        {!ok && <div><Button icon="check" disabled={!allChecked} onClick={confirm}>Confirmer la vérification</Button></div>}
        {ok && <p className="small pos"><strong>✓ Vérification confirmée.</strong> Vous pouvez envoyer le récapitulatif.</p>}
        <div className={`row ${ok ? '' : 'is-locked'}`} aria-disabled={!ok}>
          {ok ? <>
            <a className="btn btn-primary btn-wa" href={wa(company.managerPhone, text)} target="_blank" rel="noreferrer" onClick={() => sent('gérant')}><Icon name="share" />WhatsApp au gérant</a>
            <a className="btn btn-primary btn-wa" href={wa(company.bossPhone, text)} target="_blank" rel="noreferrer" onClick={() => sent('patron')}><Icon name="share" />WhatsApp au patron</a>
            <a className="btn btn-ghost" href={wa('', text)} target="_blank" rel="noreferrer" onClick={() => sent('autre contact ou groupe')}>Autre contact ou groupe</a>
            <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); sent('copie'); toast('Récapitulatif copié'); } catch { toast('Copie impossible sur cet appareil', 'error'); } }}>Copier</Button>
          </> : <>
            <Button icon="share" disabled>WhatsApp au gérant</Button>
            <Button icon="share" disabled>WhatsApp au patron</Button>
          </>}
        </div>
        {!ok && <p className="small muted">L’envoi s’active une fois les trois cases cochées et la vérification confirmée.</p>}
        <p className="small muted">{company.managerPhone ? `Gérant : ${fmtPhone(company.managerPhone)}` : 'Gérant : numéro non renseigné'} · {company.bossPhone ? `Patron : ${fmtPhone(company.bossPhone)}` : 'Patron : numéro non renseigné'}</p>
        <details><summary className="small">Voir le message qui sera envoyé</summary><pre className="recap-text">{text}</pre></details>
      </div>
    </>
  );
}
