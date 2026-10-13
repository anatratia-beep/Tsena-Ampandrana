// Stock → Inventaire : compter (photo, filtre par page, recherche exacte, brouillon gardé), importer un comptage Excel,
// valider ; historique des inventaires par page et période, export Excel réimportable, annulation ; détail des
// mouvements d'un article pour comprendre un écart entre stock réel et théorique.
import { useMemo, useRef, useState } from 'react';
import { useCan } from '../lib/auth';
import { get, useMeta, useTable } from '../lib/db';
import { fmtAr, fmtNum, parseNum, photoOf, productText, searchItems, stockOf, useCatalog, type Category, type Product, type Variant } from '../lib/catalog';
import { allPages } from '../lib/boosts';
import { rootOf, useMyScope } from '../lib/scope';
import { cancelInventory, countSheet, fullName, inventories, inventoryWorkbook, readCounts, saveDraft, validateInventory, variantHistory, type Inventory } from '../lib/inventory';
import { downloadBlob, readXlsx } from '../lib/xlsx';
import { Badge, Button, Confirm, Empty, FilterSelect, Help, Modal, MoreMatches, TextField, fmtDateTime, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PeriodPicker, defaultPeriod, inPeriod, type Period } from '../ui/period';
import { Thumb } from './Products';
import { printA4, a4Table, arA4, h } from '../lib/a4';
import { exportTables } from '../ui/table';

const pageName = (id: string) => (id ? get<Category>('categories', id)?.name ?? 'Page supprimée' : 'Sans page');

export function InventoryTab() {
  const [view, setView] = useState<'count' | 'history'>('count');
  const invs = useTable<Inventory>('inventories');
  return (
    <>
      <div className="segmented" role="group" aria-label="Inventaire">
        <button type="button" aria-pressed={view === 'count'} onClick={() => setView('count')}>Compter</button>
        <button type="button" aria-pressed={view === 'history'} onClick={() => setView('history')}>Historique des inventaires ({invs.length})</button>
      </div>
      {view === 'count' ? <Count onDone={() => setView('history')} /> : <History />}
    </>
  );
}

// ---------------------------------------------------------------- Comptage
function Count({ onDone }: { onDone: () => void }) {
  const can = useCan();
  const showCost = can('costs.view');
  const { variants } = useCatalog();
  const scope = useMyScope();
  const draft = useMeta<Record<string, string>>('inventoryDraft', {}) ?? {};
  const [page, setPage] = useState('');
  const [q, setQ] = useState('');
  const [allMatches, setAllMatches] = useState(false);
  const [show, setShow] = useState<'all' | 'counted' | 'gaps' | 'todo'>('all');
  const [limit, setLimit] = useState(150);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [imported, setImported] = useState<{ n: number; unknown: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const pages = allPages().filter((p) => !scope.on || scope.pages.includes(p.id));

  const base = useMemo(() => variants
    .map((v) => ({ v, p: get<Product>('products', v.productId) }))
    .filter((r) => r.p && r.p.active !== false && r.p.kind !== 'lot' && r.v.active !== false && scope.product(r.p.id) && (!page || rootOf(r.p.categoryId) === page)), [variants, page, scope.on]);
  const searched = searchItems(base, (r) => `${r.v.sku} ${productText(r.p!)}`, q, allMatches);
  const counted = (id: string) => parseNum(draft[id] ?? '');
  const rows = searched.list
    .map((r) => { const c = counted(r.v.id); const theo = stockOf(r.v.id); return { ...r, theo, c, delta: c == null ? undefined : c - theo }; })
    .filter((r) => show === 'all' || (show === 'counted' ? r.c != null : show === 'gaps' ? r.delta != null && r.delta !== 0 : r.c == null))
    .sort((a, b) => a.v.sku.localeCompare(b.v.sku, 'fr', { numeric: true }));
  const all = Object.keys(draft).map((id) => ({ id, c: counted(id), v: get<Variant>('variants', id) })).filter((x) => x.c != null && x.v) as { id: string; c: number; v: Variant }[];
  const gaps = all.map((x) => ({ ...x, d: x.c - stockOf(x.id) })).filter((x) => x.d !== 0);
  const valueGap = gaps.reduce((s, x) => s + x.d * (x.v.costAvg ?? 0), 0);
  const set = (id: string, val: string) => { const d = { ...draft }; if (val.trim() === '') delete d[id]; else d[id] = val; void saveDraft(d); };

  async function importFile(f: File) {
    try {
      const r = readCounts(await readXlsx(await f.arrayBuffer()));
      const d = { ...draft }; for (const c of r.counts) d[c.variantId] = String(c.counted);
      await saveDraft(d); setImported({ n: r.counts.length, unknown: r.unknown }); setShow('counted');
      toast(`${r.counts.length} ligne(s) comptée(s) importée(s) : vérifiez puis validez`);
    } catch (e: any) { toast(e.message, 'error'); }
  }

  return (
    <>
      <div className="card stack">
        <Help>Comptez les articles et saisissez la quantité trouvée (ou importez une feuille de comptage Excel). Le comptage en cours est gardé sur cet appareil même si vous quittez l’écran. À la validation, une fiche d’inventaire est enregistrée (qui, quand, chaque ligne) et les écarts corrigent le stock. Touchez « Détail » pour voir d’où vient un écart (ventes, retours, réceptions…).</Help>
        <div className="row">
          <div className="field" style={{ flex: '0 1 220px' }}><FilterSelect label="Page" value={page} onChange={setPage} options={[{ value: '', label: 'Toutes les pages' }, ...pages.map((p) => ({ value: p.id, label: p.name }))]} /></div>
          <div className="field" style={{ flex: '1 1 200px' }}><input aria-label="Rechercher" placeholder="Rechercher un code ou un article" value={q} onChange={(e) => { setQ(e.target.value); setAllMatches(false); }} /></div>
        </div>
        <MoreMatches n={searched.others} onShow={() => setAllMatches(true)} />
        <div className="row-between">
          <div className="segmented" role="group" aria-label="Afficher">
            {([['all', 'Tout'], ['todo', 'Pas encore compté'], ['counted', 'Compté'], ['gaps', 'Écarts']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" className="btn-sm" icon="download" onClick={async () => downloadBlob(await countSheet(base.map((r) => r.v.id).sort((a, b) => (get<Variant>('variants', a)?.sku ?? '').localeCompare(get<Variant>('variants', b)?.sku ?? '', 'fr', { numeric: true })), false), `feuille-comptage${page ? '-' + pageName(page) : ''}.xlsx`)}>Feuille de comptage (Excel)</Button>
            <Button variant="ghost" className="btn-sm" icon="upload" onClick={() => file.current?.click()}>Importer le comptage (Excel)</Button>
            <input ref={file} type="file" accept=".xlsx" hidden aria-label="Fichier de comptage" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          </div>
        </div>
        {imported && imported.unknown.length > 0 && <div className="notice"><Icon name="alert" /><span>{imported.unknown.length} code(s) du fichier introuvable(s) : {imported.unknown.slice(0, 8).join(', ')}{imported.unknown.length > 8 ? '…' : ''}</span></div>}
        <div className="row-between">
          <p className="small"><strong>{all.length}</strong> ligne(s) comptée(s) · <strong>{gaps.length}</strong> écart(s) · {gaps.reduce((s, x) => s + x.d, 0) > 0 ? '+' : ''}{gaps.reduce((s, x) => s + x.d, 0)} pièce(s){showCost && gaps.length ? ` · valeur ${fmtAr(valueGap)}` : ''}</p>
          <div className="row" style={{ gap: 6 }}>
            {all.length > 0 && <Button variant="quiet" onClick={() => { if (window.confirm('Effacer tout le comptage en cours ?')) void saveDraft({}); }}>Vider le comptage</Button>}
            <Button disabled={!all.length} onClick={() => setConfirm(true)}>Valider l’inventaire</Button>
          </div>
        </div>
      </div>
      <div className="card card-flush">
        {rows.length === 0 ? <Empty icon="package" title="Aucun article" /> : (
          <div className="table-wrap" style={{ maxHeight: '70vh' }}>
            <table className="table inv-table">
              <thead><tr><th>Photo</th><th>Article</th><th className="t-num">Théorique</th><th>Compté</th><th className="t-num">Écart</th><th></th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map(({ v, p, theo, delta }) => (
                  <tr key={v.id} className={delta ? 'has-gap' : ''}>
                    <td><Thumb src={photoOf(v)} size={56} zoom alt={p!.name} /></td>
                    <td><strong>{fullName(v)}</strong><div className="small muted">{v.sku} · {pageName(rootOf(p!.categoryId))}</div></td>
                    <td className="t-num num">{theo}</td>
                    <td><input className="cell-input" inputMode="numeric" aria-label={`Compté ${v.sku}`} value={draft[v.id] ?? ''} onChange={(e) => set(v.id, e.target.value)} /></td>
                    <td className={`t-num num ${delta && delta > 0 ? 'pos' : delta && delta < 0 ? 'neg' : ''}`}>{delta == null ? '' : (delta > 0 ? '+' : '') + delta}</td>
                    <td><Button variant="quiet" className="btn-sm" onClick={() => setDetail(v.id)}>Détail</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 300)}>Afficher plus ({rows.length - limit})</Button>}
      {detail && <VariantDetail variantId={detail} onClose={() => setDetail(null)} />}
      {confirm && <Confirm title="Valider l’inventaire" confirmLabel="Valider" onClose={() => setConfirm(false)}
        message={<div className="stack-s"><p>{all.length} ligne(s) comptée(s), dont <strong>{gaps.length} écart(s)</strong> qui vont corriger le stock{showCost ? ` (valeur ${fmtAr(valueGap)})` : ''}. Une fiche d’inventaire est enregistrée dans l’historique.</p>
          <TextField label="Note (facultatif)" value={note} onChange={setNote} placeholder="ex. inventaire mensuel page Lampe" /></div>}
        onConfirm={async () => {
          const inv = await validateInventory(all.map((x) => ({ variantId: x.id, counted: x.c })), { pageIds: page ? [page] : [], note: note.trim(), source: imported ? 'excel' : 'screen' });
          await saveDraft({}); setImported(null); setNote('');
          toast(`Inventaire ${inv.number} enregistré`); onDone();
        }} />}
    </>
  );
}

// ---------------------------------------------------------------- Historique
function History() {
  const can = useCan();
  const showCost = can('costs.view');
  useTable('inventories'); useTable('stockMoves');
  const [page, setPage] = useState('');
  const [period, setPeriod] = useState<Period>(defaultPeriod('month'));
  const [open, setOpen] = useState<Inventory | null>(null);
  const list = inventories().filter((i) => inPeriod(i.at, period) && (!page || i.pageIds.includes(page) || i.lines.some((l) => l.pageId === page)));
  const linesOf = (i: Inventory) => (page ? i.lines.filter((l) => l.pageId === page) : i.lines);
  const pagesOf = (i: Inventory) => (i.pageIds.length ? i.pageIds.map(pageName).join(', ') : [...new Set(i.lines.map((l) => pageName(l.pageId)))].join(', '));
  const sum = (i: Inventory) => { const g = linesOf(i).filter((l) => l.delta); return { n: linesOf(i).length, g: g.length, pcs: g.reduce((s, l) => s + l.delta, 0), val: g.reduce((s, l) => s + l.delta * l.unitCost, 0) }; };
  const title = `Historique des inventaires${page ? ` — ${pageName(page)}` : ''}`;
  const exportXls = () => exportTables(`historique-inventaires.xlsx`, [
    { name: 'Inventaires', cols: [
      { key: 'n', label: 'N°', value: (i: Inventory) => i.number, width: 12 }, { key: 'd', label: 'Date et heure', value: (i: Inventory) => new Date(i.at).toLocaleString('fr-FR'), width: 20 },
      { key: 'b', label: 'Par', value: (i: Inventory) => i.byName ?? '', width: 18 }, { key: 'p', label: 'Pages', value: pagesOf, width: 30 },
      { key: 'l', label: 'Lignes comptées', value: (i: Inventory) => sum(i).n, width: 12 }, { key: 'g', label: 'Écarts', value: (i: Inventory) => sum(i).g, width: 9 },
      { key: 'pc', label: 'Pièces', value: (i: Inventory) => sum(i).pcs, width: 9 }, ...(showCost ? [{ key: 'v', label: 'Valeur (Ar)', value: (i: Inventory) => Math.round(sum(i).val), money: true, width: 14 }] : []),
      { key: 's', label: 'État', value: (i: Inventory) => (i.status === 'cancelled' ? `Annulé (${i.cancelReason ?? ''})` : 'Validé'), width: 22 }, { key: 'no', label: 'Note', value: (i: Inventory) => i.note ?? '', width: 26 },
    ], rows: list, notes: [title] },
    { name: 'Détail des lignes', cols: [
      { key: 'n', label: 'Inventaire', value: (r: any) => r.inv, width: 12 }, { key: 'd', label: 'Date', value: (r: any) => r.date, width: 18 }, { key: 'pg', label: 'Page', value: (r: any) => pageName(r.pageId), width: 18 },
      { key: 'sku', label: 'Code variante', value: (r: any) => r.sku, width: 22 }, { key: 'a', label: 'Article', value: (r: any) => r.name, width: 30 },
      { key: 't', label: 'Théorique', value: (r: any) => r.theo, width: 10 }, { key: 'c', label: 'Stock', value: (r: any) => r.counted, width: 9 }, { key: 'e', label: 'Écart', value: (r: any) => r.delta, width: 9 },
      ...(showCost ? [{ key: 'v', label: 'Valeur écart (Ar)', value: (r: any) => Math.round(r.delta * r.unitCost), money: true, width: 14 }] : []),
    ], rows: list.flatMap((i) => linesOf(i).map((l) => ({ ...l, inv: i.number, date: new Date(i.at).toLocaleString('fr-FR') }))) },
  ]);
  const exportPdf = () => printA4(title, `Du ${period.from ? new Date(`${period.from}T12:00:00`).toLocaleDateString('fr-FR') : 'début'} au ${period.to ? new Date(`${period.to}T12:00:00`).toLocaleDateString('fr-FR') : 'aujourd’hui'}`,
    a4Table({ head: ['N°', 'Date et heure', 'Par', 'Pages', 'Lignes', 'Écarts', 'Pièces', ...(showCost ? ['Valeur'] : []), 'État'], num: showCost ? [4, 5, 6, 7] : [4, 5, 6],
      rows: list.map((i) => { const x = sum(i); return [h(i.number), h(new Date(i.at).toLocaleString('fr-FR')), h(i.byName ?? ''), h(pagesOf(i)), String(x.n), String(x.g), String(x.pcs), ...(showCost ? [arA4(x.val)] : []), i.status === 'cancelled' ? 'Annulé' : 'Validé']; }) }));
  return (
    <>
      <div className="card stack">
        <div className="row-between">
          <div className="field" style={{ flex: '0 1 220px' }}><FilterSelect label="Page" value={page} onChange={setPage} options={[{ value: '', label: 'Toutes les pages' }, ...allPages().map((p) => ({ value: p.id, label: p.name }))]} /></div>
          <div className="row" style={{ gap: 6 }}>
            <Button variant="ghost" className="btn-sm" icon="download" disabled={!list.length} onClick={exportXls}>Excel</Button>
            <Button variant="ghost" className="btn-sm" icon="printer" disabled={!list.length} onClick={exportPdf}>PDF A4</Button>
          </div>
        </div>
        <p className="small muted">Pour refaire un comptage : ouvrez un inventaire → « Exporter (Excel) », puis dans « Compter » → « Importer le comptage (Excel) ».</p>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title="Aucun inventaire sur cette période" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Date et heure</th><th>Par</th><th>Pages</th><th className="t-num">Lignes</th><th className="t-num">Écarts</th><th className="t-num">Pièces</th>{showCost && <th className="t-num">Valeur</th>}<th>État</th></tr></thead>
            <tbody>{list.map((i) => {
              const ls = page ? i.lines.filter((l) => l.pageId === page) : i.lines; const g = ls.filter((l) => l.delta);
              return (
                <tr key={i.id} className="row-link" onClick={() => setOpen(i)}>
                  <td><strong>{i.number}</strong></td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(i.at)}</td><td>{i.byName}</td>
                  <td className="small">{i.pageIds.length ? i.pageIds.map(pageName).join(', ') : [...new Set(i.lines.map((l) => pageName(l.pageId)))].slice(0, 3).join(', ')}</td>
                  <td className="t-num">{ls.length}</td><td className="t-num">{g.length}</td>
                  <td className={`t-num ${g.reduce((s, l) => s + l.delta, 0) < 0 ? 'neg' : ''}`}>{g.reduce((s, l) => s + l.delta, 0)}</td>
                  {showCost && <td className="t-num">{fmtAr(g.reduce((s, l) => s + l.delta * l.unitCost, 0))}</td>}
                  <td>{i.status === 'cancelled' ? <Badge tone="danger">Annulé</Badge> : <Badge tone="ok">Validé</Badge>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {open && <InventoryDetail inv={get<Inventory>('inventories', open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  );
}

function InventoryDetail({ inv, onClose }: { inv: Inventory; onClose: () => void }) {
  const can = useCan();
  const showCost = can('costs.view');
  const [onlyGaps, setOnlyGaps] = useState(inv.gaps > 0);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState<{ id: string; until: string } | null>(null);
  const lines = onlyGaps ? inv.lines.filter((l) => l.delta) : inv.lines;
  return (
    <Modal title={`Inventaire ${inv.number}`} wide onClose={onClose} footer={<>
      {inv.status === 'done' && can('records.correct') && <Button variant="danger" icon="x" onClick={() => setCancel(true)}>Annuler cet inventaire</Button>}
      <Button variant="ghost" icon="printer" onClick={() => printA4(`Inventaire ${inv.number}`, `${new Date(inv.at).toLocaleString('fr-FR')} · par ${inv.byName ?? '?'}${inv.status === 'cancelled' ? ' · ANNULÉ' : ''}`,
        `<div class="kpis"><div class="kpi"><span>Lignes comptées</span><b>${inv.counted}</b></div><div class="kpi"><span>Écarts</span><b>${inv.gaps}</b></div><div class="kpi"><span>Pièces</span><b>${inv.pcsGap}</b></div>${showCost ? `<div class="kpi strong"><span>Valeur</span><b>${arA4(inv.valueGap)}</b></div>` : ''}</div>`
        + a4Table({ head: ['Article', 'Code', 'Page', 'Théorique', 'Compté', 'Écart', ...(showCost ? ['Valeur'] : [])], num: showCost ? [3, 4, 5, 6] : [3, 4, 5], rows: lines.map((l) => [h(l.name), h(l.sku), h(pageName(l.pageId)), String(l.theo), String(l.counted), l.delta ? (l.delta > 0 ? '+' : '') + l.delta : '—', ...(showCost ? [l.delta ? arA4(l.delta * l.unitCost) : '—'] : [])]) }))}>PDF A4</Button>
      <Button variant="ghost" icon="download" onClick={async () => downloadBlob(await inventoryWorkbook(inv), `${inv.number}.xlsx`)}>Exporter (Excel)</Button>
      <Button onClick={onClose}>Fermer</Button></>}>
      <div className="stack">
        <p>{fmtDateTime(inv.at)} · par <strong>{inv.byName}</strong> · {inv.counted} ligne(s) comptée(s) · {inv.gaps} écart(s) · {inv.pcsGap > 0 ? '+' : ''}{inv.pcsGap} pièce(s){showCost ? ` · ${fmtAr(inv.valueGap)}` : ''}{inv.source === 'excel' ? ' · importé d’Excel' : ''}</p>
        {inv.note && <p className="small">Note : {inv.note}</p>}
        {inv.status === 'cancelled' && <div className="notice notice-danger"><Icon name="alert" /><span>Annulé le {fmtDateTime(inv.cancelledAt)} par {inv.cancelledBy} : {inv.cancelReason}. Le stock est revenu à ce qu’il était avant.</span></div>}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Seulement les écarts</label>
        <div className="table-wrap"><table className="table inv-table">
          <thead><tr><th>Photo</th><th>Article</th><th className="t-num">Théorique</th><th className="t-num">Compté</th><th className="t-num">Écart</th>{showCost && <th className="t-num">Valeur</th>}<th></th></tr></thead>
          <tbody>{lines.map((l) => { const v = get<Variant>('variants', l.variantId); return (
            <tr key={l.variantId}>
              <td><Thumb src={photoOf(v)} size={48} zoom alt={l.name} /></td>
              <td><strong>{l.name}</strong><div className="small muted">{l.sku} · {pageName(l.pageId)}</div></td>
              <td className="t-num">{l.theo}</td><td className="t-num">{l.counted}</td>
              <td className={`t-num ${l.delta > 0 ? 'pos' : l.delta < 0 ? 'neg' : ''}`}>{l.delta ? (l.delta > 0 ? '+' : '') + l.delta : '—'}</td>
              {showCost && <td className="t-num">{l.delta ? fmtAr(l.delta * l.unitCost) : '—'}</td>}
              <td><Button variant="quiet" className="btn-sm" onClick={() => setDetail({ id: l.variantId, until: inv.at })}>Détail</Button></td>
            </tr>); })}</tbody>
        </table></div>
      </div>
      {detail && <VariantDetail variantId={detail.id} until={detail.until} onClose={() => setDetail(null)} />}
      {cancel && <Confirm title={`Annuler ${inv.number}`} danger confirmLabel="Annuler l’inventaire" onClose={() => setCancel(false)}
        message={<div className="stack-s"><p>Les corrections de stock de cet inventaire sont retirées exactement : le stock revient à ce qu’il était avant. La fiche reste dans l’historique, marquée « Annulé ».</p><TextField label="Raison" value={reason} onChange={setReason} required /></div>}
        onConfirm={async () => { if (!reason.trim()) throw new Error('Indiquez la raison.'); await cancelInventory(inv, reason.trim()); toast('Inventaire annulé : stock remis'); onClose(); }} />}
    </Modal>
  );
}

/** Tous les mouvements d'un article depuis son dernier comptage : pour comprendre un écart. */
export function VariantDetail({ variantId, until, onClose }: { variantId: string; until?: string; onClose: () => void }) {
  useTable('stockMoves'); useTable('orders');
  const v = get<Variant>('variants', variantId);
  if (!v) return null;
  const h = variantHistory(variantId, until);
  return (
    <Modal title={fullName(v)} wide onClose={onClose} footer={<Button onClick={onClose}>Fermer</Button>}>
      <div className="stack">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}><Thumb src={photoOf(v)} size={84} zoom alt={v.sku} /><div><strong>{v.sku}</strong><p className="small muted">Stock théorique {until ? `au ${fmtDateTime(until)}` : 'actuel'} : <strong>{h.stock}</strong></p></div></div>
        <div className="kv-row">
          <div><span className="small muted">Dernier comptage</span><strong>{h.prev ? `${fmtNum(h.prev.line.counted)} le ${fmtDateTime(h.prev.inv.at)}` : 'jamais compté'}</strong></div>
          <div><span className="small muted">Entrées (réceptions)</span><strong className="pos">+{fmtNum(h.inQ)}</strong></div>
          <div><span className="small muted">Ventes et sorties livraison</span><strong className="neg">−{fmtNum(h.sold)}</strong></div>
          <div><span className="small muted">Retours</span><strong className="pos">+{fmtNum(h.back)}</strong></div>
          <div><span className="small muted">Ajustements</span><strong>{h.adj > 0 ? '+' : ''}{fmtNum(h.adj)}</strong></div>
        </div>
        <p className="small muted">Mouvements {h.prev ? 'depuis le dernier comptage' : 'depuis le début'}, du plus récent au plus ancien. Comparez avec ce que vous avez vu en boutique : une vente oubliée, un retour pas enregistré ou une erreur de quantité explique souvent l’écart.</p>
        {h.rows.length === 0 ? <p className="small muted">Aucun mouvement.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date et heure</th><th>Type</th><th className="t-num">Qté</th><th className="t-num">Stock après</th><th>Vente / commande</th><th>Détail</th><th>Par</th></tr></thead>
            <tbody>{h.rows.map(({ m, after, label, order }) => (
              <tr key={m.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.at)}</td><td>{label}</td>
                <td className={`t-num ${m.qty > 0 ? 'pos' : 'neg'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="t-num">{after}</td>
                <td>{order ? <a href={`#/commandes/${order.id}`} onClick={onClose}>{order.number}</a> : '—'}{order?.status === 'cancelled' && <> <Badge tone="danger">annulée</Badge></>}</td>
                <td className="small">{m.reason}</td><td className="small muted">{m.userName}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </Modal>
  );
}
