// Logique de la boutique, sans affichage : choix de la page, regroupement des articles, panier.
// Testée avec `npm test` (tests/lib.test.js).

/** Quelle page Tsena afficher ? Domaine configuré, puis /chemin, puis ?page=, puis page par défaut. */
export function resolvePage(loc, cfg) {
  const host = (loc.hostname || '').replace(/^www\./, '').toLowerCase();
  if (cfg.hosts && cfg.hosts[host]) return cfg.hosts[host];
  const q = new URLSearchParams(loc.search || '').get('page');
  if (q) return q.trim();
  // Chemin : le segment qui suit « boutique » (hébergé dans un dossier), sinon le premier segment.
  const segs = (loc.pathname || '/').split('/').filter(Boolean).map((x) => decodeURIComponent(x));
  const at = segs.map((x) => x.toLowerCase()).lastIndexOf('boutique');
  const seg = at >= 0 ? (segs[at + 1] || '') : (segs[0] || '');
  if (seg && !/\.(html?|js|css|png|jpe?g|svg|ico|txt|webp)$/i.test(seg)) return seg;
  return cfg.defaultPage || '';
}

const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'a', 'au', 'aux', 'avec', 'pour', 'en', 'sur', 'sans', 'ou']);
/** « CAMERA AVEC PANNEAUX » → « Camera avec panneaux » ; garde « SD », « K40 », « TN 10 ». */
export function niceName(s) {
  if (!s) return '';
  const t = String(s).trim().replace(/\s+/g, ' ');
  const isUpper = t === t.toUpperCase();
  if (!isUpper) return t.charAt(0).toUpperCase() + t.slice(1);
  return t.split(' ').map((w, i) => {
    if (/\d/.test(w)) return w;                                  // codes : K40, 121, TN10
    if (w.length <= 3 && !/[AEIOUYÀÂÉÈÊËÎÏÔÛÙ]/.test(w)) return w; // sigles : SD, BN, PVC
    const l = w.toLowerCase();
    if (i > 0 && SMALL.has(l)) return l;
    return i === 0 ? l.charAt(0).toUpperCase() + l.slice(1) : l;
  }).join(' ');
}

/** Initiales élégantes pour un article sans photo (« Camera ampoule » → « Ca »). */
export function monogram(name) {
  const all = niceName(name).split(' ').filter(Boolean);
  if (all[0] && /^\d{1,4}$/.test(all[0])) return all[0];          // « 121 marron » → « 121 »
  const words = all.filter((w) => /^[A-Za-zÀ-ÿ]/.test(w) && !SMALL.has(w.toLowerCase()));
  if (!words.length) return (name || '?').slice(0, 2);
  const up = (c) => c.toUpperCase();
  if (words.length === 1) return up(words[0][0]) + words[0].slice(1, 2).toLowerCase();
  return up(words[0][0]) + words[1][0].toLowerCase();
}

/**
 * Transforme les articles de Tsena en fiches de la vitrine.
 * - Article avec plusieurs variantes de catégorie (Modèle + Pointure…) : les articles du même modèle forment une
 *   seule fiche, la dernière valeur (pointure, taille) devient le choix.
 * - Article avec des variantes couleur / taille : une fiche, les variantes au choix.
 */
export function buildCards(products) {
  const cards = new Map();
  for (const p of products || []) {
    const attrs = Array.isArray(p.attrs) ? p.attrs.filter((a) => a && a.value) : [];
    let key, title, optionName = null, optionFromAttr = null;
    if (attrs.length >= 2) {
      const head = attrs.slice(0, -1);
      key = 'g:' + head.map((a) => a.value.toLowerCase()).join('|') + '|' + (p.category || '');
      title = head.map((a) => a.value).join(' ');
      optionName = attrs[attrs.length - 1].name;
      optionFromAttr = attrs[attrs.length - 1].value;
    } else {
      key = 'p:' + p.id;
      title = (attrs[0] && attrs[0].value) || p.name;
    }
    let c = cards.get(key);
    if (!c) {
      c = { key, title: niceName(title), category: p.category ? niceName(p.category) : '', notes: p.notes || '', optionName, options: [], photoIds: [], codes: [] };
      cards.set(key, c);
    }
    if (p.photo) c.photoIds.push(p.id);
    c.codes.push(p.code);
    if (!c.notes && p.notes) c.notes = p.notes;
    for (const v of p.variants || []) {
      const label = [optionFromAttr, v.label].filter(Boolean).join(' · ') || null;
      if (!c.optionName && v.label) c.optionName = v.size && !v.color ? 'Taille' : v.color && !v.size ? 'Couleur' : 'Choix';
      c.options.push({ variantId: v.id, productId: p.id, label, price: Number(v.price) || 0, available: Number(v.available) || 0 });
    }
  }
  const list = [...cards.values()].filter((c) => c.options.length);
  for (const c of list) {
    c.options.sort((a, b) => optRank(a.label) - optRank(b.label) || String(a.label).localeCompare(String(b.label), 'fr', { numeric: true }));
    const prices = c.options.map((o) => o.price);
    c.priceMin = Math.min(...prices);
    c.priceMax = Math.max(...prices);
    c.available = c.options.reduce((s, o) => s + o.available, 0);
    c.single = c.options.length === 1;
  }
  // Disponibles d'abord, puis ordre alphabétique.
  return list.sort((a, b) => (b.available > 0) - (a.available > 0) || a.title.localeCompare(b.title, 'fr', { numeric: true }));
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL'];
function optRank(label) {
  if (!label) return 0;
  const u = String(label).toUpperCase();
  const i = SIZES.indexOf(u);
  if (i >= 0) return i;
  const n = parseFloat(u);
  return isNaN(n) ? 500 : 100 + n;
}

export const fmtAr = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' Ar';
export function priceLabel(card) {
  return card.priceMin === card.priceMax ? fmtAr(card.priceMin) : 'dès ' + fmtAr(card.priceMin);
}
export function stockLabel(available) {
  if (available <= 0) return { text: 'Épuisé', tone: 'out' };
  if (available <= 3) return { text: available === 1 ? 'Dernière pièce' : `Plus que ${available}`, tone: 'low' };
  return { text: 'Disponible', tone: 'ok' };
}

/** Panier : { variantId: qty }. Quantités bornées par la disponibilité connue. */
export function cartAdd(cart, variantId, qty, max) {
  const next = { ...cart };
  next[variantId] = Math.max(0, Math.min(max ?? 50, (next[variantId] || 0) + qty));
  if (!next[variantId]) delete next[variantId];
  return next;
}
export function cartLines(cart, cards) {
  const byVariant = new Map();
  for (const c of cards) for (const o of c.options) byVariant.set(o.variantId, { card: c, option: o });
  return Object.entries(cart).map(([variantId, qty]) => {
    const hit = byVariant.get(variantId);
    return hit ? { variantId, qty, card: hit.card, option: hit.option, total: qty * hit.option.price } : null;
  }).filter(Boolean);
}
export const cartCount = (lines) => lines.reduce((s, l) => s + l.qty, 0);
export const cartTotal = (lines) => lines.reduce((s, l) => s + l.total, 0);

/** Numéro malgache : « +261 34 12 345 67 » → « 0341234567 ». */
export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('261')) d = '0' + d.slice(3);
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  return d;
}
export const validPhone = (p) => /^0(3[2-9]|2\d)\d{7}$/.test(normPhone(p));

/** Horaires du jour (heure de Madagascar) : « Ouvert jusqu'à 17:00 » / « Fermé aujourd'hui ». */
export function todayHours(hours, now = new Date()) {
  if (!hours) return '';
  const tana = new Date(now.toLocaleString('en-US', { timeZone: 'Indian/Antananarivo' }));
  const h = hours[String(tana.getDay())];
  if (!h) return 'Fermé aujourd’hui — commandes reçues, traitées au prochain jour ouvert';
  const t = `${String(tana.getHours()).padStart(2, '0')}:${String(tana.getMinutes()).padStart(2, '0')}`;
  if (t < h.open) return `Ouvre aujourd’hui à ${h.open}`;
  if (t >= h.close) return `Fermé à cette heure — votre commande sera traitée dès ${h.open}`;
  return `Ouvert aujourd’hui jusqu’à ${h.close}`;
}

export function fmtPhone(p) {
  const d = normPhone(p);
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : p || '';
}

/**
 * Étapes du suivi d'une commande (page « Suivre ma commande »), à partir de ce que renvoie shop_track.
 * Renvoie { steps: [{ key, label, at, done, current }], state: 'active' | 'done' | 'cancelled' | 'refused', note }.
 */
export function trackSteps(t) {
  const sd = t.statusDates || {};
  const pickup = !!t.pickup;
  const at = (...xs) => xs.find(Boolean) || null;
  const steps = [
    { key: 'placed', label: 'Commande enregistrée', at: t.createdAt },
    { key: 'confirmed', label: 'Commande confirmée', at: at(sd.confirmed) },
    { key: 'ready', label: pickup ? 'Prête : vous pouvez venir la chercher en boutique' : 'Préparée, en attente du livreur', at: at(sd.ready) },
  ];
  if (!pickup) steps.push({ key: 'out', label: t.courier ? `En route avec votre livreur (${t.courier})` : 'En route avec votre livreur', at: at(t.dispatchedAt, sd.out) });
  steps.push({ key: 'delivered', label: pickup ? 'Retirée en boutique' : 'Livrée', at: at(sd.delivered, sd.partial, t.returnedAt) });
  const rank = { new: 0, confirmed: 1, ready: 2, out: pickup ? 2 : 3, delivered: steps.length - 1, partial: steps.length - 1 };
  const status = t.status || 'new';
  let state = status === 'cancelled' ? 'cancelled' : status === 'refused' ? 'refused' : (status === 'delivered' || status === 'partial') ? 'done' : 'active';
  const cur = rank[status] ?? 0;
  steps.forEach((s, i) => { s.done = state === 'done' ? true : i <= cur && state === 'active'; s.current = state === 'active' && i === cur; });
  // Une commande confirmée garde l'étape « confirmée » même sans date (anciennes commandes).
  if (state !== 'active' && state !== 'done') steps.forEach((s, i) => { s.done = !!s.at && i < steps.length - 1; s.current = false; });
  const reports = t.reports || [];
  const lastReport = reports[reports.length - 1];
  let note = '';
  if (state === 'cancelled') note = 'Cette commande a été annulée. Contactez-nous pour toute question.';
  else if (state === 'refused') note = 'La livraison n’a pas pu se faire. Contactez-nous pour organiser une nouvelle livraison.';
  else if (lastReport && state === 'active' && status !== 'out') note = lastReport.to ? `Livraison reportée au ${frDate(lastReport.to)}, à votre demande.` : 'Livraison reportée à votre demande.';
  else if (t.wantedDate && state === 'active' && status !== 'out') note = `Livraison prévue le ${frDate(t.wantedDate)}.`;
  return { steps, state, note };
}
export function frDate(ymdOrIso) {
  if (!ymdOrIso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ymdOrIso) ? new Date(`${ymdOrIso}T12:00:00`) : new Date(ymdOrIso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Indian/Antananarivo' });
}
export function frDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Antananarivo' });
}
