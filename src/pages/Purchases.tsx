// Achats en Chine : commandes fournisseurs, suivi, paiements, fournisseurs.
import { useMemo, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, newId, remove, save, useTable } from '../lib/db';
import {
  categoryPath, fmtAr, fmtNum, nextNumber, parseNum, productVariants, PURCHASE_STATUS, todayYmd, useCatalog, variantLabel,
  type Category, type Product, type Purchase, type PurchaseLine, type PurchaseStatus, type Variant, matchQuery, productText, stockOf, searchItems } from '../lib/catalog';
import { lastRate, lineTotal, purchaseGoods, purchasePaid, purchaseQty, purchaseReceivedQty, purchaseTotal, purchaseTotalAr, toAr, type Supplier } from '../lib/purchases';
import { PurchasingTabs } from './ImportExport';
import { Badge, Button, Confirm, Empty, IconButton, Modal, PageHead, SelectField, TextField, fmtDate, navigate, toast, useRoute, useKeep } from '../ui/kit';
import { ListDates, applyDates, defaultPeriod, type ListOrder, type Period } from '../ui/period';
import { Icon } from '../ui/icons';
import { voidPurchase } from '../lib/corrections';
import { ACCOUNTS, ACCOUNT_IDS, addMove, atFor, type AccountId } from '../lib/money';
import { ProductForm, Thumb } from './Products';
import { productPage } from '../lib/scope';
import { activeAttrs, activeValues, articleId, articleParts, combinations, findArticle, saveArticles } from '../lib/attrs';

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
  const [tab, setTab] = useKeep<'open' | 'received' | 'all'>('purch.tab', 'open');
  const [q, setQ] = useKeep('purch.q', '');
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useKeep<ListOrder>('purch.order', 'new');
  const [period, setPeriod] = useKeep<Period>('purch.period', defaultPeriod('all'));
  const list = useMemo(() => {
  const n = q.trim().toLowerCase();
    return applyDates(purchases
      .filter((p) => tab === 'all' || (tab === 'open' ? !['received', 'cancelled'].includes(p.status) : p.status === 'received'))
      .filter((p) => !n || `${p.number} ${p.orderRef} ${p.trackingNo} ${get<Supplier>('suppliers', p.supplierId || '')?.name} ${p.notes}`.toLowerCase().includes(n))
      .sort((a, b) => b.number.localeCompare(a.number)), (p) => p.date || p.createdAt, period, order);
  }, [purchases, tab, q, order, period]);
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
        </div>
        <ListDates period={period} onPeriod={setPeriod} order={order} onOrder={setOrder} what="Date de commande" />
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
            {!['received', 'cancelled', 'partial'].includes(p.status) && <Button variant="danger" icon="x" onClick={() => setCancel(true)}>Annuler la commande</Button>}
            {['received', 'partial'].includes(p.status) && can('records.correct') && <Button variant="danger" icon="x" onClick={() => setVoiding(true)}>Annuler la commande (erreur)</Button>}
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

      {can('purchases.manage') && p.status === 'ordered' && !recs.length && <div className="row"><Button variant="danger" icon="trash" onClick={() => setDel(true)}>Supprimer la commande</Button></div>}

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

/**
 * Ajouter des articles à la commande, en un seul écran :
 * - « Rechercher » : quantité saisie directement sur la ligne (articles à une seule version) ;
 * - « Par modèle / taille » : on coche les valeurs de la page (modèle, taille, couleur…), une ligne par combinaison ;
 *   les combinaisons qui n'existent pas encore sont créées en même temps (plus besoin de créer l'article avant) ;
 * - « Nouveaux articles » : les articles créés récemment, pour les mettre dans la commande.
 */
type PickTab = 'search' | 'grid' | 'new';
const NEW_DAYS = [7, 30, 90];
function LinePicker({ currency, onClose, onAdd }: { currency: 'RMB' | 'MGA'; onClose: () => void; onAdd: (l: PurchaseLine[]) => void }) {
  const { products } = useCatalog();
  const cats = useTable<Category>('categories');
  const keep = (k: string, d: string) => { try { return localStorage.getItem('tsena.picker.' + k) ?? d; } catch { return d; } };
  const remember = (k: string, v: string) => { try { localStorage.setItem('tsena.picker.' + k, v); } catch { /* rien */ } };
  const [tab, setTabRaw] = useState<PickTab>(keep('tab', 'search') as PickTab);
  const setTab = (t: PickTab) => { setTabRaw(t); remember('tab', t); };
  const [q, setQ] = useState('');
  const [prod, setProd] = useState<Product | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});       // id variante → quantité
  const [cost, setCost] = useState<Record<string, string>>({});     // id variante → prix d'achat de la ligne
  const [pageF, setPageFRaw] = useState(keep('page', ''));
  const setPageF = (v: string) => { setPageFRaw(v); remember('page', v); };
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [days, setDaysRaw] = useState(Number(keep('days', '30')) || 30);
  const setDays = (d: number) => { setDaysRaw(d); remember('days', String(d)); };
  // Par modèle / taille
  const pages = cats.filter((c) => !c.removed && activeAttrs(c).length > 0);
  const [catId, setCatIdRaw] = useState(() => { const k = keep('cat', ''); return pages.some((c) => c.id === k) ? k : pages[0]?.id ?? ''; });
  const setCatId = (v: string) => { setCatIdRaw(v); setPicked({}); remember('cat', v); };
  const cat = cats.find((c) => c.id === catId);
  const attrs = activeAttrs(cat);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [gridQty, setGridQty] = useState<Record<string, string>>({});   // id article (fixe) → quantité
  const [gridPv, setGridPv] = useState<Record<string, string>>({});     // id article → PV détail (articles à créer)
  const [gridCost, setGridCost] = useState<Record<string, string>>({}); // id article → prix d'achat
  const [allCost, setAllCost] = useState('');
  const [allQty, setAllQty] = useState('');
  const [allPv, setAllPv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CUR = currency === 'RMB' ? '¥' : 'Ar';
  const n = q.trim().toLowerCase();
  const roots = cats.filter((c) => !c.parentId && !c.removed).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr'));
  const pool = products.filter((p) => p.active !== false && p.kind !== 'lot' && (!pageF || productPage(p.id) === pageF));
  const since = Date.now() - days * 86400e3;
  const fresh = pool.filter((p) => p.createdAt && Date.parse(p.createdAt) >= since).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const list = tab === 'new' ? (n ? fresh.filter((p) => matchQuery(productText(p), n)) : fresh).slice(0, 200) : (n ? searchItems(pool, productText, n, true).list : pageF ? [...pool].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true })) : searchItems(pool, productText, n, true).list).slice(0, pageF ? 400 : 40);
  const toggle = (aid: string, vid: string) => { const cur = picked[aid] ?? []; setPicked({ ...picked, [aid]: cur.includes(vid) ? cur.filter((x) => x !== vid) : [...cur, vid] }); };
  const combos = cat ? combinations(cat, picked).map((sel) => {
    const ex = findArticle(cat.id, sel);
    const id = ex?.id ?? articleId(cat.id, sel);
    return { sel, id, ex, parts: articleParts(cat, sel), variant: ex ? productVariants(ex.id)[0] : undefined };
  }) : [];
  const missingAttr = attrs.filter((a) => a.required !== false && !(picked[a.id] ?? []).length);

  // Tout ce qui sera ajouté : quantités saisies (recherche / nouveaux / variantes) + lignes du tableau par modèle.
  const direct = Object.entries(qty).map(([vid, v]) => ({ vid, n: parseNum(v) || 0 })).filter((x) => x.n > 0 && get<Variant>('variants', x.vid));
  const gridRows = combos.map((c) => ({ ...c, n: parseNum(gridQty[c.id] ?? '') || 0, pv: parseNum(gridPv[c.id] ?? ''), cost: parseNum(gridCost[c.id] ?? '') })).filter((c) => c.n > 0);
  const toCreate = gridRows.filter((c) => !c.ex);
  const noPv = toCreate.filter((c) => !c.pv);
  const pieces = direct.reduce((t, x) => t + x.n, 0) + gridRows.reduce((t, c) => t + c.n, 0);

  async function add() {
    setError(null);
    if (noPv.length) return setError(`Prix de vente détail à indiquer pour ${noPv.length} nouvel(s) article(s) (case « PV détail » ou « Pour toutes »).`);
    setBusy(true);
    try {
      if (toCreate.length) await saveArticles(cat!, toCreate.map((c) => ({ sel: c.sel, retail: c.pv, wholesale: c.pv })), 'Création (achat)');
      const unit = parseNum(price) || 0;
      const lines: PurchaseLine[] = direct.map((x) => ({ id: newId(), variantId: x.vid, qtyOrdered: x.n, qtyReceived: 0, unitPrice: parseNum(cost[x.vid] ?? '') ?? unit }));
      for (const c of gridRows) {
        const vid = c.variant?.id ?? productVariants(c.id)[0]?.id ?? `v_${c.id}`;
        lines.push({ id: newId(), variantId: vid, qtyOrdered: c.n, qtyReceived: 0, unitPrice: c.cost ?? unit });
      }
      onAdd(lines);
      if (toCreate.length) toast(`${toCreate.length} nouvel(s) article(s) créé(s) et ajouté(s) à la commande`);
      onClose();
    } catch (e: any) { setError(e?.message ?? String(e)); setBusy(false); }
  }

  const qtyInput = (v: Variant, label?: string) => (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input className="cell-input num-input" inputMode="numeric" placeholder="Qté" aria-label={`Quantité ${label ?? variantLabel(v)}`} value={qty[v.id] ?? ''}
        onChange={(e) => setQty({ ...qty, [v.id]: e.target.value })} onClick={(e) => e.stopPropagation()} style={{ width: 70 }} />
      <input className="cell-input num-input" inputMode="decimal" placeholder={price ? price : `Prix ${CUR}`} aria-label={`Prix d’achat ${label ?? variantLabel(v)}`} value={cost[v.id] ?? ''}
        onChange={(e) => setCost({ ...cost, [v.id]: e.target.value })} onClick={(e) => e.stopPropagation()} style={{ width: 90 }} />
    </span>
  );
  const productRow = (p: Product) => {
    const vs = productVariants(p.id);
    const one = vs.length === 1 ? vs[0] : undefined;
    const inCart = vs.reduce((t, v) => t + (parseNum(qty[v.id] ?? '') || 0), 0);
    return (
      <li key={p.id} className="list-item" style={{ gap: 10 }}>
        <Thumb src={p.photo} size={40} />
        <div className="list-item-main">
          <span className="list-item-title">{p.code} — {p.name}</span>
          <p className="small muted">{categoryPath(p.categoryId)}{one ? ` · en stock : ${stockOf(one.id)}` : ` · ${vs.length} variante(s)`}{tab === 'new' && p.createdAt ? ` · créé le ${fmtDate(p.createdAt)}` : ''}</p>
        </div>
        {one ? qtyInput(one, `${p.code} ${p.name}`) : <Button variant="ghost" onClick={() => setProd(p)}>{inCart ? `${inCart} pièce(s)` : 'Quantités'} ›</Button>}
      </li>
    );
  };
  const priceField = <TextField label={`Prix d’achat par défaut (${CUR})`} value={price} onChange={setPrice} inputMode="decimal" hint="Utilisé pour les lignes dont la case « Prix » est vide. Chaque ligne peut avoir son propre prix." />;

  return (
    <Modal title={prod ? `${prod.code} — quantités` : 'Ajouter des articles'} onClose={onClose} wide
      footer={prod ? <Button onClick={() => setProd(null)}>OK, retour à la liste</Button>
        : <><span className="muted small" style={{ marginRight: 'auto' }}>{pieces ? `${fmtNum(pieces)} pièce(s)${toCreate.length ? ` · ${toCreate.length} article(s) à créer` : ''}` : 'Saisissez les quantités'}</span>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button busy={busy} disabled={!pieces} onClick={add}>Ajouter {pieces ? `${fmtNum(pieces)} pièce(s)` : ''}</Button></>}>
      {prod ? (
        <div className="variant-grid">
          {productVariants(prod.id).map((v) => (
            <label key={v.id} className="variant-cell">
              <span className="small"><strong>{variantLabel(v)}</strong> · <span className="muted">en stock : {stockOf(v.id)}</span></span>
              {qtyInput(v)}
            </label>
          ))}
        </div>
      ) : (
        <div className="stack">
          <div className="segmented" role="group" aria-label="Façon d’ajouter" style={{ display: 'flex', flexWrap: 'wrap' }}>
            <button aria-pressed={tab === 'search'} onClick={() => setTab('search')}>Rechercher</button>
            <button aria-pressed={tab === 'grid'} onClick={() => setTab('grid')}>Par modèle / taille</button>
            <button aria-pressed={tab === 'new'} onClick={() => setTab('new')}>Nouveaux articles{fresh.length ? ` (${fresh.length})` : ''}</button>
          </div>
          {priceField}
          {tab !== 'grid' && (
            <>
              <div className="row">
                <SelectField label="Page" value={pageF} onChange={setPageF} options={[{ value: '', label: 'Toutes les pages' }, ...roots.map((c) => ({ value: c.id, label: c.name }))]} />
                <div className="field" style={{ flex: '1 1 240px', alignSelf: 'flex-end' }}><input autoFocus aria-label="Rechercher un article" placeholder={tab === 'new' ? 'Filtrer les nouveaux articles' : 'Rechercher un code ou un nom'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
                {tab === 'new' && <div className="segmented" role="group" aria-label="Créés depuis">{NEW_DAYS.map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} jours</button>)}</div>}
              </div>
              {tab === 'new' && <p className="small muted" style={{ margin: 0 }}>Articles créés ces {days} derniers jours, les plus récents en premier. Tapez la quantité sur chaque ligne.</p>}
              <ul className="list card" style={{ padding: 0 }}>
                {list.map(productRow)}
                {!list.length && <Empty icon="search" title={tab === 'new' ? `Aucun article créé ces ${days} derniers jours` : 'Aucun article trouvé'}>
                  <Button onClick={() => setTab('grid')}>Créer par modèle / taille</Button>
                </Empty>}
              </ul>
            </>
          )}
          {tab === 'grid' && (
            <>
              <SelectField label="Page" value={catId} onChange={setCatId} options={pages.length ? pages.map((c) => ({ value: c.id, label: categoryPath(c.id) })) : [{ value: '', label: 'Aucune page avec variantes' }]} />
              {!pages.length && <div className="notice"><Icon name="alert" /><span>Aucune page n’a de variantes (modèle, taille…). Définissez-les dans <a href="#/pages">Pages et variantes</a>, ou <button type="button" className="link-btn" onClick={() => setCreating(true)}>créez un article simple</button>.</span></div>}
              {attrs.map((a) => (
                <div key={a.id} className="stack-s">
                  <strong className="small">{a.name}{a.required === false ? ' (facultatif)' : ''}</strong>
                  <div className="row" style={{ gap: 6 }}>
                    {activeValues(a).map((v) => <button key={v.id} type="button" className="chip" aria-pressed={(picked[a.id] ?? []).includes(v.id)} title={v.label} onClick={() => toggle(a.id, v.id)}>{v.label === v.code ? v.label : <>{v.code}<span className="chip-sub"> · {v.label}</span></>}</button>)}
                    {activeValues(a).length > 1 && <button type="button" className="chip chip-quiet" onClick={() => setPicked({ ...picked, [a.id]: (picked[a.id] ?? []).length === activeValues(a).length ? [] : activeValues(a).map((v) => v.id) })}>{(picked[a.id] ?? []).length === activeValues(a).length ? 'Aucune' : 'Toutes'}</button>}
                    {!activeValues(a).length && <span className="small muted">Aucune valeur : ajoutez-en dans <a href="#/pages">Pages et variantes</a>.</span>}
                  </div>
                </div>
              ))}
              {cat && attrs.length > 0 && missingAttr.length > 0 && <p className="small muted" style={{ margin: 0 }}>Cochez : {missingAttr.map((a) => a.name).join(', ')}.</p>}
              {combos.length > 0 && (
                <>
                  <div className="row builder-all">
                    <input className="cell-input num-input" inputMode="numeric" placeholder="Quantité" aria-label="Quantité pour toutes" value={allQty} onChange={(e) => setAllQty(e.target.value)} />
                    <input className="cell-input num-input" inputMode="decimal" placeholder={`Prix d’achat ${CUR}`} aria-label="Prix d’achat pour toutes" value={allCost} onChange={(e) => setAllCost(e.target.value)} />
                    {combos.some((c) => !c.ex) && <input className="cell-input num-input" inputMode="numeric" placeholder="PV détail" aria-label="PV détail pour tous les nouveaux" value={allPv} onChange={(e) => setAllPv(e.target.value)} />}
                    <Button variant="ghost" onClick={() => {
                      if (allQty !== '') setGridQty({ ...gridQty, ...Object.fromEntries(combos.map((c) => [c.id, allQty])) });
                      if (allCost !== '') setGridCost({ ...gridCost, ...Object.fromEntries(combos.map((c) => [c.id, allCost])) });
                      if (allPv !== '') setGridPv({ ...gridPv, ...Object.fromEntries(combos.filter((c) => !c.ex).map((c) => [c.id, allPv])) });
                    }}>Pour toutes</Button>
                  </div>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Article</th><th className="t-num">En stock</th><th style={{ width: 90 }}>Quantité</th><th style={{ width: 110 }}>Prix d’achat ({CUR})</th><th style={{ width: 120 }}>PV détail (Ar)</th></tr></thead>
                    <tbody>{combos.map((c) => (
                      <tr key={c.id}>
                        <td><strong>{c.ex ? c.ex.name : c.parts.name}</strong> {!c.ex && <Badge tone="brand">nouveau</Badge>}<div className="small muted">{c.ex?.code ?? c.parts.code} · {c.parts.label}</div></td>
                        <td className="t-num">{c.variant ? stockOf(c.variant.id) : 0}</td>
                        <td><input className="cell-input num-input" inputMode="numeric" placeholder="0" aria-label={`Quantité ${c.parts.name}`} value={gridQty[c.id] ?? ''} onChange={(e) => setGridQty({ ...gridQty, [c.id]: e.target.value })} /></td>
                        <td><input className="cell-input num-input" inputMode="decimal" placeholder={price || ''} aria-label={`Prix d’achat ${c.parts.name}`} value={gridCost[c.id] ?? ''} onChange={(e) => setGridCost({ ...gridCost, [c.id]: e.target.value })} /></td>
                        <td>{c.ex ? <span className="small muted">{fmtAr(c.ex.priceRetail)}</span> : <input className="cell-input num-input" inputMode="numeric" aria-label={`PV détail ${c.parts.name}`} value={gridPv[c.id] ?? ''} onChange={(e) => setGridPv({ ...gridPv, [c.id]: e.target.value })} />}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <p className="small muted" style={{ margin: 0 }}>{combos.length} combinaison(s){combos.some((c) => !c.ex) ? ` · celles marquées « nouveau » seront créées automatiquement (photo, nom et prix modifiables ensuite dans Articles)` : ''}.</p>
                </>
              )}
            </>
          )}
          {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
        </div>
      )}
      {creating && <ProductForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); setTab('search'); setQ(p.code); }} />}
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
