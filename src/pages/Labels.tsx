// Étiquettes et QR : codes des articles, numéros de série par pièce, impression des étiquettes (imprimante L12…).
import { useEffect, useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { save, useTable, get, nowIso } from '../lib/db';
import { fmtAr, fmtNum, parseNum, productVariants, stockOf, useCatalog, variantLabel, attrSummary, searchItems, productText, type Category, type Product, type Variant } from '../lib/catalog';
import { rootOf, useMyScope } from '../lib/scope';
import { SERIAL_STATUS, ensureLabelCodes, fillMissingSerials, isTracked, missingSerials, readScan, serialQr, serialsOf, warrantyEnd, type Serial } from '../lib/serials';
import { LABEL_SIZES, isLabelPrinter, labelTargets, printLabels, HISTORY_ACTION, type LabelData } from '../lib/print';
import { Badge, Button, Empty, Help, PageHead, SelectField, TextField, Toggle, fmtDateTime, toast, useKeep, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ScopeBar } from '../ui/scope';
import { Thumb } from './Products';
import { isLot } from '../lib/lots';

type Mode = 'article' | 'serial';
interface Pick { on: boolean; mode: Mode; qty: string; which: 'new' | 'all' }

const titleOf = (p?: Product) => p?.name ?? '';
const subOf = (p?: Product, v?: Variant) => (p?.attrs ? '' : variantLabel(v) !== 'Unique' ? variantLabel(v) : '');

export function LabelsPage() {
  const can = useCan();
  const route = useRoute();
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const { products, categories } = useCatalog();
  const serials = useTable<Serial>('serials');
  useTable('stockMoves');
  const scope = useMyScope();
  const [page, setPage] = useKeep('labels.page', params.get('page') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [onlyStock, setOnlyStock] = useKeep('labels.stock', true);
  const [onlyTracked, setOnlyTracked] = useKeep('labels.tracked', false);
  const [showPrice, setShowPrice] = useKeep('labels.price', true);
  const printers = labelTargets();
  const [printerId, setPrinterId] = useKeep('labels.printer', printers[0]?.id ?? '');
  const printer = printers.find((p) => p.id === printerId) ?? printers[0];
  const [sizeKey, setSizeKey] = useKeep('labels.size', '30x15');
  const preset = (pid: string | null): Record<string, Pick> => (!pid ? {} : Object.fromEntries(productVariants(pid).map((v) => [v.id, { on: true, mode: isTracked(get('products', pid)) ? 'serial' : 'article', qty: String(Math.max(1, Math.floor(stockOf(v.id)))), which: 'new' } as Pick])));
  const [picks, setPicks] = useState<Record<string, Pick>>(() => preset(params.get('produit')));
  // Arrivée depuis la fiche d'un autre article (…?produit=…) : cet article est choisi.
  const pidParam = params.get('produit');
  useEffect(() => { if (pidParam) setPicks(preset(pidParam)); }, [pidParam]);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState('');
  const edit = can('catalog.edit');

  const pages = categories.filter((c) => !c.parentId && !c.removed && scope.page(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const pre = params.get('produit');
  const rows = useMemo(() => {
    const ps = products.filter((p) => p.active !== false && scope.product(p.id) && !isLot(p) && (!page || rootOf(p.categoryId) === page) && (!onlyTracked || isTracked(p)));
    const found = q.trim() ? searchItems(ps, productText, q.trim().toLowerCase(), true).list : ps;
    return found.flatMap((p) => productVariants(p.id).filter((v) => v.active !== false).map((v) => ({ p, v, stock: stockOf(v.id) })))
      .filter((r) => !onlyStock || r.stock > 0 || r.v.productId === pre)
      .sort((a, b) => a.p.name.localeCompare(b.p.name, 'fr', { numeric: true }));
  }, [products, page, q, onlyStock, onlyTracked, serials, scope.on]);

  const pickOf = (v: Variant, p: Product): Pick => picks[v.id] ?? { on: false, mode: isTracked(p) ? 'serial' : 'article', qty: String(Math.max(1, Math.floor(stockOf(v.id)))), which: 'new' };
  const setPick = (v: Variant, p: Product, patch: Partial<Pick>) => setPicks({ ...picks, [v.id]: { ...pickOf(v, p), ...patch } });
  const chosen = rows.filter((r) => pickOf(r.v, r.p).on);
  const serialList = (v: Variant, which: 'new' | 'all') => serialsOf(v.id, 'stock').filter((s) => which === 'all' || !s.printedAt);
  const countOf = (r: { v: Variant; p: Product }) => { const k = pickOf(r.v, r.p); return k.mode === 'serial' ? serialList(r.v, k.which).length : Math.max(0, Math.floor(parseNum(k.qty) ?? 0)); };
  const total = chosen.reduce((s, r) => s + countOf(r), 0);
  const missingChosen = chosen.filter((r) => isTracked(r.p) && missingSerials(r.v.id) > 0);
  const allOn = rows.length > 0 && rows.every((r) => pickOf(r.v, r.p).on);

  async function setTracked(p: Product, on: boolean) {
    await save('products', { id: p.id, serialTracked: on });
    toast(on ? `« ${p.name} » : chaque pièce aura son numéro de série` : `« ${p.name} » : plus de numéro de série par pièce`);
  }
  async function makeMissing(list = chosen) {
    const n = await fillMissingSerials(list.filter((r) => isTracked(r.p)).map((r) => r.v.id));
    toast(n ? `${n} numéro(s) de série créé(s)` : 'Aucun numéro manquant');
  }
  async function print() {
    if (!printer) return;
    setBusy(true);
    try {
      const codes = await ensureLabelCodes(chosen.filter((r) => pickOf(r.v, r.p).mode === 'article').map((r) => r.v.id));
      void codes;
      const labels: LabelData[] = [];
      const printed: string[] = [];
      for (const r of chosen) {
        const k = pickOf(r.v, r.p);
        const price = showPrice && r.p.priceRetail ? fmtAr(r.v.priceRetail ?? r.p.priceRetail) : undefined;
        if (k.mode === 'serial') {
          for (const s of serialList(r.v, k.which)) { labels.push({ qr: serialQr(s.serial), code: s.serial, title: titleOf(r.p), sub: subOf(r.p, r.v) || (r.p.warrantyMonths ? `Garantie ${r.p.warrantyMonths} mois` : undefined), price }); printed.push(s.id); }
        } else {
          const code = get<Variant>('variants', r.v.id)?.labelCode ?? r.v.sku;
          const n = Math.max(0, Math.floor(parseNum(k.qty) ?? 0));
          for (let i = 0; i < n; i++) labels.push({ qr: code, code, title: titleOf(r.p), sub: subOf(r.p, r.v), price });
        }
      }
      if (!labels.length) { toast('Rien à imprimer : choisissez des articles (et créez leurs numéros de série si besoin).', 'error'); return; }
      await printLabels(printer, labels, sizeKey);
      if (printed.length) await save('serials', printed.map((id) => ({ id, printedAt: nowIso() })));
      toast(`${labels.length} étiquette(s) envoyée(s) à « ${printer.name} »`, 'ok', { ms: 8000 });
    } catch (e: any) { toast(e?.message ?? String(e), 'error', { sticky: true, action: HISTORY_ACTION }); }
    finally { setBusy(false); }
  }

  const found = lookup.trim() ? readScan(lookup) : null;
  if (!can('catalog.view')) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Étiquettes et QR" subtitle="Codes QR des articles et numéros de série par pièce, imprimés sur l’imprimante d’étiquettes." />
      <ScopeBar scope={scope} text={`Articles de vos pages : ${scope.names}`} />
      <Help>1. Cochez les articles. 2. Pour un article « suivi par numéro de série », chaque pièce a son propre numéro : créez les numéros manquants, puis imprimez une étiquette par pièce. Sinon, imprimez l’étiquette de l’article (même QR pour toutes les pièces). 3. Choisissez l’imprimante et imprimez.</Help>

      <div className="card stack">
        <div className="grid-2">
          <SelectField label="Imprimante" value={printer?.id ?? ''} onChange={setPrinterId} options={printers.map((p) => ({ value: p.id, label: p.name + (isLabelPrinter(p) ? ' (étiquettes)' : p.kind === 'system' ? '' : ' (tickets)') }))} />
          {printer && !isLabelPrinter(printer)
            ? <SelectField label="Taille des étiquettes" value={sizeKey} onChange={setSizeKey} options={Object.entries(LABEL_SIZES).map(([k, v]) => ({ value: k, label: v.label }))} />
            : <div className="field"><label>Taille des étiquettes</label><span className="small muted">{LABEL_SIZES[printer?.labelSize ?? '30x15']?.label} (réglage de l’imprimante)</span></div>}
        </div>
        {!printers.some(isLabelPrinter) && <div className="notice"><Icon name="printer" /><span>Pas encore d’imprimante d’étiquettes sur cet appareil : ajoutez la L12 dans <a href="#/parametres/imprimantes">Paramètres → Imprimantes</a> (Bluetooth → « MPL12_… »).</span></div>}
        <div className="row" style={{ gap: 16 }}>
          <Toggle checked={showPrice} onChange={setShowPrice} label="Prix sur l’étiquette" />
          <Toggle checked={onlyStock} onChange={setOnlyStock} label="Articles en stock seulement" />
          <Toggle checked={onlyTracked} onChange={setOnlyTracked} label="Seulement les articles suivis par numéro de série" />
        </div>
        <div className="grid-2">
          <SelectField label="Page" value={page} onChange={setPage} options={[{ value: '', label: 'Toutes les pages' }, ...pages.map((c: Category) => ({ value: c.id, label: c.name }))]} />
          <TextField label="Rechercher un article" value={q} onChange={setQ} placeholder="Nom ou code…" />
        </div>
        <div className="row-between">
          <span><strong>{fmtNum(total)}</strong> étiquette(s) · {chosen.length} article(s) choisi(s)</span>
          <div className="row" style={{ gap: 8 }}>
            {edit && missingChosen.length > 0 && <Button variant="ghost" icon="plus" onClick={() => makeMissing()}>Créer les numéros manquants ({fmtNum(missingChosen.reduce((s, r) => s + missingSerials(r.v.id), 0))})</Button>}
            <Button icon="printer" busy={busy} disabled={!total || !printer} onClick={print}>Imprimer {total ? `${fmtNum(total)} étiquette(s)` : ''}</Button>
          </div>
        </div>
      </div>

      <div className="card card-flush">
        {rows.length === 0 ? <Empty icon="tag" title="Aucun article" /> : (
          <div className="table-wrap"><table className="table labels-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Tout choisir" checked={allOn} onChange={(e) => setPicks(Object.fromEntries(rows.map((r) => [r.v.id, { ...pickOf(r.v, r.p), on: e.target.checked }])))} /></th>
              <th>Article</th><th className="t-num">Stock</th><th>N° de série par pièce</th><th>Étiquettes</th>
            </tr></thead>
            <tbody>
              {rows.slice(0, 400).map(({ p, v, stock }) => {
                const k = pickOf(v, p);
                const inStock = serialsOf(v.id, 'stock');
                const miss = missingSerials(v.id);
                return (
                  <tr key={v.id} className={k.on ? 'is-checked' : ''}>
                    <td><input type="checkbox" aria-label={`Choisir ${p.name}`} checked={k.on} onChange={(e) => setPick(v, p, { on: e.target.checked })} /></td>
                    <td><div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Thumb src={v.photo ?? p.photo} size={40} />
                      <div><strong>{p.name}</strong><div className="small muted">{p.attrs ? attrSummary(p, ', ') : `${p.code}${subOf(p, v) ? ' · ' + subOf(p, v) : ''}`}{v.labelCode ? ` · QR ${v.labelCode}` : ''}</div></div></div></td>
                    <td className="t-num"><span className={`stock-pill ${stock <= 0 ? 'is-out' : ''}`}>{fmtNum(stock)}</span></td>
                    <td>
                      {edit ? <Toggle checked={isTracked(p)} onChange={(on) => setTracked(p, on)} label={isTracked(p) ? 'Oui' : 'Non'} /> : <span>{isTracked(p) ? 'Oui' : 'Non'}</span>}
                      {isTracked(p) && <div className="small muted">{inStock.length} numéro(s) en stock{miss ? <> · <span className="neg">{miss} manquant(s)</span></> : ''}{p.warrantyMonths ? ` · garantie ${p.warrantyMonths} mois` : ''}</div>}
                      {isTracked(p) && edit && <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <input className="cell-input" style={{ width: 70 }} inputMode="numeric" aria-label="Garantie en mois" placeholder="Garantie" defaultValue={p.warrantyMonths ?? ''} onBlur={(e) => { const n = parseNum(e.target.value); if ((n ?? 0) !== (p.warrantyMonths ?? 0)) void save('products', { id: p.id, warrantyMonths: n || undefined }); }} /><span className="small muted">mois</span>
                        {miss > 0 && <Button variant="quiet" className="btn-sm" onClick={() => makeMissing([{ p, v, stock }])}>Créer {miss}</Button>}
                      </div>}
                    </td>
                    <td>
                      {isTracked(p) && <div className="segmented" role="group" aria-label="Type d’étiquette" style={{ marginBottom: 6 }}>
                        <button type="button" aria-pressed={k.mode === 'serial'} onClick={() => setPick(v, p, { mode: 'serial', on: true })}>Une par pièce</button>
                        <button type="button" aria-pressed={k.mode === 'article'} onClick={() => setPick(v, p, { mode: 'article', on: true })}>Article</button>
                      </div>}
                      {k.mode === 'serial' && isTracked(p)
                        ? <SelectField label="Pièces" value={k.which} onChange={(w) => setPick(v, p, { which: w as 'new' | 'all', on: true })} options={[{ value: 'new', label: `Pas encore imprimées (${serialList(v, 'new').length})` }, { value: 'all', label: `Toutes en stock (${inStock.length})` }]} />
                        : <div className="row" style={{ gap: 6 }}><input className="cell-input qty-input" inputMode="numeric" aria-label="Nombre d’étiquettes" value={k.qty} onChange={(e) => setPick(v, p, { qty: e.target.value.replace(/\D/g, ''), on: true })} /><span className="small muted">étiquette(s)</span></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {rows.length > 400 && <p className="small muted card-pad">Les 400 premiers articles sont affichés : choisissez une page ou recherchez pour voir les autres.</p>}
      </div>

      <div className="card stack-s">
        <h2>Retrouver une pièce</h2>
        <TextField label="Numéro de série ou code scanné" value={lookup} onChange={setLookup} placeholder="Ex. LP1B22-00012" autoCapitalize="characters" />
        {found && (found.serial ? (() => {
          const s = found.serial; const p = get<Product>('products', s.productId); const end = warrantyEnd(s);
          return <div className="notice notice-ok"><Icon name="tag" /><span><strong>{s.serial}</strong> — {p?.name} · <Badge tone={s.status === 'stock' ? 'ok' : s.status === 'sold' ? 'brand' : 'warn'}>{SERIAL_STATUS[s.status]}</Badge>
            {' '}· entré le {fmtDateTime(s.inAt)}{s.outAt ? ` · sorti le ${fmtDateTime(s.outAt)}` : ''}{s.orderId ? <> · <a href={`#/commandes/${s.orderId}`}>voir la vente</a></> : ''}
            {end ? ` · garantie jusqu’au ${new Date(end).toLocaleDateString('fr-FR')}${new Date(end) < new Date() ? ' (terminée)' : ''}` : ''}</span></div>;
        })() : found.variant ? <p className="small">Code d’article : {get<Product>('products', found.variant.productId)?.name} ({variantLabel(found.variant)}).</p> : <p className="small muted">Aucun numéro de série ni code d’article ne correspond.</p>)}
      </div>
    </>
  );
}
