// ════════════════════════════════════════════════════════════════════════════
// ⚠️ CHANTIER DE SAISIE DES VÉRITÉS : PARQUÉ LE 2026-08-28, PAS ABANDONNÉ
// ════════════════════════════════════════════════════════════════════════════
// LA PRIORITÉ A BASCULÉ SUR LA RECONNAISSANCE PAR L'IMAGE, et pour une raison mesurée :
// ORB + RANSAC place la vraie carte au RANG 1 sur 449 références 10 fois sur 11, et 6 fois
// sur 6 dans la cellule « japonaise vintage · sans total · sans setCode » — là où le
// scoring la laissait au rang 15 à 23. Continuer à saisir des vérités pour évaluer un
// classement qu'on s'apprête à remplacer serait payer une mesure pour un objet qui change.
//
// L'ÉTAT EXACT AU MOMENT DE LA CLÔTURE :
//   · 53 lignes de holdout (hors incidents techniques), dont 10 portent une vérité
//     INDIVIDUELLE : H001 Spearow · H002 Growlithe · H003 The Rocket's Trap ·
//     H004 Pikachu · H005 Slowpoke · H006 Dark Charizard · H007 Cool Porygon ·
//     H008 Slowbro · H010 Dark Dragonite · H032 Gladion's Final Battle
//   · 43 restent sans vérité individuelle. Elles sont donc validées EN BLOC, c'est-à-dire
//     « attendu = ce que la production a retenu » : 100 % de justes PAR ARITHMÉTIQUE.
//   · banc-verites.json porte 71 vérités au total, tous seaux confondus.
//
// ⚠️ RIEN N'EST SUPPRIMÉ, ET C'EST DÉLIBÉRÉ. Ni les 71 vérités, ni les fiches de saisie.
// CES VÉRITÉS SONT LE SEUL MATÉRIEL D'ÉVALUATION NON BIAISÉ DU PROJET : la seule chose
// dont on sache qu'elle ne vient pas du système mesuré. Elles serviront à évaluer la
// NOUVELLE architecture exactement comme l'ancienne — « la bonne carte » ne dépend pas du
// chemin qui l'a trouvée. Le banc ne meurt pas, il change d'objet.
//
// CE QUI EST PARQUÉ AVEC, NOMMÉMENT, parce que ces mesures dépendaient de la saisie et
// qu'il ne faut pas les croire disponibles dans trois semaines :
//   · LA RÈGLE DE BRANCHEMENT DU VETO PAR LE SYMBOLE (voir sets-vintage-japonais.js) —
//     elle exige N ≥ 12 lignes DÉCIDABLES, c'est-à-dire portant une vérité individuelle.
//     Il y en a 10 sur tout le holdout, et 1 seule dans la population du veto. La clause
//     « aucune ligne cassée dans le holdout » reste satisfaite PAR VACUITÉ.
//   · LA PROMOTION DE `perimetre-vintage-suggestion` — même cause : son évaluation
//     demandait des vérités individuelles sur la cellule vintage, qui n'ont pas été
//     saisies.
// Les deux redeviendront mesurables le jour où la saisie reprendra, ou quand la mesure
// par l'image aura fourni une référence indépendante.
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ AUCUNE MESURE NE SE RÉCLAME DU HOLDOUT AUJOURD'HUI — 2026-08-18
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ CHIFFRES DU 2026-08-18, PÉRIMÉS PAR LA CROISSANCE DU HOLDOUT — il portait 29 lignes,
// il en porte 53 au 2026-08-28. Le constat, lui, ne bouge pas : 10 vérités individuelles
// sur 53, donc 43 lignes validées en bloc. Voir le bloc de clôture ci-dessus.
// LE SEAU QUI EXISTE POUR DÉCIDER EST VIDE DE SENS. Sur ses 29 lignes :
//     2 seulement portent une vérité INDIVIDUELLE — et l'une des deux n'est pas fraîche :
//       elle est HÉRITÉE, par identité, d'une carte déjà saisie dans un lot de diagnostic
//       (Dark Dragonite n°149). Une seule vérité du holdout porte sur une carte que rien
//       d'autre n'a vue.
//    21 sont validées EN BLOC — « attendu = ce que la production a retenu ». Elles
//       affichent 100 % de justes PAR ARITHMÉTIQUE, jamais par évaluation.
//     6 sont sans vérité (la production a échoué, il n'y a rien à comparer).
// Un « taux de justesse du holdout » calculé là-dessus mesure la production contre
// elle-même. C'est le défaut que ce banc a déjà commis une fois (« LOTS : JUSTE 20
// 100,0 % » sur zéro vérité vérifiée), dans l'autre sens.
//
// CE QUI RESTE VALIDE SUR CE SEAU, et rien d'autre :
//   · le MOUVEMENT avant -> après sur les lignes en bloc : `apres(d)` recalcule et peut
//     s'écarter du gagnant de production. Ça détecte une RÉGRESSION, jamais une réussite.
//   · le taux de LECTURE, qui ne dépend pas de la vérité fournie.
//
// LEVÉE DE L'AVERTISSEMENT : quand les 27 lignes (21 en bloc + 6 sans vérité) auront une
// vérité individuelle saisie. Leurs photos ont été contrôlées le 2026-08-18 — 28 sur 28
// répondent encore sur le CDN Vinted, aucune n'est perdue, la saisie est donc possible en
// entier. Tant qu'elle n'est pas faite, ce paragraphe reste en tête du fichier.
//
// ============================================================
// LE BANC JAPONAIS — le taux, point de correctif par point de correctif
// ============================================================
// POURQUOI IL EXISTE. Pendant tout ce chantier, la seule mesure disponible était
// « environ deux tiers », c'est-à-dire une impression. Ce banc est la première mesure :
// 38 cartes RÉELLES scannées par les testeurs, dont la bonne réponse a été vérifiée une
// par une sur les fiches Cardmarket. Il répond à la question qu'aucun test unitaire ne
// pose : sur des annonces vraies, combien de fois l'outil se trompe.
//
// IL SÉPARE DEUX TAUX QUE TOUT LE MONDE CONFOND :
//   - taux de LECTURE  : l'IA a-t-elle lu la bonne carte ?
//   - taux d'IDENTIFICATION : la lecture étant bonne, la chaîne a-t-elle trouvé le produit ?
// Sans cette séparation, les deux se compensent et on optimise à l'aveugle.
//
// COMMENT L'« APRÈS » EST CALCULÉ. Rejouer /api/identifier de bout en bout est impossible :
// il faudrait les photos d'annonces disparues et un appel IA payant. On fait donc l'exact
// plutôt que l'approché — les correctifs mesurés ici (chemin par le code, veto par le nom,
// égalité parfaite) AJOUTENT des décisions en tête et en fin de chaîne sans modifier les
// branches intermédiaires. La sortie enregistrée au journal EST donc l'avant réel, et la
// base exacte de l'après. Les fonctions appelées sont les VRAIES, importées d'index.js —
// jamais une réimplémentation : c'est l'erreur qui a produit « la simulation dit 12, la
// production dit 0 ».
//
// ════════════════════════════════════════════════════════════════════════════
// LA RÈGLE DE SYMÉTRIE — une décision part dans les DEUX ou dans AUCUN
// ════════════════════════════════════════════════════════════════════════════
// UNE DÉCISION QUI PART EN PRODUCTION ENTRE DANS `apres()` DANS LE MÊME COMMIT.
// Si l'un des deux ne peut pas être fait, AUCUN DES DEUX NE PART.
//
// POURQUOI, MESURÉ. Le départage par le symbole a été déployé sans être ajouté ici. Sur
// le lot « symbole-40 », la colonne APRÈS a donc annoncé -7 justes et +10 refus par
// rapport à AVANT : le banc refusait 9 cartes que la production départageait, et les 12
// départages étaient tous JUSTES. L'instrument déclarait une régression là où il y avait
// un gain — et il l'aurait déclarée à chaque mesure suivante.
//
// C'EST L'ERREUR SYMÉTRIQUE DE CELLE QU'ON A PASSÉ LA SEMAINE À CORRIGER. Jusqu'ici
// l'instrument était EN AVANCE sur le système : il simulait des décisions que la
// production n'avait pas encore (d'où la colonne APRÈS). Cette fois il était EN RETARD.
// Les deux produisent le même mensonge, dans des directions opposées, et aucune suite ne
// peut les voir : `apres()` et la route ne se comparent nulle part.
//
// COMMENT LE VÉRIFIER À LA MAIN, faute de contrôle automatique : toute décision qui
// choisit ou refuse un produit existe à DEUX endroits — la route dans index.js, et
// `apres()` ici. Aujourd'hui : la règle du numéro de Pokédex, le périmètre vintage, le
// chemin setCode+numéro, le veto par le nom, la règle d'égalité, le départage par le
// symbole, LE DÉPARTAGE PAR L'IMAGE (2026-08-29), LE DÉPARTAGE PAR L'ATTAQUE (2026-09-05).
// HUIT. Si le compte diverge, la colonne
// APRÈS ment.
//
// ⚠️ CES 44 CARTES NE SONT PLUS UN JEU DE TEST. Une quinzaine de correctifs en ont été
// dérivés — la règle du Pokédex, la table close, l'asymétrie Lv.N, la région de l'IPB,
// l'armement du périmètre, la garde du setCode — et chacun a été mesuré sur elles. Elles
// sont devenues un jeu d'ENTRAÎNEMENT : un score de 100 % dessus ne prouverait plus rien.
// C'est le troisième défaut de mesure de ce chantier, après « la référence tirée du système
// mesuré » et « le garde-fou validé sur les cas qui l'ont inspiré ».
//
// D'OÙ LE HOLDOUT. Les scans postérieurs à DATE_HOLDOUT sont rapportés SÉPARÉMENT et ne se
// mélangent jamais aux 44. C'est ce lot-là qui décide, et lui seul.
//
// LECTURE SEULE, sur la base de production.
// USAGE :
//   node banc-japonais.js                 les deux lots, séparément
//   node banc-japonais.js --holdout       le lot frais SEUL, avec ses quatre cellules
//   node banc-japonais.js --auto-controle vérifie que le banc sait signaler une erreur

require('dotenv').config();
const mongoose = require('mongoose');
const S = require('./scoring.js');
const {
    trouverParSetCodeEtNumero, nomOpposeUnVeto, scorerCandidatsLocal, lireCodeSets
} = require('./index');
const { numeroEstUnDexId } = require('./pokedex');
const { EXPANSIONS_VINTAGE, setCodeCompatibleVintage, departagerParSymbole } = require('./sets-vintage-japonais');
// RÈGLE DE SYMÉTRIE — la décision du 2026-08-29 entre ici AU MÊME COMMIT qu'en production.
// La même fonction, jamais une réimplémentation : c'est exactement la leçon du départage
// par le symbole, absent du banc pendant un commit, qui avait fait mentir la colonne APRÈS
// de −7 justes et +10 refus.
const { departager: departagerParImage } = require('./departage-image');
// RÈGLE DE SYMÉTRIE — la décision du 2026-09-05 entre ici AU MÊME COMMIT qu'en
// production. La MÊME fonction que la route, jamais une réimplémentation.
const { departagerParAttaque } = require('./departage-attaque');
const { trouverProduitsLocaux, setsPourTotal } = require('./index');

const J = mongoose.model('Jb', new mongoose.Schema({}, { strict: false }), 'journal_scans');
const Cat = mongoose.model('Pb', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');
const Num = mongoose.model('Nb', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const EST_CODE_CARD = /code\s*card/i;

// ---- LA VÉRITÉ DU BANC ---------------------------------------------------
// Fournie par le testeur sous forme d'URL Cardmarket, résolue en idProduct via les slugs
// de numeros_cartes. Les lignes absentes de cette table sont celles où la chaîne avait
// VU JUSTE : idProduct attendu = idProduct retenu.
// 'inconnu' = le testeur n'a pas pu retrouver la carte (annonce vendue et disparue). Ces
// lignes sont EXCLUES du calcul, jamais comptées comme des réussites.
// ⚠️ ANCRÉES PAR IDENTITÉ DE LA CARTE LUE, PLUS PAR CLÉ. Elles étaient posées sur
// « JP001 »..« JP044 », c'est-à-dire sur une POSITION : le seau, l'ordre, le
// dédoublonnage et le nombre de lignes qui précèdent. Elles tenaient parce que le seau
// d'entraînement n'avait pas bougé — une bombe non amorcée. La même construction avait
// déjà détaché 32 vérités saisies quand les fenêtres de lot sont apparues, et fait
// reproposer 24 cartes déjà renseignées.
// Les identités ci-dessous sont EXTRAITES du journal, aucune n'est écrite de mémoire.
//
// ⚠️ ELLES NE S'APPLIQUENT QU'AUX SEAUX D'ENTRAÎNEMENT ET DE VÉRIFICATION. C'est ce qui
// empêche la contamination mesurée : « Raichu n°026, sans code, sans total » désigne DEUX
// cartes physiques différentes — JP041 dans l'entraînement, L046 dans le lot — et leur
// lecture est identique au caractère près. L'identité seule ne les sépare pas ; le seau,
// si. Une vérité d'entraînement n'a rien à dire sur une carte d'un lot frais.
const SEAUX_VERITES_CODEES = new Set(['entrainement', 'verification']);
const VERITE = [
    { lu: { nom: "Charmander", numero: "004", setCode: "MCD", total: "018" }, idProduct: 562000, note: 'MCDP-004' },
    { lu: { nom: "Wartortle", numero: "019", setCode: "e1", total: "029" }, idProduct: 654781, note: 'EC1-S19' },
    { lu: { nom: "Wartortle", numero: "019", setCode: null, total: "029" }, idProduct: 654781, note: 'EC1-S19, même carte lue sans code' },
    { lu: { nom: "Rhydon", numero: "055", setCode: null, total: "088" }, idProduct: 653962, note: 'EC4-055 V2' },
    { lu: { nom: "Porygon2", numero: "063", setCode: "e2", total: "092" }, idProduct: 651965, note: 'EC2-063' },
    { lu: { nom: "Flareon", numero: "017", setCode: null, total: "088" }, idProduct: 653910, note: 'EC4-017 V2, holo' },
    { lu: { nom: "Light Jolteon", numero: "135", setCode: null, total: null }, idProduct: 606835, note: 'N4' },
    { lu: { nom: "Dark Haunter", numero: "093", setCode: null, total: null }, idProduct: 606847, note: 'N4' },
    { lu: { nom: "Mew", numero: "151", setCode: null, total: null }, idProduct: 571754, note: 'SI-JP' },
    { lu: { nom: "Ledian", numero: "007", setCode: null, total: "088" }, idProduct: 'inconnu', note: 'holo V1 ou V2 indéterminable, annonce disparue' },
    { lu: { nom: "Meowth", numero: "062", setCode: "e3", total: "088" }, idProduct: 'inconnu', note: 'ROG ou EC4-062 ?' },
    { lu: { nom: "Misty's Staryu", numero: "120", setCode: null, total: null }, idProduct: 'inconnu', note: 'carte non retrouvée' }
];

// ⚠️ VÉRITÉS DONNÉES PAR NOM, PAS PAR CLÉ. Le testeur a fourni cinq cartes sous forme
// d'URL Cardmarket sans les rattacher à un numéro de ligne. Sans cette table, elles
// tombaient dans le cas « absente de VERITE -> attendu = ce que la production avait
// retenu » — c'est-à-dire `null`, puisque ces cinq scans avaient ÉCHOUÉ. Le banc comptait
// donc l'échec comme la bonne réponse, et affichait une identification correcte comme une
// régression. Un banc qui prend l'échec pour la vérité est pire qu'un banc absent.
//
// ⚠️ ELLES SONT MAINTENANT ANCRÉES PAR IDENTITÉ, PLUS PAR NOM SEUL — et ce n'était pas
// une précaution théorique : « Raichu » désignait DEUX lignes, JP041 dans l'entraînement
// et L046 dans le lot frais. La vérité d'entraînement (654243) écrasait celle que le
// testeur avait saisie pour L046 (584721), et le banc comptait FAUSSE une identification
// que la production avait réussie. Un nom seul ne désigne pas une carte.
const VERITE_PAR_NOM = [
    { lu: { nom: "Raichu", numero: "026", setCode: null, total: null }, idProduct: 654243, note: 'Intro-Pack-Bulbasaur/Raichu-IPB3' },
    { lu: { nom: "Koga's Ditto", numero: "132", setCode: "G2", total: null }, idProduct: 605387, note: 'Challenge-from-the-Darkness' },
    { lu: { nom: "Tangela", numero: "114", setCode: null, total: null }, idProduct: 557645, note: 'Expansion-Pack' },
    { lu: { nom: "Dragonite", numero: "180", setCode: "DP5", total: null }, idProduct: 698502, note: 'Cry-from-the-Mysterious Lv.61' },
    { lu: { nom: "Jigglypuff", numero: "039", setCode: null, total: null }, idProduct: 584684, note: 'Pokemon-Jungle, No.039' }
];
// ════════════════════════════════════════════════════════════════════════════
// LA FRONTIÈRE ENTRAÎNEMENT / HOLDOUT
// ════════════════════════════════════════════════════════════════════════════
// Tout scan enregistré À PARTIR de cette date appartient au lot frais. La frontière est une
// DATE et non une liste : une liste se complète après coup, une date non — c'est ce qui
// empêche de reclasser une carte du mauvais côté quand le résultat déplaît.
// ⚠️ NE JAMAIS LA RECULER. La reculer reviendrait à faire entrer dans l'entraînement des
// cartes qui ont décidé, ou l'inverse.
// (la constante elle-même vit dans banc-seaux.js — source unique)

// ── LE TROISIÈME SEAU : VERIFICATION ────────────────────────────────────────
// La date seule ne suffit pas. Rescanner le Rhydon ou le Dracolosse — deux cartes
// d'ENTRAÎNEMENT — les enverrait dans le holdout et gonflerait le seul lot censé être
// propre. Elles vont donc dans un troisième seau, rapporté à part, qui ne décide de rien.
//
// LA DÉCLARATION NE PEUT PAS ÊTRE RÉÉCRITE APRÈS COUP : chaque entrée porte `declareLe`, et
// un scan n'est rangé en VERIFICATION que s'il est POSTÉRIEUR à cette date. Déclarer une
// carte après l'avoir scannée ne la sortira donc pas du holdout. La règle ne peut que le
// rendre plus STRICT, jamais plus flatteur — c'est exactement la propriété exigée.
// ════════════════════════════════════════════════════════════════════════════
// LES FENÊTRES HORS SERVICE — et le critère qui empêche d'en abuser
// ════════════════════════════════════════════════════════════════════════════
// UNE RÉGRESSION QUI CASSE TOUT N'EST PAS UN ÉCHEC D'IDENTIFICATION, c'est un build hors
// service. Le compter dans le tableau ferait porter au score la qualité d'un déploiement.
//
// ⚠️ MAIS UNE EXCLUSION PAR VERSION EST INFALSIFIABLE, ET C'EST EXACTEMENT CE QUI LA REND
// DANGEREUSE : elle peut devenir la sortie de secours de tout résultat qui déplaît. D'où le
// critère, écrit ici pour qu'on bute dessus le jour où on aura envie de sauver un chiffre :
//
//   1. L'ÉCHEC DOIT ÊTRE TOTAL OU QUASI TOTAL, et mécaniquement attribuable à un DÉFAUT
//      IDENTIFIÉ — un défaut qu'on peut nommer, situer dans le code, et dont on peut dire
//      pourquoi il touche telle famille de cartes. « Ce build fait moins bien » n'est
//      JAMAIS un motif : c'est précisément ce que le banc est là pour mesurer.
//   2. LA FENÊTRE EST ÉNUMÉRÉE EN DUR, version par version. Pas d'intervalle ouvert, pas de
//      « depuis telle date ». L'élargir exige de modifier ce fichier, donc un commit, donc
//      une trace.
//   3. LES LIGNES EXCLUES RESTENT VISIBLES ET COMPTÉES dans leur catégorie. Une exclusion
//      qui efface n'est pas une exclusion, c'est un maquillage.
//   4. ⚠️ ON EXCLUT LA FENÊTRE ENTIÈRE, SUCCÈS COMPRIS. C'est la garantie la plus solide
//      contre l'abus, et elle est automatique : exclure n'est jamais gratuit, puisqu'on
//      perd aussi ce que le build cassé avait réussi. Si la tentation d'exclure vient un
//      jour d'un chiffre qui déplaît, elle butera sur le prix à payer.
//
// LA FENÊTRE ACTUELLE : les trois builds qui ont tourné entre le câblage de `nomBrut` sur
// /v2/ja et son correctif. Défaut identifié : `nomExact` reprenait le nom rendu par TCGdex
// DANS LA LANGUE DE LA ROUTE, et ce nom japonais partait interroger un catalogue anglais.
// Il ne touche que les cartes dont l'identifiant de set n'existe QUE côté japonais — pour
// les autres, /v2/en/cards rend un nom anglais et rien ne casse.
// ⚠️ LA LISTE ELLE-MÊME VIT DANS banc-seaux.js, avec l'attribution de seau et la
// numérotation. La doctrine (les quatre clauses ci-dessus) reste ici ; les DONNÉES sont
// partagées, parce que `saisir-verites.js` doit exclure exactement les mêmes lignes.
// Il ne le faisait pas : 8 vérités ont été saisies sur des lignes que le banc n'ouvre pas.
const {
    DATE_HOLDOUT, FENETRES_HORS_SERVICE, estHorsService,
    VERIFICATION, estVerification, FENETRES_LOTS, fenetreDe,
    seauDe, numeroter, identiteDe, rattacherVerites
} = require('./banc-seaux');

// Les vérités saisies à la main par saisir-verites.js, indexées par clé. Elles portent leur
// provenance — 'saisie-a-l-aveugle' ou 'saisie-apres-candidats' — et le rapport la reprend :
// une vérité obtenue après avoir vu la liste des candidats ne vaut pas la même chose.
let VERITES_SAISIES = {};
try { VERITES_SAISIES = require('./banc-verites.json').verites || {}; } catch (_) { }

// ════════════════════════════════════════════════════════════════════════════
// LE QUATRIÈME SEAU : LES FENÊTRES DE LOT
// ════════════════════════════════════════════════════════════════════════════
// LE PROBLÈME. Un lot de diagnostic sert à trouver des bugs : ses cartes deviennent donc
// de l'ENTRAÎNEMENT par nature. La frontière par date les enverrait dans le holdout et le
// contaminerait. Le seau VÉRIFICATION ne convient pas non plus : il apparie sur
// nom + numéro, et on ne sait pas d'avance ce que l'IA va lire sur une carte donnée.
//
// LA RÈGLE. Tout scan dont la date tombe dans une fenêtre OUVERTE va dans son lot, quoi
// que l'IA ait lu. Aucun appariement, donc rien à savoir d'avance — c'est ce qui la rend
// utilisable sur un lot dont on ignore le contenu exact.
//
// TROIS CLAUSES, ET C'EST CE QUI L'EMPÊCHE DE FLATTER LE HOLDOUT :
//   1. `debut` EST la déclaration : la fenêtre ne prend que les scans POSTÉRIEURS. La
//      déclarer après avoir scanné ne rattrape rien. (Même clause que `declareLe`.)
//   2. ELLE EMPORTE TOUT, SUCCÈS COMPRIS — comme les fenêtres hors service. Une fenêtre
//      ne peut donc que RETIRER du holdout, jamais l'embellir, et elle se paie.
//   3. LA PREUVE EST DANS GIT : reculer `debut` après coup laisse une trace dans
//      l'historique du fichier.
//
// ⚠️ ET LE DANGER PROPRE À CE MÉCANISME : UNE FENÊTRE LAISSÉE OUVERTE AVALE TOUS LES
// SCANS SUIVANTS et vide le holdout sans que personne le voie. C'est le seul mode de
// défaillance silencieux du dispositif — d'où l'annonce en TÊTE de chaque rapport, avec
// l'âge en jours, qu'on regarde le lot frais ou non.
// (chargement et prédicat : voir banc-seaux.js — source unique)

// Les quatre cellules du lot frais, définies par le CHEMIN DE CODE et non par l'ère : ce
// sont elles qui décident du parcours, et les échecs venaient tous de la colonne « sans
// total ». `occidental` est la cinquième, hors grille : toutes les gardes de ce chantier
// sont conditionnées à LANGUES_ASIATIQUES, donc une régression occidentale serait invisible.
function celluleDe(d) {
    if (!['JP', 'ZH', 'ZH-CN', 'ZH-TW', 'CN', 'TW', 'KR'].includes(String(d.langue || '').toUpperCase())) {
        return 'occidental (contrôle)';
    }
    const total = d.total != null && String(d.total).trim() !== '';
    const code = d.setCode != null && String(d.setCode).trim() !== '';
    return `${total ? 'avec total' : 'SANS total'} · ${code ? 'setCode lu' : 'setCode NON lu'}`;
}

// (l'ancienne table par nom seul vivait ici — elle est remontée plus haut, ancrée par
//  identité, avec la contamination « Raichu » qu'elle produisait)

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    console.log(`\nbase : ${mongoose.connection.db.databaseName} (lecture seule)`);

    // ⚠️ EN TÊTE DE CHAQUE RAPPORT, AVANT TOUT LE RESTE, ET QUEL QUE SOIT LE MODE.
    // Une fenêtre laissée ouverte est le seul mode de défaillance SILENCIEUX du
    // dispositif : elle avale tous les scans suivants et vide le holdout sans que rien ne
    // le signale. On ne peut pas empêcher l'oubli — on peut le rendre impossible à ne pas
    // voir. L'âge en jours est là pour ça : « ouverte depuis 1 jour » se lit autrement que
    // « ouverte depuis 23 jours ».
    const ouvertes = FENETRES_LOTS.filter(f => !f.fin);
    if (ouvertes.length) {
        console.log(`\n${'▓'.repeat(76)}`);
        for (const f of ouvertes) {
            const jours = Math.floor((Date.now() - f.debut.getTime()) / 86400000);
            console.log(`  🟡 FENÊTRE OUVERTE « ${f.lot} » depuis ${jours} jour(s) (${f.debut.toISOString().slice(0, 16)})`);
            if (f.pourquoi) console.log(`     ${f.pourquoi}`);
            console.log(`     -> TOUT scan postérieur va dans ce lot et NON dans le holdout.`);
            console.log(`     -> Referme-la quand le lot est fini : "fin" dans banc-lots.json, puis commit.`);
        }
        console.log(`${'▓'.repeat(76)}`);
    } else if (FENETRES_LOTS.length) {
        console.log(`(${FENETRES_LOTS.length} fenêtre(s) de lot, toutes fermées)`);
    }
    console.log('');

    const produits = (await Cat.find({}, { idProduct: 1, idExpansion: 1, name: 1 }).lean())
        .filter(p => !EST_CODE_CARD.test(String(p.name || '')));
    const catById = new Map(produits.map(p => [p.idProduct, p]));
    const numDocs = await Num.find({}, { idProduct: 1, numero: 1, numeroUrl: 1, nomFr: 1 }).lean();
    const numParId = new Map(numDocs.map(d => [d.idProduct, d]));

    // Les codes de set RÉELS : sans eux, un bruit d'OCR ferait preuve (4e principe).
    const codesReels = (await mongoose.connection.collection('codes_set')
        .find({}, { projection: { codeSet: 1 } }).toArray())
        .map(l => S.normaliserCodeSet(l.codeSet)).filter(Boolean);

    const docs = await J.find({}).sort({ le: 1 }).lean();
    // ⚠️ LE HOLDOUT N'EST PAS FILTRÉ PAR LANGUE. Le lot frais contient 10 cartes
    // occidentales de contrôle : toutes les gardes de ce chantier sont conditionnées à
    // LANGUES_ASIATIQUES, donc une régression occidentale ne se verrait nulle part.
    // TROIS SEAUX. L'ordre de test compte : VERIFICATION avant HOLDOUT, sinon un rescan
    // déclaré partirait quand même dans le lot frais.
    // (ordre des seaux, dédoublonnage et numérotation : banc-seaux.js — source unique)
    // ⚠️ LES LIGNES HORS SERVICE SONT ÉCARTÉES **AVANT** LE DÉDOUBLONNAGE, et c'est le point
    // qui compte : le dédoublonnage garde la PREMIÈRE ligne vue. Si une ligne cassée restait
    // dans le lot, elle masquerait sa remplaçante — la carte rescannée après correction
    // n'apparaîtrait jamais. Une ligne hors service ne doit ni compter, NI MASQUER SA
    // REMPLAÇANTE.
    // ⚠️ L'ENTRAÎNEMENT RESTE JAPONAIS : les 44 cartes d'origine le sont, et y faire entrer
    // une occidentale changerait rétroactivement le jeu qui a produit les correctifs.
    // Le filtre est appliqué AVANT la numérotation, comme avant.
    const docsUtiles = docs.filter(d => {
        const dd = { ...d, le: d.le instanceof Date ? d.le : new Date(d.le) };
        return !(seauDe(dd) === 'entrainement' && !['JP', 'ZH', 'KR'].includes(d.langue));
    }).map(d => ({ ...d, le: d.le instanceof Date ? d.le : new Date(d.le) }));

    const { lignes: toutesLignes, horsService } = numeroter(docsUtiles);
    const seulementHoldout = process.argv.includes('--holdout');
    const bancs = toutesLignes.filter(l => !seulementHoldout || l.seau === 'holdout');
    const tous = toutesLignes.map(l => l.d);
    const n = s => toutesLignes.filter(l => l.seau === s).length;

    // ⚠️ LES VÉRITÉS SONT RATTACHÉES PAR IDENTITÉ, PAS PAR CLÉ. Une clé positionnelle
    // dépend du seau, de l'ordre et du nombre de lignes qui précèdent : changer la règle
    // des seaux renumérote tout et détache silencieusement ce qui a été saisi. C'est
    // exactement ce qui s'est produit — 32 vérités saisies sous H009..H033 pendant que le
    // banc numérotait L001..L025, aucune rattachée, et rien pour le dire.
    const rattachement = rattacherVerites(toutesLignes, VERITES_SAISIES);
    if (rattachement.desaccords.length) {
        console.log(`\n⚠️ ${rattachement.desaccords.length} vérité(s) saisie(s) sous une clé qui a CHANGÉ depuis :`);
        for (const x of rattachement.desaccords.slice(0, 8)) {
            console.log(`     « ${x.enregistree} » -> « ${x.actuelle} » (${x.seau})   "${x.lu?.nom}" n°${x.lu?.numero ?? '—'}`);
        }
        if (rattachement.desaccords.length > 8) console.log(`     … et ${rattachement.desaccords.length - 8} autre(s)`);
        console.log(`   Elles sont RATTACHÉES quand même : l'ancre est l'identité de la carte, pas la clé.`);
        console.log(`   Ce message dit que la règle des seaux a bougé depuis la saisie — pas qu'il y a une perte.`);
    }
    if (rattachement.orphelines.length) {
        console.log(`\n⚠️ ${rattachement.orphelines.length} vérité(s) ORPHELINE(S) — saisies sur des lignes que le banc n'ouvre pas :`);
        for (const o of rattachement.orphelines.slice(0, 10)) {
            console.log(`     « ${o.cle} » ${o.lu ? `"${o.lu.nom}" n°${o.lu.numero ?? '—'}` : ''} — ${o.raison}`);
        }
    }
    console.log(`ENTRAÎNEMENT ${n('entrainement')}  ·  HOLDOUT ${n('holdout')}  ·  VÉRIFICATION ${n('verification')}  ·  LOTS ${n('lot')}   (frontière : ${DATE_HOLDOUT.toISOString().slice(0, 10)})`);
    // Ce que chaque fenêtre a réellement capté — visible et compté, comme les lignes hors
    // service. Une fenêtre qui capte plus que prévu doit sauter aux yeux.
    for (const f of FENETRES_LOTS) {
        const pris = tous.filter(d => fenetreDe(d) === f && seauDe(d) === 'lot');
        if (pris.length || !f.fin) {
            console.log(`   lot « ${f.lot} » : ${pris.length} carte(s)${f.fin ? ` (fermée le ${f.fin.toISOString().slice(0, 10)})` : ' — OUVERTE'}`);
        }
    }
    if (VERIFICATION.length) console.log(`   ${VERIFICATION.length} carte(s) déclarée(s) en vérification : ${VERIFICATION.map(c => `${c.nom} n°${c.numero}`).join(', ')}`);
    if (horsService.length) {
        // VISIBLES ET COMPTÉES, jamais effacées — et on montre ce que l'exclusion COÛTE.
        const reussies = horsService.filter(d => d.idProduct != null).length;
        console.log(`\n⛔ ${horsService.length} ligne(s) HORS SERVICE, écartées avant dédoublonnage :`);
        for (const f of FENETRES_HORS_SERVICE) console.log(`   builds ${f.versions.join(', ')} — ${f.defaut} (corrigé par ${f.corrigePar})`);
        for (const d of horsService) {
            console.log(`     ${d.le?.toISOString?.().slice(0, 16)}  ${String(d.nom ?? '—').padEnd(16)} ${String(d.motifEchec ?? d.resultat ?? '?').padEnd(18)} build ${d.version}`);
        }
        console.log(`   ⚠️ dont ${reussies} qui avaient ABOUTI : l'exclusion les perd aussi. Elle n'est jamais gratuite.`);
    }
    if (n('holdout') === 0) console.log('   (aucun scan dans le lot frais — le tableau ci-dessous ne porte que sur l\'entraînement)\n');
    else console.log('');

    const cardInfoDe = d => ({
        name: d.nom, number: d.numero, total: d.total, setCode: d.setCode,
        language: d.langue, rarete: d.rarete, nomBrut: d.nomBrut, nomConfiance: d.nomConfiance,
        motif: null, reverse: false, rareteElevee: false
    });

    // Les lignes que le départage par l'image n'a PAS PU rejouer, faute d'avoir le vivier
    // entier au journal (tronqué à 200). ⚠️ Compté et affiché, jamais silencieux : un
    // échantillon qui rétrécit sans le dire est le défaut que ce banc traque partout.
    let imageNonRejouables = 0;

    // L'état APRÈS : les décisions ajoutées, appliquées à la sortie enregistrée.
    async function apres(d) {
        const cardInfo = cardInfoDe(d);
        let retenu = d.idProduct, incertain = Boolean(d.carteIncertaine), voie = d.voieCatalogue;

        // 0. LA RÈGLE DU NUMÉRO DE POKÉDEX. Quand elle se déclenche, le nombre lu n'est
        //    pas un numéro de carte : il ne sert plus ni de clé, ni de preuve, ni de rang.
        const avisDex = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
        const numeroCarte = avisDex.estDex ? null : d.numero;
        const cardInfoNeutre = { ...cardInfo, number: numeroCarte };
        // Perdre une source propage l'incertitude : sans le numéro, l'identification ne
        // tient plus qu'au nom, et sur ces cartes vintage le nom ne suffit pas.
        if (avisDex.estDex) { voie = 'numero-pokedex-neutralise'; incertain = true; }

        // 0 bis. LE PÉRIMÈTRE FERMÉ. Sans numéro exploitable et en langue asiatique, le
        //    vivier par le nom est restreint aux 24 sets japonais vintage. Sortie en
        //    SUGGESTION AVERTIE : `incertain` est forcé, jamais un verdict affirmé.
        // Deux portes : aucun numéro exploitable, OU un numéro mais aucune expansion
        // attendue — gardé par la compatibilité du setCode lu avec la table close.
        const compat = setCodeCompatibleVintage(d.setCode, S, codesReels);
        let sansExpansion = false;
        if (numeroCarte != null) {
            const sets = await setsPourTotal(d.total, d.langue);
            const exps = new Set();
            for (const s of sets) for (const e of await Num.distinct('idExpansion', { setTcgdex: s.id })) if (e != null) exps.add(Number(e));
            sansExpansion = exps.size === 0;
        }
        if ((numeroCarte == null || sansExpansion) && compat.compatible && ['JP', 'ZH', 'KR'].includes(d.langue)) {
            const parNom = await trouverProduitsLocaux(d.nom);
            const dedans = parNom.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
            if (parNom.length > 1 && dedans.length) {
                const cs = await lireCodeSets(dedans.map(p => p.idExpansion));
                const r = await scorerCandidatsLocal(dedans, cardInfoNeutre, null, [], cs, {});
                // ⚠️ `sontExAequo`, JAMAIS un `===` en ligne. Elle a été extraite dans
                // scoring.js pour qu'il n'existe pas un second seuil d'égalité ailleurs —
                // et le banc en portait TROIS. Aujourd'hui les deux se comportent pareil
                // (l'égalité est stricte), donc rien ne signalerait la divergence ; le jour
                // où la définition bouge, la production changerait et le banc garderait
                // l'ancienne. C'est la forme exacte du défaut que la règle de symétrie
                // existe pour attraper, et elle ne couvrait que les DÉCISIONS, pas les
                // SEUILS qu'elles utilisent.
                const eg = r.scores.length > 1 && S.sontExAequo(r.scores[0].score, r.scores[1].score);
                if (r.scores.length && !eg) {
                    retenu = r.scores[0].candidat.idProduct;
                    voie = 'perimetre-vintage';
                    incertain = true;   // suggestion avertie, arbitrage F
                    return { retenu, incertain, voie };
                }
                // Égalité dans le périmètre : le SYMBOLE d'abord, l'écart de prix ensuite.
                if (eg) {
                    const exAequo = r.scores.filter(s => S.sontExAequo(s.score, r.scores[0].score));
                    // ⚠️ LE DÉPARTAGE PAR LE SYMBOLE, DANS LE MÊME ORDRE QU'EN PRODUCTION.
                    // Il manquait ici pendant un commit, et la colonne APRÈS a menti de
                    // -7 justes et +10 refus sur le lot « symbole-40 » : le banc refusait
                    // 9 cartes que la production départageait correctement. Voir la règle
                    // de symétrie en tête de fichier.
                    const avisSym = departagerParSymbole(
                        d.symboleSet,
                        exAequo.map(s => ({ idProduct: s.candidat.idProduct, codeSet: cs.get(Number(s.candidat.idExpansion)) ?? null })),
                        S
                    );
                    if (avisSym.gagnant) {
                        return { retenu: avisSym.gagnant.idProduct, incertain: true, voie: 'symbole-departage' };
                    }
                    // ⚠️ LE DÉPARTAGE PAR L'ATTAQUE, DANS LE MÊME ORDRE QU'EN PRODUCTION :
                    // derrière le symbole (mesuré 12/12), devant l'écart de prix. Il entre
                    // ici AU MÊME COMMIT qu'en production — c'est précisément la faute que
                    // la règle de symétrie existe pour attraper.
                    //
                    // 🔴 ET IL EST INERTE SUR CE BANC AUJOURD'HUI, IL FAUT LE DIRE ICI :
                    // `d.attaque` vient du prompt du 2026-09-05, et AUCUNE ligne de journal
                    // ne le porte encore. La colonne APRÈS ne mesurera donc RIEN de cette
                    // décision — elle prouve seulement qu'elle ne casse rien. C'est le même
                    // état que le départage par l'image le 2026-08-29, inerte tant que
                    // `references_image` était vide : le banc ne pourra la mesurer qu'une
                    // fois des lectures d'attaque au journal.
                    const avisAtt = departagerParAttaque(
                        d.attaque, d.attaqueConfiance,
                        exAequo.map(s => ({
                            idProduct: s.candidat.idProduct,
                            name: catById.get(s.candidat.idProduct)?.name ?? null,
                            idMetacard: catById.get(s.candidat.idProduct)?.idMetacard ?? null
                        }))
                    );
                    if (avisAtt.gagnant) {
                        return { retenu: avisAtt.gagnant.idProduct, incertain: true, voie: 'attaque-departage' };
                    }
                    const prix = exAequo.map(s => s.candidat.prix).filter(p => Number.isFinite(p) && p > 0);
                    const ecart = prix.length >= 2 ? Math.max(...prix) - Math.min(...prix) : null;
                    if (ecart == null || ecart >= 1.00) return { retenu: null, incertain: true, voie: 'REFUS-egalite-perimetre' };
                    return { retenu: r.scores[0].candidat.idProduct, incertain: true, voie: 'perimetre-egalite-sans-enjeu' };
                }
            }
        }

        // 1. Le chemin par le code, en tête.
        const piste = await trouverParSetCodeEtNumero(d.setCode, numeroCarte, d.langue);
        if (piste.length === 1) {
            const a = await nomOpposeUnVeto(cardInfoNeutre, piste[0]);
            if (!a.veto) { retenu = piste[0].idProduct; voie = 'setcode-numero'; }
        }

        // 2. Le veto par le nom sur le gagnant, et son re-classement.
        const prod = catById.get(retenu);
        if (prod) {
            const avis = await nomOpposeUnVeto(cardInfoNeutre, prod);
            if (avis.incoherent) incertain = true;
            if (avis.veto) {
                const cs = await lireCodeSets(avis.preuves.map(p => p.idExpansion));
                // ⚠️ `cardInfoNeutre`, PAS `cardInfo`. Cette ligne était le SEUL endroit du
                // banc qui repassait au numéro BRUT, alors que tout le reste du fichier
                // utilise `cardInfoNeutre` : c'était une incohérence INTERNE au banc, et
                // c'est elle qu'on corrige ici.
                //
                // ⚠️ CE QUE CE CORRECTIF NE FAIT PAS : rétablir la symétrie avec la
                // production. Le banc neutralise le numéro jusque dans le critère de
                // SCORING ; la production, elle, ne le neutralise que pour les diagnostics
                // (voir `numeroBrutPourScoring` dans index.js — lot B retenu). Le banc a
                // donc TOUJOURS mesuré un comportement que la production n'a jamais eu, sur
                // les cartes à numéro de Pokédex : 56 lignes de journal sur 131.
                // C'est exactement ce que la mesure du lot B doit chiffrer. Tant qu'elle
                // n'est pas faite, ne pas lire les colonnes AVANT/APRÈS de ces lignes-là
                // comme une prédiction de ce que fera la production.
                const r = await scorerCandidatsLocal(avis.preuves, cardInfoNeutre, null, [], cs, {});
                const eg = r.scores.length > 1 && S.sontExAequo(r.scores[0].score, r.scores[1].score);
                if (r.scores.length && !eg) { retenu = r.scores[0].candidat.idProduct; voie = 'veto-nom-reclasse'; }
                else { retenu = null; voie = 'REFUS-veto'; incertain = true; }
            }
        }

        // 2 bis. LE DÉPARTAGE PAR L'IMAGE — branché en production le 2026-08-29, et ici le
        //    même jour. Il est placé APRÈS le symbole, qui rend la main plus haut (ligne
        //    479) : la priorité du symbole est donc la même des deux côtés, par construction
        //    et non par recopie d'un ordre.
        //
        // ⚠️ CE QUE LE BANC PEUT REJOUER, ET CE QU'IL NE PEUT PAS — à lire avant de croire
        // la colonne APRÈS sur ces lignes.
        //   · ÉGALITÉ AU SOMMET : rejouable fidèlement. `exAequoIds` est journalisé entier.
        //   · PAS DE TOTAL LU : le groupe est le vivier ENTIER, or `vivierIds` est tronqué
        //     à 200 au journal (journal-scans.js). Au-delà, le banc n'a pas le groupe que
        //     la production avait ; il s'abstient ET LE COMPTE, au lieu de départager sur
        //     un groupe amputé — ce qui reviendrait à prendre le raccourci que
        //     departage-image.js interdit en toutes lettres.
        //   · Les lignes ANTÉRIEURES au 2026-08-11 n'ont pas d'`imageUrl` : rien à
        //     télécharger, donc abstention. Ce n'est pas un défaut du banc, c'est l'âge
        //     du journal.
        // ⚠️ ET TANT QUE `references_image` EST VIDE, TOUT CECI S'ABSTIENT — des deux côtés.
        // La colonne APRÈS ne doit donc PAS bouger tant que les descripteurs ne sont pas
        // écrits. Si elle bouge, c'est le branchement qui est faux, pas la mesure.
        if (voie === d.voieCatalogue) {
            const totalLu = String(d.total ?? '').trim() !== '';
            let groupe = null, tronque = false;
            if (!totalLu) {
                const ids = Array.isArray(d.vivierIds) ? d.vivierIds : [];
                tronque = Number.isFinite(d.vivierTaille) && d.vivierTaille > ids.length;
                if (ids.length && !tronque) groupe = ids.map(id => ({ idProduct: id, score: 0 }));
            } else if (d.ecartScore === 0 && Array.isArray(d.exAequoIds) && d.exAequoIds.length > 1) {
                // Scores égaux : c'est ce que `ecartScore === 0` CONSTATE au journal, et
                // c'est ce qui fait que `sontExAequo` retiendra tout le groupe.
                groupe = d.exAequoIds.map(id => ({ idProduct: id, score: 0 }));
            }
            if (tronque) imageNonRejouables++;
            if (groupe && groupe.length > 1) {
                const avis = await departagerParImage({
                    imageUrl: d.imageUrl, langue: d.langue, total: d.total, classement: groupe
                });
                if (avis.departage && avis.gagnant !== retenu) {
                    return { retenu: avis.gagnant, incertain: true, voie: 'image-departage' };
                }
            }
        }

        // 3. L'égalité parfaite du chemin principal. `ecartScore` est enregistré au
        //    journal, donc l'égalité est CONSTATÉE, pas simulée. Elle ne s'applique qu'aux
        //    lignes que les étapes 1 et 2 n'ont pas déjà tranchées : quand une clé exacte
        //    ou un re-classement a désigné un produit, il n'y a plus d'égalité à arbitrer.
        if (voie === d.voieCatalogue && d.ecartScore === 0) {
            retenu = null; voie = 'REFUS-egalite'; incertain = true;
        }
        return { retenu, incertain, voie };
    }

    // Lecture jugée par CONTRADICTION POSITIVE seulement — même principe que partout
    // ailleurs. Un numéro absent en base ne contredit rien : il rend la lecture
    // INVÉRIFIABLE, ce qui n'est pas une réussite.
    function lecture(d, idAttendu) {
        const p = catById.get(idAttendu);
        if (!p) return { verdict: 'invérifiable', champ: null };
        const info = numParId.get(idAttendu);
        const nomOk = S.nomConcorde([d.nom, d.nomBrut].filter(Boolean),
            [String(p.name).split('[')[0].trim(), info?.nomFr].filter(Boolean));
        const numBase = info ? (info.numero || info.numeroUrl) : null;
        if (!nomOk) return { verdict: 'contredite', champ: 'nom' };
        if (!numBase || !d.numero) return { verdict: 'invérifiable', champ: 'numéro non publié' };
        if (!S.comparerNumeros(d.numero, numBase)) return { verdict: 'contredite', champ: 'numéro' };
        return { verdict: 'juste', champ: null };
    }

    // ════════════════════════════════════════════════════════════════════════
    // D'OÙ VIENT LA VÉRITÉ DE CHAQUE LIGNE — l'audit de l'instrument lui-même
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ LE DÉFAUT LE PLUS GRAVE DE TOUT LE CHANTIER ÉTAIT ICI, dans l'instrument et non
    // dans le code mesuré : le banc tirait sa référence de la chose qu'il mesurait. Quand
    // aucune vérité n'était fournie, il prenait `d.idProduct` — ce que la PRODUCTION avait
    // retenu. Sur un scan qui avait ÉCHOUÉ, cela vaut `null` : le banc notait donc juste
    // l'échec lui-même, et comptait deux identifications correctes comme des régressions.
    // UNE MESURE QUI DÉRIVE SA RÉFÉRENCE DU SYSTÈME MESURÉ NE MESURE RIEN.
    //
    // La provenance est désormais explicite et comptée. Cinq cas, et un seul est interdit :
    //   'cle'          la clé JPxxx porte un idProduct fourni par le testeur (URL Cardmarket)
    //   'nom'          idem, rattaché par le nom de la carte
    //   'bloc'         aucune vérité individuelle, MAIS la production avait abouti et le
    //                  testeur a validé en bloc « toutes les autres lignes : attendu =
    //                  retenu ». C'est une affirmation du testeur, pas une dérivation.
    //   'inconnu'      le testeur n'a pas pu retrouver la carte -> exclue
    //   'SANS-VERITE'  la production avait ÉCHOUÉ et aucune vérité n'a été fournie. Il n'y
    //                  a RIEN à comparer -> exclue, et comptée à part. C'est le cas qui
    //                  produisait le mensonge.
    // ⚠️ UN INCIDENT TECHNIQUE N'EST PAS UN ÉCHEC D'IDENTIFICATION. Un appel IA qui n'a rien
    // rendu, une exception serveur, un réveil de Render trop lent : la chaîne n'a jamais eu
    // l'occasion de se tromper. Les compter parmi les refus — ou pire, leur donner une
    // vérité et les compter faux — ferait porter au tableau la qualité du réseau.
    // Ils sortent donc dans une catégorie à eux, comptée et nommée.
    // (Un quota épuisé ou un serveur endormi, eux, ne laissent AUCUNE ligne : `verifierAcces`
    //  et le timeout agissent avant toute écriture au journal. Rien à exclure dans ce cas.)
    const MOTIFS_TECHNIQUES = new Set(['ia-echec', 'erreur-serveur']);

    function verite(cle, d) {
        if (MOTIFS_TECHNIQUES.has(d.motifEchec)) return { valeur: null, source: 'TECHNIQUE' };
        // Les deux tables codées en dur, ancrées par IDENTITÉ et bornées aux seaux
        // d'entraînement et de vérification — voir leur en-tête pour la contamination
        // « Raichu » que cette borne supprime.
        const seau = seauDe(d);
        if (SEAUX_VERITES_CODEES.has(seau)) {
            const ident = identiteDe(d);
            const parCle = VERITE.find(v => identiteDe({ ...v.lu }) === ident);
            if (parCle) return { valeur: parCle.idProduct, source: parCle.idProduct === 'inconnu' ? 'inconnu' : 'cle' };
            const parNom = VERITE_PAR_NOM.find(v => identiteDe({ ...v.lu }) === ident);
            if (parNom) return { valeur: parNom.idProduct, source: 'nom' };
        }
        // Rattachement PAR IDENTITÉ de la carte lue, jamais par la clé positionnelle.
        const vs = rattachement.parIdentite.get(identiteDe(d));
        if (vs !== undefined) {
            // ⚠️ TROIS VALEURS SPÉCIALES, ET ELLES NE DISENT PAS LA MÊME CHOSE.
            //   'inconnu'        -> le testeur n'a pas su reconnaître la carte. Limite de
            //                      l'observateur : exclue, et on ne peut rien en conclure.
            //   'hors-perimetre' -> il l'a reconnue, et elle n'est dans AUCUN candidat que
            //                      la chaîne propose. C'est un DÉFAUT DE VIVIER, mesurable
            //                      et attribuable — exclue du taux, mais COMPTÉE à part.
            // Les confondre effacerait la seule mesure qui dise « le périmètre a raté la
            // carte » ; et laisser 'hors-perimetre' tomber dans le cas général la compterait
            // FAUSSE, ce qui accuserait le scoring d'une faute du vivier.
            if (vs.idProduct === 'inconnu') return { valeur: null, source: 'inconnu' };
            if (vs.idProduct === 'hors-perimetre') return { valeur: null, source: 'hors-perimetre' };
            return { valeur: vs.idProduct, source: `saisie:${vs.source}` };
        }
        if (d.idProduct == null) return { valeur: null, source: 'SANS-VERITE' };
        return { valeur: d.idProduct, source: 'bloc' };
    }

    // DEUX JEUX DE COMPTEURS, jamais mélangés : entraînement et holdout.
    //
    // ════════════════════════════════════════════════════════════════════════
    // ET, À L'INTÉRIEUR DE CHAQUE SEAU, DEUX ORIGINES DE VÉRITÉ QUI NE VALENT PAS PAREIL
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ UN TAUX CALCULÉ SUR DES VÉRITÉS « EN BLOC » MENT PAR CONSTRUCTION. Quand aucune
    // vérité individuelle n'a été fournie, `verite()` retombe sur `attendu = d.idProduct` :
    // la référence est alors CE QU'ON MESURE. La colonne AVANT vaut donc 100 % de justes
    // par arithmétique, jamais par évaluation — le seau LOTS a affiché « JUSTE 20 100,0 % »
    // à sa première exécution, sur zéro vérité vérifiée.
    // C'EST LE MÊME DÉFAUT QUE LE BANC QUI PRENAIT L'ÉCHEC POUR LA VÉRITÉ, dans l'autre
    // sens : là il notait juste un échec, ici il note juste une réussite. Une mesure qui
    // dérive sa référence du système mesuré ne mesure rien, quel que soit le signe.
    //
    // LES DEUX ORIGINES SONT DONC COMPTÉES À PART :
    //   - INDIVIDUELLE (cle, nom, saisie:*) : quelqu'un a désigné CETTE carte. Le taux a
    //     un sens dans les deux colonnes.
    //   - EN BLOC : AVANT est tautologique. Seul le MOUVEMENT avant -> après y garde un
    //     sens, car `apres(d)` recalcule et peut s'écarter de ce que la production avait
    //     retenu : ces lignes détectent une RÉGRESSION, jamais une réussite.
    // `issuesVides` et non `compteurs` : ce dernier nomme déjà les compteurs de seaux plus
    // haut, et deux définitions du même nom dans un fichier est exactement ce qu'on évite.
    const issuesVides = () => ({ juste: 0, faux: 0, refus: 0, signale: 0 });
    const vide = () => ({
        ind: { avant: issuesVides(), apres: issuesVides(), retenus: 0 },
        blocs: { avant: issuesVides(), apres: issuesVides(), retenus: 0, bouge: 0 },
        lec: { juste: 0, contredite: 0, 'invérifiable': 0 },
        provenance: { cle: 0, nom: 0, bloc: 0, inconnu: 0, 'hors-perimetre': 0, 'SANS-VERITE': 0, TECHNIQUE: 0 },
        cellules: new Map(), exclus: 0, retenus: 0, detail: [], sansVerite: []
    });
    const LOTS = { entrainement: vide(), holdout: vide(), verification: vide(), lot: vide() };
    for (const { cle, d, seau } of bancs) {
        const L = LOTS[seau];
        const R = L, lec = L.lec, provenance = L.provenance, detail = L.detail, sansVerite = L.sansVerite;
        L.cellules.set(celluleDe(d), (L.cellules.get(celluleDe(d)) || 0) + 1);
        const v = verite(cle, d);
        provenance[v.source] = (provenance[v.source] || 0) + 1;
        if (v.source === 'TECHNIQUE') { L.exclus++; continue; }
        if (v.source === 'inconnu') { L.exclus++; continue; }
        // Exclue du taux comme 'inconnu', mais elle n'a pas la même cause : le compteur de
        // provenance ci-dessus la garde séparée, et le rapport la nomme.
        if (v.source === 'hors-perimetre') { L.exclus++; continue; }
        if (v.source === 'SANS-VERITE') { L.exclus++; sansVerite.push({ cle, d }); continue; }
        const attendu = v.valeur;
        L.retenus++;
        const l = lecture(d, attendu);
        lec[l.verdict]++;
        const a = await apres(d);
        const okAvant = d.idProduct === attendu, okApres = a.retenu === attendu;
        // ⚠️ UN REFUS N'AFFIRME RIEN. Un scan qui ne rend aucun produit (`retenu === null`)
        // est un échec, pas un mensonge : l'utilisateur est remboursé et n'a vu aucun prix.
        // Le compter parmi les « faux et affirmés » gonflait le seul chiffre qui décide du
        // lancement, et dans le mauvais sens — il faisait passer une amélioration réelle
        // pour une régression.
        // TROIS ISSUES, jamais deux. Un REFUS (aucun produit rendu) n'est ni une réussite
        // ni un mensonge : l'utilisateur est remboursé et n'a vu aucun prix. Le ranger
        // parmi les « faux » gonflait le chiffre qui décide du lancement.
        const issue = r => r.id === attendu ? 'juste' : (r.id == null ? 'refus' : 'faux');
        const iAvant = issue({ id: d.idProduct }), iApres = issue({ id: a.retenu });
        // L'ORIGINE DE LA VÉRITÉ DÉCIDE DU COMPTEUR. Voir le bloc au-dessus de `vide()` :
        // une ligne validée en bloc ne peut pas produire un « faux » à l'AVANT.
        const G = (v.source === 'bloc') ? R.blocs : R.ind;
        G.retenus++;
        G.avant[iAvant]++; G.apres[iApres]++;
        if (iAvant === 'faux' && d.carteIncertaine) G.avant.signale++;
        if (iApres === 'faux' && a.incertain) G.apres.signale++;
        if (v.source === 'bloc' && iAvant !== iApres) R.blocs.bouge++;
        if (iAvant !== 'juste' || iApres !== 'juste') detail.push({ cle, d, attendu, a, l, iAvant, iApres, source: v.source });
    }

    // ⚠️ LES DEUX LOTS SONT RAPPORTÉS SÉPARÉMENT, JAMAIS ADDITIONNÉS. Additionner un jeu
    // d'entraînement et un holdout donnerait un chiffre qui ne veut rien dire : le premier
    // est optimisé, le second seul décide.
    function rapporter(titre, L) {
        if (!L.retenus && !L.exclus) return;
        const p = x => `${(100 * x / Math.max(1, L.retenus)).toFixed(1)} %`;
        console.log(`\n${'═'.repeat(76)}\n  ${titre}\n${'═'.repeat(76)}`);
        console.log('── D\'OÙ VIENT LA VÉRITÉ DE CHAQUE LIGNE ──');
        console.log(`   idProduct fourni par le testeur, par CLÉ .......... ${L.provenance.cle}`);
        console.log(`   idProduct fourni par le testeur, par NOM .......... ${L.provenance.nom}`);
        console.log(`   validé EN BLOC (« toutes les autres : attendu = retenu ») ${L.provenance.bloc}`);
        console.log(`   « inconnu » — carte non retrouvée, EXCLUE ......... ${L.provenance.inconnu}`);
        console.log(`   HORS PÉRIMÈTRE — reconnue, ABSENTE du vivier ..... ${L.provenance['hors-perimetre']}` +
            (L.provenance['hors-perimetre'] ? '   ⚠️ défaut de vivier, pas de scoring' : ''));
        console.log(`   SANS VÉRITÉ (production en échec), EXCLUE ......... ${L.provenance['SANS-VERITE']}`);
        console.log(`   INCIDENT TECHNIQUE (IA muette, erreur serveur), EXCLUE ${L.provenance.TECHNIQUE}`);
        for (const [k, n] of Object.entries(L.provenance)) {
            if (k.startsWith('saisie:')) console.log(`   saisie à la main — ${k.slice(7).padEnd(24)} ${n}`);
        }
        for (const x of L.sansVerite) console.log(`      ${x.cle} "${x.d.nom}" n°${x.d.numero ?? '—'} — aucune référence, rien à comparer`);

        console.log('\n── RÉPARTITION RÉELLE DANS LES CELLULES ──');
        for (const [c, n] of [...L.cellules.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`   ${c.padEnd(32)} ${String(n).padStart(3)}`);
        }
        console.log(`\n${L.retenus + L.exclus} cartes distinctes · ${L.exclus} exclues · ${L.retenus} exploitables\n`);

        // ⚠️ EN TÊTE, PARCE QUE C'EST LE SEUL CONTRÔLE NON TAUTOLOGIQUE DU RAPPORT.
        // Il ne compare pas « attendu » à « retenu » — il compare CE QUE L'IA A LU au
        // produit réellement désigné. Il garde donc tout son sens même sur des lignes
        // validées en bloc, là où le taux de justes n'en a aucun.
        console.log('── TAUX DE LECTURE IA — le seul contrôle indépendant de la vérité fournie ──');
        console.log(`   juste (nom ET numéro confirmés) . ${String(L.lec.juste).padStart(3)}  ${p(L.lec.juste)}`);
        console.log(`   CONTREDITE par la carte retenue   ${String(L.lec.contredite).padStart(3)}  ${p(L.lec.contredite)}`);
        console.log(`   invérifiable (numéro non publié) . ${String(L.lec['invérifiable']).padStart(3)}  ${p(L.lec['invérifiable'])}`);

        // ---- LE TAUX DE JUSTES, sur les seules vérités INDIVIDUELLES ----
        const I = L.ind, B = L.blocs;
        const pi = x => `${(100 * x / Math.max(1, I.retenus)).toFixed(1)} %`;
        console.log('\n── TROIS ISSUES, JAMAIS DEUX ──');
        if (I.retenus === 0 && B.retenus === 0) {
            // Rien d'exploitable du tout : ne pas parler de vérités en bloc qui n'existent pas.
            console.log(`   (aucune ligne exploitable — ${L.exclus} exclue(s), rien à mesurer)`);
        } else if (I.retenus === 0) {
            // ⚠️ LE REFUS. Afficher « 100 % de justes » sur des vérités dérivées de la
            // production serait un mensonge par construction, pas une bizarrerie à
            // signaler en note de bas de page. On ne l'affiche pas.
            console.log(`   ⛔ TAUX REFUSÉ — aucune vérité individuelle sur ce seau.`);
            console.log(`      Les ${B.retenus} ligne(s) exploitables sont validées EN BLOC : leur « attendu » EST`);
            console.log(`      ce que la production avait retenu. Un taux de justes y vaudrait 100 % par`);
            console.log(`      arithmétique, jamais par évaluation.`);
            console.log(`      -> node saisir-verites.js   (puis relancer le banc)`);
        } else {
            console.log(`   (sur les ${I.retenus} ligne(s) à vérité INDIVIDUELLE ; les ${B.retenus} validées en bloc sont plus bas)`);
            console.log('                     AVANT          APRÈS');
            console.log(`   JUSTE ......... ${String(I.avant.juste).padStart(3)}  ${pi(I.avant.juste).padStart(7)}   ${String(I.apres.juste).padStart(3)}  ${pi(I.apres.juste).padStart(7)}`);
            console.log(`   FAUX .......... ${String(I.avant.faux).padStart(3)}  ${pi(I.avant.faux).padStart(7)}   ${String(I.apres.faux).padStart(3)}  ${pi(I.apres.faux).padStart(7)}`);
            console.log(`     dont signalé  ${String(I.avant.signale).padStart(3)}              ${String(I.apres.signale).padStart(3)}`);
            console.log(`     FAUX ET AFFIRMÉ ${String(I.avant.faux - I.avant.signale).padStart(2)}              ${String(I.apres.faux - I.apres.signale).padStart(3)}   ← le seuil de lancement`);
            console.log(`   REFUS ......... ${String(I.avant.refus).padStart(3)}  ${pi(I.avant.refus).padStart(7)}   ${String(I.apres.refus).padStart(3)}  ${pi(I.apres.refus).padStart(7)}   (remboursés, aucun prix montré)`);
        }

        // ---- LES LIGNES EN BLOC, à part, avec ce qu'elles peuvent et ne peuvent pas dire ----
        if (B.retenus) {
            console.log(`\n── ${B.retenus} LIGNE(S) VALIDÉE(S) EN BLOC — détecteur de régression, PAS un taux ──`);
            console.log(`   AVANT y vaut 100 % de justes par construction (attendu = ce que la production`);
            console.log(`   avait retenu). Seul le MOUVEMENT a un sens : il révèle ce que les décisions`);
            console.log(`   ajoutées CHANGENT par rapport à la production.`);
            console.log(`   inchangées ${String(B.retenus - B.bouge).padStart(3)}   ·   déplacées ${String(B.bouge).padStart(3)}` +
                `   (après : ${B.apres.juste} juste, ${B.apres.faux} faux, ${B.apres.refus} refus)`);
            if (B.apres.faux) {
                console.log(`   ⚠️ ${B.apres.faux} ligne(s) deviennent FAUSSES après nos décisions : régression réelle,`);
                console.log(`      la seule information que ce bloc puisse produire.`);
            }
        }

        if (L.detail.length) {
            console.log('\n── LES LIGNES QUI BOUGENT OU RESTENT FAUSSES ──');
            for (const x of L.detail) {
                const nomAtt = String(catById.get(x.attendu)?.name ?? '?').split('[')[0].trim();
                const ic = { juste: '✅', faux: '❌', refus: '⛔' };
                console.log(`${x.cle}  "${x.d.nom}" n°${x.d.numero} code=${x.d.setCode ?? '—'} total=${x.d.total ?? '—'}  [lecture ${x.l.verdict}${x.l.champ ? ` : ${x.l.champ}` : ''}] [vérité: ${x.source}]`);
                console.log(`      attendu ${x.attendu} "${nomAtt}"`);
                console.log(`      AVANT ${x.d.idProduct} ${ic[x.iAvant]}  ->  APRÈS ${x.a.retenu} ${ic[x.iApres]} incertain=${x.a.incertain} voie=${x.a.voie}`);
            }
        }
    }
    if (!seulementHoldout) {
        rapporter('ENTRAÎNEMENT — cartes ayant servi à dériver les correctifs. NE DÉCIDE DE RIEN.', LOTS.entrainement);
        rapporter('VÉRIFICATION — rescans de cartes d\'entraînement, déclarés AVANT le scan. NE DÉCIDE DE RIEN.', LOTS.verification);
        // Un lot de diagnostic sert à TROUVER des bugs : ses cartes deviennent de
        // l'entraînement par construction. Rapporté, jamais décisionnaire.
        rapporter('LOTS DÉCLARÉS — scans de diagnostic, fenêtre ouverte AVANT le scan. NE DÉCIDE DE RIEN.', LOTS.lot);
    }
    rapporter('HOLDOUT — lot frais, jamais vu par aucun correctif. C\'EST LUI QUI DÉCIDE.', LOTS.holdout);

    // ════════════════════════════════════════════════════════════════════════
    // AUTO-CONTRÔLE : le banc sait-il se tromper ?
    // ════════════════════════════════════════════════════════════════════════
    // Un instrument qu'on n'a jamais vu signaler une erreur n'est pas vérifié. On injecte
    // une vérité FAUSSE connue sur une ligne aujourd'hui juste : le banc doit la compter
    // comme fausse. S'il la compte juste, il ne compare rien.
    if (process.argv.includes('--auto-controle')) {
        console.log('\n── AUTO-CONTRÔLE : injection d\'une vérité fausse ──');
        const temoin = bancs.find(({ cle, d }) => {
            const v = verite(cle, d);
            return v.source !== 'inconnu' && v.source !== 'SANS-VERITE' && d.idProduct === v.valeur;
        });
        // ⚠️ CE QUE LE DÉPARTAGE PAR L'IMAGE A REJOUÉ, ET CE QU'IL A DÛ LAISSER.
        console.log(`\n   départage par l'image — lignes NON rejouables (vivier tronqué au journal) : ${imageNonRejouables}`);
        if (imageNonRejouables) {
            console.log(`   ⚠️ Sur ces lignes la colonne APRÈS ne prédit PAS la production : le banc`);
            console.log(`      n'a pas le groupe entier, et il s'abstient plutôt que de départager`);
            console.log(`      sur un groupe amputé (voir le raccourci interdit, departage-image.js).`);
        }
        if (!temoin) { console.log('   aucune ligne juste disponible comme témoin'); }
        else {
            const vraie = verite(temoin.cle, temoin.d).valeur;
            const fausse = 999999999;
            const a = await apres(temoin.d);
            const avecVraie = a.retenu === vraie ? 'juste' : (a.retenu == null ? 'refus' : 'faux');
            const avecFausse = a.retenu === fausse ? 'juste' : (a.retenu == null ? 'refus' : 'faux');
            console.log(`   témoin ${temoin.cle} "${temoin.d.nom}" — la chaîne rend ${a.retenu}`);
            console.log(`     avec la vraie vérité (${vraie})   -> ${avecVraie}   ${avecVraie === 'juste' ? '✅' : '❌'}`);
            console.log(`     avec une vérité FAUSSE (${fausse}) -> ${avecFausse}   ${avecFausse === 'faux' ? '✅ le banc la signale' : '❌ LE BANC NE COMPARE RIEN'}`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(async e => { console.error('ERREUR', e.message, e.stack); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
