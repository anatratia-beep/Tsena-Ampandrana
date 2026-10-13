// Stock : état par variante, valeur, mouvements filtrables, inventaire physique.
import { useMyScope } from '../lib/scope';
import { ScopeBar } from '../ui/scope';
import { useMemo, useState } from 'react';
import { audit, useCan, type User } from '../lib/auth';
import { get, useTable } from '../lib/db';
import {
  addMoves, categoryPath, fmtAr, fmtNum, incomingOf, MOVE_LABELS, parseNum, stockOf, useCatalog, variantLabel,
  type Category, type MoveType, type Product, type StockMove, type Variant, photoOf, matchQuery, productText, searchItems } from '../lib/catalog';
import { Button, FilterSelect, Confirm, Empty, PageHead, TextField, fmtDateTime, navigate, toast, useRoute, MoreMatches } from '../ui/kit';
import { PeriodPicker, defaultPeriod, inPeriod, type Period } from '../ui/period';
import { categoryOptions, Thumb } from './Products';
import { downloadBlob, writeXlsx } from '../lib/xlsx';
import { cancelMove } from '../lib/corrections';
import { InventoryTab, VariantDetail } from './Inventory';

const TABS = [
  { key: 'etat', label: 'État du stock', perm: '' },
  { key: 'mouvements', label: 'Mouvements', perm: '' },
  { key: 'inventaire', label: 'Inventaire', perm: 'stock.adjust' },
];

export function StockPage() {
  const can = useCan();
  const route = useRoute();
  const tabs = TABS.filter((t) => !t.perm || can(t.perm));
  const cur = tabs.find((t) => route.endsWith('/' + t.key)) ?? tabs[0];
  return (
    <>
      <PageHead title="Stock" />
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/stock/' + t.key)}>{t.label}</button>)}
      </div>
      {cur.key === 'etat' && <StockState />}
      {cur.key === 'mouvements' && <MovesTab />}
      {cur.key === 'inventaire' && <InventoryTab />}
    </>
  );
}

function inCategory(p: Product | undefined, cat: string) {
  if (!cat) return true;
  let c = p?.categoryId ? get<Category>('categories', p.categoryId) : undefined;
  while (c) { if (c.id === cat) return true; c = c.parentId ? get<Category>('categories', c.parentId) : undefined; }
  return false;
}

function StockState() {
  const can = useCan();
  const showCost = can('costs.view');
  const { variants, categories } = useCatalog();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [f, setF] = useState<'' | 'in' | 'out' | 'neg'>('in');
  const [sort, setSort] = useState<'code' | 'stock' | 'value'>('code');
  const [limit, setLimit] = useState(150);
  const scope = useMyScope();
  const [allMatches, setAllMatches] = useState(false);
  const [others, setOthers] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    const sr = searchItems(variants
      .map((v) => ({ v, p: get<Product>('products', v.productId), stock: stockOf(v.id), incoming: incomingOf(v.id) }))
      .filter((r) => r.p && r.p.active !== false && r.v.active !== false)
      .filter((r) => scope.product(r.p!.id))
      .filter((r) => inCategory(r.p, cat)), (r) => `${r.v.sku} ${productText(r.p!)}`, n, allMatches);
    queueMicrotask(() => setOthers(sr.others));
    return sr.list
      .filter((r) => f === 'in' ? r.stock > 0 : f === 'out' ? r.stock === 0 : f === 'neg' ? r.stock < 0 : true)
      .map((r) => ({ ...r, value: Math.max(0, r.stock) * (r.v.costAvg ?? 0) }))
      .sort((a, b) => sort === 'stock' ? b.stock - a.stock : sort === 'value' ? b.value - a.value : a.v.sku.localeCompare(b.v.sku, 'fr', { numeric: true }));
  }, [variants, q, cat, f, sort, scope.on, allMatches]);

  const allRows = variants.filter((v) => { const p = get<Product>('products', v.productId); return p && p.active !== false && scope.product(p.id) && inCategory(p, cat); });
  const totals = allRows.reduce((t, v) => {
    const s = stockOf(v.id);
    t.pcs += Math.max(0, s); t.value += Math.max(0, s) * (v.costAvg ?? 0);
    if (s < 0) t.neg++; if (s === 0) t.out++;
    return t;
  }, { pcs: 0, value: 0, neg: 0, out: 0 });

  async function exportXlsx() {
    const blob = await writeXlsx([{
      name: 'Stock',
      columns: [{ header: 'Catégorie', width: 22 }, { header: 'Code article', width: 14 }, { header: 'Article', width: 36 }, { header: 'Couleur', width: 14 }, { header: 'Taille', width: 9 }, { header: 'Code variante', width: 22 }, { header: 'Stock', width: 9, number: true }, { header: 'En arrivage', width: 11, number: true },
        ...(showCost ? [{ header: 'Coût moyen (Ar)', width: 14, number: true }, { header: 'Valeur (Ar)', width: 14, number: true }] : [])],
      rows: rows.map((r) => [categoryPath(r.p!.categoryId), r.p!.code, r.p!.name, r.v.color ?? '', r.v.size ?? '', r.v.sku, r.stock, r.incoming, ...(showCost ? [Math.round(r.v.costAvg ?? 0), Math.round(r.value)] : [])]),
    }]);
    downloadBlob(blob, `Tresor-en-ligne-stock-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <ScopeBar scope={scope} />
      <div className="stat-grid">
        <div className="card stat"><span className="muted small">Pièces en stock</span><span className="stat-value">{fmtNum(totals.pcs)}</span></div>
        {showCost && <div className="card stat"><span className="muted small">Valeur du stock (coût)</span><span className="stat-value">{fmtAr(totals.value)}</span></div>}
        <div className="card stat"><span className="muted small">Variantes en rupture</span><span className="stat-value">{fmtNum(totals.out)}</span></div>
        {totals.neg > 0 && <button className="card stat stat-warn" onClick={() => setF('neg')}><span className="muted small">Stocks négatifs à corriger</span><span className="stat-value">{totals.neg}</span></button>}
      </div>
      <div className="card stack">
        <div className="row">
          <div className="field" style={{ flex: '1 1 220px' }}><input aria-label="Rechercher" placeholder="Rechercher un code ou un article" value={q} onChange={(e) => { setQ(e.target.value); setAllMatches(false); }} /></div>
          <div className="field" style={{ flex: '0 1 220px' }}>
            <FilterSelect label="Catégorie" value={cat} onChange={setCat} options={categoryOptions(categories, 'Toutes les catégories')} />
          </div>
          <div className="field" style={{ flex: '0 1 180px' }}>
            <select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="code">Trier par code</option><option value="stock">Plus grand stock</option>{showCost && <option value="value">Plus grande valeur</option>}
            </select>
          </div>
        </div>
        <div className="row-between">
          <div className="segmented" role="group">
            {([['in', 'En stock'], ['out', 'En rupture'], ['neg', 'Négatifs'], ['', 'Tout']] as const).map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
          </div>
          <Button variant="ghost" icon="download" onClick={exportXlsx}>Exporter en Excel</Button>
        </div>
        <MoreMatches n={others} onShow={() => setAllMatches(true)} />
      </div>
      <div className="card card-flush">
        {rows.length === 0 ? <Empty icon="store" title="Aucune variante ne correspond" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Article</th><th>Variante</th><th className="t-num">Stock</th><th className="t-num">En arrivage</th>{showCost && <th className="t-num">Coût moyen</th>}{showCost && <th className="t-num">Valeur</th>}<th></th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map((r) => (
                  <tr key={r.v.id} className="row-link" onClick={() => navigate('/articles/' + r.p!.id)}>
                    <td><div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Thumb src={photoOf(r.v)} size={52} zoom alt={r.p!.name} /><div><strong>{r.p!.name}</strong><div className="small muted">{r.v.sku}</div></div></div></td>
                    <td>{variantLabel(r.v)}</td>
                    <td className="t-num"><span className={`stock-pill ${r.stock <= 0 ? 'is-out' : ''}`}>{fmtNum(r.stock)}</span></td>
                    <td className="t-num">{r.incoming || '—'}</td>
                    {showCost && <td className="t-num">{fmtAr(r.v.costAvg)}</td>}
                    {showCost && <td className="t-num">{fmtAr(r.value)}</td>}
                    <td><Button variant="quiet" className="btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(r.v.id); }}>Détail</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 300)}>Afficher plus ({rows.length - limit})</Button>}
      {detail && <VariantDetail variantId={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function MovesTab() {
  const can = useCan();
  const moves = useTable<StockMove>('stockMoves');
  const users = useTable<User>('users');
  useCatalog();
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const [type, setType] = useState('');
  const [dir, setDir] = useState<'' | 'in' | 'out'>('');
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return moves
      .filter((m) => inPeriod(m.at, period))
      .filter((m) => !type || m.type === type)
      .filter((m) => !dir || (dir === 'in' ? m.qty > 0 : m.qty < 0))
      .filter((m) => !userId || m.userId === userId)
      .filter((m) => { if (!n) return true; const v = get<Variant>('variants', m.variantId); const p = v && get<Product>('products', v.productId); return `${v?.sku} ${p?.name} ${m.reason}`.toLowerCase().includes(n); })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [moves, period, type, dir, userId, q]);
  const [undo, setUndo] = useState<StockMove | null>(null);
  const [undoWhy, setUndoWhy] = useState('');
  const cancelledIds = useMemo(() => new Set(moves.filter((m) => m.refType === 'cancel' && m.refId).map((m) => m.refId!)), [moves]);
  const tin = list.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0);
  const tout = list.filter((m) => m.qty < 0).reduce((s, m) => s - m.qty, 0);

  return (
    <>
      <div className="card stack">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="row">
          <div className="field" style={{ flex: '1 1 200px' }}><input aria-label="Rechercher" placeholder="Rechercher un article, un motif" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field" style={{ flex: '0 1 170px' }}>
            <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>{Object.entries(MOVE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 150px' }}>
            <select aria-label="Sens" value={dir} onChange={(e) => setDir(e.target.value as any)}><option value="">Entrées et sorties</option><option value="in">Entrées</option><option value="out">Sorties</option></select>
          </div>
          <div className="field" style={{ flex: '0 1 170px' }}>
            <select aria-label="Utilisateur" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Tous les utilisateurs</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
          </div>
        </div>
        <p className="small"><strong className="pos">+{fmtNum(tin)}</strong> entrées · <strong className="neg">−{fmtNum(tout)}</strong> sorties · {list.length} mouvement(s)</p>
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title="Aucun mouvement sur cette période" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Article</th><th>Type</th><th className="t-num">Qté</th>{can('costs.view') && <th className="t-num">Coût unit.</th>}<th>Détail</th><th>Par</th>{can('records.correct') && <th></th>}</tr></thead>
              <tbody>
                {list.slice(0, limit).map((m) => {
                  const v = get<Variant>('variants', m.variantId); const p = v && get<Product>('products', v.productId);
                  return (
                    <tr key={m.id}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.at)}</td>
                      <td><strong>{p?.name ?? '?'}</strong><div className="small muted">{v?.sku}</div></td>
                      <td>{MOVE_LABELS[m.type as MoveType]}</td>
                      <td className={`t-num num ${m.qty > 0 ? 'pos' : 'neg'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                      {can('costs.view') && <td className="t-num">{m.unitCost ? fmtAr(m.unitCost) : '—'}</td>}
                      <td className="small">{m.reason}</td>
                      <td className="small muted">{m.userName}</td>
                      {can('records.correct') && <td>{(!m.refType || m.refType === 'inventory' || m.refType === 'adjust') ? (cancelledIds.has(m.id) ? <span className="small muted">annulé</span> : <Button variant="quiet" className="btn-sm" onClick={() => setUndo(m)}>Annuler</Button>) : null}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 300)}>Afficher plus</Button>}
      {undo && <Confirm title="Annuler ce mouvement de stock" danger confirmLabel="Annuler le mouvement" onClose={() => { setUndo(null); setUndoWhy(''); }}
        message={<div className="stack-s"><p>Un mouvement inverse ({undo.qty > 0 ? '−' : '+'}{Math.abs(undo.qty)}) remet le stock comme avant. Les deux restent dans l’historique.</p><TextField label="Raison" value={undoWhy} onChange={setUndoWhy} required /></div>}
        onConfirm={async () => { if (!undoWhy.trim()) throw new Error('Indiquez la raison.'); await cancelMove(undo, undoWhy.trim()); toast('Mouvement annulé'); }} />}
    </>
  );
}
