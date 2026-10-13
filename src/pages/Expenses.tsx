// Menu « Dépenses » : saisie complète (catégorie, type, montant, compte, reçu), liste triable et filtrable par période,
// catégorie et type, totaux, export Excel ; charges fixes répétées (rappel le jour et à l'heure prévus) ;
// catégories et types de dépenses (aussi ajoutables pendant la saisie).
import { useMemo, useRef, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { all, save, useTable } from '../lib/db';
import { fmtAr, matchQuery, parseNum, parseAr } from '../lib/catalog';
import { compressPhoto } from '../lib/images';
import {
  ACCOUNTS, ACCOUNT_IDS, FREQS, RHYTHMS, WEEKDAYS, addMove, atFor, catHabit, confirmRecurring, dayOf, deleteMove, dueRecurring, habitText, nextOccurrence, recurringText, skipRecurring, today, typeForCat,
  type AccountId, type CashMove, type FinanceCategory, type Freq, type Recurring, type Rhythm,
} from '../lib/money';
import { closedBy } from '../lib/closed';
import { Help, Badge, Button, FilterSelect, Confirm, Empty, IconButton, Modal, PageHead, Req, SelectField, TextField, Toggle, fmtDate, fmtDateTime, navigate, toast, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ListDates, PeriodPicker, defaultPeriod, inPeriod, type ListOrder, type Period } from '../ui/period';
import { SortTable, exportTables, type Col } from '../ui/table';

const TABS = [
  { key: 'liste', label: 'Dépenses' },
  { key: 'fixes', label: 'Charges fixes' },
  { key: 'reglages', label: 'Catégories et types' },
];
const accountOptions = ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }));
const NEW = '__new';

export function ExpensesPage() {
  const can = useCan();
  const route = useRoute();
  const cur = TABS.find((t) => route.endsWith('/' + t.key)) ?? TABS[0];
  const [adding, setAdding] = useState(false);
  if (!can('expenses.manage') && !can('treasury.view')) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Dépenses" subtitle="Dépenses et charges : saisie, suivi par période et par catégorie, charges fixes avec rappel"
        actions={can('expenses.manage') && <Button icon="plus" onClick={() => setAdding(true)}>Ajouter une dépense</Button>} />
      <DueCharges />
      <div className="tabs" role="tablist">{TABS.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/depenses/' + t.key)}>{t.label}</button>)}</div>
      {cur.key === 'liste' && <ExpenseList />}
      {cur.key === 'fixes' && <FixedCharges />}
      {cur.key === 'reglages' && <CatsAndTypes />}
      {adding && <ExpenseForm onClose={() => setAdding(false)} />}
    </>
  );
}

// ---------- Charges fixes arrivées à échéance ----------
export function DueCharges() {
  const can = useCan();
  useTable('cashMoves'); useTable('recurring');
  const cats = useTable<FinanceCategory>('financeCategories');
  const [pay, setPay] = useState<ReturnType<typeof dueRecurring>[number] | null>(null);
  const [skip, setSkip] = useState<ReturnType<typeof dueRecurring>[number] | null>(null);
  if (!can('expenses.manage')) return null;
  const due = dueRecurring('expense');
  if (!due.length) return null;
  return (
    <div className="card stack-s due-card">
      <h2><Icon name="bell" /> Charges à payer ({due.length})</h2>
      <ul className="list">{due.map((d) => (
        <li key={d.r.id + d.period} className="list-item">
          <div className="list-item-main"><span className="list-item-title">{d.r.label}</span><p className="small muted">Échéance du {fmtDate(d.date)}{d.r.time ? ` à ${d.r.time}` : ''} · {cats.find((c) => c.id === d.r.categoryId)?.name} · {ACCOUNTS[d.r.account]}</p></div>
          <strong className="num">{fmtAr(d.r.amount)}</strong>
          <Button onClick={() => setPay(d)}>Payer</Button>
          <Button variant="quiet" onClick={() => setSkip(d)}>Ignorer</Button>
        </li>
      ))}</ul>
      {pay && <PayDue d={pay} onClose={() => setPay(null)} />}
      {skip && <Confirm title="Ignorer cette échéance ?" danger confirmLabel="Ignorer l’échéance" onClose={() => setSkip(null)} onConfirm={async () => { await skipRecurring(skip); await audit('Charge fixe ignorée', `${skip.r.label} — échéance du ${skip.date}`); toast('Échéance ignorée'); }}
        message={<p>« {skip.r.label} » du {fmtDate(skip.date)} ne sera <strong>pas payée</strong> et ne sera plus rappelée. Pour un simple rappel plus tard, fermez plutôt la notification.</p>} />}
    </div>
  );
}

export function PayDue({ d, onClose }: { d: ReturnType<typeof dueRecurring>[number]; onClose: () => void }) {
  const [amount, setAmount] = useState(String(d.r.amount));
  const [account, setAccount] = useState<AccountId>(d.r.account);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Payer : ${d.r.label}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!parseAr(amount)} onClick={async () => {
        setBusy(true);
        try { await confirmRecurring(d, parseAr(amount)!, account); toast('Dépense enregistrée'); onClose(); } catch (e: any) { toast(e.message, 'error'); setBusy(false); }
      }}>Enregistrer le paiement</Button></>}>
      <div className="stack">
        <p className="small muted">Échéance du {fmtDate(d.date)} · {recurringText(d.r)}</p>
        <div className="grid-2">
          <TextField label="Montant payé (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
          <SelectField label="Payé depuis" value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
        </div>
      </div>
    </Modal>
  );
}

// ---------- Rythme d'une catégorie de dépense ----------
interface Habit { rhythm: Rhythm; fixed: boolean; remind: boolean; amount: string; account: AccountId; day: string; weekday: string; month: string }
const habitInit = (c?: FinanceCategory): Habit => ({ ...catHabit(c), remind: true, amount: '', account: 'cash', day: '5', weekday: '1', month: '1' });
const TYPE_HELP: Record<string, string> = {
  'et-courante': 'revient souvent, montant différent à chaque fois (ex. sakafo, taxi, crédit).',
  'et-fixe': 'même montant à date fixe (ex. loyer, salaire) : un rappel « à payer » apparaît le jour venu.',
  'et-exception': 'rare ou imprévue (ex. réparation, achat de matériel).',
};
const habitOk = (h: Habit, hasRec: boolean) => !(h.rhythm !== 'occasional' && h.fixed && h.remind && !hasRec && !parseNum(h.amount));

/** Les questions posées dès qu'on crée (ou modifie) une catégorie de dépense : rythme, montant fixe ou variable, rappel. */
function HabitFields({ h, set, rec }: { h: Habit; set: (h: Habit) => void; rec?: Recurring }) {
  const cats = useTable<FinanceCategory>('financeCategories');
  const up = (p: Partial<Habit>) => set({ ...h, ...p });
  const periodic = h.rhythm !== 'occasional';
  const type = typeForCat({ id: '', rhythm: h.rhythm, fixedAmount: h.fixed } as FinanceCategory);
  return (
    <div className="stack-s habit">
      <SelectField label="Cette dépense revient…" value={h.rhythm} onChange={(v) => up({ rhythm: v as Rhythm })} options={Object.entries(RHYTHMS).map(([value, label]) => ({ value, label }))} />
      {periodic && <div className="segmented" role="group" aria-label="Montant">
        <button type="button" aria-pressed={!h.fixed} onClick={() => up({ fixed: false })}>Montant variable</button>
        <button type="button" aria-pressed={h.fixed} onClick={() => up({ fixed: true })}>Toujours le même montant</button>
      </div>}
      <p className="small muted">Type : <strong>{cats.find((c) => c.id === type)?.name ?? type}</strong> — {TYPE_HELP[type]}</p>
      {periodic && h.fixed && (rec
        ? <p className="small muted"><Icon name="bell" size={14} /> Rappel déjà prévu : {recurringText(rec)}, {fmtAr(rec.amount)}. Modifiable dans « Charges fixes ».</p>
        : <>
          <Toggle checked={h.remind} onChange={(v) => up({ remind: v })} label="Me rappeler de payer (charge fixe)" />
          {h.remind && <div className="grid-2">
            <TextField label="Montant habituel (Ar)" required value={h.amount} onChange={(v) => up({ amount: v })} inputMode="numeric" />
            <SelectField label="Payé depuis" value={h.account} onChange={(v) => up({ account: v as AccountId })} options={accountOptions} />
            {h.rhythm === 'weekly' && <SelectField label="Jour de la semaine" value={h.weekday} onChange={(v) => up({ weekday: v })} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))} />}
            {(h.rhythm === 'monthly' || h.rhythm === 'yearly') && <TextField label="Jour du mois" value={h.day} onChange={(v) => up({ day: v })} inputMode="numeric" />}
            {h.rhythm === 'yearly' && <SelectField label="Mois" value={h.month} onChange={(v) => up({ month: v })} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2026, i, 1).toLocaleDateString('fr-FR', { month: 'long' }) }))} />}
          </div>}
        </>)}
    </div>
  );
}

/** Enregistre la catégorie avec son rythme ; crée la charge fixe (rappel) si demandé. */
async function saveExpenseCat(name: string, h: Habit, existing?: FinanceCategory, active = true): Promise<string> {
  const [c] = await save('financeCategories', { ...(existing ? { id: existing.id } : { order: 50 }), kind: 'expense', name, active, rhythm: h.rhythm, fixedAmount: h.rhythm !== 'occasional' && h.fixed });
  const hasRec = all<Recurring>('recurring').some((r) => r.active && r.kind === 'expense' && r.categoryId === c.id);
  if (h.rhythm !== 'occasional' && h.fixed && h.remind && !hasRec && parseNum(h.amount)) {
    await save('recurring', { kind: 'expense', label: name, categoryId: c.id, typeId: 'et-fixe', account: h.account, amount: parseNum(h.amount)!, freq: h.rhythm as Freq,
      day: Math.min(31, Math.max(1, Number(h.day) || 1)), weekday: Number(h.weekday), month: Number(h.month), time: '08:00', startMonth: today().slice(0, 7), active: true });
    await audit('Charge fixe ajoutée', `${name} : ${parseNum(h.amount)} Ar, ${FREQS[h.rhythm as Freq].toLowerCase()}`);
  }
  await audit(existing ? 'Catégorie de dépense modifiée' : 'Catégorie de dépense ajoutée', `${name} — ${habitText(c as FinanceCategory)}`);
  return c.id;
}

// ---------- Saisie d'une dépense ----------
/** Liste déroulante avec « + Nouveau… » : la nouvelle catégorie (ou le nouveau type) est créée tout de suite. */
function PickOrAdd({ label, kind, value, onChange, required }: { label: string; kind: 'expense' | 'etype'; value: string; onChange: (v: string) => void; required?: boolean }) {
  const list = useTable<FinanceCategory>('financeCategories').filter((c) => c.kind === kind && c.active !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'fr'));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [h, setH] = useState<Habit>(habitInit());
  if (adding) return (
    <div className="field add-inline" style={kind === 'expense' ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label} — nouvelle<Req /></label>
      <div className="stack-s">
        <input className="cell-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'etype' ? 'Ex. Investissement' : 'Ex. Sakafo'} aria-label={`Nom de la nouvelle ${label.toLowerCase()}`} />
        {kind === 'expense' && name.trim() && <HabitFields h={h} set={setH} />}
        <div className="row" style={{ gap: 6 }}>
          <Button disabled={!name.trim() || (kind === 'expense' && !habitOk(h, false))} onClick={async () => {
            const exists = list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
            if (exists) { onChange(exists.id); setAdding(false); return; }
            if (kind === 'expense') { onChange(await saveExpenseCat(name.trim(), h)); }
            else {
              const [c] = await save('financeCategories', { kind, name: name.trim(), order: 50, active: true });
              await audit('Type de dépense ajouté', name.trim());
              onChange(c.id);
            }
            setAdding(false); setName(''); setH(habitInit());
          }}>{kind === 'expense' ? 'Créer la catégorie' : 'OK'}</Button>
          <Button variant="quiet" onClick={() => setAdding(false)}>Annuler</Button>
        </div>
      </div>
    </div>
  );
  return <SelectField label={label} required={required} value={value} onChange={(v) => (v === NEW ? setAdding(true) : onChange(v))} options={[...(value ? [] : [{ value: '', label: '— Choisir —' }]), ...list.map((c) => ({ value: c.id, label: c.name })), { value: NEW, label: `+ ${kind === 'etype' ? 'Nouveau type' : 'Nouvelle catégorie'}…` }]} />;
}

export function ExpenseForm({ onClose }: { onClose: () => void }) {
  const cats = useTable<FinanceCategory>('financeCategories');
  const moves = useTable<CashMove>('cashMoves');
  const recs = useTable<Recurring>('recurring');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('');
  const [typeOver, setTypeOver] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountId>('cash');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState<ReturnType<typeof dueRecurring>[number] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const n = parseAr(amount) || 0;
  const closed = closedBy(date);
  const c = cats.find((x) => x.id === cat);
  const type = typeOver ?? typeForCat(c);
  // Ce que l'on sait déjà de cette catégorie : échéance à payer, dernier paiement, dernière dépense.
  const due = cat ? dueRecurring('expense').filter((d) => d.r.categoryId === cat) : [];
  const rec = recs.find((r) => r.active && r.kind === 'expense' && r.categoryId === cat);
  const last = useMemo(() => moves.filter((m) => m.type === 'expense' && m.categoryId === cat).sort((a, b) => b.at.localeCompare(a.at))[0], [moves, cat]);
  // Charge fixe déjà payée pour la période en cours (jour, 7 derniers jours, mois, année) : risque de doublon.
  const sameDay = !!(last && rec && (() => {
    const d = dayOf(last.at), t = today();
    if (rec.freq === 'daily') return d === t;
    if (rec.freq === 'weekly') return (Date.parse(t) - Date.parse(d)) / 86400_000 < 7;
    return d.slice(0, rec.freq === 'yearly' ? 4 : 7) === t.slice(0, rec.freq === 'yearly' ? 4 : 7);
  })());
  const pick = (id: string) => {
    setCat(id); setTypeOver(null);
    const r = recs.find((x) => x.active && x.kind === 'expense' && x.categoryId === id);
    if (r && !amount) { setAmount(String(r.amount)); setAccount(r.account); }
  };
  if (pay) return <PayDue d={pay} onClose={onClose} />;
  return (
    <Modal title="Nouvelle dépense" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!n || !!closed || !cat} onClick={async () => {
        setBusy(true);
        try { await addMove({ at: atFor(date), account, amount: -Math.abs(n), type: 'expense', categoryId: cat, typeId: type, label: label.trim() || c?.name || 'Dépense', note: note.trim() || undefined, photo }); toast('Dépense enregistrée'); onClose(); }
        catch (e: any) { toast(e.message, 'error'); setBusy(false); }
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <PickOrAdd label="Catégorie" kind="expense" required value={cat} onChange={pick} />
        {c && <div className="habit-line small">
          <span className="muted">{habitText(c)} · Type : </span>
          {typeOver === null
            ? <><strong>{cats.find((x) => x.id === type)?.name}</strong> <button type="button" className="link-btn" onClick={() => setTypeOver(type)}>changer</button></>
            : <select aria-label="Type" value={typeOver} onChange={(e) => setTypeOver(e.target.value)}>{cats.filter((x) => x.kind === 'etype' && x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        </div>}
        {due.length > 0 && <div className="notice notice-warn"><Icon name="bell" /><span style={{ flex: 1 }}>« {due[0].r.label} » du {fmtDate(due[0].date)} ({fmtAr(due[0].r.amount)}) est à payer. Payez cette échéance pour qu’elle ne soit plus rappelée.</span><Button onClick={() => setPay(due[0])}>Payer l’échéance</Button></div>}
        {!due.length && sameDay && <div className="notice notice-warn"><Icon name="alert" /><span>Déjà payée pour cette période : {fmtAr(-last!.amount)} le {fmtDate(dayOf(last!.at))}. Vérifiez que ce n’est pas un doublon.</span></div>}
        <div className="grid-2">
          <TextField label="Montant (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" hint={last && !rec ? <button type="button" className="link-btn" onClick={() => setAmount(String(-last.amount))}>Dernière fois : {fmtAr(-last.amount)} le {fmtDate(dayOf(last.at))}</button> : undefined} />
          <TextField label="Date" type="date" value={date} max={today()} onChange={setDate} />
          <SelectField label="Payé depuis" value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
          <TextField label="Description (facultatif)" value={label} onChange={setLabel} placeholder={c ? `Par défaut : ${c.name}` : 'Ex. Taxi livraison Analakely'} />
        </div>
        <TextField label="Note (facultatif)" value={note} onChange={setNote} />
        <div className="row" style={{ alignItems: 'center' }}>
          <Button variant="ghost" icon="upload" onClick={() => file.current?.click()}>{photo ? 'Changer la photo du reçu' : 'Photo du reçu (facultatif)'}</Button>
          {photo && <><img src={photo} alt="Reçu" style={{ height: 48, borderRadius: 8 }} /><Button variant="quiet" onClick={() => setPhoto(undefined)}>Retirer</Button></>}
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await compressPhoto(f, { max: 1000, targetBytes: 110_000 })); } catch (err: any) { toast(err?.message ?? 'Photo illisible', 'error'); } } e.target.value = ''; }} />
        </div>
        {closed && <div className="notice notice-danger"><Icon name="lock" /><span>Semaine clôturée (versement au patron validé) : choisissez une autre date.</span></div>}
      </div>
    </Modal>
  );
}

// ---------- Liste ----------
function ExpenseList() {
  const can = useCan();
  const moves = useTable<CashMove>('cashMoves');
  const cats = useTable<FinanceCategory>('financeCategories');
  const [period, setPeriod] = useState<Period>(defaultPeriod('today'));
  const [order, setOrder] = useState<ListOrder>('new');
  const [cat, setCat] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [del, setDel] = useState<CashMove | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [allCats, setAllCats] = useState(false);
  const name = (id?: string) => cats.find((c) => c.id === id)?.name ?? '—';
  const typeOf = (m: CashMove) => m.typeId ?? (m.recurringId ? 'et-fixe' : 'et-courante');
  const list = useMemo(() => moves.filter((m) => m.type === 'expense' && inPeriod(m.at, period) && (!cat || m.categoryId === cat) && (!type || typeOf(m) === type)
    && (!q.trim() || matchQuery(`${m.label ?? ''} ${m.note ?? ''} ${name(m.categoryId)} ${m.userName ?? ''} ${-m.amount}`, q))), [moves, period, cat, type, q, cats]);
  const total = list.reduce((t, m) => t - m.amount, 0);
  const group = (key: (m: CashMove) => string) => { const g = new Map<string, number>(); for (const m of list) g.set(key(m), (g.get(key(m)) ?? 0) - m.amount); return [...g.entries()].sort((a, b) => b[1] - a[1]); };
  const byCat = group((m) => name(m.categoryId));
  const byType = group((m) => name(typeOf(m)));
  const cols: Col<CashMove>[] = [
    { key: 'd', label: 'Date', value: (m) => m.at, render: (m) => <span className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.at)}</span>, width: 18 },
    { key: 'l', label: 'Description', value: (m) => m.label ?? '', render: (m) => <><strong>{m.label || '—'}</strong>{m.note ? <div className="small muted">{m.note}</div> : null}</>, width: 30 },
    { key: 'c', label: 'Catégorie', value: (m) => name(m.categoryId), width: 22 },
    { key: 't', label: 'Type', value: (m) => name(typeOf(m)), width: 18 },
    { key: 'a', label: 'Compte', value: (m) => ACCOUNTS[m.account], width: 16 },
    { key: 'u', label: 'Saisi par', value: (m) => m.userName ?? '', width: 16 },
    { key: 'm', label: 'Montant', value: (m) => -m.amount, money: true, total: true, width: 14 },
    { key: 'x', label: '', value: () => '', render: (m) => <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>{m.photo && <IconButton icon="eye" label="Voir le reçu" onClick={() => setPhoto(m.photo!)} />}{can('expenses.manage') && <IconButton icon="trash" label="Supprimer" onClick={() => setDel(m)} />}</span> },
  ];
  return (
    <>
      <div className="card stack">
        <ListDates period={period} onPeriod={setPeriod} order={order} onOrder={setOrder} what="Date de la dépense" />
        <div className="row">
          <div className="field" style={{ flex: '2 1 220px' }}><input aria-label="Rechercher une dépense" placeholder="Rechercher (description, note, montant, personne)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field" style={{ flex: '1 1 180px' }}><FilterSelect label="Catégorie" value={cat} onChange={setCat} options={[{ value: '', label: 'Toutes les catégories' }, ...cats.filter((c) => c.kind === 'expense').map((c) => ({ value: c.id, label: c.name }))]} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}><option value="">Tous les types</option>{cats.filter((c) => c.kind === 'etype').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div className="stat-grid">
          <div className="card stat stat-strong"><span className="small muted">Total des dépenses ({list.length})</span><strong className="stat-value num">{fmtAr(total)}</strong></div>
          {byType.slice(0, 3).map(([n, v]) => <div key={n} className="card stat"><span className="small muted">{n}</span><strong className="stat-value num">{fmtAr(v)}</strong></div>)}
        </div>
        {byCat.length > 0 && <div className="bars">{(allCats ? byCat : byCat.slice(0, 5)).map(([n, v]) => (
          <div key={n} className="bar-row"><span className="bar-label">{n}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, (v / byCat[0][1]) * 100)}%` }} /></span><strong className="num">{fmtAr(v)}</strong></div>
        ))}{byCat.length > 5 && <button type="button" className="link-btn" style={{ paddingLeft: 0, justifySelf: 'start' }} onClick={() => setAllCats(!allCats)}>{allCats ? 'Voir moins' : `Voir les ${byCat.length - 5} autres catégories`}</button>}</div>}
      </div>
      <div className="card card-flush">
        <div className="card-pad row-between"><h2>Liste des dépenses</h2>
          <Button variant="ghost" icon="download" disabled={!list.length} onClick={() => exportTables(`depenses_${period.from ?? 'debut'}_${period.to ?? today()}.xlsx`, [{ name: 'Dépenses', cols: cols.slice(0, 7).map((c) => ({ ...c, value: c.key === 'd' ? (m: CashMove) => fmtDateTime(m.at) : c.value })), rows: list }, { name: 'Par catégorie', cols: [{ key: 'n', label: 'Catégorie', value: (r: [string, number]) => r[0], width: 26 }, { key: 'v', label: 'Total', value: (r: [string, number]) => r[1], money: true, total: true, width: 16 }], rows: byCat }])}>Excel</Button></div>
        <SortTable key={order} rowKey={(m) => m.id} rows={list} cols={cols} initialSort={{ key: 'd', desc: order === 'new' }} limit={100} empty="Aucune dépense sur la période." />
      </div>
      {del && <Confirm title="Supprimer cette dépense ?" danger confirmLabel="Supprimer" onClose={() => setDel(null)} onConfirm={async () => { await deleteMove(del); toast('Dépense supprimée'); }}
        message={<p>{del.label || name(del.categoryId)} — {fmtAr(-del.amount)} ({ACCOUNTS[del.account]}, {fmtDate(dayOf(del.at))}). Le solde du compte remonte d’autant.</p>} />}
      {photo && <Modal title="Reçu" onClose={() => setPhoto(null)}><img src={photo} alt="Reçu" style={{ width: '100%', borderRadius: 12 }} /></Modal>}
    </>
  );
}

// ---------- Charges fixes ----------
function FixedCharges() {
  const can = useCan();
  const recs = useTable<Recurring>('recurring');
  const cats = useTable<FinanceCategory>('financeCategories');
  const [edit, setEdit] = useState<Recurring | 'new' | null>(null);
  const sorted = [...recs].sort((a, b) => Number(b.active) - Number(a.active) || (nextOccurrence(a) ?? '9').localeCompare(nextOccurrence(b) ?? '9'));
  return (
    <>
      <div className="card row-between">
        <Help>Loyer, salaires, JIRAMA, internet… Définissez-les une fois : le jour (et l’heure) venu, une notification « à payer » apparaît avec « Payer » ou « Plus tard ».</Help>
        {can('expenses.manage') && <Button icon="plus" onClick={() => setEdit('new')}>Ajouter une charge fixe</Button>}
      </div>
      <div className="card card-flush">
        {sorted.length === 0 ? <Empty icon="refresh" title="Aucune charge fixe" /> : (
          <ul className="list">{sorted.map((r) => (
            <li key={r.id} className="list-item" style={{ opacity: r.active ? 1 : .5 }}>
              <div className="list-item-main"><span className="list-item-title">{r.label} {r.kind === 'income' && <Badge>revenu</Badge>}{!r.active && <Badge>arrêtée</Badge>}</span>
                <p className="small muted">{recurringText(r)} · {cats.find((c) => c.id === r.categoryId)?.name} · {ACCOUNTS[r.account]}{r.active && nextOccurrence(r) ? ` · prochaine : ${fmtDate(nextOccurrence(r))}` : ''}</p></div>
              <strong className="num">{fmtAr(r.amount)}</strong>
              {can('expenses.manage') && <IconButton icon="edit" label="Modifier" onClick={() => setEdit(r)} />}
            </li>
          ))}</ul>
        )}
      </div>
      {edit && <FixedForm rec={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function FixedForm({ rec, onClose }: { rec?: Recurring; onClose: () => void }) {
  const [kind, setKind] = useState<'expense' | 'income'>(rec?.kind ?? 'expense');
  const [label, setLabel] = useState(rec?.label ?? '');
  const [cat, setCat] = useState(rec?.categoryId ?? 'fc-loyer');
  const [type, setType] = useState(rec?.typeId ?? 'et-fixe');
  const [account, setAccount] = useState<AccountId>(rec?.account ?? 'cash');
  const [amount, setAmount] = useState(rec ? String(rec.amount) : '');
  const [freq, setFreq] = useState<Freq>(rec?.freq ?? 'monthly');
  const [day, setDay] = useState(String(rec?.day ?? 5));
  const [weekday, setWeekday] = useState(String(rec?.weekday ?? 1));
  const [month, setMonth] = useState(String(rec?.month ?? 1));
  const [time, setTime] = useState(rec?.time ?? '08:00');
  const [start, setStart] = useState(rec?.startMonth ?? today().slice(0, 7));
  const [active, setActive] = useState(rec?.active ?? true);
  const incomeCats = useTable<FinanceCategory>('financeCategories').filter((c) => c.kind === 'income' && c.active !== false);
  const ok = label.trim() && parseAr(amount) && cat;
  return (
    <Modal title={rec ? 'Modifier la charge fixe' : 'Nouvelle charge fixe'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!ok} onClick={async () => {
        await save('recurring', { ...(rec ? { id: rec.id } : {}), kind, label: label.trim(), categoryId: cat, typeId: kind === 'expense' ? type : undefined, account, amount: parseAr(amount)!, freq,
          day: Math.min(31, Math.max(1, Number(day) || 1)), weekday: Number(weekday), month: Number(month), time: time || undefined, startMonth: start, active });
        await audit(rec ? 'Charge fixe modifiée' : 'Charge fixe ajoutée', `${label.trim()} : ${parseAr(amount)} Ar, ${FREQS[freq].toLowerCase()}`);
        toast('Charge fixe enregistrée'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="segmented" role="group">{(['expense', 'income'] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setCat(k === 'income' ? incomeCats[0]?.id ?? '' : 'fc-loyer'); }}>{k === 'expense' ? 'Dépense' : 'Revenu'}</button>)}</div>
        <TextField label="Libellé (ex. Loyer boutique)" required value={label} onChange={setLabel} />
        <div className="grid-2">
          {kind === 'expense' ? <PickOrAdd label="Catégorie" kind="expense" required value={cat} onChange={setCat} /> : <SelectField label="Catégorie" required value={cat} onChange={setCat} options={incomeCats.map((c) => ({ value: c.id, label: c.name }))} />}
          {kind === 'expense' && <PickOrAdd label="Type" kind="etype" value={type} onChange={setType} />}
          <TextField label="Montant habituel (Ar)" required value={amount} onChange={setAmount} inputMode="numeric" />
          <SelectField label="Compte" value={account} onChange={(v) => setAccount(v as AccountId)} options={accountOptions} />
          <SelectField label="Répétition" value={freq} onChange={(v) => setFreq(v as Freq)} options={Object.entries(FREQS).map(([value, label]) => ({ value, label }))} />
          {freq === 'weekly' && <SelectField label="Jour de la semaine" value={weekday} onChange={setWeekday} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))} />}
          {(freq === 'monthly' || freq === 'yearly') && <TextField label="Jour du mois" value={day} onChange={setDay} inputMode="numeric" />}
          {freq === 'yearly' && <SelectField label="Mois" value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2026, i, 1).toLocaleDateString('fr-FR', { month: 'long' }) }))} />}
          <TextField label="Heure du rappel" type="time" value={time} onChange={setTime} />
          <TextField label="À partir du mois" type="month" value={start} onChange={setStart} />
        </div>
        <Toggle checked={active} onChange={setActive} label="Active (rappels et échéances)" />
      </div>
    </Modal>
  );
}

// ---------- Catégories et types ----------
function CatsAndTypes() {
  const can = useCan();
  const cats = useTable<FinanceCategory>('financeCategories');
  const [edit, setEdit] = useState<FinanceCategory | { kind: 'expense' | 'etype' } | null>(null);
  const manage = can('expenses.manage');
  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        {(['expense', 'etype'] as const).map((k) => (
          <div key={k} className="card stack-s">
            <div className="row-between"><h2>{k === 'expense' ? 'Catégories de dépenses' : 'Types de dépenses'}</h2>{manage && <Button variant="ghost" icon="plus" onClick={() => setEdit({ kind: k })}>Ajouter</Button>}</div>
            <ul className="list">{cats.filter((c) => c.kind === k).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || (a.order ?? 99) - (b.order ?? 99)).map((c) => (
              <li key={c.id} className="list-item" style={{ opacity: c.active === false ? .5 : 1 }}>
                <span className="list-item-main"><span>{c.name}{c.active === false && <Badge>désactivée</Badge>}</span>{k === 'expense' && <span className="small muted" style={{ display: 'block' }}>{habitText(c)}</span>}</span>
                {manage && <IconButton icon="edit" label="Modifier" onClick={() => setEdit(c)} />}
              </li>
            ))}</ul>
          </div>
        ))}
      </div>
      <Help>Les catégories et types peuvent aussi être ajoutés directement pendant la saisie d’une dépense (« + Nouvelle catégorie… »). Une catégorie n’est jamais supprimée : on la désactive, l’historique reste juste. Les catégories d’autres revenus sont dans Trésorerie.</Help>
      {edit && <CatForm cat={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
function CatForm({ cat, onClose }: { cat: FinanceCategory | { kind: 'expense' | 'etype' }; onClose: () => void }) {
  const existing = 'id' in cat ? cat : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [active, setActive] = useState(existing?.active !== false);
  const [h, setH] = useState<Habit>(habitInit(existing));
  const rec = useTable<Recurring>('recurring').find((r) => existing && r.active && r.kind === 'expense' && r.categoryId === existing.id);
  const isExp = cat.kind === 'expense';
  return (
    <Modal title={existing ? `Modifier « ${existing.name} »` : cat.kind === 'etype' ? 'Nouveau type' : 'Nouvelle catégorie de dépense'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!name.trim() || (isExp && !habitOk(h, !!rec))} onClick={async () => {
        if (isExp) await saveExpenseCat(name.trim(), h, existing as FinanceCategory | undefined, active);
        else await save('financeCategories', { ...(existing ? { id: existing.id } : { order: 50 }), kind: cat.kind, name: name.trim(), active });
        toast('Enregistré'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom" required value={name} onChange={setName} autoFocus placeholder={isExp ? 'Ex. Sakafo' : undefined} />
        {isExp && <HabitFields h={h} set={setH} rec={rec} />}
        {existing && <Toggle checked={active} onChange={setActive} label="Active (proposée dans les listes)" />}
        {isExp && existing && <p className="small muted">Changer le rythme ne modifie pas les dépenses déjà enregistrées, seulement les prochaines.</p>}
      </div>
    </Modal>
  );
}
