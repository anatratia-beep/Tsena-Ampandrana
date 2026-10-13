// Tableau de la semaine (jours × pages, dépenses, reste — comme le cahier Excel « Recette et Dépense »),
// versement de la semaine au patron (clôture) et historique des versements. Récapitulatif mensuel pour les rapports.
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { useTable } from '../lib/db';
import { fmtAr } from '../lib/catalog';
import { ACCOUNTS, addDays, dayOf, mondayOf, today, type AccountId, type CashMove } from '../lib/money';
import { cancelPayout, catName, grid, monthly, payoutOf, payouts, unpaidWeeks, usdRate, validatePayout, weekOf, type Grid } from '../lib/payouts';
import type { Payout } from '../lib/closed';
import { Badge, Button, Empty, Modal, SelectField, TextField, fmtDate, fmtDateTime, toast } from '../ui/kit';
import { exportTables, type Col } from '../ui/table';

const dayName = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const cell = (v: number) => (v ? fmtAr(v) : '—');
const useWatch = () => { useTable('orders'); useTable('cashMoves'); useTable('payouts'); useTable('boostReadings'); useTable('boosts'); useTable('categories'); useTable('settings'); useTable('financeCategories'); };

/** Tableau de la semaine : une ligne par jour (lundi → samedi), une colonne par page. */
export function WeekGrid({ monday, withProfit }: { monday: string; withProfit: boolean }) {
  useWatch();
  const w = weekOf(monday);
  const g = grid(w.start, w.end);
  const rate = usdRate();
  const pages = g.pages.filter((p) => g.pageTotals[p.id] || g.boostUsd[p.id]);
  const boostAr = (id: string) => (g.boostUsd[id] ?? 0) * rate;
  const totalBoost = pages.reduce((t, p) => t + boostAr(p.id), 0);
  const totalCost = pages.reduce((t, p) => t + (g.cost[p.id] ?? 0), 0);
  const exportXlsx = () => {
    type R = { label: string; vals: Record<string, number>; exp: number; rest: number; total: number };
    const rows: R[] = [
      ...w.days.map((d) => ({ label: dayName(d), vals: g.sales[d], total: g.dayTotals[d], exp: g.expensesByDay[d], rest: g.dayTotals[d] - g.expensesByDay[d] })),
      { label: 'TOTAL', vals: g.pageTotals, total: g.salesTotal, exp: g.expensesTotal, rest: g.rest },
      { label: 'Boost (Ar)', vals: Object.fromEntries(pages.map((p) => [p.id, boostAr(p.id)])), total: totalBoost, exp: 0, rest: 0 },
      ...(withProfit ? [{ label: 'Bénéfice (ventes − coût − boost)', vals: Object.fromEntries(pages.map((p) => [p.id, (g.pageTotals[p.id] ?? 0) - (g.cost[p.id] ?? 0) - boostAr(p.id)])), total: g.salesTotal - totalCost - totalBoost, exp: 0, rest: 0 }] : []),
    ];
    const cols: Col<R>[] = [
      { key: 'l', label: 'Jour', value: (r) => r.label, width: 30 },
      ...pages.map((p) => ({ key: p.id, label: p.name, value: (r: R) => Math.round(r.vals[p.id] ?? 0), money: true, width: 16 })),
      { key: 't', label: 'Total ventes', value: (r) => Math.round(r.total), money: true, width: 16 },
      { key: 'e', label: 'Dépenses', value: (r) => r.exp, money: true, width: 14 },
      { key: 'r', label: 'Reste', value: (r) => Math.round(r.rest), money: true, width: 16 },
    ];
    type E = CashMove;
    const ecols: Col<E>[] = [
      { key: 'd', label: 'Date', value: (m) => dayOf(m.at), width: 12 },
      { key: 'c', label: 'Catégorie', value: (m) => catName(m.categoryId) ?? '', width: 24 },
      { key: 'l', label: 'Libellé', value: (m) => m.label ?? '', width: 34 },
      { key: 'a', label: 'Compte', value: (m) => ACCOUNTS[m.account], width: 16 },
      { key: 'm', label: 'Montant', value: (m) => -m.amount, money: true, width: 14 },
    ];
    exportTables(`semaine_${w.start}.xlsx`, [{ name: 'Semaine', cols, rows }, { name: 'Dépenses', cols: ecols, rows: g.expenseMoves }]);
  };
  return (
    <div className="card card-flush">
      <div className="card-pad row-between">
        <div><h2>Tableau de la semaine</h2><p className="small muted">Ventes par page et par jour (retours déduits), dépenses et reste — comme le cahier « Recette et Dépense ». Reste = ventes − dépenses.</p></div>
        <Button variant="ghost" icon="download" onClick={exportXlsx}>Excel</Button>
      </div>
      {pages.length === 0 && !g.expensesTotal ? <p className="card-pad small muted">Aucune vente ni dépense cette semaine.</p> : (
        <div className="table-wrap"><table className="table table-grid">
          <thead><tr><th>Jour</th>{pages.map((p) => <th key={p.id} className="t-num">{p.name}</th>)}<th className="t-num">Total ventes</th><th className="t-num">Dépenses</th><th className="t-num">Reste</th></tr></thead>
          <tbody>
            {w.days.map((d) => (
              <tr key={d}><td><strong>{dayName(d)}</strong></td>
                {pages.map((p) => <td key={p.id} className="t-num">{cell(g.sales[d][p.id] ?? 0)}</td>)}
                <td className="t-num"><strong>{cell(g.dayTotals[d])}</strong></td>
                <td className="t-num neg">{cell(g.expensesByDay[d])}</td>
                <td className="t-num">{cell(g.dayTotals[d] - g.expensesByDay[d])}</td></tr>
            ))}
            <tr className="t-total"><td>Total</td>{pages.map((p) => <td key={p.id} className="t-num">{fmtAr(g.pageTotals[p.id] ?? 0)}</td>)}<td className="t-num">{fmtAr(g.salesTotal)}</td><td className="t-num neg">{fmtAr(g.expensesTotal)}</td><td className="t-num"><strong>{fmtAr(g.rest)}</strong></td></tr>
            {totalBoost > 0 && <tr><td className="muted">Boost <span className="small">({rate.toLocaleString('fr-FR')} Ar/$)</span></td>{pages.map((p) => <td key={p.id} className="t-num muted">{cell(Math.round(boostAr(p.id)))}</td>)}<td className="t-num muted">{fmtAr(Math.round(totalBoost))}</td><td /><td /></tr>}
            {withProfit && <tr><td>Bénéfice <span className="small muted">(ventes − coût − boost)</span></td>{pages.map((p) => { const v = (g.pageTotals[p.id] ?? 0) - (g.cost[p.id] ?? 0) - boostAr(p.id); return <td key={p.id} className={`t-num ${v < 0 ? 'neg' : 'pos'}`}>{fmtAr(Math.round(v))}</td>; })}<td className="t-num"><strong>{fmtAr(Math.round(g.salesTotal - totalCost - totalBoost))}</strong></td><td /><td className="t-num"><strong>{fmtAr(Math.round(g.salesTotal - totalCost - totalBoost - g.expensesTotal))}</strong></td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

/** État du versement de la semaine affichée + bouton « Versement de la semaine ». */
export function PayoutCard({ monday }: { monday: string }) {
  useWatch();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [cancel, setCancel] = useState<Payout | null>(null);
  const w = weekOf(monday);
  const p = payoutOf(monday);
  const g = grid(w.start, w.end);
  const finished = w.end <= today();
  const allowed = can('payout.validate');
  return (
    <div className={`card stack-s payout-card ${p?.status === 'paid' ? 'is-paid' : ''}`}>
      <div className="row-between">
        <div>
          <h2>Versement de la semaine {p?.status === 'paid' ? <Badge tone="ok">Versée · semaine clôturée</Badge> : finished ? <Badge tone="warn">À verser</Badge> : <Badge>Semaine en cours</Badge>}</h2>
          <p className="small muted">Du lundi {fmtDate(w.start)} au samedi {fmtDate(w.end)} · Montant à verser = total des ventes − dépenses de la caisse commune.</p>
        </div>
        {p?.status !== 'paid' && allowed && <Button icon="wallet" disabled={!finished} onClick={() => setOpen(true)}>Versement de la semaine</Button>}
      </div>
      <table className="kv-table"><tbody>
        <tr><td>Total des ventes</td><td>{fmtAr(g.salesTotal)}</td></tr>
        <tr><td>Total des dépenses ({g.expenseMoves.length})</td><td className="neg">− {fmtAr(g.expensesTotal)}</td></tr>
        <tr className="total"><td>Montant à verser</td><td>{fmtAr(g.rest)}</td></tr>
        {p?.status === 'paid' && <>
          <tr><td>Montant remis au patron</td><td><strong>{fmtAr(p.amount)}</strong>{p.gap ? <span className={`small ${p.gap < 0 ? 'neg' : 'pos'}`}> (écart {p.gap > 0 ? '+' : ''}{fmtAr(p.gap)})</span> : null}</td></tr>
          <tr><td>Validé par</td><td>{p.byName ?? '?'} · {fmtDateTime(p.at)}{p.device ? ` · ${p.device}` : ''}</td></tr>
          {p.expected !== g.rest && <tr><td colSpan={2} className="small neg">Attention : les chiffres de la semaine ont changé depuis le versement (attendu à la validation : {fmtAr(p.expected)}).</td></tr>}
        </>}
      </tbody></table>
      {!finished && p?.status !== 'paid' && <p className="small muted">Le versement se fait une fois la semaine terminée (à partir du samedi).</p>}
      {!allowed && p?.status !== 'paid' && finished && <p className="small muted">Seul le gérant (droit « Valider le versement de la semaine ») peut valider ce versement.</p>}
      {p?.status === 'paid' && allowed && <div><Button variant="danger" icon="x" onClick={() => setCancel(p)}>Annuler ce versement (erreur)…</Button></div>}
      {open && <PayoutModal monday={monday} g={g} onClose={() => setOpen(false)} />}
      {cancel && <CancelModal p={cancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

function PayoutModal({ monday, g, onClose }: { monday: string; g: Grid; onClose: () => void }) {
  const w = weekOf(monday);
  const [amount, setAmount] = useState(String(Math.max(0, Math.round(g.rest))));
  const [account, setAccount] = useState<AccountId>('cash');
  const [note, setNote] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Number(amount.replace(/\D/g, '')) || 0;
  const gap = n - g.rest;
  const pages = g.pages.filter((p) => g.pageTotals[p.id]);
  return (
    <Modal wide title={`Versement de la semaine du ${fmtDate(w.start)} au ${fmtDate(w.end)}`} onClose={onClose} footer={<>
      <Button variant="quiet" onClick={onClose}>Annuler</Button>
      <Button busy={busy} disabled={!ok || (gap !== 0 && !note.trim())} onClick={async () => {
        setBusy(true);
        try { await validatePayout(monday, n, account, note.trim() || undefined); toast('Versement validé — la semaine est clôturée'); onClose(); }
        catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Valider le versement</Button>
    </>}>
      <div className="stack">
        <div className="card-sub">
          <h3>1. Ventes de la semaine</h3>
          <table className="kv-table"><tbody>
            {pages.map((p) => <tr key={p.id}><td>{p.name}</td><td>{fmtAr(g.pageTotals[p.id])}</td></tr>)}
            <tr className="total"><td>Total des ventes</td><td>{fmtAr(g.salesTotal)}</td></tr>
          </tbody></table>
        </div>
        <div className="card-sub">
          <h3>2. Dépenses de la caisse commune déduites</h3>
          {g.expenseMoves.length === 0 ? <p className="small muted">Aucune dépense cette semaine.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Jour</th><th>Dépense</th><th>Compte</th><th className="t-num">Montant</th></tr></thead>
              <tbody>
                {g.expenseMoves.map((m) => <tr key={m.id}><td className="small">{dayName(dayOf(m.at))}</td><td>{m.label || catName(m.categoryId) || 'Dépense'}{m.label && catName(m.categoryId) ? <div className="small muted">{catName(m.categoryId)}</div> : null}</td><td className="small">{ACCOUNTS[m.account]}</td><td className="t-num">{fmtAr(-m.amount)}</td></tr>)}
                <tr className="t-total"><td colSpan={3}>Total des dépenses</td><td className="t-num">{fmtAr(g.expensesTotal)}</td></tr>
              </tbody>
            </table></div>
          )}
        </div>
        <div className="card-sub payout-due">
          <span>3. Montant à verser au patron</span>
          <strong className="num">{fmtAr(g.rest)}</strong>
          <span className="small muted">{fmtAr(g.salesTotal)} − {fmtAr(g.expensesTotal)}</span>
        </div>
        <TextField label="Montant réellement remis au patron (Ar)" value={amount} onChange={setAmount} inputMode="numeric" hint={gap ? <span className={gap < 0 ? 'neg' : 'pos'}>Écart : {gap > 0 ? '+' : ''}{fmtAr(gap)} — expliquez-le dans la remarque.</span> : 'Identique au montant à verser.'} />
        <SelectField label="Argent sorti de" value={account} onChange={(v) => setAccount(v as AccountId)} options={Object.entries(ACCOUNTS).map(([value, label]) => ({ value, label }))} />
        <TextField label={gap ? 'Remarque (en cas d’écart)' : 'Remarque (facultatif)'} required={!!gap} value={note} onChange={setNote} />
        <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Je confirme avoir vérifié le détail et remis {fmtAr(n)} au patron. Après validation, la semaine est clôturée : plus aucune vente, livraison ou dépense ne peut y être ajoutée ou supprimée.</label>
      </div>
    </Modal>
  );
}

function CancelModal({ p, onClose }: { p: Payout; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Annuler le versement" onClose={onClose} footer={<>
      <Button variant="quiet" onClick={onClose}>Retour</Button>
      <Button variant="danger" busy={busy} disabled={reason.trim().length < 4} onClick={async () => { setBusy(true); await cancelPayout(p, reason.trim()); toast('Versement annulé — la semaine est rouverte'); onClose(); }}>Annuler le versement</Button>
    </>}>
      <div className="stack">
        <p>Semaine du {fmtDate(p.weekStart)} au {fmtDate(p.weekEnd)} : {fmtAr(p.amount)} remis le {fmtDateTime(p.at)} par {p.byName}.</p>
        <p className="small muted">À utiliser seulement en cas d’erreur. La semaine sera rouverte ; l’annulation reste dans l’historique et le journal d’activité.</p>
        <TextField label="Raison de l’annulation" required value={reason} onChange={setReason} autoFocus />
      </div>
    </Modal>
  );
}

/** Historique des versements + semaines terminées pas encore versées. */
export function PayoutHistory({ onPick }: { onPick: (monday: string) => void }) {
  useWatch();
  const list = payouts();
  const todo = useMemo(() => unpaidWeeks(today(), mondayOf), [list.length]);
  return (
    <div className="card card-flush">
      <div className="card-pad row-between">
        <div><h2>Historique des versements au patron</h2><p className="small muted">Chaque semaine ne peut être versée qu’une seule fois.</p></div>
        {list.length > 0 && <Button variant="ghost" icon="download" onClick={() => exportTables(`versements_${today()}.xlsx`, [{ name: 'Versements', cols: HIST_COLS, rows: list }])}>Excel</Button>}
      </div>
      {todo.length > 0 && <div className="card-pad stack-s" style={{ paddingTop: 0 }}>
        <p className="small"><strong>Semaines terminées pas encore versées :</strong></p>
        <div className="row" style={{ gap: 6 }}>{todo.map((t) => <button key={t.monday} type="button" className="chip" onClick={() => onPick(t.monday)}>{fmtDate(t.monday)} → {fmtDate(addDays(t.monday, 5))} · {fmtAr(t.expected)}</button>)}</div>
      </div>}
      {list.length === 0 ? <Empty icon="wallet" title="Aucun versement enregistré">Le premier apparaîtra ici après validation.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Semaine</th><th className="t-num">Ventes</th><th className="t-num">Dépenses</th><th className="t-num">À verser</th><th className="t-num">Remis</th><th className="t-num">Écart</th><th>Validé par</th><th>État</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id} style={{ opacity: p.status === 'cancelled' ? .6 : 1 }}>
              <td><button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => onPick(p.weekStart)}>{fmtDate(p.weekStart)} → {fmtDate(p.weekEnd)}</button></td>
              <td className="t-num">{fmtAr(p.sales)}</td><td className="t-num neg">{fmtAr(p.expenses)}</td><td className="t-num">{fmtAr(p.expected)}</td>
              <td className="t-num"><strong>{fmtAr(p.amount)}</strong></td><td className={`t-num ${p.gap < 0 ? 'neg' : p.gap > 0 ? 'pos' : ''}`}>{p.gap ? fmtAr(p.gap) : '—'}</td>
              <td className="small">{p.byName ?? '?'}<div className="muted">{fmtDateTime(p.at)}</div>{p.note ? <div className="muted">« {p.note} »</div> : null}</td>
              <td>{p.status === 'paid' ? <Badge tone="ok">Versé</Badge> : <><Badge tone="danger">Annulé</Badge><div className="small muted">{p.cancelledBy} · {fmtDateTime(p.cancelledAt)}<br />{p.cancelReason}</div></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
const HIST_COLS: Col<Payout>[] = [
  { key: 's', label: 'Du', value: (p) => p.weekStart, width: 12 }, { key: 'e', label: 'Au', value: (p) => p.weekEnd, width: 12 },
  { key: 'v', label: 'Ventes', value: (p) => p.sales, money: true, width: 14 }, { key: 'd', label: 'Dépenses', value: (p) => p.expenses, money: true, width: 14 },
  { key: 'x', label: 'À verser', value: (p) => p.expected, money: true, width: 14 }, { key: 'a', label: 'Remis', value: (p) => p.amount, money: true, width: 14 },
  { key: 'g', label: 'Écart', value: (p) => p.gap, money: true, width: 12 }, { key: 'b', label: 'Validé par', value: (p) => p.byName ?? '', width: 18 },
  { key: 't', label: 'Le', value: (p) => fmtDateTime(p.at), width: 18 }, { key: 'n', label: 'Remarque', value: (p) => p.note ?? '', width: 24 },
  { key: 'st', label: 'État', value: (p) => (p.status === 'paid' ? 'Versé' : `Annulé : ${p.cancelReason ?? ''}`), width: 24 },
];

/** Récapitulatif mensuel (Rapports). */
export function MonthlyRecap() {
  useWatch();
  const can = useCan();
  const withProfit = can('costs.view');
  const [n, setN] = useState(3);
  const { rows, pages } = monthly(n, today());
  const cols: Col<(typeof rows)[number]>[] = [
    { key: 'm', label: 'Mois', value: (r) => r.label, width: 18 },
    ...pages.map((p) => ({ key: p.id, label: p.name, value: (r: (typeof rows)[number]) => Math.round(r.pages[p.id] ?? 0), money: true, width: 15 })),
    { key: 'ca', label: 'CA réalisé', value: (r) => Math.round(r.sales), money: true, width: 16 },
    { key: 'dep', label: 'Dépenses', value: (r) => r.expenses, money: true, width: 14 },
    { key: 'rest', label: 'Reste', value: (r) => Math.round(r.rest), money: true, width: 16 },
    { key: 'paid', label: 'Versé au patron', value: (r) => r.paid, money: true, width: 16 },
    { key: 'boost', label: 'Boost (Ar)', value: (r) => Math.round(r.boostAr), money: true, width: 14 },
    ...(withProfit ? [{ key: 'ben', label: 'Bénéfice net estimé', value: (r: (typeof rows)[number]) => Math.round(r.profit), money: true, width: 18 }] : []),
  ];
  const sum = (k: 'sales' | 'expenses' | 'rest' | 'paid' | 'boostAr' | 'profit') => rows.reduce((t, r) => t + r[k], 0);
  return (
    <>
      <div className="stat-grid">
        <div className="card stat"><span className="small muted">CA réalisé ({n} mois)</span><strong className="stat-value num">{fmtAr(Math.round(sum('sales')))}</strong></div>
        <div className="card stat"><span className="small muted">Dépenses</span><strong className="stat-value num neg">{fmtAr(sum('expenses'))}</strong></div>
        <div className="card stat stat-strong"><span className="small muted">Reste</span><strong className="stat-value num">{fmtAr(Math.round(sum('rest')))}</strong></div>
        <div className="card stat"><span className="small muted">Versé au patron</span><strong className="stat-value num">{fmtAr(sum('paid'))}</strong></div>
        <div className="card stat"><span className="small muted">Boost</span><strong className="stat-value num">{fmtAr(Math.round(sum('boostAr')))}</strong></div>
        {withProfit && <div className="card stat"><span className="small muted">Bénéfice net estimé</span><strong className={`stat-value num ${sum('profit') < 0 ? 'neg' : ''}`}>{fmtAr(Math.round(sum('profit')))}</strong></div>}
      </div>
      <div className="card card-flush">
        <div className="card-pad row-between">
          <div><h2>Récapitulatif mensuel</h2><p className="small muted">Comme l’onglet « RECAP MENSUEL » : ventes par page, CA, dépenses, reste (CA − dépenses), versé au patron, boost converti en ariary{withProfit ? ', bénéfice net estimé = CA − coût des articles − boost − dépenses' : ''}.</p></div>
          <div className="row" style={{ gap: 6 }}>
            <div className="segmented" role="group" aria-label="Nombre de mois">{[3, 6, 12].map((k) => <button key={k} type="button" aria-pressed={n === k} onClick={() => setN(k)}>{k} mois</button>)}</div>
            <Button variant="ghost" icon="download" onClick={() => exportTables(`recap-mensuel_${today()}.xlsx`, [{ name: 'Récap mensuel', cols, rows }])}>Excel</Button>
          </div>
        </div>
        <div className="table-wrap"><table className="table table-grid">
          <thead><tr>{cols.map((c) => <th key={c.key} className={c.money ? 't-num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.key}>{cols.map((c, i) => { const v = c.value(r); return <td key={c.key} className={c.money ? `t-num ${typeof v === 'number' && v < 0 ? 'neg' : ''}` : ''}>{i === 0 ? <strong style={{ textTransform: 'capitalize' }}>{v}</strong> : typeof v === 'number' ? cell(v) : v}</td>; })}</tr>)}
            <tr className="t-total">{cols.map((c, i) => <td key={c.key} className={c.money ? 't-num' : ''}>{i === 0 ? 'Total' : fmtAr(rows.reduce((t, r) => t + (Number(c.value(r)) || 0), 0))}</td>)}</tr>
          </tbody>
        </table></div>
      </div>
    </>
  );
}
