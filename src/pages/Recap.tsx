// Récapitulatifs : journée et semaine (lundi → samedi) — ventes sur place, livraisons, comptes livreurs,
// paiements reçus, dépenses et autres mouvements, à envoyer au responsable.
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { useTable } from '../lib/db';
import { fmtAr, fmtNum, variantLabel, type Product, type Variant } from '../lib/catalog';
import { salesLedger } from '../lib/analytics';
import { useCompany } from '../lib/settings';
import { fmtPhone, normPhone, orderLabel, ORDER_STATUS, PAY_METHODS, keptTotal, type Order, type Zone } from '../lib/orders';
import { ACCOUNTS, MOVE_TYPES, addDays, mondayOf, report, today, type AccountId, type Report } from '../lib/money';
import { dayText, daySections, longDate, sectionsDoc, totals, weekDays, weekSections, weekText, type Section } from '../lib/recap';
import { get } from '../lib/db';
import { daySynthesis } from '../lib/synthesis';
import { Help, Badge, Button, Empty, IconButton, PageHead, fmtDate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PrintDialog } from '../ui/print';
import { PayoutCard, PayoutHistory, WeekGrid } from './WeekBoard';

export function RecapPage() {
  const can = useCan();
  const company = useCompany();
  const o = useTable<Order>('orders'); const m = useTable('cashMoves'); const s = useTable('courierSettlements'); useTable('couriers'); useTable('financeCategories');
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(today());
  const withProfit = can('costs.view');
  const monday = mondayOf(date);
  const saturday = addDays(monday, 5);
  const days = useMemo(() => (mode === 'week' ? weekDays(monday) : []), [mode, monday, o, m, s]);
  const end = mode === 'week' ? days[days.length - 1]?.date ?? saturday : date;
  const r = useMemo(() => report(mode === 'week' ? monday : date, end), [mode, date, monday, end, o, m, s]);
  if (!can('treasury.view') && !can('reports.view')) return <Empty icon="lock" title="Accès réservé" />;
  const t = totals(r);
  const step = (n: number) => setDate(addDays(date, mode === 'week' ? 7 * n : n));
  const isFuture = (mode === 'week' ? addDays(monday, 7) : addDays(date, 1)) > today();
  const sections = mode === 'week' ? weekSections(r, days, withProfit) : daySections(r, withProfit);
  const text = mode === 'week' ? weekText(r, days, company, withProfit) : dayText(r, company, withProfit);

  return (
    <>
      <PageHead title="Récapitulatifs" subtitle="Ventes sur place, livraisons, comptes livreurs, paiements et dépenses" />
      <div className="card row" style={{ alignItems: 'center' }}>
        <div className="segmented" role="group" aria-label="Période">
          <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Journée</button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => { setMode('week'); const mon = mondayOf(date); if (date === today() && addDays(mon, 5) > today()) setDate(addDays(mon, -7)); }}>Semaine (lun. → sam.)</button>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 6 }}>
          <IconButton icon="chevronLeft" label="Précédent" onClick={() => step(-1)} />
          <strong>{mode === 'week' ? `Du ${fmtDate(monday)} au ${fmtDate(end)}` : longDate(date)}</strong>
          <IconButton icon="chevronRight" label="Suivant" disabled={isFuture} onClick={() => step(1)} />
          <input type="date" className="cell-input" style={{ maxWidth: 160 }} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Choisir une date" />
          {date !== today() && <Button variant="quiet" onClick={() => setDate(today())}>Aujourd’hui</Button>}
        </div>
      </div>

      <div className="stat-grid">
        <Stat label={`Ventes sur place (${t.walkInCount})`} value={t.walkIn} />
        <Stat label={`Livraisons (${t.delivCount})`} value={t.deliv} />
        <Stat label="Total des ventes" value={r.netSales} strong />
        <Stat label="Mobile Money reçu" value={t.mmIn} />
        <Stat label="Espèces reçues en boutique" value={t.cashIn} />
        <Stat label="Dépenses" value={r.expenses} neg />
        <Stat label={mode === 'week' ? 'Total à verser par les livreurs' : 'À verser par les livreurs'} value={r.courierDue} strong />
        {withProfit && <Stat label="Bénéfice brut" value={r.grossProfit} />}
      </div>

      {mode === 'week' && <><PayoutCard monday={monday} /><WeekGrid monday={monday} withProfit={withProfit} /></>}
      {withProfit && <ProfitDetail from={r.from} to={r.to} gross={r.grossProfit} sales={r.netSales} cost={r.cost} />}
      {mode === 'week' ? <WeekTables days={days} r={r} /> : <DayTables r={r} />}
      <MoneyCard r={r} />
      {mode === 'week' && <PayoutHistory onPick={(mon) => { setDate(mon); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      <Share text={text} title={mode === 'week' ? 'Récapitulatif de la semaine' : 'Récapitulatif du jour'} sub={mode === 'week' ? `${fmtDate(monday)} au ${fmtDate(end)}` : fmtDate(date)} sections={sections} />
    </>
  );
}

function Stat({ label, value, strong, neg }: { label: string; value: number; strong?: boolean; neg?: boolean }) {
  return <div className={`card stat ${strong ? 'stat-strong' : ''}`}><span className="small muted">{label}</span><strong className={`stat-value num ${neg && value ? 'neg' : ''}`}>{fmtAr(value)}</strong></div>;
}

function DayTables({ r }: { r: Report }) {
  const byCourier = new Map<string, typeof r.deliveries>();
  for (const d of r.deliveries) { const k = d.courierId; if (!byCourier.has(k)) byCourier.set(k, []); byCourier.get(k)!.push(d); }
  return (
    <>
      <SynthesisCard date={r.from} />
      <div className="card card-flush">
        <div className="card-pad row-between"><h2>Ventes sur place</h2><strong className="num">{fmtAr(r.sales.shopAmount)}</strong></div>
        {r.walkIns.length === 0 ? <p className="card-pad small muted">Aucune vente sur place.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Vente</th><th>Heure</th><th className="t-num">Articles</th><th>Paiement</th><th className="t-num">Montant</th></tr></thead>
            <tbody>{r.walkIns.map((o) => (
              <tr key={o.id}><td><a href={`#/commandes/${o.id}`}>{o.number}</a> <span className="muted small">{o.internal ? `Vente interne · ${o.employeeName || '?'}` : o.name || ''}</span></td><td>{new Date(o.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="t-num">{o.lines.reduce((s, l) => s + (l.qtyKept ?? l.qty), 0)}</td><td>{[...new Set(o.payments.map((p) => PAY_METHODS[p.method]))].join(' + ') || 'non payé'}</td><td className="t-num">{fmtAr(keptTotal(o) - (o.discount || 0))}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card card-flush">
        <div className="card-pad row-between"><h2>Livraisons du jour</h2><strong className="num">{fmtAr(r.deliveries.reduce((s, d) => s + d.value, 0))}</strong></div>
        {r.deliveries.length === 0 ? <p className="card-pad small muted">Aucune commande partie ce jour.</p> : [...byCourier.entries()].map(([cid, list]) => (
          <div key={cid}>
            <h3 className="card-pad" style={{ paddingBottom: 0 }}>{cid ? get<any>('couriers', cid)?.name ?? 'Livreur ?' : 'Retirées en boutique'} <span className="muted small">· {list.length} commande(s)</span></h3>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Commande</th><th>Lieu</th><th>État</th><th className="t-num">À encaisser</th><th className="t-num muted">Frais livreur</th><th className="t-num muted">Total client</th><th className="t-num">Frais à reverser</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.o.id}>
                    <td><a href={`#/commandes/${d.o.id}`}>{d.o.number}</a> <span className="small muted">{orderLabel(d.o)}</span></td>
                    <td className="small">{get<Zone>('zones', d.o.zoneId || '')?.name}{d.o.place ? ` — ${d.o.place}` : ''}</td>
                    <td><Badge tone={ORDER_STATUS[d.o.status].tone}>{d.o.status === 'out' ? 'Pas encore confirmée' : ORDER_STATUS[d.o.status].label}</Badge>{d.settled && <span className="small pos"> · versée</span>}</td>
                    <td className="t-num"><strong>{fmtAr(d.collect)}</strong>{d.collect === 0 && d.o.payments.some((p) => p.receivedBy === 'shop') ? <div className="small muted">payé par Mobile Money</div> : null}</td><td className="t-num muted">{fmtAr(d.fee)}</td><td className="t-num muted">{fmtAr(d.clientPays)}</td><td className="t-num">{d.feeOwed ? fmtAr(d.feeOwed) : '—'}</td>
                  </tr>
                ))}
                <tr className="t-total"><td colSpan={3}>Sous-total</td><td className="t-num"><strong>{fmtAr(list.reduce((s, d) => s + d.collect, 0))}</strong></td><td className="t-num muted">{fmtAr(list.reduce((s, d) => s + d.fee, 0))}</td><td className="t-num muted">{fmtAr(list.reduce((s, d) => s + d.clientPays, 0))}</td><td className="t-num">{fmtAr(list.reduce((s, d) => s + d.feeOwed, 0))}</td></tr>
              </tbody>
            </table></div>
          </div>
        ))}
      </div>
      <CourierTable r={r} />
    </>
  );
}

function CourierTable({ r, week }: { r: Report; week?: boolean }) {
  return (
    <div className="card card-flush">
      <div className="card-pad"><h2>Comptes livreurs{week ? ' de la semaine' : ''}</h2><Help>« À encaisser » = ce que le livreur encaisse pour la boutique (articles, sans ses frais). Les frais et le total payé par les clients sont indiqués pour information. « Frais à reverser » = frais déjà payés à la boutique (Mobile Money), à lui rendre en espèces. « Compte à ce jour » comprend aussi les livraisons non versées des jours précédents.</Help></div>
      {r.couriers.length === 0 ? <p className="card-pad small muted">Aucun livreur concerné.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Livreur</th><th className="t-num">Livraisons</th><th className="t-num">À encaisser</th><th className="t-num muted">Frais livreur</th><th className="t-num muted">Total clients</th><th className="t-num">Frais à reverser</th><th className="t-num">Déjà versé</th><th className="t-num">Compte à ce jour</th></tr></thead>
          <tbody>
            {r.couriers.map((c) => (
              <tr key={c.courierId}>
                <td><strong>{c.name}</strong>{c.out ? <div className="small muted">{c.out} pas encore confirmée(s)</div> : null}{c.refused ? <div className="small neg">{c.refused} refusée(s)</div> : null}</td>
                <td className="t-num">{c.count}</td><td className="t-num"><strong>{fmtAr(c.collect)}</strong></td><td className="t-num muted">{fmtAr(c.fees)}</td><td className="t-num muted">{fmtAr(c.clientPays)}</td><td className="t-num">{c.feeOwed ? fmtAr(c.feeOwed) : '—'}</td>
                <td className="t-num">{fmtAr(c.paidIn)}</td><td className={`t-num ${c.balance < 0 ? 'neg' : ''}`}><strong>{c.balance >= 0 ? fmtAr(c.balance) : `on lui doit ${fmtAr(-c.balance)}`}</strong></td>
              </tr>
            ))}
            <tr className="t-total"><td>Total</td><td className="t-num">{r.couriers.reduce((s, c) => s + c.count, 0)}</td><td className="t-num">{fmtAr(r.couriers.reduce((s, c) => s + c.collect, 0))}</td><td className="t-num muted">{fmtAr(r.couriers.reduce((s, c) => s + c.fees, 0))}</td><td className="t-num muted">{fmtAr(r.couriers.reduce((s, c) => s + c.clientPays, 0))}</td><td className="t-num">{fmtAr(r.couriers.reduce((s, c) => s + c.feeOwed, 0))}</td><td className="t-num">{fmtAr(r.couriers.reduce((s, c) => s + c.paidIn, 0))}</td><td className="t-num"><strong>{fmtAr(r.courierDue)}</strong></td></tr>
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function WeekTables({ days, r }: { days: ReturnType<typeof weekDays>; r: Report }) {
  return (
    <>
      <WeekSynth dates={days.map((d) => d.date)} />
      <div className="card card-flush">
        <div className="card-pad"><h2>Jour par jour</h2></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Jour</th><th className="t-num">Sur place</th><th className="t-num">Livraisons</th><th className="t-num">Total ventes</th><th className="t-num">Espèces reçues</th><th className="t-num">Mobile Money</th><th className="t-num">Versé par livreurs</th><th className="t-num">Dépenses</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td><strong>{new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong></td>
                <td className="t-num">{fmtAr(d.t.walkIn)}</td><td className="t-num">{fmtAr(d.t.deliv)}</td><td className="t-num"><strong>{fmtAr(d.r.netSales)}</strong></td>
                <td className="t-num">{fmtAr(d.t.cashIn)}</td><td className="t-num">{fmtAr(d.t.mmIn)}</td><td className="t-num">{fmtAr(d.t.fromCouriers)}</td><td className="t-num neg">{d.t.expenses ? fmtAr(d.t.expenses) : '—'}</td>
              </tr>
            ))}
            <tr className="t-total"><td>Semaine</td>
              {(['walkIn', 'deliv'] as const).map((k) => <td key={k} className="t-num">{fmtAr(days.reduce((s, d) => s + d.t[k], 0))}</td>)}
              <td className="t-num"><strong>{fmtAr(r.netSales)}</strong></td>
              {(['cashIn', 'mmIn', 'fromCouriers'] as const).map((k) => <td key={k} className="t-num">{fmtAr(days.reduce((s, d) => s + d.t[k], 0))}</td>)}
              <td className="t-num neg">{fmtAr(r.expenses)}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
      <CourierTable r={r} week />
      <div className="card stack-s">
        <h2>Fin de semaine : espèces</h2>
        <table className="kv-table"><tbody>
          <tr><td>Caisse espèces (selon Trésor en ligne)</td><td>{fmtAr(r.balancesEnd.cash)}</td></tr>
          <tr><td>À verser en espèces par les livreurs</td><td>{fmtAr(r.courierDue)}</td></tr>
          <tr className="total"><td>Total des espèces attendues</td><td>{fmtAr(r.balancesEnd.cash + r.courierDue)}</td></tr>
        </tbody></table>
      </div>
    </>
  );
}

function MoneyCard({ r }: { r: Report }) {
  const accounts: AccountId[] = ['cash', 'mvola', 'orange', 'airtel', 'card', 'bank'];
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card stack-s">
        <h2>Paiements reçus</h2>
        <table className="kv-table"><tbody>
          {accounts.filter((a) => (a !== 'bank' && a !== 'card') || r.receipts[a] || r.fromCouriers[a]).map((a) => <tr key={a}><td>{ACCOUNTS[a]}{r.fromCouriers[a] ? <span className="muted small"> (dont versements livreurs {fmtAr(r.fromCouriers[a])})</span> : ''}</td><td>{fmtAr(r.receipts[a] + r.fromCouriers[a])}</td></tr>)}
          <tr className="total"><td>Total reçu</td><td>{fmtAr(accounts.reduce((s, a) => s + r.receipts[a] + r.fromCouriers[a], 0))}</td></tr>
        </tbody></table>
        <h3 style={{ marginTop: 10 }}>Soldes en fin de période</h3>
        <table className="kv-table"><tbody>
          {accounts.filter((a) => (a !== 'bank' && a !== 'card') || r.balancesEnd[a]).map((a) => <tr key={a}><td>{ACCOUNTS[a]}</td><td className={r.balancesEnd[a] < 0 ? 'neg' : ''}>{fmtAr(r.balancesEnd[a])}</td></tr>)}
        </tbody></table>
      </div>
      <div className="card stack-s">
        <h2>Dépenses et autres mouvements</h2>
        {r.expenseMoves.length + r.otherMoves.length === 0 ? <p className="small muted">Aucun.</p> : (
          <table className="kv-table"><tbody>
            {r.expenseMoves.map((m) => <tr key={m.id}><td>{m.label || 'Dépense'} <span className="muted small">· {ACCOUNTS[m.account]}</span></td><td className="neg">− {fmtAr(-m.amount)}</td></tr>)}
            {r.expenseMoves.length > 0 && <tr className="total"><td>Total dépenses</td><td className="neg">− {fmtAr(r.expenses)}</td></tr>}
            {r.otherMoves.map((m) => <tr key={m.id}><td>{m.label || MOVE_TYPES[m.type]} <span className="muted small">· {MOVE_TYPES[m.type]} · {ACCOUNTS[m.account]}</span></td><td className={m.amount < 0 ? 'neg' : 'pos'}>{m.amount < 0 ? '− ' : '+ '}{fmtAr(Math.abs(m.amount))}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

function Share({ text, title, sub, sections }: { text: string; title: string; sub: string; sections: Section[] }) {
  const company = useCompany();
  const [print, setPrint] = useState(false);
  const phone = normPhone(company.bossPhone || '');
  const intl = phone ? '261' + phone.replace(/^0/, '') : '';
  const enc = encodeURIComponent(text);
  const nav = navigator as any;
  return (
    <div className="card stack-s">
      <h2>Envoyer au responsable</h2>
      <pre className="recap-text">{text}</pre>
      <div className="row">
        <a className="btn btn-primary" href={`https://wa.me/${intl}?text=${enc}`} target="_blank" rel="noreferrer"><Icon name="share" />WhatsApp{company.bossPhone ? ` (${fmtPhone(company.bossPhone)})` : ''}</a>
        <a className="btn btn-ghost" href={`sms:${phone}${/iPhone|iPad/.test(navigator.userAgent) ? '&' : '?'}body=${enc}`}>SMS</a>
        <a className="btn btn-ghost" href={`mailto:${company.bossEmail || ''}?subject=${encodeURIComponent(`${title} — ${company.name} — ${sub}`)}&body=${enc}`}>E-mail</a>
        {nav.share && <Button variant="ghost" onClick={() => nav.share({ title, text }).catch(() => {})}>Partager (Messenger…)</Button>}
        <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Récapitulatif copié'); } catch { toast('Copie impossible sur cet appareil', 'error'); } }}>Copier</Button>
        <Button variant="ghost" icon="printer" onClick={() => setPrint(true)}>Imprimer / PDF</Button>
      </div>
      {!company.bossPhone && <p className="small muted">Enregistrez le numéro WhatsApp du responsable dans Paramètres → Société pour l’envoyer en un clic.</p>}
      {print && <PrintDialog docs={[{ key: 'recap', label: title, build: () => sectionsDoc(title, sub, sections, company) }]} onClose={() => setPrint(false)} />}
    </div>
  );
}

/** Tableau de synthèse du jour : sans retour / avec retour, livreurs et frais, catégories (pages). */
function SynthesisCard({ date }: { date: string }) {
  const s = daySynthesis(date);
  const diff = (a: number, b: number) => (a !== b ? <span className="small neg"> (−{fmtAr(a - b)})</span> : null);
  return (
    <div className="card card-flush synth">
      <div className="card-pad row-between">
        <div><h2>Synthèse de la journée</h2>
          <Help>« Sans retour » : tout ce qui est vendu ou parti en livraison ce jour-là. « Avec retour » : corrigé par les retours constatés au versement des livreurs, même les jours suivants.</Help></div>
        {s.corrected ? <Badge tone="warn">Corrigé le {new Date(s.lastUpdate!).toLocaleDateString('fr-FR')}</Badge> : s.deliv.pending ? <Badge>{s.deliv.pending} livraison(s) à confirmer</Badge> : <Badge tone="ok">À jour</Badge>}
      </div>
      <div className="table-wrap"><table className="table synth-table">
        <thead><tr><th></th><th className="t-num">Nombre</th><th className="t-num">Montant sans retour</th><th className="t-num">Montant avec retour</th></tr></thead>
        <tbody>
          <tr><td>Ventes sur place</td><td className="t-num">{s.walk.count}</td><td className="t-num">{fmtAr(s.walk.sans)}</td><td className="t-num">{fmtAr(s.walk.avec)}</td></tr>
          {s.internal.count > 0 && <tr className="muted"><td style={{ paddingLeft: 24 }}>dont ventes internes (employés)</td><td className="t-num">{s.internal.count}</td><td className="t-num">{fmtAr(s.internal.amount)}</td><td className="t-num">{fmtAr(s.internal.amount)}</td></tr>}
          <tr><td>Livraisons{s.deliv.returns ? <span className="small muted"> · {s.deliv.returns} avec retour</span> : null}</td><td className="t-num">{s.deliv.count}</td><td className="t-num">{fmtAr(s.deliv.sans)}</td><td className="t-num">{fmtAr(s.deliv.avec)}{diff(s.deliv.sans, s.deliv.avec)}</td></tr>
          {s.pickup.count > 0 && <tr><td>Retraits en boutique</td><td className="t-num">{s.pickup.count}</td><td className="t-num">{fmtAr(s.pickup.sans)}</td><td className="t-num">{fmtAr(s.pickup.avec)}</td></tr>}
          <tr className="synth-total"><td>TOTAL GÉNÉRAL</td><td className="t-num">{s.walk.count + s.deliv.count + s.pickup.count}</td><td className="t-num">{fmtAr(s.total.sans)}</td><td className="t-num">{fmtAr(s.total.avec)}{diff(s.total.sans, s.total.avec)}</td></tr>
        </tbody>
      </table></div>
      <div className="synth-grid">
        <div>
          <h3 className="card-pad" style={{ paddingBottom: 0 }}>Livreurs : livraisons et frais</h3>
          {s.couriers.length === 0 ? <p className="card-pad small muted">Aucune livraison ce jour.</p> : <FeeBoard s={s} />}
        </div>
        <div>
          <h3 className="card-pad" style={{ paddingBottom: 0 }}>Par catégorie (page)</h3>
          {s.categories.length === 0 ? <p className="card-pad small muted">Aucune vente ce jour.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Catégorie</th><th className="t-num">Sans retour</th><th className="t-num">Avec retour</th></tr></thead>
              <tbody>
                {s.categories.map((c) => <tr key={c.id}><td><strong>{c.name}</strong>{c.sellers.length ? <div className="small muted">{c.sellers.join(', ')}</div> : null}</td><td className="t-num">{fmtAr(c.sans)}</td><td className="t-num">{fmtAr(c.avec)}</td></tr>)}
                <tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(s.total.sans)}</td><td className="t-num">{fmtAr(s.total.avec)}</td></tr>
              </tbody>
            </table></div>
          )}
        </div>
      </div>
      <p className="card-pad small muted">Les frais de livraison reviennent aux livreurs : ils ne sont pas compris dans les montants. Les articles « en choix » gardés par le client s’ajoutent au montant avec retour.</p>
    </div>
  );
}

/** Livreurs en lignes : colis, total des commandes emportées, frais, frais en espèces, frais par MVola, retours, et la ligne TOTAL. */
export function FeeBoard({ s }: { s: ReturnType<typeof daySynthesis> }) {
  // Total frais = espèces + MVola / Orange Money (sans les refus ni les frais payés en espèces au magasin), aussi pour un livreur dont les frais vont dans sa caisse frais (ex. Toky).
  const rows = [...s.couriers.map((c) => ({ key: c.id, name: c.name, count: c.count, value: c.sans, fees: c.feesCash + c.feesMvola, cash: c.feesCash, mvola: c.feesMvola, fund: c.feesFund, returns: c.returns })),
    { key: '_total', name: 'TOTAL', count: s.deliv.count, value: s.deliv.sans, fees: s.feesCash + s.feesMvola, cash: s.feesCash, mvola: s.feesMvola, fund: 0, returns: s.deliv.returns }];
  const withFund = s.feesFund > 0;
  return (
    <div className="card-pad">
      <div className="table-wrap fee-board"><table className="table">
        <thead><tr><th>Livreur</th><th className="t-num">Colis</th><th className="t-num">Total commandes<div className="fee-sub">emportées, sans frais</div></th><th className="t-num">Total frais</th>
          <th className="t-num">Frais en espèces<div className="fee-sub">gardés par le livreur</div></th>
          <th className="t-num">Frais MVola / Orange Money<div className="fee-sub">payés par la caisse</div></th><th className="t-num">Retours</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key} className={r.key === '_total' ? 'fee-total' : ''}>
            <th scope="row">{r.name}{r.fund > 0 && <div className="fee-sub">→ caisse frais {r.name}</div>}</th><td className="t-num num">{r.count}</td><td className="t-num num">{fmtAr(r.value)}</td><td className="t-num num fee-main">{fmtAr(r.fees)}</td>
            <td className="t-num num">{fmtAr(r.cash)}</td><td className="t-num num fee-mvola">{fmtAr(r.mvola)}</td><td className="t-num num">{r.returns}</td></tr>)}
        </tbody>
      </table></div>
      <p className="small muted" style={{ marginTop: 8 }}>Espèces : frais encaissés par le livreur auprès du client, il les garde. MVola / Orange Money : frais payés à la boutique par Mobile Money, c’est la caisse qui les paie au livreur (sortie de caisse).{withFund ? ' « → caisse frais » : ce livreur ne garde pas ses frais, ils vont en entier dans sa caisse frais (Livraisons → Caisse frais).' : ''}</p>
    </div>
  );
}

function WeekSynth({ dates }: { dates: string[] }) {
  const rows = dates.map((d) => daySynthesis(d));
  const sum = (f: (x: ReturnType<typeof daySynthesis>) => number) => rows.reduce((t, x) => t + f(x), 0);
  return (
    <div className="card card-flush synth">
      <div className="card-pad"><h2>Synthèse de la semaine</h2><p className="small muted">Chaque jour : ce qui est parti (sans retour) et le montant corrigé par les retours constatés aux versements (avec retour).</p></div>
      <div className="table-wrap"><table className="table synth-table">
        <thead><tr><th>Jour</th><th className="t-num">Sur place</th><th className="t-num">Livraisons</th><th className="t-num">Frais livreurs</th><th className="t-num">Sans retour</th><th className="t-num">Avec retour</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.date}>
              <td><strong style={{ textTransform: 'capitalize' }}>{new Date(`${x.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong>{x.deliv.pending ? <div className="small muted">{x.deliv.pending} à confirmer</div> : null}</td>
              <td className="t-num">{x.walk.count}</td><td className="t-num">{x.deliv.count}</td><td className="t-num">{fmtAr(x.fees)}</td>
              <td className="t-num">{fmtAr(x.total.sans)}</td><td className={`t-num ${x.total.diff ? 'neg' : ''}`}>{fmtAr(x.total.avec)}</td>
            </tr>
          ))}
          <tr className="synth-total"><td>Semaine</td><td className="t-num">{sum((x) => x.walk.count)}</td><td className="t-num">{sum((x) => x.deliv.count)}</td><td className="t-num">{fmtAr(sum((x) => x.fees))}</td><td className="t-num">{fmtAr(sum((x) => x.total.sans))}</td><td className="t-num">{fmtAr(sum((x) => x.total.avec))}</td></tr>
        </tbody>
      </table></div>
    </div>
  );
}

/** Détail du bénéfice brut, article par article : ventes − coût (prix de revient × pièces). */
function ProfitDetail({ from, to, gross, sales, cost }: { from: string; to: string; gross: number; sales: number; cost: number }) {
  const rows = useMemo(() => {
    const m = new Map<string, { variantId: string; sold: number; back: number; amount: number; cost: number; disc: number; full: number }>();
    for (const l of salesLedger(from, to)) {
      if (!m.has(l.variantId)) m.set(l.variantId, { variantId: l.variantId, sold: 0, back: 0, amount: 0, cost: 0, disc: 0, full: 0 });
      const x = m.get(l.variantId)!;
      if (l.kind === 'sale') x.sold += l.qty; else x.back -= l.qty;
      x.amount += l.amount; x.cost += l.cost;
    }
    return [...m.values()].map((x) => {
      const v = get<Variant>('variants', x.variantId); const p = v && get<Product>('products', v.productId);
      return { ...x, name: p ? `${p.name}` : 'Article supprimé', variant: variantLabel(v), unit: v?.costAvg ?? 0 };
    }).sort((a, b) => b.amount - a.amount);
  }, [from, to, gross]);
  const pcs = rows.reduce((t, x) => t + x.sold - x.back, 0);
  const missing = rows.filter((x) => !x.unit && x.sold - x.back);
  return (
    <details className="card card-flush">
      <summary className="card-pad row-between" style={{ cursor: 'pointer' }}><h2>Détail du bénéfice brut</h2><strong className="num">{fmtAr(gross)}</strong></summary>
      <p className="card-pad small muted" style={{ paddingTop: 0 }}>
        Bénéfice brut = total des ventes ({fmtAr(sales)}) − coût des articles vendus ({fmtAr(cost)}).
        Le coût de chaque ligne = pièces × <strong>prix de revient de la variante</strong> (couleur/taille) — il peut être différent d’une taille ou d’une couleur à l’autre.
        Les remises sont déduites des ventes ; un article retourné est enlevé des ventes <em>et</em> du coût ; les frais de livraison ne sont pas comptés.
      </p>
      {missing.length > 0 && <div className="notice notice-danger" style={{ margin: '0 16px 12px' }}><Icon name="alert" /><span>{missing.length} article(s) vendu(s) sans prix de revient : leur coût est compté à 0, le bénéfice est donc surestimé.</span></div>}
      {rows.length === 0 ? <p className="card-pad small muted">Aucune vente sur la période.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Article</th><th className="t-num">Pièces</th><th className="t-num">Ventes</th><th className="t-num">Prix de revient / pièce</th><th className="t-num">Coût total</th><th className="t-num">Bénéfice</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.variantId}>
              <td>{x.name} <span className="muted small">{x.variant}</span></td>
              <td className="t-num">{fmtNum(x.sold - x.back)}{x.back ? <span className="small muted"> ({x.sold} − {x.back} retour)</span> : null}</td>
              <td className="t-num">{fmtAr(x.amount)}</td>
              <td className={`t-num ${x.unit ? '' : 'neg'}`}>{x.unit ? fmtAr(x.unit) : 'manquant'}</td>
              <td className="t-num">{fmtAr(x.cost)}</td>
              <td className="t-num"><strong>{fmtAr(x.amount - x.cost)}</strong></td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="synth-total"><td>Total</td><td className="t-num">{fmtNum(pcs)}</td><td className="t-num">{fmtAr(rows.reduce((t, x) => t + x.amount, 0))}</td><td></td><td className="t-num">{fmtAr(rows.reduce((t, x) => t + x.cost, 0))}</td><td className="t-num">{fmtAr(rows.reduce((t, x) => t + x.amount - x.cost, 0))}</td></tr></tfoot>
        </table></div>
      )}
    </details>
  );
}
