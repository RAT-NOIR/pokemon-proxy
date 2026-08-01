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

    // --- CE QUI A ÉTÉ RETENU (la sortie) ---
    idProduct: Number,
    codeSetGagnant: String,   // code de set réel du produit retenu
    numeroGagnant: String,    // son numéro en base
    score: Number,
    nbCandidats: Number,
    confiance: String,        // 'haute' | 'basse'
    carteIncertaine: Boolean,
    sourceIdentification: String, // 'nom' | 'total+numero' | 'catalogue-local'
    // true = identifiée SANS TCGdex, donc sans variantsDetailed : le motif de reverse n'a
    // pas pu être routé. À compter séparément, c'est une identification dégradée.
    identifieeEnLocal: Boolean,
    voieCatalogue: String,        // 'nom' | 'numero'
    motifEtat: String,            // 'resolu' | 'aucun-motif' | 'non-resolu'

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
    prixVinted: Number,
    prixReference: Number,
    ratio: Number,
    // D'OÙ vient le prix de référence : 'guide-local' | 'tcgdex' | 'cache'. Sans lui,
    // un ratio aberrant serait indiscernable d'un simple repli sur une source moins
    // précise, et on tirerait un seuil d'une comparaison qui n'en est pas une.
    sourcePrix: String,

    // --- DÉSACCORD DE CODE SET ---
    // true  : l'IA a lu un code et il correspond à celui du gagnant
    // false : elle en a lu un et il ne correspond pas
    // null  : elle n'a rien lu, ou le code du gagnant est inconnu -> hors mesure
    setCodeAccord: Boolean
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
 * @returns {void}    ne renvoie rien exprès, pour qu'aucun appelant ne soit tenté d'attendre
 */
function enregistrerScan(d = {}) {
    // Pas de connexion : on sort en silence. Le scan, lui, a pu aboutir (guide en
    // cache, repli TCGdex) — ce n'est pas à la statistique de le faire échouer.
    if (mongoose.connection.readyState !== 1) return;

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
            le: new Date(),
            route: d.route || null,
            userId: d.userId || null,
            // Bornées : une URL Vinted fait ~120 caractères, une URL d'image ~200. Le
            // plafond protège d'un corps de requête fabriqué qui gonflerait la collection.
            imageUrl: d.imageUrl ? String(d.imageUrl).slice(0, 500) : null,
            vintedUrl: d.vintedUrl ? String(d.vintedUrl).slice(0, 500) : null,
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
            confiance: d.confiance || null,
            carteIncertaine: d.carteIncertaine != null ? Boolean(d.carteIncertaine) : null,
            sourceIdentification: d.sourceIdentification || null,
            identifieeEnLocal: d.identifieeEnLocal != null ? Boolean(d.identifieeEnLocal) : null,
            nomConfiance: d.nomConfiance || null,
            nomBrut: d.nomBrut || null,
            voieCatalogue: d.voieCatalogue || null,
            motifEtat: d.motifEtat || null,
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
            rangGagnant: Number.isFinite(d.rangGagnant) ? d.rangGagnant : null,
            ecartScore: Number.isFinite(d.ecartScore) ? d.ecartScore : null,
            prixVinted, prixReference, ratio,
            sourcePrix: d.sourcePrix || null,
            setCodeAccord: memeCode(d.setCode, codeSetGagnant)
        });
    })().catch(e => {
        // Trace, jamais de propagation. Un journal muet vaut mieux qu'un scan cassé.
        console.warn(`⚠️ [journal-scans] écriture impossible : ${e.message}`);
    });
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
function enregistrerEchec({ route, userId, cardInfo, motifEchec, rembourse, imageUrl, vintedUrl } = {}) {
    const c = cardInfo || {};
    enregistrerScan({
        route, userId, motifEchec, imageUrl, vintedUrl,
        rembourse: rembourse != null ? Boolean(rembourse) : null,
        // Tout ce que l'IA avait lu. Sur 'ia-echec' tout reste nul, et c'est l'information :
        // la lecture elle-même a échoué, il n'y a rien à reprocher à l'aval.
        nom: c.name, numero: c.number, total: c.total,
        setCode: c.setCode, langue: c.language, rarete: c.rarete,
        nomBrut: c.nomBrut, nomConfiance: c.nomConfiance
    });
}

module.exports = { enregistrerScan, enregistrerEchec, JournalScan, RETENTION_JOURS };
