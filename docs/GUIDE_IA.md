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
- Adresse du serveur IA : la **locale** (`http://10.5.50.7:1234/v1`) est essayée d'abord (1,5 s), sinon l'adresse
  **en ligne** (`https://ia.ampandrana-ai.app/v1`) avec la clé. Le choix est gardé 60 s ; si une requête échoue,
  la fonction bascule sur l'autre adresse et réessaie une fois.
  ⚠️ La fonction tourne dans le cloud Supabase : l'adresse locale du bureau n'y est en général **pas joignable**,
  c'est donc l'adresse en ligne qui sert (badge « En ligne » dans la bulle).
- Le raisonnement du modèle n'est jamais affiché (seulement « réfléchit… »).
- Les calculs (chiffre d'affaires, stock, versements…) sont **ceux de l'application** (même code, `src/lib`),
  donc les mêmes chiffres que les écrans.

## Installation (une seule fois)

1. **Base** : Supabase → SQL Editor → New query → coller tout [`supabase/ai.sql`](../supabase/ai.sql) → **Run**.
   (Crée le schéma privé `ai` : la table de la clé, la vue en lecture seule des données, le rôle `ai_reader`.)
2. **Fonction cloud** `ai-chat`, au choix :
   - **Automatique (conseillé)** : dans GitHub → Settings → Secrets and variables → Actions, ajouter
     `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens) et `SUPABASE_PROJECT_REF`
     (la partie `abcdefgh` de `https://abcdefgh.supabase.co`). Puis onglet **Actions → Assistant IA → Run workflow**.
     Ensuite la fonction se remet à jour toute seule quand le logiciel évolue.
   - **À la main** (ordinateur avec Node.js) : `npx supabase login` puis `npm run ai:deploy -- <référence-du-projet>`.
3. **Réglages** : dans TSENA, en administrateur, **Paramètres → Intelligence artificielle** :
   activer l'assistant, vérifier les adresses et le modèle, taper la **clé API** (champ masqué), **Enregistrer**,
   puis **Tester la connexion** (indique « Local » ou « En ligne » et le temps de réponse).
   La clé part une seule fois vers la fonction cloud, qui la garde dans `ai.secrets` : elle n'est jamais renvoyée
   aux appareils (seulement « •••• enregistrée »).

Chaque appareil doit être **relié au cloud** (Paramètres → Cloud et synchronisation) pour voir la bulle.

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
