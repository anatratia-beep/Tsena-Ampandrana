// Nouveautés de chaque mise à jour : affichées une fois après l'installation (bandeau « Logiciel mis à jour »).
// La plus récente en premier. `date` : AAAA-MM-JJ.
export interface Release { date: string; items: string[] }
export const CHANGELOG: Release[] = [
  { date: '2026-10-13', items: [
    'Bandeau « Logiciel mis à jour » et version affichée en bas du menu.',
    'Commande : plusieurs paiements à la création (espèces + mobile money) ; montants acceptés avec espaces ou points (20 000, 20.000).',
    'Articles : outil « Articles en double » (ex. PH6 importé dans deux pages) pour archiver les doublons.',
    'Tri par date d’ajout (plus récent / plus ancien) dans les listes.',
    'Heures limites du compte boost réglables dans Paramètres → Société.',
    'Inventaires : export Excel et PDF de l’historique et de chaque inventaire.',
    'Annuler / modifier : options visibles sur chaque vente, commande et achat selon les droits.',
  ] },
  { date: '2026-10-12', items: ['Corrections de vente, stock remis exactement, recherche exacte, inventaire complet, journal à vérifier, points de restauration, alerte compte boost.'] },
];
