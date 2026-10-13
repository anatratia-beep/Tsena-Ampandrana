// Achats en Chine : commandes fournisseurs, suivi, paiements, fournisseurs.
import { useMemo, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, newId, remove, save, useTable } from '../lib/db';
import {
  categoryPath, fmtAr, fmtNum, nextNumber, parseNum, productVariants, PURCHASE_STATUS, todayYmd, useCatalog, variantLabel,
  type Product, type Purchase, type PurchaseLine, type PurchaseStatus, type Variant, matchQuery, productText, stockOf, searchItems } from '../lib/catalog';
import { lastRate, lineTotal, purchaseGoods, purchasePaid, purchaseQty, purchaseReceivedQty, purchaseTotal, purchaseTotalAr, toAr, type Supplier } from '../lib/purchases';
import { PurchasingTabs } from './ImportExport';
import { Badge, Button, Confirm, Empty, IconButton, Modal, PageHead, SelectField, TextField, fmtDate, navigate, toast, useRoute, DateSort, byAdded, type DateOrder } from '../ui/kit';
import { Icon } from '../ui/icons';
import { voidPurchase } from '../lib/corrections';
import { ACCOUNTS, ACCOUNT_IDS, addMove, atFor, type AccountId } from '../lib/money';
import { ProductForm, Thumb } from './Products';

const money = (n: number, cur: 'RMB' | 'MGA') => cur === 'RMB' ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ¥` : fmtAr(n);
const FLOW: PurchaseStatus[] = ['ordered', 'shipped', 'arrived', 'received'];

export function PurchasesPage() {
  const route = useRoute();
  const id = route.split('/')[2];
  if (id === 'fournisseurs') return <SuppliersPage />;
  if (id) return <PurchaseDetail id={id} />;
  return <PurchaseList />;
}

function PurchaseList() {
  const can = useCan();
  const purchases = useTable<Purchase>('purchases');
  const suppliers = useTable<Supplier>('suppliers');
  const [tab, setTab] = useState<'open' | 'received' | 'all'>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useState<DateOrder>('');
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return byAdded(purchases
      .filter((p) => tab === 'all' || (tab === 'open' ? !['received', 'cancelled'].includes(p.status) : p.status === 'received'))
      .filter((p) => !n || `${p.number} ${p.orderRef} ${p.trackingNo} ${get<Supplier>('suppliers', p.supplierId || '')?.name} ${p.notes}`.toLowerCase().includes(n))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)), order);
  }, [purchases, tab, q, order]);
  const open = purchases.filter((p) => !['received', 'cancelled'].includes(p.status));
  const openQty = open.reduce((s, p) => s + purchaseQty(p) - purchaseReceivedQty(p), 0);
  const unpaid = purchases.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + Math.max(0, toAr(purchaseTotal(p) - purchasePaid(p), p.currency, p.rate)), 0);

  return (
    <>
      <PageHead title="Achats et réceptions" subtitle={`${open.length} commande(s) en cours`}
        actions={<>
          <Button variant="ghost" icon="users" onClick={() => navigate('/achats/fournisseurs')}>Fournisseurs</Button>
          {can('purchases.receive') && <Button variant="ghost" icon="download" onClick={() => navigate('/receptions/nouvelle')}>Réceptionner</Button>}
          {can('purchases.manage') && <Button icon="plus" onClick={() => setCreating(true)}>Nouvelle commande</Button>}
        </>} />
      <PurchasingTabs current="achats" />
      <div className="stat-grid">
        <div className="card stat"><span className="muted small">Commandes en cours</span><span className="stat-value">{open.length}</span></div>
        <div className="card stat"><span className="muted small">Pièces en route</span><span className="stat-value">{fmtNum(openQty)}</span></div>
        {can('costs.view') && <div className="card stat"><span className="muted small">Reste à payer aux fournisseurs</span><span className="stat-value">{fmtAr(unpaid)}</span></div>}
      </div>
      <div className="card stack">
        <div className="row-between">
          <div className="segmented" role="group">
            {([['open', 'En cours'], ['received', 'Reçues'], ['all', 'Toutes']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="field" style={{ flex: '1 1 240px', maxWidth: 360 }}><input aria-label="Rechercher" placeholder="N° de commande, suivi, fournisseur…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <DateSort value={order} onChange={setOrder} />
        </div>
      </div>
      <div className="card card-flush">
        {list.length === 0 ? <Empty icon="list" title={purchases.length ? 'Aucune commande ici' : 'Aucune commande pour l’instant'}>
          {!purchases.length && can('purchases.manage') && <div className="row" style={{ justifyContent: 'center' }}><Button icon="plus" onClick={() => setCreating(true)}>Saisir une commande</Button><Button variant="ghost" icon="upload" onClick={() => navigate('/import')}>Importer un fichier commande</Button></div>}
        </Empty> : (
          <ul className="list">
            {list.map((p) => {
              const st = PURCHASE_STATUS[p.status];
              const qty = purchaseQty(p);
              const firstProduct = p.lines[0] && get<Product>('products', get<Variant>('variants', p.lines[0].variantId)?.productId || '');
              return (
                <li key={p.id}>
                  <a className="list-item list-link" href={`#/achats/${p.id}`}>
                    <Thumb src={firstProduct?.photo} />
                    <div className="list-item-main">
                      <div className="row" style={{ gap: 8 }}><span className="list-item-title">{p.number}</span><Badge tone={st.tone}>{st.label}</Badge></div>
                      <p className="small muted">{fmtDate(p.date)} · {get<Supplier>('suppliers', p.supplierId || '')?.name || 'Fournisseur non indiqué'}{p.orderRef ? ` · n° ${p.orderRef}` : ''}</p>
                      <p className="small muted">{[...new Set(p.lines.map((l) => get<Product>('products', get<Variant>('variants', l.variantId)?.productId || '')?.code).filter(Boolean))].slice(0, 6).join(', ')}</p>
                    </div>
                    <div className="list-item-side">
                      <strong className="num">{fmtNum(qty)} pcs</strong>
                      {p.status !== 'ordered' && p.status !== 'cancelled' && <span className="small muted">{fmtNum(purchaseReceivedQty(p))} reçues</span>}
                      {can('costs.view') && <span className="small">{money(purchaseTotal(p), p.currency)}</span>}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {creating && <PurchaseForm onClose={() => setCreating(false)} onSaved={(p) => navigate('/achats/' + p.id)} />}
      <span hidden>{suppliers.length}</span>
    </>
  );
}

function PurchaseDetail({ id }: { id: string }) {
  const can = useCan();
  useCatalog();
  useTable('suppliers');
  const receptions = useTable('receptions');
  const p = get<Purchase>('purchases', id);
  const [voiding, setVoiding] = useState(false);
  const [voidWhy, setVoidWhy] = useState('');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [close, setClose] = useState(false);
  const [delPay, setDelPay] = useState<Purchase['payments'][number] | null>(null);
  const [del, setDel] = useState(false);
  if (!p) return <Empty icon="list" title="Commande introuvable"><Button variant="ghost" onClick={() => navigate('/achats')}>Retour</Button></Empty>;
  const st = PURCHASE_STATUS[p.status];
  const showCost = can('costs.view');
  const total = purchaseTotal(p);
  const paid = purchasePaid(p);
  const sup = get<Supplier>('suppliers', p.supplierId || '');
  const recs = receptions.filter((r: any) => r.purchaseIds?.includes(p.id));
  const flowIdx = FLOW.indexOf(p.status === 'partial' ? 'arrived' : p.status);

  async function setStatus(s: PurchaseStatus) {
    await save('purchases', { id: p!.id, status: s, statusDates: { ...(p!.statusDates || {}), [s]: todayYmd() } });
    await audit('Commande Chine', `${p!.number} : ${PURCHASE_STATUS[s].label}`, 'purchases', p!.id);
    toast(PURCHASE_STATUS[s].label);
  }

  // Regroupe les lignes par article.
  const groups = new Map<string, PurchaseLine[]>();
  for (const l of p.lines) {
    const pid = get<Variant>('variants', l.variantId)?.productId || '?';
    if (!groups.has(pid)) groups.set(pid, []);
    groups.get(pid)!.push(l);
  }

  return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => navigate('/achats')}>Achats Chine</Button></div>
      <div className="card stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-s">
            <div className="row" style={{ gap: 8 }}><h1 style={{ fontSize: '1.6rem' }}>{p.number}</h1><Badge tone={st.tone}>{st.label}</Badge></div>
            <p className="muted">{fmtDate(p.date)} · {sup?.name || 'Fournisseur non indiqué'}</p>
          </div>
          <div className="page-actions">
            {can('purchases.manage') && <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>Modifier</Button>}
            {can('purchases.receive') && !['received', 'cancelled'].includes(p.status) && <Button icon="download" onClick={() => navigate('/receptions/nouvelle?commande=' + p.id)}>Réceptionner</Button>}
          </div>
        </div>
        {p.status !== 'cancelled' && (
          <ol className="stepper">
            {FLOW.map((s, i) => (
              <li key={s} className={i <= flowIdx ? 'is-done' : ''}>
                <span className="step-dot">{i <= flowIdx ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className="small"><strong>{s === 'received' && p.status === 'partial' ? 'Reçue en partie' : PURCHASE_STATUS[s].label}</strong><br /><span className="muted">{p.statusDates?.[s] ? fmtDate(p.statusDates[s]) : p.status === 'partial' && s === 'received' && p.statusDates?.partial ? fmtDate(p.statusDates.partial) : ''}</span></span>
              </li>
            ))}
          </ol>
        )}
        {can('purchases.manage') && (
          <div className="row">
            {p.status === 'ordered' && <Button variant="ghost" onClick={() => setStatus('shipped')}>Marquer expédiée de Chine</Button>}
            {['ordered', 'shipped'].includes(p.status) && <Button variant="ghost" onClick={() => setStatus('arrived')}>Marquer arrivée à Madagascar</Button>}
            {p.status === 'partial' && <Button variant="ghost" onClick={() => setClose(true)}>Clôturer (le reste ne viendra pas)</Button>}
            {!['received', 'cancelled', 'partial'].includes(p.status) && <Button variant="quiet" onClick={() => setCancel(true)}>Annuler la commande</Button>}
            {['received', 'partial'].includes(p.status) && can('records.correct') && <Button variant="quiet" onClick={() => setVoiding(true)}>Annuler la commande (erreur)</Button>}
          </div>
        )}
        <div className="kv-row">
          <div><span className="small muted">N° commande 1688</span><strong>{p.orderRef || '—'}</strong></div>
          <div><span className="small muted">N° de suivi</span><strong>{p.trackingNo || '—'}</strong></div>
          <div><span className="small muted">Transitaire</span><strong>{p.forwarder || '—'}</strong></div>
          <div><span className="small muted">Pièces</span><strong className="num">{fmtNum(purchaseReceivedQty(p))} / {fmtNum(purchaseQty(p))} reçues</strong></div>
          {showCost && <div><span className="small muted">Taux</span><strong className="num">{p.currency === 'RMB' ? `1 ¥ = ${fmtNum(p.rate, 2)} Ar` : 'Ariary'}</strong></div>}
        </div>
        {p.link && <a className="small" href={p.link} target="_blank" rel="noreferrer">Ouvrir le lien de la commande</a>}
        {p.notes && <p className="small">{p.notes}</p>}
      </div>

      <div className="card card-flush">
        <div className="card-pad"><h2>Articles commandés</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Article</th><th className="t-num">Commandé</th><th className="t-num">Reçu</th>{showCost && <th className="t-num">Prix unitaire</th>}{showCost && <th className="t-num">Montant</th>}</tr></thead>
            <tbody>
              {[...groups.entries()].map(([pid, lines]) => {
                const prod = get<Product>('products', pid);
                return lines.map((l, i) => {
                  const v = get<Variant>('variants', l.variantId);
                  return (
                    <tr key={l.id}>
                      <td>{i === 0 ? <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Thumb src={prod?.photo} size={36} /><div><strong>{prod?.name ?? '?'}</strong><div className="small muted">{prod?.code} · {variantLabel(v)}</div></div></div> : <span style={{ paddingLeft: 46 }}>{variantLabel(v)}</span>}</td>
                      <td className="t-num num">{l.qtyOrdered}</td>
                      <td className={`t-num num ${(l.qtyReceived || 0) < l.qtyOrdered && ['received', 'partial'].includes(p.status) ? 'neg' : ''}`}>{l.qtyReceived || 0}</td>
                      {showCost && <td className="t-num">{money(l.unitPrice, p.currency)}</td>}
                      {showCost && <td className="t-num">{money(lineTotal(l), p.currency)}</td>}
                    </tr>
                  );
                });
              })}
            </tbody>
            {showCost && (
              <tfoot>
                <tr><td colSpan={4}>Marchandises</td><td className="t-num">{money(purchaseGoods(p), p.currency)}</td></tr>
                {p.chinaFees ? <tr><td colSpan={4}>Frais de livraison en Chine</td><td className="t-num">+ {money(p.chinaFees, p.currency)}</td></tr> : null}
                {p.discount ? <tr><td colSpan={4}>Remise</td><td className="t-num">− {money(p.discount, p.currency)}</td></tr> : null}
                <tr className="t-total"><td colSpan={4}>Total fournisseur</td><td className="t-num">{money(total, p.currency)}{p.currency === 'RMB' ? <div className="small muted">≈ {fmtAr(purchaseTotalAr(p))}</div> : null}</td></tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showCost && (
        <div className="card stack">
          <div className="row-between">
            <div><h2>Paiements au fournisseur</h2><p className="small muted">Payé {money(paid, p.currency)} sur {money(total, p.currency)} · reste <strong>{money(Math.max(0, total - paid), p.currency)}</strong></p></div>
            {can('purchases.manage') && <Button variant="ghost" icon="plus" onClick={() => setPaying(true)}>Ajouter un paiement</Button>}
          </div>
          {(p.payments || []).length > 0 && (
            <ul className="list">
              {p.payments.map((x) => (
                <li key={x.id} className="list-item" style={{ padding: '10px 0' }}>
                  <div className="list-item-main"><strong className="num">{money(x.amount, x.currency)}</strong><p className="small muted">{fmtDate(x.date)} · {x.method}{x.note ? ` · ${x.note}` : ''}</p></div>
                  {can('purchases.manage') && <IconButton icon="trash" label="Supprimer le paiement" onClick={() => setDelPay(x)} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {recs.length > 0 && (
        <div className="card stack-s">
          <h2>Réceptions</h2>
          {recs.map((r: any) => <a key={r.id} href={`#/receptions/${r.id}`} className="small">{r.number} du {fmtDate(r.date)} — {r.items.filter((i: any) => i.purchaseId === p.id).reduce((s: number, i: any) => s + i.qty, 0)} pièce(s)</a>)}
        </div>
      )}

      {can('purchases.manage') && p.status === 'ordered' && !recs.length && <div className="row"><Button variant="quiet" icon="trash" onClick={() => setDel(true)}>Supprimer la commande</Button></div>}

      {editing && <PurchaseForm purchase={p} onClose={() => setEditing(false)} />}
      {voiding && <Confirm title={`Annuler ${p.number}`} danger confirmLabel="Annuler la commande" onClose={() => setVoiding(false)}
        message={<div className="stack-s"><p>Commande déjà reçue : ses réceptions sont annulées et les pièces reçues sont <strong>retirées exactement du stock</strong>. Les paiements au fournisseur restent (supprimez-les à part si besoin). Tout reste dans l’historique.</p><TextField label="Raison" value={voidWhy} onChange={setVoidWhy} required /></div>}
        onConfirm={async () => { if (!voidWhy.trim()) throw new Error('Indiquez la raison.'); await voidPurchase(p, voidWhy.trim()); toast('Commande annulée : stock corrigé'); }} />}
      {paying && <PaymentModal purchase={p} onClose={() => setPaying(false)} />}
      {cancel && <Confirm title="Annuler la commande" danger confirmLabel="Annuler la commande" message={<p>Les pièces ne seront plus comptées « en arrivage ».</p>} onClose={() => setCancel(false)} onConfirm={() => setStatus('cancelled')} />}
      {close && <Confirm title="Clôturer la commande" confirmLabel="Clôturer" message={<p>Les pièces non reçues ne seront plus attendues. Elles restent visibles comme manquantes.</p>} onClose={() => setClose(false)} onConfirm={() => setStatus('received')} />}
      {delPay && <Confirm title="Supprimer ce paiement ?" danger confirmLabel="Supprimer le paiement" message={<p>Paiement de {money(delPay.amount, delPay.currency)} du {fmtDate(delPay.date)} : il sera retiré de la commande {p.number}{(delPay as any).moveId ? ' et de la trésorerie (le solde du compte remonte)' : ''}.</p>}
        onClose={() => setDelPay(null)} onConfirm={async () => { if ((delPay as any).moveId) await remove('cashMoves', (delPay as any).moveId); await save('purchases', { id: p.id, payments: p.payments.filter((y) => y.id !== delPay.id) }); await audit('Paiement fournisseur supprimé', `${p.number} : ${money(delPay.amount, delPay.currency)}`, 'purchases', p.id); }} />}
      {del && <Confirm title="Supprimer la commande" danger confirmLabel="Supprimer" message={<p>La commande {p.number} sera supprimée.{(p.payments || []).length ? ' Ses paiements seront aussi retirés de la trésorerie.' : ''}</p>} onClose={() => setDel(false)}
        onConfirm={async () => { for (const x of p.payments || []) if ((x as any).moveId) await remove('cashMoves', (x as any).moveId); await remove('purchases', p.id); await audit('Commande Chine supprimée', p.number, 'purchases', p.id); navigate('/achats'); }} />}
    </>
  );
}

function PaymentModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const rest = Math.max(0, purchaseTotal(purchase) - purchasePaid(purchase));
  const [amount, setAmount] = useState(rest ? String(Math.round(rest * 100) / 100) : '');
  const [currency, setCurrency] = useState<'RMB' | 'MGA'>(purchase.currency);
  const [date, setDate] = useState(todayYmd());
  const [method, setMethod] = useState('Alipay / agent');
  const [note, setNote] = useState('');
  const [account, setAccount] = useState<AccountId | ''>('');
  const [ar, setAr] = useState('');
  const arAuto = currency === 'MGA' ? parseNum(amount) || 0 : Math.round((parseNum(amount) || 0) * (purchase.rate || 0));
  return (
    <Modal title="Paiement au fournisseur" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!parseNum(amount)} onClick={async () => {
        const pay: any = { id: newId(), date, amount: parseNum(amount)!, currency, method, note: note.trim() || undefined };
        if (account) {
          const m = await addMove({ at: atFor(date), account, amount: -(parseNum(ar) || arAuto), type: 'purchase', label: `Paiement ${purchase.number}`, note: pay.note, refType: 'purchases', refId: purchase.id });
          pay.moveId = m.id; pay.ar = parseNum(ar) || arAuto;
        }
        await save('purchases', { id: purchase.id, payments: [...(purchase.payments || []), pay] });
        await audit('Paiement fournisseur', `${purchase.number} : ${money(pay.amount, currency)} (${method})`, 'purchases', purchase.id);
        toast('Paiement enregistré'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Montant" required value={amount} onChange={setAmount} inputMode="decimal" />
          <SelectField label="Devise" value={currency} onChange={(v) => setCurrency(v as any)} options={[{ value: 'RMB', label: 'RMB (¥)' }, { value: 'MGA', label: 'Ariary' }]} />
          <TextField label="Date" type="date" value={date} onChange={setDate} />
          <SelectField label="Moyen" value={method} onChange={setMethod} options={['Alipay / agent', 'Virement bancaire', 'Espèces', 'MVola', 'Orange Money', 'Airtel Money', 'Autre'].map((m) => ({ value: m, label: m }))} />
        </div>
        <TextField label="Note (facultatif)" value={note} onChange={setNote} />
        <div className="grid-2">
          <SelectField label="Sorti de la trésorerie" value={account} onChange={(v) => setAccount(v as AccountId | '')} options={[{ value: '', label: 'Non (payé hors caisse, ex. par un agent)' }, ...ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))]} />
          {account && <TextField label="Montant sorti en Ariary" value={ar} onChange={setAr} inputMode="numeric" placeholder={String(arAuto)} hint={currency === 'RMB' ? `Au taux de la commande : ${arAuto.toLocaleString('fr-FR')} Ar` : undefined} />}
        </div>
      </div>
    </Modal>
  );
}

export function PurchaseForm({ purchase, onClose, onSaved }: { purchase?: Purchase; onClose: () => void; onSaved?: (p: Purchase) => void }) {
  const suppliers = useTable<Supplier>('suppliers');
  useCatalog();
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? '');
  const [newSupplier, setNewSupplier] = useState('');
  const [date, setDate] = useState(purchase?.date ?? todayYmd());
  const [orderRef, setOrderRef] = useState(purchase?.orderRef ?? '');
  const [trackingNo, setTrackingNo] = useState(purchase?.trackingNo ?? '');
  const [link, setLink] = useState(purchase?.link ?? '');
  const [forwarder, setForwarder] = useState(purchase?.forwarder ?? '');
  const [currency, setCurrency] = useState<'RMB' | 'MGA'>(purchase?.currency ?? 'RMB');
  const [rate, setRate] = useState(String(purchase?.rate ?? lastRate('rmb') ?? ''));
  const [chinaFees, setChinaFees] = useState(purchase?.chinaFees ? String(purchase.chinaFees) : '');
  const [discount, setDiscount] = useState(purchase?.discount ? String(purchase.discount) : '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [lines, setLines] = useState<PurchaseLine[]>(purchase?.lines ?? []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = { lines, chinaFees: parseNum(chinaFees) || 0, discount: parseNum(discount) || 0, currency, rate: parseNum(rate) || 0 } as Purchase;

  async function submit() {
    setError(null);
    if (!lines.length) return setError('Ajoutez au moins un article.');
    if (currency === 'RMB' && !parseNum(rate)) return setError('Indiquez le taux du RMB (combien d’Ariary pour 1 ¥).');
    if (lines.some((l) => l.qtyOrdered <= 0)) return setError('Chaque ligne doit avoir une quantité.');
    setBusy(true);
    try {
      let sup = supplierId;
      if (supplierId === '__new') {
        if (!newSupplier.trim()) { setBusy(false); return setError('Nom du nouveau fournisseur ?'); }
        const [s] = await save('suppliers', { name: newSupplier.trim() });
        sup = s.id;
      }
      const data = {
        supplierId: sup || undefined, date, orderRef: orderRef.trim() || undefined, trackingNo: trackingNo.trim() || undefined, link: link.trim() || undefined,
        forwarder: forwarder.trim() || undefined, currency, rate: currency === 'RMB' ? parseNum(rate)! : 1, chinaFees: parseNum(chinaFees) || 0, discount: parseNum(discount) || 0,
        notes: notes.trim() || undefined, lines,
      };
      if (purchase) {
        await save('purchases', { id: purchase.id, ...data });
        await audit('Commande Chine modifiée', purchase.number, 'purchases', purchase.id);
        toast('Commande enregistrée'); onClose();
      } else {
        const number = nextNumber('CMD', 'purchases');
        const [p] = await save('purchases', { ...data, number, status: 'ordered', statusDates: { ordered: date }, payments: [] });
        await audit('Commande Chine créée', `${number} — ${purchaseQty(p as Purchase)} pièces`, 'purchases', p.id);
        toast(`Commande ${number} créée`); onClose(); onSaved?.(p as Purchase);
      }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const grouped = new Map<string, PurchaseLine[]>();
  for (const l of lines) { const pid = get<Variant>('variants', l.variantId)?.productId || '?'; if (!grouped.has(pid)) grouped.set(pid, []); grouped.get(pid)!.push(l); }
  const setLine = (id: string, patch: Partial<PurchaseLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <Modal title={purchase ? `Modifier ${purchase.number}` : 'Nouvelle commande Chine'} onClose={onClose} wide
      footer={<><span className="muted small" style={{ marginRight: 'auto' }}>{fmtNum(purchaseQty(draft))} pièces · {money(purchaseTotal(draft), currency)}{currency === 'RMB' && draft.rate ? ` ≈ ${fmtAr(purchaseTotalAr(draft))}` : ''}</span><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{purchase ? 'Enregistrer' : 'Créer la commande'}</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <SelectField label="Fournisseur" value={supplierId} onChange={setSupplierId} options={[{ value: '', label: 'Non indiqué' }, ...suppliers.map((s) => ({ value: s.id, label: s.name })), { value: '__new', label: '+ Nouveau fournisseur…' }]} />
          {supplierId === '__new' ? <TextField label="Nom du fournisseur" required value={newSupplier} onChange={setNewSupplier} placeholder="Ex. shop566869krq2495 (1688)" /> : <TextField label="Date de commande" type="date" value={date} onChange={setDate} />}
          {supplierId === '__new' && <TextField label="Date de commande" type="date" value={date} onChange={setDate} />}
          <TextField label="N° de commande 1688" value={orderRef} onChange={setOrderRef} inputMode="numeric" />
          <TextField label="N° de suivi" value={trackingNo} onChange={setTrackingNo} />
          <TextField label="Transitaire" value={forwarder} onChange={setForwarder} />
          <TextField label="Lien de la commande" value={link} onChange={setLink} inputMode="url" autoCapitalize="none" />
        </div>
        <div className="card stack" style={{ background: 'var(--surface-2)' }}>
          <div className="grid-2">
            <SelectField label="Devise des prix" value={currency} onChange={(v) => setCurrency(v as any)} options={[{ value: 'RMB', label: 'RMB (yuan ¥)' }, { value: 'MGA', label: 'Ariary' }]} />
            {currency === 'RMB' && <TextField label="Taux : 1 ¥ = … Ar" required value={rate} onChange={setRate} inputMode="decimal" hint="Modifiable à tout moment." />}
            <TextField label={`Frais de livraison en Chine (${currency === 'RMB' ? '¥' : 'Ar'})`} value={chinaFees} onChange={setChinaFees} inputMode="decimal" hint="Répartis sur chaque pièce." />
            <TextField label={`Remise (${currency === 'RMB' ? '¥' : 'Ar'})`} value={discount} onChange={setDiscount} inputMode="decimal" />
          </div>
        </div>

        <div className="row-between"><h3>Articles</h3><Button variant="ghost" icon="plus" onClick={() => setPicking(true)}>Ajouter un article</Button></div>
        {lines.length === 0 ? <Empty icon="store" title="Aucun article dans la commande" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Article</th><th style={{ width: 110 }}>Quantité</th><th style={{ width: 130 }}>Prix unitaire ({currency === 'RMB' ? '¥' : 'Ar'})</th><th className="t-num">Montant</th><th></th></tr></thead>
              <tbody>
                {[...grouped.entries()].map(([pid, ls]) => ls.map((l, i) => {
                  const prod = get<Product>('products', pid); const v = get<Variant>('variants', l.variantId);
                  return (
                    <tr key={l.id}>
                      <td>{i === 0 && <strong>{prod?.code} — {prod?.name}<br /></strong>}<span className="small">{variantLabel(v)} · <span className="muted">en stock : {stockOf(l.variantId)}</span></span></td>
                      <td><input className="cell-input" inputMode="numeric" aria-label="Quantité" value={l.qtyOrdered || ''} onChange={(e) => setLine(l.id, { qtyOrdered: parseNum(e.target.value) || 0 })} /></td>
                      <td><input className="cell-input" inputMode="decimal" aria-label="Prix unitaire" value={l.unitPrice || ''} onChange={(e) => setLine(l.id, { unitPrice: parseNum(e.target.value) || 0 })} /></td>
                      <td className="t-num">{money(lineTotal(l), currency)}</td>
                      <td className="t-actions"><IconButton icon="x" label="Retirer" onClick={() => setLines(lines.filter((x) => x.id !== l.id))} /></td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
        <TextField label="Notes (facultatif)" value={notes} onChange={setNotes} />
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
      {picking && <LinePicker currency={currency} onClose={() => setPicking(false)} onAdd={(newLines) => {
        const merged = [...lines];
        for (const nl of newLines) {
          const ex = merged.find((l) => l.variantId === nl.variantId);
          if (ex) { ex.qtyOrdered += nl.qtyOrdered; ex.unitPrice = nl.unitPrice || ex.unitPrice; } else merged.push(nl);
        }
        setLines(merged);
      }} />}
    </Modal>
  );
}

/** Choisir un article (ou en créer un) puis saisir les quantités par variante. */
function LinePicker({ currency, onClose, onAdd }: { currency: 'RMB' | 'MGA'; onClose: () => void; onAdd: (l: PurchaseLine[]) => void }) {
  const { products } = useCatalog();
  const [q, setQ] = useState('');
  const [prod, setProd] = useState<Product | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const n = q.trim().toLowerCase();
  const found = searchItems(products.filter((p) => p.active !== false && p.kind !== 'lot'), productText, n, true).list.slice(0, 30);
  const variants = prod ? productVariants(prod.id) : [];
  const chosen = variants.filter((v) => parseNum(qty[v.id] ?? '')! > 0);
  return (
    <Modal title={prod ? `${prod.code} — quantités` : 'Ajouter un article'} onClose={onClose} wide
      footer={prod ? <><Button variant="ghost" onClick={() => setProd(null)}>Autre article</Button><Button disabled={!chosen.length} onClick={() => {
        onAdd(chosen.map((v) => ({ id: newId(), variantId: v.id, qtyOrdered: parseNum(qty[v.id])!, qtyReceived: 0, unitPrice: parseNum(price) || 0 })));
        onClose();
      }}>Ajouter {chosen.reduce((s, v) => s + parseNum(qty[v.id])!, 0) || ''} pièce(s)</Button></> : undefined}>
      {!prod ? (
        <div className="stack">
          <div className="row">
            <div className="field" style={{ flex: 1 }}><input autoFocus aria-label="Rechercher un article" placeholder="Rechercher un code ou un nom" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Button variant="ghost" icon="plus" onClick={() => setCreating(true)}>Nouvel article</Button>
          </div>
          <ul className="list card" style={{ padding: 0 }}>
            {found.map((p) => (
              <li key={p.id}><button className="list-item list-link" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, font: 'inherit', color: 'inherit' }} onClick={() => setProd(p)}>
                <Thumb src={p.photo} size={40} /><div className="list-item-main"><span className="list-item-title">{p.code} — {p.name}</span><p className="small muted">{categoryPath(p.categoryId)} · {productVariants(p.id).length} variante(s)</p></div><Icon name="chevronRight" />
              </button></li>
            ))}
            {!found.length && <Empty icon="search" title="Aucun article trouvé"><Button onClick={() => setCreating(true)}>Créer « {q || 'un nouvel article'} »</Button></Empty>}
          </ul>
        </div>
      ) : (
        <div className="stack">
          <TextField label={`Prix unitaire (${currency === 'RMB' ? '¥' : 'Ar'})`} value={price} onChange={setPrice} inputMode="decimal" autoFocus hint="Le même pour toutes les variantes. Modifiable ensuite ligne par ligne." />
          <div className="variant-grid">
            {variants.map((v) => (
              <label key={v.id} className="variant-cell">
                <span className="small"><strong>{variantLabel(v)}</strong> · <span className="muted">en stock : {stockOf(v.id)}</span></span>
                <input className="cell-input" inputMode="numeric" placeholder="0" value={qty[v.id] ?? ''} onChange={(e) => setQty({ ...qty, [v.id]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
      )}
      {creating && <ProductForm onClose={() => setCreating(false)} onSaved={(p) => { setProd(p); setCreating(false); }} />}
    </Modal>
  );
}

function SuppliersPage() {
  const can = useCan();
  const suppliers = useTable<Supplier>('suppliers');
  const purchases = useTable<Purchase>('purchases');
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);
  return (
    <>
      <div className="row"><Button variant="quiet" icon="chevronRight" className="back-btn" onClick={() => navigate('/achats')}>Achats Chine</Button></div>
      <PageHead title="Fournisseurs" actions={can('purchases.manage') && <Button icon="plus" onClick={() => setEdit('new')}>Ajouter un fournisseur</Button>} />
      <div className="card card-flush">
        {suppliers.length === 0 ? <Empty icon="users" title="Aucun fournisseur" /> : (
          <ul className="list">
            {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
              const ps = purchases.filter((p) => p.supplierId === s.id && p.status !== 'cancelled');
              const unpaid = ps.reduce((t, p) => t + Math.max(0, toAr(purchaseTotal(p) - purchasePaid(p), p.currency, p.rate)), 0);
              return (
                <li key={s.id} className="list-item">
                  <span className="avatar">{s.name.charAt(0).toUpperCase()}</span>
                  <div className="list-item-main">
                    <span className="list-item-title">{s.name}</span>
                    <p className="small muted">{[s.contact, s.city, s.shop].filter(Boolean).join(' · ') || '—'}</p>
                    <p className="small muted">{ps.length} commande(s){can('costs.view') && unpaid ? ` · reste à payer ${fmtAr(unpaid)}` : ''}</p>
                  </div>
                  {can('purchases.manage') && <IconButton icon="edit" label="Modifier" onClick={() => setEdit(s)} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {edit && <SupplierForm supplier={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [shop, setShop] = useState(supplier?.shop ?? '');
  const [contact, setContact] = useState(supplier?.contact ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  return (
    <Modal title={supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!name.trim()} onClick={async () => {
        await save('suppliers', { id: supplier?.id, name: name.trim(), shop: shop.trim() || undefined, contact: contact.trim() || undefined, city: city.trim() || undefined, notes: notes.trim() || undefined });
        toast('Fournisseur enregistré'); onClose();
      }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom" required value={name} onChange={setName} autoFocus />
        <TextField label="Boutique / lien 1688" value={shop} onChange={setShop} autoCapitalize="none" />
        <TextField label="Contact (WeChat, téléphone)" value={contact} onChange={setContact} />
        <TextField label="Ville" value={city} onChange={setCity} />
        <TextField label="Notes" value={notes} onChange={setNotes} />
      </div>
    </Modal>
  );
}
