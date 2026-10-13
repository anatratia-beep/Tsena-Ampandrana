// Versements des vendeurs au responsable : chaque soir, chaque vendeur remet l'argent de sa page.
// - Le responsable voit tous les vendeurs du jour (ventes par page, espèces, MVola, Orange, Airtel, total à payer),
//   saisit ce qu'il a reçu et valide.
// - Le vendeur voit sa propre feuille : ce qu'il doit remettre, et si le responsable l'a reçu.
import { useState } from 'react';
import { useCan, useCurrentUser } from '../lib/auth';
import { useTable } from '../lib/db';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import { addDays, today } from '../lib/money';
import { cancelHandover, changedSince, handoverHistory, receiveHandover, sellerDay, sellersOfDay, type Handover, type SellerDay } from '../lib/handovers';
import { printA4, a4Table, arA4, h } from '../lib/a4';
import { Badge, Button, Confirm, Empty, Help, IconButton, Modal, PageHead, TextField, fmtDate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { exportTables, type Col } from '../ui/table';

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const money = (n: number) => (n ? fmtAr(n) : <span className="muted">—</span>);

export function HandoversPage() {
  const can = useCan();
  const me = useCurrentUser();
  useTable('orders'); useTable('cashMoves'); useTable('handovers'); useTable('users'); useTable('roles'); useTable('categories'); useTable('products'); useTable('variants');
  const [date, setDate] = useState(today());
  const boss = can('handover.receive');
  if (!me || (!boss && !can('handover.self'))) return <Empty icon="lock" title="Accès réservé" />;
  const isToday = date === today();
  return (
    <>
      <PageHead title="Versements des vendeurs" subtitle={boss ? 'Chaque soir, chaque vendeur remet au responsable l’argent de sa page' : 'Ce que vous devez remettre au responsable ce soir'} />
      <div className="card row" style={{ alignItems: 'center', gap: 6 }}>
        <IconButton icon="chevronLeft" label="Jour précédent" onClick={() => setDate(addDays(date, -1))} />
        <strong style={{ textTransform: 'capitalize' }}>{longDate(date)}</strong>
        <IconButton icon="chevronRight" label="Jour suivant" disabled={isToday} onClick={() => setDate(addDays(date, 1))} />
        {!isToday && <Button variant="quiet" onClick={() => setDate(today())}>Aujourd’hui</Button>}
      </div>
      {boss ? <Board date={date} /> : <Sheet d={sellerDay(me, date)} self />}
      <History userId={boss ? undefined : me.id} />
    </>
  );
}

/** Responsable : tous les vendeurs du jour. */
function Board({ date }: { date: string }) {
  const rows = sellersOfDay(date);
  const [open, setOpen] = useState<string | null>(null);
  const t = rows.reduce((a, d) => ({ sales: a.sales + d.sales, cash: a.cash + d.pay.cash, mvola: a.mvola + d.pay.mvola, orange: a.orange + d.pay.orange, airtel: a.airtel + d.pay.airtel, fees: a.fees + d.fees, exp: a.exp + d.expenses, toPay: a.toPay + d.toPay, got: a.got + (d.handover?.amount ?? 0) }),
    { sales: 0, cash: 0, mvola: 0, orange: 0, airtel: 0, fees: 0, exp: 0, toPay: 0, got: 0 });
  const waiting = rows.filter((d) => !d.handover && (d.toPay || d.sales));
  const rest = rows.filter((d) => !d.handover).reduce((s, d) => s + d.toPay, 0);
  const sel = rows.find((d) => d.user.id === open);

  const cols: Col<SellerDay>[] = [
    { key: 'v', label: 'Vendeur', value: (d) => d.user.fullName, width: 22 },
    { key: 'p', label: 'Pages', value: (d) => d.pages.map((p) => `${p.name} : ${Math.round(p.sales).toLocaleString('fr-FR')}`).join(' ; '), width: 40 },
    { key: 's', label: 'Total ventes', value: (d) => Math.round(d.sales), money: true, width: 14 },
    { key: 'c', label: 'Espèces', value: (d) => Math.round(d.pay.cash), money: true, width: 13 },
    { key: 'mv', label: 'MVola', value: (d) => Math.round(d.pay.mvola), money: true, width: 13 },
    { key: 'or', label: 'Orange Money', value: (d) => Math.round(d.pay.orange), money: true, width: 13 },
    { key: 'ai', label: 'Airtel Money', value: (d) => Math.round(d.pay.airtel), money: true, width: 13 },
    { key: 'f', label: 'Frais livreurs', value: (d) => Math.round(d.fees), money: true, width: 13 },
    { key: 'e', label: 'Dépenses', value: (d) => Math.round(d.expenses), money: true, width: 13 },
    { key: 't', label: 'Total à payer', value: (d) => Math.round(d.toPay), money: true, width: 14 },
    { key: 'r', label: 'Reçu', value: (d) => (d.handover ? Math.round(d.handover.amount) : ''), money: true, width: 13 },
    { key: 'g', label: 'Écart', value: (d) => (d.handover ? Math.round(d.handover.gap) : ''), money: true, width: 12 },
  ];
  const exportXls = () => exportTables(`versements-vendeurs_${date}.xlsx`, [{ name: 'Versements', cols, rows, notes: [`Versements des vendeurs — ${longDate(date)}`] }]);
  const exportPdf = () => printA4('Versements des vendeurs', longDate(date), `
    <div class="kpis"><div class="kpi"><span>Total ventes</span><b>${arA4(t.sales)}</b></div><div class="kpi"><span>Espèces</span><b>${arA4(t.cash)}</b></div><div class="kpi"><span>Mobile money</span><b>${arA4(t.mvola + t.orange + t.airtel)}</b></div><div class="kpi strong"><span>Total à payer</span><b>${arA4(t.toPay)}</b></div></div>
    ${a4Table({ head: ['Vendeur', 'Ventes', 'Espèces', 'MVola', 'Orange', 'Airtel', 'Frais livr.', 'Dépenses', 'À payer', 'Reçu'], num: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      rows: rows.map((d) => [h(d.user.fullName), arA4(d.sales), arA4(d.pay.cash), arA4(d.pay.mvola), arA4(d.pay.orange), arA4(d.pay.airtel), arA4(d.fees), arA4(d.expenses), `<b>${arA4(d.toPay)}</b>`, d.handover ? arA4(d.handover.amount) : '—']),
      foot: ['Total', arA4(t.sales), arA4(t.cash), arA4(t.mvola), arA4(t.orange), arA4(t.airtel), arA4(t.fees), arA4(t.exp), arA4(t.toPay), arA4(t.got)] })}
    ${rows.filter((d) => d.pages.length).map((d) => a4Table({ title: `Ventes par page — ${h(d.user.fullName)}`, head: ['Page', 'Ventes'], num: [1], rows: d.pages.map((p) => [h(p.name), arA4(p.sales)]), foot: ['Total', arA4(d.sales)] })).join('')}`);

  return (
    <>
      <div className="stat-grid">
        <div className="card stat"><span className="small muted">Total des ventes</span><strong className="stat-value num">{fmtAr(t.sales)}</strong><span className="small muted">{rows.filter((d) => d.sales).length} vendeur(s)</span></div>
        <div className="card stat"><span className="small muted">Mobile money (numéros de la boutique)</span><strong className="stat-value num">{fmtAr(t.mvola + t.orange + t.airtel)}</strong><span className="small muted">MVola {fmtAr(t.mvola)} · Orange {fmtAr(t.orange)} · Airtel {fmtAr(t.airtel)}</span></div>
        <div className="card stat stat-strong"><span className="small muted">Total à payer (espèces)</span><strong className="stat-value num">{fmtAr(t.toPay)}</strong><span className="small muted">déjà reçu : {fmtAr(t.got)}</span></div>
        <div className="card stat"><span className="small muted">Reste à recevoir</span><strong className={`stat-value num ${rest > 0 ? 'neg' : ''}`}>{fmtAr(rest)}</strong><span className="small muted">{waiting.length ? `${waiting.length} vendeur(s) pas encore reçu(s)` : 'tout est reçu'}</span></div>
      </div>
      <div className="card card-flush">
        <div className="card-pad row-between">
          <div><h2>Vendeur par vendeur</h2>
            <Help>Total à payer = espèces encaissées (ventes sur place et argent des colis) − frais gardés par les livreurs − dépenses payées par le vendeur. Le mobile money arrive sur les numéros de la boutique : il est affiché pour contrôle, mais n’est pas à remettre. Touchez un vendeur pour voir ses pages et valider ce qu’il vous remet.</Help></div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" className="btn-sm" icon="download" onClick={exportXls}>Excel</Button>
            <Button variant="ghost" className="btn-sm" icon="printer" onClick={exportPdf}>PDF A4</Button>
          </div>
        </div>
        {rows.length === 0 ? <p className="card-pad small muted">Aucun vendeur ni aucune vente ce jour.</p> : (
          <div className="table-wrap"><table className="table table-grid handover-table">
            <thead><tr><th>Vendeur</th><th className="t-num">Total ventes</th><th className="t-num">Espèces</th><th className="t-num">MVola</th><th className="t-num">Orange Money</th><th className="t-num">Airtel Money</th><th className="t-num">Frais livreurs</th><th className="t-num">Dépenses</th><th className="t-num">Total à payer</th><th>Reçu</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.user.id} className="row-link" onClick={() => setOpen(d.user.id)}>
                  <td><strong>{d.user.fullName}</strong><div className="small muted">{d.pages.length ? d.pages.map((p) => p.name).join(', ') : 'aucune vente'}</div></td>
                  <td className="t-num">{money(d.sales)}</td>
                  <td className="t-num">{money(d.pay.cash)}</td>
                  <td className="t-num">{money(d.pay.mvola)}</td>
                  <td className="t-num">{money(d.pay.orange)}</td>
                  <td className="t-num">{money(d.pay.airtel)}</td>
                  <td className="t-num">{d.fees ? <span className="neg">− {fmtAr(d.fees)}</span> : money(0)}</td>
                  <td className="t-num">{d.expenses ? <span className="neg">− {fmtAr(d.expenses)}</span> : money(0)}</td>
                  <td className="t-num"><strong>{fmtAr(d.toPay)}</strong></td>
                  <td>{d.handover ? <><Badge tone={d.handover.gap ? 'warn' : 'ok'}>{fmtAr(d.handover.amount)}</Badge>{changedSince(d) && <div className="small neg">chiffres changés</div>}</>
                    : d.toPay || d.sales ? <Badge tone="danger">À recevoir</Badge> : <span className="small muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(t.sales)}</td><td className="t-num">{fmtAr(t.cash)}</td><td className="t-num">{fmtAr(t.mvola)}</td><td className="t-num">{fmtAr(t.orange)}</td><td className="t-num">{fmtAr(t.airtel)}</td><td className="t-num">{fmtAr(t.fees)}</td><td className="t-num">{fmtAr(t.exp)}</td><td className="t-num">{fmtAr(t.toPay)}</td><td className="t-num">{fmtAr(t.got)}</td></tr></tfoot>
          </table></div>
        )}
      </div>
      {sel && <Modal title={`Versement de ${sel.user.fullName}`} wide onClose={() => setOpen(null)}><Sheet d={sel} onDone={() => setOpen(null)} /></Modal>}
    </>
  );
}

/** Feuille d'un vendeur pour un jour (et validation par le responsable). */
function Sheet({ d, self, onDone }: { d: SellerDay; self?: boolean; onDone?: () => void }) {
  const can = useCan();
  const me = useCurrentUser();
  const boss = can('handover.receive') && !self;
  const [amount, setAmount] = useState(String(Math.max(0, Math.round(d.toPay))));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState(false);
  const n = parseAr(amount);
  const gap = (n || 0) - d.toPay;
  const ho = d.handover;
  const submit = async () => {
    setBusy(true);
    try { await receiveHandover(d, n || 0, note.trim()); toast(`Versement de ${d.user.fullName} enregistré`); onDone?.(); }
    catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className={self ? 'card card-flush' : 'stack-s'}>
        <div className={self ? 'card-pad' : ''}><h2>{self ? 'Ma feuille du jour' : 'Ventes par page'}</h2></div>
        <div className="table-wrap"><table className="table">
          <tbody>
            {d.pages.length === 0 && <tr><td colSpan={2} className="small muted">Aucune vente ce jour.</td></tr>}
            {d.pages.map((p) => <tr key={p.pageId}><td>Ventes — {p.name}</td><td className="t-num">{fmtAr(p.sales)}</td></tr>)}
            <tr className="t-total"><td>Total des ventes <span className="small muted">({d.orders} vente(s), retours déduits)</span></td><td className="t-num">{fmtAr(d.sales)}</td></tr>
            <tr><td>Espèces encaissées <span className="small muted">(sur place {fmtAr(d.shopCash)} · rapportées par les livreurs {fmtAr(d.courierCash)})</span></td><td className="t-num">{fmtAr(d.pay.cash)}</td></tr>
            <tr><td>MVola <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(d.pay.mvola)}</td></tr>
            <tr><td>Orange Money <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(d.pay.orange)}</td></tr>
            <tr><td>Airtel Money <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(d.pay.airtel)}</td></tr>
            {d.fees > 0 && <tr><td>Frais de livraison gardés par les livreurs</td><td className="t-num neg">− {fmtAr(d.fees)}</td></tr>}
            <tr><td>Dépenses payées ({d.expenseMoves.length}){d.expenseMoves.length ? <div className="small muted">{d.expenseMoves.map((m) => `${m.label || 'Dépense'} ${fmtAr(-m.amount)}`).join(' · ')}</div> : null}</td><td className="t-num neg">{d.expenses ? `− ${fmtAr(d.expenses)}` : fmtAr(0)}</td></tr>
            <tr className="t-total rc-grand"><td><strong>TOTAL À PAYER</strong> <span className="small muted">= espèces − frais livreurs − dépenses</span></td><td className="t-num"><strong>{fmtAr(d.toPay)}</strong></td></tr>
          </tbody>
        </table></div>
        {d.outParcels > 0 && <div className={`notice ${self ? 'card-pad' : ''}`}><Icon name="truck" /><span>{d.outParcels} colis encore chez les livreurs : leur argent comptera le jour où le livreur le rapporte.</span></div>}
      </div>

      {ho ? (
        <div className="card stack-s">
          <p><Badge tone={ho.gap ? 'warn' : 'ok'}>Reçu</Badge> <strong>{fmtAr(ho.amount)}</strong> remis à {ho.byName ?? '?'} le {new Date(ho.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {ho.gap ? <span className={ho.gap < 0 ? 'neg' : 'pos'}> · écart {ho.gap > 0 ? '+' : ''}{fmtAr(ho.gap)}</span> : null}</p>
          {ho.note && <p className="small muted">Note : {ho.note}</p>}
          {changedSince(d) && <div className="notice notice-danger"><Icon name="alert" /><span>Les chiffres ont changé depuis la validation (à payer : {fmtAr(ho.expected)} → {fmtAr(d.toPay)}). Vérifiez avec le vendeur ; au besoin, annulez puis validez à nouveau.</span></div>}
          {boss && <div><Button variant="ghost" onClick={() => setCancel(true)}>Annuler ce versement</Button></div>}
        </div>
      ) : boss ? (
        <div className="card stack-s">
          <h2>Argent reçu de {d.user.fullName}</h2>
          {d.user.id === me?.id && <p className="small muted">C’est votre propre page : validez ce que vous mettez dans la caisse.</p>}
          <div className="grid-2">
            <TextField label="Montant reçu en espèces (Ar)" value={amount} onChange={setAmount} inputMode="numeric" required />
            <TextField label="Note (facultatif)" value={note} onChange={setNote} placeholder="ex. manque 2 000, rendra demain" />
          </div>
          {n != null && Math.round(gap) !== 0 && <p className={`small ${gap < 0 ? 'neg' : 'pos'}`}><strong>Écart : {gap > 0 ? '+' : ''}{fmtAr(gap)}</strong> {gap < 0 ? '(il manque de l’argent)' : '(il y a plus que prévu)'}</p>}
          <div><Button icon="check" busy={busy} disabled={n == null || n < 0} onClick={submit}>Valider : j’ai reçu {fmtAr(n || 0)}</Button></div>
        </div>
      ) : (
        <div className="card"><p><Badge tone="danger">Pas encore reçu</Badge> À remettre au responsable : <strong>{fmtAr(d.toPay)}</strong></p></div>
      )}
      {cancel && ho && <CancelModal h={ho} onClose={() => setCancel(false)} />}
    </div>
  );
}

function CancelModal({ h: ho, onClose }: { h: Handover; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Confirm title="Annuler ce versement ?" danger confirmLabel="Annuler le versement" onClose={onClose}
      message={<div className="stack-s"><p>{ho.userName}, {fmtDate(ho.date)} : {fmtAr(ho.amount)}. Le vendeur redevient « à recevoir ». L’annulation reste dans l’historique.</p><TextField label="Raison" value={reason} onChange={setReason} required /></div>}
      onConfirm={async () => { if (!reason.trim()) throw new Error('Indiquez la raison de l’annulation.'); await cancelHandover(ho, reason.trim()); toast('Versement annulé'); }} />
  );
}

function History({ userId }: { userId?: string }) {
  const list = handoverHistory(userId).slice(0, 40);
  if (!list.length) return null;
  return (
    <div className="card card-flush">
      <div className="card-pad"><h2>Historique des versements</h2></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Jour</th>{!userId && <th>Vendeur</th>}<th className="t-num">À payer</th><th className="t-num">Reçu</th><th className="t-num">Écart</th><th>Par</th></tr></thead>
        <tbody>{list.map((x) => (
          <tr key={x.id} className={x.status === 'cancelled' ? 'muted' : ''}>
            <td>{fmtDate(x.date)}{x.status === 'cancelled' && <> <Badge>Annulé</Badge></>}</td>{!userId && <td>{x.userName}</td>}
            <td className="t-num">{fmtAr(x.expected)}</td><td className="t-num"><strong>{fmtAr(x.amount)}</strong></td>
            <td className={`t-num ${x.gap < 0 ? 'neg' : x.gap > 0 ? 'pos' : ''}`}>{x.gap ? `${x.gap > 0 ? '+' : ''}${fmtAr(x.gap)}` : '—'}</td>
            <td className="small">{x.byName}{x.status === 'cancelled' ? ` · annulé par ${x.cancelledBy} : ${x.cancelReason}` : ''}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
