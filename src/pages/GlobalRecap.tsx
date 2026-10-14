// Récap global : vision de l'activité par jour, semaine, mois ou année (inspiré du cahier « Recette et Dépense »),
// avec sous-totaux, passage au détail en touchant une ligne, filtre de période (ou « Tout »), Excel et PDF A4.
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { useTable } from '../lib/db';
import { fmtAr, fmtNum, todayYmd } from '../lib/catalog';
import { previousPeriod } from '../lib/analytics';
import { GRAN_LABEL, finer, firstActivity, globalRecap, type Gran, type RecapRow } from '../lib/globalRecap';
import { printA4, a4Table, arA4, h } from '../lib/a4';
import { Button, Choice, Help } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PeriodPicker, defaultPeriod, type Period } from '../ui/period';
import { exportTables, type Col } from '../ui/table';
import { Delta } from './Reports';

const fmtD = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DEFAULT_PERIOD: Record<Gran, Period['key']> = { day: 'month', week: 'month', month: 'year', year: 'all' };

export function GlobalRecap() {
  const w1 = useTable('orders'), w2 = useTable('cashMoves'), w3 = useTable('payouts'), w4 = useTable('boostReadings'), w5 = useTable('stockMoves'); useTable('categories'); useTable('variants');
  const can = useCan();
  const withCost = can('costs.view');
  const [gran, setGran] = useState<Gran>('day');
  const [period, setPeriod] = useState<Period>(defaultPeriod('month'));
  const [back, setBack] = useState<{ gran: Gran; period: Period }[]>([]);
  const [byPage, setByPage] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true);
  const today = todayYmd();
  const from = period.key === 'all' || !period.from ? firstActivity() : period.from;
  const to = period.to && period.to < today ? period.to : today;
  const rc = useMemo(() => globalRecap(from, to, gran), [from, to, gran, w1, w2, w3, w4, w5]);
  const prevR = useMemo(() => { const p = previousPeriod(from, to); return globalRecap(p.from, p.to, 'year').total; }, [from, to, w1, w2]);
  const t = rc.total;
  const best = [...rc.pages].sort((a, b) => (t.pages[b.id] ?? 0) - (t.pages[a.id] ?? 0))[0];
  const showGroupTotals = gran !== 'year';
  const active = (r: RecapRow) => !!(r.revenue || r.expenses || r.paid || r.boost || r.orders || r.qty);
  const groups = rc.groups.map((g) => ({ ...g, rows: hideEmpty ? g.rows.filter(active) : g.rows })).filter((g) => g.rows.length);
  const changeGran = (g: Gran) => { setGran(g); setBack([]); setPeriod(defaultPeriod(DEFAULT_PERIOD[g])); };
  const drill = (r: RecapRow) => { const f = finer(gran); if (!f) return; setBack([...back, { gran, period }]); setGran(f); setPeriod({ key: 'custom', from: r.from, to: r.to }); };
  const goBack = () => { const last = back[back.length - 1]; if (!last) return; setBack(back.slice(0, -1)); setGran(last.gran); setPeriod(last.period); };

  type C = { key: string; label: string; v: (r: RecapRow) => number; show: boolean; cls?: (r: RecapRow) => string };
  const money: C[] = [
    ...rc.pages.map((p) => ({ key: 'p_' + p.id, label: p.name, v: (r: RecapRow) => r.pages[p.id] ?? 0, show: byPage })),
    { key: 'rev', label: 'CA réalisé', v: (r) => r.revenue, show: true },
    { key: 'exp', label: 'Dépenses', v: (r) => r.expenses, show: true },
    { key: 'rest', label: 'Reste (CA − dépenses)', v: (r) => r.rest, show: true, cls: (r) => (r.rest < 0 ? 'neg' : '') },
    { key: 'paid', label: 'Versé au patron', v: (r) => r.paid, show: true },
    { key: 'boost', label: 'Boost', v: (r) => r.boost, show: true },
    { key: 'cost', label: 'Coût des articles', v: (r) => r.cost, show: withCost },
    { key: 'net', label: 'Bénéfice net', v: (r) => r.net, show: withCost, cls: (r) => (r.net < 0 ? 'neg' : 'pos') },
    { key: 'stock', label: 'Stock fin (valeur)', v: (r) => r.stock, show: withCost },
  ];
  const cols = money.filter((c) => c.show);
  const maxRev = Math.max(1, ...rc.rows.map((r) => r.revenue));
  const periodText = `${fmtD(from)} au ${fmtD(to)}`;

  const flat = groups.flatMap((g) => [...g.rows, ...(showGroupTotals && rc.groups.length > 0 ? [{ ...g.total, label: `Total ${g.label}` }] : [])]);
  type XRow = RecapRow & { kind?: 'qty' | 'boost' | 'profit' };
  const withExtra = (r: RecapRow): XRow[] => (r.label.startsWith('Total') || r.key === 'total') && byPage ? [r, { ...r, kind: 'qty', label: 'Produits vendus (pièces)' }, { ...r, kind: 'boost', label: 'Boost' }, ...(withCost ? [{ ...r, kind: 'profit' as const, label: 'Bénéfice (CA − articles − boost)' }] : [])] : [r];
  const xv = (c: C, r: XRow) => r.kind === 'qty' ? (c.key.startsWith('p_') ? r.pageQty[c.key.slice(2)] ?? 0 : c.key === 'rev' ? r.qty : '')
    : r.kind === 'boost' ? (c.key.startsWith('p_') ? r.pageBoost[c.key.slice(2)] ?? 0 : c.key === 'boost' ? r.boost : '')
    : r.kind === 'profit' ? (c.key.startsWith('p_') ? pageProfit(r, c.key.slice(2)) : c.key === 'rev' ? r.revenue - r.cost - r.boost : '') : c.v(r);
  const xlsCols: Col<XRow>[] = [{ key: 'l', label: GRAN_LABEL[gran], value: (r) => r.label, width: 30 }, { key: 'o', label: 'Commandes', value: (r) => (r.kind ? '' : r.orders), width: 11 }, { key: 'q', label: 'Produits vendus', value: (r) => (r.kind ? '' : r.qty), width: 11 }, ...cols.map((c) => ({ key: c.key, label: c.label, value: (r: XRow) => { const v = xv(c, r); return typeof v === 'number' ? Math.round(v) : v; }, money: true, width: 15 }))];
  const exportXls = () => exportTables(`recap-${gran}_${from}_${to}.xlsx`, [{ name: `Récap ${GRAN_LABEL[gran].toLowerCase()}`, cols: xlsCols, rows: [...flat.flatMap(withExtra), ...withExtra({ ...t, label: 'TOTAL GÉNÉRAL' })], notes: [`Récap global par ${GRAN_LABEL[gran].toLowerCase()} — du ${periodText}`] }]);
  const exportPdf = () => printA4(`Récap global par ${GRAN_LABEL[gran].toLowerCase()}`, `Du ${periodText}`, `
    <div class="kpis"><div class="kpi"><span>CA réalisé</span><b>${arA4(t.revenue)}</b></div><div class="kpi"><span>Dépenses</span><b>${arA4(t.expenses)}</b></div><div class="kpi"><span>Reste</span><b>${arA4(t.rest)}</b></div>${withCost ? `<div class="kpi strong"><span>Bénéfice net</span><b>${arA4(t.net)}</b></div>` : `<div class="kpi"><span>Versé au patron</span><b>${arA4(t.paid)}</b></div>`}</div>
    ${a4Table({ head: [GRAN_LABEL[gran], 'Produits vendus', 'CA réalisé', 'Dépenses', 'Reste', 'Versé', 'Boost', ...(withCost ? ['Bénéfice net'] : [])], num: [1, 2, 3, 4, 5, 6, 7], rows: flat.map((r) => [r.label.startsWith('Total') ? `<b>${h(r.label)}</b>` : h(r.label), String(r.qty), arA4(r.revenue), arA4(r.expenses), arA4(r.rest), arA4(r.paid), arA4(r.boost), ...(withCost ? [arA4(r.net)] : [])]), foot: ['Total', String(t.qty), arA4(t.revenue), arA4(t.expenses), arA4(t.rest), arA4(t.paid), arA4(t.boost), ...(withCost ? [arA4(t.net)] : [])] })}
    ${rc.pages.length ? a4Table({ title: 'Par page : produits vendus, CA, boost et bénéfice', head: ['Page', 'Produits vendus', 'CA', 'Part', 'Boost', ...(withCost ? ['Bénéfice'] : [])], num: withCost ? [1, 2, 3, 4, 5] : [1, 2, 3, 4], rows: [...rc.pages].filter((p) => t.pages[p.id] || t.pageBoost[p.id] || t.pageQty[p.id]).sort((a, b) => (t.pages[b.id] ?? 0) - (t.pages[a.id] ?? 0)).map((p) => [h(p.name), String(t.pageQty[p.id] ?? 0), arA4(t.pages[p.id] ?? 0), t.revenue ? `${Math.round(((t.pages[p.id] ?? 0) / t.revenue) * 100)} %` : '—', arA4(t.pageBoost[p.id] ?? 0), ...(withCost ? [arA4(pageProfit(t, p.id))] : [])]) }) : ''}`);

  const cell = (c: C, r: RecapRow) => { const v = c.v(r); return <td key={c.key} className={`t-num ${c.cls?.(r) ?? ''}`}>{v ? fmtAr(v) : <span className="muted">—</span>}</td>; };
  // Sous chaque total (comme le cahier) : BOOST par page, puis BÉNÉFICE par page = CA de la page − coût des articles − boost.
  const pageProfit = (r: RecapRow, id: string) => (r.pages[id] ?? 0) - (r.pageCost[id] ?? 0) - (r.pageBoost[id] ?? 0);
  const showPageRows = byPage && rc.pages.length > 0;
  const extraRows = (r: RecapRow, key: string, grand = false) => !showPageRows ? [] : [
    <tr key={'q' + key} className={`rc-qty ${grand ? 'rc-grand' : ''}`}><td className="rc-label">Produits vendus<div className="small muted">pièces, retours déduits</div></td>{cols.map((c) => {
      if (c.key.startsWith('p_')) { const v = r.pageQty[c.key.slice(2)] ?? 0; return <td key={c.key} className="t-num">{v ? `${fmtNum(v)} produit${Math.abs(v) > 1 ? 's' : ''}` : <span className="muted">—</span>}</td>; }
      return <td key={c.key} className="t-num">{c.key === 'rev' ? <strong>{fmtNum(r.qty)} produit{Math.abs(r.qty) > 1 ? 's' : ''}</strong> : ''}</td>;
    })}</tr>,
    <tr key={'b' + key} className={`rc-boost ${grand ? 'rc-grand' : ''}`}><td className="rc-label">Boost</td>{cols.map((c) => {
      if (c.key.startsWith('p_')) { const v = r.pageBoost[c.key.slice(2)] ?? 0; return <td key={c.key} className="t-num">{v ? fmtAr(v) : <span className="muted">—</span>}</td>; }
      return <td key={c.key} className="t-num">{c.key === 'boost' && r.boost ? fmtAr(r.boost) : ''}</td>;
    })}</tr>,
    ...(withCost ? [<tr key={'n' + key} className={`rc-profit ${grand ? 'rc-grand' : ''}`}><td className="rc-label">Bénéfice<div className="small muted">CA − articles − boost</div></td>{cols.map((c) => {
      if (c.key.startsWith('p_')) { const id = c.key.slice(2); const v = pageProfit(r, id); return <td key={c.key} className={`t-num ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}`}>{v ? fmtAr(v) : <span className="muted">—</span>}</td>; }
      if (c.key === 'rev') { const v = r.revenue - r.cost - r.boost; return <td key={c.key} className={`t-num ${v < 0 ? 'neg' : 'pos'}`}>{fmtAr(v)}</td>; }
      return <td key={c.key} className="t-num"></td>;
    })}</tr>] : []),
  ];
  return (
    <div className="stack">
      <div className="card stack-s recap-filters">
        <div className="recap-bar">
          <Choice label="Regrouper par" value={gran} onChange={(v) => changeGran(v as Gran)} options={(Object.keys(GRAN_LABEL) as Gran[]).map((g) => ({ value: g, label: GRAN_LABEL[g] }))} />
          <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setBack([]); }} />
        </div>
        <div className="row-between" style={{ gap: 8 }}>
          <span className="small muted">Du {periodText}{back.length ? <> · <button type="button" className="link-btn" style={{ padding: 0 }} onClick={goBack}>‹ Retour : {GRAN_LABEL[back[back.length - 1].gran]}</button></> : null}</span>
          <div className="row" style={{ gap: 6 }}>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Masquer les périodes vides</label>
            {rc.pages.length > 0 && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={byPage} onChange={(e) => setByPage(e.target.checked)} /> CA par page</label>}
            <Button variant="ghost" className="btn-sm" icon="download" onClick={exportXls}>Excel</Button>
            <Button variant="ghost" className="btn-sm" icon="printer" onClick={exportPdf}>PDF A4</Button>
          </div>
        </div>
      </div>

      <div className="recap-kpis">
        <div className="card stat"><span className="small muted">CA réalisé</span><strong className="stat-value num">{fmtAr(t.revenue)}</strong><span className="small muted"><Delta cur={t.revenue} prev={prevR.revenue} /> vs période précédente</span></div>
        <div className="card stat"><span className="small muted">Dépenses</span><strong className="stat-value num">{fmtAr(t.expenses)}</strong><span className="small muted"><Delta cur={t.expenses} prev={prevR.expenses} invert /></span></div>
        <div className="card stat"><span className="small muted">Reste (CA − dépenses)</span><strong className={`stat-value num ${t.rest < 0 ? 'neg' : ''}`}>{fmtAr(t.rest)}</strong><span className="small muted">versé au patron : {fmtAr(t.paid)}</span></div>
        {withCost ? <div className="card stat stat-strong"><span className="small muted">{t.net >= 0 ? 'Bénéfice net' : 'Perte nette'}</span><strong className="stat-value num">{fmtAr(t.net)}</strong><span className="small muted">après articles ({fmtAr(t.cost)}) et boost ({fmtAr(t.boost)})</span></div>
          : <div className="card stat"><span className="small muted">Boost</span><strong className="stat-value num">{fmtAr(t.boost)}</strong></div>}
        <div className="card stat"><span className="small muted">Produits vendus</span><strong className="stat-value num">{fmtNum(t.qty)}</strong><span className="small muted">{[...rc.pages].filter((p) => t.pageQty[p.id]).sort((a, b) => (t.pageQty[b.id] ?? 0) - (t.pageQty[a.id] ?? 0)).slice(0, 3).map((p) => `${p.name} : ${fmtNum(t.pageQty[p.id])}`).join(' · ') || '—'}</span></div>
        {best && t.pages[best.id] ? <div className="card stat"><span className="small muted">Meilleure page</span><strong className="stat-value">{best.name}</strong><span className="small muted">{fmtAr(t.pages[best.id])} · {t.revenue ? Math.round((t.pages[best.id] / t.revenue) * 100) : 0} % du CA</span></div> : null}
      </div>

      <div className="card card-flush">
        <div className="card-pad"><h2>Récap par {GRAN_LABEL[gran].toLowerCase()}</h2>
          <Help>Une ligne par {GRAN_LABEL[gran].toLowerCase()}{showGroupTotals ? `, avec un total par ${gran === 'day' ? 'semaine' : gran === 'week' ? 'mois' : 'année'}` : ''}. {finer(gran) ? `Touchez une ligne pour voir le détail par ${GRAN_LABEL[finer(gran)!].toLowerCase()}. ` : ''}Sous chaque total : la ligne Produits vendus (nombre de pièces vendues par page, retours déduits), la ligne Boost (dépense pub de chaque page, en ariary) et la ligne Bénéfice de chaque page (CA de la page − coût des articles − boost). Reste = CA − dépenses (ce qui doit rester en caisse) ; bénéfice net = CA − coût des articles vendus − dépenses − boost.</Help></div>
        {groups.length === 0 ? <p className="card-pad small muted">Aucune activité sur cette période.</p> : (
          <div className="table-wrap"><table className="table table-grid recap-table">
            <thead><tr><th className="rc-label">{GRAN_LABEL[gran]}</th>{cols.map((c) => <th key={c.key} className={`t-num ${c.key.startsWith('p_') ? 'rc-page' : ''}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {groups.map((g) => [
                ...g.rows.map((r) => (
                  <tr key={r.key} className={finer(gran) ? 'row-link' : ''} onClick={finer(gran) ? () => drill(r) : undefined}>
                    <td className="rc-label"><strong className="cap-first">{r.label}</strong>{r.orders || r.qty ? <div className="small muted">{r.orders} vente(s) · {fmtNum(r.qty)} produit(s)</div> : null}
                      <div className="bar-track mini"><span className="bar-fill" style={{ width: `${Math.max(r.revenue ? 2 : 0, (r.revenue / maxRev) * 100)}%` }} /></div></td>
                    {cols.map((c) => cell(c, r))}
                  </tr>
                )),
                ...(showGroupTotals ? [<tr key={'t' + g.key} className="t-total"><td className="rc-label">Total {g.label}</td>{cols.map((c) => cell(c, g.total))}</tr>, ...extraRows(g.total, g.key)] : []),
              ])}
            </tbody>
            <tfoot><tr className="t-total rc-grand"><td className="rc-label">Total général</td>{cols.map((c) => cell(c, t))}</tr>{(!showGroupTotals || groups.length > 1) && extraRows(t, 'all', true)}</tfoot>
          </table></div>
        )}
      </div>
      {gran === 'day' && rc.rows.length > 120 && <div className="notice"><Icon name="alert" /><span>Beaucoup de jours affichés : choisissez « Semaine » ou une période plus courte pour une lecture plus facile.</span></div>}
    </div>
  );
}
