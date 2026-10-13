// Livraisons → Retour livreur : le compte avec le livreur en un seul écran.
// Pour chaque colis : livré / refusé / choix ou en partie / le client vient en boutique ; frais de livraison
// modifiables (client qui paie moins) ; ce qui est déjà payé (MVola…) n'est pas demandé au livreur.
// Puis : prix des articles et frais de livraison séparés, et règlement des frais du livreur
// (retenus sur l'argent versé, payés à part, ou plus tard sur son compte).
import { useMemo, useState } from 'react';
import { useCan } from '../lib/auth';
import { get, save, useTable } from '../lib/db';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import {
  cancelDeliveryToShop, choiceQty, courierSplit, fmtPhone, hasPendingChoice, orderLabel, recordReturn, remaining, PAY_METHODS,
  type Courier, type Order, type Zone,
} from '../lib/orders';
import { ACCOUNTS, ACCOUNT_IDS, courierBalance, payDeferredFees, settleCourier, type AccountId, type CourierSettlement } from '../lib/money';
import { Help, Badge, Choice, Button, Confirm, Empty, SelectField, TextField, fmtDateTime, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ReturnModal } from './Orders';

type Decision = 'delivered' | 'refused';
type FeeMode = 'retenue' | 'apart' | 'plustard';

/** Ce que donnerait le retour d'un colis encore « en livraison », sans rien enregistrer. */
function simulate(o: Order, d: Decision, fee: number): Order {
  const lines = o.lines.map((l) => ({ ...l, qtyKept: d === 'delivered' && !l.isChoice ? l.qty : 0, qtyReturned: d === 'delivered' && !l.isChoice ? 0 : l.qty }));
  const sim = { ...o, status: d, lines, feeCharged: fee } as Order;
  const rest = remaining(sim);
  if (rest > 0) sim.payments = [...(o.payments || []), { id: 'sim', at: '', amount: rest, method: 'cash', receivedBy: 'courier', courierId: o.courierId }];
  return sim;
}

export function CourierReturn() {
  const can = useCan();
  const couriers = useTable<Courier>('couriers');
  useTable<Order>('orders'); useTable<Zone>('zones'); useTable<CourierSettlement>('courierSettlements');
  const withWork = couriers.filter((c) => courierBalance(c.id).pending.length || courierBalance(c.id).carry);
  const [cid, setCid] = useState('');
  const courier = couriers.find((c) => c.id === cid) ?? withWork[0];
  return (
    <>
      <div className="card stack-s">
        <Help>Le livreur revient avec ses colis et l’argent : indiquez pour chaque colis ce qui s’est passé, vérifiez les montants (articles et frais séparés), puis validez ce qu’il vous remet.</Help>
        {withWork.length === 0 ? <Empty icon="truck" title="Aucun livreur à recevoir">Les colis remis aux livreurs apparaîtront ici.</Empty> : (
          <Choice label="Livreur" value={courier?.id ?? ''} onChange={setCid} max={4} options={[...(courier ? [] : [{ value: '', label: '— Choisir le livreur —' }]), ...withWork.map((c) => ({ value: c.id, label: `${c.name} · ${courierBalance(c.id).pending.length} colis` }))]} />
        )}
      </div>
      {courier && <CourierSheet key={courier.id} courier={courier} canSettle={can('couriers.settle')} />}
    </>
  );
}

/** Paiement des frais différés dus au livreur. */
function PayOwedModal({ courier, amount, onClose }: { courier: Courier; amount: number; onClose: () => void }) {
  const [acc, setAcc] = useState<AccountId>('cash');
  const [val, setVal] = useState(String(amount));
  return (
    <Confirm title={`Payer les frais de ${courier.name}`} confirmLabel="Enregistrer le paiement" onClose={onClose}
      onConfirm={async () => { const v = parseNum(val) || 0; if (v <= 0) throw new Error('Montant à saisir.'); await payDeferredFees(courier, v, acc); await save('couriers', { id: courier.id, feeClaimAt: null as unknown as undefined }); toast(`${fmtAr(v)} payés à ${courier.name}`); }}
      message={<div className="stack-s"><p>La boutique doit <strong>{fmtAr(amount)}</strong> de frais de livraison à {courier.name}.</p>
        <div className="grid-2"><TextField label="Montant payé (Ar)" required value={val} onChange={setVal} inputMode="numeric" /><SelectField label="Payé depuis" value={acc} onChange={(v) => setAcc(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} /></div></div>} />
  );
}

function CourierSheet({ courier, canSettle }: { courier: Courier; canSettle: boolean }) {
  const b = courierBalance(courier.id);
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [fees, setFees] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [ret, setRet] = useState<Order | null>(null);
  const [toShop, setToShop] = useState<Order | null>(null);
  const [mode, setMode] = useState<FeeMode>('retenue');
  const [amount, setAmount] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountId>('cash');
  const [feeAccount, setFeeAccount] = useState<AccountId>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  const rows = useMemo(() => b.pending.map((o) => {
    const open = o.status === 'out';
    const blocked = open && hasPendingChoice(o);
    const d: Decision = dec[o.id] ?? 'delivered';
    const fee = open ? (fees[o.id] != null ? parseNum(fees[o.id]) ?? 0 : d === 'refused' ? 0 : o.deliveryFee || 0) : (o.feeCharged ?? o.deliveryFee ?? 0);
    const sim = open && !blocked ? simulate(o, d, fee) : o;
    const x = courierSplit(sim);
    const shopPays = (o.payments || []).filter((p) => p.receivedBy === 'shop');
    const prepaid = shopPays.reduce((s, p) => s + p.amount, 0);
    const paidHow = [...new Set(shopPays.map((p) => `${PAY_METHODS[p.method] ?? p.method}${p.ref ? ' réf. ' + p.ref : ''}`))].join(', ');
    const e = x.toCollect + x.feeKept;            // ce que le client a payé au livreur
    const c = e + prepaid;                        // total payé par le client
    return { o, open, blocked, d, fee, x, prepaid, paidHow, a: c - fee, c, e, on: !blocked && !off[o.id] };
  }), [b.pending, dec, fees, off]);

  const on = rows.filter((r) => r.on);
  const collect = on.reduce((t, r) => t + r.x.toCollect, 0);
  const feeKept = on.reduce((t, r) => t + r.x.feeKept, 0);
  const feeAll = on.reduce((t, r) => t + r.x.fee, 0);
  const feeOwed = on.reduce((t, r) => t + r.x.feeOwed, 0);
  const inHand = collect + feeKept;
  const handOver = b.carry + (mode === 'retenue' ? collect - feeOwed : inHand);
  const n = amount == null ? Math.max(0, handOver) : parseAr(amount) ?? 0;
  const payFees = mode === 'apart' ? feeAll : 0;
  const after = b.carry + collect - feeOwed - n + payFees; // après validation : + il doit encore ; − la boutique lui doit
  const blockedRows = rows.filter((r) => r.blocked);

  async function validate() {
    setBusy(true);
    try {
      for (const r of on) {
        if (!r.open) continue;
        const kept = Object.fromEntries(r.o.lines.map((l) => [l.id, r.d === 'delivered' && !l.isChoice ? l.qty : 0]));
        const rest = remaining({ ...r.o, status: r.d, lines: r.o.lines.map((l) => ({ ...l, qtyKept: kept[l.id] })), feeCharged: r.fee } as Order);
        await recordReturn(r.o, { kept, feeCharged: r.fee, collected: rest > 0 ? [{ amount: rest, method: 'cash' }] : [], note: r.d === 'refused' ? 'Refusée (retour livreur)' : undefined });
      }
      const label = mode === 'retenue' ? 'frais retenus par le livreur' : mode === 'apart' ? 'frais payés à part' : 'frais à payer plus tard (compte du livreur)';
      await settleCourier(courier, on.map((r) => r.o.id), n, account, [note.trim(), label].filter(Boolean).join(' · '));
      if (payFees > 0) await settleCourier(courier, [], -payFees, feeAccount, 'Frais de livraison payés au livreur');
      for (const r of on) if (r.fee > 0) await save('orders', { id: r.o.id, feeStatus: mode === 'retenue' ? 'kept' : mode === 'apart' ? 'paid' : 'deferred', ...(mode === 'apart' ? { feePaidAt: new Date().toISOString(), feePaidHow: ACCOUNTS[feeAccount] } : {}) });
      toast(`Retour de ${courier.name} enregistré`);
      setDec({}); setFees({}); setOff({}); setAmount(null); setNote('');
    } catch (e: any) { toast(e?.message ?? String(e), 'error'); }
    setBusy(false);
  }

  const expected = Math.max(0, handOver);
  const gap = n - expected;
  const feeChoice = mode === 'apart' ? `apart:${feeAccount}` : mode;
  const setFeeChoice = (v: string) => { if (v.startsWith('apart:')) { setMode('apart'); setFeeAccount(v.slice(6) as AccountId); } else setMode(v as FeeMode); setAmount(null); };
  const tot = { a: on.reduce((t, r) => t + r.a, 0), b: on.reduce((t, r) => t + r.fee, 0), c: on.reduce((t, r) => t + r.c, 0), d: on.reduce((t, r) => t + r.prepaid, 0), e: inHand };
  const [payOwed, setPayOwed] = useState<AccountId | null>(null);
  return (
    <>
      <div className="card stack-s">
        <div className="row-between">
          <div><h2>{courier.name}</h2><p className="small muted">{courier.phone ? fmtPhone(courier.phone) + ' · ' : ''}{b.pending.length} colis à régler{b.carry ? ` · reste des fois précédentes : ${b.carry > 0 ? `il doit ${fmtAr(b.carry)}` : `la boutique lui doit ${fmtAr(-b.carry)}`}` : ''}</p></div>
        </div>
        {b.carry < 0 && canSettle && (
          <div className="notice notice-warn" style={{ flexWrap: 'wrap', alignItems: 'center' }}><Icon name="alert" /><span style={{ flex: '1 1 220px' }}><strong>Frais différés à payer à {courier.name} : {fmtAr(-b.carry)}</strong>. À régler au plus vite (au plus tard à la clôture du soir).</span>
            <Button onClick={() => setPayOwed('cash')}>Payer maintenant</Button></div>
        )}
        {blockedRows.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span>{blockedRows.length} colis avec un <strong>choix à préciser</strong> : touchez « Préciser le choix » pour indiquer ce que le client a gardé.</span></div>}
        {rows.length === 0 && <p className="small muted">Aucun colis à régler.</p>}
      </div>
      {rows.map((r) => (
        <div key={r.o.id} className={`card stack-s parcel ${r.on ? 'is-checked' : 'is-off'}`}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <label className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <input type="checkbox" className="perm-check" checked={r.on} disabled={r.blocked} onChange={(e) => setOff({ ...off, [r.o.id]: !e.target.checked })} aria-label={`Régler ${r.o.number}`} />
              <span><a href={`#/commandes/${r.o.id}`}><strong>{r.o.number}</strong></a> {orderLabel(r.o)}
                <span className="small muted" style={{ display: 'block' }}>{get<Zone>('zones', r.o.zoneId || '')?.name}{r.o.place ? ` — ${r.o.place}` : ''} · parti le {fmtDateTime(r.o.dispatchedAt)}</span></span>
            </label>
            {r.open ? (r.blocked ? <Button onClick={() => setRet(r.o)}>Préciser le choix ({choiceQty(r.o)})</Button> : (
              <div className="stack-s" style={{ alignItems: 'flex-end' }}>
                <div className="segmented small-seg" role="group" aria-label={`Résultat ${r.o.number}`}>
                  <button type="button" aria-pressed={r.d === 'delivered'} onClick={() => setDec({ ...dec, [r.o.id]: 'delivered' })}>Livrée</button>
                  <button type="button" aria-pressed={r.d === 'refused'} onClick={() => setDec({ ...dec, [r.o.id]: 'refused' })}>Refusée</button>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => setRet(r.o)}>En partie / choix…</button>
                  <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => setToShop(r.o)}>Client en boutique…</button>
                </div>
              </div>
            )) : <Badge tone={r.o.status === 'refused' ? 'danger' : 'ok'}>{r.o.status === 'refused' ? 'Refusée' : r.o.status === 'partial' ? 'Livrée en partie' : 'Livrée'}</Badge>}
          </div>
          {!r.blocked && <div className="money-lines">
            <div><span>a. Articles (après le choix du client)</span><strong className="num">{fmtAr(r.a)}</strong></div>
            <div><span>b. Frais de livraison</span>{r.open ? <input className="cell-input num-input" inputMode="numeric" aria-label={`Frais ${r.o.number}`} value={fees[r.o.id] ?? String(r.fee)} onChange={(e) => setFees({ ...fees, [r.o.id]: e.target.value })} /> : <strong className="num">{fmtAr(r.fee)}</strong>}</div>
            {r.open && r.fee !== (r.o.deliveryFee || 0) && <div className="small muted"><span>prévu</span><span>{fmtAr(r.o.deliveryFee)}</span></div>}
            <div className="ml-total"><span>c. À payer par le client (a + b)</span><strong className="num">{fmtAr(r.c)}</strong></div>
            <div><span>d. Déjà payé à la boutique{r.paidHow ? ` (${r.paidHow})` : ''}</span><strong className="num">{r.prepaid ? '− ' + fmtAr(r.prepaid) : '—'}</strong></div>
            <div className="ml-strong"><span>e. Le livreur doit verser (frais compris)</span><strong className="num">{fmtAr(r.e)}</strong></div>
          </div>}
        </div>
      ))}

      {on.length > 0 && (
        <div className="card stack">
          <h2>Compte avec {courier.name} ({on.length} colis)</h2>
          <div className="money-lines">
            <div><span>a. Articles</span><strong className="num">{fmtAr(tot.a)}</strong></div>
            <div><span>b. Frais de livraison</span><strong className="num">{fmtAr(tot.b)}</strong></div>
            <div className="ml-total"><span>c. Payé par les clients (a + b)</span><strong className="num">{fmtAr(tot.c)}</strong></div>
            <div><span>d. Déjà payé directement à la boutique</span><strong className="num">{tot.d ? '− ' + fmtAr(tot.d) : '—'}</strong></div>
            <div className="ml-strong"><span>e. Le livreur doit verser (frais compris)</span><strong className="num">{fmtAr(tot.e)}</strong></div>
            {b.carry !== 0 && <div><span>Reste des fois précédentes</span><strong className="num">{b.carry > 0 ? '+ ' : '− '}{fmtAr(Math.abs(b.carry))}</strong></div>}
            <div><span>g. Frais de livraison qui reviennent au livreur{feeOwed ? ` (dont ${fmtAr(feeOwed)} payés à la boutique par le client)` : ''}</span><strong className="num">{fmtAr(feeAll)}</strong></div>
          </div>
          <SelectField label="g. Les frais du livreur sont payés…" required value={feeChoice} onChange={setFeeChoice} options={[
            { value: 'retenue', label: 'Gardés par le livreur sur l’argent versé' },
            ...ACCOUNT_IDS.filter((x) => x !== 'bank').map((x) => ({ value: 'apart:' + x, label: `Payés à part — ${ACCOUNTS[x]}` })),
            { value: 'plustard', label: 'Différés (à payer au plus vite, au plus tard ce soir)' },
          ]} />
          <div className="ml-expected"><span>Attendu du livreur maintenant</span><strong className="num">{fmtAr(expected)}</strong></div>
          <div className="grid-2">
            <TextField label="f. Montant versé par le livreur (Ar)" required value={amount ?? String(expected)} onChange={setAmount} inputMode="numeric" />
            <SelectField label="Reçu sur" value={account} onChange={(v) => setAccount(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} />
          </div>
          <TextField label={gap ? 'Remarque (écart)' : 'Remarque (facultatif)'} required={gap !== 0} value={note} onChange={setNote} />
          <div className={`notice ${gap === 0 && after === 0 ? 'notice-ok' : gap !== 0 ? 'notice-danger' : ''}`}><Icon name={gap === 0 ? 'check' : 'alert'} />
            <span>{gap !== 0 ? <><strong>Écart : {gap > 0 ? '+' : '−'} {fmtAr(Math.abs(gap))}</strong> par rapport à l’attendu. </> : null}
              {after === 0 ? 'Après validation, le compte du livreur est à zéro.' : after > 0 ? `Il restera ${fmtAr(after)} à verser par le livreur (au prochain retour).` : `La boutique lui devra ${fmtAr(-after)} : à payer au plus vite (rappel jusqu’au paiement).`}</span></div>
          <div className="row"><Button busy={busy} disabled={!canSettle || (gap !== 0 && !note.trim())} icon="check" onClick={() => setAsk(true)}>Valider le retour de {courier.name}</Button>{!canSettle && <span className="small muted">Réservé aux personnes qui font les règlements des livreurs.</span>}</div>
        </div>
      )}
      {payOwed && <PayOwedModal courier={courier} amount={-b.carry} onClose={() => setPayOwed(null)} />}
      {ask && <Confirm title={`Valider le retour de ${courier.name} ?`} confirmLabel="Valider" onClose={() => setAsk(false)} onConfirm={validate}
        message={<div className="stack-s"><p>{on.length} colis seront enregistrés et réglés : {on.filter((r) => r.open).map((r) => `${r.o.number} ${r.d === 'delivered' ? 'livrée' : 'refusée'}`).join(', ') || 'déjà saisis'}.</p>
          <table className="kv-table"><tbody>
            <tr><td>a. Articles</td><td>{fmtAr(tot.a)}</td></tr><tr><td>b. Frais de livraison</td><td>{fmtAr(tot.b)}</td></tr>
            <tr><td>c. Payé par les clients</td><td>{fmtAr(tot.c)}</td></tr><tr><td>d. Déjà payé à la boutique</td><td>{fmtAr(tot.d)}</td></tr>
            <tr><td>e. À verser par le livreur</td><td>{fmtAr(tot.e)}</td></tr>
            <tr className="total"><td>f. Versé par {courier.name} ({ACCOUNTS[account]})</td><td>{fmtAr(n)}</td></tr>
            <tr><td>g. Frais du livreur</td><td>{fmtAr(feeAll)} — {mode === 'retenue' ? 'gardés sur le versement' : mode === 'apart' ? `payés à part (${ACCOUNTS[feeAccount]})` : 'différés'}</td></tr>
          </tbody></table>
          <p className="small muted">Après validation, ces colis ne peuvent plus changer de livreur. Une erreur se corrige ensuite par un nouveau versement.</p></div>} />}
      {ret && <ReturnModal order={ret} onClose={() => setRet(null)} />}
      {toShop && <Confirm title="Le client vient chercher en boutique" confirmLabel="Annuler la livraison" message={<p>Le colis {toShop.number} revient en boutique, réservé pour le client. Pas de frais de livraison, pas de dédommagement pour le livreur. La commande deviendra une vente sur place quand le client passera.</p>}
        onClose={() => setToShop(null)} onConfirm={async () => { await cancelDeliveryToShop(toShop); toast('Livraison annulée : la commande attend le client en boutique'); }} />}
    </>
  );
}

