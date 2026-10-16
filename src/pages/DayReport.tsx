// « Mon rapport du jour » : chaque vendeur envoie au patron, en fin de journée, le rapport de ses pages.
// Rapports → « Rapports des vendeurs » : le patron voit, jour par jour, qui a envoyé son rapport et son contenu.
import { useMemo, useState } from 'react';
import { all, useTable } from '../lib/db';
import { fmtAr, fmtNum } from '../lib/catalog';
import { fmtPhone, normPhone } from '../lib/orders';
import { addDays, today } from '../lib/money';
import { useMe, type User } from '../lib/auth';
import { userPages } from '../lib/scope';
import { useCompany } from '../lib/settings';
import { a4Table, arA4, h, printA4 } from '../lib/a4';
import { dayReport, dayReportText, reportPages, saveDayReport, sentReport, type DayReport, type DayReportRec } from '../lib/dayReport';
import { Button, Field, PageHead, toast } from '../ui/kit';
import { sellerDay } from '../lib/handovers';
import { Icon } from '../ui/icons';

const frDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const frTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const useReportData = () => { useTable('orders'); useTable('stockMoves'); useTable('variants'); useTable('products'); useTable('categories'); };

function DayNav({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  return (
    <div className="period-nav">
      <Button variant="ghost" icon="chevronLeft" onClick={() => setDate(addDays(date, -1))} aria-label="Jour précédent" />
      <strong className="period-label">{frDay(date)}</strong>
      <Button variant="ghost" icon="chevronRight" onClick={() => setDate(addDays(date, 1))} aria-label="Jour suivant" disabled={date >= today()} />
      {date !== today() && <Button variant="quiet" onClick={() => setDate(today())}>Aujourd'hui</Button>}
    </div>
  );
}

/** Contenu du rapport (chiffres, articles vendus, commandes, stock). */
export function DayReportView({ r }: { r: DayReport }) {
  const T = r.sit.total;
  const tiles: { l: string; v: number; sub?: string; strong?: boolean; neg?: boolean }[] = [
    { l: 'Ventes', v: T.sales, sub: `${T.orders} vente(s) · ${fmtNum(T.qty)} pièce(s)`, strong: true },
    { l: 'Espèces', v: T.pay.cash },
    { l: 'MVola', v: T.pay.mvola },
    ...(Math.round(T.pay.orange) ? [{ l: 'Orange Money', v: T.pay.orange }] : []),
    ...(Math.round(T.pay.airtel) ? [{ l: 'Airtel Money', v: T.pay.airtel }] : []),
    { l: 'Reste à payer', v: T.rest, sub: `${T.restN} commande(s)`, neg: T.rest > 0.5 },
    { l: 'Annulé', v: T.cancelled, sub: `${T.cancelledN} commande(s)` },
    { l: 'Reporté', v: T.reported, sub: `${T.reportedN} commande(s)` },
  ];
  const o = r.open;
  return (
    <div className="stack-s">
      <div className="stat-grid sit-kpis">
        {tiles.map((t) => (
          <div key={t.l} className={`card stat ${t.strong ? 'stat-strong' : ''}`}>
            <span className="small muted">{t.l}</span>
            <strong className={`stat-value num ${t.neg ? 'neg' : ''}`}>{fmtAr(t.v)}</strong>
            {t.sub && <span className="small muted">{t.sub}</span>}
          </div>
        ))}
      </div>
      {r.sit.rows.length > 1 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Page</th><th className="t-num">Ventes</th><th className="t-num">Pièces</th><th className="t-num">Espèces</th><th className="t-num">Mobile Money</th><th className="t-num">Reste à payer</th></tr></thead>
          <tbody>{r.sit.rows.map((p) => <tr key={p.id}><td><strong>{p.name}</strong></td><td className="t-num">{fmtAr(p.sales)}</td><td className="t-num">{fmtNum(p.qty)}</td><td className="t-num">{fmtAr(p.pay.cash)}</td><td className="t-num">{fmtAr(p.pay.mvola + p.pay.orange + p.pay.airtel)}</td><td className="t-num">{fmtAr(p.rest)}</td></tr>)}</tbody>
        </table></div>
      )}
      <h3>Articles vendus</h3>
      {r.items.length === 0 ? <p className="small muted">Aucun article vendu ce jour.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Article</th>{r.pageIds.length > 1 && <th>Page</th>}<th className="t-num">Qté</th><th className="t-num">Montant</th></tr></thead>
          <tbody>{r.items.map((i) => <tr key={i.key}><td>{i.name}</td>{r.pageIds.length > 1 && <td className="small muted">{i.page}</td>}<td className="t-num">{fmtNum(i.qty)}</td><td className="t-num">{fmtAr(i.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
      <h3>Commandes</h3>
      <div className="money-lines">
        <div><span>Reçues ce jour</span><strong className="num">{o.created}</strong></div>
        <div><span>Enregistrées (à préparer)</span><strong className="num">{o.recorded} · {fmtAr(o.recordedV)}</strong></div>
        <div><span>En attente de livraison</span><strong className="num">{o.waiting} · {fmtAr(o.waitingV)}</strong></div>
        <div><span>En livraison</span><strong className="num">{o.out} · {fmtAr(o.outV)}</strong></div>
      </div>
      <h3>Stock restant</h3>
      <div className="money-lines">{r.stock.map((s) => <div key={s.id}><span>{s.name}</span><strong className="num">{fmtNum(s.pieces)} pcs</strong></div>)}</div>
    </div>
  );
}

function printReport(r: DayReport, who: string, note?: string) {
  const T = r.sit.total;
  const kv = (rows: [string, string][]) => a4Table({ head: ['', 'Montant'], num: [1], rows });
  const body = `<p>Pages : <b>${h(r.pageNames.join(', '))}</b></p><h2>Ventes et argent reçu</h2>`
    + kv([['<b>Ventes</b>', `<b>${arA4(T.sales)}</b>`], ['Nombre de ventes / pièces', `${T.orders} / ${T.qty}`], ['Espèces', arA4(T.pay.cash)], ['MVola', arA4(T.pay.mvola)], ['Orange Money', arA4(T.pay.orange)], ['Airtel Money', arA4(T.pay.airtel)], ['Reste à payer', arA4(T.rest)], ['Annulé', `${arA4(T.cancelled)} (${T.cancelledN})`], ['Reporté', `${arA4(T.reported)} (${T.reportedN})`]])
    + (r.items.length ? a4Table({ title: 'Articles vendus', head: ['Article', 'Page', 'Qté', 'Montant'], num: [2, 3], rows: r.items.map((i) => [h(i.name), h(i.page), i.qty, arA4(i.amount)]), foot: ['Total', '', T.qty, arA4(T.sales)] }) : '')
    + a4Table({ title: 'Commandes', head: ['', 'Nombre', 'Valeur'], num: [1, 2], rows: [['Reçues ce jour', r.open.created, ''], ['Enregistrées (à préparer)', r.open.recorded, arA4(r.open.recordedV)], ['En attente de livraison', r.open.waiting, arA4(r.open.waitingV)], ['En livraison', r.open.out, arA4(r.open.outV)]] })
    + a4Table({ title: 'Stock restant', head: ['Page', 'Pièces'], num: [1], rows: r.stock.map((s) => [h(s.name), s.pieces]) })
    + (note?.trim() ? `<h2>Remarques</h2><p>${h(note.trim()).replace(/\n/g, '<br>')}</p>` : '');
  printA4(`Rapport du jour — ${who}`, frDay(r.date), body);
}

/** Menu « Mon rapport du jour » (vendeur, responsable). */
export function MyDayReportPage() {
  useReportData(); useTable('dayReports');
  const me = useMe();
  const company = useCompany();
  const [date, setDate] = useState(today());
  const pages = reportPages(me);
  const r = useMemo(() => dayReport(date, pages), [date, pages.join(), all('orders').length, all('stockMoves').length]);
  const prev = sentReport(me.id, date);
  const [note, setNote] = useState<{ d: string; v: string } | null>(null);
  const noteV = note?.d === date ? note.v : prev?.note ?? '';
  useTable('cashMoves'); useTable('handovers');
  const sd = sellerDay(me, date);
  const text = dayReportText(r, me.fullName, company.name, noteV, sd);
  const phone = normPhone(company.bossPhone || '');
  const intl = phone ? '261' + phone.replace(/^0/, '') : '';
  const send = () => { saveDayReport(me, r, text, noteV).then(() => toast('Rapport enregistré : le patron le voit aussi dans Rapports.', 'ok')).catch((e) => toast(e.message, 'error')); };

  return (
    <div className="stack">
      <PageHead title="Mon rapport du jour" subtitle={userPages(me).length ? `À envoyer au patron en fin de journée · pages : ${r.pageNames.join(', ')}` : 'À envoyer au patron en fin de journée · aucune page attribuée : toutes les pages'} />
      <div className="card stack-s">
        <DayNav date={date} setDate={setDate} />
        {prev && <p className="small ok-text"><Icon name="check" size={14} /> Rapport envoyé le {frTime(prev.sentAt)}{prev.sales !== Math.round(r.sit.total.sales) ? ' — les chiffres ont changé depuis : renvoyez-le.' : ''}</p>}
      </div>
      <section className="card stack-s"><DayReportView r={r} /></section>
      <section className="card stack-s">
        <h2>Espèces en main (à remettre ce soir)</h2>
        <p className="small muted" style={{ margin: 0 }}>Les espèces que vous avez encaissées vous-même : ventes sur place que vous avez saisies (quelle que soit la page) et argent rapporté par les livreurs pour vos commandes.</p>
        <div className="money-lines">
          <div><span>Ventes sur place (espèces)</span><strong className="num">{fmtAr(sd.shopCash)}</strong></div>
          {Math.round(sd.courierCash) !== 0 && <div><span>Rapportées par les livreurs</span><strong className="num">{fmtAr(sd.courierCash)}</strong></div>}
          {Math.round(sd.fees) !== 0 && <div><span>− Frais gardés par les livreurs</span><strong className="num">{fmtAr(sd.fees)}</strong></div>}
          <div className="ml-strong"><span>= Total à remettre</span><strong className="num">{fmtAr(sd.toPay)}</strong></div>
        </div>
        {sd.pending.length > 0 && <p className="small" style={{ margin: 0 }}>Reste à encaisser (ventes pas encore payées) : <strong className="neg">{fmtAr(sd.pending.reduce((t, x) => t + x.amount, 0))}</strong> · {sd.pending.length} commande(s) — détail dans <a href="#/versements">Versements vendeurs</a>.</p>}
        {sd.handover && <p className="small ok-text" style={{ margin: 0 }}><Icon name="check" size={14} /> Remis : {fmtAr(sd.handover.amount)} à {sd.handover.byName}</p>}
      </section>
      <section className="card stack-s">
        <h2>Envoyer au patron</h2>
        <Field label="Remarques (problèmes, clients à rappeler, articles demandés…)">{(id) => <textarea id={id} rows={3} value={noteV} onChange={(e) => setNote({ d: date, v: e.target.value })} placeholder="Facultatif" />}</Field>
        <pre className="recap-text">{text}</pre>
        <div className="row">
          <a className="btn btn-primary btn-wa" href={`https://wa.me/${intl}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={send}><Icon name="share" />Envoyer par WhatsApp{company.bossPhone ? ` (${fmtPhone(company.bossPhone)})` : ''}</a>
          <Button variant="ghost" icon="check" onClick={send}>Enregistrer sans WhatsApp</Button>
          <Button variant="ghost" icon="printer" onClick={() => printReport(r, me.fullName, noteV)}>PDF A4 / Imprimer</Button>
        </div>
        {!company.bossPhone && <p className="small muted">Le WhatsApp du patron n’est pas encore enregistré (Paramètres → Société).</p>}
      </section>
    </div>
  );
}

/** Rapports → « Rapports des vendeurs » (patron, gérant). */
export function SellerReports() {
  useReportData(); useTable('dayReports'); useTable('users');
  const [date, setDate] = useState(today());
  const [open, setOpen] = useState<string | null>(null);
  const sent = all<DayReportRec>('dayReports').filter((x) => x.date === date);
  const sellers = all<User>('users').filter((u) => !u.removed && u.active && userPages(u).length > 0);
  const ids = new Set(sellers.map((u) => u.id));
  const rows: { id: string; name: string; user?: User; rec?: DayReportRec }[] = [
    ...sellers.map((u) => ({ id: u.id, name: u.fullName, user: u, rec: sent.find((x) => x.userId === u.id) })),
    ...sent.filter((x) => !ids.has(x.userId)).map((x) => ({ id: x.userId, name: x.userName, rec: x })),
  ].sort((a, b) => Number(!!b.rec) - Number(!!a.rec) || a.name.localeCompare(b.name));
  const nSent = rows.filter((x) => x.rec).length;
  return (
    <div className="stack">
      <div className="card stack-s">
        <DayNav date={date} setDate={(d) => { setDate(d); setOpen(null); }} />
        <p className="small muted">{nSent} rapport(s) envoyé(s) sur {rows.length}. Touchez un vendeur pour voir son rapport ; s’il ne l’a pas encore envoyé, vous voyez ses chiffres actuels.</p>
      </div>
      {rows.length === 0 && <p className="card small muted">Aucun vendeur avec des pages attribuées (Utilisateurs → pages du vendeur).</p>}
      {rows.map((x) => (
        <section key={x.id} className="card stack-s">
          <button className="row-between link-row" style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
            <span><strong>{x.name}</strong> <span className="small muted">· {(x.user ? reportPages(x.user) : x.rec!.pageIds).map((id) => all<{ id: string; name: string }>('categories').find((c) => c.id === id)?.name).filter(Boolean).join(', ')}</span></span>
            <span className="row" style={{ gap: 10 }}>
              {x.rec ? <><strong className="num">{fmtAr(x.rec.sales)}</strong><span className="small ok-text"><Icon name="check" size={14} /> Envoyé à {new Date(x.rec.sentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></> : <span className="small neg">Pas encore envoyé</span>}
              <Icon name={open === x.id ? 'chevronUp' : 'chevronDown'} size={16} />
            </span>
          </button>
          {open === x.id && (x.rec ? <pre className="recap-text">{x.rec.text}</pre> : x.user ? <LiveReport u={x.user} date={date} /> : null)}
        </section>
      ))}
    </div>
  );
}

function LiveReport({ u, date }: { u: User; date: string }) {
  const r = useMemo(() => dayReport(date, reportPages(u)), [date, u.id]);
  return <><p className="small muted">Chiffres actuels (rapport pas encore envoyé) :</p><DayReportView r={r} /></>;
}
