// Réglages du site. Un seul site sert toutes les pages de Tsena :
//   https://<votre-site>/?page=netvision   (ou /netvision)  → page NetVision
//   https://<votre-site>/?page=talo        (ou /talo)       → page Talon (le code de la page dans Tsena)
// Une nouvelle page créée dans Tsena a automatiquement sa boutique : rien à modifier ici.
// Ce fichier ne contient AUCUN secret : la clé « publishable » de Supabase est faite pour être publique.
window.BOUTIQUE = {
  supabaseUrl: 'https://ynduqcvuoelkujyixyub.supabase.co',
  supabaseKey: 'sb_publishable_alV65FV6y9TIH5_30fqW8Q_0R-1G5so',

  // Paiement par carte (Stripe) : false = non ; 'test' = seulement avec &test=carte dans l'adresse ; true = pour tous.
  cardPayment: 'test',
  // Montant minimum pour payer par carte (Stripe refuse les paiements de moins d'environ 0,50 $).
  cardMin: 3000,

  // Mentions légales (CGV, confidentialité). Vide = informations de la fiche Société de Tsena.
  legal: {
    company: '',        // raison sociale, ex. 'TECH VISION SARL'
    email: '',          // e-mail de contact affiché
    nif: '', stat: '',  // sinon ceux de la fiche Société de Tsena
    returnDays: 7,      // délai pour signaler un article défectueux ou non conforme
    cardEntity: 'OASIS OF STYLE LLC', // société qui encaisse les paiements par carte (Stripe)
  },

  // Page affichée à l'adresse principale (vide = liste de toutes les boutiques).
  defaultPage: '',

  // Nom de domaine propre à une page (facultatif), ex. 'netvision.mg': 'NETVISION'.
  hosts: {},

  // Réglages par page, selon son CODE dans Tsena (NETVISION, TALO, BOTT, PYJA…). Tout est facultatif.
  //  facebook  : adresse de la page Facebook
  //  messenger : nom d'utilisateur de la page (m.me/<messenger>) pour le bouton « Écrire sur Messenger »
  //  pixel     : identifiant du Pixel Meta (publicités Facebook : suivi des ventes)
  //  accent    : couleur de la page
  //  hero      : photo d'accueil (fichier dans assets/)
  //  tagline   : phrase d'accueil (sinon le slogan saisi dans Tsena)
  pages: {
    NETVISION: {
      facebook: '',
      messenger: '',
      pixel: '',
      accent: '#5B3DB0',
      hero: 'assets/netvision-hero.jpg',
      logo: 'assets/netvision-logo.png',
      tagline: 'Caméras de surveillance, routeurs et énergie solaire — installés et suivis depuis Ampandrana.',
    },
  },
};
