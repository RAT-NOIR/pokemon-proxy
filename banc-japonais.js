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
const { EXPANSIONS_VINTAGE, setCodeCompatibleVintage } = require('./sets-vintage-japonais');
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
const VERITE = {
    JP001: 562000,   // Charmander  -> MCDP-004     (McDonalds-Original-Minimum-Pack)
    JP002: 654781,   // Wartortle   -> EC1-S19      (Base-Expansion-Pack)
    JP007: 654781,   // Wartortle   -> EC1-S19      (même carte que JP002)
    JP003: 653962,   // Rhydon      -> EC4-055 V2   (Split-Earth)
    JP009: 651965,   // Porygon2    -> EC2-063      (The-Town-on-No-Map)
    JP017: 653910,   // Flareon     -> EC4-017 V2   (Split-Earth, holo)
    JP026: 606835,   // Light Jolteon -> N4         (Darkness-and-to-Light)
    JP031: 606847,   // Dark Haunter  -> N4         (Darkness-and-to-Light)
    JP036: 571754,   // Mew         -> SI-JP        (Southern-Islands-JP)
    JP004: 'inconnu', // Ledian holo : V1 ou V2 indéterminable, annonce disparue
    JP030: 'inconnu', // Meowth : ROG ou EC4-062 ?
    JP034: 'inconnu'  // Misty's Staryu : carte non retrouvée
};

// ⚠️ VÉRITÉS DONNÉES PAR NOM, PAS PAR CLÉ. Le testeur a fourni cinq cartes sous forme
// d'URL Cardmarket sans les rattacher à un numéro de ligne. Sans cette table, elles
// tombaient dans le cas « absente de VERITE -> attendu = ce que la production avait
// retenu » — c'est-à-dire `null`, puisque ces cinq scans avaient ÉCHOUÉ. Le banc comptait
// donc l'échec comme la bonne réponse, et affichait une identification correcte comme une
// régression. Un banc qui prend l'échec pour la vérité est pire qu'un banc absent.
// ════════════════════════════════════════════════════════════════════════════
// LA FRONTIÈRE ENTRAÎNEMENT / HOLDOUT
// ════════════════════════════════════════════════════════════════════════════
// Tout scan enregistré À PARTIR de cette date appartient au lot frais. La frontière est une
// DATE et non une liste : une liste se complète après coup, une date non — c'est ce qui
// empêche de reclasser une carte du mauvais côté quand le résultat déplaît.
// ⚠️ NE JAMAIS LA RECULER. La reculer reviendrait à faire entrer dans l'entraînement des
// cartes qui ont décidé, ou l'inverse.
const DATE_HOLDOUT = new Date('2026-08-03T00:00:00Z');

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
const FENETRES_HORS_SERVICE = [
    {
        versions: ['fe9f77df0f8f', '746eedf203e5', 'd6c340b39ae7'],
        defaut: 'nomExact reprenait le nom TCGdex dans la langue de la route ; le catalogue anglais était interrogé en japonais',
        corrigePar: '83789c2'
    }
];
const VERSIONS_HORS_SERVICE = new Set(FENETRES_HORS_SERVICE.flatMap(f => f.versions));
const estHorsService = d => d.version != null && VERSIONS_HORS_SERVICE.has(String(d.version));

// Les vérités saisies à la main par saisir-verites.js, indexées par clé. Elles portent leur
// provenance — 'saisie-a-l-aveugle' ou 'saisie-apres-candidats' — et le rapport la reprend :
// une vérité obtenue après avoir vu la liste des candidats ne vaut pas la même chose.
let VERITES_SAISIES = {};
try { VERITES_SAISIES = require('./banc-verites.json').verites || {}; } catch (_) { }

let VERIFICATION = [];
try {
    VERIFICATION = (require('./banc-verification.json').cartes || [])
        .map(c => ({ ...c, declareLe: new Date(c.declareLe) }));
} catch (_) { /* fichier absent : aucun scan de vérification, le holdout prend tout */ }

function estVerification(d) {
    if (!(d.le instanceof Date)) return null;
    for (const c of VERIFICATION) {
        if (String(d.nom || '').trim() !== String(c.nom).trim()) continue;
        if (String(d.numero ?? '').trim() !== String(c.numero).trim()) continue;
        // ⚠️ LA CLAUSE QUI REND LA FRONTIÈRE INFALSIFIABLE : déclarée AVANT le scan, sinon
        // la carte reste dans le holdout.
        if (!(d.le >= c.declareLe)) continue;
        return c;
    }
    return null;
}

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
let FENETRES_LOTS = [];
try {
    FENETRES_LOTS = (require('./banc-lots.json').fenetres || []).map(f => ({
        ...f,
        debut: new Date(f.debut),
        fin: f.fin ? new Date(f.fin) : null
    }));
} catch (_) { /* fichier absent : aucune fenêtre, le holdout prend tout */ }

/** La fenêtre qui contient ce scan, ou null. Bornes : [debut, fin[ — fin exclusive. */
function fenetreDe(d) {
    if (!(d.le instanceof Date)) return null;
    for (const f of FENETRES_LOTS) {
        if (!(f.debut instanceof Date) || isNaN(f.debut)) continue;
        if (d.le < f.debut) continue;                    // clause 1 : postérieurs seulement
        if (f.fin && d.le >= f.fin) continue;
        return f;
    }
    return null;
}

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

const VERITE_PAR_NOM = {
    'Raichu': 654243,          // Intro-Pack-Bulbasaur/Raichu-IPB3
    "Koga's Ditto": 605387,    // Challenge-from-the-Darkness/Kogas-Ditto-CFTD
    'Tangela': 557645,         // Expansion-Pack/Tangela
    'Dragonite': 698502,       // Cry-from-the-Mysterious/Dragonite-Lv61-DP5c
    'Jigglypuff': 584684       // Pokemon-Jungle (PJU), « Jungle, No.039 »
};

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
    // ORDRE : du plus SPÉCIFIQUE au plus général. La déclaration par carte
    // (VERIFICATION) l'emporte sur la fenêtre, qui l'emporte sur le holdout. Chacune ne
    // peut que retirer du holdout — jamais y ajouter.
    const seauDe = d => {
        if (!(d.le instanceof Date) || d.le < DATE_HOLDOUT) return 'entrainement';
        if (estVerification(d)) return 'verification';
        if (fenetreDe(d)) return 'lot';
        return 'holdout';
    };
    // ⚠️ LES LIGNES HORS SERVICE SONT ÉCARTÉES **AVANT** LE DÉDOUBLONNAGE, et c'est le point
    // qui compte : le dédoublonnage garde la PREMIÈRE ligne vue. Si une ligne cassée restait
    // dans le lot, elle masquerait sa remplaçante — la carte rescannée après correction
    // n'apparaîtrait jamais. Une ligne hors service ne doit ni compter, NI MASQUER SA
    // REMPLAÇANTE.
    const horsService = docs.filter(estHorsService);
    const exploitables = docs.filter(d => !estHorsService(d));
    const vues = new Map();
    for (const d of exploitables) {
        const seau = seauDe(d);
        const asiatique = ['JP', 'ZH', 'KR'].includes(d.langue);
        // L'entraînement reste japonais ; le holdout accueille aussi les 10 occidentales
        // de contrôle, sans quoi une régression occidentale serait invisible.
        if (seau === 'entrainement' && !asiatique) continue;
        const k = `${seau}|${d.nom ?? ''}|${d.numero ?? ''}|${d.setCode ?? ''}|${d.total ?? ''}`;
        if (!vues.has(k)) vues.set(k, d);
    }
    const tous = [...vues.values()];
    const seulementHoldout = process.argv.includes('--holdout');
    const prefixe = { entrainement: 'JP', holdout: 'H', verification: 'V', lot: 'L' };
    const compteurs = { entrainement: 0, holdout: 0, verification: 0, lot: 0 };
    const bancs = tous
        .filter(d => !seulementHoldout || seauDe(d) === 'holdout')
        .map(d => { const s = seauDe(d); return { cle: `${prefixe[s]}${String(++compteurs[s]).padStart(3, '0')}`, d, seau: s }; });
    const n = s => tous.filter(d => seauDe(d) === s).length;
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
                const eg = r.scores.length > 1 && r.scores[0].score === r.scores[1].score;
                if (r.scores.length && !eg) {
                    retenu = r.scores[0].candidat.idProduct;
                    voie = 'perimetre-vintage';
                    incertain = true;   // suggestion avertie, arbitrage F
                    return { retenu, incertain, voie };
                }
                // Égalité dans le périmètre : on retombe sur la règle de l'égalité.
                if (eg) {
                    const prix = r.scores.filter(s => s.score === r.scores[0].score).map(s => s.candidat.prix).filter(p => Number.isFinite(p) && p > 0);
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
                const r = await scorerCandidatsLocal(avis.preuves, cardInfo, null, [], cs, {});
                const eg = r.scores.length > 1 && r.scores[0].score === r.scores[1].score;
                if (r.scores.length && !eg) { retenu = r.scores[0].candidat.idProduct; voie = 'veto-nom-reclasse'; }
                else { retenu = null; voie = 'REFUS-veto'; incertain = true; }
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
        if (VERITE[cle] !== undefined) return { valeur: VERITE[cle], source: VERITE[cle] === 'inconnu' ? 'inconnu' : 'cle' };
        if (VERITE_PAR_NOM[d.nom] !== undefined) return { valeur: VERITE_PAR_NOM[d.nom], source: 'nom' };
        if (VERITES_SAISIES[cle] !== undefined) {
            const v = VERITES_SAISIES[cle];
            return { valeur: v.idProduct, source: v.idProduct === 'inconnu' ? 'inconnu' : `saisie:${v.source}` };
        }
        if (d.idProduct == null) return { valeur: null, source: 'SANS-VERITE' };
        return { valeur: d.idProduct, source: 'bloc' };
    }

    // DEUX JEUX DE COMPTEURS, jamais mélangés : entraînement et holdout.
    const vide = () => ({
        avant: { juste: 0, faux: 0, refus: 0, signale: 0 },
        apres: { juste: 0, faux: 0, refus: 0, signale: 0 },
        lec: { juste: 0, contredite: 0, 'invérifiable': 0 },
        provenance: { cle: 0, nom: 0, bloc: 0, inconnu: 0, 'SANS-VERITE': 0, TECHNIQUE: 0 },
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
        R.avant[iAvant]++; R.apres[iApres]++;
        if (iAvant === 'faux' && d.carteIncertaine) R.avant.signale++;
        if (iApres === 'faux' && a.incertain) R.apres.signale++;
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
        console.log('── TAUX DE LECTURE IA ──');
        console.log(`   juste (nom ET numéro confirmés) . ${String(L.lec.juste).padStart(3)}  ${p(L.lec.juste)}`);
        console.log(`   CONTREDITE par la carte attendue  ${String(L.lec.contredite).padStart(3)}  ${p(L.lec.contredite)}`);
        console.log(`   invérifiable (numéro non publié) . ${String(L.lec['invérifiable']).padStart(3)}  ${p(L.lec['invérifiable'])}`);
        console.log('\n── TROIS ISSUES, JAMAIS DEUX ──');
        console.log('                     AVANT          APRÈS');
        console.log(`   JUSTE ......... ${String(L.avant.juste).padStart(3)}  ${p(L.avant.juste).padStart(7)}   ${String(L.apres.juste).padStart(3)}  ${p(L.apres.juste).padStart(7)}`);
        console.log(`   FAUX .......... ${String(L.avant.faux).padStart(3)}  ${p(L.avant.faux).padStart(7)}   ${String(L.apres.faux).padStart(3)}  ${p(L.apres.faux).padStart(7)}`);
        console.log(`     dont signalé  ${String(L.avant.signale).padStart(3)}              ${String(L.apres.signale).padStart(3)}`);
        console.log(`     FAUX ET AFFIRMÉ ${String(L.avant.faux - L.avant.signale).padStart(2)}              ${String(L.apres.faux - L.apres.signale).padStart(3)}   ← le seuil de lancement`);
        console.log(`   REFUS ......... ${String(L.avant.refus).padStart(3)}  ${p(L.avant.refus).padStart(7)}   ${String(L.apres.refus).padStart(3)}  ${p(L.apres.refus).padStart(7)}   (remboursés, aucun prix montré)`);

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
