// Rapports : résultat (bénéfice / perte), journal des ventes, articles, clients, livreurs, vendeurs, stock, achats.
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { all, get, useTable } from '../lib/db';
import { categoryPath, fmtAr, stockOf, variantCost, type Category, type Product, type Purchase, type Variant, PURCHASE_STATUS } from '../lib/catalog';
import { courierSplit, fmtPhone, orderLabel, ORDER_STATUS, PAY_METHODS, type Courier, type Customer, type Order, type Zone } from '../lib/orders';
import { courierBalance, type CourierSettlement } from '../lib/money';
import { purchaseQty, purchaseReceivedQty, purchaseTotal, purchaseTotalAr, purchasePaid, type Supplier } from '../lib/purchases';
import {
  bucketFor, categoryLabel, dormant, groupBy, kpis, moneyOut, previousPeriod, productLabel, salesLedger, series, type Group, type Kpis, type SaleLine,
} from '../lib/analytics';
import { Badge, Button, Empty, PageHead, SelectField, TextField, fmtDate, fmtDateTime, navigate, useRoute } from '../ui/kit';
import { PeriodPicker, defaultPeriod, type Period } from '../ui/period';
import { BarChart } from '../ui/chart';
import { SortTable, exportTables, type Col } from '../ui/table';
import { today } from '../lib/money';
import { GlobalRecap } from './GlobalRecap';
import { BossReport } from './BossReport';
import { abandonReasons, conversion, type ConvRow } from '../lib/insights';

const TABS = [
  { key: 'patron', label: 'Rapport au patron' },
  { key: 'global', label: 'Récap global' },
  { key: 'resultat', label: 'Bénéfice et perte' },
  { key: 'ventes', label: 'Journal des ventes' },
  { key: 'articles', label: 'Articles' },
  { key: 'clients', label: 'Clients' },
  { key: 'livreurs', label: 'Livreurs' },
  { key: 'vendeurs', label: 'Vendeurs' },
  { key: 'stock', label: 'Stock' },
  { key: 'achats', label: 'Achats' },
  { key: 'suivis', label: 'Clients à suivre' },
];
const pct = (n: number) => (n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
const range = (p: Period) => ({ from: p.from ?? '2000-01-01', to: p.to ?? today() });

export function ReportsPage() {
  const can = useCan();
  const route = useRoute();
  useTable('orders'); useTable('cashMoves'); useTable('variants'); useTable('products'); useTable('stockMoves'); useTable('purchases'); useTable('courierSettlements');
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const seg0 = route.split('?')[0].split('/')[2]; const seg = seg0 === 'mensuel' ? 'global' : seg0;
  const cur = TABS.find((t) => t.key === seg) ?? TABS[0];
  if (!can('reports.view')) return <Empty icon="lock" title="Accès réservé" />;
  const { from, to } = range(period);
  return (
    <>
      <PageHead title="Rapports" subtitle="Rapport au patron (jour, semaine, mois, année) et analyses détaillées, triables, en PDF et Excel" />
      <div className="tabs" role="tablist">{TABS.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/rapports/' + t.key)}>{t.label}</button>)}</div>
      {!['stock', 'global', 'patron'].includes(cur.key) && <div className="card"><PeriodPicker value={period} onChange={setPeriod} /></div>}
      {cur.key === 'patron' && <BossReport />}
      {cur.key === 'global' && <GlobalRecap />}
      {cur.key === 'resultat' && <ProfitLoss from={from} to={to} />}
      {cur.key === 'ventes' && <SalesJournal from={from} to={to} />}
      {cur.key === 'articles' && <Articles from={from} to={to} />}
      {cur.key === 'clients' && <Clients from={from} to={to} />}
      {cur.key === 'livreurs' && <CouriersReport from={from} to={to} />}
      {cur.key === 'vendeurs' && <Sellers from={from} to={to} />}
      {cur.key === 'stock' && <StockReport />}
      {cur.key === 'achats' && <Purchases from={from} to={to} />}
      {cur.key === 'suivis' && <FollowConversion from={from} to={to} />}
    </>
  );
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  return <Button variant="ghost" icon="download" onClick={onClick}>Exporter en Excel</Button>;
}
const fileDate = (from: string, to: string) => (from === to ? from : `${from}_${to}`);

// ---------- Bénéfice et perte ----------
function ProfitLoss({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const cost = can('costs.view');
  const lines = useMemo(() => salesLedger(from, to), [from, to]);
  const k = kpis(lines, from, to);
  const prev = previousPeriod(from, to);
  const kp = kpis(salesLedger(prev.from, prev.to), prev.from, prev.to);
  const { byCat } = moneyOut(from, to);
  const b0 = bucketFor(from, to); const bucket = b0 === 'hour' ? 'day' : b0; // au minimum par jour
  const pts = series(lines, from, to, bucket);
  const [metric, setMetric] = useState<'net' | 'revenue' | 'gross'>(cost ? 'net' : 'revenue');
  type Row = { label: string; cur: number; prev: number; strong?: boolean; sub?: boolean; pct?: boolean };
  const rows: Row[] = [
    { label: 'Ventes', cur: k.sales, prev: kp.sales },
    { label: 'Retours', cur: -k.returns, prev: -kp.returns },
    { label: "Chiffre d'affaires net", cur: k.revenue, prev: kp.revenue, strong: true },
    ...(cost ? [
      { label: 'Coût des articles vendus', cur: -k.cost, prev: -kp.cost },
      { label: 'Marge brute', cur: k.gross, prev: kp.gross, strong: true },
      { label: 'Taux de marge', cur: k.margin, prev: kp.margin, pct: true, sub: true },
    ] : []),
    ...byCat.map(([n, v]) => ({ label: n, cur: -v, prev: 0, sub: true })),
    { label: 'Total des dépenses', cur: -k.expenses, prev: -kp.expenses, strong: true },
    { label: 'Autres revenus', cur: k.incomes, prev: kp.incomes },
    ...(cost ? [{ label: k.net >= 0 ? 'BÉNÉFICE NET' : 'PERTE NETTE', cur: k.net, prev: kp.net, strong: true }] : []),
  ];
  const months = bucket === 'month' ? pts : [];
  const value = (p: typeof pts[number]) => (metric === 'revenue' ? p.revenue : metric === 'gross' ? p.gross : p.gross - p.expenses);
  return (
    <>
      <div className="card stack-s">
        <div className="row-between">
          <h2>{metric === 'revenue' ? "Chiffre d'affaires" : metric === 'gross' ? 'Marge brute' : 'Bénéfice net (marge − dépenses)'} par {bucket === 'hour' ? 'heure' : bucket === 'day' ? 'jour' : 'mois'}</h2>
          <div className="segmented" role="group">
            <button type="button" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>Chiffre d'affaires</button>
            {cost && <button type="button" aria-pressed={metric === 'gross'} onClick={() => setMetric('gross')}>Marge</button>}
            {cost && <button type="button" aria-pressed={metric === 'net'} onClick={() => setMetric('net')}>Bénéfice net</button>}
          </div>
        </div>
        <BarChart title="Évolution" bars={pts.map((p) => ({ key: p.key, label: p.label, long: p.long, value: value(p), extra: `${p.orders} vente(s)` }))} format={fmtAr} />
        {metric === 'net' && <p className="small muted">Les barres en rouge sont des périodes en perte (dépenses plus fortes que la marge).</p>}
      </div>
      <div className="card card-flush">
        <div className="card-pad row-between"><h2>Compte de résultat</h2>
          <ExportBtn onClick={() => exportTables(`resultat_${fileDate(from, to)}.xlsx`, [{ name: 'Résultat', rows, cols: [{ key: 'l', label: 'Poste', value: (r: Row) => r.label, width: 34 }, { key: 'c', label: `Du ${from} au ${to}`, value: (r: Row) => r.cur, money: true, width: 20 }, { key: 'p', label: `Période précédente (${prev.from} au ${prev.to})`, value: (r: Row) => r.prev, money: true, width: 28 }] }])} /></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Poste</th><th className="t-num">Période</th><th className="t-num">Période précédente</th><th className="t-num">Évolution</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.label} className={r.strong ? 't-total' : ''}>
              <td style={r.sub ? { paddingLeft: 28, color: 'var(--muted)' } : undefined}>{r.label}</td>
              <td className={`t-num ${r.cur < 0 && !r.pct ? 'neg' : ''}`}>{r.pct ? pct(r.cur) : fmtAr(r.cur)}</td>
              <td className="t-num muted">{r.prev ? (r.pct ? pct(r.prev) : fmtAr(r.prev)) : '—'}</td>
              <td className="t-num"><Delta cur={r.cur} prev={r.prev} pct={r.pct} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="card-pad small muted">Les frais de livraison appartiennent aux livreurs : ils ne sont ni dans le chiffre d'affaires ni dans le bénéfice. Coût des articles = coût de revient moyen (achat + transit). Période précédente : du {fmtDate(prev.from)} au {fmtDate(prev.to)}.</p>
      </div>
      {months.length > 1 && (
        <div className="card card-flush">
          <div className="card-pad"><h2>Mois par mois</h2></div>
          <SortTable rowKey={(p) => p.key} rows={months} cols={[
            { key: 'm', label: 'Mois', value: (p) => p.key, render: (p) => <span style={{ textTransform: 'capitalize' }}>{p.long}</span> },
            { key: 'o', label: 'Ventes', value: (p) => p.orders, num: true, total: true },
            { key: 'r', label: "Chiffre d'affaires", value: (p) => p.revenue, money: true, total: true },
            { key: 'g', label: 'Marge brute', value: (p) => p.gross, money: true, total: true, hide: !cost },
            { key: 'e', label: 'Dépenses', value: (p) => p.expenses, money: true, total: true },
            { key: 'n', label: 'Bénéfice net', value: (p) => p.gross - p.expenses, money: true, total: true, hide: !cost, render: (p) => <span className={p.gross - p.expenses < 0 ? 'neg' : ''}>{fmtAr(p.gross - p.expenses)}</span> },
          ]} />
        </div>
      )}
    </>
  );
}

export function Delta({ cur, prev, pct: isPct, invert }: { cur: number; prev: number; pct?: boolean; invert?: boolean }) {
  if (!prev && !cur) return <span className="muted">—</span>;
  if (!prev) return <span className="muted small">nouveau</span>;
  const d = isPct ? cur - prev : (cur - prev) / Math.abs(prev);
  const good = invert ? d < 0 : d > 0;
  return <span className={`kpi-delta ${d === 0 ? '' : good ? 'up' : 'down'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : ''} {isPct ? (d * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' pt' : pct(Math.abs(d))}</span>;
}

// ---------- Journal des ventes ----------
interface Entry { id: string; at: string; o: Order; kind: SaleLine['kind']; qty: number; amount: number; cost: number }
function SalesJournal({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const cost = can('costs.view');
  const lines = useMemo(() => salesLedger(from, to), [from, to]);
  const [channel, setChannel] = useState('');
  const [seller, setSeller] = useState('');
  const [courier, setCourier] = useState('');
  const [zone, setZone] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const entries = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const l of lines) {
      const k = `${l.order.id}|${l.at}|${l.kind}`;
      if (!m.has(k)) m.set(k, { id: k, at: l.at, o: l.order, kind: l.kind, qty: 0, amount: 0, cost: 0 });
      const e = m.get(k)!; e.qty += l.qty; e.amount += l.amount; e.cost += l.cost;
    }
    return [...m.values()];
  }, [lines]);
  const sellers = [...new Set(entries.map((e) => e.o.createdByName).filter(Boolean))] as string[];
  const couriers = all<Courier>('couriers');
  const zones = all<Zone>('zones');
  const n = q.trim().toLowerCase();
  const rows = entries.filter((e) => (!channel || (channel === 'internal' ? !!e.o.internal : channel === 'shop' ? e.o.channel === 'shop' : e.o.channel !== 'shop'))
    && (!seller || e.o.createdByName === seller) && (!courier || e.o.courierId === courier) && (!zone || e.o.zoneId === zone)
    && (!method || (e.o.payments || []).some((p) => p.method === method))
    && (!n || `${e.o.number} ${e.o.name || ''} ${e.o.phone}`.toLowerCase().includes(n)));
  const cols: Col<Entry>[] = [
    { key: 'at', label: 'Date', value: (e) => e.at, render: (e) => fmtDateTime(e.at), width: 18 },
    { key: 'n', label: 'N°', value: (e) => e.o.number, render: (e) => <a href={`#/commandes/${e.o.id}`}>{e.o.number}</a> },
    { key: 'k', label: 'Type', value: (e) => (e.kind === 'sale' ? 'Vente' : 'Retour'), render: (e) => e.kind === 'sale' ? 'Vente' : <Badge tone="danger">Retour</Badge> },
    { key: 'c', label: 'Canal', value: (e) => (e.o.internal ? 'Vente interne' : e.o.channel === 'shop' ? 'Sur place' : 'En ligne') },
    { key: 'cl', label: 'Client', value: (e) => orderLabel(e.o) },
    { key: 's', label: 'Vendeur', value: (e) => e.o.createdByName ?? '' },
    { key: 'lv', label: 'Livreur', value: (e) => (e.o.courierId ? get<Courier>('couriers', e.o.courierId)?.name ?? '' : '') },
    { key: 'pm', label: 'Paiement', value: (e) => [...new Set((e.o.payments || []).map((p) => PAY_METHODS[p.method]))].join(' + ') },
    { key: 'q', label: 'Pièces', value: (e) => e.qty, num: true, total: true },
    { key: 'a', label: 'Montant', value: (e) => e.amount, money: true, total: true, render: (e) => <span className={e.amount < 0 ? 'neg' : ''}>{fmtAr(e.amount)}</span> },
    { key: 'm', label: 'Marge', value: (e) => e.amount - e.cost, money: true, total: true, hide: !cost },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <div className="row-between"><h2>Journal des ventes</h2><ExportBtn onClick={() => exportTables(`journal-ventes_${fileDate(from, to)}.xlsx`, [{ name: 'Ventes', cols, rows }])} /></div>
        <div className="filters">
          <SelectField label="Canal" value={channel} onChange={setChannel} options={[{ value: '', label: 'Tous' }, { value: 'shop', label: 'Vente sur place' }, { value: 'online', label: 'Commandes en ligne' }, { value: 'internal', label: 'Ventes internes (employés)' }]} />
          <SelectField label="Vendeur" value={seller} onChange={setSeller} options={[{ value: '', label: 'Tous' }, ...sellers.map((s) => ({ value: s, label: s }))]} />
          <SelectField label="Livreur" value={courier} onChange={setCourier} options={[{ value: '', label: 'Tous' }, ...couriers.map((c) => ({ value: c.id, label: c.name }))]} />
          <SelectField label="Zone" value={zone} onChange={setZone} options={[{ value: '', label: 'Toutes' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]} />
          <SelectField label="Paiement" value={method} onChange={setMethod} options={[{ value: '', label: 'Tous' }, ...Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))]} />
          <TextField label="Recherche" value={q} onChange={setQ} placeholder="N°, client, téléphone" />
        </div>
        <p className="small muted">Une commande livrée compte comme vendue le jour du départ chez le livreur ; ce qui revient apparaît en « retour » le jour du retour.</p>
      </div>
      <SortTable rowKey={(e) => e.id} rows={rows} cols={cols} initialSort={{ key: 'at', desc: true }} limit={100} />
    </div>
  );
}

// ---------- Articles ----------
function Articles({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const cost = can('costs.view');
  const lines = useMemo(() => salesLedger(from, to), [from, to]);
  const [by, setBy] = useState<'product' | 'category'>('product');
  const [cat, setCat] = useState('');
  const cats = useTable<Category>('categories');
  const filtered = cat ? lines.filter((l) => l.categoryId === cat) : lines;
  const groups = by === 'product' ? groupBy(filtered, (l) => l.productId, productLabel) : groupBy(filtered, (l) => l.categoryId, categoryLabel);
  const stockOfProduct = (id: string) => all<Variant>('variants').filter((v) => v.productId === id).reduce((t, v) => t + stockOf(v.id), 0);
  const cols: Col<Group>[] = [
    ...(by === 'product' ? [{ key: 'code', label: 'Code', value: (g: Group) => g.sub ?? '' }] : []),
    { key: 'name', label: by === 'product' ? 'Article' : 'Catégorie', value: (g) => g.label, width: 30 },
    ...(by === 'product' ? [{ key: 'cat', label: 'Catégorie', value: (g: Group) => categoryPath(get<Product>('products', g.key)?.categoryId) }] : []),
    { key: 'qty', label: 'Pièces vendues', value: (g) => g.qty, num: true, total: true },
    { key: 'ret', label: 'Retours (pcs)', value: (g) => g.returnsQty, num: true, total: true },
    { key: 'rev', label: "Chiffre d'affaires", value: (g) => g.revenue, money: true, total: true },
    { key: 'cost', label: 'Coût', value: (g) => g.cost, money: true, total: true, hide: !cost },
    { key: 'gross', label: 'Marge', value: (g) => g.gross, money: true, total: true, hide: !cost },
    { key: 'pct', label: 'Marge %', value: (g) => (g.revenue ? g.gross / g.revenue : 0), render: (g) => pct(g.revenue ? g.gross / g.revenue : 0), num: true, hide: !cost },
    ...(by === 'product' ? [{ key: 'stock', label: 'Stock actuel', value: (g: Group) => stockOfProduct(g.key), num: true }] : []),
  ];
  const dorm = useMemo(() => dormant(60), [from, to]);
  const dcols: Col<ReturnType<typeof dormant>[number]>[] = [
    { key: 'c', label: 'Code', value: (d) => d.p.code },
    { key: 'n', label: 'Article', value: (d) => d.p.name, width: 30 },
    { key: 'q', label: 'En stock', value: (d) => d.qty, num: true, total: true },
    { key: 'v', label: 'Valeur (coût)', value: (d) => d.value, money: true, total: true, hide: !cost },
  ];
  return (
    <>
      <div className="card card-flush">
        <div className="card-pad stack-s">
          <div className="row-between"><h2>{by === 'product' ? 'Meilleurs articles' : 'Ventes par catégorie'}</h2>
            <ExportBtn onClick={() => exportTables(`articles_${fileDate(from, to)}.xlsx`, [{ name: by === 'product' ? 'Articles' : 'Catégories', cols, rows: groups }, { name: 'Articles dormants', cols: dcols, rows: dorm }])} /></div>
          <div className="filters">
            <div className="segmented" role="group"><button type="button" aria-pressed={by === 'product'} onClick={() => setBy('product')}>Par article</button><button type="button" aria-pressed={by === 'category'} onClick={() => setBy('category')}>Par catégorie</button></div>
            <SelectField label="Catégorie" value={cat} onChange={setCat} options={[{ value: '', label: 'Toutes' }, ...cats.map((c) => ({ value: c.id, label: categoryPath(c.id) }))]} />
          </div>
        </div>
        <SortTable rowKey={(g) => g.key} rows={groups} cols={cols} initialSort={{ key: 'rev', desc: true }} limit={50} />
      </div>
      <div className="card card-flush">
        <div className="card-pad"><h2>Articles dormants</h2><p className="small muted">En stock mais aucune vente depuis 60 jours : à mettre en promotion ou en avant sur Facebook.</p></div>
        <SortTable rowKey={(d) => d.p.id} rows={dorm} cols={dcols} initialSort={{ key: cost ? 'v' : 'q', desc: true }} limit={20} empty="Aucun article dormant." />
      </div>
    </>
  );
}

// ---------- Clients ----------
function Clients({ from, to }: { from: string; to: string }) {
  const lines = useMemo(() => salesLedger(from, to), [from, to]);
  const online = lines.filter((l) => l.channel === 'online' || l.order.phone);
  const keyOf = (l: SaleLine) => l.customerId || (l.order.phone ? 'tel:' + l.order.phone : undefined);
  const groups = groupBy(online.filter((l) => keyOf(l)), keyOf, (k) => {
    if (k.startsWith('tel:')) return { label: fmtPhone(k.slice(4)), sub: k.slice(4) };
    const c = get<Customer>('customers', k);
    return { label: c?.name || fmtPhone(c?.phone) || 'Client', sub: c?.phone };
  });
  const refused = (k: string) => all<Order>('orders').filter((o) => (o.customerId === k || 'tel:' + o.phone === k) && o.status === 'refused' && o.returnedAt && o.returnedAt.slice(0, 10) >= from && o.returnedAt.slice(0, 10) <= to).length;
  const cols: Col<Group>[] = [
    { key: 'n', label: 'Client', value: (g) => g.label, width: 26, render: (g) => g.key.startsWith('tel:') ? g.label : <a href={`#/clients/${g.key}`}>{g.label}</a> },
    { key: 't', label: 'Téléphone', value: (g) => fmtPhone(g.sub) },
    { key: 'o', label: 'Commandes', value: (g) => g.orders, num: true, total: true },
    { key: 'q', label: 'Pièces', value: (g) => g.qty, num: true, total: true },
    { key: 'r', label: 'Retours (pcs)', value: (g) => g.returnsQty, num: true },
    { key: 'f', label: 'Refusées', value: (g) => refused(g.key), num: true },
    { key: 'a', label: 'Achats', value: (g) => g.revenue, money: true, total: true },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><div><h2>Meilleurs clients</h2><p className="small muted">Clients connus par leur téléphone (commandes en ligne et ventes sur place avec numéro).</p></div><ExportBtn onClick={() => exportTables(`clients_${fileDate(from, to)}.xlsx`, [{ name: 'Clients', cols, rows: groups }])} /></div>
      <SortTable rowKey={(g) => g.key} rows={groups} cols={cols} initialSort={{ key: 'a', desc: true }} limit={50} />
    </div>
  );
}

// ---------- Livreurs ----------
interface CRow { c: Courier; count: number; delivered: number; refused: number; out: number; collect: number; fees: number; feeOwed: number; paid: number; balance: number }
function CouriersReport({ from, to }: { from: string; to: string }) {
  const inR = (iso?: string) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
  const rows: CRow[] = all<Courier>('couriers').map((c) => {
    const list = all<Order>('orders').filter((o) => o.courierId === c.id && o.status !== 'cancelled' && inR(o.dispatchedAt));
    const splits = list.map(courierSplit);
    return {
      c, count: list.length, delivered: list.filter((o) => ['delivered', 'partial'].includes(o.status)).length, refused: list.filter((o) => o.status === 'refused').length, out: list.filter((o) => o.status === 'out').length,
      collect: splits.reduce((t, x) => t + x.toCollect, 0), fees: splits.reduce((t, x) => t + x.fee, 0), feeOwed: splits.reduce((t, x) => t + x.feeOwed, 0),
      paid: all<CourierSettlement>('courierSettlements').filter((s) => s.courierId === c.id && inR(s.at)).reduce((t, s) => t + s.amount, 0),
      balance: courierBalance(c.id).due,
    };
  }).filter((r) => r.count || r.paid || r.balance);
  const cols: Col<CRow>[] = [
    { key: 'n', label: 'Livreur', value: (r) => r.c.name },
    { key: 'c', label: 'Livraisons', value: (r) => r.count, num: true, total: true },
    { key: 'd', label: 'Livrées', value: (r) => r.delivered, num: true, total: true },
    { key: 'r', label: 'Refusées', value: (r) => r.refused, num: true, total: true },
    { key: 't', label: 'Réussite', value: (r) => (r.delivered + r.refused ? r.delivered / (r.delivered + r.refused) : 0), render: (r) => (r.delivered + r.refused ? pct(r.delivered / (r.delivered + r.refused)) : '—'), num: true },
    { key: 'o', label: 'Pas confirmées', value: (r) => r.out, num: true, total: true },
    { key: 'a', label: 'À encaisser', value: (r) => r.collect, money: true, total: true },
    { key: 'f', label: 'Frais livreur (info)', value: (r) => r.fees, money: true, total: true },
    { key: 'fo', label: 'Frais à reverser', value: (r) => r.feeOwed, money: true, total: true },
    { key: 'p', label: 'Versé (période)', value: (r) => r.paid, money: true, total: true },
    { key: 'b', label: 'Solde à verser (aujourd’hui)', value: (r) => r.balance, money: true, total: true },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><div><h2>Rapport livreurs</h2><p className="small muted">Livraisons parties pendant la période. Les frais restent aux livreurs : ils ne sont pas dans « à encaisser ».</p></div><ExportBtn onClick={() => exportTables(`livreurs_${fileDate(from, to)}.xlsx`, [{ name: 'Livreurs', cols, rows }])} /></div>
      <SortTable rowKey={(r) => r.c.id} rows={rows} cols={cols} initialSort={{ key: 'c', desc: true }} />
    </div>
  );
}

// ---------- Vendeurs ----------
function Sellers({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const lines = useMemo(() => salesLedger(from, to), [from, to]);
  const groups = groupBy(lines, (l) => l.userName || '—', (k) => ({ label: k === '—' ? 'Non indiqué' : k }));
  const cols: Col<Group>[] = [
    { key: 'n', label: 'Vendeur', value: (g) => g.label },
    { key: 'o', label: 'Ventes', value: (g) => g.orders, num: true, total: true },
    { key: 'q', label: 'Pièces', value: (g) => g.qty, num: true, total: true },
    { key: 'a', label: "Chiffre d'affaires", value: (g) => g.revenue, money: true, total: true },
    { key: 'm', label: 'Marge', value: (g) => g.gross, money: true, total: true, hide: !can('costs.view') },
    { key: 'p', label: 'Panier moyen', value: (g) => (g.orders ? (g.revenue + g.returns) / g.orders : 0), money: true },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><div><h2>Ventes par vendeur</h2><p className="small muted">Selon la personne qui a saisi la commande ou la vente.</p></div><ExportBtn onClick={() => exportTables(`vendeurs_${fileDate(from, to)}.xlsx`, [{ name: 'Vendeurs', cols, rows: groups }])} /></div>
      <SortTable rowKey={(g) => g.key} rows={groups} cols={cols} initialSort={{ key: 'a', desc: true }} />
    </div>
  );
}

// ---------- Stock ----------
interface SRow { p: Product; qty: number; cost: number; value: number; price: number; retail: number }
function StockReport() {
  const can = useCan();
  const cost = can('costs.view');
  const [cat, setCat] = useState('');
  const cats = useTable<Category>('categories');
  const rows: SRow[] = all<Product>('products').filter((p) => p.kind !== 'lot' && (!cat || p.categoryId === cat)).map((p) => {
    const vs = all<Variant>('variants').filter((v) => v.productId === p.id);
    const qty = vs.reduce((t, v) => t + Math.max(0, stockOf(v.id)), 0);
    const value = vs.reduce((t, v) => t + Math.max(0, stockOf(v.id)) * variantCost(v), 0);
    const retail = vs.reduce((t, v) => t + Math.max(0, stockOf(v.id)) * (v.priceRetail ?? p.priceRetail ?? 0), 0);
    return { p, qty, cost: qty ? value / qty : 0, value, price: p.priceRetail ?? 0, retail };
  }).filter((r) => r.qty > 0);
  const cols: Col<SRow>[] = [
    { key: 'c', label: 'Code', value: (r) => r.p.code },
    { key: 'n', label: 'Article', value: (r) => r.p.name, width: 30 },
    { key: 'k', label: 'Catégorie', value: (r) => categoryPath(r.p.categoryId) },
    { key: 'q', label: 'En stock', value: (r) => r.qty, num: true, total: true },
    { key: 'u', label: 'Coût moyen', value: (r) => r.cost, money: true, hide: !cost },
    { key: 'v', label: 'Valeur au coût', value: (r) => r.value, money: true, total: true, hide: !cost },
    { key: 'p', label: 'Prix de vente', value: (r) => r.price, money: true },
    { key: 'r', label: 'Valeur de vente', value: (r) => r.retail, money: true, total: true },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <div className="row-between"><h2>État du stock et valorisation</h2><ExportBtn onClick={() => exportTables(`stock_${today()}.xlsx`, [{ name: 'Stock', cols, rows }])} /></div>
        <div className="filters"><SelectField label="Catégorie" value={cat} onChange={setCat} options={[{ value: '', label: 'Toutes' }, ...cats.map((c) => ({ value: c.id, label: categoryPath(c.id) }))]} /></div>
        <p className="small muted">Stock à ce jour. Le détail des mouvements de chaque article se trouve dans le menu Stock.</p>
      </div>
      <SortTable rowKey={(r) => r.p.id} rows={rows} cols={cols} initialSort={{ key: cost ? 'v' : 'q', desc: true }} limit={100} />
    </div>
  );
}

// ---------- Achats ----------
function Purchases({ from, to }: { from: string; to: string }) {
  const rows = all<Purchase>('purchases').filter((p) => p.date >= from && p.date <= to);
  const cols: Col<Purchase>[] = [
    { key: 'd', label: 'Date', value: (p) => p.date, render: (p) => fmtDate(p.date) },
    { key: 'n', label: 'N°', value: (p) => p.number, render: (p) => <a href={`#/achats/${p.id}`}>{p.number}</a> },
    { key: 'f', label: 'Fournisseur', value: (p) => get<Supplier>('suppliers', p.supplierId || '')?.name ?? '' },
    { key: 's', label: 'Statut', value: (p) => PURCHASE_STATUS[p.status].label },
    { key: 'q', label: 'Pièces', value: (p) => purchaseQty(p), num: true, total: true },
    { key: 'r', label: 'Reçues', value: (p) => purchaseReceivedQty(p), num: true, total: true },
    { key: 't', label: 'Total (devise)', value: (p) => `${Math.round(purchaseTotal(p)).toLocaleString('fr-FR')} ${p.currency === 'RMB' ? '¥' : 'Ar'}` },
    { key: 'a', label: 'Total en Ariary', value: (p) => purchaseTotalAr(p), money: true, total: true },
    { key: 'p', label: 'Reste à payer', value: (p) => Math.max(0, purchaseTotal(p) - purchasePaid(p)) * (p.currency === 'RMB' ? p.rate || 0 : 1), money: true, total: true },
  ];
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><h2>Achats et arrivages</h2><ExportBtn onClick={() => exportTables(`achats_${fileDate(from, to)}.xlsx`, [{ name: 'Achats', cols, rows }])} /></div>
      <SortTable rowKey={(p) => p.id} rows={rows} cols={cols} initialSort={{ key: 'd', desc: true }} />
    </div>
  );
}

export { pct };
export type { Kpis };

// ---------- Clients à suivre : taux de transformation ----------
function FollowConversion({ from, to }: { from: string; to: string }) {
  useTable('prospects');
  const cols: Col<ConvRow>[] = [
    { key: 'l', label: 'Nom', value: (r) => r.label, render: (r) => <strong>{r.label}</strong>, width: 22 },
    { key: 't', label: 'Suivis', value: (r) => r.total, num: true, total: true, width: 9 },
    { key: 'c', label: 'Transformés', value: (r) => r.converted, num: true, total: true, width: 11 },
    { key: 'a', label: 'Abandonnés', value: (r) => r.abandoned, num: true, total: true, width: 11 },
    { key: 'o', label: 'En cours', value: (r) => r.open, num: true, total: true, width: 9 },
    { key: 'r', label: 'Taux de transformation', value: (r) => r.rate, render: (r) => <strong className={r.rate >= 0.5 ? 'pos' : r.rate < 0.25 && r.converted + r.abandoned ? 'neg' : ''}>{pct(r.rate)}</strong>, num: true, width: 14 },
  ];
  const bySeller = conversion(from, to, 'owner'), byPage = conversion(from, to, 'page'), reasons = abandonReasons(from, to);
  const tot = bySeller.reduce((a, r) => ({ c: a.c + r.converted, d: a.d + r.converted + r.abandoned, t: a.t + r.total }), { c: 0, d: 0, t: 0 });
  return (
    <>
      <div className="stat-grid">
        <div className="card stat"><span className="small muted">Clients suivis (créés sur la période)</span><strong className="stat-value num">{tot.t}</strong></div>
        <div className="card stat stat-strong"><span className="small muted">Taux de transformation</span><strong className="stat-value num">{tot.d ? pct(tot.c / tot.d) : '—'}</strong><span className="small muted">transformés / (transformés + abandonnés)</span></div>
      </div>
      <div className="card card-flush"><div className="card-pad"><h2>Par vendeur</h2></div><SortTable rowKey={(r) => r.key} rows={bySeller} cols={cols} initialSort={{ key: 'r', desc: true }} empty="Aucun client suivi sur la période." /></div>
      <div className="card card-flush"><div className="card-pad"><h2>Par page</h2></div><SortTable rowKey={(r) => r.key} rows={byPage} cols={cols} initialSort={{ key: 't', desc: true }} empty="Aucun client suivi sur la période." /></div>
      {reasons.length > 0 && <div className="card stack-s"><h2>Raisons d’abandon</h2><div className="bars">{reasons.map(([n, v]) => <div key={n} className="bar-row"><span className="bar-label">{n}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(v / reasons[0][1]) * 100}%` }} /></span><strong className="num">{v}</strong></div>)}</div></div>}
    </>
  );
}
