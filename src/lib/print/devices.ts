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

export async function pairBluetooth(): Promise<{ ref: string; name: string }> {
  if (!support.bluetooth) throw new Error('Bluetooth non disponible sur ce navigateur. Utilisez Chrome sur Android ou sur ordinateur.');
  const dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  btDevices.set(dev.id, dev);
  await btCharacteristic(dev.id);
  return { ref: dev.id, name: dev.name || 'Imprimante Bluetooth' };
}

async function btCharacteristic(ref: string): Promise<any> {
  let dev = btDevices.get(ref);
  if (!dev && nav.bluetooth.getDevices) dev = (await nav.bluetooth.getDevices()).find((d: any) => d.id === ref);
  if (!dev) {
    // Le navigateur a oublié l'imprimante (après redémarrage) : on la redemande.
    dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  }
  btDevices.set(ref, dev);
  const cached = btChars.get(ref);
  if (cached && dev.gatt.connected) return cached;
  const server = await dev.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const s of services) {
    for (const ch of await s.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) { btChars.set(ref, ch); return ch; }
    }
  }
  throw new Error('Cette imprimante Bluetooth n’accepte pas l’impression directe.');
}

async function writeBluetooth(ref: string, data: Uint8Array) {
  const ch = await btCharacteristic(ref);
  const size = 180;
  for (let i = 0; i < data.length; i += size) {
    const part = data.slice(i, i + size);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) { await ch.writeValueWithoutResponse(part); await sleep(25); }
    else await (ch.writeValueWithResponse ? ch.writeValueWithResponse(part) : ch.writeValue(part));
  }
}

// ---------- USB ----------
const usbRef = (d: any) => `${d.vendorId}:${d.productId}:${d.serialNumber || ''}`;
export async function pairUsb(): Promise<{ ref: string; name: string }> {
  if (!support.usb) throw new Error('USB direct non disponible sur ce navigateur. Utilisez Chrome ou Edge sur ordinateur.');
  const d = await nav.usb.requestDevice({ filters: [] });
  return { ref: usbRef(d), name: d.productName || 'Imprimante USB' };
}
async function writeUsb(ref: string, data: Uint8Array) {
  let d = (await nav.usb.getDevices()).find((x: any) => usbRef(x) === ref);
  if (!d) d = await nav.usb.requestDevice({ filters: [] });
  if (!d.opened) await d.open();
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

// ---------- Port série (USB-série, ou Bluetooth appairé dans Windows/macOS) ----------
export async function pairSerial(): Promise<{ ref: string; name: string }> {
  if (!support.serial) throw new Error('Port série non disponible sur ce navigateur. Utilisez Chrome ou Edge sur ordinateur.');
  const port = await nav.serial.requestPort();
  const info = port.getInfo?.() || {};
  const ports = await nav.serial.getPorts();
  return { ref: `${info.usbVendorId ?? ''}:${info.usbProductId ?? ''}:${ports.indexOf(port)}`, name: info.usbVendorId ? 'Imprimante (port série USB)' : 'Imprimante (port série Bluetooth)' };
}
async function writeSerial(ref: string, data: Uint8Array, baud: number) {
  const [vid, pid, idx] = ref.split(':');
  const ports = await nav.serial.getPorts();
  let port = ports.find((p: any) => { const i = p.getInfo?.() || {}; return vid && String(i.usbVendorId) === vid && String(i.usbProductId) === pid; }) || ports[Number(idx)];
  if (!port) port = await nav.serial.requestPort();
  if (!port.writable) await port.open({ baudRate: baud || 9600 });
  const w = port.writable.getWriter();
  try { await w.write(data); } finally { w.releaseLock(); }
}

export async function writeRaw(kind: 'bluetooth' | 'usb' | 'serial', ref: string, data: Uint8Array, baud?: number) {
  if (kind === 'bluetooth') return writeBluetooth(ref, data);
  if (kind === 'usb') return writeUsb(ref, data);
  return writeSerial(ref, data, baud || 9600);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Rendu HTML (aperçu et fenêtre d'impression) ----------
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
export function docHtml(doc: PrintDoc, paper: Paper, logo?: string | null): string {
  const cols = paper === '58' ? 32 : 48;
  return layout(doc, cols).map((r: Row) => {
    if (r.logo) { const src = logoFor(r, logo); return src ? `<div class="tk-logo"><img src="${src}" alt=""></div>` : ''; }
    if (r.cut) return '<div class="tk-cut"></div>';
    if (r.qr) return `<div class="tk-qr">${qrSvg(r.qr, 3)}</div>`;
    const cls = [r.bold && 'b', r.big && 'big'].filter(Boolean).join(' ');
    return `<div class="tk-row ${cls}">${esc(r.s) || '&nbsp;'}</div>`;
  }).join('');
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
  const qrPx = 5;
  const qrH = (r: Row) => (qrMatrix(r.qr!).length + 8) * qrPx;
  const height = pad * 2 + rows.reduce((h, r) => h + (r.qr ? qrH(r) : r.logo ? (imgOf(r) ? hOf(imgOf(r)) + 10 : 0) : r.cut ? 30 : r.big ? lineH * 2 : lineH), 0);
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
    // Chaque caractère dans sa case : alignement exact des colonnes.
    const cw = r.big ? charW * 2 : charW;
    [...r.s].forEach((ch, i) => ctx.fillText(ch, pad + i * cw, y + (r.big ? 4 : 2)));
    y += r.big ? lineH * 2 : lineH;
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
