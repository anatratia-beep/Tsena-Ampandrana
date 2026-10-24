// Moyens d'impression : Bluetooth, USB, port série (navigateurs Chrome/Edge), fenêtre d'impression
// du système (tous les appareils) et image à partager (WhatsApp, enregistrer…).
import { layout, logoFor, type Paper, type PrintDoc, type Row } from './doc';
import { qrMatrix, qrSvg } from '../qr';

const nav = navigator as any;
export const support = {
  bluetooth: !!nav.bluetooth,
  usb: !!nav.usb,
  serial: !!nav.serial,
  share: !!nav.share && !!nav.canShare,
};

// ---------- Bluetooth (BLE) ----------
// Services utilisés par la plupart des imprimantes à tickets Bluetooth du marché.
const BT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb', '0000af30-0000-1000-8000-00805f9b34fb', '0000ae00-0000-1000-8000-00805f9b34fb',
];
const btDevices = new Map<string, any>();
const btChars = new Map<string, any>();
const btNames = new Map<string, string>();

// ---------- État de la liaison (vert : connectée ; rouge : à reconnecter) ----------
export type LinkState = 'connected' | 'disconnected' | 'unknown';
const linkSubs = new Set<() => void>();
export const onLinkChange = (f: () => void) => { linkSubs.add(f); return () => { linkSubs.delete(f); }; };
const linkChanged = () => linkSubs.forEach((f) => f());
const usbOpen = new Set<string>();
const serialOpen = new Set<string>();
/** État actuel de la liaison avec l'imprimante (sans rien envoyer). */
export function linkState(kind: 'bluetooth' | 'usb' | 'serial', ref: string): LinkState {
  if (kind === 'bluetooth') { const d = btDevices.get(ref); return d?.gatt?.connected && btChars.has(ref) ? 'connected' : 'disconnected'; }
  if (kind === 'usb') return usbOpen.has(ref) ? 'connected' : 'disconnected';
  return serialOpen.has(ref) ? 'connected' : 'disconnected';
}
/** Reconnexion automatique quand la liaison Bluetooth lâche (imprimante en veille, téléphone en veille…). */
let autoReconnect = false;
export const setAutoReconnect = (on: boolean) => { autoReconnect = on; };
function watchDevice(ref: string, dev: any) {
  if (dev.__tsenaWatch) return;
  dev.__tsenaWatch = true;
  dev.addEventListener?.('gattserverdisconnected', () => {
    btChars.delete(ref); linkChanged();
    if (!autoReconnect) return;
    // Pas besoin de geste de l'utilisateur pour se reconnecter à un appareil déjà autorisé.
    let n = 0;
    const retry = async () => {
      if (!autoReconnect || dev.gatt.connected) return;
      try { await btCharacteristic(ref, undefined, true); linkChanged(); }
      catch { if (++n < 8) setTimeout(retry, Math.min(30_000, 1000 * 2 ** n)); }
    };
    setTimeout(retry, 500);
  });
}

export async function pairBluetooth(): Promise<{ ref: string; name: string }> {
  if (!support.bluetooth) throw new Error('Bluetooth non disponible sur ce navigateur. Ouvrez Trésor en ligne dans Google Chrome ou Microsoft Edge.');
  const dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  btDevices.set(dev.id, dev);
  if (dev.name) btNames.set(dev.id, dev.name);
  await btCharacteristic(dev.id);
  return { ref: dev.id, name: dev.name || 'Imprimante Bluetooth' };
}

async function btCharacteristic(ref: string, name?: string, fresh = false): Promise<any> {
  let dev = btDevices.get(ref);
  if (!dev && nav.bluetooth.getDevices) dev = (await nav.bluetooth.getDevices()).find((d: any) => d.id === ref);
  const nm = name || btNames.get(ref);
  if (!dev) {
    // Le navigateur a oublié l'imprimante (après redémarrage) : on la redemande, la liste ne montre qu'elle.
    dev = await nav.bluetooth.requestDevice(nm
      ? { filters: [{ name: nm }, { namePrefix: nm.slice(0, Math.min(nm.length, 8)) }], optionalServices: BT_SERVICES }
      : { acceptAllDevices: true, optionalServices: BT_SERVICES });
  }
  btDevices.set(ref, dev);
  if (dev.name) btNames.set(ref, dev.name);
  watchDevice(ref, dev);
  const cached = btChars.get(ref);
  if (cached && dev.gatt.connected && !fresh) return cached;
  const server = await dev.gatt.connect();
  const services = await server.getPrimaryServices();
  // Écriture avec accusé de réception de préférence (plus sûre), sinon sans accusé.
  let fallback: any = null;
  for (const sv of services) {
    for (const ch of await sv.getCharacteristics()) {
      if (ch.properties.write) { btChars.set(ref, ch); linkChanged(); return ch; }
      if (ch.properties.writeWithoutResponse && !fallback) fallback = ch;
    }
  }
  if (fallback) { btChars.set(ref, fallback); linkChanged(); return fallback; }
  throw new Error('Cette imprimante Bluetooth n’accepte pas l’impression directe. Elle utilise peut-être le Bluetooth classique : appairez-la dans les réglages Bluetooth de l’appareil puis choisissez « Port série / Bluetooth appairé ».');
}

/** Taille des paquets Bluetooth : sur Android la liaison n'accepte souvent que 20 octets (au-delà, le ticket s'arrête au milieu). */
export type BtSpeed = 'safe' | 'fast' | 'max';
export const BT_SPEEDS: Record<BtSpeed, string> = { safe: 'Sûr (petits paquets, recommandé)', fast: 'Rapide', max: 'Très rapide (peut couper le ticket)' };
const BT_CHUNK: Record<BtSpeed, number> = { safe: 20, fast: 100, max: 180 };

async function writeBluetooth(ref: string, data: Uint8Array, speed: BtSpeed = 'safe', name?: string) {
  let ch = await btCharacteristic(ref, name);
  const size = BT_CHUNK[speed] ?? 20;
  for (let i = 0; i < data.length; i += size) {
    const part = data.slice(i, i + size);
    for (let attempt = 0; ; attempt++) {
      try {
        if (ch.properties.write) await (ch.writeValueWithResponse ? ch.writeValueWithResponse(part) : ch.writeValue(part));
        else { await (ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(part) : ch.writeValue(part)); await sleep(8); }
        break;
      } catch (e: any) {
        // Paquet refusé (« GATT operation already in progress », liaison lâchée) : on attend et on renvoie.
        if (attempt >= 6) throw new Error(`Envoi Bluetooth interrompu (${Math.round((i / data.length) * 100)} % envoyé) : ${e?.message ?? e}`);
        await sleep(30 * (attempt + 1));
        if (!btDevices.get(ref)?.gatt?.connected) ch = await btCharacteristic(ref, name, true);
      }
    }
  }
}

// ---------- USB ----------
const usbRef = (d: any) => `${d.vendorId}:${d.productId}:${d.serialNumber || ''}`;
export async function pairUsb(): Promise<{ ref: string; name: string }> {
  if (!support.usb) throw new Error('USB direct non disponible sur ce navigateur. Ouvrez Trésor en ligne dans Google Chrome ou Microsoft Edge.');
  const d = await nav.usb.requestDevice({ filters: [] });
  return { ref: usbRef(d), name: d.productName || 'Imprimante USB' };
}
async function writeUsb(ref: string, data: Uint8Array) {
  let d = (await nav.usb.getDevices()).find((x: any) => usbRef(x) === ref);
  if (!d) d = await nav.usb.requestDevice({ filters: [] });
  if (!d.opened) await d.open();
  usbOpen.add(ref); linkChanged();
  if (!d.configuration) await d.selectConfiguration(1);
  for (const itf of d.configuration.interfaces) {
    for (const alt of itf.alternates) {
      const ep = alt.endpoints.find((e: any) => e.direction === 'out' && e.type === 'bulk');
      if (!ep) continue;
      if (!itf.claimed) await d.claimInterface(itf.interfaceNumber);
      for (let i = 0; i < data.length; i += 4096) await d.transferOut(ep.endpointNumber, data.slice(i, i + 4096));
      return;
    }
  }
  throw new Error('Impossible d’écrire sur cette imprimante USB. Sur Windows, utilisez plutôt « Port série » ou la fenêtre d’impression.');
}

// ---------- Port série (USB-série, ou Bluetooth classique appairé : Mac, PC, Android) ----------
const SPP = '00001101-0000-1000-8000-00805f9b34fb'; // profil « port série » du Bluetooth classique
async function requestSerial() {
  try { return await nav.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] }); }
  catch (e: any) { if (e?.name === 'TypeError') return nav.serial.requestPort(); throw e; }
}
export async function pairSerial(): Promise<{ ref: string; name: string }> {
  if (!support.serial) throw new Error('Port série non disponible sur ce navigateur. Ouvrez Trésor en ligne dans Google Chrome ou Microsoft Edge (sur Android : mettez à jour Google Chrome).');
  const port = await requestSerial();
  const info = port.getInfo?.() || {};
  const ports = await nav.serial.getPorts();
  return { ref: `${info.usbVendorId ?? ''}:${info.usbProductId ?? ''}:${ports.indexOf(port)}`, name: info.usbVendorId ? 'Imprimante (port série USB)' : 'Imprimante (port série Bluetooth)' };
}
async function findSerial(ref: string) {
  const [vid, pid, idx] = ref.split(':');
  const ports = await nav.serial.getPorts();
  return ports.find((p: any) => { const i = p.getInfo?.() || {}; return vid && String(i.usbVendorId) === vid && String(i.usbProductId) === pid; }) || ports[Number(idx)];
}
async function writeSerial(ref: string, data: Uint8Array, baud: number) {
  let port = await findSerial(ref);
  if (!port) port = await requestSerial();
  if (!port.writable) {
    try { await port.open({ baudRate: baud || 9600 }); serialOpen.add(ref); linkChanged(); }
    catch (e: any) { throw new Error(`Impossible d’ouvrir l’imprimante (port série) : vérifiez qu’elle est allumée, appairée et qu’aucune autre application ne l’utilise. (${e?.message ?? e})`); }
  }
  const w = port.writable.getWriter();
  try { await w.write(data); } finally { w.releaseLock(); }
}

export interface RawOpts { baud?: number; btSpeed?: BtSpeed; name?: string }
/**
 * Reconnecte sans geste de l'utilisateur quand c'est possible (imprimante déjà autorisée et connue de cette page).
 * Renvoie false s'il faut un clic (le navigateur a oublié l'imprimante).
 */
export async function connectSilently(kind: 'bluetooth' | 'usb' | 'serial', ref: string, o: RawOpts = {}): Promise<boolean> {
  try {
    if (kind === 'bluetooth') {
      let dev = btDevices.get(ref);
      if (!dev && nav.bluetooth?.getDevices) dev = (await nav.bluetooth.getDevices()).find((d: any) => d.id === ref);
      if (!dev) return false;
      btDevices.set(ref, dev);
      await btCharacteristic(ref, o.name, !dev.gatt.connected);
      return true;
    }
    if (kind === 'usb') {
      const d = (await nav.usb?.getDevices?.() ?? []).find((x: any) => usbRef(x) === ref);
      if (!d) return false;
      if (!d.opened) await d.open();
      usbOpen.add(ref); linkChanged();
      return true;
    }
    const port = await findSerial(ref);
    if (!port) return false;
    if (!port.writable) await port.open({ baudRate: o.baud || 9600 });
    serialOpen.add(ref); linkChanged();
    return true;
  } catch { return false; }
}
export async function writeRaw(kind: 'bluetooth' | 'usb' | 'serial', ref: string, data: Uint8Array, o: RawOpts = {}) {
  if (kind === 'bluetooth') return writeBluetooth(ref, data, o.btSpeed, o.name);
  if (kind === 'usb') return writeUsb(ref, data);
  return writeSerial(ref, data, o.baud || 9600);
}

/** Libère l'imprimante (une imprimante Bluetooth ne se connecte qu'à un appareil à la fois). */
export async function disconnectRaw(kind: 'bluetooth' | 'usb' | 'serial', ref: string) {
  try {
    if (kind === 'bluetooth') {
      let dev = btDevices.get(ref);
      if (!dev && nav.bluetooth?.getDevices) dev = (await nav.bluetooth.getDevices()).find((d: any) => d.id === ref);
      if (dev?.gatt?.connected) dev.gatt.disconnect();
      btChars.delete(ref); btDevices.delete(ref);
      if (dev?.forget) await dev.forget().catch(() => {});
    } else if (kind === 'usb') {
      const d = (await nav.usb.getDevices()).find((x: any) => usbRef(x) === ref);
      usbOpen.delete(ref);
      if (d?.opened) await d.close();
    } else {
      const port = await findSerial(ref);
      serialOpen.delete(ref);
      if (port?.writable || port?.readable) await port.close();
    }
  } catch { /* déjà libérée */ }
  linkChanged();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Rendu HTML (aperçu et fenêtre d'impression) ----------
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
export function docHtml(doc: PrintDoc, paper: Paper, logo?: string | null): string {
  const cols = paper === '58' ? 32 : 48;
  return layout(doc, cols).map((r: Row) => {
    if (r.logo) { const src = logoFor(r, logo); return src ? `<div class="tk-logo"><img src="${src}" alt=""></div>` : ''; }
    if (r.cut) return '<div class="tk-cut"></div>';
    if (r.qr) return `<div class="tk-qr">${qrSvg(r.qr, 2)}</div>`;
    const cls = [r.bold && 'b', r.big && 'big', r.tall && 'tall'].filter(Boolean).join(' ');
    return `<div class="tk-row ${cls}">${esc(r.s) || '&nbsp;'}</div>`;
  }).join('') + '<div class="tk-bottom" aria-hidden="true"></div>';
}

/** Ouvre la fenêtre d'impression de l'appareil (AirPrint sur iPhone, imprimantes installées sur Windows/Mac…). */
export function systemPrint(doc: PrintDoc, paper: Paper, logo?: string | null, copies = 1): Promise<void> {
  return new Promise((resolve) => {
    const lay = layout(doc, paper === '58' ? 32 : 48);
    const rows = lay.length + lay.filter((r) => r.qr).length * 7;
    const area = document.createElement('div');
    area.className = `print-area ticket paper-${paper}`;
    const one = `<div class="tk-page">${docHtml(doc, paper, logo)}</div>`;
    area.innerHTML = Array.from({ length: Math.max(1, copies) }, () => one).join('');
    const style = document.createElement('style');
    const width = paper === '58' ? 58 : 80;
    style.textContent = paper === 'a4' ? '@page { size: A4; margin: 14mm; }'
      : `@page { size: ${width}mm ${Math.max(60, Math.ceil(rows * 4.4 * copies + 20))}mm; margin: 0; }`;
    document.head.appendChild(style);
    document.body.appendChild(area);
    document.body.classList.add('printing');
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      document.body.classList.remove('printing');
      area.remove(); style.remove();
      resolve();
    };
    window.addEventListener('afterprint', () => setTimeout(finish, 300), { once: true });
    const imgs = [...area.querySelectorAll('img')].map((i) => i.decode().catch(() => null));
    Promise.all(imgs).then(() => {
      setTimeout(() => {
        window.print();
        setTimeout(finish, 1500); // certains navigateurs n'envoient pas « afterprint »
      }, 50);
    });
  });
}

// ---------- Image du ticket (à partager) ----------
export async function docImage(doc: PrintDoc, paper: Paper, logo?: string | null): Promise<Blob> {
  const cols = paper === '58' ? 32 : 48;
  const rows = layout(doc, cols);
  const scale = 2, charW = 12, lineH = 26, pad = 24;
  const width = cols * charW + pad * 2;
  // Un logo par ligne « logo » (plusieurs étiquettes de pages différentes dans un même document).
  const imgs = new Map<string, HTMLImageElement | null>();
  for (const r of rows) { const src = r.logo ? logoFor(r, logo) : undefined; if (src && !imgs.has(src)) { const im = new Image(); im.src = src; try { await im.decode(); imgs.set(src, im); } catch { imgs.set(src, null); } } }
  const imgOf = (r: Row) => { const src = logoFor(r, logo); return src ? imgs.get(src) ?? null : null; };
  const hOf = (im: HTMLImageElement | null) => (im ? Math.min(140, (im.height * Math.min(width * 0.5, im.width)) / im.width) : 0);
  const qrPx = 3;
  const qrH = (r: Row) => (qrMatrix(r.qr!).length + 8) * qrPx;
  const bottom = 80; // 2 cm d'espace blanc en bas, comme sur le papier
  const height = pad * 2 + bottom + rows.reduce((h, r) => h + (r.qr ? qrH(r) : r.logo ? (imgOf(r) ? hOf(imgOf(r)) + 10 : 0) : r.cut ? 30 : r.big || r.tall ? lineH * 2 : lineH), 0);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111'; ctx.textBaseline = 'top';
  let y = pad;
  for (const r of rows) {
    if (r.logo) {
      const im = imgOf(r);
      if (im) { const lh = hOf(im); const w = (im.width * lh) / im.height; ctx.drawImage(im, (width - w) / 2, y, w, lh); y += lh + 10; }
      continue;
    }
    if (r.qr) {
      const m = qrMatrix(r.qr), s = (m.length + 8) * qrPx, x0 = (width - s) / 2;
      m.forEach((row, yy) => row.forEach((on, xx) => { if (on) ctx.fillRect(x0 + (xx + 4) * qrPx, y + (yy + 4) * qrPx, qrPx, qrPx); }));
      y += s; continue;
    }
    if (r.cut) { ctx.setLineDash([6, 6]); ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(pad, y + 15); ctx.lineTo(width - pad, y + 15); ctx.stroke(); ctx.setLineDash([]); y += 30; continue; }
    const size = r.big ? 40 : 20;
    ctx.font = `${r.bold ? 'bold ' : ''}${size}px "Courier New", ui-monospace, monospace`;
    // Chaque caractère dans sa case : alignement exact des colonnes. « tall » : double hauteur, largeur normale.
    const cw = r.big ? charW * 2 : charW;
    if (r.tall && !r.big) { ctx.save(); ctx.scale(1, 2); [...r.s].forEach((ch, i) => ctx.fillText(ch, pad + i * cw, (y + 2) / 2)); ctx.restore(); }
    else [...r.s].forEach((ch, i) => ctx.fillText(ch, pad + i * cw, y + (r.big ? 4 : 2)));
    y += r.big || r.tall ? lineH * 2 : lineH;
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image impossible'))), 'image/png'));
}

export async function shareImage(doc: PrintDoc, paper: Paper, logo?: string | null) {
  const blob = await docImage(doc, paper, logo);
  const name = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.png';
  const file = new File([blob], name || 'ticket.png', { type: 'image/png' });
  if (support.share && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title: doc.title }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
