// Boutique en ligne reliée à Tsena Ampandrana.
// Le catalogue, les prix, le stock et les zones de livraison viennent de Tsena (Supabase) ;
// chaque commande est créée directement dans Tsena (statut « Enregistrée », canal « Site web »).
import {
  buildCards, cartAdd, cartCount, cartLines, cartTotal, fmtAr, fmtPhone, monogram, niceName, normPhone,
  priceLabel, resolvePage, stockLabel, todayHours, validPhone,
} from './lib.js';
import { PAGES, legalPage, trackForm, trackResult } from './pages.js';

const CFG = window.BOUTIQUE || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none"/></svg>';
const ICON_MSG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.4 2 2 6.1 2 11.4c0 3 1.5 5.7 3.8 7.4V22l3.5-1.9c.9.3 1.8.4 2.7.4 5.6 0 10-4.1 10-9.4S17.6 2 12 2Zm1 12.6-2.5-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.5 5.8Z"/></svg>';

const ICON_CARD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 9.5h19" stroke="currentColor" stroke-width="1.5"/></svg>';
// Carte : true = pour tous ; 'test' = seulement avec &test=carte dans l'adresse (essais en mode test Stripe).
const cardTest = (() => { try { const on = new URLSearchParams(location.search).get('test') === 'carte'; if (on) sessionStorage.setItem('boutique-test', '1'); return on || sessionStorage.getItem('boutique-test') === '1'; } catch { return false; } })();
const cardOn = () => CFG.cardPayment === true || (CFG.cardPayment === 'test' && cardTest);
const payFn = (p) => `${CFG.supabaseUrl}/functions/v1/shop-pay${p}`;

const state = {
  pageKey: resolvePage(location, CFG),
  data: null, cards: [], page: null, pageCfg: {},
  cart: {}, query: '', onlyAvailable: false, view: 'bag', sending: false,
  photos: new Map(), // productId → data URL (ou null)
  form: {},
};

// Adresse d'une boutique : dossier du site + ?page=code (marche sur tout hébergement, même sans réécriture d'adresse).
const siteBase = () => {
  const segs = location.pathname.split('/');
  const at = segs.map((x) => x.toLowerCase()).lastIndexOf('boutique');
  return at >= 0 ? segs.slice(0, at + 1).join('/') + '/' : '/';
};
const pageUrl = (code) => `${siteBase()}?page=${encodeURIComponent(String(code).toLowerCase())}`;

// ---------- Accès à Tsena ----------
async function rpc(fn, body) {
  const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && (json.message || json.hint)) || `Connexion impossible (${res.status}).`);
  return json;
}

// ---------- Panier mémorisé (par page, sur ce navigateur) ----------
const cartKey = () => `boutique-cart-${(state.pageKey || '').toLowerCase()}`;
function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(cartKey()) || '{}') || {}; } catch { state.cart = {}; } }
function saveCart() { try { localStorage.setItem(cartKey(), JSON.stringify(state.cart)); } catch { /* navigation privée */ } }
function loadForm() { try { state.form = JSON.parse(localStorage.getItem('boutique-client') || '{}') || {}; } catch { state.form = {}; } }
function saveForm() { try { localStorage.setItem('boutique-client', JSON.stringify({ name: state.form.name, phone: state.form.phone, facebook: state.form.facebook, place: state.form.place, zoneId: state.form.zoneId })); } catch { /* facultatif */ } }

// ---------- Pixel Meta (publicités Facebook) ----------
function initPixel(id) {
  if (!id || window.fbq) return;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
  window.fbq('track', 'PageView');
}
const track = (ev, data) => { try { window.fbq && window.fbq('track', ev, { currency: 'MGA', ...data }); } catch { /* ignoré */ } };

// ---------- Photos (chargées à la demande) ----------
async function photoOf(productId) {
  if (state.photos.has(productId)) return state.photos.get(productId);
  const p = rpc('shop_photo', { p_product: productId }).catch(() => null);
  state.photos.set(productId, p);
  const v = await p;
  state.photos.set(productId, v || null);
  return v || null;
}
const lazy = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); fillPhoto(e.target); }
}, { rootMargin: '300px' }) : null;
async function fillPhoto(el) {
  const id = el.dataset.photo;
  if (!id) return;
  const src = await photoOf(id);
  if (!src) return;
  const img = new Image();
  img.alt = el.dataset.alt || '';
  img.decoding = 'async';
  img.src = src;
  el.querySelector('.mono')?.remove();
  el.prepend(img);
}
function media(card, cls = 'card-media') {
  const pid = card.photoIds[0];
  return `<div class="${cls}" ${pid ? `data-photo="${esc(pid)}" data-alt="${esc(card.title)}"` : ''}><span class="mono" aria-hidden="true">${esc(monogram(card.title))}</span></div>`;
}
function observePhotos(root) {
  root.querySelectorAll('[data-photo]').forEach((el) => (lazy ? lazy.observe(el) : fillPhoto(el)));
}

// ---------- Démarrage ----------
async function start() {
  loadForm();
  window.addEventListener('scroll', () => $('#bar').classList.toggle('scrolled', scrollY > 8), { passive: true });
  $('#bagBtn').addEventListener('click', () => openDrawer('bag'));
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#drawer').classList.contains('open')) closeDrawer(); });

  if (!CFG.supabaseUrl || !CFG.supabaseKey) return fail('Boutique non configurée', 'Renseignez l’adresse et la clé Supabase dans config.js.');
  if (!state.pageKey) return showDirectory();

  try {
    state.data = await rpc('shop_catalog', { p_page: state.pageKey });
  } catch (e) {
    return fail('Boutique introuvable', /introuvable/i.test(e.message)
      ? `Aucune page « ${state.pageKey} » n’est ouverte à la vente. Vérifiez l’adresse.`
      : 'La connexion a échoué. Vérifiez votre réseau puis actualisez la page.', true);
  }
  state.page = state.data.page;
  state.pageCfg = (CFG.pages || {})[String(state.page.code || '').toUpperCase()] || {};
  state.cards = buildCards(state.data.products);
  loadCart();
  pruneCart();
  applyBrand();
  renderPage();
  updateBag();
  initPixel(state.pageCfg.pixel);
  handleReturnFromPayment();

  // Prix et stock à jour quand le client revient sur l'onglet.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    try { state.data = await rpc('shop_catalog', { p_page: state.pageKey }); state.cards = buildCards(state.data.products); pruneCart(); renderGrid(); updateBag(); } catch { /* garde l'affichage actuel */ }
  });
}

function fail(title, text, retry) {
  $('#main').innerHTML = `<section class="fail"><h1>${esc(title)}</h1><p>${esc(text)}</p>${retry ? '<p><a class="btn ghost" href="./">Voir toutes les boutiques</a></p>' : ''}</section>`;
  $('#brandName').textContent = 'Boutique';
}

// ---------- Liste des boutiques (adresse principale) ----------
async function showDirectory() {
  let pages = [];
  try { pages = await rpc('shop_pages'); } catch { return fail('Connexion impossible', 'Vérifiez votre réseau puis actualisez la page.'); }
  document.title = 'Nos boutiques';
  $('#brandName').textContent = 'Nos boutiques';
  $('#bagBtn').hidden = true;
  $('#seal').textContent = 'B';
  $('#main').innerHTML = `
    <div class="wrap">
      <section class="hero" style="grid-template-columns:1fr">
        <div class="hero-copy"><h1>Nos boutiques</h1>
        <p class="hero-lede">Chaque boutique a sa propre adresse à partager sur sa page Facebook.</p></div>
      </section>
      <ul class="houses">${pages.map((p) => `
        <li><a href="${esc(pageUrl(p.code || p.id))}">
          <span class="seal" ${p.logo ? `style="background-image:url('${esc(p.logo)}')"` : ''}>${p.logo ? '' : esc(monogram(p.name))}</span>
          <span class="house-name">${esc(p.name)}</span></a></li>`).join('')}
      </ul>
    </div>`;
}

// ---------- Page boutique ----------
function applyBrand() {
  const p = state.page, pc = state.pageCfg;
  const name = p.ticketName || p.name;
  document.title = `${name} — boutique en ligne`;
  document.querySelector('meta[property="og:title"]').content = name;
  if (pc.accent) document.documentElement.style.setProperty('--accent', pc.accent);
  const logo = pc.logo || p.logo;
  const seal = $('#seal');
  if (logo) seal.style.backgroundImage = `url('${logo}')`; else seal.textContent = monogram(name);
  $('#brandName').textContent = name;
  $('#brand').href = pageUrl(p.code || p.id);
  if (logo) { const l = document.createElement('link'); l.rel = 'icon'; l.href = logo; document.head.append(l); }
}

function renderPage() {
  const p = state.page, pc = state.pageCfg, co = state.data.company || {};
  const name = p.ticketName || p.name;
  const phone = p.phone || co.phone;
  const lede = pc.tagline || p.slogan || 'Commandez en quelques gestes. Nous vous appelons pour confirmer, puis nous livrons — vous payez à la réception.';
  const hero = pc.hero
    ? `<div class="arch"><img src="${esc(pc.hero)}" alt="" fetchpriority="high"></div>`
    : (pc.logo || p.logo)
      ? `<div class="arch logo"><img src="${esc(pc.logo || p.logo)}" alt="Logo ${esc(name)}"></div>`
      : `<div class="arch logo"><span class="arch-mono" aria-hidden="true">${esc(monogram(name))}</span></div>`;
  const zones = state.data.zones || [];
  const delivery = zones.filter((z) => !z.pickup);
  const minFee = delivery.length ? Math.min(...delivery.map((z) => Number(z.fee) || 0)) : null;

  $('#main').innerHTML = `<div id="shopView">
    <div class="wrap">
      <section class="hero">
        <div class="hero-copy">
          <h1>${esc(name)}</h1>
          <p class="hero-lede">${esc(lede)}</p>
          <div class="hero-actions">
            <a class="btn" href="#collection">Voir la collection</a>
            ${messengerLink() ? `<a class="btn ghost" href="${esc(messengerLink())}" target="_blank" rel="noopener">${ICON_MSG}Écrire sur Messenger</a>` : ''}
          </div>
          <dl class="facts">
            ${co.address ? `<div><dt>Boutique</dt><dd>${esc(co.address)}</dd></div>` : ''}
            ${phone ? `<div><dt>Téléphone</dt><dd><a href="tel:${esc(normPhone(phone))}">${esc(fmtPhone(phone))}</a></dd></div>` : ''}
            ${minFee != null ? `<div><dt>Livraison</dt><dd>dès ${esc(fmtAr(minFee))} à Tana</dd></div>` : ''}
          </dl>
        </div>
        <div class="hero-media">${hero}</div>
      </section>

      <section class="section" id="collection" aria-labelledby="colTitle">
        <div class="section-head"><h2 id="colTitle">La collection</h2><p id="count"></p></div>
        <div class="tools">
          <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input id="q" type="search" placeholder="Rechercher un article, une pointure, un modèle" aria-label="Rechercher" autocomplete="off"></label>
          <button class="chip" id="onlyAv" type="button" aria-pressed="false">Disponibles seulement</button>
        </div>
        <div class="grid" id="grid"></div>
      </section>

      <section class="section" id="livraison" aria-labelledby="livTitle">
        <div class="section-head"><h2 id="livTitle">Comment commander</h2><p>${esc(todayHours(co.hours))}</p></div>
        <ol class="steps">
          <li><h3>Vous choisissez</h3><p>Ajoutez vos articles au panier, indiquez votre numéro et votre lieu de livraison.</p></li>
          <li><h3>Nous vous appelons</h3><p>Notre équipe confirme la commande, la taille et l’heure de passage avec vous.</p></li>
          <li><h3>Vous payez à la réception</h3><p>En espèces ou par Mobile Money, au livreur ou en boutique si vous venez chercher.</p></li>
        </ol>
        <div class="zones">${zones.map((z) => `<div><span>${esc(z.name)}</span><span>${z.pickup ? 'Gratuit' : esc(fmtAr(z.fee))}</span></div>`).join('')}</div>
        <p class="section-more"><a href="#/livraison-retours">Délais, retours et échanges</a> · <a href="#/suivi">Suivre ma commande</a></p>
      </section>
    </div></div>
    <div id="pageView" class="wrap doc" hidden></div>`;

  // Bandeau d'annonce (comme sur les grandes boutiques en ligne).
  const ann = $('#announce');
  if (ann) {
    const bits = [minFee != null ? `Livraison à Tana dès ${fmtAr(minFee)}` : '', 'Paiement à la réception', cardOn() ? 'Carte Visa / Mastercard acceptée' : 'Mobile Money accepté', 'Suivi de commande en ligne'].filter(Boolean);
    ann.innerHTML = bits.map((b) => `<span>${esc(b)}</span>`).join('');
    ann.hidden = false;
  }

  $('#foot').innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div><h2>${esc(name)}</h2><p>${esc(lede)}</p>
          <p class="foot-contact">${esc(co.address || '')}${phone ? `<br><a href="tel:${esc(normPhone(phone))}">${esc(fmtPhone(phone))}</a>` : ''}</p></div>
        <nav aria-label="Aide"><h3>Aide</h3><ul>
          <li><a href="#/suivi">Suivre ma commande</a></li><li><a href="#/livraison-retours">Livraison et retours</a></li><li><a href="#/contact">Contact</a></li></ul></nav>
        <nav aria-label="Informations"><h3>Informations</h3><ul>
          <li><a href="#/cgv">Conditions générales de vente</a></li><li><a href="#/confidentialite">Politique de confidentialité</a></li></ul></nav>
        <nav aria-label="Réseaux"><h3>Nous suivre</h3><ul>
          ${pc.facebook ? `<li><a href="${esc(pc.facebook)}" target="_blank" rel="noopener">Facebook</a></li>` : ''}
          ${messengerLink() ? `<li><a href="${esc(messengerLink())}" target="_blank" rel="noopener">Messenger</a></li>` : ''}
          ${!pc.facebook && !messengerLink() ? `<li>${esc(name)} sur Facebook</li>` : ''}</ul></nav>
      </div>
      <div class="foot-bottom">
        <small>© ${new Date().getFullYear()} ${esc(name)}${co.name && co.name !== 'Ma boutique' && co.name !== name ? ' · ' + esc(co.name) : ''}</small>
        <ul class="pay-badges" aria-label="Moyens de paiement"><li>Espèces</li><li>MVola</li><li>Orange Money</li><li>Airtel Money</li>${cardOn() ? '<li>Visa</li><li>Mastercard</li>' : ''}</ul>
      </div>
    </div>`;

  const q = $('#q');
  q.addEventListener('input', () => { state.query = q.value; renderGrid(); });
  $('#onlyAv').addEventListener('click', (e) => {
    state.onlyAvailable = !state.onlyAvailable;
    e.currentTarget.setAttribute('aria-pressed', String(state.onlyAvailable));
    renderGrid();
  });
  renderGrid();
  window.addEventListener('hashchange', route);
  route();
  // Lien direct vers un article (#article=…) partagé depuis Facebook.
  const m = /article=([^&]+)/.exec(location.hash);
  if (m) { const c = state.cards.find((x) => x.codes.includes(decodeURIComponent(m[1])) || x.key === decodeURIComponent(m[1])); if (c) openSheet(c); }
}

function messengerLink() {
  const m = state.pageCfg.messenger;
  return m ? `https://m.me/${encodeURIComponent(m.replace(/^@/, ''))}` : '';
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function renderGrid() {
  const grid = $('#grid');
  if (!grid) return;
  const words = norm(state.query).split(/\s+/).filter(Boolean);
  const list = state.cards.filter((c) => {
    if (state.onlyAvailable && c.available <= 0) return false;
    if (!words.length) return true;
    const text = norm([c.title, c.category, c.codes.join(' '), c.options.map((o) => o.label).join(' ')].join(' '));
    return words.every((w) => text.includes(w));
  });
  $('#count').textContent = `${list.length} article${list.length > 1 ? 's' : ''}`;
  if (!list.length) {
    grid.innerHTML = `<p class="empty">${state.cards.length ? 'Aucun article ne correspond. Essayez un autre mot ou retirez le filtre.' : 'La collection arrive bientôt. Écrivez-nous sur Facebook pour connaître les nouveautés.'}</p>`;
    return;
  }
  grid.innerHTML = list.map((c, i) => {
    const s = stockLabel(c.available);
    return `<button class="card${c.available <= 0 ? ' sold' : ''}" type="button" data-i="${state.cards.indexOf(c)}" aria-label="${esc(c.title)}, ${esc(priceLabel(c))}${s.tone !== 'ok' ? ', ' + esc(s.text) : ''}">
      ${media(c)}${s.tone !== 'ok' ? `<span class="badge ${s.tone}">${esc(s.text)}</span>` : ''}
      <span class="card-body">
        <span class="card-title">${esc(c.title)}</span>
        ${c.optionName && !c.single ? `<span class="card-meta">${esc(optionsSummary(c))}</span>` : c.category ? `<span class="card-meta">${esc(c.category)}</span>` : ''}
        <span class="card-price">${esc(priceLabel(c))}</span>
      </span></button>`;
  }).join('');
  grid.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => openSheet(state.cards[+b.dataset.i])));
  observePhotos(grid);
}
function optionsSummary(c) {
  const av = c.options.filter((o) => o.available > 0).map((o) => o.label);
  if (!av.length) return `${c.optionName} épuisé${c.optionName === 'Taille' || c.optionName === 'Pointure' || c.optionName === 'Couleur' ? 'e' : ''}`;
  return `${c.optionName} ${av.length > 5 ? av.slice(0, 5).join(', ') + '…' : av.join(', ')}`;
}

// ---------- Fiche article ----------
function openSheet(card) {
  const dlg = $('#sheet');
  let opt = card.options.find((o) => o.available > 0) || card.options[0];
  let qty = 1;
  const draw = () => {
    const s = stockLabel(opt.available);
    const inBag = state.cart[opt.variantId] || 0;
    const room = Math.max(0, opt.available - inBag);
    if (qty > Math.max(1, room)) qty = Math.max(1, room);
    dlg.innerHTML = `
      <button class="close" type="button" data-close aria-label="Fermer">${ICON_X}</button>
      <div class="sheet-inner">
        ${media(card, 'sheet-media')}
        <div class="sheet-body">
          <h2 id="sheetTitle">${esc(card.title)}</h2>
          <div class="price">${esc(fmtAr(opt.price))}</div>
          ${card.notes ? `<p class="notes">${esc(card.notes)}</p>` : ''}
          ${card.single ? '' : `<fieldset><legend>${esc(card.optionName || 'Choix')}</legend><div class="opts" role="radiogroup">${card.options.map((o, i) =>
            `<button type="button" class="opt${o.available <= 0 ? ' out' : ''}" role="radio" aria-checked="${o === opt}" data-o="${i}" aria-label="${esc(o.label || '')}${o.available <= 0 ? ', épuisé' : ''}">${esc(o.label || '—')}</button>`).join('')}</div></fieldset>`}
          <p class="stock-note ${s.tone}">${esc(s.text)}${inBag ? ` · ${inBag} déjà dans votre panier` : ''}</p>
          <div class="buy-row">
            <div class="qty" aria-label="Quantité"><button type="button" data-q="-1" aria-label="Moins">−</button><output>${qty}</output><button type="button" data-q="1" aria-label="Plus">+</button></div>
            <button class="btn" type="button" data-add ${room <= 0 ? 'disabled' : ''}>${opt.available <= 0 ? 'Épuisé' : room <= 0 ? 'Tout est dans votre panier' : 'Ajouter au panier'}</button>
          </div>
          ${messengerLink() ? `<a class="btn ghost" href="${esc(messengerLink())}" target="_blank" rel="noopener">${ICON_MSG}Poser une question sur Messenger</a>` : ''}
          <ul class="assure"><li>Paiement à la réception, en espèces ou Mobile Money</li><li>Nous vous appelons pour confirmer avant la livraison</li></ul>
        </div>
      </div>`;
    observePhotos(dlg);
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { opt = card.options[+b.dataset.o]; qty = 1; draw(); dlg.querySelector(`[data-o="${b.dataset.o}"]`)?.focus(); }));
    dlg.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { qty = Math.min(Math.max(1, room), Math.max(1, qty + +b.dataset.q)); dlg.querySelector('output').textContent = qty; }));
    dlg.querySelector('[data-add]').onclick = () => {
      state.cart = cartAdd(state.cart, opt.variantId, qty, opt.available);
      saveCart(); updateBag(true);
      track('AddToCart', { value: opt.price * qty, content_ids: [opt.productId], content_name: card.title, content_type: 'product' });
      dlg.close();
      toast(`${card.title}${card.single ? '' : ' · ' + (opt.label || '')} ajouté au panier`);
    };
  };
  draw();
  if (!dlg.open) dlg.showModal();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  track('ViewContent', { value: opt.price, content_ids: [opt.productId], content_name: card.title, content_type: 'product' });
}

// ---------- Panier et commande ----------
function pruneCart() {
  const known = new Map();
  for (const c of state.cards) for (const o of c.options) known.set(o.variantId, o.available);
  let changed = false;
  for (const [vid, q] of Object.entries(state.cart)) {
    const av = known.get(vid) ?? 0;
    if (q > av) { changed = true; if (av > 0) state.cart[vid] = av; else delete state.cart[vid]; }
  }
  if (changed) saveCart();
}
function updateBag(bump) {
  const n = cartCount(cartLines(state.cart, state.cards));
  const el = $('#bagCount');
  el.hidden = !n; el.textContent = n;
  $('#bagBtn').setAttribute('aria-label', n ? `Panier, ${n} article${n > 1 ? 's' : ''}` : 'Panier vide');
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  if ($('#drawer').classList.contains('open') && state.view !== 'done') renderDrawer();
}
let lastFocus = null;
function openDrawer(view) {
  state.view = view; lastFocus = document.activeElement;
  const d = $('#drawer');
  renderDrawer();
  d.inert = false; d.setAttribute('aria-hidden', 'false'); d.classList.add('open');
  $('#scrim').hidden = false; $('#bagBtn').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  setTimeout(() => d.querySelector('.close')?.focus(), 50);
}
function closeDrawer() {
  const d = $('#drawer');
  d.classList.remove('open'); d.inert = true; d.setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true; $('#bagBtn').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  if (state.view === 'done') state.view = 'bag';
  lastFocus?.focus?.();
}

function lineHtml(l) {
  return `<div class="line">
    ${media(l.card, 'line-thumb')}
    <div><div class="line-name">${esc(l.card.title)}</div>
      <div class="line-sub">${l.option.label ? esc((l.card.optionName ? l.card.optionName + ' ' : '') + l.option.label) + ' · ' : ''}${esc(fmtAr(l.option.price))}</div>
      <div class="qty" aria-label="Quantité"><button type="button" data-l="${esc(l.variantId)}" data-d="-1" aria-label="Retirer un">−</button><output>${l.qty}</output><button type="button" data-l="${esc(l.variantId)}" data-d="1" aria-label="Ajouter un" ${l.qty >= l.option.available ? 'disabled' : ''}>+</button></div>
    </div>
    <div class="line-total">${esc(fmtAr(l.total))}</div></div>`;
}

function renderDrawer() {
  const d = $('#drawer');
  const lines = cartLines(state.cart, state.cards);
  const items = cartTotal(lines);
  const zones = state.data?.zones || [];
  const zone = zones.find((z) => z.id === state.form.zoneId);
  const fee = zone ? Number(zone.fee) || 0 : 0;
  const head = (t) => `<div class="drawer-head"><h2>${t}</h2><button class="close" type="button" aria-label="Fermer">${ICON_X}</button></div>`;

  if (state.view === 'done') {
    const r = state.lastOrder;
    d.innerHTML = `${head('Merci')}<div class="drawer-body"><div class="done">
      <span class="num">Commande ${esc(r.number)}</span>
      <h3>${r.paidByCard ? 'Paiement reçu, merci.' : 'Votre commande est enregistrée.'}</h3>
      ${r.paidByCard
        ? `<p>Votre paiement par carte est confirmé${r.total ? ` (${esc(fmtAr(r.total))})` : ''}. Nous vous appelons${state.form.phone ? ` au ${esc(fmtPhone(state.form.phone))}` : ''} pour organiser la livraison. Vous n’avez rien à payer à la réception.</p>`
        : r.cardPending
          ? `<p>Le paiement par carte n’a pas été terminé. Votre commande reste enregistrée : nous vous appelons${state.form.phone ? ` au ${esc(fmtPhone(state.form.phone))}` : ''}, et vous pourrez payer à la réception.</p>`
          : `<p>Nous vous appelons au ${esc(fmtPhone(state.form.phone))} pour confirmer${r.outsideHours ? ' dès l’ouverture' : ''}. Total à payer à la réception : <strong>${esc(fmtAr(r.total))}</strong>${r.fee ? ` (livraison ${esc(r.zone)} incluse)` : ''}.</p>`}
      ${messengerLink() ? `<a class="btn ghost" href="${esc(messengerLink())}" target="_blank" rel="noopener">${ICON_MSG}Nous écrire sur Messenger</a>` : ''}
      <a class="btn ghost" href="#/suivi?n=${encodeURIComponent(r.number || '')}" data-track-link>Suivre ma commande</a>
      <button class="btn" type="button" data-continue>Continuer mes achats</button></div></div>`;
    d.querySelector('[data-continue]').onclick = closeDrawer;
    d.querySelector('[data-track-link]').onclick = () => closeDrawer();
    rememberOrder(r.number, state.form.phone);
  } else if (!lines.length) {
    d.innerHTML = `${head('Panier')}<div class="drawer-body"><p class="bag-empty">Votre panier est vide. Parcourez la collection et ajoutez ce qui vous plaît.</p>
      <button class="btn ghost" type="button" data-continue>Voir la collection</button></div>`;
    d.querySelector('[data-continue]').onclick = () => { closeDrawer(); $('#collection')?.scrollIntoView(); };
  } else if (state.view === 'bag') {
    d.innerHTML = `${head('Panier')}<div class="drawer-body">${lines.map(lineHtml).join('')}</div>
      <div class="drawer-foot"><div class="sum"><div class="grand"><span>Articles</span><span>${esc(fmtAr(items))}</span></div></div>
      <p class="line-sub">Frais de livraison selon votre quartier, à l’étape suivante.</p>
      <button class="btn wide" type="button" data-next>Passer la commande</button></div>`;
    d.querySelector('[data-next]').onclick = () => {
      track('InitiateCheckout', { value: items, num_items: cartCount(lines) });
      state.view = 'form'; renderDrawer(); d.querySelector('input')?.focus();
    };
  } else {
    const f = state.form;
    const cardMin = Number(CFG.cardMin) || 3000;
    const cardOk = cardOn() && items + fee >= cardMin;
    if (!cardOk && f.pay === 'card') f.pay = 'cod';
    const byCard = cardOk && f.pay === 'card';
    d.innerHTML = `${head('Vos coordonnées')}<div class="drawer-body"><form class="form" id="orderForm" novalidate>
        <button class="back" type="button" data-back>Modifier le panier (${cartCount(lines)} article${cartCount(lines) > 1 ? 's' : ''})</button>
        <div class="field"><label for="f-name">Nom</label><input id="f-name" name="name" autocomplete="name" required maxlength="80" value="${esc(f.name || '')}"></div>
        <div class="field"><label for="f-phone">Téléphone</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="034 12 345 67" value="${esc(f.phone || '')}"><span class="hint">Nous vous appelons sur ce numéro pour confirmer.</span></div>
        <fieldset class="field"><legend class="lab">Livraison</legend><div class="zone-list">${zones.map((z) => `
          <label class="zone"><input type="radio" name="zoneId" value="${esc(z.id)}" ${z.id === f.zoneId ? 'checked' : ''} required><span>${esc(z.pickup ? 'Je viens chercher en boutique' : z.name)}</span><span>${z.pickup ? 'Gratuit' : esc(fmtAr(z.fee))}</span></label>`).join('')}</div></fieldset>
        <div class="field" id="placeField" ${zone && zone.pickup ? 'hidden' : ''}><label for="f-place">Lieu de livraison</label><input id="f-place" name="place" autocomplete="street-address" maxlength="200" placeholder="Quartier, repère, porte…" value="${esc(f.place || '')}"></div>
        ${cardOn() ? `<fieldset class="field"><legend class="lab">Paiement</legend><div class="zone-list">
          <label class="zone" ${cardOk ? '' : 'style="opacity:.55"'}><input type="radio" name="pay" value="card" ${byCard ? 'checked' : ''} ${cardOk ? '' : 'disabled'}><span>${ICON_CARD} Payer maintenant par carte</span><span>${cardOk ? 'Visa, Mastercard' : `dès ${esc(fmtAr(cardMin))}`}</span></label>
          <label class="zone"><input type="radio" name="pay" value="cod" ${!byCard ? 'checked' : ''}><span>Payer à la réception</span><span>Espèces, Mobile Money</span></label>
        </div>${byCard ? '<span class="hint">Paiement sécurisé par Stripe. Vos données de carte ne passent jamais par notre site.</span>' : ''}</fieldset>` : ''}
        <div class="field"><label for="f-fb">Nom Facebook (facultatif)</label><input id="f-fb" name="facebook" maxlength="100" value="${esc(f.facebook || '')}"></div>
        <div class="field"><label for="f-notes">Précisions (facultatif)</label><textarea id="f-notes" name="notes" maxlength="500" placeholder="Heure qui vous arrange, autre numéro…">${esc(f.notes || '')}</textarea></div>
        <p class="err" id="formErr" role="alert" hidden></p>
      </form></div>
      <div class="drawer-foot"><div class="sum">
        <div><span>Articles</span><span>${esc(fmtAr(items))}</span></div>
        <div><span>Livraison</span><span>${zone ? (zone.pickup ? 'Gratuit' : esc(fmtAr(fee))) : 'à choisir'}</span></div>
        <div class="grand"><span>${byCard ? 'Total à payer par carte' : 'À payer à la réception'}</span><span>${esc(fmtAr(items + fee))}</span></div></div>
        <button class="btn wide" type="submit" form="orderForm" ${state.sending ? 'disabled' : ''}>${state.sending ? (byCard ? 'Ouverture du paiement…' : 'Envoi de la commande…') : byCard ? `${ICON_CARD} Payer ${esc(fmtAr(items + fee))}` : 'Envoyer la commande'}</button></div>`;
    const form = d.querySelector('#orderForm');
    form.addEventListener('input', (e) => {
      const t = e.target; if (!t.name) return;
      state.form[t.name] = t.value;
      if (t.name === 'pay') { renderDrawer(); d.querySelector(`input[name="pay"][value="${t.value}"]`)?.focus(); return; }
      if (t.name === 'zoneId') { const keep = document.activeElement?.value; renderDrawer(); d.querySelector(`input[value="${CSS.escape(keep || t.value)}"]`)?.focus(); }
    });
    form.addEventListener('submit', submitOrder);
    d.querySelector('[data-back]').onclick = () => { state.view = 'bag'; renderDrawer(); };
  }
  d.querySelector('.close').onclick = closeDrawer;
  d.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => {
    const l = lines.find((x) => x.variantId === b.dataset.l);
    state.cart = cartAdd(state.cart, b.dataset.l, +b.dataset.d, l ? l.option.available : 50);
    saveCart(); updateBag();
  }));
  observePhotos(d);
}

async function submitOrder(e) {
  e.preventDefault();
  if (state.sending) return;
  const f = state.form, err = $('#formErr');
  const zones = state.data.zones || [];
  const zone = zones.find((z) => z.id === f.zoneId);
  const problem =
    !f.name || f.name.trim().length < 2 ? ['f-name', 'Indiquez votre nom.'] :
    !validPhone(f.phone) ? ['f-phone', 'Indiquez un numéro malgache valide, par exemple 034 12 345 67.'] :
    !zone ? [null, 'Choisissez un mode de livraison.'] :
    !zone.pickup && !(f.place || '').trim() ? ['f-place', 'Indiquez le lieu de livraison.'] : null;
  if (problem) {
    err.textContent = problem[1]; err.hidden = false;
    if (problem[0]) { const el = document.getElementById(problem[0]); el.setAttribute('aria-invalid', 'true'); el.focus(); }
    return;
  }
  const lines = cartLines(state.cart, state.cards);
  const payCard = cardOn() && f.pay === 'card' && cartTotal(lines) + (Number(zone.fee) || 0) >= (Number(CFG.cardMin) || 3000);
  state.sending = true; renderDrawer();
  try {
    const r = await rpc('shop_place_order', {
      p_page: state.page.id,
      p_order: { name: f.name.trim(), phone: f.phone, facebook: f.facebook || '', zoneId: f.zoneId, place: zone.pickup ? '' : f.place, notes: f.notes || '', pay: payCard ? 'card' : 'cod', lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) },
    });
    if (payCard) {
      // La commande est enregistrée (stock réservé) ; le client part payer chez Stripe puis revient sur le site.
      state.cart = {}; saveCart(); saveForm();
      try { sessionStorage.setItem('boutique-last', JSON.stringify({ ...r, phone: f.phone })); } catch { /* facultatif */ }
      track('InitiateCheckout', { value: r.total, num_items: cartCount(lines) });
      try {
        const res = await fetch(payFn('/checkout'), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey },
          body: JSON.stringify({ orderId: r.id, returnUrl: location.origin + pageUrl(state.page.code || state.page.id) }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.url) { location.assign(j.url); return; }
        throw new Error(j.error || 'Paiement indisponible');
      } catch {
        state.lastOrder = { ...r, cardPending: true };
        state.sending = false; state.view = 'done'; renderDrawer(); updateBag();
        return;
      }
    }
    track('Purchase', { value: r.total, num_items: cartCount(lines), content_ids: lines.map((l) => l.option.productId), content_type: 'product' }); // paiement à la réception
    const hours = state.data.company?.hours; const msg = todayHours(hours);
    state.lastOrder = { ...r, outsideHours: /Fermé|Ouvre/.test(msg) };
    state.cart = {}; saveCart(); saveForm();
    state.form.notes = '';
    state.sending = false; state.view = 'done';
    renderDrawer(); updateBag();
    // Stock à jour pour les prochains achats.
    rpc('shop_catalog', { p_page: state.pageKey }).then((d) => { state.data = d; state.cards = buildCards(d.products); renderGrid(); }).catch(() => {});
  } catch (ex) {
    state.sending = false; renderDrawer();
    const e2 = $('#formErr'); e2.textContent = ex.message; e2.hidden = false;
    if (/stock|disponible/i.test(ex.message)) {
      rpc('shop_catalog', { p_page: state.pageKey }).then((d) => { state.data = d; state.cards = buildCards(d.products); renderGrid(); }).catch(() => {});
    }
  }
}

// ---------- Retour du paiement Stripe ----------
async function handleReturnFromPayment() {
  const q = new URLSearchParams(location.search);
  const session = q.get('paid'), unpaid = q.get('unpaid');
  if (!session && !unpaid) return;
  let last = {};
  try { last = JSON.parse(sessionStorage.getItem('boutique-last') || '{}') || {}; } catch { /* facultatif */ }
  q.delete('paid'); q.delete('unpaid');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  if (last.phone) state.form.phone = last.phone;
  if (unpaid) { state.lastOrder = { ...last, number: last.number || unpaid, cardPending: true }; openDrawer('done'); return; }
  state.lastOrder = { ...last, number: last.number || '…', paidByCard: true };
  openDrawer('done');
  try {
    const res = await fetch(payFn('/verify?session_id=' + encodeURIComponent(session)), { headers: { apikey: CFG.supabaseKey } });
    const j = await res.json();
    if (j.paid) {
      state.lastOrder = { ...state.lastOrder, number: j.number || state.lastOrder.number, paidByCard: true };
      track('Purchase', { value: last.total || 0 });
      try { sessionStorage.removeItem('boutique-last'); } catch { /* facultatif */ }
    } else state.lastOrder = { ...state.lastOrder, paidByCard: false, cardPending: true };
  } catch { /* le paiement sera confirmé par Stripe directement dans Tsena */ }
  renderDrawer();
}

// ---------- Pages (suivi, CGV, confidentialité, livraison, contact) ----------
function pageCtx() {
  const p = state.page;
  return { cfg: CFG, company: state.data.company, shopName: p.ticketName || p.name, phone: p.phone || state.data.company?.phone,
    zones: state.data.zones || [], cardOn: cardOn(), pixel: state.pageCfg.pixel, messenger: messengerLink() };
}
function route() {
  const shop = $('#shopView'), view = $('#pageView');
  if (!shop || !view) return;
  const m = /^#\/([a-z-]+)(?:\?(.*))?$/.exec(location.hash);
  const name = state.page.ticketName || state.page.name;
  document.querySelectorAll('.bar-links a').forEach((a) => a.removeAttribute('aria-current'));
  if (m && PAGES[m[1]]) {
    const kind = m[1], params = new URLSearchParams(m[2] || '');
    shop.hidden = true; view.hidden = false;
    document.title = `${PAGES[kind]} — ${name}`;
    document.querySelector(`.bar-links a[href="#/${kind}"]`)?.setAttribute('aria-current', 'page');
    view.innerHTML = `<a class="back-link" href="#collection">Retour à la boutique</a>` +
      (kind === 'suivi' ? trackForm({ number: params.get('n') || '', phone: state.form.phone || '' }, recentOrders()) : legalPage(kind, pageCtx()));
    if (kind === 'suivi') bindTracking(params.get('n'));
    window.scrollTo(0, 0);
    view.querySelector('h1')?.focus?.();
    return;
  }
  if (!shop.hidden) return;
  shop.hidden = false; view.hidden = true;
  document.title = `${name} — boutique en ligne`;
  const target = location.hash && /^#[a-z]/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
  if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
}

// Commandes passées sur cet appareil : proposées sur la page de suivi.
function recentOrders() { try { return JSON.parse(localStorage.getItem('boutique-orders') || '[]') || []; } catch { return []; } }
function rememberOrder(number, phone) {
  if (!number || number === '…') return;
  try { const list = recentOrders().filter((o) => o.number !== number); localStorage.setItem('boutique-orders', JSON.stringify([{ number, phone }, ...list].slice(0, 6))); } catch { /* facultatif */ }
}
function bindTracking(autoNumber) {
  const form = $('#trackForm'), out = $('#trackResult'), err = $('#trackErr');
  const run = async (num, phone) => {
    err.hidden = true;
    if (!num || !validPhone(phone)) { err.textContent = 'Indiquez le numéro de commande (ex. WEB-0012) et votre téléphone.'; err.hidden = false; return; }
    out.innerHTML = '<p class="small-muted">Recherche de votre commande…</p>';
    try {
      const t = await rpc('shop_track', { p_number: num.trim(), p_phone: phone });
      out.innerHTML = trackResult(t);
      rememberOrder(t.number, phone);
      out.querySelector('.track-card')?.scrollIntoView({ block: 'nearest' });
    } catch (e) { out.innerHTML = ''; err.textContent = e.message; err.hidden = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run(form.num.value, form.phone.value); });
  $('#pageView').querySelectorAll('[data-track]').forEach((b) => (b.onclick = () => { form.num.value = b.dataset.track; form.phone.value = b.dataset.phone; run(b.dataset.track, b.dataset.phone); }));
  if (autoNumber && validPhone(form.phone.value)) run(autoNumber, form.phone.value);
}

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

start();
