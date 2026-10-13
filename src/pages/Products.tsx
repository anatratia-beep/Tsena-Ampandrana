// Articles : liste, fiche article, variantes (couleur/taille), catégories, ajustements de stock.
import { useMyScope } from '../lib/scope';
import { ScopeBar } from '../ui/scope';
import { useMemo, useRef, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, remove, save, useTable } from '../lib/db';
import {
  ADJUST_REASONS, addMoves, categoryPath, createProduct, fmtAr, fmtNum, incomingOf, makeSku, MOVE_LABELS, normSize, parseNum,
  productIncoming, productStock, productVariants, sizeRank, stockOf, useCatalog, variantLabel, matchQuery, productText, attrSummary, articleUsage, deleteArticle, repairArticle, variantUsed,
  type Category, type Product, type StockMove, type Variant, searchItems } from '../lib/catalog';
import { blobToThumb } from '../lib/xlsx';
import { photoBytes } from '../lib/images';
import { Badge, Button, Confirm, Empty, IconButton, Modal, PageHead, SelectField, TextField, fmtDateTime, navigate, toast, useRoute, MoreMatches, DateSort, type DateOrder } from '../ui/kit';
import { Icon } from '../ui/icons';
import { rootOf } from '../lib/scope';
import { findDuplicates, resolveDuplicates, usesOf, type DupGroup } from '../lib/duplicates';
import { ArticleBuilder, AttrBadges } from './Categories';
import { LOT_STATUS, LotDetail, LotForm, NewArticleChooser, TierEditor, lotPhoto, tierText } from './Lots';
import { isLot, lotAvailable, lotStatus, type PriceTier } from '../lib/lots';

/** Photo d'article. Avec `zoom`, un toucher l'affiche en grand. */
export function Thumb({ src, size = 56, alt = '', zoom }: { src?: string; size?: number; alt?: string; zoom?: boolean }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <span className={`thumb ${zoom && src ? 'thumb-zoom' : ''}`} style={{ width: size, height: size }}
        onClick={zoom && src ? (e) => { e.preventDefault(); e.stopPropagation(); setBig(true); } : undefined}
        role={zoom && src ? 'button' : undefined} aria-label={zoom && src ? `Agrandir la photo ${alt}` : undefined}>
        {src ? <img src={src} alt={alt} loading="lazy" /> : <Icon name="store" size={Math.round(size * 0.42)} />}
      </span>
      {big && src && (
        <div className="lightbox" onClick={(e) => { e.stopPropagation(); setBig(false); }} role="dialog" aria-label="Photo">
          <img src={src} alt={alt} />
          {alt && <span className="lightbox-cap">{alt}</span>}
        </div>
      )}
    </>
  );
}

export function categoryOptions(categories: Category[], empty = 'Sans catégorie') {
  const opts = [...categories].filter((c) => !c.removed && !(c.parentId && get<Category>('categories', rootOf(c.id))?.removed)).map((c) => ({ value: c.id, label: categoryPath(c.id) })).sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: '', label: empty }, ...opts];
}

type StockFilter = '' | 'in' | 'out' | 'low' | 'incoming';

export function ProductsPage() {
  const route = useRoute();
  const id = route.split('/')[2];
  if (id) return <ProductDetail id={id} />;
  return <ProductList />;
}

function ProductList() {
  const can = useCan();
  const { products, categories } = useCatalog();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(() => /[?&]cat=([^&]+)/.exec(location.hash)?.[1] ?? '');
  const [sf, setSf] = useState<StockFilter>('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [lotNew, setLotNew] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [simple, setSimple] = useState(false);
  const [limit, setLimit] = useState(60);
  const scope = useMyScope();
  const [allMatches, setAllMatches] = useState(false);
  const [others, setOthers] = useState(0);
  const [dups, setDups] = useState(false);
  const [order, setOrder] = useState<DateOrder>('');

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    const inCat = (p: Product) => {
      if (!cat) return true;
      let c = p.categoryId ? get<Category>('categories', p.categoryId) : undefined;
      while (c) { if (c.id === cat) return true; c = c.parentId ? get<Category>('categories', c.parentId) : undefined; }
      return false;
    };
    const sr = searchItems(products
      .filter((p) => showArchived || p.active !== false)
      .filter((p) => scope.product(p.id))
      .filter(inCat), productText, n, allMatches);
    queueMicrotask(() => setOthers(sr.others));
    return sr.list
      .map((p) => ({ p, stock: isLot(p) ? lotAvailable(p, stockOf) : productStock(p.id), incoming: isLot(p) ? 0 : productIncoming(p.id) }))
      .filter(({ p, stock, incoming }) => {
        if (sf === 'in') return stock > 0;
        if (sf === 'out') return stock <= 0;
        if (sf === 'low') return stock > 0 && stock <= (p.alertQty ?? 3);
        if (sf === 'incoming') return incoming > 0;
        return true;
      })
      .sort((a, b) => order === 'new' ? b.p.createdAt.localeCompare(a.p.createdAt) : order === 'old' ? a.p.createdAt.localeCompare(b.p.createdAt) : a.p.code.localeCompare(b.p.code, 'fr', { numeric: true }));
  }, [products, q, cat, sf, showArchived, scope.on, allMatches, order]);

  const dupCount = useMemo(() => findDuplicates().length, [products]);
  return (
    <>
      {dups && <DuplicatesModal onClose={() => setDups(false)} />}
      {dupCount > 0 && can('catalog.edit') && !dups && <div className="notice"><Icon name="alert" /><span style={{ flex: 1 }}><strong>{dupCount} groupe(s) d’articles en double possible(s)</strong> (même photo et même taille dans deux pages, ou même nom) : ils faussent le stock et les recherches.</span><Button variant="ghost" onClick={() => setDups(true)}>Vérifier</Button></div>}
      <PageHead title="Articles" subtitle={`${products.filter((p) => p.active !== false).length} articles`}
        actions={<>
          {can('catalog.edit') && <Button variant="ghost" icon="list" onClick={() => navigate('/pages')}>Pages et variantes</Button>}
          {can('catalog.edit') && <Button variant="ghost" icon="upload" onClick={() => navigate('/import')}>Importer</Button>}
          {can('catalog.edit') && dupCount > 0 && <Button variant="ghost" icon="alert" onClick={() => setDups(true)}>Articles en double ({dupCount})</Button>}
          {can('catalog.edit') && <Button icon="plus" onClick={() => setChoosing(true)}>Nouvel article</Button>}
        </>} />
      <ScopeBar scope={scope} />
      <div className="card stack">
        <div className="row">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <input aria-label="Rechercher" placeholder="Rechercher un code, un nom…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); setAllMatches(false); }} />
          </div>
          <div className="field" style={{ flex: '0 1 240px' }}>
            <select aria-label="Catégorie" value={cat} onChange={(e) => setCat(e.target.value)}>
              {categoryOptions(categories, 'Toutes les catégories').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <DateSort value={order} onChange={setOrder} />
        </div>
        <MoreMatches n={others} onShow={() => setAllMatches(true)} />
        <div className="row-between">
          <div className="segmented" role="group" aria-label="Filtrer par stock">
            {([['', 'Tous'], ['in', 'En stock'], ['low', 'Stock bas'], ['out', 'En rupture'], ['incoming', 'En arrivage']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={sf === k} onClick={() => setSf(k)}>{l}</button>
            ))}
          </div>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Afficher les archivés</label>
        </div>
      </div>

      <div className="card card-flush">
        {list.length === 0 ? (
          <Empty icon="store" title={products.length ? 'Aucun article ne correspond' : 'Aucun article pour l’instant'}>
            {!products.length && can('catalog.edit') && <div className="row" style={{ justifyContent: 'center' }}>
              <Button icon="upload" onClick={() => navigate('/import')}>Importer depuis Excel</Button>
              <Button variant="ghost" icon="plus" onClick={() => setCreating(true)}>Créer un article</Button>
            </div>}
          </Empty>
        ) : (
          <ul className="list">
            {list.slice(0, limit).map(({ p, stock, incoming }) => (
              <li key={p.id}>
                <a className="list-item list-link" href={`#/articles/${p.id}`}>
                  <Thumb src={isLot(p) ? lotPhoto(p) : p.photo} />
                  <div className="list-item-main">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="list-item-title">{p.name}</span>
                      {isLot(p) && <Badge tone="brand">Lot</Badge>}
                      {isLot(p) && lotStatus(p) !== 'open' && lotStatus(p) !== 'off' && <Badge tone={LOT_STATUS[lotStatus(p)].tone}>{LOT_STATUS[lotStatus(p)].label}</Badge>}
                      {p.active === false && <Badge>Archivé</Badge>}
                    </div>
                    <p className="small muted">{p.code} · {categoryPath(p.categoryId)}{isLot(p) ? ` · ${(p.lot?.items ?? []).reduce((t, x) => t + x.qty, 0)} article(s) dans le lot` : p.attrs ? (attrSummary(p) ? ` · ${attrSummary(p)}` : '') : ` · ${productVariants(p.id).length} variante(s)`}{tierText(p) ? ` · ${tierText(p)}` : ''}</p>
                  </div>
                  <div className="list-item-side">
                    <span className={`stock-pill ${stock <= 0 ? 'is-out' : stock <= (p.alertQty ?? 3) ? 'is-low' : ''}`}>{fmtNum(stock)}</span>
                    {incoming > 0 && <span className="small muted">+{fmtNum(incoming)} en route</span>}
                    {p.priceRetail ? <span className="small">{fmtAr(p.priceRetail)}</span> : null}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {list.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 100)}>Afficher plus ({list.length - limit})</Button>}
      {choosing && <NewArticleChooser onClose={() => setChoosing(false)} onArticle={() => { setChoosing(false); setCreating(true); }} onLot={() => { setChoosing(false); setLotNew(true); }} />}
      {lotNew && <LotForm onClose={() => setLotNew(false)} onSaved={(p) => navigate('/articles/' + p.id)} />}
      {creating && <ArticleBuilder cat={cat ? get<Category>('categories', cat) : undefined} onClose={() => setCreating(false)} />}
      {can('catalog.edit') && <p className="small muted">Article sans variantes (ancien mode) : <button type="button" className="link-btn" onClick={() => setSimple(true)}>créer un article simple</button></p>}
      {simple && <ProductForm onClose={() => setSimple(false)} onSaved={(p) => navigate('/articles/' + p.id)} />}
      {catsOpen && <CategoriesModal onClose={() => setCatsOpen(false)} />}
    </>
  );
}

function ProductDetail({ id }: { id: string }) {
  const can = useCan();
  useCatalog();
  const allMoves = useTable<StockMove>('stockMoves');
  const p = get<Product>('products', id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [adjust, setAdjust] = useState<Variant[] | null>(null);
  const [archive, setArchive] = useState(false);
  const [editVariant, setEditVariant] = useState<Variant | null>(null);
  const [delArt, setDelArt] = useState(false);
  if (!p) return <Empty icon="store" title="Article introuvable"><Button variant="ghost" onClick={() => navigate('/articles')}>Retour aux articles</Button></Empty>;
  if (isLot(p)) return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => navigate('/articles')}>Articles</Button></div>
      <LotDetail p={p} onEdit={() => setEditing(true)} />
      {can('catalog.edit') && <div className="row">
        <Button variant="quiet" icon={p.active === false ? 'refresh' : 'list'} onClick={() => setArchive(true)}>{p.active === false ? 'Réactiver le lot' : 'Archiver le lot'}</Button>
        {!articleUsage(p.id).used && <Button variant="quiet" icon="trash" onClick={() => setDelArt(true)}>Supprimer le lot</Button>}
      </div>}
      {editing && <LotForm lot={p} onClose={() => setEditing(false)} />}
      {delArt && <Confirm title="Supprimer le lot" danger confirmLabel="Supprimer" message={<p>Le lot <strong>{p.name}</strong> sera supprimé (il n’a jamais été vendu). Les articles qu’il contient ne changent pas.</p>}
        onClose={() => setDelArt(false)} onConfirm={async () => { await deleteArticle(p); toast('Lot supprimé'); navigate('/articles'); }} />}
      {archive && <Confirm title={p.active === false ? 'Réactiver le lot' : 'Archiver le lot'} confirmLabel={p.active === false ? 'Réactiver' : 'Archiver'}
        message={<p>{p.active === false ? 'Le lot sera de nouveau proposé à la vente.' : 'Le lot ne sera plus proposé à la vente. Son historique est conservé.'}</p>}
        onClose={() => setArchive(false)}
        onConfirm={async () => { await save('products', { id: p.id, active: p.active === false }); await audit(p.active === false ? 'Lot réactivé' : 'Lot archivé', `${p.code} — ${p.name}`, 'products', p.id); }} />}
    </>
  );
  const variants = productVariants(p.id);
  const vIds = new Set(variants.map((v) => v.id));
  const moves = allMoves.filter((m) => vIds.has(m.variantId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  const stock = productStock(p.id);
  const showCost = can('costs.view');
  const value = variants.reduce((s, v) => s + Math.max(0, stockOf(v.id)) * (v.costAvg ?? 0), 0);
  const avgCost = stock > 0 ? value / stock : variants[0]?.costAvg;
  const margin = p.priceRetail && avgCost ? (p.priceRetail - avgCost) / p.priceRetail : undefined;

  return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => navigate('/articles')}>Articles</Button></div>
      <div className="card product-head">
        <Thumb src={p.photo} size={112} alt={p.name} />
        <div className="stack-s" style={{ flex: 1, minWidth: 220 }}>
          <div className="row" style={{ gap: 8 }}>
            <h1 style={{ fontSize: '1.6rem' }}>{p.name}</h1>
            {p.active === false && <Badge>Archivé</Badge>}
          </div>
          <p className="muted">{p.code} · {categoryPath(p.categoryId)}</p>
          <AttrBadges p={p} />
          <div className="kv-row">
            <div><span className="small muted">Stock</span><strong className="num">{fmtNum(stock)}</strong></div>
            <div><span className="small muted">En arrivage</span><strong className="num">{fmtNum(productIncoming(p.id))}</strong></div>
            <div><span className="small muted">Prix détail</span><strong className="num">{fmtAr(p.priceRetail)}</strong></div>
            <div><span className="small muted">Prix de gros</span><strong className="num">{fmtAr(p.priceWholesale)}</strong></div>
            {tierText(p) && <div><span className="small muted">Prix par quantité</span><strong className="num">{tierText(p)}</strong></div>}
            {showCost && <div><span className="small muted">Coût moyen</span><strong className="num">{fmtAr(avgCost)}</strong></div>}
            {showCost && <div><span className="small muted">Marge détail</span><strong className="num">{margin != null ? `${Math.round(margin * 100)} %` : '—'}</strong></div>}
            {showCost && <div><span className="small muted">Valeur du stock</span><strong className="num">{fmtAr(value)}</strong></div>}
          </div>
          {p.link && <a className="small" href={p.link} target="_blank" rel="noreferrer">Voir chez le fournisseur</a>}
          {p.notes && <p className="small">{p.notes}</p>}
        </div>
        <div className="page-actions" style={{ alignSelf: 'flex-start' }}>
          {can('catalog.edit') && <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>Modifier</Button>}
          {can('stock.adjust') && variants.length > 0 && <Button variant="ghost" icon="refresh" onClick={() => setAdjust(variants)}>Ajuster le stock</Button>}
        </div>
      </div>

      {variants.length === 0 && (
        <div className="notice notice-danger"><Icon name="alert" /><span style={{ flex: 1 }}>Cet article n’a plus de ligne de stock : impossible d’y ajouter du stock.</span>
          {can('catalog.edit') && <Button onClick={async () => { await repairArticle(p); toast('Ligne de stock rétablie'); }}>Rétablir</Button>}</div>
      )}
      <div className="card card-flush">
        <div className="row-between card-pad">
          <h2>{p.attrs ? 'Stock et coût' : 'Variantes'}</h2>
          {can('catalog.edit') && !p.attrs && <Button variant="ghost" icon="plus" onClick={() => setAdding(true)}>Ajouter des tailles / couleurs</Button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Variante</th><th className="hide-sm">Code</th><th className="t-num">Stock</th><th className="t-num">En arrivage</th>{showCost && <th className="t-num">Coût moyen</th>}<th className="t-num">Prix détail</th><th></th></tr></thead>
            <tbody>
              {variants.map((v) => {
                const s = stockOf(v.id);
                return (
                  <tr key={v.id} style={{ opacity: v.active === false ? .55 : 1 }}>
                    <td><strong>{variantLabel(v)}</strong></td>
                    <td className="muted hide-sm">{v.sku}</td>
                    <td className="t-num"><span className={`stock-pill ${s <= 0 ? 'is-out' : s <= (p.alertQty ?? 3) ? 'is-low' : ''}`}>{fmtNum(s)}</span></td>
                    <td className="t-num">{incomingOf(v.id) || '—'}</td>
                    {showCost && <td className="t-num">{fmtAr(v.costAvg)}</td>}
                    <td className="t-num">{fmtAr(v.priceRetail ?? p.priceRetail)}</td>
                    <td className="t-actions">
                      {can('stock.adjust') && <IconButton icon="refresh" label="Ajuster" onClick={() => setAdjust([v])} />}
                      {can('catalog.edit') && <IconButton icon="edit" label="Modifier la variante" onClick={() => setEditVariant(v)} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-flush">
        <div className="card-pad"><h2>Mouvements de stock</h2></div>
        {moves.length === 0 ? <Empty icon="list" title="Aucun mouvement" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Variante</th><th>Type</th><th className="t-num">Quantité</th>{showCost && <th className="t-num">Coût unitaire</th>}<th>Détail</th><th>Par</th></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.at)}</td>
                    <td>{variantLabel(get<Variant>('variants', m.variantId))}</td>
                    <td>{MOVE_LABELS[m.type]}</td>
                    <td className={`t-num num ${m.qty > 0 ? 'pos' : 'neg'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                    {showCost && <td className="t-num">{m.unitCost ? fmtAr(m.unitCost) : '—'}</td>}
                    <td className="small">{m.reason || ''}</td>
                    <td className="small muted">{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {can('catalog.edit') && (
        <div className="row">
          <Button variant="quiet" icon={p.active === false ? 'refresh' : 'list'} onClick={() => setArchive(true)}>{p.active === false ? 'Réactiver l’article' : 'Archiver l’article'}</Button>
          {!articleUsage(p.id).used && <Button variant="quiet" icon="trash" onClick={() => setDelArt(true)}>Supprimer l’article</Button>}
        </div>
      )}
      {delArt && <Confirm title="Supprimer l’article" danger confirmLabel="Supprimer définitivement" message={<div className="stack-s"><p>L’article <strong>{p.name}</strong> ({p.code}) sera supprimé{articleUsage(p.id).moves ? ', avec son stock de départ' : ''}.</p><p className="small muted">Possible seulement pour un article jamais vendu, commandé ni acheté (ex. article de test). Sinon, utilisez « Archiver ».</p></div>}
        onClose={() => setDelArt(false)} onConfirm={async () => { await deleteArticle(p); toast('Article supprimé'); navigate('/articles'); }} />}

      {editing && <ProductForm product={p} onClose={() => setEditing(false)} />}
      {adding && <AddVariantsModal product={p} onClose={() => setAdding(false)} />}
      {adjust && <AdjustModal product={p} variants={adjust} onClose={() => setAdjust(null)} />}
      {editVariant && <VariantForm product={p} variant={editVariant} onClose={() => setEditVariant(null)} />}
      {archive && <Confirm title={p.active === false ? 'Réactiver l’article' : 'Archiver l’article'} confirmLabel={p.active === false ? 'Réactiver' : 'Archiver'}
        message={<p>{p.active === false ? 'L’article réapparaîtra dans les listes.' : 'L’article n’apparaîtra plus dans les listes ni à la vente. Son historique est conservé.'}</p>}
        onClose={() => setArchive(false)}
        onConfirm={async () => { await save('products', { id: p.id, active: p.active === false }); await audit(p.active === false ? 'Article réactivé' : 'Article archivé', `${p.code} — ${p.name}`, 'products', p.id); }} />}
    </>
  );
}

export function parseList(s: string) {
  return [...new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
}
const SIZE_CHIPS = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

export function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved?: (p: Product) => void }) {
  const { categories, products } = useCatalog();
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [newCat, setNewCat] = useState('');
  const [photo, setPhoto] = useState(product?.photo);
  const [priceRetail, setPriceRetail] = useState(product?.priceRetail?.toString() ?? '');
  const [priceWholesale, setPriceWholesale] = useState(product?.priceWholesale?.toString() ?? '');
  const [alertQty, setAlertQty] = useState(product?.alertQty?.toString() ?? '3');
  const [link, setLink] = useState(product?.link ?? '');
  const [notes, setNotes] = useState(product?.notes ?? '');
  const [colors, setColors] = useState('');
  const [sizes, setSizes] = useState('');
  const [tiers, setTiers] = useState<PriceTier[]>(product?.tiers ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorList = parseList(colors);
  const sizeList = parseList(sizes).map(normSize).sort((a, b) => sizeRank(a) - sizeRank(b));
  const count = Math.max(1, colorList.length) * Math.max(1, sizeList.length);

  async function submit() {
    setError(null);
    if (!code.trim()) return setError('Indiquez un code (ex. BXH12).');
    if (!name.trim()) return setError('Indiquez le nom de l’article.');
    if (products.some((p) => p.id !== product?.id && p.code.toUpperCase().replace(/\s/g, '') === code.trim().toUpperCase().replace(/\s/g, ''))) return setError('Ce code est déjà utilisé par un autre article.');
    setBusy(true);
    try {
      let cat = categoryId;
      if (categoryId === '__new') {
        if (!newCat.trim()) { setBusy(false); return setError('Nom de la nouvelle catégorie ?'); }
        const [c] = await save('categories', { name: newCat.trim() });
        cat = c.id;
      }
      const data = {
        code: code.trim(), name: name.trim(), categoryId: cat || undefined, photo,
        priceRetail: parseNum(priceRetail), priceWholesale: parseNum(priceWholesale), alertQty: parseNum(alertQty),
        link: link.trim() || undefined, notes: notes.trim() || undefined,
        tiers: tiers.filter((t) => t.qty > 1 && t.price > 0).length ? tiers.filter((t) => t.qty > 1 && t.price > 0) : (product?.tiers ? [] : undefined),
      };
      if (product) {
        await save('products', { id: product.id, ...data });
        await audit('Article modifié', `${data.code} — ${data.name}`, 'products', product.id);
        toast('Article enregistré');
        onClose();
      } else {
        const combos: { color?: string; size?: string }[] = [];
        for (const c of colorList.length ? colorList : [undefined]) for (const s of sizeList.length ? sizeList : [undefined]) combos.push({ color: c, size: s });
        const p = await createProduct(data, combos);
        toast('Article créé');
        onClose();
        onSaved?.(p);
      }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={product ? 'Modifier l’article' : 'Nouvel article'} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{product ? 'Enregistrer' : `Créer l’article${count > 1 ? ` (${count} variantes)` : ''}`}</Button></>}>
      <div className="stack">
        <div className="row" style={{ alignItems: 'center', gap: 16 }}>
          <button type="button" className="photo-pick" onClick={() => fileRef.current?.click()} aria-label="Choisir une photo">
            <Thumb src={photo} size={88} />
            <span className="small">{photo ? 'Changer' : 'Ajouter une photo'}</span>
          </button>
          {photo && <span className="small muted">Photo compressée : {Math.max(1, Math.round(photoBytes(photo) / 1024))} Ko</span>}
          {photo && <Button variant="quiet" onClick={() => setPhoto(undefined)}>Retirer la photo</Button>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) { try { setPhoto(await blobToThumb(f, 320)); } catch (err: any) { toast(err.message, 'error'); } }
            e.target.value = '';
          }} />
        </div>
        <div className="grid-2">
          <TextField label="Code de l’article" required value={code} onChange={setCode} placeholder="Ex. BXH12" autoCapitalize="characters" />
          <TextField label="Nom" required value={name} onChange={setName} placeholder="Ex. Boxer homme coton imprimé" />
          <SelectField label="Catégorie" value={categoryId} onChange={setCategoryId} options={[...categoryOptions(categories), { value: '__new', label: '+ Nouvelle catégorie…' }]} />
          {categoryId === '__new' ? <TextField label="Nom de la nouvelle catégorie" required value={newCat} onChange={setNewCat} /> : <TextField label="Alerte stock bas à partir de" value={alertQty} onChange={setAlertQty} inputMode="numeric" />}
          <TextField label="Prix de vente détail (Ar)" value={priceRetail} onChange={setPriceRetail} inputMode="numeric" />
          <TextField label="Prix de gros (Ar)" value={priceWholesale} onChange={setPriceWholesale} inputMode="numeric" hint="À partir de 3 pièces (réglable)." />
        </div>
        {!product && (
          <div className="card stack" style={{ background: 'var(--surface-2)' }}>
            <div><h3>Variantes</h3><p className="small muted">Une variante est créée pour chaque couleur et chaque taille. Laissez vide si l’article n’a qu’une seule version.</p></div>
            <TextField label="Couleurs (séparées par des virgules)" value={colors} onChange={setColors} placeholder="Ex. Noir, Gris, Bleu" />
            <TextField label="Tailles (séparées par des virgules)" value={sizes} onChange={setSizes} placeholder="Ex. M, L, XL, 2XL" />
            <div className="row" style={{ gap: 6 }}>
              {SIZE_CHIPS.map((s) => <button key={s} type="button" className="chip" aria-pressed={sizeList.includes(s)}
                onClick={() => setSizes(sizeList.includes(s) ? sizeList.filter((x) => x !== s).join(', ') : [...sizeList, s].join(', '))}>{s}</button>)}
            </div>
            <p className="small"><strong>{count}</strong> variante{count > 1 ? 's' : ''} : {colorList.length || sizeList.length ? (colorList.length ? colorList : ['']).flatMap((c) => (sizeList.length ? sizeList : ['']).map((s) => makeSku(code || '…', c, s))).slice(0, 8).join(', ') + (count > 8 ? '…' : '') : 'version unique'}</p>
          </div>
        )}
        <TextField label="Lien fournisseur (facultatif)" value={link} onChange={setLink} inputMode="url" autoCapitalize="none" />
        <TierEditor tiers={tiers} onChange={setTiers} unit={parseNum(priceRetail)} />
        <TextField label="Notes (facultatif)" value={notes} onChange={setNotes} />
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
    </Modal>
  );
}

function AddVariantsModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const existing = productVariants(product.id);
  const [colors, setColors] = useState([...new Set(existing.map((v) => v.color).filter(Boolean))].join(', '));
  const [sizes, setSizes] = useState('');
  const [busy, setBusy] = useState(false);
  const colorList = parseList(colors);
  const sizeList = parseList(sizes).map(normSize);
  const combos: { color?: string; size?: string }[] = [];
  for (const c of colorList.length ? colorList : [undefined]) for (const s of sizeList.length ? sizeList : [undefined]) {
    if (!existing.some((v) => (v.color || '') === (c || '') && (v.size || '') === (s || ''))) combos.push({ color: c, size: s });
  }
  return (
    <Modal title="Ajouter des variantes" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!combos.length} onClick={async () => {
        setBusy(true);
        await save('variants', combos.map((c) => ({ productId: product.id, sku: makeSku(product.code, c.color, c.size), color: c.color, size: c.size || undefined, active: true })));
        await audit('Variantes ajoutées', `${product.code} : ${combos.map((c) => [c.color, c.size].filter(Boolean).join(' ')).join(', ')}`, 'products', product.id);
        toast(`${combos.length} variante(s) ajoutée(s)`);
        onClose();
      }}>Ajouter {combos.length || ''}</Button></>}>
      <div className="stack">
        <TextField label="Couleurs" value={colors} onChange={setColors} placeholder="Ex. Noir, Gris" />
        <TextField label="Tailles" value={sizes} onChange={setSizes} placeholder="Ex. 3XL, 4XL" />
        <p className="small muted">Nouvelles variantes : {combos.map((c) => [c.color, c.size].filter(Boolean).join(' ') || 'unique').join(', ') || 'aucune (elles existent déjà)'}</p>
      </div>
    </Modal>
  );
}

function VariantForm({ product, variant, onClose }: { product: Product; variant: Variant; onClose: () => void }) {
  const can = useCan();
  const [color, setColor] = useState(variant.color ?? '');
  const [size, setSize] = useState(variant.size ?? '');
  const [sku, setSku] = useState(variant.sku);
  const [price, setPrice] = useState(variant.priceRetail?.toString() ?? '');
  const [wholesale, setWholesale] = useState(variant.priceWholesale?.toString() ?? '');
  const [cost, setCost] = useState(variant.costAvg?.toString() ?? '');
  const [del, setDel] = useState(false);
  const hasMoves = useTable<StockMove>('stockMoves').some((m) => m.variantId === variant.id) || variantUsed(variant.id);
  const attr = !!product.attrs;
  return (
    <Modal title={attr ? `Code et coût — ${product.name}` : `Variante ${variantLabel(variant)}`} onClose={onClose}
      footer={<>
        {!hasMoves && !attr && <Button variant="quiet" icon="trash" onClick={() => setDel(true)}>Supprimer</Button>}
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button onClick={async () => {
          await save('variants', { id: variant.id, color: color.trim() || undefined, size: normSize(size) || undefined, sku: sku.trim() || makeSku(product.code, color, size), priceRetail: parseNum(price), priceWholesale: parseNum(wholesale), ...(can('costs.view') ? { costAvg: parseNum(cost) } : {}) });
          await audit('Variante modifiée', `${product.code} ${variantLabel(variant)}`, 'variants', variant.id);
          toast('Variante enregistrée'); onClose();
        }}>Enregistrer</Button>
      </>}>
      <div className="stack">
        {attr ? <p className="small muted">Les valeurs ({variantLabel(variant)}) et les prix de vente se changent avec « Modifier » en haut de la fiche.</p> : (
        <div className="grid-2">
          <TextField label="Couleur" value={color} onChange={setColor} />
          <TextField label="Taille" value={size} onChange={setSize} />
        </div>)}
        <TextField label={attr ? 'Code (code-barres)' : 'Code de la variante'} value={sku} onChange={setSku} />
        {!attr && <div className="grid-2">
          <TextField label="Prix détail propre (facultatif)" value={price} onChange={setPrice} inputMode="numeric" hint={`Sinon : ${fmtAr(product.priceRetail)}`} />
          <TextField label="Prix de gros propre (facultatif)" value={wholesale} onChange={setWholesale} inputMode="numeric" hint={`Sinon : ${fmtAr(product.priceWholesale)}`} />
        </div>}
        {can('costs.view') && <TextField label="Coût de revient moyen (Ar)" value={cost} onChange={setCost} inputMode="decimal" hint="Calculé automatiquement à chaque réception. Ne le modifiez que pour corriger." />}
      </div>
      {del && <Confirm title="Supprimer la variante" danger confirmLabel="Supprimer" message={<p>La variante {variantLabel(variant)} sera supprimée. Elle n’a ni stock, ni vente, ni achat.</p>}
        onClose={() => setDel(false)} onConfirm={async () => { await remove('variants', variant.id); onClose(); }} />}
    </Modal>
  );
}

/** Ajuster le stock : saisir la quantité réelle (ou une entrée/sortie) avec un motif. */
export function AdjustModal({ product, variants, onClose }: { product: Product; variants: Variant[]; onClose: () => void }) {
  const can = useCan();
  const first = useTable<StockMove>('stockMoves').every((m) => !variants.some((v) => v.id === m.variantId));
  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const [reason, setReason] = useState(first ? 'Stock initial' : ADJUST_REASONS[0]);
  const [note, setNote] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const initial = reason === 'Stock initial';
  const changes = variants.map((v) => {
    const cur = stockOf(v.id);
    const raw = parseNum(vals[v.id] ?? '');
    const delta = raw == null ? 0 : mode === 'set' ? raw - cur : raw;
    return { v, cur, delta };
  }).filter((c) => c.delta !== 0);

  return (
    <Modal title={`Ajuster le stock — ${product.code}`} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!changes.length} onClick={async () => {
        setBusy(true);
        const costUpdates: Partial<Variant>[] = [];
        await addMoves(changes.map((c) => {
          const uc = parseNum(costs[c.v.id] ?? '') ?? c.v.costAvg;
          if (initial && uc != null && uc !== c.v.costAvg) costUpdates.push({ id: c.v.id, costAvg: uc });
          return { variantId: c.v.id, qty: c.delta, type: initial ? 'initial' as const : 'adjust' as const, unitCost: uc, reason: [reason, note.trim()].filter(Boolean).join(' — ') };
        }));
        if (costUpdates.length) await save('variants', costUpdates);
        await audit('Stock ajusté', `${product.code} : ${changes.map((c) => `${variantLabel(c.v)} ${c.delta > 0 ? '+' : ''}${c.delta}`).join(', ')} (${reason})`, 'products', product.id);
        toast('Stock mis à jour');
        onClose();
      }}>Valider {changes.length ? `(${changes.length})` : ''}</Button></>}>
      <div className="stack">
        <div className="row-between">
          <div className="segmented" role="group">
            <button aria-pressed={mode === 'set'} onClick={() => setMode('set')}>Quantité réelle</button>
            <button aria-pressed={mode === 'delta'} onClick={() => setMode('delta')}>Entrée / sortie (+/−)</button>
          </div>
          <div style={{ minWidth: 220 }}>
            <SelectField label="Motif" value={reason} onChange={setReason} options={['Stock initial', ...ADJUST_REASONS].map((r) => ({ value: r, label: r }))} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Variante</th><th className="t-num">Actuel</th><th>{mode === 'set' ? 'Quantité réelle' : 'Ajouter / retirer'}</th><th className="t-num">Écart</th>{initial && can('costs.view') && <th>Coût unitaire (Ar)</th>}</tr></thead>
            <tbody>
              {variants.map((v) => {
                const c = changes.find((x) => x.v.id === v.id);
                return (
                  <tr key={v.id}>
                    <td><strong>{variantLabel(v)}</strong><div className="small muted">{v.sku}</div></td>
                    <td className="t-num num">{stockOf(v.id)}</td>
                    <td><input className="cell-input" inputMode="numeric" aria-label={`Quantité ${variantLabel(v)}`} value={vals[v.id] ?? ''} placeholder={mode === 'set' ? String(stockOf(v.id)) : '0'}
                      onChange={(e) => setVals({ ...vals, [v.id]: e.target.value })} /></td>
                    <td className={`t-num num ${c && c.delta > 0 ? 'pos' : c ? 'neg' : ''}`}>{c ? (c.delta > 0 ? '+' : '') + c.delta : '—'}</td>
                    {initial && can('costs.view') && <td><input className="cell-input" inputMode="decimal" aria-label={`Coût ${variantLabel(v)}`} value={costs[v.id] ?? (v.costAvg?.toString() ?? '')} onChange={(e) => setCosts({ ...costs, [v.id]: e.target.value })} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TextField label="Précision (facultatif)" value={note} onChange={setNote} />
      </div>
    </Modal>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const { categories, products } = useCatalog();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [edit, setEdit] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const sorted = [...categories].sort((a, b) => categoryPath(a.id).localeCompare(categoryPath(b.id)));
  return (
    <Modal title="Catégories" onClose={onClose} wide>
      <div className="stack">
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await save('categories', { name: name.trim(), parentId: parent || undefined });
          await audit('Catégorie créée', name.trim());
          setName('');
        }}>
          <div style={{ flex: '1 1 200px' }}><TextField label="Nouvelle catégorie" required value={name} onChange={setName} placeholder="Ex. Boxer homme" /></div>
          <div style={{ flex: '1 1 200px' }}><SelectField label="Dans la catégorie" value={parent} onChange={setParent} options={categoryOptions(categories, 'Aucune (principale)')} /></div>
          <Button type="submit" icon="plus" disabled={!name.trim()}>Ajouter</Button>
        </form>
        {sorted.length === 0 ? <Empty icon="list" title="Aucune catégorie" /> : (
          <ul className="list card" style={{ padding: 0 }}>
            {sorted.map((c) => {
              const n = products.filter((p) => p.categoryId === c.id).length;
              const children = categories.filter((x) => x.parentId === c.id).length;
              return (
                <li key={c.id} className="list-item">
                  <div className="list-item-main">
                    {edit?.id === c.id ? (
                      <form className="row" onSubmit={async (e) => { e.preventDefault(); await save('categories', { id: c.id, name: editName.trim() }); setEdit(null); }}>
                        <input className="cell-input" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus aria-label="Nom" />
                        <Button type="submit">OK</Button>
                      </form>
                    ) : <><span className="list-item-title">{categoryPath(c.id)}</span><p className="small muted">{n} article(s)</p></>}
                  </div>
                  <IconButton icon="edit" label="Renommer" onClick={() => { setEdit(c); setEditName(c.name); }} />
                  <IconButton icon="trash" label="Supprimer" onClick={async () => {
                    if (n || children) return toast('Cette catégorie contient encore des articles ou des sous-catégories.', 'error');
                    await remove('categories', c.id);
                  }} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export { MOVE_LABELS };

/** Articles en double : choisir lequel garder dans chaque groupe ; les autres sont archivés (stock remis à 0 ou transféré). */
function DuplicatesModal({ onClose }: { onClose: () => void }) {
  useTable('products'); useTable('stockMoves'); useTable('orders');
  const groups = findDuplicates();
  const pages = [...new Set(groups.flatMap((g) => g.pages))];
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const keepOf = (g: DupGroup) => keep[g.key] ?? '';
  const choosePage = (pid: string) => { const k: Record<string, string> = {}; for (const g of groups) { const it = g.items.find((p) => rootOf(p.categoryId) === pid); if (it) k[g.key] = it.id; } setKeep(k); };
  const ready = groups.filter((g) => keepOf(g));
  const apply = async () => {
    setBusy(true);
    try {
      for (const g of ready) { const k = g.items.find((p) => p.id === keepOf(g))!; await resolveDuplicates(k, g.items.filter((p) => p.id !== k.id), move); }
      toast(`${ready.length} groupe(s) réglé(s) : doublons archivés`); setKeep({});
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Articles en double" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button busy={busy} disabled={!ready.length} onClick={apply}>Archiver les doublons ({ready.length} groupe(s))</Button></>}>
      <div className="stack">
        <p className="small">Pour chaque groupe, choisissez <strong>l’article à garder</strong> (celui de la bonne page). Les autres sont archivés : ils sortent des ventes et des recherches, leur stock est remis à 0, et toutes les ventes passées gardent leur historique. Un point de restauration est créé avant.</p>
        {pages.length > 1 && <div className="row" style={{ gap: 6, alignItems: 'center' }}><span className="small">Garder partout la page :</span>{pages.map((pid) => <button key={pid} type="button" className="chip" onClick={() => choosePage(pid)}>{get<Category>('categories', pid)?.name ?? 'Sans page'}</button>)}</div>}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> Ajouter le stock des doublons à l’article gardé (sinon il est remis à 0)</label>
        {groups.length === 0 ? <p className="small muted">Aucun doublon trouvé.</p> : groups.map((g) => (
          <div key={g.key} className="card stack-s" style={{ background: 'var(--surface-2)' }}>
            {g.items.map((p) => (
              <label key={p.id} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
                <input type="radio" name={g.key} checked={keepOf(g) === p.id} onChange={() => setKeep({ ...keep, [g.key]: p.id })} aria-label={`Garder ${p.code}`} />
                <Thumb src={p.photo} size={44} />
                <span style={{ flex: 1, minWidth: 0 }}><strong>{p.name}</strong><span className="small muted"> · {p.code} · page {get<Category>('categories', rootOf(p.categoryId))?.name ?? '—'}</span><br /><span className="small">stock {productStock(p.id)} · utilisé dans {usesOf(p)} vente(s)/commande(s)</span></span>
                {keepOf(g) === p.id ? <Badge tone="ok">À garder</Badge> : keepOf(g) ? <Badge tone="danger">Sera archivé</Badge> : null}
              </label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
