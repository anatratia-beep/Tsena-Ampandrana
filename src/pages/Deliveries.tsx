// Livraisons : commandes prêtes par axe, en cours par livreur, comptes des livreurs, zones et frais.
import { allPages } from '../lib/boosts';
import { variantPage } from '../lib/scope';
import { useMemo, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, remove, save, useTable } from '../lib/db';
import { fmtAr, fmtNum, parseNum } from '../lib/catalog';
import { orderText, choiceQty, hasPendingChoice, courierAccount, courierSplit, fmtPhone, isPickupZone, orderLabel, remaining, totalQty, type Courier, type Order, type Zone } from '../lib/orders';
import { Help, Badge, FilterSelect, MultiPick, Button, Confirm, Empty, IconButton, Modal, PageHead, SelectField, TextField, Toggle, fmtDateTime, navigate, toast, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PeriodPicker, defaultPeriod, inPeriod, type Period } from '../ui/period';
import { matchQuery } from '../lib/catalog';
import { DispatchModal, ReassignModal, ReturnModal, OrderRow } from './Orders';
import { CourierReturn } from './CourierReturn';
import { useCompany } from '../lib/settings';
import { deliveryNoteDoc, joinDocs, parcelLabelDoc, routeSheetDoc } from '../lib/print';
import { PrintButton } from '../ui/print';
import { ACCOUNTS, ACCOUNT_IDS, FEE_STATE, courierBalance, courierRemovalBlockers, removeCourier, deferredOrders, deliveryNet, feeState, payDeferredFees, settleCourier, type AccountId, type CourierSettlement } from '../lib/money';

const TABS = [
  { key: 'livreurs', label: 'Comptes livreurs', perm: 'couriers.view' },
  { key: 'a-livrer', label: 'En attente de livraison', perm: 'orders.dispatch' },
  { key: 'en-cours', label: 'En livraison', perm: 'deliveries.manage' },
  { key: 'retour', label: 'Retour livreur', perm: 'deliveries.manage' },
  { key: 'zones', label: 'Zones et frais', perm: 'couriers.view' },
];

/** Filtres communs : livreur, période, recherche (tout le contenu de la commande). */
function useDelivFilters(initial: Period['key'] = 'all') {
  const [courierId, setCourierId] = useState('');
  const [period, setPeriod] = useState<Period>(defaultPeriod(initial));
  const [q, setQ] = useState('');
  const [pageId, setPageId] = useState('');
  return { courierId, setCourierId, period, setPeriod, q, setQ, pageId, setPageId };
}
type DF = ReturnType<typeof useDelivFilters>;
function DelivFilters({ f, dateLabel, searchHint, noPage }: { f: DF; dateLabel: string; searchHint?: string; noPage?: boolean }) {
  const pages = allPages();
  const couriers = useTable<Courier>('couriers').filter((c) => c.active !== false && !c.removed).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return (
    <div className="card stack-s deliv-filters">
      <div className="row">
        <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="df-c">Livreur</label><FilterSelect label="Livreur" value={f.courierId} onChange={f.setCourierId} options={[{ value: '', label: 'Tous les livreurs' }, ...couriers.map((c) => ({ value: c.id, label: c.name }))]} /></div>
        {!noPage && pages.length > 1 && <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="df-p">Page</label><FilterSelect label="Page" value={f.pageId} onChange={f.setPageId} options={[{ value: '', label: 'Toutes les pages' }, ...pages.map((p) => ({ value: p.id, label: p.name }))]} /></div>}
        <div style={{ flex: '2 1 260px' }}><PeriodPicker value={f.period} onChange={f.setPeriod} /></div>
      </div>
      <div className="field"><input aria-label="Rechercher" placeholder={searchHint ?? 'Rechercher : n°, client, téléphone, lieu, article, montant…'} value={f.q} onChange={(e) => f.setQ(e.target.value)} /></div>
      <p className="small muted" style={{ margin: 0 }}>Période sur {dateLabel}.</p>
    </div>
  );
}
const passes = (o: Order, f: DF, date?: string) => (!f.courierId || o.courierId === f.courierId) && (!f.pageId || o.lines.some((l) => variantPage(l.variantId) === f.pageId)) && (f.period.key === 'all' || inPeriod(date, f.period)) && (!f.q.trim() || matchQuery(orderText(o), f.q));

export function DeliveriesPage() {
  const can = useCan();
  const route = useRoute();
  const tabs = TABS.filter((t) => can(t.perm));
  const cur = tabs.find((t) => route.endsWith('/' + t.key)) ?? tabs[0];
  if (!cur) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Livraisons" />
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/livraisons/' + t.key)}>{t.label}</button>)}</div>
      {cur.key === 'a-livrer' && <ToDeliver />}
      {cur.key === 'en-cours' && <OutNow />}
      {cur.key === 'retour' && <CourierReturn />}
      {cur.key === 'livreurs' && <Couriers />}
      {cur.key === 'zones' && <Zones />}
    </>
  );
}

function ToDeliver() {
  const company = useCompany();
  const orders = useTable<Order>('orders');
  const zones = useTable<Zone>('zones');
  const [sel, setSel] = useState<string[]>([]);
  const [dispatch, setDispatch] = useState(false);
  const f = useDelivFilters('all');
  const ready = orders.filter((o) => o.status === 'ready' && !isPickupZone(o.zoneId) && passes(o, f, o.createdAt));
  const preparing = orders.filter((o) => ['new', 'confirmed'].includes(o.status) && o.channel !== 'shop').length;
  const groups = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of ready) { const k = o.zoneId || ''; if (!m.has(k)) m.set(k, []); m.get(k)!.push(o); }
    return [...m.entries()].sort((a, b) => (get<Zone>('zones', a[0])?.order ?? 99) - (get<Zone>('zones', b[0])?.order ?? 99));
  }, [orders, zones, f.courierId, f.period, f.q]);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <>
      <DelivFilters f={f} dateLabel="la date de la commande ; livreur = livreur prévu" />
      <div className="card row-between">
        <p className="small">{ready.length} commande(s) en attente de livraison{preparing ? ` · ${preparing} enregistrée(s), pas encore préparée(s)` : ''}. Imprimez les étiquettes, cochez les commandes d’un même axe puis remettez-les au livreur.</p>
        <div className="row" style={{ gap: 6 }}>
          {ready.length > 0 && <PrintButton label={sel.length ? `Étiquettes (${sel.length})` : 'Toutes les étiquettes'} docs={[{ key: 'etq', label: `Étiquettes colis 58 mm (${(sel.length ? ready.filter((o) => sel.includes(o.id)) : ready).length})`, build: () => joinDocs('Étiquettes colis', (sel.length ? ready.filter((o) => sel.includes(o.id)) : ready).map((o) => parcelLabelDoc(o, company))) }]} />}
          <Button icon="truck" disabled={!sel.length} onClick={() => setDispatch(true)}>Remettre {sel.length || ''} au livreur</Button>
        </div>
      </div>
      {groups.length === 0 ? <div className="card"><Empty icon="truck" title="Aucune commande en attente de livraison"><Button variant="ghost" onClick={() => navigate('/commandes/enregistrees')}>Voir les commandes enregistrées</Button></Empty></div> : groups.map(([zid, list]) => (
        <div key={zid} className="card card-flush">
          <div className="row-between card-pad">
            <h3>{get<Zone>('zones', zid)?.name || 'Zone non indiquée'} <span className="muted small">· {list.length} commande(s)</span></h3>
            <Button variant="quiet" onClick={() => setSel([...new Set([...sel, ...list.map((o) => o.id)])])}>Tout cocher</Button>
          </div>
          <ul className="list">
            {list.map((o) => (
              <li key={o.id} className="list-item">
                <input type="checkbox" className="perm-check" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} aria-label={`Choisir ${o.number}`} />
                <a className="list-item-main" href={`#/commandes/${o.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="list-item-title">{orderLabel(o)}</span>
                  <p className="small muted">{o.number} · {fmtPhone(o.phone)} · {o.place || 'lieu non précisé'} · {fmtNum(totalQty(o))} article(s){o.lines.some((l) => l.isChoice) ? ' + choix' : ''}</p>
                </a>
                <div className="list-item-side"><strong className="num">{fmtAr(courierSplit(o).toCollect)}</strong><span className="small muted">à encaisser{courierSplit(o).fee ? ` + frais ${fmtAr(courierSplit(o).feeKept)}` : ''}</span></div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {dispatch && <DispatchModal orders={ready.filter((o) => sel.includes(o.id))} onClose={() => { setDispatch(false); setSel([]); }} />}
    </>
  );
}

function OutNow() {
  const company = useCompany();
  const orders = useTable<Order>('orders');
  const couriers = useTable<Courier>('couriers');
  useTable<Zone>('zones');
  const [ret, setRet] = useState<Order | null>(null);
  const [move, setMove] = useState<Order | null>(null);
  const f = useDelivFilters('all');
  const out = orders.filter((o) => o.status === 'out' && passes(o, f, o.dispatchedAt));
  const byCourier = new Map<string, Order[]>();
  for (const o of out) { const k = o.courierId || ''; if (!byCourier.has(k)) byCourier.set(k, []); byCourier.get(k)!.push(o); }
  return (
    <>
      <DelivFilters f={f} dateLabel="la date de départ chez le livreur" />
      {out.length === 0 ? <div className="card"><Empty icon="truck" title="Aucune livraison en cours" /></div> : [...byCourier.entries()].map(([cid, list]) => {
        const c = couriers.find((x) => x.id === cid);
        return (
          <div key={cid} className="card card-flush">
            <div className="row-between card-pad">
              <div><h3>{c?.name || 'Livreur ?'}</h3><p className="small muted">{list.length} commande(s) · {fmtNum(list.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty, 0), 0))} article(s) dehors</p></div>
              <div className="row" style={{ alignItems: 'center' }}>
                <PrintButton label="Ticket livreur" docs={[
                  { key: 'route', label: 'Ticket des livraisons', build: () => routeSheetDoc(c, list, company) },
                  { key: 'bons', label: `Bons de livraison (${list.length})`, build: () => joinDocs(`Bons de livraison ${c?.name ?? ''}`, list.map((o) => deliveryNoteDoc(o, company))) },
                ]} />
                <div className="total-box"><span className="small muted">À encaisser (sans frais)</span><strong className="num">{fmtAr(list.reduce((s, o) => s + courierSplit(o).toCollect, 0))}</strong><span className="small muted">frais livreur : {fmtAr(list.reduce((s, o) => s + courierSplit(o).fee, 0))}</span></div>
              </div>
            </div>
            <ul className="list">
              {list.map((o) => (
                <li key={o.id} className="list-item">
                  <a className="list-item-main" href={`#/commandes/${o.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="list-item-title">{orderLabel(o)} <span className="muted small">{o.number}</span>{hasPendingChoice(o) && <> <Badge tone="danger">Choix à préciser ({choiceQty(o)})</Badge></>}</span>
                    <p className="small muted">{get<Zone>('zones', o.zoneId || '')?.name}{o.place ? ` — ${o.place}` : ''} · à encaisser <strong>{fmtAr(courierSplit(o).toCollect)}</strong>{courierSplit(o).toCollect === 0 ? ' (déjà payé)' : ''} · frais livreur {fmtAr(courierSplit(o).fee)}{courierSplit(o).feeOwed ? ` (payés par Mobile Money : à lui reverser)` : ''}</p>
                  </a>
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <Button variant="quiet" onClick={() => setMove(o)}>Changer de livreur</Button>
                    <Button variant={hasPendingChoice(o) ? 'primary' : 'ghost'} onClick={() => setRet(o)}>{hasPendingChoice(o) ? 'Préciser le choix' : 'Retour'}</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {ret && <ReturnModal order={ret} onClose={() => setRet(null)} />}
      {move && <ReassignModal order={move} onClose={() => setMove(null)} />}
    </>
  );
}

function Couriers() {
  const can = useCan();
  const company = useCompany();
  const couriers = useTable<Courier>('couriers');
  useTable<Order>('orders');
  const zones = useTable<Zone>('zones');
  const f = useDelivFilters('today');
  const period = f.period;
  const [edit, setEdit] = useState<Courier | 'new' | null>(null);
  const [open, setOpen] = useState<Courier | null>(null);
  const [settle, setSettle] = useState<Courier | null>(null);
  const [del, setDel] = useState<Courier | null>(null);
  useTable<CourierSettlement>('courierSettlements'); useTable('users');
  const sorted = [...couriers].filter((c) => !c.removed && (!f.courierId || c.id === f.courierId) && (!f.q.trim() || matchQuery(`${c.name} ${c.phone ?? ''} ${c.notes ?? ''}`, f.q))).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
  return (
    <>
      <div className="card stack">
        <div className="row-between"><Help>Un livreur peut avoir son propre accès (Utilisateurs → rôle « Livreur ») pour voir seulement ses colis et son compte. Sans accès, ajoutez simplement sa fiche ici. Touchez un livreur pour voir ses livraisons et l’état de ses frais.</Help>{can('couriers.manage') && <Button icon="plus" onClick={() => setEdit('new')}>Ajouter un livreur</Button>}</div>
      </div>
      <DelivFilters f={f} dateLabel="les livraisons (colonnes « Livrées », « Encaissé », « Frais », « Solde période »)" searchHint="Rechercher un livreur (nom, téléphone)…" noPage />
      <div className="card card-flush">
        {sorted.length === 0 ? <Empty icon="truck" title="Aucun livreur" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Livreur</th><th className="t-num">En cours</th><th className="t-num">Livrées</th><th className="t-num">Encaissé</th><th className="t-num">Frais gagnés</th><th className="t-num">Solde période</th><th className="t-num">Solde à verser</th><th className="t-num">Frais différés</th><th></th></tr></thead>
              <tbody>
                {sorted.map((c) => {
                  const a = courierAccount(c.id, period.from, period.to);
                  const bal = courierBalance(c.id).due;
                  return (
                    <tr key={c.id} style={{ opacity: c.active === false ? .55 : 1 }} className="row-link" onClick={() => setOpen(c)}>
                      <td><strong>{c.name}</strong><div className="small muted">{[fmtPhone(c.phone), (c.zoneIds || []).map((z) => zones.find((x) => x.id === z)?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div></td>
                      <td className="t-num">{a.out || '—'}</td>
                      <td className="t-num">{a.deliveries || '—'}</td>
                      <td className="t-num">{fmtAr(a.collected)}</td>
                      <td className="t-num">{fmtAr(a.fees)}</td>
                      <td className={`t-num ${a.due > 0 ? '' : a.due < 0 ? 'neg' : ''}`}><strong>{a.due > 0 ? `rend ${fmtAr(a.due)}` : a.due < 0 ? `à lui verser ${fmtAr(-a.due)}` : '—'}</strong></td>
                      <td className={`t-num ${bal < 0 ? 'neg' : ''}`}><strong>{bal > 0 ? `doit ${fmtAr(bal)}` : bal < 0 ? `à lui verser ${fmtAr(-bal)}` : '✓ à jour'}</strong></td>
                      <td className="t-num">{(() => { const d = deferredOrders(c.id); const t = d.reduce((x, o) => x + courierSplit(o).fee, 0); return t ? <Badge tone="danger">{fmtAr(t)} à payer ({d.length})</Badge> : <span className="muted small">aucun</span>; })()}</td>
                      <td className="t-actions"><div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}><span onClick={(e) => e.stopPropagation()}><PrintButton variant="quiet" label="Ticket" docs={[{ key: 'liste', label: 'Livraisons à verser', build: () => routeSheetDoc(c, courierBalance(c.id).pending, company, 'LIVRAISONS À VERSER') }]} /></span>{can('couriers.settle') && <Button variant="ghost" className="btn-sm" onClick={(e) => { e.stopPropagation(); navigate('/livraisons/retour'); }}>Régler</Button>}{can('couriers.manage') && <IconButton icon="edit" label="Modifier" onClick={(e) => { e.stopPropagation(); setEdit(c); }} />}{can('couriers.manage') && <IconButton icon="trash" label={`Supprimer le livreur ${c.name}`} onClick={(e) => { e.stopPropagation(); setDel(c); }} />}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Help>Solde = argent encaissé auprès des clients − frais de livraison gagnés. « Rend » : le livreur doit cette somme à la boutique. « À lui verser » : la boutique lui doit ses frais (ex. client qui a tout payé par MVola à la boutique). « Solde à verser » : argent encaissé pour la boutique sur toutes les livraisons pas encore versées (sans les frais du livreur), moins les frais à lui reverser, plus le reste des versements précédents. « Ticket » imprime la liste à remettre au livreur. Les règlements se font dans la commande (« Retour du livreur », quand elle passe de En livraison à Terminée) ou, pour plusieurs colis à la fois, dans « Retour livreur » (bouton « Régler »).</Help>
      {edit && <CourierForm courier={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {del && <DeleteCourier c={del} onClose={() => setDel(null)} />}
      {open && <CourierOrders courier={open} onClose={() => setOpen(null)} />}
      {settle && <SettleModal courier={settle} onClose={() => setSettle(null)} />}
    </>
  );
}

/**
 * Versement d'un livreur (admin) : on coche les livraisons réellement effectuées. Seules celles-ci sont réglées ;
 * les autres restent sur son compte et passent automatiquement au versement suivant.
 */
function SettleModal({ courier, onClose }: { courier: Courier; onClose: () => void }) {
  const company = useCompany();
  useTable<Order>('orders');
  const settlements = useTable<CourierSettlement>('courierSettlements').filter((s) => s.courierId === courier.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const b = courierBalance(courier.id);
  const [checked, setChecked] = useState<string[]>([]);
  const [amount, setAmount] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountId>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState<Order | null>(null);
  const checkable = (o: Order) => !hasPendingChoice(o);
  const blocked = b.pending.filter((o) => !checkable(o));
  const sel = b.pending.filter((o) => checked.includes(o.id));
  const selNet = sel.reduce((t, o) => t + deliveryNet(o).net, 0);
  const selCollect = sel.reduce((t, o) => t + deliveryNet(o).collect, 0);
  const selFeeOwed = sel.reduce((t, o) => t + deliveryNet(o).feeOwed, 0);
  const expected = b.carry + selNet;
  const n = amount == null ? Math.abs(expected) : parseNum(amount) || 0;
  const owesShop = expected >= 0;
  const after = owesShop ? expected - n : expected + n;
  const toggle = (id: string) => setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  return (
    <Modal title={`Versement — ${courier.name}`} onClose={onClose} wide
      footer={<>
        <PrintButton label="Ticket des livraisons" docs={[{ key: 'liste', label: 'Livraisons à verser', build: () => routeSheetDoc(courier, b.pending, company, 'LIVRAISONS À VERSER') }]} />
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button busy={busy} disabled={!sel.length && !n} onClick={async () => {
          setBusy(true);
          try { await settleCourier(courier, sel.map((o) => o.id), owesShop ? n : -n, account, note.trim() || undefined); toast('Versement enregistré'); onClose(); } catch (e: any) { toast(e?.message ?? String(e), 'error'); } finally { setBusy(false); }
        }}>Valider le versement</Button></>}>
      <div className="stack">
        <p className="small">Les frais du livreur ne sont jamais dans le montant à encaisser : il les garde. Cochez les livraisons <strong>réellement effectuées</strong> (d’après le ticket rapporté par le livreur). Les autres restent sur son compte et seront reportées au prochain versement. Pour une livraison pas faite, refusée ou un retour, touchez « Retour / anomalie ».</p>
        {blocked.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span><strong>{blocked.length} livraison(s) avec un choix à préciser</strong> ({blocked.map((o) => o.number).join(', ')}) : elles ne peuvent pas être versées. Touchez « Préciser le choix » sur la ligne, indiquez ce que le client a gardé, puis cochez-la.</span></div>}
        {b.pending.length === 0 ? <Empty icon="truck" title="Aucune livraison en attente de versement" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th style={{ width: 40 }}><input type="checkbox" className="perm-check" aria-label="Tout cocher" checked={sel.length > 0 && sel.length === b.pending.filter(checkable).length} onChange={(e) => setChecked(e.target.checked ? b.pending.filter(checkable).map((o) => o.id) : [])} /></th>
              <th>Livraison</th><th>État</th><th className="t-num">À encaisser</th><th className="t-num muted">Frais livreur</th><th className="t-num">Frais à reverser</th><th></th>
            </tr></thead>
            <tbody>
              {b.pending.map((o) => {
                const d = deliveryNet(o);
                const ok = checkable(o);
                return (
                  <tr key={o.id} className={checked.includes(o.id) ? 'is-checked' : !ok ? 'is-choice' : ''}>
                    <td><input type="checkbox" className="perm-check" disabled={!ok} title={ok ? undefined : 'Précisez d’abord le choix du client'} checked={checked.includes(o.id)} onChange={() => toggle(o.id)} aria-label={`Livraison ${o.number} effectuée`} /></td>
                    <td><strong>{o.number}</strong> <span className="small muted">{orderLabel(o)} · {get<Zone>('zones', o.zoneId || '')?.name}{o.place ? ` — ${o.place}` : ''} · partie le {fmtDateTime(o.dispatchedAt)}</span></td>
                    <td>{o.status === 'out' ? (ok ? <Badge tone="warn">À confirmer</Badge> : <Badge tone="danger">Choix à préciser ({choiceQty(o)})</Badge>) : <Badge tone={o.status === 'refused' ? 'danger' : 'ok'}>{o.status === 'refused' ? 'Refusée' : o.status === 'partial' ? 'Livrée en partie' : 'Livrée'}</Badge>}</td>
                    <td className="t-num"><strong>{fmtAr(d.collect)}</strong>{d.collect === 0 && o.payments.some((p) => p.receivedBy === 'shop') ? <div className="small muted">payé par Mobile Money</div> : null}</td><td className="t-num muted">{fmtAr(d.fee)}</td><td className="t-num">{d.feeOwed ? fmtAr(d.feeOwed) : '—'}</td>
                    <td>{o.status === 'out' && (ok ? <Button variant="quiet" onClick={() => setRet(o)}>Retour / anomalie</Button> : <Button onClick={() => setRet(o)}>Préciser le choix</Button>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <div className="stat-grid">
          {b.carry !== 0 && <div className="card stat"><span className="small muted">Reste des versements précédents</span><strong className={`stat-value num ${b.carry < 0 ? 'neg' : ''}`}>{fmtAr(b.carry)}</strong></div>}
          <div className="card stat"><span className="small muted">À encaisser — cochées ({sel.length})</span><strong className="stat-value num">{fmtAr(selCollect)}</strong></div>
          {selFeeOwed > 0 && <div className="card stat"><span className="small muted">Frais à lui reverser (payés par Mobile Money)</span><strong className="stat-value num neg">− {fmtAr(selFeeOwed)}</strong></div>}
          <div className="card stat stat-strong"><span className="small muted">{owesShop ? 'Net à verser par le livreur' : 'Net : la boutique lui doit'}</span><strong className="stat-value num">{fmtAr(Math.abs(expected))}</strong></div>
          <div className="card stat"><span className="small muted">Reporté (non cochées)</span><strong className="stat-value num">{fmtAr(b.pendingCollect - selCollect)}</strong></div>
        </div>
        <div className="grid-2">
          <TextField label={owesShop ? 'Montant versé par le livreur (Ar)' : 'Montant versé au livreur (Ar)'} value={amount ?? String(Math.abs(expected) || '')} onChange={setAmount} inputMode="numeric" />
          <SelectField label={owesShop ? 'Argent reçu sur' : 'Payé depuis'} value={account} onChange={(v) => setAccount(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} />
        </div>
        <TextField label="Note (remarques du ticket, facultatif)" value={note} onChange={setNote} />
        <p className="small">{after === 0 ? '✓ Après ce versement, les livraisons cochées sont soldées.' : after > 0 ? `Il restera ${fmtAr(after)} à verser par le livreur (ajouté au prochain versement).` : `La boutique lui devra encore ${fmtAr(-after)}.`}</p>
        {sel.some((o) => o.status === 'out') && <p className="small muted">Les livraisons cochées encore « à confirmer » seront marquées livrées : le client a payé au livreur tout ce qui restait.</p>}
        {settlements.length > 0 && (
          <div className="stack-s">
            <h3>Derniers versements</h3>
            <ul className="list">{settlements.map((s) => (
              <li key={s.id} className="list-item"><div className="list-item-main"><span className="list-item-title">{s.amount >= 0 ? `Versé ${fmtAr(s.amount)}` : `Payé au livreur ${fmtAr(-s.amount)}`}</span><p className="small muted">{fmtDateTime(s.at)} · {ACCOUNTS[s.account]} · attendu {fmtAr(s.balanceBefore)} · {s.orderIds.length} livraison(s){s.userName ? ` · ${s.userName}` : ''}{s.note ? ` · ${s.note}` : ''}</p></div></li>
            ))}</ul>
          </div>
        )}
      </div>
      {ret && <ReturnModal order={ret} onClose={() => setRet(null)} />}
    </Modal>
  );
}

function CourierOrders({ courier, onClose }: { courier: Courier; onClose: () => void }) {
  const can = useCan();
  useTable('courierSettlements');
  const all = useTable<Order>('orders').filter((o) => o.courierId === courier.id && o.dispatchedAt).sort((a, b) => (b.dispatchedAt || '').localeCompare(a.dispatchedAt || ''));
  const [show, setShow] = useState<'all' | 'deferred'>('all');
  const [pay, setPay] = useState<Order | 'all' | null>(null);
  const deferred = deferredOrders(courier.id);
  const deferredSum = deferred.reduce((t, o) => t + courierSplit(o).fee, 0);
  const list = (show === 'deferred' ? deferred : all).slice(0, 80);
  const [acc, setAcc] = useState<AccountId>('cash');
  return (
    <Modal title={`Livraisons de ${courier.name}`} onClose={onClose} wide>
      <div className="stack">
        <div className="stat-grid">
          <div className="card stat"><span className="small muted">Livraisons</span><strong className="stat-value num">{all.length}</strong></div>
          <div className="card stat"><span className="small muted">Frais gagnés (livraisons terminées)</span><strong className="stat-value num">{fmtAr(all.filter((o) => ['delivered', 'partial', 'refused'].includes(o.status)).reduce((t, o) => t + courierSplit(o).fee, 0))}</strong></div>
          <div className={`card stat ${deferredSum ? 'stat-hot' : ''}`}><span className="small muted">Frais différés à lui payer</span><strong className="stat-value num">{fmtAr(deferredSum)}</strong>{deferredSum > 0 && can('couriers.settle') && <Button className="btn-sm" onClick={() => setPay('all')}>Tout payer</Button>}</div>
        </div>
        <div className="segmented" role="group" aria-label="Afficher"><button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>Toutes</button><button type="button" aria-pressed={show === 'deferred'} onClick={() => setShow('deferred')}>Frais différés ({deferred.length})</button></div>
        {list.length === 0 ? <Empty icon="truck" title="Aucune livraison" /> : (
          <ul className="list">{list.map((o) => { const fs = feeState(o); const fee = courierSplit(o).fee; return (
            <li key={o.id} className="list-item">
              <a className="list-item-main" href={`#/commandes/${o.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="list-item-title">{o.number} · {orderLabel(o)}</span>
                <p className="small muted">{get<Zone>('zones', o.zoneId || '')?.name}{o.place ? ` — ${o.place}` : ''} · parti le {fmtDateTime(o.dispatchedAt)} · {o.status === 'out' ? 'en livraison' : o.status === 'refused' ? 'refusée' : 'livrée'}</p>
              </a>
              <div className="list-item-side"><strong className="num">Frais {fmtAr(fee)}</strong><Badge tone={FEE_STATE[fs].tone}>{FEE_STATE[fs].label}</Badge>{fs === 'paid' && o.feePaidAt && <span className="small muted">{fmtDateTime(o.feePaidAt)}</span>}</div>
              {fs === 'deferred' && can('couriers.settle') && <Button variant="ghost" className="btn-sm" onClick={() => setPay(o)}>Payer</Button>}
            </li>
          ); })}</ul>
        )}
      </div>
      {pay && <Confirm title={`Payer les frais de ${courier.name}`} confirmLabel="Enregistrer le paiement" onClose={() => setPay(null)}
        onConfirm={async () => { const os = pay === 'all' ? deferred : [pay]; const amt = os.reduce((t, o) => t + courierSplit(o).fee, 0); await payDeferredFees(courier, amt, acc, os); toast(`${fmtAr(amt)} de frais payés à ${courier.name}`); }}
        message={<div className="stack-s"><p>{pay === 'all' ? `${deferred.length} livraison(s) : ${fmtAr(deferredSum)} de frais différés.` : `Frais de ${pay.number} : ${fmtAr(courierSplit(pay).fee)}.`}</p>
          <SelectField label="Payé depuis" value={acc} onChange={(v) => setAcc(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} /></div>} />}
    </Modal>
  );
}

function DeleteCourier({ c, onClose }: { c: Courier; onClose: () => void }) {
  const blockers = courierRemovalBlockers(c.id);
  const users = useTable<{ id: string; username: string; courierId?: string; removed?: boolean } & Record<string, any>>('users').filter((u) => u.courierId === c.id && !u.removed);
  if (blockers.length) return (
    <Modal title={`Supprimer ${c.name} ?`} onClose={onClose} footer={<Button onClick={onClose}>Compris</Button>}>
      <div className="notice notice-danger"><Icon name="alert" /><div className="stack-s"><strong>Impossible pour le moment</strong>{blockers.map((b) => <span key={b} className="small">• {b}</span>)}</div></div>
    </Modal>
  );
  return (
    <Confirm title={`Supprimer le livreur ${c.name} ?`} danger confirmLabel="Supprimer le livreur" typeToConfirm="SUPPRIMER" onClose={onClose}
      message={<div className="stack-s"><p>{c.name} disparaîtra des listes et ne pourra plus recevoir de colis. Ses anciennes livraisons et ses règlements gardent son nom dans l’historique et les rapports.</p>
        {users.length > 0 && <p className="small"><strong>Son accès à l’application ({users.map((u) => u.username).join(', ')}) sera supprimé aussi.</strong></p>}
        <p className="small muted">Pour une simple pause (congé…), modifiez-le plutôt et décochez « Livreur actif ».</p></div>}
      onConfirm={async () => { await removeCourier(c); toast(`Livreur ${c.name} supprimé`); }} />
  );
}

function CourierForm({ courier, onClose }: { courier?: Courier; onClose: () => void }) {
  const zones = useTable<Zone>('zones').filter((z) => z.active !== false);
  const [name, setName] = useState(courier?.name ?? '');
  const [phone, setPhone] = useState(courier?.phone ?? '');
  const [zoneIds, setZoneIds] = useState<string[]>(courier?.zoneIds ?? []);
  const [active, setActive] = useState(courier?.active !== false);
  const [notes, setNotes] = useState(courier?.notes ?? '');
  return (
    <Modal title={courier ? 'Modifier le livreur' : 'Nouveau livreur'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!name.trim()} onClick={async () => {
        await save('couriers', { id: courier?.id, name: name.trim(), phone: phone.trim() || undefined, zoneIds, active, notes: notes.trim() || undefined });
        await audit(courier ? 'Livreur modifié' : 'Livreur ajouté', name.trim());
        toast('Livreur enregistré'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom" required value={name} onChange={setName} autoFocus />
        <TextField label="Téléphone" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
        <div className="stack-s"><strong className="small">Axes habituels</strong>
          <MultiPick label="Axes habituels" values={zoneIds} onChange={setZoneIds} empty="Aucun axe" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
        </div>
        <TextField label="Notes" value={notes} onChange={setNotes} />
        {courier && <Toggle checked={active} onChange={setActive} label="Livreur actif" />}
      </div>
    </Modal>
  );
}

export function Zones() {
  const can = useCan();
  const zones = useTable<Zone>('zones');
  const [form, setForm] = useState<Zone | 'new' | null>(null);
  const [del, setDel] = useState<Zone | null>(null);
  const sorted = [...zones].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const edit = can('couriers.manage') || can('settings.company');
  return (
    <>
      <div className="card row-between">
        <p className="small muted" style={{ flex: '1 1 260px' }}>Les frais de chaque zone sont proposés automatiquement dans les commandes, et restent modifiables commande par commande.</p>
        {edit ? <Button icon="plus" onClick={() => setForm('new')}>Ajouter une zone</Button> : <Badge>Modification réservée au gérant</Badge>}
      </div>
      <div className="card card-flush">
        {sorted.length === 0 ? <Empty icon="truck" title="Aucune zone">{edit && <Button icon="plus" onClick={() => setForm('new')}>Ajouter une zone</Button>}</Empty> : (
          <ul className="list">
            {sorted.map((z) => (
              <li key={z.id} className="list-item" style={{ opacity: z.active === false ? .55 : 1 }}>
                <span className="avatar"><Icon name={isPickupZone(z) ? 'store' : 'truck'} size={18} /></span>
                <div className="list-item-main">
                  <div className="row" style={{ gap: 8 }}><span className="list-item-title">{z.name}</span>{z.active === false && <Badge>Masquée</Badge>}</div>
                  <p className="small"><strong className="num">{fmtAr(z.fee)}</strong> <span className="muted">· {isPickupZone(z) ? 'Sur boutique, sans livreur' : 'Livraison'}</span></p>
                </div>
                {edit && <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                  <Button variant="ghost" icon="edit" className="btn-compact" onClick={() => setForm(z)}><span className="hide-sm">Modifier</span></Button>
                  {z.id !== 'zone-retrait' && <IconButton icon="trash" label="Supprimer" onClick={() => setDel(z)} />}
                </div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {form && <ZoneForm zone={form === 'new' ? undefined : form} count={sorted.length} onClose={() => setForm(null)} />}
      {del && <Confirm title="Supprimer la zone" danger confirmLabel="Supprimer" message={<p>La zone « {del.name} » sera supprimée. Les commandes déjà saisies gardent leurs frais.</p>} onClose={() => setDel(null)} onConfirm={async () => { await remove('zones', del.id); await audit('Zone supprimée', del.name); toast('Zone supprimée'); }} />}
    </>
  );
}

function ZoneForm({ zone, count, onClose }: { zone?: Zone; count: number; onClose: () => void }) {
  const [name, setName] = useState(zone?.name ?? '');
  const [fee, setFee] = useState(zone ? String(zone.fee) : '');
  const [pickup, setPickup] = useState(zone ? isPickupZone(zone) : false);
  const [active, setActive] = useState(zone?.active !== false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fixedPickup = zone?.id === 'zone-retrait';
  return (
    <Modal title={zone ? 'Modifier la zone' : 'Nouvelle zone de livraison'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={async () => {
        setError(null);
        if (!name.trim()) return setError('Indiquez le nom de la zone.');
        const f = pickup ? 0 : parseNum(fee);
        if (!pickup && !(f != null && f > 0)) return setError('Indiquez les frais de livraison de cette zone.');
        setBusy(true);
        await save('zones', { id: zone?.id, name: name.trim(), fee: f ?? 0, pickup: pickup || undefined, active, order: zone?.order ?? count });
        await audit(zone ? 'Zone modifiée' : 'Zone ajoutée', `${name.trim()} — ${f ?? 0} Ar`);
        toast(zone ? 'Zone modifiée' : 'Zone ajoutée');
        setBusy(false); onClose();
      }}>{zone ? 'Enregistrer' : 'Ajouter la zone'}</Button></>}>
      <div className="stack">
        <TextField label="Nom de la zone / de l’axe" required value={name} onChange={setName} placeholder="Ex. Ivandry – Ambatobe" autoFocus />
        {!pickup && <TextField label="Frais de livraison (Ar)" required value={fee} onChange={setFee} inputMode="numeric" placeholder="Ex. 4000" />}
        <Toggle checked={pickup} onChange={setPickup} disabled={fixedPickup} label="Sur boutique (le client vient chercher : 0 Ar, sans livreur)" />
        {zone && <Toggle checked={active} onChange={setActive} label="Zone active (décochez pour la masquer dans les commandes)" />}
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
    </Modal>
  );
}
