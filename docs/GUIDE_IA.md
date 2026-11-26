# Assistant IA de TSENA — installation et utilisation

L'assistant est une **bulle en bas à droite** de toutes les pages. Il répond sur le fonctionnement du logiciel
(« comment faire… ? ») et sur les **vraies données** (ventes, stock, commandes, livreurs, dépenses, versements…).
Il **lit seulement** : il ne modifie jamais rien, et chaque utilisateur n'obtient que ce qu'il a déjà le droit de voir.

## Comment ça marche

```
Appareil (bulle)  ──►  fonction cloud Supabase « ai-chat »  ──►  serveur IA (LM Studio, qwen3.8-27b)
                              │  (clé API gardée ici)
                              └──►  base Supabase, en LECTURE SEULE (rôle ai_reader)
```

- L'appareil n'appelle jamais le serveur IA ni la base directement pour l'assistant : tout passe par la fonction
  `ai-chat`, avec la connexion cloud de l'appareil.
- Le serveur en ligne est un proxy devant LM Studio : seuls les chemins `/v1/*` sont acceptés, avec l'en-tête
  `Authorization: Bearer <clé>` (sinon 401).
- Adresse du serveur IA : la **locale** (`http://10.5.50.7:1234/v1`) est essayée d'abord (1,5 s), sinon l'adresse
  **en ligne** (`https://ia.ampandrana-ai.app/v1`) avec la clé. Le choix est gardé 60 s ; si une requête échoue,
  la fonction bascule sur l'autre adresse et réessaie une fois.
  ⚠️ La fonction tourne dans le cloud Supabase : l'adresse locale du bureau n'y est en général **pas joignable**,
  c'est donc l'adresse en ligne qui sert (badge « En ligne » dans la bulle).
- Le raisonnement du modèle n'est jamais affiché (seulement « réfléchit… »).
- Les calculs (chiffre d'affaires, stock, versements…) sont **ceux de l'application** (même code, `src/lib`),
  donc les mêmes chiffres que les écrans.

## Checklist de déploiement (une seule fois, environ 15 minutes)

Il faut : l'accès au projet Supabase de TSENA, et un ordinateur avec **Node.js** installé (https://nodejs.org, bouton « LTS »).

1. **Ouvrir Supabase** : https://supabase.com → se connecter → cliquer sur le projet de TSENA.
2. **Installer la partie base de données** : menu de gauche **SQL Editor** → bouton **New query** →
   ouvrir le fichier [`supabase/ai.sql`](../supabase/ai.sql) sur GitHub → bouton **Copy raw file** → coller dans
   l'éditeur → bouton **Run** (en bas à droite). Le message **Success. No rows returned** doit s'afficher.
3. **Noter la référence du projet** : c'est la suite de lettres dans l'adresse du projet
   `https://`**`abcdefghijklmnop`**`.supabase.co` (aussi dans **Project Settings → General → Project ID**).
4. **Ajouter la clé du serveur IA comme secret** : menu de gauche **Edge Functions** → **Secrets** →
   **Add new secret** → Name : **`AI_API_KEY`** (exactement, en majuscules) → Value : la clé → **Save**.
   (La clé n'est jamais écrite dans le code ni dans GitHub.)
5. **Récupérer le code** sur l'ordinateur : ouvrir un Terminal (Mac) ou PowerShell (Windows) et taper :
   ```
   git clone https://github.com/anatratia-beep/tsena-ampandrana
   cd tsena-ampandrana
   git checkout claude/assistant-ia
   ```
   (Une fois la pull request fusionnée, `git checkout claude/assistant-ia` n'est plus nécessaire.)
6. **Se connecter à Supabase depuis l'ordinateur** : `npx supabase login` (une page web s'ouvre → **Authorize**).
7. **Déployer la fonction ai-chat** (remplacer `abcdefghijklmnop` par la référence de l'étape 3) :
   ```
   npx supabase functions deploy ai-chat --project-ref abcdefghijklmnop --use-api
   ```
   Le message se termine par **Deployed Functions … ai-chat**. Dans Supabase → **Edge Functions**, `ai-chat` apparaît.
8. **Activer l'assistant dans TSENA** (compte administrateur) : **Paramètres → Intelligence artificielle** →
   cocher **Activer l'assistant IA** → **Enregistrer** → **Tester la connexion**. Résultat attendu :
   « Connexion réussie : En ligne — temps de réponse … ms ». Sinon le message dit pourquoi :
   **401** = clé invalide (refaire l'étape 4), **502** = serveur IA injoignable (PC de LM Studio éteint ?),
   **404** = adresse incorrecte (l'URL en ligne doit se terminer par `/v1`).
9. **Recharger TSENA** sur chaque appareil (il doit être relié au cloud) : la bulle ✨ apparaît en bas à droite.
10. **Poser ces 5 questions de test dans la bulle** :
    1. « Comment enregistrer le retour d'un livreur ? » (fonctionnement du logiciel)
    2. « Combien de ventes cette semaine par rapport à la semaine dernière ? »
    3. « Quels sont les produits les plus vendus ce mois-ci ? »
    4. « Quels produits sont bientôt en rupture de stock ? »
    5. « Donne-moi les heures de travail de chaque utilisateur aujourd'hui »
    Puis refaire la question 2 avec un compte **vendeur** : il ne doit voir que ses pages.

**Variante sans ordinateur** pour les étapes 5 à 7 : dans GitHub → **Settings → Secrets and variables → Actions**,
ajouter `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → **Access Tokens** → Generate new token) et
`SUPABASE_PROJECT_REF` (la référence de l'étape 3), puis onglet **Actions → Assistant IA → Run workflow**.
Ensuite la fonction se remet à jour toute seule à chaque évolution du logiciel sur `main`.

**Autre façon de donner la clé** : la taper dans Paramètres → Intelligence artificielle (champ masqué). Elle est
alors gardée dans la base (table privée `ai.secrets`) et passe avant le secret `AI_API_KEY`.

### Messages possibles dans la bulle
| Situation | Message |
|---|---|
| Clé absente ou invalide (401) | La clé API du serveur IA est invalide ou absente… |
| Mauvaise adresse (404) | L'adresse du serveur IA est incorrecte : l'URL en ligne doit se terminer par /v1. |
| LM Studio arrêté / PC éteint (502) | Le serveur IA est injoignable : le PC qui fait tourner LM Studio est peut-être éteint… |
| Serveur occupé (4 requêtes déjà en cours) | Nouvel essai après 3 s, puis « L'assistant est occupé, réessayez dans un instant. » |
| Plus de 180 s sans réponse | Le serveur IA met trop de temps à répondre… |
| Autre panne | L'assistant IA est momentanément indisponible. |

### Limites à connaître
- Le modèle réfléchit souvent 10 à 60 s avant d'écrire : la réponse arrive en streaming jusqu'au navigateur et la
  bulle affiche « réfléchit… » pendant ce temps. Chaque appel au serveur IA a 180 s au plus.
- Une fonction Supabase ne peut pas durer plus de **150 s** sur l'offre gratuite (400 s sur l'offre payante) : une
  question qui demande beaucoup d'outils et de réflexion peut être coupée ; il suffit alors de la reposer plus simplement.

## Quand le logiciel évolue

- `npm run ai:context` régénère [`docs/AI_CONTEXT.md`](AI_CONTEXT.md) (≈ 4 000 tokens max, donné à l'assistant à
  chaque conversation) : la partie écrite à la main est dans [`docs/ai/AI_CONTEXT.template.md`](ai/AI_CONTEXT.template.md)
  (rôle, vocabulaire, règles, « comment faire »), le reste (rôles, menus et droits, statuts, tables) est lu dans le code.
  Le script affiche la taille et prévient si c'est trop long.
- `npm run ai:build` reconstruit la fonction (`supabase/functions/ai-chat/index.ts`, fichier généré).
- Avec les secrets GitHub ci-dessus, la mise en ligne de la fonction est automatique après chaque modification sur `main`.

## Journal des erreurs

Supabase → Edge Functions → `ai-chat` → **Logs** : lignes `[ai-chat] …` (adresse injoignable, clé refusée, délai
dépassé…). La clé n'y apparaît jamais.

## Tests

- `node scripts/test-ai.mjs` : fonction, outils, droits, lecture seule, bascule local / en ligne (Postgres local + faux serveur IA).
- `node scripts/test-ai-ui.mjs` : réglages et bulle dans le navigateur (après `npm run build`).
