// ============================================================
// JOURNAL DES SCANS — une ligne par identification, en base
// ============================================================
// POURQUOI. Depuis le début de ce chantier, trois décisions ont buté sur la même
// phrase : « je n'ai aucune donnée ».
//   - fiabilité du setCode lu par l'IA : aucune collection ne garde ses réponses
//   - seuil du garde-fou de ratio : quatre cas connus (x150, x150, x750, x2750),
//     c'est-à-dire un échantillon de quatre
//   - fréquence du rang 3 (numéro connu ET contradictoire) : jamais observée en vrai
// Les logs console ne peuvent pas y répondre : sur Render ils sont ÉPHÉMÈRES, ils
// auront disparu quand on voudra les analyser. D'où cette collection : elle survit au
// redéploiement, elle se requête, et elle répondra aussi aux questions qu'on ne s'est
// pas encore posées. C'est le contraire d'un seuil choisi à la main.
//
// CE QUE CE MODULE NE FAIT PAS :
//   - il n'est JAMAIS sur le chemin critique. Un échec d'écriture ne remonte pas :
//     un scan qui a livré un prix ne doit pas échouer parce qu'une statistique n'a
//     pas pu s'écrire. Appel sans await, erreurs avalées et tracées.
//   - il n'appelle jamais Cardmarket ni TCGdex.
//
// ⚠️ DÉCISION RENVERSÉE — les URL sont maintenant conservées. La version d'origine de ce
// module écartait volontairement l'URL de l'annonce et celle de l'image : « le userId
// suffit à corréler, le reste serait de la donnée personnelle sans usage ». C'était faux,
// et la construction du premier banc l'a démontré en trois jours : les annonces Vinted
// disparaissent dès que la carte est vendue. Trois lignes du banc ont dû être marquées
// « inconnu » — dont un Ledian holo à départager entre deux impressions — parce que
// l'annonce n'existait plus et qu'il ne restait aucune trace de ce qui avait été scanné.
// Un banc reconstruit de mémoire n'est pas un banc.
// Avec ces deux champs, CHAQUE scan devient une ligne de banc vérifiable des mois plus
// tard. C'est la différence entre mesurer et se souvenir. Le TTL de 90 jours borne la
// conservation, et aucune image n'est stockée — seulement son URL.
//
// PURGE. Index TTL de 90 jours (voir RETENTION_JOURS). Trois mois couvrent un
// trimestre complet — assez pour mesurer une dérive saisonnière et pour accumuler
// quelques milliers de scans — et bornent la croissance sans surveillance.

const mongoose = require('mongoose');
const { rangDuNumero } = require('./scoring');

// 90 jours. Mongo purge par un balayage qui tourne toutes les 60 s : la suppression
// n'est pas instantanée à la seconde près, ce qui est sans importance ici.
const RETENTION_JOURS = 90;

// La version qui produit les lignes. Render expose RENDER_GIT_COMMIT ; en local, on le dit.
// Tronqué à 12 caractères : de quoi identifier un commit, pas de quoi peser.
const VERSION = String(process.env.RENDER_GIT_COMMIT || process.env.VERSION || 'local').slice(0, 12);

// Modèles guardés : ce module est requis par index.js, qui déclare déjà ses propres
// modèles sur les mêmes collections. Sans le garde, un second require lèverait
// OverwriteModelError.
const journalScanSchema = new mongoose.Schema({
    // `expires` pose l'index TTL. C'est le SEUL index de la collection, volontairement :
    // les requêtes d'analyse sont ponctuelles et portent sur quelques dizaines de
    // milliers de documents — un collscan y coûte moins cher que des index à maintenir
    // à chaque insertion, sur une collection qui n'est écrite que pour être lue à la main.
    le: { type: Date, default: Date.now, expires: `${RETENTION_JOURS}d` },

    route: String,        // 'identifier' (flux réel, extension) | 'analyser' (flux serveur)
    userId: String,

    // --- DE QUOI REVÉRIFIER LE SCAN DES MOIS PLUS TARD ---
    // imageUrl  : la PREMIÈRE photo envoyée à l'IA — celle sur laquelle le verdict s'est
    //             joué. Déjà reçue par les deux routes, il n'y avait qu'à la garder.
    // vintedUrl : l'URL de l'annonce. ⚠️ L'extension NE L'ENVOIE PAS ENCORE : le champ est
    //             accepté dès maintenant (`vintedUrl` ou `url` dans le corps), il se
    //             remplira tout seul le jour où elle le fera, sans redéploiement du serveur.
    imageUrl: String,
    vintedUrl: String,

    // QUELLE VERSION DU CODE A PRODUIT CETTE LIGNE.
    // ⚠️ SON ABSENCE A DÉJÀ COÛTÉ. Le banc rejoue depuis l'`idProduct` enregistré : quand
    // une ligne échoue, impossible de savoir si c'est le code ACTUEL qui échoue ou un build
    // d'il y a trois jours. Deux fois de suite — le Rhydon et le Dragonite — il a fallu
    // rejouer les fonctions à la main pour découvrir qu'elles rendaient déjà la bonne
    // réponse et que seul le journal était périmé. Sans ce champ, un banc vieillit sans le
    // dire, et on corrige des défauts déjà corrigés.
    // Renseigné depuis la variable d'environnement du déploiement (Render expose
    // RENDER_GIT_COMMIT) ; 'local' à défaut.
    version: String,

    // --- SUCCÈS OU ÉCHEC ------------------------------------------------------
    // Le trou le plus grave du dispositif jusqu'ici : `enregistrerScan` n'était appelée
    // qu'APRÈS l'identification, donc tout scan qui échouait sortait par un `return`
    // antérieur et ne laissait AUCUNE trace. Les 42,6 % d'incertaines mesurées sur les
    // 47 premières lignes sont donc un pourcentage calculé sur les SURVIVANTS : tant que
    // les morts ne sont pas comptés, on ne sait pas si l'outil rate 5 % ou 40 % des scans.
    //
    // ⚠️ LES 47 LIGNES ANTÉRIEURES N'ONT PAS CE CHAMP. Elles sont toutes des succès (elles
    // ne pouvaient pas être autre chose). Pour compter les succès, interroger
    // `{ resultat: { $ne: 'echec' } }` et non `{ resultat: 'succes' }`, sinon on perd
    // l'historique sans s'en apercevoir.
    resultat: String,     // 'succes' | 'echec'

    // Le motif EXACT, jamais un « échec » générique : c'est la répartition entre ces
    // motifs qui dira où porter l'effort. Les valeurs viennent des `return` réels des
    // deux routes, pas d'une nomenclature inventée :
    //   'ia-echec'          -> l'IA n'a rien rendu du tout (getCardIdFromAI null)
    //   'numero-illisible'  -> l'IA le déclare elle-même ; aucun chemin ne peut aboutir
    //   'carte-introuvable' -> ni TCGdex ni le catalogue local ne connaissent la carte
    //   'aucun-candidat'    -> carte identifiée, mais zéro produit Cardmarket à tester
    //   'aucun-prix'        -> produit trouvé, aucun prix de référence (route analyser)
    //   'erreur-serveur'    -> exception remontée au catch de la route
    // ⚠️ LE MESSAGE DE L'EXCEPTION, TRONQUÉ À 300 CARACTÈRES. Jusqu'ici `motifEchec`
    // disait QU'il y avait eu une exception, jamais LAQUELLE : le texte n'existait que
    // dans les logs Render, éphémères. Les deux `erreur-serveur` du 2026-08-03 sont donc
    // indiagnosticables aujourd'hui, et c'est cette impasse qu'on ferme.
    // 300 : de quoi porter « X is not a function » et le début d'une pile, pas de quoi
    // faire grossir la collection sur une exception bavarde.
    // ⚠️⚠️ IL RESTE MASQUÉ CÔTÉ RÉPONSE HTTP, ET CE N'EST PAS NÉGOCIABLE. `e.message` brut
    // avait été retiré des réponses après qu'un utilisateur a lu
    // « memeCodeParConventionX is not a function » dans son extension — le nom d'une
    // fonction interne, qui ne l'aide en rien et décrit notre code à qui la reçoit.
    // Le journaliser NE LE RÉINTRODUIT PAS dans la réponse : les deux chemins sont
    // distincts, et la réponse garde son texte générique.
    messageErreur: String,
    //   'tcgdex-injoignable'-> TCGdex n'a pas répondu, même après réessai. ⚠️ À NE PAS
    //      AGRÉGER AVEC 'carte-introuvable' : l'un dit « cette carte n'existe pas », l'autre
    //      « je n'ai pas pu regarder ». Ils se confondaient jusqu'au 2026-08-15, ce qui rend
    //      SUSPECTE toute statistique de 'carte-introuvable' antérieure à cette date — les
    //      deux seules lignes du journal étaient en réalité une panne réseau de 17 secondes.
    motifEchec: String,

    // Le crédit a-t-il RÉELLEMENT été rendu ? Valeur de retour de `rembourserScan`, pas
    // une supposition : elle rend `false` sur plafond quotidien atteint, poche 'accueil'
    // déjà pleine, semaine ISO changée ou Mongo indisponible. Un échec non remboursé est
    // un scan payé pour rien — c'est exactement ce qu'il faut pouvoir compter.
    rembourse: Boolean,

    // --- CE QUE L'IA A LU (l'entrée du problème) ---
    nom: String,
    numero: String,
    total: String,
    setCode: String,      // le code/stamp lu sur la carte — c'est SA fiabilité qu'on mesure
    langue: String,
    rarete: String,
    // Ce que l'IA dit de SA PROPRE lecture du nom, et le nom brut qu'elle a lu (katakana,
    // français...). C'est le seul moyen de comprendre après coup une traduction fautive —
    // « Gengar » lu sur un Machoc japonais était invérifiable sans ces deux champs.
    // `nomConfiance` sert aussi de garde-fou actif : à 'basse', le nom ne choisit plus
    // les candidats (voir nomSuspect dans index.js).
    nomConfiance: String, // 'haute' | 'moyenne' | 'basse'
    nomBrut: String,

    // LE LOGO DU SET, en ÉNUMÉRATION FERMÉE — journalisé, sans aucun effet.
    // ⚠️ IL NE MARQUE AUCUN POINT ET N'ENTRE DANS AUCUNE DÉCISION. C'est la discipline
    // qui a marché pour les motifs de reverse : on mesure d'abord sa PRÉSENCE et sa
    // FIABILITÉ sur des scans réels, on câble ensuite. Le modèle a déjà halluciné des noms
    // sur les Full Art ; il peut halluciner un symbole.
    // 'aucun' est une VRAIE valeur, pas un vide : les japonaises de 1996-1997 ne portent
    // aucun logo de set, et c'est précisément ce qui distingue le Pokémon Jungle de 1997
    // (1,40 €) du Darkness-and-to-Light de 2001 (2,46 €) — la seule paire du banc que
    // rien d'autre ne sépare.
    symboleSet: String,

    // --- CE QUI A ÉTÉ RETENU (la sortie) ---
    idProduct: Number,
    codeSetGagnant: String,   // code de set réel du produit retenu
    numeroGagnant: String,    // son numéro en base
    score: Number,
    nbCandidats: Number,
    // ⚠️ CHAMP HISTORIQUE, PLUS ÉCRIT DEPUIS LE 2026-08-08. Il valait
    // `(identificationConfiante && !carteAmbigue) ? 'haute' : 'basse'` — DEUX notions dans
    // un seul champ : la marge du classement ET la présence d'une réserve. Ce mélange a
    // trompé son lecteur (voir carte.margeConfortable dans index.js).
    // Les 131 lignes antérieures le portent avec cette ancienne sémantique. Elles ne sont
    // PAS comparables aux lignes récentes : ne pas additionner, ne pas relire un ancien
    // « basse » comme une marge mince — il peut n'être qu'une réserve.
    confiance: String,        // 'haute' | 'basse' — HISTORIQUE

    // LA MARGE DU CLASSEMENT, et rien d'autre : le gagnant devance-t-il le 2e d'au moins
    // 30 points ? INDÉPENDANT de `carteIncertaine`.
    // ⚠️ SIGNAL EN RÉSERVE. Le seuil de 30 n'a jamais été mesuré (voir scoring.js) : il
    // n'alimente aucun affichage. Il est journalisé pour qu'une mesure puisse un jour lui
    // donner un sens — justesse par tranche d'écart, sur des lignes à vérité individuelle.
    margeConfortable: Boolean,
    carteIncertaine: Boolean,
    sourceIdentification: String, // 'nom' | 'total+numero' | 'catalogue-local'
    // true = identifiée SANS TCGdex, donc sans variantsDetailed : le motif de reverse n'a
    // pas pu être routé. À compter séparément, c'est une identification dégradée.
    identifieeEnLocal: Boolean,
    voieCatalogue: String,        // 'nom' | 'numero'
    motifEtat: String,            // 'resolu' | 'aucun-motif' | 'non-resolu'

    // ════════════════════════════════════════════════════════════════════════
    // LES TROIS ENTRÉES DE LA RÉSOLUTION DE MOTIF — trois causes, zéro observabilité
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ CES TROIS CHAMPS EXISTENT PARCE QU'UN FAUX-ET-AFFIRMÉ EST PARTI EN PRODUCTION
    // SANS QU'ON PUISSE DIRE POURQUOI. Le 2026-08-12, une annonce « Rayquaza 153/217
    // Reverse Pokeball » à 9,99 € a été cotée sur l'impression holo (0,02 €) au lieu de
    // sa reverse : verdict AFFIRMÉ, +49850 %, aucune réserve.
    // Trois causes possibles, et le journal ne permettait d'en écarter AUCUNE :
    //   a) le titre n'atteint pas le serveur     -> `titreAnnonce` le dit
    //   b) l'IA n'a rapporté aucun motif          -> `motifIA` le dit
    //   c) l'IA a rapporté un motif, mais le MAUVAIS, et la chaîne a résolu vers le
    //      mauvais produit sans que rien ne s'y oppose  -> `motifIA` + `motifCible` le disent
    // Trois hypothèses, un seul champ manquant chacune. Sans elles, toute garde écrite
    // sur le titre est bâtie sur du sable — on ne saurait même pas si elle reçoit son
    // entrée.
    //
    // ⚠️ `motifEtat` SEUL NE SUFFIT PAS, et c'est ce que le cas a montré : il valait
    // « resolu » sur la ligne fautive. Résolu VERS QUOI ? Il ne le disait pas.
    titreAnnonce: String,   // le titre de l'annonce Vinted, tel que reçu (tronqué)
    motifIA: String,        // ce que l'IA a rapporté : 'aucun'|'ball'|'masterball'|'reverse-classique'|'indetermine'
    motifCible: String,     // le motif RETENU par resoudreMotif — la sortie, à côté de son état

    // ⚠️ LA LECTURE BRUTE DU « REVERSE », CAPTURÉE AVANT LE VALIDATEUR TCGdex.
    // Elle est le premier des trois faits de la contradiction qu'on veut détecter :
    //   l'IA lit reverse=true · TCGdex confirme qu'une reverse EXISTE · le produit retenu
    //   n'en est PAS une
    // Journaliser `cardInfo.reverse` au moment de l'écriture aurait enregistré la valeur
    // d'APRÈS validation — le validateur l'écrase — donc un champ qui ment sans jamais se
    // contredire. Voir sa capture dans /api/identifier.
    reverseLu: Boolean,
    // Le validateur a-t-il ANNULÉ cette lecture ? C'est le « choix silencieux » qu'on lui
    // reproche : TCGdex gagne, la lecture de l'IA disparaît, et rien ne le déclarait.
    // Compté ici en attendant de décider s'il doit poser une réserve.
    reverseAnnuleeParTcgdex: Boolean,

    // ⚠️ LA RÈGLE DU NUMÉRO DE POKÉDEX S'EST-ELLE DÉCLENCHÉE ? Le numéro lu reste dans
    // `numero`, mais rien ne disait s'il avait été NEUTRALISÉ en aval — et c'est ce qui
    // change tout : quand la règle tire, `numeroCarte` vaut null, donc le chemin
    // setcode+numéro ET l'identification locale sont tous les deux hors jeu (ils exigent
    // un numéro), et le scan ne peut plus aboutir que si TCGdex répond.
    // Il a fallu RECALCULER cette valeur hors ligne pour diagnostiquer le refus « Dark
    // Kadabra » du 2026-08-15. Un champ qu'on doit recalculer pour lire une ligne n'est
    // pas journalisé — d'autant qu'il dépend de la table dex-ids, qui change.
    // `raisonReserve: 'numero-pokedex-neutralise'` n'en tenait pas lieu : elle n'apparaît
    // que si la carte sort AVEC un prix, et seulement si aucune raison plus spécifique ne
    // l'a précédée dans la cascade.
    estDex: Boolean,

    // ════════════════════════════════════════════════════════════════════════
    // LE GROUPE D'ÉGALITÉ ET LE VIVIER — ÉCRITS AU SCAN, PLUS JAMAIS REJOUÉS
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️⚠️ CES DEUX CHAMPS REMPLACENT LE REJEU COMME SOURCE. Ils ne le complètent pas :
    // ils le REMPLACENT. Quiconque voudra « vérifier » en recalculant le vivier hors ligne
    // refera l'erreur qui a coûté deux tours de mesures — mesuré le 2026-08-16 :
    // reconstruire le vivier avec `trouverProduitsLocaux` + le périmètre diverge du
    // gagnant de production sur 27 lignes comparables sur 109, soit 24,8 %. La cause est
    // structurelle : la route unit DEUX noms (`viviersUnis`), passe par `viviersAvecRangs`,
    // peut recevoir `produitsImposes` du chemin setCode+numéro, et tire ses
    // `expansionsAttendues` de la carte TCGdex. Aucune reproduction hors ligne n'a ces
    // quatre entrées.
    // ⚠️ TANT QUE CES CHAMPS N'EXISTENT PAS SUR UN LOT, LA COLONNE « APRÈS » DU BANC EST
    // INUTILISABLE — `banc-japonais.js` construit lui aussi son vivier par reproduction
    // (voir sa ligne `trouverProduitsLocaux(d.nom)`), et 17 des 18 lignes qui bougent y
    // passent. Aucune décision d'identification ne doit s'appuyer sur le banc d'ici là.
    //
    // ⚠️ ET ILS NE VALENT QUE POUR LES SCANS À VENIR. Les 138 lignes déjà au journal ne
    // les auront JAMAIS. La clôture, le coût de collecte et le taux de départage devront
    // être remesurés sur un lot neuf — les anciens chiffres ne s'y ajoutent pas.
    exAequoIds: [Number],     // les idProduct à égalité au sommet, AU MOMENT DU SCAN
    vivierIds: [Number],      // le vivier retenu, celui que le scoring a réellement vu
    // Le vivier est BORNÉ à l'écriture (voir enregistrerScan) : « Pikachu » ramène 431
    // produits, et une ligne de journal n'est pas un dépôt. La TAILLE VRAIE est gardée à
    // part, sans quoi une borne silencieuse ferait croire à un vivier plus petit qu'il
    // n'était — exactement le genre de champ qui ment sans se contredire.
    vivierTaille: Number,

    // ════════════════════════════════════════════════════════════════════════
    // LA ROUTE TCGdex QUI A TROUVÉ LA CARTE, ET CE QU'ELLE A RAPPORTÉ
    // ════════════════════════════════════════════════════════════════════════
    // 'en' | 'ja' | 'fr' | ... | null (TCGdex muet : identification locale ou setcode+numéro).
    // Le repli de langue est SILENCIEUX : une carte japonaise introuvable en [ja] est
    // cherchée en [en], et rien ne distinguait les deux cas après coup. Trois questions
    // restaient donc sans réponse possible — combien d'identifications japonaises passent
    // par une carte occidentale ramenée par le repli, ce que ce repli apporte vraiment, et
    // sur quelle population la garde A peut s'appliquer.
    //
    // ⚠️ NE PAS LIRE `langueRoute` COMME LA ROUTE DE `variants`. Le détail d'une carte est
    // TOUJOURS pris sur /v2/en (voir ROUTE_DU_DETAIL dans index.js), et les espaces
    // d'identifiants `ja` et `en` sont DISJOINTS — mesuré le 2026-08-14. Une carte trouvée
    // en [ja] a donc des variantes NULLES, pas des variantes fausses.
    langueRoute: String,
    // ⚠️ L'IDENTIFIANT DE LA CARTE TCGdex RETENUE — à ne pas confondre avec `setTcgdex`
    // plus bas, qui est celui de l'EXPANSION et qui vient de NOS liens appris, pas de
    // TCGdex. Les confondre a produit une mesure entièrement fausse le 2026-08-13 :
    // `mesure-route-langue.js` reconstruisait un identifiant de carte en collant
    // `setTcgdex` et le numéro lu, puis concluait « la route japonaise est muette 13 fois
    // sur 14 ». Elle interrogeait des identifiants qui n'avaient jamais été rendus par
    // TCGdex. Sans ce champ, on ne peut ni rejouer une route, ni savoir quelle carte a
    // réellement servi — septième principe, un instrument qui se trompe coûte plus cher
    // qu'un bug.
    carteTcgdexId: String,
    // Le champ `variants_detailed` est-il revenu, et avec combien d'impressions ?
    // Présence et vacuité sont DEUX faits distincts : un tableau vide dit « aucune
    // impression routable pour cette carte », un champ absent dit « je n'ai pas pu
    // demander ». Les confondre reviendrait à lire un silence comme une négation.
    variantsDetailedPresent: Boolean,
    variantsDetailedNb: Number,

    // COMMENT LIRE LE PRIX D'UNE REVERSE — 'filtre-url' | 'produit-distinct' | null.
    // ⚠️ ELLE PARTAIT DANS LA RÉPONSE ET N'ÉTAIT CONSERVÉE NULLE PART. Même dette que
    // `nomExact` et `raisonReserve` avant elle : une valeur de jonction, calculée à
    // chaque scan, vivante une milliseconde. Conséquence CONSTATÉE le 2026-08-10 :
    // impossible de fabriquer une charge de verrou sur la branche reverse, parce
    // qu'aucune des 131 lignes du journal ne permettait de sélectionner un scan qui
    // l'avait empruntée. Une branche qu'on ne peut pas sélectionner est une branche
    // qu'on ne peut pas verrouiller.
    // Le plus proche substitut disponible était `motifEtat: 'resolu'` (37 lignes) — il
    // dit qu'UNE stratégie a été choisie, jamais laquelle.
    strategieReverse: String,

    // --- RANG DU GAGNANT ---
    // 1 = son numéro correspond à celui lu ; 2 = son numéro est inconnu ; 3 = son
    // numéro est connu et CONTREDIT celui lu. Calculé ici par la même fonction pure
    // que celle qui pilotera le classement (scoring.rangDuNumero), pour que la mesure
    // porte exactement sur ce qui sera mis en production ensuite.
    rang: Number,

    // --- LES DEUX SIGNAUX DE RANG, en sorties de première classe ---
    // aucunCandidatAuNumero : AUCUN candidat du vivier ne portait le numéro lu, par
    //   aucune voie. Le prix a été livré, mais il ne peut pas être celui de la carte
    //   scannée. C'est le cas Kahili, et le seul que le score seul ne voit pas.
    // rangGagnant : 3 = le catalogue contredit le numéro lu pour le produit retenu.
    // Ces deux champs existent pour être COMPTÉS : c'est leur fréquence réelle qui dira
    // si les garde-fous servent, et sur quels sets ils se déclenchent.
    aucunCandidatAuNumero: Boolean,
    rangGagnant: Number,

    // TROISIÈME ÉTAT DU NOM. true = le nom lu est connu du catalogue à d'autres numéros,
    // mais JAMAIS à celui qui a été lu. Une des deux lectures est fausse et on ignore
    // laquelle : le prix part, le verdict non. Persisté pour être COMPTÉ — c'est sa
    // fréquence réelle qui dira si l'avertissement reste rare et donc lisible. Mesuré à
    // 3 scans sur 49 avant sa mise en service, dont un seul nouvel avertissement.
    // ⚠️ false quand AUCUN produit de ce nom n'a de numéro publié : 2 101 produits sont
    // dans ce cas (3,0 % du catalogue) et ne rien y trouver ne prouve rien.
    nomNumeroIncoherents: Boolean,

    // LE TOTAL LU CORRESPOND-IL À UN SET EXISTANT DE SA RÉGION ?
    // true = aucun set connu de cette taille dans la langue de la carte. Le total est donc
    // soit mal lu, soit celui d'un set que TCGdex ignore — et on ne peut pas trancher :
    // mesuré, un « 018 » invalidable était le VRAI total du McDonald's japonais, absent de
    // TCGdex. C'est pourquoi ce champ ne COMMANDE RIEN aujourd'hui : il compte.
    // Il existe pour une raison précise : la borne « total présent » de la règle du numéro
    // de Pokédex n'a que deux états, faute d'un troisième (« total douteux ») dont le coût
    // a été mesuré à zéro ligne. Ce compteur est ce qui permettra d'écrire cette branche
    // sur des chiffres le jour où elle vaudra quelque chose, plutôt que sur un principe.
    totalInvalidable: Boolean,

    // --- PAR QUEL LIEN L'IDENTIFICATION EST-ELLE PASSÉE ? ---
    // Ces trois champs existent pour une question précise, à laquelle il a été impossible
    // de répondre au moment où elle comptait : « combien de scans sont passés par un
    // identifiant TCGdex partagé ? » — 69 identifiants le sont, chacun couvrant un set
    // japonais ET son jumeau occidental, et c'est la cause du dernier verdict faux du banc.
    // Sans ces champs, la mesure du gain apporté par la table close est impossible :
    // on ne saurait dire quelles lignes elle aurait touchées.
    setTcgdex: String,            // l'identifiant TCGdex de l'expansion retenue
    idExpansionGagnante: Number,  // l'expansion elle-même, pour recouper sans relire le catalogue
    regionSource: String,         // d'où vient sa région : liste-verifiee, code-minuscule,
                                  // place-internationale-prise-par-X, nom-hors-catalogue...
                                  // Une région dérivée d'un nom hors catalogue ne vaut pas
                                  // une région tirée de la liste vérifiée : le champ le dit.

    // Écart de score entre le 1er et le 2e du classement. « Un écart de 5 points contre
    // 20 se renverse au premier bruit » : ce champ rend la liste des identifications
    // fragiles interrogeable, au lieu d'attendre qu'un testeur en remonte une.
    // null quand il n'y a qu'un candidat — il n'y a alors rien à départager.
    ecartScore: Number,

    // --- PLAUSIBILITÉ DU PRIX ---
    // ratio = prix demandé sur Vinted / prix de référence. Un ratio énorme du côté
    // « trop cher » trahit presque toujours une identification ratée, pas un vendeur
    // délirant. Les deux prix sont conservés en plus du ratio : sans eux, impossible
    // de distinguer un x1000 sur une carte à 0,02 € d'un x1000 sur une carte à 20 €.
    // ⚠️ `prixVinted` EST RENSEIGNÉ SUR 0 DES 142 LIGNES au 2026-08-11, et ce n'était pas
    // un oubli d'écriture : /api/identifier ne RECEVAIT aucun prix — son corps valait
    // { imageUrl, imageUrls, title, vintedEtat }. Le champ est désormais accepté à
    // l'entrée. C'est ce qui permettra de dire de quel côté de `fourchette` tombe une
    // annonce ; ce n'est JAMAIS une référence pour calibrer quoi que ce soit — c'est la
    // chose qu'on juge.
    prixVinted: Number,
    prixReference: Number,
    ratio: Number,

    // ⚠️ LE PRIX LIVE CARDMARKET DU PRODUIT RETENU — la seule mesure qui fasse foi, et la
    // seule qui puisse calibrer un seuil. `prixVinted` et le prix guide ne sont PAS deux
    // mesures du même objet ; `prixLive` et le prix guide, si — même idProduct, deux
    // sources. C'est leur rapport qui dira de combien le guide s'écarte du réel.
    //
    // ⚠️ IL NE PEUT PAS ARRIVER DANS LA MÊME REQUÊTE QUE LE SCAN. L'extension lit le live
    // APRÈS avoir reçu la réponse — il lui faut l'idProduct pour savoir quoi lire. D'où
    // `/api/retour-live` et l'identifiant rendu par `enregistrerScan`.
    //
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️⚠️ COMMENT CALIBRER K — LA QUEUE HAUTE, JAMAIS LA MÉDIANE
    // ════════════════════════════════════════════════════════════════════════
    // CE PARAGRAPHE EXISTE POUR EMPÊCHER UNE ERREUR PRÉVISIBLE, dans six semaines, par
    // quelqu'un qui n'aura pas suivi. Le guide Cardmarket est une TENDANCE GLOBALE — ni
    // par état, ni par langue (voir guidePrixSchema : avg, low, trend, avg30…). Le prix
    // live que lit l'extension est un PLANCHER FILTRÉ, par état et par langue.
    //
    // UN PLANCHER EST PRESQUE TOUJOURS SOUS UNE TENDANCE. Le rapport prixLive/prixGuide
    // sera donc massivement inférieur à 1, et cette masse est STRUCTURELLE : elle ne
    // mesure aucune incertitude, seulement la différence entre deux définitions.
    // Calibrer K sur la médiane reviendrait à mesurer cet écart de définition et à
    // l'appeler « marge de sécurité ». Le seuil serait beaucoup trop serré, et la règle
    // de la fourchette annoncerait des verdicts sûrs qui ne le sont pas.
    //
    // CE QUI INTÉRESSE K, C'EST LA QUEUE HAUTE : le cas RARE où le plancher réel DÉPASSE
    // la tendance — carte recherchée, offre rare, guide en retard. C'est le seul cas où
    // un candidat peut valoir plus cher que son prix guide ne le laisse croire, donc le
    // seul contre lequel la fourchette doit se protéger. K se lit dans un quantile haut
    // (q95, q99), pas au centre.
    //
    // ⚠️ ET LA STRATIFICATION SE FAIT À LA COLLECTE, PAS APRÈS. Un K unique serait trop
    // lâche sur du NM et trop serré sur du GD. Les deux champs ci-dessous sont là pour
    // qu'on puisse séparer les populations le jour venu — les ajouter plus tard ne
    // rattraperait pas les lignes déjà écrites.
    // ⚠️ L'AUTRE MOITIÉ DE LA PAIRE, et elle doit être écrite AU MOMENT DU SCAN. C'est le
    // prix guide EXACTEMENT utilisé par la chaîne — même produit, même axe normal/reverse.
    // Le re-dériver plus tard depuis `guide_prix` donnerait une TROISIÈME valeur, qui
    // divergerait de celle-ci au premier changement de `prixDeReference` : deuxième
    // principe, appliqué à une mesure.
    prixGuideRetenu: Number,
    prixLive: Number,
    prixLiveEtat: String,        // l'état sur lequel l'offre a été lue (MT, NM, EX, GD, LP, PL, PO)
    prixLiveCodeLangue: Number,  // le code langue Cardmarket du filtre (1=EN, 2=FR, 7=JP…)

    // ════════════════════════════════════════════════════════════════════════
    // CE QUE L'EXTENSION VOIT DE LA PAGE — pour calibrer ses gardes de cohérence
    // ════════════════════════════════════════════════════════════════════════
    // `prixLive` est un PLANCHER : il ne dit rien de la forme de l'offre autour de lui.
    // Ces champs disent cette forme, et ils servent à répondre à des questions que le
    // plancher seul ne peut pas trancher — « ce 0,02 € est-il le prix de la carte, ou le
    // signe qu'on regarde la mauvaise impression ? »
    //
    // ⚠️ MESURÉ AVANT D'ÊTRE ACCEPTÉ, et le résultat tempère : une grille plate n'est PAS
    // rare. Sur les 75 959 produits du guide, 62,6 % n'ont AUCUNE cotation holo et 27,9 %
    // ont un trend ≤ 0,20 €. Un signal partagé par 10,3 % du catalogue ne DÉSIGNE pas une
    // erreur — il dit « carte commune ». C'est pour ça que ces champs sont journalisés
    // pour MESURER, et qu'aucune garde n'est câblée dessus ici.
    prixLiveTendance: Number,    // la tendance affichée sur la fiche, à côté du plancher
    prixLiveNM: Number,          // le prix de la ligne NM de la grille
    // La grille complète, état -> prix. C'est la forme la plus riche : les deux entiers
    // ci-dessous s'en DÉDUISENT quand elle est là.
    grilleLive: { type: Map, of: Number },
    // ⚠️ DEUX ENTIERS, ET LE SECOND N'EST PAS UN BOOLÉEN — DÉLIBÉRÉMENT. « toutes les
    // valeurs sont égales » se lit `grilleValeursDistinctes === 1`, mais l'entier dit en
    // plus COMBIEN de paliers existent. Un booléen aurait jeté cette information, et on
    // ne peut pas la reconstruire après coup.
    grilleNbEtats: Number,
    grilleValeursDistinctes: Number,
    // Quand le retour est arrivé. Sert à mesurer le TAUX DE PERTE : l'extension tire sans
    // attendre, une partie des retours se perdra, et on veut le connaître plutôt que le
    // supposer. Une ligne sans `retourLe` est un scanId émis sans retour reçu.
    retourLe: Date,
    // D'OÙ vient le prix de référence : 'guide-local' | 'tcgdex' | 'cache'. Sans lui,
    // un ratio aberrant serait indiscernable d'un simple repli sur une source moins
    // précise, et on tirerait un seuil d'une comparaison qui n'en est pas une.
    sourcePrix: String,

    // --- DÉSACCORD DE CODE SET ---
    // true  : l'IA a lu un code et il correspond à celui du gagnant
    // false : elle en a lu un et il ne correspond pas
    // null  : elle n'a rien lu, ou le code du gagnant est inconnu -> hors mesure
    setCodeAccord: Boolean,

    // COMMENT LE setCode LU S'EST RÉSOLU — compté, sans aucun effet sur le scoring.
    //   'exact'        -> il désigne un code de set du catalogue
    //   'convention-x' -> décodage EXACT de la convention Cardmarket : les « Additionals »
    //                     d'un set portent son code préfixé d'un X (xPRE pour PRE). Après
    //                     retrait du préfixe, égalité stricte — aucun rapprochement fortuit.
    //   'parente'      -> ressemblance de PRÉFIXE, approximative par construction. Séparée
    //                     de la précédente exprès : dans six mois, il faudra pouvoir dire
    //                     lequel des deux mécanismes a produit un rapprochement douteux.
    //   'mot-non-code' -> l'IA a mis une CATÉGORIE dans ce champ (« PROMO », « HOLO », une
    //                     rareté). Ça ne discrimine rien : il existe des promos vintage
    //                     comme modernes. On le compte pour décider un jour sur des
    //                     chiffres, pas sur un cas.
    //   'inconnu'      -> ne résout vers rien : bruit d'OCR (voir le quatrième principe)
    setCodeResolution: String,

    // POURQUOI LE PRIX EST PARTI AVEC RÉSERVE — énumération fermée, une valeur par CAUSE.
    // ⚠️ CE CHAMP MANQUAIT ET ÇA S'EST VU TOUT DE SUITE. `carteIncertaine` disait qu'il y
    // avait une réserve, jamais laquelle : la raison ne vivait que dans un `console.warn`,
    // donc éphémère sur Render. Au moment d'écrire le départage par le symbole, RIEN
    // n'aurait pu dire s'il s'était déclenché une seule fois en production — et une
    // branche qu'on ne peut pas compter est une branche qu'on ne connaît pas.
    //   'symbole-departage'               -> le symbole du set a tranché une égalité parfaite
    //   'perimetre-vintage-suggestion'    -> le périmètre a restreint sans prouver
    //   'nom-seul-vintage'                -> ⚠️ À NE PAS CONFONDRE AVEC LA PRÉCÉDENTE, et la
    //      distinction est le fond du sujet : là, le périmètre RESTREINT un vivier déjà
    //      constitué ; ici il AUTORISE un vivier qui n'aurait pas existé du tout. Ni numéro
    //      (neutralisé par la règle du Pokédex), ni TCGdex (absent, et absence RÉELLE —
    //      jamais une panne), ni variantes. Trois sources perdues d'un coup : c'est le
    //      vivier le moins étayé que la chaîne produise, et sa faiblesse est CONSTITUTIVE,
    //      pas en attente de mesure. Elle ne passera jamais en « forte ».
    //   'impression-corrigee'             -> B a substitué la reverse au produit normal
    //   'impression-contredite'           -> la reverse existe, on n'a pas su la désigner
    //   'lien-tcgdex-partage'             -> identifiant TCGdex partagé JP/occidental
    //   'numero-pokedex-neutralise'       -> le nombre lu était un numéro de Pokédex
    //   'egalite-sans-enjeu'              -> ex aequo, mais moins de 1,00 € d'écart
    //   'identification-locale-sans-tcgdex' -> pas de variants_detailed, motif non routé
    //   'nom-numero-incoherents'          -> le nom existe, jamais à ce numéro
    //   'aucun-candidat-au-numero'        -> aucun candidat ne porte le numéro lu
    //   'gagnant-contredit-le-numero'     -> rang 3 sur le gagnant
    //   'nom-confiance-basse'             -> l'IA doute de sa propre lecture du nom
    //   'motif-<raison>'                  -> motif de reverse non résolu
    //   'tcgdex-numero-incoherent' | 'tcgdex-ambigu'
    // ⚠️ 'perimetre-vintage-suggestion' A RECOUVERT DEUX MÉCANISMES pendant un commit : le
    // départage réutilisait le drapeau du périmètre. Deux causes sous un seul nom, c'est
    // une mesure qu'on ne peut plus faire — d'où une valeur par cause, sans exception.
    raisonReserve: String,

    // LE NIVEAU DE LA RÉSERVE — 'forte' | 'faible'. La table raison -> niveau vit dans
    // index.js, avec la justesse mesurée à côté de chaque entrée et la règle de
    // rétrogradation. Journalisé pour que la répartition forte/faible se mesure au lot
    // suivant sans avoir à rejouer la table.
    // Mesuré le 2026-08-08 sur 65 scans : 32 % des réserves fortes, 51 % faibles.
    niveauReserve: String,

    // L'idProduct du concurrent renvoyé à l'extension, quand il y en a un. Le champ
    // complet (nom, codeSet, prixGuide) part dans la RÉPONSE ; ici on ne garde que
    // l'identifiant, qui suffit à retrouver le reste et ne duplique aucun catalogue.
    // null = aucune égalité, donc aucun concurrent à proposer.
    concurrentIdProduct: Number,

    // COMBIEN DE CANDIDATS À ÉGALITÉ PARFAITE, gagnant compris. null = aucune égalité.
    // Journalisé pour mesurer ce que le départage a RÉELLEMENT à trancher : un duel et une
    // foule de sept ne sont pas la même difficulté, et le taux de justesse du symbole
    // devra être relu par tranche. Mesuré sur un cas réel : 7 ex aequo sur un Vileplume.
    nbExAequo: Number,

    // ⚠️ LA FOURCHETTE DES CANDIDATS SUR UN REFUS — { min, max, n }, en PRIX GUIDE.
    // Sur un refus par égalité parfaite, on renonce à dire QUELLE carte c'est, mais on
    // sait entre quels prix elle se trouve. Une annonce très au-dessus du max (ou très
    // en dessous du min) permet un verdict de PRIX sans avoir départagé l'IDENTITÉ.
    // ⚠️ CE SONT DES PRIX GUIDE, pas des prix live. Le nom du champ le porte, comme
    // `prixGuide` du concurrent : les comparer à un prix réel sans marge mélange deux
    // sources — c'est tout le sujet du seuil, qui n'est pas encore mesuré.
    // Mesuré à l'ouverture (16 refus rejoués) : rapport max/min médian ×5,4, de ×1,5 à ×73.
    fourchette: {
        min: Number,   // le moins cher des ex aequo
        max: Number,   // le plus cher
        n: Number      // combien d'ex aequo — à 2 c'est un duel, à 9 c'est une foule
    },

    // LA PHRASE EXACTE RENDUE PAR LE DÉPARTAGE PAR SYMBOLE, y compris quand il n'a PAS
    // tranché. « symbole "e2" lu, mais aucun ex aequo ne le porte » est une mesure autant
    // que « il a tranché » : c'est la répartition entre ces deux cas qui dira si le signal
    // sert vraiment ou s'il est inerte. null = aucune égalité à départager sur ce scan.
    symboleDepartage: String,

    // La parenté RETENUE, quand il y en a une : « MCD~MCDP ». Toute la chaîne en dépend
    // maintenant — MCD~MCDP a sauvé un Charmander à 1033 €, DP5~DP5c un Dracolosse — et
    // c'est un rapprochement approximatif au cœur du système. Le journaliser rend une
    // dérive future visible, au lieu d'être découverte par un prix faux.
    parenteRetenue: String
}, { versionKey: false });

const JournalScan = mongoose.models.JournalScan
    || mongoose.model('JournalScan', journalScanSchema, 'journal_scans');

// Lectures d'appoint pour compléter la ligne : le numéro et le code de set du gagnant.
// Elles sont faites ICI plutôt que dans les routes pour que l'appelant n'ait qu'un
// objet plat à fournir — moins de points de rupture dans le chemin critique. Coût :
// au plus deux lectures indexées, hors chemin critique, à comparer aux ~4 s d'appel IA
// que tout scan paie de toute façon.
const NumeroCarteJ = mongoose.models.NumeroCarte
    || mongoose.model('NumeroCarteJ', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const CodeSetJ = mongoose.models.CodeSet
    || mongoose.model('CodeSetJ', new mongoose.Schema({}, { strict: false }), 'codes_set');

// Compare deux codes de set comme le fait le scoring : majuscules, sans séparateurs.
// Volontairement STRICT (égalité seule) : la parenté partielle est une tolérance du
// scoring, pas une vérité — et c'est justement la fiabilité brute du setCode qu'on veut
// mesurer, pas celle du mécanisme d'appariement.
function memeCode(a, b) {
    const n = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const x = n(a), y = n(b);
    return (x && y) ? x === y : null;
}

/**
 * Écrit une ligne de journal. FIRE-AND-FORGET : à appeler SANS await.
 *
 * @param {object} d  tout est optionnel ; les champs absents restent absents
 * @returns {string|null}  L'IDENTIFIANT DE LA LIGNE, connu AVANT son écriture.
 *
 * ⚠️ IL NE FAUT TOUJOURS PAS ATTENDRE CETTE FONCTION. Elle rend un identifiant, pas une
 * promesse : l'écriture reste en fire-and-forget, hors du chemin critique. L'identifiant
 * est fabriqué ici plutôt que relu après coup, précisément pour qu'on n'ait jamais besoin
 * d'attendre l'écriture pour le connaître.
 *
 * POURQUOI IL EXISTE. Le prix LIVE Cardmarket ne peut pas arriver avec le scan :
 * l'extension a besoin de l'idProduct — donc de la réponse — pour savoir quoi lire. Le
 * renseigner exige un retour, et un retour exige de savoir À QUELLE LIGNE l'attacher.
 * Sans cet identifiant, la seule façon de rapprocher un retour de son scan serait de
 * deviner par (userId, horodatage), c'est-à-dire une jointure approximative sur la seule
 * donnée qui doit rester exacte.
 *
 * `null` quand Mongo n'est pas connecté : il n'y aura pas de ligne, donc pas d'identifiant
 * à promettre. Un identifiant rendu pour une ligne qui n'existe pas ferait échouer tous
 * les retours, sans qu'on sache pourquoi.
 */
function enregistrerScan(d = {}) {
    // Pas de connexion : on sort en silence. Le scan, lui, a pu aboutir (guide en
    // cache, repli TCGdex) — ce n'est pas à la statistique de le faire échouer.
    if (mongoose.connection.readyState !== 1) return null;

    // L'identifiant est décidé ICI, avant l'écriture, et rendu à l'appelant.
    const _id = new mongoose.Types.ObjectId();

    (async () => {
        let numeroGagnant = d.numeroGagnant ?? null;
        let codeSetGagnant = d.codeSetGagnant ?? null;

        if (d.idProduct != null && (numeroGagnant == null || codeSetGagnant == null)) {
            const doc = await NumeroCarteJ.findOne(
                { idProduct: Number(d.idProduct) },
                { numero: 1, numeroUrl: 1, codeSet: 1, idExpansion: 1 }
            ).lean();
            if (doc) {
                if (numeroGagnant == null) numeroGagnant = doc.numero || doc.numeroUrl || null;
                if (codeSetGagnant == null) codeSetGagnant = doc.codeSet || null;
                if (codeSetGagnant == null && doc.idExpansion != null) {
                    const cs = await CodeSetJ.findOne({ idExpansion: doc.idExpansion }, { codeSet: 1 }).lean();
                    codeSetGagnant = cs?.codeSet || null;
                }
            }
        }

        const prixVinted = Number.isFinite(d.prixVinted) ? d.prixVinted : null;
        const prixReference = Number.isFinite(d.prixReference) ? d.prixReference : null;
        // Ratio calculé seulement s'il a un sens : une référence à 0 en donnerait
        // l'infini, ce qui polluerait toute moyenne ultérieure.
        const ratio = (prixVinted != null && prixReference != null && prixReference > 0)
            ? prixVinted / prixReference
            : null;

        await JournalScan.create({
            _id,
            le: new Date(),
            route: d.route || null,
            userId: d.userId || null,
            // Bornées : une URL Vinted fait ~120 caractères, une URL d'image ~200. Le
            // plafond protège d'un corps de requête fabriqué qui gonflerait la collection.
            imageUrl: d.imageUrl ? String(d.imageUrl).slice(0, 500) : null,
            vintedUrl: d.vintedUrl ? String(d.vintedUrl).slice(0, 500) : null,
            version: VERSION,
            nom: d.nom || null,
            numero: d.numero != null ? String(d.numero) : null,
            total: d.total != null ? String(d.total) : null,
            setCode: d.setCode || null,
            langue: d.langue || null,
            rarete: d.rarete || null,
            idProduct: d.idProduct != null ? Number(d.idProduct) : null,
            codeSetGagnant,
            numeroGagnant: numeroGagnant != null ? String(numeroGagnant) : null,
            score: Number.isFinite(d.score) ? d.score : null,
            nbCandidats: Number.isFinite(d.nbCandidats) ? d.nbCandidats : null,
            // `confiance` n'est plus alimenté — voir le schéma. Les anciennes lignes le
            // gardent, les nouvelles portent `margeConfortable`.
            margeConfortable: d.margeConfortable != null ? Boolean(d.margeConfortable) : null,
            carteIncertaine: d.carteIncertaine != null ? Boolean(d.carteIncertaine) : null,
            sourceIdentification: d.sourceIdentification || null,
            identifieeEnLocal: d.identifieeEnLocal != null ? Boolean(d.identifieeEnLocal) : null,
            nomConfiance: d.nomConfiance || null,
            nomBrut: d.nomBrut || null,
            symboleSet: d.symboleSet || null,
            voieCatalogue: d.voieCatalogue || null,
            motifEtat: d.motifEtat || null,
            // Tronqué à 200 : un titre Vinted tient largement dedans, et on ne veut pas
            // qu'un titre aberrant fasse grossir la collection sans limite.
            titreAnnonce: d.titreAnnonce ? String(d.titreAnnonce).slice(0, 200) : null,
            motifIA: d.motifIA || null,
            motifCible: d.motifCible || null,
            reverseLu: d.reverseLu != null ? Boolean(d.reverseLu) : null,
            reverseAnnuleeParTcgdex: d.reverseAnnuleeParTcgdex != null ? Boolean(d.reverseAnnuleeParTcgdex) : null,
            estDex: d.estDex != null ? Boolean(d.estDex) : null,
            // ⚠️ LE VIVIER EST BORNÉ ICI, ET SA TAILLE VRAIE EST GARDÉE À PART. Sans ce
            // couple, une borne silencieuse ferait lire « vivier de 200 » là où il y en
            // avait 431. Le plafond est haut : il ne coupe que les viviers pathologiques.
            exAequoIds: Array.isArray(d.exAequoIds) ? d.exAequoIds.map(Number).filter(Number.isFinite) : null,
            vivierIds: Array.isArray(d.vivierIds) ? d.vivierIds.map(Number).filter(Number.isFinite).slice(0, 200) : null,
            vivierTaille: Number.isFinite(d.vivierTaille) ? d.vivierTaille : (Array.isArray(d.vivierIds) ? d.vivierIds.length : null),
            // Tronqué ICI, une seule fois, pour que tous les appelants soient bornés de la
            // même façon — un appelant qui oublierait de tronquer ne peut pas exister.
            messageErreur: d.messageErreur ? String(d.messageErreur).slice(0, 300) : null,
            // ⚠️ `null` VOULU quand TCGdex est muet — surtout pas un défaut vers 'en', qui
            // ferait passer une identification 100 % locale pour une identification anglaise.
            langueRoute: d.langueRoute || null,
            carteTcgdexId: d.carteTcgdexId || null,
            variantsDetailedPresent: d.variantsDetailedPresent != null ? Boolean(d.variantsDetailedPresent) : null,
            // Number.isFinite et non `|| null` : 0 est une valeur SIGNIFIANTE ici (le champ
            // est revenu vide), et `0 || null` l'effacerait en la confondant avec l'absence.
            variantsDetailedNb: Number.isFinite(d.variantsDetailedNb) ? d.variantsDetailedNb : null,
            strategieReverse: d.strategieReverse || null,
            resultat: d.motifEchec ? 'echec' : 'succes',
            motifEchec: d.motifEchec || null,
            rembourse: d.rembourse != null ? Boolean(d.rembourse) : null,
            // ⚠️ PAS de rang sur une ligne d'échec. `rangDuNumero(numero, null)` rend 2,
            // c'est-à-dire « le numéro du gagnant est inconnu » — or sur un échec il n'y a
            // pas de gagnant du tout. Laisser passer ce 2 ferait grossir le rang 2 de tous
            // les échecs et fausserait précisément la fréquence que ce journal existe pour
            // mesurer.
            rang: d.motifEchec ? null : rangDuNumero(d.numero, numeroGagnant),
            aucunCandidatAuNumero: d.aucunCandidatAuNumero != null ? Boolean(d.aucunCandidatAuNumero) : null,
            nomNumeroIncoherents: d.nomNumeroIncoherents != null ? Boolean(d.nomNumeroIncoherents) : null,
            totalInvalidable: d.totalInvalidable != null ? Boolean(d.totalInvalidable) : null,
            setTcgdex: d.setTcgdex || null,
            idExpansionGagnante: Number.isFinite(d.idExpansionGagnante) ? d.idExpansionGagnante : null,
            regionSource: d.regionSource || null,
            rangGagnant: Number.isFinite(d.rangGagnant) ? d.rangGagnant : null,
            ecartScore: Number.isFinite(d.ecartScore) ? d.ecartScore : null,
            prixVinted, prixReference, ratio,
            sourcePrix: d.sourcePrix || null,
            setCodeAccord: memeCode(d.setCode, codeSetGagnant),
            setCodeResolution: d.setCodeResolution || null,
            raisonReserve: d.raisonReserve || null,
            niveauReserve: d.niveauReserve || null,
            concurrentIdProduct: Number.isFinite(d.concurrentIdProduct) ? d.concurrentIdProduct : null,
            nbExAequo: Number.isFinite(d.nbExAequo) ? d.nbExAequo : null,
            // La fourchette n'est écrite que si ses DEUX bornes sont des prix. Une borne
            // seule ne borne rien, et un min sans max se lirait comme un intervalle ouvert.
            fourchette: (d.fourchette && Number.isFinite(d.fourchette.min) && Number.isFinite(d.fourchette.max))
                ? { min: d.fourchette.min, max: d.fourchette.max, n: Number.isFinite(d.fourchette.n) ? d.fourchette.n : null }
                : null,
            prixGuideRetenu: Number.isFinite(d.prixGuideRetenu) ? d.prixGuideRetenu : null,
            prixLive: Number.isFinite(d.prixLive) ? d.prixLive : null,
            prixLiveEtat: d.prixLiveEtat || null,
            prixLiveCodeLangue: Number.isFinite(d.prixLiveCodeLangue) ? d.prixLiveCodeLangue : null,
            symboleDepartage: d.symboleDepartage || null,
            parenteRetenue: d.parenteRetenue || null
        });
    })().catch(e => {
        // Trace, jamais de propagation. Un journal muet vaut mieux qu'un scan cassé.
        console.warn(`⚠️ [journal-scans] écriture impossible : ${e.message}`);
    });

    return String(_id);
}

/**
 * Écrit une ligne d'ÉCHEC. Même collection, même TTL, même contrat : FIRE-AND-FORGET,
 * à appeler SANS await. Un scan déjà perdu ne doit pas l'être deux fois parce que sa
 * statistique n'a pas pu s'écrire.
 *
 * Ce n'est qu'un adaptateur au-dessus d'`enregistrerScan` : il aplatit `cardInfo` pour
 * que les appelants n'aient pas à recopier huit champs à chaque `return`. Un champ
 * recopié à la main sur six sites est un champ oublié sur l'un des six.
 *
 * @param {object}      o
 * @param {string}      o.route       'identifier' | 'analyser'
 * @param {string}      o.userId
 * @param {object|null} o.cardInfo    ce que l'IA a lu — null quand elle n'a rien rendu
 * @param {string}      o.motifEchec  voir la liste dans le schéma
 * @param {boolean}     o.rembourse   valeur de retour de rembourserScan, pas une intention
 * @returns {void}
 */
function enregistrerEchec({ route, userId, cardInfo, motifEchec, rembourse, imageUrl, vintedUrl,
    fourchette, nbExAequo, nbCandidats, prixVinted,
    // ⚠️ `reverseLu` EST UN PARAMÈTRE EXPLICITE, ET SURTOUT PAS `cardInfo.reverse`.
    // Le validateur TCGdex ÉCRASE `cardInfo.reverse` en cours de route. Trois des cinq
    // sorties de refus sont en AVAL de lui : y lire `cardInfo.reverse` enregistrerait la
    // valeur d'APRÈS validation en croyant enregistrer la lecture de l'IA — un champ qui
    // ment sans jamais se contredire, exactement le défaut que la capture de `reverseLu`
    // avait été écrite pour empêcher côté succès. On le fait donc passer par l'appelant,
    // qui seul sait où il en est ; absent, il reste null, et null veut dire « on ne sait
    // pas », pas « false ».
    reverseLu, motifIA, estDex,
    // ⚠️ LES REFUS EN ONT AUTANT BESOIN QUE LES SUCCÈS — plus, même : `egalite-parfaite`
    // EST un refus pour cause d'égalité, et jusqu'ici il ne disait pas ENTRE QUOI.
    // `nbExAequo` donnait le nombre, jamais les identifiants : impossible de savoir si le
    // groupe était couvert par un index, ni de mesurer la clôture après coup.
    exAequoIds, vivierIds, vivierTaille, messageErreur } = {}) {
    const c = cardInfo || {};
    enregistrerScan({
        route, userId, motifEchec, imageUrl, vintedUrl,
        rembourse: rembourse != null ? Boolean(rembourse) : null,
        // ⚠️ LES REFUS ÉTAIENT BEAUCOUP PLUS PAUVRES QUE LES SUCCÈS, alors que ce sont eux
        // qu'on cherche à comprendre. Mesuré le 2026-08-15 sur le refus « Dark Kadabra » :
        // impossible de savoir depuis le journal si la règle du Pokédex s'était déclenchée,
        // ni ce que l'IA avait lu du motif — il a fallu RECALCULER `estDex` hors ligne pour
        // répondre. Un champ qu'on doit recalculer pour lire une ligne n'est pas journalisé.
        //
        // ⚠️ `raisonReserve` N'EST PAS DANS CETTE LISTE, ET C'EST DÉLIBÉRÉ. Elle n'existe
        // pas au moment d'un refus : elle est calculée bien plus bas, sur un prix qu'on va
        // LIVRER, à partir d'un gagnant qu'un refus n'a pas. En inventer une ici
        // fabriquerait une valeur qui n'a jamais existé dans la décision — et c'est
        // précisément le défaut qu'on vient de corriger deux fois cette semaine (un champ
        // lu hors du moment où il est rempli). Ce qui EXISTE au moment du refus, ce sont
        // les faits ci-dessous, et c'est eux qu'on écrit.
        reverseLu: reverseLu != null ? Boolean(reverseLu) : null,
        motifIA: motifIA ?? c.motif ?? null,
        estDex: estDex != null ? Boolean(estDex) : null,
        exAequoIds, vivierIds, vivierTaille, messageErreur,
        // Tout ce que l'IA avait lu. Sur 'ia-echec' tout reste nul, et c'est l'information :
        // la lecture elle-même a échoué, il n'y a rien à reprocher à l'aval.
        nom: c.name, numero: c.number, total: c.total,
        setCode: c.setCode, langue: c.language, rarete: c.rarete,
        nomBrut: c.nomBrut, nomConfiance: c.nomConfiance,
        // ⚠️ LES REFUS NE PORTAIENT PRESQUE RIEN, et personne ne l'avait vu parce qu'on ne
        // les mesurait jamais. Mesuré le 2026-08-11 sur les 17 refus par égalité parfaite :
        // nbCandidats 0/17 · nbExAequo 0/17 · concurrentIdProduct 0/17 · ecartScore 0/17.
        // Une ligne d'échec disait QUE la chaîne avait refusé, jamais CONTRE QUOI — donc
        // aucune idée d'amélioration des refus n'était évaluable sans tout rejouer.
        fourchette, nbExAequo, nbCandidats, prixVinted
    });
}

module.exports = { enregistrerScan, enregistrerEchec, JournalScan, RETENTION_JOURS };
