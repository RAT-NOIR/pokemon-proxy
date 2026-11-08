# RAPPORT — réservation Pro du prix par état et par langue (critère n° 5, 08-09/11/2026)

Branche `v2-pro-prix` (depuis `origin/api-v2`), rien poussé ni déployé. Drapeau `V2_PRO_PRIX_RESERVE`, ÉTEINT par défaut, non posé sur l'essai.

## Ce qui est écrit
- `v2/identifier/reserve-pro-prix.js` : LA décision `accesPrixParEtat(cfg, offre)` (éteint : vrai pour tous ; allumé : vrai seulement si `offre.nom === 'pro'`, la lecture de l'offre en erreur donne `undefined` donc le gratuit) et ses applicateurs (`carteSelonOffre`, `analyseSelonOffre`, `corpsSelonOffre`, `repliSelonOffre`), plus `rejeuSelonOffre`. Éteint, chacun rend la MÊME référence.
- Sorties couvertes (déduites du code par le banc : tout fichier de `v2/` qui nomme `prixLive`, `prixRepli` ou les fabriques de repli doit importer la décision) :
  1. `POST /api/identifier`, une carte et lot (`routes.js`, une seule sortie) ;
  2. `POST /api/identifier/reponse` (`routes.js`) ;
  3. `POST /api/identifier/mesures` (`calcul-client-route.js` : la promotion par les mesures et la carte « probable » de groupe) ;
  4. `POST /api/retour-live` (`retour-live.js` : repli retiré AVANT la décision d'argent) ;
  5. quota du lot (`lot.js`) ;
  6. rejeu d'idempotence des quatre routes (`transport/idempotence.js`, option `rejeu`, branchée par `identifier/monter.js`).
  Hors périmètre, vérifié : le scanner ne sert jamais ces champs (`sansLive`, pour tout le monde) ; l'historique (`solde.js::ligneAnalyse`) ne porte que nom, set et numéro ; aucun cache de réponse.
- Config `proPrixReserve` ; jeton `/ping` `prix-pro-reserve` (dernier de la liste), enum OpenAPI, `fausses/ping.json`, descriptions `PrixLive` et `PrixRepli`, contrat §1.5, `AUDIT-SECURITE-V2.md` (table des variables).
- Banc `v2/test/test-offre-prix-reserve-pro.js` (85 assertions) ; mutations `v2/mesures/mutations-prix-reserve-pro.js` (16 mutants, une garde retirée à la fois).

## Arbitrages
- Le gratuit garde le prix guide (fiche, impressions, candidats, mention d'état non estimable), le lien « Voir le prix » et le repli GÉNÉRAL `tendance` (sans `fourchette` ni offre lue : causes `langue-non-lue` et `tendance-seule`). Il perd `prixLive` (mis à `null`, la clé reste) et tout `prixRepli` `etat-proche`, `fourchette` ou à fourchette. Le champ `etat` n'est jamais lu ni modifié (comparé à l'octet pour 5 offres, allumé et éteint).
- Le repli est calculé sur l'analyse complète PUIS filtré : un gratuit ne reçoit jamais un repli `langue-non-lue` fabriqué par le retrait de `prixLive`.
- Contradiction signalée : retirer `prixLive` retire l'instruction de lecture de la LANGUE, pas seulement de l'état (le critère dit « par état ou par langue » : cohérent, mais le contrat devait le dire ; fait en §1.5).
- Quota : le repli retiré n'est plus un « prix affiché » (`afficheUnPrix`). Lecture ratée définitive d'un gratuit : remboursée `sans-prix` (Pro : `prix-repli`, compté). Lot du gratuit : `prixLive` et repli d'état ne comptent plus ; un lot de cartes sans prix au guide est rendu (Pro et drapeau éteint : compté).
- Rejeu : la réponse conservée est la réponse COMPLÈTE quand le gratuit est servi sans prix (une carte, une réponse à question, les mesures) ; l'offre ACTUELLE décide au rejeu : abonnement expiré = rien ne fuit, passé à Pro = rien retiré à tort. Lot et `retour-live` : la décision d'argent a dépendu de la réservation, la réponse conservée est celle qui a été SERVIE, le rejeu ne fait que retirer (un lot rendu au gratuit ne devient pas un lot à prix par un rejeu sous Pro). Texte conservé illisible : 503. Lecture de l'offre en erreur au rejeu : réponse du gratuit.

## Vérifications exécutées
- Banc `test-offre-prix-reserve-pro.js` : 85/0, rouge vu avant le code (0b, A2, B...) puis vert ; sous les 6 conditions du critère.
- Suites rejouées une par une : capacites-ping 216/0, montage 26/0, lot-sans-prix 51/0, repli-quota 26/0, prix-repli-routes 50/0, idempotence 45/0, mutations-lot-sans-prix 4/0, mutations-repli-quota 4/0, openapi 133/0, openapi-fausses 323/0, contrat-reel 70/0, retour-live-v2 40/0, identifier-lot 91/0, abus-routes 89/0, config-invalide-heritage 27/0, lanceur 26/0. Ancres des jeux de mutants existants (lot-sans-prix, repli-quota) remises à jour.
- Mutations : voir plus bas (résultat du jeu complet).

## Non vérifié
- `lancer-tout.js` non lancé (consigne). Le verrou reste à passer.
- La route `POST /api/identifier/mesures` n'a pas de test comportemental (elle exige V2_MESURES_CLIENT et V2_EMPREINTE_EXTENSION et un modèle) : couverte par le test statique (importe la décision, dérive `acces`) et un mutant qui échoue sur ce test statique.
- Le scanner : couverture statique seulement.
- Aucune lecture réelle d'abonnement Stripe : l'offre « pro » est celle de `argent/offre.js` (abonnement actif et en cours, ou administrateur : l'administrateur est donc « pro » et reçoit le prix).
- Le banc se terminait mal (processus resté vivant : `mongoose.disconnect()` manquant) : corrigé.
