// Règlement avec le livreur (étape après « retour confirmé ») : une ou plusieurs commandes du même livreur réglées
// en une fois — articles et frais séparés, frais du livreur (retenus, payés à part, différés), montant remis.
import { useState } from 'react';
import { bizNow, save } from '../lib/db';
import { fmtAr, parseNum, parseAr } from '../lib/catalog';
import { courierSplit, orderLabel, type Courier, type Order } from '../lib/orders';
import { ACCOUNTS, ACCOUNT_IDS, courierBalance, settleCourier, type AccountId } from '../lib/money';
import { Button, Modal, SelectField, TextField, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

type FeeMode = 'retenue' | 'apart' | 'plustard';

/** Ce que chaque commande représente pour le livreur (a → e). */
export function settleRow(o: Order) {
  const x = courierSplit(o);
  const prepaid = (o.payments || []).filter((p) => p.receivedBy === 'shop').reduce((s, p) => s + p.amount, 0);
  const e = x.toCollect + x.feeKept;
  const c = e + prepaid;
  return { o, x, prepaid, a: c - x.fee, c, e };
}

export function SettleModal({ courier, orders, onClose, onDone }: { courier: Courier; orders: Order[]; onClose: () => void; onDone?: () => void }) {
  const b = courierBalance(courier.id);
  const rows = orders.map(settleRow);
  const [mode, setMode] = useState<FeeMode>('retenue');
  const [feeAccount, setFeeAccount] = useState<AccountId>('cash');
  const [amount, setAmount] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountId>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const collect = rows.reduce((t, r) => t + r.x.toCollect, 0);
  const feeKept = rows.reduce((t, r) => t + r.x.feeKept, 0);
  const feeAll = rows.reduce((t, r) => t + r.x.fee, 0);
  const feeOwed = rows.reduce((t, r) => t + r.x.feeOwed, 0);
  const inHand = collect + feeKept;
  const expected = Math.max(0, b.carry + (mode === 'retenue' ? collect - feeOwed : inHand));
  const n = amount == null ? expected : parseAr(amount) ?? 0;
  const payFees = mode === 'apart' ? feeAll : 0;
  const after = b.carry + collect - feeOwed - n + payFees;
  const gap = n - expected;
  const tot = { a: rows.reduce((t, r) => t + r.a, 0), b: feeAll, c: rows.reduce((t, r) => t + r.c, 0), d: rows.reduce((t, r) => t + r.prepaid, 0) };
  const feeChoice = mode === 'apart' ? `apart:${feeAccount}` : mode;
  const setFeeChoice = (v: string) => { if (v.startsWith('apart:')) { setMode('apart'); setFeeAccount(v.slice(6) as AccountId); } else setMode(v as FeeMode); setAmount(null); };

  async function validate() {
    if (gap !== 0 && !note.trim()) { toast('Expliquez l’écart dans la remarque.', 'error'); return; }
    setBusy(true);
    try {
      const label = mode === 'retenue' ? 'frais retenus par le livreur' : mode === 'apart' ? `frais payés à part (${ACCOUNTS[feeAccount]})` : 'frais différés (compte du livreur)';
      await settleCourier(courier, rows.map((r) => r.o.id), n, account, [`${rows.length} commande(s)`, label, note.trim()].filter(Boolean).join(' · '));
      if (payFees > 0) await settleCourier(courier, [], -payFees, feeAccount, 'Frais de livraison payés au livreur');
      const at = bizNow();
      const feeUpd = rows.filter((r) => r.x.fee > 0).map((r) => ({ id: r.o.id, feeStatus: mode === 'retenue' || (mode === 'plustard' && after <= 0 && gap <= -feeAll + 1) ? 'kept' as const : mode === 'apart' ? 'paid' as const : 'deferred' as const, ...(mode === 'apart' ? { feePaidAt: at, feePaidHow: ACCOUNTS[feeAccount] } : {}) }));
      if (feeUpd.length) await save('orders', feeUpd);
      toast(`${rows.length} commande(s) réglée(s) avec ${courier.name}`);
      onDone?.(); onClose();
    } catch (e: any) { toast(e?.message ?? String(e), 'error'); }
    setBusy(false);
  }

  return (
    <Modal wide title={`Règlement avec ${courier.name} — ${rows.length} commande(s)`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} icon="check" disabled={!rows.length || (gap !== 0 && !note.trim())} onClick={validate}>Valider le règlement ({fmtAr(n)})</Button></>}>
      <div className="stack">
        <ul className="settle-list">{rows.map((r) => (
          <li key={r.o.id}>
            <div><strong>{r.o.number}</strong> <span className="small muted">{orderLabel(r.o)}</span>
              <div className="small muted">articles {fmtAr(r.a)} · frais {fmtAr(r.x.fee)}{r.prepaid ? ` · déjà payé ${fmtAr(r.prepaid)}` : ''}</div></div>
            <strong className="num">{fmtAr(r.e)}</strong>
          </li>
        ))}</ul>
        <div className="money-lines">
          <div><span>a. Articles</span><strong className="num">{fmtAr(tot.a)}</strong></div>
          <div><span>b. Frais de livraison</span><strong className="num">{fmtAr(tot.b)}</strong></div>
          <div className="ml-total"><span>c. Payé par les clients (a + b)</span><strong className="num">{fmtAr(tot.c)}</strong></div>
          <div><span>d. Déjà payé directement à la boutique</span><strong className="num">{tot.d ? '− ' + fmtAr(tot.d) : '—'}</strong></div>
          <div className="ml-strong"><span>e. Le livreur doit verser (frais compris)</span><strong className="num">{fmtAr(inHand)}</strong></div>
          {b.carry !== 0 && <div><span>Reste des fois précédentes</span><strong className="num">{b.carry > 0 ? '+ ' : '− '}{fmtAr(Math.abs(b.carry))}</strong></div>}
          <div><span>g. Frais qui reviennent au livreur{feeOwed ? ` (dont ${fmtAr(feeOwed)} payés à la boutique par le client)` : ''}</span><strong className="num">{fmtAr(feeAll)}</strong></div>
        </div>
        <SelectField label="g. Les frais du livreur sont payés…" required value={feeChoice} onChange={setFeeChoice} options={[
          { value: 'retenue', label: 'Gardés par le livreur sur l’argent versé' },
          ...ACCOUNT_IDS.filter((x) => x !== 'bank').map((x) => ({ value: 'apart:' + x, label: `Payés à part — ${ACCOUNTS[x]}` })),
          { value: 'plustard', label: 'Différés (à payer au plus vite)' },
        ]} />
        <div className="ml-expected"><span>Le livreur doit vous remettre</span><strong className="num">{fmtAr(expected)}</strong></div>
        <div className="grid-2">
          <TextField label="f. Montant versé par le livreur (Ar)" required value={amount ?? String(expected)} onChange={setAmount} inputMode="numeric" />
          <SelectField label="Reçu sur" value={account} onChange={(v) => setAccount(v as AccountId)} options={ACCOUNT_IDS.map((a) => ({ value: a, label: ACCOUNTS[a] }))} />
        </div>
        <TextField label={gap ? 'Remarque (écart)' : 'Remarque (facultatif)'} required={gap !== 0} value={note} onChange={setNote} />
        <div className={`notice ${gap === 0 && after === 0 ? 'notice-ok' : gap !== 0 ? 'notice-danger' : ''}`}><Icon name={gap === 0 ? 'check' : 'alert'} />
          <span>{gap !== 0 ? <><strong>Écart : {gap > 0 ? '+' : '−'} {fmtAr(Math.abs(gap))}</strong> par rapport à l’attendu. </> : null}
            {after === 0 ? 'Après validation, le compte du livreur est à zéro.' : after > 0 ? `Il restera ${fmtAr(after)} à verser par le livreur (au prochain règlement).` : `La boutique lui devra ${fmtAr(-after)} : à payer au plus vite (rappel jusqu’au paiement).`}</span></div>
      </div>
    </Modal>
  );
}
