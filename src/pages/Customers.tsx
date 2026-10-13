// Clients : retrouvés par téléphone, historique des commandes, taux de refus.
import { useMyScope } from '../lib/scope';
import { ScopeBar } from '../ui/scope';
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { all, get, save, useTable } from '../lib/db';
import { fmtAr, fmtNum, matchQuery } from '../lib/catalog';
import { customerIdFor, customerText, fmtPhone, keptTotal, normPhone, type Customer, type Order, type Zone } from '../lib/orders';
import { itemsText, WAIT, type Prospect } from '../lib/prospects';
import { Badge, Button, Empty, Modal, PageHead, SelectField, TextField, navigate, toast, useRoute } from '../ui/kit';
import { ListDates, applyDates, defaultPeriod, type ListOrder, type Period } from '../ui/period';
import { OrderForm, OrderRow } from './Orders';

function stats(c: Customer, orders: Order[]) {
  const mine = orders.filter((o) => o.customerId === c.id || (!!c.phone && normPhone(o.phone) === normPhone(c.phone)));
  const done = mine.filter((o) => ['delivered', 'partial'].includes(o.status));
  const refused = mine.filter((o) => o.status === 'refused').length;
  const finished = done.length + refused;
  return { mine, count: mine.length, spent: done.reduce((s, o) => s + keptTotal(o) - (o.credit || 0) - (o.discount || 0), 0), refused, refusalRate: finished ? refused / finished : 0, last: mine.map((o) => o.createdAt).sort().pop() };
}

export function CustomersPage() {
  const route = useRoute();
  const id = route.split('/')[2];
  if (id) return <CustomerDetail id={id} />;
  return <CustomerList />;
}

function CustomerList() {
  const customers = useTable<Customer>('customers');
  const orders = useTable<Order>('orders');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(80);
  const [adding, setAdding] = useState(false);
  const can = useCan();
  const zones = useTable<Zone>('zones');
  const scope = useMyScope();
  const [order, setOrder] = useState<ListOrder>('new');
  const [period, setPeriod] = useState<Period>(defaultPeriod('all'));
  const [basis, setBasis] = useState<'last' | 'added'>('last');
  const list = useMemo(() => {
    const n = q.trim();
    const rows = customers
      .filter((c) => !scope.on || orders.some((o) => o.customerId === c.id && scope.mine(o)))
      .filter((c) => !n || matchQuery(customerText(c), n)).map((c) => ({ c, s: stats(c, orders) }));
    return applyDates(rows, (r) => (basis === 'added' ? r.c.createdAt : r.s.last || r.c.createdAt), period, order);
  }, [customers, orders, q, scope.on, order, period, basis]);
  return (
    <>
      <PageHead title="Clients" subtitle={`${customers.length} client(s) — créés automatiquement à chaque commande`} actions={can('orders.create') && <Button icon="plus" onClick={() => setAdding(true)}>Nouveau client</Button>} />
      <ScopeBar scope={scope} mineLabel="Mes clients" text="Vous voyez les clients de vos commandes et ventes." />
      <div className="card row" style={{ alignItems: 'flex-end' }}><div className="field" style={{ flex: '1 1 240px' }}><input aria-label="Rechercher" placeholder="Rechercher : téléphone, nom, nom Facebook, lieu, notes…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field" style={{ flex: '0 1 220px' }}><label htmlFor="c-basis">Date prise en compte</label><select id="c-basis" value={basis} onChange={(e) => setBasis(e.target.value as any)}><option value="last">Dernière commande</option><option value="added">Date d’ajout du client</option></select></div>
        <ListDates period={period} onPeriod={setPeriod} order={order} onOrder={setOrder} what={basis === 'added' ? 'Date d’ajout' : 'Dernière commande'} /></div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="users" title="Aucun client" /> : (
          <ul className="list">
            {list.slice(0, limit).map(({ c, s }) => (
              <li key={c.id}>
                <a className="list-item list-link" href={`#/clients/${c.id}`}>
                  <span className="avatar">{(c.name || '?').charAt(0).toUpperCase()}</span>
                  <div className="list-item-main">
                    <div className="row" style={{ gap: 8 }}><span className="list-item-title">{c.name || c.facebook || fmtPhone(c.phone)}</span>{s.refused >= 2 && s.refusalRate >= 0.3 && <Badge tone="danger">Refuse souvent</Badge>}</div>
                    <p className="small muted">{[c.phone && fmtPhone(c.phone), c.facebook && c.facebook !== c.name ? `FB : ${c.facebook}` : '', c.place].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <div className="list-item-side"><strong className="num">{s.count} cmd</strong><span className="small muted">{fmtAr(s.spent)}</span></div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {list.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 200)}>Afficher plus</Button>}
      {adding && <CustomerForm zones={zones} onClose={() => setAdding(false)} />}
    </>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const can = useCan();
  const customers = useTable<Customer>('customers');
  const orders = useTable<Order>('orders');
  const zones = useTable<Zone>('zones');
  const prospects = useTable<Prospect>('prospects');
  const c = customers.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  if (!c) return <Empty icon="users" title="Client introuvable" />;
  const s = stats(c, orders);
  const fold = (x?: string) => (x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const follows = prospects.filter((f) => (c.phone && f.phone && normPhone(f.phone) === normPhone(c.phone)) || (c.facebook && fold(f.fbName) === fold(c.facebook)));
  return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => navigate('/clients')}>Clients</Button></div>
      <div className="card stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div><h1 style={{ fontSize: '1.6rem' }}>{c.name || c.facebook || fmtPhone(c.phone)}</h1><p className="muted">{c.phone ? <a href={`tel:${c.phone}`}>{fmtPhone(c.phone)}</a> : 'Pas de téléphone'}{c.phone2 ? ` · ${fmtPhone(c.phone2)}` : ''}{c.facebook ? ` · ${c.facebook}` : ''}</p></div>
          <div className="page-actions">
            <Button variant="ghost" icon="edit" onClick={() => setEdit(true)}>Modifier</Button>
            {can('orders.create') && <Button icon="plus" onClick={() => setNewOrder(true)}>Nouvelle commande</Button>}
          </div>
        </div>
        <div className="kv-row">
          <div><span className="small muted">Commandes</span><strong className="num">{s.count}</strong></div>
          <div><span className="small muted">Achats livrés</span><strong className="num">{fmtAr(s.spent)}</strong></div>
          <div><span className="small muted">Refus</span><strong className={`num ${s.refusalRate >= 0.3 && s.refused >= 2 ? 'neg' : ''}`}>{s.refused} ({fmtNum(s.refusalRate * 100)} %)</strong></div>
          <div><span className="small muted">Lieu habituel</span><strong>{get<Zone>('zones', c.zoneId || '')?.name || '—'}{c.place ? ` — ${c.place}` : ''}</strong></div>
        </div>
        {c.notes && <p className="small">{c.notes}</p>}
      </div>
      <div className="card card-flush">
        <div className="card-pad"><h2>Commandes</h2></div>
        {s.mine.length === 0 ? <Empty icon="list" title="Aucune commande" /> : <ul className="list">{[...s.mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => <OrderRow key={o.id} o={o} />)}</ul>}
      </div>
      {follows.length > 0 && <div className="card card-flush">
        <div className="card-pad"><h2>Suivis (clients à suivre)</h2></div>
        <ul className="list">{follows.map((f) => <li key={f.id}><a className="list-item list-link" href="#/commandes/suivre"><div className="list-item-main"><span className="list-item-title">{f.status === 'open' ? `En cours — attend : ${WAIT[f.waitFor].toLowerCase()}` : f.status === 'converted' ? 'Transformé en commande' : `Abandonné : ${f.abandonReason}`}</span><p className="small muted">{itemsText(f) || 'Article pas encore précisé'}</p></div></a></li>)}</ul>
      </div>}
      {edit && <CustomerForm customer={c} zones={zones} onClose={() => setEdit(false)} />}
      {newOrder && <OrderForm prefill={{ phone: c.phone, name: c.name, facebook: c.facebook, zoneId: c.zoneId, place: c.place }} onClose={() => setNewOrder(false)} onSaved={(o) => navigate('/commandes/' + o.id)} />}
    </>
  );
}

function CustomerForm({ customer, zones, onClose }: { customer?: Customer; zones: Zone[]; onClose: () => void }) {
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [phone2, setPhone2] = useState(customer?.phone2 ?? '');
  const [facebook, setFacebook] = useState(customer?.facebook ?? '');
  const [zoneId, setZoneId] = useState(customer?.zoneId ?? '');
  const [place, setPlace] = useState(customer?.place ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const p = normPhone(phone);
  // Une seule information suffit : téléphone, nom Facebook ou lieu.
  const enough = p.length >= 9 || !!facebook.trim() || !!place.trim() || !!zoneId;
  return (
    <Modal title={customer ? 'Modifier le client' : 'Nouveau client'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!enough || (!!phone.trim() && p.length < 9)} onClick={async () => {
        const dup = p.length >= 9 ? all<Customer>('customers').find((c) => c.id !== customer?.id && ((c.phone && normPhone(c.phone) === p) || (c.phone2 && normPhone(c.phone2) === p))) : undefined;
        if (dup) return setErr(`Ce numéro appartient déjà à ${dup.name || dup.facebook || 'un autre client'}.`);
        const data = { name: name.trim() || undefined, phone: p || undefined, phone2: phone2 ? normPhone(phone2) : undefined, facebook: facebook.trim() || undefined, zoneId: zoneId || undefined, place: place.trim() || undefined, notes: notes.trim() || undefined };
        const [r] = await save('customers', customer ? { id: customer.id, ...data } : { ...(p ? { id: customerIdFor(p) } : {}), ...data });
        toast('Client enregistré'); onClose(); if (!customer) navigate('/clients/' + r.id);
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <p className="small muted">Une seule information suffit : téléphone, nom Facebook ou lieu.</p>
        <TextField label="Nom" value={name} onChange={setName} autoFocus />
        <TextField label="Téléphone" value={phone} onChange={setPhone} type="tel" error={phone.trim() && p.length < 9 ? 'Numéro incomplet' : null} />
        <TextField label="Autre téléphone" value={phone2} onChange={setPhone2} type="tel" />
        <TextField label="Nom Facebook" value={facebook} onChange={setFacebook} />
        <SelectField label="Zone habituelle" value={zoneId} onChange={setZoneId} options={[{ value: '', label: '—' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]} />
        <TextField label="Lieu habituel" value={place} onChange={setPlace} />
        <TextField label="Notes" value={notes} onChange={setNotes} />
        {err && <div className="notice notice-danger"><span>{err}</span></div>}
      </div>
    </Modal>
  );
}
