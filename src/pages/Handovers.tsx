// Versements des vendeurs au responsable : chaque soir, chaque vendeur remet l'argent de sa page.
// - Le responsable voit tous les vendeurs du jour (ventes par page, espèces, MVola, Orange, Airtel, total à payer),
//   saisit ce qu'il a reçu et valide.
// - Le vendeur voit sa propre feuille : ce qu'il doit remettre, et si le responsable l'a reçu.
import { useState } from 'react';
import { useCan, useCurrentUser } from '../lib/auth';
import { get, useTable } from '../lib/db';
import type { Courier } from '../lib/orders';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import { addDays, today } from '../lib/money';
import { cancelHandover, changedSince, gapDue, gapsBefore, handoverHistory, openGaps, pagesOfDay, repayGap, receiveHandover, sellerDay, sellersOfDay, type Handover, type PageDay, type PendingSale, type SellerDay } from '../lib/handovers';
import { printA4, a4Table, arA4, h } from '../lib/a4';
import { restLedger, type RestRow } from '../lib/situation';
import { COUNT_LABELS, moneyCountOf, parseFormula, setMoneyCount, type CountField } from '../lib/moneyCount';
import { userPages } from '../lib/scope';
import { Badge, Button, Confirm, Empty, Help, IconButton, Modal, PageHead, TextField, fmtDate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { exportTables, type Col } from '../ui/table';

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const money = (n: number) => (n ? fmtAr(n) : <span className="muted">—</span>);

export function HandoversPage() {
  const can = useCan();
  const me = useCurrentUser();
  useTable('orders'); useTable('cashMoves'); useTable('handovers'); useTable('moneyCounts'); useTable('users'); useTable('roles'); useTable('categories'); useTable('products'); useTable('variants');
  const [date, setDate] = useState(today());
  const [view, setView] = useState<'page' | 'seller'>('page');
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
        {boss && <div className="segmented" role="group" aria-label="Affichage" style={{ marginLeft: 'auto' }}>
          <button type="button" aria-pressed={view === 'page'} onClick={() => setView('page')}><Icon name="store" size={16} />Par page</button>
          <button type="button" aria-pressed={view === 'seller'} onClick={() => setView('seller')}><Icon name="users" size={16} />Par vendeur</button>
        </div>}
      </div>
      {boss ? <Boards date={date} view={view} /> : <Sheet d={sellerDay(me, date)} self />}
      <Restes date={date} pages={boss ? undefined : userPages(me)} />
      <History userId={boss ? undefined : me.id} />
    </>
  );
}

const dd = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
/**
 * Restes à payer : ventes pas encore entièrement payées (vente de 100 000, payé 20 000 le jour → reste 80 000), avec
 * le 1er paiement du reste et le 2ème paiement du reste quand ils arrivent (le lendemain ou après).
 */
function Restes({ date, pages }: { date: string; pages?: string[] }) {
  useTable('couriers');
  const [view, setView] = useState<'open' | 'paid'>('open');
  const all = restLedger('2000-01-01', date, pages);
  const open = all.filter((r) => r.rest > 0.5);
  const paid = all.filter((r) => r.p1?.day === date || r.p2?.day === date);
  const list = view === 'open' ? open : paid;
  const days = [...new Set(list.map((r) => r.day))];
  const tot = (xs: RestRow[]) => xs.reduce((t, r) => t + (view === 'open' ? r.rest : (r.p1?.day === date ? r.p1.amount : 0) + (r.p2?.day === date ? r.p2.amount : 0)), 0);
  const pageName = (id: string) => get<{ name: string }>('categories', id)?.name ?? 'Sans page';
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <div className="row-between"><h2>Restes à payer</h2><strong className={`num ${view === 'open' && tot(list) > 0.5 ? 'neg' : ''}`}>{fmtAr(tot(list))}</strong></div>
        <div className="row" style={{ gap: 6 }}>
          <Button variant={view === 'open' ? 'primary' : 'ghost'} className="btn-sm" onClick={() => setView('open')}>Encore à payer ({open.length})</Button>
          <Button variant={view === 'paid' ? 'primary' : 'ghost'} className="btn-sm" onClick={() => setView('paid')}>Restes payés ce jour ({paid.length})</Button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{view === 'open' ? 'Ventes pas encore entièrement payées à ce jour, par jour de vente. Ex. vente de 100 000 Ar, payé 20 000 Ar le jour : reste 80 000 Ar, payé ensuite en 1er puis 2ème paiement.' : 'Restes de ventes des jours précédents reçus ce jour (1er ou 2ème paiement du reste).'}</p>
      </div>
      {list.length === 0 ? <p className="card-pad small muted" style={{ paddingTop: 0 }}>{view === 'open' ? 'Aucun reste à payer.' : 'Aucun reste payé ce jour.'}</p> : (
        <div className="table-wrap"><table className="table table-grid">
          <thead><tr><th>Commande</th><th>Page</th><th className="t-num">Vente</th><th className="t-num">Payé le jour</th><th className="t-num">1er paiement du reste</th><th className="t-num">2ème paiement du reste</th><th className="t-num">Reste à payer</th></tr></thead>
          <tbody>{days.map((day) => {
            const xs = list.filter((r) => r.day === day);
            return [
              <tr key={day} className="t-total"><td colSpan={6}>{day === date ? 'Ventes de ce jour' : day === addDays(date, -1) ? 'Ventes d’hier' : `Ventes du ${dd(day)}`} <span className="small muted">({xs.length})</span></td><td className="t-num">{fmtAr(tot(xs))}</td></tr>,
              ...xs.map((r) => (
                <tr key={r.o.id}>
                  <td><a href={`#/commandes/${r.o.id}`}>{r.o.number}</a> <span className="small muted">{r.o.name || r.o.phone || ''}{r.o.createdByName ? ` · ${r.o.createdByName}` : ''}</span></td>
                  <td className="small">{r.pages.map(pageName).join(', ')}</td>
                  <td className="t-num">{fmtAr(r.value)}</td>
                  <td className="t-num">{money(r.sameDay)}</td>
                  <td className="t-num">{r.p1 ? <>{fmtAr(r.p1.amount)}<div className="small muted">{dd(r.p1.day)}</div></> : <span className="muted">—</span>}</td>
                  <td className="t-num">{r.p2 ? <>{fmtAr(r.p2.amount)}<div className="small muted">{dd(r.p2.day)}{r.p2.times > 1 ? ` (${r.p2.times} fois)` : ''}</div></> : <span className="muted">—</span>}</td>
                  <td className="t-num">{r.rest > 0.5 ? <><strong className="neg">{fmtAr(r.rest)}</strong>{r.atCourier > 0.5 ? <div className="small muted">dont {fmtAr(r.atCourier)} chez {get<{ name: string }>('couriers', r.o.courierId || '')?.name ?? 'le livreur'}</div> : null}</> : <span className="ok-text small">soldé</span>}</td>
                </tr>
              )),
            ];
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

/** Responsable : versement du jour par page (par défaut) ou par vendeur. */
function Boards({ date, view }: { date: string; view: 'page' | 'seller' }) {
  return (
    <>
      <PageRests date={date} />
      {view === 'page' ? <PageBoard date={date} /> : <Board date={date} />}
      <MoneyCountCard date={date} />
      <MoneyWeek date={date} />
      <SellerGaps date={date} />
    </>
  );
}

/**
 * Argent réellement reçu ce jour, saisi à la main (espèces comptées, MVola / Orange Money / Airtel Money vus sur les
 * téléphones), comparé à ce que l'application a calculé. Contrôle seulement : aucun calcul ne change.
 */
/**
 * Chiffres calculés d'un jour (toutes les pages). MVola / Orange / Airtel : ventes seulement, sans les frais livreurs que
 * les clients ont payés sur ces téléphones (feeBy, à rendre aux livreurs).
 */
function dayCalc(date: string) {
  const rows = pagesOfDay(date);
  const sum = (f: (d: PageDay) => number) => rows.reduce((t, d) => t + f(d), 0);
  const feeBy = { mvola: sum((d) => d.feeBy.mvola), orange: sum((d) => d.feeBy.orange), airtel: sum((d) => d.feeBy.airtel) };
  const calc: Record<CountField, number> = {
    cash: sum((d) => d.toPay), mvola: sum((d) => d.pay.mvola) - feeBy.mvola,
    orange: sum((d) => d.pay.orange) - feeBy.orange, airtel: sum((d) => d.pay.airtel) - feeBy.airtel,
  };
  return { calc, feeBy, feeMobile: feeBy.mvola + feeBy.orange + feeBy.airtel };
}

function MoneyCountCard({ date }: { date: string }) {
  const { calc, feeBy, feeMobile } = dayCalc(date);
  const mc = moneyCountOf(date);
  // Chaque téléphone a son écart (reçu − ventes calculées) ; ensemble, ces écarts doivent être les frais livreurs payés
  // en mobile money : différence = écart MVola + écart Orange (+ Airtel) − frais. 0 = juste.
  const mob: CountField[] = ['mvola', 'orange', 'airtel'];
  const entered = mob.filter((f) => mc?.[f] != null);
  const mobGap = entered.length ? entered.reduce((t, f) => t + (mc![f]! - calc[f]), 0) : undefined;
  const signed = (n: number) => `${n > 0.5 ? '+' : n < -0.5 ? '−' : ''} ${fmtAr(Math.abs(n))}`.trim();
  const feeEntered = entered.reduce((t, f) => t + feeBy[f as 'mvola' | 'orange' | 'airtel'], 0);
  const gapCell = (gap?: number) => gap == null ? <span className="muted">—</span> : Math.round(gap) === 0 ? <span className="ok-text" style={{ justifyContent: 'flex-end' }}>✓ juste</span> : <strong className={gap < 0 ? 'neg' : 'pos'}>{gap > 0 ? '+' : '−'} {fmtAr(Math.abs(gap))}</strong>;
  const [draft, setDraft] = useState<Partial<Record<CountField, string>>>({});
  const fields: CountField[] = ['cash', 'mvola', 'orange', 'airtel'];
  const commit = async (f: CountField) => {
    const v = draft[f]; if (v == null) return;
    const n = v.trim() === '' ? null : parseFormula(v);
    if (v.trim() !== '' && (n == null || n < 0)) { toast('Montant ou calcul invalide (ex. =20000+15000).', 'error'); return; }
    if ((n ?? undefined) === mc?.[f] && v.trim() === (mc?.formulas?.[f] ?? String(mc?.[f] ?? ''))) { setDraft((d) => ({ ...d, [f]: undefined })); return; }
    try { await setMoneyCount(date, f, n ?? null, v); setDraft((d) => ({ ...d, [f]: undefined })); toast(`${COUNT_LABELS[f]} enregistré`); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="card card-flush">
      <div className="card-pad">
        <h2>Argent réellement reçu ce jour</h2>
        <p className="small muted" style={{ margin: 0 }}>Écrivez à la main ce que vous avez vraiment : espèces comptées, MVola et Orange Money vus sur les téléphones de la boutique (chacun à part). Le calcul MVola / Orange compte les ventes seulement ; les frais livreurs payés sur ces téléphones sont à part, dessous. Comme dans Excel, vous pouvez écrire un calcul : =20000+15000+3500. L’écart avec le calcul de l’application s’affiche tout seul. Contrôle seulement : aucun calcul ne change.</p>
      </div>
      <div className="table-wrap"><table className="table table-grid money-count">
        <thead><tr><th></th><th className="t-num">Calculé par l’application</th><th className="t-num">Réellement reçu</th><th className="t-num">Écart</th></tr></thead>
        <tbody>{fields.map((f) => {
          const real = mc?.[f]; const gap = real == null ? undefined : real - calc[f];
          return (
            <tr key={f}>
              <td><strong>{COUNT_LABELS[f]}</strong>{f === 'cash' && <div className="small muted">total à payer des vendeurs</div>}</td>
              <td className="t-num">{fmtAr(calc[f])}</td>
              <td className="t-num"><input className="cell-input num-input" style={{ width: 170, textAlign: 'right' }} inputMode="numeric" aria-label={`${COUNT_LABELS[f]} réellement reçu`}
                placeholder="à saisir" value={draft[f] ?? (mc?.formulas?.[f] ?? (real == null ? '' : String(real)))} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                onBlur={() => commit(f)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                {(() => { const x = draft[f] ?? mc?.formulas?.[f]; if (!x || !/[+\-*/x×÷()]/i.test(x.replace(/^=/, '').trim().slice(1))) return null; const n = parseFormula(x); return <div className={`small ${n == null ? 'neg' : 'muted'}`}>{n == null ? 'calcul invalide' : `= ${fmtAr(n)}`}</div>; })()}</td>
              <td className="t-num">{gapCell(gap)}</td>
            </tr>
          );
        })}
          <tr>
            <td><strong>Total frais MVola / Orange Money (livreurs)</strong><div className="small muted">payés par les clients sur les téléphones, à rendre aux livreurs · MVola {fmtAr(feeBy.mvola)} · Orange {fmtAr(feeBy.orange)}{feeBy.airtel ? ` · Airtel ${fmtAr(feeBy.airtel)}` : ''}</div></td>
            <td className="t-num">{fmtAr(feeMobile)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="t-total">
            <td><strong>Différence : écart MVola + écart Orange − total frais</strong><div className="small muted">0 = tout est juste (reste éventuel : frais de retrait…)</div></td>
            <td className="t-num small" colSpan={2}>{mobGap == null ? <span className="muted">—</span> : <>{entered.map((f) => `écart ${COUNT_LABELS[f]} ${signed(mc![f]! - calc[f])}`).join(' + ')} − frais {fmtAr(feeEntered)}</>}</td>
            <td className="t-num">{gapCell(mobGap == null ? undefined : mobGap - feeEntered)}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  );
}

/**
 * Argent réellement reçu, jour par jour, de la semaine (lundi → jour affiché), avec le total de la semaine.
 * Espèces et MVola + Orange Money sans les frais livreurs, comparés au calcul de l'application.
 */
function MoneyWeek({ date }: { date: string }) {
  // Semaine choisie (calendrier, ‹ ›) ; par défaut celle du jour affiché en haut.
  const [pick, setPick] = useState<string | null>(null);
  const ref = pick ?? date;
  const wd = new Date(`${ref}T12:00:00`).getDay();
  const monday = addDays(ref, -((wd + 6) % 7));
  const end = addDays(monday, 6) < today() ? addDays(monday, 6) : today();
  const days: string[] = []; for (let d = monday; d <= end; d = addDays(d, 1)) days.push(d);
  const isCurrent = addDays(monday, 6) >= today();
  const rows = days.map((day) => {
    const { calc, feeBy } = dayCalc(day); const mc = moneyCountOf(day);
    // Comme la case du jour : écart espèces à part ; pour le mobile money, écart MVola + écart Orange − total frais
    // livreurs payés sur les téléphones saisis (0 = juste).
    const fee = (mc?.mvola != null ? feeBy.mvola : 0) + (mc?.orange != null ? feeBy.orange : 0);
    const mobIn = mc?.mvola != null || mc?.orange != null;
    const mobGap = mobIn ? (mc?.mvola != null ? mc.mvola - calc.mvola : 0) + (mc?.orange != null ? mc.orange - calc.orange : 0) - fee : undefined;
    return { day, cashCalc: calc.cash, cashReal: mc?.cash, cashGap: mc?.cash == null ? undefined : mc.cash - calc.cash, mvCalc: calc.mvola, mvReal: mc?.mvola, orCalc: calc.orange, orReal: mc?.orange, fee: feeBy.mvola + feeBy.orange, mobGap };
  });
  const sum = (f: (r: typeof rows[number]) => number | undefined) => rows.reduce((t, r) => t + (f(r) ?? 0), 0);
  const v = (n?: number) => (n == null ? <span className="muted">—</span> : fmtAr(n));
  const g = (n?: number) => (n == null ? <span className="muted">—</span> : Math.round(n) === 0 ? <span style={{ color: 'var(--ok)' }}>✓ juste</span> : <strong className={n < 0 ? 'neg' : 'pos'}>{n > 0 ? '+' : '−'} {fmtAr(Math.abs(n))}</strong>);
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <h2>Argent réellement reçu : la semaine</h2>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <IconButton icon="chevronLeft" label="Semaine précédente" onClick={() => setPick(addDays(monday, -7))} />
          <strong>Semaine du {dd(monday)} au {dd(addDays(monday, 6))}</strong>
          <IconButton icon="chevronRight" label="Semaine suivante" disabled={isCurrent} onClick={() => setPick(addDays(monday, 7))} />
          <input type="date" className="cell-input" style={{ width: 'auto' }} aria-label="Choisir une semaine" max={today()} value={ref} onChange={(e) => e.target.value && setPick(e.target.value)} />
          {!isCurrent && <Button variant="quiet" className="btn-sm" onClick={() => setPick(today())}>Cette semaine</Button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Ce que vous avez écrit chaque jour, comparé au calcul : espèces, MVola et Orange Money chacun à part. Pour le mobile money : écart MVola + écart Orange − total frais livreurs payés sur les téléphones (0 = juste).</p>
      </div>
      <div className="table-wrap"><table className="table table-grid money-week">
        <thead><tr><th>Jour</th><th className="t-num">Espèces (calcul)</th><th className="t-num">Espèces reçues</th><th className="t-num">Écart espèces</th><th className="t-num">MVola (calcul)</th><th className="t-num">MVola reçu</th><th className="t-num">Orange Money (calcul)</th><th className="t-num">Orange Money reçu</th><th className="t-num">Total frais MVola / Orange</th><th className="t-num">Écart MVola + écart Orange − frais</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.day}><td style={{ textTransform: 'capitalize' }}>{dd(r.day)}</td><td className="t-num">{fmtAr(r.cashCalc)}</td><td className="t-num">{v(r.cashReal)}</td><td className="t-num">{g(r.cashGap)}</td><td className="t-num">{fmtAr(r.mvCalc)}</td><td className="t-num">{v(r.mvReal)}</td><td className="t-num">{fmtAr(r.orCalc)}</td><td className="t-num">{v(r.orReal)}</td><td className="t-num">{money(r.fee)}</td><td className="t-num">{g(r.mobGap)}</td></tr>
        ))}</tbody>
        <tfoot><tr className="t-total"><td>Total semaine</td><td className="t-num">{fmtAr(sum((r) => r.cashCalc))}</td><td className="t-num">{fmtAr(sum((r) => r.cashReal))}</td><td className="t-num">{g(rows.some((r) => r.cashGap != null) ? sum((r) => r.cashGap) : undefined)}</td><td className="t-num">{fmtAr(sum((r) => r.mvCalc))}</td><td className="t-num">{fmtAr(sum((r) => r.mvReal))}</td><td className="t-num">{fmtAr(sum((r) => r.orCalc))}</td><td className="t-num">{fmtAr(sum((r) => r.orReal))}</td><td className="t-num">{fmtAr(sum((r) => r.fee))}</td><td className="t-num">{g(rows.some((r) => r.mobGap != null) ? sum((r) => r.mobGap) : undefined)}</td></tr></tfoot>
      </table></div>
    </div>
  );
}

/**
 * En haut de la page : tout ce qui reste impayé à ce jour, par page, pour ne rien oublier.
 * Restes clients = ventes pas encore entièrement payées (mêmes chiffres que « Restes à payer ») ;
 * impayés vendeur = écarts de versement pas encore remboursés. Lecture seule.
 */
function PageRests({ date }: { date: string }) {
  type Item = { day: string; amount: number; kind: 'client' | 'seller'; ref: string };
  const m = new Map<string, { key: string; name: string; client: number; seller: number; items: Item[] }>();
  const at = (k: string, name: string) => { let r = m.get(k); if (!r) { r = { key: k, name, client: 0, seller: 0, items: [] }; m.set(k, r); } return r; };
  const pageName = (id: string) => get<{ name: string }>('categories', id)?.name ?? 'Sans page';
  const [open, setOpen] = useState<string | null>(null);
  for (const r of restLedger('2000-01-01', date)) {
    if (r.rest <= 0.5) continue;
    const pages = r.pages.length ? r.pages : ['_'];
    for (const pg of pages) { const x = at(pg, pageName(pg)), a = r.rest / pages.length; x.client += a; x.items.push({ day: r.day, amount: a, kind: 'client', ref: r.o.number || '' }); }
  }
  for (const h of openGaps(date)) {
    const pg = h.userId.startsWith('page:') ? h.userId.slice(5) : '';
    const x = pg ? at(pg, h.userName) : at(`u:${h.userId}`, `${h.userName} (vendeur)`), a = gapDue(h);
    x.seller += a; x.items.push({ day: h.date, amount: a, kind: 'seller', ref: '' });
  }
  const rows = [...m.values()].filter((r) => r.client + r.seller > 0.5).sort((a, b) => b.client + b.seller - (a.client + a.seller));
  const t = rows.reduce((a, r) => ({ client: a.client + r.client, seller: a.seller + r.seller }), { client: 0, seller: 0 });
  /** Détail par jour : restes clients (avec les commandes) et impayé vendeur de ce jour-là. */
  const detail = (items: Item[]) => {
    const days = [...new Set(items.map((i) => i.day))].sort();
    return days.map((day) => {
      const cl = items.filter((i) => i.day === day && i.kind === 'client'), se = items.filter((i) => i.day === day && i.kind === 'seller');
      const sum = (xs: Item[]) => xs.reduce((s, i) => s + i.amount, 0);
      return (
        <div key={day} className="row-between small" style={{ padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
          <span><strong>Le {dd(day)}</strong>{cl.length ? <> · clients {fmtAr(sum(cl))} <span className="muted">({cl.map((i) => i.ref).filter(Boolean).join(', ')})</span></> : null}{se.length ? <> · impayé vendeur {fmtAr(sum(se))}</> : null}</span>
          <strong className="neg num">{fmtAr(sum(cl) + sum(se))}</strong>
        </div>
      );
    });
  };
  return (
    <div className="card card-flush">
      <div className="card-pad row-between">
        <div><h2>Restes impayés par page</h2><p className="small muted" style={{ margin: 0 }}>Tout ce qui reste à encaisser à ce jour : clients qui doivent encore et écarts de versement pas remboursés. Touchez une page pour voir le détail jour par jour.</p></div>
        <strong className={`num ${t.client + t.seller > 0.5 ? 'neg' : ''}`}>{fmtAr(t.client + t.seller)}</strong>
      </div>
      {rows.length === 0 ? <p className="card-pad small muted" style={{ paddingTop: 0 }}>Aucun impayé.</p> : (
        <div className="table-wrap"><table className="table table-grid page-rests">
          <thead><tr><th>Page</th><th className="t-num">Restes clients</th><th className="t-num">Impayés vendeur</th><th className="t-num">Total impayé</th></tr></thead>
          <tbody>{rows.map((r) => [
            <tr key={r.key} className="row-link" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>
              <td><strong>{r.name}</strong> <Icon name={open === r.key ? 'chevronUp' : 'chevronDown'} size={14} /></td><td className="t-num">{money(r.client)}</td><td className="t-num">{money(r.seller)}</td><td className="t-num"><strong className="neg">{fmtAr(r.client + r.seller)}</strong></td>
            </tr>,
            open === r.key && <tr key={`${r.key}-d`} className="rests-detail"><td colSpan={4} style={{ whiteSpace: 'normal' }}>{detail(r.items)}</td></tr>,
          ])}</tbody>
          <tfoot><tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(t.client)}</td><td className="t-num">{fmtAr(t.seller)}</td><td className="t-num">{fmtAr(t.client + t.seller)}</td></tr></tfoot>
        </table></div>
      )}
    </div>
  );
}

/** MVola / Orange / Airtel des ventes du jour seulement (sans frais livreurs) : les règlements de ventes des jours
 *  précédents reçus ce jour-là ne sont pas comptés, ils s'affichent en détail sous le chiffre. */
const mobDay = (d: SellerDay, m: 'mvola' | 'orange' | 'airtel') => d.pay[m] - d.feeBy[m] - d.mobOld.filter((x) => x.method === m).reduce((t, x) => t + x.amount, 0);
const ddmmyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
function MobCell({ d, m }: { d: SellerDay; m: 'mvola' | 'orange' | 'airtel' }) {
  const [open, setOpen] = useState(false);
  const old = d.mobOld.filter((x) => x.method === m), n = old.reduce((t, x) => t + x.amount, 0);
  return (
    <td className="t-num">
      {money(mobDay(d, m))}
      {old.length > 0 && <div><button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>règlements {fmtAr(n)}</button></div>}
      {open && <div className="small muted" style={{ whiteSpace: 'nowrap' }}>{old.map((x, i) => <div key={i}>{x.page} le {ddmmyy(x.day)} : {fmtAr(x.amount)}{x.number ? ` (${x.number})` : ''}</div>)}</div>}
    </td>
  );
}

/** Impayé vendeur des jours précédents (écart en moins pas encore remboursé). */
function PrevGap({ k, date }: { k: string; date: string }) {
  const n = gapsBefore(k, date);
  return n > 0.5 ? <div className="small neg">impayé précédent {fmtAr(n)}</div> : null;
}

/** Impayés vendeurs : écarts en moins à réclamer (vendeur ou page), jusqu'au jour affiché, avec remboursement. */
function SellerGaps({ date }: { date: string }) {
  const list = openGaps(date);
  const [pay, setPay] = useState<{ id: string; val: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const total = list.reduce((t, h) => t + gapDue(h), 0);
  const submit = async () => {
    const h = list.find((x) => x.id === pay?.id); const n = parseAr(pay?.val || '');
    if (!h || n == null) return;
    setBusy(true);
    try { await repayGap(h, n); toast(`${fmtAr(n)} remboursé par ${h.userName}`); setPay(null); }
    catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <div className="row-between"><h2>Impayés vendeurs (écarts à réclamer)</h2><strong className={`num ${total > 0.5 ? 'neg' : ''}`}>{fmtAr(total)}</strong></div>
        <p className="small muted" style={{ margin: 0 }}>Quand un vendeur remet moins que prévu, l’écart reste ici à réclamer jusqu’à ce qu’il le rembourse (bouton « Régler »). Séparé des impayés clients.</p>
      </div>
      {list.length === 0 ? <p className="card-pad small muted" style={{ paddingTop: 0 }}>Aucun écart à réclamer.</p> : (
        <div className="table-wrap"><table className="table table-grid">
          <thead><tr><th>Jour</th><th>Page / vendeur</th><th className="t-num">Écart</th><th className="t-num">Déjà remboursé</th><th className="t-num">Reste à réclamer</th><th></th></tr></thead>
          <tbody>{list.map((h) => (
            <tr key={h.id}>
              <td>{fmtDate(h.date)}</td>
              <td><strong>{h.userName}</strong>{h.userId.startsWith('page:') ? <span className="small muted"> · page</span> : null}</td>
              <td className="t-num neg">{fmtAr(-h.gap)}</td>
              <td className="t-num">{money(h.repaid || 0)}</td>
              <td className="t-num"><strong className="neg">{fmtAr(gapDue(h))}</strong></td>
              <td>{pay?.id === h.id ? (
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <input className="cell-input num-input" style={{ width: 110 }} inputMode="numeric" aria-label={`Remboursé par ${h.userName}`} value={pay.val} disabled={busy}
                    onChange={(e) => setPay({ id: h.id, val: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setPay(null); }} />
                  <IconButton icon="check" label="Valider le remboursement" disabled={busy || !pay.val.trim()} onClick={submit} />
                </div>
              ) : <Button variant="ghost" className="btn-sm" onClick={() => setPay({ id: h.id, val: String(Math.round(gapDue(h))) })}>Régler</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/** Responsable : toutes les pages du jour. Espèces reçues saisies directement dans le tableau. */
function PageBoard({ date }: { date: string }) {
  const rows = pagesOfDay(date);
  const t = rows.reduce((a, d) => ({ sales: a.sales + d.sales, cash: a.cash + d.pay.cash, day: a.day + dayCash(d).shown, c1: a.c1 + dayCash(d).n1, c2: a.c2 + dayCash(d).n2, fm: a.fm + d.feeMobile, mvola: a.mvola + mobDay(d, 'mvola'), orange: a.orange + mobDay(d, 'orange'), airtel: a.airtel + mobDay(d, 'airtel'), fees: a.fees + d.fees, toPay: a.toPay + d.toPay, got: a.got + (d.handover?.amount ?? 0) }),
    { sales: 0, cash: 0, day: 0, c1: 0, c2: 0, fm: 0, mvola: 0, orange: 0, airtel: 0, fees: 0, toPay: 0, got: 0 });
  const rest = rows.filter((d) => !d.handover).reduce((s, d) => s + d.toPay, 0);
  const waiting = rows.filter((d) => !d.handover && (d.toPay || d.sales));
  const cols: Col<PageDay>[] = [
    { key: 'p', label: 'Page', value: (d) => d.user.fullName, width: 24 },
    { key: 'v', label: 'Vendeurs', value: (d) => d.sellers.join(', '), width: 28 },
    { key: 's', label: 'Total ventes', value: (d) => Math.round(d.sales), money: true, width: 14 },
    { key: 'c', label: 'Espèces du jour', value: (d) => Math.round(dayCash(d).shown), money: true, width: 13 },
    { key: 'c1', label: '1er paiement espèces', value: (d) => Math.round(dayCash(d).n1), money: true, width: 13 },
    { key: 'c2', label: '2ème paiement espèces', value: (d) => Math.round(dayCash(d).n2), money: true, width: 13 },
    { key: 'mv', label: 'MVola', value: (d) => Math.round(mobDay(d, 'mvola')), money: true, width: 13 },
    { key: 'or', label: 'Orange Money', value: (d) => Math.round(mobDay(d, 'orange')), money: true, width: 13 },
    { key: 'ai', label: 'Airtel Money', value: (d) => Math.round(mobDay(d, 'airtel')), money: true, width: 13 },
    { key: 'f', label: 'Frais livreurs MVola / Orange Money', value: (d) => Math.round(d.feeMobile), money: true, width: 15 },
    { key: 't', label: 'Total à payer', value: (d) => Math.round(d.toPay), money: true, width: 14 },
    { key: 'r', label: 'Espèces reçues', value: (d) => (d.handover ? Math.round(d.handover.amount) : ''), money: true, width: 13 },
    { key: 'g', label: 'Écart', value: (d) => (d.handover ? Math.round(d.handover.gap) : ''), money: true, width: 12 },
  ];
  const exportXls = () => exportTables(`versements-pages_${date}.xlsx`, [{ name: 'Versements par page', cols, rows, notes: [`Versements par page — ${longDate(date)}`] }]);
  const exportPdf = () => printA4('Versements par page', longDate(date), `
    <div class="kpis"><div class="kpi"><span>Total ventes</span><b>${arA4(t.sales)}</b></div><div class="kpi"><span>Espèces</span><b>${arA4(t.cash)}</b></div><div class="kpi"><span>Mobile money</span><b>${arA4(t.mvola + t.orange + t.airtel)}</b></div><div class="kpi strong"><span>Total à payer</span><b>${arA4(t.toPay)}</b></div></div>
    ${a4Table({ head: ['Page', 'Ventes', 'Espèces du jour', '1er paiement', '2ème paiement', 'MVola', 'Orange', 'Airtel', 'Frais MVola / Orange', 'À payer', 'Reçu'], num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      rows: rows.map((d) => [h(d.user.fullName), arA4(d.sales), arA4(dayCash(d).shown), arA4(dayCash(d).n1), arA4(dayCash(d).n2), arA4(mobDay(d, 'mvola')), arA4(mobDay(d, 'orange')), arA4(mobDay(d, 'airtel')), arA4(d.feeMobile), `<b>${arA4(d.toPay)}</b>`, d.handover ? arA4(d.handover.amount) : '—']),
      foot: ['Total', arA4(t.sales), arA4(t.day), arA4(t.c1), arA4(t.c2), arA4(t.mvola), arA4(t.orange), arA4(t.airtel), arA4(t.fm), arA4(t.toPay), arA4(t.got)] })}`);
  return (
    <>
      <div className="stat-grid">
        <div className="card stat"><span className="small muted">Total des ventes</span><strong className="stat-value num">{fmtAr(t.sales)}</strong><span className="small muted">{rows.filter((d) => d.sales).length} page(s)</span></div>
        <div className="card stat"><span className="small muted">Mobile money (numéros de la boutique)</span><strong className="stat-value num">{fmtAr(t.mvola + t.orange + t.airtel)}</strong><span className="small muted">MVola {fmtAr(t.mvola)} · Orange {fmtAr(t.orange)} · Airtel {fmtAr(t.airtel)}</span></div>
        <div className="card stat stat-strong"><span className="small muted">Total à payer (espèces)</span><strong className="stat-value num">{fmtAr(t.toPay)}</strong><span className="small muted">déjà reçu : {fmtAr(t.got)}</span></div>
        <div className="card stat"><span className="small muted">Reste à recevoir</span><strong className={`stat-value num ${rest > 0 ? 'neg' : ''}`}>{fmtAr(rest)}</strong><span className="small muted">{waiting.length ? `${waiting.length} page(s) pas encore reçue(s)` : 'tout est reçu'}</span></div>
      </div>
      <div className="card card-flush">
        <div className="card-pad row-between">
          <div><h2>Page par page</h2>
            <Help>Mêmes calculs que par vendeur, regroupés par page : total à payer = espèces du jour + 1er + 2ème paiement espèces. Total ventes, MVola et Orange Money se remplissent tout seuls. Les frais gardés par les livreurs sont déjà retirés des espèces ; la colonne frais montre seulement les frais payés en MVola / Orange Money. Dans « Espèces du jour » : ✓ si vous avez reçu le montant calculé, ✏️ pour écrire directement le montant vraiment reçu ; l’écart s’affiche dessous et devient un impayé vendeur.</Help></div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" className="btn-sm" icon="download" onClick={exportXls}>Excel</Button>
            <Button variant="ghost" className="btn-sm" icon="printer" onClick={exportPdf}>PDF A4</Button>
          </div>
        </div>
        {rows.length === 0 ? <p className="card-pad small muted">Aucune vente ce jour.</p> : (
          <div className="table-wrap"><table className="table table-grid handover-table">
            <thead><tr><th>Page</th><th className="t-num">Total ventes</th><th className="t-num">Espèces du jour</th><th className="t-num">1er paiement espèces</th><th className="t-num">2ème paiement espèces</th><th className="t-num">MVola</th><th className="t-num">Orange Money</th><th className="t-num">Airtel Money</th><th className="t-num">Frais livreurs MVola / Orange Money</th><th className="t-num">Total à payer</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.pageId}>
                  <td><strong>{d.user.fullName}</strong><div className="small muted">{d.sellers.join(', ') || '—'}</div><PrevGap k={d.user.id} date={date} /></td>
                  <td className="t-num">{money(d.sales)}</td>
                  <CashCells d={d} />
                  <MobCell d={d} m="mvola" />
                  <MobCell d={d} m="orange" />
                  <MobCell d={d} m="airtel" />
                  <td className="t-num">{money(d.feeMobile)}</td>
                  <td className="t-num"><strong>{fmtAr(d.toPay)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(t.sales)}</td><td className="t-num">{fmtAr(t.day)}</td><td className="t-num">{fmtAr(t.c1)}</td><td className="t-num">{fmtAr(t.c2)}</td><td className="t-num">{fmtAr(t.mvola)}</td><td className="t-num">{fmtAr(t.orange)}</td><td className="t-num">{fmtAr(t.airtel)}</td><td className="t-num">{fmtAr(t.fm)}</td><td className="t-num">{fmtAr(t.toPay)}</td></tr></tfoot>
          </table></div>
        )}
      </div>
    </>
  );
}

/** Responsable : tous les vendeurs du jour. */
function Board({ date }: { date: string }) {
  const rows = sellersOfDay(date);
  const [open, setOpen] = useState<string | null>(null);
  const t = rows.reduce((a, d) => ({ sales: a.sales + d.sales, cash: a.cash + d.pay.cash, day: a.day + dayCash(d).shown, c1: a.c1 + dayCash(d).n1, c2: a.c2 + dayCash(d).n2, fm: a.fm + d.feeMobile, mvola: a.mvola + mobDay(d, 'mvola'), orange: a.orange + mobDay(d, 'orange'), airtel: a.airtel + mobDay(d, 'airtel'), fees: a.fees + d.fees, exp: a.exp + d.expenses, toPay: a.toPay + d.toPay, got: a.got + (d.handover?.amount ?? 0) }),
    { sales: 0, cash: 0, day: 0, c1: 0, c2: 0, fm: 0, mvola: 0, orange: 0, airtel: 0, fees: 0, exp: 0, toPay: 0, got: 0 });
  const waiting = rows.filter((d) => !d.handover && (d.toPay || d.sales));
  const rest = rows.filter((d) => !d.handover).reduce((s, d) => s + d.toPay, 0);
  const sel = rows.find((d) => d.user.id === open);

  const cols: Col<SellerDay>[] = [
    { key: 'v', label: 'Vendeur', value: (d) => d.user.fullName, width: 22 },
    { key: 'p', label: 'Pages', value: (d) => d.pages.map((p) => `${p.name} : ${Math.round(p.sales).toLocaleString('fr-FR')}`).join(' ; '), width: 40 },
    { key: 's', label: 'Total ventes', value: (d) => Math.round(d.sales), money: true, width: 14 },
    { key: 'c', label: 'Espèces du jour', value: (d) => Math.round(dayCash(d).shown), money: true, width: 13 },
    { key: 'c1', label: '1er paiement espèces', value: (d) => Math.round(dayCash(d).n1), money: true, width: 13 },
    { key: 'c2', label: '2ème paiement espèces', value: (d) => Math.round(dayCash(d).n2), money: true, width: 13 },
    { key: 'mv', label: 'MVola', value: (d) => Math.round(mobDay(d, 'mvola')), money: true, width: 13 },
    { key: 'or', label: 'Orange Money', value: (d) => Math.round(mobDay(d, 'orange')), money: true, width: 13 },
    { key: 'ai', label: 'Airtel Money', value: (d) => Math.round(mobDay(d, 'airtel')), money: true, width: 13 },
    { key: 'f', label: 'Frais livreurs MVola / Orange Money', value: (d) => Math.round(d.feeMobile), money: true, width: 15 },
    { key: 'e', label: 'Dépenses (caisse)', value: (d) => Math.round(d.expenses), money: true, width: 13 },
    { key: 't', label: 'Total à payer', value: (d) => Math.round(d.toPay), money: true, width: 14 },
    { key: 'r', label: 'Reçu', value: (d) => (d.handover ? Math.round(d.handover.amount) : ''), money: true, width: 13 },
    { key: 'g', label: 'Écart', value: (d) => (d.handover ? Math.round(d.handover.gap) : ''), money: true, width: 12 },
  ];
  const exportXls = () => exportTables(`versements-vendeurs_${date}.xlsx`, [{ name: 'Versements', cols, rows, notes: [`Versements des vendeurs — ${longDate(date)}`] }]);
  const exportPdf = () => printA4('Versements des vendeurs', longDate(date), `
    <div class="kpis"><div class="kpi"><span>Total ventes</span><b>${arA4(t.sales)}</b></div><div class="kpi"><span>Espèces</span><b>${arA4(t.cash)}</b></div><div class="kpi"><span>Mobile money</span><b>${arA4(t.mvola + t.orange + t.airtel)}</b></div><div class="kpi strong"><span>Total à payer</span><b>${arA4(t.toPay)}</b></div></div>
    ${a4Table({ head: ['Vendeur', 'Ventes', 'Espèces du jour', '1er paiement', '2ème paiement', 'MVola', 'Orange', 'Airtel', 'Frais MVola / Orange', 'Dépenses', 'À payer', 'Reçu'], num: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      rows: rows.map((d) => [h(d.user.fullName), arA4(d.sales), arA4(dayCash(d).shown), arA4(dayCash(d).n1), arA4(dayCash(d).n2), arA4(mobDay(d, 'mvola')), arA4(mobDay(d, 'orange')), arA4(mobDay(d, 'airtel')), arA4(d.feeMobile), arA4(d.expenses), `<b>${arA4(d.toPay)}</b>`, d.handover ? arA4(d.handover.amount) : '—']),
      foot: ['Total', arA4(t.sales), arA4(t.day), arA4(t.c1), arA4(t.c2), arA4(t.mvola), arA4(t.orange), arA4(t.airtel), arA4(t.fm), arA4(t.exp), arA4(t.toPay), arA4(t.got)] })}
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
            <Help>Total à payer = espèces encaissées (ventes sur place et argent des colis versé par les livreurs) − frais gardés par les livreurs. Les dépenses sont débitées de la caisse de la boutique, pas du versement. Le mobile money arrive sur les numéros de la boutique : il est affiché pour contrôle, mais n’est pas à remettre. Touchez un vendeur pour voir ses pages et valider ce qu’il vous remet.</Help></div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" className="btn-sm" icon="download" onClick={exportXls}>Excel</Button>
            <Button variant="ghost" className="btn-sm" icon="printer" onClick={exportPdf}>PDF A4</Button>
          </div>
        </div>
        {rows.length === 0 ? <p className="card-pad small muted">Aucun vendeur ni aucune vente ce jour.</p> : (
          <div className="table-wrap"><table className="table table-grid handover-table">
            <thead><tr><th>Vendeur</th><th className="t-num">Total ventes</th><th className="t-num">Espèces du jour</th><th className="t-num">1er paiement espèces</th><th className="t-num">2ème paiement espèces</th><th className="t-num">MVola</th><th className="t-num">Orange Money</th><th className="t-num">Airtel Money</th><th className="t-num">Frais livreurs MVola / Orange Money</th><th className="t-num">Dépenses</th><th className="t-num">Total à payer</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.user.id} className="row-link" onClick={() => setOpen(d.user.id)}>
                  <td><strong>{d.user.fullName}</strong><div className="small muted">{d.pages.length ? d.pages.map((p) => p.name).join(', ') : 'aucune vente'}</div><PrevGap k={d.user.id} date={date} /></td>
                  <td className="t-num">{money(d.sales)}</td>
                  <CashCells d={d} />
                  <MobCell d={d} m="mvola" />
                  <MobCell d={d} m="orange" />
                  <MobCell d={d} m="airtel" />
                  <td className="t-num">{money(d.feeMobile)}</td>
                  <td className="t-num muted">{money(d.expenses)}</td>
                  <td className="t-num"><strong>{fmtAr(d.toPay)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(t.sales)}</td><td className="t-num">{fmtAr(t.day)}</td><td className="t-num">{fmtAr(t.c1)}</td><td className="t-num">{fmtAr(t.c2)}</td><td className="t-num">{fmtAr(t.mvola)}</td><td className="t-num">{fmtAr(t.orange)}</td><td className="t-num">{fmtAr(t.airtel)}</td><td className="t-num">{fmtAr(t.fm)}</td><td className="t-num">{fmtAr(t.exp)}</td><td className="t-num">{fmtAr(t.toPay)}</td></tr></tfoot>
          </table></div>
        )}
      </div>
      {sel && <Modal title={`Versement de ${sel.user.fullName}`} wide onClose={() => setOpen(null)}><Sheet d={sel} onDone={() => setOpen(null)} /></Modal>}
    </>
  );
}

/**
 * Espèces à remettre, en 3 parts : espèces du jour (ventes du jour), 1er et 2ème paiement espèces (restes des jours
 * précédents). Les frais gardés par les livreurs sont déjà retirés de chaque part : la somme des 3 = total à payer.
 * Quand le responsable corrige « Espèces du jour », la case suit ce montant ; le chiffre calculé et l'écart restent
 * affichés en dessous. Affichage seulement : le total à payer ne change pas.
 */
function dayCash(d: SellerDay) {
  const n1 = d.cash1 - d.fee1, n2 = d.cash2 - d.fee2;
  const calc = d.toPay - n1 - n2;
  const shown = d.handover ? d.handover.amount - n1 - n2 : calc;
  return { n1, n2, calc, shown, changed: !!d.handover && Math.round(shown) !== Math.round(calc) };
}
function CashCells({ d }: { d: SellerDay }) {
  const c = dayCash(d);
  return (
    <>
      <td className="t-num" onClick={(e) => e.stopPropagation()}><DayCashCell d={d} /></td>
      <td className="t-num">{money(c.n1)}</td>
      <td className="t-num">{money(c.n2)}</td>
    </>
  );
}

/** Case « Espèces du jour » : ✓ = reçu comme calculé ; ✏️ = corriger directement le montant vraiment reçu (Entrée ou ✓).
 *  Versement enregistré = espèces du jour reçues + 1er + 2ème paiement espèces. Un montant validé peut être corrigé
 *  (l'ancien reste tracé dans le journal). */
function DayCashCell({ d }: { d: SellerDay }) {
  const ho = d.handover;
  const c = dayCash(d);
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ho && !d.toPay && !d.sales && !Math.round(c.calc)) return money(0);
  const save = async (n: number) => {
    const total = Math.max(0, n + c.n1 + c.n2);
    setBusy(true);
    try {
      if (ho) await cancelHandover(ho, `Montant corrigé dans le tableau : ${fmtAr(ho.amount)} → ${fmtAr(total)}`);
      await receiveHandover(d, total);
      toast(`${fmtAr(n)} d’espèces du jour reçu de ${d.user.fullName}`); setEdit(false); setVal('');
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const submit = () => { const n = parseAr(val); if (n == null || n < 0) { toast('Indiquez les espèces du jour reçues.', 'error'); return; } save(n); };
  if (edit) return (
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <input className="cell-input num-input" style={{ width: 110 }} inputMode="numeric" autoFocus aria-label={`Espèces du jour reçues de ${d.user.fullName}`}
        value={val} disabled={busy} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setEdit(false); }} />
      <IconButton icon="check" label="Valider le montant reçu" disabled={busy || !val.trim()} onClick={submit} />
    </div>
  );
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="row" style={{ gap: 2, flexWrap: 'nowrap', justifyContent: 'flex-end', alignItems: 'center' }}>
        <strong>{fmtAr(c.shown)}</strong>
        {!ho && <IconButton icon="check" label={`Reçu comme calculé (${d.user.fullName})`} disabled={busy} onClick={() => save(c.calc)} />}
        <IconButton icon="edit" label={`Corriger les espèces du jour (${d.user.fullName})`} onClick={() => { setVal(String(Math.round(c.shown))); setEdit(true); }} />
      </div>
      {ho ? <div className="small" style={{ color: "var(--ok)" }}>reçu</div> : <div className="small neg">à recevoir</div>}
      {c.changed && <div className="small muted">calculé {fmtAr(c.calc)}</div>}
      {ho?.gap ? <div className="small neg">écart {ho.gap > 0 ? '+' : '−'} {fmtAr(Math.abs(ho.gap))}</div> : null}
      {changedSince(d) && <div className="small neg">chiffres changés</div>}
    </div>
  );
}

const WHY: Record<PendingSale['why'], string> = { out: 'en livraison', courier: 'livré, argent chez le livreur', client: 'le client doit encore' };
/** Ventes pas encore encaissées (reste d'hier et d'avant, et du jour) : pour faire le compte avec le responsable. */
function PendingList({ d }: { d: SellerDay }) {
  const days = [...new Set(d.pending.map((x) => x.day))];
  const total = d.pending.reduce((t, x) => t + x.amount, 0);
  const label = (day: string) => day === d.date ? 'Ventes de ce jour' : day === addDays(d.date, -1) ? 'Reste d’hier' : `Reste du ${new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><div><h2>Reste à encaisser</h2><p className="small muted" style={{ margin: 0 }}>Ventes pas encore payées à ce jour : elles compteront le jour où l’argent arrive.</p></div><strong className={`num ${total > 0.5 ? 'neg' : ''}`}>{fmtAr(total)}</strong></div>
      {d.pending.length === 0 ? <p className="card-pad small muted" style={{ paddingTop: 0 }}>Tout est encaissé.</p> : (
        <div className="table-wrap"><table className="table">
          <tbody>{days.map((day) => {
            const xs = d.pending.filter((x) => x.day === day);
            return [
              <tr key={day} className="t-total"><td>{label(day)} <span className="small muted">({xs.length} commande(s))</span></td><td className="t-num">{fmtAr(xs.reduce((t, x) => t + x.amount, 0))}</td></tr>,
              ...xs.map((x) => <tr key={x.o.id}><td><a href={`#/commandes/${x.o.id}`}>{x.o.number}</a> {x.o.name || x.o.phone ? <span className="small muted">· {x.o.name || x.o.phone}</span> : null} <span className="small muted">· {WHY[x.why]}{x.o.courierId && x.why !== 'client' ? ` (${get<Courier>('couriers', x.o.courierId)?.name ?? 'livreur'})` : ''}</span></td><td className="t-num">{fmtAr(x.amount)}</td></tr>),
            ];
          })}</tbody>
        </table></div>
      )}
    </div>
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
            <tr><td>Espèces encaissées <span className="small muted">(clients {fmtAr(d.shopCash)} · versées par les livreurs {fmtAr(d.courierCash)}{Math.round(d.cashOld) > 0 ? <> · dont <strong>{fmtAr(d.cashOld)}</strong> pour des ventes des jours précédents</> : null})</span></td><td className="t-num">{fmtAr(d.pay.cash)}</td></tr>
            <tr><td>MVola <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(mobDay(d, 'mvola'))}</td></tr>
            <tr><td>Orange Money <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(mobDay(d, 'orange'))}</td></tr>
            <tr><td>Airtel Money <span className="small muted">(numéro de la boutique)</span></td><td className="t-num">{fmtAr(mobDay(d, 'airtel'))}</td></tr>
            {d.fees > 0 && <tr><td>Frais de livraison gardés par les livreurs</td><td className="t-num neg">− {fmtAr(d.fees)}</td></tr>}
            <tr className="t-total rc-grand"><td><strong>TOTAL À PAYER</strong> <span className="small muted">= espèces − frais livreurs</span></td><td className="t-num"><strong>{fmtAr(d.toPay)}</strong></td></tr>
            {d.expenseMoves.length > 0 && <tr><td className="small muted">Dépenses payées ce jour ({d.expenseMoves.length}) : débitées de la caisse de la boutique, pas de ce versement<div>{d.expenseMoves.map((m) => `${m.label || 'Dépense'} ${fmtAr(-m.amount)}`).join(' · ')}</div></td><td className="t-num small muted">{fmtAr(d.expenses)}</td></tr>}
          </tbody>
        </table></div>
        {d.outParcels > 0 && <div className={`notice ${self ? 'card-pad' : ''}`}><Icon name="truck" /><span>{d.outParcels} colis encore chez les livreurs : leur argent comptera le jour où le livreur le verse.</span></div>}
      </div>
      <PendingList d={d} />

      {ho ? (
        <div className="card stack-s">
          <p><Badge tone={ho.gap ? 'warn' : 'ok'}>Reçu</Badge> <strong>{fmtAr(ho.amount)}</strong> remis à {ho.byName ?? '?'} le {new Date(ho.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {ho.gap ? <span className={ho.gap < 0 ? 'neg' : 'pos'}> · écart {ho.gap > 0 ? '+' : ''}{fmtAr(ho.gap)}</span> : null}</p>
          {ho.note && <p className="small muted">Note : {ho.note}</p>}
          {changedSince(d) && <div className="notice notice-danger"><Icon name="alert" /><span>Les chiffres ont changé depuis la validation (à payer : {fmtAr(ho.expected)} → {fmtAr(d.toPay)}). Vérifiez avec le vendeur ; au besoin, annulez puis validez à nouveau.</span></div>}
          {boss && <div><Button variant="danger" icon="x" onClick={() => setCancel(true)}>Annuler ce versement</Button></div>}
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
