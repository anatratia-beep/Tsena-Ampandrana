// Paramètres → Imprimantes : imprimantes de cet appareil, poste d'impression partagé, options.
import { useState } from 'react';
import { useCan } from '../lib/auth';
import { newId, remove, setMeta, useMeta, useTable } from '../lib/db';
import { getCloud } from '../lib/sync';
import { useCompany } from '../lib/settings';
import {
  BT_SPEEDS, CHARSETS, DEFAULT_FEED_MM, KINDS, PAPERS, SYSTEM_PRINTER, accentTest, cancelJobs, charsetOptions, deletePrinter, disconnectPrinter, makeStation, pairBluetooth, pairSerial, pairUsb,
  printOn, reconnectPrinter, reprintJob, retryJob, savePrinter, stationOnline, stopStation, support, testDoc, usePrinters,
  type BtSpeed, type Charset, type Paper, type PrintJob, type PrintStation, type Printer, type PrinterKind,
} from '../lib/print';
import { Help, Badge, Button, Confirm, Empty, IconButton, Modal, SelectField, TextField, Toggle, fmtDateTime, timeAgo, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

/** Appareil utilisé (pour des explications adaptées). */
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const DEVICE: 'mac' | 'android' | 'pc' = /Android/i.test(ua) ? 'android' : /Mac/i.test(ua) ? 'mac' : 'pc';
const BT_SETTINGS = { mac: 'Réglages Système → Bluetooth', android: 'Paramètres → Bluetooth', pc: 'Paramètres Windows → Bluetooth et appareils' }[DEVICE];
const noDirect = !support.bluetooth && !support.usb && !support.serial;
const errText = (e: any) => e?.message ?? String(e);

/** Guide pas à pas : imprimante à tickets 58 mm (JK-5803H, « POS-58 », « KPrinter »). */
function Guide({ open }: { open: boolean }) {
  return (
    <details className="card stack-s" open={open}>
      <summary><strong>Imprimante à tickets 58 mm (ex. JK-5803H, « POS-58 », « KPrinter ») : comment la brancher</strong></summary>
      <ol className="small stack-s" style={{ paddingLeft: 20, margin: 0 }}>
        <li>Allumez l’imprimante et ouvrez Trésor en ligne dans <strong>Google Chrome</strong> ou <strong>Microsoft Edge</strong>.</li>
        <li>Touchez « Ajouter une imprimante », choisissez <strong>« Bluetooth (direct) »</strong> puis « Chercher l’imprimante » : choisissez <strong>KPrinter_…</strong> dans la liste.</li>
        <li>Si elle n’apparaît pas : appairez-la d’abord dans les réglages Bluetooth de l’appareil (<strong>{BT_SETTINGS}</strong> ; Mac : Réglages Système → Bluetooth ; Android : Paramètres → Bluetooth ; code <strong>0000</strong> ou <strong>1234</strong>), puis choisissez <strong>« Port série / Bluetooth appairé »</strong>.</li>
        <li>Avec un câble USB : choisissez <strong>« USB (direct) »</strong> puis <strong>POS-58</strong>.</li>
        <li>Choisissez le papier <strong>58 mm</strong>, puis touchez <strong>« Test des accents »</strong> et choisissez la lettre dont la ligne est bien imprimée.</li>
        <li><strong>Enregistrer</strong>, puis <strong>« Par défaut »</strong>.</li>
      </ol>
      <p className="small muted" style={{ margin: 0 }}>Rien à installer : ni pilote, ni logiciel, ni « Imprimantes et scanners » du Mac.</p>
    </details>
  );
}

export function PrintersTab() {
  const can = useCan();
  const company = useCompany();
  const printers = usePrinters();
  const stations = useTable<PrintStation>('printStations');
  const jobs = useTable<PrintJob>('printJobs');
  const mine = useMeta<{ stationId: string; printerId: string } | null>('myStation', null);
  const def = useMeta<string>('printDefault', '');
  const auto = useMeta<boolean>('printAutoTicket', false);
  const [edit, setEdit] = useState<Printer | 'new' | null>(null);
  const [del, setDel] = useState<Printer | null>(null);
  const [pause, setPause] = useState<Printer | null>(null);
  const [station, setStation] = useState(false);
  const [delStation, setDelStation] = useState<PrintStation | null>(null);
  const [clearAll, setClearAll] = useState(false);
  const myStation = stations.find((s) => s.id === mine?.stationId);
  const recent = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  const stuck = jobs.filter((j) => j.status !== 'done');
  const hasDirect = printers.some((p) => p.kind !== 'system');

  async function test(p: Printer) {
    try { await printOn(p, testDoc(company, p.name)); toast(p.kind === 'system' ? 'Fenêtre d’impression ouverte' : 'Page de test envoyée', 'ok', { ms: 10_000 }); }
    catch (e: any) { if (e?.name !== 'NotFoundError') toast(errText(e), 'error', { sticky: true }); }
  }
  async function reconnect(p: Printer) {
    try { await reconnectPrinter(p); toast(`« ${p.name} » est reconnectée à cet appareil`, 'ok', { ms: 10_000 }); }
    catch (e: any) { if (e?.name !== 'NotFoundError') toast(errText(e), 'error', { sticky: true }); }
  }

  return (
    <div className="stack">
      {noDirect && <div className="notice notice-danger"><Icon name="alert" /><span><strong>Ce navigateur ne peut pas imprimer directement</strong> (Safari, Firefox…) : ouvrez Trésor en ligne dans <strong>Google Chrome</strong> ou <strong>Microsoft Edge</strong> pour utiliser une imprimante à tickets Bluetooth ou USB.</span></div>}
      <Guide open={!hasDirect} />
      <div className="card stack">
        <div className="row-between">
          <div><h2>Imprimantes de cet appareil</h2><p className="small muted">Chaque téléphone ou ordinateur a ses propres imprimantes. Donnez-leur un nom clair (ex. « Ticket caisse »).</p></div>
          <Button icon="plus" onClick={() => setEdit('new')}>Ajouter une imprimante</Button>
        </div>
        {printers.length === 0 ? (
          <Empty icon="printer" title="Aucune imprimante ajoutée">
            <p className="small muted">Sans réglage, vous pouvez déjà imprimer avec la fenêtre d’impression de l’appareil ou partager le ticket en image.</p>
          </Empty>
        ) : (
          <ul className="list">
            {printers.map((p) => (
              <li key={p.id} className="list-item">
                <Icon name="printer" />
                <div className="list-item-main">
                  <span className="list-item-title">{p.name} {def === p.id && <Badge tone="brand">Par défaut</Badge>} {p.kind !== 'system' && (p.paused ? <Badge tone="warn">Déconnectée</Badge> : p.ref ? <Badge tone="ok">Associée à cet appareil</Badge> : null)}</span>
                  <p className="small muted">{KINDS[p.kind]} · {PAPERS[p.paper]}{p.deviceName ? ` · ${p.deviceName}` : ''}{p.kind !== 'system' && !p.ref ? ' · pas encore appairée' : ''}</p>
                </div>
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {p.paused ? <Button variant="ghost" onClick={() => reconnect(p)}>Reconnecter</Button> : <Button variant="ghost" onClick={() => test(p)}>Test</Button>}
                  {p.kind !== 'system' && p.ref && !p.paused && <Button variant="quiet" className="hide-sm" onClick={() => setPause(p)}>Déconnecter</Button>}
                  {def !== p.id && <Button variant="quiet" className="hide-sm" onClick={() => setMeta('printDefault', p.id)}>Par défaut</Button>}
                  <IconButton icon="edit" label="Modifier" onClick={() => setEdit(p)} />
                  <IconButton icon="trash" label="Supprimer" onClick={() => setDel(p)} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="list-item" style={{ padding: 0 }}>
          <Icon name="monitor" />
          <div className="list-item-main"><span className="list-item-title">{SYSTEM_PRINTER.name} {def === SYSTEM_PRINTER.id && <Badge tone="brand">Par défaut</Badge>}</span><p className="small muted">Toujours disponible : AirPrint (iPhone, Mac), imprimantes installées sur Windows, enregistrer en PDF.</p></div>
          <Button variant="ghost" onClick={() => test(SYSTEM_PRINTER)}>Test</Button>
        </div>
        <Toggle checked={auto} onChange={(v) => setMeta('printAutoTicket', v)} label="Imprimer le ticket automatiquement après chaque vente sur place (sur l’imprimante par défaut de cet appareil)" />
      </div>

      <div className="card stack">
        <div><h2>Poste d’impression partagé</h2>
          <Help>N’importe quel appareil peut être le poste : un ordinateur, ou un téléphone Android avec Chrome (pas un iPhone). Il est relié à l’imprimante ; les autres appareils (iPhone, téléphones sans Bluetooth…) lui envoient les tickets par le cloud, comme une imprimante « en réseau ». Le poste doit rester allumé avec Trésor en ligne ouvert. Pour le poste, préférez l’USB ou le Bluetooth appairé (« Port série »), qui se reconnectent tout seuls.</Help></div>
        {!getCloud() && <div className="notice"><Icon name="cloudOff" /><span>Reliez d’abord le cloud (onglet « Cloud et synchronisation ») pour utiliser un poste partagé.</span></div>}
        {myStation ? (
          <div className="notice notice-ok"><Icon name="check" /><span><strong>Cet appareil est le poste « {myStation.name} ».</strong> Il imprime sur « {myStation.printerName} » les tickets envoyés par les autres. <button className="link-btn" onClick={() => setStation(true)}>Modifier</button> · <button className="link-btn" onClick={async () => { await stopStation(); toast('Cet appareil n’est plus un poste d’impression'); }}>Arrêter</button></span></div>
        ) : (
          <Button variant="ghost" icon="cloud" disabled={!getCloud()} onClick={() => setStation(true)}>Faire de cet appareil un poste d’impression</Button>
        )}
        {stations.length > 0 && (
          <ul className="list">
            {stations.map((s) => {
              const waiting = jobs.filter((j) => j.stationId === s.id && j.status === 'pending').length;
              return (
                <li key={s.id} className="list-item">
                  <span className={`dot ${stationOnline(s) ? 'dot-ok' : 'dot-off'}`} />
                  <div className="list-item-main">
                    <span className="list-item-title">{s.name}{s.id === mine?.stationId ? ' (cet appareil)' : ''} {s.alert && <Badge tone="danger">Imprimante à reconnecter</Badge>}</span>
                    <p className="small muted">{s.printerName || '—'} · {stationOnline(s) ? 'en ligne' : `vu ${timeAgo(s.lastSeen)}`}{waiting ? ` · ${waiting} en attente` : ''}</p>
                    {s.alert && <p className="small">Les tickets attendent : sur ce poste, touchez « Reconnecter l’imprimante » (bandeau en haut de l’écran).</p>}
                  </div>
                  {can('settings.company') && s.id !== mine?.stationId && <IconButton icon="trash" label="Retirer" onClick={() => setDelStation(s)} />}
                </li>
              );
            })}
          </ul>
        )}
        {recent.length > 0 && (
          <details>
            <summary className="small">Dernières impressions envoyées aux postes</summary>
            <ul className="list">
              {recent.map((j) => (
                <li key={j.id} className="list-item">
                  <div className="list-item-main"><span className="list-item-title">{j.doc?.title}</span><p className="small muted">{fmtDateTime(j.createdAt)} · {j.byName || ''} → {stations.find((s) => s.id === j.stationId)?.name || 'poste retiré'}{j.error ? ` · ${j.error}` : ''}</p></div>
                  <Badge tone={j.status === 'done' ? 'ok' : j.status === 'error' ? 'danger' : 'warn'}>{j.status === 'done' ? 'Imprimé' : j.status === 'error' ? 'Erreur' : 'En attente'}</Badge>
                  {j.status === 'done'
                    ? <Button variant="quiet" className="btn-sm" onClick={async () => { await reprintJob(j); toast('Ticket renvoyé au poste', 'ok', { ms: 10_000 }); }}>Réimprimer</Button>
                    : <Button variant="quiet" className="btn-sm" onClick={async () => { await retryJob(j); toast('Nouvel essai demandé au poste', 'ok', { ms: 10_000 }); }}>Réessayer</Button>}
                  <IconButton icon="trash" label="Effacer ce ticket" onClick={async () => { await cancelJobs([j.id]); toast('Ticket effacé'); }} />
                </li>
              ))}
            </ul>
            {stuck.length > 0 && <Button variant="ghost" className="btn-sm" icon="trash" onClick={() => setClearAll(true)}>Effacer les tickets en attente et en erreur ({stuck.length})</Button>}
          </details>
        )}
      </div>

      <div className="card stack-s">
        <h2>Quelle imprimante acheter ?</h2>
        <p className="small">Une imprimante à tickets <strong>58 mm « ESC/POS »</strong> avec <strong>Bluetooth et USB</strong>. Sur Android (Chrome) et sur ordinateur (Chrome ou Edge), Trésor en ligne imprime directement dessus. Sur iPhone, Apple bloque le Bluetooth direct : utilisez un poste d’impression partagé, une imprimante compatible AirPrint, ou le partage en image.</p>
        <p className="small muted">Ce navigateur : Bluetooth {support.bluetooth ? '✓' : '✗'} · USB {support.usb ? '✓' : '✗'} · Port série {support.serial ? '✓' : '✗'}</p>
      </div>

      {edit && <PrinterForm printer={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {del && <Confirm title="Supprimer cette imprimante ?" message={`« ${del.name} » sera retirée de cet appareil.`} confirmLabel="Supprimer" danger onConfirm={async () => { await deletePrinter(del.id); if (mine?.printerId === del.id) await stopStation(); toast('Imprimante supprimée'); }} onClose={() => setDel(null)} />}
      {pause && <Confirm title="Déconnecter cette imprimante ?" message={`« ${pause.name} » est libérée pour qu’un autre appareil puisse l’utiliser (une imprimante Bluetooth ne se connecte qu’à un appareil à la fois). Ses réglages sont gardés : « Reconnecter » la reprend en un clic.${mine?.printerId === pause.id ? ' Cet appareil arrête d’être le poste d’impression.' : ''}`} confirmLabel="Déconnecter" onConfirm={async () => { await disconnectPrinter(pause); toast(`« ${pause.name} » est déconnectée de cet appareil`, 'ok', { ms: 10_000 }); }} onClose={() => setPause(null)} />}
      {station && <StationForm current={myStation} printers={printers} onClose={() => setStation(false)} />}
      {delStation && <Confirm title="Retirer ce poste ?" message={`Les autres appareils ne pourront plus envoyer de tickets à « ${delStation.name} ».`} confirmLabel="Retirer" danger onConfirm={async () => { await remove('printStations', delStation.id); toast('Poste retiré'); }} onClose={() => setDelStation(null)} />}
      {clearAll && <Confirm title="Effacer ces tickets ?" message={`${stuck.length} ticket(s) en attente ou en erreur seront effacés : ils ne seront pas imprimés.`} confirmLabel="Effacer" danger onConfirm={async () => { await cancelJobs(stuck.map((j) => j.id)); toast('Tickets effacés'); }} onClose={() => setClearAll(false)} />}
    </div>
  );
}

function PrinterForm({ printer, onClose }: { printer?: Printer; onClose: () => void }) {
  const company = useCompany();
  const firstKind: PrinterKind = support.bluetooth ? 'bluetooth' : support.usb ? 'usb' : 'system';
  const [p, setP] = useState<Printer>(printer ?? { id: newId(), name: '', kind: firstKind, paper: '58', charset: 'cp850', logo: true, cut: false, btSpeed: 'safe', feedMm: DEFAULT_FEED_MM });
  const [busy, setBusy] = useState(false);
  const [btMiss, setBtMiss] = useState(false);
  const set = (patch: Partial<Printer>) => setP({ ...p, ...patch });
  const available = (k: PrinterKind) => k === 'system' || support[k];
  const direct = p.kind !== 'system';

  async function pair() {
    setBusy(true);
    try {
      const r = p.kind === 'bluetooth' ? await pairBluetooth() : p.kind === 'usb' ? await pairUsb() : await pairSerial();
      setP({ ...p, ref: r.ref, deviceName: r.name, name: p.name || r.name, paused: false });
      toast(`Imprimante trouvée : ${r.name}`);
    } catch (e: any) {
      if (e?.name === 'NotFoundError' && p.kind === 'bluetooth') setBtMiss(true);
      else if (e?.name !== 'NotFoundError') toast(errText(e), 'error', { sticky: true });
    } finally { setBusy(false); }
  }
  async function submit() {
    if (!p.name.trim()) return toast('Donnez un nom à l’imprimante.', 'error');
    await savePrinter({ ...p, name: p.name.trim() });
    toast('Imprimante enregistrée'); onClose();
  }
  async function accents() {
    try { await accentTest(p); toast('Test des accents envoyé : choisissez la lettre dont la ligne est bien imprimée', 'ok', { ms: 10_000 }); }
    catch (e: any) { if (e?.name !== 'NotFoundError') toast(errText(e), 'error', { sticky: true }); }
  }
  const help: Record<PrinterKind, string> = {
    bluetooth: available('bluetooth') ? 'Android (Chrome), ordinateur (Chrome/Edge). Allumez l’imprimante avant de chercher.' : 'Pas disponible sur ce navigateur (iPhone/Safari, Firefox) : ouvrez Google Chrome ou Microsoft Edge.',
    usb: available('usb') ? 'Imprimante branchée par câble (ex. « POS-58 »), Chrome ou Edge.' : 'Pas disponible sur ce navigateur : ouvrez Google Chrome ou Microsoft Edge.',
    serial: available('serial')
      ? `Imprimante Bluetooth « classique » (ex. JK-301PL) : appairez-la d’abord dans ${BT_SETTINGS} (code 0000 ou 1234), puis choisissez-la ici. Aussi pour un câble USB-série.`
      : DEVICE === 'android' ? 'Pas disponible : mettez à jour Google Chrome.' : 'Pas disponible sur ce navigateur : ouvrez Google Chrome ou Microsoft Edge.',
    system: 'Tous les appareils : la fenêtre d’impression s’ouvre, vous y choisissez l’imprimante.',
  };

  return (
    <Modal title={printer ? 'Modifier l’imprimante' : 'Ajouter une imprimante'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button>
        {(!direct || p.ref) && <Button variant="ghost" onClick={async () => { try { await printOn({ ...p, paused: false }, testDoc(company, p.name || 'Imprimante')); } catch (e: any) { toast(errText(e), 'error', { sticky: true }); } }}>Page de test</Button>}
        <Button onClick={submit}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom de l’imprimante" required hint="Le nom que vous choisirez au moment d’imprimer, ex. « Ticket caisse »." value={p.name} onChange={(v) => set({ name: v })} />
        <div className="stack-s">
          <strong>Branchement</strong>
          <div className="choice-list">
            {(['bluetooth', 'usb', 'serial', 'system'] as PrinterKind[]).map((k) => (
              <label key={k} className={`choice ${p.kind === k ? 'is-on' : ''} ${available(k) ? '' : 'is-disabled'}`}>
                <input type="radio" name="kind" disabled={!available(k)} checked={p.kind === k} onChange={() => { set({ kind: k, ref: undefined, deviceName: undefined }); setBtMiss(false); }} />
                <span className="choice-text"><strong>{KINDS[k]}</strong><span className="small muted">{help[k]}</span></span>
              </label>
            ))}
          </div>
        </div>
        {direct && (
          <div className="row" style={{ alignItems: 'center' }}>
            <Button icon="search" busy={busy} onClick={pair}>{p.ref ? 'Chercher une autre imprimante' : 'Chercher l’imprimante'}</Button>
            {p.ref ? <Badge tone="ok">Appairée : {p.deviceName}</Badge> : <span className="small muted">Une liste des appareils proches va s’ouvrir.</span>}
          </div>
        )}
        {btMiss && p.kind === 'bluetooth' && <div className="notice"><Icon name="alert" /><span>Imprimante introuvable ? Elle utilise sans doute le <strong>Bluetooth classique</strong> (ex. JK-301PL) : appairez-la dans {BT_SETTINGS} (code 0000 ou 1234), puis choisissez <strong>« Port série / Bluetooth appairé »</strong>.{!support.serial && DEVICE === 'android' ? ' Si ce choix n’est pas disponible, mettez à jour Google Chrome.' : ''}</span></div>}
        <div className="grid-2">
          <SelectField label="Papier" value={p.paper} onChange={(v) => set({ paper: v as Paper })} options={(Object.keys(PAPERS) as Paper[]).filter((k) => direct ? k !== 'a4' : true).map((k) => ({ value: k, label: PAPERS[k] }))} />
          {direct && <SelectField label="Jeu de caractères (accents)" value={p.charset} onChange={(v) => set({ charset: v as Charset })} options={charsetOptions(p.charset).map((k) => ({ value: k, label: CHARSETS[k] }))} />}
          {p.kind === 'serial' && <SelectField label="Vitesse du port" value={String(p.baud ?? 9600)} onChange={(v) => set({ baud: Number(v) })} options={[9600, 19200, 38400, 115200].map((b) => ({ value: String(b), label: `${b} bauds` }))} />}
          {p.kind === 'bluetooth' && <SelectField label="Envoi Bluetooth" value={p.btSpeed ?? 'safe'} onChange={(v) => set({ btSpeed: v as BtSpeed })} options={(Object.keys(BT_SPEEDS) as BtSpeed[]).map((k) => ({ value: k, label: BT_SPEEDS[k] }))} />}
          {direct && <SelectField label="Espace blanc en bas du ticket" value={String(p.feedMm ?? DEFAULT_FEED_MM)} onChange={(v) => set({ feedMm: Number(v) })} options={[10, 15, 20, 25, 30].map((n) => ({ value: String(n), label: `${n / 10} cm${n === DEFAULT_FEED_MM ? ' (conseillé)' : ''}` }))} />}
        </div>
        {direct && p.ref && <div className="row" style={{ alignItems: 'center' }}><Button variant="ghost" icon="printer" onClick={accents}>Test des accents</Button><span className="small muted">Imprime une ligne par jeu (A, C, D) : choisissez la lettre dont la ligne est bien imprimée.</span></div>}
        {p.kind === 'bluetooth' && <p className="small muted" style={{ margin: 0 }}>Si le ticket s’arrête au milieu, gardez « Envoi Bluetooth : Sûr ».</p>}
        <Toggle checked={p.logo} onChange={(v) => set({ logo: v })} label="Imprimer le logo en haut du ticket" />
        {direct && <Toggle checked={p.cut} onChange={(v) => set({ cut: v })} label="Couper le papier à la fin (si l’imprimante a un massicot)" />}
      </div>
    </Modal>
  );
}

function StationForm({ current, printers, onClose }: { current?: PrintStation; printers: Printer[]; onClose: () => void }) {
  const mine = useMeta<{ printerId: string } | null>('myStation', null);
  const choices = [...printers, SYSTEM_PRINTER];
  const [name, setName] = useState(current?.name ?? 'Caisse boutique');
  const [pid, setPid] = useState(mine?.printerId ?? printers[0]?.id ?? SYSTEM_PRINTER.id);
  const chosen = choices.find((c) => c.id === pid);
  return (
    <Modal title="Poste d’impression" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button disabled={!name.trim()} onClick={async () => { try { await makeStation(name.trim(), pid); toast('Cet appareil est maintenant un poste d’impression'); onClose(); } catch (e: any) { toast(errText(e), 'error', { sticky: true }); } }}>Enregistrer</Button></>}>
      <div className="stack">
        <TextField label="Nom du poste (vu par les autres appareils)" required value={name} onChange={setName} />
        <SelectField label="Imprimante utilisée par ce poste" value={pid} onChange={setPid} options={choices.map((c) => ({ value: c.id, label: c.name + (c.paused ? ' (déconnectée : elle sera reconnectée)' : '') }))} />
        {chosen?.kind === 'system' && <div className="notice"><Icon name="alert" /><span>Avec la fenêtre d’impression, quelqu’un devra cliquer « Imprimer » sur ce poste à chaque ticket. Préférez une imprimante en USB ou Bluetooth appairé (port série).</span></div>}
        {printers.length === 0 && <p className="small muted">Ajoutez d’abord l’imprimante à tickets de cet appareil (USB ou Bluetooth) pour qu’il imprime tout seul.</p>}
      </div>
    </Modal>
  );
}
