require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');

// CHEMIN ARGENT : décompte et remboursement d'un scan. Extrait dans son propre module
// pour qu'il n'existe qu'UNE implémentation, exécutée à l'identique par le serveur et
// par test-acces.js. Tant que le test en recopiait la logique, la copie pouvait diverger
// du vrai code sans que rien ne le signale.
const {
    Credit, QuotaSemaine,
    exigerImage, verifierAcces, rembourserScan, signalerIncertain,
    semaineISO, SCANS_ACCUEIL, SCANS_GRATUITS_SEMAINE
} = require('./acces');

// ⚠️ LE MODULE ENTIER, en plus de la déstructuration. Il existe pour UNE raison :
// `setCodeCompatibleVintage` reçoit un « scoring » en paramètre et y déstructure les
// fonctions dont il a besoin. Cette ligne passait un objet FABRIQUÉ À LA MAIN avec trois
// fonctions sur quatre — production morte au premier setCode hors table close
// (« memeCodeParConventionX is not a function »), pendant que les 52 tests de la table et
// les 32 du chemin par le code passaient au vert : EUX passaient le module entier.
// Un stub fabriqué à la main est une SECONDE source de vérité qui diverge en silence
// (deuxième principe) — et ici la divergence était invisible parce que les deux appelants
// ne recevaient pas le même objet. On passe le module, jamais un extrait : ajouter une
// fonction dans sets-vintage-japonais.js ne peut plus casser index.js.
const SCORING = require('./scoring');
const {
    choisirMeilleur,
    analyserVariantes, resoudreMotif, motifDuTitre, normaliserTotal,
    prixDeReference, impressionEstReverse,
    setsCompatiblesAvecTotal, comparerNumeros,
    // rangDuNumero ne pilote encore RIEN : il ne sert qu'aux traces et au journal,
    // le temps de mesurer la fréquence réelle du rang 3 avant le point 4.
    rangDuNumero, bilanDesRangs, normaliserCodeSet, codesApparentes,
    regionDuCodeSet,
    // numeroDepuisSlug : /api/apprendre-lot recalcule le numeroUrl lui-même plutôt que
    // de faire confiance au client. L'oubli de cet import a cassé l'endpoint en
    // production — node --check ne valide que la SYNTAXE, pas la résolution des noms.
    numeroDepuisSlug,
    // ALIAS_CODES_LUS : le marquage physique e-Reader (E1..E5) n'est pas le code
    // Cardmarket (EC1..EC5). L'alias porte sur le code LU, jamais sur celui de la base.
    // nomConcorde : moitié PURE du veto par le nom, voir nomOpposeUnVeto plus bas.
    ALIAS_CODES_LUS, nomConcorde, LANGUES_ASIATIQUES, memeCodeParConventionX, sontExAequo,
    // numeroAmbiguDansPerimetre : règle GÉNÉRALE des préfixes alphabétiques. Une clé
    // (code + numéro) ne doit pas se déclencher quand « 019 » et « S19 » coexistent.
    numeroAmbiguDansPerimetre,
    MOTIFS_CIBLABLES
} = require('./scoring');

// Journal des scans : une ligne par identification, en base. Les logs Render sont
// éphémères ; les seuils qu'on pose (ratio, rangs, fiabilité du setCode) ont besoin de
// données qui survivent au redéploiement. Jamais sur le chemin critique — voir le module.
// `JournalScan` : le modèle lui-même, pour /api/retour-live qui COMPLÈTE une ligne déjà
// écrite. C'est la seule route qui touche au journal autrement qu'en y ajoutant — d'où
// les trois gardes qui l'entourent, et l'écriture conditionnelle plutôt qu'un update sec.
const { enregistrerScan, enregistrerEchec, JournalScan, VERSION } = require('./journal-scans');

// « Rien trouvé » et « pas pu chercher » sont deux états, jamais un seul. Voir sources.js :
// six requêtes catalogue rendaient `[]` dans les deux cas, et l'aval lisait ce vide comme
// un fait sur le catalogue.
const { interrogerSource, dansUnScan, sourcesTombees,
    noterNonRemboursement, raisonNonRemboursement } = require('./sources');

// La cause racine du vintage japonais : sur les cartes de 1996-2003, le nombre imprimé
// est le numéro de Pokédex de l'espèce, pas le rang de la carte dans son set. Voir pokedex.js.
const { numeroEstUnDexId } = require('./pokedex');

// La table close des sets japonais vintage — écrite à la main, vérifiée ligne à ligne.
// Elle ne pilote PAS encore l'identification : elle sert à lever l'ambiguïté des
// identifiants TCGdex partagés. Voir sets-vintage-japonais.js.
const { EXPANSIONS_VINTAGE, setCodeCompatibleVintage, departagerParSymbole } = require('./sets-vintage-japonais');
// Le départage par l'image. Renommé à l'import pour qu'aucune relecture ne le confonde
// avec `departagerParSymbole` juste au-dessus : les deux tranchent une égalité, sur des
// signaux sans rapport, et l'un est prioritaire sur l'autre (voir le branchement).
const { departager: departagerParImage } = require('./departage-image');
// Le troisième départage d'égalité, écrit le 2026-09-05 sur la forme EXACTE du symbole.
// Il ne touche aucun score : il choisit dans une égalité que le scoring déclare parfaite.
// Voir departage-attaque.js — les quatre verrous et le traitement du non-latin y sont écrits.
const { departagerParAttaque } = require('./departage-attaque');

// Identification de repli, dans le SEUL catalogue local, quand TCGdex ne connaît pas la
// carte (les e-Series japonaises en sont absentes) ou quand le nom n'est pas fiable.
// Testée en bac à sable par test-identification-locale.js.
const { identifierEnLocal } = require('./identification-locale');

const app = express();
app.set('trust proxy', 1); // Render est derrière un proxy → nécessaire pour lire la vraie IP côté rate-limit
const PORT = process.env.PORT || 3000;

// SÉCURITÉ : sans restriction, n'importe quel site ouvert dans ton navigateur
// pourrait appeler ce serveur local et brûler tes crédits IA / déclencher du
// scraping en ton nom.
// ⚠️ Un content script s'exécute DANS la page : sa requête porte donc l'origine
//    de la page (https://www.vinted.fr) et NON "chrome-extension://".
const ORIGINES_AUTORISEES = [
    /^chrome-extension:\/\/[a-p]+$/,                       // l'extension elle-même
    /^https:\/\/(www\.)?vinted\.(fr|be|com|de|es|it|nl|lu|at|pl|pt|se|cz|sk|lt|uk)$/ // Vinted, domaines officiels
];
app.use(cors({
    origin: (origin, callback) => {
        // Pas d'origine = appel direct (curl, tests locaux) -> autorisé
        if (!origin) return callback(null, true);
        if (ORIGINES_AUTORISEES.some(re => re.test(origin))) return callback(null, true);
        console.warn(`🚫 Requête refusée depuis une origine non autorisée : ${origin}`);
        return callback(new Error('Origine non autorisée'));
    }
}));
// ════════════════════════════════════════════════════════════════════════════
// LE CONTEXTE DE SCAN — EN TOUT PREMIER, AVANT LA MOINDRE ROUTE
// ════════════════════════════════════════════════════════════════════════════
// Il ouvre le contexte dans lequel `interrogerSource` retient les sources tombées
// (sources.js). Sans lui, `sourcesTombees()` rendrait toujours [] et la requalification
// des refus d'absence serait inerte SANS LE DIRE.
//
// ⚠️ IL EST POSÉ AVANT TOUTES LES ROUTES, Y COMPRIS LE WEBHOOK STRIPE, ET C'EST UNE
// CORRECTION. Sa première version était placée après `express.json()`, donc APRÈS la
// déclaration du webhook : cette route-là n'avait aucun contexte, et une panne qui y
// serait tombée aurait disparu en silence. Elle n'interroge aucune de ces sources
// aujourd'hui — mais « aujourd'hui » n'est pas une garantie, et un trou de couverture
// qui dépend de l'ordre de déclaration des routes est exactement le genre de piège qui
// se referme six mois plus tard. Un contexte vide ne coûte rien ; un contexte manquant
// coûte une mesure fausse.
// ⚠️ IL NE TOUCHE PAS AU CORPS DE LA REQUÊTE : il n'enveloppe que le contexte asynchrone.
// La signature Stripe, qui dépend des octets bruts, est rigoureusement inchangée.
app.use((req, res, next) => dansUnScan(next));

// ⚠️ ORDRE CRITIQUE : Stripe signe le corps BRUT de la requête. Si express.json()
// le parsait avant, l'octet-à-octet serait perdu et la vérification de signature
// échouerait systématiquement. Cette route est donc déclarée AVANT le parser JSON
// global, avec son propre express.raw(). `gererWebhookStripe` est une déclaration
// de fonction (hoistée) écrite plus bas, dans la section paiement : l'ordre des
// middlewares est garanti sans éparpiller le code Stripe en haut du fichier.
app.post('/api/webhook-stripe', express.raw({ type: 'application/json' }), gererWebhookStripe);

app.use(express.json());

// Limite anti-abus par IP : backstop indépendant du quota par utilisateur (qui, lui,
// se contourne en changeant d'identifiant). Ne s'applique QU'aux routes IA coûteuses —
// surtout pas à /ping, sinon le keep-alive cron-job se ferait jeter.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 LE MAGASIN EST EN MÉMOIRE — CE QUE « 60/H » VEUT DIRE EN VRAI
// ════════════════════════════════════════════════════════════════════════════
// MESURÉ LE 2026-09-02, en interrogeant Render pour de bon (16 requêtes 401, aucun appel
// IA). Huit requêtes IDENTIQUES ont rendu `RateLimit-Remaining` :
//     56, 56, 55, 54, 53, 52, 51, 50
// et surtout des `RateLimit-Reset` DIFFÉRENTS — 3563 s sur la deuxième, 3374 s sur toutes
// les autres. Deux origines de fenêtre = DEUX COMPTEURS INDÉPENDANTS pour la même IP.
// ⚠️ CE N'EST DONC PAS SEULEMENT « ça repart à zéro au redémarrage » : plusieurs processus
// servent en parallèle, chacun avec SON magasin mémoire, et le plafond réel vaut
// 60 × (nombre de processus). Le multi-compteur est PERMANENT, la remise à zéro est
// ponctuelle — c'est le premier qui coûte le plus cher.
//
// ✅ CE QUI EST SAIN, ET QUI A ÉTÉ VÉRIFIÉ PLUTÔT QUE SUPPOSÉ : `trust proxy` (voir
// app.set plus haut). Trois requêtes portant un `X-Forwarded-For` FORGÉ identique ont
// rendu 49, 48, 47 — elles CONTINUENT la série au lieu d'ouvrir un compteur neuf. Le XFF
// du client est donc ignoré et `req.ip` est la vraie adresse : ni sur-blocage, ni
// sous-blocage. La bonne forme de cette vérification est celle-là — forger l'en-tête et
// regarder si un seau neuf apparaît, pas lire le code et conclure.
//
// LA DÉCISION PRISE : forcer UNE SEULE INSTANCE sur Render. Zéro code, zéro dépendance,
// zéro mode d'échec nouveau, et ça supprime le multi-compteur, qui est le défaut permanent.
//
// 📌 LE REPLI, POUR PLUS TARD, ET LA FORMULATION EST À GARDER MOT POUR MOT :
//     magasin Mongo avec repli mémoire quand Mongo est absent, jamais « ouvrir en grand »
//     ni « fermer tout » — le comportement dégradé doit être le comportement actuel,
//     jamais pire.
// « Ouvrir en grand » supprimerait la seule borne de coût au moment le plus dangereux ;
// « fermer tout » transformerait une panne Mongo en panne totale du service. Le repli
// mémoire, lui, ramène exactement à l'état d'aujourd'hui : on perd le partage entre
// instances, on ne perd jamais la borne.
const limiteurIA = rateLimit({
    windowMs: 60 * 60 * 1000,   // fenêtre : 1 heure
    max: 60,                    // 60 requêtes/h/IP (large pour un usage normal, coupe le pilonnage)
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de requêtes, réessaie plus tard.' }
});
app.use(['/api/identifier', '/api/analyser'], limiteurIA);

// Limiteur dédié à la création de Checkout Sessions. Le jeton partagé est
// extractible de l'extension distribuée : sans ce garde-fou, n'importe qui pourrait
// faire créer des milliers de sessions Stripe. 20/h/IP laisse largement la place à
// un achat normal (et à quelques hésitations/retours en arrière).
const limiteurPaiement = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de tentatives de paiement, réessaie plus tard.' }
});

// Jeton partagé entre l'extension et le serveur. Empêche une page web d'utiliser
// ton serveur même si elle contournait le CORS. À définir dans le .env :
//   JETON_API=une_chaine_longue_et_aleatoire
// et à recopier dans content.js. Si absent, la protection est simplement inactive.
const JETON_API = process.env.JETON_API || null;
if (!JETON_API) {
    console.warn("⚠️ Aucun JETON_API défini dans .env — le serveur accepte toute requête locale.");
}
function verifierJeton(req, res, next) {
    if (!JETON_API) return next();
    if (req.headers['x-jeton'] === JETON_API) return next();
    console.warn("🚫 Requête refusée : jeton absent ou invalide.");
    return res.status(401).json({ success: false, error: "Non autorisé" });
}

// ============================================================
// CONFIG — à ajuster facilement
// ============================================================

// Durée pendant laquelle on fait confiance à un prix en cache avant de re-scraper
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// ════════════════════════════════════════════════════════════════════════════
// LE POINT DE CONVERSION UNIQUE DES MONTANTS — 2026-09-01
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ `toFixed(2)` REND UN SÉPARATEUR ANGLAIS. Écrit dans une phrase française, il produit
// « 1.62 € » — et c'est ce que le testeur lit dans son historique, parce que ces phrases
// partent telles quelles à l'extension dans le champ `error`.
// UN SEUL POINT DE CONVERSION, pas un `replace` à chaque site : un formatage recopié sur
// six sites est un formatage oublié sur l'un des six, et celui-là ne se verra que dans
// l'interface d'un utilisateur.
// `toLocaleString('fr-FR')` fait la virgule ET l'espace insécable des milliers.
const euros = n => Number.isFinite(n)
    ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : '—';

// Seuils pour le verdict "bonne affaire" (ratio prixVinted / prixCardmarket)
const SEUIL_BONNE_AFFAIRE = 0.80; // 20% moins cher ou plus -> bonne affaire
const SEUIL_PRIX_CORRECT  = 1.10; // jusqu'à 10% plus cher -> prix correct
// au-dessus de SEUIL_PRIX_CORRECT -> trop cher

// Modèle IA pour lire la carte (OCR + extraction). google/gemini-3-flash-preview
// = génération 3, en tête de l'OCR Arena, à 0,50 $/3 $ le M tokens (~3x moins
// cher que la 3.5-flash stable). ⚠️ C'est une PREVIEW : elle peut changer de
// comportement ou disparaître sans préavis — si erreur "model not found" ou
// résultats qui se dégradent d'un coup, repasse sur "google/gemini-3.5-flash"
// (stable, plus chère). L'ancien "google/gemini-2.5-flash" est arrêté oct. 2026.
const MODELE_IA = "google/gemini-3-flash-preview";

// ============================================================
// MONGODB — connexion + schéma de cache
// ============================================================

// ⚠️ EXCEPTION ASSUMÉE à la règle « nommer la base ou refuser » (mongo-connexion.js).
// Le serveur, lui, DOIT tourner sur la production : exiger MONGODB_BASE ici casserait
// le déploiement Render tant que la variable n'y est pas posée. Le compromis :
//   - le nom de la base est TOUJOURS affiché au démarrage (c'est ce qui manquait) ;
//   - si MONGODB_BASE est défini, il fait foi ET un écart est fatal.
// Poser MONGODB_BASE=test sur Render active donc le refus, sans risque de coupure.
if (!process.env.MONGODB_URI) {
    console.error("⚠️  MONGODB_URI n'est pas défini dans les variables d'environnement Render. Le cache sera désactivé.");
} else {
    const baseVoulue = (process.env.MONGODB_BASE || '').trim() || null;
    mongoose.connect(process.env.MONGODB_URI, baseVoulue ? { dbName: baseVoulue } : {})
        .then(() => {
            const reelle = mongoose.connection.db.databaseName;
            console.log(`✅ MongoDB connecté — base "${reelle}"${baseVoulue ? '' : ' (non nommée : défaut de l\'URI)'}`);
            if (baseVoulue && reelle !== baseVoulue) {
                console.error(`❌ ARRÊT : base "${reelle}" alors que MONGODB_BASE="${baseVoulue}".`);
                process.exit(1);
            }
        })
        .catch(err => console.error("❌ Erreur connexion MongoDB:", err.message));
}

const cardPriceSchema = new mongoose.Schema({
    name: { type: String, required: true },       // nom EN de la carte, normalisé en minuscule
    number: { type: String, required: true },      // numéro de collection
    language: { type: String, required: true },    // EN, FR, JP, ...
    price: { type: Number, required: true },       // prix Cardmarket en EUR
    url: { type: String, required: true },          // lien vers la fiche Cardmarket
    updatedAt: { type: Date, default: Date.now }
});
cardPriceSchema.index({ name: 1, number: 1, language: 1 }, { unique: true });

const CardPrice = mongoose.model('CardPrice', cardPriceSchema);

// Catalogue produits Cardmarket (importé via import-catalogue.js)
const catalogueProduitSchema = new mongoose.Schema({
    idProduct: Number, name: String, idExpansion: Number, idMetacard: Number
});
// Alignés sur ce qu'import-catalogue.js déclare déjà pour cette même collection (un
// index Mongo appartient à la collection, pas au schéma qui s'y connecte — il existe
// donc peut-être déjà côté Atlas si l'import a tourné ; cette déclaration comble
// l'oubli côté serveur, sans risque : Mongoose ne fait rien si l'index existe déjà,
// sinon le construit en tâche de fond. Pas d'index sur `name` : les 2 recherches du
// serveur sont des regex insensibles à la casse (voir chercherPrixCatalogueLocal et
// trouverProduitsLocaux), qu'un index classique n'accélère pas — l'ajouter coûterait
// du stockage (Atlas peut être sur un palier limité) pour aucun gain de requête réel.
//
// ⚠️ `idMetacard` RETIRÉ LE 2026-08-30 — et la trace reste pour qu'il ne revienne pas.
// L'index pesait 3 076 Ko et n'était interrogé par RIEN : `idMetacard` n'est jamais un
// critère de requête, il est lu comme CHAMP de documents ramenés par un autre critère puis
// groupé en mémoire (voir `chercherPrixCatalogueLocal`, plus bas). Un index ne sert pas à
// lire un champ, il sert à le chercher.
// 🔴 ET IL ÉTAIT DÉCLARÉ DEUX FOIS — ici et dans import-catalogue.js. Le retirer d'un seul
// des deux n'aurait rien libéré : `autoIndex` est actif par défaut et rien ne le désactive
// dans ce dépôt, donc cette ligne-ci le recréait À CHAQUE DÉMARRAGE DU SERVEUR — sur un
// plan Render gratuit, à chaque réveil après 15 minutes d'inactivité. Pas « au prochain
// import » : toutes les quinze minutes d'inactivité.
// La suppression en base se fait par `maintenance-index.js`, qui refuse de tourner tant
// qu'une de ces déclarations existe.
catalogueProduitSchema.index({ idExpansion: 1 });
catalogueProduitSchema.index({ idProduct: 1 });
const CatalogueProduit = mongoose.model('CatalogueProduit', catalogueProduitSchema, 'catalogue_produits');

// Guide des prix Cardmarket (importé via import-price-guide.js)
const guidePrixSchema = new mongoose.Schema({
    idProduct: Number, avg: Number, low: Number, trend: Number,
    avg1: Number, avg7: Number, avg30: Number,
    avgHolo: Number, lowHolo: Number, trendHolo: Number
});
// Requêtes réelles sur idProduct : getPrixGuideLocal/getPrixGuideLocalLot, à chaque identification.
guidePrixSchema.index({ idProduct: 1 });
const GuidePrix = mongoose.model('GuidePrix', guidePrixSchema, 'guide_prix');

// Codes set appris au fil de l'eau (idExpansion Cardmarket -> code court type "TWM").
// Rempli automatiquement quand le module live lit une fiche : on ne redécouvre
// jamais deux fois le code d'un même set.
const codeSetSchema = new mongoose.Schema({
    idExpansion: { type: Number, required: true, unique: true },
    codeSet: { type: String, required: true },
    apprisLe: { type: Date, default: Date.now }
});
const CodeSet = mongoose.model('CodeSet', codeSetSchema, 'codes_set');

// Numéros de collection appris set par set (via apprendre-set.js).
// Le catalogue Cardmarket ne contient PAS les numéros : sans cette table, on ne
// peut pas savoir lequel des 18 "M Kangaskhan EX" est le #79.
const numeroCarteSchema = new mongoose.Schema({
    idProduct: { type: Number, required: true, unique: true },
    idExpansion: Number,
    numero: String,
    numeroUrl: String,
    codeSet: String,
    nomFr: String,
    variante: String,
    slug: String,
    slugSet: String,
    source: String,      // 'cardmarket' (fait foi) ou 'tcgdex' (pré-rempli)
    certitude: String,   // 'exacte' ou 'heuristique'
    // ⚠️ AJOUTÉ AU SCHÉMA LE 2026-08-30 — IL ÉTAIT DÉJÀ EN BASE ET DÉJÀ INTERROGÉ.
    // `expansionsDuSetTCGdex` (ligne 2534) et `diagnosticLienTcgdex` (ligne 2115) lisent ce
    // champ depuis toujours ; il est écrit par prefill-tcgdex.js et corriger-lien-base1.js.
    // Il n'était simplement déclaré NULLE PART. Conséquence concrète découverte en voulant
    // l'indexer : on allait poser un index sur un chemin que le schéma ignore.
    // Un champ qui vit en base, qu'on lit dans une décision, et qu'aucun schéma ne nomme,
    // est invisible à toute relecture du code — c'est la même dette que `strategieReverse`
    // avant sa journalisation.
    setTcgdex: String
});
// ⚠️ DEUX INDEX AJOUTÉS LE 2026-08-30, ET LA MESURE QUI LES JUSTIFIE EST ICI POUR QU'ON
// NE LES SUPPRIME PAS « PARCE QU'ON NE VOIT PAS À QUOI ILS SERVENT ». Avant eux, mesuré
// par `explain(executionStats)` sur la base de production :
//     {idExpansion: …}  -> COLLSCAN, 69 598 documents lus pour 244 rendus, 71 ms
//     {setTcgdex: …}    -> COLLSCAN, 69 598 documents lus pour 152 rendus, 42 ms
// Soit 113 ms sur le CHEMIN D'IDENTIFICATION, à chaque scan qui passe par
// `trouverProduitsParNumero` (ligne 1843) ou `expansionsDuSetTCGdex` (ligne 2534).
// La collection ne portait que `_id_` et `idProduct_1` — 2,4 Mo pour 18,7 Mo de données,
// un rapport de ×0,1 qui aurait dû alerter : c'est l'exact opposé du ×3,1 de
// `catalogue_produits`, dont 17,9 Mo d'index n'étaient interrogés par rien.
// Coût attendu de ces deux-là : environ 2 Mo. Le solde de l'opération reste −15 Mo.
//
// 🔑 DÉCLARÉS DANS LE SCHÉMA, ET PAS SEULEMENT CRÉÉS PAR `maintenance-index.js`. Un index
// qui n'existe que dans un script de maintenance est invisible à la lecture du code, et
// une base reconstruite ne l'aurait pas. Ici, `autoIndex` (actif par défaut) les recrée
// au démarrage — c'est exactement ce qu'on veut pour CEUX-CI, et exactement ce qu'on ne
// voulait pas pour `idMetacard_1`.
numeroCarteSchema.index({ idExpansion: 1 });
numeroCarteSchema.index({ setTcgdex: 1 });
const NumeroCarte = mongoose.model('NumeroCarte', numeroCarteSchema, 'numeros_cartes');

// Événements Stripe déjà traités. Stripe REJOUE ses webhooks (retry sur timeout, ou
// simple doublon réseau) : sans cette table, un même paiement créditerait plusieurs fois.
// L'index unique sur eventId est le verrou — c'est l'insertion qui échoue (11000), pas
// une lecture préalable qui pourrait passer entre deux appels concurrents.
// ⚠️ TROU D'AUDIT CONNU, NOMMÉ LE 2026-08-19, DÉLIBÉRÉMENT NON RÉPARÉ.
// Cette table dit QU'UN événement a été traité, jamais CE QU'IL A CRÉDITÉ. Conséquence :
// un crédit double qui serait passé ne serait PAS détectable après coup. Le solde est un
// NET — crédité moins consommé — et la consommation n'est traçable que sur les lignes de
// journal qui portent un `userId` : 6 sur 172 au moment où c'est écrit. On ne peut donc
// ni reconstruire le total crédité, ni le confronter à quoi que ce soit.
//
// CE QU'IL FAUDRAIT POUR QUE ÇA DEVIENNE AUDITABLE :
//   · que ce document porte le PACK crédité (`scans`, et tant qu'à faire `userId`) ;
//   · alors la somme des événements d'un utilisateur devient confrontable à
//     « solde actuel + consommation », et un doublon se voit par simple soustraction.
//
// POURQUOI ON NE L'ÉCRIT PAS AUJOURD'HUI : cinq comptes, un seul avec un solde payant.
// La valeur d'un audit est nulle à cette échelle et deviendra réelle avec des
// utilisateurs. C'est écrit ici pour ne pas être oublié — pas pour être fait maintenant.
// ⚠️ Et ça ne change RIEN à la garantie : la déduplication, elle, est prouvée
// (index unique vérifié en base + test-webhook-stripe.js). Ce qui manque n'est pas la
// protection, c'est la capacité à constater après coup qu'elle a tenu.
const evenementStripeSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    recuLe:  { type: Date, default: Date.now }
});
const EvenementStripe = mongoose.model('EvenementStripe', evenementStripeSchema, 'evenements_stripe');

// Récupère les numéros connus pour une liste d'idProduct -> Map(idProduct => {numero, numeroUrl})
async function lireNumeros(idsProducts) {
    try {
        if (mongoose.connection.readyState !== 1 || idsProducts.length === 0) return new Map();
        const docs = await NumeroCarte.find({ idProduct: { $in: idsProducts } }).lean();
        return new Map(docs.map(d => [d.idProduct, d]));
    } catch (e) {
        console.error("Erreur lecture numéros :", e.message);
        return new Map();
    }
}

async function lireCodeSet(idExpansion) {
    try {
        if (mongoose.connection.readyState !== 1) return null;
        const doc = await CodeSet.findOne({ idExpansion });
        return doc ? doc.codeSet : null;
    } catch (e) {
        console.error("Erreur lecture codeSet:", e.message);
        return null;
    }
}

// Version groupée de lireCodeSet : un seul aller-retour Mongo pour N idExpansion au
// lieu d'un par candidat (jusqu'à ~79 fois par requête d'identification). Number()
// des deux côtés (clé de la Map ET valeur lue dans produits) : idExpansion est déclaré
// Number dans le schéma, mais Mongoose ne caste que les requêtes qu'il construit
// lui-même (findOne/$in) — une Map JS, elle, fait une égalité stricte de type, donc
// "6096" et 6096 ne matcheraient jamais si une entrée plus ancienne avait été écrite
// avec un type différent. Sans ce filet, un mismatch de type ferait taire le critère
// région (±45 points) EN SILENCE, sans la moindre erreur.
async function lireCodeSets(idsExpansion) {
    try {
        if (mongoose.connection.readyState !== 1) return new Map();
        const uniques = [...new Set(idsExpansion.filter(e => e != null).map(Number))];
        if (uniques.length === 0) return new Map();
        const docs = await CodeSet.find({ idExpansion: { $in: uniques } }).lean();
        return new Map(docs.map(d => [Number(d.idExpansion), d.codeSet]));
    } catch (e) {
        console.error("Erreur lecture codeSets (lot):", e.message);
        return new Map();
    }
}

// Régions DÉRIVÉES, lues dans codes_set. C'est la seule source d'où peut venir un verdict
// « occidental » : scoring.regionDuCodeSet ne le déduit plus de la casse du code, parce
// que cette présomption se trompait sur 4620 produits japonais. La dérivation, elle,
// compare le nom d'expansion Cardmarket au catalogue international de TCGdex — et son
// origine est tracée dans le champ regionSource, consultable en base.
// Absence = région inconnue = critère NEUTRE. Voir deriver-region.js.
async function lireRegions(idsExpansion) {
    try {
        if (mongoose.connection.readyState !== 1) return new Map();
        const uniques = [...new Set(idsExpansion.filter(e => e != null).map(Number))];
        if (uniques.length === 0) return new Map();
        const docs = await CodeSet.find({ idExpansion: { $in: uniques } }, { idExpansion: 1, region: 1 }).lean();
        // Même précaution de type que lireCodeSets : un mismatch ferait taire le critère
        // région (±45 points) en silence.
        return new Map(docs.filter(d => d.region).map(d => [Number(d.idExpansion), d.region]));
    } catch (e) {
        console.error("Erreur lecture régions (lot):", e.message);
        return new Map();
    }
}

// Un codeSet arrive presque toujours d'une URL d'image Cardmarket, donc URL-ENCODÉ
// ("SV-P%2FCS" pour "SV-P/CS", "K%2BK" pour "K+K"). On décode À L'ENTRÉE, une bonne
// fois : stocké encodé, le "%2F" survit à la normalisation du scoring ("SVP2FCS" au
// lieu de "SVPCS") et casse la comparaison de set. Point d'entrée unique, appliqué à
// TOUS les chemins d'écriture (/api/apprendre, /api/apprendre-lot, memoriserCodeSet).
// Une séquence malformée ("100%") est laissée telle quelle plutôt que de faire échouer
// l'apprentissage. Voir nettoyer-codeset.js pour le rattrapage de l'existant.
function decoderCodeSet(codeSet) {
    if (!codeSet) return codeSet;
    const s = String(codeSet);
    if (!s.includes('%')) return s;
    try { return decodeURIComponent(s); } catch (_) { return s; }
}

async function memoriserCodeSet(idExpansion, codeSetBrut) {
    const codeSet = decoderCodeSet(codeSetBrut);
    try {
        if (mongoose.connection.readyState !== 1 || !idExpansion || !codeSet) return;
        await CodeSet.findOneAndUpdate(
            { idExpansion },
            { idExpansion, codeSet, apprisLe: new Date() },
            { upsert: true }
        );
        console.log(`🧠 Code set appris et mémorisé : idExpansion ${idExpansion} -> ${codeSet}`);
    } catch (e) {
        console.error("Erreur mémorisation codeSet:", e.message);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// 📌 CE CACHE EST BRANCHÉ SUR LA ROUTE QUE PERSONNE N'EMPRUNTE — 2026-09-02
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ RIEN N'EST DÉCIDÉ ICI, ET CE N'EST PAS URGENT : vérifié, `lireCache` n'est appelée
// qu'à un seul endroit (dans /api/analyser), et `ecrireCache` de même. Le cache n'est donc
// ni lu ni écrit par le trafic réel — il ne rend AUCUN prix faux aujourd'hui.
//
// LE CONSTAT. `cardprices` a 6 entrées, une expiration à 24 h, un index, et un contrat
// complet. Le flux réel de l'extension est /api/identifier, qui ne l'appelle jamais :
// 0 ligne de journal sur 216 porte `route: 'analyser'` (rétention 90 jours — « aucun appel
// depuis 90 jours », pas « jamais »).
// 🔑 ET IL N'A PAS ÉTÉ DÉBRANCHÉ, IL A ÉTÉ CONTOURNÉ — c'est la variante la plus discrète
// de la famille (voir aussi `departagerParImage` appelé après le `return`, et `symboleSet`
// absent de l'aplatissement) :
//     ecrireCache        d545637   2026-07-11
//     /api/identifier    b116723   2026-07-16   <- cinq jours PLUS TARD
// Le cache était CORRECT quand il a été écrit : /api/analyser était la seule route. La
// nouvelle route est née avec sa propre logique, sans reprendre le cache. Personne n'a
// rien cassé, donc rien n'a crié — et c'est précisément pourquoi ça dure deux mois.
//
// SI ON LE BRANCHAIT UN JOUR SUR /identifier, TROIS CONDITIONS, ET AUCUNE N'EST OPTIONNELLE :
//   1. 🔴 LA CLÉ CI-DESSOUS EST TROP GROSSIÈRE. `(name, number, language)` ignore
//      l'idProduct (deux réimpressions partagent nom+numéro+langue), l'axe normal/reverse
//      (dont `prixDeReference` dépend) et l'ÉTAT — or `etatRetenu` fait passer la base de
//      4,75 € à 1,50 € sur le même produit. La clé correcte est
//          (idProduct, estReverse, etatRetenu).
//   2. LA DURÉE SE MESURE, elle ne s'hérite pas des 24 h actuelles, choisies pour un autre
//      usage et jamais vérifiées.
//   3. 🔑 SUR CACHE PÉRIMÉ PENDANT UNE PANNE CARDMARKET : ON REFUSE. Le prix est le seul
//      champ dont on ait écrit qu'un faux est PIRE que rien. Un prix daté servi comme
//      actuel EST un prix faux. La seule forme acceptable serait un prix explicitement
//      horodaté et affiché comme tel — décision d'affichage, donc côté extension.
//
// ⚠️ ET CE N'EST PAS LE MEILLEUR LEVIER : le gain plafonne à 13,5 % (24 lectures
// redondantes sur 178 scans aboutis). L'alarme d'entretien de l'extension, à 72 requêtes
// par jour et par utilisateur, pèse bien davantage sur Cardmarket — et elle est hors serveur.
function cleKey(name, number, language) {
    return {
        name: String(name).trim().toLowerCase(),
        number: String(number).trim(),
        language: String(language || "EN").trim().toUpperCase()
    };
}

async function lireCache(name, number, language) {
    try {
        if (mongoose.connection.readyState !== 1) return null; // pas connecté
        const key = cleKey(name, number, language);
        const doc = await CardPrice.findOne(key);
        if (!doc) return null;
        const age = Date.now() - doc.updatedAt.getTime();
        if (age > CACHE_DURATION_MS) return null; // trop vieux, on re-scrape
        console.log(`💾 Cache HIT pour ${key.name} #${key.number} (${key.language})`);
        return { price: doc.price, url: doc.url };
    } catch (e) {
        console.error("Erreur lecture cache:", e.message);
        return null;
    }
}

async function ecrireCache(name, number, language, price, url) {
    try {
        if (mongoose.connection.readyState !== 1) return;
        const key = cleKey(name, number, language);
        await CardPrice.findOneAndUpdate(
            key,
            { ...key, price, url, updatedAt: new Date() },
            { upsert: true }
        );
    } catch (e) {
        console.error("Erreur écriture cache:", e.message);
    }
}

// ============================================================
// ÉTAPE 1 — Identification de la carte par l'IA (vision)
// ============================================================

async function getCardIdFromAI(imageUrls, title) {
    // Accepte une URL unique ou un tableau d'URLs (recto, verso, gros plans).
    const images = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [imageUrls].filter(Boolean);
    if (images.length === 0) return null;
    const prompt = `Identifie cette carte Pokémon à partir de l'image (le titre de l'annonce est un complément d'info, en français). Réponds UNIQUEMENT en JSON strict, sans texte ni markdown autour, format exact :
{"name": "Nom anglais de la carte", "nomBrut": "le nom TEL QU'IMPRIMÉ sur la carte, dans sa langue d'origine (katakana japonais, français...), ou null si illisible", "nomConfiance": "haute/moyenne/basse — voir les règles plus bas", "attaqueBrute": "le nom de la PREMIÈRE attaque, TEL QU'IMPRIMÉ sur la carte (katakana, français...), ou null si illisible", "attaque": "son nom ANGLAIS officiel (ex: Rainbow Burn), ou null si tu n'es pas sûr de la correspondance", "attaqueConfiance": "haute/moyenne/basse — voir les règles plus bas", "number": "numéro de collection SEUL sans le total (ex: 184)", "total": "le nombre APRÈS le slash (ex: 182 pour 184/182), ou null si absent", "setCode": "code du set (ex: BLK, PAL, OBF) si visible, sinon null", "symboleSet": "logo-tcg/R/fossile/feuilles/pokeball/gym/palmier/etoile/ruines/couronne/eclair/vs/e1/e2/e3/e4/e5/mcdo/empreintes/croix/cercle-chiffre/promo-etoile/aucun/illisible — le LOGO DU SET, voir plus bas", "rarete": "IR/SR/SIR/UR/AR/promo/normale selon ce que tu vois", "reverse": "true/false/null — true SEULEMENT si c'est une REVERSE HOLO, false si tu es sûr que non, null si tu n'arrives pas à juger", "motif": "aucun/reverse-classique/ball/masterball/indetermine — le MOTIF du fond brillant, voir la description détaillée plus bas", "language": "EN", "etatEstime": "NM/EX/GD/LP/PL/PO", "etatConfiance": "haute/moyenne/basse", "defautsVus": ["liste courte des défauts visibles, [] si aucun"]}

LE NOM — c'est le champ le plus lourd de conséquences, et celui où l'erreur est la plus coûteuse.
Un nom faux mais PLAUSIBLE est bien pire qu'un nom avoué illisible : il envoie la recherche
vers une carte qui existe vraiment, ailleurs, et le prix rendu est celui d'une autre carte.
- "nomBrut" : recopie ce qui est IMPRIMÉ, sans traduire. Sur une carte japonaise, ce sont des
  katakana (ex: "ワンリキー", "ハッサム"). Sur une carte française, le nom français
  (ex: "Carabaffe"). Si tu ne peux pas le lire, mets null — ne le reconstitue pas.
- "name" : le nom ANGLAIS officiel correspondant. Sur une carte japonaise, cela demande de
  translittérer PUIS traduire (ワンリキー = Machop, ハッサム = Scizor). Si tu n'es pas sûr de
  la correspondance, garde le nom que tu lis dans "nomBrut" et baisse "nomConfiance".
- "nomConfiance" :
  * "haute"   : tu LIS le nom distinctement et tu es sûr de sa traduction anglaise.
  * "moyenne" : tu lis le nom mais hésites sur la traduction, OU tu déduis surtout de l'illustration.
  * "basse"   : nom peu lisible (flou, reflet, sleeve, angle), langue que tu déchiffres mal, ou
                tu t'appuies principalement sur le titre de l'annonce plutôt que sur la carte.
⚠️ NE DEVINE JAMAIS un Pokémon célèbre par défaut. Si l'illustration ne te dit rien de sûr,
"nomConfiance" doit être "basse" — c'est une information UTILE, pas un aveu d'échec. Un nom en
confiance basse est traité autrement en aval ; un nom faux en confiance haute produit un faux prix.

L'ATTAQUE — elle distingue deux cartes qui portent le MÊME nom de Pokémon.
Un même Pokémon a des dizaines de cartes différentes ; le nom seul ne les sépare pas, l'attaque si.
Lis le nom de la PREMIÈRE attaque, celle du haut du bloc d'attaques, en gros caractères à gauche
du coût en énergies. Ne lis PAS le texte descriptif en dessous, ni le nom du talent s'il y en a un.
- "attaqueBrute" : recopie ce qui est IMPRIMÉ, sans traduire, exactement comme pour "nomBrut".
  Sur une carte japonaise ce sont des katakana (ex: "レインボーバーン"). null si illisible.
- "attaque" : son nom ANGLAIS officiel (レインボーバーン = "Rainbow Burn"). Même exercice que
  pour "name" : translittérer PUIS traduire. ⚠️ SI TU N'ES PAS SÛR DE LA CORRESPONDANCE
  ANGLAISE, METS null — ne propose pas une traduction littérale approchée. Une attaque
  anglaise inventée peut tomber sur celle d'une AUTRE carte et désigner la mauvaise.
- "attaqueConfiance" :
  * "haute"   : tu lis l'attaque distinctement ET tu es sûr de son nom anglais officiel.
  * "moyenne" : tu la lis mais hésites sur la traduction.
  * "basse"   : texte peu lisible (flou, reflet, sleeve, angle), ou tu déduis du contexte.
⚠️ N'INVENTE JAMAIS une attaque plausible. Sur une carte dont le bloc d'attaques n'est pas
lisible, "attaqueBrute" et "attaque" valent null : c'est une réponse propre, traitée en aval.
Ce champ ne sert QUE de départage entre candidats déjà à égalité — un null ne coûte rien,
une invention désigne une autre carte.

ÉVALUATION DE L'ÉTAT (etatEstime) — barème Cardmarket, du meilleur au pire : MT > NM > EX > GD > LP > PL > PO.
- NM (Near Mint) : aucun défaut visible, bords nets, coins pointus.
- EX (Excellent) : très légères marques d'usure, minuscule blanchiment de bord.
- GD (Good) : blanchiment net des bords/coins, légères rayures visibles.
- LP (Light Played) : usure marquée, rayures, coins émoussés.
- PL / PO : dégâts importants (pli, déchirure, tache).

RÈGLES IMPORTANTES pour etatConfiance — sois HONNÊTE sur ce que tu ne peux pas voir :
- "basse" si : la carte est sous sleeve/toploader/blister (reflets qui masquent les défauts), photo floue, angle en biais, éclairage mauvais, ou verso non visible.
- "moyenne" si : photo correcte de face mais détails des bords/coins pas nets.
- "haute" UNIQUEMENT si : carte nue, photo nette, bords et coins clairement visibles.
Dans le doute, sois PESSIMISTE (préfère GD à EX) : surestimer l'état conduit à surpayer.
Ne devine pas un état "haute confiance" à partir d'une photo qui ne le permet pas.

PLUSIEURS PHOTOS te sont fournies (recto, verso, gros plans). EXAMINE-LES TOUTES.
Le VERSO est déterminant : c'est là que l'usure se voit le mieux (bords blanchis, coins
usés, dos terni/jauni par le temps, rayures). Une carte au recto impeccable mais au dos
usé n'est PAS NM ni EX — un dos visiblement fatigué signifie GD ou moins.
Ton etatEstime doit refléter la PIRE face observée, pas la meilleure.
Si aucune photo du verso n'est fournie, dis-le via etatConfiance "basse".

defautsVus : décris ce que tu OBSERVES réellement (ex: "blanchiment bord gauche", "rayure sur l'illustration", "coin corné"). Tableau vide [] si tu ne vois aucun défaut. N'invente rien.

IMPORTANT pour "number" et "total" : le numéro de collection est imprimé en bas de la carte sous la forme "X/Y" (ex: "184/182", "025/165"). Lis les DEUX nombres avec attention, ils sont petits mais cruciaux. "number" = le X (avant le slash), "total" = le Y (après le slash). Si le X est SUPÉRIEUR au Y (ex: 184/182), c'est une carte secrète/spéciale (souvent une Illustration Rare) — lis bien, ne confonds pas 184 avec 8.
Le numéro est le signal le plus DISCRIMINANT dont on dispose : il permet de retrouver la carte
même quand son nom est douteux. Cherche-le donc partout : en bas de la carte, mais aussi dans le
TITRE de l'annonce, qui le contient très souvent sous la forme "099/128" ou "055/088".
Si malgré tout tu ne le lis pas, réponds null — n'invente PAS un numéro, et ne recopie pas celui
d'une autre carte visible sur la photo. Un numéro absent est traité proprement en aval ; un
numéro inventé désigne une carte qui n'a rien à voir.
Sur les cartes JAPONAISES anciennes, le numéro peut être imprimé seul, sans total, ou porter un
préfixe (ex: "S19"). Recopie-le tel quel dans "number" et laisse "total" à null si tu ne vois
aucun dénominateur.

Le "setCode" est le petit code alphabétique (2 à 4 lettres) imprimé en bas de la carte à côté du numéro, ou parfois dans le titre de l'annonce (ex: "BLK 129"). Si tu ne le vois pas clairement, réponds null, n'invente rien.
IMPORTANT — les TAMPONS/STAMPS de réimpression : si la carte porte un tampon anniversaire ou de sous-set (le logo doré "Celebrations 25 ans", le tampon "Pokémon 151", "Trainer Gallery", "Prize Pack"...), ce sont des réimpressions qui GARDENT le numéro d'origine (ex: Florizarre 15/102 en Celebrations). Dans ce cas, indique le set du TAMPON dans "setCode" (ex: "CEL" pour Celebrations, "MEW" pour 151, "TG" pour Trainer Gallery), PAS le set d'origine — c'est ce qui permet de distinguer la réimpression de la carte vintage au même numéro.

Pour "symboleSet" — LE LOGO DU SET, petit pictogramme imprimé à côté du numéro, en bas de la carte. À ne pas confondre avec le symbole de RARETÉ (rond/losange/étoile) ni avec le symbole d'ÉNERGIE du type. Il fait quelques millimètres : si tu ne le distingues pas nettement, réponds "illisible". Ne devine JAMAIS le dessin, c'est le champ où une invention coûte le plus cher. Réponds par UNE de ces valeurs, jamais autre chose :
- "logo-tcg" : le logo « Pokémon Trading Card Game », jaune et rouge.
- "R" : un grand R noir, penché.
- "fossile" : une griffe ou patte squelettique, os noirs.
- "feuilles" : un bouquet de feuilles ovales groupées en rosace.
- "pokeball" : une Poké Ball pleine, noir et blanc.
- "gym" : les trois lettres GYM, écrites en toutes lettres.
- "palmier" : un palmier, en aplat d'une seule couleur.
- "etoile" : une étoile à cinq branches, contour large, intérieur vide, SANS aucun texte écrit dessus.
- "ruines" : une pyramide à degrés vue de face, avec un escalier central.
- "couronne" : un bandeau circulaire surmonté de dents triangulaires, comme une couronne posée.
- "eclair" : un éclat anguleux violet et indigo, tracé en biais, aux angles irréguliers.
- "vs" : les deux lettres V et S, très grandes, dorées.
- "e1", "e2", "e3", "e4", "e5" : un cercle ouvert contenant le chiffre 1, 2, 3, 4 ou 5. LIS LE CHIFFRE : c'est lui qui distingue cinq sets différents. Si le cercle est visible mais le chiffre non, réponds "illisible".
- "empreintes" : deux empreintes de pattes.
- "croix" : une croix aux bras épais, avec un ovale au milieu.
- "mcdo" : les deux arches jaunes de McDonald's, en forme de M.
- "cercle-chiffre" : le NUMÉRO DE LA CARTE lui-même, entouré d'un trait fin, et AUCUN pictogramme de set à côté.
- "promo-etoile" : une étoile qui PORTE LE MOT « PROMO » écrit dessus. Si tu ne lis pas ce mot, réponds "etoile".
- "aucun" : rien à cet emplacement. C'est une VRAIE réponse, pas une absence de réponse — mais ne la donne que si tu vois clairement l'emplacement et qu'il est vide.
- "illisible" : reflet, sleeve, cadrage ou résolution insuffisante. C'est la bonne réponse dans le doute.

Pour "rarete" : regarde le symbole de rareté et le style de la carte. "IR" = Illustration Rare (illustration pleine, personnage humain souvent), "SIR"/"SR" = Special/Super Rare, "AR" = Art Rare, "promo" = carte promotionnelle, "normale" = carte de jeu standard. Si tu n'es pas sûr, réponds "normale".
⚠️ NE CONFONDS PAS "rarete" et "etatEstime" : la rareté est une propriété d'IMPRESSION de la carte (IR, SR, promo, normale...), l'état est son USURE physique (NM, EX, GD...). N'écris JAMAIS un code d'état (EX, GD, NM...) dans le champ "rarete".

Pour "reverse" : une REVERSE HOLO est une carte de jeu normale dont le motif holographique/brillant recouvre le FOND et les BORDURES (toute la carte scintille SAUF l'illustration), alors que sur une holo normale c'est l'ILLUSTRATION qui brille. Le numéro d'une reverse est IDENTIQUE à celui de la version normale. Réponds true UNIQUEMENT si tu distingues clairement ce scintillement de fond ; false si la carte est visiblement mate/normale ; null si reflets, sleeve ou photo ne permettent pas d'en être sûr. Ne devine pas.

Pour "motif" — LE MOTIF DU FOND BRILLANT D'UNE REVERSE. C'est un marquage holographique GRAVÉ et DISCRET, répété sur toute la surface brillante de la carte (le fond et les bordures, pas l'illustration). Regarde le fond en biais, là où la lumière accroche. Quatre réponses possibles :
- "aucun" : la carte est mate/normale, aucun fond brillant.
- "reverse-classique" : le fond brillant est couvert de petits SYMBOLES DE TYPE répétés (les symboles énergie : flamme, goutte, éclair, feuille...). C'est le reverse le plus courant, celui de la majorité des cartes.
- "ball" : le fond brillant est couvert de POKÉ BALLS répétées (ou d'autres balls : Friend Ball, Love Ball, Quick Ball). Des cercles séparés en deux moitiés par une bande horizontale, avec un bouton central.
- "masterball" : le fond est couvert de MASTER BALLS — reconnaissables à leur moitié supérieure violette/mauve portant un "M" et deux pastilles rondes de chaque côté.
- "indetermine" : reflets, sleeve, photo trop floue ou angle qui ne permet pas de voir le motif.
RÈGLE ABSOLUE : "indetermine" vaut MIEUX que deviner. Ne dis "ball" ou "masterball" que si tu DISTINGUES réellement la forme répétée. Ne cherche pas à identifier QUEL ball précisément (Poké/Friend/Love/Quick) : réponds "ball" pour tous, sauf la Master Ball qui a sa propre valeur. Si la carte est mate, réponds "aucun", pas "indetermine".
"motif" et "reverse" doivent être cohérents : motif "aucun" => reverse false ; tout autre motif => reverse true.

Pour "language", déduis-la du TEXTE VISIBLE SUR LA CARTE elle-même (pas du titre) : JP si texte japonais, FR si texte français, DE si allemand, IT si italien, ES si espagnol, PT si portugais, KR si coréen, ZH si chinois. Si tu n'es pas sûr, réponds "EN" par défaut.

Titre de l'annonce (contexte) : ${title || "(non fourni)"}`;

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: MODELE_IA,
            // Température 0 : lire un numéro sur une carte n'est pas une tâche
            // créative. Sans ça, le modèle "improvise" et donne des résultats
            // différents sur la MÊME photo (vu en conditions réelles : rareté AR
            // puis "normale", total TG30 puis absent -> 25 points d'écart au
            // scoring et la confiance qui bascule de HAUTE à BASSE).
            temperature: 0,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    // Toutes les photos de l'annonce : le verso et les gros plans sont
                    // indispensables pour juger l'état (l'usure s'y voit le mieux).
                    ...images.map(url => ({ type: "image_url", image_url: { url } }))
                ]
            }]
        }, {
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://render.com",
                "Content-Type": "application/json"
            },
            timeout: 30000
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            console.error("Réponse IA inattendue (pas de string content):", JSON.stringify(response.data));
            return null;
        }

        console.log("🤖 Réponse brute IA:", content);

        const clean = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);

        // ⚠️ ON NE JETTE PLUS LA RÉPONSE QUAND LE NUMÉRO MANQUE. L'ancienne version rendait
        // null dans ce cas, ce qui la rendait indiscernable d'une VRAIE panne (clé
        // invalide, quota, timeout, JSON illisible) : même retour, même message « Analyse
        // IA échouée », même motif de remboursement. Deux annonces réelles « e-series 5
        // jap » sont mortes là, alors que l'IA avait parfaitement répondu — elle n'avait
        // simplement pas pu lire le numéro. L'appelant a besoin de distinguer les deux
        // pour rembourser avec le bon motif et pour que le journal les compte séparément.
        if (!parsed.name) {
            console.error("JSON IA sans nom — inexploitable :", parsed);
            return null;
        }
        // Numéro absent : on renvoie quand même la lecture, avec un drapeau explicite.
        parsed.numeroIllisible = !parsed.number;
        if (parsed.numeroIllisible) {
            parsed.number = null;
            console.warn(`⚠️ IA : numéro de collection NON LU pour "${parsed.name}" — le numéro est le signal le plus discriminant, sans lui l'identification n'est pas fiable.`);
        }
        parsed.language = (parsed.language || "EN").toUpperCase();

        // --- NOM : ce que l'IA a lu, et à quel point elle y croit -----------
        // `nomBrut` est conservé tel quel (katakana, français...) : il ne sert pas au
        // scoring mais il est la seule trace de ce qui était RÉELLEMENT imprimé, donc le
        // seul moyen de comprendre après coup une traduction fautive.
        parsed.nomBrut = (typeof parsed.nomBrut === 'string' && parsed.nomBrut.trim()) ? parsed.nomBrut.trim() : null;
        const confiancesNom = ['haute', 'moyenne', 'basse'];
        const confLue = String(parsed.nomConfiance ?? '').trim().toLowerCase();
        // Absente ou hors énumération -> 'moyenne'. Volontairement PAS 'basse' : traiter un
        // champ manquant comme une alerte rendrait tout scan suspect le jour où le modèle
        // cesse de le renvoyer, et viderait le signal de son sens.
        parsed.nomConfiance = confiancesNom.includes(confLue) ? confLue : 'moyenne';
        if (parsed.nomConfiance === 'basse') {
            console.warn(`⚠️ IA : nom "${parsed.name}" en confiance BASSE (brut : ${parsed.nomBrut ?? 'illisible'}) — le nom ne fera pas foi pour choisir les candidats.`);
        }

        // ── LE MOT « null » N'EST PAS UNE VALEUR ─────────────────────────────────
        // Le modèle rend parfois la CHAÎNE "null" (ou "none", "aucun", "n/a") au lieu du
        // null JSON. Vu en production : un scan de Furret portant setCode:"null", que la
        // chaîne a traité comme un vrai code — il se normalisait en « NULL » et servait de
        // preuve. Conséquence mesurée : le périmètre vintage refusait de s'armer sur cette
        // carte, alors que son expansion (EC3) est dans la table close. Une lecture ratée
        // était devenue une contradiction.
        // On nettoie donc À L'ENTRÉE, une seule fois, plutôt que de s'en défendre à chaque
        // usage en aval.
        const MOTS_VIDES = new Set(['null', 'none', 'undefined', 'aucun', 'n/a', 'na', '-', '?', '']);
        // `attaque` et `attaqueBrute` entrent dans cette liste pour la même raison que
        // `setCode` : le modèle rend parfois le MOT « aucun » là où il veut dire « rien lu ».
        // Sur un champ qui sert de clé de jointure, la chaîne « aucun » irait chercher une
        // attaque nommée « aucun » — elle n'existe pas, donc le départage s'abstiendrait
        // silencieusement au lieu de dire qu'il n'a rien lu. Deux causes sous une seule sortie.
        for (const champ of ['setCode', 'name', 'nomBrut', 'number', 'total', 'rarete', 'symboleSet', 'attaque', 'attaqueBrute']) {
            const v = parsed[champ];
            if (typeof v === 'string' && MOTS_VIDES.has(v.trim().toLowerCase())) {
                if (champ === 'setCode') console.warn(`⚠️ IA : setCode rendu comme le MOT "${v}" -> traité comme absent (voir le quatrième principe).`);
                parsed[champ] = null;
            }
        }

        // Normalisation des nouveaux champs pour le scoring.
        // `total` attend un NOMBRE (le "Y" de X/Y). L'IA y met parfois autre chose : vu
        // en réel sur une promo chinoise, "total": "SV-P", c'est-à-dire un code de set.
        // L'ancien nettoyage (replace(/\D/g,'')) produisait alors la chaîne VIDE, ce qui
        // désactivait le départage par total EN SILENCE. La normalisation vit désormais
        // dans scoring.js (module testé — voir normaliserTotal et le test "184/182").
        const { total, brutIgnore } = normaliserTotal(parsed.total);
        parsed.total = total;
        if (brutIgnore) {
            console.warn(`⚠️ IA : "total" non numérique ("${brutIgnore}") -> ignoré (départage par total désactivé).`);
            // Repêchage : ce qu'elle a mis là est presque toujours le code du set (elle
            // confond les deux champs). Si setCode est vide, autant récupérer
            // l'information plutôt que de la jeter : c'est elle qui active le critère
            // set du scoring (40 points, ou 15 en apparenté).
            if (!parsed.setCode) {
                parsed.setCode = brutIgnore;
                console.warn(`   ↪️ "${brutIgnore}" repêché comme setCode (le champ était vide).`);
            }
        }
        parsed.rarete = parsed.rarete || 'normale';
        // reverse : on ne garde QUE true ou false explicites ; tout le reste ("null",
        // absent, chaîne "null") devient null -> le scoring restera neutre dans le doute.
        parsed.reverse = (parsed.reverse === true || parsed.reverse === 'true') ? true
            : (parsed.reverse === false || parsed.reverse === 'false') ? false
            : null;
        // MOTIF du fond brillant. Énumération volontairement GROSSIÈRE : on ne demande
        // pas à l'IA de nommer le ball exact (Poké/Friend/Love/Quick), c'est l'axe où
        // l'identification visuelle échoue en pratique. Le catalogue TCGdex tranche
        // ensuite quel produit porte ce motif (voir resoudreMotif dans scoring.js).
        const motifLu = String(parsed.motif ?? '').trim().toLowerCase();
        parsed.motif = MOTIFS_CIBLABLES.includes(motifLu) ? motifLu : 'indetermine';
        // Cohérence interne de la réponse : `motif` est plus précis que `reverse`, il
        // prime — sauf contradiction franche entre les deux, où l'on refuse de trancher
        // plutôt que de choisir arbitrairement (le repli, lui, est mesuré dans les logs).
        if (parsed.motif !== 'indetermine') {
            if (parsed.reverse === true && parsed.motif === 'aucun') {
                console.warn(`⚠️ IA incohérente : reverse=true mais motif="aucun" -> motif remis à indéterminé.`);
                parsed.motif = 'indetermine';
            } else {
                parsed.reverse = parsed.motif !== 'aucun';
            }
        }
        // Carte "à valeur" si : numéro > total (secrète), ou rareté spéciale lue par l'IA
        const numN = parseInt(String(parsed.number).replace(/\D/g, ''), 10);
        const totN = parsed.total ? parseInt(parsed.total, 10) : null;
        const raretesElevees = ['IR', 'SR', 'SIR', 'UR', 'AR', 'SAR', 'CHR', 'CSR'];
        parsed.rareteElevee = (totN != null && numN > totN)
            || raretesElevees.includes(String(parsed.rarete).toUpperCase());
        // `reverse` est loggé explicitement : sans lui, la ligne laissait croire que
        // "élevée=false" concernait la reverse, alors qu'elle décrit la RARETÉ
        // (secret/IR). On avait donc "élevée=false" suivi d'une décision reverse juste
        // après, sans jamais voir la valeur qui l'avait déclenchée.
        const reverseLog = parsed.reverse === null ? 'indéterminée' : parsed.reverse;
        console.log(`🎴 IA : ${parsed.name} #${parsed.number ?? 'ILLISIBLE'}${parsed.total ? '/' + parsed.total : ''}, nomConfiance=${parsed.nomConfiance}${parsed.nomBrut ? ` (brut "${parsed.nomBrut}")` : ''}, rareté=${parsed.rarete}, rareté élevée=${parsed.rareteElevee}, reverse=${reverseLog}, motif=${parsed.motif}, langue=${parsed.language}`);
        if (parsed.etatEstime) {
            const defauts = Array.isArray(parsed.defautsVus) && parsed.defautsVus.length ? parsed.defautsVus.join(', ') : 'aucun défaut vu';
            console.log(`   👁️ État estimé par l'IA : ${parsed.etatEstime} (confiance ${parsed.etatConfiance || '?'}) — ${defauts}`);
        }

        return parsed;

    } catch (e) {
        // Log complet : c'est ici que tu verras la vraie cause (clé invalide, quota, timeout...)
        console.error("❌ Erreur getCardIdFromAI:", e.response?.data || e.message);
        return null;
    }
}

// ============================================================
// ÉTAPE 1bis — Catalogue LOCAL (importé depuis les exports officiels Cardmarket)
// Gratuit, instantané, aucun appel réseau. On regroupe par idMetacard : si un
// seul "idMetacard" correspond au nom, toutes les entrées sont la même carte
// (juste des réimpressions) -> pas d'ambiguïté, prix directement fiable.
// Si plusieurs idMetacard correspondent, c'est une vraie ambiguïté qu'on ne
// peut pas trancher sans image -> on laisse la main à TCGdex+comparaison photo.
// ============================================================

function echapperRegex(texte) {
    return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function chercherPrixCatalogueLocal(name) {
    try {
        if (mongoose.connection.readyState !== 1) return { trouvaille: null, ambigu: false };

        // Nom exact, éventuellement suivi de " [Attaque1 | Attaque2]"
        const regex = new RegExp(`^${echapperRegex(name)}(\\s*\\[|$)`, 'i');
        const candidats = await CatalogueProduit.find({ name: regex }).lean();

        if (candidats.length === 0) {
            console.log(`ℹ️ Catalogue local : aucune correspondance pour "${name}".`);
            return { trouvaille: null, ambigu: false };
        }

        const groupes = {};
        for (const c of candidats) (groupes[c.idMetacard] ||= []).push(c);
        const nombreDeGroupes = Object.keys(groupes).length;

        if (nombreDeGroupes > 1) {
            // Le catalogue local n'a pas le numéro de collection par carte, donc un nom
            // très réimprimé (ex: "Mewtwo ex") remonte toutes ses éditions -> ambiguïté
            // qu'une recherche directe (même numéro) ne résoudra pas différemment.
            console.log(`ℹ️ Catalogue local : ${nombreDeGroupes} cartes distinctes possibles pour "${name}" — ambigu, inutile d'essayer la recherche directe, repli direct sur TCGdex+image.`);
            return { trouvaille: null, ambigu: true };
        }

        // Un seul idMetacard, MAIS avec beaucoup de réimpressions (ex: cartes promo très
        // rééditées comme "Iono") -> des produits différents avec des valeurs très
        // différentes (promo vs ETB vs deck thème). Une moyenne aveugle serait fausse —
        // on préfère laisser TCGdex+comparaison d'image identifier le produit précis.
        const idsProducts = candidats.map(c => c.idProduct);
        const SEUIL_REIMPRESSIONS_FIABLE = 5;
        if (idsProducts.length > SEUIL_REIMPRESSIONS_FIABLE) {
            console.log(`ℹ️ Catalogue local : "${name}" a ${idsProducts.length} réimpressions sous le même idMetacard — trop pour une moyenne fiable, repli sur TCGdex+image.`);
            return { trouvaille: null, ambigu: true };
        }

        const guides = await GuidePrix.find({ idProduct: { $in: idsProducts }, trend: { $ne: null } }).lean();

        if (guides.length === 0) {
            console.log(`ℹ️ Catalogue local : "${name}" trouvé (idMetacard unique) mais aucun prix dans le guide local.`);
            return { trouvaille: null, ambigu: false };
        }

        const prixMoyen = guides.reduce((s, g) => s + g.trend, 0) / guides.length;
        const idProductRetenu = guides[0].idProduct;

        console.log(`✅ Catalogue local : "${name}" -> idProduct ${idProductRetenu}, prix ${prixMoyen.toFixed(2)} € (moyenne sur ${guides.length} réimpression(s))`);

        return {
            trouvaille: {
                price: parseFloat(prixMoyen.toFixed(2)),
                idProduct: idProductRetenu,
                url: `https://www.cardmarket.com/en/Pokemon/Products/Singles?idProduct=${idProductRetenu}`
            },
            ambigu: false
        };

    } catch (e) {
        console.error(`❌ Erreur catalogue local pour "${name}" :`, e.message);
        return { trouvaille: null, ambigu: false };
    }
}



// ============================================================
// ÉTAPE 2 — Identification via TCGdex (gratuit, sans clé)
// ============================================================
// NOTE : la comparaison d'images (hash perceptif via sharp) a été RETIRÉE.
// Mesuré en conditions réelles : sur des photos d'annonce (angle, reflets,
// carte sous sleeve), les distances tournaient entre 21 et 41/64 — aucune ne se
// détachait, et le hash désignait parfois la MAUVAISE carte. Il apportait ~15
// points de bruit face au numéro (50), à la région (±45) et au set (40), qui
// décident réellement.
// Le retirer supprime au passage la dépendance à `sharp` (module natif, lourd en
// RAM), ce qui allège le déploiement et rend l'architecture portable en extension.

// Langues supportées par TCGdex pour la recherche (codes ISO)
const LANGUES_TCGDEX = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ja', 'ko', 'zh-cn', 'zh-tw', 'nl', 'pl', 'ru', 'id', 'th'];

// Convertit notre code langue (EN, FR, JP...) vers le code TCGdex (en, fr, ja...)
function langueVersTCGdex(langue) {
    const map = { EN: 'en', FR: 'fr', DE: 'de', ES: 'es', IT: 'it', PT: 'pt', JP: 'ja', KR: 'ko', ZH: 'zh-cn', RU: 'ru' };
    return map[(langue || 'EN').toUpperCase()] || 'en';
}

// ════════════════════════════════════════════════════════════════════════════
// UNE PANNE N'EST PAS UNE ABSENCE — ET LA CONFUSION A COÛTÉ DEUX SCANS
// ════════════════════════════════════════════════════════════════════════════
// LE CAS RÉEL, 2026-08-15. Deux cartes japonaises du même set, 17 secondes d'écart :
// « Abra » 11:47:29 et « Dark Kadabra » 11:47:46, toutes deux sorties en
// `carte-introuvable` — « ni sur TCGdex ni dans le catalogue local ». Or TCGdex les
// connaît : /v2/ja rend PMCG4-034 et PMCG4-008, vérifié. Les scans qui encadrent, à
// 11:41 et 11:54, sont passés. Ce n'était pas une absence, c'était le réseau.
//
// CE QUI L'A RENDU INVISIBLE : `trouverCarteTCGdex` avalait TOUTE exception dans son
// catch final et rendait `null` — la même valeur que « zéro résultat ». Deux états du
// monde radicalement différents, une seule valeur pour les dire.
//
// DEUX CONSÉQUENCES, ET LA SECONDE EST LA PIRE :
//   - L'AFFICHAGE. `NATURE_REFUS['carte-introuvable']` vaut 'refus-delibere' : une panne
//     réseau sortait donc en doré, dans la couleur qui affirme que la chaîne a
//     fonctionné. C'est exactement l'inversion que cette table a été écrite pour
//     empêcher, et elle s'est produite au premier cas réel.
//   - LA MESURE. Tant que les deux se confondent, TOUTE statistique de
//     `carte-introuvable` est suspecte — y compris celles sur lesquelles on s'est déjà
//     appuyés. Une panne qu'on ne sait pas distinguer d'une absence est une panne qu'on
//     ne saura jamais mesurer.
//
// LA LIGNE DE PARTAGE, ET ELLE EST CONSERVATRICE. Est une PANNE : toute erreur sans
// réponse HTTP (DNS, connexion coupée, timeout), plus les 429 et les 5xx — le serveur a
// parlé, mais pour dire qu'il ne peut pas servir. N'est PAS une panne : une réponse
// propre, 404 compris. Un 404 sur une recherche par nom veut dire « je n'ai rien », et
// c'est une information, pas un incident.
// ⚠️ EN CAS DE DOUTE ON CLASSE EN PANNE (le `return true` final), parce que les deux
// erreurs ne coûtent pas la même chose : traiter une absence comme une panne fait perdre
// un repli et rembourse ; traiter une panne comme une absence fabrique un verdict faux.
function estUnePanneReseau(e) {
    if (!e) return false;
    if (e.response) {
        const s = e.response.status;
        return s === 429 || s >= 500;
    }
    return true;
}

// UN SEUL RÉESSAI, ET COURT. Le correctif le moins cher de tous : quelques centaines de
// millisecondes auraient sauvé les deux scans du 15 août sans rien changer d'autre.
// ⚠️ UN SEUL — pas une boucle. Une insistance plus longue transformerait un incident
// TCGdex en latence utilisateur, et le scan a déjà payé ~4 s d'appel IA.
// Le réessai ne s'applique QU'AUX PANNES : rejouer un 404 ne rendrait rien de nouveau.
const DELAI_REESSAI_TCGDEX_MS = 400;
async function getTCGdex(url, timeout = 15000) {
    try {
        return await axios.get(url, { timeout });
    } catch (e) {
        if (!estUnePanneReseau(e)) throw e;
        console.warn(`↻ [tcgdex] ${e.code || e.response?.status || e.message} sur ${url} — un seul réessai dans ${DELAI_REESSAI_TCGDEX_MS} ms.`);
        await new Promise(r => setTimeout(r, DELAI_REESSAI_TCGDEX_MS));
        return await axios.get(url, { timeout });
    }
}

// Valeur de retour DISTINCTE de `null`, pour que l'appelant puisse séparer les deux états.
// Gelée : elle est comparée par identité (`===`), jamais copiée ni étendue.
const TCGDEX_EN_PANNE = Object.freeze({ panne: true });

async function chercherCartesTCGdex(name, numberFilter, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}&localId=${numberFilter}`;
    const response = await getTCGdex(url);
    return Array.isArray(response.data) ? response.data : [];
}

// Recherche TCGdex par nom seul (sans numéro), pour les cas où le numéro bloque le match
async function chercherCartesTCGdexNomSeul(name, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}`;
    const response = await getTCGdex(url);
    return Array.isArray(response.data) ? response.data : [];
}

// Génère des variantes d'un nom de carte pour contourner les différences de
// nommage entre l'IA, TCGdex et Cardmarket (Méga, esperluette, tirets, suffixes...).
function genererVariantesNom(name) {
    const variantes = new Set();
    const base = name.trim();
    variantes.add(base);

    // "M Kangaskhan-EX" / "M-Kangaskhan" -> "Mega Kangaskhan..."
    if (/^M[\s-]/i.test(base)) {
        variantes.add(base.replace(/^M[\s-]/i, 'Mega '));
    }
    // "Mega X" -> "M X" (l'inverse, au cas où)
    if (/^Mega\s/i.test(base)) {
        variantes.add(base.replace(/^Mega\s/i, 'M '));
    }
    // Esperluette : "Jesse & James" -> "and", et l'orthographe "Jessie"
    if (base.includes('&')) {
        variantes.add(base.replace(/\s*&\s*/g, ' and '));
    }
    if (/jesse/i.test(base)) variantes.add(base.replace(/jesse/gi, 'Jessie'));

    // Tirets : "Kangaskhan-EX" <-> "Kangaskhan EX" <-> "Kangaskhan"
    if (base.includes('-')) {
        variantes.add(base.replace(/-/g, ' '));
        variantes.add(base.replace(/-/g, ''));
    }
    // Retirer les suffixes de type -EX/-GX/-V/-VMAX pour élargir
    const sansSuffixe = base.replace(/[\s-]*(EX|GX|V|VMAX|VSTAR)\b/gi, '').trim();
    if (sansSuffixe && sansSuffixe !== base) variantes.add(sansSuffixe);

    // Nom principal seul (premier mot significatif) en tout dernier recours
    const premierMot = base.split(/[\s&-]/)[0];
    if (premierMot && premierMot.length > 2) variantes.add(premierMot);

    return [...variantes];
}

// Liste des sets TCGdex, mémorisée pour la durée du process. Elle sert à traduire un
// TOTAL imprimé en SET, ce qui est le signal le plus fiable dont on dispose. Un seul
// appel réseau, réutilisé par toutes les identifications : sans ce cache, chaque scan
// paierait une requête supplémentaire pour une donnée qui bouge quelques fois par an.
// ⚠️ UNE LISTE PAR LANGUE, et c'est décisif. /v2/en/sets ne contient que les 218 sets
// INTERNATIONAUX ; /v2/ja/sets en contient 177, dont les sets japonais avec leur total
// IMPRIMÉ exact. Mesuré :
//     total 128 -> en: AUCUN     ja: E1 「基本拡張パック」
//     total  92 -> en: ex12      ja: E2 「地図にない町」
//     total  87 -> en: AUCUN     ja: E3 「海からの風」   (le set de Scizor)
//     total  88 -> en: me03      ja: E4 「裂けた大地」, E5  (celui de Flareon et Rhydon)
// Interroger la liste `en` pour une carte japonaise donnait donc « Perfect Order » (2025)
// sur un total de 88 : c'est ce qui a fait rendre « Turtonator » à 0,02 € au lieu d'un
// Flareon EC4 à 239,94 €. Et les ids japonais de TCGdex (E1..E5) sont EXACTEMENT ce que
// l'IA lit sur la carte, ce que la table ALIAS_CODES_LUS relie aux codes Cardmarket
// EC1..EC5 — la correspondance est vérifiée une par une, sans exception.
const _setsTCGdex = new Map();      // langueApi -> { liste, expire }
const DUREE_CACHE_SETS_MS = 24 * 60 * 60 * 1000;

/**
 * Quelle LISTE DE SETS consulter pour une carte de cette langue.
 *
 * ⚠️ DÉLIBÉRÉMENT DIFFÉRENT de langueVersTCGdex, qui sert à chercher un NOM (et où
 * interroger le français a tout son sens). Ici on cherche des TAILLES de sets, et la
 * mesure impose deux choses :
 *   - le bucket ASIATIQUE (JP/ZH/KR, comme dans regionAttendue) -> 'ja', la seule liste
 *     qui contienne les sets japonais avec leur total imprimé (E1..E5, PCG8...) ;
 *   - TOUT LE RESTE -> 'en', qui est la liste la plus COMPLÈTE : 218 sets contre 200 en
 *     français. Utiliser 'fr' pour une carte française perdrait 18 sets et rendrait le
 *     pont plus ambigu (mesuré : total 182 donne 2 sets en fr là où en en donne moins).
 * Le comportement des cartes occidentales est donc rigoureusement INCHANGÉ.
 */
function langueDesSetsTCGdex(langue) {
    return LANGUES_ASIATIQUES.includes(String(langue || '').toUpperCase()) ? 'ja' : 'en';
}

async function chargerSetsTCGdex(langueApi = 'en') {
    const lg = String(langueApi || 'en').toLowerCase();
    const cache = _setsTCGdex.get(lg);
    if (cache && Date.now() < cache.expire) return cache.liste;
    try {
        const r = await axios.get(`https://api.tcgdex.net/v2/${lg}/sets`, { timeout: 20000 });
        if (Array.isArray(r.data) && r.data.length) {
            _setsTCGdex.set(lg, { liste: r.data, expire: Date.now() + DUREE_CACHE_SETS_MS });
            return r.data;
        }
    } catch (e) {
        console.warn(`⚠️ Liste des sets TCGdex [${lg}] indisponible (${e.message}) — le total ne pourra pas restreindre les sets.`);
    }
    return cache?.liste || [];
}

/**
 * Sets dont la taille officielle == total lu, dans la langue de la CARTE.
 *
 * ⚠️ PAS DE REPLI D'UNE LANGUE SUR L'AUTRE. Pour une carte japonaise dont aucun set
 * japonais ne fait la bonne taille, on renvoie [] — et c'est la bonne réponse. Se rabattre
 * sur le catalogue international proposerait des produits d'une AUTRE édition, et cette
 * fausse piste ne serait pas seulement inutile : elle sert de PÉRIMÈTRE de recherche.
 * Mesuré sur le Salamèche McDonald's — total 18, aucun set japonais de cette taille, et
 * la liste `en` proposait « Southern Islands » et « Detective Pikachu ». Un pont vide
 * laisse la main au nom, au numéro et à la région, qui eux ne se trompent pas d'édition.
 */
async function setsPourTotal(totalImprime, langue = null) {
    if (!totalImprime) return [];
    const sets = await chargerSetsTCGdex(langueDesSetsTCGdex(langue));
    return setsCompatiblesAvecTotal(sets, totalImprime);
}

const setIdDeCarte = idCarte => (idCarte && idCarte.includes('-')) ? idCarte.slice(0, idCarte.lastIndexOf('-')) : null;

// ════════════════════════════════════════════════════════════════════════════
// LA ROUTE DU DÉTAIL EST FIXE, ET CE N'EST PAS CELLE DE LA RECHERCHE
// ════════════════════════════════════════════════════════════════════════════
// `detailCarteTCGdex` interroge TOUJOURS /v2/en, quelle que soit la route sur laquelle
// la carte a été TROUVÉE. Les deux ne coïncident que sur les cartes occidentales.
//
// ⚠️ LES ESPACES D'IDENTIFIANTS SONT MAJORITAIREMENT DISJOINTS — ET LES EXCEPTIONS SONT
// LE PIRE CAS. Mesuré sur 15 identifiants de set le 2026-08-15 : 13 ne répondent que sur
// UNE route (PMCG*, E*, SV* côté ja ; base*, gym*, neo… côté en), 2 répondent sur les DEUX.
// ⚠️ CORRECTION D'UNE AFFIRMATION TROP FORTE que j'avais écrite la veille sur 6
// identifiants seulement : « les espaces sont disjoints » est FAUX en général.
//   neo1  [ja] 金、銀、新世界へ... 96 cartes   |   [en] Neo Genesis 111 cartes
//   neo4  [ja] 闇、そして光へ...  113 cartes   |   [en] Neo Destiny 113 cartes
// Des comptes de cartes DIFFÉRENTS sur neo1 : ce ne sont pas deux localisations du même
// set, ce sont DEUX SETS DIFFÉRENTS qui partagent un identifiant. C'est le défaut
// `lien-tcgdex-partage` à sa source, chez TCGdex lui-même.
//
// D'OÙ DEUX RÉGIMES DE DÉGÂT, ET NON UN SEUL, quand on détaille une carte japonaise sur
// la route occidentale :
//   - familles route-spécifiques (PMCG, E, SV…) : l'appel ne rend RIEN. `nomExact`,
//     `variants` et `variantsDetailed` sortent à null, et avec eux le validateur de
//     reverse et le routage de motif — en silence, sans se contredire.
//   - familles partagées (neo…) : l'appel rend UNE AUTRE CARTE, celle du set occidental
//     homonyme. C'est pire, et c'est invisible : les champs sont pleins, ils sont faux.
// L'alignement de la route ci-dessous ferme les deux, pas seulement le premier.
//
// C'est le DEUXIÈME PRINCIPE (voir scoring.js) : deux sources de vérité — la route qui
// trouve, la route qui détaille — divergent sans qu'aucun signal ne le dise.
//
// ⚠️ CE QUI N'EST PAS MESURÉ : la FRÉQUENCE. La sonde établit que les espaces sont
// disjoints, sur 6 identifiants dont 4 choisis à la main. Elle ne dit pas combien de
// scans réels tombent dedans — c'est `langueRoute` + `variantsDetailedPresent` au
// journal qui le diront, et rien ne doit être décidé avant.
//
// ── LA ROUTE EST DÉSORMAIS ALIGNÉE, ET VOICI POURQUOI C'ÉTAIT SANS RISQUE ────────────
// La crainte était qu'aligner casse l'identification japonaise, /v2/ja rendant des noms
// en kana. Vérifié dans le code plutôt que supposé : `nomPourLeCatalogue` a justement été
// écrite pour ce cas. Les deux situations donnent le MÊME résultat —
//   détail sur /v2/en (muet) : nomAnglais=null, nomTrouvé=kana -> tombe sur le nom de l'IA
//   détail sur /v2/ja        : nomAnglais=kana, nomTrouvé=kana -> tombe sur le nom de l'IA
// `estLatin` rejette le kana dans les deux cas. La crainte n'avait pas d'objet.
//
// ET LE SECOND APPEL QU'ON AURAIT PU IMAGINER (variantes sur la route de la carte, nom
// latin sur /v2/en) NE PEUT RIEN RENDRE DE BON : sur les familles route-spécifiques
// l'identifiant japonais n'existe pas côté occidental (PMCG4-034/008/053/017 tous MUETS
// en /v2/en), et sur les familles PARTAGÉES il rendrait le nom d'une AUTRE carte. Dans
// les deux cas, il n'y a pas de nom latin fiable à récupérer par identifiant — et il n'en
// faut pas, `nomPourLeCatalogue` retombant déjà sur la lecture de l'IA.
// Aligner la route ne coûte donc AUCUN appel de plus : c'est le même appel, sur la bonne
// route. Sur une carte occidentale, `langueRoute === 'en'` et rien ne change du tout.
//
// ⚠️ LE GAIN EST PETIT, ET IL FAUT LE DIRE. /v2/ja rend bien `variants_detailed`, mais
// SANS AUCUN idProduct Cardmarket (0 sur 4 cartes mesurées) : le routage des motifs n'est
// PAS restauré sur les japonaises, la table de routage n'existe pas. Ce qu'on gagne, c'est
// un `variants.reverse` FACTUEL par carte, là où identification-locale.js se rabat sur un
// proxy par EXPANSION (le trendHolo du set entier). Remplacer un proxy par un fait vaut
// le geste : c'est le genre de proxy qui ment sans prévenir.
//
// ⚠️⚠️ ET LA VRAIE RÈGLE, CELLE À RETENIR POUR NE PAS REJOUER CE RAISONNEMENT :
// C'EST L'ÂGE DU SET QUI DÉCIDE DE LA PRÉSENCE DES idProduct, PAS LA LANGUE.
// `base5-39` (Dark Kadabra, Team Rocket, 2000, OCCIDENTALE) rend lui aussi 0 idProduct sur
// 2 variantes ; `me02.5-153` (Rayquaza, 2025) en rend 3 sur 3. Le vintage japonais n'est
// pas mal servi parce qu'il est japonais — il l'est parce qu'il est vieux, et le vintage
// occidental l'est autant. Toute conclusion « TCGdex traite mal le japonais » tirée de
// l'absence de variantes est donc fausse : elle confond deux axes.
const ROUTE_DU_DETAIL_PAR_DEFAUT = 'en';

/**
 * Détail d'une carte TCGdex : nom ANGLAIS + variantes. Un seul appel, deux usages.
 * Le nom trouvé peut être dans la langue de recherche (ex: français) alors que le
 * catalogue Cardmarket est en anglais — d'où la récupération par l'id, universel.
 * `variants_detailed` vient de la MÊME réponse : c'est la table de routage des motifs
 * de reverse (motif -> idProduct Cardmarket), obtenue sans requête supplémentaire.
 *
 * ⚠️ `routeApi` DOIT être la route qui a TROUVÉ la carte : les espaces d'identifiants sont
 * disjoints d'une route à l'autre, donc un identifiant japonais interrogé en /v2/en ne rend
 * RIEN — ni nom, ni variantes. Voir le bloc juste au-dessus.
 */
async function detailCarteTCGdex(idCarte, nomTrouve = null, routeApi = ROUTE_DU_DETAIL_PAR_DEFAUT) {
    try {
        const route = routeApi || ROUTE_DU_DETAIL_PAR_DEFAUT;
        const r = await getTCGdex(`https://api.tcgdex.net/v2/${route}/cards/${encodeURIComponent(idCarte)}`, 15000);
        const nomExact = r.data?.name || null;
        if (nomExact && nomTrouve && nomExact !== nomTrouve) {
            console.log(`🔤 Nom anglais récupéré : "${nomExact}" (trouvé en "${nomTrouve}").`);
        }
        return {
            nomExact,
            variants: r.data?.variants || null,
            variantsDetailed: Array.isArray(r.data?.variants_detailed) ? r.data.variants_detailed : null
        };
    } catch (e) {
        return { nomExact: null, variants: null, variantsDetailed: null };
    }
}

/**
 * Identifie une carte SANS UTILISER SON NOM : uniquement le total (qui donne le set)
 * et le numéro (qui donne la carte dans ce set).
 *
 * C'est le chemin de secours quand le nom est démontrablement faux ou inexploitable :
 *  - nom halluciné mais plausible (Dana lue "Kahili") : le nom existe ailleurs, donc
 *    rien en aval ne peut le suspecter ;
 *  - nom impossible à apparier entre TCGdex et Cardmarket ("_____'s Pikachu", où le
 *    nombre de tirets bas diffère d'une source à l'autre).
 * Dans les deux cas le numéro était parfaitement lisible.
 */
async function identifierParTotalEtNumero(number, totalImprime, langue = null, nomLu = null, nomBrut = null) {
    // La langue de la CARTE choisit le catalogue : les sets japonais ne sont pas dans
    // /v2/en/sets, et y chercher un total japonais désigne un produit d'une autre édition.
    const langueApi = langueDesSetsTCGdex(langue);
    const sets = await setsPourTotal(totalImprime, langue);
    if (sets.length === 0) return null;
    if (sets.length > 5) {
        // Total peu discriminant (typiquement <= 30 : trainer kits, promos POP).
        console.log(`ℹ️ [total] ${sets.length} sets à ${totalImprime} cartes — trop peu discriminant, on n'essaie pas.`);
        return null;
    }

    // ⚠️ DÉTERMINISME. Chaque set RETOURNE ses trouvailles au lieu de les empiler dans un
    // tableau partagé : `Promise.all` préserve l'ordre des VALEURS RENDUES, jamais celui
    // des réponses HTTP. L'ancienne version faisait `trouvees.push(...)` depuis les
    // callbacks, puis prenait `retenues[0]` — c'est-à-dire le set dont la réponse réseau
    // arrivait la première. Mesuré : cinq appels identiques sur le même scan (Rhydon,
    // n°055, total 088) ont rendu E4, E5, E5, E4, E5. Deux conséquences que rien ne
    // signalait : un banc dont les lignes basculent selon la latence, et un utilisateur
    // qui scanne deux fois la même carte et voit deux prix différents.
    // ⚠️ UN SET INJOIGNABLE REND LE RÉSULTAT INCOMPLET, ET DOIT LE DIRE.
    // L'ancienne version avalait l'erreur en silence (`catch (_) {}`) et continuait avec
    // les sets restants. Conséquence jamais vue : quand E5 ne répondait pas, il ne restait
    // qu'UN candidat, `ambigu` valait donc `false`, et une identification réellement
    // ambiguë sortait AVEC CONFIANCE. Un aléa réseau transformait un doute en certitude —
    // c'est ce qui explique la ligne du journal marquée `incertain=false` alors que deux
    // sets répondaient au même numéro.
    let setsInjoignables = 0;
    const parSet = await Promise.all(sets.map(async s => {
        try {
            const detail = await axios.get(`https://api.tcgdex.net/v2/${langueApi}/sets/${encodeURIComponent(s.id)}`, { timeout: 15000 });
            return (detail.data?.cards || [])
                .map(c => ({ carte: c, set: s, correspondance: comparerNumeros(number, c.localId) }))
                .filter(t => t.correspondance);
        } catch (e) {
            setsInjoignables++;
            console.warn(`⚠️ [total] set ${s.id} injoignable (${e.message}) — le résultat sera marqué incertain.`);
            return [];
        }
    }));
    const trouvees = parSet.flat();
    if (trouvees.length === 0) return null;

    // Une égalité EXACTE prime sur une égalité de chiffres (cf. "SV14" vs "14").
    const exactes = trouvees.filter(t => t.correspondance === 'exact');
    let retenues = exactes.length ? exactes : trouvees;

    // ---- ARBITRAGE PAR LE NOM LU --------------------------------------------
    // Cette fonction est le chemin « le nom est suspect », et elle ignorait donc le nom
    // ENTIÈREMENT. C'était trop large : sur le Rhydon, le nom n'était pas suspect, il
    // n'avait simplement jamais été consulté — la recherche par nom avait rendu zéro
    // parce qu'on interroge /v2/ja avec un nom ANGLAIS quand TCGdex y stocke les noms
    // japonais. Or E4-055 est « ライドン » et E5-055 « マグカルゴ » : ce ne sont pas des
    // Pokémon voisins, le nom tranche sans le moindre appel réseau.
    // Le nom n'est utilisé ici que pour DÉPARTAGER des candidats déjà retenus par le
    // numéro : il ne peut ni en ajouter, ni faire échouer la recherche.
    const formesLues = [nomLu, nomBrut].filter(Boolean);
    if (retenues.length > 1 && formesLues.length) {
        // Les noms tels que TCGdex les rend DANS CETTE LANGUE. En `ja`, c'est `nomBrut`
        // (katakana) qui correspond ; en `en`, le nom translittéré par l'IA.
        //
        // ⚠️ IL N'Y A PAS DE REPLI PAR LE NOM ANGLAIS, et ce n'est pas un oubli. J'avais
        // écrit ce repli — récupérer le nom anglais du candidat pour le comparer à un nom
        // latin — avant de le mesurer : /v2/en/cards/E4-055 répond 404, alors que
        // /v2/ja/cards/E4-055 rend « ライドン ». Les identifiants de sets japonais
        // N'EXISTENT PAS dans l'espace de noms anglais ; le repli était donc du code mort
        // qui avait l'air de fonctionner, ce qui est pire que pas de code du tout.
        // Conséquence assumée : quand l'IA n'a rendu qu'un nom latin sur une carte
        // japonaise, l'égalité N'EST PAS tranchée — elle est signalée (`ambigu: true`) et
        // le choix reste déterministe. C'est la liaison par le CODE de set, mesurée à part,
        // qui donnera l'arbitre local qui manque ici.
        const concordants = retenues.filter(t => nomConcorde(formesLues, [t.carte.name]));
        if (concordants.length && concordants.length < retenues.length) {
            console.log(`🔤 [total] ${retenues.length} candidats au n°${number} -> ${concordants.length} retenu(s) par le NOM lu "${formesLues[0]}".`);
            retenues = concordants;
        }
    }

    // Tri STABLE, appliqué même quand un seul candidat reste : le choix ne doit jamais
    // dépendre de l'ordre d'arrivée. À défaut d'arbitrage, on veut un résultat REPRODUCTIBLE
    // et signalé, pas un tirage au sort silencieux.
    retenues = [...retenues].sort((a, b) =>
        String(a.set.id).localeCompare(String(b.set.id)) || String(a.carte.id).localeCompare(String(b.carte.id)));
    const gagnante = retenues[0];

    console.log(`🎯 [total] ${totalImprime} cartes -> set ${gagnante.set.id} ("${gagnante.set.name}") ; n°${number} -> ${gagnante.carte.id} ("${gagnante.carte.name}")`);
    if (retenues.length > 1) console.log(`   ⚠️ ${retenues.length} cartes candidates à ce numéro, et le nom ne les départage pas — identification marquée incertaine (choix déterministe : ${gagnante.carte.id}).`);
    if (setsInjoignables) console.log(`   ⚠️ ${setsInjoignables} set(s) sur ${sets.length} n'ont pas répondu : on ne peut pas affirmer qu'aucun autre ne portait ce numéro.`);
    return {
        id: gagnante.carte.id,
        localId: gagnante.carte.localId,
        nom: gagnante.carte.name,
        setId: gagnante.set.id,
        // Ambigu si plusieurs candidats subsistent, OU si un set n'a pas répondu : dans
        // les deux cas on ne peut pas garantir que ce numéro ne désigne qu'une carte.
        ambigu: retenues.length > 1 || setsInjoignables > 0
    };
}

/**
 * LE NOM QUI PARTIRA INTERROGER LE CATALOGUE — et il doit être en alphabet LATIN.
 *
 * ⚠️ RÉGRESSION DE PRODUCTION, ET ELLE VENAIT DE MOI. Le catalogue Cardmarket est en
 * ANGLAIS. En câblant `nomBrut` sur la route /v2/ja — pour que « ライドン » trouve enfin
 * la bonne carte — j'ai rendu la recherche par nom EFFICACE en japonais, et TCGdex a donc
 * commencé à rendre des `name` japonais. Ce nom partait ensuite dans
 * `trouverProduitsLocaux`, qui cherchait « ガラガラ » dans un catalogue anglais et ne
 * trouvait rien. Résultat : « aucun produit Cardmarket pour "ガラガラ" » sur 6 scans sur 8.
 *
 * C'EST EXACTEMENT LE DÉFAUT DIAGNOSTIQUÉ SUR L'AQUALI il y a des semaines — « le catalogue
 * est interrogé avec le nom d'affichage de TCGdex » — recréé par le correctif censé aider,
 * et cette fois sur TOUTES les cartes japonaises au lieu d'une.
 *
 * ET LE SYMPTÔME PARADOXAL QUI L'A RÉVÉLÉ : le Rhydon PASSAIT. Son kana lu (サイドン) ne
 * correspond pas à celui de TCGdex (ライドン), la route japonaise échouait donc, le repli
 * anglais prenait la main et tout marchait. Autrement dit : le succès dépendait d'une
 * lecture FAUSSE. Plus l'IA lisait juste, plus la chaîne cassait.
 *
 * LA RÈGLE : on préfère le nom anglais de TCGdex ; à défaut, le nom trouvé S'IL EST LATIN ;
 * à défaut, le nom translittéré par l'IA. Jamais un nom que le catalogue ne peut pas lire.
 */
function nomPourLeCatalogue(nomAnglaisTCGdex, nomTrouve, nomLuParIA) {
    const estLatin = s => typeof s === 'string' && s.trim() !== '' && !/[^\x00-\x7FÀ-ÿŒœ]/.test(s);
    if (estLatin(nomAnglaisTCGdex)) return nomAnglaisTCGdex;
    if (estLatin(nomTrouve)) return nomTrouve;
    if (estLatin(nomLuParIA)) {
        console.log(`🔤 [nom-catalogue] TCGdex ne rend qu'un nom non latin ("${nomTrouve}") -> on garde le nom lu par l'IA : "${nomLuParIA}".`);
        return nomLuParIA;
    }
    // Aucun nom latin nulle part : on rend ce qu'on a, et l'aval le signalera.
    return nomAnglaisTCGdex || nomTrouve || nomLuParIA || null;
}

async function trouverCarteTCGdex(name, number, setCode, imageUrlVinted, langue = 'EN', totalImprime = null, nomBrut = null) {
    try {
        const variantes = genererVariantesNom(name);
        let resultats = [];
        let nomUtilise = name;

        // On cherche d'abord dans la langue de la carte (le nom lu par l'IA correspond
        // mieux au nom TCGdex dans cette langue), puis en anglais en repli.
        const langueCarte = langueVersTCGdex(langue);
        const languesAEssayer = langueCarte === 'en' ? ['en'] : [langueCarte, 'en'];

        // ════════════════════════════════════════════════════════════════════
        // QUELLE ROUTE A RÉELLEMENT TROUVÉ LA CARTE
        // ════════════════════════════════════════════════════════════════════
        // Le repli ci-dessus est SILENCIEUX : une carte japonaise introuvable en [ja] est
        // cherchée en [en], et rien en aval ne distingue les deux cas. Trois questions
        // qu'on ne pouvait pas poser faute de ce champ :
        //   - la muteté de la route japonaise est-elle subie ou auto-infligée ? (répondue :
        //     subie — `nomBrut` est en kana sur 128/135 lignes)
        //   - combien d'identifications japonaises JUSTES passent par une carte occidentale
        //     ramenée par le repli, donc par une carte qui n'est pas la leur ?
        //   - le repli apporte-t-il quelque chose ? On ne retire pas un correcteur
        //     accidentel avant d'avoir mesuré ce qu'il corrige.
        // Une ligne au journal débloque les trois. Elle ne change AUCUN comportement.
        let langueRoute = null;

        // ⚠️ LE NOM BRUT SUR LA ROUTE NON ANGLAISE. TCGdex stocke ses noms DANS la langue
        // interrogée : /v2/ja rend « ライドン », pas « Rhydon ». Interroger cette route avec
        // le nom translittéré par l'IA ne pouvait donc rien rendre, et la chaîne basculait
        // systématiquement sur le chemin total+numéro pour les cartes japonaises — celui
        // qui a produit Turtonator pour un Flareon et m3 pour un Rhydon.
        // `nomBrut` est ce que l'IA a lu SANS le traduire : c'est exactement la clé de
        // cette route. Il passe EN PREMIER quand il existe, le nom translittéré reste en
        // repli. Sur les routes anglaises, rien ne change.
        const variantesPour = langApi => (langApi !== 'en' && nomBrut)
            ? [nomBrut, ...variantes.filter(v => v !== nomBrut)]
            : variantes;

        // Pour chaque langue, chaque variante de nom, essayer : numéro strict -> numéro large
        // ⚠️ `number` peut être NUL : c'est le cas quand la règle du numéro de Pokédex l'a
        // neutralisé (voir pokedex.js). On saute alors la recherche numérotée — la
        // construire avec `null` produirait la requête « eq:null », deux appels réseau pour
        // rien à chaque variante et à chaque langue — et on laisse la recherche par NOM SEUL
        // plus bas faire le travail. C'est exactement ce qu'on veut : sans numéro de carte
        // exploitable, le nom est le seul signal.
        const numeroExploitable = number != null && String(number).trim() !== '';
        for (const langApi of languesAEssayer) {
            if (!numeroExploitable) break;
            for (const variante of variantesPour(langApi)) {
                resultats = await chercherCartesTCGdex(variante, `eq:${encodeURIComponent(number)}`, langApi);
                if (resultats.length === 0) {
                    const numeroSansZeros = String(number).replace(/^0+/, '') || number;
                    resultats = await chercherCartesTCGdex(variante, encodeURIComponent(numeroSansZeros), langApi);
                }
                if (resultats.length > 0) {
                    nomUtilise = variante;
                    langueRoute = langApi;
                    if (langApi !== 'en' || variante !== name) console.log(`ℹ️ TCGdex : trouvé via "${variante}" en [${langApi}] (recherche initiale "${name}").`);
                    break;
                }
            }
            if (resultats.length > 0) break;
        }

        // Dernier recours : recherche par NOM SEUL (sans numéro) dans les deux langues
        if (resultats.length === 0) {
            for (const langApi of languesAEssayer) {
                for (const variante of variantesPour(langApi)) {
                    const parNom = await chercherCartesTCGdexNomSeul(variante, langApi);
                    if (parNom.length > 0) {
                        // Sans numéro exploitable, on garde TOUT ce que le nom a ramené :
                        // filtrer sur un numéro neutralisé écarterait la bonne carte.
                        const numLu = numeroExploitable ? String(number).replace(/^0+/, '') : null;
                        const matchNum = numLu ? parNom.filter(c => String(c.localId).replace(/^0+/, '') === numLu) : [];
                        resultats = matchNum.length > 0 ? matchNum : parNom;
                        nomUtilise = variante;
                        langueRoute = langApi;
                        console.log(`ℹ️ TCGdex : trouvé par nom seul via "${variante}" en [${langApi}] (${resultats.length} résultat(s)).`);
                        break;
                    }
                }
                if (resultats.length > 0) break;
            }
        }

        // ---- LE TOTAL PASSE AVANT LE NOM ----------------------------------------
        // Hiérarchie : numéro + total > set déclaré > NOM. Un set dont la taille ne
        // correspond pas au total imprimé ne doit pas pouvoir gagner, quel que soit
        // le nom lu — c'est ce qui aurait écarté Lost Thunder (214 cartes) sur une
        // carte lue "173/181", Team Up étant le seul set à 181 cartes.
        const resultatsDuNom = resultats;   // conservés comme filet, voir plus bas
        // La langue de la CARTE choisit le catalogue de sets. Avec la liste `en`, un total
        // japonais de 88 désignait « Perfect Order » (2025) et tous les résultats du nom
        // « Flareon » étaient écartés comme suspects : le nom était juste, c'est TCGdex qui
        // n'avait pas le set. Avec la liste `ja`, 88 donne E4/E5, où Flareon figure.
        const setsDuTotal = await setsPourTotal(totalImprime, langue);
        const idsSetsDuTotal = new Set(setsDuTotal.map(s => s.id));
        if (setsDuTotal.length && resultats.length) {
            const compatibles = resultats.filter(r => idsSetsDuTotal.has(setIdDeCarte(r.id)));
            if (compatibles.length && compatibles.length < resultats.length) {
                console.log(`🎯 Total ${totalImprime} -> ${resultats.length} résultats réduits à ${compatibles.length} (sets de la bonne taille).`);
                resultats = compatibles;
            } else if (compatibles.length === 0) {
                // Le nom a ramené des cartes, mais AUCUNE dans un set de la bonne taille :
                // c'est le nom qui est suspect, pas le total. On ne s'appuie plus dessus.
                console.warn(`⚠️ Aucun résultat de "${nomUtilise}" n'appartient à un set de ${totalImprime} cartes — le NOM lu est suspect.`);
                resultats = [];
            }
        }

        // Nom inexploitable (aucun résultat, ou tous écartés par le total) : on
        // identifie sans lui, par le total puis le numéro.
        if (resultats.length === 0) {
            const parTotal = await identifierParTotalEtNumero(number, totalImprime, langue, name, nomBrut);
            if (parTotal) {
                // Ce chemin ne cherche pas par nom : sa route est celle du catalogue de SETS,
                // et c'est donc elle qui doit servir à détailler la carte trouvée.
                const detail = await detailCarteTCGdex(parTotal.id, null, langueDesSetsTCGdex(langue));
                console.log(`🔗 Carte TCGdex retenue SANS le nom : ${parTotal.id} ("${detail.nomExact || parTotal.nom}")`);
                return {
                    id: parTotal.id, ambigu: parTotal.ambigu,
                    nomExact: nomPourLeCatalogue(detail.nomExact, parTotal.nom, name),
                    localId: parTotal.localId || number,
                    variants: detail.variants, variantsDetailed: detail.variantsDetailed,
                    source: 'total+numero',   // le nom lu est écarté, il ne sert plus à rien en aval
                    // Ce chemin ne cherche PAS par nom : sa route est celle du catalogue de
                    // SETS (`langueDesSetsTCGdex`), qui ne connaît que 'ja' et 'en'. On
                    // journalise la route réellement empruntée, pas celle qu'on aurait prise.
                    langueRoute: langueDesSetsTCGdex(langue)
                };
            }
            // ⚠️ FILET : le total est une PRÉFÉRENCE, jamais un veto qui fait tout perdre.
            // Si le nom avait ramené des cartes et que le total les a toutes écartées
            // SANS rien proposer en échange, c'est le TOTAL qui était mal lu — pas le
            // nom. On restaure alors les résultats du nom plutôt que d'échouer là où
            // l'ancien code réussissait.
            if (resultatsDuNom.length) {
                console.warn(`↩️ Le total ${totalImprime} n'a rien donné non plus : il est probablement mal lu. On revient aux ${resultatsDuNom.length} résultat(s) du nom.`);
                resultats = resultatsDuNom;
            } else {
                console.error(`⚠️ TCGdex : aucun résultat pour "${name}" #${number} (même avec variantes).`);
                return null;
            }
        }

        let choisi = resultats[0];
        let ambigu = false;

        if (resultats.length > 1) {
            console.log(`ℹ️ TCGdex : ${resultats.length} résultats pour "${nomUtilise}" #${number} :`, resultats.map(r => r.id));

            // Départage par le code du set lu par l'IA. (La comparaison d'images a été
            // retirée : sur des photos d'annonce, elle donnait 35-41/64 même pour la
            // bonne carte — donc aucun signal exploitable.)
            const correspondance = setCode ? resultats.find(r => r.id.toLowerCase().includes(setCode.toLowerCase())) : null;

            if (correspondance) {
                choisi = correspondance;
                console.log(`ℹ️ Départage par le set "${setCode}".`);
            } else {
                // Pas de code de set lisible (fréquent sur les vieilles cartes). On tente
                // de trancher par le TOTAL imprimé (X/Y -> Y) : chaque set a un nombre de
                // cartes officiel. On récupère le cardCount des sets candidats via TCGdex
                // et on garde celui qui colle. Corrige "même numéro dans plusieurs sets"
                // (ex: Venusaur 3/108 Dark Explorers vs Venusaur ex #3 du set 151).
                const totN = totalImprime ? parseInt(String(totalImprime).replace(/\D/g, ''), 10) : null;
                let departageTotal = null;
                if (totN) {
                    // Ce chemin n'a PAS d'early-exit (il faut vérifier tous les sets candidats
                    // de toute façon), contrairement à la recherche par variante ci-dessus :
                    // paralléliser ne change donc AUCUN volume total de requêtes TCGdex, juste
                    // leur ordonnancement. Sets distincts typiquement peu nombreux (2 à 5 ici),
                    // pas besoin d'un plafond de concurrence.
                    const setIds = [...new Set(resultats.map(r => r.id.includes('-') ? r.id.slice(0, r.id.lastIndexOf('-')) : null).filter(Boolean))];
                    const countParSet = {};
                    await Promise.all(setIds.map(async setId => {
                        try {
                            const s = await axios.get(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`, { timeout: 12000 });
                            countParSet[setId] = s.data?.cardCount?.official ?? s.data?.cardCount?.total ?? null;
                        } catch (_) { countParSet[setId] = null; }
                    }));
                    const matches = resultats.filter(r => {
                        const setId = r.id.includes('-') ? r.id.slice(0, r.id.lastIndexOf('-')) : null;
                        return setId && countParSet[setId] === totN;
                    });
                    if (matches.length === 1) {
                        departageTotal = matches[0];
                    } else if (matches.length > 1) {
                        choisi = matches[0];
                        ambigu = true;
                        console.log(`⚠️ ${matches.length} sets à ${totN} cartes pour "${name}" #${number} — le live tranchera.`);
                    }
                }
                if (departageTotal) {
                    choisi = departageTotal;
                    console.log(`ℹ️ Départage par le total imprimé (${totN} cartes) -> ${choisi.id}.`);
                } else if (!ambigu) {
                    // Aucun moyen de trancher : premier candidat, marqué incertain. Le
                    // garde-fou live vérifiera le numéro et rebondira si besoin.
                    ambigu = true;
                    console.log(`⚠️ ${resultats.length} impressions possibles pour "${name}" #${number} et pas de set pour trancher — le live vérifiera.`);
                }
            }
        }

        // ---- CONTRÔLE FINAL : le total imprimé contredit-il le set retenu ? -----
        // TCGdex annonce lui-même le nombre officiel de cartes de chaque set. Si l'IA a lu
        // un total et que le set retenu en annonce un AUTRE, la carte retenue ne peut pas
        // venir de ce set. Cas réel — Wartortle lu « 019/029 » : TCGdex retenait PCG8-019,
        // alors que PCG8 「きせきの結晶」 compte 75 cartes officielles. Une carte imprimée
        // /029 n'en vient pas. Le filtre par total ne l'attrapait pas, parce qu'AUCUN set
        // (ni en, ni ja) ne fait 29 cartes : la liste des sets compatibles était vide, donc
        // le filtre entier était sauté.
        // On ne REJETTE pas — le total peut être mal lu, et la carte retenue reste le
        // meilleur candidat connu — mais on cesse de la présenter comme une certitude.
        const totalLu = totalImprime ? parseInt(String(totalImprime).replace(/\D/g, ''), 10) : null;
        if (totalLu) {
            const setRetenu = setIdDeCarte(choisi.id);
            const infoSet = (await chargerSetsTCGdex(langueDesSetsTCGdex(langue))).find(s => s.id === setRetenu);
            const officiel = infoSet?.cardCount?.official ?? null;
            if (officiel && officiel !== totalLu) {
                ambigu = true;
                console.warn(
                    `⚠️ [total-contredit-le-set] le total lu est ${totalLu}, mais le set retenu` +
                    ` ${setRetenu} ("${infoSet.name}") en compte ${officiel} officiellement.` +
                    ` La carte retenue ne peut pas venir de ce set -> résultat marqué INCERTAIN.`
                );
            }
        }

        // ⚠️ SUR LA ROUTE QUI A TROUVÉ LA CARTE. Avant l'alignement, ce détail partait
        // toujours en /v2/en : pour toute carte trouvée en [ja], il ne rendait rien, et
        // `variants`/`variantsDetailed` sortaient nuls sans que rien ne le dise.
        const detail = await detailCarteTCGdex(choisi.id, choisi.name, langueRoute);
        const nomExact = nomPourLeCatalogue(detail.nomExact, choisi.name, name);

        console.log(`🔗 Carte TCGdex retenue : ${choisi.id} ("${nomExact}")${ambigu ? ' [INCERTAIN]' : ''}`);
        return {
            id: choisi.id, ambigu, nomExact, localId: choisi.localId || number,
            variants: detail.variants, variantsDetailed: detail.variantsDetailed,
            source: 'nom',
            // La route qui a trouvé la carte — et, depuis l'alignement, celle qui l'a aussi
            // détaillée. Les deux ne peuvent plus diverger : `variants` ci-dessus décrit
            // bien la carte retenue, pas une homonyme d'un autre espace d'identifiants.
            langueRoute
        };

    } catch (e) {
        // ⚠️ DEUX ÉTATS DU MONDE, DEUX VALEURS DE RETOUR. Ce catch rendait `null` dans tous
        // les cas — la même valeur que « zéro résultat ». Un incident réseau était donc
        // indiscernable d'une carte qui n'existe pas, et sortait en refus délibéré doré.
        // Voir estUnePanneReseau pour la ligne de partage et pour le sens du doute.
        if (estUnePanneReseau(e)) {
            console.error(`🔌 TCGdex INJOIGNABLE pour "${name}" #${number} (${e.code || e.response?.status || e.message}) — PANNE, pas une absence.`);
            return TCGDEX_EN_PANNE;
        }
        console.error(`❌ Erreur recherche TCGdex pour "${name}" #${number} :`, e.response?.status, e.message);
        return null;
    }
}

async function getPrixDepuisTCGdex(cardId, name, number) {
    try {
        const url = `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`;
        const response = await axios.get(url, { timeout: 15000 });
        const cardmarket = response.data?.pricing?.cardmarket;

        if (!cardmarket) {
            console.error(`⚠️ TCGdex : pas de données Cardmarket pour "${cardId}" (carte pas encore cotée sur Cardmarket ?).`);
            return null;
        }

        // On privilégie la tendance (reflète le mieux le prix actuel), avec replis successifs
        const prix = cardmarket.trend ?? cardmarket.avg ?? cardmarket['trend-holo'] ?? cardmarket['avg-holo'] ?? cardmarket.avg7 ?? cardmarket.avg30;

        if (typeof prix !== 'number') {
            console.error(`⚠️ TCGdex : objet cardmarket vide/incomplet pour "${cardId}".`, cardmarket);
            return null;
        }

        console.log(`✅ Prix TCGdex/Cardmarket pour "${cardId}" : ${prix} €`);

        // TCGdex ne fournit pas l'URL exacte de la fiche Cardmarket -> on donne un lien de
        // recherche Cardmarket fonctionnel (pas la fiche exacte, mais jamais cassé).
        const urlRecherche = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name + ' ' + number)}`;

        return { price: prix, url: urlRecherche };

    } catch (e) {
        console.error(`❌ Erreur récupération prix TCGdex pour "${cardId}" :`, e.response?.status, e.message);
        return null;
    }
}



// ============================================================
// Détection de région (occidental vs japonais) pour éviter de confondre
// une carte FR/EN (ex: Destined Rivals) avec son édition japonaise (sv9a).
// ============================================================
// regionDuCodeSet vit dans scoring.js : c'est une fonction PURE, et ses cas limites
// (MCDP vs MCD11, SI vs SI-JP, xPRE vs xsv8a, "SV-P/CS" neutre) sont vérifiés par la
// suite de tests de ce module. Elle est importée en tête de fichier.

// Région attendue déduite de ce que l'IA a lu :
//  - langue JP -> japonais (= bucket ASIATIQUE)
//  - chinois (ZH) / coréen (KR) -> asiatique aussi. Cardmarket range le chinois
//    simplifié ET traditionnel + le coréen du côté japonais (même numérotation) ;
//    leurs produits (codes type "mC", "...C") sont classés "japonais" ici. Sans ça,
//    une carte chinoise prenait -45 de malus région et la bonne carte perdait.
//  - langue occidentale (FR/EN/DE/ES/IT/PT) -> occidental
//  - à défaut, la structure du numéro : "184/182" (occidental) vs pas de total (souvent JP)
function regionAttendue(cardInfo) {
    const langue = (cardInfo.language || '').toUpperCase();
    if (langue === 'JP') return 'japonais';
    if (['ZH', 'KR', 'ZH-CN', 'ZH-TW', 'CN', 'TW'].includes(langue)) return 'japonais';
    if (['FR', 'EN', 'DE', 'ES', 'IT', 'PT'].includes(langue)) return 'occidental';
    // Repli sur la structure du numéro : un total présent (X/Y) = format occidental
    if (cardInfo.total) return 'occidental';
    return null;
}

// Normalise un nom pour comparaison : minuscules, sans espaces/tirets/ponctuation.
// "M Kangaskhan EX" et "MKangaskhan EX" -> "mkangaskhanex" (identiques).
function normaliserNom(nom) {
    return nom.toLowerCase().replace(/[\s\-'.&]/g, '');
}

// ============================================================
// ÉCARTE LES NON-CARTES du vivier de candidats
// ============================================================
// Cardmarket range dans le même catalogue que les cartes les « Online / Live Code
// Card » : les cartons de code numérique glissés dans les boosters. Ce ne sont pas des
// cartes Pokémon, on ne les scannera jamais, et elles n'ont aucune raison de disputer
// un score à la vraie carte.
//
// POURQUOI CE CRITÈRE-LÀ, ET LUI SEUL. Mesuré sur les 70 975 produits du catalogue :
//   - 1246 produits contiennent « Code Card », dont 460 portaient un numeroUrl parasite
//     valant "2" (extrait de "?language=2" — voir nettoyer-slugs.js), ce qui les rendait
//     appariables à n'importe quelle carte n°2 ;
//   - un seul porte un `numero` : idProduct 279891, numero "CC-1", dans l'expansion 1645
//     (code PKM) dont les 443 produits sont TOUS des Code Cards. "CC-1" est la référence
//     Cardmarket du carton lui-même, pas un numéro de carte : rien à sauver ;
//   - contrôle décisif : 0 produit non-Code-Card ne partage un idMetacard avec une Code
//     Card. L'exclusion ne peut donc pas emporter une impression légitime par ricochet.
//
// Et surtout, les autres familles qu'on aurait pu croire non-cartes n'en sont pas :
// « Suspicious Food Tin » et « Amulet Coin » sont de vrais Dresseurs, « Talonflame
// (Theme Deck) » une vraie carte, « [… | Burn Booster] » et « [Random Spark] » des noms
// d'attaques. Hors Code Card, les motifs Display/Playmat/Portfolio/Figurine ne ramènent
// AUCUN produit. Un filtre par mots-clés « booster / tin / coin » jetterait des cartes
// réelles : « Code Card » est le seul critère juste, et il suffit.
const EST_CODE_CARD = /code\s*card/i;

function ecarterNonCartes(produits, contexte) {
    if (!Array.isArray(produits) || produits.length === 0) return produits;
    const gardes = produits.filter(p => !EST_CODE_CARD.test(String(p?.name || '')));
    const ecartes = produits.length - gardes.length;
    if (ecartes > 0) {
        console.log(`🚮 ${ecartes} Code Card écartée(s) du vivier (${contexte}) — reste ${gardes.length} candidat(s).`);
    }
    // Vivier vidé : on renvoie bien le vide. Un vivier composé UNIQUEMENT de Code Cards
    // ne peut produire qu'un verdict faux ; mieux vaut l'échec franc, qui rembourse le
    // scan, qu'un prix de carton de code présenté comme celui d'une carte.
    if (gardes.length === 0 && produits.length > 0) {
        console.warn(`⚠️ [non-cartes] les ${produits.length} candidat(s) de "${contexte}" étaient tous des Code Cards.`);
    }
    return gardes;
}

// ============================================================
// CHOIX DU VIVIER — la règle du « aucun candidat au numéro lu »
// ============================================================
// LE TROU QU'ELLE BOUCHE. Aujourd'hui, trouverProduitsParNumero n'est tenté QUE si le
// vivier par nom est VIDE. Or il existe un cas où il est plein et pourtant inutilisable :
// l'IA lit un nom faux qui EXISTE ailleurs. Mesuré sur le cas réel — « Kahili » lu au
// lieu de « Dana » ramène 8 produits, aucun au n°173, et le scoring rend quand même un
// gagnant à 70 points sans le moindre avertissement.
//
// Ce cas ne passe aujourd'hui que grâce à `numeroContredit`, qui exige que TCGdex ait
// rendu une carte au numéro divergent. Ce garde-fou tombe dès que TCGdex est D'ACCORD
// avec la mauvaise lecture (voir le test 24 de scoring.js, qui simule cet accord).
//
// LA RÈGLE, en clair :
//   1. Vivier par le nom. S'il contient AU MOINS UN candidat de rang 1 (son numéro
//      correspond à celui lu) -> on le garde. Comportement inchangé.
//   2. Sinon — et seulement si au moins un candidat CONTREDIT le numéro, voir la note
//      sur la preuve positive dans bilanDesRangs — on construit le vivier par NUMÉRO :
//      d'abord dans les expansions attendues (si elles ont survécu au contrôle de
//      setCode), puis, à défaut seulement, sur TOUT le catalogue.
//   3. Si aucun des deux n'a de rang 1 -> on garde le meilleur vivier disponible et on
//      LIVRE le prix, marqué `carteIncertaine` avec le motif `aucun-candidat-au-numero`.
//      Un prix avec réserve vaut mieux que rien, et la politique de remboursement traite
//      déjà « livré avec réserve » comme livré.
//   4. Aucun vivier du tout -> échec dur et remboursement. Inchangé (`aucun-candidat`).
//
// ⚠️ POURQUOI LE PÉRIMÈTRE D'ABORD, ET TOUT LE CATALOGUE SEULEMENT ENSUITE. Le réflexe
// était de chercher d'emblée dans tout le catalogue, pour ne pas dépendre d'un set
// attendu qui peut être faux. MESURÉ SUR LES DIX CAS : ça en casse quatre.
//   - le n°173 existe dans 115 produits occidentaux, TOUS à 120 points, le bon à 95 :
//     sans setCode lu, le total (181 -> Team Up) est le SEUL discriminant, et c'est
//     exactement ce que l'expansion attendue apporte. Idem pour Nita et Evelyn.
//   - le n°024 existe dans 510 produits ; les promos SVP et SV-P décrochent +40 (code
//     égal au « SV-P » lu) contre +15 pour la ligne chinoise SV-P/CS, qui est la bonne.
// Le périmètre n'est donc PAS le problème : le périmètre INVALIDE l'est. C'est pour ça
// que le contrôle vit en amont, dans expansionsDuSetTCGdex — quand le setCode lu
// contredit le code de l'expansion attendue, celle-ci est abandonnée et ne cadre plus
// rien. Le vivier sans périmètre reste utile en DERNIER recours : au plus ~850 produits
// (mesuré : 828 pour le n°004, 855 pour le n°1), mieux que rien du tout.
//
// On ne réordonne RIEN : le rang ne devient pas un critère de score. Il sert à choisir
// le vivier, puis à qualifier la confiance.
//
// ⚠️ Les candidats reçus ici viennent du CATALOGUE et ne portent donc PAS de numéro :
// il faut le lire avant de pouvoir juger d'un rang. La première version l'a oublié, et
// comme rangDuNumero rend « inconnu » sur un champ absent, la substitution se
// déclenchait à CHAQUE scan — c'est ce qui a fait afficher 0,05 € sur le Salamèche.
/**
 * Le vivier par le nom, cherché avec les DEUX noms disponibles et UNI.
 *
 * `nomCatalogue` est le nom rendu par TCGdex (pont de langue vers un catalogue anglais) ;
 * `nomLu` est ce que l'IA a lu sur la photo. Ils coïncident presque toujours — mesuré :
 * 62 fois sur 65. Quand ils divergent, c'est parce que TCGdex a désigné une autre carte,
 * et le vivier construit sur son seul nom ne contient alors pas la bonne.
 *
 * ⚠️ L'UNION NE PEUT QUE GROSSIR LE VIVIER, jamais le réduire : elle ne retire aucun
 * candidat que la version d'origine aurait retenu. Le seul risque est en aval, dans le
 * classement — et il est mesuré à +1 candidat au pire sur 38 lignes.
 *
 * Dédoublonnage par `idProduct` : les deux recherches ramènent massivement les mêmes
 * produits, et un doublon fausserait les comptes d'ex aequo autant que le scoring.
 */
async function viviersUnis(nomCatalogue, nomLu) {
    // Les deux interrogations sont ENVELOPPÉES : une panne sur l'une ou l'autre est
    // retenue par le contexte de scan (sources.js) au lieu de se confondre avec « ce nom
    // n'existe pas au catalogue ». Le comportement reste le même — on continue avec ce
    // qu'on a — mais la sortie finale saura qu'elle n'a pas tout vu.
    const { liste: premier } = nomCatalogue
        ? await interrogerSource('catalogue/nom', () => trouverProduitsLocaux(nomCatalogue))
        : { liste: [] };
    // Même nom (à la casse et aux accents près) : rien à unir, on évite l'aller-retour Mongo.
    const memeNom = nomCatalogue && nomLu && normaliserNom(nomCatalogue) === normaliserNom(nomLu);
    if (memeNom || !nomLu) return premier;

    const { liste: second } = await interrogerSource('catalogue/nom', () => trouverProduitsLocaux(nomLu));
    if (!second.length) return premier;

    const parId = new Map();
    for (const p of [...premier, ...second]) if (!parId.has(p.idProduct)) parId.set(p.idProduct, p);
    const union = [...parId.values()];
    if (union.length !== premier.length) {
        console.log(`🔗 [vivier-uni] "${nomCatalogue}" (${premier.length}) + "${nomLu}" (${second.length}) -> ${union.length} candidat(s) uniques.`);
    }
    return union;
}

async function viviersAvecRangs(vivierNom, numeroLu, idExpansionsAttendues, contexte) {
    // Enrichissement MINIMAL : uniquement le numéro, seul champ dont les rangs dépendent.
    // C'est l'étape qui manquait : les documents catalogue n'ont pas de numeroCardmarket.
    const rangsDe = async produits => {
        const numeros = await lireNumeros(produits.map(p => p.idProduct));
        return bilanDesRangs(produits.map(p => {
            const d = numeros.get(p.idProduct);
            return { idProduct: p.idProduct, numeroCardmarket: d ? (d.numero || d.numeroUrl) : null };
        }), numeroLu);
    };
    const rangsNom = await rangsDe(vivierNom);

    if (!rangsNom.aucunRang1) {
        // Cas fréquent et sain. Mais si AUCUN numéro n'est connu, on le dit : ce n'est
        // pas la même chose qu'un vivier validé, et ça signale un set non appris.
        if (rangsNom.aucunNumeroConnu) {
            console.log(`ℹ️ ${contexte} : ${vivierNom.length} candidat(s), aucun numéro appris — rangs indisponibles, vivier conservé.`);
        }
        return { produits: vivierNom, voie: 'nom', aucunCandidatAuNumero: false, rangs: rangsNom };
    }

    // Preuve positive : au moins un candidat porte un numéro connu, et il contredit.
    // Le log dit ce qu'il a RÉELLEMENT constaté — combien de numéros étaient lisibles,
    // combien contredisaient. « aucun au numéro X » tout court était mensonger quand le
    // vivier n'avait simplement aucun numéro appris.
    console.warn(
        `⚠️ [vivier-sans-rang1] ${contexte} : ${vivierNom.length} candidat(s) par le nom,` +
        ` ${rangsNom.rang1 + rangsNom.rang3} à numéro connu dont ${rangsNom.rang3} qui CONTREDISENT` +
        ` le numéro ${numeroLu}, 0 qui le portent, ${rangsNom.rang2} sans numéro appris` +
        ` -> recherche par NUMÉRO`
    );

    // 1er repli : DANS LES EXPANSIONS ATTENDUES. Elles ont déjà passé le contrôle de
    // setCode (voir expansionsDuSetTCGdex) : si elles sont encore là, elles ne sont pas
    // contredites. Et elles portent une information que le numéro seul n'a pas — sur les
    // trois cas Team Up, le total est le SEUL discriminant entre 115 produits au n°173.
    const exps = (idExpansionsAttendues || []).filter(e => e != null);
    for (const [ouCherche, chercher] of [
        [`l'expansion attendue ${exps.join('/') || '—'}`,
        () => exps.length
            ? interrogerSource('catalogue/numero-expansion', () => trouverProduitsParNumero(exps, numeroLu)).then(r => r.liste)
            : []],
        // 2e repli, en DERNIER recours : tout le catalogue. Moins discriminant (mesuré :
        // il fait perdre 4 des 10 cas s'il passe en premier), mais mieux que rien quand
        // aucune expansion n'est attendue ou qu'elle ne contient pas ce numéro.
        ['tout le catalogue',
            () => interrogerSource('catalogue/numero-partout', () => trouverProduitsParNumeroPartout(numeroLu)).then(r => r.liste)]
    ]) {
        const parNumero = await chercher();
        if (!parNumero.length) continue;
        const rangs2 = await rangsDe(parNumero);
        if (rangs2.rang1 > 0) {
            // ════════════════════════════════════════════════════════════════
            // 📌 REMPLACER PLUTÔT QU'ÉTENDRE — amélioration NON URGENTE, notée
            //    le 2026-09-03 sur le cas Milotic δ 5/101
            // ════════════════════════════════════════════════════════════════
            // ⚠️ CE N'EST PAS LE CORRECTIF DE CE CAS-LÀ, et c'est important : sur Milotic,
            // le vivier par nom (52 candidats) NE CONTENAIT PAS la bonne carte, et c'est
            // le repli qui l'a ramenée (277210 est dans les 697 au n°5). Le remplacement a
            // SAUVÉ ce scan. Il ne l'a pas cassé.
            // L'objection reste vraie en général : rien ne garantit que le vivier de repli
            // contienne ce que le premier avait. ÉTENDRE (52 + 697, dédoublonnés) est
            // strictement plus sûr pour 52 candidats de plus — soit ~0,8 s au tarif mesuré
            // de 15,6 ms par candidat. Non urgent, mais gratuit en justesse.
            //
            // 🔑 ET LA VRAIE CAUSE EST EN AMONT, elle : le vivier par nom était faux.
            // Le catalogue nomme la carte « Milotic δ Delta Species » ; la carte porte
            // « Milotic ». « Delta Species » N'EST PAS IMPRIMÉ — aucune lecture, humaine
            // ou IA, ne peut le produire. La correspondance par nom EXACT l'exclut donc
            // par construction. MESURÉ le 2026-09-03 :
            //   · 355 produits portent la queue « δ Delta Species » (0,5 % du catalogue) —
            //     c'est le défaut STRUCTUREL : le nom n'est pas lisible ;
            //   · 11 852 produits (16,2 %) ont un nom « <nom existant> + suffixe », mais
            //     ⚠️ LA PLUPART DE CES SUFFIXES SONT IMPRIMÉS (`ex` 4 821, `V/VMAX/VSTAR`
            //     3 570, `Lv.X` 2 613, `X's Y` 4 159, `BREAK`, `Star`…). Pour ceux-là le
            //     nom EST lisible : c'est une FRAGILITÉ de lecture, pas un défaut de
            //     catalogue. Confondre les deux ferait chiffrer le problème à 16 % au lieu
            //     de 0,5 %, et attaquer le mauvais bout.
            //   · en production, la signature du repli (vivier ≥ 200) apparaît sur
            //     4 lignes sur 188 — 2,1 %, dont deux sont le MÊME Milotic rescanné.
            //     Trois cartes distinctes en cinq semaines : réel, structurel, et RARE.
            //
            // ⚠️ ET L'AUTRE BOUT NE SUFFIRAIT PAS NON PLUS. TCGdex avait donné `ex15-5`,
            // la bonne réponse. Chercher le n°5 DANS ce set était impossible : le pont
            // `ex15 -> DF` n'est pas appris. Mesuré : 139 `setTcgdex` distincts appris pour
            // ~218 sets publiés par TCGdex, et seulement 25,6 % des lignes de
            // `numeros_cartes` portent un `setTcgdex`. Réparer les noms sans réparer les
            // ponts laisserait ce chemin muet.
            console.log(`   ↪️ vivier REMPLACÉ depuis ${ouCherche} : ${parNumero.length} candidat(s), ${rangs2.rang1} au rang 1.`);
            return { produits: parNumero, voie: 'numero-substitue', aucunCandidatAuNumero: false, rangs: rangs2 };
        }
    }
    // Aucune voie ne donne de candidat au bon numéro. On livre quand même — un prix avec
    // réserve vaut mieux que rien — mais la réserve est explicite et nommée.
    console.warn(`   ⚠️ aucun candidat au numéro ${numeroLu} par aucune voie -> résultat marqué incertain.`);
    return { produits: vivierNom, voie: 'nom', aucunCandidatAuNumero: true, rangs: rangsNom };
}

// Retrouve le(s) produit(s) dans le catalogue local pour un nom de carte donné.
// Utilise une comparaison NORMALISÉE (ignore espaces, tirets, casse, ponctuation)
// car le format Cardmarket est très irrégulier (MKangaskhan, Mega Kangaskhan ex...).
async function trouverProduitsLocaux(nomExact) {
    try {
        if (mongoose.connection.readyState !== 1) return [];

        // Le nom Cardmarket a la forme "Nom [Attaques]". On isole le nom (avant le [) et on normalise.
        // On construit d'abord une liste de "cœurs de nom" à accepter (nom + variantes principales).
        const cibles = new Set();
        for (const v of genererVariantesNom(nomExact)) cibles.add(normaliserNom(v));

        // Récupère un sur-ensemble via le 1er mot significatif (indexé, rapide), puis filtre en JS
        const premierMot = nomExact.replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];
        if (!premierMot || premierMot.length < 3) {
            // Nom trop court pour pré-filtrer : on tente une regex directe sur les variantes
            const variantes = genererVariantesNom(nomExact);
            for (const variante of variantes) {
                const regex = new RegExp(`^${echapperRegex(variante)}(\\s*\\[|$)`, 'i');
                const r = await CatalogueProduit.find({ name: regex }).lean();
                if (r.length > 0) return ecarterNonCartes(r, `nom court "${nomExact}"`);
            }
            return [];
        }

        const preselection = await CatalogueProduit.find({ name: new RegExp(echapperRegex(premierMot), 'i') }).lean();

        // Garde ceux dont le nom (partie avant "[") normalisé correspond à une de nos cibles
        const resultats = preselection.filter(p => {
            const nomProduit = p.name.split('[')[0].trim();
            if (cibles.has(normaliserNom(nomProduit))) return true;
            // ── L'ASYMÉTRIE DU NIVEAU ──────────────────────────────────────────────
            // `genererVariantesNom` élargit le nom CHERCHÉ ; rien n'élargissait le nom du
            // PRODUIT. La recherche était donc asymétrique : « Dragonite Lv.61 » trouvait
            // « Dragonite », mais « Dragonite » ne trouvait pas « Dragonite Lv.61 ».
            // Cas réel : la vérité du testeur est 698502 « Dragonite Lv.61 » (DP5c), et le
            // vivier par le nom ne l'a JAMAIS contenue — l'échec venait d'avant le
            // périmètre, pas du périmètre.
            //
            // ⚠️ SEULEMENT LE NIVEAU, et c'est mesuré famille par famille sur les 41 noms
            // du journal (2093 candidats au total aujourd'hui) :
            //   Lv.N / Lv.X ............... +184 candidats  (+8,8 %)   ADOPTÉ
            //   ex / GX / V / VMAX / VSTAR  +484 candidats  (+23 %)    REFUSÉ
            //   δ Delta Species ............ +39 candidats             non adopté
            //   ☆ / Star .................... +0                       sans objet
            //   Prime / LEGEND / BREAK ...... +7                       non adopté
            // LE CRITÈRE, EN UNE LIGNE : on élargit sur ce qui n'est PAS lu par l'IA,
            // jamais sur ce qui distingue deux cartes différentes.
            // Un « Charizard ex » est une AUTRE carte, à un autre prix, et l'IA lit « ex »
            // parce que c'est écrit dans le bandeau du nom. Le niveau est une petite
            // mention qu'elle ne reprend pas : même Pokémon, pas autre carte. δ et
            // Prime/LEGEND/BREAK restent dehors pour la même raison qu'« ex ».
            const sansNiveau = nomProduit.replace(/[\s-]*Lv\.?\s?(X|\d+)\b/i, '').trim();
            return sansNiveau !== nomProduit && cibles.has(normaliserNom(sansNiveau));
        });

        if (resultats.length > 0) {
            console.log(`ℹ️ Catalogue local : ${resultats.length} produit(s) via correspondance normalisée pour "${nomExact}".`);
            return ecarterNonCartes(resultats, `nom "${nomExact}"`);
        }
        return [];
    } catch (e) {
        // ⚠️ NE REND PLUS `[]`. Une source qui décide seule qu'une panne vaut « rien
        // trouvé » EST le défaut que sources.js ferme : l'aval lirait ce vide comme un
        // fait sur le catalogue. On nomme la source et on relance — c'est
        // `interrogerSource`, au point d'appel, qui décide et qui journalise.
        e.source = 'trouverProduitsLocaux';
        throw e;
    }
}

/**
 * Retrouve des produits Cardmarket par (expansion, NUMÉRO) — sans jamais passer par le
 * nom. C'est le pendant catalogue de identifierParTotalEtNumero : une fois le SET connu
 * grâce au total, le numéro suffit à désigner la carte.
 *
 * Règle le nom halluciné (Dana lue "Kahili") ET le nom inapparieable ("_____'s Pikachu",
 * dont le nombre de tirets bas diffère entre TCGdex et Cardmarket).
 *
 * ⚠️ PRÉFÉRENCE STRICTE POUR L'ÉGALITÉ EXACTE. Les numéros à préfixe sont fréquents
 * (1936 en base : "TG09", "SV14", "001C") et ils collisionnent avec les numéros nus de
 * la même expansion — mesuré : l'expansion 3630 contient "SV14" ET "14", l'expansion
 * 4361 contient "001C"/"001L"/"001P"/"001M". On ne retombe sur l'égalité de chiffres
 * que si aucune correspondance exacte n'existe, et on renvoie alors TOUS les candidats
 * plutôt que d'en choisir un : c'est au scoring de trancher.
 */
async function trouverProduitsParNumero(idExpansions, numeroLu) {
    try {
        if (mongoose.connection.readyState !== 1) return [];
        const exps = [...new Set((idExpansions || []).filter(e => e != null).map(Number))];
        if (!exps.length || numeroLu == null) return [];

        const docs = await NumeroCarte.find({ idExpansion: { $in: exps } }, { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 }).lean();
        return departagerParNumero(docs, numeroLu, `l'expansion ${exps.join('/')}`);
    } catch (e) {
        // Rapporte, ne décide pas — voir sources.js et `trouverProduitsLocaux`.
        e.source = 'trouverProduitsParNumero';
        throw e;
    }
}

// ============================================================
// CHEMIN DE RECHERCHE : le code de set LU + le numéro LU
// ============================================================
// POURQUOI IL EXISTE, ET POURQUOI IL EST EN TÊTE. Jusqu'ici le setCode ne servait qu'à
// SCORER un candidat déjà trouvé, ou à invalider une expansion attendue. Or (code, numéro)
// est une CLÉ du catalogue : il n'y avait aucune raison de ne pas s'en servir pour
// chercher. Ce chemin ne dépend ni de TCGdex, ni du nom, ni du titre de l'annonce — donc
// il survit exactement là où les autres tombent. Trace réelle : l'Aquali δ, où TCGdex
// avait trouvé la bonne carte (PCG6-030) et où le catalogue a été interrogé avec le nom
// d'AFFICHAGE japonais de TCGdex, « Vaporeon（デルタ種）», qui ne correspond à rien chez
// nous. La bonne réponse était là et elle a été jetée à la dernière étape.
//
// CE QU'IL COUVRE, MESURÉ (49 scans journalisés, catalogue de 69 729 produits) :
//   - l'IA rend un setCode sur 67,3 % des scans ; il existe au catalogue dans 84,8 % de
//     ces cas ; code ET numéro exploitables sur 55,1 % des scans ;
//   - il tranche (un seul produit) sur 85,2 % de ceux-là, soit 47 % de tous les scans ;
//   - plafond : (code + numéro) désigne un produit UNIQUE pour 77,7 % du catalogue.
//
// CE QU'IL NE COUVRERA JAMAIS, ET C'EST STRUCTUREL. 41 expansions — 2 101 produits, 3,0 %
// du catalogue — n'ont AUCUN numéro publié par Cardmarket. Le Rocket Gang japonais (ROG,
// 65 produits, 65 déjà lus, 0 numéro) en fait partie : ROG+149 rend zéro produit, quoi que
// l'IA lise sur la carte, et aucun apprentissage n'y changera rien. Pour ces 2 101
// produits, c'est le NOM qui tranche — il désigne un produit unique dans 92,2 % des cas
// dès lors que l'expansion est connue.
// D'où la règle : setCode+numéro D'ABORD, puis nom+région. Les deux mécanismes se
// RELAIENT, ils ne se remplacent pas. Le contre-exemple qui l'établit : « Vaporeon » seul
// ramène 71 produits — pour lui, seul le code tranche ; « Dark Dragonite » n'a pas de
// numéro — pour lui, seul le nom tranche.
async function trouverParSetCodeEtNumero(setCodeLu, numeroLu, langue = null) {
    try {
        if (mongoose.connection.readyState !== 1 || numeroLu == null) return [];
        const brut = normaliserCodeSet(setCodeLu);
        if (!brut) return [];
        const code = ALIAS_CODES_LUS.get(brut) || brut;

        // Les 747 lignes de codes_set sont lues en entier : la normalisation (majuscules,
        // suppression des séparateurs) se fait en JS et ne peut pas être poussée dans la
        // requête. C'est ~45 Ko par scan, à comparer aux ~4 s d'appel IA que tout scan paie
        // de toute façon. Pas de cache : codes_set s'enrichit en continu via /api/apprendre,
        // et un cache périmé rendrait un code introuvable sans le moindre signe.
        const lignes = await CodeSet.find({}, { idExpansion: 1, codeSet: 1, region: 1 }).lean();
        let exps = lignes.filter(l => normaliserCodeSet(l.codeSet) === code);

        // CODE APPARENTÉ, EN REPLI SEULEMENT. L'IA lit ce qui est IMPRIMÉ sur la carte, et
        // l'imprimé n'est pas toujours le code Cardmarket : « MCD » lu pour l'expansion
        // « MCDP ». Sans ce repli, zéro code exact -> le chemin ne se déclenche pas, alors
        // que la bonne réponse est à un caractère. Mesuré sur ce cas : 14 codes apparentés,
        // 15 produits au n°004 — dont UN SEUL japonais, et c'est la bonne carte (562000,
        // Charmander MCDP). Les 14 autres sont les McDonald's occidentaux.
        // C'est donc la RÉGION qui tranche, pas le code : le filtre ci-dessous n'est pas un
        // raffinement, c'est ce qui rend le repli utilisable.
        let parParente = false, parenteRetenue = null;
        if (!exps.length) {
            const cousins = lignes.filter(l => { const c = normaliserCodeSet(l.codeSet); return memeCodeParConventionX(code, c) || codesApparentes(code, c); });
            if (cousins.length) {
                // ── LA BORNE DE RÉGION, ET SES DEUX ÉTATS ────────────────────────────
                // Un cousin dont la région est CONNUE et DIFFÉRENTE de celle attendue est
                // ÉCARTÉ : deux codes de régions différentes ne sont jamais apparentés.
                // Un cousin de région INCONNUE, lui, RESTE candidat — inconnu n'est pas
                // contradiction (premier principe). Mesuré sur le cas qui compte : « MCD »
                // en région japonaise a 14 cousins ; la borne jette les 9 McDonald's
                // occidentaux, garde MCDP et 4 dont la région est inconnue.
                // ⚠️ L'ancienne version retombait sur TOUS les cousins quand le filtre ne
                // laissait rien — donc y compris ceux d'une autre région. C'était une
                // préférence, pas une borne.
                const region = regionAttendue({ language: langue });
                exps = region ? cousins.filter(l => !l.region || l.region === region) : cousins;
                if (!exps.length) {
                    console.log(`🎯 [setcode-numero] « ${code} » n'a que des cousins d'une autre région que ${region} -> aucune parenté retenue.`);
                    return [];
                }
                parParente = true;
                parenteRetenue = `${code}~${exps.map(l => l.codeSet).join('/')}`;
            }
        }
        if (!exps.length) return [];
        const ids = exps.map(l => l.idExpansion);

        // ⚠️ PAS de `trouverProduitsParNumero` ici, et c'est délibéré : sa préférence
        // stricte pour l'égalité exacte CHOISIT entre « 019 » et « S19 » au lieu de
        // constater qu'elle ne sait pas. Sur une clé censée être exacte, ce départage est
        // un piège — voir numeroAmbiguDansPerimetre. On lit donc les numéros du périmètre,
        // on vérifie l'absence d'ambiguïté de préfixe, et on ne rend que les correspondances.
        const docs = await NumeroCarte.find(
            { idExpansion: { $in: ids.map(Number) } },
            { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 }
        ).lean();
        const numerosDuPerimetre = docs.map(d => d.numero || d.numeroUrl);
        if (numeroAmbiguDansPerimetre(numeroLu, numerosDuPerimetre)) {
            console.log(`🎯 [setcode-numero] ${setCodeLu}+${numeroLu} : plusieurs FORMES du même nombre coexistent dans ce périmètre (préfixe) -> clé ambiguë, on ne tranche pas.`);
            return [];
        }
        const retenus = docs.filter(d => comparerNumeros(numeroLu, d.numero) || comparerNumeros(numeroLu, d.numeroUrl));
        if (!retenus.length) return [];
        if (parParente) console.log(`🎯 [setcode-numero] code « ${setCodeLu} » inconnu, replié sur ${exps.map(l => l.codeSet).join('/')} par parenté${exps.length < 3 ? ' + région' : ''}.`);

        const produits = await CatalogueProduit.find({ idProduct: { $in: retenus.map(d => d.idProduct) } }).lean();
        return ecarterNonCartes(produits, `${setCodeLu}+${numeroLu}`);
    } catch (e) {
        // Rapporte, ne décide pas — voir sources.js et `trouverProduitsLocaux`.
        e.source = 'trouverParSetCodeEtNumero';
        throw e;
    }
}

/**
 * LE VETO PAR LE NOM. Le code cherche, le nom peut REFUSER.
 *
 * POURQUOI. Le chemin ci-dessus est aveugle par construction, et c'est sa force jusqu'au
 * moment où l'IA lit mal le code. Cas réel du journal : « Meowth · n°062 · total 088 »
 * avec un setCode lu « e3 » au lieu de « e4 » — un chiffre sur un tampon e-Reader.
 * e3+062 désigne EC3-062, qui est un DODRIO. Sans veto, ce scan rendrait Dodrio avec
 * assurance, là où le nom le sauve aujourd'hui.
 *
 * DEUX GARDE-FOUS, sans lesquels ce veto ferait plus de mal que de bien :
 *
 *   a) PREUVE POSITIVE DE DISCORDANCE, jamais une simple absence de correspondance.
 *      « Je ne sais pas » et « je sais que non » ne commandent pas la même action — c'est
 *      la règle déjà posée pour bilanDesRangs, et elle vaut ici mot pour mot. Un nomFr
 *      absent, une lecture française, un katakana seul : tout cela ne correspond à rien
 *      sans rien prouver.
 *      LA PREUVE EXIGÉE EST DONC : le nom lu, AU NUMÉRO LU, existe ailleurs au catalogue.
 *      « Il existe une carte appelée X portant le numéro N, et ce n'est pas celle-ci. »
 *      ⚠️ Une première version se contentait de « le nom lu existe quelque part » : trop
 *      faible, et mesuré comme tel. « Kahili » désigne 8 produits RÉELS au catalogue —
 *      la carte existe, c'est la lecture qui est fausse (Dana s'appelle « Méridia » en
 *      français). Ce veto-là aurait refusé un code correct sur la seule foi d'un nom
 *      halluciné. Au numéro lu, en revanche, la distinction est nette et déjà mesurée
 *      sur les cas réels : « Meowth » au n°062 existe (EC4), « Kahili » au n°173 n'existe
 *      pas. C'est exactement le test d'arbitrage du nom déjà en place plus bas.
 *
 *   b) DÉSARMÉ quand nomConfiance n'est pas 'haute'. Sinon un nom halluciné opposerait
 *      son veto à un code correct, et on aurait reconstruit le bug d'origine à l'envers :
 *      c'est exactement le cas Kahili, où le nom lu n'existe sur aucune carte.
 *
 * CE QUE LE VETO REND EN PLUS DU REFUS. Sa condition de preuve DÉSIGNE déjà des produits :
 * ceux qui portent le nom lu au numéro lu. Ce n'est pas un sous-produit du refus, c'est la
 * réponse. « Flareon au n°017 existe (653910) et n'est pas Turtonator » — 653910 est la
 * bonne carte, à 239,94 € contre 0,02 €. `preuves` porte donc cet ensemble, pour que
 * l'appelant le RE-CLASSE au lieu de se contenter d'écarter le gagnant. Refuser un prix
 * faux vaut mieux que le facturer ; rendre le bon vaut mieux que les deux.
 *
 * @returns {Promise<{veto: boolean, raison: string, preuves: object[]}>}
 */
async function nomOpposeUnVeto(cardInfo, produit) {
    try {
        // (b) — l'IA elle-même doute de sa lecture : le nom n'a pas voix au chapitre.
        if (cardInfo.nomConfiance !== 'haute') return { veto: false, preuves: [], incoherent: false, raison: 'confiance du nom non haute -> veto désarmé' };

        const formesLues = [cardInfo.name, cardInfo.nomBrut].filter(Boolean);
        if (!formesLues.length) return { veto: false, preuves: [], incoherent: false, raison: 'aucun nom lu' };

        const info = (await lireNumeros([produit.idProduct])).get(produit.idProduct);
        const formesCandidat = [String(produit.name || '').split('[')[0].trim(), info?.nomFr].filter(Boolean);
        if (!formesCandidat.length) return { veto: false, preuves: [], incoherent: false, raison: 'candidat sans nom exploitable' };

        if (nomConcorde(formesLues, formesCandidat)) return { veto: false, preuves: [], incoherent: false, raison: 'concordance' };

        // (a) — LA PREUVE. On réutilise volontairement trouverProduitsLocaux : c'est la MÊME
        // résolution de nom que partout ailleurs (variantes, normalisation), donc le veto ne
        // peut pas être plus sévère que la recherche par nom elle-même. Deux allers-retours
        // Mongo, et seulement dans le cas de désaccord — mesuré à 1 scan sur 23 où le chemin
        // par le code tranche.
        const { liste: ailleurs } = await interrogerSource('catalogue/nom', () => trouverProduitsLocaux(cardInfo.name));
        if (!ailleurs.length) return { veto: false, preuves: [], incoherent: false, raison: `"${cardInfo.name}" inconnu du catalogue -> aucune preuve, on laisse passer` };

        // ... AU NUMÉRO LU. Sans cette seconde condition, un nom halluciné mais réel
        // (« Kahili ») suffirait à refuser un code correct.
        if (cardInfo.number == null || String(cardInfo.number).trim() === '') {
            return { veto: false, preuves: [], incoherent: false, raison: 'aucun numéro lu -> la preuve ne peut pas être établie' };
        }
        const numeros = await lireNumeros(ailleurs.map(p => p.idProduct));
        const auNumeroLu = ailleurs.filter(p => {
            const d = numeros.get(p.idProduct);
            return d && (comparerNumeros(cardInfo.number, d.numero) || comparerNumeros(cardInfo.number, d.numeroUrl));
        });
        if (!auNumeroLu.length) {
            // ─── LE TROISIÈME ÉTAT ───────────────────────────────────────────────────
            // « Le nom lu et le numéro lu ne se rejoignent sur aucun produit » N'EST PAS
            // une absence d'information : c'est une PREUVE POSITIVE D'INCOHÉRENCE. On sait
            // qu'une des deux lectures est fausse, on ignore seulement laquelle. Ça ne
            // justifie pas de refuser un candidat — on ne sait pas lequel accuser — mais ça
            // justifie de SUPPRIMER LE VERDICT. Même principe que bilanDesRangs : trois
            // états, pas deux.
            // Cas mesuré : « Light Jolteon » lu au n°135 alors que le seul Light Jolteon du
            // catalogue est NDE-48. Le scan est sorti avec incertain=NON et le prix d'une
            // « Lightning Energy ».
            //
            // ⚠️ MAIS SEULEMENT SI DES NUMÉROS EXISTENT POUR CE NOM. Sans cette condition on
            // retomberait dans l'erreur qu'on vient de corriger : 41 expansions — 2 101
            // produits, 3,0 % du catalogue, dont tout le Rocket Gang japonais — n'ont AUCUN
            // numéro publié par Cardmarket. Pour elles, ne rien trouver au numéro lu ne
            // prouve rien du tout, et les signaler toutes viderait l'avertissement de son
            // sens. Absence de donnée n'est pas preuve de contradiction.
            const avecNumero = ailleurs.filter(p => {
                const d = numeros.get(p.idProduct);
                return d && (d.numero || d.numeroUrl);
            });
            if (!avecNumero.length) {
                return { veto: false, preuves: [], incoherent: false, raison: `aucun "${cardInfo.name}" n'a de numéro publié -> la preuve est impossible, on laisse passer` };
            }
            return {
                veto: false, preuves: [], incoherent: true,
                raison: `"${cardInfo.name}" est connu à ${avecNumero.length} numéro(s), mais JAMAIS au n°${cardInfo.number} : une des deux lectures est fausse`
            };
        }

        return {
            veto: true,
            // L'ensemble de preuve EST le nouveau vivier. Voir le re-classement dans
            // /api/identifier : ces produits portent le nom lu ET le numéro lu, ce qui en
            // fait de bien meilleurs candidats que celui qu'on vient d'écarter.
            preuves: auNumeroLu,
            raison: `"${cardInfo.name}" au n°${cardInfo.number} existe au catalogue (${auNumeroLu.slice(0, 3).map(p => p.idProduct).join(', ')}) et n'est pas "${formesCandidat[0]}"`
        };
    } catch (e) {
        // Un veto qui casse ne doit pas casser le scan : en cas de doute, on laisse passer.
        console.error(`❌ Erreur nomOpposeUnVeto :`, e.message);
        return { veto: false, preuves: [], incoherent: false, raison: 'erreur -> veto désarmé' };
    }
}

/**
 * L'identifiant TCGdex de cette expansion est-il PARTAGÉ avec d'autres expansions ?
 *
 * POURQUOI CETTE QUESTION DÉCIDE D'UN VERDICT. Mesuré : 69 identifiants TCGdex sont
 * portés par plusieurs expansions Cardmarket, et le motif est systématique — chaque set
 * japonais partage le sien avec son jumeau occidental (neo4 -> N4 + NDE, base5 -> ROG + TR,
 * ecard3 -> EC4 + EC5 + SK). Nos liens ont été appris depuis le catalogue ANGLAIS, qui ne
 * distingue pas les deux éditions. Un identifiant partagé ne peut donc PAS désigner une
 * expansion : il en désigne deux, dont une seule est la bonne.
 *
 * Ce n'est pas une imperfection à tolérer, c'est la cause du dernier verdict faux et
 * affirmé du banc : un Rhydon japonais rendu comme un produit d'un set de 2025.
 *
 * @returns {Promise<{setTcgdex: string|null, partage: boolean, autres: number[], regionSource: string|null}>}
 */
// Tous les codes de set RÉELS du catalogue, normalisés. Mémorisé pour la durée du process :
// 747 codes qui bougent quelques fois par mois, relus à chaque scan sinon.
// Sert à distinguer une CONTRADICTION (un vrai set) d'un BRUIT (un code qui ne résout vers
// rien) — voir le quatrième principe dans scoring.js.
let _codesSetReels = null;
async function lireTousLesCodesSet() {
    if (_codesSetReels) return _codesSetReels;
    try {
        if (mongoose.connection.readyState !== 1) return [];
        const docs = await CodeSet.find({}, { codeSet: 1 }).lean();
        _codesSetReels = docs.map(d => normaliserCodeSet(d.codeSet)).filter(Boolean);
        return _codesSetReels;
    } catch (e) {
        // Principe des sources perdues : sans la liste, on ne peut pas prouver qu'un code
        // est du bruit. On rend une liste vide, et `setCodeCompatibleVintage` retombe alors
        // sur son comportement d'avant — prudent, jamais inventif.
        console.error('❌ Erreur lireTousLesCodesSet :', e.message);
        return [];
    }
}

async function diagnosticLienTcgdex(idExpansion) {
    const vide = { setTcgdex: null, partage: false, autres: [], regionSource: null };
    try {
        if (mongoose.connection.readyState !== 1 || idExpansion == null) return vide;
        const exp = Number(idExpansion);
        const ids = (await NumeroCarte.distinct('setTcgdex', { idExpansion: exp })).filter(Boolean);
        const cs = await CodeSet.findOne({ idExpansion: exp }, { regionSource: 1 }).lean();
        if (!ids.length) return { ...vide, regionSource: cs?.regionSource ?? null };
        // Un seul identifiant attendu par expansion ; s'il y en a plusieurs, le premier
        // suffit pour poser la question du partage.
        const setTcgdex = ids[0];
        const autres = (await NumeroCarte.distinct('idExpansion', { setTcgdex }))
            .map(Number).filter(e => Number.isFinite(e) && e !== exp);
        return { setTcgdex, partage: autres.length > 0, autres, regionSource: cs?.regionSource ?? null };
    } catch (e) {
        // Principe des sources perdues : en cas d'erreur on ne conclut PAS « lien propre ».
        console.error(`❌ Erreur diagnosticLienTcgdex :`, e.message);
        return vide;
    }
}

/**
 * Même recherche, mais SANS PÉRIMÈTRE : tout le catalogue.
 *
 * ⚠️ POURQUOI ELLE EXISTE. La version restreinte ci-dessus a besoin d'expansions
 * attendues, qui viennent du pont total -> set, donc de TCGdex. Quand TCGdex ne connaît
 * pas le set (les sets japonais anciens, le McDonald's japonais 2002), le pont désigne un
 * set de même taille et la recherche se fait au mauvais endroit — le Salamèche McDonald's
 * a affiché 0,05 € pour cette raison : n°004 cherché dans « Detective Pikachu ».
 * Sans périmètre, on ne peut pas se tromper de périmètre. Le coût est mesuré : au plus
 * ~850 produits (828 pour le n°004, 855 pour le n°1, 67 pour le n°203), pour deux
 * allers-retours Mongo groupés au scoring quelle que soit la taille du vivier.
 */
async function trouverProduitsParNumeroPartout(numeroLu) {
    try {
        if (mongoose.connection.readyState !== 1 || numeroLu == null) return [];
        // On ne peut pas filtrer côté Mongo : la comparaison de numéros est normalisée
        // (zéros de tête, préfixes) et doit rester STRICTEMENT celle du scoring. On lit
        // donc les numéros connus et on départage en mémoire, comme ci-dessus.
        const docs = await NumeroCarte.find(
            { $or: [{ numero: { $type: 'string', $ne: '' } }, { numeroUrl: { $type: 'string', $ne: '' } }] },
            { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 }
        ).lean();
        return departagerParNumero(docs, numeroLu, 'tout le catalogue');
    } catch (e) {
        // Rapporte, ne décide pas — voir sources.js et `trouverProduitsLocaux`.
        e.source = 'trouverProduitsParNumeroPartout';
        throw e;
    }
}

// Cœur commun aux deux recherches par numéro : préférence STRICTE pour l'égalité exacte,
// repli sur les chiffres seulement si aucune exacte n'existe, puis retour des documents
// CATALOGUE (même forme que trouverProduitsLocaux, donc interchangeables).
async function departagerParNumero(docs, numeroLu, ouCherche) {
    try {
        const notes = [];
        for (const d of docs) {
            const corr = comparerNumeros(numeroLu, d.numero) || comparerNumeros(numeroLu, d.numeroUrl);
            if (corr) notes.push({ idProduct: d.idProduct, idExpansion: d.idExpansion, correspondance: corr });
        }
        if (!notes.length) return [];

        const exactes = notes.filter(n => n.correspondance === 'exact');
        const retenus = exactes.length ? exactes : notes;
        const ids = retenus.map(n => n.idProduct);

        // On renvoie les documents CATALOGUE, pour rester interchangeable avec
        // trouverProduitsLocaux (même forme : { idProduct, name, idExpansion, ... }).
        const produits = await CatalogueProduit.find({ idProduct: { $in: ids } }).lean();
        console.log(`🔢 Recherche par NUMÉRO : n°${numeroLu} dans ${ouCherche} -> ${produits.length} produit(s) (correspondance ${exactes.length ? 'exacte' : 'sur les chiffres'}).`);
        // C'est ici que les Code Cards faisaient le plus de dégâts : 460 d'entre elles
        // portaient un numeroUrl "2", donc ce repli les ramenait pour toute carte n°2.
        return ecarterNonCartes(produits, `numéro ${numeroLu} / ${ouCherche}`);
    } catch (e) {
        // Rapporte, ne décide pas. Appelée UNIQUEMENT depuis les deux `trouverProduits
        // ParNumero*` : son exception remonte à travers eux jusqu'à leur point d'appel,
        // qui est enveloppé. Pas de point d'appel propre à envelopper ici.
        e.source = e.source || 'departagerParNumero';
        throw e;
    }
}

// Prix depuis le guide local (instantané) pour un idProduct précis.
// `estReverse` = l'impression VISÉE est-elle une reverse ? Si oui, le prix vit dans les
// champs *Holo — que la reverse partage l'idProduct de la normale (Pikachu LOR 052 :
// 0,27 € vs 10,13 €) ou qu'elle ait un produit dédié (Master Ball 806449 : 0,50 € vs
// 24,13 €). Voir prixDeReference, testé dans scoring.js.
async function getPrixGuideLocal(idProduct, estReverse = false) {
    try {
        if (mongoose.connection.readyState !== 1) return null;
        const g = await GuidePrix.findOne({ idProduct }).lean();
        if (!g) return null;
        return prixDeReference(g, estReverse);
    } catch (e) {
        console.error(`❌ Erreur getPrixGuideLocal pour ${idProduct} :`, e.message);
        return null;
    }
}

// Version groupée de getPrixGuideLocal : un seul aller-retour Mongo pour N idProduct
// (même repli de champs, même contrat de retour null si prix inconnu). Number() des
// deux côtés pour la même raison que lireCodeSets ci-dessus.
async function getPrixGuideLocalLot(idsProducts, estReverse = false) {
    try {
        if (mongoose.connection.readyState !== 1) return new Map();
        const uniques = [...new Set(idsProducts.filter(id => id != null).map(Number))];
        if (uniques.length === 0) return new Map();
        const docs = await GuidePrix.find({ idProduct: { $in: uniques } }).lean();
        const map = new Map();
        // Même sélection de prix que getPrixGuideLocal (via prixDeReference) : les deux
        // chemins doivent voir le MÊME prix, sinon le scoring départage sur une valeur
        // que la route n'affichera jamais.
        for (const g of docs) map.set(Number(g.idProduct), prixDeReference(g, estReverse));
        return map;
    } catch (e) {
        console.error("Erreur lecture prix guide (lot):", e.message);
        return new Map();
    }
}

// Libellés des stratégies reverse renvoyées par scoring.js. Uniquement pour les logs :
// la valeur transmise à l'extension reste le code court ('produit-distinct'|'filtre-url').
const LIBELLES_STRATEGIE_REVERSE = {
    'produit-distinct': "le motif est un PRODUIT distinct -> lecture normale de sa fiche",
    'filtre-url': "produit PARTAGÉ avec la version normale -> filtre isReverseHolo=Y (live) / trendHolo (guide)",
    inconnue: "indéterminée"
};

// Trace unique du REPLI de motif, pensée pour être grepée en production :
//   grep "[motif-non-resolu]" server.log
// Champs stables et dans un ordre fixe, valeurs sans espace, une seule ligne.
// ⚠️ Ce log ne se déclenche QUE quand la carte A un motif de reverse ET qu'on n'a pas
// su le cibler. JAMAIS sur "pas d'idProduct par variante" : les cartes des vieux sets
// n'ont pas de motif à départager, le chemin catalogue les résout parfaitement, et les
// marquer incertaines viderait le drapeau de son sens (~86 % des cartes).
function loggerReplieMotif(resolution, cardInfo, analyse, tcgdexId, titre) {
    const motifTitre = motifDuTitre(titre) || 'aucun';
    console.warn(
        `⚠️ [motif-non-resolu] carte=${tcgdexId || '?'} nom=${String(cardInfo.name || '?').replace(/\s+/g, '_')}` +
        ` motifIA=${cardInfo.motif || '?'} motifTitre=${motifTitre}` +
        ` motifsCarte=${analyse.motifsDisponibles.join('|') || 'aucun'}` +
        ` variantes=${analyse.entrees.length} raison=${resolution.raison}` +
        ` -> repli catalogue + carteIncertaine`
    );
}

// ============================================================
// Enrichit les candidats (numéro appris + prix local + région) puis les score.
// NIVEAU 1 : 100% local, aucune requête Cardmarket, aucun risque de ban.
// ============================================================
async function scorerCandidatsLocal(produits, cardInfo, imageUrlVinted, idExpansionsAttendues = [], codeSetsPreChauffes = null, options = {}) {
    const regionCible = regionAttendue(cardInfo);
    console.log(`🌍 Région attendue : ${regionCible || 'indéterminée'} (langue=${cardInfo.language}, total=${cardInfo.total || 'absent'})`);

    // Numéros appris (via apprendre-set.js) : c'est ce qui permet au critère
    // "numéro" du scoring de fonctionner, et donc de viser LE bon candidat.
    const numerosConnus = await lireNumeros(produits.map(p => p.idProduct));
    if (numerosConnus.size > 0) {
        console.log(`🔢 Numéros connus pour ${numerosConnus.size}/${produits.length} candidats.`);
    } else {
        const expansions = [...new Set(produits.map(p => p.idExpansion))];
        console.log(`💡 Aucun numéro connu pour ces candidats. Pour rendre l'identification précise, lance : node apprendre-set.js ${expansions.join(' ')}`);
    }

    // Codes set + prix guide de TOUS les candidats en DEUX allers-retours Mongo groupés
    // au lieu de deux PAR CANDIDAT (jusqu'à ~79 candidats -> ~158 requêtes séquentielles
    // avant ce fix). codeSetsPreChauffes permet à l'appelant (/api/identifier) d'injecter
    // une Map déjà récupérée, pour ne pas la redemander une seconde fois à Mongo.
    const codeSets = codeSetsPreChauffes || await lireCodeSets(produits.map(p => p.idExpansion));
    // Régions dérivées : un « occidental » ne peut venir que d'ici (voir lireRegions).
    const regions = await lireRegions(produits.map(p => p.idExpansion));

    // Table des motifs de la carte (TCGdex), puis arbitrage IA / titre / catalogue.
    // Tout est PUR et testé dans scoring.js ; ici on ne fait que fournir les entrées.
    // Résolu AVANT les prix : c'est la nature de l'impression visée (reverse ou non)
    // qui décide quel champ du guide fait foi.
    const analyse = analyserVariantes(options.variantsDetailed);
    const resolution = resoudreMotif(analyse, cardInfo.motif, options.titre);
    const estReverse = impressionEstReverse(resolution.cible, cardInfo.reverse);

    // Les prix des candidats sont lus sur le MÊME axe que le prix qui sera affiché.
    // Indispensable au départage « moins cher » de la décision produit B : sur Espeon
    // PRE 033, comparer les `trend` désignerait la Master Ball (0,50 €) comme la moins
    // chère alors que c'est de loin la plus chère en reverse (24,13 €).
    const prixGuide = await getPrixGuideLocalLot(produits.map(p => p.idProduct), estReverse);

    const candidatsEnrichis = produits.map(p => {
        const infoNum = numerosConnus.get(p.idProduct);
        const codeSet = codeSets.get(Number(p.idExpansion)) ?? null;
        return {
            idProduct: p.idProduct,
            idExpansion: p.idExpansion,
            numeroCardmarket: infoNum ? (infoNum.numero || infoNum.numeroUrl) : null,
            certitudeNumero: infoNum ? (infoNum.certitude || 'exacte') : null,
            // V1/V2/V3 = normale/reverse/illustration, présente seulement sur les
            // sets appris AVEC les nouveaux champs (--maj). Absente = null -> neutre.
            variante: infoNum ? (infoNum.variante || null) : null,
            prix: prixGuide.get(Number(p.idProduct)) ?? null,
            // code de set appris (ex: "PAL", "EXP", "PGO") : sert à confronter ce que
            // l'IA a lu (setCode/stamp) au set réel du candidat.
            codeSet: codeSet || (infoNum && infoNum.codeSet) || null,
            // distanceImage volontairement absente : le hash perceptif a été retiré
            // (bruit sur photos d'annonce). Le critère image du scoring reste dans
            // scoring.js et se réactivera tout seul si on lui refournit un jour une
            // distance (via OffscreenCanvas côté extension, par exemple).
            // La région dérivée en base fait foi ; à défaut, seules les preuves tirées du
            // code lui-même (minuscule, suffixe -JP, liste vérifiée) sont retenues. Un
            // code non vérifié donne null, et le critère région reste alors NEUTRE.
            region: regionDuCodeSet(codeSet || (infoNum && infoNum.codeSet), regions.get(Number(p.idExpansion)) ?? null)
        };
    });

    if (idExpansionsAttendues.length) {
        console.log(`🎯 Set attendu -> expansion(s) Cardmarket : ${idExpansionsAttendues.join(', ')}`);
    }

    const lu = {
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ LA SEULE LIGNE DE CETTE FONCTION QUI DÉCIDE DE L'IDENTIFICATION
        // ════════════════════════════════════════════════════════════════════
        // Les deux autres lectures du numéro dans cette fonction — le contrôle
        // `region-conflit` et `bilanDesRangs` — sont des DIAGNOSTICS : un console.warn et
        // des signaux journalisés. Elles ont reçu le numéro EFFECTIF (neutralisé quand
        // c'est un numéro de Pokédex). Celle-ci note les candidats, donc elle choisit la
        // carte, donc elle change le prix affiché.
        //
        // LOT B, RETENU DÉLIBÉRÉMENT. Lui donner le numéro effectif est probablement juste
        // — un numéro de Pokédex n'est pas un numéro de collection, et un candidat qui
        // « correspond » à 172 y correspond par coïncidence. Mais ça toucherait 56 des 131
        // lignes du journal (43 %), et l'effet n'est PAS mesuré : le banc ne peut pas y
        // répondre puisqu'il neutralise déjà. Un contrat d'affichage additif n'a aucune
        // raison de voyager avec un changement d'identification non mesuré.
        // La mesure qui décidera : sur ces 56 lignes, combien changent de gagnant, et
        // parmi celles-là combien vont vers la BONNE carte.
        //
        // ⚠️ L'ABSENCE DE L'OPTION DONNE LE COMPORTEMENT CORRIGÉ, pas l'ancien. C'est
        // délibéré : le jour où le lot B part, il suffit de supprimer cette option et ses
        // deux passages dans /api/identifier — aucun appelant ne peut hériter de l'ancien
        // comportement par oubli. Les autres appelants (banc, mesures, tests) ne la
        // passent pas et sont donc déjà sur le comportement cible.
        numero: (options.numeroBrutPourScoring !== undefined ? options.numeroBrutPourScoring : cardInfo.number) || null,
        setCode: cardInfo.setCode || null, // le code/stamp lu par l'IA (ex: PAL, CEL)
        idExpansionsAttendues,             // déduites du set TCGdex via le pré-remplissage
        rarete: cardInfo.rarete || null,   // brut : neutralise le critère prix sur les promos
        rareteElevee: cardInfo.rareteElevee,
        regionAttendue: regionCible,
        // Le routage du motif de reverse. La règle "reverse -> V2" a DISPARU : le
        // numéro de variante Cardmarket n'a pas de sémantique stable, et dans Obsidian
        // Flames il désignait un holo à 37 €. C'est le catalogue TCGdex qui fait foi.
        motif: { ...resolution, strategieParIdProduct: analyse.strategieParIdProduct }
    };

    const resultat = choisirMeilleur(candidatsEnrichis, lu);

    // INSTRUMENTATION du correctif « promo » (neutralisation du critère prix).
    // Mesuré hors ligne sur 15 promos réelles : 0 gagnant changé, mais le critère
    // n'était réellement en jeu que sur 7 d'entre elles et la marge médiane était de
    // 50 points — l'échantillon ne dit donc rien des cas SERRÉS. Sur le seul cas serré
    // connu (Magikarp 024), la marge n'est que de 10 points et repose entièrement sur
    // POIDS.setPartiel, dont le seuil de bascule est 6. Ce log mesure en production la
    // fréquence réelle des bascules, pour savoir si ces 9 points de réserve sont
    // confortables ou si on vit sur de la chance.
    // Coût : un second scoring en mémoire, uniquement sur les promos. Aucune I/O.
    if (String(cardInfo.rarete || '').toLowerCase() === 'promo') {
        const sansNeutralisation = choisirMeilleur(candidatsEnrichis, { ...lu, rarete: null });
        const avant = sansNeutralisation.scores[0], apres = resultat.scores[0];
        if (avant && apres && avant.candidat.idProduct !== apres.candidat.idProduct) {
            console.log(
                `📊 [promo-neutralise] carte=${options.tcgdexId || '?'}` +
                ` gagnantAvant=${avant.candidat.idProduct} scoreAvant=${avant.score}` +
                ` gagnantApres=${apres.candidat.idProduct} scoreApres=${apres.score}`
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // TROIS TRACES, pour instruire les décisions qui restent à prendre.
    // Format stable, une ligne, valeurs sans espace : grep "[region-conflit]" etc.
    // Elles ne changent AUCUN comportement — elles mesurent celui qui existe.
    // ════════════════════════════════════════════════════════════════════════
    const gagnantEnrichi = resultat.scores[0]?.candidat ?? null;

    // 1. CONFLIT DE RÉGION — un candidat portant le BON numéro, écarté par le malus de
    //    région. C'est la signature exacte du bug Charmander McDonald's. La liste des
    //    exceptions vient d'être posée : ce log dit si elle est complète, et un
    //    conflit qui persiste désigne un code japonais qu'on n'a pas encore recensé.
    if (regionCible && cardInfo.number != null) {
        const ecartes = candidatsEnrichis.filter(c =>
            c.region && c.region !== regionCible && comparerNumeros(cardInfo.number, c.numeroCardmarket));
        if (ecartes.length) {
            console.warn(
                `⚠️ [region-conflit] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
                ` regionAttendue=${regionCible} ecartes=${ecartes.length}` +
                ` codes=${[...new Set(ecartes.map(c => c.codeSet || '?'))].slice(0, 6).join('|')}` +
                ` idProducts=${ecartes.slice(0, 6).map(c => c.idProduct).join('|')}` +
                ` gagnant=${gagnantEnrichi?.idProduct ?? '?'} gagnantRegion=${gagnantEnrichi?.region ?? '?'}`
            );
        }
    }

    // 2. LES DEUX SIGNAUX DE RANG. Mesuré : le rang 3 pris candidat par candidat n'est
    //    PAS un signal (majoritaire partout — 135/153 sur Charmander, 78/85 sur
    //    Magikarp), parce que le même nom existe dans beaucoup d'autres sets. Seuls
    //    `aucunRang1` et le rang du GAGNANT sont exploitables. Voir bilanDesRangs.
    const rangs = bilanDesRangs(candidatsEnrichis, cardInfo.number, gagnantEnrichi);
    if (cardInfo.number != null) {
        console.log(
            `📊 [rang] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
            ` gagnant=${gagnantEnrichi?.idProduct ?? '?'} rangGagnant=${rangs.rangGagnant ?? 'sans-objet'}` +
            ` candidats=${candidatsEnrichis.length} rang1=${rangs.rang1} rang2=${rangs.rang2} rang3=${rangs.rang3}` +
            ` aucunRang1=${rangs.aucunRang1}`
        );
    }
    if (rangs.aucunRang1) {
        console.warn(
            `⚠️ [aucun-rang1] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
            ` candidats=${candidatsEnrichis.length} -> AUCUN ne porte ce numéro,` +
            ` le vivier ne peut pas contenir la bonne carte`
        );
    }

    // 3. ACCORD DU setCode LU. Aucune collection ne conservait les réponses de l'IA :
    //    sa fiabilité était donc invérifiable. Comparaison STRICTE (égalité après
    //    normalisation) — c'est la fiabilité BRUTE de la lecture qu'on veut, pas celle
    //    du mécanisme de parenté partielle du scoring, qui la masquerait.
    if (cardInfo.setCode) {
        const luN = normaliserCodeSet(cardInfo.setCode);
        const gagnantN = gagnantEnrichi?.codeSet ? normaliserCodeSet(gagnantEnrichi.codeSet) : null;
        console.log(
            `📊 [setcode] carte=${options.tcgdexId || '?'} lu=${cardInfo.setCode} normalise=${luN || 'vide'}` +
            ` gagnant=${gagnantEnrichi?.codeSet ?? 'inconnu'}` +
            ` accord=${gagnantN ? (luN === gagnantN) : 'indeterminable'}` +
            ` apparente=${gagnantN ? codesApparentes(luN, gagnantN) : 'indeterminable'}` +
            ` langue=${cardInfo.language}`
        );
    }

    // Trois états, volontairement DISTINCTS (le 2e n'est pas un échec) :
    if (resolution.etat === 'non-resolu') {
        loggerReplieMotif(resolution, cardInfo, analyse, options.tcgdexId, options.titre);
    } else if (resolution.etat === 'resolu' && resolution.cible !== 'aucun') {
        console.log(`🔁 Motif "${resolution.cible}" -> produit(s) ${resolution.vises.join(', ')} · ${LIBELLES_STRATEGIE_REVERSE[resultat.strategieReverse] || LIBELLES_STRATEGIE_REVERSE.inconnue}${resolution.raison ? ` (${resolution.raison})` : ''}`);
    }
    // 'aucun-motif' : silence volontaire. C'est le cas de l'immense majorité des cartes
    // (tous les sets d'avant Prismatic Evolutions), il n'y a rien à signaler.

    // codeSets renvoyé pour réutilisation par l'appelant (évite une 2e lecture
    // identique, ex: la construction de `codesSet` dans /api/identifier).
    // `rangs` remonte les deux signaux : l'appelant décide (voir la règle documentée
    // sur `viviersAvecRangs`), les expose à l'extension et les journalise.
    return { ...resultat, codeSets, motif: resolution, estReverse, rangs };
}

function calculerVerdict(prixVinted, prixCardmarket, language, carteIncertaine) {
    if (!prixVinted || isNaN(prixVinted)) return null;
    const ratio = prixVinted / prixCardmarket;
    const diffPourcent = Math.round((ratio - 1) * 100);

    // Nos sources gratuites (TCGdex/scraping direct) ne filtrent pas toujours
    // fiablement par langue, et parfois plusieurs impressions sont ambiguës.
    // Dans ces deux cas, on ne peut pas garantir que le prix de référence
    // correspond à la bonne carte/langue -> seuils plus prudents + avertissement
    // explicite plutôt qu'un faux verdict de confiance. L'incertitude sur la
    // carte elle-même (mauvais set possible) est encore plus grave que la langue.
    const langueIncertaine = Boolean(language) && language !== 'EN';
    const incertitude = carteIncertaine || langueIncertaine;
    const seuilBonneAffaire = carteIncertaine ? 0.50 : (langueIncertaine ? 0.60 : SEUIL_BONNE_AFFAIRE);
    const seuilPrixCorrect = carteIncertaine ? 1.50 : (langueIncertaine ? 1.30 : SEUIL_PRIX_CORRECT);

    let label;
    if (ratio <= seuilBonneAffaire) label = "🔥 Bonne affaire";
    else if (ratio <= seuilPrixCorrect) label = "✅ Prix correct";
    else label = "⚠️ Plus cher que le marché";

    return { label, diffPourcent, langueIncertaine: incertitude };
}

// ============================================================
// ROUTE PRINCIPALE
// ============================================================

// Ordre officiel Cardmarket, du meilleur au pire
const ORDRE_ETATS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

// Prix le moins cher pour un état donné OU MIEUX (= ce que ferait minCondition).
// Ex: grille {NM:22.82, EX:18, LP:3} + état EX -> min(22.82, 18) = 18 €
function prixPourEtat(grille, etat) {
    if (!grille || !etat) return null;
    const seuil = ORDRE_ETATS.indexOf(String(etat).toUpperCase());
    if (seuil === -1) return null;
    const prix = ORDRE_ETATS.slice(0, seuil + 1)
        .map(e => grille[e])
        .filter(p => typeof p === 'number');
    return prix.length ? Math.min(...prix) : null;
}

// Renvoie le PIRE des deux états (le plus dégradé). Sert à croiser l'avis de
// l'IA et celui du vendeur : en cas de désaccord, on prend le moins favorable,
// car surestimer l'état conduit à surpayer.
function pireEtat(a, b) {
    const ia = ORDRE_ETATS.indexOf(String(a || '').toUpperCase());
    const ib = ORDRE_ETATS.indexOf(String(b || '').toUpperCase());
    if (ia === -1) return ib === -1 ? null : ORDRE_ETATS[ib];
    if (ib === -1) return ORDRE_ETATS[ia];
    return ORDRE_ETATS[Math.max(ia, ib)]; // index le plus grand = état le plus dégradé
}

// Retrouve les idExpansion Cardmarket correspondant à un set TCGdex.
// C'est le "pont" qui manquait : le pré-remplissage TCGdex a stocké, pour chaque
// carte, le set d'où venait son numéro (champ setTcgdex). En interrogeant cette
// trace, on sait dans quelle(s) expansion(s) Cardmarket chercher — ce qui active
// le critère "set" du scoring (40 points).
//
// ⚠️ Un set TCGdex couvre souvent PLUSIEURS éditions Cardmarket (japonaise,
// internationale, suppléments) : les cartes y portent les mêmes noms. Sans filtre,
// on pourrait donc récompenser l'édition japonaise alors que la carte est
// française. On ne retient que les expansions de la RÉGION attendue.
async function expansionsDuSetTCGdex(tcgdexCardId, regionAttendue = null, setCodeLu = null) {
    try {
        if (mongoose.connection.readyState !== 1 || !tcgdexCardId) return [];
        const setId = String(tcgdexCardId).split('-')[0];
        if (!setId) return [];

        const exps = (await NumeroCarte.distinct('idExpansion', { setTcgdex: setId })).filter(e => e != null);
        if (exps.length === 0) return exps;

        // ════════════════════════════════════════════════════════════════════
        // INVALIDATION PAR LE setCode LU
        // ════════════════════════════════════════════════════════════════════
        // Le set attendu vient du pont total -> set, donc de TCGdex, qui ne connaît pas
        // tous les sets japonais : sur le Salamèche McDonald's, le total 18 a résolu vers
        // « Detective Pikachu ». Or l'information qui invalidait cette piste était déjà
        // là — l'IA avait lu le stamp « MCD », sans aucun rapport avec Detective Pikachu.
        //
        // Règle : si un setCode a été lu ET qu'AUCUNE expansion candidate ne porte un code
        // égal ou apparenté, la piste est invalidée. Elle ne doit alors ni scorer (+40)
        // ni servir de PÉRIMÈTRE de recherche — c'est le second usage qui a fait le plus
        // de dégâts, puisqu'il transforme une fausse piste en filtre.
        //
        // ⚠️ Le risque est BORNÉ, et dans le bon sens. Si l'IA lit mal le setCode alors que
        // l'expansion était juste, on n'invalide pas une bonne réponse : on élargit la
        // recherche (le vivier par numéro couvre tout le catalogue) au lieu de la
        // restreindre à tort. Une invalidation ne peut donc que retirer un périmètre,
        // jamais écarter la bonne carte. Et le silence est la règle : sans setCode lu, ou
        // avec un setCode compatible, rien ne change.
        if (setCodeLu) {
            const luN = normaliserCodeSet(setCodeLu);
            const codes = await lireCodeSets(exps);
            const compatible = exps.some(e => {
                const c = codes.get(Number(e));
                if (!c) return true;   // code inconnu -> on ne peut rien contredire
                const cN = normaliserCodeSet(c);
                return cN === luN || codesApparentes(luN, cN);
            });
            if (!compatible) {
                console.warn(
                    `⚠️ [set-attendu-invalide] setCode lu "${setCodeLu}" incompatible avec` +
                    ` le(s) code(s) de l'expansion attendue (${exps.map(e => codes.get(Number(e)) || '?').join('|')})` +
                    ` déduite de ${setId} -> piste ABANDONNÉE (ni score, ni périmètre)`
                );
                return [];
            }
        }

        if (!regionAttendue) return exps;

        // Filtrage par région, via le code set appris (MAJ = occidental, min = japonais).
        // Un seul aller-retour Mongo pour toutes les expansions, au lieu d'un par expansion.
        const codes = await lireCodeSets(exps);
        const regionsDerivees = await lireRegions(exps);
        const gardees = [];
        for (const e of exps) {
            const code = codes.get(Number(e)) ?? null;
            const region = regionDuCodeSet(code, regionsDerivees.get(Number(e)) ?? null);
            // Région inconnue -> on garde (on ne pénalise pas ce qu'on ignore)
            if (!region || region === regionAttendue) gardees.push(e);
            else console.log(`   ℹ️ Expansion ${e} (${code}, ${region}) écartée du set attendu : on cherche de l'${regionAttendue}.`);
        }
        return gardees;
    } catch (e) {
        // Rapporte, ne décide pas — voir sources.js et `trouverProduitsLocaux`. Celle-ci
        // interroge TCGdex : son vide alimentait le PÉRIMÈTRE d'expansions attendues, donc
        // une panne y élargissait silencieusement la recherche au lieu de la restreindre.
        e.source = 'expansionsDuSetTCGdex';
        throw e;
    }
}

// Correspondance état Vinted -> état Cardmarket (minimum demandé).
// ⚠️ L'échelle Vinted est pensée pour les vêtements et l'état est DÉCLARÉ par le
// vendeur : c'est un indice, pas un grading. On reste donc volontairement prudent
// (ex: "Neuf sans étiquette" -> NM et pas MT, car les vendeurs surestiment).
function etatVintedVersCardmarket(etatVinted) {
    if (!etatVinted) return null;
    const e = etatVinted.toLowerCase();
    if (e.includes('neuf')) return 'NM';
    if (e.includes('très bon')) return 'EX';
    if (e.includes('bon état')) return 'GD';
    if (e.includes('satisfaisant')) return 'LP';
    return null;
}

app.post('/api/analyser', verifierJeton, exigerImage, verifierAcces, async (req, res) => {
    // Portée élargie jusqu'au catch : une ligne d'échec 'erreur-serveur' qui ne dit pas
    // CE QUE L'IA AVAIT LU ne sert à rien pour diagnostiquer. Déclarée ici plutôt que
    // dans le try, où elle serait hors de portée du bloc qui en a le plus besoin.
    let cardInfo = null;
    let annonce = { imageUrl: null, vintedUrl: null };
    try {
        const { imageUrl, imageUrls, title, vintedPrice, vintedEtat, debug } = req.body;
        annonce = {
            imageUrl: (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls[0] : imageUrl,
            vintedUrl: req.body.vintedUrl || req.body.url || null
        };

        if (!imageUrl) {
            console.error("⚠️ Requête reçue sans imageUrl. Body reçu:", req.body);
            return res.json({ success: false, error: "Aucune image reçue" });
        }

        const etatMin = etatVintedVersCardmarket(vintedEtat);
        if (vintedEtat) console.log(`🏷️ État Vinted : "${vintedEtat}" -> Cardmarket ${etatMin || '(non mappé)'}${etatMin ? ' minimum' : ''}`);

        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        console.log(`📷 ${photos.length} photo(s) envoyée(s) à l'IA.`);
        cardInfo = await getCardIdFromAI(photos, title);
        if (!cardInfo) {
            // Échec DUR : aucune carte identifiée, rien n'a été livré -> on rend le scan.
            const rendu = await rembourserScan(req, 'ia-echec');
            enregistrerEchec({ route: 'analyser', userId: req.credit?.userId, ...annonce, cardInfo: null, motifEchec: 'ia-echec', rembourse: rendu });
            return res.json({ success: false, error: "Analyse IA échouée (voir logs Render pour la cause exacte)" });
        }

        // 1. Cache Mongo (sauté si debug=true, pratique pour retester une carte sans attendre 24h)
        let resultat = debug ? null : await lireCache(cardInfo.name, cardInfo.number, cardInfo.language);
        // Portée élargie : sert au log du ratio, en dehors du bloc d'identification.
        let idCarteTCGdex = null;
        // Idem pour le journal : la ligne est composée DANS le bloc d'identification
        // (où vivent candidats, scores et motif) mais écrite APRÈS, une fois les prix
        // connus. Reste null quand le cache a répondu — il n'y a alors pas eu de scan.
        let ligneJournal = null;
        if (debug) console.log("🐛 Mode debug : lecture du cache sautée.");

        // 2. Flux combiné orienté JUSTESSE :
        //    a) identifier le produit exact (TCGdex : numéro + image)
        //    b) retrouver le produit (idProduct + idExpansion) dans le catalogue local
        //    c) prix GUIDE LOCAL (instantané, par défaut)
        //    d) prix LIVE en bonus (exact + langue) si ton PC passe Cloudflare,
        //       + apprentissage du code set au passage
        //    e) repli TCGdex si rien d'autre n'a marché
        if (!resultat) {
            // 2a. Identification précise via TCGdex + image
            const trouvailleTCGdex = await trouverCarteTCGdex(cardInfo.name, cardInfo.number, cardInfo.setCode, imageUrl, cardInfo.language, cardInfo.total, cardInfo.nomBrut);
            if (!trouvailleTCGdex) {
                // Même distinction de motif que /api/identifier : un numéro illisible n'est
                // pas une carte introuvable. Le chemin d'identification LOCALE, lui, n'est
                // branché que sur /api/identifier — la route réellement utilisée par
                // l'extension. L'ajouter ici doublerait la surface sans gain visible.
                const motif = cardInfo.numeroIllisible ? 'numero-illisible' : 'carte-introuvable';
                const rendu = await rembourserScan(req, motif);
                enregistrerEchec({ route: 'analyser', userId: req.credit?.userId, ...annonce, cardInfo, motifEchec: motif, rembourse: rendu });
                return res.json({
                    success: false,
                    error: cardInfo.numeroIllisible
                        ? `Numéro de collection illisible sur la photo — identification impossible pour "${cardInfo.name}"`
                        : `Carte "${cardInfo.name}${cardInfo.setCode ? ' ' + cardInfo.setCode : ''} #${cardInfo.number}" non trouvée sur TCGdex`
                });
            }
            idCarteTCGdex = trouvailleTCGdex.id;

            // 2b. Candidats Cardmarket. Même hiérarchie que /api/identifier : le nom
            //     n'est utilisé que s'il est fiable, sinon on passe par le NUMÉRO dans
            //     l'expansion déduite du total.
            const { liste: expAttendues } = await interrogerSource('tcgdex/expansions',
                () => expansionsDuSetTCGdex(trouvailleTCGdex.id, regionAttendue(cardInfo), cardInfo.setCode));
            const nomFiable = trouvailleTCGdex.source !== 'total+numero';
            let produits = nomFiable
                ? (await interrogerSource('catalogue/nom', () => trouverProduitsLocaux(trouvailleTCGdex.nomExact))).liste
                : [];
            let voieCatalogue = 'nom';
            let aucunCandidatAuNumero = false;
            if (produits.length === 0 && expAttendues.length) {
                const { liste: parNumero } = await interrogerSource('catalogue/numero-expansion',
                    () => trouverProduitsParNumero(expAttendues, cardInfo.number));
                if (parNumero.length) { produits = parNumero; voieCatalogue = 'numero'; }
            } else if (produits.length > 0) {
                // Même règle que /api/identifier : le vivier par nom peut être plein et
                // pourtant incapable de contenir la bonne carte. Voir viviersAvecRangs.
                const choix = await viviersAvecRangs(produits, cardInfo.number, expAttendues, `[analyser] "${trouvailleTCGdex.nomExact}"`);
                produits = choix.produits;
                voieCatalogue = choix.voie;
                aucunCandidatAuNumero = choix.aucunCandidatAuNumero;
            }
            console.log(`🗂️ Catalogue local : ${produits.length} produit(s) pour "${trouvailleTCGdex.nomExact}".`);

            // 2c. NIVEAU 1 — scoring local (classe TOUS les candidats par pertinence)
            let classement = [];
            let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
            let estReverse = false;
            // Un candidat unique n'a rien à départager : la confiance est haute par
            // construction (c'est déjà ce que dit `confiant: true` dans ce cas-là).
            let confianceScoring = true;
            const optionsMotif = { variantsDetailed: trouvailleTCGdex.variantsDetailed, titre: title, tcgdexId: trouvailleTCGdex.id };
            if (produits.length === 1) {
                const analyseSolo = analyserVariantes(trouvailleTCGdex.variantsDetailed);
                motifResolution = resoudreMotif(analyseSolo, cardInfo.motif, title);
                estReverse = impressionEstReverse(motifResolution.cible, cardInfo.reverse);
                if (motifResolution.etat === 'non-resolu') loggerReplieMotif(motifResolution, cardInfo, analyseSolo, trouvailleTCGdex.id, title);
                classement = [{
                    candidat: produits[0], confiant: true,
                    strategie: analyseSolo.strategieParIdProduct.get(produits[0].idProduct) ?? null
                }];
            } else if (produits.length > 1) {
                const { scores, confiant, motif, estReverse: rev } = await scorerCandidatsLocal(produits, cardInfo, imageUrl, expAttendues, null, optionsMotif);
                motifResolution = motif;
                estReverse = rev;
                // scores est déjà trié par score décroissant ; on récupère les produits complets
                classement = scores.map(s => ({
                    candidat: produits.find(p => p.idProduct === s.candidat.idProduct),
                    score: s.score,
                    strategie: s.strategie
                }));
                console.log(`🧮 Scoring local : ${classement.length} candidats classés, meilleur = ${classement[0]?.candidat?.idProduct} (score ${scores[0]?.score}), confiance ${confiant ? 'HAUTE' : 'BASSE'}`);
                confianceScoring = confiant;
            }

            // Composition de la ligne de journal. Les prix seront ajoutés plus bas.
            ligneJournal = {
                route: 'analyser',
                userId: req.credit?.userId,
                ...annonce,
                nom: cardInfo.name, numero: cardInfo.number, total: cardInfo.total,
                setCode: cardInfo.setCode, langue: cardInfo.language, rarete: cardInfo.rarete,
                idProduct: classement[0]?.candidat?.idProduct,
                score: classement[0]?.score,
                nbCandidats: produits.length,
                // Aligné sur /api/identifier : `confiance` n'est plus écrit nulle part,
                // c'est `margeConfortable` (la marge du classement, et rien d'autre).
                // Deux routes qui n'écrivent pas le même champ pour la même notion
                // rendraient toute mesure par route incomparable.
                margeConfortable: confianceScoring,
                sourceIdentification: trouvailleTCGdex.source || 'nom',
                voieCatalogue,
                motifEtat: motifResolution.etat,
                aucunCandidatAuNumero,
                ecartScore: (classement.length > 1 && Number.isFinite(classement[0]?.score) && Number.isFinite(classement[1]?.score))
                    ? classement[0].score - classement[1].score
                    : null
            };

            const carteNonEN = cardInfo.language && cardInfo.language !== 'EN';

            // NIVEAU 2 — le serveur ne contacte JAMAIS Cardmarket lui-même : le live est
            // réservé à l'extension, côté navigateur de l'utilisateur (voir /api/identifier).
            // On prend directement le prix guide local du meilleur candidat classé.
            if (classement.length > 0) {
                const meilleur = classement[0].candidat;
                // C'est la NATURE de l'impression visée (reverse ou non) qui décide du
                // champ de prix, pas la stratégie de lecture : un produit dédié à une
                // Master Ball ne se vend qu'en reverse holo, son prix est donc dans
                // trendHolo (24,13 €) et pas dans trend (0,50 €).
                const prixLocal = await getPrixGuideLocal(meilleur.idProduct, estReverse);
                if (prixLocal !== null) {
                    resultat = {
                        price: prixLocal,
                        idProduct: meilleur.idProduct,   // tracé dans le log du ratio
                        url: `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${meilleur.idProduct}`,
                        source: 'guide-local',
                        // Incertain si plusieurs candidats OU si la carte a un motif de
                        // reverse qu'on n'a pas su cibler (écart de prix jusqu'à x100).
                        carteIncertaine: produits.length > 1 || motifResolution.etat === 'non-resolu'
                    };
                    const mention = estReverse ? ' [prix reverse : trendHolo]' : '';
                    console.log(`📘 Repli guide local pour idProduct ${meilleur.idProduct} : ${prixLocal} €${mention}${resultat.carteIncertaine ? ' (incertain)' : ''}`);
                }
            }

            // 2e. Repli TCGdex (frais du jour) si ni guide local ni live n'ont donné de prix
            if (!resultat) {
                console.log("↪️ Repli sur TCGdex (pas d'idProduct fiable ou pas de prix local).");
                resultat = await getPrixDepuisTCGdex(trouvailleTCGdex.id, cardInfo.name, cardInfo.number);
                if (resultat) resultat.source = 'tcgdex';
            }

            if (!resultat) {
                // Carte identifiée mais AUCUN prix de référence : le scan ne livre rien
                // d'exploitable pour l'utilisateur -> échec dur lui aussi.
                const rendu = await rembourserScan(req, 'aucun-prix');
                enregistrerEchec({ route: 'analyser', userId: req.credit?.userId, ...annonce, cardInfo, motifEchec: 'aucun-prix', rembourse: rendu });
                return res.json({ success: false, error: "Carte identifiée mais aucun prix disponible (voir logs)" });
            }

            // Marquer incertain si l'identification TCGdex l'était
            if (trouvailleTCGdex.ambigu) resultat.carteIncertaine = true;

            // Résultat LIVRÉ mais avec réserve : on le trace (et on ne rembourse que si
            // la politique a été élargie explicitement).
            if (resultat.carteIncertaine) {
                await signalerIncertain(req, motifResolution.etat === 'non-resolu'
                    ? `motif-${motifResolution.raison}`
                    : (trouvailleTCGdex.ambigu ? 'tcgdex-ambigu' : 'plusieurs-candidats'));
            }

            // On ne met pas en cache un résultat incertain
            if (!resultat.carteIncertaine) {
                await ecrireCache(cardInfo.name, cardInfo.number, cardInfo.language, resultat.price, resultat.url);
            }
        }

        const prixVintedNombre = vintedPrice ? parseFloat(String(vintedPrice).replace(',', '.')) : null;
        const verdict = calculerVerdict(prixVintedNombre, resultat.price, cardInfo.language, resultat.carteIncertaine);

        // ---- TRACE DU RATIO, pour fonder un seuil sur des données plutôt que sur une
        // intuition. Un ratio énorme du côté "trop cher" est bien plus souvent une
        // erreur d'identification qu'un vendeur délirant : les quatre cas connus sont
        // à x150, x150, x750 et x2750, et 16,8 % du catalogue cote moins de 0,10 €,
        // ce qui est la zone où atterrit une identification ratée.
        // ⚠️ Ce log ne couvre QUE /api/analyser. Dans le flux réel, c'est l'extension
        // qui lit le prix live et calcule le verdict : le serveur n'y voit jamais le
        // ratio. Le garde-fou doit donc vivre côté extension (spécification à part).
        // Format stable, une ligne, grepable : grep "[ratio]" server.log
        if (prixVintedNombre && resultat.price > 0) {
            const ratio = prixVintedNombre / resultat.price;
            console.log(
                `📊 [ratio] carte=${idCarteTCGdex || '?'} idProduct=${resultat.idProduct ?? '?'}` +
                ` vinted=${prixVintedNombre} reference=${resultat.price} ratio=${ratio.toFixed(1)}` +
                ` source=${resultat.source || '?'} incertain=${Boolean(resultat.carteIncertaine)}` +
                ` langue=${cardInfo.language}`
            );
        }

        // JOURNAL — même ligne que le log ci-dessus, mais PERSISTANTE. Les logs Render
        // sont éphémères ; cette collection est ce qui restera pour fonder les seuils.
        // Écrite seulement si un scan a réellement eu lieu (ligneJournal reste null
        // quand le cache a répondu : rien n'a été identifié, il n'y a rien à mesurer).
        if (ligneJournal) {
            enregistrerScan({
                ...ligneJournal,
                carteIncertaine: Boolean(resultat.carteIncertaine),
                prixVinted: prixVintedNombre,
                prixReference: resultat.price,
                sourcePrix: resultat.source || null
            });
        }

        // Le prix est fiable par langue UNIQUEMENT si le live filtré a réussi.
        // Sinon (guide local ou repli TCGdex = toutes langues), on prévient.
        const prixFiltreParLangue = resultat.source === 'cardmarket-live-langue';
        const langueVraimentIncertaine = (cardInfo.language && cardInfo.language !== 'EN') && !prixFiltreParLangue;

        // Lien vers la fiche Cardmarket filtrée dans la langue détectée
        const codeLangueURL = { EN: 1, FR: 2, DE: 3, ES: 4, IT: 5, ZH: 6, JP: 7, PT: 8, RU: 9, KR: 10 }[cardInfo.language] || 1;
        const urlLangue = resultat.url
            ? `${resultat.url}${resultat.url.includes('?') ? '&' : '?'}language=${codeLangueURL}`
            : null;

        res.json({
            success: true,
            cardName: cardInfo.name,
            cardNumber: cardInfo.number,
            cardTotal: cardInfo.total || null,
            rarete: cardInfo.rarete || null,
            language: cardInfo.language,
            cardmarketPrice: resultat.price,
            cardmarketUrl: urlLangue || resultat.url,
            tendance: resultat.tendance ?? null,
            historique: resultat.historique || null,
            vintedPrice: prixVintedNombre,
            verdict: verdict?.label || null,
            diffPourcent: verdict?.diffPourcent ?? null,
            langueIncertaine: langueVraimentIncertaine,
            carteIncertaine: Boolean(resultat.carteIncertaine),
            prixFiltreParLangue,
            etatVinted: vintedEtat || null,
            etatEstimeIA: cardInfo.etatEstime || null,
            etatConfianceIA: cardInfo.etatConfiance || null,
            defautsVus: cardInfo.defautsVus || null,
            grilleEtats: resultat.grilleEtats || null,
            baseEtat: resultat.baseEtat || null,
            etatCardmarket: etatMin || null,
            source: resultat.source || 'inconnue'
        });

    } catch (error) {
        console.error("❌ Erreur /api/analyser:", error);
        // ⚠️ LE CATCH REMBOURSE DÉSORMAIS — voir rembourserSiRienLivre. L'objection qui
        // l'en empêchait (« on ignore si un résultat a été livré ») était juste ; elle se
        // tranche par `res.headersSent`, pas par l'abstention.
        const rendu = await rembourserSiRienLivre(req, res, 'erreur-serveur');
        // ⚠️ Le message part au JOURNAL, jamais dans la réponse — voir `messageErreur`.
        enregistrerEchec({
            route: 'analyser', userId: req.credit?.userId, ...annonce, cardInfo,
            motifEchec: 'erreur-serveur', rembourse: rendu,
            messageErreur: `${error?.message ?? error} @ ${String(error?.stack ?? '').split('\n')[1]?.trim() ?? '?'}`
        });
        if (!res.headersSent) res.json({ success: false, error: "Erreur serveur interne" });
    }
});

// ============================================================
// ROUTE /api/identifier — pour l'ARCHITECTURE EXTENSION
// ============================================================
// Fait tout le travail d'identification (IA, TCGdex, catalogue, scoring) et
// renvoie les candidats CLASSÉS, mais ne touche PAS à Cardmarket : c'est
// l'extension qui fera le live depuis le navigateur de l'utilisateur, avec son
// IP et ses cookies. C'est la répartition qui évite les bannissements.
// ════════════════════════════════════════════════════════════════════════════
// LA NATURE D'UN REFUS — énumération FERMÉE, et la table vit ICI
// ════════════════════════════════════════════════════════════════════════════
// POURQUOI DEUX CHAMPS ET PAS UN. `rembourse` seul est inutilisable : `ia-echec` est
// une PANNE et sort pourtant avec `rembourse: true`. Une extension qui peindrait en
// doré tout ce qui est remboursé apprendrait à l'utilisateur qu'une panne est un
// service — l'inverse exact de ce qu'on veut lui enseigner.
// D'où la même séparation que `niveauReserve` / `raisonReserve`, qui a déjà fait ses
// preuves : LE CHAMP QUI PILOTE L'AFFICHAGE est distinct de CELUI QUI ALIMENTE LE
// TEXTE. `natureRefus` décide de la couleur ; `motifRefus` dit lequel, pour le libellé.
//
// POURQUOI LA TABLE EST CÔTÉ SERVEUR. Si l'extension recopiait motif -> nature, il
// n'existerait aucun défaut sûr pour une valeur qu'elle ne connaît pas encore. C'est
// ici qu'on ajoute des motifs, c'est donc ici qu'on les classe.
//
// ⚠️ LE DÉFAUT EST `echec-technique`, ET LE SENS DU DÉFAUT EST LE POINT. Un motif
// oublié dans cette table sort en ROUGE. On perd alors l'effet « l'outil t'a protégé »
// sur un refus qui le méritait — c'est un coût d'affichage. Le défaut inverse ferait
// passer une panne pour un service : c'est un coût de CONFIANCE, et il ne se répare
// pas. Entre les deux, on choisit toujours de se dévaloriser.
//
// ⚠️ CE QUE CETTE TABLE NE COUVRE PAS. Les refus des MIDDLEWARES arrivent avant le
// corps de la route, ne consomment aucun crédit et ne portent donc ni `rembourse` ni
// `motifRefus` : jeton invalide (401), image absente (400), quota épuisé (429, qui a
// déjà son `quotaAtteint: true`, lu par l'extension déployée), accès indisponible
// (503). Ils se distinguent par le CODE HTTP, qui n'est pas 200 — contrairement à
// tous les refus ci-dessous. Une allowlist branchée sur `motifRefus` ne doit donc être
// consultée QUE sur une réponse 200.
// ════════════════════════════════════════════════════════════════════════════
// UN BUG SERVEUR NE SE FACTURE PAS — ET « ON NE SAIT PAS » SE TRANCHE
// ════════════════════════════════════════════════════════════════════════════
// LE CAS RÉEL. Deux scans du 2026-08-03 ("Dragonite" n°080 et n°180, japonais, setCode
// « DP5 » lu alors que seul « DP5c » existe au catalogue) ont levé une exception et sont
// sortis en `erreur-serveur` avec `rembourse: false`. Crédit débité, rien rendu, rien
// livré. Ce sont les deux seules lignes du journal dans ce cas — et deux de trop.
//
// L'OBJECTION QUI BLOQUAIT LE CORRECTIF ÉTAIT JUSTE : dans un `catch`, on ignore si un
// résultat a déjà été livré, et rembourser après une livraison offrirait un scan gratuit
// sur un résultat rendu. Le code CONSTATAIT donc l'absence de remboursement au lieu de
// la corriger — prudence honnête, mais qui laissait l'utilisateur payer nos pannes.
//
// LA SORTIE N'EST PAS L'ABSTENTION, C'EST LA QUESTION POSÉE AU BON ENDROIT. Express sait
// si une réponse est partie : `res.headersSent`. Trois états au lieu de deux —
//   réponse déjà envoyée -> un résultat A été livré      -> on ne rembourse PAS
//   rien envoyé           -> l'utilisateur n'a rien reçu -> on rembourse
//   pas de crédit débité  -> rembourserScan rend false tout seul (code maître)
// C'est le premier principe appliqué à l'argent : « je ne sais pas » ne doit pas être
// traité comme « je sais que non » — il doit cesser d'être « je ne sais pas ».
//
// ⚠️ LE DOUBLE REMBOURSEMENT RESTE IMPOSSIBLE, et ce n'est pas cette fonction qui le
// garantit : `rembourserScan` pose `req.scanRembourse` au premier appel et refuse les
// suivants (acces.js). Vérifié par test-acces.js, « 2e appel refusé (verrou req) ».
async function rembourserSiRienLivre(req, res, motif) {
    if (res && res.headersSent) {
        console.warn(`💸 [catch] réponse DÉJÀ envoyée (motif ${motif}) -> pas de remboursement : un résultat a été livré.`);
        // La neuvième cause, et la seule qui ne vient pas de `rembourserScan` : ce n'est
        // pas un échec de remboursement, c'est un refus JUSTIFIÉ — un résultat a été
        // livré, donc le scan est dû. La distinguer des huit autres est tout l'intérêt.
        noterNonRemboursement('deja-livre');
        return false;
    }
    return await rembourserScan(req, motif);
}

const NATURE_REFUS = {
    // ── REFUS DÉLIBÉRÉS : la chaîne a fonctionné, et elle refuse de livrer un prix
    //    qu'elle sait ou soupçonne faux. Le crédit est rendu. C'est le service rendu,
    //    pas la panne — mesuré à 15 % des scans.
    'numero-illisible': 'refus-delibere',        // le numéro de collection n'est pas lisible sur la photo
    'carte-introuvable': 'refus-delibere',       // ni TCGdex ni le catalogue local ne connaissent cette carte
    'aucun-candidat': 'refus-delibere',          // aucun produit Cardmarket ne porte ce nom
    'nom-contredit-egalite': 'refus-delibere',   // le gagnant ne porte pas le nom lu, et le vivier de preuve ne départage pas
    'nom-contredit-sans-repli': 'refus-delibere',// idem, et le vivier de preuve est vide
    'egalite-parfaite': 'refus-delibere',        // plusieurs cartes correspondent aussi bien, l'écart de prix décide du verdict
    'aucun-prix': 'refus-delibere',              // ⚠️ /api/analyser UNIQUEMENT — jamais émis par /api/identifier

    // ── ÉCHECS TECHNIQUES : quelque chose n'a pas marché. Rouge, même remboursé.
    'ia-echec': 'echec-technique',               // le modèle n'a rien rendu d'exploitable — REMBOURSÉ, et pourtant une panne
    'erreur-serveur': 'echec-technique',         // exception dans la route — NON remboursé
    // ⚠️ CELUI-CI EXISTE PARCE QUE SON ABSENCE A MENTI. Le 2026-08-15 à 11:47, deux cartes
    // japonaises que TCGdex connaît sont sorties en `carte-introuvable`, donc en
    // 'refus-delibere', donc en doré — la couleur qui dit « la chaîne a fonctionné, cette
    // carte n'existe pas ». C'était le réseau. Une panne classée en refus délibéré est la
    // pire sortie possible : elle affirme une absence qu'on n'a jamais constatée, et elle
    // pollue toutes les statistiques de `carte-introuvable` au passage.
    'tcgdex-injoignable': 'echec-technique'      // TCGdex n'a pas répondu, même après un réessai — REMBOURSÉ, et pourtant une panne
};
// ════════════════════════════════════════════════════════════════════════════
// LES REFUS QUI AFFIRMENT UNE ABSENCE — et la seule chose qui peut les démentir
// ════════════════════════════════════════════════════════════════════════════
// Ces deux motifs-là ne disent pas « je ne sais pas trancher » : ils disent « cette carte
// n'existe pas ». C'est une AFFIRMATION SUR LE MONDE, et elle n'a le droit d'être
// prononcée que si on a effectivement cherché. Si une source est tombée pendant le scan,
// on n'a pas cherché — on a échoué à chercher, et ce n'est pas la même sortie.
// Les autres motifs ne sont pas concernés : `egalite-parfaite` affirme qu'on a trouvé
// PLUSIEURS candidats, `numero-illisible` parle de la photo. Une panne ne les rend pas
// faux, elle ne les touche pas.
const REFUS_D_ABSENCE = new Set(['carte-introuvable', 'aucun-candidat']);

// UN SEUL ENDROIT CONSTRUIT LES TROIS CHAMPS, pour qu'aucune sortie ne puisse en
// oublier un ni les faire diverger. Les cinq sorties de /api/identifier l'appellent.
//
// ⚠️ ET C'EST POUR ÇA QUE LA REQUALIFICATION EST ICI ET NULLE PART AILLEURS. La clause
// aurait pu être écrite à chacune des sorties d'absence ; elle aurait alors été oubliée
// à la sixième, comme les trois champs l'auraient été sans cette fonction.
//
// ════════════════════════════════════════════════════════════════════════════
// 📌 CE QUI DEVRAIT ÊTRE ICI ET N'Y EST PAS — REPORTÉ LE 2026-09-01, PAS OUBLIÉ
// ════════════════════════════════════════════════════════════════════════════
// LA BONNE FORME EST CONNUE : cette fonction devrait construire AUSSI LA PHRASE, pas
// seulement les trois champs machine. Le raisonnement est exactement celui du paragraphe
// ci-dessus — « écrite à chacune des sorties, elle sera oubliée à la sixième » — et il
// s'est vérifié : la clause d'argent a été écrite cinq fois à la main, et il a fallu cinq
// passages pour la corriger cinq fois. La règle tiendrait en une ligne ici :
//     la clause d'argent n'est ajoutée QUE si `raisonNonRembourse === 'plafond-jour'` ;
//     toute autre valeur, Y COMPRIS INCONNUE, ⇒ silence.
//
// POURQUOI ON NE LE FAIT PAS AUJOURD'HUI, et c'est le testeur qui a tranché sur ce
// chiffre-là : le refactor touche LES 7 SITES d'appel, dont CINQ SONT DÉJÀ CORRECTS et
// muets sur l'argent. On paierait la réécriture de cinq phrases justes pour en réparer une.
// Le risque n'est pas le mécanisme, il est dans le passage.
//
// 🔑 QUAND LE FAIRE : le jour où une AUTRE raison oblige déjà à toucher ces sites. Le
// refactor devient alors gratuit — on relit les phrases de toute façon. Le faire seul,
// aujourd'hui, c'est ouvrir sept sites pour un.
//
// Recensement des 7 sites : grep sur `champsDeRefus(` — PAS sur le vocabulaire du défaut.
// Le cinquième exemplaire disait « votre crédit est rendu » et aucun grep sur « rembours »
// ne l'a jamais vu. Voir l'erreur d'instrument #17 dans scoring.js.
//
// ⚠️ ANGLE MORT ASSUMÉ, DÉCLARÉ ICI PARCE QUE C'EST ICI QU'ON VIENDRA :
// AUCUN TEST NE LIT LES PHRASES DE REFUS. `test-sources.js` couvre la NATURE des sorties
// (`refus-delibere` / `echec-technique`, clause 3 comprise) et rien de leur PROSE. Les cinq
// exemplaires de la clause d'argent ont donc tous été trouvés à l'œil, un par un, sur
// signalement — jamais par une suite. Non comblé le 2026-09-01, sur décision du testeur, et
// écrit pour que la prochaine relecture sache que le vert des suites ne couvre pas ce texte.
function champsDeRefus(motifRefus, rembourse) {
    // CLAUSE 3 — un refus d'absence prononcé alors qu'une source est tombée n'est pas un
    // refus délibéré, c'est un échec technique. Le MOTIF ne bouge pas (il dit par où on
    // est sorti, et les statistiques par motif restent comparables) ; c'est la NATURE qui
    // change, donc la couleur affichée et le sens rendu à l'utilisateur.
    const tombees = sourcesTombees();
    const absenceNonConstatee = tombees.length > 0 && REFUS_D_ABSENCE.has(motifRefus);
    if (absenceNonConstatee) {
        console.warn(`⚠️ [absence-non-constatee] « ${motifRefus} » requalifié en echec-technique :` +
            ` ${tombees.join(', ')} n'a pas répondu. On n'affirme pas une absence qu'on n'a pas constatée.`);
    }
    // ⚠️ LA CLAUSE 2 EST ÉCRITE ICI ET REPORTÉE, POUR QU'ELLE NE SE PERDE PAS.
    // Elle dirait : `sourcesTombees().length > 0` force `carteIncertaine`, même sur un
    // SUCCÈS — un prix calculé sur un vivier amputé par une panne est un prix dont on ne
    // répond pas. Elle n'est pas écrite aujourd'hui pour deux raisons :
    //   · elle fait basculer des scans RÉUSSIS en réserve, à 57,1 % de réserve déjà
    //     (52 succès sur 91). C'est une décision de PRODUIT, pas un correctif, et elle ne
    //     part pas dans le même lot qu'un correctif d'honnêteté ;
    //   · son coût rétroactif est nul là où il est mesurable et inconnu ailleurs. Sur les
    //     172 lignes : 0 sur `catalogue/numero-expansion` et `catalogue/numero-partout`
    //     (leur trace, `aucunCandidatAuNumero`, n'a JAMAIS été vraie), 0 sur
    //     `catalogue/nom` par construction (une panne y donne un refus, pas un succès), et
    //     NON MESURABLE sur `catalogue/setcode-numero`, dont la borne large est de 11
    //     succès ayant lu un setCode mais abouti par une autre voie.
    // Le report est donc gratuit sur ce qu'on sait mesurer. Quand `sourcesEnPanne` aura
    // couru quelques semaines, le vrai coût se lira au journal au lieu de se borner.
    return {
        // ⚠️ LA VALEUR RÉELLE, jamais `true` en dur : `rembourserScan` peut échouer, et
        // annoncer un remboursement qui n'a pas eu lieu serait une seconde source de
        // vérité sur l'état d'un compte.
        rembourse: Boolean(rembourse),
        // ⚠️ POURQUOI, QUAND `rembourse` EST FAUX. Neuf causes se cachaient derrière ce
        // booléen, dont une seule — 'plafond-jour' — signifie que l'utilisateur a perdu
        // quelque chose. Les autres disent « il n'y avait rien à rendre ». Sans ce champ,
        // aucune des deux situations ne peut être ni mesurée ni expliquée.
        // null quand le scan est remboursé, ou qu'aucun remboursement n'a été tenté.
        // Énumération fermée : voir RAISONS_NON_REMBOURSE dans sources.js.
        //
        // ════════════════════════════════════════════════════════════════════
        // CONTRAT D'AFFICHAGE — POUR L'EXTENSION, ARRÊTÉ LE 2026-08-19, CIBLE 1.0.5
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ CETTE NOTE VIT ICI PARCE QUE C'EST ICI QUE LE CHAMP EST PRODUIT. L'extension
        // est un autre dépôt ; une règle d'affichage écrite seulement là-bas se perd entre
        // deux versions — c'est ce qui est arrivé à la traduction des pannes. Écrite du
        // côté qui émet, elle survit au renumérotage des versions.
        //
        // LA RÈGLE, EN UNE PHRASE : ON NE PARLE D'ARGENT QUE QUAND IL Y A PRÉJUDICE.
        // Neuf causes, une seule mérite une phrase à l'utilisateur.
        //
        //   'plafond-jour'   -> PARLE. C'est la seule où l'utilisateur a perdu quelque
        //                       chose : il y avait un crédit à rendre et on a refusé.
        //                       Dire quoi, pas pourquoi techniquement, et renvoyer vers
        //                       l'adresse de contact DÉJÀ publiée dans les mentions
        //                       légales et les CGV de rat-market.fr — surtout pas un
        //                       canal nouveau, qui serait une seconde chose à surveiller.
        //                       « Ce scan n'a pas été recrédité : la limite de
        //                         remboursements automatiques du jour est atteinte.
        //                         Écris-nous si tu penses qu'il y a une erreur. »
        //   'deja-livre'     -> SE TAIT. Un résultat A ÉTÉ livré, donc le scan est dû.
        //                       Afficher « non remboursé » ici serait un reproche à propos
        //                       d'un service rendu.
        //   'aucun-debit'    -> SE TAIT. Rien n'a été pris, il n'y a rien à rendre. C'est
        //                       le cas ORDINAIRE — 32 lignes sur 172 au 2026-08-19 — et en
        //                       parler fabriquerait une inquiétude sans objet.
        //   les six autres   -> SE TAISENT, même raison : ce sont des « rien à rendre »,
        //                       pas des refus de rendre. Elles restent au journal, pour
        //                       être comptées.
        //
        // ⚠️ CE QUE ÇA CORRIGE : l'extension tire aujourd'hui son texte du seul booléen
        // `rembourse`, donc elle parle sur les NEUF. La règle n'est pas « montrer
        // `rembourse` », c'est « montrer `raisonNonRembourse === 'plafond-jour'` ».
        raisonNonRembourse: rembourse ? null : raisonNonRemboursement(),
        motifRefus,
        natureRefus: absenceNonConstatee ? 'echec-technique' : (NATURE_REFUS[motifRefus] ?? 'echec-technique')
    };
}

app.post('/api/identifier', verifierJeton, exigerImage, verifierAcces, async (req, res) => {
    // Même raison que dans /api/analyser : le catch doit pouvoir journaliser CE QUE
    // L'IA AVAIT LU, sinon la ligne d'échec ne désigne aucune carte.
    let cardInfo = null;
    // De quoi revérifier ce scan des mois plus tard, y compris depuis le catch. Voir
    // journal-scans.js : les annonces Vinted disparaissent en quelques jours.
    let annonce = { imageUrl: null, vintedUrl: null };
    try {
        const { imageUrl, imageUrls, title, vintedEtat } = req.body;
        // ⚠️ LE PRIX DEMANDÉ SUR L'ANNONCE — accepté à l'entrée depuis le 2026-08-11.
        // Il était renseigné sur 0 des 142 lignes du journal, et ce n'était PAS un oubli
        // d'écriture : la route ne le recevait pas. Sans lui, impossible de dire de quel
        // côté de la fourchette tombe une annonce, donc impossible de mesurer ce que la
        // règle de la fourchette rapporterait.
        // ⚠️ CE N'EST PAS UNE RÉFÉRENCE. C'est la chose qu'on JUGE : il ne calibre rien,
        // il ne corrige rien, il ne pilote aucune décision de ce serveur. Il est lu, il
        // est journalisé, et c'est tout.
        // Validé plutôt que fait confiance : une chaîne, un zéro ou un négatif deviennent
        // null. Un 0 n'est pas un prix, c'est une absence — même règle que le guide.
        const prixVintedBrut = Number(req.body?.prixVinted);
        const prixVinted = Number.isFinite(prixVintedBrut) && prixVintedBrut > 0 ? prixVintedBrut : null;

        // ════════════════════════════════════════════════════════════════════
        // L'ÉTAT — UN SEUL POINT DE CONSTRUCTION, POUR LA RÉPONSE ET POUR LE JOURNAL
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI CE POINT EXISTE — mesuré le 2026-09-02, et c'est un trou plus large que
        // les deux précédents. AUCUN champ d'état n'atteignait le journal :
        //     etatEstime · etatConfiance · etatVinted · etatMin · etatRetenu · prixParEtat
        // tous ABSENTS DU SCHÉMA, 0 ligne sur 212. Le bloc `etat` existait déjà, entier,
        // mais il partait dans la RÉPONSE HTTP à l'extension et s'arrêtait là.
        // 🔑 LA CAUSE COMMUNE AUX TROIS TROUS DU CHANTIER (`symboleSet`, `vivierIds`, et
        // celui-ci) : LA RÉPONSE ET LE JOURNAL SONT DEUX PUITS DISTINCTS. Enrichir l'un
        // n'enrichit pas l'autre, et rien ne le signale — la réponse est relue tous les
        // jours par l'extension, le journal ne l'est que le jour où on veut mesurer.
        //
        // CE QUE ÇA RENDAIT IMPOSSIBLE, et pas seulement difficile : « combien de fois le
        // verdict s'inverse selon l'état retenu ». `etatRetenu` vaut le PIRE de l'avis IA et
        // de l'état déclaré par le vendeur — l'IA ne peut que DÉGRADER, jamais relever. Sur
        // un cas réel : base EX+ à 1,50 € donne « 167 % au-dessus », base NM à 4,75 € donne
        // une bonne affaire. LE VERDICT S'INVERSE. Sans ces champs la question n'attendait
        // pas plus de volume : elle était sans réponse à tout volume.
        //
        // ⚠️ UNE FONCTION, PAS UN OBJET FIGÉ, pour la même raison que `champsVivier` :
        // `cardInfo` n'existe pas encore à cette ligne (l'IA n'est pas appelée) et il est
        // RÉÉCRIT plus bas par le validateur TCGdex. Un instantané pris ici serait vide ;
        // pris plus bas, il manquerait à toutes les sorties de refus qui le précèdent. La
        // fonction lit au MOMENT de l'appel, seul moment qui décrit la décision.
        //
        // ⚠️ ET LA RÉPONSE HTTP LIT CE MÊME BLOC (voir `etat:` plus bas). C'est le point :
        // deux expressions « qui se ressemblent » — l'une pour l'extension, l'autre pour le
        // journal — divergeraient au premier changement de la règle du pire état, et on
        // mesurerait alors autre chose que ce qu'on affiche.
        const champsEtat = () => {
            const c = cardInfo || {};
            const etatMin = etatVintedVersCardmarket(vintedEtat);
            return {
                etatVinted: vintedEtat || null,
                etatMin,
                etatEstimeIA: c.etatEstime || null,
                etatConfianceIA: c.etatConfiance || null,
                defautsVus: Array.isArray(c.defautsVus) ? c.defautsVus : null,
                // ⚠️ `etatConfiance` EST UNE PORTE, PAS UN POIDS : sous « moyenne », l'avis
                // de l'IA est ignoré EN BLOC, il n'est pas pondéré. C'est un choix, et il
                // devient mesurable maintenant qu'il est journalisé.
                etatRetenu: pireEtat(
                    (c.etatConfiance === 'haute' || c.etatConfiance === 'moyenne') ? c.etatEstime : null,
                    etatMin
                )
            };
        };

        // `vintedUrl` ou `url` : l'extension n'en envoie encore AUCUN des deux. Les deux
        // noms sont acceptés pour que le champ se remplisse sans toucher au serveur.
        annonce = {
            imageUrl: (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls[0] : imageUrl,
            vintedUrl: req.body.vintedUrl || req.body.url || null
        };
        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        // exigerImage a déjà refusé les requêtes sans photo, AVANT tout décompte.

        // ⚓ JALON DU VERROU (« route ») — voir verrou/jalons.js. Ne pas reformuler ni
        // déplacer sans mettre le verrou à jour : il lit ce texte pour savoir jusqu'où la
        // chaîne est allée, et un jalon perdu se manifeste par un échec qui accuse le code
        // alors que seul le log a bougé.
        console.log(`\n📷 [identifier] ${photos.length} photo(s) reçue(s).`);

        // 1. Lecture de la carte par l'IA
        const debutIA = Date.now();
        cardInfo = await getCardIdFromAI(photos, title);
        // ⚓ JALON DU VERROU (« ia-lue ») — voir verrou/jalons.js.
        // ⚠️ CAPTURÉ DANS UNE VARIABLE, PAS SEULEMENT AFFICHÉ. Cette durée n'existait que
        // dans ce `console.log` : elle partait dans les logs Render et nulle part ailleurs.
        // `msCatalogue` est renseignée plus bas, au même endroit que son propre log.
        const msIA = Date.now() - debutIA;
        let msCatalogue = null;
        console.log(`⏱️ [identifier] appel IA : ${msIA} ms`);
        // UN SEUL POINT DE CONSTRUCTION, comme `champsEtat` et `champsVivier`. Et une
        // FONCTION pour la même raison : `msCatalogue` n'est renseignée que ~700 lignes
        // plus bas, et les sorties de refus d'amont doivent quand même porter `msIA` et
        // `nbPhotos`. Un objet figé ici rendrait `msCatalogue` toujours nulle.
        const champsCout = () => ({ msIA, msCatalogue, nbPhotos: photos.length });
        if (!cardInfo) {
            const rendu = await rembourserScan(req, 'ia-echec');
            // ⚠️ `cardInfo` EST NUL ICI, ET LE BLOC RESTE UTILE : `etatVinted` et `etatMin`
            // ne viennent pas de l'IA mais de l'annonce. Une panne de lecture n'efface pas
            // ce que le vendeur a déclaré. Les trois champs d'origine IA seront nuls, et ce
            // null-là est une information : la lecture a échoué, pas l'annonce.
            enregistrerEchec({
                route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo: null,
                motifEchec: 'ia-echec', rembourse: rendu, ...champsEtat(), ...champsCout()
            });
            // ⚠️ REMBOURSÉ, ET POURTANT UNE PANNE. C'est précisément le cas qui rendait
            // `rembourse` inutilisable seul : voir la table NATURE_REFUS au-dessus.
            return res.json({ success: false, ...champsDeRefus('ia-echec', rendu), error: "Analyse IA échouée" });
        }

        // Instrumentation : mesure le coût du bloc catalogue+TCGdex+scoring (tout ce
        // qui suit), pour décider plus tard si un cache/cache mémoire (reporté) vaut le
        // coup — à comparer avec le temps d'appel IA ci-dessus, qui tourne de toute façon.
        const debutCatalogue = Date.now();

        // ════════════════════════════════════════════════════════════════════
        // LE NOMBRE IMPRIMÉ EST-IL UN NUMÉRO DE POKÉDEX ?
        // ════════════════════════════════════════════════════════════════════
        // Voir pokedex.js pour la règle et ses trois bornes. Quand elle se déclenche, le
        // nombre lu N'EST PAS un numéro de carte, et il ne doit donc plus servir à rien :
        //   - ni de clé de recherche (il désignerait une autre carte, souvent dans un des
        //     quatre sets ordonnés par le Pokédex) ;
        //   - ni à disqualifier le NOM (`nomSuspect`) : c'est ce désaccord de numéro qui a
        //     jeté « Koga's Ditto », un nom pourtant JUSTE, sur un 72 contre 132 ;
        //   - ni au classement par rangs, qui conclurait « aucun candidat ne porte ce
        //     numéro » — vrai, et sans le moindre intérêt.
        // `numeroCarte` remplace donc `cardInfo.number` PARTOUT en aval. Le nombre lu reste
        // dans cardInfo, il part au journal et à l'extension : on le neutralise, on ne
        // l'efface pas.
        const avisDex = numeroEstUnDexId({
            nom: cardInfo.name, numero: cardInfo.number, total: cardInfo.total, langue: cardInfo.language
        });
        const numeroCarte = avisDex.estDex ? null : cardInfo.number;
        if (avisDex.estDex) {
            // ⚠️ « scoring » N'EST PAS DANS CETTE LISTE, et c'est exact : voir le lot B
            // retenu, sur `numeroBrutPourScoring`. Ce log dit ce qui EST neutralisé.
            console.warn(`🔢 [numero-pokedex] ${avisDex.raison} -> le numéro est NEUTRALISÉ (recherche, nomSuspect, rangs, région).`);
        }
        // ════════════════════════════════════════════════════════════════════
        // ⚰️ QUESTION FERMÉE — « que donner d'autre à TCGdex ? » — 2026-09-02
        // ════════════════════════════════════════════════════════════════════
        // Le numéro neutralisé, la requête TCGdex part avec LE NOM SEUL, sans `localId`.
        // La question s'est posée pendant l'incident du 2026-09-02 (trois refus
        // `tcgdex-injoignable` sur un Haunter ゴースト) : peut-on lui donner autre chose ?
        // MESURÉ sur les 7 lignes à numéro neutralisé du journal :
        //     total 0/7 · setCode 0/7 · symboleSet 2/7 · rarete 7/7
        // `total` et `setCode` sont nuls PAR DÉFINITION — c'est ce qui définit la cellule.
        // `symboleSet` n'est pas un filtre que l'API TCGdex accepte. `rarete` non plus.
        // 🔑 RÉPONSE : NON, IL N'Y A RIEN D'AUTRE. La requête restera un nom seul.
        //
        // ⚠️ ET ELLE N'EST PAS LOURDE POUR AUTANT — c'est l'autre moitié de la conclusion,
        // et elle interdit de rouvrir le sujet sous l'angle de la performance. Mesuré cinq
        // fois sur l'URL exacte du log :
        //     nom seul  -> 14 éléments, 0,9 Ko, médiane 74 ms
        //     avec localId -> 1 élément, 0,1 Ko, médiane 48 ms
        // 26 ms d'écart. TCGdex filtre côté serveur ; il ne rend pas un catalogue. Un
        // ECONNABORTED à 15 000 ms sur une requête de 74 ms n'est donc PAS une lenteur
        // structurelle de ce chemin — c'était un incident réseau d'au moins ~30 s (le
        // réessai à 400 ms a échoué aussi). Les trois seuls `tcgdex-injoignable` de tout
        // le journal sont ces trois-là, et ce sont trois tentatives sur LA MÊME carte.
        // ════════════════════════════════════════════════════════════════════
        // LE cardInfo EFFECTIF — « PARTOUT en aval » rendu vrai
        // ════════════════════════════════════════════════════════════════════
        // La phrase ci-dessus était écrite depuis le début ; elle n'était pas tenue.
        // `scorerCandidatsLocal` recevait `cardInfo` BRUT et y lisait le numéro TROIS fois :
        //   - `lu.numero`, le critère de scoring
        //   - le contrôle `region-conflit`
        //   - `bilanDesRangs`, qui produit `rangGagnant`
        // pendant que le reste de la route — recherche, veto par le nom, identification
        // locale, périmètre vintage — utilisait `numeroCarte`, neutralisé. DEUX DÉFINITIONS
        // DE « LE NUMÉRO LU » DANS LA MÊME ROUTE, à quelques lignes d'écart, sans signal :
        // le deuxième principe, pour la troisième fois en une semaine. Les deux premières
        // étaient le veto par le nom (Light Jolteon, Dark Haunter, Misty's Staryu, sortis
        // « incohérents » alors que la seule incohérence était la nôtre) et le troisième
        // état ; celle-ci a produit QUATRE faux rangs 3 — Pichu #172, Cyndaquil #155,
        // Hypno #097, Entei #244, qui sont les numéros de Pokédex de ces espèces.
        //
        // ⚠️ CHANGEMENT D'INSTRUMENT, AU MÊME TITRE QU'UN CHANGEMENT DE PROMPT.
        // `rangGagnant` change de valeur sur les lignes à numéro de Pokédex : les rangs
        // journalisés avant ce commit et après ne s'additionnent pas. On ne préserve pas la
        // comparabilité d'une mesure fausse — la valeur d'avant ne mesurait pas le rang du
        // gagnant, elle mesurait le désaccord entre un numéro de Pokédex et un numéro de
        // collection, ce qui n'a jamais eu d'intérêt.
        //
        // ⚠️ LA PORTÉE S'ARRÊTE AUX DIAGNOSTICS, ET C'EST UN CHOIX. Ce correctif couvre le
        // contrôle `region-conflit` (un console.warn) et `bilanDesRangs` (des signaux
        // journalisés) : aucun des deux ne choisit une carte, donc aucun ne change un prix.
        // Le critère `numero` du SCORING, lui, garde le nombre brut pour l'instant — voir
        // `numeroBrutPourScoring` dans scorerCandidatsLocal. Le neutraliser est
        // probablement juste, mais toucherait 56 des 131 lignes du journal et n'est PAS
        // mesuré : ça part dans un lot séparé, après la mesure, jamais avec un contrat
        // d'affichage.
        //
        // `cardInfo` BRUT reste la source pour le journal, la réponse et les messages : on
        // neutralise le numéro, on ne l'efface pas.
        const cardInfoEffectif = { ...cardInfo, number: numeroCarte };

        // DETTE COMPTÉE, PAS TRAITÉE. La borne « total présent » de la règle ci-dessus n'a
        // que deux états ; le troisième (« total douteux ») n'est pas écrit parce que son
        // coût est mesuré à ZÉRO ligne du banc. Ce compteur est ce qui permettra de trancher
        // avec des chiffres le jour venu — voir pokedex.js et journal-scans.js.
        // ⚠️ Il NE COMMANDE RIEN : la liste des sets est lue dans un cache déjà chaud
        // (aucun appel réseau supplémentaire) et le résultat ne va qu'au journal.
        //
        // ⚠️ TROIS ÉTATS, PAS DEUX — et le troisième est celui qui manquait.
        // `chargerSetsTCGdex` rend une liste VIDE quand elle est injoignable. L'ancienne
        // écriture (`setsPourTotal(...).length === 0`) ne pouvait donc pas distinguer
        // « aucun set ne fait cette taille » de « je n'ai pas pu regarder » — le même
        // défaut absence/panne que le catch d'identification a déjà fermé. Mesuré : sur les
        // 7 lignes marquées, 3 tombent dans une seule fenêtre de 43 minutes le 2026-08-15,
        // sur un seul build, et TOUTES les trois retrouvent leur set au rejeu d'aujourd'hui
        // avec un code inchangé depuis le 2026-07-30. C'était la liste, pas les cartes.
        //   null  -> aucun total lu, OU liste indisponible : HORS MESURE
        //   true  -> la liste a été consultée et aucun set n'a cette taille
        //   false -> un set au moins a cette taille
        let totalHorsTailleDeSet = null;
        if (cardInfo.total != null && String(cardInfo.total).trim() !== '') {
            const setsConnus = await chargerSetsTCGdex(langueDesSetsTCGdex(cardInfo.language));
            totalHorsTailleDeSet = setsConnus.length === 0
                ? null
                : setsCompatiblesAvecTotal(setsConnus, cardInfo.total).length === 0;
            if (totalHorsTailleDeSet) console.log(`📊 [total-hors-taille-de-set] total ${cardInfo.total} : aucun set de cette taille en [${langueDesSetsTCGdex(cardInfo.language)}]. Compté, sans conséquence.`);
        }

        // ════════════════════════════════════════════════════════════════════
        // CHEMIN 1 — setCode LU + numéro LU, EN TÊTE
        // ════════════════════════════════════════════════════════════════════
        // Voir trouverParSetCodeEtNumero pour le pourquoi et les chiffres. Ce chemin ne
        // décide QUE de l'identité du produit ; TCGdex reste appelé juste après pour ses
        // variants_detailed, qui sont la seule chose qu'il apporte et que Cardmarket ne
        // sait pas donner (routage du motif de reverse, jusqu'à x100 d'écart de prix).
        // Court-circuiter TCGdex ici ferait perdre ce routage sur ~47 % des scans : le
        // gain d'identification se paierait en erreurs de prix.
        let produitsImposes = null, voieImposee = null;
        // ⚠️ ENVELOPPÉ, et c'est le site le plus sournois des six : une panne ici n'efface
        // pas un candidat, elle efface un CHEMIN ENTIER — le scan continue par une autre
        // voie et peut réussir, sans que rien ne dise que le chemin en tête n'a pas été
        // essayé. C'est le seul des six dont le coût passé n'a pas pu être chiffré.
        const { liste: pisteCode } = await interrogerSource('catalogue/setcode-numero',
            () => trouverParSetCodeEtNumero(cardInfo.setCode, numeroCarte, cardInfo.language));
        if (pisteCode.length === 1) {
            const avis = await nomOpposeUnVeto({ ...cardInfo, number: numeroCarte }, pisteCode[0]);
            if (avis.veto) {
                console.warn(`🚫 [setcode-numero] ${cardInfo.setCode}+${cardInfo.number} désigne ${pisteCode[0].idProduct} "${String(pisteCode[0].name).split('[')[0].trim()}", REFUSÉ : ${avis.raison}`);
            } else {
                produitsImposes = pisteCode;
                voieImposee = 'setcode-numero';
                console.log(`🎯 [setcode-numero] ${cardInfo.setCode}+${cardInfo.number} -> ${pisteCode[0].idProduct} "${String(pisteCode[0].name).split('[')[0].trim()}" (${avis.raison})`);
            }
        } else if (pisteCode.length > 1) {
            console.log(`🎯 [setcode-numero] ${cardInfo.setCode}+${cardInfo.number} -> ${pisteCode.length} produits, le chemin ne tranche pas : on laisse le scoring faire.`);
        }

        // 2. Identification précise via TCGdex (+ variantes de nom, multilingue)
        let trouvaille = await trouverCarteTCGdex(cardInfo.name, numeroCarte, cardInfo.setCode, photos[0], cardInfo.language, cardInfo.total, cardInfo.nomBrut);
        // ⚠️ PANNE ET ABSENCE SE SÉPARENT ICI, ET NULLE PART AILLEURS. `trouvaille` reprend
        // sa valeur `null` habituelle pour que tout l'aval soit inchangé ; le drapeau, lui,
        // survit et commande deux choses, une par étape :
        //   - le MOTIF du refus final : une panne n'est pas un refus délibéré (NATURE_REFUS) ;
        //   - le droit de REPLIER par nom seul, qui n'est ouvert que sur absence RÉELLE.
        // Replier sur une panne échangerait un refus honnête contre une identification
        // hasardeuse : c'est le mauvais sens de l'échange, le seul que le critère de
        // lancement interdit.
        const tcgdexEnPanne = trouvaille === TCGDEX_EN_PANNE;
        if (tcgdexEnPanne) trouvaille = null;

        // ════════════════════════════════════════════════════════════════════
        // REPLI LOCAL — avant tout remboursement
        // ════════════════════════════════════════════════════════════════════
        // TCGdex ne connaît pas tout : les e-Series japonaises en sont absentes, et notre
        // propre catalogue a la réponse. Mesuré sur les annonces réelles — Arbok 099 ->
        // 160,08 €, Rhydon 055 -> 72,22 €, Ledian 007 -> 147,94 € — alors que la route
        // répondait « non trouvée sur TCGdex » et remboursait. Voir identification-locale.js.
        let identificationLocale = false;
        // Le repli par NOM SEUL borné au périmètre vintage (étape 3). Drapeau DISTINCT de
        // `perimetreVintage`, qui est déclaré bien plus bas et RESTREINT un vivier déjà
        // constitué : ici le périmètre ne restreint pas, il AUTORISE un vivier qui n'aurait
        // pas existé. Deux mécanismes, deux mesures — les confondre rendrait l'un des deux
        // illisible dans les statistiques.
        let nomSeulVintage = false;
        let localIncertain = false;
        // ⚠️ L'écart de score du chemin LOCAL n'était nulle part : ni au journal, ni dans
        // la réponse. Il n'existait que dans un console.log, donc éphémère sur Render.
        // Conséquence mesurée : la statistique « 9 égalités sur 27 » ne comptait QUE le
        // chemin principal, alors que le chemin local porte 46,8 % des identifications.
        // Un seuil dérivé de cette mesure aurait été fixé sur la moitié du volume.
        let ecartScoreLocal = null;
        if (!trouvaille && produitsImposes) {
            // Le chemin par le code a déjà tranché et TCGdex est muet : on n'a plus rien à
            // lui demander. `trouvaille` synthétique, comme pour l'identification locale —
            // ses champs TCGdex sont nuls, donc pas de routage de motif possible, d'où
            // `identifieeEnLocal` et le drapeau d'ambiguïté qui va avec.
            const gagnant = produitsImposes[0];
            identificationLocale = true;
            localIncertain = true;
            console.log(`🗃️ [identifier] TCGdex muet, mais setCode+numéro avait déjà tranché -> ${gagnant.idProduct}`);
            trouvaille = {
                id: null, localId: null, variants: null, variantsDetailed: null,
                nomExact: String(gagnant.name || '').split('[')[0].trim(),
                source: 'setcode-numero', ambigu: true,
                // TCGdex est muet : AUCUNE route n'a trouvé. `null` et non 'en' — ne pas
                // confondre « pas de route » avec « la route anglaise ».
                langueRoute: null
            };
        } else if (!trouvaille) {
            // Enveloppée : voir le 3e appel plus bas, et sources.js. `valeur` et pas
            // `liste` — cette source rend un objet ou null.
            const { valeur: local } = await interrogerSource('catalogue/local-nom-numero', () => identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: numeroCarte,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui décide s'il y a une
                // impression à router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            }));
            if (local) {
                identificationLocale = true;
                localIncertain = local.incertain;
                ecartScoreLocal = local.ecartScore;
                produitsImposes = local.produits;
                const nomGagnant = local.produits.find(p => p.idProduct === local.gagnant?.candidat?.idProduct);
                console.log(
                    `🗃️ [identifier] TCGdex muet -> IDENTIFICATION LOCALE : ${local.produits.length} candidat(s)` +
                    ` via ${local.voie} (${local.raison}), gagnant ${local.gagnant?.candidat?.idProduct}` +
                    ` code=${local.gagnant?.candidat?.codeSet} écart=${local.ecartScore}` +
                    ` motifARouter=${local.motifARouter} incertain=${local.incertain}`
                );
                // `trouvaille` synthétique : tout l'aval l'attend. Ses champs TCGdex sont
                // NULS, et c'est le fond du sujet — sans variantsDetailed on ne sait pas
                // router les motifs de reverse (jusqu'à x100 d'écart), d'où `ambigu: true`.
                trouvaille = {
                    id: null, localId: null, variants: null, variantsDetailed: null,
                    nomExact: nomGagnant ? String(nomGagnant.name).split('[')[0].trim() : cardInfo.name,
                    source: 'catalogue-local',
                    // `ambigu` suit le VERDICT du module, pas le simple fait d'être passé
                    // par le chemin local : sur une carte sans impression reverse (toutes
                    // les e-Series, mesuré sur 521 produits), n'avoir pas routé le motif ne
                    // coûte rien. Marquer douteux un prix juste use le drapeau pour rien.
                    ambigu: local.incertain,
                    // Identification 100 % locale : TCGdex n'a été d'aucun secours, aucune
                    // route n'a abouti. Voir la note de l'autre trouvaille synthétique.
                    langueRoute: null
                };
            }
            // ════════════════════════════════════════════════════════════════
            // ÉTAPE 3 — LE REPLI PAR NOM SEUL, SUR ABSENCE RÉELLE UNIQUEMENT
            // ════════════════════════════════════════════════════════════════
            // LE TROU QU'IL BOUCHE, ET SA TAILLE. Quand la règle du Pokédex tire,
            // `numeroCarte` vaut null — et les DEUX chemins de secours exigent un numéro :
            // `trouverParSetCodeEtNumero` rend [] d'entrée, et `identifierEnLocal` s'arrête
            // à sa première garde (voir identification-locale.js). Le scan ne peut alors
            // aboutir QUE si TCGdex répond. Mesuré sur le journal : 70 lignes sur 162
            // (43 %) déclenchent la règle et n'ont donc AUCUN repli si TCGdex cligne.
            // ⚠️ Ce n'est PAS justifié par les deux refus du 15 août : ceux-là étaient une
            // panne, et le repli ne doit surtout pas s'y appliquer. C'est un trou
            // STRUCTUREL, démontré par lecture du code, pas par ces deux lignes.
            //
            // TROIS BORNES, ET AUCUNE N'EST NÉGOCIABLE :
            //   1. ABSENCE RÉELLE. `!tcgdexEnPanne` : replier sur une panne échangerait un
            //      refus honnête contre une identification hasardeuse.
            //   2. AUCUN NUMÉRO EXPLOITABLE. C'est la seule situation où les autres chemins
            //      sont structurellement hors jeu. Avec un numéro, `identifierEnLocal` a
            //      déjà fait son travail et fait mieux — on ne la double pas.
            //   3. LE PÉRIMÈTRE VINTAGE, ET IL EST OBLIGATOIRE ICI. Sans numéro, un nom seul
            //      ramène jusqu'à 153 produits (« Charmander ») que rien ne départage —
            //      c'est très exactement la raison pour laquelle identifierEnLocal REFUSE
            //      de tourner sans numéro, et cette raison reste valable. Le périmètre est
            //      ce qui la lève : il ramène ces viviers à une poignée. S'il ne garde
            //      rien, on renonce et on refuse, comme avant.
            //
            // ⚠️ SORTIE EN SUGGESTION AVERTIE, JAMAIS UN VERDICT. `ambigu: true` en dur :
            // ce chemin n'a ni numéro, ni TCGdex, ni variantes — trois sources perdues.
            if (!identificationLocale && !tcgdexEnPanne && numeroCarte == null
                && LANGUES_ASIATIQUES.includes(String(cardInfo.language || '').toUpperCase())) {
                const { liste: parNomSeul } = await interrogerSource('catalogue/nom', () => trouverProduitsLocaux(cardInfo.name));
                const dedans = parNomSeul.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
                if (dedans.length) {
                    identificationLocale = true;
                    localIncertain = true;
                    produitsImposes = dedans;
                    voieImposee = 'nom-seul-vintage';
                    nomSeulVintage = true;
                    console.log(
                        `🗾 [nom-seul-vintage] TCGdex absent ET numéro neutralisé : "${cardInfo.name}"` +
                        ` -> ${parNomSeul.length} produit(s) au nom, ${dedans.length} dans les 24 sets japonais vintage.`
                    );
                    trouvaille = {
                        id: null, localId: null, variants: null, variantsDetailed: null,
                        nomExact: String(dedans[0].name).split('[')[0].trim(),
                        source: 'nom-seul-vintage', ambigu: true, langueRoute: null
                    };
                } else {
                    console.log(`🗾 [nom-seul-vintage] "${cardInfo.name}" : ${parNomSeul.length} produit(s) au nom, AUCUN dans la table close -> on ne replie pas.`);
                }
            }
            if (!trouvaille) {
                // Trois motifs DISTINCTS : sans numéro lisible, aucun chemin ne peut
                // aboutir, et ce n'est pas la même défaillance qu'une carte introuvable.
                // ⚠️ ET UNE PANNE N'EST NI L'UNE NI L'AUTRE : `tcgdex-injoignable` est un
                // ÉCHEC TECHNIQUE, donc rouge chez l'extension. Dire « carte introuvable »
                // quand le réseau a lâché, c'est affirmer une absence qu'on n'a pas
                // constatée — et c'est ce qui est arrivé le 2026-08-15 à 11:47.
                const motif = tcgdexEnPanne ? 'tcgdex-injoignable'
                    : cardInfo.numeroIllisible ? 'numero-illisible' : 'carte-introuvable';
                const rendu = await rembourserScan(req, motif);
                // ⚠️ ICI, `cardInfo.reverse` EST ENCORE LA LECTURE BRUTE : cette sortie est
                // en AMONT du validateur TCGdex, qui l'écrase plus bas. Les trois autres
                // sorties de refus, elles, sont en aval et doivent passer la capture.
                enregistrerEchec({
                    route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo,
                    motifEchec: motif, rembourse: rendu,
                    reverseLu: cardInfo.reverse === true, motifIA: cardInfo.motif, estDex: avisDex.estDex,
                    ...champsEtat(), ...champsCout()
                });
                return res.json({
                    success: false,
                    // ════════════════════════════════════════════════════════════
                    // TROIS CHAMPS, UN NOM EXACT CHACUN, AUCUNE DÉDUCTION
                    // ════════════════════════════════════════════════════════════
                    // La réponse de refus n'avait que `success: false` et un texte. Un REFUS
                    // DÉLIBÉRÉ — celui qui protège l'utilisateur d'un prix faux, et qui lui
                    // rend son crédit — y était indiscernable d'une PANNE. L'extension
                    // affichait donc « Analyse impossible » en rouge sur 15 % des scans,
                    // c'est-à-dire au moment précis où l'outil rend son plus grand service.
                    // Apprendre à son utilisateur à se méfier de la seule mécanique qui le
                    // protège est le pire échange possible.
                    // `rembourse` · `motifRefus` · `natureRefus` : voir NATURE_REFUS, juste
                    // au-dessus de cette route, pour l'énumération fermée et le sens du défaut.
                    ...champsDeRefus(motif, rendu),
                    // ⚠️ LE TEXTE SUIT LE MOTIF. « Introuvable » est une AFFIRMATION sur le
                    // monde ; on ne la prononce que si on a effectivement cherché et rien
                    // trouvé. Sur panne, on dit ce qu'on sait — le service ne répond pas —
                    // et on invite à réessayer, ce qui est la bonne action de l'utilisateur.
                    //
                    // ⚠️ CETTE PHRASE NE PARLE PLUS D'ARGENT — 2026-09-01.
                    // Elle disait « votre crédit est rendu », affirmation d'office alors que
                    // `rembourserScan` est TENTÉ ligne 3474 et peut échouer (plafond du jour).
                    // Le résultat vrai est dans `rendu` et part via `champsDeRefus`.
                    // 🔑 MÊME RÈGLE QU'À `egalite-parfaite` ET `nom-contredit-*` : UNE SEULE
                    // PHRASE PARLE D'ARGENT, celle de l'extension, qui lit `rembourse` et
                    // `raisonNonRembourse`. Le serveur dit POURQUOI il refuse, pas ce qu'il
                    // advient du crédit.
                    // 🔴 CINQUIÈME EXEMPLAIRE DU MÊME DÉFAUT, ET LE SEUL QU'UN grep
                    // « rembours » NE TROUVE PAS : il dit « crédit rendu ». Voir l'erreur
                    // d'instrument #17 dans scoring.js — un défaut qui se cherche par son
                    // vocabulaire ne se trouve jamais en entier.
                    error: tcgdexEnPanne
                        ? `Le service de référence (TCGdex) n'a pas répondu, même après un nouvel essai. La carte n'a pas pu être cherchée — réessayez dans un instant.`
                        : cardInfo.numeroIllisible
                            ? `Numéro de collection illisible sur la photo — impossible d'identifier "${cardInfo.name}" de façon fiable`
                            : `Carte "${cardInfo.name}" #${cardInfo.number} introuvable, ni sur TCGdex ni dans le catalogue local`,
                    cardInfo
                });
            }
        }

        // Garde-fou : le numéro de la carte trouvée contredit-il celui lu sur la photo ?
        // ⚠️ On N'INVENTE PLUS DE CAUSE. L'ancienne version concluait « set trop récent
        // pour TCGdex » et repartait chercher dans le catalogue avec le NOM LU PAR L'IA
        // — le pire repli possible, puisque c'est précisément le nom qui est en cause
        // quand il est halluciné. Diagnostic faux au passage : le cas réel qui a déclenché
        // ce correctif portait sur Team Up, un set de 2019.
        // On se contente donc de CONSTATER le désaccord, et on bascule sur le chemin
        // numéro + total, qui ne dépend d'aucun nom.
        const numLuIA = String(numeroCarte || '').replace(/^0+/, '').toLowerCase();
        const numTCG = String(trouvaille.localId || '').replace(/^0+/, '').toLowerCase();
        const numeroContredit = Boolean(numLuIA && numTCG && numLuIA !== numTCG);

        // ════════════════════════════════════════════════════════════════════
        // ARBITRAGE DU NOM par le catalogue local
        // ════════════════════════════════════════════════════════════════════
        // Quand TCGdex trouve la carte SANS le nom (source 'total+numero'), il conclut que
        // « le NOM lu est suspect ». C'est une inférence, et elle est fausse dès que TCGdex
        // n'a simplement pas le set. Trace réelle : une carte japonaise Flareon 017/088
        // (EC4 « Split Earth », 239,94 €). Le total 088 est IMPRIMÉ sur la carte et il est
        // juste, mais le seul set de 88 cartes que connaisse TCGdex est « Perfect Order »
        // (2025) — donc aucun Flareon n'y figure, le nom a été déclaré suspect, et le
        // repli par total a rendu... « Turtonator », à 0,02 €. Que le serveur a APPRIS.
        //
        // Le catalogue local est un arbitre INDÉPENDANT : contient-il une carte de ce nom
        // à ce numéro ? Vérifié sur les cinq cas réels —
        //   Flareon 017 -> OUI (EC4, 239,94 €)      le nom est corroboré, TCGdex a tort
        //   Pyroli 017  -> OUI, via nomFr           même carte, nom français
        //   Nix 180     -> OUI, via nomFr           « Nix » EST le nom français de Nita
        //   Vesper 175  -> OUI, via nomFr           idem pour Evelyn
        //   Kahili 173  -> NON                      là c'est une vraie hallucination
        //                                           (Dana s'appelle « Méridia » en français)
        // Le même test distingue donc une lecture juste d'une hallucination, sans dépendre
        // de la couverture de TCGdex. Et il corrige au passage deux cas que je prenais pour
        // des hallucinations : nos noms de catalogue sont anglais, la lecture était bonne.
        // `!produitsImposes` : quand setCode+numéro a tranché, il n'y a plus rien à
        // arbitrer — le produit est déjà désigné par une clé, et le nom a déjà eu son
        // droit de veto dessus. Relancer l'arbitre ici ne pourrait que le contredire.
        if (trouvaille.source === 'total+numero' && !identificationLocale && !produitsImposes) {
            // Enveloppée : voir sources.js. `valeur` et pas `liste`.
            const { valeur: arbitre } = await interrogerSource('catalogue/local-nom-numero', () => identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: numeroCarte,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui décide s'il y a une
                // impression à router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            }));
            if (arbitre) {
                const gagnantArbitre = arbitre.produits.find(p => p.idProduct === arbitre.gagnant?.candidat?.idProduct);
                console.log(
                    `⚖️ [nom-corrobore] le catalogue local CONFIRME "${cardInfo.name}" au n°${cardInfo.number}` +
                    ` -> ${arbitre.gagnant?.candidat?.idProduct} code=${arbitre.gagnant?.candidat?.codeSet}` +
                    ` prix=${arbitre.gagnant?.candidat?.prix}. TCGdex proposait "${trouvaille.nomExact}"` +
                    ` (${trouvaille.id}) : sa suggestion est ÉCARTÉE.`
                );
                identificationLocale = true;
                localIncertain = arbitre.incertain;
                ecartScoreLocal = arbitre.ecartScore;
                produitsImposes = arbitre.produits;
                trouvaille = {
                    id: null, localId: null, variants: null, variantsDetailed: null,
                    nomExact: gagnantArbitre ? String(gagnantArbitre.name).split('[')[0].trim() : cardInfo.name,
                    source: 'catalogue-local', ambigu: arbitre.incertain
                };
            } else {
                console.log(`⚖️ [nom-non-corrobore] aucun "${cardInfo.name}" au n°${cardInfo.number} dans le catalogue local -> le nom est bien suspect, on garde le chemin total+numéro.`);
            }
        }

        const nomPourCatalogue = trouvaille.nomExact;
        // Le nom n'est PAS digne de confiance si TCGdex a été trouvé sans lui, si le
        // numéro de la carte retenue contredit celui, parfaitement lisible, de la photo,
        // ou si l'IA ELLE-MÊME annonce une confiance basse sur le nom.
        //
        // ⚠️ Ce troisième cas est le seul qui ne dépende PAS de l'accord de TCGdex. Les
        // deux premiers exigent que TCGdex ait vu quelque chose de contradictoire : ils
        // tombent dès qu'il est d'accord avec une mauvaise lecture. Le cas réel qui l'a
        // motivé : l'IA a lu « Gengar » sur un Machoc japonais — un nom qui existe, dans
        // d'autres sets, et que rien en aval ne pouvait mettre en doute.
        const nomPeuFiable = cardInfo.nomConfiance === 'basse';
        const nomSuspect = trouvaille.source === 'total+numero' || numeroContredit || nomPeuFiable;
        if (nomPeuFiable) {
            console.warn(`⚠️ [identifier] l'IA annonce une confiance BASSE sur le nom -> le nom ne servira pas à choisir les candidats.`);
        }
        if (numeroContredit) {
            console.warn(`⚠️ [identifier] désaccord de numéro : TCGdex donne ${numTCG}, l'IA a lu ${numLuIA}.`);
            console.warn(`   -> on ne se fie plus au NOM ; identification par numéro + total.`);
        }

        // Validateur de reverse (TCGdex) : on ne garde "reverse=true" que si cette
        // carte possède RÉELLEMENT une impression reverse. Neutralise les faux
        // positifs (une holo normale lue à tort comme reverse par l'IA). On ne
        // l'applique PAS si TCGdex s'est trompé de carte (variants d'une autre carte).
        // ⚠️ LA LECTURE BRUTE EST CAPTURÉE AVANT LE VALIDATEUR, ET C'EST INDISPENSABLE.
        // Le bloc ci-dessous ÉCRASE `cardInfo.reverse` quand TCGdex dit qu'aucune reverse
        // n'existe. Journaliser `cardInfo.reverse` plus bas — au moment de l'écriture, à
        // 800 lignes d'ici — enregistrerait donc la valeur d'APRÈS validation en croyant
        // enregistrer ce que l'IA a lu. Le champ aurait menti sans jamais se contredire.
        const reverseLu = cardInfo.reverse === true;
        // Et l'annulation elle-même devient observable : c'est le « choix silencieux »
        // qu'on reproche à ce validateur, et on ne pouvait pas le compter.
        let reverseAnnuleeParTcgdex = false;
        if (cardInfo.reverse === true && !numeroContredit && trouvaille.variants) {
            if (trouvaille.variants.reverse === false) {
                console.log(`↩️ TCGdex : pas de reverse connue pour cette carte -> on ignore le "reverse" lu par l'IA.`);
                cardInfo.reverse = false;
                reverseAnnuleeParTcgdex = true;
            } else if (trouvaille.variants.reverse === true) {
                console.log(`✅ TCGdex confirme qu'une reverse existe pour cette carte.`);
            }
        }

        // Le set TCGdex nous dit dans quelle(s) expansion(s) Cardmarket chercher. Calculé
        // AVANT les produits : quand le nom est suspect, c'est l'expansion + le numéro
        // qui désignent la carte, et le nom ne sert plus du tout.
        const { liste: expansionsAttendues } = await interrogerSource('tcgdex/expansions',
            () => expansionsDuSetTCGdex(trouvaille.id, regionAttendue(cardInfo), cardInfo.setCode));

        // 3. Candidats Cardmarket. Par le NOM tant qu'il est fiable ; sinon par le
        //    NUMÉRO dans l'expansion identifiée, ce qui contourne complètement un nom
        //    halluciné (Dana lue "Kahili") ou inapparieable ("_____'s Pikachu").
        // ════════════════════════════════════════════════════════════════════
        // L'UNION DES DEUX NOMS — le vivier ne peut plus perdre la carte à l'entrée
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI DEUX NOMS. `nomPourCatalogue` vient de TCGdex : c'est un PONT DE LANGUE,
        // parce que le catalogue Cardmarket est en anglais et que la lecture ne l'est pas
        // toujours (voir nomPourLeCatalogue). Mais quand TCGdex se trompe de carte, ce pont
        // mène ailleurs — et le nom LU, lui, était bon. Mesuré : « Dark Ursaring » lu juste,
        // TCGdex rend `neo4-097` = « Dark Porygon2 », et le vivier ne contient alors AUCUN
        // Ursaring. Aucun classement ne peut rattraper une carte absente du vivier.
        //
        // CHERCHER AVEC LES DEUX ET UNIR : le vivier ne peut que grossir, donc la bonne
        // carte ne peut plus être perdue à l'entrée.
        //
        // ⚠️ CE QUE ÇA COÛTE, MESURÉ AVANT D'ÊTRE ÉCRIT (mesure-vivier-union.js, 38 lignes
        // où cette construction s'applique réellement) :
        //   candidats ajoutés : UNE seule ligne sur 38 en gagne, maximum +1, médiane 0
        //   verdicts : juste->juste 29 · faux->faux 7 · refus->refus 1 · faux->refus 1
        //   ZÉRO ligne juste ne bascule. ZÉRO ligne ne devient juste.
        // Le seul mouvement est « Dark Ursaring » : un prix FAUX devient un REFUS, parce
        // que l'union amène bien la bonne carte mais que rien ne la sépare de l'autre.
        // C'est un gain au sens du principe « un prix faux facturé coûte plus cher qu'un
        // scan remboursé », et ce n'est PAS une identification retrouvée.
        //
        // ⚠️ CE QUE ÇA NE RÉSOUT PAS. Le départage de deux candidats que le scoring note à
        // égalité reste entier — c'est le prochain chantier, pas celui-ci.
        //
        // `nomSuspect` garde son veto sur les DEUX noms : quand le nom est halluciné ou
        // inapparieable, l'unir à un autre nom ne le rendrait pas fiable.
        let produits = produitsImposes ?? (nomSuspect ? [] : await viviersUnis(nomPourCatalogue, cardInfo.name));
        let voieCatalogue = voieImposee ?? (identificationLocale ? 'local-nom-numero' : 'nom');
        let aucunCandidatAuNumero = false;
        if (produits.length === 0 && expansionsAttendues.length) {
            const { liste: parNumero } = await interrogerSource('catalogue/numero-expansion',
                () => trouverProduitsParNumero(expansionsAttendues, numeroCarte));
            if (parNumero.length) { produits = parNumero; voieCatalogue = 'numero'; }
        }
        // 2e usage du chemin local : le nom est suspect ET l'expansion attendue n'a rien
        // donné. C'est le cas Rhydon/Ledian — TCGdex trouve la carte ailleurs, déclare le
        // nom suspect, et le pont total -> set désigne un set de 2025. Sans ce repli il ne
        // reste RIEN, alors que le catalogue contient la bonne carte au bon numéro.
        if (produits.length === 0 && !identificationLocale) {
            // ⚠️ ENVELOPPÉE COMME LES AUTRES, ET C'EST LA 7e CELLULE DU VERROU QUI L'A
            // TROUVÉE. Elle interroge `catalogue_produits` (identification-locale.js) sans
            // aucun filet : au premier passage de la cellule, une panne du catalogue est
            // sortie ici en EXCEPTION, la route a fini dans son catch, et l'utilisateur a
            // lu « Erreur serveur interne » là où un refus propre était possible.
            // ⚠️ `valeur` ET PAS `liste` : cette source-là rend un OBJET ou null, pas un
            // tableau. Voir sources.js, qui rend les deux pour cette raison exacte.
            const { valeur: local } = await interrogerSource('catalogue/local-nom-numero', () => identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: numeroCarte,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui décide s'il y a une
                // impression à router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            }));
            if (local) {
                identificationLocale = true;
                localIncertain = local.incertain;
                ecartScoreLocal = local.ecartScore;
                produits = local.produits;
                voieCatalogue = 'local-nom-numero';
                console.log(`🗃️ [identifier] ni le nom ni l'expansion attendue -> IDENTIFICATION LOCALE : ${produits.length} candidat(s), gagnant ${local.gagnant?.candidat?.idProduct} code=${local.gagnant?.candidat?.codeSet} motifARouter=${local.motifARouter} incertain=${local.incertain}`);
            }
        }
        if (produits.length > 0 && !identificationLocale && !produitsImposes) {
            // `!produitsImposes` : viviersAvecRangs REMPLACE un vivier par nom qui ne peut
            // pas contenir la bonne carte. Un produit désigné par (code + numéro) n'est pas
            // un vivier par nom — il porte déjà le numéro lu, par construction. Le laisser
            // passer ici reviendrait à défaire la décision qu'on vient de prendre.
            //
            // Le vivier par nom est plein : reste à savoir s'il PEUT contenir la bonne
            // carte. Voir viviersAvecRangs pour la règle et le cas Kahili.
            const choix = await viviersAvecRangs(produits, numeroCarte, expansionsAttendues, `[identifier] "${nomPourCatalogue}"`);
            produits = choix.produits;
            voieCatalogue = choix.voie;
            aucunCandidatAuNumero = choix.aucunCandidatAuNumero;
        }
        // ⚓ JALON DU VERROU (« vivier ») — voir verrou/jalons.js. C'est lui qui prouve que
        // la sortie « carte introuvable » a été passée : sans ce jalon, deux charges qui
        // ressortaient trois lignes plus haut ont affiché huit ✅ sans rien vérifier.
        console.log(`🗂️ [identifier] ${produits.length} candidat(s) via ${voieCatalogue === 'nom' ? `le nom "${nomPourCatalogue}"` : `le NUMÉRO ${cardInfo.number}`}.`);

        // ════════════════════════════════════════════════════════════════════
        // PÉRIMÈTRE FERMÉ DES SETS JAPONAIS VINTAGE
        // ════════════════════════════════════════════════════════════════════
        // QUAND. Carte asiatique ET aucun numéro de carte exploitable — soit qu'il n'y en
        // ait pas, soit que la règle du Pokédex l'ait neutralisé. C'est exactement la
        // famille qui échouait : les cinq échecs journalisés ont TOUS `total = —`, et les
        // cartes qui tombent sont précisément celles qui n'impriment pas de total.
        //
        // POURQUOI ÇA MARCHE. Sans numéro, le nom seul ramène des dizaines de candidats
        // répartis sur autant de sets — mesuré : « Raichu » 114 produits sur 24 expansions,
        // « Tangela » 60 sur 19. Le périmètre les ramène à 9 et 3. Il ne devine rien : il
        // retire les sets où la carte NE PEUT PAS être, parce qu'ils sont postérieurs ou
        // occidentaux.
        //
        // ⚠️ SORTIE EN SUGGESTION AVERTIE, JAMAIS UN VERDICT. Le périmètre restreint sans
        // prouver : il dit où chercher, pas laquelle c'est. Tant que le banc n'a pas montré
        // zéro faux-et-affirmé sur ces lignes, le prix part avec réserve.
        //
        // ⚠️ IL NE PEUT QUE RESTREINDRE. Si le périmètre ne garde rien, on conserve le
        // vivier d'origine : la table couvre 24 expansions et 1 835 produits, pas tout le
        // vintage. Mieux vaut un vivier large et signalé qu'un refus dû à une table
        // incomplète.
        //
        // DEUX PORTES D'ENTRÉE, et la seconde a été mesurée avant d'être écrite :
        //   a) aucun numéro exploitable — la famille d'origine ;
        //   b) un numéro, mais AUCUNE EXPANSION ATTENDUE. C'est le cas du Rhydon : le pont
        //      total -> set désigne « E4 », et « E4 » ne correspond à aucune expansion
        //      Cardmarket (69 identifiants TCGdex sont partagés, le vintage japonais est
        //      faux par construction). La chaîne se rabat alors sur tout le catalogue et
        //      rend un set de 2025. Mesuré : 32 scans concernés, 7 lignes deviennent
        //      justes, 5 justes basculaient — d'où la garde ci-dessous, qui ramène les
        //      risques à zéro sans perdre un seul gain.
        let perimetreVintage = false;
        // Les codes RÉELS du catalogue : ils permettent de distinguer une contradiction
        // (« CLK », un vrai set moderne) d'un bruit d'OCR (un code qui ne résout vers rien).
        // Quatrième principe — sans cette liste, le bruit ferait preuve.
        const codesReels = [...(await lireTousLesCodesSet())];
        // ⚠️ LE MODULE ENTIER, jamais un objet fabriqué ici. Voir le require en tête de
        // fichier : la version « { normaliserCodeSet, ALIAS_CODES_LUS, codesApparentes } »
        // a tué la production, parce que la fonction en déstructure QUATRE.
        const compat = setCodeCompatibleVintage(cardInfo.setCode, SCORING, codesReels);

        // ── DIAGNOSTIC DU setCode LU — journalisé, AUCUN effet sur le scoring ────────
        // Deux questions, un seul champ :
        //   1. l'IA met-elle autre chose qu'un code dans ce champ ? Un « PROMO » ou un
        //      « HOLO » n'est pas un code de set : c'est une catégorie ou une rareté, et
        //      elle ne discrimine rien (il existe des promos vintage comme modernes). On
        //      ne la traite pas — on la COMPTE. Si la classe grossit, on décidera sur des
        //      chiffres plutôt que sur un cas.
        //   2. quand une PARENTÉ est retenue, laquelle ? Toute la chaîne repose désormais
        //      dessus (MCD~MCDP, e1~EC1, DP5~DP5c) et c'est un rapprochement approximatif
        //      au cœur d'un système dont on a passé la semaine à retirer les approximations.
        //      Le journaliser rend une dérive future VISIBLE au lieu d'être découverte par
        //      un prix faux.
        let setCodeResolution = null, parenteJournal = null;
        if (cardInfo.setCode) {
            const MOTS_CATEGORIE = new Set(['promo', 'holo', 'reverse', 'rare', 'commune', 'common', 'uncommon',
                'normale', 'normal', 'ir', 'sr', 'sir', 'ar', 'ur', 'secret', 'fullart', 'full art']);
            const brutLu = normaliserCodeSet(cardInfo.setCode);
            const codeLu = ALIAS_CODES_LUS.get(brutLu) || brutLu;
            if (MOTS_CATEGORIE.has(String(cardInfo.setCode).trim().toLowerCase())) {
                setCodeResolution = 'mot-non-code';
                console.log(`📊 [setcode-diagnostic] « ${cardInfo.setCode} » n'est pas un code de set mais une catégorie/rareté — compté, sans effet.`);
            } else if (codesReels.includes(codeLu)) {
                setCodeResolution = 'exact';
            } else {
                // DEUX MÉCANISMES DISTINCTS, DEUX VALEURS DISTINCTES. La convention du X est
                // un décodage exact ; la parenté est une ressemblance de préfixe. Les
                // confondre dans le journal reviendrait à ne pas pouvoir dire, dans six
                // mois, lequel des deux a produit un rapprochement douteux.
                const parConvention = codesReels.filter(c => memeCodeParConventionX(codeLu, c));
                const cousins = codesReels.filter(c => codesApparentes(codeLu, c));
                if (parConvention.length) {
                    setCodeResolution = 'convention-x';
                    parenteJournal = `${codeLu}=${parConvention.slice(0, 5).join('/')}`;
                    console.log(`📊 [setcode-diagnostic] convention X (décodage exact) : ${parenteJournal}`);
                } else if (cousins.length) {
                    setCodeResolution = 'parente';
                    parenteJournal = `${codeLu}~${cousins.slice(0, 5).join('/')}`;
                    console.log(`📊 [setcode-diagnostic] parenté retenue (préfixe, approximatif) : ${parenteJournal}`);
                } else {
                    setCodeResolution = 'inconnu';
                }
            }
        }
        const sansPerimetreTCGdex = numeroCarte != null && expansionsAttendues.length === 0;
        if ((numeroCarte == null || sansPerimetreTCGdex)
            && compat.compatible
            && LANGUES_ASIATIQUES.includes(String(cardInfo.language || '').toUpperCase())
            && produits.length > 1) {
            const dedans = produits.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
            if (dedans.length) {
                console.log(`🗾 [perimetre-vintage] ${numeroCarte == null ? "sans numéro exploitable" : "aucune expansion attendue, " + compat.raison} : ${produits.length} candidat(s) -> ${dedans.length} dans les 24 sets japonais vintage.`);
                produits = dedans;
                voieCatalogue = 'perimetre-vintage';
                perimetreVintage = true;
            } else {
                console.log(`🗾 [perimetre-vintage] aucun des ${produits.length} candidats n'est dans la table close -> vivier inchangé.`);
            }
        }

        // Codes set de TOUS les candidats en un seul aller-retour Mongo, injecté dans le
        // scoring pour lui éviter de refaire la même lecture candidat par candidat.
        const codeSetsConnus = await lireCodeSets(produits.map(p => p.idExpansion));

        // 4. Scoring : on renvoie le CLASSEMENT, l'extension testera dans l'ordre
        let classement = [];
        // Stratégie reverse du GAGNANT + état de résolution du motif (champs additifs).
        let strategieReverse = null;
        let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
        // La MARGE du classement : le gagnant devance-t-il le 2e d'au moins 30 points ?
        // Elle part telle quelle vers l'extension sous `carte.margeConfortable` — sans être
        // mélangée à `ambigu`, contrairement à l'ancien `confianceIdentification`.
        // À ne pas confondre avec la confiance de l'ÉTAT lue par l'IA (NM/EX/GD).
        let identificationConfiante = true;
        // Bilan des rangs du vivier retenu. Rempli par le scoring quand il y a plusieurs
        // candidats ; calculé à la main pour le cas du candidat unique, qui ne passe pas
        // par scorerCandidatsLocal mais mérite le même diagnostic.
        let rangsScoring = null;
        const optionsMotif = { variantsDetailed: trouvaille.variantsDetailed, titre: title, tcgdexId: trouvaille.id };

        if (produits.length === 1) {
            // Un seul produit pour ce nom : rien à départager, mais la table dit quand
            // même COMMENT lire sa reverse (produit partagé ou non).
            const analyse = analyserVariantes(trouvaille.variantsDetailed);
            motifResolution = resoudreMotif(analyse, cardInfo.motif, title);
            strategieReverse = analyse.strategieParIdProduct.get(produits[0].idProduct) ?? null;
            classement = [{
                idProduct: produits[0].idProduct, idExpansion: produits[0].idExpansion,
                score: 999, strategie: strategieReverse
            }];
            if (motifResolution.etat === 'non-resolu') loggerReplieMotif(motifResolution, cardInfo, analyse, trouvaille.id, title);
            // Un seul candidat : son numéro est-il celui qu'on a lu ? Le vivier a déjà
            // été choisi par viviersAvecRangs, mais le rang du gagnant reste à qualifier.
            const infoSolo = (await lireNumeros([produits[0].idProduct])).get(produits[0].idProduct);
            rangsScoring = bilanDesRangs(
                [{ numeroCardmarket: infoSolo ? (infoSolo.numero || infoSolo.numeroUrl) : null }],
                numeroCarte,
                { numeroCardmarket: infoSolo ? (infoSolo.numero || infoSolo.numeroUrl) : null }
            );
        } else if (produits.length > 1) {
            // ⚠️ `cardInfoEffectif`, PAS `cardInfo` : voir le bloc du numéro de Pokédex.
            // C'est ce paramètre qui portait la divergence — les rangs et le contrôle de
            // région lisaient le numéro BRUT pendant que toute la route utilisait le
            // neutralisé.
            // ⚠️ `numeroBrutPourScoring` EST LE LOT B, RETENU. Il rend au seul critère de
            // scoring le numéro brut, c'est-à-dire le comportement d'aujourd'hui, le temps
            // de mesurer ce que sa neutralisation change sur les 56 lignes concernées.
            // Le supprimer ici et à l'appel du veto EST le lot B, en entier.
            const { scores, confiant, strategieReverse: strat, motif, rangs } = await scorerCandidatsLocal(
                produits, cardInfoEffectif, photos[0], expansionsAttendues, codeSetsConnus,
                { ...optionsMotif, numeroBrutPourScoring: cardInfo.number }
            );
            strategieReverse = strat;
            motifResolution = motif;
            identificationConfiante = confiant;
            rangsScoring = rangs;
            classement = scores.map(s => ({
                idProduct: s.candidat.idProduct,
                idExpansion: s.candidat.idExpansion,
                score: s.score,
                // Prix guide du candidat, sur le MÊME axe que celui qui sera affiché.
                // Sert à arbitrer les égalités : voir la règle de l'écart de prix.
                prix: Number.isFinite(s.candidat.prix) ? s.candidat.prix : null,
                // Stratégie PAR CANDIDAT : sur une même carte les deux mécanismes
                // coexistent (produit de base partagé + motifs en produits distincts),
                // donc une stratégie globale serait fausse pour une partie du classement.
                strategie: s.strategie,
                detail: s.detail
            }));
            console.log(`🧮 [identifier] meilleur = ${classement[0]?.idProduct} (score ${classement[0]?.score}), confiance ${confiant ? 'HAUTE' : 'BASSE'}`);
        }

        // ⚓ JALON DU VERROU (« perimetre-vintage ») — LE PLUS IMPORTANT DES CINQ.
        // Il est écrit APRÈS l'appel à setCodeCompatibleVintage et AVANT la sortie « aucun
        // produit Cardmarket » : l'atteindre PROUVE que la ligne qui a tué la production le
        // 4 août (« memeCodeParConventionX is not a function ») a bien été exécutée.
        // Ne pas reformuler, ne pas déplacer au-dessus de cet appel — voir verrou/jalons.js.
        msCatalogue = Date.now() - debutCatalogue;
        console.log(`⏱️ [identifier] catalogue+scoring : ${msCatalogue} ms`);

        // ════════════════════════════════════════════════════════════════════
        // LE VIVIER, SUR TOUTE LIGNE DE REFUS — UN SEUL POINT DE CONSTRUCTION
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI CE POINT EXISTE. `vivierIds` manquait sur 32 refus sur 35 (mesuré le
        // 2026-09-02), et sans lui LA question du chantier n'a pas de réponse :
        //     la bonne carte était-elle dans le vivier ?
        // Elle sépare deux chantiers qui n'ont rien à voir — un défaut de VIVIER, qu'aucun
        // départage ne rattrapera jamais, et un défaut de DÉPARTAGE, où un signal de plus
        // peut sauver la ligne. Sur 76 lignes portant une vérité individuelle, UNE SEULE
        // portait aussi `vivierIds` : la question était indécidable, quel que soit le
        // nombre de vérités saisies ensuite. Ce n'est donc pas un levier de plus, c'est le
        // PRÉALABLE aux deux autres.
        //
        // 🔑 POURQUOI UNE FONCTION ET NON UN OBJET FIGÉ ICI. Un instantané pris à cette
        // ligne serait lu jusqu'à 300 lignes plus bas, et `produits` est RÉASSIGNÉ entre
        // les deux (veto-nom, ligne ~4019). Il rendrait alors le vivier d'AVANT le
        // re-classement en prétendant décrire celui du refus — c'est-à-dire l'erreur
        // d'instrument #7, LE CHAMP LU TROP TÔT, réintroduite par le correctif censé
        // fermer un trou de journalisation. La fonction lit `produits` AU MOMENT du refus,
        // et c'est le seul moment qui décrit la décision.
        //
        // ⚠️ CE QU'IL ATTRAPE : tout refus en aval du scoring porte désormais le vivier
        // que le scoring a réellement vu, y compris VIDE — et « vide constaté » n'est pas
        // « inconnu », c'est exactement la distinction qui manquait.
        // ⚠️ CE QU'IL N'ATTRAPE PAS, et il faut le savoir avant de s'y fier :
        //   · les refus EN AMONT du catalogue — `ia-echec`, `tcgdex-injoignable`,
        //     `carte-introuvable`, `numero-illisible` — n'ont pas de vivier du tout. Leur
        //     `null` reste un null honnête : aucun vivier n'a été constitué. Ne pas le
        //     lire comme « vivier vide ».
        //   · `erreur-serveur` (le catch) : `produits` peut ne pas exister selon l'endroit
        //     où l'exception est tombée. Le catch ne l'appelle donc pas.
        //   · il ne dit RIEN de la justesse : savoir que la vérité était dans le vivier
        //     demande une vérité saisie, et le banc en a 70 pour 181 lignes.
        //   · les 32 lignes déjà écrites sans le champ ne seront jamais réparées — un
        //     journal ne se réécrit pas. La mesure part de zéro à partir d'ici.
        const champsVivier = () => ({
            vivierIds: produits.map(p => p.idProduct),
            vivierTaille: produits.length,
            nbCandidats: produits.length
        });

        // Échec DUR : aucun candidat à tester, l'extension n'a rien à lire -> on rend
        // le scan. (Un classement même incertain, lui, EST un résultat livré.)
        if (classement.length === 0) {
            const rendu = await rembourserScan(req, 'aucun-candidat');
            // `reverseLu` est la CAPTURE, pas `cardInfo.reverse` : on est en aval du validateur.
            enregistrerEchec({
                route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo,
                motifEchec: 'aucun-candidat', rembourse: rendu,
                reverseLu, motifIA: cardInfo.motif, estDex: avisDex.estDex,
                // L'état est connu dès la lecture IA : un refus n'empêche pas de savoir ce
                // que le vendeur a déclaré ni ce que l'IA a vu de l'usure.
                ...champsEtat(), ...champsCout(),
                // ⚠️ ICI LE VIVIER EST SOUVENT VIDE, ET C'EST PRÉCISÉMENT L'INFORMATION.
                // `aucun-candidat` peut vouloir dire deux choses très différentes : aucun
                // produit trouvé au catalogue, ou des produits trouvés dont aucun n'a
                // survécu au scoring. Le premier est un défaut de collecte, le second un
                // défaut de scoring. Sans ce champ les deux étaient confondus.
                ...champsVivier()
            });
            // ⚠️ Les trois champs de refus — voir NATURE_REFUS, au-dessus de la route.
            return res.json({ success: false, ...champsDeRefus('aucun-candidat', rendu), error: `Aucun produit Cardmarket pour "${nomPourCatalogue}"`, cardInfo });
        }

        // ════════════════════════════════════════════════════════════════════
        // VETO PAR LE NOM SUR LE GAGNANT, PUIS RE-CLASSEMENT
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI ICI, ET PAS SEULEMENT SUR LE CHEMIN PAR LE CODE. Mesuré sur les 49
        // premiers scans journalisés : cinq verdicts portaient un nom qui ne pouvait pas
        // être celui de la carte — Flareon rendu « Turtonator » (0,02 € au lieu de
        // 239,94 €), Light Jolteon rendu « Lightning Energy », Dark Haunter rendu
        // « Darkness Energy », Misty's Staryu rendu « Team Rocket's Archer ». TROIS sont
        // partis avec confiance=haute, sans le moindre avertissement, et QUATRE au rang 1 :
        // le numéro correspondait. Ni les rangs, ni l'écart de score, ni la région ne
        // peuvent voir cette classe — seul le nom la voit.
        //
        // ON NE SE CONTENTE PAS DE REFUSER. La condition de preuve du veto DÉSIGNE déjà des
        // produits : ceux qui portent le nom lu AU numéro lu. Ce sont de meilleurs candidats
        // que celui qu'on écarte, par construction. Ils deviennent donc le vivier, et le
        // scoring habituel les départage — région, code de set, prix, tout ce qui existe.
        // Le veto n'est pas un garde-fou de plus : c'est un correctif.
        //
        // ON NE REFUSE QU'EN DERNIER RECOURS : vivier de preuve vide, ou égalité au sommet
        // (rien ne départage). Un prix faux facturé coûte plus cher qu'un scan remboursé.
        // TROISIÈME ÉTAT : le nom lu et le numéro lu s'excluent l'un l'autre. Aucun veto —
        // on ne sait pas laquelle des deux lectures accuser — mais aucun verdict non plus.
        let nomNumeroIncoherents = false;
        // Égalité au sommet dont l'écart de prix est trop faible pour changer le verdict :
        // le prix part, mais avec réserve. Voir la règle de l'écart de prix plus bas.
        let egaliteSansEnjeu = false;
        // ⚠️ LE GROUPE D'ÉGALITÉ, HISSÉ HORS DU BLOC QUI LE CALCULE. Il vivait dans le
        // `if` de l'égalité et mourait avec lui ; le journal ne recevait que son NOMBRE.
        // Sans les identifiants, la clôture d'un index sur ce groupe ne se mesure pas —
        // et la seule autre source, le rejeu hors ligne, diverge de la production sur
        // 24,8 % des gagnants. Voir la note de `exAequoIds` dans journal-scans.js.
        let exAequoIds = null;
        // Le départage par le symbole a-t-il tranché une égalité parfaite ? Drapeau DISTINCT
        // de `perimetreVintage` : les deux forcent la réserve, mais pour des raisons
        // différentes, et c'est cette différence qu'on veut pouvoir compter.
        let departageParSymbole = false;
        let symboleDepartageRaison = null;
        // Le départage par l'attaque — son drapeau et sa phrase, SÉPARÉS de ceux du symbole.
        // Réutiliser `departageParSymbole` rendrait les deux mécanismes indiscernables au
        // journal : deux causes sous un seul nom, c'est une mesure qu'on ne peut plus faire.
        // (La même faute a déjà été corrigée entre le symbole et `perimetreVintage`.)
        let departageParAttaqueFait = false;
        let attaqueDepartageRaison = null;
        // Le `name` et la métacarte de chaque candidat, pris dans les documents catalogue
        // qu'on a DÉJÀ en main : aucun aller-retour Mongo de plus. `idMetacard` est présent
        // sur 100 % du catalogue (mesuré), `name` porte les attaques entre crochets.
        const nomsCatalogue = new Map(produits.map(p => [Number(p.idProduct), p.name]));
        const metacartes = new Map(produits.map(p => [Number(p.idProduct), p.idMetacard]));
        {
            const gagnantProduit = produits.find(p => p.idProduct === classement[0].idProduct);
            // `numeroCarte` et non `cardInfo.number` : la preuve du veto ET le troisième
            // état reposent sur « ce nom, À CE NUMÉRO ». Avec un numéro de Pokédex, les
            // deux tests portent sur un numéro qui n'existe dans aucun catalogue — c'est
            // précisément ce qui faisait sortir Light Jolteon, Dark Haunter et Misty's
            // Staryu en « incohérents » alors que la seule incohérence était la nôtre.
            const avis = gagnantProduit ? await nomOpposeUnVeto({ ...cardInfo, number: numeroCarte }, gagnantProduit) : { veto: false };
            if (avis.incoherent) {
                nomNumeroIncoherents = true;
                console.warn(`⚠️ [nom-numero-incoherents] ${avis.raison} -> le prix est livré SANS verdict.`);
            }
            if (avis.veto) {
                console.warn(`🚫 [veto-nom] gagnant ${classement[0].idProduct} "${String(gagnantProduit.name).split('[')[0].trim()}" ÉCARTÉ : ${avis.raison}`);

                const codeSetsPreuve = await lireCodeSets(avis.preuves.map(p => p.idExpansion));
                // ⚠️ `cardInfoEffectif` ici aussi — voir le bloc du numéro de Pokédex. Un
                // seul des deux appels corrigé rétablirait la divergence à l'intérieur de
                // la même route. `numeroBrutPourScoring` : lot B retenu, voir l'autre appel.
                const r = await scorerCandidatsLocal(
                    avis.preuves, cardInfoEffectif, photos[0], expansionsAttendues, codeSetsPreuve,
                    { ...optionsMotif, numeroBrutPourScoring: cardInfo.number }
                );
                // « Ne tranche pas » = égalité au sommet. Deux candidats au même score, c'est
                // le cas Carabaffe : « le moins cher gagne » y désignerait un produit à
                // 3,76 € sans le moindre fondement. Une égalité n'est pas un verdict.
                const egaliteAuSommet = r.scores.length > 1 && r.scores[0].score === r.scores[1].score;
                if (r.scores.length && !egaliteAuSommet) {
                    produits = avis.preuves;
                    voieCatalogue = 'veto-nom-reclasse';
                    identificationConfiante = r.confiant;
                    strategieReverse = r.strategieReverse;
                    motifResolution = r.motif;
                    rangsScoring = r.rangs;
                    aucunCandidatAuNumero = false;   // ces produits portent le numéro lu, par construction
                    classement = r.scores.map(s => ({
                        idProduct: s.candidat.idProduct, idExpansion: s.candidat.idExpansion,
                        score: s.score, strategie: s.strategie, detail: s.detail
                    }));
                    console.log(`♻️ [veto-nom] RE-CLASSÉ sur ${avis.preuves.length} candidat(s) portant "${cardInfo.name}" au n°${cardInfo.number} -> ${classement[0].idProduct} (score ${classement[0].score})`);
                } else {
                    const motifRefus = r.scores.length ? 'nom-contredit-egalite' : 'nom-contredit-sans-repli';
                    console.warn(`🚫 [veto-nom] le vivier de preuve ${r.scores.length ? 'NE TRANCHE PAS (égalité au sommet)' : 'est VIDE'} -> refus.`);
                    const rendu = await rembourserScan(req, motifRefus);
                    enregistrerEchec({
                        route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo,
                        motifEchec: motifRefus, rembourse: rendu,
                        reverseLu, motifIA: cardInfo.motif, estDex: avisDex.estDex,
                        ...champsEtat(), ...champsCout(),
                        // ⚠️ LE VIVIER ICI EST CELUI DU SCORING (`produits`), PAS LE VIVIER
                        // DE PREUVE DU VETO (`r.scores`). Les deux existent à cette ligne et
                        // ils ne répondent pas à la même question : `produits` est la
                        // population que la chaîne a réellement considérée, donc la seule
                        // dans laquelle « la vérité y était-elle ? » a un sens. `r.scores`
                        // décrit pourquoi le veto a refusé, et son compte part déjà au
                        // journal par `nbCandidats` ci-dessous — écrasé volontairement.
                        ...champsVivier(), nbCandidats: r.scores.length
                    });
                    return res.json({
                        success: false,
                        // ⚠️ Les trois champs de refus — voir NATURE_REFUS, au-dessus de la
                        // route. Celle-ci est le refus délibéré par excellence : on préfère
                        // rendre le crédit plutôt que facturer un prix qu'on sait faux.
                        // `motifRefus` porte ici la variable locale du même nom, qui vaut
                        // 'nom-contredit-egalite' ou 'nom-contredit-sans-repli' — les deux
                        // sont dans la table.
                        ...champsDeRefus(motifRefus, rendu),
                        // ⚠️ MÊME DÉFAUT QUE `egalite-parfaite`, TROUVÉ EN LE CORRIGEANT :
                        // cette phrase affirmait elle aussi « scan remboursé » d'office.
                        // Le testeur n'avait signalé que l'autre ; les corriger toutes les
                        // deux évite de laisser vivre le même bug sous un autre motif.
                        error: `Le produit retenu ne porte pas le nom lu sur la carte ("${cardInfo.name}"), et aucun candidat ne le départage — aucun prix ne peut être donné sans risquer d'être faux.`,
                        cardInfo
                    });
                }
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // ÉGALITÉ AU SOMMET DU CHEMIN PRINCIPAL — aucun verdict
        // ════════════════════════════════════════════════════════════════════
        // La règle existait déjà dans le re-classement du veto ; elle n'avait jamais été
        // écrite pour le chemin principal, où elle vaut le plus. Mesuré sur le journal :
        // 27 scans ont un écart mesurable, NEUF sont des égalités parfaites, et SEPT sont
        // sorties avec confiance=haute. Le cas le plus cher : un Wartortle EC1-S19 à
        // 48,01 € rendu comme un PCG8 à 3,76 € — cinq de ces neuf lignes — sur 53 candidats
        // strictement à égalité.
        //
        // Sur une égalité parfaite, le départage par le prix N'EST PAS un arbitrage : les
        // critères ont tous parlé et aucun ne sépare les candidats. Choisir « le moins
        // cher » revient à tirer au sort, avec l'apparence d'une réponse. On ne joue plus.
        //
        // Cette règle couvre aussi, sans être écrite pour elles, les 2 345 paires de
        // variantes qui partagent un même numéro — dont 537 japonaises que TCGdex ne peut
        // pas router faute de variants_detailed. Une holo et une non-holo au même numéro,
        // au même score, c'est exactement une égalité parfaite.
        // ---- L'ÉGALITÉ S'ARBITRE PAR L'ÉCART DE PRIX, PAS PAR ELLE-MÊME -------
        // Une égalité n'est pas nuisible en soi : si les candidats valent la même chose,
        // le prix affiché est utile quel que soit celui qu'on retient. Le seuil ci-dessous
        // est DÉRIVÉ, pas choisi — 17 égalités rejouées sur les scans journalisés, tous
        // chemins confondus (10 par le chemin local, 7 par le principal) :
        //
        //   rapport de prix entre ex aequo :  min 2,21x  médiane 7,49x  q75 12,77x  max 559x
        //   écart ABSOLU :                    médiane 4,56 €  q75 44,25 €  max 1031,98 €
        //
        // ⚠️ LE RAPPORT NE DISCRIMINE PAS : aucune égalité n'est en dessous de 2,21x, et
        // 47 % dépassent 10x. Des candidats « qui valent à peu près la même chose », il n'y
        // en a pas un seul. C'est l'écart ABSOLU qui sépare, et la distribution y montre une
        // rupture nette : 0,55 € · 0,88 € · puis 2,27 €. D'où le seuil à 1,00 €, qui tombe
        // dans le vide entre les deux groupes plutôt qu'au milieu d'un continuum.
        //   sous 1,00 € (3 cas sur 17) : Raichu 0,15 -> 1,03 €, Misty's Staryu 0,06 -> 0,61 €.
        //     Le verdict « bonne affaire ou non » est le même dans les deux cas : on affiche.
        //   au-dessus (14 cas) : Wartortle 3,76 -> 48,01 €, Charmander 1,85 -> 1033,83 €.
        //     Là, le choix DÉCIDE du verdict : on refuse et on rembourse.
        //
        // PRIX INCONNUS = REFUS. On ne peut pas mesurer l'enjeu, donc on ne parie pas.
        // C'est le principe des sources perdues (voir scoring.js) : ne pas savoir ne doit
        // jamais valoir permission.
        const ECART_PRIX_TOLERABLE = 1.00;
        // `sontExAequo` et non `===` en ligne : c'est LA définition de l'égalité, partagée
        // avec le candidat concurrent renvoyé à l'extension. Voir scoring.js.
        if (classement.length > 1 && sontExAequo(classement[0].score, classement[1].score)) {
            const exAequo = classement.filter(c => sontExAequo(c.score, classement[0].score));
            // Capturé ICI, à la source, avant tout départage : c'est le groupe que le
            // scoring N'A PAS SU séparer, et c'est lui qui décide de tout ce qui suit.
            exAequoIds = exAequo.map(c => c.idProduct);
            const prix = exAequo.map(c => c.prix).filter(p => Number.isFinite(p) && p > 0);
            const ecartPrix = prix.length >= 2 ? Math.max(...prix) - Math.min(...prix) : null;
            const sansEnjeu = ecartPrix != null && ecartPrix < ECART_PRIX_TOLERABLE;

            // ════════════════════════════════════════════════════════════════
            // DÉPARTAGE PAR LE SYMBOLE DU SET — avant le refus, jamais dans le scoring
            // ════════════════════════════════════════════════════════════════
            // Voir departagerParSymbole (sets-vintage-japonais.js) pour les quatre verrous
            // et la mesure qui les justifie. Ici, deux choses seulement :
            //   - il s'applique AVANT la décision de refus, parce qu'il n'a de sens que
            //     là : sur une égalité déjà tranchée il n'y a rien à départager ;
            //   - il ne touche NI les scores NI l'ordre du classement. Il choisit un
            //     gagnant parmi des candidats que le scoring déclare équivalents.
            // ⚠️ SORTIE EN SUGGESTION AVERTIE, TOUJOURS. `perimetreVintage` force
            // `carteAmbigue` plus bas : le prix part avec réserve. Un signal lu juste 6
            // fois sur 7 transforme un refus en suggestion, jamais en affirmation.
            const avisSymbole = departagerParSymbole(
                cardInfo.symboleSet,
                exAequo.map(c => ({ ...c, codeSet: codeSetsConnus.get(Number(c.idExpansion)) ?? null })),
                SCORING
            );
            symboleDepartageRaison = avisSymbole.raison;
            if (avisSymbole.gagnant) {
                console.log(`🔣 [symbole-departage] ${avisSymbole.raison} -> ${avisSymbole.gagnant.idProduct} retenu, EN SUGGESTION AVERTIE.`);
                // On remonte le désigné en tête sans toucher à un seul score : le
                // classement reste celui du scoring, on ne fait que choisir dans l'égalité.
                classement = [
                    classement.find(c => c.idProduct === avisSymbole.gagnant.idProduct),
                    ...classement.filter(c => c.idProduct !== avisSymbole.gagnant.idProduct)
                ];
                // ⚠️ SON PROPRE DRAPEAU, PAS CELUI DU PÉRIMÈTRE. La première version
                // réutilisait `perimetreVintage` pour forcer la réserve — ça marchait, et
                // ça rendait les deux mécanismes INDISCERNABLES au journal. Deux causes
                // sous un seul nom, c'est une mesure qu'on ne peut plus faire.
                departageParSymbole = true;
            } else if (cardInfo.symboleSet) {
                console.log(`🔣 [symbole-departage] ${avisSymbole.raison}`);
            }

            // ════════════════════════════════════════════════════════════
            // LE DÉPARTAGE PAR L'ATTAQUE — 2026-09-05, MÊME FORME, DERRIÈRE LE SYMBOLE
            // ════════════════════════════════════════════════════════════
            // ⚠️ L'ORDRE EST UNE DÉCISION, PAS UN HASARD. Le symbole est mesuré 12/12 EN
            // PRODUCTION ; l'attaque n'est mesurée nulle part. Laisser la neuve passer devant
            // l'ancienne remplacerait une règle prouvée par une règle supposée — exactement
            // ce que la règle de promotion interdit (voir NIVEAU_RESERVE). L'attaque ne parle
            // donc QUE si le symbole s'est tu, et sa phrase est journalisée dans tous les cas.
            //
            // ⚠️ ELLE NE TOUCHE NI LES SCORES NI L'ORDRE. Comme le symbole : elle remonte un
            // désigné en tête d'une égalité, et rien d'autre. Aucun point n'est ajouté nulle
            // part — un départage qui modifierait le barème ne serait plus un départage, il
            // serait un critère, et il faudrait le mesurer comme tel.
            //
            // ⚠️ SORTIE EN SUGGESTION AVERTIE, TOUJOURS, via son propre drapeau. Le signal
            // n'a AUCUNE mesure de justesse : il transforme un refus en suggestion, jamais en
            // affirmation. Sa `raisonReserve` lui est propre (`attaque-departage`) pour que
            // sa classe reste comptable séparément de celle du symbole.
            if (!avisSymbole.gagnant) {
                const avisAttaque = departagerParAttaque(
                    cardInfo.attaque, cardInfo.attaqueConfiance,
                    exAequo.map(c => ({
                        idProduct: c.idProduct,
                        name: nomsCatalogue.get(Number(c.idProduct)) ?? null,
                        idMetacard: metacartes.get(Number(c.idProduct)) ?? null
                    }))
                );
                // 🔑 LA PHRASE EST GARDÉE MÊME QUAND IL NE TRANCHE PAS. Sans elle, « l'attaque
                // n'a pas départagé » et « il n'y avait pas d'égalité » sont indistinguables au
                // journal — c'est la leçon de `symboleDepartage`, appliquée le même jour.
                attaqueDepartageRaison = avisAttaque.raison;
                if (avisAttaque.gagnant) {
                    console.log(`⚔️ [attaque-departage] ${avisAttaque.raison} -> ${avisAttaque.gagnant.idProduct} retenu, EN SUGGESTION AVERTIE.`);
                    classement = [
                        classement.find(c => c.idProduct === avisAttaque.gagnant.idProduct),
                        ...classement.filter(c => c.idProduct !== avisAttaque.gagnant.idProduct)
                    ];
                    departageParAttaqueFait = true;
                } else if (cardInfo.attaque) {
                    console.log(`⚔️ [attaque-departage] ${avisAttaque.raison}`);
                }
            }

            if (avisSymbole.gagnant || departageParAttaqueFait) {
                // Départagé : on continue vers le verdict, avec réserve. Aucun refus.
            } else if (sansEnjeu) {
                console.warn(`⚠️ [egalite-sans-enjeu] ${exAequo.length} candidats à ${classement[0].score} points, mais ${euros(Math.min(...prix))} à ${euros(Math.max(...prix))} : l'écart (${euros(ecartPrix)}) ne change pas le verdict -> on affiche AVEC réserve.`);
                egaliteSansEnjeu = true;
            } else {
                const enjeu = ecartPrix != null ? `${euros(Math.min(...prix))} à ${euros(Math.max(...prix))}` : 'prix inconnus';
                console.warn(`🚫 [egalite-parfaite] ${exAequo.length} candidats à ${classement[0].score} points sur ${classement.length} (${enjeu}) : aucun critère ne les sépare et le choix décide du prix -> aucun verdict, scan remboursé.`);
                const rendu = await rembourserScan(req, 'egalite-parfaite');
                // ════════════════════════════════════════════════════════════
                // LA FOURCHETTE DES CANDIDATS — de la DONNÉE, jamais un verdict
                // ════════════════════════════════════════════════════════════
                // ON RENONCE À DIRE QUELLE CARTE C'EST, PAS À TOUT DIRE. Cas réel : deux
                // candidats à 1,90 € et 2,94 € pour une annonce à 85 €. Le refus est
                // techniquement correct — rien ne les départage — mais il jette une réponse
                // CERTAINE : quelle que soit la carte, 85 € est très au-dessus. L'utilisateur
                // repart sans rien alors qu'on savait. Le contraste avec Articuno est net :
                // 17,38 € à 404,55 € pour une annonce à 60 €, la fourchette ENCADRE le prix
                // et le refus est la seule réponse honnête.
                //
                // ⚠️ CE SONT DES PRIX GUIDE, ET LE SERVEUR NE TRANCHE PAS. Il n'a pas le prix
                // live — c'est le navigateur qui le lit — donc il envoie la donnée et laisse
                // l'extension décider. C'est la séparation des deux axes, tenue : ici on ne
                // parle QUE de prix, l'identification reste refusée.
                //
                // ⚠️ AUCUN SEUIL N'EST POSÉ ICI, ET C'EST DÉLIBÉRÉ. Comparer un prix guide à
                // un prix réel demande une marge, et cette marge doit sortir d'une mesure —
                // la distribution de prixLive/prixGuide sur un même produit, qu'on ne peut
                // pas encore calculer (voir `prixLive` dans journal-scans.js). Poser un
                // nombre maintenant ferait un second SEUIL_MARGE_CONFORTABLE, « posé à
                // l'estime, jamais mesuré ». L'extension gardera donc la fourchette sans
                // s'en servir jusqu'à ce que le seuil existe.
                //
                // ⚠️ CE N'EST PAS RÉTROACTIF. Les 17 refus déjà au journal resteront muets :
                // ils ne portent ni fourchette, ni nbExAequo, ni nbCandidats. La mesure de
                // cette classe repart de zéro à partir d'ici.
                const fourchette = (prix.length >= 2)
                    ? { min: Math.min(...prix), max: Math.max(...prix), n: exAequo.length }
                    : null;
                // ════════════════════════════════════════════════════════════
                // 🔑 CE QUE L'IMAGE AURAIT FAIT — MESURÉ, JAMAIS APPLIQUÉ ICI
                // ════════════════════════════════════════════════════════════
                // LE TROU QUE ÇA BOUCHE : le départage par l'image est branché ~200 lignes
                // PLUS BAS, donc sur un refus il n'était jamais consulté. Les trois refus
                // du 30-31 août sont tous des `egalite-parfaite` — la population que
                // l'image vise précisément — et le journal n'en dit rien.
                // ⚠️ ON MESURE, ON NE DÉCIDE PAS. `avis.gagnant` n'est PAS lu : le refus
                // reste un refus, mot pour mot. Laisser l'image sauver un refus serait un
                // changement de comportement, et il se déciderait sur des chiffres qu'on
                // n'a justement pas encore — ceux que cette ligne va produire.
                // ⚠️ ET ÇA COÛTE : un téléchargement de photo et un appariement sur un scan
                // déjà perdu. C'est le prix de savoir, et il est assumé ici plutôt que
                // découvert dans six semaines.
                const avisImageRefus = await departagerParImage({
                    imageUrl: photos[0], langue: cardInfo.language,
                    total: cardInfo.total, classement
                });
                enregistrerEchec({
                    route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo,
                    motifEchec: 'egalite-parfaite', rembourse: rendu,
                    fourchette, nbExAequo: exAequo.length, nbCandidats: produits.length, prixVinted,
                    reverseLu, motifIA: cardInfo.motif, estDex: avisDex.estDex,
                    ...champsEtat(), ...champsCout(),
                    // Les onze champs, tels que `departager()` les rend — même objet que
                    // sur la voie du succès, même point de construction.
                    champsImage: avisImageRefus.champs,
                    // 🔑 LA PHRASE DU SYMBOLE, SUR LE REFUS AUSSI — ajoutée le 2026-09-02.
                    // `symboleDepartageRaison` est renseignée à ce point (elle l'est ~75
                    // lignes plus haut) et elle dit ce que le symbole a fait MÊME quand il
                    // n'a rien tranché : « aucun symbole lu », ou « symbole lu, mais aucun
                    // ex aequo ne le porte ». C'est exactement le cas qui manquait : un
                    // refus par égalité où un symbole ÉTAIT lu sans pouvoir départager.
                    symboleDepartage: symboleDepartageRaison,
                    // La phrase du departage par l'ATTAQUE, sur le REFUS aussi, et pour la
                    // meme raison que celle du symbole : « attaque lue, mais les 4 ex aequo
                    // sont la MEME carte » est une mesure autant qu'un departage.
                    // attaqueLue / attaqueBrute / attaqueConfiance sont aplatis depuis
                    // cardInfo par enregistrerEchec — voir journal-scans.js.
                    attaqueDepartage: attaqueDepartageRaison,
                    exAequoIds, ...champsVivier(), nbCandidats: produits.length
                });
                return res.json({
                    success: false,
                    // ⚠️ Les trois champs de refus — voir NATURE_REFUS, au-dessus de la route.
                    // Refus délibéré, lui aussi : une égalité parfaite n'est pas un verdict.
                    ...champsDeRefus('egalite-parfaite', rendu),
                    // DONNÉE, PAS VERDICT. `min`/`max` sont des prix GUIDE ; `n` dit combien
                    // de candidats sont à égalité — à 2 c'est un duel, à 9 une foule.
                    // null quand moins de deux candidats ont un prix connu : on ne borne
                    // rien avec une seule borne.
                    fourchette,
                    // ⚠️ CETTE PHRASE NE PARLE PLUS D'ARGENT — 2026-09-01.
                    // Elle affirmait « scan remboursé » D'OFFICE, alors que le
                    // remboursement est TENTÉ trois lignes plus haut et peut échouer
                    // (plafond du jour). Le résultat vrai est dans `rendu`, et il part
                    // dans la réponse via `champsDeRefus` — la prose, elle, ne le lisait
                    // pas. Constaté dans le produit : sur un refus non remboursé, le
                    // panneau affichait ensemble « scan remboursé » (cette phrase) et
                    // « débité et n'a pas pu être rendu » (la ligne d'argent de
                    // l'extension). Deux phrases contradictoires dans le même cadre.
                    // 🔑 LA RÈGLE : UNE SEULE PHRASE PARLE D'ARGENT, et c'est celle de
                    // l'extension, qui lit `rembourse` et `raisonNonRembourse`. Le serveur
                    // dit POURQUOI il refuse ; il ne dit pas ce qu'il advient du crédit.
                    error: `${exAequo.length} cartes correspondent aussi bien l'une que l'autre à ce qui a été lu, et leurs prix vont de ${enjeu}. Aucun critère ne les départage : aucun prix ne peut être donné sans le tirer au sort.`,
                    cardInfo
                });
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // IDENTIFIANT TCGdex PARTAGÉ — ambiguïté déclarée
        // ════════════════════════════════════════════════════════════════════
        // 69 identifiants TCGdex sont portés par plusieurs expansions Cardmarket, parce que
        // nos liens ont été appris depuis le catalogue ANGLAIS, qui ne distingue pas un set
        // japonais de son jumeau occidental. Sur une carte japonaise, un tel lien ne
        // désigne pas une expansion : il en désigne deux.
        // La table close (sets-vintage-japonais.js) lève l'ambiguïté pour les expansions
        // qu'elle couvre — vérifiées une par une. Pour les autres, mesuré à 63 expansions
        // japonaises, on ne peut pas trancher : la carte sort AVERTIE, jamais affirmée.
        const lienGagnant = await diagnosticLienTcgdex(classement[0]?.idExpansion);
        const lienAmbigu = Boolean(
            lienGagnant.partage
            && LANGUES_ASIATIQUES.includes(String(cardInfo.language || '').toUpperCase())
            && !EXPANSIONS_VINTAGE.has(Number(classement[0]?.idExpansion))
        );
        if (lienAmbigu) {
            console.warn(`⚠️ [lien-tcgdex-partage] l'expansion ${classement[0].idExpansion} partage l'identifiant « ${lienGagnant.setTcgdex} » avec ${lienGagnant.autres.join(', ')} et n'est pas dans la table close -> ambiguïté déclarée, aucun verdict affirmé.`);
        }

        // ════════════════════════════════════════════════════════════════════
        // CONTRADICTION A -> CORRECTION B — l'impression retenue n'est pas celle lue
        // ════════════════════════════════════════════════════════════════════
        // LE CAS QUI L'A MOTIVÉE. Rayquaza me02.5-153, occidentale moderne, sortie FAUSSE
        // ET AFFIRMÉE : l'annonce dit reverse, TCGdex confirme qu'une reverse existe, et le
        // produit retenu est l'impression NORMALE. Le motif n'a même pas été consulté — la
        // chaîne avait tranché par setcode+numéro bien avant. Une réserve n'aurait rien
        // signalé, parce qu'aucune n'était levée.
        //
        // A EST UNE CONTRADICTION, PAS UN SILENCE. Quatrième principe : contredire prouve,
        // ne pas lire ne prouve rien. Les trois faits doivent être POSITIFS —
        //   1. l'impression VOULUE est une reverse : l'IA l'a lue (avant le validateur,
        //      d'où `reverseLu`) OU le titre de l'annonce le dit ;
        //   2. TCGdex ROUTE une reverse pour cette carte : `variants_detailed` donne au
        //      moins un idProduct de reverse. Pas « variants.reverse === true », qui dit
        //      seulement qu'elle existe quelque part — ici il faut de quoi la désigner ;
        //   3. TCGdex désigne le produit RETENU comme l'impression NON reverse. C'est une
        //      appartenance à `parMotif['aucun']`, pas une absence de la liste des reverses :
        //      un produit inconnu de la table ne prouve rien (premier principe).
        //
        // ⚠️ 4. ET LA CONDITION DE ROUTE — elle a changé de nature, pas d'objet.
        // AVANT L'ALIGNEMENT : les faits 2 et 3 venaient de /v2/en quelle que soit la route
        // qui avait trouvé la carte. Les espaces d'identifiants étant disjoints, une carte
        // trouvée en [ja] avait des `variantsDetailed` NULS, et la garde ne pouvait que se
        // taire — elle tenait par une coïncidence de nullité, pas par une preuve.
        // DEPUIS L'ALIGNEMENT : le détail est pris sur `langueRoute`, donc les faits 2 et 3
        // décrivent LA carte retenue, par construction. La condition devient structurelle.
        // ON LA GARDE ÉCRITE QUAND MÊME, et c'est délibéré : elle dit que la garde exige
        // une carte réellement trouvée par une route (`langueRoute` non nul). Les
        // trouvailles SYNTHÉTIQUES — identification locale, setcode+numéro — n'en ont pas :
        // TCGdex n'a rien vu, et une garde qui s'appuierait sur ses variantes s'appuierait
        // sur du vide.
        //
        // ⚠️ CE QUE `langueRoute` NE DIT PAS, et il faut le lire avant de s'appuyer dessus :
        // une carte trouvée par la route de sa langue reste une carte trouvée PAR RECHERCHE
        // DE NOM. Elle peut donc être la mauvaise carte de la BONNE langue — c'est
        // exactement « Dark Ursaring » lu juste et rendu `neo4-097` = « Dark Porygon2 ».
        // La route élimine UN mode d'erreur (la carte d'une autre région), pas tous.
        //
        // B = LA CORRECTION, ET ELLE NE DEVINE RIEN. Les idProducts des impressions reverse
        // sont DÉJÀ dans `variantsDetailed` : B va simplement les chercher au catalogue. Ce
        // n'est pas un élargissement de périmètre, c'est une lecture d'une table qu'on avait
        // sous la main et qu'on ne consultait pas sur ce chemin.
        //
        // TROIS SORTIES, ET AUCUNE N'AFFIRME :
        //   3a `impression-corrigee`  — B trouve UNE reverse au catalogue -> on la substitue.
        //   3b `impression-contredite` — B ne trouve rien, OU en trouve plusieurs et rien ne
        //      les départage. Le produit retenu ne bouge pas, mais la contradiction est
        //      déclarée. Une égalité n'est pas un verdict, ici comme ailleurs.
        // Les deux partent en réserve FAIBLE : dans un cas on vient de changer de produit
        // sur la foi d'une table, dans l'autre on sait qu'on affiche probablement la
        // mauvaise impression. Ni l'un ni l'autre n'autorise à quasi-affirmer.
        let impressionCorrigee = false, impressionContredite = false;
        {
            const analyseA = analyserVariantes(trouvaille.variantsDetailed);
            const idGagnant = classement[0]?.idProduct;
            const routeDuFait = trouvaille.langueRoute != null;
            // Fait 1 — deux sources, l'une suffit. `reverseLu` est la lecture BRUTE de l'IA,
            // capturée avant le validateur ; `motifDuTitre` lit le titre de l'annonce, qui
            // est écrit par le vendeur et ne passe par aucun modèle.
            const motifTitre = motifDuTitre(title);
            const reverseVoulue = reverseLu === true || (motifTitre != null && motifTitre !== 'aucun');
            // Fait 2 — des reverses ROUTABLES, et pas celle qu'on tient déjà.
            const ciblesReverse = [...new Set([
                ...analyseA.parMotif['reverse-classique'],
                ...analyseA.parMotif['ball'],
                ...analyseA.parMotif['masterball']
            ])].filter(id => id != null && id !== idGagnant);
            // Fait 3 — appartenance POSITIVE à la classe non-reverse.
            const gagnantEstNonReverse = idGagnant != null && analyseA.parMotif['aucun'].includes(idGagnant);

            if (routeDuFait && reverseVoulue && ciblesReverse.length && gagnantEstNonReverse) {
                console.warn(
                    `⚠️ [impression-contredite] reverse voulue (ia=${reverseLu} titre=${motifTitre ?? '—'})` +
                    ` mais le gagnant ${idGagnant} est l'impression NON reverse de ${trouvaille.id}.` +
                    ` Reverses routables : ${ciblesReverse.join(', ')}.`
                );
                // B — on ne les invente pas, on les lit au catalogue.
                const trouvesAuCatalogue = await CatalogueProduit.find({ idProduct: { $in: ciblesReverse } }).lean();
                const utilisables = ecarterNonCartes(trouvesAuCatalogue, `[impression] reverses de ${trouvaille.id}`);
                if (utilisables.length === 1) {
                    const remplacant = utilisables[0];
                    impressionCorrigee = true;
                    strategieReverse = analyseA.strategieParIdProduct.get(remplacant.idProduct) ?? null;
                    // Le remplaçant prend la tête ; l'ancien gagnant reste dans le classement,
                    // derrière, parce que l'extension teste dans l'ordre et qu'il reste un
                    // repli valable si la reverse n'a pas d'offre.
                    classement = [
                        {
                            idProduct: remplacant.idProduct, idExpansion: remplacant.idExpansion,
                            score: classement[0].score, strategie: strategieReverse,
                            detail: 'impression-corrigee'
                        },
                        ...classement
                    ];
                    if (!produits.some(p => p.idProduct === remplacant.idProduct)) produits = [remplacant, ...produits];
                    console.warn(`♻️ [impression-corrigee] ${idGagnant} -> ${remplacant.idProduct} "${String(remplacant.name).split('[')[0].trim()}" (stratégie ${strategieReverse ?? 'inconnue'}).`);
                } else {
                    impressionContredite = true;
                    console.warn(
                        `🚧 [impression-contredite] ${utilisables.length === 0 ? 'aucune' : utilisables.length} reverse(s) au catalogue` +
                        ` -> le produit retenu ne bouge pas, la contradiction est déclarée.`
                    );
                }
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // LE DÉPARTAGE PAR L'IMAGE — branché le 2026-08-29
        // ════════════════════════════════════════════════════════════════════
        // La règle, la mesure qui l'autorise et la garde vivent dans departage-image.js.
        // Ici, seulement le branchement — et il tient en trois faits :
        //
        //   1. IL EST APPELÉ À CHAQUE SCAN, MÊME QUAND IL NE TRANCHERA PAS. `champsImage`
        //      part au journal dans tous les cas. C'est ce qui permettra de mesurer ce
        //      qu'il AURAIT fait, exactement comme `symboleDepartage` journalise « aucun
        //      ex aequo ne porte ce symbole » — une abstention est une mesure.
        //   2. IL NE RETIRE JAMAIS UN CANDIDAT, il en remonte un. Le classement du scoring
        //      reste derrière, intact : s'il se trompe, le repli existe encore.
        //   3. IL EST INERTE TANT QUE `references_image` EST VIDE. Aucun vecteur -> la
        //      garde ne passe pas -> abstention -> pas un verdict ne bouge. Le code peut
        //      donc partir AVANT les descripteurs, et c'est la seule façon de savoir
        //      laquelle des deux bascules aura cassé quoi.
        //
        // ⚠️⚠️ UNE CONDITION QUE JE N'AI PAS REÇUE ET QUE J'AJOUTE — DÉCLARÉE, PAS GLISSÉE.
        // Le départage par le SYMBOLE est mesuré 12/12 sur sa classe. Le départage par
        // l'image est mesuré 31 D+ / 0 D− sur la cellule, mais JAMAIS contre le symbole.
        // Les deux peuvent se déclencher sur la même carte (une carte de cellule peut être
        // dans le périmètre vintage avec un symbole lisible). Laisser l'image passer devant
        // remplacerait une règle mesurée par une autre sur une population où la première
        // n'a jamais échoué — une promotion sans mesure, exactement ce que la règle de
        // rétrogradation interdit dans l'autre sens.
        // L'image s'abstient donc quand le symbole a tranché, ET ON JOURNALISE LE
        // DÉSACCORD : c'est la mesure qui manquera pour trancher plus tard.
        let departageParImage = false;
        let champsImage = {};
        {
            const avis = await departagerParImage({
                imageUrl: photos[0], langue: cardInfo.language,
                total: cardInfo.total, classement
            });
            champsImage = avis.champs;
            if (departageParSymbole && avis.departage) {
                champsImage.imageStatut = 'abstention-symbole-prioritaire';
                champsImage.imageMotif = avis.gagnant === classement[0]?.idProduct
                    ? 'le symbole et l\'image sont d\'accord' : 'DÉSACCORD symbole/image';
                console.warn(`🔀 [image] symbole prioritaire — ${champsImage.imageMotif}` +
                    ` (symbole ${classement[0]?.idProduct}, image ${avis.gagnant}).`);
            } else if (avis.departage && avis.gagnant !== classement[0]?.idProduct) {
                departageParImage = true;
                const gagnant = classement.find(c => c.idProduct === avis.gagnant);
                classement = [gagnant, ...classement.filter(c => c.idProduct !== avis.gagnant)];
                console.warn(`🖼️ [image-departage] ${avis.champs.imageInliers} inliers contre` +
                    ` ${avis.champs.imageInliersSecond} — ${avis.gagnant} passe devant.`);
            } else if (avis.departage) {
                // L'image confirme le scoring. Pas de réserve NEUVE : le scoring avait déjà
                // raison, et étiqueter une confirmation comme un départage gonflerait la
                // classe avec les cas les plus faciles — ce qui la ferait paraître meilleure
                // qu'elle n'est. C'est la même erreur que le dénominateur pris dans la
                // mauvaise table, dans l'autre sens.
                champsImage.imageStatut = 'confirme-le-scoring';
            }
        }

        // Rang du gagnant retenu : 3 = le catalogue CONTREDIT le numéro lu pour lui.
        const gagnantContreditNumero = rangsScoring?.rangGagnant === 3;

        // Les deux signaux de rang entrent dans l'incertitude, chacun avec SON motif —
        // un motif générique empêcherait de mesurer lequel se déclenche.
        const carteAmbigue = Boolean(
            trouvaille.ambigu || numeroContredit || motifResolution.etat === 'non-resolu'
            || aucunCandidatAuNumero || gagnantContreditNumero || localIncertain || nomPeuFiable
            || nomNumeroIncoherents || egaliteSansEnjeu || lienAmbigu
            // Les deux sorties de la contradiction A. `impression-corrigee` est incertaine
            // parce qu'on vient de CHANGER de produit sur la foi d'une table ;
            // `impression-contredite` parce qu'on sait afficher probablement la mauvaise
            // impression et qu'on n'a pas su faire mieux. Voir le bloc A -> B plus haut.
            || impressionCorrigee || impressionContredite
            // Le repli par nom seul : ni numéro, ni TCGdex, ni variantes. Trois sources
            // perdues d'un coup — c'est le vivier le moins étayé que la chaîne produise,
            // et il ne sort jamais autrement qu'en suggestion avertie.
            || nomSeulVintage
            // Le périmètre restreint sans prouver : sa sortie est une suggestion, pas un
            // verdict. Arbitrage explicite, à ne pas lever avant que le banc le justifie.
            || perimetreVintage
            // Le départage par le symbole : il choisit dans une égalité que le scoring
            // déclare parfaite, sur un signal lu juste 6 fois sur 7. Suggestion, jamais
            // verdict — c'est la condition à laquelle il a été écrit.
            || departageParSymbole
            // Le départage par l'attaque : il choisit dans une égalité que le scoring
            // déclare parfaite, sur un signal dont la justesse n'est mesurée NULLE PART.
            // Suggestion, jamais verdict — c'est la condition à laquelle il a été écrit.
            || departageParAttaqueFait
            // Le départage par l'image : il vient de CHANGER le produit retenu, sur un
            // signal que le texte n'a pas. Mesuré 31 D+ / 0 D− sur la cellule — excellent,
            // et pas une preuve : l'intervalle de Wilson à 95 % sur 41 succès en 44 va de
            // 80 % à 98 %. Suggestion, donc, jamais verdict, exactement comme le symbole
            // l'a été à ses débuts.
            || departageParImage
            // NEUTRALISER LE NUMÉRO, C'EST PERDRE UNE SOURCE — donc propager l'incertitude,
            // jamais la réduire (voir le principe dans scoring.js). Mesuré au banc : sans
            // cette ligne, la règle du numéro de Pokédex FAIT EMPIRER le critère de
            // lancement, de 1 à 3 verdicts faux et affirmés. Elle retire un drapeau qui se
            // levait pour une mauvaise raison — le « troisième état » du nom — sans encore
            // fournir le chemin d'identification qui le remplace. Tant que ce chemin
            // n'existe pas, l'identification repose sur le seul nom, et sur ces cartes
            // vintage le nom ne suffit pas : « Mew » ramène 75 candidats.
            || avisDex.estDex
        );
        // ════════════════════════════════════════════════════════════════════
        // LA RAISON DE LA RÉSERVE — calculée UNE FOIS, donnée à ses DEUX consommateurs
        // ════════════════════════════════════════════════════════════════════
        // Elle ne vivait que dans l'appel à `signalerIncertain`, c'est-à-dire dans un
        // `console.warn` — ÉPHÉMÈRE sur Render. Le journal, lui, ne portait que le booléen
        // `carteIncertaine` : on savait qu'il y avait une réserve, jamais laquelle.
        // Conséquence immédiate : le départage par symbole venait d'être écrit et RIEN
        // n'aurait pu dire s'il s'était déclenché une seule fois en production. Une branche
        // qu'on ne peut pas compter est une branche qu'on ne connaît pas.
        //
        // ⚠️ UNE SEULE EXPRESSION, DEUX USAGES. La recopier pour le journal en ferait une
        // seconde source de vérité qui divergerait au premier ajout — deuxième principe,
        // trois fois vérifié cette semaine.
        //
        // ÉNUMÉRATION FERMÉE, une valeur par CAUSE — jamais un motif générique, sinon on ne
        // peut plus mesurer lequel se déclenche. `perimetre-vintage-suggestion` couvrait
        // deux mécanismes distincts depuis que le départage réutilisait son drapeau : c'est
        // corrigé, ils ont chacun le leur.
        //
        // ════════════════════════════════════════════════════════════════════
        // LE PRINCIPE D'ORDRE — quelle cause gagne quand plusieurs s'appliquent
        // ════════════════════════════════════════════════════════════════════
        // LE PROBLÈME DE FOND N'EST PAS L'ORDRE ACTUEL, c'est qu'une carte relève souvent de
        // PLUSIEURS causes et qu'un seul champ doit en désigner une. Le recouvrement est
        // apparu trois fois — le départage sous le drapeau du périmètre, puis deux égalités
        // parfaites rapportées comme « périmètre » — et il reviendra à chaque nouvelle
        // raison tant que la règle d'arbitrage n'est pas écrite. La voici.
        //
        //   RÈGLE 1 — UNE CAUSE QUI SAPE LA PRÉMISSE D'UNE AUTRE PASSE DEVANT, quelle que
        //   soit sa spécificité. Un doute sur l'ENTRÉE bat une précision sur la SORTIE.
        //   Exemple : `nom-confiance-basse` dit que l'IA doute de sa propre lecture ;
        //   `symbole-departage` suppose au contraire que la lecture était assez bonne pour
        //   construire un vivier. Annoncer « forte » sur une carte dont le nom est douteux
        //   serait promouvoir une conclusion bâtie sur une prémisse qu'on sait fragile.
        //   ⚠️ C'est la clause qui manque encore à l'ordre ci-dessous.
        //
        //   RÈGLE 2 — À DÉFAUT, LA PLUS SPÉCIFIQUE L'EMPORTE : celle qui décrit le mécanisme
        //   le plus ÉTROIT. Elle porte le plus d'information, et surtout elle se mesure le
        //   mieux — une classe étroite est homogène, donc sa justesse veut dire quelque
        //   chose. Une égalité parfaite est plus spécifique qu'un périmètre qui restreint :
        //   elle devra donc passer devant lui.
        //
        //   ⚠️ ET LA LIMITE DE LA RÈGLE 2, à garder en tête avant chaque promotion en
        //   « forte » : la justesse mesurée d'une classe étroite est CONDITIONNELLE au
        //   mélange de causes générales présentes dans l'échantillon. C'est exactement ce
        //   que la règle 1 protège, et ce n'est pas une précaution théorique — c'est
        //   MESURÉ : les 12 lignes `symbole-departage` ont TOUTES `nomConfiance: 'haute'`.
        //   Le 12/12 ne dit donc rien d'une carte dont le nom serait douteux ; il n'a
        //   jamais été mis à l'épreuve dans ce cas.
        //
        //   ÉTAT AU 2026-08-08 : la règle 1 n'a encore RIEN à arbitrer. Zéro ligne sort
        //   « forte » avec une prémisse sapée, et pour une raison plus large qu'un hasard
        //   heureux — `nomConfiance: 'basse'` n'est apparue AUCUNE fois sur les 131 lignes
        //   du journal. Le garde `nomPeuFiable` n'a jamais servi en production.
        //   ⚠️ Ce qui veut dire que sa fréquence réelle est INCONNUE, pas nulle. Le jour où
        //   elle apparaît, la règle 1 doit déjà être appliquée dans l'ordre ci-dessous —
        //   sinon la première carte concernée sortira « forte » à tort.
        //
        // ⚠️ CHANGER CET ORDRE CRÉE UN NOUVEL INSTRUMENT, ET LES MESURES REPARTENT DE ZÉRO.
        // `raisonReserve` est FIGÉE au moment du scan : les lignes déjà au journal gardent
        // leur ancienne étiquette, les nouvelles en reçoivent une autre. Les statistiques
        // par raison ne sont donc PAS additionnables de part et d'autre d'un changement
        // d'ordre — exactement comme les 7 lignes lues sous l'ancien prompt ne s'ajoutent
        // pas aux 28 lues sous le nouveau. Deux instruments, deux mesures.
        // Le jour où l'ordre change : le noter ici avec sa date, et repartir d'un lot neuf.
        // ⚠️⚠️ CHANGEMENT D'INSTRUMENT DÉCLARÉ — 2026-08-16, LE PLUS LOURD DES DEUX.
        // `egalite-sans-enjeu` passe devant `perimetre-vintage-suggestion`. Les
        // statistiques par raison REPARTENT DE ZÉRO à cette date, exactement comme au
        // changement de prompt : les 16 lignes de `perimetre-vintage-suggestion` déjà au
        // journal ne s'additionnent PAS aux suivantes, puisqu'une partie d'entre elles
        // aurait porté l'autre étiquette sous le nouvel ordre. Le 10/16 appartient à
        // l'ancien instrument ; le prochain lot mesure le nouveau.
        // À ÉCRIRE DANS LA NOTE DU LOT, faute de quoi quelqu'un comparera les deux périodes.
        //
        // ⚠️ CHANGEMENT D'INSTRUMENT DÉCLARÉ — 2026-08-14. Deux entrées ajoutées EN TÊTE :
        // `impression-corrigee` et `impression-contredite`. Elles passent devant
        // `symbole-departage` par la RÈGLE 1 : quand B a substitué le produit, le départage
        // par symbole portait sur un gagnant qui n'est plus le gagnant — sa prémisse est
        // sapée, pas seulement moins spécifique. Les lignes déjà au journal gardent leur
        // ancienne étiquette ; les statistiques par raison ne sont pas additionnables de
        // part et d'autre de cette date pour les scans qui déclenchent la contradiction A.
        const raisonReserve = !carteAmbigue ? null
            : impressionCorrigee ? 'impression-corrigee'
            : impressionContredite ? 'impression-contredite'
            // Devant tout le reste par la RÈGLE 1 : ce repli dit que le vivier lui-même
            // n'existe que par défaut de tout le reste. C'est une prémisse plus faible que
            // n'importe quelle raison portant sur le DÉPARTAGE à l'intérieur du vivier.
            : nomSeulVintage ? 'nom-seul-vintage'
            : departageParSymbole ? 'symbole-departage'
            // ⚠️ CHANGEMENT D'INSTRUMENT DÉCLARÉ — 2026-09-05, et il est ÉTROIT.
            // `attaque-departage` s'insère derrière le symbole (qui garde la priorité dans le
            // code, voir le branchement). Aucune ligne DÉJÀ au journal ne change d'étiquette :
            // le drapeau n'a jamais pu être vrai avant aujourd'hui. Mais les lignes à venir où
            // l'attaque tranche auraient porté `egalite-sans-enjeu` — ou n'auraient pas existé
            // du tout, le scan finissant en refus. C'est donc cette classe-là, et elle seule,
            // qui cesse d'être additivement comparable de part et d'autre de cette date.
            : departageParAttaqueFait ? 'attaque-departage'
            // ⚠️ CHANGEMENT D'INSTRUMENT DÉCLARÉ — 2026-08-29, ET IL EST ÉTROIT.
            // `image-departage` s'insère ici, derrière le symbole (qui reste prioritaire,
            // voir le branchement). Aucune ligne DÉJÀ au journal ne change d'étiquette :
            // le drapeau n'a jamais pu être vrai avant aujourd'hui. Mais les lignes à
            // venir où l'image tranche auraient porté `egalite-sans-enjeu` ou une raison
            // plus basse sous l'ancien code. C'est donc cette classe-là, et elle seule,
            // qui cesse d'être additivement comparable de part et d'autre de cette date.
            // À écrire dans la note du lot, faute de quoi quelqu'un comparera les deux
            // périodes de `egalite-sans-enjeu` comme si c'était le même instrument.
            : departageParImage ? 'image-departage'
                // ⚠️ RECOUVREMENT CORRIGÉ — 2026-08-16. `egaliteSansEnjeu` passe DEVANT
                // `perimetreVintage`. Avant, une carte qui était les DEUX était rapportée
                // comme « périmètre », et la classe la plus fréquente absorbait des lignes
                // qui n'étaient pas les siennes. Mesuré : L038 Ponyta et L056 Caterpie ont
                // `ecartScore = 0` — donc une égalité — sont classées « périmètre », et
                // sont toutes deux FAUSSES. Elles tirent vers le bas le taux de la classe
                // qu'on cherche justement à promouvoir (10/16 aujourd'hui).
                // RÈGLE 2 : la plus SPÉCIFIQUE l'emporte. Une égalité parfaite est plus
                // étroite qu'un périmètre qui restreint — le périmètre dit d'où viennent
                // les candidats, l'égalité dit que rien ne les sépare.
                : egaliteSansEnjeu ? 'egalite-sans-enjeu'
                    : perimetreVintage ? 'perimetre-vintage-suggestion'
                        : lienAmbigu ? 'lien-tcgdex-partage'
                            : avisDex.estDex ? 'numero-pokedex-neutralise'
                                : localIncertain ? 'identification-locale-sans-tcgdex'
                                    : nomNumeroIncoherents ? 'nom-numero-incoherents'
                                        : aucunCandidatAuNumero ? 'aucun-candidat-au-numero'
                                            : gagnantContreditNumero ? 'gagnant-contredit-le-numero'
                                                : nomPeuFiable ? 'nom-confiance-basse'
                                                    : motifResolution.etat === 'non-resolu' ? `motif-${motifResolution.raison}`
                                                        : numeroContredit ? 'tcgdex-numero-incoherent'
                                                            : 'tcgdex-ambigu';
        if (carteAmbigue) await signalerIncertain(req, raisonReserve);

        // ════════════════════════════════════════════════════════════════════
        // LE NIVEAU DE LA RÉSERVE — deux valeurs, et la table vit ICI
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI CÔTÉ SERVEUR, et pas dans l'extension. Si elle recopiait une table
        // raison -> niveau, il n'existerait AUCUN défaut sûr pour une valeur qu'elle ne
        // connaît pas encore : la faire tomber vers « faible » muselleraient une réserve
        // mesurée à 12/12, vers « forte » promouvrait une réserve tiède en quasi-affirmation
        // et casserait le contrat « quand l'outil affirme, il a raison ». C'est ici qu'on
        // mesure, c'est donc ici qu'on classe.
        //
        // LE NIVEAU PILOTE LE COMPORTEMENT, LA RAISON ALIMENTE LE TEXTE. L'extension n'a
        // jamais besoin de connaître la liste des raisons pour décider quoi faire.
        //
        // ⚠️ RÈGLE DE RÉTROGRADATION, ÉCRITE AVANT D'EN AVOIR BESOIN :
        //   UNE ENTRÉE CLASSÉE « FORTE » REDESCEND EN « FAIBLE » À LA PREMIÈRE MESURE OÙ
        //   ELLE RATE. Sans discussion, sans attendre un échantillon plus grand, sans
        //   chercher si le cas était particulier.
        //   La raison est un arbitrage assumé : mieux vaut perdre douze bonnes cartes que
        //   casser une seule fois « quand l'outil affirme, il a raison ». Un contrat de
        //   confiance ne se répare pas en le remesurant.
        //   ⚠️ Et « forte » n'a jamais voulu dire « prouvé ». `symbole-departage` est à
        //   12/12, mais l'intervalle de confiance à 95 % sur 12 succès va de 74 % à 100 % :
        //   c'est excellent, ce n'est pas une certitude. Toute entrée forte est à remesurer
        //   à chaque lot.
        //
        // JUSTESSE MESURÉE, sur 65 scans réels avec vérités saisies à l'aveugle (2026-08-08).
        // Le chiffre est à côté de chaque entrée pour que la prochaine promotion se fasse
        // sur une mesure et non sur une impression.
        // ════════════════════════════════════════════════════════════════════
        // 🔑 LA RÈGLE DE PROMOTION — v2, ADOPTÉE LE 2026-09-02
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ LA v1 EXIGEAIT « ≥ 12 LIGNES » **ET** UN INTERVALLE DISJOINT. L'EFFECTIF A ÉTÉ
        // RETIRÉ, ET VOICI POURQUOI — c'est le seul point qui compte pour comprendre v2 :
        // un seuil en EFFECTIF et un seuil en INTERVALLE ne se traduisent pas l'un dans
        // l'autre. Wilson sur 12/12 donne [75,8 – 100] ; le plancher était 81,5. La v1,
        // appliquée à la lettre, REFUSAIT `symbole-departage` — la seule entrée forte, et
        // celle qu'elle prétendait codifier. Écrire les deux seuils côte à côte comme s'ils
        // disaient la même chose fabriquait une règle qui se contredit en silence.
        // L'effectif n'était pas un critère : c'était un PROXY pour « assez de preuve ».
        // Le critère est l'intervalle. On garde le critère, on jette le proxy.
        //
        // Une entrée passe de `faible` à `forte` SI ET SEULEMENT SI, toutes réunies :
        //   1. sa BORNE BASSE de Wilson à 95 % dépasse la BORNE HAUTE de la classe faible
        //      la mieux mesurée — aujourd'hui `perimetre-vintage-suggestion`, 10/16, dont
        //      la borne haute est 81,5 %. Deux intervalles qui se chevauchent ne
        //      distinguent rien. L'effectif nécessaire en DÉCOULE, il ne se décrète pas ;
        //   2. mesurée sur une population où LE VIVIER N'A PAS ÉTÉ TRUQUÉ : aucune
        //      injection de la vérité, le vivier est celui que la chaîne produit ;
        //   3. sur des PHOTOS DE VENDEUR, pas des images de référence ;
        //   4. ZÉRO CASSE AU HOLDOUT ;
        //   5. ⚠️ ET LA CONDITION QUI NE SE CALCULE PAS : une erreur doit rester PIRE
        //      qu'un refus. Là où l'utilisateur ne reçoit rien aujourd'hui, lui livrer un
        //      prix faux est une régression, pas un progrès. La charge de la preuve est
        //      entièrement du côté du signal qui veut parler.
        //
        // 🔴 CE QUE v2 DIT DE `symbole-departage`, ET IL FAUT QUE ÇA SE VOIE :
        // il est classé FORTE, il est mesuré 12/12 en production, et Wilson sur 12/12 vaut
        // [75,8 – 100]. 75,8 < 81,5 : **SA PROPRE PROMOTION NE SATISFAIT PAS LA CONDITION 1**.
        // Il faudrait 20/20 pour la franchir. Il n'est PAS rétrogradé ici — ce serait une
        // décision de produit, prise à la légère sur une entrée qui n'a jamais raté. Mais
        // il n'est pas confortable non plus : une entrée forte dont la promotion ne tient
        // pas la règle actuelle doit être VISIBLE. Elle l'est, ici, à côté de la table.
        //
        // ⚠️ ET LE PLANCHER LUI-MÊME EST MOU — mesuré le 2026-09-02, et c'est un défaut de
        // la condition 1 qu'il faut connaître avant de s'y fier. 81,5 % est la borne HAUTE
        // d'une classe de SEIZE lignes. Si `perimetre-vintage-suggestion` gagne dix lignes :
        //     à taux constant (16/26) le plancher DESCEND à 77,6 — l'intervalle se resserre ;
        //     si la classe s'améliore (18/26) il MONTE à 83,5 ;
        //     à 22/26 il atteint 93,8 et l'image, à 84,9, NE PASSERAIT PLUS.
        // 🔑 Autrement dit : la promotion d'un signal dépend de la performance d'une classe
        // QUI N'A RIEN À VOIR AVEC LUI. C'est assumé faute de mieux — il faut bien un
        // témoin — mais un plancher assis sur seize lignes n'est pas un socle, et tout
        // seuil qui en dérive bouge avec lui. À reconsidérer quand cette classe aura n≥30.
        //
        // ⚠️ ET LA RÈGLE DE RÉTROGRADATION, PLUS BAS, RESTE PRIORITAIRE : une entrée forte
        // redescend à la première mesure où elle rate, sans discussion.
        //
        // ════════════════════════════════════════════════════════════════════
        // OÙ EN EST `image-departage` CONTRE LA v2 — mesuré le 2026-09-02
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ IL RESTE `faible`. Ce bloc dit ce qui est satisfait et ce qui ne l'est pas ;
        // il ne promeut rien.
        //   1. BORNE BASSE > 81,5 % .......... ✅ 42/44 sur la cellule -> Wilson [84,9 – 98,7].
        //   2. VIVIER NON TRUQUÉ ............. ✅ ET C'EST UNE SURPRISE. La mesure existait
        //      pour lever un doute que j'avais soulevé moi-même : le banc COMPLÉTAIT le
        //      vivier avec la vérité quand elle en était absente, garantie que la production
        //      n'a jamais. Régime « vivier RÉEL » ajouté et relancé :
        //          vérité ABSENTE du vivier réel = 0 sur 44.
        //      L'injection ne s'est JAMAIS déclenchée sur ce jeu. Les deux régimes rendent
        //      42/44 à l'identique. 🔑 Le doute était fondé sur la LECTURE du code et faux
        //      sur les DONNÉES — une garantie inutilisée reste une garantie, mais elle ne
        //      change aucun chiffre. Le 42/44 était déjà un chiffre de vivier réel.
        //   3. PHOTOS DE VENDEUR ............. ✅ 66/66 téléchargées depuis l'annonce, 0 repli.
        //   4. ZÉRO CASSE AU HOLDOUT ......... 🔴 NON VÉRIFIABLE, ET C'EST CE QUI BLOQUE.
        //      Le holdout porte 10 vérités pour 67 lignes ; les 44 de la cellule viennent
        //      à 94 % du seau « lot », une population CHOISIE et scannée exprès. On ne peut
        //      donc pas dire qu'aucune casse n'a eu lieu — on peut dire qu'on n'a pas
        //      regardé. Le premier principe interdit de compter ça comme un succès.
        //   5. UNE ERREUR PIRE QU'UN REFUS ... ⚠️ 2 erreurs sur 44 = deux prix FAUX affirmés
        //      là où l'utilisateur ne recevait rien. C'est le prix à accepter, explicitement.
        //
        // 🔑 CE QUI BLOQUE N'EST PLUS UN CHIFFRE, C'EST UNE POPULATION. Attendre plus de
        // trafic ne lèvera pas la condition 4 : il faut des vérités saisies À L'AVEUGLE sur
        // le HOLDOUT. Trois bornes restent vraies quoi qu'il arrive et doivent accompagner
        // toute citation du 42/44 : les 11 cartes du chantier sont dans les 44 (le jeu les
        // absorbe), 64 des 68 vérités viennent du lot, et `departager` reçoit au banc un
        // classement à `score: 0` là où la production lui passe les vrais scores.
        const NIVEAU_RESERVE = {
            'symbole-departage': 'forte',   // 12/12 justes — le symbole du set a désigné un seul ex aequo
            // ⚠️ FAIBLE, ET C'EST UN ARBITRAGE, PAS UN OUBLI. Le départage par l'image est
            // la réserve la MIEUX mesurée du projet avant même sa première ligne de
            // production : 41/44 sur la cellule, contre 10/44 au scoring, D+ 31 / D− 0,
            // p < 0,0001. Rien de tout ça n'autorise « forte ».
            //   · La mesure est un REJEU DE LABORATOIRE sur des vérités saisies à la main,
            //     pas du trafic. Zéro ligne de journal existe.
            //   · Le contrat est « quand l'outil affirme, il a raison ». 41/44, c'est un
            //     intervalle de Wilson de 80 % à 98 % : trois cartes sur quarante-quatre
            //     seraient AFFIRMÉES À TORT.
            //   · Le symbole, lui, a attendu 12/12 EN PRODUCTION avant d'être promu.
            // Elle se promeut au premier lot réel qui tient, et pas avant. C'est justement
            // pour ça que la table vit ici, côté serveur : la promotion ne demandera pas
            // de republier l'extension.
            'image-departage': 'faible',
            // ⚠️ FAIBLE, ET IL N'Y A MÊME PAS D'ARBITRAGE À FAIRE. Le départage par l'attaque
            // n'a AUCUNE mesure de justesse : zéro ligne de journal, zéro rejeu contre une
            // vérité. Ce qui est mesuré, c'est sa PORTÉE (16 groupes sur 45 réunissent des
            // métacartes différentes ; il isolerait un candidat unique 10 fois sur les 12 où
            // la vérité est dans le groupe), et la portée n'est pas la justesse. Il se
            // promeut au premier lot réel qui tient, comme le symbole a dû le faire — 12/12
            // EN PRODUCTION — et pas avant.
            'attaque-departage': 'faible',
            // Tout le reste est FAIBLE tant qu'aucune mesure ne justifie mieux :
            'perimetre-vintage-suggestion': 'faible',   // 10/16 justes — la classe la plus fréquente et la plus tiède
            'tcgdex-numero-incoherent': 'faible',       // 1/2 — deux lignes ne mesurent rien
            'egalite-sans-enjeu': 'faible',             // non mesurée isolément
            'numero-pokedex-neutralise': 'faible',      // non mesurée isolément
            'nom-numero-incoherents': 'faible',
            'aucun-candidat-au-numero': 'faible',
            'gagnant-contredit-le-numero': 'faible',
            'nom-confiance-basse': 'faible',
            'identification-locale-sans-tcgdex': 'faible',
            'lien-tcgdex-partage': 'faible',
            'tcgdex-ambigu': 'faible',
            // Les deux sorties de la contradiction A — FAIBLES par construction, et elles
            // le resteront tant qu'un lot n'aura pas mesuré leur justesse. Zéro ligne au
            // journal aujourd'hui : ce sont des classes NEUVES, pas des classes tièdes.
            'impression-corrigee': 'faible',     // non mesurée — B vient de changer le produit
            'impression-contredite': 'faible',   // non mesurée — on sait qu'on affiche peut-être la mauvaise impression
            // Ni numéro, ni TCGdex, ni variantes : le vivier le moins étayé de la chaîne.
            // Il ne pourra JAMAIS passer en « forte » — ce n'est pas une classe en attente
            // de mesure, c'est une classe dont la faiblesse est constitutive.
            'nom-seul-vintage': 'faible'
        };
        // ════════════════════════════════════════════════════════════════════
        // 📌 NOTE — NON DEMANDÉE AUJOURD'HUI, ÉCRITE POUR NE PAS ÊTRE REDÉCOUVERTE
        // ════════════════════════════════════════════════════════════════════
        // EXPOSER LA LISTE DES `raisonReserve` COMME `Object.keys(NIVEAU_RESERVE)` —
        // PRODUITE, ET JAMAIS RECOPIÉE.
        //
        // LE CONSTAT. L'extension porte une table de 9 entrées ; celle-ci en a 16. Sept
        // causes rendent donc une phrase générique côté utilisateur, dont `image-departage`,
        // qui est la mieux mesurée du projet.
        //
        // ⚠️ UN CONTRÔLE QUI COMPARERAIT LES DEUX TABLES A ÉTÉ ENVISAGÉ PUIS REFUSÉ, et la
        // raison du refus est plus utile que le contrôle : la famille `motif-${raison}` est
        // construite DYNAMIQUEMENT. Comparer deux ensembles finis repose donc sur une
        // prémisse fausse — l'ensemble des raisons émises n'est pas fini. Et l'exempter par
        // un `startsWith` rouvrirait exactement le trou qu'on venait de fermer.
        //
        // ⚠️ ET UNE LISTE TENUE À LA MAIN SERAIT UNE TROISIÈME SOURCE DE VÉRITÉ, créée pour
        // surveiller l'écart entre les deux premières. D'où « produite, jamais recopiée » :
        // la seule forme qui ne peut pas diverger est celle qui n'existe pas séparément.
        //
        // 🔑 LE TROU QU'AUCUNE DE CES FORMES N'ATTRAPE, et il faut l'écrire aussi : UNE CLÉ
        // STABLE DONT LE SENS DÉRIVE. On réordonne la cascade — c'est arrivé DEUX FOIS en
        // août — la clé ne bouge pas, et la phrase affichée par l'extension devient fausse.
        // Aucune comparaison d'ensembles ne peut voir ça : les deux ensembles restent égaux.
        // Défaut FAIBLE pour toute raison non listée — y compris `motif-<raison>`, qui est
        // construite dynamiquement. Ici le défaut est sûr : c'est le serveur qui décide, et
        // une raison qu'il ne s'est pas encore donné la peine de mesurer n'a rien prouvé.
        // ════════════════════════════════════════════════════════════════════
        // LE PLAFOND DU RANG 3 — la règle 1, appliquée pour la première fois
        // ════════════════════════════════════════════════════════════════════
        // CE QUI TENAIT DÉJÀ, ET CE QUI NE TENAIT PAS. `gagnantContreditNumero` entre dans
        // `carteAmbigue` depuis le début : une carte de rang 3 a TOUJOURS une réserve, c'est
        // structurel et vérifié sur le journal (5 lignes de rang 3, 5 avec réserve, 0 sans).
        // Ce qui ne tenait pas, c'est le NIVEAU. Les 4 lignes de rang 3 récentes portent
        // toutes `raisonReserve: 'symbole-departage'`, qui est classé FORTE — c'est-à-dire
        // le niveau qui autorise l'extension à quasi-affirmer. La réserve existait ; elle
        // ne freinait rien.
        //
        // RÈGLE 1 (voir le principe d'ordre plus haut) : une cause qui SAPE LA PRÉMISSE
        // d'une autre passe devant, quelle que soit sa spécificité. Le départage par
        // symbole suppose que le vivier contient la bonne carte ; un rang 3 dit que le
        // catalogue CONTREDIT le numéro lu pour le gagnant. On ne peut pas affirmer à
        // partir d'une prémisse qu'on sait attaquée.
        //
        // ⚠️ C'EST UN PLAFOND, PAS UN CHANGEMENT DE RAISON. `raisonReserve` reste
        // `symbole-departage` : les statistiques par raison restent additionnables avec
        // celles déjà au journal, et le changement d'ordre qui créerait un nouvel
        // instrument n'a pas lieu. Seul le niveau est borné, et seulement vers le bas —
        // ce plafond ne peut jamais promouvoir une réserve.
        //
        // ⚠️ CE N'EST PAS UN NO-OP, ET IL FAUT LE DIRE. Rejoué sur le journal : 4 des 12
        // lignes `symbole-departage` sont de rang 3 et sortiraient désormais FAIBLE au lieu
        // de FORTE. Ces 4 cartes faisaient partie du 12/12 juste — on perd donc de la
        // couverture sur des cartes qui étaient bonnes. C'est l'arbitrage déjà écrit dans
        // la règle de rétrogradation : mieux vaut perdre douze bonnes cartes que casser une
        // seule fois « quand l'outil affirme, il a raison ».
        //
        // ⚠️ ET LA CAUSE DE CES 4 LIGNES EST AILLEURS — voir la note sur `cardInfo.number`
        // dans scorerCandidatsLocal. Pichu #172, Cyndaquil #155, Hypno #097, Entei #244
        // sont des numéros de POKÉDEX : le rang 3 y est un faux positif né de ce que les
        // rangs sont calculés sur le numéro BRUT quand tout le reste de la chaîne utilise
        // `numeroCarte`, neutralisé. Ce plafond ne corrige pas cette divergence, il en
        // limite le dégât. Quand elle sera corrigée, le plafond redeviendra le no-op qu'il
        // aurait dû être.
        const niveauReserve = !carteAmbigue ? null
            : gagnantContreditNumero ? 'faible'
                : (NIVEAU_RESERVE[raisonReserve] ?? 'faible');

        // ════════════════════════════════════════════════════════════════════
        // LE CANDIDAT CONCURRENT — seulement quand il y a vraiment hésitation
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ IL N'EST RENVOYÉ QUE SUR UNE ÉGALITÉ, au sens de `sontExAequo` — LA définition
        // du scoring, pas un seuil inventé ici. Sur `perimetre-vintage-suggestion`, le
        // deuxième du classement est parfois à 105 points derrière (mesuré) : annoncer
        // « on hésite entre X et Y » serait un mensonge d'interface.
        // Hors égalité -> null. Pas d'approximation.
        //
        // ⚠️ `prixGuide` ET NON `prix`. C'est le prix du GUIDE local, pas le prix live que
        // l'extension lit pour le gagnant. Les deux ne sont pas sur le même axe et les
        // mettre côte à côte ferait croire à une comparaison qui n'en est pas une. Le nom
        // du champ est la seule barrière qui survit à la relecture.
        let concurrent = null;
        // COMBIEN SONT À ÉGALITÉ, gagnant compris. C'est ce qui distingue un DUEL d'une
        // FOULE, et sans lui `concurrent` ment par omission.
        // ⚠️ MESURÉ SUR UN CAS RÉEL : un Vileplume japonais sort avec SEPT candidats à 45
        // points. `concurrent` y désigne le deuxième de la liste triée, c'est-à-dire un
        // ex aequo ARBITRAIRE parmi six. Afficher « on hésite entre X et Y » sur cette
        // carte serait un mensonge d'interface — le genre de faute qui se voit sur la
        // capture d'écran d'un utilisateur et jamais dans nos mesures.
        // L'extension ne doit proposer un choix binaire que si nbExAequo vaut 2.
        let nbExAequo = null;
        if (classement.length > 1 && sontExAequo(classement[0].score, classement[1].score)) {
            nbExAequo = classement.filter(c => sontExAequo(c.score, classement[0].score)).length;
        }
        if (carteAmbigue && nbExAequo != null) {
            const c2 = classement[1];
            const p2 = produits.find(p => p.idProduct === c2.idProduct);
            concurrent = {
                idProduct: c2.idProduct,
                nom: p2 ? String(p2.name).split('[')[0].trim() : null,
                codeSet: codeSetsConnus.get(Number(c2.idExpansion)) ?? null,
                prixGuide: Number.isFinite(c2.prix) ? c2.prix : null
            };
        }

        // ════════════════════════════════════════════════════════════════════
        // LE NOM DU PRODUIT TARIFÉ — lu SUR le gagnant, pas à côté
        // ════════════════════════════════════════════════════════════════════
        // POURQUOI IL FALLAIT UN TROISIÈME NOM. La réponse en portait déjà deux, et AUCUN
        // n'était extrait du produit retenu :
        //   `nom`      = ce que l'IA a lu sur la photo (cardInfo.name)
        //   `nomExact` = le nom TCGdex, ou celui du gagnant du module LOCAL — figé plus
        //                haut, AVANT que le scoring produise `classement`
        // Sur la charge « Dark Ursaring », `nom` vaut "Dark Ursaring" et `nomExact` vaut
        // "Dark Porygon2" ; le produit 606889 s'appelle bien « Dark Porygon2 » au catalogue.
        // `nomExact` avait donc raison — PAR LE CHEMIN EMPRUNTÉ, pas par construction. C'est
        // un contrat implicite de plus, du même genre que « le premier du classement est le
        // gagnant », et il se rompra le jour où une décision tardive changera le gagnant.
        //
        // MESURÉ sur les 108 lignes de journal ayant un idProduct : sur DOUZE, le nom LU
        // désigne autre chose que le produit tarifé (Misty's Staryu -> Team Rocket's Archer,
        // Light Jolteon -> Lightning Energy, Mew -> Mew ex...). Le compte mélange deux
        // époques — plusieurs de ces cas ont été corrigés depuis — mais il donne l'ordre de
        // grandeur du piège.
        //
        // CE QUE ÇA CASSAIT, ET C'EST LE POINT. Le bloc de réserve faible repose sur une
        // prémisse FALSIFIABLE : « Si c'est bien X », l'utilisateur regarde sa photo et
        // confirme. Si X est ce que l'IA a lu, il confirme « oui, c'est bien un Dark
        // Ursaring » pendant qu'on lui affiche le prix d'un Dark Porygon2 : la vérification
        // ne vérifie plus rien, et elle RASSURE À TORT. Une prémisse falsifiable qui porte
        // sur la mauvaise proposition est pire qu'aucune vérification.
        //
        // ⚠️ C'EST LUI QUE LA PRÉMISSE DOIT NOMMER. Il est extrait de `produits` par
        // l'idProduct du gagnant : il ne PEUT pas diverger du produit tarifé, et il ne peut
        // pas être null (tout `classement[0]` vient de `produits`, y compris après le
        // re-classement du veto, qui remplace les deux ensemble).
        // `nomExact` reste dans la réponse pour qui s'en sert déjà, mais il sort de la
        // logique d'affichage : plus personne n'a à choisir entre deux noms dont l'un ment.
        const produitGagnant = produits.find(p => p.idProduct === classement[0]?.idProduct);
        const nomProduit = produitGagnant ? String(produitGagnant.name).split('[')[0].trim() : null;

        const etatMin = etatVintedVersCardmarket(vintedEtat);

        // ════════════════════════════════════════════════════════════════════
        // LE PRIX GUIDE RÉELLEMENT RETENU — l'autre moitié de la paire
        // ════════════════════════════════════════════════════════════════════
        // `prixLive` seul ne calibre rien : il lui faut son homologue guide, et il doit
        // s'agir du prix EXACTEMENT utilisé par la chaîne — même produit, même axe
        // normal/reverse. Le re-dériver plus tard depuis `guide_prix` donnerait une
        // TROISIÈME valeur, qui divergerait de celle-ci au premier changement de
        // `prixDeReference`. C'est le deuxième principe, appliqué à une mesure.
        //
        // ⚠️ LE CHEMIN À CANDIDAT UNIQUE NE PASSE PAS PAR LE SCORING, donc `classement[0]`
        // n'y porte pas de prix. Sans le repli ci-dessous, toutes ces lignes sortiraient
        // avec un guide nul — et la calibration se ferait alors uniquement sur les cartes
        // à plusieurs candidats, c'est-à-dire sur un échantillon biaisé, sans que rien ne
        // le dise. Un findOne indexé de plus vaut mieux qu'un biais invisible.
        const prixGuideRetenu = Number.isFinite(classement[0]?.prix)
            ? classement[0].prix
            : (classement[0]?.idProduct != null
                ? await getPrixGuideLocal(classement[0].idProduct,
                    impressionEstReverse(motifResolution.cible, cardInfo.reverse))
                : null);

        // JOURNAL — une ligne par scan, en base, hors chemin critique (pas de await).
        // C'est ICI que se joue la mesure qui compte : /api/identifier est le flux RÉEL,
        // celui de l'extension. Les prix restent vides sur cette route (c'est le
        // navigateur de l'utilisateur qui lit le live, le serveur ne voit jamais le prix
        // final) — d'où le renvoi du ratio par l'extension, à spécifier séparément.
        // ⚠️ ON GARDE L'IDENTIFIANT DE LA LIGNE, sans attendre son écriture. C'est lui que
        // l'extension renverra avec le prix live (voir /api/retour-live) : sans lui, un
        // retour ne pourrait être rapproché de son scan que par (userId, horodatage),
        // c'est-à-dire par une jointure approximative sur la seule donnée qui doit rester
        // exacte. Vaut null si Mongo n'est pas connecté — il n'y aura alors pas de ligne.
        const scanId = enregistrerScan({
            route: 'identifier',
            userId: req.credit?.userId,
            // Ce qui rend cette ligne revérifiable dans six mois — voir journal-scans.js.
            ...annonce,
            nom: cardInfo.name, numero: cardInfo.number, total: cardInfo.total,
            setCode: cardInfo.setCode, langue: cardInfo.language, rarete: cardInfo.rarete,
            idProduct: classement[0]?.idProduct,
            score: classement[0]?.score,
            nbCandidats: produits.length,
            // ⚠️ `confiance` N'EST PLUS ÉCRIT. Il valait
            // `(identificationConfiante && !carteAmbigue) ? 'haute' : 'basse'` — deux
            // notions dans un champ. Les 131 lignes déjà au journal le portent avec cette
            // ANCIENNE sémantique ; les nouvelles portent `margeConfortable`, qui n'est
            // PAS la même chose. Ne pas additionner les deux, ne pas relire les anciennes
            // comme des marges.
            margeConfortable: identificationConfiante,
            carteIncertaine: carteAmbigue,
            // ⚠️ LE PRIX DEMANDÉ, SUR LES SCANS ABOUTIS AUSSI — et pas seulement sur les
            // refus. C'est sur ces lignes-là qu'on pourra un jour rapprocher un prix
            // d'annonce du prix live du produit retenu, donc mesurer ce que vaut le guide.
            // `prixReference` et `ratio` restent nuls sur cette route : le serveur ne voit
            // jamais le prix final, et un ratio calculé sur le prix GUIDE serait une
            // troisième grandeur mélangée aux deux autres.
            prixVinted,
            // Le prix guide du gagnant, tel que la chaîne l'a utilisé. Sans lui, le prix
            // live renvoyé plus tard n'aurait rien à quoi se comparer.
            prixGuideRetenu,
            sourceIdentification: trouvaille.source || 'nom',
            identifieeEnLocal: identificationLocale,
            nomConfiance: cardInfo.nomConfiance,
            nomBrut: cardInfo.nomBrut,
            symboleSet: cardInfo.symboleSet,
            // Les six champs de l'état, tels que la RÉPONSE les rend — même construction.
            ...champsEtat(), ...champsCout(),
            voieCatalogue,
            motifEtat: motifResolution.etat,
            // ⚠️ LES TROIS ENTRÉES DE LA RÉSOLUTION DE MOTIF — voir journal-scans.js.
            // Sans elles on ne peut distinguer « le titre n'arrive pas » de « l'IA n'a rien
            // dit » de « l'IA a dit autre chose ». Trois causes, et le faux-et-affirmé du
            // Rayquaza du 2026-08-12 ne permettait d'en écarter aucune.
            titreAnnonce: title,
            motifIA: cardInfo.motif,
            motifCible: motifResolution.cible,
            // ⚠️ `reverseLu` EST LA LECTURE BRUTE, capturée avant le validateur TCGdex —
            // voir sa capture plus haut. Sans elle, la contradiction « l'IA lit reverse,
            // TCGdex confirme qu'une reverse existe, le produit retenu n'en est pas une »
            // n'est pas mesurable après coup : on ne saurait jamais ce que l'IA avait lu.
            reverseLu,
            reverseAnnuleeParTcgdex,
            // La règle du Pokédex a-t-elle tiré ? Journalisée sur les SUCCÈS comme sur les
            // refus : c'est elle qui met `numeroCarte` à null, donc qui retire d'un coup le
            // chemin setcode+numéro ET l'identification locale, qui exigent tous deux un
            // numéro. Sans ce champ, il fallait la recalculer hors ligne pour lire une ligne.
            estDex: avisDex.estDex,
            // ⚠️ LE GROUPE D'ÉGALITÉ ET LE VIVIER — voir journal-scans.js pour la raison,
            // et surtout pour l'avertissement : ces champs REMPLACENT le rejeu, ils ne le
            // complètent pas. `exAequoIds` est nul quand il n'y a pas eu d'égalité, et
            // c'est une information : le scoring a tranché.
            exAequoIds,
            vivierIds: produits.map(p => p.idProduct),
            vivierTaille: produits.length,
            // ⚠️ LA ROUTE QUI A TROUVÉ, ET CE QU'ELLE A RAPPORTÉ — les deux ensemble, jamais
            // l'une sans l'autre. `langueRoute` dit d'où vient la CARTE ; les deux champs
            // suivants disent si elle portait l'INFORMATION dont la garde A a besoin. Savoir
            // qu'une carte vient de [ja] sans savoir que ses `variantsDetailed` sont vides
            // ne permet de conclure ni sur la portée de la garde, ni sur ce que le repli
            // apporte réellement. C'est la combinaison qui mesure, pas la route seule.
            // ⚠️ `null` = TCGdex muet (identification locale ou setcode+numéro), à ne pas
            // confondre avec 'en'. Trois états, pas deux.
            langueRoute: trouvaille.langueRoute ?? null,
            // ⚠️ LA CARTE, pas l'expansion. `setTcgdex` plus bas vient de nos liens appris ;
            // celui-ci est l'identifiant que TCGdex a réellement rendu. Sans lui, aucune
            // route n'est rejouable — voir la note du champ dans journal-scans.js.
            carteTcgdexId: trouvaille.id ?? null,
            // Présence = le champ est revenu sous forme de tableau. Vacuité = il est revenu
            // VIDE, ce qui n'est pas la même chose et ne se déduit pas de la présence :
            // un tableau vide dit « cette carte n'a aucune impression routable », un champ
            // absent dit « je n'ai pas pu demander ». Premier principe.
            variantsDetailedPresent: Array.isArray(trouvaille.variantsDetailed),
            variantsDetailedNb: Array.isArray(trouvaille.variantsDetailed) ? trouvaille.variantsDetailed.length : null,
            // ⚠️ ELLE PART DANS LA RÉPONSE DEPUIS LE DÉBUT ET N'ÉTAIT PAS JOURNALISÉE.
            // Sans elle, aucune ligne du journal ne permet de sélectionner un scan passé
            // par la branche reverse : c'est ce qui a rendu impossible la cinquième
            // cellule du verrou. Voir journal-scans.js.
            strategieReverse,
            // Les deux signaux de rang, persistés : c'est ce qui permettra de mesurer
            // leur fréquence réelle sans dépendre des logs éphémères de Render.
            aucunCandidatAuNumero,
            nomNumeroIncoherents,
            totalHorsTailleDeSet,
            // Par quel lien l'identification est passée. Aucun changement de comportement :
            // ces trois champs sont la seule façon de mesurer, au tour suivant, ce que la
            // table close aura réellement corrigé.
            setCodeResolution,
            // POURQUOI le prix part avec réserve, en énumération fermée. Sans ce champ,
            // `carteIncertaine` dit qu'il y a une réserve et jamais laquelle : impossible
            // de compter un mécanisme plutôt qu'un autre, ni de savoir si une branche
            // neuve s'est déclenchée une seule fois.
            raisonReserve,
            niveauReserve,
            // Les onze champs du départage par l'image, à CHAQUE scan — y compris quand il
            // s'abstient, et surtout quand il s'abstient. Voir journal-scans.js.
            ...champsImage,
            concurrentIdProduct: concurrent?.idProduct ?? null,
            nbExAequo,
            // La phrase exacte rendue par le départage — y compris quand il N'A PAS
            // tranché. « aucun ex aequo ne porte ce symbole » est une mesure autant que
            // « il a tranché » : c'est elle qui dira si le signal sert ou s'il est inerte.
            symboleDepartage: symboleDepartageRaison,
            // Le departage par l'ATTAQUE : sa phrase, et ce que l'IA a lu.
            // La phrase part MEME quand il n'a pas tranche — sans elle, « l'attaque n'a
            // pas departage » et « il n'y avait pas d'egalite » sont indistinguables au
            // journal. C'est la lecon de `symboleDepartage`, appliquee le meme jour.
            attaqueDepartage: attaqueDepartageRaison,
            attaqueLue: cardInfo.attaque ?? null,
            attaqueBrute: cardInfo.attaqueBrute ?? null,
            attaqueConfiance: cardInfo.attaqueConfiance ?? null,
            // ⚠️ `parenteRetenue` n'est plus journalisé — supprimé le 2026-08-18 après
            // 0 occurrence sur 117 lignes. `parenteJournal` reste, il alimente la trace
            // `[setcode-diagnostic]` à la console. Voir journal-scans.js pour la raison.
            setTcgdex: lienGagnant.setTcgdex,
            idExpansionGagnante: classement[0]?.idExpansion ?? null,
            regionSource: lienGagnant.regionSource,
            rangGagnant: rangsScoring?.rangGagnant ?? null,
            // Écart entre le 1er et le 2e du classement : rend visibles les
            // identifications qui « tiennent à un fil » avant qu'un testeur les remonte.
            // L'écart du classement quand il y en a un ; sinon celui du chemin LOCAL, qui
            // départage lui aussi des candidats et dont l'égalité comptait autant.
            ecartScore: (classement.length > 1 && Number.isFinite(classement[0]?.score) && Number.isFinite(classement[1]?.score))
                ? classement[0].score - classement[1].score
                : (Number.isFinite(ecartScoreLocal) ? ecartScoreLocal : null)
        });

        // ⚓ JALON DU VERROU (« verdict ») — le cinquième et le seul qui ne soit pas un log :
        // c'est `success: true` qui le marque. Voir verrou/jalons.js.
        res.json({
            success: true,
            // ⚠️ L'IDENTIFIANT DE CE SCAN, à renvoyer avec le prix live sur /api/retour-live.
            // null = le journal n'a pas pu écrire (Mongo absent) : dans ce cas il n'y a
            // aucune ligne à compléter, et l'extension doit simplement ne rien renvoyer.
            // Il n'est PAS un secret, mais il n'est pas devinable : c'est ce qui empêche
            // d'attacher un prix à un scan qu'on ne possède pas.
            scanId,
            carte: {
                // ⚠️ LE GAGNANT EST NOMMÉ, PAS DÉDUIT D'UN ORDRE DE TABLEAU.
                // Il n'était lisible que dans `classement[0]`, c'est-à-dire par un contrat
                // IMPLICITE entre deux dépôts qui ne se voient pas : « le premier du
                // tableau est celui qu'on a retenu ». Il se trouve que c'est vrai — vérifié
                // par capture-reponse.js, qui relit la ligne de journal écrite par le scan
                // lui-même — mais un lecteur ne pouvait pas le savoir, et l'agent de
                // l'extension a eu raison de s'en inquiéter : si une décision tardive
                // changeait le gagnant sans réordonner, l'extension tariferait un AUTRE
                // produit, avec un verdict prononcé quand la réserve est forte.
                // Désormais c'est écrit. `classement` garde son ordre, mais plus personne
                // n'a besoin d'y croire.
                idProduct: classement[0]?.idProduct ?? null,
                // ⚠️ LE NOM À AFFICHER, ET LE SEUL QUI NE PUISSE PAS MENTIR sur ce qui est
                // tarifé : il est extrait du produit gagnant. C'est LUI que doit nommer la
                // prémisse « Si c'est bien X ». Voir le bloc au-dessus de `res.json`.
                nomProduit,
                // Ce que l'IA a lu sur la photo. À afficher comme une LECTURE, jamais comme
                // l'identité du produit tarifé — les deux divergent, et pas rarement.
                nom: cardInfo.name,
                // Le nom de l'identification (TCGdex ou module local), figé AVANT le
                // scoring. Conservé pour qui s'en sert déjà ; il peut valoir null.
                nomExact: trouvaille.nomExact,
                numero: cardInfo.number,
                total: cardInfo.total || null,
                setCode: cardInfo.setCode || null,
                rarete: cardInfo.rarete || null,
                langue: cardInfo.language,
                rareteElevee: cardInfo.rareteElevee,
                tcgdexId: trouvaille.id,
                // Incertain si TCGdex hésitait, s'il s'est manifestement trompé de carte,
                // OU si la carte a un motif de reverse qu'on n'a pas su cibler (le prix
                // peut alors varier d'un facteur 100 entre variantes — cf. Master Ball).
                ambigu: carteAmbigue,
                // ⚠️ LES DEUX AXES NE SE FUSIONNENT JAMAIS, et ce commentaire est là pour
                // qu'aucun refactor ne les rapproche. `ambigu` / `niveauReserve` disent la
                // confiance dans L'IDENTIFICATION — quelle carte c'est. Le verdict de prix
                // (bonne affaire ou non) est un AUTRE axe, calculé plus bas.
                // INVARIANT : un prix auquel on ne se fie pas ne porte AUCUN verdict, quelle
                // que soit la force de l'identification. Une identification forte n'autorise
                // pas un verdict de prix ; elle autorise seulement à nommer la carte.
                // Les fusionner produirait un verdict affirmé sur une prémisse non prouvée —
                // exactement ce que le contrat « quand l'outil affirme, il a raison » interdit.
                //
                // NIVEAU DE LA RÉSERVE : 'forte' | 'faible' | null (null = aucune réserve).
                // Le NIVEAU pilote le comportement de l'extension, la RAISON alimente son
                // texte. L'extension n'a jamais besoin de connaître la liste des raisons.
                niveauReserve,
                raisonReserve,
                // Le principal concurrent, UNIQUEMENT sur une vraie égalité de score. null
                // dès qu'un écart existe : hors égalité, « on hésite entre X et Y » serait
                // faux. `prixGuide` est le prix du GUIDE local — PAS le prix live du
                // gagnant, et les deux ne se comparent pas.
                concurrent,
                // ⚠️ COMBIEN SONT À ÉGALITÉ, gagnant compris. null = aucune égalité.
                // À LIRE AVANT `concurrent` : à 2, c'est un duel et le concurrent est LE
                // concurrent. À 7 — cas réel, mesuré — le concurrent est un ex aequo pris
                // parmi six, et proposer un choix binaire tromperait l'utilisateur.
                nbExAequo,
                // ⚠️ `margeConfortable` N'EST PAS DANS LA RÉPONSE, ET C'EST DÉLIBÉRÉ.
                // Il l'a été quelques heures, sous le nom `confianceIdentification`, en
                // mélangeant DEUX notions — la marge du classement et la présence d'une
                // réserve. Ce mélange a piégé son lecteur : parce que le champ tombait à
                // 'basse' pour TOUTE réserve, une consigne le prenant comme garde-fou
                // prioritaire sur `niveauReserve` aurait rétrogradé 100 % des réserves
                // fortes, en silence.
                // Il reste JOURNALISÉ, où il ne coûte rien et demeure mesurable. Mesuré sur
                // les 65 lignes récentes : UNE SEULE dirait quelque chose qu'`ambigu` ne dit
                // pas. Un champ dans un contrat entre deux dépôts qui ne se voient pas est
                // une invitation à s'en servir ; une ligne sur 65 ne la justifie pas.
                // On le remesurera au prochain lot ; s'il reste à ce niveau, on le
                // supprimera pour de bon.
                // Par quel signal la carte a été identifiée : 'nom', 'total+numero' (nom
                // écarté car halluciné ou inapparieable) ou 'catalogue-local' (TCGdex muet).
                sourceIdentification: trouvaille.source || 'nom',
                // ⚠️ true = identifiée SANS TCGdex, donc sans variantsDetailed : le motif de
                // reverse n'a pas pu être routé et l'écart de prix entre impressions peut
                // atteindre x100. L'extension doit présenter le prix avec réserve.
                identifieeEnLocal: identificationLocale,
                // Ce que l'IA dit de sa propre lecture du nom, et le nom brut qu'elle a lu.
                nomConfiance: cardInfo.nomConfiance || null,
                nomBrut: cardInfo.nomBrut || null,
                // Par quel signal les produits candidats ont été trouvés au catalogue.
                //   'setcode-numero'     -> clé exacte (code de set lu + numéro lu), le
                //                           chemin le plus direct : ni TCGdex ni nom
                //   'nom' | 'numero'
                //   'numero-substitue'   -> le vivier par nom ne pouvait pas contenir la
                //                           bonne carte (voir viviersAvecRangs)
                //   'local-nom-numero'   -> identification dans le seul catalogue local
                voieCatalogue,
                // ⚠️ SIGNAL DE PREMIÈRE CLASSE. true = AUCUN candidat, par aucune voie, ne
                // porte le numéro lu sur la photo. Le prix est livré, mais il ne peut pas
                // être celui de la carte scannée : l'extension doit le présenter comme
                // douteux, pas comme un verdict.
                aucunCandidatAuNumero,
                // ⚠️ SIGNAL DE PREMIÈRE CLASSE. true = le nom lu existe au catalogue à
                // d'autres numéros mais JAMAIS à celui qui a été lu. Une des deux lectures
                // est fausse et on ignore laquelle : l'extension doit livrer le prix SANS
                // verdict — ni bonne affaire, ni surcote.
                nomNumeroIncoherents,
                // 1 = le numéro du produit retenu correspond à celui lu ; 2 = inconnu ;
                // 3 = le catalogue le CONTREDIT. null = rien de lu, donc pas de rang.
                rangGagnant: rangsScoring?.rangGagnant ?? null
            },
            // ⚠️ CE BLOC EST DÉRIVÉ DE `champsEtat()`, IL NE RECALCULE PLUS RIEN.
            // Il portait sa propre copie de la règle du pire état ; le journal en aurait eu
            // une seconde, et les deux auraient divergé au premier changement de règle — on
            // aurait alors mesuré autre chose que ce qu'on affiche, sans que rien ne le
            // dise. Les NOMS de la réponse sont conservés tels quels : l'extension déployée
            // les lit, et les renommer casserait un contrat pour une raison interne.
            etat: (() => {
                const e = champsEtat();
                return {
                    estimeIA: e.etatEstimeIA,
                    confianceIA: e.etatConfianceIA,
                    defautsVus: e.defautsVus || [],
                    declareVendeur: e.etatVinted,
                    declareCardmarket: e.etatMin,
                    // L'état à retenir = le PIRE des deux avis (voir explication plus haut)
                    retenu: e.etatRetenu
                };
            })(),
            classement,
            // Champ ADDITIF (l'extension actuelle l'ignore, aucun champ existant ne
            // change) : dit à l'extension COMMENT lire le prix d'une reverse.
            //   'produit-distinct' -> le produit visé EST la reverse, lecture normale.
            //   'filtre-url'       -> même produit que la normale : il faut ajouter
            //                         isReverseHolo=Y à l'URL, sinon on lit le prix de
            //                         la commune (bug Pikachu 052 : 0,02 € affiché).
            //   null               -> pas de reverse attendue, ou données insuffisantes.
            reverse: {
                attendue: cardInfo.reverse === true,
                motif: motifResolution.cible,        // 'pokeball' n'existe pas ici : classes
                                                     // grossières 'ball' | 'masterball' |
                                                     // 'reverse-classique' | 'aucun' | null
                etat: motifResolution.etat,          // 'resolu' | 'aucun-motif' | 'non-resolu'
                strategie: strategieReverse
            },
            // Codes langue Cardmarket, pour que l'extension construise l'URL du live
            codeLangue: { EN: 1, FR: 2, DE: 3, ES: 4, IT: 5, ZH: 6, JP: 7, PT: 8, RU: 9, KR: 10 }[cardInfo.language] || 1
        });

    } catch (e) {
        console.error("❌ [identifier]", e.message);
        // ⚠️ ON REMBOURSE MAINTENANT — voir rembourserSiRienLivre, au-dessus de NATURE_REFUS.
        // `natureRefus: 'echec-technique'` reste juste : c'est une panne, pas un refus
        // délibéré. Mais une panne n'a jamais eu à être facturée.
        const rendu = await rembourserSiRienLivre(req, res, 'erreur-serveur');
        // ⚠️ LE MESSAGE VA AU JOURNAL, ET SEULEMENT LÀ. Les deux Dragonite du 2026-08-03
        // sont indiagnosticables parce que leur exception n'existait que dans les logs
        // Render. La PREMIÈRE LIGNE DE PILE accompagne le message : sans elle on saurait
        // « quoi » sans savoir « où ». La réponse HTTP, elle, garde son texte générique.
        enregistrerEchec({
            route: 'identifier', userId: req.credit?.userId, ...annonce, cardInfo,
            motifEchec: 'erreur-serveur', rembourse: rendu,
            messageErreur: `${e?.message ?? e} @ ${String(e?.stack ?? '').split('\n')[1]?.trim() ?? '?'}`
        });
        // ⚠️ LE MESSAGE BRUT NE SORT PAS. Il reste au log ; la réponse ne porte qu'un texte
        // générique. Le 4 août, un utilisateur a lu dans son extension
        // « memeCodeParConventionX is not a function » : le nom d'une fonction interne, une
        // information qui ne l'aide en rien et qui décrit notre code à qui la reçoit.
        // ⚠️ `champsDeRefus` reçoit la valeur RÉELLE `rendu`, jamais `false` en dur : le
        // champ `rembourse` de la réponse est lu par l'extension pour son texte, et lui
        // faire annoncer un non-remboursement qui a eu lieu serait une seconde source de
        // vérité sur l'état du compte.
        if (!res.headersSent) res.json({ success: false, ...champsDeRefus('erreur-serveur', rendu), error: "Erreur serveur interne" });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// LE RETOUR DU PRIX LIVE — la seule mesure qui puisse calibrer un seuil
// ════════════════════════════════════════════════════════════════════════════
// POURQUOI UNE ROUTE À PART, et pas un champ de plus sur /api/identifier : l'extension
// ne CONNAÎT pas le prix live au moment du scan. Il lui faut l'idProduct — donc la
// réponse — pour savoir quoi lire sur Cardmarket. Le prix live n'existe qu'après.
//
// CE QU'IL SERT À MESURER. Le prix guide dont dispose ce serveur et le prix live que
// paie l'utilisateur sont DEUX MESURES DU MÊME OBJET : même idProduct, deux sources.
// C'est leur rapport, et lui seul, qui peut dire de combien le guide s'écarte du réel —
// donc calibrer la marge de la règle de la fourchette. `prixVinted` ne le peut pas : ce
// n'est pas une mesure de la carte, c'est la chose qu'on juge.
// ⚠️ La calibration se lit dans la QUEUE HAUTE du rapport, jamais dans sa médiane —
// l'explication complète est dans journal-scans.js, sur le champ `prixLive`.
//
// ⚠️ AUCUN CRÉDIT N'EST DÉBITÉ. `verifierJeton` seul, pas `verifierAcces` : renvoyer une
// mesure ne doit rien coûter, sinon personne ne la renvoie et la donnée n'existe jamais.
//
// TROIS GARDES, ET SANS ELLES CETTE ROUTE EMPOISONNERAIT LA SEULE DONNÉE QUI DOIT RESTER
// PROPRE — elle accepterait des prix arbitraires pour des scans arbitraires :
//   1. le scanId doit EXISTER ;
//   2. il doit APPARTENIR au userId qui poste — sinon n'importe qui pourrait écrire dans
//      la ligne d'un autre, et l'identifiant, qui voyage dans une réponse HTTP, n'est pas
//      un secret ;
//   3. un SECOND retour sur le même scanId est REFUSÉ. Pas « écrasé » : refusé. Un prix
//      live est une observation datée ; la remplacer effacerait la première sans trace, et
//      autoriserait à pousser une valeur jusqu'à ce qu'elle arrange.
// Les trois rendent un code HTTP distinct, pour que l'extension puisse les distinguer
// sans lire le texte.
app.post('/api/retour-live', limiteurIA, verifierJeton, async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: "Service momentanément indisponible" });
        }
        const userId = req.body?.userId ? String(req.body.userId).slice(0, 80) : null;
        const scanId = req.body?.scanId ? String(req.body.scanId) : null;
        if (!userId || !scanId) {
            return res.status(400).json({ success: false, error: "userId et scanId sont requis" });
        }
        // Un identifiant mal formé n'atteint pas Mongo : `findOne` lèverait un CastError
        // qui sortirait en 500, c'est-à-dire en « panne serveur » pour une faute d'entrée.
        if (!mongoose.Types.ObjectId.isValid(scanId)) {
            return res.status(400).json({ success: false, error: "scanId invalide" });
        }
        // ⚠️ UN 0 N'EST PAS UN PRIX, c'est une absence de cotation — même règle que le
        // guide, où un `trend: 0` a déjà produit un « 0 € » gagnant par défaut.
        const prixLive = Number(req.body?.prixLive);
        if (!Number.isFinite(prixLive) || prixLive <= 0) {
            return res.status(400).json({ success: false, error: "prixLive doit être un nombre strictement positif" });
        }
        // ÉNUMÉRATION FERMÉE, la même que le reste de la chaîne (ORDRE_ETATS). Un état
        // libre rendrait la stratification impossible au moment où elle servira.
        const etat = req.body?.prixLiveEtat ? String(req.body.prixLiveEtat).toUpperCase() : null;
        if (etat && !ORDRE_ETATS.includes(etat)) {
            return res.status(400).json({ success: false, error: `prixLiveEtat doit être l'un de ${ORDRE_ETATS.join(', ')}` });
        }
        const codeLangue = Number(req.body?.prixLiveCodeLangue);
        const codeLangueValide = Number.isInteger(codeLangue) && codeLangue >= 1 && codeLangue <= 10 ? codeLangue : null;

        // ════════════════════════════════════════════════════════════════════
        // D'OÙ VIENT LE PRIX — ajouté le 2026-09-03, sur signalement de l'extension
        // ════════════════════════════════════════════════════════════════════
        // 🔑 SANS CE CHAMP, LA MESURE QU'ON ATTEND DE CETTE ROUTE SERAIT FAUSSE, ET
        // SILENCIEUSEMENT. `resultat.price` a TROIS origines côté extension :
        //   'grille'                  -> plancher lu sur les offres réelles. C'est un PRIX.
        //   'plancher-toutes-langues' -> le « De » de la fiche, toutes langues confondues.
        //                                Un prix, mais pas celui de la langue visée.
        //   'tendance'                -> dernier recours. ⚠️ CE N'EST PAS UN PRIX D'OFFRE,
        //                                c'est une moyenne calculée par Cardmarket.
        // Comparer le guide à une TENDANCE, c'est comparer une moyenne à une moyenne : on
        // mesurerait l'accord de deux estimations, pas l'écart au marché. Le rapport
        // ressemblerait à ×1,00 et on en conclurait « le guide est juste ».
        //
        // ⚠️ ÉNUMÉRATION FERMÉE, comme `prixLiveEtat` : une valeur libre rendrait la
        // stratification impossible au moment précis où elle servira.
        // ⚠️ ET ON N'ÉCARTE RIEN À L'ÉCRITURE — décision du testeur, et elle est juste :
        // écarter les tendances ici ferait perdre une classe entière avant de l'avoir
        // regardée. On STOCKE tout, on TRIE à la lecture. C'est le même raisonnement que
        // `sourcesEnPanne` : on enregistre le fait, on décide ensuite ce qu'on en fait.
        const ORIGINES_PRIX = ['grille', 'plancher-toutes-langues', 'tendance'];
        const originePrix = req.body?.originePrix ? String(req.body.originePrix).trim().toLowerCase() : null;
        if (originePrix && !ORIGINES_PRIX.includes(originePrix)) {
            return res.status(400).json({ success: false, error: `originePrix doit être l'un de ${ORIGINES_PRIX.join(', ')}` });
        }
        // ⚠️ `null` EST ACCEPTÉ, ET IL VEUT DIRE « ON NE SAIT PAS », JAMAIS « grille ».
        // Les extensions déjà déployées ne l'envoient pas : leur donner un défaut ferait
        // passer des tendances pour des planchers d'offres. Un défaut ici fabriquerait
        // exactement l'erreur que ce champ existe pour empêcher.
        if (!originePrix) {
            console.warn(`⚠️ [retour-live] scan ${scanId} : \`originePrix\` absent — la ligne`
                + ` entrera dans « origine inconnue », pas dans « grille ».`);
        }

        // ════════════════════════════════════════════════════════════════════
        // LA FORME DE L'OFFRE — tendance, prix NM, grille, et deux entiers
        // ════════════════════════════════════════════════════════════════════
        // `prixLive` est un PLANCHER : il ne dit rien de ce qu'il y a autour. Ces champs
        // disent la forme, et ils servent à calibrer des gardes de cohérence côté
        // extension — la mesure se fait ici parce que c'est ici que les données
        // s'accumulent.
        // ⚠️ AUCUNE GARDE N'EST CÂBLÉE DESSUS. Mesuré d'abord : sur les 75 959 produits du
        // guide, 62,6 % n'ont AUCUNE cotation holo et 27,9 % ont un trend ≤ 0,20 €. Une
        // grille plate est partagée par 10,3 % du catalogue : elle dit « carte commune »,
        // pas « erreur ». On collecte, on ne conclut pas.
        const nbPositif = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
        const prixLiveTendance = nbPositif(req.body?.prixLiveTendance);
        const prixLiveNM = nbPositif(req.body?.prixLiveNM);

        // LA GRILLE, si elle est envoyée. Clés VALIDÉES sur ORDRE_ETATS : une clé libre
        // rendrait la stratification impossible plus tard, et Mongo accepterait n'importe
        // quoi dans une Map.
        let grilleLive = null;
        const brute = req.body?.grilleLive;
        if (brute && typeof brute === 'object' && !Array.isArray(brute)) {
            const g = {};
            for (const [k, v] of Object.entries(brute)) {
                const e = String(k).toUpperCase();
                const p = nbPositif(v);
                if (ORDRE_ETATS.includes(e) && p != null) g[e] = p;
            }
            if (Object.keys(g).length) grilleLive = g;
        }

        // ⚠️ UNE SEULE SOURCE POUR LES DEUX ENTIERS. Quand la grille est là, ils s'en
        // DÉDUISENT — les accepter en plus créerait deux versions du même fait, qui
        // divergeraient au premier bug de l'extension sans que personne ne le voie.
        // Un désaccord est tracé : c'est un signal sur l'extension, pas sur la carte.
        let grilleNbEtats = null, grilleValeursDistinctes = null;
        if (grilleLive) {
            const vals = Object.values(grilleLive);
            grilleNbEtats = vals.length;
            grilleValeursDistinctes = new Set(vals).size;
            const dEtats = Number(req.body?.grilleNbEtats);
            const dDistinctes = Number(req.body?.grilleValeursDistinctes);
            if ((Number.isFinite(dEtats) && dEtats !== grilleNbEtats)
                || (Number.isFinite(dDistinctes) && dDistinctes !== grilleValeursDistinctes)) {
                console.warn(`⚠️ [retour-live] les compteurs envoyés contredisent la grille :`
                    + ` reçus ${dEtats}/${dDistinctes}, déduits ${grilleNbEtats}/${grilleValeursDistinctes}.`
                    + ` La GRILLE fait foi.`);
            }
        } else {
            // Pas de grille : on prend les entiers tels quels, ce sont les seuls témoins.
            const e = Number(req.body?.grilleNbEtats);
            const d = Number(req.body?.grilleValeursDistinctes);
            grilleNbEtats = Number.isInteger(e) && e >= 0 ? e : null;
            grilleValeursDistinctes = Number.isInteger(d) && d >= 0 ? d : null;
        }

        // GARDE 1 + 2 EN UNE SEULE ÉCRITURE CONDITIONNELLE, et c'est délibéré : un
        // findOne suivi d'un update laisserait une fenêtre entre la vérification et
        // l'écriture. La garde 3 (`prixLive` absent) y est incluse pour la même raison —
        // deux retours simultanés sur le même scanId ne peuvent pas passer tous les deux.
        const maj = await JournalScan.findOneAndUpdate(
            { _id: scanId, userId, prixLive: null },
            {
                $set: {
                    prixLive, prixLiveEtat: etat, prixLiveCodeLangue: codeLangueValide,
                    prixLiveTendance, prixLiveNM, grilleLive,
                    grilleNbEtats, grilleValeursDistinctes,
                    originePrix,
                    retourLe: new Date()
                }
            },
            { new: true }
        ).lean();

        if (!maj) {
            // L'écriture conditionnelle a échoué : on relit pour DIRE LAQUELLE des trois
            // gardes a mordu. Un refus qui ne dit pas pourquoi est un refus qu'on ne peut
            // pas corriger — et l'extension a besoin de distinguer « scan inconnu » (bug
            // de son côté) de « déjà renvoyé » (comportement normal, à ne pas réessayer).
            const ligne = await JournalScan.findById(scanId, { userId: 1, prixLive: 1 }).lean();
            if (!ligne) {
                return res.status(404).json({ success: false, error: "scanId inconnu" });
            }
            if (ligne.userId !== userId) {
                console.warn(`🚫 [retour-live] ${userId} tente d'écrire dans le scan de ${ligne.userId} (${scanId}).`);
                return res.status(403).json({ success: false, error: "Ce scan n'appartient pas à cet utilisateur" });
            }
            return res.status(409).json({ success: false, error: "Un prix live a déjà été renvoyé pour ce scan" });
        }

        console.log(`💶 [retour-live] scan ${scanId} · idProduct ${maj.idProduct ?? '?'} · live ${prixLive} €` +
            ` · état ${etat || '?'} · langue ${codeLangueValide ?? '?'}` +
            ` · origine ${originePrix ?? 'INCONNUE'}` +
            ` · tendance ${prixLiveTendance ?? '—'} · NM ${prixLiveNM ?? '—'}` +
            ` · grille ${grilleNbEtats ?? '—'} état(s)/${grilleValeursDistinctes ?? '—'} valeur(s)`);
        res.json({ success: true });
    } catch (e) {
        console.error("❌ [retour-live]", e.message);
        // Message brut au log, jamais dans la réponse — voir /api/identifier.
        res.status(500).json({ success: false, error: "Erreur serveur interne" });
    }
});

// Enregistre ce que l'extension a lu en live : le code set et le numéro réel d'un
// idProduct. C'est ainsi que la base s'enrichit — depuis les navigateurs des
// utilisateurs, une carte à la fois, sans jamais scraper en masse.
app.post('/api/apprendre', verifierJeton, async (req, res) => {
    try {
        const { idProduct, idExpansion, numero } = req.body;
        // Décodé à l'entrée : le userscript l'extrait d'une URL d'image (voir decoderCodeSet).
        const codeSet = decoderCodeSet(req.body.codeSet);
        if (!idProduct) return res.json({ success: false });

        if (codeSet && idExpansion) await memoriserCodeSet(idExpansion, codeSet);

        if (numero) {
            await NumeroCarte.findOneAndUpdate(
                { idProduct },
                {
                    $set: {
                        idProduct, idExpansion, numero: String(numero), codeSet,
                        source: 'cardmarket',   // vu en direct = fait foi
                        certitude: 'exacte',
                        apprisLe: new Date()
                    }
                },
                { upsert: true }
            );
            console.log(`🧠 [apprendre] idProduct ${idProduct} -> n°${numero} (${codeSet || '?'})`);
        }
        res.json({ success: true });
    } catch (e) {
        console.error("❌ [apprendre]", e.message);
        // Message brut au log, jamais dans la réponse — voir /api/identifier.
        res.json({ success: false, error: "Erreur serveur interne" });
    }
});
// Apprentissage par LOT depuis le userscript. Règle de priorité :
//  - déjà source:'cardmarket' (exact) -> INTACT, on ne le retouche pas
//  - source:'tcgdex' (heuristique) ou sans source (vieux Puppeteer allégé)
//    -> ÉCRASÉ par la lecture exacte Cardmarket (nomFr/variante/slug en bonus)
//  - absent -> inséré
// On ignore les cartes sans numéro lisible (elles n'aident pas le scoring).
app.post('/api/apprendre-lot', verifierJeton, async (req, res) => {
    try {
        const { cartes } = req.body;
        if (!Array.isArray(cartes) || cartes.length === 0) {
            return res.json({ success: false, error: "Aucune carte reçue" });
        }

        // ════════════════════════════════════════════════════════════════════
        // LE numeroUrl EST RECALCULÉ ICI — le client ne décide plus
        // ════════════════════════════════════════════════════════════════════
        // Le client envoyait son propre `numeroUrl` et on le stockait tel quel. Or il
        // existe DEUX clients (le userscript Tampermonkey et live-cardmarket.js), chacun
        // avec sa copie de la règle d'extraction, donc chacun capable de réintroduire les
        // bugs qu'on vient de corriger sur 20 917 documents : la query string prise pour un
        // numéro ("?language=2" -> "2") et les chiffres du code de set avalés
        // ("sI100340" -> "100340" au lieu de 340).
        // La règle vit maintenant à UN seul endroit (scoring.numeroDepuisSlug) et c'est le
        // serveur qui l'applique. Un client resté à l'ancienne version ne peut plus abîmer
        // la base : son numeroUrl est ignoré, et le slug est nettoyé de sa query string.
        let numeroUrlRecalcules = 0;
        for (const c of cartes) {
            if (typeof c.slug === 'string' && c.slug) c.slug = c.slug.split('?')[0];
            const recalcule = numeroDepuisSlug(c.slug, c.codeSet);
            if (String(recalcule ?? '') !== String(c.numeroUrl ?? '')) numeroUrlRecalcules++;
            c.numeroUrl = recalcule;
        }
        if (numeroUrlRecalcules) {
            console.log(`🔧 [apprendre-lot] ${numeroUrlRecalcules}/${cartes.length} numeroUrl recalculés depuis le slug — la règle du serveur fait foi.`);
        }

        // Cartes exploitables = celles qui ont au moins un numéro (titre ou URL)
        const lisibles = cartes.filter(c => c.idProduct && (c.numero || c.numeroUrl));
        const sansNumero = cartes.length - lisibles.length;

        const ids = [...new Set(lisibles.map(c => Number(c.idProduct)).filter(Boolean))];
        if (ids.length === 0) {
            return res.json({ success: true, recus: cartes.length, nouvelles: 0, ameliorees: 0, dejaExactes: 0, sansNumero });
        }

        // idExpansion déduit du catalogue (comme apprendreUnSet)
        let idExpansion = null;
        if (mongoose.connection.readyState === 1) {
            const ref = await CatalogueProduit.findOne({ idProduct: { $in: ids } }).lean();
            idExpansion = ref?.idExpansion ?? null;
        }

        // Source actuelle de chaque idProduct déjà en base
        const existants = await NumeroCarte.find({ idProduct: { $in: ids } }, { idProduct: 1, source: 1 }).lean();
        const sourceParId = new Map(existants.map(d => [d.idProduct, d.source || null]));

        // Classement : exact -> intact ; reste -> à écrire
        const aEcrire = [];
        let nouvelles = 0, ameliorees = 0, dejaExactes = 0;
        for (const c of lisibles) {
            const id = Number(c.idProduct);
            if (!sourceParId.has(id))                        { aEcrire.push(c); nouvelles++; }
            else if (sourceParId.get(id) !== 'cardmarket')   { aEcrire.push(c); ameliorees++; }
            else                                             { dejaExactes++; } // déjà exact -> on n'y touche pas
        }

        if (aEcrire.length > 0) {
            const ops = aEcrire.map(c => ({
                updateOne: {
                    filter: { idProduct: Number(c.idProduct) },
                    // $set (pas $setOnInsert) : on VEUT écraser une entrée heuristique
                    // par la donnée exacte. Les entrées 'cardmarket' sont déjà exclues.
                    update: {
                        $set: {
                            idProduct:   Number(c.idProduct),
                            idExpansion: idExpansion != null ? Number(idExpansion) : null,
                            numero:      c.numero    != null ? String(c.numero)    : null,
                            numeroUrl:   c.numeroUrl != null ? String(c.numeroUrl) : null,
                            // Décodé à l'entrée : le lot vient d'URLs d'images (voir decoderCodeSet)
                            codeSet:     decoderCodeSet(c.codeSet) || null,
                            nomFr:       c.nomFr    || null,
                            variante:    c.variante || null,
                            slug:        c.slug     || null,
                            slugSet:     c.slugSet  || null,
                            source:      'cardmarket',
                            certitude:   'exacte'
                        }
                    },
                    upsert: true
                }
            }));
            await NumeroCarte.bulkWrite(ops, { ordered: false });

            const cs = aEcrire.find(c => c.codeSet)?.codeSet || null;
            if (cs && idExpansion != null) await memoriserCodeSet(Number(idExpansion), cs);
        }

        // COUVERTURE DE L'EXPANSION, renvoyée au client. Sans elle, l'utilisateur qui
        // tourne les pages d'une galerie ne sait pas quand il a fini — et c'est justement
        // la couverture des numéros qui décide si le chemin local peut identifier une
        // carte : 43 expansions à 0 % sont la cause de tous les échecs récents.
        let couverture = null;
        if (idExpansion != null && mongoose.connection.readyState === 1) {
            const idsExp = (await CatalogueProduit.find({ idExpansion: Number(idExpansion) }, { idProduct: 1 }).lean())
                .map(x => x.idProduct);
            const avecNumero = idsExp.length
                ? await NumeroCarte.countDocuments({ idProduct: { $in: idsExp }, numero: { $type: 'string', $ne: '' } })
                : 0;
            couverture = {
                produits: idsExp.length,
                avecNumero,
                pourcent: idsExp.length ? Math.round(100 * avecNumero / idsExp.length) : null
            };
        }

        console.log(`🧠 [apprendre-lot] ${nouvelles} nouv. / ${ameliorees} améliorées / ${dejaExactes} déjà exactes (exp ${idExpansion ?? '?'})`
            + (couverture ? ` — couverture ${couverture.avecNumero}/${couverture.produits} (${couverture.pourcent} %)` : ''));
        res.json({ success: true, recus: cartes.length, nouvelles, ameliorees, dejaExactes, sansNumero, idExpansion, couverture });
    } catch (e) {
        console.error("❌ [apprendre-lot]", e.message);
        // Message brut au log, jamais dans la réponse — voir /api/identifier.
        res.json({ success: false, error: "Erreur serveur interne" });
    }
});
// ============================================================
// PAIEMENT — recharges de scans via Stripe Checkout
// ============================================================

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
    console.warn("⚠️ STRIPE_SECRET_KEY absent — les routes de paiement répondront 503.");
}

// SOURCE DE VÉRITÉ des packs, côté SERVEUR uniquement. Le client n'envoie qu'un packId :
// s'il pouvait envoyer le nombre de scans, il suffirait de le modifier dans la requête
// pour s'offrir 100 000 scans au prix de 20.
//
// ════════════════════════════════════════════════════════════════════════════
// LES price_id VIENNENT DE L'ENVIRONNEMENT, PLUS DU CODE
// ════════════════════════════════════════════════════════════════════════════
// POURQUOI. Un price_id est un identifiant D'ENVIRONNEMENT : celui de Test et celui de
// Live sont deux objets différents chez Stripe, et une clé Live avec un price de Test
// échoue à la création de session. Les écrire dans le code obligeait à modifier le code
// pour passer en production — c'est-à-dire à faire un déploiement dont le SEUL but est de
// changer quatre chaînes, avec toutes les occasions d'erreur que ça implique.
// Le nombre de scans, LUI, reste dans le code : c'est une décision produit, pas une
// coordonnée d'environnement, et il ne doit pas pouvoir changer sans revue.
//
// ⚠️ FAIL-CLOSED, ET C'EST DÉLIBÉRÉ. Un pack dont le price_id est absent n'est pas vendu :
// aucun repli sur une valeur codée en dur. Un repli silencieux ferait payer le prix de
// Test en production, ou l'inverse — et personne ne s'en apercevrait avant le premier
// relevé. Mieux vaut une route qui refuse bruyamment qu'un paiement au mauvais tarif.
const PACKS = {
    p20: { price: process.env.STRIPE_PRICE_P20, scans: 20 },
    p50: { price: process.env.STRIPE_PRICE_P50, scans: 50 },
    p100: { price: process.env.STRIPE_PRICE_P100, scans: 100 },
    p200: { price: process.env.STRIPE_PRICE_P200, scans: 200 }
};
// AU DÉMARRAGE, ON DIT CE QUI EST VENDABLE. Sans cette ligne, un price_id oublié se
// découvrirait au premier client qui essaie de payer.
{
    const configures = Object.entries(PACKS).filter(([, p]) => p.price);
    const manquants = Object.keys(PACKS).filter(k => !PACKS[k].price);
    if (manquants.length) {
        console.warn(`⚠️ [stripe] ${manquants.length} pack(s) SANS price_id — non vendables : ${manquants.join(', ')}`);
        console.warn(`   Pose STRIPE_PRICE_P20 / P50 / P100 / P200 dans l'environnement.`);
    }
    if (stripe) {
        // Le mode de la CLÉ, pour qu'une clé Live avec des prix de Test se voie tout de suite.
        const mode = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'LIVE' : 'TEST';
        // ⚠️ LE SECRET DE WEBHOOK EST ANNONCÉ ICI, et c'est le plus important des cinq.
        // C'est le SEUL réglage dont l'absence ou l'erreur ne se voit NULLE PART tant qu'un
        // vrai paiement n'a pas échoué : la clé, les prix et l'URL des CGV se manifestent à
        // la création de la session, donc avant que le client paie. Le secret de webhook,
        // lui, n'intervient qu'APRÈS — le client a payé, la signature est rejetée, le
        // crédit n'a jamais lieu, et Stripe réessaie trois jours en silence.
        // On ne peut pas vérifier qu'il est le BON (seul un événement réel le dirait), mais
        // on peut dire qu'il est là et à quel mode il ressemble.
        const wh = String(process.env.STRIPE_WEBHOOK_SECRET || '');
        const etatWh = !wh ? '❌ ABSENT — aucun paiement ne sera crédité'
            : (wh.startsWith('whsec_') ? `présent (${wh.slice(0, 11)}…)` : '⚠️ présent mais ne commence pas par whsec_');
        console.log(`💳 [stripe] clé ${mode} · ${configures.length}/4 pack(s) configuré(s) · secret webhook : ${etatWh}`);
        if (!wh) {
            console.error(`❌ [stripe] STRIPE_WEBHOOK_SECRET manquant : les clients pourront PAYER sans être crédités.`);
        }
    }
}

// Crée une session de paiement et renvoie l'URL Stripe où rediriger l'utilisateur.
// Ne crédite RIEN : le crédit n'a lieu que dans le webhook signé, après paiement confirmé.
app.post('/api/creer-recharge', limiteurPaiement, verifierJeton, async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ success: false, error: "Paiement indisponible" });

        const userId = req.body && req.body.userId ? String(req.body.userId).slice(0, 80) : null;
        if (!userId) return res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });

        const pack = PACKS[req.body && req.body.packId];
        if (!pack) return res.status(400).json({ success: false, error: "Pack inconnu" });
        // Pack connu mais price_id absent de l'environnement : on REFUSE plutôt que de
        // créer une session qui échouerait chez Stripe avec un message technique.
        if (!pack.price) {
            console.error(`❌ [recharge] pack ${req.body.packId} sans price_id — vérifie STRIPE_PRICE_* dans l'environnement`);
            return res.status(503).json({ success: false, error: "Ce pack est momentanément indisponible" });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: pack.price, quantity: 1 }],
            client_reference_id: userId,
            // metadata : c'est ce que le webhook relira pour savoir QUI créditer et de
            // COMBIEN. Écrit ici par le serveur à partir de PACKS, donc non falsifiable.
            metadata: { userId, scans: String(pack.scans) },
            // ⚠️ ACCEPTATION EXPLICITE DES CONDITIONS DE VENTE. Vente à des consommateurs
            // dans l'UE : le consentement doit être un acte positif, et il doit être
            // PROUVABLE. Stripe horodate l'acceptation et la conserve sur la session, ce
            // qu'aucune case cochée dans l'extension ne ferait aussi bien.
            // ⚠️ DÉPENDANCE : Stripe REFUSE la création de session si l'URL des conditions
            // n'est pas renseignée dans le Dashboard (Paramètres > Informations publiques).
            // À poser AVANT de déployer, sinon toutes les recharges tombent en 500.
            consent_collection: { terms_of_service: 'required' },
            success_url: `${process.env.SITE_URL}/merci`,
            cancel_url: `${process.env.SITE_URL}/annule`
        });

        console.log(`💳 [recharge] session créée pour ${userId} — pack ${req.body.packId} (${pack.scans} scans)`);
        res.json({ url: session.url });
    } catch (e) {
        console.error("❌ [creer-recharge]", e.message);
        res.status(500).json({ success: false, error: "Impossible de créer la session de paiement" });
    }
});

// Webhook Stripe — SEUL endroit où des scans payants sont crédités.
// Pas de verifierJeton : l'appelant est Stripe, pas l'extension ; c'est la SIGNATURE
// cryptographique qui authentifie. Le corps arrive BRUT (Buffer) grâce au express.raw()
// monté tout en haut du fichier, avant express.json().
// Déclaration de fonction (hoistée) : voir le app.post() en tête de fichier.
async function gererWebhookStripe(req, res) {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        console.error("❌ [webhook] Stripe non configuré (clé ou secret webhook manquant)");
        return res.status(503).send('Stripe non configuré');
    }

    // 1) Authentification par signature. Tant que ceci n'a pas réussi, le contenu du
    // corps est celui d'un inconnu : on ne le lit même pas.
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (e) {
        console.warn(`🚫 [webhook] signature invalide : ${e.message}`);
        return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type !== 'checkout.session.completed') {
        return res.json({ recu: true }); // event non concerné : accusé de réception, rien à faire
    }

    const session = event.data.object;
    const userId = session.metadata?.userId || session.client_reference_id || null;
    const scans = parseInt(session.metadata?.scans || '0', 10);

    if (!userId || !Number.isFinite(scans) || scans <= 0) {
        // Rien d'exploitable : on ACQUITTE quand même (200), sinon Stripe rejouerait
        // indéfiniment un event que le rejeu ne réparera pas.
        console.error(`❌ [webhook] metadata inutilisable (userId=${userId}, scans=${scans}) — event ${event.id}`);
        return res.json({ recu: true });
    }

    // 2+3) Marque d'idempotence ET crédit dans UNE SEULE TRANSACTION.
    // Les deux écritures committent ensemble ou pas du tout. C'est ce qui ferme
    // définitivement la fenêtre "payé mais pas crédité" : il devient impossible que
    // l'event soit marqué traité alors que les scans n'ont pas été ajoutés (ce que le
    // précédent rollback manuel ne garantissait pas si Mongo tombait au mauvais moment).
    // Atlas est un replica set -> transactions disponibles.
    const sessionMongo = await mongoose.startSession();
    let dejaTraite = false;
    try {
        await sessionMongo.withTransaction(async () => {
            // Idempotence : l'insertion EST le verrou. Si l'event a déjà été traité,
            // l'index unique renvoie 11000 -> on avorte la transaction, donc aucun crédit.
            try {
                // create([doc], {session}) — la forme tableau est obligatoire pour que
                // Mongoose lise bien le 2e argument comme des options et non comme un
                // second document à insérer.
                await EvenementStripe.create([{ eventId: event.id }], { session: sessionMongo });
            } catch (e) {
                if (e.code === 11000) dejaTraite = true;
                throw e;   // dans les deux cas on sort : la transaction est annulée
            }

            // Crédit. `scans` vient de metadata, écrit par NOTRE serveur à la création
            // de la session — jamais d'une valeur envoyée par le client.
            await Credit.updateOne(
                { userId },
                {
                    $inc: { soldeScans: scans },
                    $setOnInsert: { userId, soldeGratuit: SCANS_ACCUEIL },
                    $set: { email: session.customer_details?.email || null }
                },
                { upsert: true, session: sessionMongo }
            );
        });

        console.log(`✅ [webhook] +${scans} scans crédités à ${userId} (event ${event.id})`);
    } catch (e) {
        if (dejaTraite) {
            // Rejeu Stripe d'un event déjà encaissé : rien n'a été réécrit, on acquitte.
            console.log(`↩️ [webhook] event ${event.id} déjà traité — ignoré`);
            return res.json({ recu: true });
        }
        // Échec réel : la transaction a été annulée, RIEN n'est persisté — ni la marque
        // d'idempotence, ni le crédit. Le rejeu de Stripe repassera donc proprement.
        // 500 = "réessaie", c'est exactement ce qu'on veut.
        console.error(`❌ [webhook] transaction échouée pour ${userId} (+${scans}, event ${event.id}) : ${e.message}`);
        // Dernier recours : si le rejeu Stripe n'aboutissait jamais (épuisement des
        // tentatives), cette ligne reste la trace permettant de créditer à la main.
        console.error(`🔥 [webhook] SI AUCUN REJEU N'ABOUTIT — créditer MANUELLEMENT ${userId} de ${scans} scans (event ${event.id})`);
        return res.status(500).send('Erreur crédit');
    } finally {
        await sessionMongo.endSession();
    }

    res.json({ recu: true });
}

// Consultation du solde. LECTURE SEULE : consulter son solde ne doit ni créer de
// compte, ni consommer quoi que ce soit.
app.post('/api/solde', verifierJeton, async (req, res) => {
    try {
        const userId = req.body && req.body.userId ? String(req.body.userId).slice(0, 80) : null;
        if (!userId) return res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: "Service momentanément indisponible" });
        }

        const credit = await Credit.findOne({ userId }).lean();
        // Compte pas encore créé (aucun scan à ce jour) : on renvoie le solde EFFECTIF
        // qu'il aura à son premier scan, pas des zéros — sinon un nouvel utilisateur
        // lirait "0 scan" alors que ses crédits d'accueil l'attendent.
        if (!credit) {
            return res.json({
                soldeGratuit: SCANS_ACCUEIL,
                soldeScans: 0,
                restantSemaine: SCANS_GRATUITS_SEMAINE
            });
        }

        const doc = await QuotaSemaine.findOne({ userId, semaine: semaineISO() }).lean();
        const restantSemaine = Math.max(0, SCANS_GRATUITS_SEMAINE - (doc?.count || 0));

        res.json({
            soldeGratuit: credit.soldeGratuit || 0,
            soldeScans: credit.soldeScans || 0,
            restantSemaine
        });
    } catch (e) {
        console.error("❌ [solde]", e.message);
        res.status(500).json({ success: false, error: "Erreur lors de la lecture du solde" });
    }
});

// Route de réveil : l'extension l'appelle dès qu'une page Vinted se charge, pour
// que le serveur (endormi sur le plan gratuit Render après 15 min d'inactivité)
// soit déjà chaud quand l'utilisateur clique sur "Analyser". Volontairement
// minimale : aucun accès base, aucun calcul.
//
// ⚠️ ELLE REND AUSSI `version` — DEPUIS LE 2026-09-05, ET POUR UNE RAISON PRÉCISE.
// Ce jour-là, après un push, il était impossible de savoir si Render avait fini de
// déployer : `/ping` ne rendait que { ok, mongo }, et Render laisse l'ANCIENNE instance
// servir pendant que la neuve build — une réponse rapide ne distingue donc pas
// « déployé » de « pas encore ». La seule façon de lire la version en ligne était de
// LANCER UN SCAN et de regarder la ligne au journal : consommer une mesure pour dater
// l'instrument qui allait la produire, et risquer de mesurer l'ancien code dans une
// fenêtre de lot ouverte pour le nouveau.
//
// `version` est la MÊME constante que celle écrite au journal (`VERSION`, exportée par
// `journal-scans.js`), jamais un second calcul : sinon les deux dériveraient et on
// croirait dater une ligne alors qu'on daterait une route.
app.get('/ping', (req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1, version: VERSION }));

app.get('/', (req, res) => res.send('Serveur Analyseur Pokémon actif'));

// `require.main === module` : vrai quand on lance `node index.js` — ce que fait Render, et
// ce que fait le smoke test qui démarre un processus séparé. Faux quand un TEST require ce
// fichier pour appeler ses fonctions.
//
// POURQUOI CE GARDE-FOU. Sans lui, les fonctions d'identification n'étaient testables
// qu'en les RÉÉCRIVANT dans un script de mesure — et une réécriture ne teste que la
// réécriture. C'est exactement ce qui a produit la contradiction « la simulation dit
// 3 candidats, la production en rend 2 » : le script de mesure n'appliquait pas la
// préférence stricte pour l'égalité exacte. On teste maintenant le VRAI code.
if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
}

// Exporté pour les tests UNIQUEMENT. Le serveur, lui, ne lit jamais ces exports.
module.exports = {
    app, trouverParSetCodeEtNumero, nomOpposeUnVeto, trouverProduitsLocaux,
    // Exportés pour que le re-classement du veto soit rejouable À L'IDENTIQUE dans les
    // tests. Les rejouer avec une réimplémentation ne prouverait rien : c'est précisément
    // l'erreur qui a produit « la simulation dit 12, la production dit 0 ».
    scorerCandidatsLocal, lireCodeSets, lireNumeros,
    // ⚠️ EXPORTÉ POUR MESURER LE VIVIER, pas pour être appelé ailleurs. Le banc construit
    // son vivier avec le nom LU, la production avec le `nomExact` que rend cette fonction :
    // ce sont deux catalogues différents, et `nomExact` n'est PAS journalisé. Sans cet
    // export, la seule façon de comparer les deux constructions serait de réimplémenter la
    // résolution TCGdex — ce qui ne prouverait rien, exactement comme pour le veto.
    trouverCarteTCGdex,
    // Le pont total -> set, exporté pour être DIAGNOSTIQUÉ sur pièces plutôt que déduit.
    setsPourTotal, identifierParTotalEtNumero,
    // ⚠️ EXPORTÉE POUR ÊTRE TESTÉE, PAS POUR ÊTRE RÉUTILISÉE AILLEURS. La chaîne argent
    // ne part jamais sans preuve : test-remboursement-catch.js exerce cette fonction
    // exacte, celle que les deux `catch` appellent — pas une copie de sa logique.
    rembourserSiRienLivre,
    // ⚠️ EXPORTÉES POUR MESURER SI UNE ABSENCE ÉTAIT RÉELLE, pas pour être appelées
    // ailleurs. Ces deux fonctions relancent désormais leur exception (voir sources.js) ;
    // les rejouer sur les lignes déjà au journal reste la seule façon de borner la part
    // de pannes déguisées, et une réimplémentation ne prouverait rien.
    trouverProduitsParNumero, trouverProduitsParNumeroPartout,
    // ⚠️ EXPORTÉE POUR ÊTRE TESTÉE. La requalification d'un refus d'absence en échec
    // technique se décide ICI et nulle part ailleurs : un test qui la réimplémenterait ne
    // testerait que lui-même. Voir test-sources.js.
    champsDeRefus, REFUS_D_ABSENCE
};