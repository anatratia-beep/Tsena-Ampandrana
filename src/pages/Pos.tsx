// Vente sur place : écran de comptoir rapide (recherche, panier, encaissement, monnaie à rendre).
import { useMemo, useState } from 'react';
import { useCan, useMe, type User } from '../lib/auth';
import { rootOf, useMyScope } from '../lib/scope';
import { ScopeBar } from '../ui/scope';
import { get, getMeta, newId, useTable } from '../lib/db';
import { fmtAr, fmtNum, parseNum, productVariants, todayYmd, useCatalog, variantLabel, type Product, type Variant, matchQuery, searchItems, productText, attrSummary, findProductByCode, findVariantBySku, type Category, parseAr } from '../lib/catalog';
import {
  availableOf, createWalkInSale, internalPrice, isOutsideHours, isWalkIn, linePrice, orderLabel, PAY_METHODS, paidTotal, keptTotal, priceOrder, removeLine, reservedIndex, useWholesale,
  type Order, type OrderLine, type PayMethod, discountAr, stockShortages,
} from '../lib/orders';
import { useCompany } from '../lib/settings';
import { ListDates, applyDates, defaultPeriod, inPeriod, type ListOrder, type Period } from '../ui/period';
import { Badge, Choice, Button, DiscountField, Empty, MoreMatches, IconButton, Modal, PageHead, SelectField, TextField, fmtDateTime, toast, useKeep } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ItemPicker, StockTag } from './Orders';
import { defaultTarget, printTo, ticketDoc } from '../lib/print';
import { PrintButton, PrintDialog } from '../ui/print';
import { Thumb } from './Products';
import { AdjustList, LotTag, lotPhoto } from './Lots';
import { adjustsTotal, isLot, lotAvailable, lotOpen } from '../lib/lots';

export function PosPage() {
  const can = useCan();
  const company = useCompany();
  const { products } = useCatalog();
  const orders = useTable<Order>('orders');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useTable<Category>('categories');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [discUnit, setDiscUnit] = useState<'ar' | 'pct'>('ar');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [picking, setPicking] = useState<Product | null>(null);
  const [browse, setBrowse] = useState(false);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [last, setLast] = useState<Order | null>(null);
  const [printFor, setPrintFor] = useState<Order | null>(null);
  // Vente interne : achat d'un employé, au prix de revient arrondi (pas de remise ni de prix de gros).
  const [internal, setInternal] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const users = useTable<User>('users').filter((u) => u.active !== false).sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));
  const reserved = useMemo(() => reservedIndex(), [orders]);
  const scope = useMyScope();
  // Ventes du jour : chaque vendeur voit d'abord les siennes (l'admin voit tout).
  const [allSales, setAllSales] = useKeep('pos.all', can('reports.view'));
  const [salesPeriod, setSalesPeriod] = useKeep<Period>('pos.period', defaultPeriod('today'));
  const [salesOrder, setSalesOrder] = useKeep<ListOrder>('pos.order', 'new');
  const me = useMe();
  const minQty = company.wholesaleMinQty ?? 3;
  const step = company.internalRounding ?? 1;
  const pr = internal ? { lines: lines.map((l) => ({ ...l, priceManual: false, wholesale: false, unitPrice: internalPrice(l.variantId, step) })), adjusts: [] } : priceOrder(lines);
  const priced = pr.lines; const adjusts = pr.adjusts;
  const noCost = internal ? priced.filter((l) => !l.unitPrice) : [];
  const items = priced.reduce((s, l) => s + l.qty * l.unitPrice, 0) + adjustsTotal({ adjusts });
  const discAr = internal ? 0 : discountAr(discount, discUnit, items);
  const total = Math.max(0, items - discAr);
  const short = stockShortages(priced);
  const employee = users.find((u) => u.id === employeeId);
  const count = priced.reduce((s, l) => s + l.qty, 0);

  const n = q.trim().toLowerCase();
  const [allMatches, setAllMatches] = useState(false);
  const searched = useMemo(() => searchItems(products.filter((p) => p.active !== false && scope.product(p.id) && (!isLot(p) || lotOpen(p)) && (!cat || rootOf(p.categoryId) === cat)), productText, n, allMatches), [products, n, scope.on, cat, allMatches]);
  const found = useMemo(() => searched.list
    .map((p) => ({ p, avail: isLot(p) ? lotAvailable(p, (vid) => availableOf(vid, reserved)) : productVariants(p.id).reduce((s, v) => s + Math.max(0, availableOf(v.id, reserved)), 0) }))
    .sort((a, b) => Number(b.avail > 0) - Number(a.avail > 0) || a.p.code.localeCompare(b.p.code, 'fr', { numeric: true }))
    .slice(0, 60), [searched, reserved]);
  const pages = cats.filter((c) => !c.parentId && products.some((p) => p.active !== false && rootOf(p.categoryId) === c.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  /** Lecteur de code-barres ou saisie du code + Entrée : l'article est ajouté directement au panier. */
  function onEnter() {
    const code = q.trim().toUpperCase().replace(/\s+/g, '');
    if (!code) return;
    const byCode = findProductByCode(code);
    if (byCode && isLot(byCode)) { if (lotOpen(byCode)) setPicking(byCode); setQ(''); return; }
    const v = findVariantBySku(code) ?? (byCode ? productVariants(byCode.id).find((x) => x.active !== false) : undefined);
    if (v) { add([{ variantId: v.id, qty: 1 }]); setQ(''); toast(`Ajouté : ${get<Product>('products', v.productId)?.name ?? code}`); return; }
    if (found.length === 1) { pick(found[0].p); setQ(''); }
  }

  const today = todayYmd();
  const mySales = orders.filter((o) => isWalkIn(o) && o.status !== 'cancelled' && (allSales || o.createdBy === me.id || (!o.createdBy && o.createdByName === me.fullName)));
  const todaySales = mySales.filter((o) => inPeriod(o.createdAt, defaultPeriod('today')));
  const shownSales = applyDates(mySales, (o) => o.createdAt, salesPeriod, salesOrder);
  const shownTotal = shownSales.reduce((s, o) => s + Math.max(0, keptTotal(o) - (o.discount || 0)), 0);
  const todayTotal = todaySales.reduce((s, o) => s + Math.max(0, keptTotal(o) - (o.discount || 0)), 0);

  function add(a: { variantId: string; qty: number }[]) {
    const merged = [...lines];
    for (const x of a) {
      const ex = merged.find((l) => l.variantId === x.variantId && !l.lotKey);
      if (ex) ex.qty += x.qty; else merged.push({ id: newId(), variantId: x.variantId, qty: x.qty, unitPrice: linePrice(x.variantId, false) });
    }
    setLines(merged);
  }
  function pick(p: Product) {
    if (isLot(p)) { setPicking(p); return; }
    const vs = productVariants(p.id).filter((v) => v.active !== false);
    if (vs.length === 1) add([{ variantId: vs[0].id, qty: 1 }]); else setPicking(p);
  }
  const setLine = (id: string, patch: Partial<OrderLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const firstOfLot = (l: OrderLine) => !l.lotKey || priced.find((x) => x.lotKey === l.lotKey)?.id === l.id;
  const reset = () => { setLines([]); setDiscount(''); setPhone(''); setName(''); setDiscUnit('ar'); setQ(''); setInternal(false); setEmployeeId(''); };
  const tilePrice = (p: Product) => internal && !isLot(p) ? Math.min(...productVariants(p.id).map((v) => internalPrice(v.id, step) || Infinity)) : p.priceRetail;

  if (!can('pos.sell')) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Vente sur place" subtitle={`${allSales ? 'Aujourd’hui' : 'Mes ventes aujourd’hui'} : ${todaySales.length} vente(s) · ${fmtAr(todayTotal)}`} />
      <ScopeBar scope={scope} text={`Articles de vos pages : ${scope.names}`} />
      {last && (
        <div className="notice notice-ok"><Icon name="check" /><span style={{ flex: 1 }}><strong>Vente {last.number} enregistrée</strong> — {fmtAr(Math.max(0, keptTotal(last) - (last.discount || 0)))}. Le stock est mis à jour.</span><PrintButton label="Ticket" docs={[{ key: 'ticket', label: 'Ticket de caisse', build: () => ticketDoc(get<Order>('orders', last.id) ?? last, company) }]} /></div>
      )}
      <div className="pos-layout">
        <section className="pos-catalog card stack-s">
          <div className="row-between"><h2>Ajouter un article</h2><Button variant="ghost" className="btn-sm" icon="search" onClick={() => setBrowse(true)}>Parcourir le catalogue</Button></div>
          <div className="field"><input aria-label="Rechercher un article" placeholder="Rechercher ou scanner un code (Entrée pour ajouter)…" value={q} onChange={(e) => { setQ(e.target.value); setAllMatches(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} autoFocus /></div>
          {n && pages.length > 1 && <Choice label="Page" hideLabel value={cat} onChange={setCat} max={5} options={[{ value: '', label: pages.length + 1 > 5 ? 'Toutes les pages' : 'Toutes' }, ...pages.map((c) => ({ value: c.id, label: c.name }))]} />}
          {n && (found.length === 0 ? <p className="small muted">Aucun article trouvé.</p> : (
            <ul className="list pos-results">
              {found.slice(0, 8).map(({ p, avail }) => (
                <li key={p.id}><button type="button" className={`list-item list-link btn-reset ${avail <= 0 ? 'is-out' : ''}`} onClick={() => { pick(p); setQ(''); }}>
                  <Thumb src={isLot(p) ? lotPhoto(p) : p.photo} size={44} />
                  <div className="list-item-main"><span className="list-item-title">{p.name} {isLot(p) && <Badge tone="brand">Lot</Badge>}</span><p className="small muted">{p.attrs ? attrSummary(p, ', ') : p.code}</p></div>
                  <div className="list-item-side"><strong className="num">{fmtAr(Number.isFinite(tilePrice(p) as number) ? tilePrice(p) : undefined)}</strong><span className={`stock-pill ${avail <= 0 ? 'is-out' : ''}`}>{avail} {isLot(p) ? 'lot(s)' : 'en stock'}</span></div>
                </button></li>
              ))}
              {searched.others > 0 && <li style={{ padding: '4px 14px' }}><MoreMatches n={searched.others} onShow={() => setAllMatches(true)} /></li>}
              {found.length > 8 && <li className="small muted" style={{ padding: '8px 14px' }}>+ {found.length - 8} autre(s) : précisez la recherche ou parcourez le catalogue.</li>}
            </ul>
          ))}
          {!n && <p className="small muted" style={{ margin: 0 }}>Tapez un nom ou un code (ou scannez) : les articles correspondants s’affichent ici. Touchez-en un pour l’ajouter au panier.</p>}
        </section>

        <aside className="pos-cart card stack" id="pos-cart">
          <div className="row-between"><h2>Panier</h2>{lines.length > 0 && <Button variant="quiet" onClick={reset}>Vider</Button>}</div>
          <div className="segmented" role="group" aria-label="Type de vente">
            <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)}>Client</button>
            <button type="button" aria-pressed={internal} onClick={() => setInternal(true)}>Vente interne (employé)</button>
          </div>
          {internal && (
            <div className="notice"><Icon name="tag" /><span style={{ flex: 1 }}>Achat d’un employé : chaque article est vendu à son <strong>prix de revient arrondi</strong>{step > 1 ? ` aux ${fmtNum(step)} Ar supérieurs` : ' à l’ariary supérieur'}. Pas de remise ni de prix de gros.</span></div>
          )}
          {internal && <SelectField label="Employé qui achète" required value={employeeId} onChange={setEmployeeId} options={[{ value: '', label: 'Choisir l’employé…' }, ...users.map((u) => ({ value: u.id, label: u.fullName }))]} />}
          {priced.length === 0 ? <Empty icon="store" title="Touchez un article pour l’ajouter" /> : (
            <ul className="list">
              {priced.map((l) => {
                const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId);
                return (
                  <li key={l.id} className="cart-line">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong className="cart-name">{p?.name}</strong>
                      <div className="small muted">{p?.attrs ? attrSummary(p, ', ') : `${p?.code} · ${variantLabel(v)}`}</div>
                      <LotTag l={l} />
                      <StockTag variantId={l.variantId} reserved={reserved} short={short.find((x) => x.variantId === l.variantId)} />
                      {l.lotKey ? <div className="row" style={{ gap: 6, marginTop: 6 }}><span className="small">{l.qty} × {fmtAr(l.unitPrice)}</span>{firstOfLot(l) && <Button variant="quiet" className="btn-sm" icon="x" onClick={() => setLines(removeLine(lines, l))}>Retirer le lot</Button>}</div> : <>
                      {!internal && <div className="line-opts"><label><input type="checkbox" checked={!!l.wholesale} onChange={(e) => setLine(l.id, { wholesale: e.target.checked, priceManual: false })} /> Prix de gros</label></div>}
                      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: internal ? 'wrap' : 'nowrap' }}>
                        <IconButton icon="x" label="Retirer un" onClick={() => setLine(l.id, { qty: l.qty - 1 })} />
                        <input className="cell-input qty-input" inputMode="numeric" aria-label="Quantité" value={qtyDraft[l.id] ?? String(l.qty)} onFocus={(e) => e.target.select()}
                          onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setQtyDraft({ ...qtyDraft, [l.id]: v }); if (v && Number(v) > 0) setLines(lines.map((x) => (x.id === l.id ? { ...x, qty: Number(v) } : x))); }}
                          onBlur={() => { const { [l.id]: _, ...rest } = qtyDraft; setQtyDraft(rest); }} />
                        <IconButton icon="plus" label="Ajouter un" onClick={() => setLine(l.id, { qty: l.qty + 1 })} />
                        {internal
                          ? <span className="small muted">{l.unitPrice ? `${fmtAr(l.unitPrice)} (revient ${fmtAr(Math.round((v?.costAvg ?? 0) * 100) / 100)})` : <span className="neg">prix de revient manquant</span>}</span>
                          : <input className="cell-input" style={{ maxWidth: 110 }} inputMode="numeric" aria-label="Prix unitaire" value={l.unitPrice || ''} onChange={(e) => setLine(l.id, { unitPrice: parseNum(e.target.value) || 0, priceManual: true })} />}
                      </div></>}
                    </div>
                    <strong className="num">{fmtAr(l.qty * l.unitPrice)}</strong>
                  </li>
                );
              })}
            </ul>
          )}
          <AdjustList adjusts={adjusts} lines={priced} />
          {!internal && <>
          <div className="grid-2">
            <DiscountField value={discount} unit={discUnit} onChange={setDiscount} onUnit={setDiscUnit} amount={discAr} />
            <TextField label="Téléphone client (facultatif)" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
          </div>
          <TextField label="Nom du client (facultatif)" value={name} onChange={setName} />
          </>}
          {noCost.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span>{noCost.length} article(s) sans prix de revient : impossible de calculer le prix interne. Renseignez le prix de revient dans la fiche article (ou retirez-le du panier).</span></div>}
          <div className="summary-box" style={{ maxWidth: 'none' }}>
            <div><span>{fmtNum(count)} article(s)</span><strong className="num">{fmtAr(items)}</strong></div>
            {!internal && (parseNum(discount) || 0) > 0 && <div><span>Remise</span><strong className="num">− {fmtAr(parseNum(discount))}</strong></div>}
            <div className="summary-total"><span>Total</span><strong className="num pos-total">{fmtAr(total)}</strong></div>
          </div>
          {short.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span>Stock insuffisant pour {short.length} article(s) : diminuez la quantité ou choisissez un autre article.</span></div>}
          <Button block icon="check" disabled={!priced.length || short.length > 0 || (internal && (!employee || noCost.length > 0))} onClick={() => setPaying(true)}>{internal ? (employee ? `Encaisser ${fmtAr(total)} — ${employee.fullName}` : 'Choisissez l’employé') : `Encaisser ${fmtAr(total)}`}</Button>
        </aside>
      </div>

      {priced.length > 0 && <button type="button" className="pos-mobile-bar" onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })}>
        <span>Panier · {fmtNum(count)} article(s)</span><strong className="num">{fmtAr(total)}</strong><span>Encaisser ›</span>
      </button>}
      <div className="card card-flush">
        <div className="card-pad stack-s"><div className="row-between"><h2>{allSales ? 'Ventes' : 'Mes ventes'} <span className="small muted">({shownSales.length} · {fmtAr(shownTotal)})</span></h2>
          <div className="segmented" role="group" aria-label="Ventes"><button type="button" aria-pressed={!allSales} onClick={() => setAllSales(false)}>Mes ventes</button><button type="button" aria-pressed={allSales} onClick={() => setAllSales(true)}>Toutes</button></div></div>
          <ListDates period={salesPeriod} onPeriod={setSalesPeriod} order={salesOrder} onOrder={setSalesOrder} what="Date de vente" /></div>
        {shownSales.length === 0 ? <Empty icon="list" title="Aucune vente sur place sur cette période" /> : (
          <ul className="list">
            {shownSales.slice(0, 300).map((o) => (
              <li key={o.id} className="li-with-action">
                <a className="list-item list-link" href={`#/commandes/${o.id}`}>
                  <div className="list-item-main">
                    <span className="list-item-title">{o.number} · {orderLabel(o)}{o.internal && <> <Badge tone="warn">Interne</Badge></>}</span>
                    <p className="small muted">{fmtDateTime(o.createdAt)} · {o.lines.reduce((s, l) => s + l.qty, 0)} article(s) · {[...new Set(o.payments.map((p) => PAY_METHODS[p.method]))].join(' + ') || 'non payé'}{o.createdByName ? ` · ${o.createdByName}` : ''}</p>
                  </div>
                  <div className="list-item-side"><strong className="num">{fmtAr(Math.max(0, keptTotal(o) - (o.discount || 0)))}</strong>{paidTotal(o) < keptTotal(o) - (o.discount || 0) && <span className="small neg">reste {fmtAr(keptTotal(o) - (o.discount || 0) - paidTotal(o))}</span>}</div>
                </a>
                <IconButton icon="printer" label={`Imprimer le ticket ${o.number}`} onClick={() => setPrintFor(o)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {picking && <ItemPicker noChoice initialProduct={picking} onClose={() => setPicking(null)} onAdd={add} onAddLines={(ls) => setLines([...lines, ...ls])} />}
      {browse && <ItemPicker noChoice onClose={() => setBrowse(false)} onAdd={add} onAddLines={(ls) => setLines([...lines, ...ls])} />}
      {paying && <PayDialog total={total} onClose={() => setPaying(false)} onPaid={async (payments, cashGiven) => {
        const o = await createWalkInSale({ lines: priced, adjusts, discount: discAr, wholesale: undefined, phone: internal ? undefined : phone.trim() || undefined, name: internal ? undefined : name.trim() || undefined, payments, cashGiven, outsideHours: isOutsideHours(new Date(), company), employee: internal && employee ? { id: employee.id, name: employee.fullName } : undefined });
        setLast(o); reset(); setPaying(false); toast(`Vente ${o.number} enregistrée`);
        if (getMeta('printAutoTicket', false)) {
          printTo(defaultTarget(), ticketDoc(o, company)).then((m) => toast(m)).catch((e) => toast(`Ticket non imprimé : ${e?.message ?? e}`, 'error'));
        }
      }} />}
      {printFor && <PrintDialog docs={[{ key: 'ticket', label: 'Ticket de caisse', build: () => ticketDoc(printFor, company) }]} onClose={() => setPrintFor(null)} />}
    </>
  );
}

/** Encaissement : un ou plusieurs moyens de paiement, calcul de la monnaie à rendre. */
function PayDialog({ total, onClose, onPaid }: { total: number; onClose: () => void; onPaid: (p: { amount: number; method: PayMethod; ref?: string }[], cashGiven?: number) => Promise<void> }) {
  const [pays, setPays] = useState<{ method: PayMethod; amount: string; ref: string }[]>([{ method: 'cash', amount: String(total), ref: '' }]);
  const [given, setGiven] = useState('');
  const [busy, setBusy] = useState(false);
  const sum = pays.reduce((s, p) => s + (parseAr(p.amount) || 0), 0);
  const cash = pays.filter((p) => p.method === 'cash').reduce((s, p) => s + (parseAr(p.amount) || 0), 0);
  const change = given ? (parseAr(given) || 0) - cash : 0;
  const missing = total - sum;
  const set = (i: number, patch: Partial<{ method: PayMethod; amount: string; ref: string }>) => setPays(pays.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Modal title={`Encaisser ${fmtAr(total)}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={sum <= 0 || sum > total} onClick={async () => {
        setBusy(true);
        try { await onPaid(pays.map((p) => ({ amount: parseAr(p.amount) || 0, method: p.method, ref: p.ref.trim() || undefined })), parseAr(given) || undefined); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
      }}>{missing > 0 ? `Valider (reste ${fmtAr(missing)})` : 'Valider la vente'}</Button></>}>
      <div className="stack">
        {pays.map((p, i) => (
          <div key={i} className="card stack-s" style={{ background: 'var(--surface-2)' }}>
            <div className="segmented" role="group" aria-label="Moyen de paiement">
              {(Object.keys(PAY_METHODS) as PayMethod[]).map((m) => <button key={m} type="button" aria-pressed={p.method === m} onClick={() => set(i, { method: m })}>{PAY_METHODS[m]}</button>)}
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><TextField label="Montant (Ar)" value={p.amount} onChange={(v) => set(i, { amount: v })} inputMode="numeric" /></div>
              {p.method !== 'cash' && <div style={{ flex: 1 }}><TextField label="Référence" value={p.ref} onChange={(v) => set(i, { ref: v })} /></div>}
              {pays.length > 1 && <IconButton icon="x" label="Retirer" onClick={() => setPays(pays.filter((_, j) => j !== i))} />}
            </div>
          </div>
        ))}
        {missing > 0 && <Button variant="ghost" icon="plus" onClick={() => setPays([...pays, { method: 'mvola', amount: String(missing), ref: '' }])}>Ajouter un autre moyen ({fmtAr(missing)} restants)</Button>}
        {sum > total && <div className="notice notice-danger"><Icon name="alert" /><span>Le total des paiements dépasse le montant de la vente.</span></div>}
        {cash > 0 && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}><TextField label="Espèces données par le client (Ar)" value={given} onChange={setGiven} inputMode="numeric" /></div>
            <div className="total-box" style={{ flex: 1 }}><span className="small muted">Monnaie à rendre</span><strong className={`num ${change < 0 ? 'neg' : ''}`}>{given ? fmtAr(Math.abs(change)) : '—'}</strong>{change < 0 && <span className="small neg">il manque</span>}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
