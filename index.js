require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');

// CHEMIN ARGENT : dÃ©compte et remboursement d'un scan. Extrait dans son propre module
// pour qu'il n'existe qu'UNE implÃ©mentation, exÃ©cutÃ©e Ã  l'identique par le serveur et
// par test-acces.js. Tant que le test en recopiait la logique, la copie pouvait diverger
// du vrai code sans que rien ne le signale.
const {
    Credit, QuotaSemaine,
    exigerImage, verifierAcces, rembourserScan, signalerIncertain,
    semaineISO, SCANS_ACCUEIL, SCANS_GRATUITS_SEMAINE
} = require('./acces');

const {
    choisirMeilleur,
    analyserVariantes, resoudreMotif, motifDuTitre, normaliserTotal,
    prixDeReference, impressionEstReverse,
    setsCompatiblesAvecTotal, comparerNumeros,
    // rangDuNumero ne pilote encore RIEN : il ne sert qu'aux traces et au journal,
    // le temps de mesurer la frÃ©quence rÃ©elle du rang 3 avant le point 4.
    rangDuNumero, bilanDesRangs, normaliserCodeSet, codesApparentes,
    regionDuCodeSet,
    MOTIFS_CIBLABLES
} = require('./scoring');

// Journal des scans : une ligne par identification, en base. Les logs Render sont
// Ã©phÃ©mÃ¨res ; les seuils qu'on pose (ratio, rangs, fiabilitÃ© du setCode) ont besoin de
// donnÃ©es qui survivent au redÃ©ploiement. Jamais sur le chemin critique â€” voir le module.
const { enregistrerScan } = require('./journal-scans');

// Identification de repli, dans le SEUL catalogue local, quand TCGdex ne connaÃ®t pas la
// carte (les e-Series japonaises en sont absentes) ou quand le nom n'est pas fiable.
// TestÃ©e en bac Ã  sable par test-identification-locale.js.
const { identifierEnLocal } = require('./identification-locale');

const app = express();
app.set('trust proxy', 1); // Render est derriÃ¨re un proxy â†’ nÃ©cessaire pour lire la vraie IP cÃ´tÃ© rate-limit
const PORT = process.env.PORT || 3000;

// SÃ‰CURITÃ‰ : sans restriction, n'importe quel site ouvert dans ton navigateur
// pourrait appeler ce serveur local et brÃ»ler tes crÃ©dits IA / dÃ©clencher du
// scraping en ton nom.
// âš ï¸ Un content script s'exÃ©cute DANS la page : sa requÃªte porte donc l'origine
//    de la page (https://www.vinted.fr) et NON "chrome-extension://".
const ORIGINES_AUTORISEES = [
    /^chrome-extension:\/\/[a-p]+$/,                       // l'extension elle-mÃªme
    /^https:\/\/(www\.)?vinted\.(fr|be|com|de|es|it|nl|lu|at|pl|pt|se|cz|sk|lt|uk)$/ // Vinted, domaines officiels
];
app.use(cors({
    origin: (origin, callback) => {
        // Pas d'origine = appel direct (curl, tests locaux) -> autorisÃ©
        if (!origin) return callback(null, true);
        if (ORIGINES_AUTORISEES.some(re => re.test(origin))) return callback(null, true);
        console.warn(`ðŸš« RequÃªte refusÃ©e depuis une origine non autorisÃ©e : ${origin}`);
        return callback(new Error('Origine non autorisÃ©e'));
    }
}));
// âš ï¸ ORDRE CRITIQUE : Stripe signe le corps BRUT de la requÃªte. Si express.json()
// le parsait avant, l'octet-Ã -octet serait perdu et la vÃ©rification de signature
// Ã©chouerait systÃ©matiquement. Cette route est donc dÃ©clarÃ©e AVANT le parser JSON
// global, avec son propre express.raw(). `gererWebhookStripe` est une dÃ©claration
// de fonction (hoistÃ©e) Ã©crite plus bas, dans la section paiement : l'ordre des
// middlewares est garanti sans Ã©parpiller le code Stripe en haut du fichier.
app.post('/api/webhook-stripe', express.raw({ type: 'application/json' }), gererWebhookStripe);

app.use(express.json());

// Limite anti-abus par IP : backstop indÃ©pendant du quota par utilisateur (qui, lui,
// se contourne en changeant d'identifiant). Ne s'applique QU'aux routes IA coÃ»teuses â€”
// surtout pas Ã  /ping, sinon le keep-alive cron-job se ferait jeter.
const limiteurIA = rateLimit({
    windowMs: 60 * 60 * 1000,   // fenÃªtre : 1 heure
    max: 60,                    // 60 requÃªtes/h/IP (large pour un usage normal, coupe le pilonnage)
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de requÃªtes, rÃ©essaie plus tard.' }
});
app.use(['/api/identifier', '/api/analyser'], limiteurIA);

// Limiteur dÃ©diÃ© Ã  la crÃ©ation de Checkout Sessions. Le jeton partagÃ© est
// extractible de l'extension distribuÃ©e : sans ce garde-fou, n'importe qui pourrait
// faire crÃ©er des milliers de sessions Stripe. 20/h/IP laisse largement la place Ã 
// un achat normal (et Ã  quelques hÃ©sitations/retours en arriÃ¨re).
const limiteurPaiement = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de tentatives de paiement, rÃ©essaie plus tard.' }
});

// Jeton partagÃ© entre l'extension et le serveur. EmpÃªche une page web d'utiliser
// ton serveur mÃªme si elle contournait le CORS. Ã€ dÃ©finir dans le .env :
//   JETON_API=une_chaine_longue_et_aleatoire
// et Ã  recopier dans content.js. Si absent, la protection est simplement inactive.
const JETON_API = process.env.JETON_API || null;
if (!JETON_API) {
    console.warn("âš ï¸ Aucun JETON_API dÃ©fini dans .env â€” le serveur accepte toute requÃªte locale.");
}
function verifierJeton(req, res, next) {
    if (!JETON_API) return next();
    if (req.headers['x-jeton'] === JETON_API) return next();
    console.warn("ðŸš« RequÃªte refusÃ©e : jeton absent ou invalide.");
    return res.status(401).json({ success: false, error: "Non autorisÃ©" });
}

// ============================================================
// CONFIG â€” Ã  ajuster facilement
// ============================================================

// DurÃ©e pendant laquelle on fait confiance Ã  un prix en cache avant de re-scraper
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// Seuils pour le verdict "bonne affaire" (ratio prixVinted / prixCardmarket)
const SEUIL_BONNE_AFFAIRE = 0.80; // 20% moins cher ou plus -> bonne affaire
const SEUIL_PRIX_CORRECT  = 1.10; // jusqu'Ã  10% plus cher -> prix correct
// au-dessus de SEUIL_PRIX_CORRECT -> trop cher

// ModÃ¨le IA pour lire la carte (OCR + extraction). google/gemini-3-flash-preview
// = gÃ©nÃ©ration 3, en tÃªte de l'OCR Arena, Ã  0,50 $/3 $ le M tokens (~3x moins
// cher que la 3.5-flash stable). âš ï¸ C'est une PREVIEW : elle peut changer de
// comportement ou disparaÃ®tre sans prÃ©avis â€” si erreur "model not found" ou
// rÃ©sultats qui se dÃ©gradent d'un coup, repasse sur "google/gemini-3.5-flash"
// (stable, plus chÃ¨re). L'ancien "google/gemini-2.5-flash" est arrÃªtÃ© oct. 2026.
const MODELE_IA = "google/gemini-3-flash-preview";

// ============================================================
// MONGODB â€” connexion + schÃ©ma de cache
// ============================================================

// âš ï¸ EXCEPTION ASSUMÃ‰E Ã  la rÃ¨gle Â« nommer la base ou refuser Â» (mongo-connexion.js).
// Le serveur, lui, DOIT tourner sur la production : exiger MONGODB_BASE ici casserait
// le dÃ©ploiement Render tant que la variable n'y est pas posÃ©e. Le compromis :
//   - le nom de la base est TOUJOURS affichÃ© au dÃ©marrage (c'est ce qui manquait) ;
//   - si MONGODB_BASE est dÃ©fini, il fait foi ET un Ã©cart est fatal.
// Poser MONGODB_BASE=test sur Render active donc le refus, sans risque de coupure.
if (!process.env.MONGODB_URI) {
    console.error("âš ï¸  MONGODB_URI n'est pas dÃ©fini dans les variables d'environnement Render. Le cache sera dÃ©sactivÃ©.");
} else {
    const baseVoulue = (process.env.MONGODB_BASE || '').trim() || null;
    mongoose.connect(process.env.MONGODB_URI, baseVoulue ? { dbName: baseVoulue } : {})
        .then(() => {
            const reelle = mongoose.connection.db.databaseName;
            console.log(`âœ… MongoDB connectÃ© â€” base "${reelle}"${baseVoulue ? '' : ' (non nommÃ©e : dÃ©faut de l\'URI)'}`);
            if (baseVoulue && reelle !== baseVoulue) {
                console.error(`âŒ ARRÃŠT : base "${reelle}" alors que MONGODB_BASE="${baseVoulue}".`);
                process.exit(1);
            }
        })
        .catch(err => console.error("âŒ Erreur connexion MongoDB:", err.message));
}

const cardPriceSchema = new mongoose.Schema({
    name: { type: String, required: true },       // nom EN de la carte, normalisÃ© en minuscule
    number: { type: String, required: true },      // numÃ©ro de collection
    language: { type: String, required: true },    // EN, FR, JP, ...
    price: { type: Number, required: true },       // prix Cardmarket en EUR
    url: { type: String, required: true },          // lien vers la fiche Cardmarket
    updatedAt: { type: Date, default: Date.now }
});
cardPriceSchema.index({ name: 1, number: 1, language: 1 }, { unique: true });

const CardPrice = mongoose.model('CardPrice', cardPriceSchema);

// Catalogue produits Cardmarket (importÃ© via import-catalogue.js)
const catalogueProduitSchema = new mongoose.Schema({
    idProduct: Number, name: String, idExpansion: Number, idMetacard: Number
});
// AlignÃ©s sur ce qu'import-catalogue.js dÃ©clare dÃ©jÃ  pour cette mÃªme collection (un
// index Mongo appartient Ã  la collection, pas au schÃ©ma qui s'y connecte â€” il existe
// donc peut-Ãªtre dÃ©jÃ  cÃ´tÃ© Atlas si l'import a tournÃ© ; cette dÃ©claration comble
// l'oubli cÃ´tÃ© serveur, sans risque : Mongoose ne fait rien si l'index existe dÃ©jÃ ,
// sinon le construit en tÃ¢che de fond. Pas d'index sur `name` : les 2 recherches du
// serveur sont des regex insensibles Ã  la casse (voir chercherPrixCatalogueLocal et
// trouverProduitsLocaux), qu'un index classique n'accÃ©lÃ¨re pas â€” l'ajouter coÃ»terait
// du stockage (Atlas peut Ãªtre sur un palier limitÃ©) pour aucun gain de requÃªte rÃ©el.
catalogueProduitSchema.index({ idExpansion: 1 });
catalogueProduitSchema.index({ idMetacard: 1 });
catalogueProduitSchema.index({ idProduct: 1 });
const CatalogueProduit = mongoose.model('CatalogueProduit', catalogueProduitSchema, 'catalogue_produits');

// Guide des prix Cardmarket (importÃ© via import-price-guide.js)
const guidePrixSchema = new mongoose.Schema({
    idProduct: Number, avg: Number, low: Number, trend: Number,
    avg1: Number, avg7: Number, avg30: Number,
    avgHolo: Number, lowHolo: Number, trendHolo: Number
});
// RequÃªtes rÃ©elles sur idProduct : getPrixGuideLocal/getPrixGuideLocalLot, Ã  chaque identification.
guidePrixSchema.index({ idProduct: 1 });
const GuidePrix = mongoose.model('GuidePrix', guidePrixSchema, 'guide_prix');

// Codes set appris au fil de l'eau (idExpansion Cardmarket -> code court type "TWM").
// Rempli automatiquement quand le module live lit une fiche : on ne redÃ©couvre
// jamais deux fois le code d'un mÃªme set.
const codeSetSchema = new mongoose.Schema({
    idExpansion: { type: Number, required: true, unique: true },
    codeSet: { type: String, required: true },
    apprisLe: { type: Date, default: Date.now }
});
const CodeSet = mongoose.model('CodeSet', codeSetSchema, 'codes_set');

// NumÃ©ros de collection appris set par set (via apprendre-set.js).
// Le catalogue Cardmarket ne contient PAS les numÃ©ros : sans cette table, on ne
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
    source: String,      // 'cardmarket' (fait foi) ou 'tcgdex' (prÃ©-rempli)
    certitude: String    // 'exacte' ou 'heuristique'
});
const NumeroCarte = mongoose.model('NumeroCarte', numeroCarteSchema, 'numeros_cartes');

// Ã‰vÃ©nements Stripe dÃ©jÃ  traitÃ©s. Stripe REJOUE ses webhooks (retry sur timeout, ou
// simple doublon rÃ©seau) : sans cette table, un mÃªme paiement crÃ©diterait plusieurs fois.
// L'index unique sur eventId est le verrou â€” c'est l'insertion qui Ã©choue (11000), pas
// une lecture prÃ©alable qui pourrait passer entre deux appels concurrents.
const evenementStripeSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    recuLe:  { type: Date, default: Date.now }
});
const EvenementStripe = mongoose.model('EvenementStripe', evenementStripeSchema, 'evenements_stripe');

// RÃ©cupÃ¨re les numÃ©ros connus pour une liste d'idProduct -> Map(idProduct => {numero, numeroUrl})
async function lireNumeros(idsProducts) {
    try {
        if (mongoose.connection.readyState !== 1 || idsProducts.length === 0) return new Map();
        const docs = await NumeroCarte.find({ idProduct: { $in: idsProducts } }).lean();
        return new Map(docs.map(d => [d.idProduct, d]));
    } catch (e) {
        console.error("Erreur lecture numÃ©ros :", e.message);
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

// Version groupÃ©e de lireCodeSet : un seul aller-retour Mongo pour N idExpansion au
// lieu d'un par candidat (jusqu'Ã  ~79 fois par requÃªte d'identification). Number()
// des deux cÃ´tÃ©s (clÃ© de la Map ET valeur lue dans produits) : idExpansion est dÃ©clarÃ©
// Number dans le schÃ©ma, mais Mongoose ne caste que les requÃªtes qu'il construit
// lui-mÃªme (findOne/$in) â€” une Map JS, elle, fait une Ã©galitÃ© stricte de type, donc
// "6096" et 6096 ne matcheraient jamais si une entrÃ©e plus ancienne avait Ã©tÃ© Ã©crite
// avec un type diffÃ©rent. Sans ce filet, un mismatch de type ferait taire le critÃ¨re
// rÃ©gion (Â±45 points) EN SILENCE, sans la moindre erreur.
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

// RÃ©gions DÃ‰RIVÃ‰ES, lues dans codes_set. C'est la seule source d'oÃ¹ peut venir un verdict
// Â« occidental Â» : scoring.regionDuCodeSet ne le dÃ©duit plus de la casse du code, parce
// que cette prÃ©somption se trompait sur 4620 produits japonais. La dÃ©rivation, elle,
// compare le nom d'expansion Cardmarket au catalogue international de TCGdex â€” et son
// origine est tracÃ©e dans le champ regionSource, consultable en base.
// Absence = rÃ©gion inconnue = critÃ¨re NEUTRE. Voir deriver-region.js.
async function lireRegions(idsExpansion) {
    try {
        if (mongoose.connection.readyState !== 1) return new Map();
        const uniques = [...new Set(idsExpansion.filter(e => e != null).map(Number))];
        if (uniques.length === 0) return new Map();
        const docs = await CodeSet.find({ idExpansion: { $in: uniques } }, { idExpansion: 1, region: 1 }).lean();
        // MÃªme prÃ©caution de type que lireCodeSets : un mismatch ferait taire le critÃ¨re
        // rÃ©gion (Â±45 points) en silence.
        return new Map(docs.filter(d => d.region).map(d => [Number(d.idExpansion), d.region]));
    } catch (e) {
        console.error("Erreur lecture rÃ©gions (lot):", e.message);
        return new Map();
    }
}

// Un codeSet arrive presque toujours d'une URL d'image Cardmarket, donc URL-ENCODÃ‰
// ("SV-P%2FCS" pour "SV-P/CS", "K%2BK" pour "K+K"). On dÃ©code Ã€ L'ENTRÃ‰E, une bonne
// fois : stockÃ© encodÃ©, le "%2F" survit Ã  la normalisation du scoring ("SVP2FCS" au
// lieu de "SVPCS") et casse la comparaison de set. Point d'entrÃ©e unique, appliquÃ© Ã 
// TOUS les chemins d'Ã©criture (/api/apprendre, /api/apprendre-lot, memoriserCodeSet).
// Une sÃ©quence malformÃ©e ("100%") est laissÃ©e telle quelle plutÃ´t que de faire Ã©chouer
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
        console.log(`ðŸ§  Code set appris et mÃ©morisÃ© : idExpansion ${idExpansion} -> ${codeSet}`);
    } catch (e) {
        console.error("Erreur mÃ©morisation codeSet:", e.message);
    }
}

function cleKey(name, number, language) {
    return {
        name: String(name).trim().toLowerCase(),
        number: String(number).trim(),
        language: String(language || "EN").trim().toUpperCase()
    };
}

async function lireCache(name, number, language) {
    try {
        if (mongoose.connection.readyState !== 1) return null; // pas connectÃ©
        const key = cleKey(name, number, language);
        const doc = await CardPrice.findOne(key);
        if (!doc) return null;
        const age = Date.now() - doc.updatedAt.getTime();
        if (age > CACHE_DURATION_MS) return null; // trop vieux, on re-scrape
        console.log(`ðŸ’¾ Cache HIT pour ${key.name} #${key.number} (${key.language})`);
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
        console.error("Erreur Ã©criture cache:", e.message);
    }
}

// ============================================================
// Ã‰TAPE 1 â€” Identification de la carte par l'IA (vision)
// ============================================================

async function getCardIdFromAI(imageUrls, title) {
    // Accepte une URL unique ou un tableau d'URLs (recto, verso, gros plans).
    const images = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [imageUrls].filter(Boolean);
    if (images.length === 0) return null;
    const prompt = `Identifie cette carte PokÃ©mon Ã  partir de l'image (le titre de l'annonce est un complÃ©ment d'info, en franÃ§ais). RÃ©ponds UNIQUEMENT en JSON strict, sans texte ni markdown autour, format exact :
{"name": "Nom anglais de la carte", "nomBrut": "le nom TEL QU'IMPRIMÃ‰ sur la carte, dans sa langue d'origine (katakana japonais, franÃ§ais...), ou null si illisible", "nomConfiance": "haute/moyenne/basse â€” voir les rÃ¨gles plus bas", "number": "numÃ©ro de collection SEUL sans le total (ex: 184)", "total": "le nombre APRÃˆS le slash (ex: 182 pour 184/182), ou null si absent", "setCode": "code du set (ex: BLK, PAL, OBF) si visible, sinon null", "rarete": "IR/SR/SIR/UR/AR/promo/normale selon ce que tu vois", "reverse": "true/false/null â€” true SEULEMENT si c'est une REVERSE HOLO, false si tu es sÃ»r que non, null si tu n'arrives pas Ã  juger", "motif": "aucun/reverse-classique/ball/masterball/indetermine â€” le MOTIF du fond brillant, voir la description dÃ©taillÃ©e plus bas", "language": "EN", "etatEstime": "NM/EX/GD/LP/PL/PO", "etatConfiance": "haute/moyenne/basse", "defautsVus": ["liste courte des dÃ©fauts visibles, [] si aucun"]}

LE NOM â€” c'est le champ le plus lourd de consÃ©quences, et celui oÃ¹ l'erreur est la plus coÃ»teuse.
Un nom faux mais PLAUSIBLE est bien pire qu'un nom avouÃ© illisible : il envoie la recherche
vers une carte qui existe vraiment, ailleurs, et le prix rendu est celui d'une autre carte.
- "nomBrut" : recopie ce qui est IMPRIMÃ‰, sans traduire. Sur une carte japonaise, ce sont des
  katakana (ex: "ãƒ¯ãƒ³ãƒªã‚­ãƒ¼", "ãƒãƒƒã‚µãƒ "). Sur une carte franÃ§aise, le nom franÃ§ais
  (ex: "Carabaffe"). Si tu ne peux pas le lire, mets null â€” ne le reconstitue pas.
- "name" : le nom ANGLAIS officiel correspondant. Sur une carte japonaise, cela demande de
  translittÃ©rer PUIS traduire (ãƒ¯ãƒ³ãƒªã‚­ãƒ¼ = Machop, ãƒãƒƒã‚µãƒ  = Scizor). Si tu n'es pas sÃ»r de
  la correspondance, garde le nom que tu lis dans "nomBrut" et baisse "nomConfiance".
- "nomConfiance" :
  * "haute"   : tu LIS le nom distinctement et tu es sÃ»r de sa traduction anglaise.
  * "moyenne" : tu lis le nom mais hÃ©sites sur la traduction, OU tu dÃ©duis surtout de l'illustration.
  * "basse"   : nom peu lisible (flou, reflet, sleeve, angle), langue que tu dÃ©chiffres mal, ou
                tu t'appuies principalement sur le titre de l'annonce plutÃ´t que sur la carte.
âš ï¸ NE DEVINE JAMAIS un PokÃ©mon cÃ©lÃ¨bre par dÃ©faut. Si l'illustration ne te dit rien de sÃ»r,
"nomConfiance" doit Ãªtre "basse" â€” c'est une information UTILE, pas un aveu d'Ã©chec. Un nom en
confiance basse est traitÃ© autrement en aval ; un nom faux en confiance haute produit un faux prix.

Ã‰VALUATION DE L'Ã‰TAT (etatEstime) â€” barÃ¨me Cardmarket, du meilleur au pire : MT > NM > EX > GD > LP > PL > PO.
- NM (Near Mint) : aucun dÃ©faut visible, bords nets, coins pointus.
- EX (Excellent) : trÃ¨s lÃ©gÃ¨res marques d'usure, minuscule blanchiment de bord.
- GD (Good) : blanchiment net des bords/coins, lÃ©gÃ¨res rayures visibles.
- LP (Light Played) : usure marquÃ©e, rayures, coins Ã©moussÃ©s.
- PL / PO : dÃ©gÃ¢ts importants (pli, dÃ©chirure, tache).

RÃˆGLES IMPORTANTES pour etatConfiance â€” sois HONNÃŠTE sur ce que tu ne peux pas voir :
- "basse" si : la carte est sous sleeve/toploader/blister (reflets qui masquent les dÃ©fauts), photo floue, angle en biais, Ã©clairage mauvais, ou verso non visible.
- "moyenne" si : photo correcte de face mais dÃ©tails des bords/coins pas nets.
- "haute" UNIQUEMENT si : carte nue, photo nette, bords et coins clairement visibles.
Dans le doute, sois PESSIMISTE (prÃ©fÃ¨re GD Ã  EX) : surestimer l'Ã©tat conduit Ã  surpayer.
Ne devine pas un Ã©tat "haute confiance" Ã  partir d'une photo qui ne le permet pas.

PLUSIEURS PHOTOS te sont fournies (recto, verso, gros plans). EXAMINE-LES TOUTES.
Le VERSO est dÃ©terminant : c'est lÃ  que l'usure se voit le mieux (bords blanchis, coins
usÃ©s, dos terni/jauni par le temps, rayures). Une carte au recto impeccable mais au dos
usÃ© n'est PAS NM ni EX â€” un dos visiblement fatiguÃ© signifie GD ou moins.
Ton etatEstime doit reflÃ©ter la PIRE face observÃ©e, pas la meilleure.
Si aucune photo du verso n'est fournie, dis-le via etatConfiance "basse".

defautsVus : dÃ©cris ce que tu OBSERVES rÃ©ellement (ex: "blanchiment bord gauche", "rayure sur l'illustration", "coin cornÃ©"). Tableau vide [] si tu ne vois aucun dÃ©faut. N'invente rien.

IMPORTANT pour "number" et "total" : le numÃ©ro de collection est imprimÃ© en bas de la carte sous la forme "X/Y" (ex: "184/182", "025/165"). Lis les DEUX nombres avec attention, ils sont petits mais cruciaux. "number" = le X (avant le slash), "total" = le Y (aprÃ¨s le slash). Si le X est SUPÃ‰RIEUR au Y (ex: 184/182), c'est une carte secrÃ¨te/spÃ©ciale (souvent une Illustration Rare) â€” lis bien, ne confonds pas 184 avec 8.
Le numÃ©ro est le signal le plus DISCRIMINANT dont on dispose : il permet de retrouver la carte
mÃªme quand son nom est douteux. Cherche-le donc partout : en bas de la carte, mais aussi dans le
TITRE de l'annonce, qui le contient trÃ¨s souvent sous la forme "099/128" ou "055/088".
Si malgrÃ© tout tu ne le lis pas, rÃ©ponds null â€” n'invente PAS un numÃ©ro, et ne recopie pas celui
d'une autre carte visible sur la photo. Un numÃ©ro absent est traitÃ© proprement en aval ; un
numÃ©ro inventÃ© dÃ©signe une carte qui n'a rien Ã  voir.
Sur les cartes JAPONAISES anciennes, le numÃ©ro peut Ãªtre imprimÃ© seul, sans total, ou porter un
prÃ©fixe (ex: "S19"). Recopie-le tel quel dans "number" et laisse "total" Ã  null si tu ne vois
aucun dÃ©nominateur.

Le "setCode" est le petit code alphabÃ©tique (2 Ã  4 lettres) imprimÃ© en bas de la carte Ã  cÃ´tÃ© du numÃ©ro, ou parfois dans le titre de l'annonce (ex: "BLK 129"). Si tu ne le vois pas clairement, rÃ©ponds null, n'invente rien.
IMPORTANT â€” les TAMPONS/STAMPS de rÃ©impression : si la carte porte un tampon anniversaire ou de sous-set (le logo dorÃ© "Celebrations 25 ans", le tampon "PokÃ©mon 151", "Trainer Gallery", "Prize Pack"...), ce sont des rÃ©impressions qui GARDENT le numÃ©ro d'origine (ex: Florizarre 15/102 en Celebrations). Dans ce cas, indique le set du TAMPON dans "setCode" (ex: "CEL" pour Celebrations, "MEW" pour 151, "TG" pour Trainer Gallery), PAS le set d'origine â€” c'est ce qui permet de distinguer la rÃ©impression de la carte vintage au mÃªme numÃ©ro.

Pour "rarete" : regarde le symbole de raretÃ© et le style de la carte. "IR" = Illustration Rare (illustration pleine, personnage humain souvent), "SIR"/"SR" = Special/Super Rare, "AR" = Art Rare, "promo" = carte promotionnelle, "normale" = carte de jeu standard. Si tu n'es pas sÃ»r, rÃ©ponds "normale".
âš ï¸ NE CONFONDS PAS "rarete" et "etatEstime" : la raretÃ© est une propriÃ©tÃ© d'IMPRESSION de la carte (IR, SR, promo, normale...), l'Ã©tat est son USURE physique (NM, EX, GD...). N'Ã©cris JAMAIS un code d'Ã©tat (EX, GD, NM...) dans le champ "rarete".

Pour "reverse" : une REVERSE HOLO est une carte de jeu normale dont le motif holographique/brillant recouvre le FOND et les BORDURES (toute la carte scintille SAUF l'illustration), alors que sur une holo normale c'est l'ILLUSTRATION qui brille. Le numÃ©ro d'une reverse est IDENTIQUE Ã  celui de la version normale. RÃ©ponds true UNIQUEMENT si tu distingues clairement ce scintillement de fond ; false si la carte est visiblement mate/normale ; null si reflets, sleeve ou photo ne permettent pas d'en Ãªtre sÃ»r. Ne devine pas.

Pour "motif" â€” LE MOTIF DU FOND BRILLANT D'UNE REVERSE. C'est un marquage holographique GRAVÃ‰ et DISCRET, rÃ©pÃ©tÃ© sur toute la surface brillante de la carte (le fond et les bordures, pas l'illustration). Regarde le fond en biais, lÃ  oÃ¹ la lumiÃ¨re accroche. Quatre rÃ©ponses possibles :
- "aucun" : la carte est mate/normale, aucun fond brillant.
- "reverse-classique" : le fond brillant est couvert de petits SYMBOLES DE TYPE rÃ©pÃ©tÃ©s (les symboles Ã©nergie : flamme, goutte, Ã©clair, feuille...). C'est le reverse le plus courant, celui de la majoritÃ© des cartes.
- "ball" : le fond brillant est couvert de POKÃ‰ BALLS rÃ©pÃ©tÃ©es (ou d'autres balls : Friend Ball, Love Ball, Quick Ball). Des cercles sÃ©parÃ©s en deux moitiÃ©s par une bande horizontale, avec un bouton central.
- "masterball" : le fond est couvert de MASTER BALLS â€” reconnaissables Ã  leur moitiÃ© supÃ©rieure violette/mauve portant un "M" et deux pastilles rondes de chaque cÃ´tÃ©.
- "indetermine" : reflets, sleeve, photo trop floue ou angle qui ne permet pas de voir le motif.
RÃˆGLE ABSOLUE : "indetermine" vaut MIEUX que deviner. Ne dis "ball" ou "masterball" que si tu DISTINGUES rÃ©ellement la forme rÃ©pÃ©tÃ©e. Ne cherche pas Ã  identifier QUEL ball prÃ©cisÃ©ment (PokÃ©/Friend/Love/Quick) : rÃ©ponds "ball" pour tous, sauf la Master Ball qui a sa propre valeur. Si la carte est mate, rÃ©ponds "aucun", pas "indetermine".
"motif" et "reverse" doivent Ãªtre cohÃ©rents : motif "aucun" => reverse false ; tout autre motif => reverse true.

Pour "language", dÃ©duis-la du TEXTE VISIBLE SUR LA CARTE elle-mÃªme (pas du titre) : JP si texte japonais, FR si texte franÃ§ais, DE si allemand, IT si italien, ES si espagnol, PT si portugais, KR si corÃ©en, ZH si chinois. Si tu n'es pas sÃ»r, rÃ©ponds "EN" par dÃ©faut.

Titre de l'annonce (contexte) : ${title || "(non fourni)"}`;

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: MODELE_IA,
            // TempÃ©rature 0 : lire un numÃ©ro sur une carte n'est pas une tÃ¢che
            // crÃ©ative. Sans Ã§a, le modÃ¨le "improvise" et donne des rÃ©sultats
            // diffÃ©rents sur la MÃŠME photo (vu en conditions rÃ©elles : raretÃ© AR
            // puis "normale", total TG30 puis absent -> 25 points d'Ã©cart au
            // scoring et la confiance qui bascule de HAUTE Ã  BASSE).
            temperature: 0,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    // Toutes les photos de l'annonce : le verso et les gros plans sont
                    // indispensables pour juger l'Ã©tat (l'usure s'y voit le mieux).
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
            console.error("RÃ©ponse IA inattendue (pas de string content):", JSON.stringify(response.data));
            return null;
        }

        console.log("ðŸ¤– RÃ©ponse brute IA:", content);

        const clean = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);

        // âš ï¸ ON NE JETTE PLUS LA RÃ‰PONSE QUAND LE NUMÃ‰RO MANQUE. L'ancienne version rendait
        // null dans ce cas, ce qui la rendait indiscernable d'une VRAIE panne (clÃ©
        // invalide, quota, timeout, JSON illisible) : mÃªme retour, mÃªme message Â« Analyse
        // IA Ã©chouÃ©e Â», mÃªme motif de remboursement. Deux annonces rÃ©elles Â« e-series 5
        // jap Â» sont mortes lÃ , alors que l'IA avait parfaitement rÃ©pondu â€” elle n'avait
        // simplement pas pu lire le numÃ©ro. L'appelant a besoin de distinguer les deux
        // pour rembourser avec le bon motif et pour que le journal les compte sÃ©parÃ©ment.
        if (!parsed.name) {
            console.error("JSON IA sans nom â€” inexploitable :", parsed);
            return null;
        }
        // NumÃ©ro absent : on renvoie quand mÃªme la lecture, avec un drapeau explicite.
        parsed.numeroIllisible = !parsed.number;
        if (parsed.numeroIllisible) {
            parsed.number = null;
            console.warn(`âš ï¸ IA : numÃ©ro de collection NON LU pour "${parsed.name}" â€” le numÃ©ro est le signal le plus discriminant, sans lui l'identification n'est pas fiable.`);
        }
        parsed.language = (parsed.language || "EN").toUpperCase();

        // --- NOM : ce que l'IA a lu, et Ã  quel point elle y croit -----------
        // `nomBrut` est conservÃ© tel quel (katakana, franÃ§ais...) : il ne sert pas au
        // scoring mais il est la seule trace de ce qui Ã©tait RÃ‰ELLEMENT imprimÃ©, donc le
        // seul moyen de comprendre aprÃ¨s coup une traduction fautive.
        parsed.nomBrut = (typeof parsed.nomBrut === 'string' && parsed.nomBrut.trim()) ? parsed.nomBrut.trim() : null;
        const confiancesNom = ['haute', 'moyenne', 'basse'];
        const confLue = String(parsed.nomConfiance ?? '').trim().toLowerCase();
        // Absente ou hors Ã©numÃ©ration -> 'moyenne'. Volontairement PAS 'basse' : traiter un
        // champ manquant comme une alerte rendrait tout scan suspect le jour oÃ¹ le modÃ¨le
        // cesse de le renvoyer, et viderait le signal de son sens.
        parsed.nomConfiance = confiancesNom.includes(confLue) ? confLue : 'moyenne';
        if (parsed.nomConfiance === 'basse') {
            console.warn(`âš ï¸ IA : nom "${parsed.name}" en confiance BASSE (brut : ${parsed.nomBrut ?? 'illisible'}) â€” le nom ne fera pas foi pour choisir les candidats.`);
        }

        // Normalisation des nouveaux champs pour le scoring.
        // `total` attend un NOMBRE (le "Y" de X/Y). L'IA y met parfois autre chose : vu
        // en rÃ©el sur une promo chinoise, "total": "SV-P", c'est-Ã -dire un code de set.
        // L'ancien nettoyage (replace(/\D/g,'')) produisait alors la chaÃ®ne VIDE, ce qui
        // dÃ©sactivait le dÃ©partage par total EN SILENCE. La normalisation vit dÃ©sormais
        // dans scoring.js (module testÃ© â€” voir normaliserTotal et le test "184/182").
        const { total, brutIgnore } = normaliserTotal(parsed.total);
        parsed.total = total;
        if (brutIgnore) {
            console.warn(`âš ï¸ IA : "total" non numÃ©rique ("${brutIgnore}") -> ignorÃ© (dÃ©partage par total dÃ©sactivÃ©).`);
            // RepÃªchage : ce qu'elle a mis lÃ  est presque toujours le code du set (elle
            // confond les deux champs). Si setCode est vide, autant rÃ©cupÃ©rer
            // l'information plutÃ´t que de la jeter : c'est elle qui active le critÃ¨re
            // set du scoring (40 points, ou 15 en apparentÃ©).
            if (!parsed.setCode) {
                parsed.setCode = brutIgnore;
                console.warn(`   â†ªï¸ "${brutIgnore}" repÃªchÃ© comme setCode (le champ Ã©tait vide).`);
            }
        }
        parsed.rarete = parsed.rarete || 'normale';
        // reverse : on ne garde QUE true ou false explicites ; tout le reste ("null",
        // absent, chaÃ®ne "null") devient null -> le scoring restera neutre dans le doute.
        parsed.reverse = (parsed.reverse === true || parsed.reverse === 'true') ? true
            : (parsed.reverse === false || parsed.reverse === 'false') ? false
            : null;
        // MOTIF du fond brillant. Ã‰numÃ©ration volontairement GROSSIÃˆRE : on ne demande
        // pas Ã  l'IA de nommer le ball exact (PokÃ©/Friend/Love/Quick), c'est l'axe oÃ¹
        // l'identification visuelle Ã©choue en pratique. Le catalogue TCGdex tranche
        // ensuite quel produit porte ce motif (voir resoudreMotif dans scoring.js).
        const motifLu = String(parsed.motif ?? '').trim().toLowerCase();
        parsed.motif = MOTIFS_CIBLABLES.includes(motifLu) ? motifLu : 'indetermine';
        // CohÃ©rence interne de la rÃ©ponse : `motif` est plus prÃ©cis que `reverse`, il
        // prime â€” sauf contradiction franche entre les deux, oÃ¹ l'on refuse de trancher
        // plutÃ´t que de choisir arbitrairement (le repli, lui, est mesurÃ© dans les logs).
        if (parsed.motif !== 'indetermine') {
            if (parsed.reverse === true && parsed.motif === 'aucun') {
                console.warn(`âš ï¸ IA incohÃ©rente : reverse=true mais motif="aucun" -> motif remis Ã  indÃ©terminÃ©.`);
                parsed.motif = 'indetermine';
            } else {
                parsed.reverse = parsed.motif !== 'aucun';
            }
        }
        // Carte "Ã  valeur" si : numÃ©ro > total (secrÃ¨te), ou raretÃ© spÃ©ciale lue par l'IA
        const numN = parseInt(String(parsed.number).replace(/\D/g, ''), 10);
        const totN = parsed.total ? parseInt(parsed.total, 10) : null;
        const raretesElevees = ['IR', 'SR', 'SIR', 'UR', 'AR', 'SAR', 'CHR', 'CSR'];
        parsed.rareteElevee = (totN != null && numN > totN)
            || raretesElevees.includes(String(parsed.rarete).toUpperCase());
        // `reverse` est loggÃ© explicitement : sans lui, la ligne laissait croire que
        // "Ã©levÃ©e=false" concernait la reverse, alors qu'elle dÃ©crit la RARETÃ‰
        // (secret/IR). On avait donc "Ã©levÃ©e=false" suivi d'une dÃ©cision reverse juste
        // aprÃ¨s, sans jamais voir la valeur qui l'avait dÃ©clenchÃ©e.
        const reverseLog = parsed.reverse === null ? 'indÃ©terminÃ©e' : parsed.reverse;
        console.log(`ðŸŽ´ IA : ${parsed.name} #${parsed.number ?? 'ILLISIBLE'}${parsed.total ? '/' + parsed.total : ''}, nomConfiance=${parsed.nomConfiance}${parsed.nomBrut ? ` (brut "${parsed.nomBrut}")` : ''}, raretÃ©=${parsed.rarete}, raretÃ© Ã©levÃ©e=${parsed.rareteElevee}, reverse=${reverseLog}, motif=${parsed.motif}, langue=${parsed.language}`);
        if (parsed.etatEstime) {
            const defauts = Array.isArray(parsed.defautsVus) && parsed.defautsVus.length ? parsed.defautsVus.join(', ') : 'aucun dÃ©faut vu';
            console.log(`   ðŸ‘ï¸ Ã‰tat estimÃ© par l'IA : ${parsed.etatEstime} (confiance ${parsed.etatConfiance || '?'}) â€” ${defauts}`);
        }

        return parsed;

    } catch (e) {
        // Log complet : c'est ici que tu verras la vraie cause (clÃ© invalide, quota, timeout...)
        console.error("âŒ Erreur getCardIdFromAI:", e.response?.data || e.message);
        return null;
    }
}

// ============================================================
// Ã‰TAPE 1bis â€” Catalogue LOCAL (importÃ© depuis les exports officiels Cardmarket)
// Gratuit, instantanÃ©, aucun appel rÃ©seau. On regroupe par idMetacard : si un
// seul "idMetacard" correspond au nom, toutes les entrÃ©es sont la mÃªme carte
// (juste des rÃ©impressions) -> pas d'ambiguÃ¯tÃ©, prix directement fiable.
// Si plusieurs idMetacard correspondent, c'est une vraie ambiguÃ¯tÃ© qu'on ne
// peut pas trancher sans image -> on laisse la main Ã  TCGdex+comparaison photo.
// ============================================================

function echapperRegex(texte) {
    return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function chercherPrixCatalogueLocal(name) {
    try {
        if (mongoose.connection.readyState !== 1) return { trouvaille: null, ambigu: false };

        // Nom exact, Ã©ventuellement suivi de " [Attaque1 | Attaque2]"
        const regex = new RegExp(`^${echapperRegex(name)}(\\s*\\[|$)`, 'i');
        const candidats = await CatalogueProduit.find({ name: regex }).lean();

        if (candidats.length === 0) {
            console.log(`â„¹ï¸ Catalogue local : aucune correspondance pour "${name}".`);
            return { trouvaille: null, ambigu: false };
        }

        const groupes = {};
        for (const c of candidats) (groupes[c.idMetacard] ||= []).push(c);
        const nombreDeGroupes = Object.keys(groupes).length;

        if (nombreDeGroupes > 1) {
            // Le catalogue local n'a pas le numÃ©ro de collection par carte, donc un nom
            // trÃ¨s rÃ©imprimÃ© (ex: "Mewtwo ex") remonte toutes ses Ã©ditions -> ambiguÃ¯tÃ©
            // qu'une recherche directe (mÃªme numÃ©ro) ne rÃ©soudra pas diffÃ©remment.
            console.log(`â„¹ï¸ Catalogue local : ${nombreDeGroupes} cartes distinctes possibles pour "${name}" â€” ambigu, inutile d'essayer la recherche directe, repli direct sur TCGdex+image.`);
            return { trouvaille: null, ambigu: true };
        }

        // Un seul idMetacard, MAIS avec beaucoup de rÃ©impressions (ex: cartes promo trÃ¨s
        // rÃ©Ã©ditÃ©es comme "Iono") -> des produits diffÃ©rents avec des valeurs trÃ¨s
        // diffÃ©rentes (promo vs ETB vs deck thÃ¨me). Une moyenne aveugle serait fausse â€”
        // on prÃ©fÃ¨re laisser TCGdex+comparaison d'image identifier le produit prÃ©cis.
        const idsProducts = candidats.map(c => c.idProduct);
        const SEUIL_REIMPRESSIONS_FIABLE = 5;
        if (idsProducts.length > SEUIL_REIMPRESSIONS_FIABLE) {
            console.log(`â„¹ï¸ Catalogue local : "${name}" a ${idsProducts.length} rÃ©impressions sous le mÃªme idMetacard â€” trop pour une moyenne fiable, repli sur TCGdex+image.`);
            return { trouvaille: null, ambigu: true };
        }

        const guides = await GuidePrix.find({ idProduct: { $in: idsProducts }, trend: { $ne: null } }).lean();

        if (guides.length === 0) {
            console.log(`â„¹ï¸ Catalogue local : "${name}" trouvÃ© (idMetacard unique) mais aucun prix dans le guide local.`);
            return { trouvaille: null, ambigu: false };
        }

        const prixMoyen = guides.reduce((s, g) => s + g.trend, 0) / guides.length;
        const idProductRetenu = guides[0].idProduct;

        console.log(`âœ… Catalogue local : "${name}" -> idProduct ${idProductRetenu}, prix ${prixMoyen.toFixed(2)} â‚¬ (moyenne sur ${guides.length} rÃ©impression(s))`);

        return {
            trouvaille: {
                price: parseFloat(prixMoyen.toFixed(2)),
                idProduct: idProductRetenu,
                url: `https://www.cardmarket.com/en/Pokemon/Products/Singles?idProduct=${idProductRetenu}`
            },
            ambigu: false
        };

    } catch (e) {
        console.error(`âŒ Erreur catalogue local pour "${name}" :`, e.message);
        return { trouvaille: null, ambigu: false };
    }
}



// ============================================================
// Ã‰TAPE 2 â€” Identification via TCGdex (gratuit, sans clÃ©)
// ============================================================
// NOTE : la comparaison d'images (hash perceptif via sharp) a Ã©tÃ© RETIRÃ‰E.
// MesurÃ© en conditions rÃ©elles : sur des photos d'annonce (angle, reflets,
// carte sous sleeve), les distances tournaient entre 21 et 41/64 â€” aucune ne se
// dÃ©tachait, et le hash dÃ©signait parfois la MAUVAISE carte. Il apportait ~15
// points de bruit face au numÃ©ro (50), Ã  la rÃ©gion (Â±45) et au set (40), qui
// dÃ©cident rÃ©ellement.
// Le retirer supprime au passage la dÃ©pendance Ã  `sharp` (module natif, lourd en
// RAM), ce qui allÃ¨ge le dÃ©ploiement et rend l'architecture portable en extension.

// Langues supportÃ©es par TCGdex pour la recherche (codes ISO)
const LANGUES_TCGDEX = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ja', 'ko', 'zh-cn', 'zh-tw', 'nl', 'pl', 'ru', 'id', 'th'];

// Convertit notre code langue (EN, FR, JP...) vers le code TCGdex (en, fr, ja...)
function langueVersTCGdex(langue) {
    const map = { EN: 'en', FR: 'fr', DE: 'de', ES: 'es', IT: 'it', PT: 'pt', JP: 'ja', KR: 'ko', ZH: 'zh-cn', RU: 'ru' };
    return map[(langue || 'EN').toUpperCase()] || 'en';
}

async function chercherCartesTCGdex(name, numberFilter, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}&localId=${numberFilter}`;
    const response = await axios.get(url, { timeout: 15000 });
    return Array.isArray(response.data) ? response.data : [];
}

// Recherche TCGdex par nom seul (sans numÃ©ro), pour les cas oÃ¹ le numÃ©ro bloque le match
async function chercherCartesTCGdexNomSeul(name, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}`;
    const response = await axios.get(url, { timeout: 15000 });
    return Array.isArray(response.data) ? response.data : [];
}

// GÃ©nÃ¨re des variantes d'un nom de carte pour contourner les diffÃ©rences de
// nommage entre l'IA, TCGdex et Cardmarket (MÃ©ga, esperluette, tirets, suffixes...).
function genererVariantesNom(name) {
    const variantes = new Set();
    const base = name.trim();
    variantes.add(base);

    // "M Kangaskhan-EX" / "M-Kangaskhan" -> "Mega Kangaskhan..."
    if (/^M[\s-]/i.test(base)) {
        variantes.add(base.replace(/^M[\s-]/i, 'Mega '));
    }
    // "Mega X" -> "M X" (l'inverse, au cas oÃ¹)
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
    // Retirer les suffixes de type -EX/-GX/-V/-VMAX pour Ã©largir
    const sansSuffixe = base.replace(/[\s-]*(EX|GX|V|VMAX|VSTAR)\b/gi, '').trim();
    if (sansSuffixe && sansSuffixe !== base) variantes.add(sansSuffixe);

    // Nom principal seul (premier mot significatif) en tout dernier recours
    const premierMot = base.split(/[\s&-]/)[0];
    if (premierMot && premierMot.length > 2) variantes.add(premierMot);

    return [...variantes];
}

// Liste des sets TCGdex, mÃ©morisÃ©e pour la durÃ©e du process. Elle sert Ã  traduire un
// TOTAL imprimÃ© en SET, ce qui est le signal le plus fiable dont on dispose. Un seul
// appel rÃ©seau, rÃ©utilisÃ© par toutes les identifications : sans ce cache, chaque scan
// paierait une requÃªte supplÃ©mentaire pour une donnÃ©e qui bouge quelques fois par an.
// âš ï¸ UNE LISTE PAR LANGUE, et c'est dÃ©cisif. /v2/en/sets ne contient que les 218 sets
// INTERNATIONAUX ; /v2/ja/sets en contient 177, dont les sets japonais avec leur total
// IMPRIMÃ‰ exact. MesurÃ© :
//     total 128 -> en: AUCUN     ja: E1 ã€ŒåŸºæœ¬æ‹¡å¼µãƒ‘ãƒƒã‚¯ã€
//     total  92 -> en: ex12      ja: E2 ã€Œåœ°å›³ã«ãªã„ç”ºã€
//     total  87 -> en: AUCUN     ja: E3 ã€Œæµ·ã‹ã‚‰ã®é¢¨ã€   (le set de Scizor)
//     total  88 -> en: me03      ja: E4 ã€Œè£‚ã‘ãŸå¤§åœ°ã€, E5  (celui de Flareon et Rhydon)
// Interroger la liste `en` pour une carte japonaise donnait donc Â« Perfect Order Â» (2025)
// sur un total de 88 : c'est ce qui a fait rendre Â« Turtonator Â» Ã  0,02 â‚¬ au lieu d'un
// Flareon EC4 Ã  239,94 â‚¬. Et les ids japonais de TCGdex (E1..E5) sont EXACTEMENT ce que
// l'IA lit sur la carte, ce que la table ALIAS_CODES_LUS relie aux codes Cardmarket
// EC1..EC5 â€” la correspondance est vÃ©rifiÃ©e une par une, sans exception.
const _setsTCGdex = new Map();      // langueApi -> { liste, expire }
const DUREE_CACHE_SETS_MS = 24 * 60 * 60 * 1000;

/**
 * Quelle LISTE DE SETS consulter pour une carte de cette langue.
 *
 * âš ï¸ DÃ‰LIBÃ‰RÃ‰MENT DIFFÃ‰RENT de langueVersTCGdex, qui sert Ã  chercher un NOM (et oÃ¹
 * interroger le franÃ§ais a tout son sens). Ici on cherche des TAILLES de sets, et la
 * mesure impose deux choses :
 *   - le bucket ASIATIQUE (JP/ZH/KR, comme dans regionAttendue) -> 'ja', la seule liste
 *     qui contienne les sets japonais avec leur total imprimÃ© (E1..E5, PCG8...) ;
 *   - TOUT LE RESTE -> 'en', qui est la liste la plus COMPLÃˆTE : 218 sets contre 200 en
 *     franÃ§ais. Utiliser 'fr' pour une carte franÃ§aise perdrait 18 sets et rendrait le
 *     pont plus ambigu (mesurÃ© : total 182 donne 2 sets en fr lÃ  oÃ¹ en en donne moins).
 * Le comportement des cartes occidentales est donc rigoureusement INCHANGÃ‰.
 */
const LANGUES_ASIATIQUES = ['JP', 'ZH', 'ZH-CN', 'ZH-TW', 'CN', 'TW', 'KR'];
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
        console.warn(`âš ï¸ Liste des sets TCGdex [${lg}] indisponible (${e.message}) â€” le total ne pourra pas restreindre les sets.`);
    }
    return cache?.liste || [];
}

/**
 * Sets dont la taille officielle == total lu, dans la langue de la CARTE.
 *
 * âš ï¸ PAS DE REPLI D'UNE LANGUE SUR L'AUTRE. Pour une carte japonaise dont aucun set
 * japonais ne fait la bonne taille, on renvoie [] â€” et c'est la bonne rÃ©ponse. Se rabattre
 * sur le catalogue international proposerait des produits d'une AUTRE Ã©dition, et cette
 * fausse piste ne serait pas seulement inutile : elle sert de PÃ‰RIMÃˆTRE de recherche.
 * MesurÃ© sur le SalamÃ¨che McDonald's â€” total 18, aucun set japonais de cette taille, et
 * la liste `en` proposait Â« Southern Islands Â» et Â« Detective Pikachu Â». Un pont vide
 * laisse la main au nom, au numÃ©ro et Ã  la rÃ©gion, qui eux ne se trompent pas d'Ã©dition.
 */
async function setsPourTotal(totalImprime, langue = null) {
    if (!totalImprime) return [];
    const sets = await chargerSetsTCGdex(langueDesSetsTCGdex(langue));
    return setsCompatiblesAvecTotal(sets, totalImprime);
}

const setIdDeCarte = idCarte => (idCarte && idCarte.includes('-')) ? idCarte.slice(0, idCarte.lastIndexOf('-')) : null;

/**
 * DÃ©tail d'une carte TCGdex : nom ANGLAIS + variantes. Un seul appel, deux usages.
 * Le nom trouvÃ© peut Ãªtre dans la langue de recherche (ex: franÃ§ais) alors que le
 * catalogue Cardmarket est en anglais â€” d'oÃ¹ la rÃ©cupÃ©ration par l'id, universel.
 * `variants_detailed` vient de la MÃŠME rÃ©ponse : c'est la table de routage des motifs
 * de reverse (motif -> idProduct Cardmarket), obtenue sans requÃªte supplÃ©mentaire.
 */
async function detailCarteTCGdex(idCarte, nomTrouve = null) {
    try {
        const r = await axios.get(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(idCarte)}`, { timeout: 15000 });
        const nomExact = r.data?.name || null;
        if (nomExact && nomTrouve && nomExact !== nomTrouve) {
            console.log(`ðŸ”¤ Nom anglais rÃ©cupÃ©rÃ© : "${nomExact}" (trouvÃ© en "${nomTrouve}").`);
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
 * et le numÃ©ro (qui donne la carte dans ce set).
 *
 * C'est le chemin de secours quand le nom est dÃ©montrablement faux ou inexploitable :
 *  - nom hallucinÃ© mais plausible (Dana lue "Kahili") : le nom existe ailleurs, donc
 *    rien en aval ne peut le suspecter ;
 *  - nom impossible Ã  apparier entre TCGdex et Cardmarket ("_____'s Pikachu", oÃ¹ le
 *    nombre de tirets bas diffÃ¨re d'une source Ã  l'autre).
 * Dans les deux cas le numÃ©ro Ã©tait parfaitement lisible.
 */
async function identifierParTotalEtNumero(number, totalImprime, langue = null) {
    // La langue de la CARTE choisit le catalogue : les sets japonais ne sont pas dans
    // /v2/en/sets, et y chercher un total japonais dÃ©signe un produit d'une autre Ã©dition.
    const langueApi = langueDesSetsTCGdex(langue);
    const sets = await setsPourTotal(totalImprime, langue);
    if (sets.length === 0) return null;
    if (sets.length > 5) {
        // Total peu discriminant (typiquement <= 30 : trainer kits, promos POP).
        console.log(`â„¹ï¸ [total] ${sets.length} sets Ã  ${totalImprime} cartes â€” trop peu discriminant, on n'essaie pas.`);
        return null;
    }

    const trouvees = [];
    await Promise.all(sets.map(async s => {
        try {
            const detail = await axios.get(`https://api.tcgdex.net/v2/${langueApi}/sets/${encodeURIComponent(s.id)}`, { timeout: 15000 });
            for (const c of (detail.data?.cards || [])) {
                const corr = comparerNumeros(number, c.localId);
                if (corr) trouvees.push({ carte: c, set: s, correspondance: corr });
            }
        } catch (_) { /* set indisponible : on continue avec les autres */ }
    }));

    if (trouvees.length === 0) return null;
    // Une Ã©galitÃ© EXACTE prime sur une Ã©galitÃ© de chiffres (cf. "SV14" vs "14").
    const exactes = trouvees.filter(t => t.correspondance === 'exact');
    const retenues = exactes.length ? exactes : trouvees;
    const gagnante = retenues[0];

    console.log(`ðŸŽ¯ [total] ${totalImprime} cartes -> set ${gagnante.set.id} ("${gagnante.set.name}") ; nÂ°${number} -> ${gagnante.carte.id} ("${gagnante.carte.name}")`);
    if (retenues.length > 1) console.log(`   âš ï¸ ${retenues.length} cartes candidates Ã  ce numÃ©ro â€” identification marquÃ©e incertaine.`);
    return {
        id: gagnante.carte.id,
        localId: gagnante.carte.localId,
        nom: gagnante.carte.name,
        setId: gagnante.set.id,
        ambigu: retenues.length > 1
    };
}

async function trouverCarteTCGdex(name, number, setCode, imageUrlVinted, langue = 'EN', totalImprime = null) {
    try {
        const variantes = genererVariantesNom(name);
        let resultats = [];
        let nomUtilise = name;

        // On cherche d'abord dans la langue de la carte (le nom lu par l'IA correspond
        // mieux au nom TCGdex dans cette langue), puis en anglais en repli.
        const langueCarte = langueVersTCGdex(langue);
        const languesAEssayer = langueCarte === 'en' ? ['en'] : [langueCarte, 'en'];

        // Pour chaque langue, chaque variante de nom, essayer : numÃ©ro strict -> numÃ©ro large
        for (const langApi of languesAEssayer) {
            for (const variante of variantes) {
                resultats = await chercherCartesTCGdex(variante, `eq:${encodeURIComponent(number)}`, langApi);
                if (resultats.length === 0) {
                    const numeroSansZeros = String(number).replace(/^0+/, '') || number;
                    resultats = await chercherCartesTCGdex(variante, encodeURIComponent(numeroSansZeros), langApi);
                }
                if (resultats.length > 0) {
                    nomUtilise = variante;
                    if (langApi !== 'en' || variante !== name) console.log(`â„¹ï¸ TCGdex : trouvÃ© via "${variante}" en [${langApi}] (recherche initiale "${name}").`);
                    break;
                }
            }
            if (resultats.length > 0) break;
        }

        // Dernier recours : recherche par NOM SEUL (sans numÃ©ro) dans les deux langues
        if (resultats.length === 0) {
            for (const langApi of languesAEssayer) {
                for (const variante of variantes) {
                    const parNom = await chercherCartesTCGdexNomSeul(variante, langApi);
                    if (parNom.length > 0) {
                        const numLu = String(number).replace(/^0+/, '');
                        const matchNum = parNom.filter(c => String(c.localId).replace(/^0+/, '') === numLu);
                        resultats = matchNum.length > 0 ? matchNum : parNom;
                        nomUtilise = variante;
                        console.log(`â„¹ï¸ TCGdex : trouvÃ© par nom seul via "${variante}" en [${langApi}] (${resultats.length} rÃ©sultat(s)).`);
                        break;
                    }
                }
                if (resultats.length > 0) break;
            }
        }

        // ---- LE TOTAL PASSE AVANT LE NOM ----------------------------------------
        // HiÃ©rarchie : numÃ©ro + total > set dÃ©clarÃ© > NOM. Un set dont la taille ne
        // correspond pas au total imprimÃ© ne doit pas pouvoir gagner, quel que soit
        // le nom lu â€” c'est ce qui aurait Ã©cartÃ© Lost Thunder (214 cartes) sur une
        // carte lue "173/181", Team Up Ã©tant le seul set Ã  181 cartes.
        const resultatsDuNom = resultats;   // conservÃ©s comme filet, voir plus bas
        // La langue de la CARTE choisit le catalogue de sets. Avec la liste `en`, un total
        // japonais de 88 dÃ©signait Â« Perfect Order Â» (2025) et tous les rÃ©sultats du nom
        // Â« Flareon Â» Ã©taient Ã©cartÃ©s comme suspects : le nom Ã©tait juste, c'est TCGdex qui
        // n'avait pas le set. Avec la liste `ja`, 88 donne E4/E5, oÃ¹ Flareon figure.
        const setsDuTotal = await setsPourTotal(totalImprime, langue);
        const idsSetsDuTotal = new Set(setsDuTotal.map(s => s.id));
        if (setsDuTotal.length && resultats.length) {
            const compatibles = resultats.filter(r => idsSetsDuTotal.has(setIdDeCarte(r.id)));
            if (compatibles.length && compatibles.length < resultats.length) {
                console.log(`ðŸŽ¯ Total ${totalImprime} -> ${resultats.length} rÃ©sultats rÃ©duits Ã  ${compatibles.length} (sets de la bonne taille).`);
                resultats = compatibles;
            } else if (compatibles.length === 0) {
                // Le nom a ramenÃ© des cartes, mais AUCUNE dans un set de la bonne taille :
                // c'est le nom qui est suspect, pas le total. On ne s'appuie plus dessus.
                console.warn(`âš ï¸ Aucun rÃ©sultat de "${nomUtilise}" n'appartient Ã  un set de ${totalImprime} cartes â€” le NOM lu est suspect.`);
                resultats = [];
            }
        }

        // Nom inexploitable (aucun rÃ©sultat, ou tous Ã©cartÃ©s par le total) : on
        // identifie sans lui, par le total puis le numÃ©ro.
        if (resultats.length === 0) {
            const parTotal = await identifierParTotalEtNumero(number, totalImprime, langue);
            if (parTotal) {
                const detail = await detailCarteTCGdex(parTotal.id);
                console.log(`ðŸ”— Carte TCGdex retenue SANS le nom : ${parTotal.id} ("${detail.nomExact || parTotal.nom}")`);
                return {
                    id: parTotal.id, ambigu: parTotal.ambigu,
                    nomExact: detail.nomExact || parTotal.nom,
                    localId: parTotal.localId || number,
                    variants: detail.variants, variantsDetailed: detail.variantsDetailed,
                    source: 'total+numero'   // le nom lu est Ã©cartÃ©, il ne sert plus Ã  rien en aval
                };
            }
            // âš ï¸ FILET : le total est une PRÃ‰FÃ‰RENCE, jamais un veto qui fait tout perdre.
            // Si le nom avait ramenÃ© des cartes et que le total les a toutes Ã©cartÃ©es
            // SANS rien proposer en Ã©change, c'est le TOTAL qui Ã©tait mal lu â€” pas le
            // nom. On restaure alors les rÃ©sultats du nom plutÃ´t que d'Ã©chouer lÃ  oÃ¹
            // l'ancien code rÃ©ussissait.
            if (resultatsDuNom.length) {
                console.warn(`â†©ï¸ Le total ${totalImprime} n'a rien donnÃ© non plus : il est probablement mal lu. On revient aux ${resultatsDuNom.length} rÃ©sultat(s) du nom.`);
                resultats = resultatsDuNom;
            } else {
                console.error(`âš ï¸ TCGdex : aucun rÃ©sultat pour "${name}" #${number} (mÃªme avec variantes).`);
                return null;
            }
        }

        let choisi = resultats[0];
        let ambigu = false;

        if (resultats.length > 1) {
            console.log(`â„¹ï¸ TCGdex : ${resultats.length} rÃ©sultats pour "${nomUtilise}" #${number} :`, resultats.map(r => r.id));

            // DÃ©partage par le code du set lu par l'IA. (La comparaison d'images a Ã©tÃ©
            // retirÃ©e : sur des photos d'annonce, elle donnait 35-41/64 mÃªme pour la
            // bonne carte â€” donc aucun signal exploitable.)
            const correspondance = setCode ? resultats.find(r => r.id.toLowerCase().includes(setCode.toLowerCase())) : null;

            if (correspondance) {
                choisi = correspondance;
                console.log(`â„¹ï¸ DÃ©partage par le set "${setCode}".`);
            } else {
                // Pas de code de set lisible (frÃ©quent sur les vieilles cartes). On tente
                // de trancher par le TOTAL imprimÃ© (X/Y -> Y) : chaque set a un nombre de
                // cartes officiel. On rÃ©cupÃ¨re le cardCount des sets candidats via TCGdex
                // et on garde celui qui colle. Corrige "mÃªme numÃ©ro dans plusieurs sets"
                // (ex: Venusaur 3/108 Dark Explorers vs Venusaur ex #3 du set 151).
                const totN = totalImprime ? parseInt(String(totalImprime).replace(/\D/g, ''), 10) : null;
                let departageTotal = null;
                if (totN) {
                    // Ce chemin n'a PAS d'early-exit (il faut vÃ©rifier tous les sets candidats
                    // de toute faÃ§on), contrairement Ã  la recherche par variante ci-dessus :
                    // parallÃ©liser ne change donc AUCUN volume total de requÃªtes TCGdex, juste
                    // leur ordonnancement. Sets distincts typiquement peu nombreux (2 Ã  5 ici),
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
                        console.log(`âš ï¸ ${matches.length} sets Ã  ${totN} cartes pour "${name}" #${number} â€” le live tranchera.`);
                    }
                }
                if (departageTotal) {
                    choisi = departageTotal;
                    console.log(`â„¹ï¸ DÃ©partage par le total imprimÃ© (${totN} cartes) -> ${choisi.id}.`);
                } else if (!ambigu) {
                    // Aucun moyen de trancher : premier candidat, marquÃ© incertain. Le
                    // garde-fou live vÃ©rifiera le numÃ©ro et rebondira si besoin.
                    ambigu = true;
                    console.log(`âš ï¸ ${resultats.length} impressions possibles pour "${name}" #${number} et pas de set pour trancher â€” le live vÃ©rifiera.`);
                }
            }
        }

        // ---- CONTRÃ”LE FINAL : le total imprimÃ© contredit-il le set retenu ? -----
        // TCGdex annonce lui-mÃªme le nombre officiel de cartes de chaque set. Si l'IA a lu
        // un total et que le set retenu en annonce un AUTRE, la carte retenue ne peut pas
        // venir de ce set. Cas rÃ©el â€” Wartortle lu Â« 019/029 Â» : TCGdex retenait PCG8-019,
        // alors que PCG8 ã€Œãã›ãã®çµæ™¶ã€ compte 75 cartes officielles. Une carte imprimÃ©e
        // /029 n'en vient pas. Le filtre par total ne l'attrapait pas, parce qu'AUCUN set
        // (ni en, ni ja) ne fait 29 cartes : la liste des sets compatibles Ã©tait vide, donc
        // le filtre entier Ã©tait sautÃ©.
        // On ne REJETTE pas â€” le total peut Ãªtre mal lu, et la carte retenue reste le
        // meilleur candidat connu â€” mais on cesse de la prÃ©senter comme une certitude.
        const totalLu = totalImprime ? parseInt(String(totalImprime).replace(/\D/g, ''), 10) : null;
        if (totalLu) {
            const setRetenu = setIdDeCarte(choisi.id);
            const infoSet = (await chargerSetsTCGdex(langueDesSetsTCGdex(langue))).find(s => s.id === setRetenu);
            const officiel = infoSet?.cardCount?.official ?? null;
            if (officiel && officiel !== totalLu) {
                ambigu = true;
                console.warn(
                    `âš ï¸ [total-contredit-le-set] le total lu est ${totalLu}, mais le set retenu` +
                    ` ${setRetenu} ("${infoSet.name}") en compte ${officiel} officiellement.` +
                    ` La carte retenue ne peut pas venir de ce set -> rÃ©sultat marquÃ© INCERTAIN.`
                );
            }
        }

        const detail = await detailCarteTCGdex(choisi.id, choisi.name);
        const nomExact = detail.nomExact || choisi.name;

        console.log(`ðŸ”— Carte TCGdex retenue : ${choisi.id} ("${nomExact}")${ambigu ? ' [INCERTAIN]' : ''}`);
        return {
            id: choisi.id, ambigu, nomExact, localId: choisi.localId || number,
            variants: detail.variants, variantsDetailed: detail.variantsDetailed,
            source: 'nom'
        };

    } catch (e) {
        console.error(`âŒ Erreur recherche TCGdex pour "${name}" #${number} :`, e.response?.status, e.message);
        return null;
    }
}

async function getPrixDepuisTCGdex(cardId, name, number) {
    try {
        const url = `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`;
        const response = await axios.get(url, { timeout: 15000 });
        const cardmarket = response.data?.pricing?.cardmarket;

        if (!cardmarket) {
            console.error(`âš ï¸ TCGdex : pas de donnÃ©es Cardmarket pour "${cardId}" (carte pas encore cotÃ©e sur Cardmarket ?).`);
            return null;
        }

        // On privilÃ©gie la tendance (reflÃ¨te le mieux le prix actuel), avec replis successifs
        const prix = cardmarket.trend ?? cardmarket.avg ?? cardmarket['trend-holo'] ?? cardmarket['avg-holo'] ?? cardmarket.avg7 ?? cardmarket.avg30;

        if (typeof prix !== 'number') {
            console.error(`âš ï¸ TCGdex : objet cardmarket vide/incomplet pour "${cardId}".`, cardmarket);
            return null;
        }

        console.log(`âœ… Prix TCGdex/Cardmarket pour "${cardId}" : ${prix} â‚¬`);

        // TCGdex ne fournit pas l'URL exacte de la fiche Cardmarket -> on donne un lien de
        // recherche Cardmarket fonctionnel (pas la fiche exacte, mais jamais cassÃ©).
        const urlRecherche = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name + ' ' + number)}`;

        return { price: prix, url: urlRecherche };

    } catch (e) {
        console.error(`âŒ Erreur rÃ©cupÃ©ration prix TCGdex pour "${cardId}" :`, e.response?.status, e.message);
        return null;
    }
}



// ============================================================
// DÃ©tection de rÃ©gion (occidental vs japonais) pour Ã©viter de confondre
// une carte FR/EN (ex: Destined Rivals) avec son Ã©dition japonaise (sv9a).
// ============================================================
// regionDuCodeSet vit dans scoring.js : c'est une fonction PURE, et ses cas limites
// (MCDP vs MCD11, SI vs SI-JP, xPRE vs xsv8a, "SV-P/CS" neutre) sont vÃ©rifiÃ©s par la
// suite de tests de ce module. Elle est importÃ©e en tÃªte de fichier.

// RÃ©gion attendue dÃ©duite de ce que l'IA a lu :
//  - langue JP -> japonais (= bucket ASIATIQUE)
//  - chinois (ZH) / corÃ©en (KR) -> asiatique aussi. Cardmarket range le chinois
//    simplifiÃ© ET traditionnel + le corÃ©en du cÃ´tÃ© japonais (mÃªme numÃ©rotation) ;
//    leurs produits (codes type "mC", "...C") sont classÃ©s "japonais" ici. Sans Ã§a,
//    une carte chinoise prenait -45 de malus rÃ©gion et la bonne carte perdait.
//  - langue occidentale (FR/EN/DE/ES/IT/PT) -> occidental
//  - Ã  dÃ©faut, la structure du numÃ©ro : "184/182" (occidental) vs pas de total (souvent JP)
function regionAttendue(cardInfo) {
    const langue = (cardInfo.language || '').toUpperCase();
    if (langue === 'JP') return 'japonais';
    if (['ZH', 'KR', 'ZH-CN', 'ZH-TW', 'CN', 'TW'].includes(langue)) return 'japonais';
    if (['FR', 'EN', 'DE', 'ES', 'IT', 'PT'].includes(langue)) return 'occidental';
    // Repli sur la structure du numÃ©ro : un total prÃ©sent (X/Y) = format occidental
    if (cardInfo.total) return 'occidental';
    return null;
}

// Normalise un nom pour comparaison : minuscules, sans espaces/tirets/ponctuation.
// "M Kangaskhan EX" et "MKangaskhan EX" -> "mkangaskhanex" (identiques).
function normaliserNom(nom) {
    return nom.toLowerCase().replace(/[\s\-'.&]/g, '');
}

// ============================================================
// Ã‰CARTE LES NON-CARTES du vivier de candidats
// ============================================================
// Cardmarket range dans le mÃªme catalogue que les cartes les Â« Online / Live Code
// Card Â» : les cartons de code numÃ©rique glissÃ©s dans les boosters. Ce ne sont pas des
// cartes PokÃ©mon, on ne les scannera jamais, et elles n'ont aucune raison de disputer
// un score Ã  la vraie carte.
//
// POURQUOI CE CRITÃˆRE-LÃ€, ET LUI SEUL. MesurÃ© sur les 70 975 produits du catalogue :
//   - 1246 produits contiennent Â« Code Card Â», dont 460 portaient un numeroUrl parasite
//     valant "2" (extrait de "?language=2" â€” voir nettoyer-slugs.js), ce qui les rendait
//     appariables Ã  n'importe quelle carte nÂ°2 ;
//   - un seul porte un `numero` : idProduct 279891, numero "CC-1", dans l'expansion 1645
//     (code PKM) dont les 443 produits sont TOUS des Code Cards. "CC-1" est la rÃ©fÃ©rence
//     Cardmarket du carton lui-mÃªme, pas un numÃ©ro de carte : rien Ã  sauver ;
//   - contrÃ´le dÃ©cisif : 0 produit non-Code-Card ne partage un idMetacard avec une Code
//     Card. L'exclusion ne peut donc pas emporter une impression lÃ©gitime par ricochet.
//
// Et surtout, les autres familles qu'on aurait pu croire non-cartes n'en sont pas :
// Â« Suspicious Food Tin Â» et Â« Amulet Coin Â» sont de vrais Dresseurs, Â« Talonflame
// (Theme Deck) Â» une vraie carte, Â« [â€¦ | Burn Booster] Â» et Â« [Random Spark] Â» des noms
// d'attaques. Hors Code Card, les motifs Display/Playmat/Portfolio/Figurine ne ramÃ¨nent
// AUCUN produit. Un filtre par mots-clÃ©s Â« booster / tin / coin Â» jetterait des cartes
// rÃ©elles : Â« Code Card Â» est le seul critÃ¨re juste, et il suffit.
const EST_CODE_CARD = /code\s*card/i;

function ecarterNonCartes(produits, contexte) {
    if (!Array.isArray(produits) || produits.length === 0) return produits;
    const gardes = produits.filter(p => !EST_CODE_CARD.test(String(p?.name || '')));
    const ecartes = produits.length - gardes.length;
    if (ecartes > 0) {
        console.log(`ðŸš® ${ecartes} Code Card Ã©cartÃ©e(s) du vivier (${contexte}) â€” reste ${gardes.length} candidat(s).`);
    }
    // Vivier vidÃ© : on renvoie bien le vide. Un vivier composÃ© UNIQUEMENT de Code Cards
    // ne peut produire qu'un verdict faux ; mieux vaut l'Ã©chec franc, qui rembourse le
    // scan, qu'un prix de carton de code prÃ©sentÃ© comme celui d'une carte.
    if (gardes.length === 0 && produits.length > 0) {
        console.warn(`âš ï¸ [non-cartes] les ${produits.length} candidat(s) de "${contexte}" Ã©taient tous des Code Cards.`);
    }
    return gardes;
}

// ============================================================
// CHOIX DU VIVIER â€” la rÃ¨gle du Â« aucun candidat au numÃ©ro lu Â»
// ============================================================
// LE TROU QU'ELLE BOUCHE. Aujourd'hui, trouverProduitsParNumero n'est tentÃ© QUE si le
// vivier par nom est VIDE. Or il existe un cas oÃ¹ il est plein et pourtant inutilisable :
// l'IA lit un nom faux qui EXISTE ailleurs. MesurÃ© sur le cas rÃ©el â€” Â« Kahili Â» lu au
// lieu de Â« Dana Â» ramÃ¨ne 8 produits, aucun au nÂ°173, et le scoring rend quand mÃªme un
// gagnant Ã  70 points sans le moindre avertissement.
//
// Ce cas ne passe aujourd'hui que grÃ¢ce Ã  `numeroContredit`, qui exige que TCGdex ait
// rendu une carte au numÃ©ro divergent. Ce garde-fou tombe dÃ¨s que TCGdex est D'ACCORD
// avec la mauvaise lecture (voir le test 24 de scoring.js, qui simule cet accord).
//
// LA RÃˆGLE, en clair :
//   1. Vivier par le nom. S'il contient AU MOINS UN candidat de rang 1 (son numÃ©ro
//      correspond Ã  celui lu) -> on le garde. Comportement inchangÃ©.
//   2. Sinon â€” et seulement si au moins un candidat CONTREDIT le numÃ©ro, voir la note
//      sur la preuve positive dans bilanDesRangs â€” on construit le vivier par NUMÃ‰RO :
//      d'abord dans les expansions attendues (si elles ont survÃ©cu au contrÃ´le de
//      setCode), puis, Ã  dÃ©faut seulement, sur TOUT le catalogue.
//   3. Si aucun des deux n'a de rang 1 -> on garde le meilleur vivier disponible et on
//      LIVRE le prix, marquÃ© `carteIncertaine` avec le motif `aucun-candidat-au-numero`.
//      Un prix avec rÃ©serve vaut mieux que rien, et la politique de remboursement traite
//      dÃ©jÃ  Â« livrÃ© avec rÃ©serve Â» comme livrÃ©.
//   4. Aucun vivier du tout -> Ã©chec dur et remboursement. InchangÃ© (`aucun-candidat`).
//
// âš ï¸ POURQUOI LE PÃ‰RIMÃˆTRE D'ABORD, ET TOUT LE CATALOGUE SEULEMENT ENSUITE. Le rÃ©flexe
// Ã©tait de chercher d'emblÃ©e dans tout le catalogue, pour ne pas dÃ©pendre d'un set
// attendu qui peut Ãªtre faux. MESURÃ‰ SUR LES DIX CAS : Ã§a en casse quatre.
//   - le nÂ°173 existe dans 115 produits occidentaux, TOUS Ã  120 points, le bon Ã  95 :
//     sans setCode lu, le total (181 -> Team Up) est le SEUL discriminant, et c'est
//     exactement ce que l'expansion attendue apporte. Idem pour Nita et Evelyn.
//   - le nÂ°024 existe dans 510 produits ; les promos SVP et SV-P dÃ©crochent +40 (code
//     Ã©gal au Â« SV-P Â» lu) contre +15 pour la ligne chinoise SV-P/CS, qui est la bonne.
// Le pÃ©rimÃ¨tre n'est donc PAS le problÃ¨me : le pÃ©rimÃ¨tre INVALIDE l'est. C'est pour Ã§a
// que le contrÃ´le vit en amont, dans expansionsDuSetTCGdex â€” quand le setCode lu
// contredit le code de l'expansion attendue, celle-ci est abandonnÃ©e et ne cadre plus
// rien. Le vivier sans pÃ©rimÃ¨tre reste utile en DERNIER recours : au plus ~850 produits
// (mesurÃ© : 828 pour le nÂ°004, 855 pour le nÂ°1), mieux que rien du tout.
//
// On ne rÃ©ordonne RIEN : le rang ne devient pas un critÃ¨re de score. Il sert Ã  choisir
// le vivier, puis Ã  qualifier la confiance.
//
// âš ï¸ Les candidats reÃ§us ici viennent du CATALOGUE et ne portent donc PAS de numÃ©ro :
// il faut le lire avant de pouvoir juger d'un rang. La premiÃ¨re version l'a oubliÃ©, et
// comme rangDuNumero rend Â« inconnu Â» sur un champ absent, la substitution se
// dÃ©clenchait Ã  CHAQUE scan â€” c'est ce qui a fait afficher 0,05 â‚¬ sur le SalamÃ¨che.
async function viviersAvecRangs(vivierNom, numeroLu, idExpansionsAttendues, contexte) {
    // Enrichissement MINIMAL : uniquement le numÃ©ro, seul champ dont les rangs dÃ©pendent.
    // C'est l'Ã©tape qui manquait : les documents catalogue n'ont pas de numeroCardmarket.
    const rangsDe = async produits => {
        const numeros = await lireNumeros(produits.map(p => p.idProduct));
        return bilanDesRangs(produits.map(p => {
            const d = numeros.get(p.idProduct);
            return { idProduct: p.idProduct, numeroCardmarket: d ? (d.numero || d.numeroUrl) : null };
        }), numeroLu);
    };
    const rangsNom = await rangsDe(vivierNom);

    if (!rangsNom.aucunRang1) {
        // Cas frÃ©quent et sain. Mais si AUCUN numÃ©ro n'est connu, on le dit : ce n'est
        // pas la mÃªme chose qu'un vivier validÃ©, et Ã§a signale un set non appris.
        if (rangsNom.aucunNumeroConnu) {
            console.log(`â„¹ï¸ ${contexte} : ${vivierNom.length} candidat(s), aucun numÃ©ro appris â€” rangs indisponibles, vivier conservÃ©.`);
        }
        return { produits: vivierNom, voie: 'nom', aucunCandidatAuNumero: false, rangs: rangsNom };
    }

    // Preuve positive : au moins un candidat porte un numÃ©ro connu, et il contredit.
    // Le log dit ce qu'il a RÃ‰ELLEMENT constatÃ© â€” combien de numÃ©ros Ã©taient lisibles,
    // combien contredisaient. Â« aucun au numÃ©ro X Â» tout court Ã©tait mensonger quand le
    // vivier n'avait simplement aucun numÃ©ro appris.
    console.warn(
        `âš ï¸ [vivier-sans-rang1] ${contexte} : ${vivierNom.length} candidat(s) par le nom,` +
        ` ${rangsNom.rang1 + rangsNom.rang3} Ã  numÃ©ro connu dont ${rangsNom.rang3} qui CONTREDISENT` +
        ` le numÃ©ro ${numeroLu}, 0 qui le portent, ${rangsNom.rang2} sans numÃ©ro appris` +
        ` -> recherche par NUMÃ‰RO`
    );

    // 1er repli : DANS LES EXPANSIONS ATTENDUES. Elles ont dÃ©jÃ  passÃ© le contrÃ´le de
    // setCode (voir expansionsDuSetTCGdex) : si elles sont encore lÃ , elles ne sont pas
    // contredites. Et elles portent une information que le numÃ©ro seul n'a pas â€” sur les
    // trois cas Team Up, le total est le SEUL discriminant entre 115 produits au nÂ°173.
    const exps = (idExpansionsAttendues || []).filter(e => e != null);
    for (const [ouCherche, chercher] of [
        [`l'expansion attendue ${exps.join('/') || 'â€”'}`, () => exps.length ? trouverProduitsParNumero(exps, numeroLu) : []],
        // 2e repli, en DERNIER recours : tout le catalogue. Moins discriminant (mesurÃ© :
        // il fait perdre 4 des 10 cas s'il passe en premier), mais mieux que rien quand
        // aucune expansion n'est attendue ou qu'elle ne contient pas ce numÃ©ro.
        ['tout le catalogue', () => trouverProduitsParNumeroPartout(numeroLu)]
    ]) {
        const parNumero = await chercher();
        if (!parNumero.length) continue;
        const rangs2 = await rangsDe(parNumero);
        if (rangs2.rang1 > 0) {
            console.log(`   â†ªï¸ vivier REMPLACÃ‰ depuis ${ouCherche} : ${parNumero.length} candidat(s), ${rangs2.rang1} au rang 1.`);
            return { produits: parNumero, voie: 'numero-substitue', aucunCandidatAuNumero: false, rangs: rangs2 };
        }
    }
    // Aucune voie ne donne de candidat au bon numÃ©ro. On livre quand mÃªme â€” un prix avec
    // rÃ©serve vaut mieux que rien â€” mais la rÃ©serve est explicite et nommÃ©e.
    console.warn(`   âš ï¸ aucun candidat au numÃ©ro ${numeroLu} par aucune voie -> rÃ©sultat marquÃ© incertain.`);
    return { produits: vivierNom, voie: 'nom', aucunCandidatAuNumero: true, rangs: rangsNom };
}

// Retrouve le(s) produit(s) dans le catalogue local pour un nom de carte donnÃ©.
// Utilise une comparaison NORMALISÃ‰E (ignore espaces, tirets, casse, ponctuation)
// car le format Cardmarket est trÃ¨s irrÃ©gulier (MKangaskhan, Mega Kangaskhan ex...).
async function trouverProduitsLocaux(nomExact) {
    try {
        if (mongoose.connection.readyState !== 1) return [];

        // Le nom Cardmarket a la forme "Nom [Attaques]". On isole le nom (avant le [) et on normalise.
        // On construit d'abord une liste de "cÅ“urs de nom" Ã  accepter (nom + variantes principales).
        const cibles = new Set();
        for (const v of genererVariantesNom(nomExact)) cibles.add(normaliserNom(v));

        // RÃ©cupÃ¨re un sur-ensemble via le 1er mot significatif (indexÃ©, rapide), puis filtre en JS
        const premierMot = nomExact.replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];
        if (!premierMot || premierMot.length < 3) {
            // Nom trop court pour prÃ©-filtrer : on tente une regex directe sur les variantes
            const variantes = genererVariantesNom(nomExact);
            for (const variante of variantes) {
                const regex = new RegExp(`^${echapperRegex(variante)}(\\s*\\[|$)`, 'i');
                const r = await CatalogueProduit.find({ name: regex }).lean();
                if (r.length > 0) return ecarterNonCartes(r, `nom court "${nomExact}"`);
            }
            return [];
        }

        const preselection = await CatalogueProduit.find({ name: new RegExp(echapperRegex(premierMot), 'i') }).lean();

        // Garde ceux dont le nom (partie avant "[") normalisÃ© correspond Ã  une de nos cibles
        const resultats = preselection.filter(p => {
            const nomProduit = p.name.split('[')[0].trim();
            return cibles.has(normaliserNom(nomProduit));
        });

        if (resultats.length > 0) {
            console.log(`â„¹ï¸ Catalogue local : ${resultats.length} produit(s) via correspondance normalisÃ©e pour "${nomExact}".`);
            return ecarterNonCartes(resultats, `nom "${nomExact}"`);
        }
        return [];
    } catch (e) {
        console.error(`âŒ Erreur trouverProduitsLocaux pour "${nomExact}" :`, e.message);
        return [];
    }
}

/**
 * Retrouve des produits Cardmarket par (expansion, NUMÃ‰RO) â€” sans jamais passer par le
 * nom. C'est le pendant catalogue de identifierParTotalEtNumero : une fois le SET connu
 * grÃ¢ce au total, le numÃ©ro suffit Ã  dÃ©signer la carte.
 *
 * RÃ¨gle le nom hallucinÃ© (Dana lue "Kahili") ET le nom inapparieable ("_____'s Pikachu",
 * dont le nombre de tirets bas diffÃ¨re entre TCGdex et Cardmarket).
 *
 * âš ï¸ PRÃ‰FÃ‰RENCE STRICTE POUR L'Ã‰GALITÃ‰ EXACTE. Les numÃ©ros Ã  prÃ©fixe sont frÃ©quents
 * (1936 en base : "TG09", "SV14", "001C") et ils collisionnent avec les numÃ©ros nus de
 * la mÃªme expansion â€” mesurÃ© : l'expansion 3630 contient "SV14" ET "14", l'expansion
 * 4361 contient "001C"/"001L"/"001P"/"001M". On ne retombe sur l'Ã©galitÃ© de chiffres
 * que si aucune correspondance exacte n'existe, et on renvoie alors TOUS les candidats
 * plutÃ´t que d'en choisir un : c'est au scoring de trancher.
 */
async function trouverProduitsParNumero(idExpansions, numeroLu) {
    try {
        if (mongoose.connection.readyState !== 1) return [];
        const exps = [...new Set((idExpansions || []).filter(e => e != null).map(Number))];
        if (!exps.length || numeroLu == null) return [];

        const docs = await NumeroCarte.find({ idExpansion: { $in: exps } }, { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 }).lean();
        return departagerParNumero(docs, numeroLu, `l'expansion ${exps.join('/')}`);
    } catch (e) {
        console.error(`âŒ Erreur trouverProduitsParNumero :`, e.message);
        return [];
    }
}

/**
 * MÃªme recherche, mais SANS PÃ‰RIMÃˆTRE : tout le catalogue.
 *
 * âš ï¸ POURQUOI ELLE EXISTE. La version restreinte ci-dessus a besoin d'expansions
 * attendues, qui viennent du pont total -> set, donc de TCGdex. Quand TCGdex ne connaÃ®t
 * pas le set (les sets japonais anciens, le McDonald's japonais 2002), le pont dÃ©signe un
 * set de mÃªme taille et la recherche se fait au mauvais endroit â€” le SalamÃ¨che McDonald's
 * a affichÃ© 0,05 â‚¬ pour cette raison : nÂ°004 cherchÃ© dans Â« Detective Pikachu Â».
 * Sans pÃ©rimÃ¨tre, on ne peut pas se tromper de pÃ©rimÃ¨tre. Le coÃ»t est mesurÃ© : au plus
 * ~850 produits (828 pour le nÂ°004, 855 pour le nÂ°1, 67 pour le nÂ°203), pour deux
 * allers-retours Mongo groupÃ©s au scoring quelle que soit la taille du vivier.
 */
async function trouverProduitsParNumeroPartout(numeroLu) {
    try {
        if (mongoose.connection.readyState !== 1 || numeroLu == null) return [];
        // On ne peut pas filtrer cÃ´tÃ© Mongo : la comparaison de numÃ©ros est normalisÃ©e
        // (zÃ©ros de tÃªte, prÃ©fixes) et doit rester STRICTEMENT celle du scoring. On lit
        // donc les numÃ©ros connus et on dÃ©partage en mÃ©moire, comme ci-dessus.
        const docs = await NumeroCarte.find(
            { $or: [{ numero: { $type: 'string', $ne: '' } }, { numeroUrl: { $type: 'string', $ne: '' } }] },
            { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 }
        ).lean();
        return departagerParNumero(docs, numeroLu, 'tout le catalogue');
    } catch (e) {
        console.error(`âŒ Erreur trouverProduitsParNumeroPartout :`, e.message);
        return [];
    }
}

// CÅ“ur commun aux deux recherches par numÃ©ro : prÃ©fÃ©rence STRICTE pour l'Ã©galitÃ© exacte,
// repli sur les chiffres seulement si aucune exacte n'existe, puis retour des documents
// CATALOGUE (mÃªme forme que trouverProduitsLocaux, donc interchangeables).
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
        // trouverProduitsLocaux (mÃªme forme : { idProduct, name, idExpansion, ... }).
        const produits = await CatalogueProduit.find({ idProduct: { $in: ids } }).lean();
        console.log(`ðŸ”¢ Recherche par NUMÃ‰RO : nÂ°${numeroLu} dans ${ouCherche} -> ${produits.length} produit(s) (correspondance ${exactes.length ? 'exacte' : 'sur les chiffres'}).`);
        // C'est ici que les Code Cards faisaient le plus de dÃ©gÃ¢ts : 460 d'entre elles
        // portaient un numeroUrl "2", donc ce repli les ramenait pour toute carte nÂ°2.
        return ecarterNonCartes(produits, `numÃ©ro ${numeroLu} / ${ouCherche}`);
    } catch (e) {
        console.error(`âŒ Erreur departagerParNumero :`, e.message);
        return [];
    }
}

// Prix depuis le guide local (instantanÃ©) pour un idProduct prÃ©cis.
// `estReverse` = l'impression VISÃ‰E est-elle une reverse ? Si oui, le prix vit dans les
// champs *Holo â€” que la reverse partage l'idProduct de la normale (Pikachu LOR 052 :
// 0,27 â‚¬ vs 10,13 â‚¬) ou qu'elle ait un produit dÃ©diÃ© (Master Ball 806449 : 0,50 â‚¬ vs
// 24,13 â‚¬). Voir prixDeReference, testÃ© dans scoring.js.
async function getPrixGuideLocal(idProduct, estReverse = false) {
    try {
        if (mongoose.connection.readyState !== 1) return null;
        const g = await GuidePrix.findOne({ idProduct }).lean();
        if (!g) return null;
        return prixDeReference(g, estReverse);
    } catch (e) {
        console.error(`âŒ Erreur getPrixGuideLocal pour ${idProduct} :`, e.message);
        return null;
    }
}

// Version groupÃ©e de getPrixGuideLocal : un seul aller-retour Mongo pour N idProduct
// (mÃªme repli de champs, mÃªme contrat de retour null si prix inconnu). Number() des
// deux cÃ´tÃ©s pour la mÃªme raison que lireCodeSets ci-dessus.
async function getPrixGuideLocalLot(idsProducts, estReverse = false) {
    try {
        if (mongoose.connection.readyState !== 1) return new Map();
        const uniques = [...new Set(idsProducts.filter(id => id != null).map(Number))];
        if (uniques.length === 0) return new Map();
        const docs = await GuidePrix.find({ idProduct: { $in: uniques } }).lean();
        const map = new Map();
        // MÃªme sÃ©lection de prix que getPrixGuideLocal (via prixDeReference) : les deux
        // chemins doivent voir le MÃŠME prix, sinon le scoring dÃ©partage sur une valeur
        // que la route n'affichera jamais.
        for (const g of docs) map.set(Number(g.idProduct), prixDeReference(g, estReverse));
        return map;
    } catch (e) {
        console.error("Erreur lecture prix guide (lot):", e.message);
        return new Map();
    }
}

// LibellÃ©s des stratÃ©gies reverse renvoyÃ©es par scoring.js. Uniquement pour les logs :
// la valeur transmise Ã  l'extension reste le code court ('produit-distinct'|'filtre-url').
const LIBELLES_STRATEGIE_REVERSE = {
    'produit-distinct': "le motif est un PRODUIT distinct -> lecture normale de sa fiche",
    'filtre-url': "produit PARTAGÃ‰ avec la version normale -> filtre isReverseHolo=Y (live) / trendHolo (guide)",
    inconnue: "indÃ©terminÃ©e"
};

// Trace unique du REPLI de motif, pensÃ©e pour Ãªtre grepÃ©e en production :
//   grep "[motif-non-resolu]" server.log
// Champs stables et dans un ordre fixe, valeurs sans espace, une seule ligne.
// âš ï¸ Ce log ne se dÃ©clenche QUE quand la carte A un motif de reverse ET qu'on n'a pas
// su le cibler. JAMAIS sur "pas d'idProduct par variante" : les cartes des vieux sets
// n'ont pas de motif Ã  dÃ©partager, le chemin catalogue les rÃ©sout parfaitement, et les
// marquer incertaines viderait le drapeau de son sens (~86 % des cartes).
function loggerReplieMotif(resolution, cardInfo, analyse, tcgdexId, titre) {
    const motifTitre = motifDuTitre(titre) || 'aucun';
    console.warn(
        `âš ï¸ [motif-non-resolu] carte=${tcgdexId || '?'} nom=${String(cardInfo.name || '?').replace(/\s+/g, '_')}` +
        ` motifIA=${cardInfo.motif || '?'} motifTitre=${motifTitre}` +
        ` motifsCarte=${analyse.motifsDisponibles.join('|') || 'aucun'}` +
        ` variantes=${analyse.entrees.length} raison=${resolution.raison}` +
        ` -> repli catalogue + carteIncertaine`
    );
}

// ============================================================
// Enrichit les candidats (numÃ©ro appris + prix local + rÃ©gion) puis les score.
// NIVEAU 1 : 100% local, aucune requÃªte Cardmarket, aucun risque de ban.
// ============================================================
async function scorerCandidatsLocal(produits, cardInfo, imageUrlVinted, idExpansionsAttendues = [], codeSetsPreChauffes = null, options = {}) {
    const regionCible = regionAttendue(cardInfo);
    console.log(`ðŸŒ RÃ©gion attendue : ${regionCible || 'indÃ©terminÃ©e'} (langue=${cardInfo.language}, total=${cardInfo.total || 'absent'})`);

    // NumÃ©ros appris (via apprendre-set.js) : c'est ce qui permet au critÃ¨re
    // "numÃ©ro" du scoring de fonctionner, et donc de viser LE bon candidat.
    const numerosConnus = await lireNumeros(produits.map(p => p.idProduct));
    if (numerosConnus.size > 0) {
        console.log(`ðŸ”¢ NumÃ©ros connus pour ${numerosConnus.size}/${produits.length} candidats.`);
    } else {
        const expansions = [...new Set(produits.map(p => p.idExpansion))];
        console.log(`ðŸ’¡ Aucun numÃ©ro connu pour ces candidats. Pour rendre l'identification prÃ©cise, lance : node apprendre-set.js ${expansions.join(' ')}`);
    }

    // Codes set + prix guide de TOUS les candidats en DEUX allers-retours Mongo groupÃ©s
    // au lieu de deux PAR CANDIDAT (jusqu'Ã  ~79 candidats -> ~158 requÃªtes sÃ©quentielles
    // avant ce fix). codeSetsPreChauffes permet Ã  l'appelant (/api/identifier) d'injecter
    // une Map dÃ©jÃ  rÃ©cupÃ©rÃ©e, pour ne pas la redemander une seconde fois Ã  Mongo.
    const codeSets = codeSetsPreChauffes || await lireCodeSets(produits.map(p => p.idExpansion));
    // RÃ©gions dÃ©rivÃ©es : un Â« occidental Â» ne peut venir que d'ici (voir lireRegions).
    const regions = await lireRegions(produits.map(p => p.idExpansion));

    // Table des motifs de la carte (TCGdex), puis arbitrage IA / titre / catalogue.
    // Tout est PUR et testÃ© dans scoring.js ; ici on ne fait que fournir les entrÃ©es.
    // RÃ©solu AVANT les prix : c'est la nature de l'impression visÃ©e (reverse ou non)
    // qui dÃ©cide quel champ du guide fait foi.
    const analyse = analyserVariantes(options.variantsDetailed);
    const resolution = resoudreMotif(analyse, cardInfo.motif, options.titre);
    const estReverse = impressionEstReverse(resolution.cible, cardInfo.reverse);

    // Les prix des candidats sont lus sur le MÃŠME axe que le prix qui sera affichÃ©.
    // Indispensable au dÃ©partage Â« moins cher Â» de la dÃ©cision produit B : sur Espeon
    // PRE 033, comparer les `trend` dÃ©signerait la Master Ball (0,50 â‚¬) comme la moins
    // chÃ¨re alors que c'est de loin la plus chÃ¨re en reverse (24,13 â‚¬).
    const prixGuide = await getPrixGuideLocalLot(produits.map(p => p.idProduct), estReverse);

    const candidatsEnrichis = produits.map(p => {
        const infoNum = numerosConnus.get(p.idProduct);
        const codeSet = codeSets.get(Number(p.idExpansion)) ?? null;
        return {
            idProduct: p.idProduct,
            idExpansion: p.idExpansion,
            numeroCardmarket: infoNum ? (infoNum.numero || infoNum.numeroUrl) : null,
            certitudeNumero: infoNum ? (infoNum.certitude || 'exacte') : null,
            // V1/V2/V3 = normale/reverse/illustration, prÃ©sente seulement sur les
            // sets appris AVEC les nouveaux champs (--maj). Absente = null -> neutre.
            variante: infoNum ? (infoNum.variante || null) : null,
            prix: prixGuide.get(Number(p.idProduct)) ?? null,
            // code de set appris (ex: "PAL", "EXP", "PGO") : sert Ã  confronter ce que
            // l'IA a lu (setCode/stamp) au set rÃ©el du candidat.
            codeSet: codeSet || (infoNum && infoNum.codeSet) || null,
            // distanceImage volontairement absente : le hash perceptif a Ã©tÃ© retirÃ©
            // (bruit sur photos d'annonce). Le critÃ¨re image du scoring reste dans
            // scoring.js et se rÃ©activera tout seul si on lui refournit un jour une
            // distance (via OffscreenCanvas cÃ´tÃ© extension, par exemple).
            // La rÃ©gion dÃ©rivÃ©e en base fait foi ; Ã  dÃ©faut, seules les preuves tirÃ©es du
            // code lui-mÃªme (minuscule, suffixe -JP, liste vÃ©rifiÃ©e) sont retenues. Un
            // code non vÃ©rifiÃ© donne null, et le critÃ¨re rÃ©gion reste alors NEUTRE.
            region: regionDuCodeSet(codeSet || (infoNum && infoNum.codeSet), regions.get(Number(p.idExpansion)) ?? null)
        };
    });

    if (idExpansionsAttendues.length) {
        console.log(`ðŸŽ¯ Set attendu -> expansion(s) Cardmarket : ${idExpansionsAttendues.join(', ')}`);
    }

    const lu = {
        numero: cardInfo.number || null,   // le numÃ©ro lu par l'IA (ex: 79, TG06)
        setCode: cardInfo.setCode || null, // le code/stamp lu par l'IA (ex: PAL, CEL)
        idExpansionsAttendues,             // dÃ©duites du set TCGdex via le prÃ©-remplissage
        rarete: cardInfo.rarete || null,   // brut : neutralise le critÃ¨re prix sur les promos
        rareteElevee: cardInfo.rareteElevee,
        regionAttendue: regionCible,
        // Le routage du motif de reverse. La rÃ¨gle "reverse -> V2" a DISPARU : le
        // numÃ©ro de variante Cardmarket n'a pas de sÃ©mantique stable, et dans Obsidian
        // Flames il dÃ©signait un holo Ã  37 â‚¬. C'est le catalogue TCGdex qui fait foi.
        motif: { ...resolution, strategieParIdProduct: analyse.strategieParIdProduct }
    };

    const resultat = choisirMeilleur(candidatsEnrichis, lu);

    // INSTRUMENTATION du correctif Â« promo Â» (neutralisation du critÃ¨re prix).
    // MesurÃ© hors ligne sur 15 promos rÃ©elles : 0 gagnant changÃ©, mais le critÃ¨re
    // n'Ã©tait rÃ©ellement en jeu que sur 7 d'entre elles et la marge mÃ©diane Ã©tait de
    // 50 points â€” l'Ã©chantillon ne dit donc rien des cas SERRÃ‰S. Sur le seul cas serrÃ©
    // connu (Magikarp 024), la marge n'est que de 10 points et repose entiÃ¨rement sur
    // POIDS.setPartiel, dont le seuil de bascule est 6. Ce log mesure en production la
    // frÃ©quence rÃ©elle des bascules, pour savoir si ces 9 points de rÃ©serve sont
    // confortables ou si on vit sur de la chance.
    // CoÃ»t : un second scoring en mÃ©moire, uniquement sur les promos. Aucune I/O.
    if (String(cardInfo.rarete || '').toLowerCase() === 'promo') {
        const sansNeutralisation = choisirMeilleur(candidatsEnrichis, { ...lu, rarete: null });
        const avant = sansNeutralisation.scores[0], apres = resultat.scores[0];
        if (avant && apres && avant.candidat.idProduct !== apres.candidat.idProduct) {
            console.log(
                `ðŸ“Š [promo-neutralise] carte=${options.tcgdexId || '?'}` +
                ` gagnantAvant=${avant.candidat.idProduct} scoreAvant=${avant.score}` +
                ` gagnantApres=${apres.candidat.idProduct} scoreApres=${apres.score}`
            );
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // TROIS TRACES, pour instruire les dÃ©cisions qui restent Ã  prendre.
    // Format stable, une ligne, valeurs sans espace : grep "[region-conflit]" etc.
    // Elles ne changent AUCUN comportement â€” elles mesurent celui qui existe.
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const gagnantEnrichi = resultat.scores[0]?.candidat ?? null;

    // 1. CONFLIT DE RÃ‰GION â€” un candidat portant le BON numÃ©ro, Ã©cartÃ© par le malus de
    //    rÃ©gion. C'est la signature exacte du bug Charmander McDonald's. La liste des
    //    exceptions vient d'Ãªtre posÃ©e : ce log dit si elle est complÃ¨te, et un
    //    conflit qui persiste dÃ©signe un code japonais qu'on n'a pas encore recensÃ©.
    if (regionCible && cardInfo.number != null) {
        const ecartes = candidatsEnrichis.filter(c =>
            c.region && c.region !== regionCible && comparerNumeros(cardInfo.number, c.numeroCardmarket));
        if (ecartes.length) {
            console.warn(
                `âš ï¸ [region-conflit] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
                ` regionAttendue=${regionCible} ecartes=${ecartes.length}` +
                ` codes=${[...new Set(ecartes.map(c => c.codeSet || '?'))].slice(0, 6).join('|')}` +
                ` idProducts=${ecartes.slice(0, 6).map(c => c.idProduct).join('|')}` +
                ` gagnant=${gagnantEnrichi?.idProduct ?? '?'} gagnantRegion=${gagnantEnrichi?.region ?? '?'}`
            );
        }
    }

    // 2. LES DEUX SIGNAUX DE RANG. MesurÃ© : le rang 3 pris candidat par candidat n'est
    //    PAS un signal (majoritaire partout â€” 135/153 sur Charmander, 78/85 sur
    //    Magikarp), parce que le mÃªme nom existe dans beaucoup d'autres sets. Seuls
    //    `aucunRang1` et le rang du GAGNANT sont exploitables. Voir bilanDesRangs.
    const rangs = bilanDesRangs(candidatsEnrichis, cardInfo.number, gagnantEnrichi);
    if (cardInfo.number != null) {
        console.log(
            `ðŸ“Š [rang] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
            ` gagnant=${gagnantEnrichi?.idProduct ?? '?'} rangGagnant=${rangs.rangGagnant ?? 'sans-objet'}` +
            ` candidats=${candidatsEnrichis.length} rang1=${rangs.rang1} rang2=${rangs.rang2} rang3=${rangs.rang3}` +
            ` aucunRang1=${rangs.aucunRang1}`
        );
    }
    if (rangs.aucunRang1) {
        console.warn(
            `âš ï¸ [aucun-rang1] carte=${options.tcgdexId || '?'} numeroLu=${cardInfo.number}` +
            ` candidats=${candidatsEnrichis.length} -> AUCUN ne porte ce numÃ©ro,` +
            ` le vivier ne peut pas contenir la bonne carte`
        );
    }

    // 3. ACCORD DU setCode LU. Aucune collection ne conservait les rÃ©ponses de l'IA :
    //    sa fiabilitÃ© Ã©tait donc invÃ©rifiable. Comparaison STRICTE (Ã©galitÃ© aprÃ¨s
    //    normalisation) â€” c'est la fiabilitÃ© BRUTE de la lecture qu'on veut, pas celle
    //    du mÃ©canisme de parentÃ© partielle du scoring, qui la masquerait.
    if (cardInfo.setCode) {
        const luN = normaliserCodeSet(cardInfo.setCode);
        const gagnantN = gagnantEnrichi?.codeSet ? normaliserCodeSet(gagnantEnrichi.codeSet) : null;
        console.log(
            `ðŸ“Š [setcode] carte=${options.tcgdexId || '?'} lu=${cardInfo.setCode} normalise=${luN || 'vide'}` +
            ` gagnant=${gagnantEnrichi?.codeSet ?? 'inconnu'}` +
            ` accord=${gagnantN ? (luN === gagnantN) : 'indeterminable'}` +
            ` apparente=${gagnantN ? codesApparentes(luN, gagnantN) : 'indeterminable'}` +
            ` langue=${cardInfo.language}`
        );
    }

    // Trois Ã©tats, volontairement DISTINCTS (le 2e n'est pas un Ã©chec) :
    if (resolution.etat === 'non-resolu') {
        loggerReplieMotif(resolution, cardInfo, analyse, options.tcgdexId, options.titre);
    } else if (resolution.etat === 'resolu' && resolution.cible !== 'aucun') {
        console.log(`ðŸ” Motif "${resolution.cible}" -> produit(s) ${resolution.vises.join(', ')} Â· ${LIBELLES_STRATEGIE_REVERSE[resultat.strategieReverse] || LIBELLES_STRATEGIE_REVERSE.inconnue}${resolution.raison ? ` (${resolution.raison})` : ''}`);
    }
    // 'aucun-motif' : silence volontaire. C'est le cas de l'immense majoritÃ© des cartes
    // (tous les sets d'avant Prismatic Evolutions), il n'y a rien Ã  signaler.

    // codeSets renvoyÃ© pour rÃ©utilisation par l'appelant (Ã©vite une 2e lecture
    // identique, ex: la construction de `codesSet` dans /api/identifier).
    // `rangs` remonte les deux signaux : l'appelant dÃ©cide (voir la rÃ¨gle documentÃ©e
    // sur `viviersAvecRangs`), les expose Ã  l'extension et les journalise.
    return { ...resultat, codeSets, motif: resolution, estReverse, rangs };
}

function calculerVerdict(prixVinted, prixCardmarket, language, carteIncertaine) {
    if (!prixVinted || isNaN(prixVinted)) return null;
    const ratio = prixVinted / prixCardmarket;
    const diffPourcent = Math.round((ratio - 1) * 100);

    // Nos sources gratuites (TCGdex/scraping direct) ne filtrent pas toujours
    // fiablement par langue, et parfois plusieurs impressions sont ambiguÃ«s.
    // Dans ces deux cas, on ne peut pas garantir que le prix de rÃ©fÃ©rence
    // correspond Ã  la bonne carte/langue -> seuils plus prudents + avertissement
    // explicite plutÃ´t qu'un faux verdict de confiance. L'incertitude sur la
    // carte elle-mÃªme (mauvais set possible) est encore plus grave que la langue.
    const langueIncertaine = Boolean(language) && language !== 'EN';
    const incertitude = carteIncertaine || langueIncertaine;
    const seuilBonneAffaire = carteIncertaine ? 0.50 : (langueIncertaine ? 0.60 : SEUIL_BONNE_AFFAIRE);
    const seuilPrixCorrect = carteIncertaine ? 1.50 : (langueIncertaine ? 1.30 : SEUIL_PRIX_CORRECT);

    let label;
    if (ratio <= seuilBonneAffaire) label = "ðŸ”¥ Bonne affaire";
    else if (ratio <= seuilPrixCorrect) label = "âœ… Prix correct";
    else label = "âš ï¸ Plus cher que le marchÃ©";

    return { label, diffPourcent, langueIncertaine: incertitude };
}

// ============================================================
// ROUTE PRINCIPALE
// ============================================================

// Ordre officiel Cardmarket, du meilleur au pire
const ORDRE_ETATS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

// Prix le moins cher pour un Ã©tat donnÃ© OU MIEUX (= ce que ferait minCondition).
// Ex: grille {NM:22.82, EX:18, LP:3} + Ã©tat EX -> min(22.82, 18) = 18 â‚¬
function prixPourEtat(grille, etat) {
    if (!grille || !etat) return null;
    const seuil = ORDRE_ETATS.indexOf(String(etat).toUpperCase());
    if (seuil === -1) return null;
    const prix = ORDRE_ETATS.slice(0, seuil + 1)
        .map(e => grille[e])
        .filter(p => typeof p === 'number');
    return prix.length ? Math.min(...prix) : null;
}

// Renvoie le PIRE des deux Ã©tats (le plus dÃ©gradÃ©). Sert Ã  croiser l'avis de
// l'IA et celui du vendeur : en cas de dÃ©saccord, on prend le moins favorable,
// car surestimer l'Ã©tat conduit Ã  surpayer.
function pireEtat(a, b) {
    const ia = ORDRE_ETATS.indexOf(String(a || '').toUpperCase());
    const ib = ORDRE_ETATS.indexOf(String(b || '').toUpperCase());
    if (ia === -1) return ib === -1 ? null : ORDRE_ETATS[ib];
    if (ib === -1) return ORDRE_ETATS[ia];
    return ORDRE_ETATS[Math.max(ia, ib)]; // index le plus grand = Ã©tat le plus dÃ©gradÃ©
}

// Retrouve les idExpansion Cardmarket correspondant Ã  un set TCGdex.
// C'est le "pont" qui manquait : le prÃ©-remplissage TCGdex a stockÃ©, pour chaque
// carte, le set d'oÃ¹ venait son numÃ©ro (champ setTcgdex). En interrogeant cette
// trace, on sait dans quelle(s) expansion(s) Cardmarket chercher â€” ce qui active
// le critÃ¨re "set" du scoring (40 points).
//
// âš ï¸ Un set TCGdex couvre souvent PLUSIEURS Ã©ditions Cardmarket (japonaise,
// internationale, supplÃ©ments) : les cartes y portent les mÃªmes noms. Sans filtre,
// on pourrait donc rÃ©compenser l'Ã©dition japonaise alors que la carte est
// franÃ§aise. On ne retient que les expansions de la RÃ‰GION attendue.
async function expansionsDuSetTCGdex(tcgdexCardId, regionAttendue = null, setCodeLu = null) {
    try {
        if (mongoose.connection.readyState !== 1 || !tcgdexCardId) return [];
        const setId = String(tcgdexCardId).split('-')[0];
        if (!setId) return [];

        const exps = (await NumeroCarte.distinct('idExpansion', { setTcgdex: setId })).filter(e => e != null);
        if (exps.length === 0) return exps;

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // INVALIDATION PAR LE setCode LU
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Le set attendu vient du pont total -> set, donc de TCGdex, qui ne connaÃ®t pas
        // tous les sets japonais : sur le SalamÃ¨che McDonald's, le total 18 a rÃ©solu vers
        // Â« Detective Pikachu Â». Or l'information qui invalidait cette piste Ã©tait dÃ©jÃ 
        // lÃ  â€” l'IA avait lu le stamp Â« MCD Â», sans aucun rapport avec Detective Pikachu.
        //
        // RÃ¨gle : si un setCode a Ã©tÃ© lu ET qu'AUCUNE expansion candidate ne porte un code
        // Ã©gal ou apparentÃ©, la piste est invalidÃ©e. Elle ne doit alors ni scorer (+40)
        // ni servir de PÃ‰RIMÃˆTRE de recherche â€” c'est le second usage qui a fait le plus
        // de dÃ©gÃ¢ts, puisqu'il transforme une fausse piste en filtre.
        //
        // âš ï¸ Le risque est BORNÃ‰, et dans le bon sens. Si l'IA lit mal le setCode alors que
        // l'expansion Ã©tait juste, on n'invalide pas une bonne rÃ©ponse : on Ã©largit la
        // recherche (le vivier par numÃ©ro couvre tout le catalogue) au lieu de la
        // restreindre Ã  tort. Une invalidation ne peut donc que retirer un pÃ©rimÃ¨tre,
        // jamais Ã©carter la bonne carte. Et le silence est la rÃ¨gle : sans setCode lu, ou
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
                    `âš ï¸ [set-attendu-invalide] setCode lu "${setCodeLu}" incompatible avec` +
                    ` le(s) code(s) de l'expansion attendue (${exps.map(e => codes.get(Number(e)) || '?').join('|')})` +
                    ` dÃ©duite de ${setId} -> piste ABANDONNÃ‰E (ni score, ni pÃ©rimÃ¨tre)`
                );
                return [];
            }
        }

        if (!regionAttendue) return exps;

        // Filtrage par rÃ©gion, via le code set appris (MAJ = occidental, min = japonais).
        // Un seul aller-retour Mongo pour toutes les expansions, au lieu d'un par expansion.
        const codes = await lireCodeSets(exps);
        const regionsDerivees = await lireRegions(exps);
        const gardees = [];
        for (const e of exps) {
            const code = codes.get(Number(e)) ?? null;
            const region = regionDuCodeSet(code, regionsDerivees.get(Number(e)) ?? null);
            // RÃ©gion inconnue -> on garde (on ne pÃ©nalise pas ce qu'on ignore)
            if (!region || region === regionAttendue) gardees.push(e);
            else console.log(`   â„¹ï¸ Expansion ${e} (${code}, ${region}) Ã©cartÃ©e du set attendu : on cherche de l'${regionAttendue}.`);
        }
        return gardees;
    } catch (e) {
        console.error("Erreur expansionsDuSetTCGdex :", e.message);
        return [];
    }
}

// Correspondance Ã©tat Vinted -> Ã©tat Cardmarket (minimum demandÃ©).
// âš ï¸ L'Ã©chelle Vinted est pensÃ©e pour les vÃªtements et l'Ã©tat est DÃ‰CLARÃ‰ par le
// vendeur : c'est un indice, pas un grading. On reste donc volontairement prudent
// (ex: "Neuf sans Ã©tiquette" -> NM et pas MT, car les vendeurs surestiment).
function etatVintedVersCardmarket(etatVinted) {
    if (!etatVinted) return null;
    const e = etatVinted.toLowerCase();
    if (e.includes('neuf')) return 'NM';
    if (e.includes('trÃ¨s bon')) return 'EX';
    if (e.includes('bon Ã©tat')) return 'GD';
    if (e.includes('satisfaisant')) return 'LP';
    return null;
}

app.post('/api/analyser', verifierJeton, exigerImage, verifierAcces, async (req, res) => {
    try {
        const { imageUrl, imageUrls, title, vintedPrice, vintedEtat, debug } = req.body;

        if (!imageUrl) {
            console.error("âš ï¸ RequÃªte reÃ§ue sans imageUrl. Body reÃ§u:", req.body);
            return res.json({ success: false, error: "Aucune image reÃ§ue" });
        }

        const etatMin = etatVintedVersCardmarket(vintedEtat);
        if (vintedEtat) console.log(`ðŸ·ï¸ Ã‰tat Vinted : "${vintedEtat}" -> Cardmarket ${etatMin || '(non mappÃ©)'}${etatMin ? ' minimum' : ''}`);

        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        console.log(`ðŸ“· ${photos.length} photo(s) envoyÃ©e(s) Ã  l'IA.`);
        const cardInfo = await getCardIdFromAI(photos, title);
        if (!cardInfo) {
            // Ã‰chec DUR : aucune carte identifiÃ©e, rien n'a Ã©tÃ© livrÃ© -> on rend le scan.
            await rembourserScan(req, 'ia-echec');
            return res.json({ success: false, error: "Analyse IA Ã©chouÃ©e (voir logs Render pour la cause exacte)" });
        }

        // 1. Cache Mongo (sautÃ© si debug=true, pratique pour retester une carte sans attendre 24h)
        let resultat = debug ? null : await lireCache(cardInfo.name, cardInfo.number, cardInfo.language);
        // PortÃ©e Ã©largie : sert au log du ratio, en dehors du bloc d'identification.
        let idCarteTCGdex = null;
        // Idem pour le journal : la ligne est composÃ©e DANS le bloc d'identification
        // (oÃ¹ vivent candidats, scores et motif) mais Ã©crite APRÃˆS, une fois les prix
        // connus. Reste null quand le cache a rÃ©pondu â€” il n'y a alors pas eu de scan.
        let ligneJournal = null;
        if (debug) console.log("ðŸ› Mode debug : lecture du cache sautÃ©e.");

        // 2. Flux combinÃ© orientÃ© JUSTESSE :
        //    a) identifier le produit exact (TCGdex : numÃ©ro + image)
        //    b) retrouver le produit (idProduct + idExpansion) dans le catalogue local
        //    c) prix GUIDE LOCAL (instantanÃ©, par dÃ©faut)
        //    d) prix LIVE en bonus (exact + langue) si ton PC passe Cloudflare,
        //       + apprentissage du code set au passage
        //    e) repli TCGdex si rien d'autre n'a marchÃ©
        if (!resultat) {
            // 2a. Identification prÃ©cise via TCGdex + image
            const trouvailleTCGdex = await trouverCarteTCGdex(cardInfo.name, cardInfo.number, cardInfo.setCode, imageUrl, cardInfo.language, cardInfo.total);
            if (!trouvailleTCGdex) {
                // MÃªme distinction de motif que /api/identifier : un numÃ©ro illisible n'est
                // pas une carte introuvable. Le chemin d'identification LOCALE, lui, n'est
                // branchÃ© que sur /api/identifier â€” la route rÃ©ellement utilisÃ©e par
                // l'extension. L'ajouter ici doublerait la surface sans gain visible.
                await rembourserScan(req, cardInfo.numeroIllisible ? 'numero-illisible' : 'carte-introuvable');
                return res.json({
                    success: false,
                    error: cardInfo.numeroIllisible
                        ? `NumÃ©ro de collection illisible sur la photo â€” identification impossible pour "${cardInfo.name}"`
                        : `Carte "${cardInfo.name}${cardInfo.setCode ? ' ' + cardInfo.setCode : ''} #${cardInfo.number}" non trouvÃ©e sur TCGdex`
                });
            }
            idCarteTCGdex = trouvailleTCGdex.id;

            // 2b. Candidats Cardmarket. MÃªme hiÃ©rarchie que /api/identifier : le nom
            //     n'est utilisÃ© que s'il est fiable, sinon on passe par le NUMÃ‰RO dans
            //     l'expansion dÃ©duite du total.
            const expAttendues = await expansionsDuSetTCGdex(trouvailleTCGdex.id, regionAttendue(cardInfo), cardInfo.setCode);
            const nomFiable = trouvailleTCGdex.source !== 'total+numero';
            let produits = nomFiable ? await trouverProduitsLocaux(trouvailleTCGdex.nomExact) : [];
            let voieCatalogue = 'nom';
            let aucunCandidatAuNumero = false;
            if (produits.length === 0 && expAttendues.length) {
                const parNumero = await trouverProduitsParNumero(expAttendues, cardInfo.number);
                if (parNumero.length) { produits = parNumero; voieCatalogue = 'numero'; }
            } else if (produits.length > 0) {
                // MÃªme rÃ¨gle que /api/identifier : le vivier par nom peut Ãªtre plein et
                // pourtant incapable de contenir la bonne carte. Voir viviersAvecRangs.
                const choix = await viviersAvecRangs(produits, cardInfo.number, expAttendues, `[analyser] "${trouvailleTCGdex.nomExact}"`);
                produits = choix.produits;
                voieCatalogue = choix.voie;
                aucunCandidatAuNumero = choix.aucunCandidatAuNumero;
            }
            console.log(`ðŸ—‚ï¸ Catalogue local : ${produits.length} produit(s) pour "${trouvailleTCGdex.nomExact}".`);

            // 2c. NIVEAU 1 â€” scoring local (classe TOUS les candidats par pertinence)
            let classement = [];
            let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
            let estReverse = false;
            // Un candidat unique n'a rien Ã  dÃ©partager : la confiance est haute par
            // construction (c'est dÃ©jÃ  ce que dit `confiant: true` dans ce cas-lÃ ).
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
                // scores est dÃ©jÃ  triÃ© par score dÃ©croissant ; on rÃ©cupÃ¨re les produits complets
                classement = scores.map(s => ({
                    candidat: produits.find(p => p.idProduct === s.candidat.idProduct),
                    score: s.score,
                    strategie: s.strategie
                }));
                console.log(`ðŸ§® Scoring local : ${classement.length} candidats classÃ©s, meilleur = ${classement[0]?.candidat?.idProduct} (score ${scores[0]?.score}), confiance ${confiant ? 'HAUTE' : 'BASSE'}`);
                confianceScoring = confiant;
            }

            // Composition de la ligne de journal. Les prix seront ajoutÃ©s plus bas.
            ligneJournal = {
                route: 'analyser',
                userId: req.credit?.userId,
                nom: cardInfo.name, numero: cardInfo.number, total: cardInfo.total,
                setCode: cardInfo.setCode, langue: cardInfo.language, rarete: cardInfo.rarete,
                idProduct: classement[0]?.candidat?.idProduct,
                score: classement[0]?.score,
                nbCandidats: produits.length,
                confiance: confianceScoring ? 'haute' : 'basse',
                sourceIdentification: trouvailleTCGdex.source || 'nom',
                voieCatalogue,
                motifEtat: motifResolution.etat,
                aucunCandidatAuNumero,
                ecartScore: (classement.length > 1 && Number.isFinite(classement[0]?.score) && Number.isFinite(classement[1]?.score))
                    ? classement[0].score - classement[1].score
                    : null
            };

            const carteNonEN = cardInfo.language && cardInfo.language !== 'EN';

            // NIVEAU 2 â€” le serveur ne contacte JAMAIS Cardmarket lui-mÃªme : le live est
            // rÃ©servÃ© Ã  l'extension, cÃ´tÃ© navigateur de l'utilisateur (voir /api/identifier).
            // On prend directement le prix guide local du meilleur candidat classÃ©.
            if (classement.length > 0) {
                const meilleur = classement[0].candidat;
                // C'est la NATURE de l'impression visÃ©e (reverse ou non) qui dÃ©cide du
                // champ de prix, pas la stratÃ©gie de lecture : un produit dÃ©diÃ© Ã  une
                // Master Ball ne se vend qu'en reverse holo, son prix est donc dans
                // trendHolo (24,13 â‚¬) et pas dans trend (0,50 â‚¬).
                const prixLocal = await getPrixGuideLocal(meilleur.idProduct, estReverse);
                if (prixLocal !== null) {
                    resultat = {
                        price: prixLocal,
                        idProduct: meilleur.idProduct,   // tracÃ© dans le log du ratio
                        url: `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${meilleur.idProduct}`,
                        source: 'guide-local',
                        // Incertain si plusieurs candidats OU si la carte a un motif de
                        // reverse qu'on n'a pas su cibler (Ã©cart de prix jusqu'Ã  x100).
                        carteIncertaine: produits.length > 1 || motifResolution.etat === 'non-resolu'
                    };
                    const mention = estReverse ? ' [prix reverse : trendHolo]' : '';
                    console.log(`ðŸ“˜ Repli guide local pour idProduct ${meilleur.idProduct} : ${prixLocal} â‚¬${mention}${resultat.carteIncertaine ? ' (incertain)' : ''}`);
                }
            }

            // 2e. Repli TCGdex (frais du jour) si ni guide local ni live n'ont donnÃ© de prix
            if (!resultat) {
                console.log("â†ªï¸ Repli sur TCGdex (pas d'idProduct fiable ou pas de prix local).");
                resultat = await getPrixDepuisTCGdex(trouvailleTCGdex.id, cardInfo.name, cardInfo.number);
                if (resultat) resultat.source = 'tcgdex';
            }

            if (!resultat) {
                // Carte identifiÃ©e mais AUCUN prix de rÃ©fÃ©rence : le scan ne livre rien
                // d'exploitable pour l'utilisateur -> Ã©chec dur lui aussi.
                await rembourserScan(req, 'aucun-prix');
                return res.json({ success: false, error: "Carte identifiÃ©e mais aucun prix disponible (voir logs)" });
            }

            // Marquer incertain si l'identification TCGdex l'Ã©tait
            if (trouvailleTCGdex.ambigu) resultat.carteIncertaine = true;

            // RÃ©sultat LIVRÃ‰ mais avec rÃ©serve : on le trace (et on ne rembourse que si
            // la politique a Ã©tÃ© Ã©largie explicitement).
            if (resultat.carteIncertaine) {
                await signalerIncertain(req, motifResolution.etat === 'non-resolu'
                    ? `motif-${motifResolution.raison}`
                    : (trouvailleTCGdex.ambigu ? 'tcgdex-ambigu' : 'plusieurs-candidats'));
            }

            // On ne met pas en cache un rÃ©sultat incertain
            if (!resultat.carteIncertaine) {
                await ecrireCache(cardInfo.name, cardInfo.number, cardInfo.language, resultat.price, resultat.url);
            }
        }

        const prixVintedNombre = vintedPrice ? parseFloat(String(vintedPrice).replace(',', '.')) : null;
        const verdict = calculerVerdict(prixVintedNombre, resultat.price, cardInfo.language, resultat.carteIncertaine);

        // ---- TRACE DU RATIO, pour fonder un seuil sur des donnÃ©es plutÃ´t que sur une
        // intuition. Un ratio Ã©norme du cÃ´tÃ© "trop cher" est bien plus souvent une
        // erreur d'identification qu'un vendeur dÃ©lirant : les quatre cas connus sont
        // Ã  x150, x150, x750 et x2750, et 16,8 % du catalogue cote moins de 0,10 â‚¬,
        // ce qui est la zone oÃ¹ atterrit une identification ratÃ©e.
        // âš ï¸ Ce log ne couvre QUE /api/analyser. Dans le flux rÃ©el, c'est l'extension
        // qui lit le prix live et calcule le verdict : le serveur n'y voit jamais le
        // ratio. Le garde-fou doit donc vivre cÃ´tÃ© extension (spÃ©cification Ã  part).
        // Format stable, une ligne, grepable : grep "[ratio]" server.log
        if (prixVintedNombre && resultat.price > 0) {
            const ratio = prixVintedNombre / resultat.price;
            console.log(
                `ðŸ“Š [ratio] carte=${idCarteTCGdex || '?'} idProduct=${resultat.idProduct ?? '?'}` +
                ` vinted=${prixVintedNombre} reference=${resultat.price} ratio=${ratio.toFixed(1)}` +
                ` source=${resultat.source || '?'} incertain=${Boolean(resultat.carteIncertaine)}` +
                ` langue=${cardInfo.language}`
            );
        }

        // JOURNAL â€” mÃªme ligne que le log ci-dessus, mais PERSISTANTE. Les logs Render
        // sont Ã©phÃ©mÃ¨res ; cette collection est ce qui restera pour fonder les seuils.
        // Ã‰crite seulement si un scan a rÃ©ellement eu lieu (ligneJournal reste null
        // quand le cache a rÃ©pondu : rien n'a Ã©tÃ© identifiÃ©, il n'y a rien Ã  mesurer).
        if (ligneJournal) {
            enregistrerScan({
                ...ligneJournal,
                carteIncertaine: Boolean(resultat.carteIncertaine),
                prixVinted: prixVintedNombre,
                prixReference: resultat.price,
                sourcePrix: resultat.source || null
            });
        }

        // Le prix est fiable par langue UNIQUEMENT si le live filtrÃ© a rÃ©ussi.
        // Sinon (guide local ou repli TCGdex = toutes langues), on prÃ©vient.
        const prixFiltreParLangue = resultat.source === 'cardmarket-live-langue';
        const langueVraimentIncertaine = (cardInfo.language && cardInfo.language !== 'EN') && !prixFiltreParLangue;

        // Lien vers la fiche Cardmarket filtrÃ©e dans la langue dÃ©tectÃ©e
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
        console.error("âŒ Erreur /api/analyser:", error);
        res.json({ success: false, error: "Erreur serveur interne" });
    }
});

// ============================================================
// ROUTE /api/identifier â€” pour l'ARCHITECTURE EXTENSION
// ============================================================
// Fait tout le travail d'identification (IA, TCGdex, catalogue, scoring) et
// renvoie les candidats CLASSÃ‰S, mais ne touche PAS Ã  Cardmarket : c'est
// l'extension qui fera le live depuis le navigateur de l'utilisateur, avec son
// IP et ses cookies. C'est la rÃ©partition qui Ã©vite les bannissements.
app.post('/api/identifier', verifierJeton, exigerImage, verifierAcces, async (req, res) => {
    try {
        const { imageUrl, imageUrls, title, vintedEtat } = req.body;
        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        // exigerImage a dÃ©jÃ  refusÃ© les requÃªtes sans photo, AVANT tout dÃ©compte.

        console.log(`\nðŸ“· [identifier] ${photos.length} photo(s) reÃ§ue(s).`);

        // 1. Lecture de la carte par l'IA
        const debutIA = Date.now();
        const cardInfo = await getCardIdFromAI(photos, title);
        console.log(`â±ï¸ [identifier] appel IA : ${Date.now() - debutIA} ms`);
        if (!cardInfo) {
            await rembourserScan(req, 'ia-echec');
            return res.json({ success: false, error: "Analyse IA Ã©chouÃ©e" });
        }

        // Instrumentation : mesure le coÃ»t du bloc catalogue+TCGdex+scoring (tout ce
        // qui suit), pour dÃ©cider plus tard si un cache/cache mÃ©moire (reportÃ©) vaut le
        // coup â€” Ã  comparer avec le temps d'appel IA ci-dessus, qui tourne de toute faÃ§on.
        const debutCatalogue = Date.now();

        // 2. Identification prÃ©cise via TCGdex (+ variantes de nom, multilingue)
        let trouvaille = await trouverCarteTCGdex(cardInfo.name, cardInfo.number, cardInfo.setCode, photos[0], cardInfo.language, cardInfo.total);

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // REPLI LOCAL â€” avant tout remboursement
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // TCGdex ne connaÃ®t pas tout : les e-Series japonaises en sont absentes, et notre
        // propre catalogue a la rÃ©ponse. MesurÃ© sur les annonces rÃ©elles â€” Arbok 099 ->
        // 160,08 â‚¬, Rhydon 055 -> 72,22 â‚¬, Ledian 007 -> 147,94 â‚¬ â€” alors que la route
        // rÃ©pondait Â« non trouvÃ©e sur TCGdex Â» et remboursait. Voir identification-locale.js.
        let identificationLocale = false;
        let localIncertain = false;
        let produitsImposes = null;
        if (!trouvaille) {
            const local = await identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: cardInfo.number,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui decide s'il y a une
                // impression a router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            });
            if (local) {
                identificationLocale = true;
                localIncertain = local.incertain;
                produitsImposes = local.produits;
                const nomGagnant = local.produits.find(p => p.idProduct === local.gagnant?.candidat?.idProduct);
                console.log(
                    `ðŸ—ƒï¸ [identifier] TCGdex muet -> IDENTIFICATION LOCALE : ${local.produits.length} candidat(s)` +
                    ` via ${local.voie} (${local.raison}), gagnant ${local.gagnant?.candidat?.idProduct}` +
                    ` code=${local.gagnant?.candidat?.codeSet} Ã©cart=${local.ecartScore}` +
                    ` motifARouter=${local.motifARouter} incertain=${local.incertain}`
                );
                // `trouvaille` synthÃ©tique : tout l'aval l'attend. Ses champs TCGdex sont
                // NULS, et c'est le fond du sujet â€” sans variantsDetailed on ne sait pas
                // router les motifs de reverse (jusqu'Ã  x100 d'Ã©cart), d'oÃ¹ `ambigu: true`.
                trouvaille = {
                    id: null, localId: null, variants: null, variantsDetailed: null,
                    nomExact: nomGagnant ? String(nomGagnant.name).split('[')[0].trim() : cardInfo.name,
                    source: 'catalogue-local',
                    // `ambigu` suit le VERDICT du module, pas le simple fait d'Ãªtre passÃ©
                    // par le chemin local : sur une carte sans impression reverse (toutes
                    // les e-Series, mesurÃ© sur 521 produits), n'avoir pas routÃ© le motif ne
                    // coÃ»te rien. Marquer douteux un prix juste use le drapeau pour rien.
                    ambigu: local.incertain
                };
            } else {
                // Deux motifs DISTINCTS : sans numÃ©ro lisible, aucun chemin ne peut
                // aboutir, et ce n'est pas la mÃªme dÃ©faillance qu'une carte introuvable.
                const motif = cardInfo.numeroIllisible ? 'numero-illisible' : 'carte-introuvable';
                await rembourserScan(req, motif);
                return res.json({
                    success: false,
                    error: cardInfo.numeroIllisible
                        ? `NumÃ©ro de collection illisible sur la photo â€” impossible d'identifier "${cardInfo.name}" de faÃ§on fiable`
                        : `Carte "${cardInfo.name}" #${cardInfo.number} introuvable, ni sur TCGdex ni dans le catalogue local`,
                    cardInfo
                });
            }
        }

        // Garde-fou : le numÃ©ro de la carte trouvÃ©e contredit-il celui lu sur la photo ?
        // âš ï¸ On N'INVENTE PLUS DE CAUSE. L'ancienne version concluait Â« set trop rÃ©cent
        // pour TCGdex Â» et repartait chercher dans le catalogue avec le NOM LU PAR L'IA
        // â€” le pire repli possible, puisque c'est prÃ©cisÃ©ment le nom qui est en cause
        // quand il est hallucinÃ©. Diagnostic faux au passage : le cas rÃ©el qui a dÃ©clenchÃ©
        // ce correctif portait sur Team Up, un set de 2019.
        // On se contente donc de CONSTATER le dÃ©saccord, et on bascule sur le chemin
        // numÃ©ro + total, qui ne dÃ©pend d'aucun nom.
        const numLuIA = String(cardInfo.number || '').replace(/^0+/, '').toLowerCase();
        const numTCG = String(trouvaille.localId || '').replace(/^0+/, '').toLowerCase();
        const numeroContredit = Boolean(numLuIA && numTCG && numLuIA !== numTCG);

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // ARBITRAGE DU NOM par le catalogue local
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // Quand TCGdex trouve la carte SANS le nom (source 'total+numero'), il conclut que
        // Â« le NOM lu est suspect Â». C'est une infÃ©rence, et elle est fausse dÃ¨s que TCGdex
        // n'a simplement pas le set. Trace rÃ©elle : une carte japonaise Flareon 017/088
        // (EC4 Â« Split Earth Â», 239,94 â‚¬). Le total 088 est IMPRIMÃ‰ sur la carte et il est
        // juste, mais le seul set de 88 cartes que connaisse TCGdex est Â« Perfect Order Â»
        // (2025) â€” donc aucun Flareon n'y figure, le nom a Ã©tÃ© dÃ©clarÃ© suspect, et le
        // repli par total a rendu... Â« Turtonator Â», Ã  0,02 â‚¬. Que le serveur a APPRIS.
        //
        // Le catalogue local est un arbitre INDÃ‰PENDANT : contient-il une carte de ce nom
        // Ã  ce numÃ©ro ? VÃ©rifiÃ© sur les cinq cas rÃ©els â€”
        //   Flareon 017 -> OUI (EC4, 239,94 â‚¬)      le nom est corroborÃ©, TCGdex a tort
        //   Pyroli 017  -> OUI, via nomFr           mÃªme carte, nom franÃ§ais
        //   Nix 180     -> OUI, via nomFr           Â« Nix Â» EST le nom franÃ§ais de Nita
        //   Vesper 175  -> OUI, via nomFr           idem pour Evelyn
        //   Kahili 173  -> NON                      lÃ  c'est une vraie hallucination
        //                                           (Dana s'appelle Â« MÃ©ridia Â» en franÃ§ais)
        // Le mÃªme test distingue donc une lecture juste d'une hallucination, sans dÃ©pendre
        // de la couverture de TCGdex. Et il corrige au passage deux cas que je prenais pour
        // des hallucinations : nos noms de catalogue sont anglais, la lecture Ã©tait bonne.
        if (trouvaille.source === 'total+numero' && !identificationLocale) {
            const arbitre = await identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: cardInfo.number,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui decide s'il y a une
                // impression a router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            });
            if (arbitre) {
                const gagnantArbitre = arbitre.produits.find(p => p.idProduct === arbitre.gagnant?.candidat?.idProduct);
                console.log(
                    `âš–ï¸ [nom-corrobore] le catalogue local CONFIRME "${cardInfo.name}" au nÂ°${cardInfo.number}` +
                    ` -> ${arbitre.gagnant?.candidat?.idProduct} code=${arbitre.gagnant?.candidat?.codeSet}` +
                    ` prix=${arbitre.gagnant?.candidat?.prix}. TCGdex proposait "${trouvaille.nomExact}"` +
                    ` (${trouvaille.id}) : sa suggestion est Ã‰CARTÃ‰E.`
                );
                identificationLocale = true;
                localIncertain = arbitre.incertain;
                produitsImposes = arbitre.produits;
                trouvaille = {
                    id: null, localId: null, variants: null, variantsDetailed: null,
                    nomExact: gagnantArbitre ? String(gagnantArbitre.name).split('[')[0].trim() : cardInfo.name,
                    source: 'catalogue-local', ambigu: arbitre.incertain
                };
            } else {
                console.log(`âš–ï¸ [nom-non-corrobore] aucun "${cardInfo.name}" au nÂ°${cardInfo.number} dans le catalogue local -> le nom est bien suspect, on garde le chemin total+numÃ©ro.`);
            }
        }

        const nomPourCatalogue = trouvaille.nomExact;
        // Le nom n'est PAS digne de confiance si TCGdex a Ã©tÃ© trouvÃ© sans lui, si le
        // numÃ©ro de la carte retenue contredit celui, parfaitement lisible, de la photo,
        // ou si l'IA ELLE-MÃŠME annonce une confiance basse sur le nom.
        //
        // âš ï¸ Ce troisiÃ¨me cas est le seul qui ne dÃ©pende PAS de l'accord de TCGdex. Les
        // deux premiers exigent que TCGdex ait vu quelque chose de contradictoire : ils
        // tombent dÃ¨s qu'il est d'accord avec une mauvaise lecture. Le cas rÃ©el qui l'a
        // motivÃ© : l'IA a lu Â« Gengar Â» sur un Machoc japonais â€” un nom qui existe, dans
        // d'autres sets, et que rien en aval ne pouvait mettre en doute.
        const nomPeuFiable = cardInfo.nomConfiance === 'basse';
        const nomSuspect = trouvaille.source === 'total+numero' || numeroContredit || nomPeuFiable;
        if (nomPeuFiable) {
            console.warn(`âš ï¸ [identifier] l'IA annonce une confiance BASSE sur le nom -> le nom ne servira pas Ã  choisir les candidats.`);
        }
        if (numeroContredit) {
            console.warn(`âš ï¸ [identifier] dÃ©saccord de numÃ©ro : TCGdex donne ${numTCG}, l'IA a lu ${numLuIA}.`);
            console.warn(`   -> on ne se fie plus au NOM ; identification par numÃ©ro + total.`);
        }

        // Validateur de reverse (TCGdex) : on ne garde "reverse=true" que si cette
        // carte possÃ¨de RÃ‰ELLEMENT une impression reverse. Neutralise les faux
        // positifs (une holo normale lue Ã  tort comme reverse par l'IA). On ne
        // l'applique PAS si TCGdex s'est trompÃ© de carte (variants d'une autre carte).
        if (cardInfo.reverse === true && !numeroContredit && trouvaille.variants) {
            if (trouvaille.variants.reverse === false) {
                console.log(`â†©ï¸ TCGdex : pas de reverse connue pour cette carte -> on ignore le "reverse" lu par l'IA.`);
                cardInfo.reverse = false;
            } else if (trouvaille.variants.reverse === true) {
                console.log(`âœ… TCGdex confirme qu'une reverse existe pour cette carte.`);
            }
        }

        // Le set TCGdex nous dit dans quelle(s) expansion(s) Cardmarket chercher. CalculÃ©
        // AVANT les produits : quand le nom est suspect, c'est l'expansion + le numÃ©ro
        // qui dÃ©signent la carte, et le nom ne sert plus du tout.
        const expansionsAttendues = await expansionsDuSetTCGdex(trouvaille.id, regionAttendue(cardInfo), cardInfo.setCode);

        // 3. Candidats Cardmarket. Par le NOM tant qu'il est fiable ; sinon par le
        //    NUMÃ‰RO dans l'expansion identifiÃ©e, ce qui contourne complÃ¨tement un nom
        //    hallucinÃ© (Dana lue "Kahili") ou inapparieable ("_____'s Pikachu").
        let produits = produitsImposes ?? (nomSuspect ? [] : await trouverProduitsLocaux(nomPourCatalogue));
        let voieCatalogue = identificationLocale ? 'local-nom-numero' : 'nom';
        let aucunCandidatAuNumero = false;
        if (produits.length === 0 && expansionsAttendues.length) {
            const parNumero = await trouverProduitsParNumero(expansionsAttendues, cardInfo.number);
            if (parNumero.length) { produits = parNumero; voieCatalogue = 'numero'; }
        }
        // 2e usage du chemin local : le nom est suspect ET l'expansion attendue n'a rien
        // donnÃ©. C'est le cas Rhydon/Ledian â€” TCGdex trouve la carte ailleurs, dÃ©clare le
        // nom suspect, et le pont total -> set dÃ©signe un set de 2025. Sans ce repli il ne
        // reste RIEN, alors que le catalogue contient la bonne carte au bon numÃ©ro.
        if (produits.length === 0 && !identificationLocale) {
            const local = await identifierEnLocal({
                nomLu: cardInfo.name, numeroLu: cardInfo.number,
                regionAttendue: regionAttendue(cardInfo), setCodeLu: cardInfo.setCode,
                rarete: cardInfo.rarete, rareteElevee: cardInfo.rareteElevee, total: cardInfo.total,
                // Ce que l'IA a lu du motif : c'est la CARTE qui decide s'il y a une
                // impression a router, pas seulement son set. Voir identification-locale.js.
                motifLu: cardInfo.motif, reverseLu: cardInfo.reverse
            });
            if (local) {
                identificationLocale = true;
                localIncertain = local.incertain;
                produits = local.produits;
                voieCatalogue = 'local-nom-numero';
                console.log(`ðŸ—ƒï¸ [identifier] ni le nom ni l'expansion attendue -> IDENTIFICATION LOCALE : ${produits.length} candidat(s), gagnant ${local.gagnant?.candidat?.idProduct} code=${local.gagnant?.candidat?.codeSet} motifARouter=${local.motifARouter} incertain=${local.incertain}`);
            }
        }
        if (produits.length > 0 && !identificationLocale) {
            // Le vivier par nom est plein : reste Ã  savoir s'il PEUT contenir la bonne
            // carte. Voir viviersAvecRangs pour la rÃ¨gle et le cas Kahili.
            const choix = await viviersAvecRangs(produits, cardInfo.number, expansionsAttendues, `[identifier] "${nomPourCatalogue}"`);
            produits = choix.produits;
            voieCatalogue = choix.voie;
            aucunCandidatAuNumero = choix.aucunCandidatAuNumero;
        }
        console.log(`ðŸ—‚ï¸ [identifier] ${produits.length} candidat(s) via ${voieCatalogue === 'nom' ? `le nom "${nomPourCatalogue}"` : `le NUMÃ‰RO ${cardInfo.number}`}.`);

        // Codes set de TOUS les candidats en un seul aller-retour Mongo, injectÃ© dans le
        // scoring pour lui Ã©viter de refaire la mÃªme lecture candidat par candidat.
        const codeSetsConnus = await lireCodeSets(produits.map(p => p.idExpansion));

        // 4. Scoring : on renvoie le CLASSEMENT, l'extension testera dans l'ordre
        let classement = [];
        // StratÃ©gie reverse du GAGNANT + Ã©tat de rÃ©solution du motif (champs additifs).
        let strategieReverse = null;
        let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
        // Confiance de l'IDENTIFICATION (quel produit), Ã  ne pas confondre avec la
        // confiance de l'Ã‰TAT lue par l'IA (NM/EX/GD). Elle part telle quelle vers
        // l'extension dans un champ distinct â€” voir carte.confianceIdentification.
        let identificationConfiante = true;
        // Bilan des rangs du vivier retenu. Rempli par le scoring quand il y a plusieurs
        // candidats ; calculÃ© Ã  la main pour le cas du candidat unique, qui ne passe pas
        // par scorerCandidatsLocal mais mÃ©rite le mÃªme diagnostic.
        let rangsScoring = null;
        const optionsMotif = { variantsDetailed: trouvaille.variantsDetailed, titre: title, tcgdexId: trouvaille.id };

        if (produits.length === 1) {
            // Un seul produit pour ce nom : rien Ã  dÃ©partager, mais la table dit quand
            // mÃªme COMMENT lire sa reverse (produit partagÃ© ou non).
            const analyse = analyserVariantes(trouvaille.variantsDetailed);
            motifResolution = resoudreMotif(analyse, cardInfo.motif, title);
            strategieReverse = analyse.strategieParIdProduct.get(produits[0].idProduct) ?? null;
            classement = [{
                idProduct: produits[0].idProduct, idExpansion: produits[0].idExpansion,
                score: 999, strategie: strategieReverse
            }];
            if (motifResolution.etat === 'non-resolu') loggerReplieMotif(motifResolution, cardInfo, analyse, trouvaille.id, title);
            // Un seul candidat : son numÃ©ro est-il celui qu'on a lu ? Le vivier a dÃ©jÃ 
            // Ã©tÃ© choisi par viviersAvecRangs, mais le rang du gagnant reste Ã  qualifier.
            const infoSolo = (await lireNumeros([produits[0].idProduct])).get(produits[0].idProduct);
            rangsScoring = bilanDesRangs(
                [{ numeroCardmarket: infoSolo ? (infoSolo.numero || infoSolo.numeroUrl) : null }],
                cardInfo.number,
                { numeroCardmarket: infoSolo ? (infoSolo.numero || infoSolo.numeroUrl) : null }
            );
        } else if (produits.length > 1) {
            const { scores, confiant, strategieReverse: strat, motif, rangs } = await scorerCandidatsLocal(
                produits, cardInfo, photos[0], expansionsAttendues, codeSetsConnus, optionsMotif
            );
            strategieReverse = strat;
            motifResolution = motif;
            identificationConfiante = confiant;
            rangsScoring = rangs;
            classement = scores.map(s => ({
                idProduct: s.candidat.idProduct,
                idExpansion: s.candidat.idExpansion,
                score: s.score,
                // StratÃ©gie PAR CANDIDAT : sur une mÃªme carte les deux mÃ©canismes
                // coexistent (produit de base partagÃ© + motifs en produits distincts),
                // donc une stratÃ©gie globale serait fausse pour une partie du classement.
                strategie: s.strategie,
                detail: s.detail
            }));
            console.log(`ðŸ§® [identifier] meilleur = ${classement[0]?.idProduct} (score ${classement[0]?.score}), confiance ${confiant ? 'HAUTE' : 'BASSE'}`);
        }

        console.log(`â±ï¸ [identifier] catalogue+scoring : ${Date.now() - debutCatalogue} ms`);

        // Ã‰chec DUR : aucun candidat Ã  tester, l'extension n'a rien Ã  lire -> on rend
        // le scan. (Un classement mÃªme incertain, lui, EST un rÃ©sultat livrÃ©.)
        if (classement.length === 0) {
            await rembourserScan(req, 'aucun-candidat');
            return res.json({ success: false, error: `Aucun produit Cardmarket pour "${nomPourCatalogue}"`, cardInfo });
        }

        // Rang du gagnant retenu : 3 = le catalogue CONTREDIT le numÃ©ro lu pour lui.
        const gagnantContreditNumero = rangsScoring?.rangGagnant === 3;

        // Les deux signaux de rang entrent dans l'incertitude, chacun avec SON motif â€”
        // un motif gÃ©nÃ©rique empÃªcherait de mesurer lequel se dÃ©clenche.
        const carteAmbigue = Boolean(
            trouvaille.ambigu || numeroContredit || motifResolution.etat === 'non-resolu'
            || aucunCandidatAuNumero || gagnantContreditNumero || localIncertain || nomPeuFiable
        );
        if (carteAmbigue) {
            await signalerIncertain(req,
                localIncertain ? 'identification-locale-sans-tcgdex'
                    : aucunCandidatAuNumero ? 'aucun-candidat-au-numero'
                        : gagnantContreditNumero ? 'gagnant-contredit-le-numero'
                            : nomPeuFiable ? 'nom-confiance-basse'
                                : motifResolution.etat === 'non-resolu' ? `motif-${motifResolution.raison}`
                                    : numeroContredit ? 'tcgdex-numero-incoherent'
                                        : 'tcgdex-ambigu');
        }

        const etatMin = etatVintedVersCardmarket(vintedEtat);

        // JOURNAL â€” une ligne par scan, en base, hors chemin critique (pas de await).
        // C'est ICI que se joue la mesure qui compte : /api/identifier est le flux RÃ‰EL,
        // celui de l'extension. Les prix restent vides sur cette route (c'est le
        // navigateur de l'utilisateur qui lit le live, le serveur ne voit jamais le prix
        // final) â€” d'oÃ¹ le renvoi du ratio par l'extension, Ã  spÃ©cifier sÃ©parÃ©ment.
        enregistrerScan({
            route: 'identifier',
            userId: req.credit?.userId,
            nom: cardInfo.name, numero: cardInfo.number, total: cardInfo.total,
            setCode: cardInfo.setCode, langue: cardInfo.language, rarete: cardInfo.rarete,
            idProduct: classement[0]?.idProduct,
            score: classement[0]?.score,
            nbCandidats: produits.length,
            confiance: (identificationConfiante && !carteAmbigue) ? 'haute' : 'basse',
            carteIncertaine: carteAmbigue,
            sourceIdentification: trouvaille.source || 'nom',
            identifieeEnLocal: identificationLocale,
            nomConfiance: cardInfo.nomConfiance,
            nomBrut: cardInfo.nomBrut,
            voieCatalogue,
            motifEtat: motifResolution.etat,
            // Les deux signaux de rang, persistÃ©s : c'est ce qui permettra de mesurer
            // leur frÃ©quence rÃ©elle sans dÃ©pendre des logs Ã©phÃ©mÃ¨res de Render.
            aucunCandidatAuNumero,
            rangGagnant: rangsScoring?.rangGagnant ?? null,
            // Ã‰cart entre le 1er et le 2e du classement : rend visibles les
            // identifications qui Â« tiennent Ã  un fil Â» avant qu'un testeur les remonte.
            ecartScore: (classement.length > 1 && Number.isFinite(classement[0]?.score) && Number.isFinite(classement[1]?.score))
                ? classement[0].score - classement[1].score
                : null
        });

        res.json({
            success: true,
            carte: {
                nom: cardInfo.name,
                nomExact: trouvaille.nomExact,
                numero: cardInfo.number,
                total: cardInfo.total || null,
                setCode: cardInfo.setCode || null,
                rarete: cardInfo.rarete || null,
                langue: cardInfo.language,
                rareteElevee: cardInfo.rareteElevee,
                tcgdexId: trouvaille.id,
                // Incertain si TCGdex hÃ©sitait, s'il s'est manifestement trompÃ© de carte,
                // OU si la carte a un motif de reverse qu'on n'a pas su cibler (le prix
                // peut alors varier d'un facteur 100 entre variantes â€” cf. Master Ball).
                ambigu: carteAmbigue,
                // âš ï¸ CONFIANCE DE L'IDENTIFICATION â€” quel PRODUIT a Ã©tÃ© retenu. Ã€ ne pas
                // confondre avec etat.confianceIA plus bas, qui porte sur l'usure lue sur
                // la photo (NM/EX/GD). Les deux sont indÃ©pendantes : une carte peut Ãªtre
                // parfaitement identifiÃ©e avec un Ã©tat incertain, et l'inverse.
                //   'haute' -> le gagnant devance nettement le 2e (>= 30 points)
                //   'basse' -> Ã©cart faible, ou identification obtenue sans le nom
                confianceIdentification: (identificationConfiante && !carteAmbigue) ? 'haute' : 'basse',
                // Par quel signal la carte a Ã©tÃ© identifiÃ©e : 'nom', 'total+numero' (nom
                // Ã©cartÃ© car hallucinÃ© ou inapparieable) ou 'catalogue-local' (TCGdex muet).
                sourceIdentification: trouvaille.source || 'nom',
                // âš ï¸ true = identifiÃ©e SANS TCGdex, donc sans variantsDetailed : le motif de
                // reverse n'a pas pu Ãªtre routÃ© et l'Ã©cart de prix entre impressions peut
                // atteindre x100. L'extension doit prÃ©senter le prix avec rÃ©serve.
                identifieeEnLocal: identificationLocale,
                // Ce que l'IA dit de sa propre lecture du nom, et le nom brut qu'elle a lu.
                nomConfiance: cardInfo.nomConfiance || null,
                nomBrut: cardInfo.nomBrut || null,
                // Par quel signal les produits candidats ont Ã©tÃ© trouvÃ©s au catalogue.
                //   'nom' | 'numero' | 'numero-substitue' (le vivier par nom ne pouvait
                //   pas contenir la bonne carte â€” voir viviersAvecRangs)
                voieCatalogue,
                // âš ï¸ SIGNAL DE PREMIÃˆRE CLASSE. true = AUCUN candidat, par aucune voie, ne
                // porte le numÃ©ro lu sur la photo. Le prix est livrÃ©, mais il ne peut pas
                // Ãªtre celui de la carte scannÃ©e : l'extension doit le prÃ©senter comme
                // douteux, pas comme un verdict.
                aucunCandidatAuNumero,
                // 1 = le numÃ©ro du produit retenu correspond Ã  celui lu ; 2 = inconnu ;
                // 3 = le catalogue le CONTREDIT. null = rien de lu, donc pas de rang.
                rangGagnant: rangsScoring?.rangGagnant ?? null
            },
            etat: {
                estimeIA: cardInfo.etatEstime || null,
                confianceIA: cardInfo.etatConfiance || null,
                defautsVus: cardInfo.defautsVus || [],
                declareVendeur: vintedEtat || null,
                declareCardmarket: etatMin,
                // L'Ã©tat Ã  retenir = le PIRE des deux avis (voir explication plus haut)
                retenu: pireEtat(
                    (cardInfo.etatConfiance === 'haute' || cardInfo.etatConfiance === 'moyenne') ? cardInfo.etatEstime : null,
                    etatMin
                )
            },
            classement,
            // Champ ADDITIF (l'extension actuelle l'ignore, aucun champ existant ne
            // change) : dit Ã  l'extension COMMENT lire le prix d'une reverse.
            //   'produit-distinct' -> le produit visÃ© EST la reverse, lecture normale.
            //   'filtre-url'       -> mÃªme produit que la normale : il faut ajouter
            //                         isReverseHolo=Y Ã  l'URL, sinon on lit le prix de
            //                         la commune (bug Pikachu 052 : 0,02 â‚¬ affichÃ©).
            //   null               -> pas de reverse attendue, ou donnÃ©es insuffisantes.
            reverse: {
                attendue: cardInfo.reverse === true,
                motif: motifResolution.cible,        // 'pokeball' n'existe pas ici : classes
                                                     // grossiÃ¨res 'ball' | 'masterball' |
                                                     // 'reverse-classique' | 'aucun' | null
                etat: motifResolution.etat,          // 'resolu' | 'aucun-motif' | 'non-resolu'
                strategie: strategieReverse
            },
            // Codes langue Cardmarket, pour que l'extension construise l'URL du live
            codeLangue: { EN: 1, FR: 2, DE: 3, ES: 4, IT: 5, ZH: 6, JP: 7, PT: 8, RU: 9, KR: 10 }[cardInfo.language] || 1
        });

    } catch (e) {
        console.error("âŒ [identifier]", e.message);
        res.json({ success: false, error: e.message });
    }
});

// Enregistre ce que l'extension a lu en live : le code set et le numÃ©ro rÃ©el d'un
// idProduct. C'est ainsi que la base s'enrichit â€” depuis les navigateurs des
// utilisateurs, une carte Ã  la fois, sans jamais scraper en masse.
app.post('/api/apprendre', verifierJeton, async (req, res) => {
    try {
        const { idProduct, idExpansion, numero } = req.body;
        // DÃ©codÃ© Ã  l'entrÃ©e : le userscript l'extrait d'une URL d'image (voir decoderCodeSet).
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
            console.log(`ðŸ§  [apprendre] idProduct ${idProduct} -> nÂ°${numero} (${codeSet || '?'})`);
        }
        res.json({ success: true });
    } catch (e) {
        console.error("âŒ [apprendre]", e.message);
        res.json({ success: false, error: e.message });
    }
});
// Apprentissage par LOT depuis le userscript. RÃ¨gle de prioritÃ© :
//  - dÃ©jÃ  source:'cardmarket' (exact) -> INTACT, on ne le retouche pas
//  - source:'tcgdex' (heuristique) ou sans source (vieux Puppeteer allÃ©gÃ©)
//    -> Ã‰CRASÃ‰ par la lecture exacte Cardmarket (nomFr/variante/slug en bonus)
//  - absent -> insÃ©rÃ©
// On ignore les cartes sans numÃ©ro lisible (elles n'aident pas le scoring).
app.post('/api/apprendre-lot', verifierJeton, async (req, res) => {
    try {
        const { cartes } = req.body;
        if (!Array.isArray(cartes) || cartes.length === 0) {
            return res.json({ success: false, error: "Aucune carte reÃ§ue" });
        }

        // Cartes exploitables = celles qui ont au moins un numÃ©ro (titre ou URL)
        const lisibles = cartes.filter(c => c.idProduct && (c.numero || c.numeroUrl));
        const sansNumero = cartes.length - lisibles.length;

        const ids = [...new Set(lisibles.map(c => Number(c.idProduct)).filter(Boolean))];
        if (ids.length === 0) {
            return res.json({ success: true, recus: cartes.length, nouvelles: 0, ameliorees: 0, dejaExactes: 0, sansNumero });
        }

        // idExpansion dÃ©duit du catalogue (comme apprendreUnSet)
        let idExpansion = null;
        if (mongoose.connection.readyState === 1) {
            const ref = await CatalogueProduit.findOne({ idProduct: { $in: ids } }).lean();
            idExpansion = ref?.idExpansion ?? null;
        }

        // Source actuelle de chaque idProduct dÃ©jÃ  en base
        const existants = await NumeroCarte.find({ idProduct: { $in: ids } }, { idProduct: 1, source: 1 }).lean();
        const sourceParId = new Map(existants.map(d => [d.idProduct, d.source || null]));

        // Classement : exact -> intact ; reste -> Ã  Ã©crire
        const aEcrire = [];
        let nouvelles = 0, ameliorees = 0, dejaExactes = 0;
        for (const c of lisibles) {
            const id = Number(c.idProduct);
            if (!sourceParId.has(id))                        { aEcrire.push(c); nouvelles++; }
            else if (sourceParId.get(id) !== 'cardmarket')   { aEcrire.push(c); ameliorees++; }
            else                                             { dejaExactes++; } // dÃ©jÃ  exact -> on n'y touche pas
        }

        if (aEcrire.length > 0) {
            const ops = aEcrire.map(c => ({
                updateOne: {
                    filter: { idProduct: Number(c.idProduct) },
                    // $set (pas $setOnInsert) : on VEUT Ã©craser une entrÃ©e heuristique
                    // par la donnÃ©e exacte. Les entrÃ©es 'cardmarket' sont dÃ©jÃ  exclues.
                    update: {
                        $set: {
                            idProduct:   Number(c.idProduct),
                            idExpansion: idExpansion != null ? Number(idExpansion) : null,
                            numero:      c.numero    != null ? String(c.numero)    : null,
                            numeroUrl:   c.numeroUrl != null ? String(c.numeroUrl) : null,
                            // DÃ©codÃ© Ã  l'entrÃ©e : le lot vient d'URLs d'images (voir decoderCodeSet)
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

        console.log(`ðŸ§  [apprendre-lot] ${nouvelles} nouv. / ${ameliorees} amÃ©liorÃ©es / ${dejaExactes} dÃ©jÃ  exactes (exp ${idExpansion ?? '?'})`);
        res.json({ success: true, recus: cartes.length, nouvelles, ameliorees, dejaExactes, sansNumero, idExpansion });
    } catch (e) {
        console.error("âŒ [apprendre-lot]", e.message);
        res.json({ success: false, error: e.message });
    }
});
// ============================================================
// PAIEMENT â€” recharges de scans via Stripe Checkout
// ============================================================

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
    console.warn("âš ï¸ STRIPE_SECRET_KEY absent â€” les routes de paiement rÃ©pondront 503.");
}

// SOURCE DE VÃ‰RITÃ‰ des packs, cÃ´tÃ© SERVEUR uniquement. Le client n'envoie qu'un packId :
// s'il pouvait envoyer le nombre de scans, il suffirait de le modifier dans la requÃªte
// pour s'offrir 100 000 scans au prix de 20.
// âš ï¸ price_id de TEST â€” Ã  remplacer par les Live avant la mise en production.
const PACKS = {
    p20:  { price: 'price_1TxYgxCHs5xC36JEiTYo1tVy', scans: 20 },
    p50:  { price: 'price_1TxYhSCHs5xC36JEJD8T72vJ', scans: 50 },
    p100: { price: 'price_1TxYhzCHs5xC36JEgQ1VFhBn', scans: 100 },
    p200: { price: 'price_1TxYiQCHs5xC36JEtThiZz1S', scans: 200 }
};

// CrÃ©e une session de paiement et renvoie l'URL Stripe oÃ¹ rediriger l'utilisateur.
// Ne crÃ©dite RIEN : le crÃ©dit n'a lieu que dans le webhook signÃ©, aprÃ¨s paiement confirmÃ©.
app.post('/api/creer-recharge', limiteurPaiement, verifierJeton, async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ success: false, error: "Paiement indisponible" });

        const userId = req.body && req.body.userId ? String(req.body.userId).slice(0, 80) : null;
        if (!userId) return res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });

        const pack = PACKS[req.body && req.body.packId];
        if (!pack) return res.status(400).json({ success: false, error: "Pack inconnu" });

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: pack.price, quantity: 1 }],
            client_reference_id: userId,
            // metadata : c'est ce que le webhook relira pour savoir QUI crÃ©diter et de
            // COMBIEN. Ã‰crit ici par le serveur Ã  partir de PACKS, donc non falsifiable.
            metadata: { userId, scans: String(pack.scans) },
            success_url: `${process.env.SITE_URL}/merci`,
            cancel_url: `${process.env.SITE_URL}/annule`
        });

        console.log(`ðŸ’³ [recharge] session crÃ©Ã©e pour ${userId} â€” pack ${req.body.packId} (${pack.scans} scans)`);
        res.json({ url: session.url });
    } catch (e) {
        console.error("âŒ [creer-recharge]", e.message);
        res.status(500).json({ success: false, error: "Impossible de crÃ©er la session de paiement" });
    }
});

// Webhook Stripe â€” SEUL endroit oÃ¹ des scans payants sont crÃ©ditÃ©s.
// Pas de verifierJeton : l'appelant est Stripe, pas l'extension ; c'est la SIGNATURE
// cryptographique qui authentifie. Le corps arrive BRUT (Buffer) grÃ¢ce au express.raw()
// montÃ© tout en haut du fichier, avant express.json().
// DÃ©claration de fonction (hoistÃ©e) : voir le app.post() en tÃªte de fichier.
async function gererWebhookStripe(req, res) {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        console.error("âŒ [webhook] Stripe non configurÃ© (clÃ© ou secret webhook manquant)");
        return res.status(503).send('Stripe non configurÃ©');
    }

    // 1) Authentification par signature. Tant que ceci n'a pas rÃ©ussi, le contenu du
    // corps est celui d'un inconnu : on ne le lit mÃªme pas.
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (e) {
        console.warn(`ðŸš« [webhook] signature invalide : ${e.message}`);
        return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type !== 'checkout.session.completed') {
        return res.json({ recu: true }); // event non concernÃ© : accusÃ© de rÃ©ception, rien Ã  faire
    }

    const session = event.data.object;
    const userId = session.metadata?.userId || session.client_reference_id || null;
    const scans = parseInt(session.metadata?.scans || '0', 10);

    if (!userId || !Number.isFinite(scans) || scans <= 0) {
        // Rien d'exploitable : on ACQUITTE quand mÃªme (200), sinon Stripe rejouerait
        // indÃ©finiment un event que le rejeu ne rÃ©parera pas.
        console.error(`âŒ [webhook] metadata inutilisable (userId=${userId}, scans=${scans}) â€” event ${event.id}`);
        return res.json({ recu: true });
    }

    // 2+3) Marque d'idempotence ET crÃ©dit dans UNE SEULE TRANSACTION.
    // Les deux Ã©critures committent ensemble ou pas du tout. C'est ce qui ferme
    // dÃ©finitivement la fenÃªtre "payÃ© mais pas crÃ©ditÃ©" : il devient impossible que
    // l'event soit marquÃ© traitÃ© alors que les scans n'ont pas Ã©tÃ© ajoutÃ©s (ce que le
    // prÃ©cÃ©dent rollback manuel ne garantissait pas si Mongo tombait au mauvais moment).
    // Atlas est un replica set -> transactions disponibles.
    const sessionMongo = await mongoose.startSession();
    let dejaTraite = false;
    try {
        await sessionMongo.withTransaction(async () => {
            // Idempotence : l'insertion EST le verrou. Si l'event a dÃ©jÃ  Ã©tÃ© traitÃ©,
            // l'index unique renvoie 11000 -> on avorte la transaction, donc aucun crÃ©dit.
            try {
                // create([doc], {session}) â€” la forme tableau est obligatoire pour que
                // Mongoose lise bien le 2e argument comme des options et non comme un
                // second document Ã  insÃ©rer.
                await EvenementStripe.create([{ eventId: event.id }], { session: sessionMongo });
            } catch (e) {
                if (e.code === 11000) dejaTraite = true;
                throw e;   // dans les deux cas on sort : la transaction est annulÃ©e
            }

            // CrÃ©dit. `scans` vient de metadata, Ã©crit par NOTRE serveur Ã  la crÃ©ation
            // de la session â€” jamais d'une valeur envoyÃ©e par le client.
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

        console.log(`âœ… [webhook] +${scans} scans crÃ©ditÃ©s Ã  ${userId} (event ${event.id})`);
    } catch (e) {
        if (dejaTraite) {
            // Rejeu Stripe d'un event dÃ©jÃ  encaissÃ© : rien n'a Ã©tÃ© rÃ©Ã©crit, on acquitte.
            console.log(`â†©ï¸ [webhook] event ${event.id} dÃ©jÃ  traitÃ© â€” ignorÃ©`);
            return res.json({ recu: true });
        }
        // Ã‰chec rÃ©el : la transaction a Ã©tÃ© annulÃ©e, RIEN n'est persistÃ© â€” ni la marque
        // d'idempotence, ni le crÃ©dit. Le rejeu de Stripe repassera donc proprement.
        // 500 = "rÃ©essaie", c'est exactement ce qu'on veut.
        console.error(`âŒ [webhook] transaction Ã©chouÃ©e pour ${userId} (+${scans}, event ${event.id}) : ${e.message}`);
        // Dernier recours : si le rejeu Stripe n'aboutissait jamais (Ã©puisement des
        // tentatives), cette ligne reste la trace permettant de crÃ©diter Ã  la main.
        console.error(`ðŸ”¥ [webhook] SI AUCUN REJEU N'ABOUTIT â€” crÃ©diter MANUELLEMENT ${userId} de ${scans} scans (event ${event.id})`);
        return res.status(500).send('Erreur crÃ©dit');
    } finally {
        await sessionMongo.endSession();
    }

    res.json({ recu: true });
}

// Consultation du solde. LECTURE SEULE : consulter son solde ne doit ni crÃ©er de
// compte, ni consommer quoi que ce soit.
app.post('/api/solde', verifierJeton, async (req, res) => {
    try {
        const userId = req.body && req.body.userId ? String(req.body.userId).slice(0, 80) : null;
        if (!userId) return res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, error: "Service momentanÃ©ment indisponible" });
        }

        const credit = await Credit.findOne({ userId }).lean();
        // Compte pas encore crÃ©Ã© (aucun scan Ã  ce jour) : on renvoie le solde EFFECTIF
        // qu'il aura Ã  son premier scan, pas des zÃ©ros â€” sinon un nouvel utilisateur
        // lirait "0 scan" alors que ses crÃ©dits d'accueil l'attendent.
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
        console.error("âŒ [solde]", e.message);
        res.status(500).json({ success: false, error: "Erreur lors de la lecture du solde" });
    }
});

// Route de rÃ©veil : l'extension l'appelle dÃ¨s qu'une page Vinted se charge, pour
// que le serveur (endormi sur le plan gratuit Render aprÃ¨s 15 min d'inactivitÃ©)
// soit dÃ©jÃ  chaud quand l'utilisateur clique sur "Analyser". Volontairement
// minimale : aucun accÃ¨s base, aucun calcul.
app.get('/ping', (req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1 }));

app.get('/', (req, res) => res.send('Serveur Analyseur PokÃ©mon actif'));

app.listen(PORT, () => console.log(`ðŸš€ Serveur actif sur le port ${PORT}`));
