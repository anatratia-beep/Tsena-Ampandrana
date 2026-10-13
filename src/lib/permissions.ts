// Droits d'accès : chaque rôle est une liste de droits. L'admin peut ajuster la matrice.

export interface PermissionDef { key: string; label: string; group: string }

export const PERMISSIONS: PermissionDef[] = [
  { group: 'Général', key: 'dashboard.view', label: 'Voir le tableau de bord' },
  { group: 'Général', key: 'costs.view', label: "Voir les prix d'achat, marges et bénéfices" },
  { group: 'Articles et stock', key: 'catalog.view', label: 'Consulter les articles et le stock' },
  { group: 'Articles et stock', key: 'catalog.edit', label: 'Créer et modifier les articles, catégories et prix' },
  { group: 'Articles et stock', key: 'stock.adjust', label: 'Ajuster le stock et faire les inventaires' },
  { group: 'Achats', key: 'purchases.manage', label: 'Gérer les achats en Chine et les arrivages' },
  { group: 'Achats', key: 'purchases.receive', label: 'Réceptionner la marchandise' },
  { group: 'Ventes', key: 'orders.create', label: 'Créer les commandes clients' },
  { group: 'Ventes', key: 'orders.prepare', label: 'Préparer les commandes' },
  { group: 'Ventes', key: 'pos.sell', label: 'Vendre en boutique (caisse)' },
  { group: 'Ventes', key: 'returns.manage', label: 'Enregistrer retours et échanges' },
  { group: 'Livraison', key: 'orders.dispatch', label: 'Assigner les commandes aux livreurs' },
  { group: 'Livraison', key: 'deliveries.manage', label: 'Enregistrer le retour des livreurs (livré, refusé, choix rendus, argent rapporté)' },
  { group: 'Livraison', key: 'couriers.view', label: 'Consulter le compte des livreurs (frais gagnés, argent à rendre)' },
  { group: 'Livraison', key: 'courier.self', label: 'Livreur : voir seulement ses colis et son compte' },
  { group: 'Livraison', key: 'couriers.manage', label: 'Créer et modifier les fiches livreurs' },
  { group: 'Argent', key: 'treasury.view', label: 'Voir la trésorerie et les soldes' },
  { group: 'Argent', key: 'cashday.use', label: 'Caisse du jour : saisir les dépenses de la caisse commune et envoyer le récapitulatif global par WhatsApp' },
  { group: 'Argent', key: 'expenses.manage', label: 'Saisir les dépenses et autres revenus' },
  { group: 'Argent', key: 'handover.self', label: 'Vendeur : voir sa feuille de versement du jour (ventes, espèces, mobile money, total à remettre)' },
  { group: 'Argent', key: 'handover.receive', label: 'Responsable : recevoir et valider les versements des vendeurs' },
  { group: 'Argent', key: 'couriers.settle', label: 'Faire les règlements des livreurs' },
  { group: 'Argent', key: 'payout.validate', label: 'Valider le versement de la semaine au patron (clôture la semaine)' },
  { group: 'Argent', key: 'closing.do', label: 'Faire la clôture de journée' },
  { group: 'Publicité', key: 'boosts.enter', label: 'Saisir les résultats des boosts et les messages reçus, ajouter ou arrêter un boost' },
  { group: 'Publicité', key: 'boosts.view', label: 'Voir le suivi et l’analyse des boosts' },
  { group: 'Rapports', key: 'reports.view', label: 'Voir les rapports complets' },
  { group: 'Administration', key: 'users.manage', label: 'Créer les utilisateurs et donner les accès' },
  { group: 'Administration', key: 'settings.company', label: 'Modifier la société (nom, logo, couleur)' },
  { group: 'Administration', key: 'audit.view', label: "Consulter le journal d'activité" },
  { group: 'Administration', key: 'backup.manage', label: 'Faire et télécharger des sauvegardes' },
  { group: 'Administration', key: 'system.admin', label: 'Restaurer, réinitialiser, réparer (super-admin)' },
];

const ALL = PERMISSIONS.map((p) => p.key);
const not = (...ex: string[]) => ALL.filter((k) => !ex.includes(k));

export interface RoleSeed { id: string; name: string; description: string; permissions: string[]; locked?: boolean; system?: boolean }

/** Rôles de départ (identifiants fixes pour être identiques sur tous les appareils). */
export const COURIER_ROLE = 'role-courier';
export const DEFAULT_ROLES: RoleSeed[] = [
  { id: 'role-superadmin', name: 'Super-admin', description: 'Compte technique de secours : mots de passe, restauration, réinitialisation.', permissions: ALL, locked: true, system: true },
  { id: 'role-admin', name: 'Admin / Gérant', description: "Gère toute l'activité, les utilisateurs et leurs accès.", permissions: not('system.admin', 'courier.self'), system: true },
  { id: 'role-owner', name: 'Propriétaire', description: 'Consulte les tableaux de bord et les rapports, sans rien modifier.', permissions: ['dashboard.view', 'costs.view', 'catalog.view', 'treasury.view', 'reports.view', 'audit.view', 'boosts.view'], system: true },
  { id: 'role-seller', name: 'Vendeur', description: 'Gère sa page : répond aux clients, crée les commandes, prépare, vend en boutique, reçoit l’argent de ses colis et le remet au responsable le soir.', permissions: ['dashboard.view', 'catalog.view', 'orders.create', 'orders.prepare', 'deliveries.manage', 'couriers.view', 'pos.sell', 'returns.manage', 'boosts.enter', 'boosts.view', 'cashday.use', 'handover.self'], system: true },
  { id: 'role-manager', name: 'Responsable', description: 'Vend sur sa page comme un vendeur, assigne les livreurs (il sait qui apporte quoi) et reçoit chaque soir le versement de chaque vendeur.', permissions: ['dashboard.view', 'catalog.view', 'orders.create', 'orders.prepare', 'orders.dispatch', 'deliveries.manage', 'couriers.view', 'pos.sell', 'returns.manage', 'boosts.enter', 'boosts.view', 'cashday.use', 'handover.self', 'handover.receive'], system: true },
  { id: 'role-courier', name: 'Livreur', description: 'Voit seulement ses colis à livrer (adresse, téléphone, montant à encaisser) et son compte : argent à rendre, frais gagnés.', permissions: ['courier.self'], system: true },
  { id: 'role-stock', name: 'Magasinier', description: 'Réceptionne la marchandise et fait les inventaires.', permissions: ['dashboard.view', 'catalog.view', 'purchases.receive', 'stock.adjust'], system: true },
];

export const SUPERADMIN_ROLE = 'role-superadmin';
export const ADMIN_ROLE = 'role-admin';
export const MANAGER_ROLE = 'role-manager';
export const SELLER_ROLE = 'role-seller';
