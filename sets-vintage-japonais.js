// ════════════════════════════════════════════════════════════════════════════
// ⚠️ CE FICHIER EST CANDIDAT À DEVENIR DU CODE MORT — 2026-08-19
// ════════════════════════════════════════════════════════════════════════════
// LA BASCULE D'ARCHITECTURE EST DÉCIDÉE : l'appariement d'images cesse d'être un
// départage de dernier recours pour devenir le CHEMIN PRINCIPAL d'identification. Le
// reste de la chaîne garde trois rôles et perd le premier :
//   · l'ÉTAT de la carte vendue — aucune image ne le donne, et c'est lui qui fait le prix
//   · la LANGUE, et le choix de l'IMPRESSION quand deux idProducts partagent un même scan
//   · le garde-fou quand l'image doute
//
// CE QUI DEVIENDRA PROBABLEMENT INUTILE, ET IL FAUT L'ÉCRIRE MAINTENANT : la table close
// ci-dessous, la règle du numéro de Pokédex (pokedex.js), le départage par le symbole, et
// le périmètre vintage. Tous existent pour une seule raison — reconstituer par le TEXTE
// une information que la carte ne porte pas. Une carte sans symbole dont le seul nombre
// imprimé est « No. 100 » (le numéro de Pokédex) est indécidable par le texte : la preuve
// par l'existence a été faite le 2026-08-19 sur un Voltorb japonais, qu'un scanner
// concurrent a rendu « Expansion Pack n°037 » à 94,1 % depuis une photo d'annonce, en
// 1,6 s. L'information n'est pas sur la carte ; elle est dans l'illustration.
//
//   ⚠️ ON NE SUPPRIME RIEN AUJOURD'HUI, ET CETTE NOTE EXISTE POUR QU'ON NE S'INTERDISE
//   PAS DE LE FAIRE PLUS TARD PAR ATTACHEMENT. Ce fichier a coûté des jours : une table
//   écrite à la main ligne par ligne, une règle d'admission sans exception, des symboles
//   relevés un par un. Rien de tout ça ne le rend utile si l'image répond mieux. Un code
//   qu'on garde parce qu'il a été cher à écrire est la définition du coût irrécupérable.
//
// LA CONDITION DE MISE À MORT, écrite d'avance comme les autres : le jour où le chemin
// image tient les seuils de sa règle de décision ET couvre les sets que ces règles
// servaient, on retire — table close, règle Pokédex, départage par symbole, périmètre —
// et on mesure ce que ça coûte au banc. Si le banc ne bouge pas, le code était mort.
// ⚠️ ET CE QUI NE CHANGE PAS : les références d'images du vintage japonais n'existent
// nulle part (0 % chez TCGdex). Tant que ce goulot tient, ces règles restent le seul
// chemin sur les sets non couverts — leur mort dépend de l'approvisionnement en images,
// pas de la qualité de l'appariement.

// ════════════════════════════════════════════════════════════════════════════
// LA RÈGLE QUI PASSE AVANT TOUTES LES AUTRES DANS CE CHANTIER
// ════════════════════════════════════════════════════════════════════════════
// AUCUN SIGNAL NOUVEAU N'EST AJOUTÉ TANT QU'UN SIGNAL DÉJÀ CALCULÉ RESTE NON CONSULTÉ.
// Soit on le branche, soit on le supprime.
//
// POURQUOI. Ajouter un signal est facile et se sent productif ; le brancher demande de
// mesurer ce qu'il casse. Le chantier a donc accumulé des champs calculés à chaque scan,
// écrits en base, et que rien ne lit — chacun ayant l'air d'un progrès au moment où il a
// été écrit. Le cas qui a fait adopter la règle : `totalInvalidable`. Calculé sur tous les
// scans depuis le 2026-08-04, jamais consulté, et SON NOM PRÉPARAIT LA MAUVAISE
// CONCLUSION — « total invalidable » invitait à jeter le total, alors que sur les 7 lignes
// marquées, ZÉRO portait un total mal lu. Sur Bayleef, le total (029) était le signal le
// plus précis de la ligne : il désignait les 29 cartes de la sous-série « S » d'EC1.
// Un signal non branché ne dort pas : il vieillit, et il ment quand on le réveille.
//
// L'INVENTAIRE, au 2026-08-18 — champs calculés à chaque scan, journalisés, qu'AUCUNE
// décision du serveur ne lit :
//   · totalHorsTailleDeSet  (ex-totalInvalidable) — renommé, toujours non branché
//   · setCodeResolution     — 5 valeurs assignées (exact / convention-x / parente /
//                             mot-non-code / inconnu), jamais relues
//   · setCodeAccord         — calculé dans journal-scans.js, jamais relu
//   · rang                  — rang du numéro lu contre celui du gagnant, jamais relu
//                             (⚠️ `rangGagnant`, lui, EST consulté : index.js, rang 3)
//   · parenteRetenue        — la chaîne « code~codes » ; `parParente` est relu, elle non
//   · symboleSet            — consulté en UN seul endroit, `departagerParSymbole`, et
//                             uniquement pour départager une égalité parfaite
// Ne SONT PAS dans cette liste, et c'est délibéré : les copies journalisées d'une décision
// déjà prise (`identifieeEnLocal`, `margeConfortable`, `motifCible`, `symboleDepartage`,
// `reverseAnnuleeParTcgdex`, `voieCatalogue`, `raisonReserve`), qui sont des TRACES et non
// des signaux en attente ; l'instrumentation déclarée journal-only (`exAequoIds`,
// `vivierIds`, `vivierTaille`, `messageErreur`, `carteTcgdexId`, `variantsDetailed*`) ;
// et `fourchette`, consultée en aval — elle part dans la réponse HTTP à l'extension.
//
// ════════════════════════════════════════════════════════════════════════════
// CE QUE LE VETO PAR LE SYMBOLE COÛTERAIT — mesuré le 2026-08-18, NON BRANCHÉ
// ════════════════════════════════════════════════════════════════════════════
// Question posée : le symbole, aujourd'hui simple départage, devrait-il aussi INTERDIRE un
// gagnant dont le set contredit ce qui a été lu ? Sur les 143 lignes numérotées du banc,
// 46 sont mesurables (symbole fiable relevé + set du gagnant connu + un produit retenu).
// Le symbole CONFIRME le gagnant sur 29, le CONTREDIT sur 17. Et les 17 se séparent en deux
// populations qui ne valent pas la même chose :
//
//   gagnant DANS la table  ->  7 lignes : 1 juste · 4 fausses · 2 sans vérité
//   gagnant HORS table     -> 10 lignes : 7 justes · 1 fausse · 2 sans vérité
//
// ⚠️ LE VETO NON BORNÉ CASSE 8 LIGNES JUSTES POUR EN TOUCHER 5 FAUSSES : il est perdant.
// Et la cause n'est pas statistique, elle est structurelle — cette table ne couvre que
// 24 sets japonais vintage. Un Mewtwo d'Evolutions dont l'IA lit « eclair » ne contredit
// rien : la table est MUETTE sur son set. C'est le premier principe, appliqué à un index
// partiel — « je ne sais pas » n'est pas « je sais que non ». Un veto ne peut donc porter
// que sur les lignes dont le gagnant est LUI AUSSI dans la table.
// ⚠️ ET MÊME BORNÉ, IL N'EST PAS GRATUIT : il casserait Light Togetic (« etoile » lu, N1,
// vérité N4), et très probablement Golem n°122 (« e5 » lu, gagnant EC1) — dont le total
// 128 est exactement le corps d'EC1, ce qui met trois signaux contre le symbole. Le
// symbole se trompe aussi, et sur les e-Card il confond les chiffres.
//
// LA BORNE EST LA TABLE CLOSE, PAS LE VOCABULAIRE. Le découpage série e / hors série e a
// été fait : 2 lignes seulement lisent un symbole e, on n'en conclut rien. Exclure la
// série e reste une PRÉCAUTION GRATUITE — ça ne change pas l'échange, ça retire seulement
// Golem des indécidables — mais ce n'est pas elle qui rend le veto acceptable.
//
// ════════════════════════════════════════════════════════════════════════════
// LA RÈGLE DE DÉCISION, ÉCRITE AVANT LES CHIFFRES QUI LA DÉCLENCHERONT
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ ELLE EST ÉCRITE MAINTENANT PARCE QU'UNE RÈGLE ÉCRITE APRÈS SE RENÉGOCIE. Le veto a
// été refusé sur un échange de 4 contre 1 mesuré sur 6 lignes — exactement le motif qui
// avait fait refuser la promotion de `perimetre-vintage-suggestion` sur un 4/4. La
// discipline ne doit pas dépendre de qui propose la règle.
//
// POPULATION D'ÉVALUATION, et rien d'autre :
//   symbole relevé ET `symboleFiable: true`  ·  gagnant dans un set DE CETTE TABLE
//   ·  ligne portant une vérité INDIVIDUELLE (les « en bloc » ne peuvent ni confirmer
//      ni infirmer : leur vérité est ce qu'on mesure)
// Les indécidables sont comptés et affichés, jamais convertis en l'un ou l'autre camp.
//
// ON BRANCHE QUAND LES TROIS SONT VRAIES :
//   1. N ≥ 12 lignes DÉCIDABLES dans cette population.
//      12 n'est pas un chiffre rond : c'est le premier effectif où, à l'échange observé
//      aujourd'hui (4 corrigées pour 1 cassée), les deux intervalles de Wilson à 95 %
//      cessent de se recouvrir — 10/12 -> [55,2 % ; 95,3 %] contre 2/12 -> [4,7 % ;
//      44,8 %]. À 10 lignes ils se recouvrent encore.
//   2. LES DEUX INTERVALLES DE WILSON À 95 % NE SE RECOUVRENT PAS : borne basse du taux
//      de correction > borne haute du taux de casse. Aujourd'hui, sur 5 décidables, ils
//      se recouvrent sur 24,9 points.
//   3. AUCUNE DES LIGNES CASSÉES N'EST DANS LE HOLDOUT. Casser une ligne fraîche coûte
//      le seul seau qui décide ; une casse en entraînement ou en lot se paie en mesure,
//      pas en pouvoir de décision.
//      ⚠️ AUJOURD'HUI CETTE CLAUSE EST SATISFAITE PAR VACUITÉ, ET CE N'EST PAS LA MÊME
//      CHOSE QUE SATISFAITE. Le holdout ne porte que 2 vérités individuelles : aucune
//      de ses lignes ne peut être comptée « cassée », faute de quoi la comparer. La
//      clause ne mordra qu'une fois les 27 fiches saisies. Lire « 0 casse en holdout »
//      comme un feu vert serait relire une absence comme une valeur contraire —
//      exactement l'erreur d'instrument que ce chantier passe son temps à fermer.
//
// ET AUCUN CHAMP NOUVEAU N'EST NÉCESSAIRE POUR Y ARRIVER. `symboleSet` et
// `codeSetGagnant` sont déjà journalisés : l'effet du veto se recalcule après coup, sur
// chaque nouveau lot, sans rien brancher. C'est le même argument qui fait supprimer
// `setCodeAccord` — un dérivé recalculable n'a pas besoin d'être stocké, et un veto
// mesurable après coup n'a pas besoin d'être branché pour être mesuré.
// RIEN N'EST BRANCHÉ. Les deux chiffres décident ensemble, et ils disent : pas encore.
//
// ════════════════════════════════════════════════════════════════════════════
// LES PRÉFIXES ALPHABÉTIQUES — un problème de 71 000 produits, pas de vintage japonais
// ════════════════════════════════════════════════════════════════════════════
// 1 936 produits du catalogue (28 préfixes distincts : S, TG, SV, GG, H…) portent un
// numéro à préfixe alphabétique et sont donc HORS D'ATTEINTE du chemin `local-nom-numero`,
// qui filtre par égalité stricte du numéro. L'IA lit « 007 », le catalogue porte « S07 » :
// le bon candidat est écarté AVANT tout scoring, en silence. Le cas Bayleef en est un, la
// classe est bien plus large — et elle n'a rien de japonais ni de vintage.
//
// ============================================================
// LA TABLE CLOSE DES SETS JAPONAIS VINTAGE (1996-2003)
// ============================================================
// ⚠️ ÉCRITE À LA MAIN, ET C'EST LE SEUL GESTE CORRECT. La liaison automatique a été
// tentée et mesurée : les 177 sets de /v2/ja/sets contre nos slugs donnent 2 appariements
// sur 177 (1,1 %), et LES DEUX SONT FAUX. La raison est structurelle — TCGdex nomme ses
// sets japonais en japonais (« 裂けた大地 »), nos slugs Cardmarket sont anglais
// (« Split-Earth »). Les deux côtés ne partagent aucune langue. Vingt lignes vérifiées
// valent mieux que cent soixante-dix-sept devinées.
//
// POURQUOI CETTE TABLE EXISTE. Mesuré : 69 identifiants TCGdex sont partagés par
// plusieurs expansions Cardmarket, et le motif est systématique — chaque set japonais
// partage son identifiant avec son jumeau occidental :
//   neo4 -> N4 [jap] + NDE [occ]        gym1 -> G1 [jap] + GH [occ]
//   base5 -> ROG [jap] + TR [occ]       ecard3 -> EC4 [jap] + EC5 [jap] + SK [occ]
// Le pont japonais n'est pas incomplet : il est FAUX PAR CONSTRUCTION sur toute la
// période vintage. Le Rhydon rendu « m3 » (set de 2025) était le premier symptôme visible,
// pas une exception.
//
// RÈGLE D'ADMISSION, SANS EXCEPTION. Une ligne n'entre que si :
//   1. son `slugSet` existe EXACTEMENT dans numeros_cartes ;
//   2. il ne désigne qu'UNE expansion ;
//   3. la région lue dans codes_set est « japonais » — pas inconnue, pas occidentale.
//   4. son `slugSet` désigne UN SEUL SET ATTESTÉ chez la source qui le date. Si la source
//      en liste PLUSIEURS pour ce slug — séries, tirages, rééditions — la ligne part dans
//      SETS_NON_PROUVES en NOMMANT le nombre de sets listés et la source.
//      ⚠️ L'ABSENCE de source n'est pas un échec de ce critère : c'est un échec du 3.
//         Les deux ne se confondent pas. « Je ne sais pas d'où elle vient » et « je sais
//         qu'elle en désigne trois » sont deux refus différents, et seul le second peut
//         être levé en choisissant laquelle des trois.
//
//   4 bis. LA CLAUSE BORNÉE — un slug FUSIONNÉ peut entrer, à une condition stricte.
//         Un `slugSet` dont la source atteste qu'il recouvre PLUSIEURS sets entre À
//         CONDITION DE NE DÉCLARER AUCUN ATTRIBUT PAR-SET, et la fusion est NOMMÉE sur
//         la ligne :
//              symbole: null · symboleFiable: null · annee: null
//              fusion: 'recouvre N séries (…) selon <source>'
//         La ligne sert alors le PÉRIMÈTRE (`EXPANSIONS_VINTAGE`) et la GARDE DU setCode
//         (`setCodeCompatibleVintage`), et JAMAIS le départage par le symbole.
//
//         POURQUOI C'EST BORNÉ AINSI, ET PAS AUTREMENT. Relevé sur tout le dépôt : le
//         CODE ne lit que quatre champs de cette table. `exp` et `code` sont des attributs
//         de l'EXPANSION — ils restent EXACTS sur une ligne fusionnée (les trois séries
//         d'EXS sont japonaises, vintage, sous un seul code Cardmarket). `symbole` et
//         `symboleFiable` sont les seuls attributs PAR-SET, et ce sont les seuls que la
//         fusion abîme. `nom` n'apparaît que dans une chaîne de `raison` ; `annee`,
//         `slug`, `prod` et `regionSource` ne sont lus par AUCUNE décision. La clause
//         neutralise donc exactement la colonne endommagée, et rien de plus.
//         Les verrous 2 et 4 de `departagerParSymbole` la rendent inerte sans code neuf :
//         `symbole: null` n'est jamais une correspondance.
//
//         ⚠️ CE QUE LA CLAUSE NE FAIT PAS. Elle ne dit PAS qu'une fusion est sans
//         importance : elle dit que son dommage est LOCALISÉ et qu'on refuse de le
//         déclarer. Une ligne fusionnée est une ligne AMPUTÉE, pas une ligne normale.
//
//         LES TROIS GARDE-FOUS, sans lesquels cette clause serait une renégociation :
//         (a) ÉCRITE AVANT LA RÉPONSE DE LA SOURCE. Au 2026-09-06, on ne sait pas encore
//             si les trois séries d'Expansion Sheet portent des symboles différents. La
//             clause est écrite AVANT de le savoir, et elle est ROBUSTE à la réponse :
//             les attributs par-set sont nuls dans tous les cas. Une règle écrite après
//             le résultat se renégocie ; celle-ci ne le peut pas.
//         (b) COÛT MESURÉ SUR LES 24 AVANT APPLICATION. Fait le 2026-09-06 : la clause
//             est STRICTEMENT ADDITIVE — elle admet un cas jusque-là refusé, elle ne
//             retire rien. Aucune des 24 ne déclare de fusion, donc aucune n'entre dans
//             son champ, et aucune ne peut devenir inéligible par son effet.
//             Rejeu du banc avec 3781 admise SOUS CETTE CLAUSE (ligne complète, code EXS
//             dans CODES_VINTAGE, attributs par-set nuls) : 63 justes · 8 faux · 0 FAUX
//             ET AFFIRMÉ · 17 refus — IDENTIQUE à la référence, zéro verdict changé.
//             Vivier de la route 75/89 -> 81/89 (84,3 % -> 91,0 %), absences 14 -> 8,
//             top 3 des présentes 97,1 %, TOP 3 DES LIGNES SOUS RÉSERVE 100 % (43/43).
//         (c) ELLE NE REND PAS 4170 ADMISSIBLE. « Unnumbered Promos » échoue au critère
//             3 — `codes_set.region` est ABSENTE — et aucune clause sur la fusion ne
//             fabrique une attestation de région. Une clause qui lève un critère ne lève
//             que celui-là.
// Tout le reste part dans SETS_NON_PROUVES, en bas de ce fichier. Le plausible-et-faux
// est le mode d'échec de ce projet depuis le début ; une table de 23 lignes sûres vaut
// mieux qu'une de 27 dont 4 sont vraisemblables.
//
// ── POURQUOI LE CRITÈRE 4 EST ÉCRIT LE 2026-09-06, ET PAS AVANT ─────────────────────
// Il était DÉJÀ APPLIQUÉ, mais nulle part. `Expansion-Sheet` (exp 3781, code EXS) remplit
// les critères 1, 2 et 3 — slug unique, une seule expansion, `codes_set.region` = japonais
// — et elle est pourtant en bas de ce fichier avec « trois séries chez pokesymbols, un
// seul slug en base ». Ce motif n'était écrit dans aucune règle. Les trois premiers
// critères vérifient tous le côté BASE ; AUCUN ne vérifiait que le slug désigne un seul
// set RÉEL. Un critère non écrit qui refuse une ligne n'est pas une règle, c'est une
// décision au cas par cas — et une décision au cas par cas ne se relit pas.
//
// CE QUE ÇA COÛTE RÉTROACTIVEMENT AUX 24 : rien de mesurable. La question « la source
// liste-t-elle plusieurs sets ? » ne se rejoue pas en base (pokesymbols n'y est pas), mais
// les TROIS SYMPTÔMES que ce défaut y laisse ont été mesurés le 2026-09-06, et ils sont
// propres :
//   · expansions portant PLUSIEURS `slugSet` ..................... 0 / 24
//   · expansions portant PLUSIEURS `setTcgdex` ................... 0 / 24
//   · lignes dont `prod` ne colle plus au catalogue ............... 0 / 24
//     (les 24 comptes de produits sont exacts AU PRODUIT PRÈS — ces lignes ont bien été
//      vérifiées une par une, et le fichier ne le dit pas seulement, il le prouve)
// ⚠️ Ce n'est pas la preuve qu'aucune des 24 n'échouerait chez la source : c'est la preuve
// qu'aucune n'en porte le symptôme. Le critère 4 n'est donc PAS une exception rétroactive.
// Et le critère 3 non plus : vérifié le 2026-09-06, les 24 portent `region: 'japonais'`
// dans codes_set, 24 sur 24, sans exception.
//
// ── DEUX DETTES, CONSTATÉES LE 2026-09-06, NON CORRIGÉES CE JOUR ────────────────────
// 1. LE COMMENTAIRE D'`IPB` CI-DESSOUS EST PÉRIMÉ. Il dit « codes_set dit INCONNUE
//    (regionSource 'nom-hors-catalogue') ». C'est faux aujourd'hui : codes_set porte
//    `region: 'japonais'`, `regionSource:
//    'sources-multiples-concordantes-rapportees-par-testeur'`. Quelqu'un a attesté, la
//    provenance a été écrite, la base l'a enregistrée. ⚠️ Le commentaire est laissé tel
//    quel pour l'instant PARCE QUE le corriger effacerait la trace du moment où on ne
//    savait pas — mais il ne doit plus servir d'exemple d'un état de la base.
//    🔑 ET C'EST LE CHEMIN DE SORTIE POUR LES LIGNES REFUSÉES AU CRITÈRE 3 : il existe,
//    il a déjà servi proprement une fois.
// 2. L'EN-TÊTE DE LA TABLE PROMET « (1996-2003) » ET LA TABLE NE LE TIENT PAS.
//    `DP5c` « Cry from the Mysterious » est de 2007. Elle remplit les quatre critères ;
//    c'est le TITRE qui annonce une période qui n'est pas un critère d'admission. Nul ne
//    doit s'appuyer sur « 1996-2003 » comme sur une garantie : ce n'en est pas une.
//
// ⚠️ AUCUNE DÉCISION DE PRODUCTION NE CHANGE ICI, DONC LA RÈGLE DE SYMÉTRIE NE S'APPLIQUE
// PAS : ce bloc est une règle écrite, pas un branchement. Aucune ligne n'est ajoutée à la
// table, `EXPANSIONS_VINTAGE` est inchangée, le banc rend exactement les mêmes chiffres.
//
// SOURCES, une par colonne :
//   nom + année : pokesymbols.com/tcg/japanese-sets (liste datée, noms anglais canoniques)
//   slug + expansion + nb de produits : notre base, vérifiés un par un
//   région + sa provenance : codes_set.region / codes_set.regionSource
//
// ⚠️ CE FICHIER NE PILOTE PAS ENCORE L'IDENTIFICATION. Il ne sert, pour l'instant, qu'à la
// règle d'ambiguïté des identifiants partagés. Le périmètre fermé viendra APRÈS validation
// ligne à ligne.

// ============================================================
// LE SYMBOLE DE SET — relevé, journalisé, SANS AUCUN EFFET
// ============================================================
// ⚠️ IL NE MARQUE AUCUN POINT ET N'ENTRE DANS AUCUNE DÉCISION. Il est là pour être MESURÉ
// sur de vrais scans : le modèle sait-il lire ces dessins de quelques millimètres sur une
// photo d'annonce prise au téléphone ? Tant qu'on ne le sait pas, un symbole qui marque
// des points n'est qu'une hallucination avec un coefficient. Même discipline que pour les
// motifs de reverse, qui a marché.
//
// DEUX HYPOTHÈSES QUE J'AVAIS FAITES ÉTAIENT FAUSSES, et le relevé du testeur les corrige :
//   - je supposais « aucun symbole » sur les plus anciennes (PJU, MFO, ROG) : faux, elles
//     en ont chacune un, et très différents — feuilles, fossile, R.
//   - je supposais que les cinq e-Card partageaient un symbole : faux, c'est le même
//     cercle avec le CHIFFRE du set dedans. EC1 à EC5 sont donc discriminables ENTRE EUX,
//     ce qui vaut bien mieux qu'une classe unique.
// La deuxième erreur allait dans le sens de la prudence, la première dans l'autre : j'avais
// bâti une classe « aucun » qui aurait fait échouer la lecture sur trois sets.
//
// `symboleFiable: false` marque les COLLISIONS relevées — deux sets de la table portant le
// même dessin. Le symbole n'y départage rien et ne devra jamais y marquer de point :
//   logo-tcg -> EXP (1996) et WEB (2001)
//   gym ......-> G1 et G2
// Note pour plus tard : toutes les lignes promo japonaises partagent la même étoile PROMO.
// Le symbole ne les séparera jamais entre elles.
//
// `symbole: null` ≠ `symbole: 'aucun'`. null = NON RELEVÉ, absence de donnée. 'aucun' =
// relevé, et il n'y a rien à cet emplacement. Confondre les deux serait refaire, dans une
// table neuve, le défaut qu'on passe ce chantier à corriger.
const SETS_VINTAGE_JAPONAIS = [
    // nom anglais canonique          année  slugSet                            exp    code     prod  source de la région
    { nom: 'Expansion Pack', annee: 1996, slug: 'Expansion-Pack', exp: 4169, code: 'EXP', prod: 102, regionSource: 'liste-verifiee', symbole: 'logo-tcg', symboleFiable: false },
    { nom: 'Pokémon Jungle', annee: 1997, slug: 'Pokemon-Jungle', exp: 4463, code: 'PJU', prod: 48, regionSource: 'place-internationale-prise-par-JU', symbole: 'feuilles', symboleFiable: true },
    { nom: 'Mystery of the Fossils', annee: 1997, slug: 'Mystery-of-the-Fossils', exp: 4464, code: 'MFO', prod: 48, regionSource: 'place-internationale-prise-par-FO', symbole: 'fossile', symboleFiable: true },
    { nom: 'Rocket Gang', annee: 1997, slug: 'Rocket-Gang', exp: 4465, code: 'ROG', prod: 65, regionSource: 'place-internationale-prise-par-TR', symbole: 'R', symboleFiable: true },
    { nom: "Leaders' Stadium", annee: 1998, slug: 'Leaders-Stadium', exp: 4466, code: 'G1', prod: 96, regionSource: 'place-internationale-prise-par-GH', symbole: 'gym', symboleFiable: false },
    { nom: 'Challenge from the Darkness', annee: 1999, slug: 'Challenge-from-the-Darkness', exp: 4467, code: 'G2', prod: 98, regionSource: 'place-internationale-prise-par-GC', symbole: 'gym', symboleFiable: false },
    { nom: 'Southern Islands', annee: 1999, slug: 'Southern-Islands-JP', exp: 4357, code: 'SI-JP', prod: 18, regionSource: 'code-suffixe-JP', symbole: 'palmier', symboleFiable: true },
    { nom: 'Gold, Silver, to a New World...', annee: 2000, slug: 'Gold-Silver-to-a-New-World', exp: 4506, code: 'N1', prod: 96, regionSource: 'place-internationale-prise-par-NG', symbole: 'etoile', symboleFiable: true },
    { nom: 'Crossing the Ruins...', annee: 2000, slug: 'Crossing-the-Ruins', exp: 4507, code: 'N2', prod: 57, regionSource: 'place-internationale-prise-par-NDI', symbole: 'ruines', symboleFiable: true },
    { nom: 'Awakening Legends', annee: 2000, slug: 'Awakening-Legends', exp: 4508, code: 'N3', prod: 57, regionSource: 'place-internationale-prise-par-NR', symbole: 'couronne', symboleFiable: true },
    { nom: 'Darkness, and to Light...', annee: 2001, slug: 'Darkness-and-to-Light', exp: 4509, code: 'N4', prod: 113, regionSource: 'place-internationale-prise-par-NDE', symbole: 'eclair', symboleFiable: true },
    { nom: 'Pokémon VS', annee: 2001, slug: 'Pokemon-CardVS', exp: 4168, code: 'VS', prod: 151, regionSource: 'liste-verifiee', symbole: 'vs', symboleFiable: true },
    { nom: 'Pokémon Card web', annee: 2001, slug: 'Pokemon-Cardweb', exp: 4355, code: 'WEB', prod: 48, regionSource: 'liste-verifiee', symbole: 'logo-tcg', symboleFiable: false },
    { nom: 'Base Expansion Pack', annee: 2001, slug: 'Base-Expansion-Pack', exp: 5021, code: 'EC1', prod: 157, regionSource: 'liste-verifiee', symbole: 'e1', symboleFiable: true },
    { nom: 'The Town on No Map', annee: 2002, slug: 'The-Town-on-No-Map', exp: 5022, code: 'EC2', prod: 92, regionSource: 'liste-verifiee', symbole: 'e2', symboleFiable: true },
    { nom: 'Wind from the Sea', annee: 2002, slug: 'Wind-from-the-Sea', exp: 5023, code: 'EC3', prod: 90, regionSource: 'liste-verifiee', symbole: 'e3', symboleFiable: true },
    { nom: 'Split Earth', annee: 2002, slug: 'Split-Earth', exp: 5024, code: 'EC4', prod: 91, regionSource: 'liste-verifiee', symbole: 'e4', symboleFiable: true },
    { nom: 'Mysterious Mountains', annee: 2002, slug: 'Mysterious-Mountains', exp: 5025, code: 'EC5', prod: 91, regionSource: 'liste-verifiee', symbole: 'e5', symboleFiable: true },
    { nom: 'Miracle of the Desert', annee: 2003, slug: 'Miracle-of-the-Desert', exp: 5873, code: 'ADV2', prod: 53, regionSource: 'liste-verifiee', symbole: 'empreintes', symboleFiable: true },
    { nom: 'Rulers of the Heavens', annee: 2003, slug: 'Rulers-of-the-Heavens', exp: 5872, code: 'ADV3', prod: 54, regionSource: 'liste-verifiee', symbole: 'croix', symboleFiable: true },
    { nom: 'Magma VS Aqua: Two Ambitions', annee: 2003, slug: 'Magma-VS-Aqua-Two-Ambitions', exp: 5869, code: 'ADVex1', prod: 80, regionSource: 'code-minuscule', symbole: null, symboleFiable: null },
    // ⚠️ RÉGION NON VÉRIFIÉE PAR MOI. codes_set dit INCONNUE (regionSource 'nom-hors-catalogue') :
    // le nom de l'expansion n'existe pas au catalogue international, donc la dérivation ne
    // conclut rien. L'attestation vient de chartmon.com/pokemon/jp/sets, qui date ce set de
    // 1999 dans l'ère japonaise — RAPPORTÉE PAR LE TESTEUR : ma propre requête sur cette page
    // a reçu un HTTP 403, je n'ai donc pas pu la vérifier moi-même. La provenance est écrite
    // ici pour que ce soit relisible, pas pour faire croire à une vérification.
    { nom: 'Intro Pack (Bulbasaur)', annee: 1999, slug: 'Intro-Pack-Bulbasaur', exp: 5059, code: 'IPB', prod: 41, regionSource: 'chartmon-rapporte-par-testeur', symbole: 'cercle-chiffre', symboleFiable: true },
    // Hors de la liste pokesymbols mais exigés par le banc : promo et sets dérivés japonais
    // dont la région est établie et le slug unique.
    { nom: "McDonald's Original Minimum Pack", annee: 2002, slug: 'McDonalds-Original-Minimum-Pack', exp: 4178, code: 'MCDP', prod: 24, regionSource: 'liste-verifiee', symbole: 'mcdo', symboleFiable: true },
    { nom: 'Cry from the Mysterious', annee: 2007, slug: 'Cry-from-the-Mysterious', exp: 4305, code: 'DP5c', prod: 65, regionSource: 'code-minuscule', symbole: null, symboleFiable: null },
    // ════════════════════════════════════════════════════════════════════════
    // LA SEULE LIGNE FUSIONNÉE — admise le 2026-09-06 sous le CRITÈRE 4 bis
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ ELLE N'EST PAS UNE LIGNE COMME LES AUTRES : c'est une ligne AMPUTÉE. Les deux
    // sources se contredisent, et les deux ont raison de leur côté —
    //   · CARDMARKET (la source de nos idExpansion) : UNE expansion « Expansion Sheet »,
    //     fil d'Ariane unique, tous les produits sous le code EXS. Rien à résoudre.
    //   · POKESYMBOLS : TROIS séries réelles — Expansion Sheet 1 (blue), 2 (red),
    //     3 (green). Le slug en recouvre donc trois.
    // Le critère 4 la refusait entière ; le critère 4 bis la fait entrer SANS AUCUN
    // attribut par-set. `exp` et `code` sont des attributs de l'EXPANSION et restent
    // exacts ; `symbole`, `symboleFiable` et `annee` sont NULS ET LE RESTENT.
    //
    // 🔑 ET C'EST DÉLIBÉRÉ MÊME AVEC UNE RÉPONSE FAVORABLE. Vignettes relevées à la main
    // par le testeur le 2026-09-06 : LES TROIS SÉRIES PORTENT LE MÊME SYMBOLE, une
    // pokéball. La fusion n'abîmerait donc PAS la colonne — un symbole lu désignerait
    // l'expansion entière. On ne le déclare pas pour autant : la clause interdit tout
    // attribut par-set sur une ligne fusionnée, et c'est la RÈGLE qui protège, pas le
    // fait qu'elle tombe bien cette fois-ci. Une règle qu'on suspend quand le résultat
    // arrange n'a jamais protégé personne.
    // ⚠️ ET LE SYMBOLE NE DÉPARTAGERAIT RIEN À L'INTÉRIEUR D'EXS DE TOUTE FAÇON : la
    // pokéball est commune à TOUTE la série Vending (fait connu du testeur). Déclarée,
    // elle serait au mieux `symboleFiable: false` — même statut que `gym` et `logo-tcg`.
    // Vérifié le 2026-09-06 : « pokeball » n'entre en collision avec AUCUN des 20 symboles
    // déjà déclarés, et aucune ligne de SETS_NON_PROUVES ne déclare de symbole. La valeur
    // est libre — elle reste libre.
    //
    // CE QUE SON ADMISSION A COÛTÉ, mesuré AVANT (rejeu du banc, clause simulée en
    // mémoire) : banc 63 justes · 8 faux · 0 FAUX ET AFFIRMÉ · 17 refus — IDENTIQUE à la
    // référence, zéro verdict changé. Vivier de la route 75/89 -> 81/89 (84,3 % -> 91,0 %),
    // absences 14 -> 8, top 3 des présentes 97,1 %, TOP 3 DES LIGNES SOUS RÉSERVE 100 %.
    // Elle n'achète aucun juste : elle rend 6 vérités CANDIDATES, et ne coûte rien.
    {
        nom: 'Expansion Sheet', annee: null, slug: 'Expansion-Sheet', exp: 3781, code: 'EXS',
        prod: 125, regionSource: 'place-internationale-prise-par-MEW',
        symbole: null, symboleFiable: null,
        // ⚠️ LE CHAMP QUI REND LA LIGNE RELISIBLE. Aucun code ne le lit ; il existe pour
        // qu'on ne redécouvre pas dans six mois que cette ligne n'est pas atomique.
        fusion: 'recouvre 3 séries — Expansion Sheet 1 (blue) / 2 (red) / 3 (green) — '
            + 'Cardmarket n\'expose qu\'UNE expansion (code EXS, 125 produits), pokesymbols '
            + 'en liste TROIS ; les trois portent le MÊME symbole (pokéball, commune à toute '
            + 'la série Vending). Admise sous le critère 4 bis, attributs par-set nuls.'
    }
];

// ============================================================
// LES NON PROUVÉES — elles n'entrent pas, et on dit pourquoi
// ============================================================
// Aucune de ces lignes ne doit être ajoutée sans une preuve NOUVELLE. Les recopier telles
// quelles dans la table ci-dessus reviendrait à faire exactement ce que la règle
// d'admission interdit.
const SETS_NON_PROUVES = [
    {
        nom: 'ADV Expansion Pack', slug: null, code: 'ADV1', prod: null,
        // Le refus tient, mais pour une raison MEILLEURE que celle que j'avais donnée. Ce
        // n'était pas une ambiguïté d'homonyme tranchable par l'année : il n'y a
        // simplement AUCUNE expansion cible. Relevé : la base contient douze expansions à
        // code ADV (advD à advJ, ADV2, ADV3, ADV4, ADVex1, ADV-P), et pas une seule ne
        // correspond à l'ADV Expansion Pack de 2003. Une date n'aide pas à choisir entre
        // zéro candidat.
        preuveManquante: 'aucune expansion ADV1 en base — IMPASSE, pas ambiguïté'
    },
    // ✅ SORTIE DE CETTE LISTE LE 2026-09-06 — `Expansion Sheet` (EXS, exp 3781) est
    // ADMISE, sous le critère 4 bis, avec tous ses attributs par-set nuls. Sa ligne est
    // en bas de SETS_VINTAGE_JAPONAIS et porte le champ `fusion`. L'entrée ci-dessous est
    // CONSERVÉE, commentée, parce qu'elle porte l'histoire du refus — et qu'un refus levé
    // sans trace se relit comme s'il n'avait jamais existé.
    /*
    {
        nom: 'Expansion Sheet (Vending Machine, séries 1 à 3)', slug: 'Expansion-Sheet', code: 'EXS', prod: null,
        // pokesymbols en liste TROIS (bleue 1998, rouge 1998, verte 1998), la base n'a
        // qu'un slug. On ne sait pas lequel des trois il désigne, ni s'il les fusionne.
        //
        // ⚠️ 2026-09-06 — ELLE ÉCHOUE AU CRITÈRE 4, ET À LUI SEUL. Mesuré : critère 1 ✅
        // (slug exact), 2 ✅ (`Expansion-Sheet` -> [3781] et rien d'autre), 3 ✅
        // (`codes_set.region` = japonais, source 'place-internationale-prise-par-MEW').
        // C'est le premier refus qui repose sur le critère 4 depuis qu'il est écrit, et
        // c'est lui qui a fait l'écrire.
        //
        // CE QUE LA BASE PEUT DIRE, ET CE QU'ELLE NE PEUT PAS. Le test décisif espéré —
        // « plusieurs produits portent le MÊME numéro, donc l'expansion fusionne des
        // séries » — EST INAPPLICABLE ICI : sur les 125 lignes de numeros_cartes de 3781,
        // `numero` est non nul 0 FOIS, `numeroUrl` 0 fois. Il n'y a aucun numéro à
        // comparer. La base ne peut ni confirmer ni infirmer la fusion : SEULE UNE
        // ATTESTATION TRANCHE. (125 produits pour trois séries de sheets est compatible
        // avec la fusion comme avec une série unique ; un compte n'est pas une preuve.)
        //
        // 🔑 CE QU'IL FAUT VÉRIFIER, ET OÙ — dans cet ordre, la première réponse décide :
        //   a) CARDMARKET, la source de nos idExpansion : la page « Expansion Sheet »
        //      japonaise est-elle UNE expansion, ou Cardmarket en liste-t-il trois
        //      (bleue / rouge / verte) ? C'est la seule source qui parle le même langage
        //      que 3781. Si Cardmarket n'en a qu'une ET qu'elle contient les trois séries,
        //      le slug FUSIONNE -> elle reste dehors, le critère a fait son travail.
        //   b) pokesymbols.com/tcg/japanese-sets : combien de lignes « Expansion Sheet ».
        //      C'est la source du refus d'origine, elle dit TROIS. À reconfirmer, pas à
        //      croire sur parole d'un commentaire écrit ici il y a des semaines.
        //   c) Si (a) et (b) se contredisent, c'est (a) qui décide POUR NOTRE TABLE : nos
        //      expansions sont des identifiants Cardmarket, pas des sets du monde.
        //
        // ⚠️ ET SI ELLE ENTRAIT : mesuré le 2026-09-06, périmètre élargi EN MÉMOIRE, banc
        // rejoué. 3781 SEULE ne change AUCUN verdict (63 justes · 8 faux · 0 faux et
        // affirmé · 17 refus, identiques à la référence ; 60 lignes de sortie diffèrent,
        // toutes des comptes de candidats). Elle rend 6 vérités CANDIDATES : vivier de la
        // route 75/89 -> 81/89, absences 14 -> 8, et le top 3 des lignes SOUS RÉSERVE
        // reste à 100 % (43/43). Gain sans contrepartie mesurée — ET CE N'EST PAS UNE
        // RAISON DE L'ADMETTRE. Une mesure ne remplace pas une attestation ; c'est
        // exactement l'échange que la règle d'admission refuse depuis le premier jour.
        preuveManquante: 'CRITÈRE 4 : trois séries chez pokesymbols, un seul slug en base — attestation Cardmarket requise'
    },
    */
    {
        nom: 'Gym Booster 1 (Grass Deck) et 2 (Psychic Deck)', slug: null, code: null, prod: null,
        // IMPASSE CONNUE, et c'est une information utile : aucune expansion cible
        // n'existe. Une carte de ces sets doit se refuser PROPREMENT — surtout pas
        // retomber sur une recherche dans le catalogue entier, qui rendrait un homonyme
        // occidental avec l'assurance d'une réponse.
        preuveManquante: 'aucun slug en base — IMPASSE CONNUE, refus propre attendu'
    }
];

// Index par expansion, pour les tests d'appartenance. Seules les lignes dont l'expansion
// est VÉRIFIÉE y figurent : une ligne à `exp: null` est prouvée comme set mais son
// expansion reste à relever, elle ne peut donc pas servir de périmètre.
const EXPANSIONS_VINTAGE = new Set(SETS_VINTAGE_JAPONAIS.filter(s => s.exp != null).map(s => s.exp));
const CODES_VINTAGE = new Set(SETS_VINTAGE_JAPONAIS.map(s => s.code));

/**
 * LE setCode LU CONTREDIT-IL L'HYPOTHÈSE VINTAGE ?
 *
 * POURQUOI CETTE GARDE EXISTE, ET CE QU'ELLE A COÛTÉ DE MESURER. Élargir le périmètre aux
 * scans « sans expansion attendue » rapporte 7 lignes justes, mais en fait basculer 5 qui
 * l'étaient — et les cinq sont de la même famille : des cartes dont l'IA a LU un setCode
 * qui désigne un set moderne. `M-P`, `S-P`, `BW-P`, `PROMO`, `CLK`. Trois Pikachu promo, un
 * Meowth BW, un Wartortle Classic Collection. Le périmètre les tirait de force dans le
 * vintage, où elles n'ont rien à faire, et remplaçait une bonne réponse par un ADV2 à
 * 30 points.
 *
 * LA RÈGLE : un setCode lu qui ne correspond à AUCUN set de la table close est une preuve
 * que la carte n'est pas vintage. Pas d'absence de preuve — une preuve. C'est la même
 * logique que l'invalidation par le setCode ailleurs : ce qui disqualifie une piste est une
 * information, pas un silence.
 * À l'inverse, l'ABSENCE de setCode ne contredit rien : le périmètre reste armé.
 *
 * Mesuré sur les douze cas concernés : 7 gains préservés sur 7, 5 risques bloqués sur 5.
 *
 * L'alias E1..E5 -> EC1..EC5 et la parenté sont appliqués, sans quoi « e1 » (marquage
 * e-Reader), « MCD » (pour MCDP) et « DP5 » (pour DP5c) seraient tous rejetés à tort.
 *
 * @param {string|null} setCodeLu
 * @returns {{compatible: boolean, raison: string}}
 */
function setCodeCompatibleVintage(setCodeLu, scoring, codesReelsDuCatalogue = null) {
    const { normaliserCodeSet, ALIAS_CODES_LUS, codesApparentes, memeCodeParConventionX } = scoring;
    const brut = normaliserCodeSet(setCodeLu);
    if (!brut) return { compatible: true, raison: 'aucun setCode lu — rien ne contredit l\'hypothèse vintage' };
    const code = ALIAS_CODES_LUS.get(brut) || brut;
    const codes = SETS_VINTAGE_JAPONAIS.map(s => normaliserCodeSet(s.code));
    if (codes.includes(code)) return { compatible: true, raison: `« ${code} » est dans la table close` };
    const cousin = codes.find(c => memeCodeParConventionX(code, c) || codesApparentes(code, c));
    if (cousin) return { compatible: true, raison: `« ${code} » apparenté à « ${cousin} »` };

    // ── LE BRUIT N'EST PAS UNE CONTRADICTION ──────────────────────────────────
    // Quatrième principe (voir scoring.js) : une lecture ne fait preuve que si elle
    // désigne quelque chose de RÉEL. « M-P » ou « CLK » sont des sets existants et
    // modernes : ils prouvent que la carte n'est pas vintage. Un code qui ne résout vers
    // aucun set du catalogue est du bruit d'OCR, et le bruit se traite comme l'absence.
    // Mesuré : sans cette distinction, 1 scan sur 55 était bloqué à tort — un Furret dont
    // le gagnant est pourtant EC3, dans la table close, à cause d'un setCode lu « null ».
    if (Array.isArray(codesReelsDuCatalogue) && codesReelsDuCatalogue.length) {
        const reel = codesReelsDuCatalogue.includes(code)
            || codesReelsDuCatalogue.some(c => memeCodeParConventionX(code, c) || codesApparentes(code, c));
        if (!reel) {
            return { compatible: true, raison: `« ${code} » ne résout vers aucun set du catalogue — BRUIT, pas une contradiction` };
        }
    }
    return { compatible: false, raison: `« ${code} » désigne un set réel hors de la table close — la carte n'est PAS vintage` };
}

// ════════════════════════════════════════════════════════════════════════════
// DÉPARTAGE D'UNE ÉGALITÉ PARFAITE PAR LE SYMBOLE DU SET
// ════════════════════════════════════════════════════════════════════════════
// CE QU'IL FAIT, ET STRICTEMENT RIEN D'AUTRE : quand plusieurs candidats sont à ÉGALITÉ
// PARFAITE de score et qu'un seul d'entre eux appartient à un set dont le symbole DÉCLARÉ
// est celui que l'IA a lu, on retient celui-là. Aucun point n'est ajouté, aucun classement
// n'est modifié : le scoring reste exactement ce qu'il était. C'est un départage, pas un
// signal.
//
// POURQUOI SEULEMENT LÀ. Mesuré sur 25 scans réels avec vérités saisies à l'aveugle :
// l'IA rend une valeur DANS l'énumération fermée 16 fois sur 16 (zéro invention), se tait
// ou avoue « illisible » 52 % du temps, et sur les 7 lignes où elle se prononce et où la
// comparaison est possible, elle a raison 6 fois. Un signal qui se tait plus souvent qu'il
// ne se trompe est ce qu'il faut pour DÉPARTAGER — pas pour peser dans un score, où une
// erreur écarterait la bonne carte avec assurance.
//
// LES QUATRE VERROUS, chacun pour une raison mesurée :
//   1. RIEN SANS LECTURE EXPLICITE. Champ vide, « illisible » : aucun effet. Ne pas savoir
//      n'autorise pas à désigner (quatrième principe).
//   2. JAMAIS UN SYMBOLE MARQUÉ NON FIABLE. `symboleFiable: false` couvre « gym » (G1 et
//      G2 le partagent) et « logo-tcg » (EXP et WEB le partagent) : ces dessins ne
//      DÉSIGNENT rien, ils sont portés par plusieurs sets. Un symbole lu juste une fois ne
//      les rachète pas.
//   3. EXACTEMENT UN CANDIDAT. Zéro correspondance -> le symbole ne prouve rien ici. Deux
//      ou plus -> il ne départage pas, il faut se taire.
//   4. `symbole: null` N'EST PAS UNE CORRESPONDANCE. null = NON RELEVÉ, absence de donnée.
//      Un set dont on n'a pas relevé le symbole ne peut ni gagner ni perdre par lui.
//
// ⚠️ ET LA SORTIE RESTE UNE SUGGESTION AVERTIE. Un départage par un signal lu à 6 sur 7 ne
// fabrique pas un verdict affirmé. Ce qu'on gagne, c'est de transformer un REFUS en
// suggestion — jamais un refus en affirmation.
//
// @param {string|null} symboleLu    ce que l'IA a répondu dans `symboleSet`
// @param {{idProduct:number, codeSet:string|null}[]} exAequo  les candidats à égalité
// @param {object} scoring           le module scoring ENTIER (jamais un extrait — voir index.js)
// @returns {{gagnant: object|null, raison: string}}
function departagerParSymbole(symboleLu, exAequo, scoring) {
    const { normaliserCodeSet } = scoring;
    const lu = String(symboleLu ?? '').trim();
    if (!lu || lu.toLowerCase() === 'illisible') {
        return { gagnant: null, raison: 'aucun symbole lu — rien à départager' };
    }
    // La table, indexée par code de set normalisé.
    const parCode = new Map();
    for (const s of SETS_VINTAGE_JAPONAIS) parCode.set(normaliserCodeSet(s.code), s);

    const correspondants = exAequo.filter(c => {
        const s = parCode.get(normaliserCodeSet(c.codeSet));
        if (!s) return false;                    // set hors table close : rien de déclaré
        if (s.symbole == null) return false;     // verrou 4 : non relevé n'est pas égal
        if (s.symboleFiable === false) return false; // verrou 2 : porté par plusieurs sets
        return s.symbole === lu;
    });

    if (correspondants.length === 1) {
        const g = correspondants[0];
        const s = parCode.get(normaliserCodeSet(g.codeSet));
        return { gagnant: g, raison: `symbole « ${lu} » lu, et « ${g.codeSet} » (${s.nom}) est le SEUL ex aequo à le porter` };
    }
    if (correspondants.length === 0) {
        return { gagnant: null, raison: `symbole « ${lu} » lu, mais aucun ex aequo ne le porte (ou il est marqué non fiable) — il ne prouve rien ici` };
    }
    return {
        gagnant: null,
        raison: `symbole « ${lu} » lu, mais ${correspondants.length} ex aequo le portent (${correspondants.map(c => c.codeSet).join(', ')}) — il ne départage pas`
    };
}

module.exports = {
    SETS_VINTAGE_JAPONAIS, SETS_NON_PROUVES,
    EXPANSIONS_VINTAGE, CODES_VINTAGE, setCodeCompatibleVintage,
    departagerParSymbole
};
