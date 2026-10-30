// Pages de la boutique : conditions générales de vente, confidentialité, livraison & retours, contact, suivi de commande.
// Les informations (société, adresse, téléphone, zones, horaires) viennent de Tsena et de config.js (section legal).
import { fmtAr, fmtPhone, frDate, frDateTime, normPhone, trackSteps } from './lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PAGES = {
  suivi: 'Suivre ma commande',
  'livraison-retours': 'Livraison et retours',
  cgv: 'Conditions générales de vente',
  confidentialite: 'Politique de confidentialité',
  contact: 'Contact',
  'a-propos': 'À propos',
};
// Texte saisi dans Tsena → paragraphes HTML sûrs.
const paras = (t) => String(t || '').split(/\n{2,}/).map((x) => `<p>${esc(x.trim()).replace(/\n/g, '<br>')}</p>`).join('');

/** Informations légales : config.js (legal) d'abord, sinon la fiche Société de Tsena. */
export function sellerInfo(ctx) {
  const L = ctx.cfg.legal || {}, co = ctx.company || {};
  const shop = ctx.shopName;
  const company = L.company || (co.name && co.name !== 'Ma boutique' ? co.name : '') || shop;
  return {
    shop, company,
    address: L.address || co.address || '',
    phone: ctx.phone || co.phone || '',
    email: L.email || '',
    nif: L.nif || co.nif || '', stat: L.stat || co.stat || '',
    returnDays: Number(L.returnDays) || 7,
    cardEntity: L.cardEntity || '',
  };
}

const hoursText = (hours) => {
  if (!hours) return '';
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((d) => { const h = hours[String(d)]; return `<tr><td>${days[d]}</td><td>${h ? `${esc(h.open)} – ${esc(h.close)}` : 'Fermé'}</td></tr>`; }).join('');
};

const updated = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

function identity(s) {
  return `<p><strong>${esc(s.company)}</strong>${s.company !== s.shop ? ` (boutique « ${esc(s.shop)} »)` : ''}<br>
    ${s.address ? `${esc(s.address)}, Antananarivo, Madagascar<br>` : ''}
    ${s.phone ? `Téléphone : <a href="tel:${esc(normPhone(s.phone))}">${esc(fmtPhone(s.phone))}</a><br>` : ''}
    ${s.email ? `E-mail : <a href="mailto:${esc(s.email)}">${esc(s.email)}</a><br>` : ''}
    ${s.nif ? `NIF : ${esc(s.nif)}` : ''}${s.nif && s.stat ? ' · ' : ''}${s.stat ? `STAT : ${esc(s.stat)}` : ''}</p>`;
}

export function legalPage(kind, ctx) {
  const s = sellerInfo(ctx);
  const zones = ctx.zones || [];
  const card = ctx.cardOn;
  const zoneRows = zones.map((z) => `<tr><td>${esc(z.pickup ? 'Retrait en boutique' : z.name)}</td><td>${z.pickup ? 'Gratuit' : esc(fmtAr(z.fee))}</td></tr>`).join('');

  if (kind === 'cgv') return `
    <h1>Conditions générales de vente</h1>
    <p class="doc-meta">Mise à jour : ${updated()}</p>
    <h2>1. Le vendeur</h2>${identity(s)}
    <h2>2. Champ d’application</h2>
    <p>Les présentes conditions s’appliquent à toute commande passée sur ce site. Passer commande vaut acceptation de ces conditions.</p>
    <h2>3. Articles et prix</h2>
    <p>Les articles proposés sont ceux affichés sur le site, dans la limite des stocks disponibles. Les photos sont présentées à titre indicatif. Les prix sont indiqués en ariary (Ar), toutes taxes comprises ; les frais de livraison sont affichés avant la validation de la commande, selon la zone choisie. Le prix applicable est celui affiché au moment de la commande.</p>
    <h2>4. Commande</h2>
    <p>Le client choisit ses articles, indique ses coordonnées et son mode de livraison, puis valide. Un numéro de commande lui est attribué. Notre équipe l’appelle pour confirmer la commande (article, taille, adresse, heure de passage). Nous pouvons refuser ou annuler une commande en cas de stock épuisé, de coordonnées injoignables ou d’abus ; si la commande a été payée, elle est alors remboursée en totalité.</p>
    <h2>5. Paiement</h2>
    <p>Le paiement s’effectue à la réception, en espèces ou par Mobile Money (MVola, Orange Money, Airtel Money)${card ? `, ou en ligne par carte bancaire (Visa, Mastercard) au moment de la commande. Le paiement par carte est traité de façon sécurisée par Stripe${s.cardEntity ? ` pour le compte de ${esc(s.cardEntity)}` : ''} ; nos services n’ont jamais accès aux données de votre carte` : ''}.</p>
    <h2>6. Livraison</h2>
    <p>Les conditions, zones, délais et frais de livraison sont détaillés sur la page <a href="#/livraison-retours">Livraison et retours</a>. Le client peut suivre sa commande à tout moment sur la page <a href="#/suivi">Suivre ma commande</a>.</p>
    <h2>7. Retours, échanges et remboursements</h2>
    <p>Le client vérifie ses articles à la réception, en présence du livreur. Un article ne correspondant pas à la commande ou présentant un défaut peut être refusé sur place ou signalé dans un délai de ${s.returnDays} jours après la réception. L’article est alors échangé ou remboursé. Les articles doivent être retournés dans leur état d’origine, non utilisés, avec leur emballage. Pour des raisons d’hygiène, les sous-vêtements, préservatifs et articles intimes ne sont ni repris ni échangés s’ils ont été déballés. Les remboursements sont faits par le moyen de paiement utilisé (Mobile Money, espèces${card ? ' ou remboursement sur la carte bancaire' : ''}).</p>
    <h2>8. Garantie</h2>
    <p>Les appareils (caméras, électronique, batteries…) bénéficient, le cas échéant, de la garantie indiquée sur leur fiche ou lors de l’appel de confirmation. La garantie ne couvre pas la casse, une mauvaise utilisation ou un mauvais branchement.</p>
    <h2>9. Données personnelles</h2>
    <p>Les informations collectées servent uniquement à traiter et livrer les commandes. Voir la <a href="#/confidentialite">Politique de confidentialité</a>.</p>
    <h2>10. Réclamations et litiges</h2>
    <p>Pour toute question ou réclamation, contactez-nous (page <a href="#/contact">Contact</a>) : nous recherchons toujours une solution à l’amiable. À défaut, le litige relève des juridictions compétentes d’Antananarivo, selon la loi malgache.</p>
    ${ctx.texts?.termsExtra ? `<h2>11. Conditions particulières</h2>${paras(ctx.texts.termsExtra)}` : ''}`;

  if (kind === 'confidentialite') return `
    <h1>Politique de confidentialité</h1>
    <p class="doc-meta">Mise à jour : ${updated()}</p>
    <h2>Qui est responsable de vos données ?</h2>${identity(s)}
    <h2>Les informations que nous collectons</h2>
    <ul><li>Nom, numéro de téléphone (et un second numéro si vous le donnez), nom Facebook, lieu de livraison et précisions que vous écrivez ;</li>
      <li>le détail de vos commandes (articles, montants, paiements, livraison) ;</li>
      ${card ? '<li>pour un paiement par carte : le résultat du paiement et sa référence. Les numéros de carte sont saisis directement chez Stripe ; nous ne les voyons et ne les conservons jamais ;</li>' : ''}
      <li>votre panier et vos coordonnées sont aussi gardés sur votre propre téléphone ou ordinateur pour vous éviter de les retaper.</li></ul>
    <h2>Pourquoi ?</h2>
    <p>Pour enregistrer et confirmer votre commande, vous appeler, organiser la livraison, encaisser le paiement, gérer un retour, et tenir notre comptabilité. Nous ne vendons ni ne louons jamais vos informations.</p>
    <h2>Qui y a accès ?</h2>
    <p>Notre équipe (vendeurs, responsable, livreur pour l’adresse et le téléphone de livraison) ; nos prestataires techniques qui hébergent les données (Supabase, GitHub)${card ? ', et Stripe pour les paiements par carte' : ''}${ctx.pixel ? ' ; Meta (Facebook) reçoit, par son outil de mesure, les pages vues et les achats faits sur le site, sans votre nom ni votre téléphone' : ''}.</p>
    <h2>Combien de temps ?</h2>
    <p>Le temps nécessaire au suivi de vos commandes et à nos obligations comptables, puis elles sont supprimées.</p>
    <h2>Vos droits</h2>
    <p>Vous pouvez demander à consulter, corriger ou supprimer vos informations, conformément à la législation malgache sur la protection des données personnelles : contactez-nous (page <a href="#/contact">Contact</a>). Vous pouvez aussi effacer les données gardées sur votre appareil en vidant les données du site dans votre navigateur.</p>`;

  if (kind === 'livraison-retours') return `
    <h1>Livraison et retours</h1>
    <h2>Zones et frais de livraison</h2>
    <table class="doc-table"><tbody>${zoneRows}</tbody></table>
    <h2>Délais</h2>
    <p>Après l’appel de confirmation, les commandes sont livrées en général le jour même ou le lendemain à Antananarivo, aux heures d’ouverture. En province, l’envoi se fait par taxi-brousse ou coopérative : comptez 1 à 4 jours selon la destination ; les frais de transport de la coopérative peuvent s’ajouter et vous sont indiqués lors de l’appel.</p>
    <p>Vous pouvez suivre chaque étape sur la page <a href="#/suivi">Suivre ma commande</a> : commande enregistrée, confirmée, préparée, en route avec le livreur, livrée.</p>
    ${ctx.texts?.deliveryNote ? paras(ctx.texts.deliveryNote) : ''}
    <h2>Report de livraison</h2>
    <p>Vous n’êtes pas disponible ? Prévenez-nous : la livraison est reportée au jour qui vous convient (3 reports au maximum).</p>
    <h2>Vérification à la réception</h2>
    <p>Vérifiez vos articles devant le livreur. Si un article ne correspond pas à la commande ou présente un défaut, vous pouvez le refuser sur place : vous ne payez que ce que vous gardez.</p>
    <h2>Retours et échanges</h2>
    <p>Vous avez ${s.returnDays} jours après la réception pour signaler un article défectueux ou non conforme. Il est échangé (taille, couleur) ou remboursé. L’article doit être dans son état d’origine, non utilisé, avec son emballage. Les sous-vêtements, préservatifs et articles intimes déballés ne sont pas repris.</p>
    <h2>Horaires de la boutique</h2>
    <table class="doc-table"><tbody>${hoursText(ctx.company?.hours)}</tbody></table>`;

  if (kind === 'a-propos') return `<h1>À propos</h1>${paras(ctx.texts?.about)}
    <p><a href="#/contact">Nous contacter</a></p>`;

  if (kind === 'contact') return `
    <h1>Contact</h1>
    <p class="lede-doc">Une question sur un article, une commande ou une livraison ? Nous répondons pendant les heures d’ouverture.</p>
    <div class="contact-grid">
      ${s.phone ? `<a class="contact-card" href="tel:${esc(normPhone(s.phone))}"><span>Téléphone</span><strong>${esc(fmtPhone(s.phone))}</strong></a>` : ''}
      ${ctx.messenger ? `<a class="contact-card" href="${esc(ctx.messenger)}" target="_blank" rel="noopener"><span>Messenger</span><strong>Écrire sur Facebook</strong></a>` : ''}
      ${s.email ? `<a class="contact-card" href="mailto:${esc(s.email)}"><span>E-mail</span><strong>${esc(s.email)}</strong></a>` : ''}
      ${s.address ? `<div class="contact-card"><span>Boutique</span><strong>${esc(s.address)}</strong></div>` : ''}
    </div>
    <h2>Horaires</h2>
    <table class="doc-table"><tbody>${hoursText(ctx.company?.hours)}</tbody></table>
    <p>Pour une commande, munissez-vous de votre numéro de commande (ex. WEB-0012) : vous pouvez aussi <a href="#/suivi">la suivre en ligne</a>.</p>`;
  return '';
}

// ---------- Suivi de commande ----------
export function trackForm(prefill = {}, recent = []) {
  return `
    <h1>Suivre ma commande</h1>
    <p class="lede-doc">Entrez le numéro de votre commande et le téléphone donné à la commande.</p>
    <form class="form track-form" id="trackForm" novalidate>
      <div class="field"><label for="t-num">Numéro de commande</label><input id="t-num" name="num" required autocomplete="off" autocapitalize="characters" placeholder="WEB-0012" value="${esc(prefill.number || '')}"></div>
      <div class="field"><label for="t-phone">Téléphone</label><input id="t-phone" name="phone" type="tel" inputmode="tel" required placeholder="034 12 345 67" value="${esc(prefill.phone || '')}"></div>
      <button class="btn" type="submit">Voir le suivi</button>
      <p class="err" id="trackErr" role="alert" hidden></p>
    </form>
    ${recent.length ? `<div class="recent"><p class="lab">Vos dernières commandes sur cet appareil</p><div class="chips">${recent.map((r) => `<button class="chip" type="button" data-track="${esc(r.number)}" data-phone="${esc(r.phone)}">${esc(r.number)}</button>`).join('')}</div></div>` : ''}
    <div id="trackResult" aria-live="polite"></div>`;
}

export function trackResult(t) {
  const { steps, state, note } = trackSteps(t);
  const badge = state === 'done' ? (t.pickup ? 'Retirée' : 'Livrée') : state === 'cancelled' ? 'Annulée' : state === 'refused' ? 'Non livrée' : 'En cours';
  const total = Math.max(0, t.items - (t.discount || 0)) + (t.fee || 0);
  return `
    <article class="track-card">
      <header class="track-head"><div><span class="lab">Commande</span><h2>${esc(t.number)}</h2></div><span class="track-badge ${state}">${badge}</span></header>
      ${note ? `<p class="track-note">${esc(note)}</p>` : ''}
      <ol class="timeline">${steps.map((s) => `
        <li class="${s.done ? 'done' : ''} ${s.current ? 'current' : ''}"><span class="dot" aria-hidden="true"></span>
          <div><strong>${esc(s.label)}</strong>${s.at && (s.done || s.current) ? `<span>${esc(frDateTime(s.at))}</span>` : ''}</div></li>`).join('')}
      </ol>
      ${t.trackingNo ? `<div class="track-box"><span class="lab">Numéro de suivi${t.carrier ? ` — ${esc(t.carrier)}` : ''}</span><strong>${esc(t.trackingNo)}</strong>${t.trackingUrl ? `<a class="btn ghost" href="${esc(t.trackingUrl)}" target="_blank" rel="noopener">Suivre chez le transporteur</a>` : ''}</div>` : ''}
      <div class="track-lines">${(t.lines || []).map((l) => `<div><span>${esc(l.qty)} × ${esc(l.name)}${l.label ? ` <small>(${esc(l.label)})</small>` : ''}</span><span>${esc(fmtAr(l.qty * l.unitPrice))}</span></div>`).join('')}
        ${t.fee ? `<div><span>Livraison${t.zone ? ` — ${esc(t.zone)}` : ''}</span><span>${esc(fmtAr(t.fee))}</span></div>` : ''}
        ${t.discount ? `<div><span>Remise</span><span>− ${esc(fmtAr(t.discount))}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${esc(fmtAr(total))}</span></div>
        <div><span>${t.paidByCard ? 'Payé par carte' : 'Déjà payé'}</span><span>${esc(fmtAr(t.paid))}</span></div>
        ${state !== 'cancelled' ? `<div class="due"><span>Reste à payer${state === 'done' ? '' : ' à la réception'}</span><span>${esc(fmtAr(t.due))}</span></div>` : ''}
      </div>
      ${t.wantedDate && state === 'active' ? `<p class="small-muted">Date souhaitée : ${esc(frDate(t.wantedDate))}</p>` : ''}
    </article>`;
}
