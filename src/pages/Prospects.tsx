// Commandes → « À suivre » : clients qui vont probablement acheter mais attendent encore quelque chose.
// Saisie séparée de la commande ; liste groupée (en retard / aujourd'hui / plus tard) avec tris ; relances ;
// transformation en commande seulement quand les critères essentiels sont remplis.
import { useMemo, useState } from 'react';
import { useCan, useMe } from '../lib/auth';
import { get, newId, useTable } from '../lib/db';
import { fmtAr, matchQuery, parseNum, useCatalog, type Category, parseAr } from '../lib/catalog';
import { fmtPhone, isPickupZone, normPhone, PAY_METHODS, type Order, type PayMethod, type Zone } from '../lib/orders';
import {
  ABANDON, PRIORITY, STALE_DAYS, WAIT, abandonProspect, bucketOf, estimate, followUp, itemLabel, itemsText, markConverted, missing, reopenProspect, saveProspect, staleDays, tomorrow9,
  type Bucket, type Priority, type Prospect, type ProspectItem, type WaitFor,
} from '../lib/prospects';
import { useMyScope } from '../lib/scope';
import { Help, Badge, Button, Choice, Confirm, Empty, IconButton, Modal, SelectField, TextField, Toggle, fmtDateTime, navigate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ItemPicker, OrderForm } from './Orders';

// ---------- Dates de relance ----------
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (v: string) => new Date(v).toISOString();
function quickDates(): { label: string; iso: string }[] {
  const at = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const now = new Date();
  return [
    { label: 'Dans 2 h', iso: new Date(now.getTime() + 2 * 3600_000).toISOString() },
    ...(now.getHours() < 17 ? [{ label: 'Ce soir 18 h', iso: at(0, 18) }] : []),
    { label: 'Demain 9 h', iso: tomorrow9() },
    { label: 'Dans 3 jours', iso: at(3, 9) },
    { label: 'Dans 1 semaine', iso: at(7, 9) },
  ];
}
function FollowAtField({ value, onChange, label = 'Relancer le' }: { value: string; onChange: (iso: string) => void; label?: string }) {
  return (
    <div className="stack-s">
      <TextField label={label} type="datetime-local" value={toLocal(value)} onChange={(v) => v && onChange(fromLocal(v))} />
      <div className="row" style={{ gap: 6 }}>{quickDates().map((q) => <button key={q.label} type="button" className="chip" onClick={() => onChange(q.iso)}>{q.label}</button>)}</div>
    </div>
  );
}

export const BUCKETS: Record<Bucket, { label: string; tone: string }> = {
  late: { label: 'À relancer maintenant (en retard)', tone: 'danger' },
  today: { label: "Aujourd'hui", tone: 'warn' },
  later: { label: 'Plus tard', tone: 'muted' },
};
const PRIO_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const SORTS = [
  { value: 'date', label: 'Tri : date de relance' },
  { value: 'prio', label: 'Tri : priorité' },
  { value: 'amount', label: 'Tri : montant estimé' },
  { value: 'recent', label: 'Tri : ajoutés récemment' },
  { value: 'name', label: 'Tri : nom (A → Z)' },
];

// ---------- Liste ----------
export function ProspectList() {
  const can = useCan();
  const all = useTable<Prospect>('prospects');
  useTable('variants'); useTable('products'); useTable<Zone>('zones');
  const scope = useMyScope();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'open' | 'converted' | 'abandoned'>('open');
  const [wait, setWait] = useState('');
  const [sort, setSort] = useState('date');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => all
    .filter((p) => p.status === status && scope.mine({ createdBy: p.ownerId, createdByName: p.ownerName }) && (!wait || p.waitFor === wait))
    .filter((p) => !q.trim() || matchQuery(`${p.fbName} ${p.phone ?? ''} ${normPhone(p.phone ?? '')} ${itemsText(p)} ${p.notes ?? ''} ${p.waitNote ?? ''} ${p.place ?? ''}`, q))
    .sort((a, b) => {
      switch (sort) {
        case 'prio': return PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.followAt.localeCompare(b.followAt);
        case 'amount': return estimate(b) - estimate(a);
        case 'recent': return b.createdAt.localeCompare(a.createdAt);
        case 'name': return a.fbName.localeCompare(b.fbName, 'fr');
        default: return status === 'open' ? a.followAt.localeCompare(b.followAt) : (b.closedAt ?? '').localeCompare(a.closedAt ?? '');
      }
    }), [all, status, wait, sort, q, scope.on]);
  const groups = status === 'open' ? (['late', 'today', 'later'] as Bucket[]).map((b) => ({ b, items: list.filter((p) => bucketOf(p) === b) })).filter((g) => g.items.length) : [{ b: null as Bucket | null, items: list }];
  const sel = open ? all.find((p) => p.id === open) : undefined;
  return (
    <>
      <div className="card stack-s">
        <Help>Clients repérés dans les messages qui vont probablement acheter, mais attendent encore quelque chose (confirmation, information, paiement…). Notez ce que vous savez, relancez à la date prévue, puis transformez en commande quand tout est complet.</Help>
        <div className="row">
          <div className="field" style={{ flex: '2 1 220px' }}><input aria-label="Rechercher un client à suivre" placeholder="Rechercher (nom Facebook, téléphone, article, note)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 150px' }}><select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="open">En cours</option><option value="converted">Transformés en commande</option><option value="abandoned">Abandonnés</option></select></div>
          <div className="field" style={{ flex: '1 1 150px' }}><select aria-label="Attend" value={wait} onChange={(e) => setWait(e.target.value)}><option value="">Tous les motifs</option>{Object.entries(WAIT).map(([k, l]) => <option key={k} value={k}>Attend : {l.toLowerCase()}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 170px' }}><select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        </div>
      </div>
      {list.length === 0 ? <div className="card"><Empty icon="users" title={status === 'open' ? 'Aucun client à suivre' : 'Rien ici'}>{status === 'open' && can('orders.create') && !q && <Button icon="plus" onClick={() => setAdding(true)}>Ajouter un client à suivre</Button>}</Empty></div>
        : groups.map((g) => (
          <section key={g.b ?? 'all'} className={`card card-flush follow-group ${g.b ? 'fg-' + g.b : ''}`}>
            {g.b && <h2 className="follow-head"><span className="follow-dot" aria-hidden />{BUCKETS[g.b].label} <span className="tab-count">{g.items.length}</span></h2>}
            <ul className="list">{g.items.map((p) => <ProspectRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}</ul>
          </section>
        ))}
      {adding && <ProspectForm onClose={() => setAdding(false)} />}
      {sel && <ProspectDetail p={sel} onClose={() => setOpen(null)} />}
    </>
  );
}

function ProspectRow({ p, onOpen }: { p: Prospect; onOpen: () => void }) {
  const miss = missing(p);
  const est = estimate(p);
  const stale = p.status === 'open' ? staleDays(p) : 0;
  return (
    <li>
      <button type="button" className="list-item list-link btn-reset" onClick={onOpen}>
        <span className={`prio-bar prio-${p.priority}`} aria-hidden />
        <div className="list-item-main">
          <div className="row" style={{ gap: 6 }}>
            <span className="list-item-title">{p.fbName}</span>
            {p.priority !== 'normal' && <Badge tone={p.priority === 'high' ? 'danger' : undefined}>Priorité {PRIORITY[p.priority].toLowerCase()}</Badge>}
            {p.status === 'open' && <Badge tone="brand">Attend : {WAIT[p.waitFor].toLowerCase()}{p.waitDone ? ' ✓' : ''}</Badge>}
            {p.status === 'converted' && <Badge tone="ok">Commande créée</Badge>}
            {p.status === 'abandoned' && <Badge>Abandonné : {p.abandonReason}</Badge>}
            {stale >= STALE_DAYS && <Badge tone="danger">Sans nouvelles depuis {stale} j</Badge>}
          </div>
          <p className="small muted">{p.items.length ? itemsText(p) : 'Article pas encore précisé'}{p.phone ? ` · ${fmtPhone(p.phone)}` : ''}</p>
          <p className="small muted">{p.status === 'open' ? <>Relance : <strong>{fmtDateTime(p.followAt)}</strong></> : fmtDateTime(p.closedAt)}{p.ownerName ? ` · ${p.ownerName}` : ''}</p>
          {p.status === 'open' && (miss.length ? <p className="small miss">Manque : {miss.join(', ')}</p> : <p className="small ok-text"><Icon name="check" size={14} /> Prêt à transformer en commande</p>)}
        </div>
        <div className="list-item-side">{est > 0 && <strong className="num">≈ {fmtAr(est)}</strong>}</div>
      </button>
    </li>
  );
}

// ---------- Saisie / modification ----------
export function ProspectForm({ p, onClose, onSaved }: { p?: Prospect; onClose: () => void; onSaved?: () => void }) {
  useCatalog();
  const me = useMe();
  const zones = useTable<Zone>('zones').filter((z) => z.active !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const pages = useTable<Category>('categories').filter((c) => !c.parentId && !c.removed).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const [fbName, setFbName] = useState(p?.fbName ?? '');
  const [phone, setPhone] = useState(p?.phone ?? '');
  const [pageId, setPageId] = useState(p?.pageId ?? (me.pageIds?.length === 1 ? me.pageIds[0] : ''));
  const [items, setItems] = useState<ProspectItem[]>(p?.items ?? []);
  const [freeText, setFreeText] = useState('');
  const [waitFor, setWaitFor] = useState<WaitFor | ''>(p?.waitFor ?? '');
  const [waitNote, setWaitNote] = useState(p?.waitNote ?? '');
  const [followAt, setFollowAt] = useState(p?.followAt ?? tomorrow9());
  const [priority, setPriority] = useState<Priority>(p?.priority ?? 'normal');
  const [zoneId, setZoneId] = useState(p?.zoneId ?? '');
  const [place, setPlace] = useState(p?.place ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [picking, setPicking] = useState<string | 'new' | null>(null); // 'new' ou id de la ligne en texte à remplacer
  const [busy, setBusy] = useState(false);
  // Motif proposé selon ce qui manque : article ou quantité pas encore connus → « une information ».
  const suggested: WaitFor = !items.length || items.some((i) => !i.variantId || !i.qty) ? 'info' : 'confirm';
  const wf = (waitFor || suggested) as WaitFor;
  const setItem = (id: string, patch: Partial<ProspectItem>) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <Modal title={p ? `Modifier — ${p.fbName}` : 'Nouveau client à suivre'} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!fbName.trim()} onClick={async () => {
        setBusy(true);
        const extra = freeText.trim() ? [{ id: newId(), text: freeText.trim() }] : [];
        await saveProspect({ fbName: fbName.trim(), phone: normPhone(phone) || undefined, pageId: pageId || undefined, items: [...items, ...extra], waitFor: wf, waitNote: waitNote.trim() || undefined, followAt, priority, zoneId: zoneId || undefined, place: place.trim() || undefined, notes: notes.trim() || undefined }, p);
        toast(p ? 'Suivi mis à jour' : 'Client ajouté à la liste « À suivre »'); onClose(); onSaved?.();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Nom Facebook du client" required value={fbName} onChange={setFbName} autoFocus={!p} placeholder="Ex. Soa Rakoto" />
          <TextField label="Téléphone (si connu)" value={phone} onChange={setPhone} type="tel" inputMode="tel" placeholder="034 00 000 00" />
          {pages.length > 0 && <SelectField label="Page" value={pageId} onChange={setPageId} options={[{ value: '', label: '— Aucune —' }, ...pages.map((c) => ({ value: c.id, label: c.name }))]} />}
          <div className="field"><label>Priorité</label><Choice label="Priorité" value={priority} onChange={(v) => setPriority(v as Priority)} options={Object.entries(PRIORITY).map(([value, label]) => ({ value, label }))} /></div>
        </div>

        <div className="stack-s">
          <div className="row-between"><h3>Ce qui l’intéresse</h3><Button variant="ghost" icon="plus" onClick={() => setPicking('new')}>Article du catalogue</Button></div>
          {items.length > 0 && <ul className="list card" style={{ padding: 0 }}>{items.map((i) => (
            <li key={i.id} className="list-item">
              <div className="list-item-main"><span className="list-item-title">{itemLabel(i)}</span>{!i.variantId && <p className="small miss">Texte libre : choisissez l’article précis quand il sera connu. <button type="button" className="link-btn" onClick={() => setPicking(i.id)}>Choisir l’article</button></p>}</div>
              <input className="cell-input" style={{ width: 80 }} inputMode="numeric" aria-label="Quantité" placeholder="Qté ?" value={i.qty || ''} onChange={(e) => setItem(i.id, { qty: parseNum(e.target.value) || undefined })} />
              <IconButton icon="x" label="Retirer" onClick={() => setItems(items.filter((x) => x.id !== i.id))} />
            </li>
          ))}</ul>}
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input className="cell-input" value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Pas encore précis ? Écrivez-le (ex. pyjama lapin, taille à voir)" aria-label="Article en texte libre" onKeyDown={(e) => { if (e.key === 'Enter' && freeText.trim()) { e.preventDefault(); setItems([...items, { id: newId(), text: freeText.trim() }]); setFreeText(''); } }} />
            <Button variant="ghost" disabled={!freeText.trim()} onClick={() => { setItems([...items, { id: newId(), text: freeText.trim() }]); setFreeText(''); }}>Ajouter</Button>
          </div>
        </div>

        <div className="grid-2">
          <SelectField label="Il attend…" value={wf} onChange={(v) => setWaitFor(v as WaitFor)} options={Object.entries(WAIT).map(([value, label]) => ({ value, label }))} hint={!waitFor ? 'Proposé selon ce qui manque, modifiable.' : undefined} />
          <TextField label="Précision (facultatif)" value={waitNote} onChange={setWaitNote} placeholder={wf === 'info' ? 'Ex. veut savoir la taille 6A' : wf === 'payment' ? 'Ex. acompte MVola promis ce soir' : ''} />
        </div>
        <FollowAtField value={followAt} onChange={setFollowAt} />
        <div className="grid-2">
          <SelectField label="Lieu de livraison (si connu)" value={zoneId} onChange={setZoneId} options={[{ value: '', label: '— Pas encore connu —' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]} />
          <TextField label={isPickupZone(zoneId) ? 'Lieu (facultatif)' : 'Lieu précis'} value={place} onChange={setPlace} placeholder="Ex. Ivandry, près du lycée" />
        </div>
        <TextField label="Notes" value={notes} onChange={setNotes} placeholder="Ex. envoyé les photos, attend l’avis de son mari" />
      </div>
      {picking && <ItemPicker noChoice unknownQty onClose={() => setPicking(null)} onAdd={(add) => {
        const rows = add.map((a) => ({ id: newId(), variantId: a.variantId, qty: a.qty || undefined }));
        if (picking === 'new') setItems([...items, ...rows]);
        else setItems(items.flatMap((i) => (i.id === picking ? rows.map((r, k) => (k === 0 ? { ...r, qty: r.qty ?? i.qty } : r)) : [i])));
      }} />}
    </Modal>
  );
}

// ---------- Fiche ----------
function ProspectDetail({ p, onClose }: { p: Prospect; onClose: () => void }) {
  const can = useCan();
  const [edit, setEdit] = useState(false);
  const [relance, setRelance] = useState(false);
  const [abandon, setAbandon] = useState(false);
  const [convert, setConvert] = useState(false);
  const [paying, setPaying] = useState(false);
  const miss = missing(p);
  const stale = staleDays(p);
  const zone = get<Zone>('zones', p.zoneId || '');
  const manage = can('orders.create');
  if (edit) return <ProspectForm p={p} onClose={() => setEdit(false)} />;
  if (convert) return <OrderForm onClose={() => setConvert(false)}
    prefill={{ phone: p.phone, name: p.fbName, facebook: p.fbName, zoneId: p.zoneId, place: p.place, lines: p.items.filter((i) => i.variantId && i.qty).map((i) => ({ variantId: i.variantId!, qty: i.qty! })), notes: [p.notes, p.waitNote].filter(Boolean).join(' — ') || undefined, prepay: p.paid }}
    onSaved={async (o: Order) => { await markConverted(p, o.id, o.number); onClose(); navigate('/commandes/' + o.id); }} />;
  const checks: [string, boolean][] = [
    ['Téléphone du client', normPhone(p.phone || '').length >= 9],
    ['Lieu de livraison (zone + lieu) ou retrait en boutique', !!p.zoneId && (isPickupZone(p.zoneId) || !!p.place?.trim())],
    ['Article précis du catalogue', p.items.length > 0 && p.items.every((i) => !!i.variantId)],
    ['Quantité de chaque article', p.items.length > 0 && p.items.every((i) => !!i.qty)],
    [`Réponse reçue : ${WAIT[p.waitFor].toLowerCase()}`, !!p.waitDone],
  ];
  return (
    <Modal title={p.fbName} onClose={onClose} wide
      footer={p.status === 'open' && manage ? <>
        <Button variant="quiet" onClick={() => setAbandon(true)}>Abandonner</Button>
        <Button variant="ghost" icon="edit" onClick={() => setEdit(true)}>Compléter</Button>
        <Button variant="ghost" icon="refresh" onClick={() => setRelance(true)}>Relancé</Button>
        <Button icon="check" disabled={miss.length > 0} onClick={() => setConvert(true)}>Transformer en commande</Button>
      </> : p.status === 'abandoned' && manage ? <Button variant="ghost" icon="refresh" onClick={async () => { await reopenProspect(p); toast('Suivi rouvert'); }}>Rouvrir le suivi</Button>
        : p.orderId ? <Button onClick={() => { onClose(); navigate('/commandes/' + p.orderId); }}>Voir la commande</Button> : undefined}>
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={p.priority === 'high' ? 'danger' : undefined}>Priorité {PRIORITY[p.priority].toLowerCase()}</Badge>
          <Badge tone="brand">Attend : {WAIT[p.waitFor].toLowerCase()}{p.waitNote ? ` — ${p.waitNote}` : ''}</Badge>
          {p.status === 'open' && <Badge tone={bucketOf(p) === 'late' ? 'danger' : undefined}>Relance : {fmtDateTime(p.followAt)}</Badge>}
        </div>
        {p.status === 'open' && stale >= STALE_DAYS && <div className="notice notice-warn"><Icon name="alert" /><span style={{ flex: 1 }}>Sans nouvelles depuis {stale} jours. Relancer une dernière fois, ou abandonner ce suivi ?</span>{manage && <Button variant="ghost" onClick={() => setAbandon(true)}>Abandonner</Button>}</div>}
        <div className="grid-2 detail-grid">
          <div><span className="small muted">Téléphone</span><p>{p.phone ? fmtPhone(p.phone) : '—'}</p></div>
          <div><span className="small muted">Lieu</span><p>{zone ? `${zone.name}${p.place ? ' — ' + p.place : ''}` : '—'}</p></div>
          <div><span className="small muted">Page</span><p>{get<Category>('categories', p.pageId || '')?.name ?? '—'}</p></div>
          <div><span className="small muted">Suivi par</span><p>{p.ownerName ?? '—'}</p></div>
        </div>
        <div><span className="small muted">Ce qui l’intéresse</span>
          {p.items.length ? <ul className="plain-list">{p.items.map((i) => <li key={i.id}>{i.qty ? <strong>{i.qty} × </strong> : <span className="miss">Qté ? </span>}{itemLabel(i)}{!i.variantId && <span className="small miss"> (texte libre)</span>}</li>)}</ul> : <p className="miss">Pas encore précisé</p>}
          {estimate(p) > 0 && <p className="small">Montant estimé : <strong>{fmtAr(estimate(p))}</strong> (prix détail, sans livraison)</p>}
        </div>
        {p.notes && <p className="small"><strong>Notes :</strong> {p.notes}</p>}
        {p.status === 'open' && <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Pour transformer en commande</strong>
          <ul className="checks">{checks.map(([l, ok]) => <li key={l} className={ok ? 'is-ok' : 'is-miss'}><Icon name={ok ? 'check' : 'x'} size={16} /> {l}</li>)}</ul>
          {manage && !p.waitDone && (p.waitFor === 'payment'
            ? <Button variant="ghost" onClick={() => setPaying(true)}>Paiement reçu…</Button>
            : <Toggle checked={false} onChange={async () => { await followUp(p, `Réponse reçue : ${WAIT[p.waitFor].toLowerCase()}`, p.followAt, { waitDone: true }); toast('Noté'); }} label={`Le client a répondu (${WAIT[p.waitFor].toLowerCase()})`} />)}
          {p.paid && <p className="small"><Icon name="check" size={14} /> Paiement reçu : {fmtAr(p.paid.amount)} ({PAY_METHODS[p.paid.method]}{p.paid.ref ? ` · ${p.paid.ref}` : ''}) — repris dans la commande.</p>}
          {miss.length > 0 && <p className="small miss">Il manque : {miss.join(', ')}. Touchez « Compléter » pour ajouter ce que vous savez.</p>}
        </div>}
        <div><strong className="small">Historique</strong>
          <ul className="timeline">{[...(p.events || [])].reverse().map((e, k) => <li key={k}><span className="small muted">{fmtDateTime(e.at)}{e.user ? ` · ${e.user}` : ''}</span><span>{e.text}</span></li>)}</ul>
        </div>
      </div>
      {relance && <RelanceModal p={p} onClose={() => setRelance(false)} />}
      {paying && <PaidModal p={p} onClose={() => setPaying(false)} />}
      {abandon && <AbandonModal p={p} onClose={() => setAbandon(false)} onDone={onClose} />}
    </Modal>
  );
}

const RESULTS = ['Pas de réponse', 'A répondu, attend encore', 'Veut réfléchir', 'Rappeler plus tard'];
function RelanceModal({ p, onClose }: { p: Prospect; onClose: () => void }) {
  const [text, setText] = useState('');
  const [next, setNext] = useState(tomorrow9());
  const [waitFor, setWaitFor] = useState<WaitFor>(p.waitFor);
  return (
    <Modal title={`Relance — ${p.fbName}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!text.trim()} onClick={async () => {
        await followUp(p, text.trim(), next, waitFor !== p.waitFor ? { waitFor, waitDone: false } : {});
        toast('Relance notée'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Ce qui s’est passé" required value={text} onChange={setText} autoFocus placeholder="Ex. veut la taille 6A, envoie l’acompte demain" />
        <div className="row" style={{ gap: 6 }}>{RESULTS.map((r) => <button key={r} type="button" className="chip" onClick={() => setText(r)}>{r}</button>)}</div>
        <SelectField label="Il attend maintenant…" value={waitFor} onChange={(v) => setWaitFor(v as WaitFor)} options={Object.entries(WAIT).map(([value, label]) => ({ value, label }))} />
        <FollowAtField label="Prochaine relance" value={next} onChange={setNext} />
      </div>
    </Modal>
  );
}

function PaidModal({ p, onClose }: { p: Prospect; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('mvola');
  const [ref, setRef] = useState('');
  return (
    <Modal title="Paiement reçu" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!parseAr(amount)} onClick={async () => {
        await followUp(p, `Paiement reçu : ${parseAr(amount)} Ar (${PAY_METHODS[method]})`, p.followAt, { waitDone: true, paid: { amount: parseAr(amount)!, method, ref: ref.trim() || undefined } });
        toast('Paiement noté : il sera repris dans la commande'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <p className="small muted">Le paiement est enregistré en caisse au moment où la commande est créée (rien n’est compté deux fois).</p>
        <div className="grid-2">
          <TextField label="Montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" autoFocus />
          <SelectField label="Moyen" value={method} onChange={(v) => setMethod(v as PayMethod)} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} />
          {method !== 'cash' && <TextField label="Référence de la transaction" value={ref} onChange={setRef} />}
        </div>
      </div>
    </Modal>
  );
}

function AbandonModal({ p, onClose, onDone }: { p: Prospect; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(ABANDON[0]);
  const [other, setOther] = useState('');
  return (
    <Confirm title={`Abandonner le suivi de ${p.fbName} ?`} confirmLabel="Abandonner" onClose={onClose}
      onConfirm={async () => { await abandonProspect(p, reason === 'Autre' && other.trim() ? other.trim() : reason); toast('Suivi abandonné'); onDone(); }}
      message={<div className="stack-s">
        <p>Le client sort de la liste « À suivre ». Il reste visible dans « Abandonnés » et peut être rouvert.</p>
        <Choice label="Raison" value={reason} onChange={setReason} max={3} options={ABANDON.map((r) => ({ value: r, label: r }))} />
        {reason === 'Autre' && <TextField label="Précisez" value={other} onChange={setOther} />}
      </div>} />
  );
}
