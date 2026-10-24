// Imprimantes : celles de cet appareil (gardées sur l'appareil), les postes d'impression partagés
// (via le cloud : un téléphone sans Bluetooth envoie, le poste relié à l'imprimante imprime).
import { useEffect } from 'react';
import { all, get, getMeta, newId, nowIso, remove, save, setMeta, useMeta, useTable, type BaseRecord } from '../db';
import { currentUser } from '../auth';
import { getCloud, syncNow } from '../sync';
import { DEFAULT_COMPANY, type Company } from '../settings';
import { colsOf, type Paper, type PrintDoc } from './doc';
import { DEFAULT_FEED_MM, accentTestBytes, encodeDoc, type Charset } from './escpos';
import { disconnectRaw, shareImage, systemPrint, writeRaw, type BtSpeed } from './devices';
import { toast } from '../../ui/kit';

export * from './doc';
export { CHARSETS, charsetOptions, DEFAULT_FEED_MM, type Charset } from './escpos';
export { support, pairBluetooth, pairUsb, pairSerial, docHtml, BT_SPEEDS, type BtSpeed } from './devices';

export type PrinterKind = 'system' | 'bluetooth' | 'usb' | 'serial';
export const KINDS: Record<PrinterKind, string> = {
  bluetooth: 'Bluetooth (direct)',
  usb: 'USB (direct)',
  serial: 'Port série / Bluetooth appairé',
  system: 'Fenêtre d’impression de l’appareil',
};
export interface Printer {
  id: string;
  name: string;
  kind: PrinterKind;
  paper: Paper;
  charset: Charset;
  logo: boolean;
  cut: boolean;
  ref?: string;        // identifiant de l'appareil appairé
  deviceName?: string; // nom donné par l'imprimante
  baud?: number;
  /** Taille des paquets Bluetooth (sûr 20 octets par défaut). */
  btSpeed?: BtSpeed;
  /** Espace blanc en bas du ticket, en mm (10 à 30, 20 par défaut). */
  feedMm?: number;
  /** Déconnectée de cet appareil (libérée pour un autre appareil), réglages gardés. */
  paused?: boolean;
}
export interface PrintStation extends BaseRecord {
  name: string; printerName?: string; paper?: Paper; lastSeen?: string; deviceId?: string;
  /** L'imprimante du poste attend qu'on clique « Reconnecter l'imprimante » sur le poste (message). */
  alert?: string | null;
}
export interface PrintJob extends BaseRecord {
  stationId: string; doc: PrintDoc; copies: number; status: 'pending' | 'done' | 'error'; byName?: string; printedAt?: string; error?: string;
  /** Nouvel essai demandé (Réessayer) : le poste le reprend. */
  retryAt?: string;
  /** Appareil qui a envoyé le ticket (pour le prévenir quand il est sorti). */
  fromDevice?: string;
}

/** Choix toujours disponibles, sans réglage. */
export const SYSTEM_PRINTER: Printer = { id: '@system', name: 'Fenêtre d’impression de l’appareil', kind: 'system', paper: '58', charset: 'cp850', logo: true, cut: false };
export const SHARE_TARGET = '@share';

export const usePrinters = () => useMeta<Printer[]>('printers', []);
export const getPrinters = () => getMeta<Printer[]>('printers', []);
export async function savePrinter(p: Printer) {
  const list = getPrinters();
  await setMeta('printers', list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]);
}
export async function deletePrinter(id: string) {
  await setMeta('printers', getPrinters().filter((p) => p.id !== id));
  if (getMeta('printDefault', '') === id) await setMeta('printDefault', '');
}

/** Ce que l'on peut choisir au moment d'imprimer : imprimantes de l'appareil, postes partagés, fenêtre système, image. */
export interface Target { id: string; label: string; detail: string; kind: 'printer' | 'station' | 'share'; online?: boolean; alert?: string | null }
export const stationOnline = (s: PrintStation) => !!s.lastSeen && Date.now() - new Date(s.lastSeen).getTime() < 3 * 60_000;
export function useTargets(): Target[] {
  const printers = usePrinters();
  const stations = useTable<PrintStation>('printStations');
  const jobs = useTable<PrintJob>('printJobs');
  const myStation = useMeta<{ stationId: string } | null>('myStation', null);
  const t: Target[] = printers.map((p) => ({ id: p.id, label: p.name, detail: `${KINDS[p.kind]} · ${p.paper === 'a4' ? 'A4' : p.paper + ' mm'}${p.paused ? ' · déconnectée de cet appareil' : ''}`, kind: 'printer' }));
  for (const s of stations) {
    if (s.id === myStation?.stationId) continue;
    const online = stationOnline(s);
    const waiting = jobs.filter((j) => j.stationId === s.id && j.status === 'pending').length;
    t.push({ id: 'station:' + s.id, label: s.name, detail: `Poste d’impression partagé${s.printerName ? ' · ' + s.printerName : ''}${online ? '' : ' · hors ligne'}${waiting ? ` · ${waiting} en attente` : ''}${s.alert ? ' · imprimante à reconnecter sur le poste' : ''}`, kind: 'station', online, alert: s.alert });
  }
  t.push({ id: SYSTEM_PRINTER.id, label: SYSTEM_PRINTER.name, detail: 'AirPrint, imprimantes installées sur l’ordinateur, PDF…', kind: 'printer' });
  t.push({ id: SHARE_TARGET, label: 'Partager en image', detail: 'WhatsApp, Messenger, enregistrer dans les photos…', kind: 'share' });
  return t;
}

const company = (): Company => ({ ...DEFAULT_COMPANY, ...(get<Company>('settings', 'company') ?? {}) });
export const findPrinter = (id: string) => (id === SYSTEM_PRINTER.id ? SYSTEM_PRINTER : getPrinters().find((p) => p.id === id));

/** Erreur : l'imprimante est déconnectée de cet appareil (il faut cliquer « Reconnecter »). */
export class PrinterPaused extends Error {
  constructor(name: string) { super(`L’imprimante « ${name} » est déconnectée de cet appareil : touchez « Reconnecter » dans Paramètres → Imprimantes.`); this.name = 'PrinterPaused'; }
}
const rawOpts = (p: Printer) => ({ baud: p.baud, btSpeed: p.btSpeed ?? 'safe', name: p.deviceName });
const feedOf = (p: Printer) => Math.min(30, Math.max(10, p.feedMm ?? DEFAULT_FEED_MM));

/** Imprime sur une imprimante de cet appareil. */
export async function printOn(p: Printer, doc: PrintDoc, copies = 1) {
  const logo = p.logo ? company().logo ?? '' : null; // null : pas de logo sur cette imprimante
  if (p.kind === 'system') return systemPrint(doc, p.paper, logo, copies);
  if (p.paused) throw new PrinterPaused(p.name);
  if (!p.ref) throw new Error(`L’imprimante « ${p.name} » n’est pas encore appairée : ouvrez Paramètres → Imprimantes.`);
  const data = await encodeDoc(doc, { cols: colsOf(p.paper), charset: p.charset, cut: p.cut, logo, copies, feedMm: feedOf(p) });
  await writeRaw(p.kind, p.ref, data, rawOpts(p));
}

/** « Test des accents » : une ligne par jeu de caractères (A, C, D) pour choisir la bonne lettre. */
export async function accentTest(p: Printer) {
  if (p.kind === 'system') throw new Error('Le test des accents est pour les imprimantes Bluetooth, USB ou port série.');
  if (!p.ref) throw new Error('Cherchez d’abord l’imprimante.');
  await writeRaw(p.kind, p.ref, accentTestBytes(p.name, feedOf(p)), rawOpts(p));
}

/** Déconnecter : libère l'imprimante pour un autre appareil sans la supprimer (réglages gardés). */
export async function disconnectPrinter(p: Printer) {
  if (p.kind !== 'system' && p.ref) await disconnectRaw(p.kind, p.ref);
  await savePrinter({ ...p, paused: true });
  const mine = getMeta<{ stationId: string; printerId: string } | null>('myStation', null);
  if (mine?.printerId === p.id) await stopStation();
}
/** Reconnecter en un clic (envoie une initialisation ESC @). */
export async function reconnectPrinter(p: Printer) {
  if (p.kind !== 'system') {
    if (!p.ref) throw new Error('Cherchez d’abord l’imprimante.');
    await writeRaw(p.kind, p.ref, new Uint8Array([0x1b, 0x40]), rawOpts(p));
  }
  await savePrinter({ ...p, paused: false });
}

/** Imprime vers un choix (imprimante, poste partagé ou image). Renvoie un message pour l'utilisateur. */
export async function printTo(targetId: string, doc: PrintDoc, copies = 1): Promise<string> {
  await setMeta('printDefault', targetId);
  if (targetId === SHARE_TARGET) { await shareImage(doc, '58', company().logo ?? ''); return 'Image prête'; }
  if (targetId.startsWith('station:')) {
    const stationId = targetId.slice(8);
    const st = get<PrintStation>('printStations', stationId);
    if (!getCloud()) throw new Error('Le cloud n’est pas relié : impossible d’envoyer au poste d’impression.');
    const [job] = await save('printJobs', { stationId, doc, copies, status: 'pending', byName: currentUser()?.fullName, fromDevice: getMeta('deviceId', '') });
    watchJob(job.id);
    syncNow();
    return st?.alert
      ? `Envoyé à « ${st.name} » : le ticket attend qu’on clique « Reconnecter l’imprimante » sur ce poste`
      : `Envoyé à « ${st?.name ?? 'poste'} » : impression dans quelques secondes`;
  }
  const p = findPrinter(targetId);
  if (!p) throw new Error('Imprimante introuvable sur cet appareil.');
  await printOn(p, doc, copies);
  return p.kind === 'system' ? 'Fenêtre d’impression ouverte' : `Imprimé sur « ${p.name} »`;
}

/** Impression rapide sur le choix habituel de l'appareil (ex. ticket automatique après une vente). */
export function defaultTarget(): string {
  const d = getMeta<string>('printDefault', '');
  if (d === SYSTEM_PRINTER.id || d === SHARE_TARGET) return d;
  if (d.startsWith('station:') && get('printStations', d.slice(8))) return d;
  if (getPrinters().some((p) => p.id === d)) return d;
  return getPrinters()[0]?.id ?? SYSTEM_PRINTER.id;
}

// ---------- Historique des impressions envoyées aux postes ----------
/** Réessayer un ticket en attente ou en erreur. */
export const retryJob = (j: PrintJob) => save('printJobs', { id: j.id, status: 'pending', error: '', retryAt: nowIso() }).then(() => syncNow());
/** Réimprimer un ticket déjà sorti (nouvel envoi). */
export async function reprintJob(j: PrintJob) {
  const [n] = await save('printJobs', { stationId: j.stationId, doc: j.doc, copies: j.copies || 1, status: 'pending', byName: currentUser()?.fullName, fromDevice: getMeta('deviceId', '') });
  watchJob(n.id);
  syncNow();
}
export async function cancelJobs(ids: string[]) { for (const id of ids) await remove('printJobs', id); syncNow(); }

// ---------- Côté expéditeur : prévenu quand le ticket est sorti ----------
const watched = new Map<string, number>();
function watchJob(id: string) { watched.set(id, Date.now()); }
/** Notifications « Ticket imprimé » / « n'a pas pu imprimer » / encore en attente après 25 s. */
export function usePrintJobWatcher() {
  const jobs = useTable<PrintJob>('printJobs');
  useEffect(() => {
    for (const [id, at] of [...watched]) {
      const j = jobs.find((x) => x.id === id);
      if (!j) { if (Date.now() - at > 60_000) watched.delete(id); continue; }
      const st = get<PrintStation>('printStations', j.stationId);
      if (j.status === 'done') { watched.delete(id); toast(`Ticket imprimé sur « ${st?.name ?? 'poste'} »`, 'ok', { ms: 10_000 }); }
      else if (j.status === 'error') { watched.delete(id); toast(`Le poste « ${st?.name ?? 'poste'} » n’a pas pu imprimer : ${j.error || 'erreur inconnue'}`, 'error', { sticky: true }); }
    }
  }, [jobs]);
  useEffect(() => {
    const t = setInterval(() => {
      for (const [id, at] of [...watched]) {
        if (Date.now() - at < 25_000) continue;
        const j = get<PrintJob>('printJobs', id);
        if (!j || j.status !== 'pending') continue;
        watched.set(id, Infinity); // une seule alerte
        const st = get<PrintStation>('printStations', j.stationId);
        const why = !st ? 'le poste a été retiré' : st.alert ? 'son imprimante est à reconnecter : cliquez « Reconnecter l’imprimante » sur le poste' : !stationOnline(st) ? 'le poste semble éteint ou hors ligne' : 'le poste ne l’a pas encore reçu (connexion lente ?)';
        toast(`Ticket encore en attente sur « ${st?.name ?? 'poste'} » : ${why}.`, 'error', { sticky: true });
      }
    }, 5_000);
    return () => clearInterval(t);
  }, []);
}

// ---------- Poste d'impression partagé ----------
export async function makeStation(name: string, printerId: string) {
  const p = findPrinter(printerId);
  // Faire de cet appareil un poste reprend une imprimante déconnectée.
  if (p?.paused) { try { await reconnectPrinter(p); } catch { await savePrinter({ ...p, paused: false }); } }
  const prev = getMeta<{ stationId: string } | null>('myStation', null);
  const [st] = await save('printStations', { id: prev?.stationId || newId(), name, printerName: p?.name, paper: p?.paper, lastSeen: nowIso(), deviceId: getMeta('deviceId', ''), alert: null });
  await setMeta('myStation', { stationId: st.id, printerId });
}
export async function stopStation() {
  const mine = getMeta<{ stationId: string } | null>('myStation', null);
  if (mine) await remove('printStations', mine.stationId);
  await setMeta('myStation', null);
}

/** Erreurs qui viennent de l'imprimante ou du navigateur (geste nécessaire) : le ticket reste en attente. */
export function needsGesture(e: any): boolean {
  const n = e?.name ?? '';
  if (['SecurityError', 'NotFoundError', 'NotAllowedError', 'NetworkError', 'InvalidStateError', 'PrinterPaused'].includes(n)) return true;
  return /gesture|geste|gatt|disconnected|déconnect|not connected|user activation/i.test(String(e?.message ?? e));
}
async function setAlert(stationId: string, alert: string | null) {
  const st = get<PrintStation>('printStations', stationId);
  if (st && (st.alert ?? null) !== alert) await save('printStations', { id: stationId, alert });
}
/** Sur le poste : « Reconnecter l'imprimante » (geste de l'utilisateur), retire l'alerte et relance la file. */
export async function reconnectStation() {
  const mine = getMeta<{ stationId: string; printerId: string } | null>('myStation', null);
  if (!mine) return;
  const p = findPrinter(mine.printerId);
  if (!p) throw new Error('Imprimante du poste introuvable');
  await reconnectPrinter(p);
  await setAlert(mine.stationId, null);
  kick();
}

let kick = () => {};
const busy = new Set<string>();
const jobKey = (j: PrintJob) => `${j.id}|${j.retryAt ?? ''}`;

/** Tourne sur le poste d'impression : imprime les tickets envoyés par les autres appareils. */
export function usePrintStationWorker() {
  const mine = useMeta<{ stationId: string; printerId: string } | null>('myStation', null);
  const jobs = useTable<PrintJob>('printJobs');
  useEffect(() => {
    if (!mine) return;
    const beat = () => save('printStations', { id: mine.stationId, lastSeen: nowIso() });
    beat();
    const b = setInterval(beat, 60_000);
    const s = setInterval(() => syncNow(), 5_000); // récupère vite les impressions demandées
    return () => { clearInterval(b); clearInterval(s); };
  }, [mine?.stationId]);
  useEffect(() => {
    if (!mine) return;
    let stopped = false;
    const run = async (auto = false) => {
      const todo = all<PrintJob>('printJobs').filter((j) => j.stationId === mine.stationId && j.status === 'pending' && Date.now() - new Date(j.createdAt).getTime() < 24 * 3600_000 && !busy.has(jobKey(j)));
      if (!todo.length) return;
      for (const j of todo.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (stopped) return;
        const k = jobKey(j);
        busy.add(k);
        const p = findPrinter(mine.printerId);
        try {
          if (!p) throw new Error('Imprimante du poste introuvable');
          await printOn(p, j.doc, j.copies || 1);
          await save('printJobs', { id: j.id, status: 'done', printedAt: nowIso(), error: '' });
          await setAlert(mine.stationId, null); // une impression réussie retire l'alerte
        } catch (e: any) {
          if (needsGesture(e)) {
            // Le navigateur exige un clic (ou l'imprimante est déconnectée) : le ticket reste en attente.
            busy.delete(k);
            await setAlert(mine.stationId, e?.message ?? String(e));
            return;
          }
          await save('printJobs', { id: j.id, status: 'error', error: e?.message ?? String(e) });
        }
      }
      // Ménage : les impressions de plus de 7 jours sont effacées.
      for (const old of all<PrintJob>('printJobs').filter((x) => x.status !== 'pending' && Date.now() - new Date(x.createdAt).getTime() > 7 * 24 * 3600_000)) await remove('printJobs', old.id);
      void auto;
    };
    kick = () => { for (const k of [...busy]) if (!all<PrintJob>('printJobs').some((j) => jobKey(j) === k && j.status === 'pending')) busy.delete(k); void run(); };
    void run();
    // Nouvel essai automatique toutes les 20 s (ex. imprimante rallumée).
    const t = setInterval(() => void run(true), 20_000);
    return () => { stopped = true; clearInterval(t); };
  }, [jobs, mine?.stationId, mine?.printerId]);
}
/** Le poste affiche ce bandeau : imprimante à reconnecter + tickets en attente. */
export function useStationAlert(): { station: PrintStation; waiting: number } | null {
  const mine = useMeta<{ stationId: string } | null>('myStation', null);
  const stations = useTable<PrintStation>('printStations');
  const jobs = useTable<PrintJob>('printJobs');
  const st = stations.find((s) => s.id === mine?.stationId);
  if (!st?.alert) return null;
  return { station: st, waiting: jobs.filter((j) => j.stationId === st.id && j.status === 'pending').length };
}
