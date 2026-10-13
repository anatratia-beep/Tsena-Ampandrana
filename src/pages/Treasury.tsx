// Trésorerie : soldes des comptes, mouvements, dépenses, autres revenus, virements, opérations récurrentes.
import { closedBy } from '../lib/closed';
import { useMemo, useRef, useState } from 'react';
import { useCan } from '../lib/auth';
import { save, useTable } from '../lib/db';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import { compressPhoto } from '../lib/images';
import {
  ACCOUNTS, ACCOUNT_IDS, MOVE_TYPES, addMove, addTransfer, atFor, balances, confirmRecurring, dayOf, deleteMove, dueRecurring, flows, skipRecurring, today,
  type AccountId, type CashMove, type FinanceCategory, type Flow, type MoveType, type Recurring,
} from '../lib/money';
import type { Order } from '../lib/orders';
import { Badge, Button, Confirm, Empty, IconButton, Modal, PageHead, SelectField, TextField, Toggle, fmtDate, fmtDateTime, navigate, toast, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { PeriodPicker, defaultPeriod, type Period } from '../ui/period';

const TABS = [
  { key: 'comptes', label: 'Soldes et mouvements' },
  { key: 'depenses', label: 'Autres revenus' },
  { key: 'categories', label: 'Catégories de revenus' },
];

/** Plus de clôture verrouillée : toutes les journées restent modifiables (traçées dans le journal). */
export function useDayLock() {
  return (_ymd: string) => false;
}

export function TreasuryPage() {
  const can = useCan();
  const route = useRoute();
  const cur = TABS.find((t) => route.endsWith('/' + t.key)) ?? TABS[0];
  if (!can('treasury.view') && !can('expenses.manage')) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Trésorerie" subtitle="Caisse, mobile money, dépenses et autres revenus" />
      <div className="tabs" role="tablist">{TABS.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/tresorerie/' + t.key)}>{t.label}</button>)}</div>
      {cur.key === 'comptes' && <Accounts />}
      {cur.key === 'depenses' && <Expenses />}
      {cur.key === 'categories' && <Categories />}
    </>
  );
}

type FormKind = 'expense' | 'income' | 'owner_in' | 'owner_out' | 'opening';

function Accounts() {
  const can = useCan();
  useTable<Order>('orders'); useTable<CashMove>('cashMoves'); useTable('financeCategories');
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const [account, setAccount] = useState<AccountId | ''>('');
  const [form, setForm] = useState<FormKind | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [del, setDel] = useState<CashMove | null>(null);
  const locked = useDayLock();
  const b = balances();
  const list = flows(period.from, period.to, account || undefined);
  const inSum = list.filter((f) => f.amount > 0 && f.move?.type !== 'transfer').reduce((s, f) => s + f.amount, 0);
  const outSum = list.filter((f) => f.amount < 0 && f.move?.type !== 'transfer').reduce((s, f) => s - f.amount, 0);
  const shown = ACCOUNT_IDS.filter((a) => a !== 'bank' || b.bank || list.some((f) => f.account === 'bank'));
  const total = ACCOUNT_IDS.reduce((s, a) => s + b[a], 0);
  return (
    <>
      <div className="stat-grid">
        {shown.map((a) => (
          <button key={a} className={`card stat stat-btn ${account === a ? 'is-on' : ''}`} onClick={() => setAccount(account === a ? '' : a)}>
            <span className="small muted">{ACCOUNTS[a]}</span>
            <strong className={`stat-value num ${b[a] < 0 ? 'neg' : ''}`}>{fmtAr(b[a])}</strong>
          </button>
        ))}
        <div className="card stat"><span className="small muted">Total disponible</span><strong className="stat-value num">{fmtAr(total)}</strong></div>
      </div>
      {can('expenses.manage') && (
        <div className="row">
          <Button icon="download" onClick={() => setForm('expense')}>Dépense</Button>
          <Button variant="ghost" icon="upload" onClick={() => setForm('income')}>Autre revenu</Button>
          <Button variant="ghost" icon="refresh" onClick={() => setTransfer(true)}>Virement entre comptes</Button>
          <Button variant="ghost" onClick={() => setForm('owner_in')}>Apport du gérant</Button>
          <Button variant="ghost" onClick={() => setForm('owner_out')}>Retrait du gérant</Button>
          {can('users.manage') && <Button variant="quiet" onClick={() => setForm('opening')}>Solde de départ</Button>}
        </div>
      )}
      <div className="card stack">
        <div className="row-between"><h2>Mouvements{account ? ` — ${ACCOUNTS[account]}` : ''}</h2>{account && <Button variant="quiet" onClick={() => setAccount('')}>Tous les comptes</Button>}</div>
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="row small"><span>Entrées : <strong className="pos num">{fmtAr(inSum)}</strong></span><span>Sorties : <strong className="neg num">{fmtAr(outSum)}</strong></span><span className="muted">(virements non comptés)</span></div>
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title="Aucun mouvement sur la période" /> : (
          <ul className="list">
            {list.slice(0, 300).map((f) => <FlowRow key={f.id + f.account} f={f} onDelete={f.move && can('expenses.manage') && !locked(dayOf(f.at)) && f.move.type !== 'courier_settlement' ? () => setDel(f.move!) : undefined} />)}
          </ul>
        )}
      </div>
      {form && <MoveForm kind={form} onClose={() => setForm(null)} />}
      {transfer && <TransferForm onClose={() => setTransfer(false)} />}
      {del && <Confirm title="Supprimer cette opération ?" danger confirmLabel="Supprimer" message={<p>{MOVE_TYPES[del.type]} de {fmtAr(Math.abs(del.amount))} ({ACCOUNTS[del.account]}){del.transferId ? ' — les deux côtés du virement seront supprimés.' : '.'}</p>} onConfirm={async () => { await deleteMove(del); toast('Opération supprimée'); }} onClose={() => setDel(null)} />}
    </>
  );
}

function FlowRow({ f, onDelete }: { f: Flow; onDelete?: () => void }) {
  const [photo, setPhoto] = useState(false);
  return (
    <li className="list-item">
      <div className="list-item-main">
        <span className="list-item-title">{f.orderId ? <a href={`#/commandes/${f.orderId}`}>{f.label}</a> : f.label}</span>
        <p className="small muted">{fmtDateTime(f.at)} · {ACCOUNTS[f.account]}{f.detail ? ` · ${f.detail}` : ''}</p>
      </div>
      {f.move?.photo && <IconButton icon="eye" label="Voir le reçu" onClick={() => setPhoto(true)} />}
      <strong className={`num ${f.amount < 0 ? 'neg' : 'pos'}`}>{f.amount > 0 ? '+' : '−'} {fmtAr(Math.abs(f.amount))}</strong>
      {onDelete && <IconButton icon="trash" label="Supprimer" onClick={onDelete} />}
      {photo && <Modal title="Reçu" onClose={() => setPhoto(false)}><img src={f.move!.photo} alt="Reçu" style={{ width: '100%', borderRadius: 12 }} /></Modal>}
    </li>
  );
}

const accountOptions = ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }));

function MoveForm({ kind, onClose }: { kind: FormKind; onClose: () => void }) {
  const cats = useTable<FinanceCategory>('financeCategories').filter((c) => c.active !== false && c.kind === (kind === 'income' ? 'income' : 'expense')).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const locked = useDayLock();
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState<AccountId>('cash');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState(cats[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const withCat = kind === 'expense' || kind === 'income';
  const title = { expense: 'Nouvelle dépense', income: 'Autre revenu', owner_in: 'Apport du gérant', owner_out: 'Retrait du gérant', opening: 'Solde de départ d’un compte' }[kind];
  const n = parseAr(amount) || 0;
  const dayLocked = locked(date);
  const weekClosed = kind === 'expense' || kind === 'income' ? closedBy(date) : undefined;
  async function submit() {
    setBusy(true);
    try {
      const sign = kind === 'expense' || kind === 'owner_out' ? -1 : 1;
      await addMove({ at: atFor(date), account, amount: kind === 'opening' ? n : sign * Math.abs(n), type: kind as MoveType, categoryId: withCat ? cat : undefined, label: label.trim() || undefined, note: note.trim() || undefined, photo });
      toast(`${title} enregistré${kind === 'expense' ? 'e' : ''}`); onClose();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!n || dayLocked || !!weekClosed || (withCat && !cat)} onClick={submit}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" autoFocus />
          <SelectField label={kind === 'expense' || kind === 'owner_out' ? 'Payé depuis' : kind === 'opening' ? 'Compte' : 'Reçu sur'} value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
          {withCat && <SelectField label="Catégorie" required value={cat} onChange={setCat} options={cats.map((c) => ({ value: c.id, label: c.name }))} />}
          <TextField label="Date" type="date" value={date} max={today()} onChange={setDate} />
        </div>
        {kind === 'opening' && <p className="small muted">L’argent déjà présent sur ce compte au moment où vous commencez avec Trésor en ligne (peut être négatif pour corriger).</p>}
        <TextField label={withCat ? 'Description (ex. loyer d’octobre)' : 'Description (facultatif)'} value={label} onChange={setLabel} />
        <TextField label="Note (facultatif)" value={note} onChange={setNote} />
        {kind === 'expense' && (
          <div className="row" style={{ alignItems: 'center' }}>
            <Button variant="ghost" icon="upload" onClick={() => file.current?.click()}>{photo ? 'Changer la photo du reçu' : 'Photo du reçu'}</Button>
            {photo && <><img src={photo} alt="Reçu" style={{ height: 48, borderRadius: 8 }} /><Button variant="quiet" onClick={() => setPhoto(undefined)}>Retirer</Button></>}
            <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await compressPhoto(f, { max: 1000, targetBytes: 110_000 })); } catch (err: any) { toast(err.message, 'error'); } } e.target.value = ''; }} />
          </div>
        )}
        {weekClosed && <div className="notice notice-danger"><Icon name="lock" /><span>Semaine clôturée : le versement de la semaine du {fmtDate(weekClosed.weekStart)} au {fmtDate(weekClosed.weekEnd)} a été validé par {weekClosed.byName ?? '?'}. Choisissez une autre date.</span></div>}
        {dayLocked && <div className="notice notice-danger"><Icon name="lock" /><span>Cette journée est clôturée. Seuls l’admin ou le gérant peuvent encore y ajouter une opération.</span></div>}
      </div>
    </Modal>
  );
}

function TransferForm({ onClose }: { onClose: () => void }) {
  const locked = useDayLock();
  const [from, setFrom] = useState<AccountId>('mvola');
  const [to, setTo] = useState<AccountId>('cash');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const n = parseAr(amount) || 0;
  return (
    <Modal title="Virement entre comptes" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!n || from === to || locked(date)} onClick={async () => { await addTransfer(from, to, n, atFor(date), note.trim() || undefined, parseNum(fee) || 0); toast('Virement enregistré'); onClose(); }}>Enregistrer</Button></>}>
      <div className="stack">
        <p className="small muted">Ex. retrait MVola vers la caisse, dépôt de la caisse à la banque.</p>
        <div className="grid-2">
          <SelectField label="Depuis" value={from} onChange={(v) => setFrom(v as AccountId)} options={accountOptions} />
          <SelectField label="Vers" value={to} onChange={(v) => setTo(v as AccountId)} options={accountOptions} />
          <TextField label="Montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
          <TextField label="Frais de retrait (Ar, facultatif)" value={fee} onChange={setFee} inputMode="numeric" />
          <TextField label="Date" type="date" value={date} max={today()} onChange={setDate} />
          <TextField label="Note (facultatif)" value={note} onChange={setNote} />
        </div>
        {from === to && <p className="small neg">Choisissez deux comptes différents.</p>}
      </div>
    </Modal>
  );
}

// ---------- Dépenses ----------
function Expenses() {
  const can = useCan();
  const moves = useTable<CashMove>('cashMoves');
  const cats = useTable<FinanceCategory>('financeCategories');
  useTable<Recurring>('recurring');
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const [form, setForm] = useState<FormKind | null>(null);
  const [confirm, setConfirm] = useState<ReturnType<typeof dueRecurring>[number] | null>(null);
  const due = can('expenses.manage') ? dueRecurring('income') : [];
  const inP = (iso: string) => (!period.from || dayOf(iso) >= period.from) && (!period.to || dayOf(iso) <= period.to);
  const list = moves.filter((m) => m.type === 'income' && inP(m.at)).sort((a, b) => b.at.localeCompare(a.at));
  const name = (id?: string) => cats.find((c) => c.id === id)?.name ?? 'Sans catégorie';
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of list) m.set(name(x.categoryId), (m.get(name(x.categoryId)) ?? 0) + x.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list, cats]);
  const totalExp = byCat.reduce((s, [, v]) => s + v, 0);
  const totalInc = list.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0);
  return (
    <>
      {due.length > 0 && (
        <div className="card stack-s">
          <h2>Opérations récurrentes à confirmer</h2>
          <ul className="list">
            {due.map((d) => (
              <li key={d.r.id + d.period} className="list-item">
                <div className="list-item-main"><span className="list-item-title">{d.r.label}</span><p className="small muted">Échéance du {fmtDate(d.date)} · {name(d.r.categoryId)} · {ACCOUNTS[d.r.account]}</p></div>
                <strong className="num">{fmtAr(d.r.amount)}</strong>
                <Button onClick={() => setConfirm(d)}>Confirmer</Button>
                <Button variant="quiet" onClick={async () => { await skipRecurring(d); toast('Échéance ignorée'); }}>Ignorer</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card stack">
        <div className="row-between"><PeriodPicker value={period} onChange={setPeriod} />
          {can('expenses.manage') && <div className="row"><Button icon="plus" onClick={() => setForm('income')}>Autre revenu</Button><Button variant="ghost" onClick={() => navigate('/depenses')}>Les dépenses sont dans le menu Dépenses ›</Button></div>}</div>
        <div className="stat-grid">
          <div className="card stat"><span className="small muted">Autres revenus</span><strong className="stat-value num pos">{fmtAr(totalInc)}</strong></div>
        </div>
        {byCat.length > 0 && (
          <div className="bars">
            {byCat.map(([n, v]) => (
              <div key={n} className="bar-row"><span className="bar-label">{n}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, (v / byCat[0][1]) * 100)}%` }} /></span><strong className="num">{fmtAr(v)}</strong></div>
            ))}
          </div>
        )}
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title="Aucun autre revenu sur la période" /> : (
          <ul className="list">
            {list.map((m) => <FlowRow key={m.id} f={{ id: m.id, at: m.at, account: m.account, amount: m.amount, label: m.label || name(m.categoryId), detail: [m.label ? name(m.categoryId) : '', m.note, m.userName].filter(Boolean).join(' · '), move: m }} />)}
          </ul>
        )}
      </div>
      {form && <MoveForm kind={form} onClose={() => setForm(null)} />}
      {confirm && <ConfirmRecurring d={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

function ConfirmRecurring({ d, onClose }: { d: ReturnType<typeof dueRecurring>[number]; onClose: () => void }) {
  const [amount, setAmount] = useState(String(d.r.amount));
  const [account, setAccount] = useState<AccountId>(d.r.account);
  return (
    <Modal title={`${d.r.label} — ${fmtDate(d.date)}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!parseAr(amount)} onClick={async () => { await confirmRecurring(d, parseAr(amount)!, account); toast('Opération enregistrée'); onClose(); }}>Confirmer le paiement</Button></>}>
      <div className="grid-2">
        <TextField label="Montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
        <SelectField label={d.r.kind === 'expense' ? 'Payé depuis' : 'Reçu sur'} value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
      </div>
    </Modal>
  );
}

// ---------- Catégories et opérations récurrentes ----------
function Categories() {
  const can = useCan();
  const cats = useTable<FinanceCategory>('financeCategories');
  const recs = useTable<Recurring>('recurring');
  const [edit, setEdit] = useState<FinanceCategory | { kind: 'expense' | 'income' } | null>(null);
  const [rec, setRec] = useState<Recurring | 'new' | null>(null);
  const manage = can('expenses.manage');
  const sorted = (k: 'expense' | 'income') => cats.filter((c) => c.kind === k).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || (a.order ?? 99) - (b.order ?? 99));
  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        {(['income'] as const).map((k) => (
          <div key={k} className="card stack-s">
            <div className="row-between"><h2>{k === 'expense' ? 'Catégories de dépenses' : 'Catégories d’autres revenus'}</h2>{manage && <Button variant="ghost" icon="plus" onClick={() => setEdit({ kind: k })}>Ajouter</Button>}</div>
            <ul className="list">
              {sorted(k).map((c) => (
                <li key={c.id} className="list-item" style={{ opacity: c.active === false ? .5 : 1 }}>
                  <span className="list-item-main">{c.name}{c.active === false && <Badge>désactivée</Badge>}</span>
                  {manage && <IconButton icon="edit" label="Modifier" onClick={() => setEdit(c)} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="card"><p className="small">Les catégories et types de <strong>dépenses</strong> et les <strong>charges fixes</strong> (loyer, salaires…) sont dans le menu <a href="#/depenses/fixes">Dépenses</a>.</p></div>
      {edit && <CategoryForm cat={edit} onClose={() => setEdit(null)} />}
      {rec && <RecurringForm rec={rec === 'new' ? undefined : rec} onClose={() => setRec(null)} />}
    </>
  );
}

function CategoryForm({ cat, onClose }: { cat: FinanceCategory | { kind: 'expense' | 'income' }; onClose: () => void }) {
  const existing = 'id' in cat ? cat : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [active, setActive] = useState(existing?.active !== false);
  return (
    <Modal title={existing ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!name.trim()} onClick={async () => { await save('financeCategories', { ...(existing ? { id: existing.id } : { order: 50 }), kind: cat.kind, name: name.trim(), active }); toast('Catégorie enregistrée'); onClose(); }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom" required value={name} onChange={setName} autoFocus />
        {existing && <Toggle checked={active} onChange={setActive} label="Active (proposée dans les listes)" />}
      </div>
    </Modal>
  );
}

function RecurringForm({ rec, onClose }: { rec?: Recurring; onClose: () => void }) {
  const cats = useTable<FinanceCategory>('financeCategories').filter((c) => c.active !== false);
  const [kind, setKind] = useState<'expense' | 'income'>(rec?.kind ?? 'expense');
  const [label, setLabel] = useState(rec?.label ?? '');
  const [cat, setCat] = useState(rec?.categoryId ?? 'fc-loyer');
  const [account, setAccount] = useState<AccountId>(rec?.account ?? 'cash');
  const [amount, setAmount] = useState(rec ? String(rec.amount) : '');
  const [day, setDay] = useState(String(rec?.day ?? 5));
  const [start, setStart] = useState(rec?.startMonth ?? today().slice(0, 7));
  const [active, setActive] = useState(rec?.active ?? true);
  const list = cats.filter((c) => c.kind === kind);
  const ok = label.trim() && parseAr(amount) && list.some((c) => c.id === cat);
  return (
    <Modal title={rec ? 'Modifier l’opération récurrente' : 'Nouvelle opération récurrente'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!ok} onClick={async () => {
        await save('recurring', { ...(rec ? { id: rec.id } : {}), kind, label: label.trim(), categoryId: cat, account, amount: parseAr(amount)!, day: Math.min(31, Math.max(1, Number(day) || 1)), startMonth: start, active });
        toast('Opération récurrente enregistrée'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="segmented" role="group">{(['expense', 'income'] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCat(cats.find((c) => c.kind === k)?.id ?? ''); }}>{k === 'expense' ? 'Dépense' : 'Revenu'}</button>)}</div>
        <TextField label="Libellé (ex. Loyer boutique)" required value={label} onChange={setLabel} />
        <div className="grid-2">
          <SelectField label="Catégorie" required value={cat} onChange={setCat} options={list.map((c) => ({ value: c.id, label: c.name }))} />
          <TextField label="Montant habituel (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
          <SelectField label="Compte" value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
          <TextField label="Jour du mois" value={day} onChange={setDay} inputMode="numeric" />
          <TextField label="À partir du mois" type="month" value={start} onChange={setStart} />
        </div>
        <Toggle checked={active} onChange={setActive} label="Active" />
      </div>
    </Modal>
  );
}
