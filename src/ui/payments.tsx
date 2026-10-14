// Paiement en plusieurs tranches : ex. article à 10 000 Ar payé 5 000 Ar en espèces + 5 000 Ar en MVola.
// Utilisé à l'encaissement d'une vente sur place, à la création d'une commande et pour un paiement reçu ensuite.
import { PAY_METHODS, type PayMethod } from '../lib/orders';
import { fmtAr, parseAr } from '../lib/catalog';
import { Button, IconButton, TextField } from './kit';

export interface PayLine { method: PayMethod; amount: string; ref: string }
const MOBILE: PayMethod = 'mvola';
const round100 = (n: number) => Math.round(n / 100) * 100;

/** Remplit automatiquement la dernière tranche avec le reste quand on modifie une autre tranche. */
export function rebalance(lines: PayLine[], changed: number, total: number): PayLine[] {
  if (!total || lines.length < 2) return lines;
  const last = changed === lines.length - 1 ? lines.length - 2 : lines.length - 1;
  const others = lines.reduce((s, l, j) => (j === last ? s : s + (parseAr(l.amount) || 0)), 0);
  return lines.map((l, j) => (j === last ? { ...l, amount: String(Math.max(0, total - others)) } : l));
}
/** Coupe un montant en deux tranches : espèces + mobile money (moitié chacune, arrondie à 100 Ar ; modifiable). */
export function splitInTwo(total: number): PayLine[] {
  const a = round100(total / 2);
  return [{ method: 'cash', amount: String(a), ref: '' }, { method: MOBILE, amount: String(Math.max(0, total - a)), ref: '' }];
}
export const payLinesSum = (lines: PayLine[]) => lines.reduce((s, l) => s + (parseAr(l.amount) || 0), 0);

/** Une ou plusieurs tranches de paiement, chacune avec son moyen (espèces, MVola, Orange Money, Airtel Money…). */
export function PayLines({ lines, onChange, total, mode = 'buttons', allowEmpty }: { lines: PayLine[]; onChange: (l: PayLine[]) => void; total: number; mode?: 'buttons' | 'select'; allowEmpty?: boolean }) {
  const sum = payLinesSum(lines);
  const rest = total - sum;
  const set = (i: number, patch: Partial<PayLine>) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    onChange('amount' in patch ? rebalance(next, i, total) : next);
  };
  const add = () => {
    const used = new Set(lines.map((l) => l.method));
    const method = (['cash', MOBILE, 'orange', 'airtel'] as PayMethod[]).find((m) => !used.has(m) && m in PAY_METHODS) ?? MOBILE;
    onChange([...lines, { method, amount: rest > 0 ? String(rest) : '', ref: '' }]);
  };
  const label = (i: number) => (lines.length > 1 ? `Tranche ${i + 1} (Ar)` : 'Montant (Ar)');
  return (
    <div className="stack-s pay-lines">
      {total > 0 && lines.length === 1 && (
        <div className="row" style={{ gap: 6 }}>
          <Button variant="ghost" className="btn-sm" icon="plus" onClick={() => onChange(splitInTwo(total))}>Payer en 2 tranches (espèces + mobile money)</Button>
        </div>
      )}
      {lines.map((p, i) => (
        <div key={i} className="card stack-s pay-line" style={{ background: 'var(--surface-2)' }}>
          {lines.length > 1 && <strong className="small">Tranche {i + 1}</strong>}
          {mode === 'buttons' ? (
            <div className="segmented" role="group" aria-label={lines.length > 1 ? `Moyen de paiement tranche ${i + 1}` : 'Moyen de paiement'}>
              {(Object.keys(PAY_METHODS) as PayMethod[]).map((m) => <button key={m} type="button" aria-pressed={p.method === m} onClick={() => set(i, { method: m })}>{PAY_METHODS[m]}</button>)}
            </div>
          ) : (
            <div className="field"><label htmlFor={`pm-${i}`}>Moyen</label>
              <select id={`pm-${i}`} aria-label={lines.length > 1 ? `Moyen tranche ${i + 1}` : 'Moyen'} value={p.method} onChange={(e) => set(i, { method: e.target.value as PayMethod })}>
                {Object.entries(PAY_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
          )}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}><TextField label={label(i)} value={p.amount} onChange={(v) => set(i, { amount: v })} inputMode="numeric" hint={p.amount && parseAr(p.amount) && /[^\d]/.test(p.amount) ? `= ${fmtAr(parseAr(p.amount))}` : undefined} /></div>
            {p.method !== 'cash' && <div style={{ flex: 1 }}><TextField label="Référence (facultatif)" value={p.ref} onChange={(v) => set(i, { ref: v })} /></div>}
            {lines.length > 1 && <IconButton icon="trash" label={`Retirer la tranche ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))} />}
          </div>
        </div>
      ))}
      <div className="row-between" style={{ alignItems: 'center' }}>
        <Button variant="ghost" className="btn-sm" icon="plus" onClick={add}>Ajouter une tranche</Button>
        {total > 0 && (lines.length > 1 || rest !== 0) && (sum > 0 || !allowEmpty) && (
          <span className="small">Payé <strong className="num">{fmtAr(sum)}</strong>{rest > 0 ? <> · reste <strong className="num neg">{fmtAr(rest)}</strong></> : rest < 0 ? <> · <strong className="neg">{fmtAr(-rest)} de trop</strong></> : <> · <strong className="pos">complet</strong></>}</span>
        )}
      </div>
      {lines.length > 1 && <p className="small muted" style={{ margin: 0 }}>{lines.filter((l) => parseAr(l.amount)).map((l) => `${fmtAr(parseAr(l.amount) || 0)} ${PAY_METHODS[l.method]}`).join(' + ')}</p>}
    </div>
  );
}
