// Fenêtre « Imprimer » : aperçu du ticket, choix de l'imprimante par son nom, nombre d'exemplaires.
import { useMemo, useState } from 'react';
import { useCompany } from '../lib/settings';
import { useMeta } from '../lib/db';
import { defaultTarget, docHtml, findPrinter, printTo, useTargets, type PrintDoc } from '../lib/print';
import { Button, IconButton, Modal, navigate, toast } from './kit';
import { Icon } from './icons';

export interface DocChoice { key: string; label: string; build: () => PrintDoc }

export function PrintDialog({ docs, onClose }: { docs: DocChoice[]; onClose: () => void }) {
  const company = useCompany();
  const targets = useTargets();
  useMeta('printDefault', '');
  const [docKey, setDocKey] = useState(docs[0].key);
  const [target, setTarget] = useState(() => { const d = defaultTarget(); return targets.some((t) => t.id === d) ? d : targets[0]?.id; });
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const choice = docs.find((d) => d.key === docKey) ?? docs[0];
  const doc = useMemo(() => choice.build(), [choice]);
  const printer = findPrinter(target);
  const paper = printer?.paper ?? '58';
  const html = useMemo(() => docHtml(doc, paper, printer && !printer.logo ? null : company.logo ?? ''), [doc, paper, printer, company.logo]);
  const t = targets.find((x) => x.id === target);

  async function go() {
    setBusy(true);
    try { toast(await printTo(target, doc, copies)); onClose(); }
    catch (e: any) { if (e?.name !== 'NotFoundError' && e?.name !== 'AbortError') toast(e?.message ?? String(e), 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Imprimer" onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Fermer</Button>
        <Button icon={t?.kind === 'share' ? 'share' : 'printer'} busy={busy} disabled={!target} onClick={go}>{t?.kind === 'share' ? 'Partager' : copies > 1 ? `Imprimer ${copies} exemplaires` : 'Imprimer'}</Button>
      </>}>
      <div className="print-dialog">
        <div className="stack">
          {docs.length > 1 && (
            <div className="segmented" role="group" aria-label="Document">
              {docs.map((d) => <button key={d.key} type="button" aria-pressed={d.key === docKey} onClick={() => setDocKey(d.key)}>{d.label}</button>)}
            </div>
          )}
          <div className="stack-s">
            <strong>Imprimante</strong>
            <div className="choice-list" role="radiogroup" aria-label="Imprimante">
              {targets.map((x) => (
                <label key={x.id} className={`choice ${x.id === target ? 'is-on' : ''}`}>
                  <input type="radio" name="printer" checked={x.id === target} onChange={() => setTarget(x.id)} />
                  <Icon name={x.kind === 'share' ? 'share' : x.kind === 'station' ? 'cloud' : 'printer'} />
                  <span className="choice-text"><strong>{x.label}</strong><span className="small muted">{x.detail}</span></span>
                  {x.kind === 'station' && <span className={`dot ${x.online ? 'dot-ok' : 'dot-off'}`} title={x.online ? 'En ligne' : 'Hors ligne'} />}
                </label>
              ))}
            </div>
            <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); navigate('/parametres/imprimantes'); }}>Ajouter ou régler une imprimante</button>
          </div>
          {t?.kind !== 'share' && (
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span>Exemplaires</span>
              <IconButton icon="x" label="Moins" disabled={copies <= 1} onClick={() => setCopies(Math.max(1, copies - 1))} />
              <strong className="num" style={{ minWidth: 20, textAlign: 'center' }}>{copies}</strong>
              <IconButton icon="plus" label="Plus" onClick={() => setCopies(Math.min(5, copies + 1))} />
            </div>
          )}
          {printer?.kind === 'system' && <p className="small muted">La fenêtre d’impression de l’appareil va s’ouvrir : choisissez-y votre imprimante par son nom. Pour un ticket, réglez les marges sur « Aucune ».</p>}
          {t?.kind === 'station' && !t.online && <div className="notice"><Icon name="alert" /><span>Ce poste semble éteint ou hors ligne : le ticket sortira dès qu’il sera rallumé avec Trésor en ligne ouvert.</span></div>}
        </div>
        <div className="ticket-preview" aria-label="Aperçu">
          <div className={`ticket paper-${paper === 'a4' ? '80' : paper}`} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </Modal>
  );
}

/** Bouton « Imprimer » qui ouvre la fenêtre ci-dessus. */
export function PrintButton({ docs, label = 'Imprimer', variant = 'ghost' }: { docs: DocChoice[]; label?: string; variant?: 'ghost' | 'quiet' | 'primary' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon="printer" onClick={() => setOpen(true)}>{label}</Button>
      {open && <PrintDialog docs={docs} onClose={() => setOpen(false)} />}
    </>
  );
}
