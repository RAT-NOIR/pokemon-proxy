# pokemon-proxy — serveur d'identification (Vinted ⇄ Cardmarket)

Serveur Node/Express + MongoDB, déployé sur Render. L'extension Chrome envoie les photos
d'une annonce Vinted à `/api/identifier` ; le serveur lit la carte par un modèle de vision,
l'identifie dans le catalogue Cardmarket local et rend le classement des produits. Le prix
live est lu par le navigateur de l'utilisateur, jamais par le serveur.

Les règles de travail sont dans `CLAUDE.md` (chargé à chaque session). L'état du chantier et
son historique sont dans `PASSATION-SERVEUR.md`.

## Variables d'environnement (Render)

| variable | rôle |
|---|---|
| `NODE_ENV=production` | ⚠️ **À POSER SUR RENDER.** Sans elle, le gestionnaire d'erreurs par défaut d'Express renvoie la pile complète dans le corps HTML d'une erreur non attrapée. Le serveur pose désormais son propre gestionnaire final (réponse générique, jamais de pile), mais la variable reste la ceinture sous les bretelles : tout middleware tiers lit `NODE_ENV`. |
| `MONGODB_URI` | connexion Atlas. ⚠️ La base de PRODUCTION s'appelle `test` ; le bac à sable `test_scratch`. |
| `MONGODB_BASE` | si posée, fait foi et un écart est fatal au démarrage (voir index.js, bloc MONGODB). |
| `OPENROUTER_API_KEY` | l'appel de vision. |
| `JETON_API` | jeton partagé extension ⇄ serveur (`x-jeton`). Absent = toute requête acceptée, avec avertissement au démarrage. |
| `CODE_ILLIMITE` | code maître : une requête qui le porte n'est ni limitée ni décomptée. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_P20/P50/P100/P200`, `SITE_URL` | paiement. Le secret de webhook est le seul réglage dont l'absence ne se voit qu'après un vrai paiement. |
| `RENDER_GIT_COMMIT` | posée par Render ; c'est la `version` écrite au journal et rendue par `/ping`. |

## Contrôles avant tout merge vers `main`

`main` se déploie automatiquement. Le travail se fait sur une branche, et ces trois contrôles
doivent être verts avant le merge :

```
node verrou-charges.js --base=test     # extrait les charges (une fois)
node verrou-avant-push.js              # 7 cellules + cliquet de couverture (plancher dans verrou/couverture-plancher.json)
node banc-japonais.js                  # le banc, lecture seule sur la base de production
```

Le push est fait par le testeur, depuis GitHub Desktop. Git n'est pas dans le PATH : voir
`CLAUDE.md` pour le résoudre sans figer un numéro de version.
