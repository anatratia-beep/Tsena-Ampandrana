// Accueil : tableau de bord adapté au rôle (chiffres de la période, trésorerie, stock, livreurs, meilleurs articles).
import { useMemo, useState } from 'react';
import { setMeta } from '../lib/db';
import { fmtAr, fmtNum, productStock, type Product } from '../lib/catalog';
import { bucketOf, type Prospect } from '../lib/prospects';
import { rootOf } from '../lib/scope';
import { get } from '../lib/db';
import type { Category } from '../lib/catalog';
import { OrderRow } from './Orders';
import { anomalies, boostRoi, coverage, sameDayLastWeek, targets } from '../lib/insights';
import { messagesByPage } from '../lib/boosts';
import { addDays } from '../lib/money';
import { ACCOUNTS, balances, courierBalance, today as todayYmd, type AccountId } from '../lib/money';
import { bucketFor, groupBy, kpis, pendingPurchases, previousPeriod, productLabel, salesLedger, series, stockValue, dormant } from '../lib/analytics';
import { PeriodPicker, defaultPeriod, type Period } from '../ui/period';
import { BarChart } from '../ui/chart';
import { Delta } from './Reports';
import { useMyScope } from '../lib/scope';
import { situation, type PageSit } from '../lib/situation';
import type { Courier } from '../lib/orders';
import { managesOwnPassword, roleOf, SUPERADMIN_ID, useCan, useCurrentUser, type User, useMe } from '../lib/auth';
import { useMeta, useTable } from '../lib/db';
import type { Order } from '../lib/orders';
import { isWalkIn } from '../lib/orders';
import { MyDeliveriesPage } from './MyDeliveries';
import { DEFAULT_COMPANY, useCompany } from '../lib/settings';
import { useSyncStatus } from '../lib/sync';
import { Choice, IconButton, PageHead, timeAgo } from '../ui/kit';
import { Icon } from '../ui/icons';

export function DashboardPage() {
  const me = useMe();
  const can = useCan();
  if (me.courierId && can('courier.self') && !can('orders.create')) return <MyDeliveriesPage />;
  return <Board />;
}

function Board() {
  const me = useMe();
  const can = useCan();
  const company = useCompany();
  const users = useTable<User>('users');
  const orders = useTable<Order>('orders');
  const scope = useMyScope();
  const status = useSyncStatus();
  const cloud = useMeta('cloud', null);
  const lastFile = useMeta<string | null>('lastFileBackup', null);
  const lastCloud = useMeta<string | null>('lastCloudBackup', null);
  const lastBackup = [lastFile, lastCloud].filter(Boolean).sort().pop() ?? undefined;
  const session = useMeta<{ at: string } | null>('session', null);
  const hiddenFor = useMeta<string | null>('secretNoticeHidden', null);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const team = users.filter((u) => u.id !== SUPERADMIN_ID && u.active);

  const steps = [
    { done: company.name !== DEFAULT_COMPANY.name || !!company.logo, title: 'Personnaliser la société', text: 'Nom, logo, couleur, téléphone pour les tickets.', href: '#/parametres/societe', perm: 'settings.company' },
    { done: !!cloud, title: 'Relier cet appareil au cloud', text: 'Pour partager les données entre tous les appareils et les mettre à l’abri.', href: '#/parametres/cloud', perm: 'backup.manage' },
    { done: team.length > 0, title: "Créer les comptes de l'équipe", text: 'Vendeurs, propriétaire, magasinier : chacun avec son rôle.', href: '#/utilisateurs', perm: 'users.manage' },
    { done: !!lastBackup, title: 'Faire une première sauvegarde', text: 'Un fichier à garder en lieu sûr.', href: '#/parametres/sauvegarde', perm: 'backup.manage' },
  ].filter((s) => can(s.perm));
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHead title={`${hello}, ${me.fullName.split(' ')[0]}`} subtitle={<span style={{ textTransform: 'capitalize' }}>{today}</span>} />
      {managesOwnPassword(me) && (me.mustChangePassword || !me.secretAnswerHash) && hiddenFor !== session?.at && (
        <div className="notice">
          <Icon name="key" />
          <span style={{ flex: 1 }}>
            {me.mustChangePassword ? 'Votre compte utilise encore le mot de passe provisoire. ' : ''}
            {!me.secretAnswerHash ? 'Aucune question secrète n’est définie. ' : ''}
            <a href="#/compte">Régler maintenant dans Mon compte</a>
          </span>
          <IconButton icon="x" label="Masquer jusqu’à la prochaine connexion" onClick={() => setMeta('secretNoticeHidden', session?.at ?? 'x')} />
        </div>
      )}

      {(can('reports.view') || can('treasury.view')) ? <><ManagerSummary /><SituationCard /><ManagerSales /><SalesExtras /><ManagerMoney /></> : can('orders.create') || can('pos.sell') ? <SellerBoard name={me.fullName} /> : null}
      {can('orders.create') && <OrdersState />}
      {can('cashday.use') && (
        <div className="card row-between daycash-shortcut">
          <div><h3>Caisse du jour</h3><p className="small muted">Saisir une dépense de la caisse commune ou envoyer le récapitulatif global du jour.</p></div>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn btn-ghost" href="#/caisse-du-jour"><Icon name="wallet" />Dépense</a>
            <a className="btn btn-primary" href="#/caisse-du-jour"><Icon name="share" />Récap WhatsApp</a>
          </div>
        </div>
      )}

      {(can('orders.create') || can('pos.sell')) && <BestSellers />}
      {(can('reports.view') || can('treasury.view')) && <><ManagerChart /><h2 className="dash-title">Argent, stock et alertes</h2><Watchlist /><ManagerMore /></>}
      {can('catalog.view') && <LowStock />}
      {steps.length > 0 && doneCount < steps.length && (
        <div className="card stack">
          <div className="row-between">
            <div><h2>Mise en route</h2><p className="muted small">{doneCount} sur {steps.length} terminées</p></div>
          </div>
          <ol className="checklist">
            {steps.map((s, i) => (
              <li key={s.title} className={s.done ? 'step-done' : ''}>
                <a href={s.href}>
                  <span className="step-mark">{s.done ? <Icon name="check" size={16} /> : i + 1}</span>
                  <span className="list-item-main">
                    <span className="step-title" style={{ fontWeight: 700, display: 'block' }}>{s.title}</span>
                    <span className="small muted">{s.text}</span>
                  </span>
                  <Icon name="chevronRight" />
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid-2">
        {can('users.manage') && (
          <a className="card stat" href="#/utilisateurs" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="muted small">Comptes actifs dans l'équipe</span>
            <span className="stat-value">{team.length}</span>
            <span className="small muted">Mots de passe donnés par vous</span>
          </a>
        )}
        <div className="card stat">
          <span className="muted small">Synchronisation</span>
          <span className="stat-value" style={{ fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name={status.state === 'ok' ? 'cloud' : status.state === 'off' ? 'database' : 'cloudOff'} size={26} />
            {{ ok: 'À jour', syncing: 'En cours…', offline: 'Hors connexion', error: 'Problème', off: 'Cet appareil seul' }[status.state]}
          </span>
          <span className="small muted">
            {status.state === 'off' ? 'Les données restent sur cet appareil.' : `Dernière fois ${timeAgo(status.lastSync)}${status.pending ? ` · ${status.pending} en attente` : ''}`}
          </span>
        </div>
        {can('backup.manage') && (
          <div className="card stat">
            <span className="muted small">Dernière sauvegarde</span>
            <span className="stat-value" style={{ fontSize: '1.4rem' }}>{lastBackup ? timeAgo(lastBackup) : 'Aucune'}</span>
            <span className="small muted">Les données sont aussi enregistrées sur l'appareil à chaque action.</span>
          </div>
        )}
      </div>

      {!can('users.manage') && (
        <div className="card stack-s">
          <h2>Votre espace</h2>
          <p className="muted">Vous êtes connecté(e) en tant que <strong>{roleOf(me)?.name}</strong>. {roleOf(me)?.description}</p>
        </div>
      )}
    </>
  );
}

const pct = (n: number) => (Math.abs(n) < 0.0005 ? 0 : n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';

function usePeriod() {
  const saved = useMeta<Period | null>('dashPeriod', null);
  const p = saved?.key && saved.key !== 'custom' ? defaultPeriod(saved.key) : saved ?? defaultPeriod('today');
  return [p, (v: Period) => setMeta('dashPeriod', v)] as const;
}

/** 1. Ventes de la période (en premier). */
function ManagerSummary() { return <ManagerBoard part="summary" />; }
function ManagerSales() { return <ManagerBoard part="sales" />; }
function ManagerMoney() { return <ManagerBoard part="money" />; }
function ManagerChart() { return <ManagerBoard part="chart" />; }
/** 4. Dépenses, bénéfice, évolution par jour, trésorerie, stock, meilleurs articles. */
function ManagerMore() { return <ManagerBoard part="more" />; }

function ManagerBoard({ part }: { part: 'summary' | 'sales' | 'money' | 'chart' | 'more' }) {
  const can = useCan();
  const cost = can('costs.view');
  const orders = useTable<Order>('orders'); const moves = useTable('cashMoves'); useTable('variants'); useTable('stockMoves'); useTable('purchases'); useTable('courierSettlements');
  const couriers = useTable<Courier>('couriers');
  const [period, setPeriod] = usePeriod();
  const from = period.from ?? '2000-01-01', to = period.to ?? todayYmd();
  const lines = useMemo(() => salesLedger(from, to), [from, to, orders, moves]);
  const k = kpis(lines, from, to);
  const prev = previousPeriod(from, to);
  const kp = useMemo(() => kpis(salesLedger(prev.from, prev.to), prev.from, prev.to), [prev.from, prev.to, orders, moves]);
  const b0 = bucketFor(from, to);
  const bucket = b0 === 'hour' ? 'day' : b0; // au minimum par jour (le détail par heure n'est plus affiché)
  const pts = series(lines, from, to, bucket);
  const top = groupBy(lines, (l) => l.productId, productLabel).slice(0, 5);
  const byPage = groupBy(lines, (l) => rootOf(l.categoryId) || '_', (id) => ({ label: id === '_' ? 'Sans page' : get<Category>('categories', id)?.name ?? '?' })).filter((g) => Math.round(g.revenue) !== 0).sort((a, b) => b.revenue - a.revenue);
  const readings = useTable('boostReadings');
  const msgs = useMemo(() => messagesByPage(from, to), [from, to, readings]);
  const msgTotal = [...msgs.values()].reduce((t, n) => t + n, 0);
  const bal = balances();
  const stock = stockValue();
  const purchases = pendingPurchases();
  const courierDue = couriers.reduce((t, c) => t + Math.max(0, courierBalance(c.id).due), 0);
  const out = orders.filter((o) => o.status === 'out');
  const dorm = useMemo(() => dormant(60).slice(0, 5), [orders]);
  const all = [
    { label: "Chiffre d'affaires", value: fmtAr(k.revenue), cur: k.revenue, prev: kp.revenue, show: true, part: 'sales', strong: true },
    { label: `Ventes (${k.shopOrders} sur place · ${k.onlineOrders} en ligne)`, value: String(k.orders), cur: k.orders, prev: kp.orders, show: true, part: 'sales' },
    { label: 'Panier moyen', value: fmtAr(k.avgBasket), cur: k.avgBasket, prev: kp.avgBasket, show: true, part: 'sales' },
    { label: 'Taux de retour', value: pct(k.returnRate), cur: k.returnRate, prev: kp.returnRate, show: true, isPct: true, invert: true, part: 'sales' },
    { label: 'Dépenses', value: fmtAr(k.expenses), cur: k.expenses, prev: kp.expenses, show: true, invert: true, part: 'more' },
    { label: 'Bénéfice brut', value: fmtAr(k.gross), cur: k.gross, prev: kp.gross, show: cost, part: 'more' },
    { label: k.net >= 0 ? 'Bénéfice net' : 'Perte nette', value: fmtAr(k.net), cur: k.net, prev: kp.net, show: cost, strong: true, part: 'more' },
    { label: 'Taux de marge', value: pct(k.margin), cur: k.margin, prev: kp.margin, show: cost, isPct: true, part: 'more' },
  ] as { label: string; value: string; cur: number; prev: number; show: boolean; part: string; strong?: boolean; isPct?: boolean; invert?: boolean }[];
  const tiles = all.filter((t) => t.show && t.part === (part === 'money' ? 'more' : part));
  if (part === 'summary') return (
    <section className="card summary-hero">
      <div className="summary-head">
        <div><h2>Résumé</h2><p className="small muted">{period.key === 'today' ? "Aujourd'hui" : period.from && period.to ? (period.from === period.to ? new Date(`${period.from}T12:00:00`).toLocaleDateString('fr-FR') : `Du ${new Date(`${period.from}T12:00:00`).toLocaleDateString('fr-FR')} au ${new Date(`${period.to}T12:00:00`).toLocaleDateString('fr-FR')}`) : 'Toute la période'}</p></div>
        <div className="summary-tools"><PeriodPicker value={period} onChange={setPeriod} />{can('reports.view') && <a className="link-btn summary-link" href="#/rapports/patron">Rapport au patron ›</a>}</div>
      </div>
      <div className="summary-grid">
        <div className="sm-cell"><span className="sm-label">Chiffre d’affaires</span><strong className="sm-value num">{fmtAr(k.revenue)}</strong><span className="sm-delta"><Delta cur={k.revenue} prev={kp.revenue} /></span></div>
        <div className="sm-cell"><span className="sm-label">Dépenses</span><strong className="sm-value num">{fmtAr(k.expenses)}</strong><span className="sm-delta"><Delta cur={k.expenses} prev={kp.expenses} invert /></span></div>
        <div className="sm-cell"><span className="sm-label">Reste <span className="muted">(CA − dépenses)</span></span><strong className={`sm-value num ${k.revenue - k.expenses < 0 ? 'neg' : ''}`}>{fmtAr(k.revenue - k.expenses)}</strong><span className="sm-delta"><Delta cur={k.revenue - k.expenses} prev={kp.revenue - kp.expenses} /></span></div>
        {cost && <div className="sm-cell sm-strong"><span className="sm-label">{k.net >= 0 ? 'Bénéfice net' : 'Perte nette'}</span><strong className="sm-value num">{fmtAr(k.net)}</strong><span className="sm-delta">après coût des articles ({fmtAr(k.cost)})</span></div>}
      </div>
    </section>
  );
  if (part === 'sales') return (
    <>
      <h2 className="dash-title">Ventes</h2>
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className={`card stat ${t.strong ? 'stat-strong' : ''}`}>
            <span className="small muted">{t.label}</span>
            <strong className={`stat-value num ${t.cur < 0 ? 'neg' : ''}`}>{t.value}</strong>
            <span className="small muted"><Delta cur={t.cur} prev={t.prev} pct={t.isPct} invert={t.invert} /> vs période précédente</span>
            {t.label === "Chiffre d'affaires" && msgTotal > 0 && <span className="small msg-hint"><a href="#/boosts/suivi">{fmtNum(msgTotal)} messages (boosts)</a> · {fmtAr(k.revenue / msgTotal)} par message</span>}
          </div>
        ))}
      </div>
      {byPage.length > 0 && <div className="card card-flush">
        <div className="card-pad"><h2>Chiffre d’affaires par page</h2></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Page</th><th className="t-num">CA</th><th className="t-num">Part</th><th className="t-num">Pièces</th><th className="t-num">Ventes</th>{cost && <th className="t-num">Bénéfice brut</th>}</tr></thead>
          <tbody>{byPage.map((g) => <tr key={g.key}><td><strong>{g.label}</strong><div className="bar-track mini"><span className="bar-fill" style={{ width: `${k.revenue ? Math.max(2, (g.revenue / k.revenue) * 100) : 0}%` }} /></div></td><td className="t-num">{fmtAr(g.revenue)}{msgs.get(g.key) ? <div className="small muted msg-hint">{fmtNum(msgs.get(g.key)!)} messages · {fmtAr(g.revenue / msgs.get(g.key)!)}/msg</div> : null}</td><td className="t-num">{pct(k.revenue ? g.revenue / k.revenue : 0)}</td><td className="t-num">{g.qty}</td><td className="t-num">{g.orders}</td>{cost && <td className="t-num">{fmtAr(g.gross)}</td>}</tr>)}</tbody>
          <tfoot><tr className="t-total"><td>Total</td><td className="t-num">{fmtAr(byPage.reduce((t, g) => t + g.revenue, 0))}{msgTotal ? <div className="small muted msg-hint">{fmtNum(msgTotal)} messages · {fmtAr(byPage.reduce((t, g) => t + g.revenue, 0) / msgTotal)}/msg</div> : null}</td><td className="t-num">100 %</td><td className="t-num">{byPage.reduce((t, g) => t + g.qty, 0)}</td><td className="t-num">{k.orders}</td>{cost && <td className="t-num">{fmtAr(byPage.reduce((t, g) => t + g.gross, 0))}</td>}</tr></tfoot></table></div>
      </div>}
    </>
  );
  if (part === 'money') return (
    <>
      <h2 className="dash-title">Dépenses et bénéfice</h2>
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className={`card stat ${t.strong ? 'stat-strong' : ''}`}>
            <span className="small muted">{t.label}</span>
            <strong className={`stat-value num ${t.cur < 0 ? 'neg' : ''}`}>{t.value}</strong>
            <span className="small muted"><Delta cur={t.cur} prev={t.prev} pct={t.isPct} invert={t.invert} /> vs période précédente</span>
          </div>
        ))}
      </div>
    </>
  );
  if (part === 'chart') return (
    <div className="card stack-s">
      <h2>{cost ? 'Bénéfice net' : "Chiffre d'affaires"} par {bucket === 'day' ? 'jour' : 'mois'}{pts.length <= 1 ? ' (choisissez une semaine ou un mois pour voir l’évolution)' : ''}</h2>
      <BarChart title="Évolution" bars={pts.map((p) => ({ key: p.key, label: p.label, long: p.long, value: cost ? p.gross - p.expenses : p.revenue, extra: `${p.orders} vente(s) · CA ${fmtAr(p.revenue)}` }))} format={fmtAr} />
    </div>
  );
  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        {can('treasury.view') && (
          <a className="card stack-s" href="#/tresorerie" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h2>Trésorerie</h2>
            <table className="kv-table"><tbody>
              {(['cash', 'mvola', 'orange', 'airtel', 'bank'] as AccountId[]).filter((a) => a !== 'bank' || bal.bank).map((a) => <tr key={a}><td>{ACCOUNTS[a]}</td><td className={bal[a] < 0 ? 'neg' : ''}>{fmtAr(bal[a])}</td></tr>)}
              <tr><td>À verser par les livreurs</td><td>{fmtAr(courierDue)}</td></tr>
              <tr className="total"><td>Total</td><td>{fmtAr(Object.values(bal).reduce((t, v) => t + v, 0) + courierDue)}</td></tr>
            </tbody></table>
          </a>
        )}
        <div className="card stack-s">
          <h2>Stock et arrivages</h2>
          <table className="kv-table"><tbody>
            <tr><td>Pièces en stock</td><td>{stock.pieces.toLocaleString('fr-FR')}</td></tr>
            {cost && <tr><td>Valeur du stock (coût)</td><td>{fmtAr(stock.value)}</td></tr>}
            <tr><td>Valeur du stock (prix de vente)</td><td>{fmtAr(stock.retail)}</td></tr>
            <tr><td>Arrivages en attente</td><td>{purchases.count} commande(s) · {purchases.pieces.toLocaleString('fr-FR')} pcs</td></tr>
            {cost && purchases.unpaidAr > 0 && <tr><td>Reste à payer aux fournisseurs</td><td>{fmtAr(purchases.unpaidAr)}</td></tr>}
            <tr><td>En livraison maintenant</td><td>{out.length} commande(s)</td></tr>
          </tbody></table>
        </div>
        <div className="card stack-s">
          <h2>Articles dormants</h2>
          <p className="small muted">En stock, aucune vente depuis 60 jours.</p>
          {dorm.length === 0 ? <p className="small muted">Aucun.</p> : (
            <table className="kv-table"><tbody>{dorm.map((d) => <tr key={d.p.id}><td>{d.p.name} <span className="muted small">· {d.p.code}</span></td><td>{d.qty} pcs</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}

/** Vendeur : ses propres ventes de la période (sans les marges). */
function SellerBoard({ name }: { name: string }) {
  const orders = useTable<Order>('orders');
  const scope = useMyScope();
  const [period, setPeriod] = usePeriod();
  const from = period.from ?? '2000-01-01', to = period.to ?? todayYmd();
  // Vendeur limité à ses pages : ventes de ses pages (quel que soit celui qui a saisi) ; sinon ses propres saisies.
  const lines = useMemo(() => salesLedger(from, to).filter((l) => (scope.strict ? scope.page(rootOf(l.categoryId)) : l.userName === name)), [from, to, orders, name, scope.strict, scope.pages.join()]);
  const k = kpis(lines);
  const pts = series(lines, from, to, bucketFor(from, to));
  return (
    <>
      <div className="card"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="stat-grid">
        <div className="card stat"><span className="small muted">{scope.strict ? 'Ventes de mes pages' : 'Mes ventes'}</span><strong className="stat-value num">{k.orders}</strong><span className="small muted">{k.shopOrders} sur place · {k.onlineOrders} en ligne</span></div>
        <div className="card stat"><span className="small muted">Montant vendu</span><strong className="stat-value num">{fmtAr(k.revenue)}</strong></div>
        <div className="card stat"><span className="small muted">Pièces</span><strong className="stat-value num">{k.pieces}</strong></div>
      </div>
      <SituationCard from={from} to={to} />
      {lines.length > 0 && <div className="card stack-s"><h2>Mes ventes dans le temps</h2><BarChart title="Mes ventes" bars={pts.map((p) => ({ key: p.key, label: p.label, long: p.long, value: p.revenue, extra: `${p.orders} vente(s)` }))} format={fmtAr} /></div>}
    </>
  );
}

/**
 * Situation par page : ventes, espèces, MVola, Orange Money, Airtel Money, reste à payer, annulations, échanges,
 * reports. Vendeur limité à ses pages : seulement ses pages ; gérant : toutes les pages et le total.
 */
function SituationCard({ from: f, to: t }: { from?: string; to?: string }) {
  const ords = useTable<Order>('orders'); useTable('categories');
  const scope = useMyScope();
  const [own, setOwn] = usePeriod();
  const from = f ?? own.from ?? '2000-01-01', to = t ?? own.to ?? todayYmd();
  const sit = useMemo(() => situation(from, to, scope.strict ? scope.pages : undefined), [from, to, scope.strict, scope.pages.join(), ords]);
  const T = sit.total;
  const cols: { k: string; l: string; v: (r: PageSit) => number; money?: boolean; n?: (r: PageSit) => number; cls?: string; strong?: boolean; minus?: boolean }[] = [
    { k: 'gross', l: 'Total commandes', v: (r) => r.gross, money: true },
    { k: 'cancel', l: 'Annulé', v: (r) => r.cancelled, money: true, n: (r) => r.cancelledN, minus: true },
    { k: 'rep', l: 'Reporté', v: (r) => r.reported, money: true, n: (r) => r.reportedN, minus: true },
    { k: 'sales', l: 'Ventes', v: (r) => r.sales, money: true, strong: true },
    { k: 'cash', l: 'Espèces', v: (r) => r.pay.cash, money: true },
    { k: 'mvola', l: 'MVola', v: (r) => r.pay.mvola, money: true },
    { k: 'orange', l: 'Orange Money', v: (r) => r.pay.orange, money: true },
    { k: 'airtel', l: 'Airtel Money', v: (r) => r.pay.airtel, money: true },
    { k: 'rest', l: 'Reste à payer', v: (r) => r.rest, money: true, n: (r) => r.restN, cls: 'neg' },
    { k: 'exch', l: 'dont échange', v: (r) => r.exchange, money: true, n: (r) => r.exchangeN },
  ];
  const sub = (c: (typeof cols)[number], r: PageSit) => c.k === 'sales' ? `${fmtNum(r.qty)} produit(s)` : c.n ? `${c.n(r)} commande(s)` : '';
  const cell = (c: (typeof cols)[number], r: PageSit) => { const v = c.v(r); return <td key={c.k} className={`t-num ${v && c.cls ? c.cls : ''} ${c.strong ? 'sit-strong' : ''}`}>{v ? <>{c.minus ? '− ' : ''}{c.money ? fmtAr(v) : fmtNum(v)}</> : <span className="muted">—</span>}{v && sub(c, r) ? <div className="small muted">{sub(c, r)}</div> : null}</td>; };
  return (
    <div className="card card-flush situation-card">
      <div className="card-pad stack-s">
        <div className="row-between"><h2>{scope.strict ? 'Situation de mes pages' : 'Situation par page'}</h2>{!f && <PeriodPicker value={own} onChange={setOwn} />}</div>
        <div className="stat-grid sit-kpis">
          <div className="card stat"><span className="small muted">Total commandes</span><strong className="stat-value num">{fmtAr(T.gross)}</strong><span className="small muted">ventes + annulé + reporté</span></div>
          <a className="card stat" href="#/commandes/annulees" style={{ textDecoration: 'none', color: 'inherit' }}><span className="small muted">− Annulé</span><strong className="stat-value num">{fmtAr(T.cancelled)}</strong><span className="small muted">{T.cancelledN} commande(s)</span></a>
          <a className="card stat" href="#/commandes/attente" style={{ textDecoration: 'none', color: 'inherit' }}><span className="small muted">− Reporté</span><strong className="stat-value num">{fmtAr(T.reported)}</strong><span className="small muted">{T.reportedN} commande(s), passées à leur nouvelle date</span></a>
          <div className="card stat stat-strong"><span className="small muted">= Ventes</span><strong className="stat-value num">{fmtAr(T.sales)}</strong><span className="small muted">{fmtNum(T.qty)} produit(s) · {T.orders} vente(s){T.exchange ? ` · dont échange ${fmtAr(T.exchange)}` : ''}</span></div>
          <div className="card stat"><span className="small muted">Espèces</span><strong className="stat-value num">{fmtAr(T.pay.cash)}</strong></div>
          <div className="card stat"><span className="small muted">MVola</span><strong className="stat-value num">{fmtAr(T.pay.mvola)}</strong></div>
          <div className="card stat"><span className="small muted">Orange Money</span><strong className="stat-value num">{fmtAr(T.pay.orange)}</strong></div>
          <div className="card stat"><span className="small muted">Airtel Money</span><strong className="stat-value num">{fmtAr(T.pay.airtel)}</strong></div>
          <a className="card stat" href="#/commandes/terminees" style={{ textDecoration: 'none', color: 'inherit' }}><span className="small muted">Reste à payer</span><strong className={`stat-value num ${T.rest ? 'neg' : ''}`}>{fmtAr(T.rest)}</strong><span className="small muted">{T.restN} commande(s)</span></a>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Total commandes − annulé − reporté = <strong>ventes</strong> ; ventes = espèces + MVola + Orange Money + Airtel Money + reste à payer. Une livraison reportée passe à sa nouvelle date ; un échange pris par le client compte dans les ventes, un échange non pris est retiré. Une commande avec des articles de plusieurs pages est répartie selon la valeur de chaque page.</p>
      </div>
      {sit.rows.length === 0 ? <p className="card-pad small muted">Aucune activité sur cette période.</p> : (
        <div className="table-wrap"><table className="table table-grid sit-table">
          <thead><tr><th>Page</th>{cols.map((c) => <th key={c.k} className="t-num">{c.l}</th>)}</tr></thead>
          <tbody>{sit.rows.map((r) => <tr key={r.id}><td><strong>{r.name}</strong></td>{cols.map((c) => cell(c, r))}</tr>)}</tbody>
          {sit.rows.length > 1 && <tfoot><tr className="t-total"><td>{scope.strict ? 'Total de mes pages' : 'Total'}</td>{cols.map((c) => cell(c, T))}</tr></tfoot>}
        </table></div>
      )}
    </div>
  );
}

/** 2. État des commandes : à suivre, enregistrées, en attente, en livraison, argent à rendre par les livreurs. */
function OrdersState() {
  const can = useCan();
  const orders = useTable<Order>('orders');
  const prospects = useTable<Prospect>('prospects');
  const couriers = useTable<Courier>('couriers');
  useTable('courierSettlements'); useTable('cashMoves');
  const scope = useMyScope();
  const follow = prospects.filter((p) => p.status === 'open' && scope.mine({ createdBy: p.ownerId, createdByName: p.ownerName }) && bucketOf(p) !== 'later').length;
  const n = (sts: string[]) => orders.filter((o) => sts.includes(o.status) && !isWalkIn(o) && scope.mine(o)).length;
  const due = couriers.reduce((t, c) => t + Math.max(0, courierBalance(c.id).due), 0);
  const tiles: { label: string; value: string; href: string; hot?: boolean }[] = [
    { label: 'Clients à relancer', value: String(follow), href: '#/commandes/suivre', hot: follow > 0 },
    { label: 'Enregistrées', value: String(n(['new', 'confirmed'])), href: '#/commandes/enregistrees' },
    { label: 'En attente de livraison', value: String(n(['ready'])), href: '#/commandes/attente' },
    { label: 'En livraison', value: String(n(['out'])), href: '#/commandes/livraison' },
    ...(can('deliveries.menu') ? [{ label: 'À rendre par les livreurs', value: fmtAr(due), href: '#/livraisons/retour' }] : []),
  ];
  return (
    <>
      <h2 className="dash-title">Commandes</h2>
      <div className="stat-grid">
        {tiles.map((t) => (
          <a key={t.label} className={`card stat ${t.hot ? 'stat-hot' : ''}`} href={t.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="muted small">{t.label}</span><span className="stat-value num">{t.value}</span>
          </a>
        ))}
      </div>
    </>
  );
}

/** 3. Dernières ventes et commandes. */
function RecentActivity() {
  const orders = useTable<Order>('orders');
  const scope = useMyScope();
  const last = [...orders].filter((o) => scope.mine(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  if (!last.length) return null;
  return (
    <div className="card card-flush">
      <div className="card-pad row-between"><h2>Dernières ventes et commandes</h2><a className="btn btn-ghost" href="#/commandes">Tout voir</a></div>
      <ul className="list">{last.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
    </div>
  );
}

/** 5. Stock faible : articles épuisés ou presque. */
function LowStock() {
  const products = useTable<Product>('products'); useTable('stockMoves'); useTable('variants');
  const scope = useMyScope();
  const low = products.filter((p) => p.active !== false && p.kind !== 'lot' && scope.product(p.id)).map((p) => ({ p, s: productStock(p.id) })).filter((x) => x.s <= (x.p.alertQty ?? 3)).sort((a, b) => a.s - b.s);
  if (!low.length) return null;
  return (
    <div className="card stack-s">
      <div className="row-between"><h2>Stock faible ({low.length})</h2><a className="btn btn-ghost" href="#/stock">Voir le stock</a></div>
      <table className="kv-table"><tbody>{low.slice(0, 6).map(({ p, s }) => <tr key={p.id}><td>{p.name} <span className="muted small">· {p.code}</span></td><td className={s <= 0 ? 'neg' : ''}>{s <= 0 ? 'épuisé' : `${s} pcs`}</td></tr>)}</tbody></table>
      {low.length > 6 && <p className="small muted">… et {low.length - 6} autre(s).</p>}
    </div>
  );
}

/** 4. Meilleures ventes de la période (articles ou pages, triées au choix) et dernières ventes et commandes. */
function BestSellers() {
  const can = useCan();
  const cost = can('costs.view');
  const orders = useTable<Order>('orders'); useTable('variants'); useTable('products'); useTable('categories');
  const [period] = usePeriod();
  const scope = useMyScope();
  const [view, setView] = useState<'articles' | 'pages' | 'dernieres'>('articles');
  const [sort, setSort] = useState<'revenue' | 'qty' | 'gross'>('revenue');
  const from = period.from ?? '2000-01-01', to = period.to ?? todayYmd();
  const lines = useMemo(() => salesLedger(from, to).filter((l) => (scope.strict ? scope.page(rootOf(l.categoryId)) : scope.mine(l.order))), [from, to, orders, scope.on, scope.strict]);
  const groups = (view === 'pages' ? groupBy(lines, (l) => rootOf(l.categoryId) || '_', (k) => ({ label: k === '_' ? 'Sans page' : get<Category>('categories', k)?.name ?? '?' })) : groupBy(lines, (l) => l.productId, productLabel))
    .sort((a, b) => (b[sort] as number) - (a[sort] as number)).slice(0, 8);
  const max = Math.max(1, ...groups.map((g) => Math.abs(g[sort] as number)));
  const last = [...orders].filter((o) => scope.mine(o) && o.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const fmt = (g: { revenue: number; qty: number; gross: number }) => (sort === 'qty' ? `${g.qty} pcs` : fmtAr(sort === 'gross' ? g.gross : g.revenue));
  return (
    <>
      <h2 className="dash-title">Meilleures ventes</h2>
      <div className="card stack-s">
        <div className="row-between" style={{ gap: 8 }}>
          <Choice label="Voir" value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: 'articles', label: 'Articles' }, { value: 'pages', label: 'Pages' }, { value: 'dernieres', label: 'Dernières commandes' }]} />
          {view !== 'dernieres' && <Choice label="Trier par" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ value: 'revenue', label: 'CA' }, { value: 'qty', label: 'Quantité' }, ...(cost ? [{ value: 'gross', label: 'Bénéfice' }] : [])]} />}
        </div>
        {view === 'dernieres' ? (last.length ? <ul className="list">{last.map((o) => <OrderRow key={o.id} o={o} />)}</ul> : <p className="small muted">Aucune commande.</p>)
          : groups.length === 0 ? <p className="small muted">Aucune vente sur la période choisie en haut (Ventes).</p> : (
            <div className="bars">{groups.map((g, i) => (
              <div key={g.key} className="bar-row"><span className="bar-label"><span className="rank">{i + 1}</span> {g.label}{g.sub ? <span className="muted small"> · {g.sub}</span> : null}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, (Math.abs(g[sort] as number) / max) * 100)}%` }} /></span><strong className="num">{fmt(g)}</strong></div>
            ))}</div>
          )}
      </div>
    </>
  );
}

/** Objectifs de vente (jour, mois) et comparaison avec le même jour de la semaine dernière. */
function SalesExtras() {
  useTable('orders');
  const [period] = usePeriod();
  const goals = targets();
  const isToday = period.key === 'today';
  const last = isToday ? sameDayLastWeek() : null;
  const todayRev = isToday ? kpis(salesLedger(todayYmd(), todayYmd())).revenue : 0;
  const dayName = new Date().toLocaleDateString('fr-FR', { weekday: 'long' });
  if (!goals.length && !last) return null;
  return (
    <div className="card stack-s">
      {last && <p className="small">Comparé à {dayName} dernier ({fmtAr(last.revenue)}) : <Delta cur={todayRev} prev={last.revenue} /></p>}
      {goals.map((g) => (
        <div key={g.label} className="goal">
          <div className="row-between"><strong>{g.label}</strong><span className="num small">{fmtAr(g.done)} / {fmtAr(g.target)} · <strong>{Math.round(g.ratio * 100)} %</strong></span></div>
          <div className="goal-track"><span className={`goal-fill ${g.ratio >= 1 ? 'is-done' : g.behind ? 'is-behind' : ''}`} style={{ width: `${Math.min(100, g.ratio * 100)}%` }} />{g.expected != null && <span className="goal-pace" style={{ left: `${Math.min(100, (g.expected / g.target) * 100)}%` }} title="Rythme à tenir aujourd’hui" />}</div>
          {g.behind ? <p className="small muted">En retard de {fmtAr(g.behind)} sur le rythme du mois (trait vertical = où il faudrait être aujourd’hui).</p> : g.ratio >= 1 ? <p className="small ok-text">Objectif atteint ✓</p> : null}
        </div>
      ))}
      {!goals.length && <p className="small muted">Fixez des objectifs de vente (jour, mois) dans <a href="#/parametres/societe">Paramètres → Société</a> pour suivre votre progression ici.</p>}
    </div>
  );
}

/** À surveiller : anomalies (7 derniers jours), fin de stock prévue, boosts pas rentables (mois en cours). */
function Watchlist() {
  useTable('orders'); useTable('stockMoves'); useTable('payouts'); useTable('boostReadings');
  const t = todayYmd();
  const an = anomalies(addDays(t, -6), t);
  const cov = coverage(14).slice(0, 6);
  const roi = boostRoi(t.slice(0, 8) + '01', t).filter((r) => r.profit < 0);
  if (!an.length && !cov.length && !roi.length) return null;
  return (
    <div className="card stack-s watch">
      <h2><Icon name="alert" /> À surveiller</h2>
      {cov.length > 0 && <div><strong className="small">Bientôt en rupture (au rythme des 30 derniers jours)</strong>
        <table className="kv-table"><tbody>{cov.map((c) => <tr key={c.product.id}><td>{c.product.name} <span className="muted small">· {c.product.code} · {c.stock} pcs, ~{c.perDay.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/jour</span></td><td className={c.days <= 3 ? 'neg' : ''}>{c.days < 1 ? 'moins d’1 jour' : `~${Math.round(c.days)} jour(s)`}</td></tr>)}</tbody></table></div>}
      {roi.length > 0 && <div><strong className="small">Boosts pas rentables ce mois</strong>
        <table className="kv-table"><tbody>{roi.map((r) => <tr key={r.pageId}><td>{r.name} <span className="muted small">· 1 $ rapporte {fmtAr(r.perUsd)} de CA</span></td><td className="neg">{fmtAr(r.profit)}</td></tr>)}</tbody></table></div>}
      {an.length > 0 && <div><strong className="small">À vérifier (7 derniers jours)</strong>
        <ul className="plain-list small">{an.slice(0, 8).map((a, i) => <li key={i}><a href={a.href}>{a.text}</a></li>)}</ul></div>}
    </div>
  );
}
