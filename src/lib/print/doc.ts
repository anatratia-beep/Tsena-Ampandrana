// Documents imprimables (ticket de caisse, bon de livraison, feuille de route, page de test).
// Un document est une suite de blocs indépendants de l'imprimante : la mise en page (32 colonnes
// pour le 58 mm, 48 pour le 80 mm) est faite au moment d'imprimer.
import { get } from '../db';
import { fmtAr, fmtNum, variantLabel, type Category, type Product, type Variant } from '../catalog';
import { variantPage } from '../scope';
import {
  CHANNELS, courierSplit, exchangeBalance, fmtPhone, isPickupZone, isWalkIn, itemsTotal, keptTotal, orderTotal, PAY_METHODS, paidTotal, remaining, sellingLines,
  type Courier, type Order, type Zone,
} from '../orders';
import type { Company } from '../settings';
import { adjustKept, adjustLabel } from '../lots';

export type Block =
  | { k: 'text'; s: string; align?: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean }
  | { k: 'pair'; l: string; r: string; bold?: boolean; big?: boolean }
  | { k: 'line'; ch?: '-' | '=' }
  | { k: 'logo'; src?: string }   // src : logo propre à ce document (ex. logo de la page), sinon celui de la société
  | { k: 'qr'; data: string }
  | { k: 'feed'; n?: number }
  | { k: 'cut' };

export interface PrintDoc { title: string; blocks: Block[] }

export type Paper = '58' | '80' | 'a4';
export const PAPERS: Record<Paper, string> = { '58': 'Ticket 58 mm', '80': 'Ticket 80 mm', a4: 'Feuille A4' };
export const colsOf = (paper: Paper) => (paper === '58' ? 32 : 48);

// ---------- Mise en page en colonnes ----------
/** Espaces spéciaux (séparateurs de milliers français) → espace normal, pour que tout tienne en colonnes. */
export const clean = (s: string) => (s ?? '').replace(/[   ]/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-');

export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(s).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else { out.push(line); line = word; }
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    out.push(line);
  }
  return out;
}

export interface Row { s: string; bold?: boolean; big?: boolean; logo?: boolean; logoSrc?: string; cut?: boolean; qr?: string }

/**
 * Logo à dessiner pour une ligne « logo ». `allowed` : null = logos désactivés sur cette imprimante ;
 * sinon logo par défaut (société). Le logo propre au document (page) passe en premier.
 */
export const logoFor = (r: Row, allowed: string | null | undefined) => (allowed === null ? undefined : r.logoSrc || allowed || undefined);

/** Transforme les blocs en lignes de texte de largeur fixe (utilisé pour l'aperçu, l'image et l'imprimante). */
export function layout(doc: PrintDoc, cols: number): Row[] {
  const rows: Row[] = [];
  for (const b of doc.blocks) {
    if (b.k === 'logo') rows.push({ s: '', logo: true, logoSrc: b.src });
    else if (b.k === 'qr') rows.push({ s: '', qr: b.data });
    else if (b.k === 'cut') rows.push({ s: '', cut: true });
    else if (b.k === 'feed') for (let i = 0; i < (b.n ?? 1); i++) rows.push({ s: '' });
    else if (b.k === 'line') rows.push({ s: (b.ch ?? '-').repeat(cols) });
    else if (b.k === 'text') {
      const w = b.big ? Math.floor(cols / 2) : cols;
      for (const l of wrap(b.s, w)) {
        const pad = b.align === 'center' ? Math.floor((w - l.length) / 2) : b.align === 'right' ? w - l.length : 0;
        rows.push({ s: ' '.repeat(Math.max(0, pad)) + l, bold: b.bold, big: b.big });
      }
    } else {
      const r = clean(b.r);
      // Gros caractères : si le libellé et le montant ne tiennent pas sur une ligne, le libellé passe au-dessus.
      if (b.big && b.l.length + r.length + 1 > Math.floor(cols / 2)) {
        for (const l of wrap(b.l, cols)) rows.push({ s: l, bold: true });
        if (r.length <= Math.floor(cols / 2)) rows.push({ s: ' '.repeat(Math.floor(cols / 2) - r.length) + r, bold: true, big: true });
        else rows.push({ s: ' '.repeat(Math.max(0, cols - r.length)) + r, bold: true });
        continue;
      }
      const w = b.big ? Math.floor(cols / 2) : cols;
      const left = wrap(b.l, Math.max(4, w - r.length - 1));
      left.forEach((l, i) => {
        const last = i === left.length - 1;
        rows.push({ s: last ? l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r : l, bold: b.bold, big: b.big });
      });
    }
  }
  return rows;
}

export function joinDocs(title: string, docs: PrintDoc[]): PrintDoc {
  return { title, blocks: docs.flatMap((d, i) => (i < docs.length - 1 ? [...d.blocks, { k: 'cut' as const }] : d.blocks)) };
}

// ---------- Morceaux communs ----------
const T = (s: string, o: Partial<Extract<Block, { k: 'text' }>> = {}): Block => ({ k: 'text', s, ...o });
const P = (l: string, r: string, o: Partial<Extract<Block, { k: 'pair' }>> = {}): Block => ({ k: 'pair', l, r, ...o });
const L = (ch: '-' | '=' = '-'): Block => ({ k: 'line', ch });
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ar = (n: number) => fmtAr(n);

function header(c: Brand, withLogo = true): Block[] {
  const b: Block[] = [];
  if (withLogo && c.logo) b.push({ k: 'logo', src: c.pageId ? c.logo : undefined });
  b.push(T(c.name, { align: 'center', bold: true, big: true }));
  if (c.slogan) b.push(T(c.slogan, { align: 'center' }));
  if (c.address) b.push(T(c.address, { align: 'center' }));
  if (c.phone) b.push(T(`Tél : ${c.phone}`, { align: 'center' }));
  const ids = [c.nif && `NIF ${c.nif}`, c.stat && `STAT ${c.stat}`].filter(Boolean).join(' · ');
  if (ids) b.push(T(ids, { align: 'center' }));
  return b;
}

function itemName(variantId: string) {
  const v = get<Variant>('variants', variantId);
  const p = v && get<Product>('products', v.productId);
  const vl = variantLabel(v);
  return [p?.name || 'Article', vl && vl !== 'Unique' && !p?.attrs ? vl : ''].filter(Boolean).join(' - ');
}
function itemLines(variantId: string, qty: number, price: number, note = ''): Block[] {
  return [T(itemName(variantId) + note), P(`  ${fmtNum(qty)} x ${fmtNum(price)}`, ar(qty * price))];
}

// ---------- En-tête au nom de la page ----------
/** Société, ou page dont le nom (et le logo) figure en tête du ticket. */
export type Brand = Company & { pageId?: string };
/** Page principale d'une commande : celle qui pèse le plus en montant (articles vendus ou envoyés). */
export function orderPage(o: Pick<Order, 'lines'>): string {
  const sum = new Map<string, number>();
  for (const l of o.lines) { const p = variantPage(l.variantId); if (p) sum.set(p, (sum.get(p) ?? 0) + Math.max(1, l.qty * l.unitPrice)); }
  return [...sum.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
/**
 * Tickets, bons et étiquettes portent le nom de la page de la commande : nom affiché sur le ticket, logo, téléphone
 * et message de la page ; à défaut, ceux de la société. Adresse, NIF et STAT restent ceux de la société (même boutique).
 */
export function brandOf(o: Pick<Order, 'lines'>, c: Company): Brand {
  const pageId = orderPage(o);
  const pg = pageId ? get<Category>('categories', pageId) : undefined;
  if (!pg) return c;
  return { ...c, pageId, name: pg.ticketName?.trim() || pg.name, slogan: pg.slogan?.trim() || undefined, logo: pg.logo || c.logo, phone: pg.phone?.trim() || c.phone, ticketFooter: pg.ticketFooter?.trim() || c.ticketFooter };
}

// ---------- Ticket de caisse (vente sur place ou commande) ----------
export function ticketDoc(o: Order, company: Company, opts: { cashGiven?: number } = {}): PrintDoc {
  const c = brandOf(o, company);
  const closed = ['delivered', 'partial', 'refused'].includes(o.status);
  const walkIn = isWalkIn(o);
  const zone = get<Zone>('zones', o.zoneId || '');
  const courier = get<Courier>('couriers', o.courierId || '');
  const b: Block[] = [...header(c), L('=')];
  b.push(T(`${o.internal ? 'VENTE INTERNE' : walkIn ? 'TICKET' : o.kind === 'exchange' ? 'ÉCHANGE' : 'COMMANDE'} ${o.number}`, { align: 'center', bold: true }));
  b.push(T(dt(o.createdAt), { align: 'center' }));
  if (o.createdByName) b.push(T(`Vendeur : ${o.createdByName}`, { align: 'center' }));
  if (o.internal) { b.push(L()); b.push(T(`Employé : ${o.employeeName || '?'}`, { bold: true })); b.push(T('Prix de revient arrondi')); }
  if (o.name || o.phone) {
    b.push(L());
    if (o.name) b.push(T(`Client : ${o.name}`));
    if (o.phone) b.push(T(`Tél : ${fmtPhone(o.phone)}`));
  }
  if (!walkIn && zone) b.push(T(`Livraison : ${zone.name}${o.place && !isPickupZone(zone) ? ' - ' + o.place : ''}`));
  if (!walkIn && courier) b.push(T(`Livreur : ${courier.name}`));
  b.push(L());

  let count = 0;
  for (const l of o.lines) {
    const q = closed ? (l.qtyKept ?? 0) : l.isChoice ? 0 : l.qty;
    if (q > 0) { b.push(...itemLines(l.variantId, q, l.unitPrice)); count += q; }
  }
  const choices = closed ? [] : o.lines.filter((l) => l.isChoice);
  if (choices.length) {
    b.push(T('En choix (non compté) :', { bold: true }));
    for (const l of choices) b.push(T(`  ${fmtNum(l.qty)} x ${itemName(l.variantId)}`));
  }
  for (const a of o.adjusts || []) { const n = closed ? adjustKept(a, o.lines, o.adjusts!) : a.qty; if (n) b.push(P(adjustLabel(a), (n * a.unit < 0 ? '- ' : '') + ar(Math.abs(n * a.unit)))); }
  for (const r of o.returnLines || []) b.push(...itemLines(r.variantId, -r.qty, r.unitPrice, ' (repris)'));
  b.push(L());

  const items = closed ? keptTotal(o) : itemsTotal(o);
  const fee = closed ? (o.feeCharged ?? o.deliveryFee) : o.deliveryFee;
  b.push(P(`${fmtNum(count)} article(s)`, ar(items)));
  if (o.discount) b.push(P('Remise', '- ' + ar(o.discount)));
  if (o.credit) b.push(P('Articles repris', '- ' + ar(o.credit)));
  if (fee) b.push(P('Frais de livraison', ar(fee)));
  const due = o.kind === 'exchange' ? exchangeBalance(o) : orderTotal(o);
  b.push(P('TOTAL', ar(Math.max(0, due)), { bold: true, big: true }));
  const pays = o.payments || [];
  for (const p of pays) b.push(P(`Payé ${PAY_METHODS[p.method]}${p.ref ? ' ' + p.ref : ''}`, ar(p.amount)));
  const cashPaid = pays.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const given = opts.cashGiven ?? o.cashGiven;
  if (given && given > cashPaid) {
    b.push(P('Espèces reçues', ar(given)));
    b.push(P('Monnaie rendue', ar(given - cashPaid), { bold: true }));
  }
  const rest = due - paidTotal(o);
  if (rest > 0) b.push(P('RESTE À PAYER', ar(rest), { bold: true }));
  else if (rest < 0) b.push(P('À rendre au client', ar(-rest), { bold: true }));
  b.push(L('='));
  if (c.ticketFooter) b.push(T(c.ticketFooter, { align: 'center' }));
  b.push({ k: 'feed', n: 2 });
  return { title: `Ticket ${o.number}`, blocks: b };
}

// ---------- Bon de livraison (remis au livreur avec le colis) ----------
export function deliveryNoteDoc(o: Order, company: Company): PrintDoc {
  const c = brandOf(o, company);
  const zone = get<Zone>('zones', o.zoneId || '');
  const courier = get<Courier>('couriers', o.courierId || '');
  const b: Block[] = [...header(c, false), L('=')];
  b.push(T('BON DE LIVRAISON', { align: 'center', bold: true }));
  b.push(T(o.number, { align: 'center', bold: true, big: true }));
  b.push(T(dt(o.dispatchedAt || o.createdAt), { align: 'center' }));
  b.push(L());
  b.push(T(`Client : ${o.name || '-'}`, { bold: true }));
  if (o.phone) b.push(T(`Tél : ${fmtPhone(o.phone)}`, { bold: true }));
  b.push(T(`Lieu : ${zone?.name || '-'}${o.place ? ' - ' + o.place : ''}`));
  if (courier) b.push(T(`Livreur : ${courier.name}${courier.phone ? ' (' + fmtPhone(courier.phone) + ')' : ''}`));
  b.push(T(`Canal : ${CHANNELS[o.channel]}`));
  b.push(L());
  for (const l of o.lines) b.push(...itemLines(l.variantId, l.qty, l.unitPrice, l.isChoice ? ' (CHOIX)' : ''));
  for (const a of o.adjusts || []) b.push(P(adjustLabel(a), (a.unit < 0 ? '- ' : '') + ar(Math.abs(a.qty * a.unit))));
  if ((o.adjusts || []).some((a) => a.kind === 'lot')) b.push(T('LOT : prix du lot seulement si le client garde le lot complet.'));
  if (o.lines.some((l) => l.isChoice)) b.push(T('CHOIX : le client paie seulement ce qu’il garde, le reste revient à la boutique.'));
  b.push(L());
  const items = itemsTotal(o);
  b.push(P('Articles', ar(items)));
  if (o.discount) b.push(P('Remise', '- ' + ar(o.discount)));
  if (o.credit) b.push(P('Articles repris', '- ' + ar(o.credit)));
  b.push(P('Frais de livraison', ar(o.deliveryFee || 0)));
  const paid = paidTotal(o);
  if (paid) b.push(P('Déjà payé', '- ' + ar(paid)));
  b.push(P('LE CLIENT PAIE', ar(Math.max(0, remaining(o))), { bold: true, big: true }));
  { const x = courierSplit(o); b.push(P('  dont pour la boutique', ar(x.toCollect))); if (x.feeKept) b.push(P('  dont frais livreur', ar(x.feeKept))); if (x.feeOwed) b.push(T(`Frais livreur ${ar(x.feeOwed)} déjà payés à la boutique`)); }
  if (remaining(o) < 0) b.push(P('À rendre au client', ar(-remaining(o)), { bold: true }));
  if (o.notes) { b.push(L()); b.push(T(`Obs. : ${o.notes}`)); }
  b.push(L());
  b.push({ k: 'feed' });
  b.push(T('Signature client :'));
  b.push({ k: 'feed', n: 3 });
  return { title: `Bon de livraison ${o.number}`, blocks: b };
}

// ---------- Étiquette du colis (ticket 58 mm collé sur le colis pendant la préparation) ----------
export const orderUrl = (id: string) => (typeof location !== 'undefined' ? `${location.origin}${location.pathname}#/commandes/${id}` : id);
export function parcelLabelDoc(o: Order, company: Company): PrintDoc {
  const c = brandOf(o, company);
  const zone = get<Zone>('zones', o.zoneId || '');
  const courier = get<Courier>('couriers', o.courierId || '');
  const x = courierSplit(o);
  const rest = Math.max(0, remaining(o));
  const b: Block[] = [T(c.name, { align: 'center', bold: true }), L('=')];
  b.push(T(o.number, { align: 'center', bold: true, big: true }));
  b.push(L());
  b.push(T(o.name || 'Client', { bold: true, big: true }));
  if (o.phone) b.push(T(fmtPhone(o.phone), { bold: true, big: true }));
  b.push(T(`${zone?.name || ''}${o.place ? ' - ' + o.place : ''}`, { bold: true }));
  if (o.wantedDate) b.push(T(`Livraison souhaitée : ${new Date(o.wantedDate + 'T12:00:00').toLocaleDateString('fr-FR')}`));
  if (courier) b.push(T(`Livreur : ${courier.name}`));
  b.push(L());
  for (const l of o.lines) b.push(T(`${fmtNum(l.qty)} x ${itemName(l.variantId)}${l.isChoice ? ' (CHOIX)' : ''}`));
  if (o.lines.some((l) => l.isChoice)) b.push(T('CHOIX : le client paie seulement ce qu\u2019il garde.'));
  b.push(L());
  const items = itemsTotal(o);
  b.push(P('Articles', ar(items)));
  if (o.discount) b.push(P('Remise', '- ' + ar(o.discount)));
  if (o.credit) b.push(P('Articles repris', '- ' + ar(o.credit)));
  b.push(P('Frais de livraison', ar(o.deliveryFee || 0)));
  const pays = o.payments || [];
  for (const p of pays) b.push(P(`Déjà payé ${PAY_METHODS[p.method]}`, '- ' + ar(p.amount)));
  if (rest > 0) {
    b.push(P('À ENCAISSER', ar(rest), { bold: true, big: true }));
    b.push(P('  dont articles', ar(x.toCollect)));
    if (x.feeKept) b.push(P('  dont frais livraison', ar(x.feeKept)));
  } else b.push(T('RIEN À ENCAISSER - DÉJÀ PAYÉ', { align: 'center', bold: true }));
  if (o.notes) { b.push(L()); b.push(T(`Obs. : ${o.notes}`)); }
  b.push({ k: 'qr', data: orderUrl(o.id) });
  b.push(T(`Scanner pour ouvrir ${o.number}`, { align: 'center' }));
  b.push({ k: 'feed', n: 2 });
  return { title: `Étiquette ${o.number}`, blocks: b };
}

// ---------- Ticket des livraisons d'un livreur (feuille de route) ----------
/**
 * Remis au livreur avec ses colis. Il coche sur le papier ce qui est livré, pas livré ou retourné,
 * et le rapporte au versement (souvent le lendemain) : l'admin reporte ses remarques dans TSENA.
 */
export function routeSheetDoc(courier: Courier | undefined, orders: Order[], c: Company, title = 'LIVRAISONS DU LIVREUR'): PrintDoc {
  const b: Block[] = [T(c.name, { align: 'center', bold: true }), L('=')];
  b.push(T(title, { align: 'center', bold: true }));
  b.push(T(courier?.name || 'Livreur', { align: 'center', bold: true, big: true }));
  if (courier?.phone) b.push(T(fmtPhone(courier.phone), { align: 'center' }));
  b.push(T(`Imprimé le ${dt(new Date().toISOString())}`, { align: 'center' }));
  b.push(L());
  let collect = 0, fees = 0, owed = 0, clients = 0, pcs = 0;
  orders.forEach((o, i) => {
    const zone = get<Zone>('zones', o.zoneId || '');
    const closed = ['delivered', 'partial', 'refused'].includes(o.status);
    const x = courierSplit(o);
    collect += x.toCollect; fees += x.fee; owed += x.feeOwed; clients += x.clientPays; pcs += o.lines.reduce((t, l) => t + l.qty, 0);
    b.push(P(`${i + 1}. ${o.number}`, o.dispatchedAt ? dt(o.dispatchedAt).slice(0, 5) : '', { bold: true }));
    b.push(T(`${o.name ? o.name + ' - ' : ''}${fmtPhone(o.phone)}`));
    b.push(T(`${zone?.name || ''}${o.place ? ' - ' + o.place : ''}`));
    for (const l of o.lines) b.push(T(`  ${fmtNum(l.qty)} x ${itemName(l.variantId)}${l.isChoice ? ' (CHOIX)' : ''}`));
    b.push(P('À ENCAISSER', ar(x.toCollect), { bold: true }));
    if (!x.toCollect && x.feeOwed) b.push(T('Déjà payé par Mobile Money : rien à encaisser'));
    b.push(P(`  + frais livreur${x.feeOwed ? ' (déjà payés)' : ''}`, ar(x.fee)));
    b.push(P('  Le client paie au total', ar(x.clientPays)));
    if (closed) b.push(T(`Déjà saisi : ${o.status === 'refused' ? 'refusée' : o.status === 'partial' ? 'livrée en partie' : 'livrée'}`));
    else b.push(T('[ ] Livré  [ ] Pas livré  [ ] Retour'));
    if (o.notes) b.push(T(`Obs. : ${o.notes}`));
    b.push(T('Remarque : .....................'));
    b.push(L());
  });
  b.push(P(`${orders.length} livraison(s), ${fmtNum(pcs)} pcs`, ''));
  b.push(P('Info : total payé par les clients', ar(clients)));
  b.push(P('Info : frais livreur (gardés)', ar(fees - owed)));
  if (owed) b.push(P('Frais à reverser au livreur', '- ' + ar(owed), { bold: true }));
  b.push(P('TOTAL À VERSER', ar(collect - owed), { bold: true, big: true }));
  b.push(T('Les frais de livraison ne sont pas à verser : ils restent au livreur.'));
  b.push(T('Si une livraison n’est pas faite ou revient, cochez-la et ne versez pas son montant : elle sera reportée.'));
  b.push({ k: 'feed' });
  b.push(T('Versé le : ....../....../......'));
  b.push(T('Montant versé : ................'));
  b.push({ k: 'feed' });
  b.push(T('Signature livreur :'));
  b.push({ k: 'feed', n: 3 });
  return { title: `Livraisons ${courier?.name || ''}`.trim(), blocks: b };
}

// ---------- Page de test ----------
export function testDoc(c: Company, printerName: string): PrintDoc {
  return {
    title: 'Page de test',
    blocks: [
      ...header(c), L('='),
      T('PAGE DE TEST', { align: 'center', bold: true }),
      T(printerName, { align: 'center' }),
      T(dt(new Date().toISOString()), { align: 'center' }),
      L(),
      T('Accents : é è ê à â ç ô û ù ï « »'),
      T('Si les accents sont mal imprimés, changez le « jeu de caractères » de l’imprimante dans Trésor en ligne.'),
      P('Article exemple', ar(25000)),
      P('TOTAL', ar(25000), { bold: true, big: true }),
      L('='),
      T('Impression réussie !', { align: 'center', bold: true }),
      { k: 'feed', n: 2 },
    ],
  };
}
