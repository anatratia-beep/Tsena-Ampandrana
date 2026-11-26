# TSENA — connaissance du logiciel
TSENA : logiciel de gestion commerciale d'une boutique à Madagascar qui vend surtout via des pages Facebook : achats en Chine, stock, commandes en ligne livrées par des livreurs, vente sur place, argent des vendeurs, dépenses, versement au patron, publicités (boosts), rapports. Application web installable, fonctionne hors ligne, synchronisée par le cloud. Montants en Ariary (Ar). Semaine de travail : lundi → samedi.

## Vocabulaire
- **Page** = catégorie principale = une page Facebook (ex. « Pyjamas Homme ») ; un article appartient à une page. Un vendeur peut avoir des pages attribuées : il ne voit alors que ses pages.
- **Article** (code, nom, page, prix détail/gros, seuil d'alerte) et ses **variantes** (couleur, taille…, chacune son stock et son prix de revient). **Lot** : article sans stock propre qui regroupe d'autres articles (promotion) ; **prix par quantité** (ex. 3 pour 50 000 Ar). **Prix de gros** automatique à partir de 3 pièces (réglable).
- **Commande client** : livraison (Facebook, téléphone, site web) ou **vente sur place** (canal boutique). **Articles en choix** : envoyés au client pour qu'il choisisse (ex. 3 tailles) ; ce n'est pas une vente tant qu'il ne les garde pas.
- **Livreur** : fiche livreur (pas forcément un utilisateur). **Frais de livraison** : appartiennent au livreur (sauf livreur salarié « frais pour la boutique »), jamais dans le chiffre d'affaires. **À encaisser** = ce que le livreur doit rapporter à la boutique.
- **Versement vendeur** : chaque soir le vendeur remet au responsable l'argent du jour (espèces − frais livreurs gardés − dépenses). **Versement au patron** : chaque semaine, ventes − dépenses de la caisse espèces ; la semaine est alors clôturée.
- **Reste / impayé** : vente pas encore encaissée (colis en livraison, argent chez le livreur, client qui doit encore). « 1er paiement » / « 2ème paiement » : argent d'une vente reçu les jours suivants.
- **Boost** : publicité Facebook payante d'une page (dépense en $, messages reçus).

## Règles de calcul importantes
- **Chiffre d'affaires** : une vente sur place compte le jour de la vente ; une livraison compte le **jour du départ avec le livreur** (pas le jour de saisie). Ce qui revient (refus, retour partiel) est déduit de ce même jour de départ. Une commande annulée ne compte pas. Remises déduites, frais de livraison exclus. Vente interne (employé, au prix de revient) : comptée à part.
- **Stock** = somme des mouvements de stock (réception, vente, sortie livraison, retour, ajustement, inventaire). Le stock baisse quand le colis part. **Alerte** : stock ≤ seuil d'alerte de l'article.
- **Prix de revient** (coût moyen de la variante) = prix Chine + frais + part du transit, calculé à la réception. **Marge brute** = ventes − pièces × prix de revient. Prix d'achat, marges et bénéfices visibles seulement avec le droit « Voir les prix d'achat ».
- **Soldes** : chaque compte (Caisse espèces, MVola, Orange Money, Airtel Money, Banque, Stripe) = paiements reçus par la boutique + mouvements (dépenses, revenus, virements, apports, retraits, règlements livreurs, paiements fournisseurs).
- Une **semaine versée au patron est clôturée** : plus aucune vente, dépense ou retour ne peut y être daté (sauf annulation du versement).
- Toute action importante est notée dans le **journal d'activité** (qui, quand, quoi, appareil). Il n'y a pas de pointage des heures de travail.

## Rôles de départ
{{ROLES}}
Les droits de chaque rôle sont réglables (Administration → Rôles et accès). Un utilisateur peut avoir un rôle principal et des rôles en plus.

## Menus et écrans (selon les droits)
{{MENU}}

## Comment faire (pas à pas)
- **Vendre sur place** : Vente sur place → chercher ou scanner l'article → quantité → (remise) → Encaisser → moyen de paiement (espèces avec monnaie, MVola/Orange avec référence, paiement mixte possible) → ticket imprimé. Vente interne : choisir « Vente interne (employé) ».
- **Créer une commande à livrer** : Commandes clients → Nouvelle commande → téléphone du client (fiche retrouvée automatiquement), articles et variantes (cocher « choix » pour les tailles à essayer), zone (frais par défaut), lieu, paiement déjà reçu éventuel → Enregistrer. Statut « Enregistrée ».
- **Préparer puis remettre au livreur** : la commande passe « En attente de livraison » une fois préparée ; Livraisons et livreurs → assigner un livreur → « En livraison » (le stock sort, la vente compte ce jour-là).
- **Retour du livreur** : Livraisons → En livraison → pour chaque colis : livré, livré en partie, refusé, choix gardés, argent encaissé et moyen ; puis **règlement** du livreur (argent remis, frais gardés ou payés). Reporter une livraison : 3 fois au plus, ensuite la commande est annulée.
- **Échange / retour client** : ouvrir la commande → Échange ou Retour → articles repris et nouveaux articles ; le logiciel calcule la différence (payer ou rembourser).
- **Annuler ou corriger** une vente terminée : réservé aux droits « Corriger les erreurs » (super-admin, gérant), avec motif ; tracé dans le journal.
- **Saisir une dépense** : Caisse du jour (dépense de la caisse commune, jour même) ou Dépenses (toutes, avec catégorie, compte, photo du reçu, charges fixes récurrentes).
- **Versement du soir** : Versements vendeurs → le responsable voit ce que chaque vendeur doit remettre → saisir le montant reçu → Valider (un écart est suivi comme impayé vendeur).
- **Versement au patron** : Récapitulatifs → Semaine → vérifier ventes par page et dépenses → montant remis → Valider (la semaine est clôturée).
- **Ajouter un article** : Articles → Nouvel article (page, valeurs des variantes, prix détail/gros, seuil d'alerte, photo) ; ou Import / Export (modèle Excel par page).
- **Commander en Chine et réceptionner** : Achats et réceptions → nouvel achat (fournisseur, articles, prix en RMB, taux) → suivre le statut → Réception avec la facture du transit (au m³ ou au kg) : le stock entre et le prix de revient est calculé.
- **Inventaire / ajustement** : Stock → Inventaire (compter, valider les écarts) ou Ajuster (motif : casse, perte, vol…).
- **Boosts** : Boosts pub → saisir chaque jour la dépense et les messages de chaque boost avant l'heure limite ; analyse coût par message et ventes par page.
- **Créer un utilisateur** : Administration → Utilisateurs → Nouveau (nom, identifiant, rôle, pages, mot de passe provisoire).
- **Imprimante** : Paramètres → Imprimantes (Bluetooth, USB, port série, fenêtre d'impression ; poste d'impression partagé).
- **Cloud et sauvegardes** : Paramètres → Cloud et synchronisation ; Paramètres → Sauvegardes.
- **Assistant IA** : Paramètres → Intelligence artificielle (admin) ; bulle en bas à droite.

## Statuts et codes
{{STATUTS}}

## Données (tables synchronisées ; chaque fiche a id, createdAt, updatedAt, deleted)
{{TABLES}}
