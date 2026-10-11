# TSENA — Cahier des charges (version 4.2, mise à jour le 09/10/2026 — refonte v4, phases 1 à 3)

> **Nom de l’application : « Trésor en ligne »** (depuis le 09/10/2026 ; anciennement TSENA). Le nom et l’adresse de la société (ex. II VK Ankadindramamy) se règlent dans Paramètres → Société.

> Logiciel de gestion commerciale et de comptabilité : achats (Chine), stock, ventes en ligne et en boutique, livraisons, trésorerie, rapports.
> Fonctionne **en ligne et hors ligne** (coupure de connexion ou de courant), sur **téléphone et ordinateur** (iOS, Android, Windows, macOS).

---

## 1. Principes de base

| Principe | Ce que ça veut dire concrètement |
|---|---|
| **Hors ligne d'abord** | Chaque appareil garde une copie locale des données. On peut vendre, encaisser, préparer, livrer sans Internet. Dès que la connexion revient, tout se synchronise automatiquement. |
| **Rien ne se supprime** | Une vente, un paiement, un mouvement de stock ne s'efface jamais : on l'**annule** avec une contre-écriture et un motif. Tout reste traçable (qui, quoi, quand, sur quel appareil). |
| **Le stock = la somme des mouvements** | Le stock n'est jamais « tapé » directement : il est calculé à partir des entrées, sorties, retours, ajustements. Ça évite les conflits quand deux appareils travaillent hors ligne en même temps. |
| **Tout est paramétrable** | Catégories d'articles, catégories de revenus et de dépenses, zones et frais de livraison, moyens de paiement, rôles : tout s'ajoute sans toucher au code. |
| **Monnaie** | Ariary (MGA) pour tout. Les achats en Chine se saisissent en **RMB (yuan)** ou en **Ariary**, avec le taux de change du jour. |

---

## 2. Utilisateurs, rôles et accès

### 2.1 Les rôles

| Rôle | Pour qui | Peut faire | Ne peut pas faire |
|---|---|---|---|
| **Super-admin** (technique) | Compte de secours | Réinitialiser les mots de passe de tous, forcer une synchronisation, réparer, restaurer une sauvegarde, remettre le logiciel à l'état d'origine | — (mais ne sert pas au travail quotidien) |
| **Admin / Gérant** | Vous | Tout le métier : achats, stock, prix, utilisateurs et droits, dépenses, clôture, rapports complets, bénéfices | Remise à zéro totale (réservée au super-admin) |
| **Propriétaire / Observateur** *(ajout)* | Votre boss | Voir les tableaux de bord et le récapitulatif journalier, en lecture seule | Rien modifier |
| **Vendeur / Opérateur** | Personnes qui répondent sur Facebook et en boutique | Créer clients et commandes, vendre en boutique, préparer les commandes, encaisser, enregistrer retours et échanges. **Gérer les livraisons à la place des livreurs** : assigner les commandes, marquer livré / refusé / choix rendus, enregistrer l'argent rapporté, consulter le compte de chaque livreur (frais gagnés, argent à rendre) | Voir les prix d'achat et les bénéfices, modifier le stock à la main, gérer les utilisateurs |
| **Magasinier** *(ajout, optionnel)* | Personne qui réceptionne la marchandise | Réceptionner les arrivages, faire les inventaires | Vendre, voir la trésorerie |

- **Les livreurs n'utilisent pas l'application.** Ce ne sont pas des utilisateurs mais des **fiches livreurs** (nom, téléphone, axes desservis, actif/inactif) créées par l'admin. Toutes leurs opérations sont saisies par les vendeurs, et chaque saisie garde le nom du vendeur qui l'a faite.
- Seul l'**Admin** crée les comptes et attribue les rôles. Un utilisateur ne peut rien faire avant d'avoir été créé par l'admin.
- Les droits sont présentés sous forme de **matrice cochable** (rôle × fonction) : l'admin peut ajuster un rôle ou créer un rôle personnalisé.
- Chaque utilisateur ne voit **que les menus de son rôle**.
- **Pages attribuées aux vendeurs** *(ajouté le 08/10/2026)* : dans la fiche utilisateur, l'admin coche la ou les pages (catégories principales) du vendeur, ex. Vendeur 1 → « Pyjamas Homme », Vendeur 2 → « Boxer ». À sa connexion, le vendeur voit d'abord : les **articles et le stock** de ses pages, les **articles proposés** dans ses commandes et à la caisse, **ses propres commandes** (et leurs compteurs sur l'accueil) et **ses clients**. Un bouton « Tout » permet de voir exceptionnellement les autres pages. Restent communs à tous : les **livraisons** (à livrer, en cours, livreurs). **Ventes sur place** : la liste du jour montre par défaut « Mes ventes » (bouton « Toutes »). Sans page cochée, le vendeur voit tout.


### 2.2 Connexion et sécurité

- Nom d'utilisateur + mot de passe.
- **Les mots de passe des vendeurs, magasiniers et du propriétaire sont choisis et donnés par le gérant ou le super-admin** (champ mot de passe dans la fiche utilisateur, visible d'eux seuls). Ces utilisateurs ne peuvent pas changer leur mot de passe eux-mêmes : en cas d'oubli, ils s'adressent au gérant. Seuls le super-admin et le gérant gèrent leur propre mot de passe et leur question secrète.
- Compte super-admin par défaut : `super-adm`, avec le mot de passe d'origine communiqué au gérant — **changement obligatoire du mot de passe à la première connexion** (sinon n'importe qui ayant lu ce document pourrait entrer).
- À la première connexion de chaque utilisateur : choix d'une **question secrète** parmi des suggestions proposées automatiquement par le logiciel, + adresse e-mail facultative.
- Mot de passe oublié : par **e-mail** (lien de réinitialisation), par **question secrète**, ou par l'**admin / super-admin**.
- Code PIN rapide (4–6 chiffres) optionnel pour déverrouiller l'appli sur son propre téléphone.
- Déconnexion automatique après inactivité (réglable).
- **Journal d'audit** : chaque action importante est enregistrée (utilisateur, date/heure, appareil, avant/après).

---

## 3. Articles et catégories

- **Catégories et sous-catégories** illimitées (ajout, renommage, archivage).
- **Article** : nom, code/SKU, code-barres (scan par la caméra du téléphone), photo(s), catégorie, unité, prix d'achat moyen (coût de revient), prix de vente détail, prix de gros *(optionnel)*, seuil d'alerte stock, statut (actif / archivé).
- **Variantes** *(ajout important)* : taille, couleur, pointure… Chaque variante a son propre stock. Indispensable pour les « choix » de taille envoyés aux clients.

### 3.1 Pages et variantes *(refonte v4 — phase 1, 09/10/2026)*
Menu **Stock → Pages et variantes**.
- **Une page Facebook = une catégorie**, avec un **code court** (ex. « Lampe rechargeable » → LAMR, modifiable).
- Chaque page porte **autant de variantes que nécessaire** (Modèle, Type, Puissance, Taille, Couleur, Âge, Pointure, Matière…), dans l’ordre voulu, obligatoires ou facultatives. Chaque variante a ses **valeurs** : **libellé complet** (« B22 (baïonnette) ») et **code court** (« B22 »), proposé automatiquement avec un sens (« 7 watts » → 7W, « 2 ans » → 2A, « Bleu marine » → BLM) et modifiable.
- Rien n’est figé : ajout, renommage, réordonnancement à tout moment ; une variante ou une valeur déjà utilisée par des articles est **désactivée** (plus proposée) au lieu d’être supprimée. Ajout de plusieurs valeurs d’un coup (une par ligne).
- **Modèles proposés** à la création d’une page : Vêtements, Vêtements enfant, Chaussures, Électrique / lampes, Accessoires / bijoux, Vide ; plus des variantes courantes en un clic.
- **Article = une valeur par variante.** Nom automatique avec les codes courts (« LP1 B22 7W », modifiable), code article = code de la page + codes (« LAMR-LP1-B22-7W »), libellé complet affiché sur la fiche. Identifiant tiré de la combinaison : le même article créé sur deux appareils hors ligne ne fait qu’un.
- **Créer des articles** : on coche une ou plusieurs valeurs par variante → une ligne par combinaison (celles qui existent déjà sont signalées), on décoche ce qui n’existe pas, on saisit prix de revient, PV détail, PV gros (= détail si vide) et stock de départ, avec « Remplir toutes les lignes ».
- **Recherche** des articles (liste, stock, caisse, commandes, achats) dans le code, le nom, la page et les libellés et codes des valeurs, sans tenir compte des accents ni des majuscules, tous les mots tapés.
- Les anciens articles « couleur / taille » restent utilisables (bouton « créer un article simple »).
- **Supprimer un article** *(10/10)* : possible seulement s’il n’a jamais été vendu, commandé, acheté ni reçu (ex. article de test) ; son stock de départ est effacé avec lui. Sinon : « Archiver ».
- Fiche d’un article par variantes : le bouton crayon de la ligne de stock ne modifie que le **code** (code-barres) et le **coût de revient** (pas de couleur/taille, pas de suppression). Si la ligne de stock a disparu, un bouton **« Rétablir »** la recrée.

- **Photos des articles** *(09/10/2026)* :
  - fiche article → Modifier → « Ajouter une photo » ;
  - dans « Créer des articles » : une photo pour tous les articles créés d’un coup ;
  - dans le **fichier Excel de la page** : image collée dans la ligne (colonne « Photo »), et une image posée sur des lignes fusionnées sert à toutes ces lignes. L’aperçu d’import montre la photo de chaque ligne ; sans image, la photo actuelle est gardée ;
  - même traitement automatique que les autres photos (JPEG compressé).

### 3.1 bis Protection contre les actions risquées *(09/10/2026)*
- Toute **suppression ou action risquée** demande une confirmation, avec un avertissement rouge : « Action risquée… notée dans le journal d’activité avec votre nom ».
- Les plus graves exigent en plus de **taper un mot** : effacer les données, remettre à l’état d’origine, restaurer une sauvegarde.
- **Interdit** quand cela casserait l’historique (il faut alors archiver ou désactiver) :
  - supprimer un article ou une variante déjà vendu, commandé ou acheté ;
  - supprimer une valeur ou une variante de page déjà utilisée ;
  - supprimer une page qui a des articles ;
  - supprimer un rôle encore attribué ;
  - supprimer depuis la Trésorerie un paiement de commande Chine (à faire depuis la commande), un versement de livreur ou un versement au patron.
- **Confirmation avec résumé** :
  - suppression d’un paiement fournisseur (retiré aussi de la trésorerie) ;
  - suppression d’une commande Chine (ses paiements sont retirés de la trésorerie) ;
  - validation du **retour livreur** (montant remis, frais payés) ;
  - changement de la **date de saisie pour tous les appareils**.
- Avertissement dans l’éditeur d’une page qui a déjà des articles (effet d’un changement de libellé ou de code court).

### 3.2 Import Excel par page *(phase 1)*
1. Créer la page et ses variantes (à la main). 2. Télécharger **le fichier de la page** (depuis la page ou Import Excel) : une colonne par variante avec **liste déroulante** des valeurs, puis Nom (facultatif), Prix de revient, PV détail, PV gros, Stock, Alerte stock bas ; les articles existants sont pré-remplis ; onglets « Listes » et « Mode d’emploi ». 3. Importer : **chaque ligne est contrôlée avant d’enregistrer** (valeur inconnue avec la liste des codes permis, variante obligatoire manquante, nombre invalide, doublon dans le fichier, PV détail manquant pour un nouvel article). Aperçu : nouveaux, mises à jour (avec le changement de stock), erreurs en rouge. L’import est bloqué tant qu’il y a des erreurs, sauf si l’on choisit d’importer seulement les lignes correctes. Valeurs acceptées par libellé ou par code, sans tenir compte des majuscules. Article existant : prix et coût mis à jour, stock remis à la quantité du fichier (mouvement « inventaire » tracé).

---

- **Photos des articles** *(ajouté le 08/10/2026)* : toute photo ajoutée (fiche article, import Excel, commande Chine) suit automatiquement le même traitement **avant** d'être enregistrée : redimensionnement à 480 px au plus grand côté → conversion en **JPEG** (format unique, fond blanc) → compression jusqu'à environ **40 Ko** avec une qualité suffisante → enregistrement. Les reçus de dépenses suivent le même principe (1000 px, ~110 Ko). **Une photo par couleur** quand un article a plusieurs couleurs avec des photos différentes (stockée une seule fois par couleur). Photos affichées en grand (caisse, choix des articles, tailles/couleurs) et **agrandies d'un toucher**. Outil « Optimiser les photos » (Paramètres → Outils) pour les photos plus anciennes.

## 4. Achats en Chine → arrivage → stock

### 4.1 Fournisseurs et commandes d'achat
- Fiche fournisseur (nom, contact WeChat/téléphone, ville, notes).
- **Commande d'achat** : fournisseur, date, devise (RMB ou Ariary) + taux de change, lignes (article existant **ou nouvel article / nouvelle catégorie créés à la volée**), quantité, prix unitaire.
- Paiements au fournisseur (acomptes, solde) et suivi de ce qui reste à payer.

### 4.2 Suivi de la commande
- Statuts : **Commandée → Expédiée de Chine → Arrivée à Madagascar → Reçue** (partiellement ou totalement), ou Annulée — avec la date de chaque étape.
- N° de commande 1688, n° de suivi, lien, transitaire.
- Le **taux du RMB** est saisi sur chaque commande (pas de taux fixe) et reste modifiable.

### 4.3 Réception et facture du transit (validé avec le gérant)
- **Les tarifs du transit ne sont jamais fixés à l'avance** : on les saisit **à la réception**, d'après la facture du transitaire.
- Une réception (arrivage) regroupe **une ou plusieurs commandes** reçues ensemble.
- Facture du transit :
  - **Maritime** : volume facturé en **m³** × tarif par m³.
  - **Aérien** : poids facturé en **kg** × tarif par kg.
  - Tarif en **USD, RMB ou Ariary**, avec le **taux de change de la facture**.
  - Autres frais éventuels : dédouanement, transport local, frais du transitaire…
- Répartition des frais sur les pièces reçues : **par quantité** (méthode habituelle du gérant, par défaut), ou par valeur.
- **Coût de revient unitaire** = (prix unitaire + part des frais Chine − part de la remise) × taux du RMB + part du transit + part des autres frais.
- Aperçu avant validation : coût de revient, prix de vente détail/gros et marge de chaque article.
- Le **coût moyen pondéré** de chaque article est recalculé à la réception.

### 4.4 Réception (quantités)
- Réception totale ou **partielle**, avec écarts (manquant, abîmé, en trop) et photos.
- La réception crée automatiquement les **entrées de stock**.
- Vue « **En attente d'arrivage** » : ce qui est commandé et pas encore arrivé, par article (utile pour dire au client « disponible le … »).

---

## 5. Stock

- Emplacements logiques : **Boutique**, **Réservé** (commande préparée), **Chez livreur X** (en cours de livraison ou en choix), **En arrivage**.
- Mouvements : entrée (réception, retour client), sortie (vente), transfert (boutique → livreur → boutique), ajustement (casse, perte, vol, cadeau, usage interne) avec motif obligatoire.
- **Inventaire physique** : comptage (par scan ou saisie), comparaison avec le théorique, validation des écarts par l'admin.
- Alertes : stock bas, rupture, articles dormants (pas vendus depuis X jours), articles les plus vendus.
- Valeur du stock au coût de revient et au prix de vente.

---

## 6. Clients

- Fiche client : nom, téléphone(s) (clé principale), nom/lien Facebook, adresse, **zone de livraison**, notes.
- Historique : commandes, montants, retours, refus.
- *Ajout* : indicateur de **fiabilité** (taux de refus à la livraison) pour repérer les clients qui refusent souvent.
- Recherche instantanée par téléphone pendant la conversation Facebook ; si le client existe déjà, ses infos se remplissent toutes seules.

---

## 7. Commandes en ligne (Facebook) et livraison

### 7.A Refonte v4 — phase 2 *(09/10/2026)* — prime sur les points ci-dessous en cas de différence
**Deux types de vente seulement : vente sur place et vente à livraison.**

**Vente à livraison en 4 étapes** :
1. **Enregistrée** (la commande saisie ; l’ancienne étape « À confirmer » est supprimée) ;
2. **En attente de livraison** (bouton « Préparée — en attente de livraison ») ;
3. **En livraison** (remise au livreur) ;
4. **Retour livreur** → **Terminée** (livrée, livrée en partie ou refusée).

Onglets des commandes : Enregistrées, En attente de livraison, En livraison, Terminées, Annulées.

- **Étiquette du colis** (ticket **58 mm**) pendant la préparation :
  - contenu : n° de commande, client, téléphone et lieu en gros, articles avec les **choix**, articles, remise, frais de livraison, paiements déjà reçus, **« À ENCAISSER »** (dont articles / dont frais), ou « RIEN À ENCAISSER — DÉJÀ PAYÉ », observations ;
  - **QR code** qui ouvre la commande ;
  - impression depuis la commande, ou toutes les étiquettes d’un coup (Livraisons → En attente de livraison, cochées ou toutes) ;
  - QR natif sur imprimante ticket, image sur les autres imprimantes.
- **Paiement avant le retour du livreur** (MVola, espèces en boutique) : « Paiement reçu » à toute étape ; il est affiché comme déjà payé et n’est pas demandé au livreur.
- **Retrait en boutique** :
  - **commande enregistrée ou en attente** : bouton « Retrait en boutique » → la livraison est **annulée** (pas de frais, pas de livreur) et la commande devient une **vente sur place** au moment du paiement ;
  - **commande déjà chez le livreur** : au retour, « Le client vient chercher en boutique » → les articles reviennent en boutique, réservés pour le client, sans frais pour le client ni dédommagement pour le livreur ; elle devient une vente sur place quand le client paie.
  - Dans les récapitulatifs, ces ventes comptent comme ventes sur place.
- **Retour livreur** (Livraisons → Retour livreur), le compte avec le livreur en un seul écran :
  - par colis : **Livrée / Refusée**, « En partie / choix… », « Client en boutique… » ;
  - **frais de livraison modifiables** (client qui a payé moins) ; paiements déjà reçus affichés ;
  - totaux séparés : **prix des articles encaissés**, **frais encaissés auprès des clients**, **total que le livreur a en main**, frais qui lui reviennent (dont frais déjà payés à la boutique), reste des fois précédentes ;
  - **règlement des frais du livreur** :
    - **retenus** sur l’argent versé ;
    - **payés à part** (caisse ou Mobile Money, le livreur remet tout) ;
    - **plus tard** (sur son compte, à payer un autre jour depuis Comptes livreurs → Versement) ;
  - montant remis modifiable, compte de réception ; un colis avec un choix à préciser bloque seulement ce colis.
- **Livreurs = utilisateurs** :
  - rôle **« Livreur »** dans Utilisateurs, relié à une fiche livreur (existante ou créée automatiquement) ;
  - avec son accès, il voit **seulement « Mes livraisons »** : ses colis en cours (adresse, téléphone, articles, montant à encaisser, articles et frais séparés), ce qu’il doit rendre, ses dernières livraisons et ses versements ;
  - un livreur sans accès reste une simple fiche (Comptes livreurs).
- **Choix de tailles avec les articles par variantes** : en ajoutant un article à une commande, les articles voisins (même page, une seule variante différente, ex. les autres âges du même modèle) sont proposés pour « Vendu » ou « En choix ».
- **Caisse (vente sur place)** :
  - filtre par page ;
  - recherche dans le libellé des variantes ;
  - **code ou code-barres + Entrée = ajout direct** au panier (lecteur de code-barres) ;
  - tuiles avec les valeurs des variantes ;
  - sur téléphone, barre « Panier · total · Encaisser » toujours visible.

### 7.0 Saisie (validé avec le gérant, reprend le cahier des vendeurs)
- **Contact du client : obligatoire.** Nom : facultatif. La fiche client est créée ou complétée automatiquement.
- **Lieu de livraison : obligatoire** avant d'enregistrer la commande (l'option « lieu à confirmer » a été retirée).
  - **Sur boutique** (retrait par le client) : frais de livraison **0 Ar automatiquement**, **aucun livreur** ; la commande se termine par « Remis au client en boutique ».
  - **Livraison** : lieu précis, **frais obligatoires** et **livreur obligatoire**.
- La rubrique **Commandes clients** est réservée aux commandes des clients (Facebook, téléphone…). Les ventes directes en boutique se font dans la rubrique **Ventes → Vente sur place** (écran de comptoir : client, contact et lieu facultatifs ; panier, prix de gros dès 3 pièces, remise, paiement en un ou plusieurs moyens, monnaie à rendre).
- Les zones et leurs frais se gèrent dans **Paramètres → Zones de livraison** (ou Livraisons → Zones et frais).
- Articles, quantités, prix (détail, ou gros dès 3 pièces / accordé à la main), frais de livraison (selon la zone, modifiables), récapitulatif « total + frais », observations.
- **Horaires** : lundi–vendredi 8 h–17 h, samedi 8 h–14 h. Les commandes sont reçues **tous les jours, dimanche compris** ; celles reçues hors horaires sont marquées « hors heures » et préparées à l'ouverture.

### 7.1 Cycle de vie d'une commande

```
Brouillon → Confirmée → En préparation → Prête → Assignée au livreur → En livraison
   → Livrée (totale ou partielle) / Refusée → Clôturée
```

- **Création** par le vendeur : client, articles (+ variante), quantités, prix, remise éventuelle, zone, frais de livraison, date/créneau souhaité, mode de paiement prévu, notes.
- **Hors heures d'ouverture** : la commande est enregistrée et apparaît dans la file « À préparer à l'ouverture ».
- **Préparation** : liste de préparation, cochage article par article, la marchandise passe en « Réservé ».
- **Articles en choix** : lignes marquées « choix » (ex. 3 tailles envoyées pour 1 achetée). Ils sortent physiquement avec le livreur mais **ne sont pas une vente**.

### 7.2 Livraisons
- **Zones / axes de livraison** paramétrables, chacun avec un **tarif par défaut** ; le montant peut être modifié à la main.
- Regroupement des commandes par axe, **feuille de route** pour chaque livreur (imprimable).
- **Changer de livreur** : une commande déjà attribuée peut être réattribuée à un autre livreur (fiche commande → « Changer », ou Livraisons → En cours → « Changer de livreur »), avec un motif. La commande et l'argent déjà encaissé passent du compte du premier livreur au compte du nouveau ; les frais de livraison iront au nouveau livreur ; l'historique de la commande garde la trace « Livreur changé : A → B ». **Possible uniquement tant que le versement du livreur n'est pas validé** (règlement par l'admin, étape 6).
- Au retour du livreur, **le vendeur** enregistre pour chaque commande : livrée, refusée, articles pris parmi les choix, articles rendus, montant encaissé et par quel moyen.

### 7.3 Retours, refus et échanges
- **Refus à la livraison** : la marchandise revient en stock, la commande est annulée (motif obligatoire : taille, couleur, qualité, client absent…).
- **Choix non retenus** : retour en stock, sans impact sur le chiffre d'affaires.
- **Échange (le lendemain ou plus tard)** : article rendu + nouvel article ; le logiciel calcule la **différence** (le client paie le complément, ou on lui rembourse / on lui fait un avoir). Frais de livraison facturés ou offerts au choix.
- **Avoir client** *(ajout)* : un montant à valoir sur un prochain achat, au lieu d'un remboursement.
- Motifs de retour suivis dans les rapports (pour voir quels articles reviennent le plus).

---

## 8. Vente en boutique (caisse)

- Écran de caisse rapide : recherche ou scan, panier, remise, paiement (espèces avec calcul de la monnaie à rendre, mobile money avec **référence de transaction**), **paiement mixte** (ex. une partie en espèces + une partie MVola).
- **Prix de gros** : appliqué automatiquement **à partir de 3 pièces** (seuil réglable dans les paramètres). Le vendeur peut aussi **l'accorder à la main** à un client qui en prend moins (ex. 2 pièces) ; ce choix est enregistré avec la vente.
- Impression du ticket de caisse.
- Mise en attente d'un panier, reprise plus tard.
- **Vente interne (employés)** *(ajout du 08/10/2026)* : achat d'un employé en boutique. Dans la caisse, choisir « Vente interne (employé) » puis l'employé qui achète. Chaque article est vendu à son **prix de revient arrondi au palier supérieur** : à l'ariary supérieur par défaut (ex. 2 562,55 → 2 563 Ar), ou aux 50 / 100 / 500 / 1 000 Ar supérieurs (réglage dans Paramètres → Société). Prix non modifiable, pas de remise ni de prix de gros ; vente impossible si un article n'a pas de prix de revient. Numéro **VI-xxxx**, ticket « VENTE INTERNE » avec le nom de l'employé, stock mis à jour comme une vente normale. Les ventes internes comptent dans les ventes sur place et apparaissent à part (« dont ventes internes ») dans la synthèse, le récapitulatif envoyé au responsable et le rapport des ventes (filtre « Ventes internes »).

---

## 9. Paiements, trésorerie et comptes livreurs

### 9.1 Comptes de trésorerie
- **Caisse espèces**, **MVola**, **Orange Money**, **Airtel Money** (+ banque si besoin). Pas de chèques.
- Solde de chaque compte en temps réel.
- **Virements entre comptes** (ex. retrait MVola → caisse) et retraits / apports du gérant.

### 9.2 Moments de paiement
- **Avant livraison** (souvent mobile money) : la commande est marquée « payée ».
- **À la livraison** : c'est le livreur qui reçoit l'argent → ce montant devient **une dette du livreur envers la boutique** jusqu'à ce qu'il le remette.
- **Acompte / paiement partiel** possible.

### 9.3 Frais de livraison — séparés du chiffre d'affaires
- Les frais de livraison **appartiennent au livreur** : ils ne comptent **pas** dans les entrées de la boutique.
- Chaque livreur a un **compte courant** :
  - **+** frais de livraison gagnés,
  - **+** argent client encaissé par le livreur (à rendre),
  - **−** argent remis à la boutique,
  - **−** frais que la boutique lui a reversés (cas où le client a payé article + frais par mobile money à la boutique).
- **Règlement livreur** (fait **uniquement par l'admin**) : à chaque remise d'argent, le logiciel affiche ce que le livreur doit rendre ou ce qu'on lui doit, et garde l'historique complet de chaque transfert.

### 9.4 Dépenses et autres revenus (pour tout type d'activité)
- **Catégories de dépenses** paramétrables : loyer, salaires, électricité, eau, Internet/crédit, carburant, publicité Facebook, emballage, entretien, impôts, etc. (ajout illimité).
- **Catégories d'autres revenus** paramétrables : location, prestations, commissions, etc.
- **Opérations récurrentes** *(ajout)* : loyer mensuel, salaires, abonnement… générées automatiquement à l'échéance et à confirmer.
- Pièce jointe (photo du reçu).

- *Réalisé (étape 6)* : menu **Argent → Trésorerie** : soldes en temps réel (ventes payées en boutique + mouvements), dépenses avec photo du reçu, autres revenus, virements entre comptes (avec frais de retrait), apports et retraits du gérant, solde de départ de chaque compte, opérations récurrentes à confirmer. Les paiements aux fournisseurs chinois peuvent sortir d'un compte (montant en Ariary). Remboursement d'un client (échange moins cher) depuis la commande. Versement des livreurs dans **Livraisons → Livreurs → « Versement »** : l'admin **coche les livraisons réellement effectuées** ; seules celles-ci sont comptées dans le montant à verser, les autres restent sur le compte du livreur et sont **reportées automatiquement** au versement suivant. Une livraison cochée encore « à confirmer » est marquée livrée ; une livraison pas faite, refusée ou avec retour se corrige par « Retour / anomalie ». Versement partiel possible (le reste est reporté), historique gardé ; les commandes versées ne peuvent plus changer de livreur. **Ticket des livraisons** (58 mm) à remettre au livreur : pour chaque commande, client, lieu, articles, ce que le client paie, frais, à verser, cases « Livré / Pas livré / Retour » et remarque ; il le rapporte au moment du versement.

### 9.5 Frais du livreur, paiements Mobile Money et corrections *(ajouté le 07/10/2026)*
- Le client paie d'abord les **articles**, puis les **frais de livraison**. Le livreur **garde ses frais** : ils ne sont **jamais** dans le « montant à encaisser » ni dans les totaux des ventes, des récapitulatifs ou du tableau de bord ; ils apparaissent seulement **pour information**, avec le total réellement payé par les clients.
- **À encaisser** (compte livreur) = ce que le livreur encaisse pour la boutique. Exemple : articles 50 000 Ar, Mobile Money 20 000 Ar → **30 000 Ar à encaisser** (+ ses frais qu'il garde).
- **Commande entièrement payée par Mobile Money** : 0 Ar à encaisser, mais la livraison reste dans le compte du livreur (trace de qui a livré). Si les frais ont aussi été payés à la boutique, ils sont comptés à part comme **« frais à reverser »** au livreur en espèces (déduits au versement).
- Par défaut, le client paie tout à la livraison ; dans la commande, « Paiement déjà reçu » permet d'indiquer un paiement total ou partiel par Mobile Money (boutons « Articles payés » / « Tout payé ») et affiche ce que le livreur encaissera.
- **Correction d'un paiement** (admin et gérant) : nouveau montant et/ou moyen, motif ; l'ancien montant, le nouveau, la date et l'utilisateur restent visibles sous le paiement, dans l'historique de la commande et dans le journal. Reste à payer et compte du livreur se recalculent.

- **Livraisons avec articles en choix** *(règle du 08/10/2026)* : tant que le client n’a pas dit ce qu’il garde, la livraison porte le badge rouge **« Choix à préciser (n) »** (liste des commandes, fiche commande, « En livraison », versement). On le précise avec le bouton **« Préciser le choix du client »** (fiche commande, onglet « En livraison » ou directement dans la fenêtre de versement) : pour chaque ligne « choix », le nombre de pièces gardées doit être saisi (0 si tout est rendu) avant de pouvoir valider. **Le versement de cette livraison est bloqué** (case non cochable, refus aussi côté calcul) tant que le choix n’est pas renseigné.

---

## 10. Récapitulatif journalier et hebdomadaire *(remplace la « clôture de caisse », modifié le 07/10/2026)*

Les livreurs versent généralement le lendemain (ou en fin de semaine) : il n'y a donc **pas de comptage des billets** ni de verrouillage de la journée. À la place :

### 10.1 Récapitulatif journalier (menu Argent → Récapitulatifs → Journée)
- **Ventes sur place** (liste, heure, paiement, montant).
- **Livraisons du jour** par livreur : commande, lieu, état (pas encore confirmée / livrée / refusée / versée), ce que le client paie, frais du livreur, **montant à verser**.
- **Comptes livreurs** : livraisons du jour, à verser pour le jour, déjà versé, **compte à ce jour** (y compris les livraisons non versées des jours précédents).
- **Paiements reçus** par compte (espèces boutique, MVola, Orange Money, Airtel Money, versements des livreurs), **dépenses** et **autres mouvements** (virements, apports, retraits, autres revenus, paiements fournisseurs).
- Soldes en fin de journée et **espèces attendues** (caisse + à verser par les livreurs) ; bénéfice brut pour les utilisateurs autorisés.
- Règle de comptage inchangée : un article parti chez un livreur (hors choix) est vendu le jour du départ ; ce qui revient est un retour le jour du retour.

- **Synthèse de la journée** (en tête du récapitulatif, et dans le message envoyé au responsable) : ventes sur place, livraisons (nombre) et **total général**, avec deux colonnes **« Montant sans retour »** (ce qui est vendu ou parti en livraison ce jour-là) et **« Montant avec retour »** (corrigé automatiquement quand les retours sont constatés au versement des livreurs, même les jours suivants) ; **par livreur** : nombre de livraisons, **frais qui lui reviennent**, retours, montants ; **par catégorie (page)**, avec le ou les vendeurs : montants sans / avec retour. Le jour même les deux montants sont égaux ; dès qu'un retour est enregistré, le récapitulatif du jour concerné est marqué **« corrigé »** et peut être renvoyé. Même synthèse jour par jour dans le récapitulatif de la semaine.

### 10.2 Récapitulatif hebdomadaire (lundi → samedi)
- Tableau **jour par jour** : sur place, livraisons, total des ventes, espèces reçues, mobile money, versements des livreurs, dépenses ; total de la semaine (le dimanche est ajouté seulement s'il y a eu de l'activité).
- **Comptes livreurs de la semaine** et **total à verser en espèces** par les livreurs en fin de semaine.

### 10.3 Envoi au responsable
Journée ou semaine, en un clic : WhatsApp, SMS, e-mail, partage (Messenger…), copie, impression 58 mm ou PDF.

- **Détail du bénéfice brut** *(ajout du 08/10/2026)* : tableau dépliable, article par article (variante) : pièces vendues (moins les retours), ventes, prix de revient par pièce, coût total, bénéfice. Bénéfice brut = total des ventes (remises et retours déduits) − pièces × prix de revient de chaque variante ; frais de livraison non comptés. Les articles vendus sans prix de revient sont signalés.

### 10.3 bis Caisse du jour des vendeurs *(ajout du 09/10/2026)*
Menu **Ventes → Caisse du jour** + raccourci sur l’accueil (droit « Caisse du jour », donné aux vendeurs et à l’admin / gérant).
- **Une seule caisse commune** pour tous les vendeurs : pas de caisse ni de suivi de dépenses par vendeur. Chaque dépense saisie va dans le compte **Caisse espèces**, quel que soit le vendeur ; son nom est noté (traçabilité).
- **Saisie des dépenses du jour** : montant, catégorie (Dépenses diverses par défaut), description obligatoire, photo du reçu facultative. Saisie le jour même uniquement ; un vendeur peut supprimer sa propre dépense du jour ; les autres corrections passent par le gérant (Trésorerie). Impossible sur une semaine déjà versée au patron.
- **Récapitulatif global du jour**, identique pour tous les vendeurs : ventes par page, **total des ventes de tous les vendeurs** (sur place / livraisons), détail et **total des dépenses de la caisse commune**, **montant net du jour = total des ventes − dépenses de la caisse commune**.
- **Aperçu à vérifier avant l’envoi** : (1) tableau de toutes les ventes du jour de tous les vendeurs — heure, n°, type (sur place, livraison, retour), client, page, articles, vendeur, montant, total ; (2) tableau des totaux transmis (ventes par page, total, dépenses de la caisse commune, montant net) ; (3) **points à contrôler** : livraisons encore chez les livreurs, choix à préciser, commandes confirmées pas encore remises au livreur, ventes sans page, ventes à 0 Ar.
- **Vérification obligatoire** : le vendeur coche « ventes vérifiées », « dépenses vérifiées », « totaux confirmés » puis « Confirmer la vérification » (noté dans le journal d’activité). Les boutons WhatsApp ne s’activent qu’après. Si une vente ou une dépense change ensuite, l’envoi est de nouveau bloqué jusqu’à une nouvelle vérification.
- **Envoi WhatsApp en un clic** (après vérification) : au gérant, au patron (numéros dans Paramètres → Société) ou à un autre contact / groupe ; bouton Copier. Chaque envoi est noté dans le journal d’activité.

### 10.4 Tableau de la semaine et versement au patron *(ajout du 09/10/2026)*
Inspiré du cahier Excel « Recette et Dépense » (onglets RECAP JOURNALIER / HEBDOMADAIRE / MENSUEL).

- **Tableau de la semaine** (Récapitulatifs → Semaine) : une ligne par jour (lundi → samedi), une colonne par **page** (catégorie principale ayant des ventes ou un boost), puis **Total ventes**, **Dépenses** et **Reste** (= ventes − dépenses) ; ligne Total ; ligne **Boost** (dépense $ × taux du dollar, réglable dans Paramètres → Société, 4 700 Ar par défaut) ; ligne **Bénéfice** par page (ventes − coût des articles − boost, visible seulement avec le droit « Voir les prix d’achat… »). Export Excel (onglets Semaine et Dépenses).
- **Versement de la semaine** (droit « Valider le versement de la semaine au patron », donné à l’Admin / Gérant) :
  - semaine = **lundi → samedi** ; en ouvrant la vue Semaine un jour de semaine, c’est la **semaine précédente** qui s’affiche ;
  - **Montant à verser = total des ventes de la semaine − total des dépenses de la caisse commune** (compte « Caisse espèces » ; une dépense payée par MVola, banque… n’est pas déduite) ;
  - avant de valider, le gérant voit le détail : ventes par page, chaque dépense (jour, libellé, catégorie, compte, montant) et le montant à verser ; il saisit le **montant réellement remis** (par défaut le montant à verser), le compte d’où sort l’argent (caisse espèces par défaut) et une remarque (**obligatoire en cas d’écart**), puis coche la confirmation ;
  - possible seulement une fois la semaine terminée (à partir du samedi) ;
  - à la validation : une sortie de trésorerie « Versement au patron » est créée, la semaine est **clôturée**, et l’opération est tracée : période, montant attendu, montant remis, écart, date et heure, gérant, appareil, détail des ventes par page et des dépenses ;
  - **jamais deux fois la même semaine** : un seul versement par semaine (identifiant unique de la semaine, même depuis deux appareils hors ligne) ;
  - **semaine clôturée** : plus aucune vente sur place, remise au livreur, retour de livreur, retrait ou échange en boutique, ni ajout ou suppression de dépense ou de revenu ne peut y être daté ; le message indique qui a validé et quand ;
  - **annulation** (en cas d’erreur seulement, même droit) avec une raison obligatoire : la semaine est rouverte, l’annulation reste visible dans l’historique et le journal d’activité.
- **Historique des versements** : semaine, ventes, dépenses, à verser, remis, écart, validé par / le, remarque, état (versé / annulé) ; liste des **semaines terminées pas encore versées** (12 dernières) ; export Excel.

---

## 9 bis. Dépenses, charges fixes et notifications *(refonte v4 — phase 3, 09/10/2026)*

**Menu Argent → Dépenses** (saisie : droit « Saisir les dépenses » ; consultation aussi avec « Voir la trésorerie »).

- **« + Ajouter une dépense »** :
  - champs : montant, date, **catégorie**, **type** (Dépense courante, Charge fixe, Dépense exceptionnelle…), payé depuis (caisse par défaut), description, note, photo du reçu ;
  - une catégorie ou un type qui manque se crée **directement dans la liste** (« + Nouvelle catégorie… », « + Nouveau type… »), sans passer par les réglages ;
  - interdit sur une semaine déjà versée au patron.
- **Liste** :
  - filtres : **période** (aujourd’hui, semaine, mois, année, dates libres…), **catégorie**, **type**, recherche (description, note, montant, personne) ;
  - totaux : total, totaux par type, barres par catégorie ;
  - tableau triable (date, description, catégorie, type, compte, saisi par, montant) avec ligne de total, reçu visible ;
  - suppression confirmée ; **export Excel** (liste et totaux par catégorie).
- **Charges fixes** (loyer, salaires, JIRAMA, internet…) :
  - définies une fois : montant, catégorie, type (Charge fixe par défaut), compte ;
  - répétition : chaque jour, chaque semaine (jour choisi), chaque mois (jour du mois) ou chaque année (jour et mois) ;
  - **heure du rappel**, mois de début, active ou arrêtée ; prochaine échéance affichée ;
  - **le jour et à l’heure venus**, la charge apparaît « à payer » (en tête du menu Dépenses et en notification) : **Payer** (montant et compte modifiables : la dépense est enregistrée avec le type Charge fixe) ou **Ignorer l’échéance** (confirmation) ; « Plus tard » = fermer la notification ;
  - les charges fixes de revenus restent possibles.
- **Catégories et types** : ajout, renommage, désactivation (jamais supprimés, pour garder l’historique). Les catégories d’autres revenus et les autres revenus restent dans Trésorerie.
- **Rythme de chaque catégorie de dépense** *(09/10/2026)* : à la création (aussi pendant la saisie d’une dépense), on répond à « Cette dépense revient… » : chaque jour, chaque semaine, chaque mois, chaque année, ou de temps en temps (imprévu) ; puis, si elle revient régulièrement, **montant variable** ou **toujours le même montant**. Le **type est déduit tout seul** : imprévu → Dépense exceptionnelle ; même montant → Charge fixe (avec, si on le souhaite, le rappel créé tout de suite : montant habituel, compte, jour) ; montant variable → Dépense courante. Les catégories d’origine ont un rythme par défaut (Loyer et Salaires : mois, montant fixe ; Carburant et transport : jour…), modifiable.
- **Nouvelle dépense** : on choisit d’abord la catégorie ; le type s’affiche (« changer » reste possible), le montant habituel d’une charge fixe est prérempli, sinon « Dernière fois : … » le propose ; si une échéance de cette charge est à payer, « Payer l’échéance » est proposé (pas de double saisie) ; si elle est déjà payée pour la période, un avertissement de doublon s’affiche. La description devient facultative (nom de la catégorie par défaut).

**Notifications** (cloche en bas du menu et en haut sur téléphone, avec le nombre ; bandeau en haut des pages pour les 3 plus importantes) :

| Importance | Notifications | Revient après × |
|---|---|---|
| Urgente | Charge fixe à payer (une par charge, avec le nombre d’échéances en attente), livraisons avec choix à préciser | 1 h |
| Importante | Semaines terminées pas encore versées au patron, stock presque épuisé ou en rupture, conflits de synchronisation | 2 h |
| Information | Pas de sauvegarde depuis 7 jours | 5 h |

- Chaque notification a un **×** (elle revient plus tard), **« Pas aujourd’hui »**, **« Ouvrir »**, et **« Payer »** pour une charge.
- Dans la cloche, les notifications reportées montrent leur **heure de retour** et peuvent être réaffichées.
- Chacun ne voit que ce qui concerne ses droits. Le report est propre à chaque appareil.

## 10 bis. Boosts publicitaires *(ajout du 08/10/2026)*

Menu **Ventes → Boosts pub** (droits « Saisir les résultats des boosts » pour les vendeurs, « Voir le suivi et l’analyse des boosts » pour le propriétaire).

- **Boost** : page (catégorie principale), **n°** = position dans la liste de l’Espace Pubs (1 = le premier), texte de la publicité, date de lancement, budget par jour ($). Seuls les boosts **actifs** sont enregistrés ; un boost qui n’est plus actif est **arrêté** (dernier jour + raison : peu performant, remplacé, budget terminé…). Un numéro déjà pris par un boost actif est refusé ; en modification, les deux numéros sont échangés.
- **Saisie du jour** (avant la fin de journée, par le vendeur) : pour chaque boost actif, la **dépense cumulée ($)** et les **conversations cumulées** affichées par Meta (bouton « = » si rien n’a changé), puis les **messages réellement reçus** sur la page ce jour-là. Tous les boosts actifs doivent être saisis.
- **Contrôle** : une valeur cumulée reste stable ou augmente, jamais elle ne baisse. Une valeur inférieure à la saisie précédente (ou supérieure à une saisie plus récente, en cas de correction) est signalée en rouge et l’enregistrement est bloqué.
- **Calcul** : messages théoriques du jour d’un boost = valeur du jour − valeur de la saisie précédente (la 1re saisie compte tout depuis le lancement) ; total théorique du jour = somme des boosts ; **écart = réel − théorique** (et réel en % du théorique) ; dépense du jour ; coût par message réel ; commandes en ligne de la page ce jour-là (pour suivre messages → commandes).
- **Semaine (lundi → dimanche)** : par page, tableau jour par jour (chaque boost, total théorique, réel, écart, dépense, coût par message, commandes) et totaux de la semaine ; vue « Toutes les pages » avec les totaux par page et par jour. Export Excel.
- **Performance des boosts** (7, 14 ou 30 jours) : par boost, messages, dépense, coût par message, messages des 3 derniers jours, total depuis le lancement, et un **avis** : Bon (≥ 20 % moins cher que la moyenne de la page), Moyen, Faible (≥ 30 % plus cher, aucun message depuis 3 jours, ou dépense sans message → à arrêter et remplacer), Trop récent. Bandeau d’alerte listant les boosts à arrêter. Export Excel.

---

## 11. Tableaux de bord et rapports

### 11.1 Un tableau de bord par rôle
- **Admin / Propriétaire** : chiffre d'affaires, **bénéfice et perte** (par heure, jour, semaine, mois, année), marge, dépenses, trésorerie par compte, valeur du stock, arrivages en attente, argent chez les livreurs, meilleurs articles, articles dormants, taux de retour.
- **Vendeur** : ses ventes, ses commandes à préparer, commandes en attente, objectifs.
- **Suivi des livreurs** (dans l'espace du vendeur et de l'admin) : par livreur, les livraisons du jour, ce qui est encore dehors (articles et argent), les frais gagnés, l'argent à rendre.

### 11.2 Filtres partout
- Période : aujourd'hui, hier, cette semaine, ce mois, cette année, **intervalle libre**.
- Type de mouvement : entrées / sorties, ventes, retours, dépenses, virements…
- Par utilisateur, livreur, zone, catégorie, article, client, moyen de paiement.
- Tri sur chaque colonne, export Excel / PDF.

### 11.3 Rapports
- Journal des ventes, journal de caisse, journal des dépenses.
- Compte de résultat simplifié (chiffre d'affaires − coût des marchandises vendues − dépenses = bénéfice net).
- État du stock et valorisation, mouvements de stock par article.
- Rapport livreurs, rapport achats/arrivages, rapport clients.
- Comparaison entre périodes (ce mois vs mois dernier).

### 11.4 Réalisé (étape 7)
- **Accueil (admin, gérant, propriétaire)** : période au choix (retenue sur l'appareil) ; chiffre d'affaires, bénéfice brut, dépenses, **bénéfice ou perte nette**, taux de marge, nombre de ventes (sur place / en ligne), panier moyen, taux de retour, chacun **comparé à la période précédente** ; graphique du bénéfice net par heure / jour / mois (barres rouges = perte) ; trésorerie par compte + à verser par les livreurs ; stock (pièces, valeur au coût et au prix de vente), arrivages en attente, reste à payer aux fournisseurs ; meilleurs articles ; articles dormants (60 jours sans vente).
- **Accueil (vendeur)** : ses ventes de la période (nombre, montant, pièces, graphique), sans les marges.
- **Menu Argent → Rapports** (droit « Voir les rapports complets ») : Bénéfice et perte (compte de résultat avec comparaison, graphique, mois par mois), Journal des ventes (filtres canal, vendeur, livreur, zone, paiement, recherche), Articles (par article ou catégorie, marge, retours, stock ; articles dormants), Clients, Livreurs (livraisons, taux de réussite, à encaisser sans les frais, frais à reverser, versé, solde), Vendeurs, Stock (valorisation), Achats. Tri sur chaque colonne, ligne de total, **export Excel**.
- **Récapitulatif mensuel** *(ajout du 09/10/2026, premier onglet des Rapports)* : 3, 6 ou 12 derniers mois ; par mois : ventes par page, **CA réalisé**, **dépenses**, **reste** (CA − dépenses), **versé au patron** (versements validés des semaines commençant dans le mois), **boost** en ariary et **bénéfice net estimé** (CA − coût des articles − boost − dépenses) ; cartes de totaux en tête ; export Excel.
- Les montants de coût et de marge ne s'affichent qu'avec le droit « Voir les prix d'achat, marges et bénéfices ». Les frais de livraison ne sont jamais dans le chiffre d'affaires.

---

## 12. Import et export Excel

- Menu **« Modèles Excel »** : téléchargement de fichiers d'exemple prêts à remplir, avec une feuille d'explication et des exemples :
  1. Catégories
  2. Articles + **stock initial** + coût de revient + prix de vente (une feuille par catégorie acceptée, comme vos fichiers actuels)
  3. Fournisseurs
  4. **Achats en attente d'arrivage** (commandes déjà passées en Chine)
  5. Clients
  6. Zones et frais de livraison
  7. Catégories de dépenses / revenus
- Import avec **aperçu et contrôle des erreurs** avant validation (doublons, prix manquants, catégories inconnues créées automatiquement sur confirmation).
- Saisie manuelle toujours possible, une par une.
- Export Excel de toutes les listes et rapports.

---

## 13. Impression

- **Documents** : ticket de caisse (vente sur place, avec espèces reçues et monnaie rendue), ticket client d'une commande, **bon de livraison** (remis au livreur : client, lieu, articles et choix, **montant à encaisser**, signature), **feuille de route livreur** (toutes ses commandes en cours et le total à encaisser) et bons de livraison groupés.
- Format **58 mm** (32 colonnes) par défaut, 80 mm ou A4 possibles. Logo, nom, slogan, téléphone, adresse, NIF/STAT et message de pied de ticket repris de Paramètres → Société.
- **Choix de l'imprimante par son nom** au moment d'imprimer, depuis n'importe quel téléphone ou ordinateur, avec aperçu et nombre d'exemplaires. Le dernier choix devient l'imprimante par défaut de l'appareil.
- **Moyens d'impression** (Paramètres → Imprimantes, propres à chaque appareil) :
  - **Bluetooth direct** (Android Chrome, ordinateur Chrome/Edge), **USB direct** et **port série / Bluetooth appairé** (ordinateur) : impression ESC/POS, jeu de caractères réglable pour les accents, coupe papier en option, page de test ;
  - **fenêtre d'impression de l'appareil** (AirPrint sur iPhone/Mac, imprimantes installées sur Windows, PDF) : toujours disponible ;
  - **partage en image** (WhatsApp, Messenger, photos).
- **Poste d'impression partagé** : un appareil relié à l'imprimante (ex. téléphone Android ou ordinateur de la caisse) reçoit par le cloud les tickets envoyés par les autres appareils (iPhone compris) et les imprime automatiquement ; état en ligne / hors ligne visible et historique des impressions.
- Option par appareil : **ticket imprimé automatiquement après chaque vente sur place**.
- Imprimante conseillée : thermique 58 mm ESC/POS, Bluetooth + USB.
- *Plus tard* : étiquettes articles avec code-barres et prix, récapitulatif de clôture et rapports en PDF.

---

## 14. Sauvegarde, synchronisation, restauration

| Fonction | Détail |
|---|---|
| **Enregistrement local instantané** | Chaque action est écrite immédiatement sur l'appareil (pas besoin d'attendre 15 s : même une coupure de courant juste après ne fait rien perdre). |
| **Synchronisation cloud automatique** | Toutes les 15 s quand il y a du réseau, + immédiatement après chaque opération. Indicateur visible : 🟢 synchronisé / 🟠 en attente / 🔴 hors ligne (avec le nombre d'opérations en attente). |
| **Sauvegarde manuelle** | Bouton « Sauvegarder maintenant » → fichier téléchargeable (chiffré, protégé par mot de passe). |
| **Sauvegardes automatiques** | Quotidienne, hebdomadaire, mensuelle, conservées dans le cloud (historique). |
| **Restauration** | À partir d'une sauvegarde cloud ou d'un fichier ; réservée à l'admin / super-admin, avec confirmation. |
| **Transfert** | Nouveau téléphone / ordinateur : il suffit de se connecter, les données se chargent. |
| **Réinitialisation** | (a) vider les données de test en gardant les paramètres ; (b) **remise à l'état d'origine** complète. Réservées au super-admin, double confirmation + sauvegarde automatique juste avant. |
| **Outils de réparation** | Forcer la resynchronisation, recalculer les stocks à partir des mouvements, vérifier la cohérence. |

### 14.1 Réalisé (étape 8)
- **Copies automatiques dans le cloud** : une par jour, faite par l'appareil d'un admin ou du gérant (vérifié toutes les heures). Conservation : **7 quotidiennes, 5 hebdomadaires, 12 mensuelles** ; les plus anciennes sont effacées automatiquement, les copies manuelles jamais. Liste des copies avec restauration, suppression et nettoyage (Paramètres → Sauvegardes).
- **Fichier de sauvegarde** chiffré par mot de passe (facultatif), restauration par fichier ou depuis le cloud (super-admin, mot à taper « RESTAURER », sauvegarde de l'état actuel juste avant).
- **Effacer les données de test** (super-admin, Paramètres → Système) : choix des données (ventes, clients, trésorerie, mouvements de stock, achats, impressions, et si voulu articles, fournisseurs, livreurs, journal), en gardant toujours paramètres, utilisateurs, rôles, zones, catégories de dépenses, opérations récurrentes et imprimantes. Mot à taper « EFFACER », fichier + copie cloud juste avant, effacement envoyé à tous les appareils.
- **Remise à l'état d'origine** (super-admin) inchangée.
- **Mot de passe oublié par e-mail** (super-admin et gérant) : un lien est envoyé à l'adresse e-mail du **compte cloud de la société** ; en l'ouvrant sur un appareil relié au cloud, on choisit le nouveau mot de passe (lien valable 1 heure, réinitialisation tracée). Réglage nécessaire une fois dans Supabase : Authentication → URL Configuration → Site URL = adresse de l'application. La question secrète et la réinitialisation par le gérant restent possibles.
- **Code PIN** (4 à 6 chiffres, propre à chaque appareil, Mon compte) pour déverrouiller après le verrouillage automatique ; après 5 erreurs, le mot de passe est demandé.
- **Date de saisie commune** *(modifié le 09/10/2026)* (admin et gérant, Paramètres → Outils) : choisir un jour passé pour des essais ou pour rattraper un cahier. La date s’applique à **tous les utilisateurs et tous les appareils** (réglage synchronisé, reçu dès la synchronisation) et reste en place, même après déconnexion ou redémarrage, jusqu’à ce que l’admin ou le gérant la change ou clique « Revenir à aujourd’hui (tous) ». Ventes, commandes, livraisons, retours, paiements, versements, dépenses et mouvements de stock prennent ce jour (heure actuelle). Bandeau orange sur toutes les pages de tous les appareils, avec le nom de la personne qui a fixé la date ; seul l’admin / gérant voit le bouton de retour. Changement tracé dans le journal. La synchronisation garde l’heure réelle.
- **Outils** (admin, Paramètres → Outils) : vérification de la cohérence (stock recalculé depuis les mouvements, stocks négatifs avec correction tracée, variantes orphelines, articles sans coût, commandes sans livreur, trop-perçus, impayés, numéros en double), **export complet en Excel** (sans mots de passe ni photos), espace utilisé et nombre d'enregistrements ; **Tout resynchroniser** et **Chercher une mise à jour** (Système).

### Fonctionnement hors ligne et synchronisation fiable *(renforcé le 08/10/2026)*

- **Base locale sur chaque appareil** (IndexedDB) : tout est enregistré d’abord sur l’appareil, avec ou sans Internet. Chaque modification est mise dans une **file d’envoi** dans la même opération (rien ne peut être enregistré sans être mis en file). Envoi automatique dès que la connexion revient (et toutes les 15 s, au retour sur l’application, après chaque saisie).
- **Version par information** : chaque champ d’un enregistrement garde la date de sa dernière modification, donnée par une **horloge logique** qui ne recule jamais (elle tient compte des modifications déjà reçues : un téléphone à l’heure fausse ne fait pas gagner une ancienne valeur).
- **Fusion** : deux appareils qui modifient des informations différentes d’une même fiche gardent tous les deux leurs modifications ; les **paiements** et l’**historique** sont réunis élément par élément (deux paiements saisis hors ligne sur deux appareils = deux paiements). Même résultat sur tous les appareils, quel que soit l’ordre d’arrivée ; recevoir deux fois la même chose ne change rien.
- **Conflit réel** (la même information modifiée sur deux appareils avant synchronisation) : la plus récente est gardée partout ; l’autre valeur est notée dans **Paramètres → Cloud et synchronisation → Conflits** (qui, quel appareil, quand), avec « Rétablir l’autre valeur » ou « C’est bon ».
- **Pas de doublons** : identifiant unique créé sur l’appareil (un envoi répété remplace, n’ajoute pas) ; **lettre par appareil** dans les numéros (C-A0012, C-B0012, V-A0003…) ; un **client** est identifié par son téléphone et une **catégorie** par son nom (créés sur deux appareils hors ligne = une seule fiche) ; les mouvements de stock et de caisse sont des ajouts (jamais réécrits).
- **Convergence** : réception et fusion, envoi, puis nouvelle réception ; si la fusion garde des modifications locales, elles repartent automatiquement. Le cloud ne garde jamais une version plus ancienne qu’une plus récente.
- **Traçabilité** : chaque enregistrement garde la personne et l’appareil de la dernière modification ; journal d’activité ; liste des appareils reliés (lettre, dernière connexion).
- **Plusieurs onglets** ouverts sur le même appareil : ils se tiennent à jour entre eux.

---

## 15. Interface et installation

- Interface moderne, rapide, pensée **d'abord pour le téléphone**, confortable aussi sur ordinateur.
- Thème **clair / sombre / automatique** (selon le téléphone).
- **Couleur principale au choix**, nom et logo de la société modifiables.
- Langue : **français**.
- **Application web installable (PWA)** : icône sur l'écran d'accueil, plein écran, fonctionne hors ligne — sur iPhone/iPad (Safari → « Sur l'écran d'accueil »), Android (Chrome → « Installer »), Windows et macOS (Chrome/Edge → « Installer »).

---

## 16. Choix techniques (proposés)

| Élément | Choix | Pourquoi |
|---|---|---|
| Application | React + TypeScript, PWA | Un seul code pour tous les appareils, installable, hors ligne |
| Base locale | IndexedDB (Dexie) | Données sur l'appareil, fonctionne sans réseau |
| Cloud | **Supabase** (PostgreSQL + authentification + e-mails) | Offre gratuite suffisante pour démarrer, sauvegardes, envoi d'e-mails de réinitialisation |
| Hébergement de l'appli | GitHub Pages (gratuit), déployé automatiquement depuis le dépôt `TSENA-1` | Chaque mise à jour du code est en ligne en quelques minutes |
| Impression | Impression navigateur au format ticket (tous appareils) + Bluetooth direct sur Android/PC | iPhone ne permet pas le Bluetooth direct depuis une appli web |

---

## 17. Plan de réalisation pas à pas

| Étape | Contenu | Ce que vous pourrez faire à la fin |
|---|---|---|
| **0** | Validation de ce cahier des charges ✅ | — |
| **1** | Fondations : appli installable, connexion, rôles, super-admin, thème, logo, mode hors ligne + synchronisation | Installer l'appli, créer les utilisateurs |
| **2** | Catégories, articles, variantes, stock + **modèles Excel et import** | Charger votre stock actuel |
| **3** | Fournisseurs, achats Chine, expéditions, coût de revient, réception | Saisir les commandes en attente d'arrivage |
| **4** | Clients, commandes Facebook, préparation, livraisons, choix, retours, échanges | Travailler les commandes en ligne |
| **5** | Caisse boutique, paiements, tickets | Vendre en boutique |
| **6** | Trésorerie, dépenses, comptes livreurs, clôture + récapitulatif boss | Fermer la journée et envoyer le résumé |
| **7** | Tableaux de bord, rapports, bénéfice / perte, filtres, exports | Piloter l'activité |
| **8** | Sauvegardes, restauration, réinitialisation, journal d'audit, outils de réparation | Sécuriser les données |

Chaque étape est mise en ligne et testée avec vous avant de passer à la suivante.

## 9 ter. Clients à suivre *(refonte v4 — point 15, 09/10/2026)*

**Commandes clients → onglet « À suivre »** (premier onglet ; pastille rouge = nombre de relances en retard ou du jour).

- **Saisie séparée de la commande** : bouton « Client à suivre » à côté de « Nouvelle commande » (les deux ne sont pas mélangés).
- **Fiche** : seul le **nom Facebook** est obligatoire. Le reste se note quand on le sait : téléphone, page, priorité (haute, normale, basse), ce qui l'intéresse (article du catalogue, avec ou sans quantité, ou texte libre « pyjama lapin, taille à voir »), **ce qu'il attend** (sa confirmation, une information, son paiement, arrivage/stock, autre ; proposé automatiquement selon ce qui manque), précision, lieu de livraison, notes, **date de relance** (demain 9 h par défaut ; raccourcis : dans 2 h, ce soir 18 h, demain 9 h, dans 3 jours, dans 1 semaine).
- **Liste** : trois groupes bien séparés et colorés, par date de relance par défaut : **À relancer maintenant (en retard)** en rouge, **Aujourd'hui**, **Plus tard**. Tri au choix dans chaque groupe : date de relance, priorité, montant estimé, ajoutés récemment, nom. Filtres : statut (en cours, transformés, abandonnés) et motif d'attente ; recherche. Chaque ligne montre la priorité, le motif, le montant estimé, la prochaine relance et **ce qui manque**.
- **Relancé** : une ligne sur ce qui s'est passé (raccourcis : pas de réponse, attend encore…), nouveau motif si besoin, prochaine relance. Tout est gardé dans l'historique.
- **Notification** « N client(s) à relancer » quand l'heure de relance est passée (ses propres suivis ; le gérant voit tout).
- **Transformer en commande** : possible seulement quand tout est coché : téléphone, lieu (zone + lieu précis, ou retrait en boutique), article précis du catalogue, quantité de chaque article, réponse attendue reçue (« Le client a répondu », ou « Paiement reçu… » pour un paiement). La commande s'ouvre **préremplie** (client, articles, quantités, lieu, frais, livreur de la zone, paiement déjà reçu, notes) ; une fois enregistrée, le suivi passe en « Transformé » avec le lien vers la commande. Le paiement noté sur le suivi n'entre en caisse qu'à la création de la commande (jamais compté deux fois).
- **Abandonner** (raison : pas de réponse, trop cher, a acheté ailleurs, article indisponible, autre) ; proposé quand il n'y a pas de nouvelles depuis **7 jours** (le vendeur décide). Un suivi abandonné peut être rouvert.
- Le suivi **ne réserve pas le stock**.

## 9 quater. Listes longues *(règle commune, 09/10/2026)*

Une liste de choix ne doit pas prendre toute la place : peu d'options → boutons côte à côte ; beaucoup d'options → **liste déroulante** (choix unique) ou **liste déroulante à cases** avec recherche (choix multiple). Appliqué : période des tableaux et rapports, pages de la vente sur place, choix du livreur au retour, pages attribuées à un vendeur, axes d'un livreur ; dans Dépenses, les catégories du graphique sont limitées aux 5 premières (« Voir les autres »).

## 9 quinquies. Phases 4, 5 et 6 de la refonte v4 *(09/10/2026)*

**Clients (phase 4).** Une seule information suffit pour une fiche : téléphone, nom Facebook ou lieu (bouton « Nouveau client » dans Clients). Champ **Nom Facebook** sur la fiche et sur la commande. Dans « Nouvelle commande », la case **« Client déjà connu ? »** cherche un client (téléphone, Facebook, nom, lieu) et remplit ses informations ; la commande rejoint son historique (pas de doublon : la fiche Facebook reçoit le téléphone). La fiche client montre aussi ses suivis « À suivre ».

**Recherche partout.** Chaque recherche porte sur tout le contenu (commandes : numéro, client, Facebook, téléphone, lieu, zone, livreur, articles, codes, montant, observations ; clients : nom, Facebook, téléphones, lieu, notes), sans accents ni majuscules ; un numéro se trouve avec ou sans espaces (« 034 12 » = « 03412 », « +261 34… »).

**Listes longues.** Au-delà de 12 choix, une liste déroulante devient une liste **avec recherche** (zones, catégories, pages…), partout dans l'application.

**Menu (phase 5), du plus important au moins important :** Accueil · Ventes (Vente sur place, Commandes clients, Livraisons et livreurs, Clients) · Argent (Dépenses, Caisse du jour, Récapitulatifs, Trésorerie) · Articles et stock (Pages et variantes, Articles, Stock, **Achats et réceptions** réunis avec deux onglets) · Analyse (Boosts pub, Rapports) · Administration (Utilisateurs, Rôles, Journal, **Import / Export**, Paramètres).

**Import / Export.** Onglet Importer (modèles par page, fichiers habituels) et onglet **Exporter** : un classeur Excel par sujet (ventes et commandes avec les articles vendus, clients, clients à suivre, dépenses, stock, versements au patron) ou **tout dans un seul classeur**. Le coût n'apparaît qu'avec le droit de le voir.

**Tableau de bord, dans l'ordre :** 1. Ventes (période au choix, chiffre d'affaires, nombre de ventes, panier moyen, retours) ; 2. Commandes (clients à relancer, enregistrées, en attente, en livraison, à rendre par les livreurs) ; 3. Dernières ventes et commandes ; 4. Dépenses et bénéfice, évolution **par jour au minimum** (plus de détail par heure), trésorerie, stock, meilleurs articles ; 5. Stock faible ; puis mise en route et état de l'appareil.

**Page d'installation.** En ouvrant le lien dans le navigateur (avant connexion) : bouton « Installer Trésor en ligne » (Android, ordinateur) ou tutoriel en 3 étapes (iPhone : Partager → Sur l'écran d'accueil → Ajouter) ; « Continuer dans le navigateur » ; ne s'affiche plus une fois installée.

**Compatibilité.** Code produit en ES2019 avec petits compléments : Android 8 et plus (Chrome 64+), iPhone iOS 12.2 et plus, ordinateur Chrome/Edge. Un navigateur trop ancien affiche un message clair au lieu d'une page blanche. (Sur iOS 12 à 14.4, quelques espacements peuvent être plus serrés.)

**Sauvegardes (phase 6).** **Mot de passe des sauvegardes défini une seule fois** par un admin ; il n'est jamais stocké en clair (une copie chiffrée par personne, avec son mot de passe de connexion). Pour sauvegarder, chacun confirme seulement **son mot de passe de connexion** (la première fois, ou après un changement de mot de passe de connexion, il saisit une fois le mot de passe des sauvegardes). Sur ordinateur (Chrome/Edge) : **dossier choisi une fois**, chaque sauvegarde y va directement. Sur téléphone : message « Enregistré dans Téléchargements : nom du fichier » et bouton **Partager** (Drive, WhatsApp, e-mail). Restauration : mot de passe des sauvegardes ou mot de passe de connexion.

**Historique de synchronisation** (Paramètres → Cloud) : « date — N envoyé(s), N reçu(s), N conflit(s) », ou l'erreur rencontrée ; 100 dernières lignes, propres à l'appareil.

**Règles d'écran communes (09/10/2026).** Tout champ obligatoire porte une **petite étoile rouge \***. Quand on passe d'un écran à un autre par un lien (pas par le menu), une flèche **« Retour : <écran précédent> »** permet de revenir où l'on était. Dans « Nouvelle commande », « Gérer les zones de livraison » s'ouvre par-dessus la commande, qui est gardée (« Revenir à la commande »).

**Commandes et caisse (10/10/2026).**
- **Stock vérifié** : impossible d'enregistrer une commande ou une vente si une quantité dépasse le stock disponible (stock − pièces promises aux autres commandes) ; message « diminuez la quantité ou choisissez un autre article ». Le stock disponible s'affiche **à côté du nom** de chaque article ajouté (vert, orange si ≤ 3, rouge si insuffisant), ainsi que « en stock » dans les commandes Chine et les réceptions.
- **Prix détail par défaut, prix de gros article par article** : petite case discrète « Prix de gros » sur chaque ligne (à côté de « Envoyé en choix »). L'ancien choix « gros automatique dès N pièces » est supprimé.
- **Remise en Ar ou en %** (le montant en Ar est affiché).
- Le rappel « question secrète / mot de passe provisoire » de l'accueil se ferme (×) jusqu'à la prochaine connexion.

## 9 sexies. Rapport au patron et tableau de bord de décision *(10/10/2026, proposition v5 — étape a et tableau de bord)*

**Périodes.** Toutes les listes et analyses datées s'ouvrent sur **« Aujourd'hui »** (tableau de bord, rapports, dépenses, trésorerie, commandes terminées, mouvements de stock, journal). Flèches **‹ ›** pour la période précédente / suivante de même longueur.

**Rapports → « Rapport au patron »** (premier onglet). Type : **Jour** (par défaut), **Semaine** (du lundi au samedi ; le dimanche est compté s'il y a eu des ventes), **Mois**, **Année**, **Période** (du … au …), avec ‹ › pour naviguer.
- **Résultat** : CA, dépenses (toutes), reste (CA − dépenses), boost Facebook ($ × taux, sauf rapport du jour), **bénéfice net** = CA − coût des articles vendus − dépenses (− boost hors rapport du jour : « sans boost » pour le jour) ; chaque chiffre comparé à la période précédente.
- **CA par page** : barres + tableau triable (CA, part, pièces, coût, boost, bénéfice) ; les pages sans vente ne sont pas affichées.
- **Stock** (au prix de revient, hors rapport du jour) : valeur au début + entrées (réceptions, ajustements) − valeur à la fin = **valeur du stock sorti**, dont vendu (coût des ventes) et autres sorties ; **stock par page** (pages sans stock non affichées).
- **Envoi** : texte **WhatsApp** au patron, **PDF A4** (impression ou « Enregistrer en PDF », en-tête société, tableaux, pied de page), **Excel**. « Envoyé le … » est noté ; **rappels** : rapport du jour à partir de 18 h, de la semaine le lundi, du mois le 1er, de l'année le 1er janvier (jusqu'à l'envoi).

**Tableau de bord, dans l'ordre :** a. Ventes (période, CA, nombre de ventes, panier moyen, retours) ; b. Dépenses et bénéfice ; c. État des commandes ; d. **Meilleures ventes** de la période : articles ou pages, tri par CA, quantité ou bénéfice, ou dernières commandes ; e. Graphe du bénéfice net par jour (par mois sur une année) ; puis argent, stock, articles dormants, stock faible, mise en route.

## 9 septies. Aides à la décision et affichage sur téléphone *(10/10/2026)*

- **Objectifs de vente** (Paramètres → Société : objectif par jour et par mois) : barres de progression sur l'accueil ; pour le mois, un trait indique le rythme à tenir et l'écart est affiché ; objectif rappelé dans le rapport du jour / du mois.
- **Comparaison avec le même jour de la semaine dernière** (accueil, période « Aujourd'hui »).
- **À surveiller** (accueil) : articles **bientôt en rupture** (stock ÷ ventes moyennes des 30 derniers jours, ≤ 14 jours), **boosts pas rentables** ce mois (bénéfice de la page après boost négatif, et CA rapporté par 1 $), **anomalies** des 7 derniers jours (article vendu sous son prix de revient, remise > 20 %, écart de versement).
- **Rapport au patron** : colonne « CA pour 1 $ de boost » par page.
- **Rapports → Clients à suivre** : taux de transformation (transformés ÷ transformés + abandonnés) par vendeur et par page, raisons d'abandon.
- **Téléphone** : une seule notification en haut (la plus importante, format compact), les autres dans la cloche ; dans les listes, le montant passe sous le nom (le nom garde toute la largeur) ; lignes d'articles d'une commande empilées (article, puis quantité, prix, montant) ; tableaux larges glissables avec une ombre qui l'indique. Contrôle automatique de tous les écrans et onglets à 360, 390, 768 et 1280 px, en clair et en sombre (`scripts/design-check.mjs`) : aucun débordement.

**Règlement du livreur dans la commande (10/10/2026).** Quand une commande passe de **En livraison** à **Terminée** (« Enregistrer le retour du livreur » / « Préciser le choix du client »), la fenêtre affiche clairement : a. articles après le choix du client, b. frais de livraison (modifiables), = à payer par le client, c. déjà payé à la boutique (moyen et référence), e. reste à verser par le livreur (frais compris), puis, avec « Régler maintenant avec le livreur » (coché par défaut) : g. frais du livreur (gardés sur le versement, payés à part en espèces / MVola / Orange / Airtel, ou différés), « Le livreur doit vous remettre », f. montant versé et compte. Un écart oblige à écrire une remarque. Bouton « Terminer et régler avec le livreur ». Pour plusieurs colis à la fois : Livraisons → Retour livreur. L'onglet « Comptes livreurs » sert à consulter (bouton « Régler » → Retour livreur).

**Frais des livreurs, Livraisons et accueil (10/10/2026).**
- Chaque commande livrée affiche **« Frais de livraison du livreur : X Ar »** avec son état : gardés par le livreur, payés au livreur (date, moyen), **différés : à payer** (bouton « Payer les frais »), ou pas encore réglés. Les frais différés se paient aussi depuis le compte du livreur (Livraisons → Comptes livreurs → toucher le livreur : chaque livraison avec ses frais et leur état, filtre « Frais différés », « Payer » ou « Tout payer ») et depuis Retour livreur ; le livreur les voit dans « Mes livraisons » (liste des livraisons concernées) et peut les réclamer.
- **Livraisons et livreurs** : onglets dans l'ordre Comptes livreurs, En attente de livraison, En livraison, Retour livreur, Zones et frais ; filtres **livreur**, **période** et **recherche** (n°, client, téléphone, lieu, article, montant) sur les comptes, les commandes en attente et en livraison.
- **Accueil** : en premier, la période puis le **Résumé** (CA − Dépenses = Reste, et Bénéfice net) ; puis Ventes avec le **CA par page** (CA, part, pièces, ventes, bénéfice brut ; le total = le CA), Dépenses et bénéfice, Commandes, Meilleures ventes, graphe, et le reste.

**Finitions (10/10/2026).**
- **Comptes livreurs** : colonne « Frais différés » (montant à lui payer et nombre de livraisons) visible directement dans le tableau. L'état « différé » d'une livraison est toujours accordé au compte réel du livreur (si le livreur a finalement gardé ses frais, la livraison n'apparaît plus « à payer » mais « Réglés »).
- **Commandes terminées** : chaque ligne indique « Frais livreur X Ar » et leur état (gardés, payés, différés, réglés).
- **Vente sur place** : plus de liste de tous les articles ; recherche (ou code scanné) → résultats compacts (photo, prix, stock) ; « Parcourir le catalogue » ouvre la fenêtre de choix ; le panier reste visible.
- **Accueil** : Résumé en une carte claire (période et lien « Rapport au patron » sur la même ligne ; CA, Dépenses, Reste, Bénéfice net), sans signes − et =.
- **Boutons et pastilles** plus sobres et proportionnés : hauteur 40 px (34 px dans les tableaux, listes et cartes), contour fin, sans ombre épaisse ; pastilles sans contour noir ; sur téléphone, les boutons d'en-tête se partagent la ligne.

## 9 octies. Caisse, aides repliables, groupes de boutons, synchronisation après mise à jour *(10/10/2026)*

| Point | Règle |
|---|---|
| Quantité à la vente sur place | La quantité de chaque ligne se tape directement au clavier (ex. 102) ; les boutons − / + restent pour les petits ajustements. Le contrôle du stock s'applique à la quantité tapée. |
| Longues explications | Toute explication de plus de 2 lignes est repliée : on voit le début, puis « Voir plus » pour tout lire (« Voir moins » pour replier). |
| Groupes de boutons (Jour / Semaine / Mois / Année / Période, filtres de stock, onglets de graphique…) | Toujours sur **une seule ligne**, même sur téléphone. S'il manque de place, le groupe glisse horizontalement avec le doigt ; il ne pousse plus la page hors de l'écran. Les titres longs passent à la ligne. |
| Graphique Bénéfice et perte | Au minimum par jour (le détail par heure n'est plus affiché), comme le tableau de bord. |
| Mêmes menus sur ordinateur et téléphone | Le menu est identique ; sur téléphone, les entrées sont dans la barre du bas + « Menu ». |
| Synchronisation après mise à jour | Quand une nouvelle version ajoute un type de données (ex. clients à suivre), l'appareil retélécharge automatiquement tout le cloud une fois. Corrige le cas d'un téléphone resté sur une ancienne version qui avait reçu ces données sans les garder. |

## 9 nonies. Lots, promotions et prix par quantité *(10/10/2026)*

| Point | Règle |
|---|---|
| Création | Articles → « Nouvel article » → choix : **Article (avec couleurs, tailles…)** ou **Lot ou promotion**. |
| Lot / promotion | Article sans stock propre : nom, code (automatique si vide), page, **prix du lot**, articles contenus avec quantité par lot. Pour chaque article : variante imposée ou **« au choix à la vente »** (ex. 3 pyjamas : 2 roses + 1 bleu choisis en vendant), case **Cadeau** (offert). Dates de début / fin facultatives : hors dates, le lot n'est plus proposé (badge « Promotion terminée »), l'historique reste. |
| Fiche du lot | Prix du lot, valeur des articles séparés, ce que gagne le client, nombre de lots possibles avec le stock, marge (prix de revient cadeaux compris). |
| Vente (commande et vente sur place) | Le lot apparaît dans la recherche (badge « Lot »). On choisit le nombre de lots et les couleurs au choix (ajout bloqué tant que le compte n'y est pas). Les articles du lot sortent du stock ; une ligne « Prix du lot » donne la différence avec les prix normaux. Quantités du lot non modifiables ligne par ligne ; « Retirer le lot » enlève tout le lot. |
| Retour partiel | Le client peut rendre tout le lot ou une partie. Le prix du lot ne compte que pour les **lots complets gardés** ; les articles gardés d'un lot incomplet sont payés **au prix normal**. Les articles rendus reviennent en stock. |
| Prix par quantité | Dans la fiche d'un article (« Modifier ») : ex. **3 pièces pour 50 000 Ar**. Appliqué automatiquement dès que la quantité est atteinte (couleurs/tailles mélangées), plusieurs paliers possibles, pas sur les lignes au prix de gros ou au prix modifié. Même règle au retour : le reste repasse au prix normal. |
| Rapports | Un article vendu dans un lot complet compte pour le lot (meilleures ventes, CA par page) ; le stock et la fin de stock prévue restent calculés sur les articles réels. Ticket et bon de livraison affichent la ligne « Prix du lot / prix par quantité ». |

## 10 ter. Boosts : saisie par semaine, pause, ordre, messages → chiffre d'affaires *(10/10/2026, remplace la « saisie du jour »)*

| Point | Règle |
|---|---|
| Onglets | **Saisie et suivi** (un seul tableau) et **Performance des boosts**. |
| Filtres (même design partout) | Page (ou « Toutes les pages ») + **Semaine** (lundi → dimanche, ‹ ›, « Cette semaine ») ou **Période** (du … au …, 62 jours au plus). |
| Tableau d'une page | Lignes : n° / boost / une colonne par jour (conversations **cumulées** affichées par Meta ; les jours passés déjà remplis par l'historique) / **du jour** (jour − veille) / **total de la période**. Sous chaque case : nouvelles conversations de ce jour. On tape dans la case du jour ; l'enregistrement se fait en quittant la case (ou Entrée). Une valeur plus petite que la veille est refusée. Bascule « Conversations / Dépense ($) » (dépense facultative). Sur téléphone, le tableau s'ouvre sur la colonne d'aujourd'hui. |
| Lignes de synthèse | Total nouvelles conversations, messages réels comptés (facultatif), commandes en ligne, **chiffre d'affaires de la page**, **CA par conversation**, dépense. Export Excel. |
| Pause / reprise | « Pause » : le boost n'est plus demandé à partir de demain (la case du jour reste à remplir), badge « En pause », raison. « Reprendre » le remet en route à partir d'aujourd'hui. Les boosts en pause sans saisie sur la période sont masqués (case « Afficher les boosts en pause »). |
| Supprimer | Pour un boost qui ne sert plus : supprimé avec ses saisies (confirmation). |
| Ordre | Glisser-déposer la poignée ⋮⋮ (souris) ou flèches ↑↓ (téléphone) : les numéros deviennent 1, 2, 3… dans l'ordre choisi (même ordre que l'Espace Pubs). Un nouveau boost s'ajoute à la fin. |
| Toutes les pages | Par page : boosts actifs, conversations, CA, CA par conversation, commandes, dépense, coût par conversation (tri par colonne) + conversations par jour. |
| Tableau de bord | Sous le chiffre d'affaires : « N messages (boosts) · X Ar par message » ; dans « CA par page », sous le CA de chaque page : messages et CA par message. |

## 10 quater. Retour livreur en deux étapes, règlement groupé, filtres par onglet *(11/10/2026)*

| Point | Règle |
|---|---|
| Étape 1 — « Confirmer le retour du livreur » | Depuis une commande « En livraison » : seulement ce qui s'est passé (tout livré, refusé, en partie, choix du client, frais facturés, ce que le client a payé et comment). Plus de règlement dans cette fenêtre. La commande passe dans l'onglet **« À régler (livreur) »**. |
| Étape 2 — « À régler (livreur) » | Nouvel onglet des Commandes (entre « En livraison » et « Terminées »), compteur en couleur. Cases à cocher + « Tout sélectionner » ; barre en haut : nombre sélectionné et ce que le livreur doit verser. **« Régler la sélection »** ouvre le règlement de **plusieurs commandes à la fois** (un seul livreur ; si plusieurs livreurs sont cochés, le bouton est bloqué et invite à filtrer par livreur). Aussi depuis une commande : « Régler avec … ». |
| Fenêtre de règlement | Liste des commandes (articles, frais, déjà payé, à verser), totaux a → e, reste des fois précédentes, g. frais du livreur (gardés / payés à part / différés), montant remis, remarque obligatoire en cas d'écart. Une fois réglées, les commandes passent dans « Terminées ». |
| Terminées | Commandes livrées / refusées **et réglées** (ou sans livreur). |
| Filtres de chaque onglet | Recherche (dans l'onglet seulement), **Livreur**, **Page** (+ période pour Terminées / Annulées). La recherche ne mélange plus les onglets ; une ligne « Aussi trouvé dans : … (n) » permet d'aller à l'onglet concerné. Livraisons : filtre **Page** ajouté (À livrer, En cours). |
| Livraisons → Retour livreur | Reste disponible pour tout faire en une fois par livreur. |

## 12 bis. Import du stock de départ avec les variantes de la page *(11/10/2026)*

| Point | Règle |
|---|---|
| Deux façons | **a.** Fichier de la page (Importer → « Télécharger le fichier de la page » : une colonne par variante, liste déroulante). **b.** **Votre propre fichier Excel**, tel qu'il est (ex. CATEGORIE, MODELE, COULEUR, PT, STK THEO FINALE, PRIX DE REVIENT, PV détail, PV gros, PHOTOS). |
| Lecture de votre fichier | Reconnu automatiquement quand une colonne « Catégorie / Page » nomme une page qui a des variantes (ou quand les titres correspondent aux variantes). Écran « Lire votre fichier avec les variantes de la page » : 1. colonnes communes (catégorie, nom, prix de revient, PV détail, PV gros, stock, alerte) ; 2. page de chaque groupe de lignes (d'après la colonne Catégorie ; « Ne pas importer ces lignes » possible) ; 3. colonne de chaque variante de la page. Tout est deviné d'après les titres (PT → Pointure, STK… → Stock, etc.) et modifiable. |
| Valeurs nouvelles | Case cochée par défaut : les valeurs absentes de la page (nouveau modèle S6, couleur Noir, pointure 36-37…) sont ajoutées à la page à l'import ; elles sont listées avant. |
| Stock négatif | Case cochée par défaut : un stock négatif du fichier est importé à 0 (à vérifier à l'inventaire). |
| Contrôle | Chaque ligne est vérifiée avant d'enregistrer (variante manquante, doublon, prix non numérique, PV détail manquant pour un nouvel article) ; « Importer seulement les lignes correctes » possible. Photos collées dans la ligne reprises. Article déjà existant : prix mis à jour et stock remis à la quantité du fichier. |
| Plusieurs pages | Un même fichier peut contenir plusieurs pages (colonne Catégorie) : chaque page utilise ses propres variantes. |
| Correction | Un fichier dont la 1re colonne s'appelle « Catégorie » n'est plus pris pour une liste de catégories (seulement si le fichier n'a que Catégorie / Catégorie parente). |
| Modèle « Articles simples » | Gardé pour les articles sans variantes de page (ancien mode couleur / taille). |
| Photos *(11/10/2026)* | Reprises qu'elles soient **posées sur la ligne** (image flottante) ou **insérées dans la cellule** (Excel 365 / Google Sheets « Image dans la cellule », WPS). Aperçu de chaque photo dans le contrôle et nombre de photos trouvées ; chaque photo est réduite automatiquement (480 px, ~40 Ko, JPEG). Si le fichier a une colonne Photo mais aucune image, un message explique comment exporter depuis Google Sheets (les liens d'images ne contiennent pas la photo). |
| Fichier illisible *(11/10/2026)* | Message clair selon la cause : fichier vide (téléchargement Drive / iCloud pas fini), ancien format .xls ou fichier protégé par mot de passe, page web enregistrée au lieu d'un .xlsx, CSV / texte, fichier incomplet ou abîmé (téléchargement interrompu) — avec la marche à suivre (Google Sheets : Fichier → Télécharger → Microsoft Excel .xlsx). |
| PV détail vide | Case cochée par défaut : un nouvel article sans PV détail est importé quand même (« à compléter » dans le contrôle), le prix se complète ensuite dans la fiche article. |
| Variantes facultatives | Une variante non cochée « obligatoire » dans Pages et variantes peut rester vide dans le fichier (et n'a pas besoin de colonne) : l'article est enregistré sans cette variante. Les variantes obligatoires vides donnent une erreur sur la ligne. |
