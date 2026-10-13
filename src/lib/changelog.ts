// Nouveautés de chaque mise à jour : affichées une fois après l'installation (bandeau « Logiciel mis à jour »).
// La plus récente en premier. `date` : AAAA-MM-JJ.
export interface Release { date: string; items: string[] }
export const CHANGELOG: Release[] = [
  { date: '2026-10-13', items: [
    'Nouveau menu « Notifications » : consulter, reporter (1 h, 3 h, demain), « Ne plus afficher » (revient seulement si un nouveau problème apparaît) ; textes longs coupés avec « voir plus ».',
    'Synchronisation vérifiée : une modification refusée par le cloud (heure d’un téléphone décalée) est fusionnée et renvoyée. Le nom et les infos de la société arrivent sur tous les appareils ; seuls les champs modifiés sont enregistrés.',
    'Copies cloud contrôlées : faites seulement après une synchronisation complète, relues après l’envoi, nombre de fiches noté ; les copies incomplètes sont signalées.',
    'Photos à la norme (articles 600 px ~50 Ko, reçus 1000 px, logos 256 px) ; les anciennes photos trop lourdes sont réduites automatiquement chaque jour.',
    'Filtre de période (hier, aujourd’hui, demain, jour défini, période) et ordre plus récent / plus ancien sur commandes, ventes, achats, réceptions, articles, stock, clients et dépenses.',
    'Compte boost : le dimanche aussi, avant 17 h le jour même ; premier comptage avec la colonne « veille » pour que le lundi soit juste.',
    'Boutons Annuler / Supprimer en rouge avec icône, partout.',
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
