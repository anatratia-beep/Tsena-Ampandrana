<!-- Fichier GÉNÉRÉ par « npm run ai:context » à partir de docs/ai/AI_CONTEXT.template.md et du code : ne pas modifier à la main. -->
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
- **Super-admin** : Compte technique de secours : mots de passe, restauration, réinitialisation.
- **Admin / Gérant** : Gère toute l'activité, les utilisateurs et leurs accès.
- **Propriétaire** : Consulte les tableaux de bord et les rapports, sans rien modifier.
- **Vendeur** : Gère sa page : répond aux clients, crée les commandes, prépare (le responsable remet les colis au livreur), vend en boutique, reçoit l’argent de ses colis et le remet au responsable le soir.
- **Responsable** : Vend sur sa page comme un vendeur, assigne les livreurs (il sait qui apporte quoi) et reçoit chaque soir le versement de chaque vendeur.
- **Livreur** : Voit seulement ses colis à livrer (adresse, téléphone, montant à encaisser) et son compte : argent à rendre, frais gagnés.
- **Magasinier** : Réceptionne la marchandise et fait les inventaires.
Les droits de chaque rôle sont réglables (Administration → Rôles et accès). Un utilisateur peut avoir un rôle principal et des rôles en plus.

## Menus et écrans (selon les droits)
- Général : Accueil ; Notifications
- Ventes : Vente sur place [pos.sell] ; Commandes clients [orders.create] ; Mes livraisons [courier.self] ; Livraisons et livreurs [deliveries.menu] ; Mon rapport du jour [orders.create ou pos.sell] ; Clients [orders.create] ; Boutique en ligne [settings.company ou catalog.edit]
- Argent : Dépenses [expenses.manage] ; Caisse du jour [cashday.use] ; Versements vendeurs [handover.receive ou handover.self] ; Récapitulatifs [treasury.view] ; Trésorerie [treasury.view]
- Articles et stock : Pages et variantes [catalog.view] ; Articles [catalog.view] ; Stock [catalog.view] ; Étiquettes et QR [catalog.view] ; Achats et réceptions [purchases.manage ou purchases.receive]
- Analyse : Boosts pub [boosts.view] ; Rapports [reports.view]
- Administration : Utilisateurs [users.manage] ; Rôles et accès [users.manage] ; Journal d'activité [audit.view] ; Import / Export [catalog.edit ou orders.create ou treasury.view ou catalog.view] ; Paramètres
- Onglets de Paramètres : Société, Apparence, Imprimantes, Zones de livraison, Cloud et synchronisation, Sauvegardes, Intelligence artificielle, Outils, Système.
(Entre crochets : droit nécessaire pour voir le menu.)

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
- Commande (status) : new = Enregistrée, confirmed = Enregistrée, ready = En attente de livraison, out = En livraison, delivered = Livrée, partial = Livrée en partie, refused = Refusée, cancelled = Annulée. kind : order (commande) ou exchange (échange).
- Canal (channel) : facebook = Facebook, phone = Téléphone, shop = Vente sur place (boutique), web = Site web, other = Autre.
- Moyen de paiement (method) : cash = Espèces, mvola = MVola, orange = Orange Money, airtel = Airtel Money, card = Carte bancaire (site web) ; receivedBy : shop (boutique) ou courier (livreur).
- Achat fournisseur (status) : ordered = Commandée, shipped = Expédiée de Chine, arrived = Arrivée à Madagascar, partial = Reçue en partie, received = Reçue, cancelled = Annulée.
- Mouvement de stock (type, qty + entrée / − sortie) : initial = Stock initial, reception = Réception, sale = Vente, return = Retour client, adjust = Ajustement, inventory = Inventaire, dispatch = Sortie livraison, delivery_return = Retour de livraison, exchange_in = Retour échange.
- Mouvement d'argent (cashMoves.type, amount + entrée / − sortie) : opening = Solde de départ, expense = Dépense, income = Autre revenu, transfer = Virement entre comptes, owner_in = Apport du gérant, owner_out = Retrait du gérant, courier_settlement = Règlement livreur, purchase = Paiement fournisseur (Chine), gap = Écart de clôture.
- Comptes (account) : cash = Caisse espèces, mvola = MVola, orange = Orange Money, airtel = Airtel Money, card = Stripe (cartes, site web), bank = Banque.
- Versement vendeur (handovers.status) : received (reçu) ou cancelled (annulé) ; gap = remis − attendu.

## Données (tables synchronisées ; chaque fiche a id, createdAt, updatedAt, deleted)
- users : utilisateurs (fullName, username, roleId, extraRoleIds, pageIds, courierId, active)
- roles : rôles (name, permissions[])
- settings : réglages (id company : nom, téléphones, horaires, taux du dollar ; id ai : assistant IA)
- audit : journal d'activité (at, action, details, userId, userName, level)
- categories : pages et sous-catégories (name, parentId vide = page, code, attrs = variantes)
- products : articles (code, name, categoryId, priceRetail, priceWholesale, alertQty, active, kind=lot)
- variants : variantes (productId, sku, color, size, costAvg = prix de revient, priceRetail)
- stockMoves : mouvements de stock (variantId, qty, type, at, refId)
- suppliers : fournisseurs
- purchases : achats Chine (number, supplierId, date, currency, rate, status, lines, payments)
- receptions : réceptions (items avec unitCost)
- zones : zones de livraison (name, fee)
- couriers : livreurs (name, phone, active, feeToShop)
- customers : clients (name, phone, facebook, place)
- orders : commandes et ventes (number, channel, status, lines[variantId, qty, unitPrice, isChoice, qtyKept, qtyReturned], payments[at, amount, method, receivedBy], discount, deliveryFee, feeCharged, courierId, dispatchedAt = départ livreur, returnedAt, createdBy, createdByName, internal)
- cashMoves : mouvements d'argent (at, account, amount, type, categoryId, label)
- financeCategories : catégories de dépenses / revenus
- recurring : charges fixes récurrentes
- courierSettlements : règlements des livreurs (courierId, at, amount)
- boosts : publicités Facebook (pageId, dailyBudget, status)
- boostReadings : relevés des boosts (date, spend $, messages)
- pageMessages : messages reçus par page et par jour
- payouts : versements de la semaine au patron (weekStart, amount, status)
- prospects : clients à suivre
- handovers : versements des vendeurs (userId, date, expected, amount, gap)
- inventories : inventaires
- dayReports : rapports du jour des vendeurs
- serials : numéros de série (garantie)
- Autres : closings, courierFund, moneyCounts.
