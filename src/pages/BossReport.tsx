// Rapports → « Rapport au patron » : jour (par défaut aujourd'hui), semaine (lundi → samedi), mois, année, période libre.
// Résultat, CA par page, stock (début + entrées − fin = sorti) et stock par page ; envoi WhatsApp, PDF A4, Excel.
import { useMemo, useState } from 'react';
import { setMeta, useMeta, useTable } from '../lib/db';
import { fmtAr } from '../lib/catalog';
import { fmtPhone, normPhone } from '../lib/orders';
import { today } from '../lib/money';
import { PKIND, bossReport, periodOf, reportText, shiftAnchor, type PKind, type PageRow, type Report, type StockRow } from '../lib/report';
import { a4Table, arA4, h, printA4 } from '../lib/a4';
import { useCompany } from '../lib/settings';
import { usdRate } from '../lib/payouts';
import { Button, Choice, TextField, toast, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { SortTable, exportTables, type Col } from '../ui/table';
import { Delta } from './Reports';

const pctTxt = (n: number) => (n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';

/** Clé « déjà envoyé » d'un rapport (pour ne plus le rappeler). */
export const reportKey = (kind: PKind, from: string) => `${kind}:${from}`;

export function BossReport() {
  useTable('orders'); useTable('cashMoves'); useTable('stockMoves'); useTable('variants'); useTable('boostReadings'); useTable('categories');
  const company = useCompany();
  const route = useRoute();
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  const [kind, setKind] = useState<PKind>((q.get('p') as PKind) || 'day');
  const [anchor, setAnchor] = useState(q.get('a') || today());
  const [custom, setCustom] = useState({ from: today(), to: today() });
  const per = periodOf(kind, anchor, custom);
  const prevNav = shiftAnchor(kind, anchor, -1, custom);
  const prevPer = periodOf(kind, prevNav.anchor, prevNav.custom ?? custom);
  const r = useMemo(() => bossReport(per.from, per.to), [per.from, per.to]);
  const p = useMemo(() => bossReport(prevPer.from, prevPer.to), [prevPer.from, prevPer.to]);
  const sent = useMeta<Record<string, string>>('reportSent', {});
  const key = reportKey(kind, per.from);
  const markSent = () => setMeta('reportSent', { ...sent, [key]: new Date().toISOString() });
  const go = (dir: -1 | 1) => { const n = shiftAnchor(kind, anchor, dir, custom); setAnchor(n.anchor); if (n.custom) setCustom(n.custom); };
  const isDay = kind === 'day';
  const text = reportText(kind, per.label, r, company.name);
  const phone = normPhone(company.bossPhone || '');
  const intl = phone ? '261' + phone.replace(/^0/, '') : '';

  const goal = kind === 'day' ? company.targetDay : kind === 'month' ? company.targetMonth : undefined;
  const tiles: { label: string; cur: number; prev: number; invert?: boolean; strong?: boolean; hint?: string }[] = [
    { label: "Chiffre d'affaires", cur: r.revenue, prev: p.revenue, hint: `${r.orders} vente(s) · ${r.pieces} pièce(s)${goal ? ` · objectif ${fmtAr(goal)} (${Math.round((r.revenue / goal) * 100)} %)` : ''}` },
    { label: 'Dépenses', cur: r.expenses, prev: p.expenses, invert: true },
    { label: 'Reste (CA − dépenses)', cur: r.rest, prev: p.rest },
    ...(isDay ? [] : [{ label: 'Boost Facebook', cur: r.boost, prev: p.boost, invert: true, hint: r.boostUsd ? `${r.boostUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $` : undefined }]),
    { label: isDay ? 'Bénéfice net (sans boost)' : 'Bénéfice net', cur: isDay ? r.netNoBoost : r.net, prev: isDay ? p.netNoBoost : p.net, strong: true, hint: isDay ? `CA − coût des articles (${fmtAr(r.cost)}) − dépenses` : `CA − coût des articles (${fmtAr(r.cost)}) − dépenses − boost` },
  ];
  const m = r.money, pm = p.money;
  const dd = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const cashBoss = [{ id: 'total', label: 'Total à verser patron', cur: m.cash.total }, { id: 'net', label: 'Total à verser − dépenses espèces', cur: m.cash.toPay }];
  const toBoss: { id: string; label: string; cur: number; prev: number; hint: string; strong?: boolean; invert?: boolean }[] = [
    { id: 'mvola', label: 'MVola', cur: m.mvola.toPay, prev: pm.mvola.toPay, hint: `Total MVola ${fmtAr(m.mvola.sales)} − dépenses MVola ${fmtAr(m.mvola.expenses)}` },
    { id: 'orange', label: 'Orange Money', cur: m.orange.toPay, prev: pm.orange.toPay, hint: `Total Orange Money ${fmtAr(m.orange.sales)} − dépenses Orange Money ${fmtAr(m.orange.expenses)}` },
    { id: 'unpaid', label: 'Reste impayé (1 semaine)', cur: m.week.amount, prev: pm.week.amount, invert: true, hint: `${m.week.n} vente(s) du ${dd(m.week.from)} au ${dd(m.week.to)} pas encore payée(s) · les ventes annulées ne comptent pas` },
  ];
  const pageCols: Col<PageRow>[] = [
    { key: 'n', label: 'Page', value: (x) => x.name, render: (x) => <strong>{x.name}</strong>, width: 22 },
    { key: 'r', label: 'CA', value: (x) => x.revenue, money: true, total: true, width: 14 },
    { key: 's', label: 'Part', value: (x) => x.share, render: (x) => pctTxt(x.share), num: true, width: 8 },
    { key: 'q', label: 'Pièces', value: (x) => x.qty, num: true, total: true, width: 8 },
    { key: 'c', label: 'Coût articles', value: (x) => x.cost, money: true, total: true, width: 14 },
    ...(isDay ? [] : [{ key: 'b', label: 'Boost', value: (x: PageRow) => x.boost, money: true, total: true, width: 12 } as Col<PageRow>,
      { key: 'roi', label: 'CA pour 1 $ de boost', value: (x: PageRow) => (x.boost ? x.revenue / (x.boost / usdRate()) : 0), render: (x: PageRow) => (x.boost ? fmtAr(x.revenue / (x.boost / usdRate())) : '—'), num: true, width: 14 } as Col<PageRow>]),
    { key: 'p', label: isDay ? 'Marge' : 'Bénéfice page', value: (x) => (isDay ? x.revenue - x.cost : x.profit), money: true, total: true, width: 14 },
  ];
  const stockCols: Col<StockRow>[] = [
    { key: 'n', label: 'Page', value: (x) => x.name, render: (x) => <strong>{x.name}</strong>, width: 22 },
    { key: 's', label: 'Début', value: (x) => x.start, money: true, total: true, width: 14 },
    { key: 'i', label: '+ Entrées', value: (x) => x.in, money: true, total: true, width: 14 },
    { key: 'e', label: 'Fin', value: (x) => x.end, money: true, total: true, width: 14 },
    { key: 'o', label: '= Sorti', value: (x) => x.out, money: true, total: true, width: 14 },
    { key: 'q', label: 'Pièces restantes', value: (x) => x.pieces, num: true, total: true, width: 10 },
  ];
  const maxPage = Math.max(1, ...r.pages.map((x) => x.revenue));

  function pdf() {
    const k = `<div class="kpis">${tiles.map((t) => `<div class="kpi${t.strong ? ' strong' : ''}"><span>${h(t.label)}</span><b>${arA4(t.cur)}</b></div>`).join('')}</div>`;
    const pages = r.pages.length ? a4Table({ title: "Chiffre d'affaires par page", head: ['Page', 'CA', 'Part', 'Pièces', 'Coût articles', ...(isDay ? [] : ['Boost']), isDay ? 'Marge' : 'Bénéfice'], num: [1, 2, 3, 4, 5, 6],
      rows: r.pages.map((x) => [h(x.name), arA4(x.revenue), pctTxt(x.share), x.qty, arA4(x.cost), ...(isDay ? [] : [arA4(x.boost)]), arA4(isDay ? x.revenue - x.cost : x.profit)]),
      foot: ['Total', arA4(r.revenue), '100 %', r.pieces, arA4(r.cost), ...(isDay ? [] : [arA4(r.boost)]), arA4(isDay ? r.revenue - r.cost : r.revenue - r.cost - r.boost)] }) : '<p class="muted">Aucune vente sur la période.</p>';
    const stock = isDay ? '' : a4Table({ title: 'Stock (au prix de revient)', head: ['', 'Montant'], num: [1], rows: [['Valeur du stock au début', arA4(r.stock.start)], ['+ Entrées (réceptions, ajustements)', arA4(r.stock.in)], ['− Valeur du stock à la fin', arA4(r.stock.end)], ['<b>= Valeur du stock sorti</b>', `<b>${arA4(r.stock.out)}</b>`], ['dont vendu (coût des ventes)', arA4(r.stock.sold)], ['dont autres sorties', arA4(r.stock.other)]] })
      + (r.stockPages.length ? a4Table({ title: 'Stock par page', head: ['Page', 'Début', '+ Entrées', 'Fin', '= Sorti', 'Pièces'], num: [1, 2, 3, 4, 5], rows: r.stockPages.map((x) => [h(x.name), arA4(x.start), arA4(x.in), arA4(x.end), arA4(x.out), x.pieces]), foot: ['Total', arA4(r.stock.start), arA4(r.stock.in), arA4(r.stock.end), arA4(r.stock.out), r.stockPages.reduce((t, x) => t + x.pieces, 0)] }) : '');
    const boss = `<h2>À verser au patron</h2><div class="kpis">${cashBoss.map((t) => `<div class="kpi strong"><span>${h(t.label)}</span><b>${arA4(t.cur)}</b></div>`).join('')}${toBoss.map((t) => `<div class="kpi${t.strong ? ' strong' : ''}"><span>${h(t.label)}<br><small>${h(t.hint)}</small></span><b>${arA4(t.cur)}</b></div>`).join('')}</div>`;
    printA4(`Rapport ${isDay ? 'du jour' : kind === 'week' ? 'de la semaine' : kind === 'month' ? 'du mois' : kind === 'year' ? "de l'année" : 'de la période'}`, per.label, `<h2>Résultat</h2>${k}${boss}${pages}${stock}`);
    markSent();
  }
  async function excel() {
    await exportTables(`rapport_${kind}_${per.from}.xlsx`, [
      { name: 'Résultat', cols: [{ key: 'l', label: 'Ligne', value: (x: [string, number]) => x[0], width: 34 }, { key: 'v', label: 'Montant', value: (x: [string, number]) => x[1], money: true, width: 16 }], rows: [["Chiffre d'affaires", r.revenue], ['Dépenses', r.expenses], ['Reste', r.rest], ['Ventes espèces', m.cash.sales], ['Impayés', m.cash.unpaid], ['Total à verser patron', m.cash.total], ['Dépenses espèces', m.cash.expenses], ['Total à verser − dépenses espèces', m.cash.toPay], ['Total MVola', m.mvola.sales], ['Dépenses MVola', m.mvola.expenses], ['MVola à verser', m.mvola.toPay], ['Total Orange Money', m.orange.sales], ['Dépenses Orange Money', m.orange.expenses], ['Orange Money à verser', m.orange.toPay], ['Reste impayé (7 derniers jours)', m.week.amount], ['Coût des articles vendus', r.cost], ['Boost Facebook', r.boost], ['Bénéfice net sans boost', r.netNoBoost], ['Bénéfice net', r.net]] },
      { name: 'CA par page', cols: pageCols, rows: r.pages },
      { name: 'Stock par page', cols: stockCols, rows: r.stockPages },
    ]);
  }

  return (
    <div className="stack boss-report">
      <div className="card stack-s">
        <Choice label="Type de rapport" value={kind} onChange={(v) => { setKind(v as PKind); setAnchor(today()); }} max={5} options={(Object.keys(PKIND) as PKind[]).map((k) => ({ value: k, label: PKIND[k] }))} />
        {kind === 'custom' ? (
          <div className="row">
            <TextField label="Du" type="date" value={custom.from} onChange={(v) => setCustom({ ...custom, from: v })} />
            <TextField label="Au" type="date" value={custom.to} onChange={(v) => setCustom({ ...custom, to: v })} />
          </div>
        ) : (
          <div className="period-nav">
            <Button variant="ghost" icon="chevronLeft" onClick={() => go(-1)} aria-label="Période précédente" />
            <strong className="period-label">{per.label}</strong>
            <Button variant="ghost" icon="chevronRight" onClick={() => go(1)} aria-label="Période suivante" disabled={per.to >= today()} />
            {anchor !== today() && <Button variant="quiet" onClick={() => setAnchor(today())}>{kind === 'day' ? "Aujourd'hui" : 'En cours'}</Button>}
          </div>
        )}
      </div>

      <section className="stack-s">
        <h2 className="dash-title">Résultat</h2>
        <div className="stat-grid">
          {tiles.map((t) => (
            <div key={t.label} className={`card stat ${t.strong ? 'stat-strong' : ''}`}>
              <span className="small muted">{t.label}</span>
              <strong className={`stat-value num ${t.cur < 0 ? 'neg' : ''}`}>{fmtAr(t.cur)}</strong>
              <span className="small muted"><Delta cur={t.cur} prev={t.prev} invert={t.invert} /> vs {isDay ? 'la veille' : 'période précédente'}</span>
              {t.hint && <span className="small muted">{t.hint}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="stack-s">
        <h2 className="dash-title">À verser au patron</h2>
        <div className="stat-grid">
          <div className="boss-cash">
            {cashBoss.map((t) => (
              <div key={t.id} className="card stat stat-strong">
                <span className="small muted">{t.label}</span>
                <strong className={`stat-value num ${t.cur < 0 ? 'neg' : ''}`}>{fmtAr(t.cur)}</strong>
              </div>
            ))}
          </div>
          {toBoss.map((t) => (
            <div key={t.id} className={`card stat ${t.strong ? 'stat-strong' : ''}`}>
              <span className="small muted">{t.label}</span>
              <strong className={`stat-value num ${t.cur < 0 ? 'neg' : ''}`}>{fmtAr(t.cur)}</strong>
              <span className="small muted"><Delta cur={t.cur} prev={t.prev} invert={t.invert} /> vs {isDay ? 'la veille' : 'période précédente'}</span>
              <span className="small muted">{t.hint}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack-s">
        <h2>Chiffre d’affaires par page</h2>
        {r.pages.length === 0 ? <p className="small muted">Aucune vente sur la période.</p> : <>
          <div className="bars">{r.pages.map((x) => (
            <div key={x.id} className="bar-row"><span className="bar-label">{x.name}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, (x.revenue / maxPage) * 100)}%` }} /></span><strong className="num">{fmtAr(x.revenue)}</strong></div>
          ))}</div>
          <SortTable rowKey={(x) => x.id} rows={r.pages} cols={pageCols} initialSort={{ key: 'r', desc: true }} />
        </>}
      </section>

      {!isDay && <section className="card stack-s">
        <h2>Stock (au prix de revient)</h2>
        <div className="money-lines stock-flow">
          <div><span>Valeur du stock au début ({new Date(`${r.from}T12:00:00`).toLocaleDateString('fr-FR')})</span><strong className="num">{fmtAr(r.stock.start)}</strong></div>
          <div><span>+ Entrées (réceptions, ajustements)</span><strong className="num">{fmtAr(r.stock.in)}</strong></div>
          <div><span>− Valeur du stock à la fin</span><strong className="num">{fmtAr(r.stock.end)}</strong></div>
          <div className="ml-strong"><span>= Valeur du stock sorti</span><strong className="num">{fmtAr(r.stock.out)}</strong></div>
          <div><span className="small">dont vendu (coût des ventes)</span><span className="num small">{fmtAr(r.stock.sold)}</span></div>
          {Math.round(r.stock.other) !== 0 && <div><span className="small">dont autres sorties (pertes, ajustements)</span><span className="num small">{fmtAr(r.stock.other)}</span></div>}
        </div>
        <h3>Stock par page</h3>
        <SortTable rowKey={(x) => x.id} rows={r.stockPages} cols={stockCols} initialSort={{ key: 'e', desc: true }} empty="Aucun stock." />
      </section>}

      <section className="card stack-s">
        <div className="row-between"><h2>Envoyer au patron</h2>{sent[key] && <span className="small ok-text"><Icon name="check" size={14} /> Envoyé le {new Date(sent[key]).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>}</div>
        <pre className="recap-text">{text}</pre>
        <div className="row">
          <a className="btn btn-primary btn-wa" href={`https://wa.me/${intl}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={markSent}><Icon name="share" />WhatsApp{company.bossPhone ? ` (${fmtPhone(company.bossPhone)})` : ''}</a>
          <Button variant="ghost" icon="printer" onClick={pdf}>PDF A4 / Imprimer</Button>
          <Button variant="ghost" icon="download" onClick={() => excel().catch((e) => toast(e.message, 'error'))}>Excel</Button>
        </div>
        {!company.bossPhone && <p className="small muted">Enregistrez le WhatsApp du patron dans Paramètres → Société pour l’envoyer en un clic.</p>}
      </section>
    </div>
  );
}

/** Rapports à envoyer (pour les rappels) : du jour le soir, de la semaine le lundi, du mois le 1er, de l'année le 1er janvier. */
export function reportsDue(now = new Date()): { kind: PKind; anchor: string; label: string; key: string }[] {
  const t = today();
  const out: { kind: PKind; anchor: string; label: string; key: string }[] = [];
  const add = (kind: PKind, anchor: string) => { const p = periodOf(kind, anchor); out.push({ kind, anchor, label: p.label, key: reportKey(kind, p.from) }); };
  const d = new Date(`${t}T12:00:00`);
  if (now.getHours() >= 18) add('day', t);
  if (d.getDay() === 1) { const last = new Date(d); last.setDate(d.getDate() - 7); add('week', last.toISOString().slice(0, 10)); }
  if (d.getDate() === 1) { const last = new Date(d); last.setDate(0); add('month', last.toISOString().slice(0, 10)); }
  if (d.getDate() === 1 && d.getMonth() === 0) add('year', `${d.getFullYear() - 1}-06-01`);
  return out;
}
export type { Report };
