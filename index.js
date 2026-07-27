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

const {
    choisirMeilleur,
    analyserVariantes, resoudreMotif, motifDuTitre, normaliserTotal,
    prixDeReference, impressionEstReverse,
    MOTIFS_CIBLABLES
} = require('./scoring');

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

if (!process.env.MONGODB_URI) {
    console.error("⚠️  MONGODB_URI n'est pas défini dans les variables d'environnement Render. Le cache sera désactivé.");
} else {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("✅ MongoDB connecté"))
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
catalogueProduitSchema.index({ idExpansion: 1 });
catalogueProduitSchema.index({ idMetacard: 1 });
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
    certitude: String    // 'exacte' ou 'heuristique'
});
const NumeroCarte = mongoose.model('NumeroCarte', numeroCarteSchema, 'numeros_cartes');

// Événements Stripe déjà traités. Stripe REJOUE ses webhooks (retry sur timeout, ou
// simple doublon réseau) : sans cette table, un même paiement créditerait plusieurs fois.
// L'index unique sur eventId est le verrou — c'est l'insertion qui échoue (11000), pas
// une lecture préalable qui pourrait passer entre deux appels concurrents.
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
{"name": "Nom anglais de la carte", "number": "numéro de collection SEUL sans le total (ex: 184)", "total": "le nombre APRÈS le slash (ex: 182 pour 184/182), ou null si absent", "setCode": "code du set (ex: BLK, PAL, OBF) si visible, sinon null", "rarete": "IR/SR/SIR/UR/AR/promo/normale selon ce que tu vois", "reverse": "true/false/null — true SEULEMENT si c'est une REVERSE HOLO, false si tu es sûr que non, null si tu n'arrives pas à juger", "motif": "aucun/reverse-classique/ball/masterball/indetermine — le MOTIF du fond brillant, voir la description détaillée plus bas", "language": "EN", "etatEstime": "NM/EX/GD/LP/PL/PO", "etatConfiance": "haute/moyenne/basse", "defautsVus": ["liste courte des défauts visibles, [] si aucun"]}

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

Le "setCode" est le petit code alphabétique (2 à 4 lettres) imprimé en bas de la carte à côté du numéro, ou parfois dans le titre de l'annonce (ex: "BLK 129"). Si tu ne le vois pas clairement, réponds null, n'invente rien.
IMPORTANT — les TAMPONS/STAMPS de réimpression : si la carte porte un tampon anniversaire ou de sous-set (le logo doré "Celebrations 25 ans", le tampon "Pokémon 151", "Trainer Gallery", "Prize Pack"...), ce sont des réimpressions qui GARDENT le numéro d'origine (ex: Florizarre 15/102 en Celebrations). Dans ce cas, indique le set du TAMPON dans "setCode" (ex: "CEL" pour Celebrations, "MEW" pour 151, "TG" pour Trainer Gallery), PAS le set d'origine — c'est ce qui permet de distinguer la réimpression de la carte vintage au même numéro.

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

        if (!parsed.name || !parsed.number) {
            console.error("JSON IA incomplet:", parsed);
            return null;
        }
        parsed.language = (parsed.language || "EN").toUpperCase();

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
        console.log(`🎴 IA : ${parsed.name} #${parsed.number}${parsed.total ? '/' + parsed.total : ''}, rareté=${parsed.rarete}, rareté élevée=${parsed.rareteElevee}, reverse=${reverseLog}, motif=${parsed.motif}, langue=${parsed.language}`);
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

async function chercherCartesTCGdex(name, numberFilter, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}&localId=${numberFilter}`;
    const response = await axios.get(url, { timeout: 15000 });
    return Array.isArray(response.data) ? response.data : [];
}

// Recherche TCGdex par nom seul (sans numéro), pour les cas où le numéro bloque le match
async function chercherCartesTCGdexNomSeul(name, langueApi = 'en') {
    const url = `https://api.tcgdex.net/v2/${langueApi}/cards?name=${encodeURIComponent(name)}`;
    const response = await axios.get(url, { timeout: 15000 });
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

async function trouverCarteTCGdex(name, number, setCode, imageUrlVinted, langue = 'EN', totalImprime = null) {
    try {
        const variantes = genererVariantesNom(name);
        let resultats = [];
        let nomUtilise = name;

        // On cherche d'abord dans la langue de la carte (le nom lu par l'IA correspond
        // mieux au nom TCGdex dans cette langue), puis en anglais en repli.
        const langueCarte = langueVersTCGdex(langue);
        const languesAEssayer = langueCarte === 'en' ? ['en'] : [langueCarte, 'en'];

        // Pour chaque langue, chaque variante de nom, essayer : numéro strict -> numéro large
        for (const langApi of languesAEssayer) {
            for (const variante of variantes) {
                resultats = await chercherCartesTCGdex(variante, `eq:${encodeURIComponent(number)}`, langApi);
                if (resultats.length === 0) {
                    const numeroSansZeros = String(number).replace(/^0+/, '') || number;
                    resultats = await chercherCartesTCGdex(variante, encodeURIComponent(numeroSansZeros), langApi);
                }
                if (resultats.length > 0) {
                    nomUtilise = variante;
                    if (langApi !== 'en' || variante !== name) console.log(`ℹ️ TCGdex : trouvé via "${variante}" en [${langApi}] (recherche initiale "${name}").`);
                    break;
                }
            }
            if (resultats.length > 0) break;
        }

        // Dernier recours : recherche par NOM SEUL (sans numéro) dans les deux langues
        if (resultats.length === 0) {
            for (const langApi of languesAEssayer) {
                for (const variante of variantes) {
                    const parNom = await chercherCartesTCGdexNomSeul(variante, langApi);
                    if (parNom.length > 0) {
                        const numLu = String(number).replace(/^0+/, '');
                        const matchNum = parNom.filter(c => String(c.localId).replace(/^0+/, '') === numLu);
                        resultats = matchNum.length > 0 ? matchNum : parNom;
                        nomUtilise = variante;
                        console.log(`ℹ️ TCGdex : trouvé par nom seul via "${variante}" en [${langApi}] (${resultats.length} résultat(s)).`);
                        break;
                    }
                }
                if (resultats.length > 0) break;
            }
        }

        if (resultats.length === 0) {
            console.error(`⚠️ TCGdex : aucun résultat pour "${name}" #${number} (même avec variantes).`);
            return null;
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

        // Le nom du candidat peut être dans la langue de recherche (ex: français).
        // Or le catalogue Cardmarket est en anglais -> on récupère le nom ANGLAIS via
        // l'id (universel) pour que la recherche catalogue fonctionne.
        let nomExact = choisi.name;
        let variants = null;
        let variantsDetailed = null;
        try {
            const detailEN = await axios.get(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(choisi.id)}`, { timeout: 15000 });
            if (detailEN.data?.name) {
                if (detailEN.data.name !== choisi.name) console.log(`🔤 Nom anglais récupéré : "${detailEN.data.name}" (trouvé en "${choisi.name}").`);
                nomExact = detailEN.data.name;
            }
            // variants = { normal, reverse, holo, firstEdition, wPromo } : dit quelles
            // impressions EXISTENT. Récupéré gratuitement ici (même réponse que le nom).
            // Sert à valider/infirmer la reverse lue par l'IA, sans scraper Cardmarket.
            if (detailEN.data?.variants) variants = detailEN.data.variants;
            // variants_detailed = LA table de routage des motifs de reverse : pour
            // chaque impression (reverse ordinaire, Poké Ball, Master Ball, holo
            // cosmos...), son motif ET son idProduct Cardmarket. Récupéré GRATUITEMENT
            // ici : c'est la même réponse HTTP que le nom anglais ci-dessus, aucun appel
            // supplémentaire. C'est ce qui remplace toute règle déduite du n° de
            // variante V1/V2/V3, lequel n'a aucune sémantique stable d'un set à l'autre.
            if (Array.isArray(detailEN.data?.variants_detailed)) variantsDetailed = detailEN.data.variants_detailed;
        } catch (e) { /* on garde choisi.name si l'appel échoue */ }

        console.log(`🔗 Carte TCGdex retenue : ${choisi.id} ("${nomExact}")${ambigu ? ' [INCERTAIN]' : ''}`);
        return { id: choisi.id, ambigu, nomExact, localId: choisi.localId || number, variants, variantsDetailed };

    } catch (e) {
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

// Région d'un code set Cardmarket : les codes occidentaux sont en MAJUSCULES
// (DRI, TWM, OBF, PAL...), les japonais en minuscules / format sv+chiffres
// (sv9a, sv10s, m2a...). Règle empirique fiable sur nos données.
function regionDuCodeSet(codeSet) {
    if (!codeSet) return null;
    // Le préfixe "x" = les "Additionals" (reverse holos, cartes bonus) et NE change
    // PAS la région : xPRE = Additionals de PRE (occidental), xsv8a = Additionals de
    // sv8a (japonais). On le retire avant de classer, sinon le "x" minuscule fait
    // passer une expansion occidentale (xPRE) pour du japonais et on l'écarte à tort.
    const code = codeSet.replace(/^x/, '');
    // Un code purement en majuscules (lettres) = occidental
    if (/^[A-Z0-9]+$/.test(code) && /[A-Z]/.test(code)) return 'occidental';
    // Contient une minuscule = japonais (sv9a, m2a, mC, xm2a...)
    if (/[a-z]/.test(code)) return 'japonais';
    // ⚠️ NE PAS "réparer" ce null en supprimant les séparateurs avant de tester.
    // Les codes à séparateur ("SV-P/CS", "M-P/TH", "K+K") tombent ici et restent
    // NEUTRES, ce qui est le comportement voulu : "SV-P/CS" est la ligne promo
    // CHINOISE de SV-P, mais son code est en majuscules. Le normaliser en "SVPCS" le
    // ferait classer "occidental" et infligerait -45 au BON produit sur une carte
    // chinoise (cas Magikarp 024). Rester neutre ne coûte rien ; se tromper de région
    // coûte 45 points au mauvais endroit. Le critère set fait le travail à sa place.
    return null;
}

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
                if (r.length > 0) return r;
            }
            return [];
        }

        const preselection = await CatalogueProduit.find({ name: new RegExp(echapperRegex(premierMot), 'i') }).lean();

        // Garde ceux dont le nom (partie avant "[") normalisé correspond à une de nos cibles
        const resultats = preselection.filter(p => {
            const nomProduit = p.name.split('[')[0].trim();
            return cibles.has(normaliserNom(nomProduit));
        });

        if (resultats.length > 0) {
            console.log(`ℹ️ Catalogue local : ${resultats.length} produit(s) via correspondance normalisée pour "${nomExact}".`);
            return resultats;
        }
        return [];
    } catch (e) {
        console.error(`❌ Erreur trouverProduitsLocaux pour "${nomExact}" :`, e.message);
        return [];
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
            region: regionDuCodeSet(codeSet || (infoNum && infoNum.codeSet))
        };
    });

    if (idExpansionsAttendues.length) {
        console.log(`🎯 Set attendu -> expansion(s) Cardmarket : ${idExpansionsAttendues.join(', ')}`);
    }

    const lu = {
        numero: cardInfo.number || null,   // le numéro lu par l'IA (ex: 79, TG06)
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
    return { ...resultat, codeSets, motif: resolution, estReverse };
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
async function expansionsDuSetTCGdex(tcgdexCardId, regionAttendue = null) {
    try {
        if (mongoose.connection.readyState !== 1 || !tcgdexCardId) return [];
        const setId = String(tcgdexCardId).split('-')[0];
        if (!setId) return [];

        const exps = (await NumeroCarte.distinct('idExpansion', { setTcgdex: setId })).filter(e => e != null);
        if (!regionAttendue || exps.length === 0) return exps;

        // Filtrage par région, via le code set appris (MAJ = occidental, min = japonais).
        // Un seul aller-retour Mongo pour toutes les expansions, au lieu d'un par expansion.
        const codes = await lireCodeSets(exps);
        const gardees = [];
        for (const e of exps) {
            const code = codes.get(Number(e)) ?? null;
            const region = regionDuCodeSet(code);
            // Région inconnue -> on garde (on ne pénalise pas ce qu'on ignore)
            if (!region || region === regionAttendue) gardees.push(e);
            else console.log(`   ℹ️ Expansion ${e} (${code}, ${region}) écartée du set attendu : on cherche de l'${regionAttendue}.`);
        }
        return gardees;
    } catch (e) {
        console.error("Erreur expansionsDuSetTCGdex :", e.message);
        return [];
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
    try {
        const { imageUrl, imageUrls, title, vintedPrice, vintedEtat, debug } = req.body;

        if (!imageUrl) {
            console.error("⚠️ Requête reçue sans imageUrl. Body reçu:", req.body);
            return res.json({ success: false, error: "Aucune image reçue" });
        }

        const etatMin = etatVintedVersCardmarket(vintedEtat);
        if (vintedEtat) console.log(`🏷️ État Vinted : "${vintedEtat}" -> Cardmarket ${etatMin || '(non mappé)'}${etatMin ? ' minimum' : ''}`);

        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        console.log(`📷 ${photos.length} photo(s) envoyée(s) à l'IA.`);
        const cardInfo = await getCardIdFromAI(photos, title);
        if (!cardInfo) {
            // Échec DUR : aucune carte identifiée, rien n'a été livré -> on rend le scan.
            await rembourserScan(req, 'ia-echec');
            return res.json({ success: false, error: "Analyse IA échouée (voir logs Render pour la cause exacte)" });
        }

        // 1. Cache Mongo (sauté si debug=true, pratique pour retester une carte sans attendre 24h)
        let resultat = debug ? null : await lireCache(cardInfo.name, cardInfo.number, cardInfo.language);
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
            const trouvailleTCGdex = await trouverCarteTCGdex(cardInfo.name, cardInfo.number, cardInfo.setCode, imageUrl, cardInfo.language, cardInfo.total);
            if (!trouvailleTCGdex) {
                await rembourserScan(req, 'carte-introuvable');
                return res.json({ success: false, error: `Carte "${cardInfo.name}${cardInfo.setCode ? ' ' + cardInfo.setCode : ''} #${cardInfo.number}" non trouvée sur TCGdex` });
            }

            // 2b. Candidats Cardmarket (avec idExpansion) via le catalogue local
            const produits = await trouverProduitsLocaux(trouvailleTCGdex.nomExact);
            console.log(`🗂️ Catalogue local : ${produits.length} produit(s) pour "${trouvailleTCGdex.nomExact}".`);

            // 2c. NIVEAU 1 — scoring local (classe TOUS les candidats par pertinence)
            let classement = [];
            let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
            let estReverse = false;
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
                const expAttendues = await expansionsDuSetTCGdex(trouvailleTCGdex.id, regionAttendue(cardInfo));
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
            }

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
                await rembourserScan(req, 'aucun-prix');
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
        res.json({ success: false, error: "Erreur serveur interne" });
    }
});

// ============================================================
// ROUTE /api/identifier — pour l'ARCHITECTURE EXTENSION
// ============================================================
// Fait tout le travail d'identification (IA, TCGdex, catalogue, scoring) et
// renvoie les candidats CLASSÉS, mais ne touche PAS à Cardmarket : c'est
// l'extension qui fera le live depuis le navigateur de l'utilisateur, avec son
// IP et ses cookies. C'est la répartition qui évite les bannissements.
app.post('/api/identifier', verifierJeton, exigerImage, verifierAcces, async (req, res) => {
    try {
        const { imageUrl, imageUrls, title, vintedEtat } = req.body;
        const photos = (Array.isArray(imageUrls) && imageUrls.length) ? imageUrls : [imageUrl];
        // exigerImage a déjà refusé les requêtes sans photo, AVANT tout décompte.

        console.log(`\n📷 [identifier] ${photos.length} photo(s) reçue(s).`);

        // 1. Lecture de la carte par l'IA
        const debutIA = Date.now();
        const cardInfo = await getCardIdFromAI(photos, title);
        console.log(`⏱️ [identifier] appel IA : ${Date.now() - debutIA} ms`);
        if (!cardInfo) {
            await rembourserScan(req, 'ia-echec');
            return res.json({ success: false, error: "Analyse IA échouée" });
        }

        // Instrumentation : mesure le coût du bloc catalogue+TCGdex+scoring (tout ce
        // qui suit), pour décider plus tard si un cache/cache mémoire (reporté) vaut le
        // coup — à comparer avec le temps d'appel IA ci-dessus, qui tourne de toute façon.
        const debutCatalogue = Date.now();

        // 2. Identification précise via TCGdex (+ variantes de nom, multilingue)
        const trouvaille = await trouverCarteTCGdex(cardInfo.name, cardInfo.number, cardInfo.setCode, photos[0], cardInfo.language, cardInfo.total);
        if (!trouvaille) {
            await rembourserScan(req, 'carte-introuvable');
            return res.json({ success: false, error: `Carte "${cardInfo.name}" #${cardInfo.number} non trouvée sur TCGdex`, cardInfo });
        }

        // Garde-fou : si le numéro de la carte trouvée contredit celui lu sur la photo,
        // c'est que TCGdex s'est trompé de carte (typiquement : set trop récent, absent
        // de sa base -> il retombe sur une homonyme d'un autre set). Dans ce cas on ne
        // se fie plus à son nom : on repart de ce que l'IA a lu.
        const numLuIA = String(cardInfo.number || '').replace(/^0+/, '').toLowerCase();
        const numTCG = String(trouvaille.localId || '').replace(/^0+/, '').toLowerCase();
        let nomPourCatalogue = trouvaille.nomExact;
        let tcgdexDouteux = false;
        if (numLuIA && numTCG && numLuIA !== numTCG) {
            tcgdexDouteux = true;
            nomPourCatalogue = cardInfo.name;
            console.log(`⚠️ [identifier] TCGdex renvoie le n°${numTCG} alors que l'IA a lu ${numLuIA} : set probablement trop récent pour TCGdex.`);
            console.log(`   -> on cherche dans le catalogue avec le nom lu par l'IA ("${cardInfo.name}") plutôt qu'avec celui de TCGdex.`);
        }

        // Validateur de reverse (TCGdex) : on ne garde "reverse=true" que si cette
        // carte possède RÉELLEMENT une impression reverse. Neutralise les faux
        // positifs (une holo normale lue à tort comme reverse par l'IA). On ne
        // l'applique PAS si TCGdex s'est trompé de carte (variants d'une autre carte).
        if (cardInfo.reverse === true && !tcgdexDouteux && trouvaille.variants) {
            if (trouvaille.variants.reverse === false) {
                console.log(`↩️ TCGdex : pas de reverse connue pour cette carte -> on ignore le "reverse" lu par l'IA.`);
                cardInfo.reverse = false;
            } else if (trouvaille.variants.reverse === true) {
                console.log(`✅ TCGdex confirme qu'une reverse existe pour cette carte.`);
            }
        }

        // 3. Candidats Cardmarket via le catalogue local
        const produits = await trouverProduitsLocaux(nomPourCatalogue);
        console.log(`🗂️ [identifier] ${produits.length} candidat(s) pour "${nomPourCatalogue}".`);

        // Le set TCGdex nous dit dans quelle(s) expansion(s) Cardmarket chercher.
        // Si TCGdex s'est trompé de carte (numéro incohérent), on n'utilise pas son set.
        const expansionsAttendues = tcgdexDouteux ? [] : await expansionsDuSetTCGdex(trouvaille.id, regionAttendue(cardInfo));

        // Codes set de TOUS les candidats en un seul aller-retour Mongo, injecté dans le
        // scoring pour lui éviter de refaire la même lecture candidat par candidat.
        const codeSetsConnus = await lireCodeSets(produits.map(p => p.idExpansion));

        // 4. Scoring : on renvoie le CLASSEMENT, l'extension testera dans l'ordre
        let classement = [];
        // Stratégie reverse du GAGNANT + état de résolution du motif (champs additifs).
        let strategieReverse = null;
        let motifResolution = { etat: 'aucun-motif', cible: null, raison: null };
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
        } else if (produits.length > 1) {
            const { scores, confiant, strategieReverse: strat, motif } = await scorerCandidatsLocal(
                produits, cardInfo, photos[0], expansionsAttendues, codeSetsConnus, optionsMotif
            );
            strategieReverse = strat;
            motifResolution = motif;
            classement = scores.map(s => ({
                idProduct: s.candidat.idProduct,
                idExpansion: s.candidat.idExpansion,
                score: s.score,
                // Stratégie PAR CANDIDAT : sur une même carte les deux mécanismes
                // coexistent (produit de base partagé + motifs en produits distincts),
                // donc une stratégie globale serait fausse pour une partie du classement.
                strategie: s.strategie,
                detail: s.detail
            }));
            console.log(`🧮 [identifier] meilleur = ${classement[0]?.idProduct} (score ${classement[0]?.score}), confiance ${confiant ? 'HAUTE' : 'BASSE'}`);
        }

        console.log(`⏱️ [identifier] catalogue+scoring : ${Date.now() - debutCatalogue} ms`);

        // Échec DUR : aucun candidat à tester, l'extension n'a rien à lire -> on rend
        // le scan. (Un classement même incertain, lui, EST un résultat livré.)
        if (classement.length === 0) {
            await rembourserScan(req, 'aucun-candidat');
            return res.json({ success: false, error: `Aucun produit Cardmarket pour "${nomPourCatalogue}"`, cardInfo });
        }

        const carteAmbigue = Boolean(trouvaille.ambigu || tcgdexDouteux || motifResolution.etat === 'non-resolu');
        if (carteAmbigue) {
            await signalerIncertain(req, motifResolution.etat === 'non-resolu'
                ? `motif-${motifResolution.raison}`
                : (tcgdexDouteux ? 'tcgdex-numero-incoherent' : 'tcgdex-ambigu'));
        }

        const etatMin = etatVintedVersCardmarket(vintedEtat);

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
                // Incertain si TCGdex hésitait, s'il s'est manifestement trompé de carte,
                // OU si la carte a un motif de reverse qu'on n'a pas su cibler (le prix
                // peut alors varier d'un facteur 100 entre variantes — cf. Master Ball).
                ambigu: carteAmbigue
            },
            etat: {
                estimeIA: cardInfo.etatEstime || null,
                confianceIA: cardInfo.etatConfiance || null,
                defautsVus: cardInfo.defautsVus || [],
                declareVendeur: vintedEtat || null,
                declareCardmarket: etatMin,
                // L'état à retenir = le PIRE des deux avis (voir explication plus haut)
                retenu: pireEtat(
                    (cardInfo.etatConfiance === 'haute' || cardInfo.etatConfiance === 'moyenne') ? cardInfo.etatEstime : null,
                    etatMin
                )
            },
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
        res.json({ success: false, error: e.message });
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
        res.json({ success: false, error: e.message });
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

        console.log(`🧠 [apprendre-lot] ${nouvelles} nouv. / ${ameliorees} améliorées / ${dejaExactes} déjà exactes (exp ${idExpansion ?? '?'})`);
        res.json({ success: true, recus: cartes.length, nouvelles, ameliorees, dejaExactes, sansNumero, idExpansion });
    } catch (e) {
        console.error("❌ [apprendre-lot]", e.message);
        res.json({ success: false, error: e.message });
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
// ⚠️ price_id de TEST — à remplacer par les Live avant la mise en production.
const PACKS = {
    p20:  { price: 'price_1TxYgxCHs5xC36JEiTYo1tVy', scans: 20 },
    p50:  { price: 'price_1TxYhSCHs5xC36JEJD8T72vJ', scans: 50 },
    p100: { price: 'price_1TxYhzCHs5xC36JEgQ1VFhBn', scans: 100 },
    p200: { price: 'price_1TxYiQCHs5xC36JEtThiZz1S', scans: 200 }
};

// Crée une session de paiement et renvoie l'URL Stripe où rediriger l'utilisateur.
// Ne crédite RIEN : le crédit n'a lieu que dans le webhook signé, après paiement confirmé.
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
            // metadata : c'est ce que le webhook relira pour savoir QUI créditer et de
            // COMBIEN. Écrit ici par le serveur à partir de PACKS, donc non falsifiable.
            metadata: { userId, scans: String(pack.scans) },
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
app.get('/ping', (req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1 }));

app.get('/', (req, res) => res.send('Serveur Analyseur Pokémon actif'));

app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));