// Commandes clients : saisie (comme le cahier), préparation, remise au livreur, retour, échanges.
import { useMyScope, variantPage } from '../lib/scope';
import { ScopeBar } from '../ui/scope';
import { useMemo, useState } from 'react';
import { audit, currentUser, useCan } from '../lib/auth';
import { bizNow, get, newId, save, useTable } from '../lib/db';
import { fmtAr, fmtNum, nextNumber, parseNum, productVariants, useCatalog, variantLabel, type Product, type Variant , photoOf, matchQuery, matchExact, searchItems, productText, parseAr, type Category } from '../lib/catalog';
import {
  addPayment, availableOf, backToPrepare, cancelOrder, cancelDeliveryToShop, MAX_REPORTS, reportCount, canPostpone, postponeOrder, cancelAfterReports, CHANNELS, completeAtShop, confirmOrder, dispatchOrder, exchangeBalance, findCustomer, fmtPhone,
  canReassign, customerIdFor, choiceQty, hasPendingChoice, needsSettlement, reassignCourier, isOutsideHours, isPickupZone, isWalkIn, orderLabel, handOverAtShop, itemsTotal, keptTotal, linePrice, markReady, normPhone, ORDER_STATUS, orderTotal, paidTotal, PAY_METHODS, recordReturn, remaining,
  priceOrder, removeLine, reservedIndex, totalQty, useWholesale, editPayment, courierSplit, withLineWholesale, discountAr, stockShortages,
  type Courier, type Customer, type Order, type OrderLine, type OrderStatus, type PayMethod, type Payment, type Zone, orderText, customerText, findCustomerBy,
} from '../lib/orders';
import { useCompany } from '../lib/settings';
import { correctWalkInSale, netMoves, refundSuggested, voidOrder } from '../lib/corrections';
import { ACCOUNTS, ACCOUNT_IDS, FEE_STATE, feeState, payDeferredFees, settleCourier, type AccountId } from '../lib/money';
import { Help, DiscountField, Badge, Button, Confirm, Empty, FilterSelect, IconButton, Modal, MoreMatches, PageHead, SelectField, TextField, fmtDate, fmtDateTime, navigate, toast, useRoute, DateSort, type DateOrder, useKeep } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PayLines, payLinesSum, splitInTwo, type PayLine } from '../ui/payments';
import { ListDates, defaultPeriod, inPeriod, type ListOrder, type Period } from '../ui/period';
import { Thumb, categoryOptions } from './Products';
import { siblingsOf } from '../lib/attrs';
import { deliveryNoteDoc, parcelLabelDoc, ticketDoc } from '../lib/print';
import { PrintButton, type DocChoice } from '../ui/print';
import { ProspectForm, ProspectList } from './Prospects';
import { Zones } from './Deliveries';
import { bucketOf, type Prospect } from '../lib/prospects';
import { AdjustList, LotPicker, LotTag, lotPhoto } from './Lots';
import { SettleModal, settleRow } from './Settle';
import { allPages } from '../lib/boosts';
import { isLot, lotAvailable, lotOpen } from '../lib/lots';

const CLOSED: OrderStatus[] = ['delivered', 'partial', 'refused'];
const TABS: { key: string; label: string; statuses: OrderStatus[]; match?: (o: Order) => boolean }[] = [
  { key: 'enregistrees', label: 'Enregistrées', statuses: ['new', 'confirmed'] },
  { key: 'attente', label: 'En attente de livraison', statuses: ['ready'] },
  { key: 'livraison', label: 'En livraison', statuses: ['out'] },
  { key: 'regler', label: 'À régler (livreur)', statuses: CLOSED, match: (o) => needsSettlement(o) },
  { key: 'terminees', label: 'Terminées', statuses: CLOSED, match: (o) => !needsSettlement(o) },
  { key: 'annulees', label: 'Annulées', statuses: ['cancelled'] },
];
const inTab = (t: (typeof TABS)[number], o: Order) => t.statuses.includes(o.status) && (!t.match || t.match(o));
/**
 * Regroupe des commandes ou ventes par page (catégorie principale des articles : Boxer homme, Pyjamas homme…).
 * Une commande dont les articles sont de plusieurs pages va dans « Plusieurs pages » ; sans article, dans « Sans article ».
 * L'ordre des commandes dans chaque groupe est gardé ; les pages sont par ordre alphabétique.
 */
export function groupOrdersByPage(list: Order[]): { key: string; label: string; items: Order[] }[] {
  const groups = new Map<string, { key: string; label: string; items: Order[] }>();
  for (const o of list) {
    const sold = o.lines.filter((l) => !l.isChoice);
    const ids = [...new Set((sold.length ? sold : o.lines).map((l) => variantPage(l.variantId)))];
    const key = ids.length > 1 ? '~multi' : ids.length ? ids[0] || '~none' : '~empty';
    const label = key === '~multi' ? 'Plusieurs pages' : key === '~empty' ? 'Sans article' : key === '~none' ? 'Sans catégorie' : get<{ name: string }>('categories', key)?.name ?? 'Sans catégorie';
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key)!.items.push(o);
  }
  return [...groups.values()].sort((a, b) => Number(a.key.startsWith('~')) - Number(b.key.startsWith('~')) || a.label.localeCompare(b.label, 'fr', { numeric: true }));
}

/** En-tête d'un groupe de commandes : nom de la page, nombre et montant. */
export function OrderGroupHead({ label, count, total }: { label: string; count: number; total: number }) {
  return <li className="list-group-head row-between"><span>{label} <span className="muted">({count})</span></span><span className="num">{fmtAr(total)}</span></li>;
}

const hasPage = (o: Order, pageId: string) => o.lines.some((l) => variantPage(l.variantId) === pageId) || (o.lines.length === 0 && pageId === '');

export function OrdersPage() {
  const route = useRoute();
  const raw = route.split('/')[2]?.split('?')[0];
  const seg = raw && ({ confirmer: 'enregistrees', preparer: 'enregistrees', pretes: 'attente' } as Record<string, string>)[raw] || raw;
  if (seg && seg !== 'suivre' && !TABS.some((t) => t.key === seg)) return <OrderDetail id={seg} />;
  return <OrderList tabKey={seg} />;
}

export function OrderStatusBadge({ o }: { o: Order }) {
  const st = ORDER_STATUS[o.status];
  return <>
    <Badge tone={st.tone}>{o.kind === 'exchange' ? `Échange · ${st.label}` : st.label}</Badge>
    {hasPendingChoice(o) && <Badge tone="danger">Choix à préciser ({choiceQty(o)})</Badge>}
    {reportCount(o) > 0 && o.status !== 'cancelled' && <Badge tone={reportCount(o) >= MAX_REPORTS ? 'danger' : 'warn'}>Reportée {reportCount(o)}/{MAX_REPORTS}{o.wantedDate && ['new', 'confirmed', 'ready'].includes(o.status) ? ` · au ${new Date(`${o.wantedDate}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}` : ''}</Badge>}
  </>;
}

function OrderList({ tabKey }: { tabKey?: string }) {
  const can = useCan();
  const orders = useTable<Order>('orders');
  useTable<Zone>('zones');
  const couriers = useTable<Courier>('couriers');
  const [q, setQ] = useKeep('orders.q', '');
  const [courierF, setCourierF] = useKeep('orders.courier', '');
  const [pageF, setPageF] = useKeep('orders.page', '');
  const [creating, setCreating] = useState(false);
  const [following, setFollowing] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [settling, setSettling] = useState(false);
  const prospects = useTable<Prospect>('prospects');
  const scope = useMyScope();
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS.find((t) => !['terminees', 'annulees'].includes(t.key) && orders.some((o) => !isWalkIn(o) && inTab(t, o))) ?? TABS[0];
  const done = ['terminees', 'annulees'].includes(tab.key);
  // Période et ordre : commandes en cours = toutes, plus anciennes d'abord (à traiter) ; terminées = aujourd'hui, récentes d'abord.
  const [periodOpen, setPeriodOpen] = useKeep<Period>('orders.periodOpen', defaultPeriod('all'));
  const [periodDone, setPeriodDone] = useKeep<Period>('orders.periodDone', defaultPeriod('today'));
  const [orderOpen, setOrderOpen] = useKeep<ListOrder>('orders.orderOpen', 'old');
  const [orderDone, setOrderDone] = useKeep<ListOrder>('orders.orderDone', 'new');
  const period = done ? periodDone : periodOpen, setPeriod = done ? setPeriodDone : setPeriodOpen;
  const order = done ? orderDone : orderOpen, setOrder = done ? setOrderDone : setOrderOpen;
  const regler = tab.key === 'regler';
  const pages = allPages().filter((p) => !scope.on || scope.pages.includes(p.id));
  // Filtres de l'onglet : livreur, page, recherche (et période pour les commandes terminées / annulées).
  // Recherche : priorité aux correspondances exactes (« PH6 » ne ramène pas « PH60 ») quand il y en a.
  const exactOnly = useMemo(() => !!q.trim() && orders.some((o) => !isWalkIn(o) && matchExact(orderText(o), q)), [orders, q]);
  const base = (o: Order) => !isWalkIn(o) && scope.mine(o) && (!courierF || o.courierId === courierF) && (!pageF || hasPage(o, pageF)) && (!q.trim() || (exactOnly ? matchExact(orderText(o), q) : matchQuery(orderText(o), q)));
  const list = useMemo(() => orders
    .filter((o) => base(o) && inTab(tab, o))
    .filter((o) => (done && q.trim()) || inPeriod(o.createdAt, period))
    .sort((a, b) => (order === 'new' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt))),
  [orders, tab.key, q, period, scope.on, courierF, pageF, order]);
  // La recherche reste dans l'onglet ; on indique seulement où d'autres commandes correspondent.
  const elsewhere = q.trim() ? TABS.filter((t) => t.key !== tab.key).map((t) => ({ t, n: orders.filter((o) => base(o) && inTab(t, o)).length })).filter((x) => x.n) : [];
  const selected = list.filter((o) => sel.includes(o.id));
  const selCouriers = [...new Set(selected.map((o) => o.courierId))];
  const selCourier = selCouriers.length === 1 ? couriers.find((c) => c.id === selCouriers[0]) : undefined;
  const selDue = selected.reduce((t, o) => t + settleRow(o).e, 0);
  const switchTab = (k: string) => { setSel([]); navigate('/commandes/' + k); };

  return (
    <>
      <PageHead title="Commandes" subtitle="Commandes Facebook, téléphone et autres, jusqu’à la livraison et au règlement du livreur."
        actions={can('orders.create') && <><Button variant="ghost" icon="users" onClick={() => setFollowing(true)}>Client à suivre</Button><Button icon="plus" onClick={() => setCreating(true)}>Nouvelle commande</Button></>} />
      <ScopeBar scope={scope} mineLabel="Mes commandes" text={scope.strict ? 'Vous voyez seulement les commandes de vos pages' : "Vous voyez les commandes que vous avez enregistrées. Les livraisons du jour restent visibles par tous dans Livraisons."} />
      <div className="tabs" role="tablist">
        {(() => { const n = prospects.filter((x) => x.status === 'open' && scope.mine({ createdBy: x.ownerId, createdByName: x.ownerName }) && bucketOf(x) !== 'later').length; return <button role="tab" aria-selected={tabKey === 'suivre'} onClick={() => switchTab('suivre')}>À suivre{n ? <span className="tab-count tab-count-hot">{n}</span> : null}</button>; })()}
        {TABS.map((t) => {
          const n = orders.filter((o) => !isWalkIn(o) && scope.mine(o) && inTab(t, o)).length;
          return <button key={t.key} role="tab" aria-selected={tabKey !== 'suivre' && tab.key === t.key} onClick={() => switchTab(t.key)}>{t.label}{!['terminees', 'annulees'].includes(t.key) && n ? <span className={`tab-count ${t.key === 'regler' ? 'tab-count-hot' : ''}`}>{n}</span> : null}</button>;
        })}
      </div>
      {tabKey === 'suivre' ? <ProspectList /> : <>
      <div className="card stack-s order-filters">
        <div className="row">
          <div className="field" style={{ flex: '2 1 240px' }}><input aria-label="Rechercher" placeholder={`Rechercher dans « ${tab.label} » : téléphone, nom, n°, lieu, article…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><FilterSelect label="Livreur" value={courierF} onChange={(v) => { setCourierF(v); setSel([]); }} options={[{ value: '', label: 'Tous les livreurs' }, ...couriers.filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => ({ value: c.id, label: c.name }))]} /></div>
          {pages.length > 1 && <div className="field" style={{ flex: '1 1 160px' }}><FilterSelect label="Page" value={pageF} onChange={setPageF} options={[{ value: '', label: 'Toutes les pages' }, ...pages.map((p) => ({ value: p.id, label: p.name }))]} /></div>}
        </div>
        <ListDates period={period} onPeriod={setPeriod} order={order} onOrder={setOrder} what="Date de la commande" />
        {(q || courierF || pageF) && <div><Button variant="ghost" className="btn-sm" icon="x" onClick={() => { setQ(''); setCourierF(''); setPageF(''); setSel([]); }}>Effacer les filtres</Button></div>}
        {elsewhere.length > 0 && <p className="small muted" style={{ margin: 0 }}>Aussi trouvé dans : {elsewhere.map(({ t, n }, i) => <span key={t.key}>{i ? ', ' : ''}<button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => switchTab(t.key)}>{t.label} ({n})</button></span>)}</p>}
      </div>
      {regler && list.length > 0 && (
        <div className="card settle-bar">
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={selected.length === list.length} onChange={(e) => setSel(e.target.checked ? list.map((o) => o.id) : [])} /> Tout sélectionner</label>
          <span className="small">{selected.length ? <>{selected.length} sélectionnée(s){selCourier ? <> · {selCourier.name} doit verser <strong>{fmtAr(selDue)}</strong></> : null}</> : 'Cochez les commandes que le livreur règle maintenant.'}</span>
          {selCouriers.length > 1 && <span className="small neg">Plusieurs livreurs : choisissez un livreur dans le filtre.</span>}
          {can('couriers.settle') && <Button icon="check" disabled={!selCourier} onClick={() => setSettling(true)}>Régler la sélection</Button>}
        </div>
      )}
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title={q || courierF || pageF ? 'Aucune commande trouvée dans cet onglet' : regler ? 'Aucune commande à régler' : 'Aucune commande ici'}>{tab.key === 'enregistrees' && can('orders.create') && !q && <Button icon="plus" onClick={() => setCreating(true)}>Saisir une commande</Button>}</Empty> : (
          <ul className="list">{groupOrdersByPage(list).map((g) => [
            <OrderGroupHead key={'h' + g.key} label={g.label} count={g.items.length} total={g.items.reduce((s, o) => s + (o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o)), 0)} />,
            ...g.items.map((o) => regler ? (
            <li key={o.id} className="row-check">
              <input type="checkbox" aria-label={`Sélectionner ${o.number}`} checked={sel.includes(o.id)} onChange={(e) => setSel(e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id))} />
              <ul className="list" style={{ flex: 1, minWidth: 0 }}><OrderRow o={o} /></ul>
            </li>
          ) : <OrderRow key={o.id} o={o} />)])}</ul>
        )}
      </div>
      </>}
      {settling && selCourier && <SettleModal courier={selCourier} orders={selected} onClose={() => setSettling(false)} onDone={() => setSel([])} />}
      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={(o) => navigate('/commandes/' + o.id)} />}
      {following && <ProspectForm onClose={() => setFollowing(false)} onSaved={() => navigate('/commandes/suivre')} />}
    </>
  );
}

export function OrderRow({ o }: { o: Order }) {
  const zone = get<Zone>('zones', o.zoneId || '');
  const courier = get<Courier>('couriers', o.courierId || '');
  const firstV = o.lines[0] && get<Variant>('variants', o.lines[0].variantId);
  const firstP = firstV && get<Product>('products', firstV.productId);
  const rest = remaining(o);
  return (
    <li>
      <a className="list-item list-link" href={`#/commandes/${o.id}`}>
        <Thumb src={firstP?.photo} />
        <div className="list-item-main">
          <div className="row" style={{ gap: 8 }}>
            <span className="list-item-title">{orderLabel(o)}</span>
            <OrderStatusBadge o={o} />
            {o.outsideHours && ['new', 'confirmed'].includes(o.status) && <Badge>Hors heures</Badge>}
            {isPickupZone(o.zoneId) && !['delivered', 'partial', 'refused', 'cancelled'].includes(o.status) && <Badge>Sur boutique</Badge>}
          </div>
          <p className="small muted">{o.number}{o.phone ? ` · ${fmtPhone(o.phone)}` : ''} · {zone?.name || 'Zone ?'}{o.place ? ` — ${o.place}` : ''}</p>
          <p className="small muted">{fmtNum(totalQty(o))} article(s){o.lines.some((l) => l.isChoice) ? ` + ${o.lines.filter((l) => l.isChoice).reduce((s, l) => s + l.qty, 0)} en choix` : ''}{courier ? ` · ${courier.name}` : ''} · {fmtDateTime(o.createdAt)}</p>
          {needsSettlement(o) && <p className="small"><Badge tone="warn">À régler avec {courier?.name ?? 'le livreur'}</Badge> le livreur doit verser {fmtAr(settleRow(o).e)}</p>}
          {['delivered', 'partial', 'refused'].includes(o.status) && (() => { const fs = feeState(o); return fs !== 'none' ? <p className="small fee-line">Frais livreur {fmtAr(courierSplit(o).fee)} · <Badge tone={FEE_STATE[fs].tone}>{FEE_STATE[fs].label}</Badge></p> : null; })()}
        </div>
        <div className="list-item-side">
          <strong className="num">{fmtAr(o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o))}</strong>
          {paidTotal(o) > 0 && <span className="small muted">payé {fmtAr(paidTotal(o))}</span>}
          {rest > 0 && !['cancelled', 'refused'].includes(o.status) && <span className="small">reste {fmtAr(rest)}</span>}
        </div>
      </a>
    </li>
  );
}

// ---------- Stock affiché à côté de chaque article ----------
export function StockTag({ variantId, reserved, short }: { variantId: string; reserved: Map<string, number>; short?: { qty: number; available: number } }) {
  const a = Math.max(0, availableOf(variantId, reserved));
  return <span className={`stock-tag ${short ? 'is-short' : a <= 3 ? 'is-low' : ''}`}>{short ? `Stock insuffisant : ${short.available} disponible(s)` : `Stock : ${a} disponible(s)`}</span>;
}

// ---------- Client existant ----------
/** Recherche d'un client déjà connu (téléphone, nom Facebook, nom, lieu) : ses informations se remplissent toutes seules. */
export function CustomerSearch({ onPick }: { onPick: (c: Customer) => void }) {
  const customers = useTable<Customer>('customers');
  const [q, setQ] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const found = q.trim().length >= 2 ? customers.filter((c) => matchQuery(customerText(c), q)).slice(0, 6) : [];
  return (
    <div className="stack-s cust-search">
      <div className="field"><label htmlFor="cust-q">Client déjà connu ?</label>
        <input id="cust-q" value={q} onChange={(e) => { setQ(e.target.value); setDone(null); }} placeholder="Rechercher : téléphone, nom Facebook, nom, lieu…" autoComplete="off" /></div>
      {done && <p className="small ok-text"><Icon name="check" size={14} /> {done} : informations remplies.</p>}
      {!done && found.length > 0 && <ul className="list card" style={{ padding: 0 }}>{found.map((c) => (
        <li key={c.id}><button type="button" className="list-item list-link btn-reset" onClick={() => { onPick(c); setDone(c.name || c.facebook || fmtPhone(c.phone)); setQ(''); }}>
          <span className="avatar">{(c.name || c.facebook || '?').charAt(0).toUpperCase()}</span>
          <div className="list-item-main"><span className="list-item-title">{c.name || c.facebook || fmtPhone(c.phone)}</span><p className="small muted">{[c.phone && fmtPhone(c.phone), c.facebook && `FB : ${c.facebook}`, c.place].filter(Boolean).join(' · ')}</p></div>
        </button></li>
      ))}</ul>}
      {!done && q.trim().length >= 2 && !found.length && <p className="small muted">Aucun client trouvé : remplissez les champs ci-dessous, la fiche sera créée avec la commande.</p>}
    </div>
  );
}

// ---------- Saisie d'une commande ----------
/** Données reprises d'un client à suivre au moment de le transformer en commande. */
export interface OrderPrefill { phone?: string; name?: string; facebook?: string; zoneId?: string; place?: string; lines?: { variantId: string; qty: number }[]; notes?: string; prepay?: { amount: number; method: PayMethod; ref?: string } }
export function OrderForm({ order, exchangeOf, onClose, onSaved, prefill: pre }: { order?: Order; exchangeOf?: { parent: Order; returnLines: { variantId: string; qty: number; unitPrice: number }[] }; onClose: () => void; onSaved?: (o: Order) => void; prefill?: OrderPrefill }) {
  const company = useCompany();
  const zones = useTable<Zone>('zones').filter((z) => z.active !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  useCatalog();
  const base = exchangeOf?.parent;
  const [phone, setPhone] = useState(order?.phone ?? base?.phone ?? pre?.phone ?? '');
  const [name, setName] = useState(order?.name ?? base?.name ?? pre?.name ?? '');
  const [facebook, setFacebook] = useState(order?.facebook ?? base?.facebook ?? pre?.facebook ?? '');
  const [pickedCust, setPickedCust] = useState<string | undefined>(order?.customerId ?? base?.customerId);
  const [channel, setChannel] = useState<Order['channel']>(order?.channel ?? base?.channel ?? 'facebook');
  const [zoneId, setZoneId] = useState(order?.zoneId ?? base?.zoneId ?? pre?.zoneId ?? '');
  const [place, setPlace] = useState(order?.place ?? base?.place ?? pre?.place ?? '');
  const couriers = useTable<Courier>('couriers').filter((c) => c.active !== false);
  const [courierId, setCourierId] = useState(order?.courierId ?? (pre?.zoneId && !isPickupZone(pre.zoneId) ? couriers.find((x) => x.zoneIds?.includes(pre.zoneId!))?.id : undefined) ?? '');
  const [newCourier, setNewCourier] = useState('');
  const [fee, setFee] = useState(String(order?.deliveryFee ?? (base ? get<Zone>('zones', base.zoneId || '')?.fee ?? '' : pre?.zoneId ? (isPickupZone(pre.zoneId) ? 0 : get<Zone>('zones', pre.zoneId)?.fee ?? '') : '')));
  const [wantedDate, setWantedDate] = useState(order?.wantedDate ?? '');
  const [lines, setLines] = useState<OrderLine[]>(order?.lines ? withLineWholesale(order.lines) : (pre?.lines ?? []).map((l) => ({ id: newId(), variantId: l.variantId, qty: l.qty, unitPrice: linePrice(l.variantId, false) })));
  const [discount, setDiscount] = useState(order?.discountPct ? String(order.discountPct) : order?.discount ? String(order.discount) : '');
  const [discUnit, setDiscUnit] = useState<'ar' | 'pct'>(order?.discountPct ? 'pct' : 'ar');
  const [notes, setNotes] = useState(order?.notes ?? pre?.notes ?? '');
  // Paiements déjà reçus à la création (plusieurs possibles : espèces + MVola…).
  const [pays, setPays] = useState<{ amount: string; method: PayMethod; ref: string }[]>([{ amount: pre?.prepay?.amount ? String(pre.prepay.amount) : '', method: pre?.prepay?.method ?? 'mvola', ref: pre?.prepay?.ref ?? '' }]);
  const prepay = pays[0].amount; const setPrepay = (v: string) => setPays([{ ...pays[0], amount: v }, ...pays.slice(1)]);
  const prepayMethod = pays[0].method;
  const prepaid = pays.reduce((s, x) => s + (parseAr(x.amount) || 0), 0);
  const setPay = (i: number, patch: Partial<{ amount: string; method: PayMethod; ref: string }>) => setPays(pays.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [picking, setPicking] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => findCustomer(phone), [phone]);
  const { lines: priced, adjusts } = priceOrder(lines);
  const itemsAr = itemsTotal({ lines: priced, adjusts });
  const discAr = discountAr(discount, discUnit, itemsAr);
  const short = stockShortages(priced, order?.id);
  const shortOf = (vid: string) => short.find((x) => x.variantId === vid);
  const reservedNow = useMemo(() => reservedIndex(order?.id), [order?.id, priced.length]);
  const draft = { lines: priced, adjusts, discount: discAr, deliveryFee: parseNum(fee) || 0, payments: [], status: 'new', kind: exchangeOf ? 'exchange' : 'order', credit: exchangeOf ? exchangeOf.returnLines.reduce((s, r) => s + r.qty * r.unitPrice, 0) : 0 } as unknown as Order;
  const total = exchangeOf ? exchangeBalance(draft) : orderTotal(draft);

  function onPhone(v: string) {
    setPhone(v);
    const c = findCustomer(v);
    if (c && !order) {
      if (!name) setName(c.name || '');
      if (!facebook && c.facebook) setFacebook(c.facebook);
      if (!zoneId && c.zoneId) { setZoneId(c.zoneId); setFee(String(get<Zone>('zones', c.zoneId)?.fee ?? '')); }
      if (!place && c.place) setPlace(c.place);
    }
  }
  const pickup = isPickupZone(zoneId);
  const walkIn = false;
  function onChannel(v: string) {
    setChannel(v as Order['channel']);
    if (v === 'shop') {
      const z = zones.find((x) => isPickupZone(x));
      if (z) { setZoneId(z.id); setFee('0'); }
    }
  }
  function onZone(id: string) {
    setZoneId(id);
    const z = get<Zone>('zones', id);
    if (z) setFee(isPickupZone(z) ? '0' : String(z.fee));
    if (!courierId && z && !isPickupZone(z)) { const c = couriers.find((x) => x.zoneIds?.includes(z.id)); if (c) setCourierId(c.id); }
  }

  async function submit() {
    setError(null);
    const p = normPhone(phone);
    if (!walkIn && p.length < 9) return setError('Le contact du client est obligatoire (numéro de téléphone).');
    if (walkIn && phone.trim() && p.length < 9) return setError('Numéro de téléphone incomplet (ou laissez-le vide).');
    if (!zoneId) return setError('Le lieu de livraison est obligatoire : choisissez une zone (ou « Sur boutique »).');
    if (!pickup) {
      if (!place.trim()) return setError('Indiquez le lieu précis de livraison.');
      if (!((parseNum(fee) ?? 0) > 0)) return setError('Les frais de livraison sont obligatoires pour une livraison.');
      if (!courierId || (courierId === '__new' && !newCourier.trim())) return setError('Choisissez le livreur de cette commande.');
    }
    if (!priced.length && !exchangeOf) return setError('Ajoutez au moins un article.');
    if (priced.some((l) => l.qty <= 0)) return setError('Chaque article doit avoir une quantité.');
    if (short.length) return setError(`Stock insuffisant : ${short.map((x) => { const v = get<Variant>('variants', x.variantId); return `${get<Product>('products', v?.productId || '')?.name ?? '?'} ${variantLabel(v)} (demandé ${x.qty}, disponible ${x.available})`; }).join(' ; ')}. Diminuez la quantité ou choisissez un autre article.`);
    setBusy(true);
    try {
      // Fiche client : créée ou complétée automatiquement.
      let cid = courierId;
      if (!pickup && cid === '__new') { const [c] = await save('couriers', { name: newCourier.trim(), active: true }); cid = c.id; }
      let cust = (pickedCust ? get<Customer>('customers', pickedCust) : undefined) ?? findCustomerBy(p, facebook);
      if (p && !cust) { const [c] = await save('customers', { id: customerIdFor(p), phone: p, name: name.trim() || undefined, facebook: facebook.trim() || undefined, zoneId: zoneId || undefined, place: place.trim() || undefined }); cust = c as Customer; }
      else if (cust) await save('customers', { id: cust.id, phone: cust.phone || p || undefined, phone2: cust.phone && p && normPhone(cust.phone) !== p && !cust.phone2 ? p : cust.phone2, name: cust.name || name.trim() || undefined, facebook: cust.facebook || facebook.trim() || undefined, zoneId: zoneId || cust.zoneId, place: place.trim() || cust.place });
      const data: Partial<Order> = {
        phone: p, name: name.trim() || undefined, facebook: facebook.trim() || undefined, channel, customerId: cust?.id, zoneId: zoneId || undefined, place: pickup ? (place.trim() || undefined) : place.trim(), placeToConfirm: false,
        courierId: pickup ? undefined : cid, deliveryFee: pickup ? 0 : parseNum(fee) || 0, wantedDate: wantedDate || undefined, lines: priced, adjusts: adjusts.length ? adjusts : (order?.adjusts ? [] : undefined), discount: discAr, discountPct: discUnit === 'pct' ? Number(String(discount).replace(',', '.')) || undefined : undefined, notes: notes.trim() || undefined,
      };
      if (order) {
        await save('orders', { id: order.id, ...data });
        await audit('Commande modifiée', order.number, 'orders', order.id);
        toast('Commande enregistrée'); onClose();
      } else {
        const u = currentUser();
        const now = new Date(bizNow());
        const payments = pays.filter((x) => (parseAr(x.amount) || 0) > 0).map((x) => ({ id: newId(), at: now.toISOString(), amount: parseAr(x.amount)!, method: x.method, ref: x.ref.trim() || undefined, receivedBy: 'shop' as const, userName: u?.fullName }));
        const [o] = await save('orders', {
          ...data, number: nextNumber(exchangeOf ? 'ECH' : 'C', 'orders'), kind: exchangeOf ? 'exchange' : 'order', parentId: exchangeOf?.parent.id,
          returnLines: exchangeOf?.returnLines, credit: draft.credit || undefined, payments, status: 'confirmed', statusDates: { confirmed: now.toISOString() },
          outsideHours: isOutsideHours(now, company), createdBy: u?.id, createdByName: u?.fullName,
        });
        await audit(exchangeOf ? 'Échange créé' : 'Commande créée', `${(o as Order).number} — ${fmtPhone(p)} — ${fmtAr(total)}`, 'orders', o.id);
        toast(`Commande ${(o as Order).number} enregistrée${payments.length ? ` — payé ${fmtAr(payments.reduce((s, x) => s + x.amount, 0))} (${payments.map((x) => PAY_METHODS[x.method]).join(' + ')})` : ''}`); onClose(); onSaved?.(o as Order);
      }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const setLine = (id: string, patch: Partial<OrderLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  return (
    <Modal title={order ? `Modifier ${order.number}` : exchangeOf ? `Échange — ${exchangeOf.parent.number}` : 'Nouvelle commande'} onClose={onClose} wide
      footer={<><span className="small" style={{ marginRight: 'auto' }}>{exchangeOf ? (total >= 0 ? 'Le client paie ' : 'À rendre au client ') : 'Total à payer '}<strong className="num">{fmtAr(Math.abs(total))}</strong></span><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{order ? 'Enregistrer' : 'Enregistrer la commande'}</Button></>}>
      <div className="stack">
        {!order && !exchangeOf && <CustomerSearch onPick={(c) => {
          setPickedCust(c.id); setPhone(c.phone || ''); setName(c.name || ''); setFacebook(c.facebook || '');
          if (c.zoneId) onZone(c.zoneId); if (c.place) setPlace(c.place);
        }} />}
        <div className="grid-2">
          <SelectField label="Commande reçue par" value={channel} onChange={onChannel} options={Object.entries(CHANNELS).filter(([k]) => k !== 'shop').map(([value, label]) => ({ value, label }))} />
          <div />
          <div className="stack-s">
            <TextField label={walkIn ? 'Contact du client (facultatif)' : 'Contact du client'} required={!walkIn} value={phone} onChange={onPhone} type="tel" inputMode="tel" autoFocus={!order} placeholder="034 00 000 00" />
            {known && !order && <p className="small"><Icon name="check" size={14} /> Client connu : <strong>{known.name || fmtPhone(known.phone)}</strong>{known.place ? ` · ${known.place}` : ''}</p>}
          </div>
          <TextField label="Nom du client (facultatif)" value={name} onChange={setName} />
          <TextField label="Nom Facebook (facultatif)" value={facebook} onChange={setFacebook} placeholder="Tel qu’il apparaît dans Messenger" />
          <SelectField label="Zone de livraison" required value={zoneId} onChange={onZone} options={[{ value: '', label: '— Choisir —' }, ...zones.map((z) => ({ value: z.id, label: `${z.name} (${fmtAr(z.fee)})` }))]} />
          <TextField label={pickup ? 'Lieu (facultatif)' : 'Lieu précis'} required={!pickup} value={place} onChange={setPlace} placeholder={pickup ? 'Boutique' : 'Ex. Analakely, devant la pharmacie'} />
          <TextField label="Frais de livraison (Ar)" required={!pickup} value={pickup ? '0' : fee} onChange={setFee} inputMode="numeric" disabled={pickup} hint={pickup ? 'Retrait en boutique : pas de frais.' : 'Obligatoire. Rempli selon la zone, modifiable.'} />
          {!pickup && <SelectField label="Livreur" required value={courierId} onChange={setCourierId} options={[{ value: '', label: '— Choisir —' }, ...couriers.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nouveau livreur…' }]} />}
          {!pickup && courierId === '__new' && <TextField label="Nom du nouveau livreur" required value={newCourier} onChange={setNewCourier} />}
        </div>
        <p className="small muted">Zone manquante ou frais à changer ? <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => setZonesOpen(true)}>Gérer les zones de livraison</button> (la commande en cours est gardée)</p>

        {exchangeOf && (
          <div className="notice"><Icon name="refresh" /><span>Articles repris au client : {exchangeOf.returnLines.map((r) => `${r.qty} × ${variantLabel(get<Variant>('variants', r.variantId))}`).join(', ')} — valeur {fmtAr(draft.credit)} déduite.</span></div>
        )}

        <div className="row-between"><h3>{exchangeOf ? 'Nouveaux articles' : 'Articles'}</h3><Button variant="ghost" icon="plus" onClick={() => setPicking(true)}>Ajouter un article</Button></div>
        {priced.length === 0 ? <Empty icon="store" title="Aucun article" /> : (
          <div className="table-wrap">
            <table className="table lines-table">
              <thead><tr><th>Article</th><th style={{ width: 90 }}>Qté</th><th style={{ width: 120 }}>Prix (Ar)</th><th className="t-num">Montant</th><th></th></tr></thead>
              <tbody>
                {priced.map((l) => {
                  const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId);
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Thumb src={photoOf(v)} size={48} zoom alt={p?.name} /><div><strong>{p?.name}</strong><div className="small muted">{p?.code} · {variantLabel(v)}</div>
                          <LotTag l={l} />
                          <StockTag variantId={l.variantId} reserved={reservedNow} short={shortOf(l.variantId)} /></div></div>
                        {!l.lotKey && <div className="line-opts">
                          <label><input type="checkbox" checked={!!l.wholesale} onChange={(e) => setLine(l.id, { wholesale: e.target.checked, priceManual: false })} /> Prix de gros</label>
                          <label><input type="checkbox" checked={!!l.isChoice} onChange={(e) => setLine(l.id, { isChoice: e.target.checked })} /> Envoyé en choix</label>
                        </div>}
                      </td>
                      <td data-label="Qté">{l.lotKey ? <span className="num">{l.qty}</span> : <input className="cell-input" inputMode="numeric" aria-label="Quantité" value={l.qty || ''} onChange={(e) => setLine(l.id, { qty: parseNum(e.target.value) || 0 })} />}</td>
                      <td data-label="Prix (Ar)">{l.lotKey ? <span className="num">{fmtAr(l.unitPrice)}</span> : <input className="cell-input" inputMode="numeric" aria-label="Prix" value={l.unitPrice || ''} onChange={(e) => setLine(l.id, { unitPrice: parseNum(e.target.value) || 0, priceManual: true })} />}</td>
                      <td className="t-num">{l.isChoice ? <span className="muted">choix</span> : fmtAr(l.qty * l.unitPrice)}</td>
                      <td className="t-actions">{(!l.lotKey || priced.find((x) => x.lotKey === l.lotKey)?.id === l.id) && <IconButton icon="x" label={l.lotKey ? 'Retirer le lot' : 'Retirer'} onClick={() => setLines(removeLine(lines, l))} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <AdjustList adjusts={adjusts} lines={priced} />
        {short.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span>Stock insuffisant pour {short.length} article(s) : diminuez la quantité ou choisissez un autre article.</span></div>}

        <div className="grid-2">
          <DiscountField value={discount} unit={discUnit} onChange={setDiscount} onUnit={setDiscUnit} amount={discAr} />
          <TextField label="Date de livraison souhaitée" type="date" value={wantedDate} onChange={setWantedDate} />
        </div>
        {!order && (
          <div className="card stack" style={{ background: 'var(--surface-2)' }}>
            <strong className="small">Paiement déjà reçu (facultatif)</strong>
            <Help>Par défaut, le client paie tout à la livraison. S’il a déjà payé (tout ou une partie) par Mobile Money, indiquez-le : le livreur n’encaissera que le reste.</Help>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="chip" onClick={() => setPrepay(String(Math.max(0, total - draft.deliveryFee)))}>Articles payés</button>
              {draft.deliveryFee > 0 && <button type="button" className="chip" onClick={() => setPrepay(String(Math.max(0, total)))}>Tout payé (articles + frais)</button>}
              {total > 0 && <button type="button" className="chip" onClick={() => setPays(splitInTwo(Math.max(0, total)).map((l) => ({ amount: l.amount, method: l.method, ref: '' })))}>En 2 tranches (espèces + mobile money)</button>}
              {prepaid > 0 && <button type="button" className="chip" onClick={() => setPays([{ amount: '', method: 'mvola', ref: '' }])}>Rien payé</button>}
            </div>
            {pays.map((x, i) => (
              <div key={i} className="grid-2 pay-row">
                <TextField label={pays.length > 1 ? `Montant ${i + 1} (Ar)` : 'Montant (Ar)'} value={x.amount} onChange={(v) => setPay(i, { amount: v })} inputMode="numeric" hint={x.amount && parseAr(x.amount) ? `= ${fmtAr(parseAr(x.amount))}` : undefined} />
                <SelectField label="Moyen" value={x.method} onChange={(v) => setPay(i, { method: v as PayMethod })} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />
                {x.method !== 'cash' && <TextField label="Référence de la transaction" value={x.ref} onChange={(v) => setPay(i, { ref: v })} />}
                {pays.length > 1 && <div><Button variant="quiet" onClick={() => setPays(pays.filter((_, j) => j !== i))}>Retirer ce paiement</Button></div>}
              </div>
            ))}
            {pays.length > 1 && prepaid > 0 && <p className="small" style={{ margin: 0 }}>Total reçu : <strong>{fmtAr(prepaid)}</strong> ({pays.filter((x) => parseAr(x.amount)).map((x) => `${fmtAr(parseAr(x.amount) || 0)} ${PAY_METHODS[x.method]}`).join(' + ')}){total - prepaid > 0 ? <> · le livreur encaissera <strong>{fmtAr(total - prepaid)}</strong></> : null}</p>}
            <div><Button variant="ghost" className="btn-sm" icon="plus" onClick={() => setPays([...pays, { amount: '', method: pays.some((x) => x.method === 'cash') ? 'mvola' : 'cash', ref: '' }])}>Ajouter un autre moyen de paiement</Button></div>
          </div>
        )}
        <TextField label="Observations" value={notes} onChange={setNotes} placeholder="Ex. appeler avant de venir, client au bureau jusqu’à 16 h…" />

        <div className="summary-box">
          <div><span>Articles</span><strong className="num">{fmtAr(itemsTotal(draft))}</strong></div>
          {draft.discount > 0 && <div><span>Remise{discUnit === 'pct' ? ` (${discount} %)` : ''}</span><strong className="num">− {fmtAr(draft.discount)}</strong></div>}
          {exchangeOf && <div><span>Articles repris</span><strong className="num">− {fmtAr(draft.credit)}</strong></div>}
          <div><span>Frais de livraison</span><strong className="num">{fmtAr(draft.deliveryFee)}</strong></div>
          <div className="summary-total"><span>{exchangeOf ? (total >= 0 ? 'Le client paie' : 'À rendre au client') : 'Total à payer'}</span><strong className="num">{fmtAr(Math.abs(total))}</strong></div>
          {prepaid ? <div><span>Déjà payé</span><strong className="num">− {fmtAr(prepaid)}</strong></div> : null}
          {prepaid ? <div className="summary-total"><span>Reste à payer par le client</span><strong className="num">{fmtAr(Math.max(0, total - prepaid))}</strong></div> : null}
          {draft.deliveryFee > 0 && !exchangeOf && (() => { const x = courierSplit({ ...draft, payments: prepaid ? [{ id: 'x', at: '', amount: prepaid, method: prepayMethod, receivedBy: 'shop' }] : [] } as Order); return (
            <div className="small muted" style={{ display: 'block' }}>Le livreur encaissera <strong>{fmtAr(x.toCollect)}</strong> pour la boutique{x.feeKept ? <> + ses frais {fmtAr(x.feeKept)}</> : null}{x.feeOwed ? <> ; frais {fmtAr(x.feeOwed)} déjà payés, à lui reverser en espèces</> : null}.</div>
          ); })()}
        </div>
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
      {zonesOpen && <Modal title="Zones de livraison" wide onClose={() => setZonesOpen(false)} footer={<Button onClick={() => setZonesOpen(false)}><Icon name="chevronLeft" size={16} /> Revenir à la commande</Button>}><Zones /></Modal>}
      {picking && <ItemPicker excludeOrderId={order?.id} onClose={() => setPicking(false)} onAddLines={(ls) => setLines([...lines, ...ls])} onAdd={(add) => {
        const merged = [...lines];
        for (const a of add) {
          const ex = merged.find((l) => l.variantId === a.variantId && !!l.isChoice === !!a.isChoice && !l.lotKey);
          if (ex) ex.qty += a.qty; else merged.push({ id: newId(), variantId: a.variantId, qty: a.qty, isChoice: a.isChoice, unitPrice: linePrice(a.variantId, false) });
        }
        setLines(merged);
      }} />}
    </Modal>
  );
}

/** Choisir des articles : recherche, puis quantité par taille/couleur avec le stock disponible. */
/** L'article est dans la catégorie choisie ou dans une de ses sous-catégories. */
function inCategory(p: Product, cat: string) {
  if (!cat) return true;
  let c = p.categoryId ? get<Category>('categories', p.categoryId) : undefined;
  while (c) { if (c.id === cat) return true; c = c.parentId ? get<Category>('categories', c.parentId) : undefined; }
  return false;
}

export function ItemPicker({ excludeOrderId, onClose, onAdd, onAddLines, noChoice, initialProduct, unknownQty }: { excludeOrderId?: string; onClose: () => void; onAdd: (a: { variantId: string; qty: number; isChoice?: boolean }[]) => void; onAddLines?: (lines: OrderLine[]) => void; noChoice?: boolean; initialProduct?: Product; unknownQty?: boolean }) {
  const { products, categories } = useCatalog();
  const reserved = useMemo(() => reservedIndex(excludeOrderId), [excludeOrderId]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useKeep('picker.cat', '');
  const [limit, setLimit] = useState(60);
  const [prod, setProd] = useState<Product | null>(initialProduct ?? null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [want, setWant] = useState<Record<string, boolean>>({});
  const scope = useMyScope();
  const n = q.trim().toLowerCase();
  const [allMatches, setAllMatches] = useState(false);
  const usable = products.filter((p) => p.active !== false && scope.product(p.id) && (isLot(p) ? !!onAddLines && lotOpen(p) : true));
  // Catégories proposées dans le filtre : seulement celles (et leurs parents) qui ont des articles à vendre ici.
  const catIds = new Set(usable.flatMap((p) => { const ids: string[] = []; let c = p.categoryId ? get<Category>('categories', p.categoryId) : undefined; while (c) { ids.push(c.id); c = c.parentId ? get<Category>('categories', c.parentId) : undefined; } return ids; }));
  const catOpts = categoryOptions(categories.filter((c) => catIds.has(c.id)), 'Toutes les catégories');
  const catF = catIds.has(cat) ? cat : '';
  const searched = searchItems(usable.filter((p) => inCategory(p, catF)), productText, n, allMatches);
  const sorted = searched.list.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  const found = sorted.slice(0, limit);
  // Articles voisins proposés en choix : même modèle seulement (autres tailles / couleurs), et qui répondent à la recherche.
  const family = prod?.attrs ? [prod, ...siblingsOf(prod).filter((x) => !n || (matchExact(productText(prod), n) ? matchExact(productText(x), n) : matchQuery(productText(x), n)))] : prod ? [prod] : [];
  const variants = family.flatMap((p) => productVariants(p.id).filter((v) => v.active !== false));
  const cellLabel = (v: Variant) => { const p = get<Product>('products', v.productId); return p?.attrs ? (p.id === prod?.id ? `${p.name} (choisi)` : p.name) : variantLabel(v); };
  const picked = variants.flatMap((v) => [
    ...(parseNum(qty[v.id] ?? '') ? [{ variantId: v.id, qty: parseNum(qty[v.id])! }] : []),
    ...(parseNum(choice[v.id] ?? '') ? [{ variantId: v.id, qty: parseNum(choice[v.id])!, isChoice: true }] : []),
    ...(unknownQty && want[v.id] && !parseNum(qty[v.id] ?? '') ? [{ variantId: v.id, qty: 0 }] : []),
  ]);
  if (prod && isLot(prod) && onAddLines) return <LotPicker p={prod} reserved={reserved} onBack={initialProduct ? undefined : () => setProd(null)} onClose={onClose} onAdd={onAddLines} />;
  return (
    <Modal title={prod ? prod.name : 'Ajouter un article'} onClose={onClose} wide
      footer={prod ? <><Button variant="ghost" onClick={() => { setProd(null); setQty({}); setChoice({}); setWant({}); }}>Autre article</Button><Button disabled={!picked.length} onClick={() => { onAdd(picked); onClose(); }}>Ajouter</Button></> : undefined}>
      {!prod ? (
        <div className="stack">
          <ScopeBar scope={scope} />
          <div className="row">
            <div className="field" style={{ flex: '2 1 220px' }}><input autoFocus aria-label="Rechercher un article" placeholder="Rechercher un code ou un nom" value={q} onChange={(e) => { setQ(e.target.value); setAllMatches(false); setLimit(60); }} /></div>
            {catOpts.length > 2 && <div className="field" style={{ flex: '1 1 180px' }}><FilterSelect label="Catégorie" value={catF} onChange={(v) => { setCat(v); setLimit(60); }} options={catOpts} /></div>}
          </div>
          <MoreMatches n={searched.others} onShow={() => setAllMatches(true)} />
          <ul className="list card" style={{ padding: 0 }}>
            {found.map((p) => {
              const avail = isLot(p) ? lotAvailable(p, (vid) => availableOf(vid, reserved)) : productVariants(p.id).reduce((s, v) => s + Math.max(0, availableOf(v.id, reserved)), 0);
              return (
                <li key={p.id}><button className="list-item list-link btn-reset" onClick={() => setProd(p)}>
                  <Thumb src={isLot(p) ? lotPhoto(p) : p.photo} size={72} zoom alt={p.name} />
                  <div className="list-item-main"><span className="list-item-title">{p.name} {isLot(p) && <Badge tone="brand">Lot</Badge>}</span><p className="small muted">{p.code} · {fmtAr(p.priceRetail)}{isLot(p) ? ' le lot' : ''}{p.priceWholesale ? ` · gros ${fmtAr(p.priceWholesale)}` : ''}</p></div>
                  <span className={`stock-pill ${avail <= 0 ? 'is-out' : ''}`}>{avail}</span>
                </button></li>
              );
            })}
            {sorted.length > found.length && <li style={{ padding: '10px 14px' }}><Button variant="ghost" className="btn-sm" onClick={() => setLimit(limit + 100)}>Afficher plus ({sorted.length - found.length})</Button></li>}
            {!found.length && <Empty icon="search" title={catF ? 'Aucun article trouvé dans cette catégorie' : 'Aucun article trouvé'} />}
          </ul>
        </div>
      ) : (
        <div className="stack">
          <div className="row" style={{ gap: 12 }}><Thumb src={prod.photo} size={120} zoom alt={prod.name} /><div><strong>{prod.code}</strong> {prod.name}<p className="small muted">{fmtAr(prod.priceRetail)}{prod.priceWholesale ? ` · gros ${fmtAr(prod.priceWholesale)}` : ''}</p></div></div>
          {family.length > 1 && <p className="small muted">Les articles voisins (une seule variante différente, ex. les autres tailles) sont proposés pour envoyer des choix.</p>}
          {!noChoice && <p className="small muted">« Vendu » : ce que le client achète. « En choix » : les tailles ou couleurs envoyées en plus pour qu’il choisisse sur place.</p>}
          <div className="variant-grid">
            {variants.map((v) => {
              const a = availableOf(v.id, reserved);
              return (
                <div key={v.id} className={`variant-cell ${a <= 0 ? 'is-out' : ''}`}>
                  {variants.some((x) => x.photo) && <Thumb src={photoOf(v)} size={84} zoom alt={`${prod.code} ${variantLabel(v)}`} />}
                  <span className="small"><strong>{cellLabel(v)}</strong> · <span className={a <= 0 ? 'neg' : 'muted'}>{a > 0 ? `${a} dispo` : 'épuisé'}</span></span>
                  <label className="small">{noChoice ? 'Quantité' : 'Vendu'}<input className="cell-input" inputMode="numeric" placeholder="0" value={qty[v.id] ?? ''} onChange={(e) => setQty({ ...qty, [v.id]: e.target.value })} /></label>
                  {unknownQty && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={!!want[v.id] || !!parseNum(qty[v.id] ?? '')} onChange={(e) => setWant({ ...want, [v.id]: e.target.checked })} /> Intéressé (quantité pas encore connue)</label>}
                  {!noChoice && <label className="small">En choix<input className="cell-input" inputMode="numeric" placeholder="0" value={choice[v.id] ?? ''} onChange={(e) => setChoice({ ...choice, [v.id]: e.target.value })} /></label>}
                </div>
              );
            })}
          </div>
          {picked.some((p) => availableOf(p.variantId, reserved) < p.qty) && <div className="notice"><Icon name="alert" /><span>Attention : certaines quantités dépassent le stock disponible.</span></div>}
        </div>
      )}
    </Modal>
  );
}

// ---------- Détail d'une commande ----------
/** Documents imprimables d'une commande : ticket, et bon de livraison si elle part avec un livreur. */
function printDocs(o: Order, company: ReturnType<typeof useCompany>): DocChoice[] {
  const d: DocChoice[] = [{ key: 'ticket', label: isWalkIn(o) ? 'Ticket de caisse' : 'Ticket client', build: () => ticketDoc(o, company) }];
  if (!isWalkIn(o) && !isPickupZone(o.zoneId)) d.unshift({ key: 'bon', label: 'Bon de livraison', build: () => deliveryNoteDoc(o, company) });
  if (!isWalkIn(o) && !['delivered', 'partial', 'refused', 'cancelled'].includes(o.status)) d.unshift({ key: 'etiquette', label: 'Étiquette du colis (58 mm)', build: () => parcelLabelDoc(o, company) });
  return d;
}

function OrderDetail({ id }: { id: string }) {
  const can = useCan();
  const company = useCompany();
  useCatalog();
  const orders = useTable<Order>('orders');
  const couriers = useTable<Courier>('couriers');
  useTable<Zone>('zones');
  const o = orders.find((x) => x.id === id);
  const [editPay, setEditPay] = useState<Payment | null>(null);
  const [modal, setModal] = useState<'' | 'edit' | 'dispatch' | 'return' | 'pay' | 'cancel' | 'exchange' | 'shop' | 'pickup' | 'reassign' | 'settle' | 'postpone'>('');
  const [payFee, setPayFee] = useState(false);
  if (!o) return <Empty icon="list" title="Commande introuvable"><Button variant="ghost" onClick={() => navigate('/commandes')}>Retour</Button></Empty>;
  const zone = get<Zone>('zones', o.zoneId || '');
  const courier = couriers.find((c) => c.id === o.courierId);
  const closed = ['delivered', 'partial', 'refused'].includes(o.status);
  const due = o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o);
  const rest = due - paidTotal(o);
  const parent = o.parentId ? orders.find((x) => x.id === o.parentId) : undefined;
  const children = orders.filter((x) => x.parentId === o.id);
  const act = (fn: () => Promise<void>, msg: string) => async () => { await fn(); toast(msg); };

  return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => history.back()}>Commandes</Button></div>
      <div className="card stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-s">
            <div className="row" style={{ gap: 8 }}><h1 style={{ fontSize: '1.6rem' }}>{o.number}</h1><OrderStatusBadge o={o} />{o.outsideHours && <Badge>Reçue hors heures</Badge>}</div>
            <p className="muted">{o.internal ? `Vente interne — employé : ${o.employeeName || '?'} (prix de revient arrondi)` : CHANNELS[o.channel]} · {fmtDateTime(o.createdAt)}{o.createdByName ? ` · par ${o.createdByName}` : ''}</p>
          </div>
          <div className="page-actions">
            <PrintButton docs={printDocs(o, company)} />
            {can('orders.create') && ['new', 'confirmed', 'ready'].includes(o.status) && <Button variant="ghost" icon="edit" onClick={() => setModal('edit')}>Modifier</Button>}
          </div>
        </div>
        <div className="kv-row">
          <div><span className="small muted">Client</span><strong>{orderLabel(o)}</strong></div>
          {o.phone && <div><span className="small muted">Contact</span><a href={`tel:${o.phone}`}><strong>{fmtPhone(o.phone)}</strong></a></div>}
          <div><span className="small muted">Livraison</span><strong>{zone?.name || '—'}{o.place && !isPickupZone(zone) ? ` — ${o.place}` : ''}</strong></div>
          {o.wantedDate && <div><span className="small muted">Souhaitée le</span><strong>{fmtDate(o.wantedDate)}</strong></div>}
          {courier && <div><span className="small muted">Livreur</span><strong>{courier.name}</strong>{canReassign(o) && can('orders.dispatch') && <button className="link-btn" onClick={() => setModal('reassign')}>Changer</button>}</div>}
        </div>
        {o.notes && <p className="small" style={{ whiteSpace: 'pre-line' }}><strong>Observations :</strong> {o.notes}</p>}
        {parent && <p className="small">Échange de la commande <a href={`#/commandes/${parent.id}`}>{parent.number}</a></p>}
        {children.map((c) => <p key={c.id} className="small">Échange lié : <a href={`#/commandes/${c.id}`}>{c.number}</a> ({ORDER_STATUS[c.status].label})</p>)}
        {hasPendingChoice(o) && <div className="notice notice-danger"><Icon name="alert" /><span style={{ flex: 1 }}><strong>Choix du client à préciser</strong> : {choiceQty(o)} pièce(s) sont parties en choix. Dès que le livreur revient, touchez « Préciser le choix du client » et indiquez ce que le client a gardé. Tant que ce n’est pas fait, le versement du livreur pour cette livraison est bloqué.</span></div>}

        <div className="action-bar">
          {['new', 'confirmed'].includes(o.status) && !isWalkIn(o) && can('orders.prepare') && <Button icon="package" onClick={act(async () => { await markReady(o); }, 'Commande préparée : en attente de livraison')}>{isPickupZone(o.zoneId) ? 'Préparée — le client vient la chercher' : 'Préparée — en attente de livraison'}</Button>}
          {o.status === 'ready' && !isPickupZone(o.zoneId) && can('orders.dispatch') && <Button icon="truck" onClick={() => setModal('dispatch')}>Remettre au livreur (en livraison)</Button>}
          {o.status === 'ready' && !isPickupZone(o.zoneId) && !can('orders.dispatch') && <span className="small muted row" style={{ gap: 6 }}><Icon name="truck" size={16} />Le responsable choisira le livreur.</span>}
          {['new', 'confirmed', 'ready'].includes(o.status) && can('orders.create') && <Button variant={isPickupZone(o.zoneId) ? 'primary' : 'ghost'} icon="store" onClick={() => setModal('pickup')}>{isPickupZone(o.zoneId) ? 'Remise au client en boutique' : 'Retrait en boutique (le client vient la chercher)'}</Button>}
          {o.status === 'ready' && can('orders.prepare') && <Button variant="ghost" onClick={act(async () => { await backToPrepare(o); }, 'Commande revenue à « enregistrée »')}>Revenir à « enregistrée »</Button>}
          {o.status === 'out' && can('deliveries.manage') && <Button icon="inbox" onClick={() => setModal('return')}>{hasPendingChoice(o) ? 'Préciser le choix du client' : 'Confirmer le retour du livreur'}</Button>}
          {needsSettlement(o) && courier && can('couriers.settle') && <Button icon="wallet" onClick={() => setModal('settle')}>Régler avec {courier.name}</Button>}
          {o.kind === 'exchange' && ['new', 'confirmed', 'ready'].includes(o.status) && can('returns.manage') && <Button variant="ghost" onClick={() => setModal('shop')}>Échange fait en boutique</Button>}
          {((!closed && o.status !== 'cancelled') || rest !== 0) && o.status !== 'cancelled' && can('orders.create') && <Button variant="ghost" icon="plus" onClick={() => setModal('pay')}>{rest < 0 ? 'Rendre l’argent au client' : 'Paiement reçu'}</Button>}
          {closed && o.status !== 'refused' && can('returns.manage') && <Button variant="ghost" icon="refresh" onClick={() => setModal('exchange')}>Retour / échange</Button>}
          {canPostpone(o) && (can('orders.create') || can('deliveries.manage')) && <Button variant="ghost" icon="clock" onClick={() => setModal('postpone')}>{reportCount(o) >= MAX_REPORTS ? `Reportée ${MAX_REPORTS} fois : annuler ?` : `À reporter (${reportCount(o)}/${MAX_REPORTS})`}</Button>}
          {!closed && o.status !== 'cancelled' && can('orders.create') && <Button variant="danger" icon="trash" onClick={() => setModal('cancel')}>Annuler / supprimer</Button>}
          {closed && isWalkIn(o) && can('records.correct') && <Button variant="ghost" icon="edit" onClick={() => setModal('correct')}>Modifier / corriger la vente</Button>}
          {closed && can('records.correct') && <Button variant="danger" icon="trash" onClick={() => setModal('void')}>Annuler / supprimer la vente</Button>}
          {closed && !can('records.correct') && <span className="small muted">Erreur sur cette vente ? Le gérant ou le super-admin peut la corriger ou l’annuler.</span>}
        </div>
      </div>

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Article</th><th className="t-num">Qté</th>{closed && <th className="t-num">Gardé</th>}<th className="t-num">Prix</th><th className="t-num">Montant</th></tr></thead>
            <tbody>
              {o.lines.map((l) => {
                const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId);
                const q = closed ? (l.qtyKept ?? 0) : l.isChoice ? 0 : l.qty;
                return (
                  <tr key={l.id}>
                    <td><div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Thumb src={photoOf(v)} size={56} zoom alt={p?.name} /><div><strong>{p?.name}</strong><div className="small muted">{p?.code} · {variantLabel(v)}{l.isChoice ? ' · en choix' : ''}</div><LotTag l={l} /></div></div></td>
                    <td className="t-num num">{l.qty}</td>
                    {closed && <td className={`t-num num ${(l.qtyKept ?? 0) < l.qty && !l.isChoice ? 'neg' : ''}`}>{l.qtyKept ?? 0}</td>}
                    <td className="t-num">{fmtAr(l.unitPrice)}</td>
                    <td className="t-num">{q ? fmtAr(q * l.unitPrice) : '—'}</td>
                  </tr>
                );
              })}
              {(o.returnLines || []).map((r, i) => {
                const v = get<Variant>('variants', r.variantId); const p = v && get<Product>('products', v.productId);
                return <tr key={'r' + i}><td><span className="small">↩ Repris : <strong>{p?.name}</strong> {variantLabel(v)}</span></td><td className="t-num num">{r.qty}</td>{closed && <td></td>}<td className="t-num">{fmtAr(r.unitPrice)}</td><td className="t-num">− {fmtAr(r.qty * r.unitPrice)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        {(o.adjusts || []).length > 0 && <div style={{ margin: '12px 16px 0' }}><AdjustList adjusts={o.adjusts} lines={o.lines} closed={closed} /></div>}
        <div className="summary-box" style={{ margin: 16 }}>
          <div><span>Articles</span><strong className="num">{fmtAr(closed ? keptTotal(o) : itemsTotal(o))}</strong></div>
          {o.discount > 0 && <div><span>Remise</span><strong className="num">− {fmtAr(o.discount)}</strong></div>}
          {o.credit ? <div><span>Articles repris</span><strong className="num">− {fmtAr(o.credit)}</strong></div> : null}
          <div><span>Frais de livraison{closed && o.feeCharged !== o.deliveryFee ? ` (prévu ${fmtAr(o.deliveryFee)})` : ''}</span><strong className="num">{fmtAr(closed ? o.feeCharged ?? 0 : o.deliveryFee)}</strong></div>
          <div className="summary-total"><span>{o.kind === 'exchange' && due < 0 ? 'À rendre au client' : 'Total'}</span><strong className="num">{fmtAr(Math.abs(due))}</strong></div>
          <div><span>Payé</span><strong className="num">{fmtAr(paidTotal(o))}</strong></div>
          {o.status !== 'cancelled' && <div className="summary-total"><span>{rest >= 0 ? 'Reste à encaisser' : 'Trop perçu / à rendre'}</span><strong className={`num ${rest > 0 ? '' : rest < 0 ? 'neg' : 'pos'}`}>{fmtAr(Math.abs(rest))}</strong></div>}
          {!isWalkIn(o) && !isPickupZone(o.zoneId) && !['cancelled', 'delivered', 'partial', 'refused'].includes(o.status) && (() => { const x = courierSplit(o); return (
            <p className="small muted" style={{ margin: 0 }}>Le livreur encaisse <strong>{fmtAr(x.toCollect)}</strong> pour la boutique{x.feeKept ? ` + ses frais ${fmtAr(x.feeKept)}` : ''}{x.feeOwed ? ` ; frais ${fmtAr(x.feeOwed)} déjà payés : à lui reverser` : ''}.</p>
          ); })()}
        </div>
      </div>

      {(() => { const fs = feeState(o); if (fs === 'none' || fs === 'pending' && o.status === 'out') return null; const fc = get<Courier>('couriers', o.courierId || ''); const f = courierSplit(o).fee; return (
        <div className={`card row-between fee-card fee-${fs}`}>
          <div><h3>Frais de livraison du livreur{fc ? ` (${fc.name})` : ''} : {fmtAr(f)}</h3>
            <p className="small"><Badge tone={FEE_STATE[fs].tone}>{FEE_STATE[fs].label}</Badge>{fs === 'paid' && o.feePaidAt ? ` le ${fmtDateTime(o.feePaidAt)}${o.feePaidHow ? ` (${o.feePaidHow})` : ''}` : ''}{fs === 'pending' ? ' — à régler au retour du livreur.' : ''}</p></div>
          {fs === 'deferred' && fc && can('couriers.settle') && <Button onClick={() => setPayFee(true)}>Payer les frais</Button>}
          {payFee && fc && <PayFeeModal order={o} courier={fc} amount={f} onClose={() => setPayFee(false)} />}
        </div>
      ); })()}

      {(o.payments || []).length > 0 && (
        <div className="card stack-s">
          <h2>Paiements</h2>
          <ul className="list">
            {o.payments.map((p) => (
              <li key={p.id} className="list-item" style={{ padding: '10px 0' }}>
                <div className="list-item-main"><strong className="num">{fmtAr(p.amount)}</strong> · {PAY_METHODS[p.method]}{p.ref ? ` · réf. ${p.ref}` : ''}
                  <p className="small muted">{fmtDateTime(p.at)} · {p.receivedBy === 'shop' ? 'reçu par la boutique' : `encaissé par ${get<Courier>('couriers', p.courierId || '')?.name || 'le livreur'}`}{p.userName ? ` · saisi par ${p.userName}` : ''}</p>
                  {(p.edits || []).map((e, i) => <p key={i} className="small" style={{ color: 'var(--warn, #9a6700)' }}>Corrigé le {fmtDateTime(e.at)} par {e.user || '—'} : {fmtAr(e.fromAmount)}{e.fromMethod !== e.toMethod ? ` (${PAY_METHODS[e.fromMethod]})` : ''} → {fmtAr(e.toAmount)}{e.fromMethod !== e.toMethod ? ` (${PAY_METHODS[e.toMethod]})` : ''}{e.reason ? ` — ${e.reason}` : ''}</p>)}
                </div>
                {can('users.manage') && <IconButton icon="edit" label="Corriger ce paiement" onClick={() => setEditPay(p)} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card stack-s">
        <h2>Historique</h2>
        <ul className="timeline">
          {[
            ...(Object.entries(o.statusDates || {}) as [OrderStatus, string][]).map(([s, at]) => ({ at, text: ORDER_STATUS[s].label, user: '' })),
            ...(o.events || []),
          ].sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => <li key={i}><strong>{e.text}</strong> <span className="small muted">{fmtDateTime(e.at)}{e.user ? ` · ${e.user}` : ''}</span></li>)}
        </ul>
      </div>

      {modal === 'edit' && <OrderForm order={o} onClose={() => setModal('')} />}
      {modal === 'dispatch' && <DispatchModal orders={[o]} onClose={() => setModal('')} />}
      {modal === 'return' && <ReturnModal order={o} onClose={() => setModal('')} />}
      {modal === 'settle' && courier && <SettleModal courier={courier} orders={[o]} onClose={() => setModal('')} />}
      {modal === 'pay' && <PayModal order={o} onClose={() => setModal('')} />}
      {modal === 'exchange' && <ExchangeStart order={o} onClose={() => setModal('')} />}
      {modal === 'shop' && <ShopExchangeModal order={o} onClose={() => setModal('')} />}
      {modal === 'pickup' && <PickupModal order={o} onClose={() => setModal('')} />}
      {modal === 'reassign' && <ReassignModal order={o} onClose={() => setModal('')} />}
      {editPay && <EditPaymentModal order={o} payment={editPay} onClose={() => setEditPay(null)} />}
      {modal === 'cancel' && <CancelModal order={o} onClose={() => setModal('')} />}
      {modal === 'postpone' && <PostponeModal order={o} onClose={() => setModal('')} />}
      {modal === 'void' && <VoidModal order={o} onClose={() => setModal('')} />}
      {modal === 'correct' && <CorrectSaleModal order={o} onClose={() => setModal('')} />}
    </>
  );
}

export function DispatchModal({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const couriers = useTable<Courier>('couriers').filter((c) => c.active !== false);
  const zoneIds = new Set(orders.map((o) => o.zoneId));
  const preset = orders.length && orders.every((o) => o.courierId && o.courierId === orders[0].courierId) ? orders[0].courierId : undefined;
  const suggested = couriers.find((c) => c.id === preset) ?? couriers.find((c) => c.zoneIds?.some((z) => zoneIds.has(z)));
  const [courierId, setCourierId] = useState(suggested?.id ?? couriers[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={orders.length > 1 ? `Remettre ${orders.length} commandes au livreur` : `Remettre ${orders[0]?.number ?? ''} au livreur`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!courierId || (courierId === '__new' && !newName.trim())} onClick={async () => {
        setBusy(true);
        let cid = courierId;
        if (cid === '__new') { const [c] = await save('couriers', { name: newName.trim(), active: true }); cid = c.id; }
        try { for (const o of orders) await dispatchOrder(o, cid); } catch (e: any) { toast(e.message, 'error'); setBusy(false); return; }
        toast(`${orders.length} commande(s) remise(s) au livreur`); setBusy(false); onClose();
      }}>Remettre</Button></>}>
      <div className="stack">
        <SelectField label="Livreur" required value={courierId} onChange={setCourierId} options={[...couriers.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nouveau livreur…' }]} />
        {courierId === '__new' && <TextField label="Nom du livreur" required value={newName} onChange={setNewName} autoFocus />}
        <p className="small muted">Les articles (y compris ceux en choix) sortent du stock de la boutique. Ce qui revient sera remis en stock au retour du livreur.</p>
        <ul className="small">{orders.map((o) => <li key={o.id}>{o.number} — {orderLabel(o)} — à encaisser {fmtAr(Math.max(0, remaining(o)))}</li>)}</ul>
      </div>
    </Modal>
  );
}

export function ReturnModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [kept, setKept] = useState<Record<string, string>>(() => Object.fromEntries(o.lines.map((l) => [l.id, l.isChoice ? '' : String(l.qty)])));
  const hasChoice = o.lines.some((l) => l.isChoice);
  const choiceMissing = o.lines.filter((l) => l.isChoice && (kept[l.id] ?? '').trim() === '');
  const keptNum = Object.fromEntries(o.lines.map((l) => [l.id, Math.max(0, Math.min(l.qty, parseNum(kept[l.id]) ?? 0))]));
  const anyKept = Object.values(keptNum).some((n) => n > 0);
  const [fee, setFee] = useState<string | null>(null);
  const feeVal = fee == null ? (anyKept || (o.kind === 'exchange' && !o.lines.length) ? o.deliveryFee : 0) : parseNum(fee) ?? 0;
  const sim = { ...o, status: 'delivered', lines: o.lines.map((l) => ({ ...l, qtyKept: keptNum[l.id] })), feeCharged: feeVal } as Order;
  const toCollect = Math.max(0, (o.kind === 'exchange' ? exchangeBalance(sim) : orderTotal(sim)) - paidTotal(o));
  const [amount, setAmount] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toShop, setToShop] = useState(false);
  const [postpone, setPostpone] = useState(false);
  const amountVal = amount == null ? toCollect : parseAr(amount) ?? 0;
  const c = o.kind === 'exchange' ? exchangeBalance(sim) : orderTotal(sim);
  const prepaid = (o.payments || []).filter((p) => p.receivedBy === 'shop').reduce((t, p) => t + p.amount, 0);
  const paidHow = [...new Set((o.payments || []).filter((p) => p.receivedBy === 'shop').map((p) => `${PAY_METHODS[p.method]}${p.ref ? ' réf. ' + p.ref : ''}`))].join(', ');
  const simPaid = { ...sim, payments: [...(o.payments || []), ...(amountVal ? [{ id: 'sim', at: '', amount: amountVal, method, receivedBy: 'courier' as const, courierId: o.courierId }] : [])] } as Order;
  const x = courierSplit(simPaid);
  const eDue = x.toCollect + x.feeKept;
  const toSettle = !!o.courierId && !isPickupZone(o.zoneId);
  return (
    <Modal title={hasChoice ? `Préciser le choix du client — ${o.number}` : `Retour du livreur — ${o.number}`} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={choiceMissing.length > 0} onClick={async () => {
        setBusy(true);
        try { await recordReturn(o, { kept: keptNum, feeCharged: feeVal, collected: [{ amount: amountVal, method, ref: ref.trim() || undefined }], note: note.trim() || undefined }); }
        catch (e: any) { toast(e.message, 'error'); setBusy(false); return; }
        toast(toSettle ? 'Retour confirmé : la commande passe dans « À régler (livreur) »' : 'Retour enregistré'); setBusy(false); onClose();
      }}>{choiceMissing.length ? `Indiquez le choix (${choiceMissing.length} ligne(s))` : 'Confirmer le retour'}</Button></>}>
      <div className="stack">
        {hasChoice && <div className="notice"><Icon name="alert" /><span>Cette livraison contient des articles <strong>en choix</strong>. Pour chaque ligne « choix », indiquez combien de pièces le client a <strong>gardées</strong> (0 s’il les a toutes rendues).</span></div>}
        <div className="row">
          <Button variant="ghost" onClick={() => setKept(Object.fromEntries(o.lines.map((l) => [l.id, String(l.isChoice ? 0 : l.qty)])))}>{hasChoice ? 'Tout livré, choix tous rendus' : 'Tout livré'}</Button>
          <Button variant="ghost" onClick={() => setKept(Object.fromEntries(o.lines.map((l) => [l.id, '0'])))}>Tout refusé</Button>
          {o.status === 'out' && <Button variant="ghost" icon="store" onClick={() => setToShop(true)}>Le client vient chercher en boutique</Button>}
          {o.status === 'out' && <Button variant="ghost" icon="clock" onClick={() => setPostpone(true)}>À reporter ({reportCount(o)}/{MAX_REPORTS})</Button>}
        </div>
        {postpone && <PostponeModal order={o} onClose={() => setPostpone(false)} onDone={onClose} />}
        {toShop && <Confirm title="Livraison annulée : retrait en boutique" confirmLabel="Annuler la livraison" message={<div className="stack-s"><p>Le livreur rapporte le colis : les articles reviennent en boutique, <strong>réservés pour ce client</strong>.</p><p>Pas de frais de livraison pour le client, pas de dédommagement pour le livreur. Quand le client passera, ouvrez la commande et touchez « Remise au client en boutique » : elle sera comptée comme <strong>vente sur place</strong>.</p></div>}
          onClose={() => setToShop(false)} onConfirm={async () => { await cancelDeliveryToShop(o); toast('Livraison annulée : la commande attend le client en boutique'); onClose(); }} />}
        <div className="table-wrap">
          <table className="table lines-table return-lines">
            <thead><tr><th>Article</th><th className="t-num">Parti</th><th style={{ width: 110 }}>Gardé par le client</th><th className="t-num">Revient en stock</th></tr></thead>
            <tbody>
              {o.lines.map((l) => {
                const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId);
                return (
                  <tr key={l.id} className={l.isChoice ? 'is-choice' : ''}>
                    <td><strong>{p?.code}</strong> {variantLabel(v)} {l.isChoice && <Badge tone="warn">choix</Badge>}<div className="small muted">{fmtAr(l.unitPrice)}</div><LotTag l={l} /></td>
                    <td className="t-num num" data-label="Parti">{l.qty}</td>
                    <td data-label="Gardé par le client"><input className="cell-input" inputMode="numeric" aria-label="Gardé" placeholder={l.isChoice ? 'à préciser' : ''} aria-invalid={l.isChoice && (kept[l.id] ?? '').trim() === ''} value={kept[l.id]} onChange={(e) => setKept({ ...kept, [l.id]: e.target.value })} /></td>
                    <td className="t-num num" data-label="Revient en stock">{l.qty - keptNum[l.id]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(o.adjusts || []).length > 0 && <>
          <AdjustList adjusts={o.adjusts} lines={sim.lines} closed />
          <p className="small muted">Lot ou prix par quantité : le prix réduit ne compte que pour les lots complets gardés ; le reste est payé au prix normal.</p>
        </>}
        <div className="card stack-s settle-box">
          <h3>Ce que le client a payé</h3>
          <div className="money-lines">
            <div><span>a. Articles (après le choix du client)</span><strong className="num">{fmtAr(c - feeVal)}</strong></div>
            <div><span>b. Frais de livraison</span><input className="cell-input num-input" inputMode="numeric" aria-label="Frais de livraison facturés (Ar)" value={fee ?? String(feeVal)} onChange={(e) => setFee(e.target.value)} /></div>
            {!anyKept && <div className="small muted"><span>Commande refusée : mettez les frais seulement si le client les a payés.</span></div>}
            <div className="ml-total"><span>= À payer par le client (a + b)</span><strong className="num">{fmtAr(c)}</strong></div>
            <div><span>c. Déjà payé à la boutique{paidHow ? ` (${paidHow})` : ''}</span><strong className="num">{prepaid ? '− ' + fmtAr(prepaid) : '—'}</strong></div>
            <div className="ml-strong"><span>e. Reste à verser par le livreur (frais compris)</span><strong className="num">{fmtAr(eDue)}</strong></div>
          </div>
          <div className="grid-2">
            <TextField label="Encaissé par le livreur auprès du client (Ar)" value={amount ?? String(amountVal)} onChange={setAmount} inputMode="numeric" hint={amountVal !== toCollect ? `Prévu : ${fmtAr(toCollect)}` : 'Normalement : le reste à payer par le client.'} />
            <SelectField label="Le client a payé le livreur en" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />
            {method !== 'cash' && <TextField label="Référence de la transaction" value={ref} onChange={setRef} />}
          </div>
        </div>
        <TextField label="Remarque (motif de refus, etc.)" value={note} onChange={setNote} placeholder="Ex. taille trop petite, client absent…" />
        {toSettle && <p className="small muted">Étape suivante : le règlement avec le livreur (onglet « À régler »), pour une ou plusieurs commandes à la fois.</p>}
      </div>
    </Modal>
  );
}

/** Payer les frais différés d'une commande au livreur (aussi possible depuis son compte). */
export function PayFeeModal({ order, courier, amount, onClose }: { order: Order; courier: Courier; amount: number; onClose: () => void }) {
  const [acc, setAcc] = useState<AccountId>('cash');
  return (
    <Confirm title={`Payer les frais de ${courier.name}`} confirmLabel="Enregistrer le paiement" onClose={onClose}
      onConfirm={async () => { await payDeferredFees(courier, amount, acc, [order]); toast(`Frais de ${order.number} payés à ${courier.name}`); }}
      message={<div className="stack-s"><p>Frais de livraison de la commande <strong>{order.number}</strong> : <strong>{fmtAr(amount)}</strong>, différés au retour du livreur.</p>
        <SelectField label="Payé depuis" value={acc} onChange={(v) => setAcc(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} /></div>} />
  );
}

function EditPaymentModal({ order: o, payment: p, onClose }: { order: Order; payment: Payment; onClose: () => void }) {
  const [amount, setAmount] = useState(String(p.amount));
  const [method, setMethod] = useState<PayMethod>(p.method);
  const [reason, setReason] = useState('Erreur de saisie');
  const n = parseAr(amount) ?? NaN;
  return (
    <Modal title={`Corriger un paiement — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={isNaN(n) || (n === p.amount && method === p.method)} onClick={async () => { await editPayment(o, p.id, n, method, reason.trim() || undefined); toast('Paiement corrigé'); onClose(); }}>Enregistrer la correction</Button></>}>
      <div className="stack">
        <p className="small">Montant actuel : <strong>{fmtAr(p.amount)}</strong> ({PAY_METHODS[p.method]}, {p.receivedBy === 'shop' ? 'reçu par la boutique' : 'encaissé par le livreur'}) le {fmtDateTime(p.at)}.</p>
        <div className="grid-2">
          <TextField label="Nouveau montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" hint="0 pour annuler ce paiement" />
          <SelectField label="Moyen" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />
        </div>
        <TextField label="Motif" value={reason} onChange={setReason} />
        <Help>L’ancien montant, le nouveau, la date et votre nom restent visibles sous le paiement et dans le journal d’activité. Le reste à payer et le compte du livreur se recalculent tout seuls.</Help>
      </div>
    </Modal>
  );
}

function PayModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const refund = remaining(o) < 0;
  const due = Math.abs(remaining(o));
  const [lines, setLines] = useState<PayLine[]>([{ method: refund ? 'cash' : 'mvola', amount: String(due), ref: '' }]);
  const [by, setBy] = useState<'shop' | 'courier'>('shop');
  const sum = payLinesSum(lines);
  return (
    <Modal title={refund ? `Argent rendu au client — ${o.number}` : `Paiement reçu — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!sum} onClick={async () => {
        for (const l of lines) { const n = parseAr(l.amount) || 0; if (n > 0) await addPayment(o = get<Order>('orders', o.id) ?? o, { amount: refund ? -n : n, method: l.method, ref: l.ref.trim() || undefined, receivedBy: by, courierId: by === 'courier' ? o.courierId : undefined }); }
        toast(refund ? 'Remboursement enregistré' : lines.filter((l) => parseAr(l.amount)).length > 1 ? 'Paiement en plusieurs tranches enregistré' : 'Paiement enregistré'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        {refund && <p className="small">Le client a trop payé (ex. échange contre un article moins cher) : ce montant sort de la caisse ou du compte choisi.</p>}
        {!refund && <p className="small muted">Reste à payer : <strong>{fmtAr(due)}</strong>. Le client peut payer en plusieurs tranches (ex. une partie en espèces, le reste en mobile money).</p>}
        <PayLines lines={lines} onChange={setLines} total={due} mode="select" />
        {o.courierId && <SelectField label="Reçu par" value={by} onChange={(v) => setBy(v as any)} options={[{ value: 'shop', label: 'La boutique' }, { value: 'courier', label: 'Le livreur' }]} />}
      </div>
    </Modal>
  );
}

const tomorrowYmd = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const REPORT_REASONS = ['Client absent', 'Client pas encore prêt à payer', 'Client demande un autre jour', 'Client injoignable', 'Autre'];
/** « À reporter » : le client demande une autre date. Au plus 3 fois ; ensuite, annulation de la commande. */
export function PostponeModal({ order: o, onClose, onDone }: { order: Order; onClose: () => void; onDone?: () => void }) {
  const n = reportCount(o);
  const [to, setTo] = useState(tomorrowYmd());
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [other, setOther] = useState('');
  const why = reason === 'Autre' ? other.trim() : reason;
  const history = (o.reports || []).map((r, i) => <li key={i} className="small">{i + 1}. {new Date(r.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{r.to ? ` → au ${new Date(`${r.to}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}` : ''}{r.reason ? ` — ${r.reason}` : ''}{r.user ? ` (${r.user})` : ''}</li>);
  if (n >= MAX_REPORTS) return (
    <Confirm title={`${o.number} : déjà reportée ${n} fois`} danger confirmLabel="Annuler la commande" onClose={onClose}
      message={<div className="stack-s"><p>Le client a déjà fait reporter cette livraison <strong>{n} fois</strong> sans prendre sa commande. Elle doit maintenant être <strong>annulée</strong> : les articles reviennent exactement en stock.</p><ul className="stack-s" style={{ margin: 0, paddingLeft: 16 }}>{history}</ul>
        <TextField label="Remarque (facultatif)" value={other} onChange={setOther} /></div>}
      onConfirm={async () => { await cancelAfterReports(o, other.trim()); toast(`Commande annulée après ${n} reports`); onDone?.(); }} />
  );
  return (
    <Modal title={`Reporter la livraison — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button icon="clock" disabled={!to || (reason === 'Autre' && !why)} onClick={async () => {
        try { await postponeOrder(o, { to, reason: why }); toast(`Livraison reportée (${n + 1}/${MAX_REPORTS})${o.status === 'out' ? ' : colis revenu en boutique' : ''}`); onDone?.(); onClose(); } catch (e: any) { toast(e.message, 'error'); }
      }}>Reporter ({n + 1}/{MAX_REPORTS})</Button></>}>
      <div className="stack">
        <p className="small">Le client demande de livrer un autre jour. {o.status === 'out' ? <>Le livreur rapporte le colis : <strong>les articles reviennent en boutique</strong>, réservés pour ce client, et la commande repasse « en attente de livraison ».</> : 'La commande garde ses articles réservés et attend la nouvelle date.'}</p>
        <div className="grid-2">
          <TextField label="Nouvelle date de livraison" type="date" value={to} onChange={setTo} />
          <SelectField label="Raison" value={reason} onChange={setReason} options={REPORT_REASONS.map((r) => ({ value: r, label: r }))} />
        </div>
        {reason === 'Autre' && <TextField label="Précisez" value={other} onChange={setOther} required />}
        <div className={`notice ${n + 1 >= MAX_REPORTS ? 'notice-danger' : ''}`}><Icon name="alert" /><span>Report <strong>{n + 1} sur {MAX_REPORTS}</strong>. {n + 1 >= MAX_REPORTS ? 'C’est le dernier report possible : si le client ne prend toujours pas la commande, elle sera annulée.' : `Après ${MAX_REPORTS} reports, la commande devra être annulée.`}</span></div>
        {n > 0 && <div><strong className="small">Reports précédents</strong><ul className="stack-s" style={{ margin: '4px 0 0', paddingLeft: 16 }}>{history}</ul></div>}
      </div>
    </Modal>
  );
}

function CancelModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [reason, setReason] = useState('Client injoignable');
  return (
    <Confirm title={`Annuler ${o.number}`} danger confirmLabel="Annuler la commande" onClose={onClose}
      message={<div className="stack"><p>{o.status === 'out' ? 'Les articles partis avec le livreur seront remis en stock.' : 'La commande ne réservera plus de stock.'}</p>
        <SelectField label="Motif" value={reason} onChange={setReason} options={['Client injoignable', 'Client a annulé', 'Article indisponible', 'Erreur de saisie', 'Doublon', 'Autre'].map((r) => ({ value: r, label: r }))} /></div>}
      onConfirm={async () => { await cancelOrder(o, reason); toast('Commande annulée'); }} />
  );
}

/** Annuler une vente ou commande déjà terminée (erreur de saisie) : stock remis exactement, argent rendu si besoin. */
function VoidModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [reason, setReason] = useState('Erreur de saisie');
  const [other, setOther] = useState('');
  const suggested = refundSuggested(o);
  const [refund, setRefund] = useState(suggested > 0);
  const [amount, setAmount] = useState(String(suggested));
  const [method, setMethod] = useState<PayMethod>((o.payments || []).find((p) => p.amount > 0)?.method ?? 'cash');
  const net = netMoves('order', o.id);
  const pcs = [...net.values()].reduce((s, q) => s + Math.abs(q), 0);
  const why = reason === 'Autre' ? other.trim() : reason;
  return (
    <Confirm title={`Annuler ${o.number}`} danger confirmLabel="Annuler la vente" onClose={onClose}
      message={<div className="stack">
        <p>Correction d’une erreur : la vente disparaît du chiffre d’affaires de son jour et <strong>{pcs} pièce(s) reviennent exactement en stock</strong>. Tout est noté dans l’historique (qui, quand, pourquoi) et signalé au gérant.</p>
        <SelectField label="Motif" value={reason} onChange={setReason} options={['Erreur de saisie', 'Vente en double', 'Client a rendu les articles', 'Mauvais article', 'Autre'].map((r) => ({ value: r, label: r }))} />
        {reason === 'Autre' && <TextField label="Précisez" value={other} onChange={setOther} required />}
        {suggested > 0 && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> L’argent reçu ({fmtAr(suggested)}) est rendu au client / sort de la caisse</label>}
        {refund && <div className="grid-2"><TextField label="Montant rendu (Ar)" value={amount} onChange={setAmount} inputMode="numeric" /><SelectField label="Moyen" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} /></div>}
      </div>}
      onConfirm={async () => { if (!why) throw new Error('Indiquez le motif.'); await voidOrder(o, why, refund ? { amount: parseAr(amount) || 0, method } : undefined); toast(`${o.number} annulée : stock remis`); }} />
  );
}

/** Corriger une vente sur place : quantités, prix, articles retirés ; le stock suit exactement. */
function CorrectSaleModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [rows, setRows] = useState(() => o.lines.map((l) => ({ ...l, qtyS: String(l.qty), priceS: String(l.unitPrice) })));
  const [discount, setDiscount] = useState(String(o.discount || 0));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = rows.map((r) => ({ ...r, qty: parseNum(r.qtyS) ?? 0, unitPrice: parseNum(r.priceS) ?? 0 })).filter((r) => r.qty > 0);
  const total = Math.max(0, kept.reduce((s, l) => s + l.qty * l.unitPrice, 0) - (parseNum(discount) || 0));
  const paidNow = (o.payments || []).reduce((s, p) => s + p.amount, 0);
  const diff = total - paidNow; // + : le client doit encore ; − : à lui rendre
  const [settle, setSettle] = useState(true);
  const [method, setMethod] = useState<PayMethod>((o.payments || []).find((p) => p.amount > 0)?.method ?? 'cash');
  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError('Indiquez la raison de la correction.');
    setBusy(true);
    try {
      await correctWalkInSale(o, kept.map(({ qtyS, priceS, ...l }) => ({ ...l, priceManual: true })), parseNum(discount) || 0, reason.trim(), settle && Math.round(diff) ? { amount: diff, method } : undefined);
      toast(`${o.number} corrigée : stock mis à jour`); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Corriger ${o.number}`} wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button busy={busy} onClick={submit}>Enregistrer la correction</Button></>}>
      <div className="stack">
        <p className="small muted">Mettez 0 pour retirer un article. Le stock est remis exactement selon la vente corrigée ; l’ancienne et la nouvelle version restent dans l’historique.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Article</th><th>Quantité</th><th>Prix unitaire (Ar)</th><th className="t-num">Montant</th></tr></thead>
          <tbody>{rows.map((r, i) => { const v = get<Variant>('variants', r.variantId); const p = v && get<Product>('products', v.productId); return (
            <tr key={r.id}><td><strong>{p?.name ?? '?'}</strong><div className="small muted">{v?.sku}</div></td>
              <td><input className="cell-input" inputMode="numeric" aria-label={`Quantité ${v?.sku}`} value={r.qtyS} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qtyS: e.target.value } : x)))} /></td>
              <td><input className="cell-input" inputMode="numeric" aria-label={`Prix ${v?.sku}`} value={r.priceS} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, priceS: e.target.value } : x)))} /></td>
              <td className="t-num">{fmtAr((parseNum(r.qtyS) ?? 0) * (parseNum(r.priceS) ?? 0))}</td></tr>); })}</tbody>
        </table></div>
        <div className="grid-2"><TextField label="Remise (Ar)" value={discount} onChange={setDiscount} inputMode="numeric" /><TextField label="Raison de la correction" required value={reason} onChange={setReason} placeholder="ex. mauvaise quantité saisie" /></div>
        <p>Nouveau total : <strong>{fmtAr(total)}</strong> · déjà payé : {fmtAr(paidNow)}{Math.round(diff) ? <> · <strong className={diff < 0 ? 'neg' : ''}>{diff < 0 ? `à rendre ${fmtAr(-diff)}` : `reste à payer ${fmtAr(diff)}`}</strong></> : ' · rien à régler'}</p>
        {Math.round(diff) !== 0 && <div className="row" style={{ gap: 10, alignItems: 'center' }}><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} /> Enregistrer {diff < 0 ? 'l’argent rendu' : 'le paiement'} maintenant</label>
          {settle && <SelectField label="Moyen" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />}</div>}
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
    </Modal>
  );
}

/** Retour / échange après livraison : choisir ce que le client rend, puis les nouveaux articles. */
function ExchangeStart({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [ret, setRet] = useState<Record<string, string>>({});
  const [next, setNext] = useState<{ variantId: string; qty: number; unitPrice: number }[] | null>(null);
  const keptLines = o.lines.filter((l) => (l.qtyKept ?? 0) > 0);
  const returnLines = keptLines.map((l) => ({ variantId: l.variantId, qty: Math.min(l.qtyKept ?? 0, parseNum(ret[l.id]) ?? 0), unitPrice: l.unitPrice })).filter((r) => r.qty > 0);
  if (next) return <OrderForm exchangeOf={{ parent: o, returnLines: next }} onClose={onClose} onSaved={(x) => navigate('/commandes/' + x.id)} />;
  return (
    <Modal title={`Retour / échange — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!returnLines.length} onClick={() => setNext(returnLines)}>Continuer</Button></>}>
      <div className="stack">
        <Help>Indiquez ce que le client rend. À l’étape suivante, ajoutez les articles qu’il prend à la place (ou aucun pour un simple retour). La différence de prix est calculée automatiquement.</Help>
        {keptLines.map((l) => {
          const v = get<Variant>('variants', l.variantId); const p = v && get<Product>('products', v.productId);
          return (
            <div key={l.id} className="row" style={{ flexWrap: 'nowrap' }}>
              <Thumb src={p?.photo} size={40} />
              <div style={{ flex: 1 }}><strong>{p?.code}</strong> {variantLabel(v)}<div className="small muted">acheté {l.qtyKept} × {fmtAr(l.unitPrice)}</div></div>
              <input className="cell-input" style={{ width: 90 }} inputMode="numeric" placeholder="0" aria-label="Quantité rendue" value={ret[l.id] ?? ''} onChange={(e) => setRet({ ...ret, [l.id]: e.target.value })} />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ShopExchangeModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const bal = exchangeBalance({ ...o, deliveryFee: 0 }) - paidTotal(o);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [ref, setRef] = useState('');
  return (
    <Modal title={`Échange en boutique — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={async () => {
        try { await completeAtShop(o, bal !== 0 ? { amount: bal, method, ref: ref.trim() || undefined } : undefined); } catch (e: any) { toast(e.message, 'error'); return; }
        toast('Échange terminé'); onClose();
      }}>Valider l’échange</Button></>}>
      <div className="stack">
        <p>Le client est en boutique : les articles repris reviennent en stock, les nouveaux articles sortent, sans frais de livraison.</p>
        <p><strong>{bal > 0 ? `Le client paie ${fmtAr(bal)}` : bal < 0 ? `À rendre au client : ${fmtAr(-bal)}` : 'Aucune différence à payer.'}</strong></p>
        {bal !== 0 && <SelectField label="Moyen" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />}
        {bal !== 0 && method !== 'cash' && <TextField label="Référence" value={ref} onChange={setRef} />}
      </div>
    </Modal>
  );
}

function PickupModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const converting = !isPickupZone(o.zoneId) || !!o.deliveryFee || !!o.courierId;
  const rest = Math.max(0, remaining(o) - (converting ? o.deliveryFee || 0 : 0));
  const [amount, setAmount] = useState(String(rest));
  const [method, setMethod] = useState<PayMethod>('cash');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Retrait en boutique — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={async () => {
        setBusy(true);
        try { await handOverAtShop(o, parseAr(amount) ? { amount: parseAr(amount)!, method, ref: ref.trim() || undefined } : undefined); } catch (e: any) { toast(e.message, 'error'); setBusy(false); return; }
        toast('Commande remise au client'); setBusy(false); onClose();
      }}>Valider</Button></>}>
      <div className="stack">
        <p>Le client est venu chercher sa commande en boutique : elle devient une <strong>vente sur place</strong>. Les articles sortent du stock{converting ? ', la livraison est annulée (pas de frais de livraison, pas de livreur)' : ''}.</p>
        <TextField label="Montant encaissé (Ar)" value={amount} onChange={setAmount} inputMode="numeric" hint={`Reste à payer : ${fmtAr(rest)}`} />
        <SelectField label="Moyen de paiement" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />
        {method !== 'cash' && <TextField label="Référence de la transaction" value={ref} onChange={setRef} />}
      </div>
    </Modal>
  );
}

/** Changer de livreur avant son versement : la commande, ses frais et l'argent encaissé passent au nouveau. */
export function ReassignModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const couriers = useTable<Courier>('couriers').filter((c) => c.active !== false && c.id !== o.courierId);
  const current = get<Courier>('couriers', o.courierId || '');
  const [courierId, setCourierId] = useState(couriers.find((c) => c.zoneIds?.includes(o.zoneId || ''))?.id ?? couriers[0]?.id ?? '__new');
  const [newName, setNewName] = useState('');
  const [reason, setReason] = useState('Zone d’un autre livreur');
  const [busy, setBusy] = useState(false);
  const collected = (o.payments || []).filter((p) => p.receivedBy === 'courier' && p.courierId === o.courierId).reduce((s, p) => s + p.amount, 0);
  return (
    <Modal title={`Changer de livreur — ${o.number}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={courierId === '__new' && !newName.trim()} onClick={async () => {
        setBusy(true);
        try {
          let cid = courierId;
          if (cid === '__new') { const [c] = await save('couriers', { name: newName.trim(), active: true }); cid = c.id; }
          await reassignCourier(o, cid, reason.trim() || undefined);
          toast('Livreur changé'); onClose();
        } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
      }}>Changer de livreur</Button></>}>
      <div className="stack">
        <p>Livreur actuel : <strong>{current?.name ?? '—'}</strong></p>
        <SelectField label="Nouveau livreur" value={courierId} onChange={setCourierId} options={[...couriers.map((c) => ({ value: c.id, label: c.name })), { value: '__new', label: '+ Nouveau livreur…' }]} />
        {courierId === '__new' && <TextField label="Nom du nouveau livreur" required value={newName} onChange={setNewName} autoFocus />}
        <SelectField label="Motif" value={reason} onChange={setReason} options={['Zone d’un autre livreur', 'Livreur indisponible', 'Erreur d’attribution', 'Autre'].map((r) => ({ value: r, label: r }))} />
        <div className="notice"><Icon name="refresh" /><span>La commande est retirée du compte de {current?.name ?? 'l’ancien livreur'} et passe au nouveau{['delivered', 'partial', 'refused'].includes(o.status) ? `, avec ses frais (${fmtAr(o.feeCharged ?? 0)})` : ''}{collected ? ` et l’argent encaissé (${fmtAr(collected)})` : ''}. Le changement est noté dans l’historique.</span></div>
      </div>
    </Modal>
  );
}
