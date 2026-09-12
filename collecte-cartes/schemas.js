// ============================================================
// SCHÉMAS de la base `cartes` — cible TOTALE dès le premier set
// ============================================================
// Cinq collections, déclarées sur la connexion `cartes` (jamais sur la connexion par défaut de
// mongoose : index.js y déclare les siennes, et un modèle partagé écrirait au mauvais endroit).
//   sets            — une ligne par set, écrite depuis la table à la main + l'infobox Bulbapedia
//   cartes          — une ligne par PAGE Bulbapedia (_id = pageid), tous tirages fusionnés
//   cartes_produits — la jointure n-n, une ligne par (carte, produit), avec sa PREUVE
//   restes          — ce qui n'a pas joint, LISTÉ, jamais résolu par le code
//   collecte_etat   — l'état de reprise par set, écrit après chaque unité, jamais avant
// `strict: false` partout : le schéma documente les champs attendus, il n'interdit pas d'en écrire
// d'autres — un champ nouveau ne doit pas exiger une migration.

const mongoose = require('mongoose');

const setSchema = new mongoose.Schema({
    _id: String,                          // slug stable : slugSet Cardmarket (ex. 'Expansion-Pack')
    code: String, idExpansion: [Number], nomEn: String, nomJa: String, nomJaTraduit: String, nomFr: String,
    region: String, dateSortieJa: String, dateSortieEn: String, totalImprime: Number,
    bulba: { titre: String, pageid: Number, revid: Number, motifTitres: String, expansion: mongoose.Schema.Types.Mixed },   // nom OU liste (EXS)
    complet: mongoose.Schema.Types.Mixed,
    collecteLe: Date, version: { type: Number, default: 1 }
}, { strict: false, collection: 'sets' });

const carteSchema = new mongoose.Schema({
    _id: Number,                          // pageid Bulbapedia
    nomEn: String, nomJa: String, nomFr: String,
    categorie: String, type: String, pv: mongoose.Schema.Types.Mixed, stade: String, ndex: Number,
    rarete: String, illustrateur: String,
    attaques: [{ _id: false, nom: String, nomJa: String, cout: [String], degats: String }],
    faiblesse: String, resistance: String, retraite: Number,
    impressions: [{ _id: false, tirage: String, expansion: String, deck: String, numero: String, total: String, rarete: String }],
    liens: { idProduct: [Number], idMetacard: Number },
    bulba: { titre: String, pageid: Number, revid: Number, redirigeDepuis: [String], cleR2: String },
    sets: [String],                       // slugs des sets de la table qui ont amené cette page
    champsNuls: [String],
    image: mongoose.Schema.Types.Mixed,
    collecteLe: Date, version: { type: Number, default: 1 }
}, { strict: false, collection: 'cartes' });
carteSchema.index({ nomEn: 1 });
carteSchema.index({ sets: 1 });
carteSchema.index({ 'liens.idProduct': 1 });

const carteProduitSchema = new mongoose.Schema({
    _id: String,                          // `${carteId}|${idProduct}`
    carteId: Number, idProduct: Number, idExpansion: Number, tirage: String,
    preuve: String,                       // 'set+numero' | 'set+nom+attaques' | 'set+nom' | 'manuel'
    detail: String, verifieLe: Date
}, { strict: false, collection: 'cartes_produits' });
carteProduitSchema.index({ idProduct: 1 });
carteProduitSchema.index({ carteId: 1 });

const resteSchema = new mongoose.Schema({
    set: String, type: String,            // 'produit-sans-carte' | 'carte-sans-produit' | 'produit-vers-plusieurs-cartes' | 'titre-manquant'
    idProduct: Number, carteId: Number, detail: String, le: Date
}, { strict: false, collection: 'restes' });
resteSchema.index({ set: 1, type: 1 });

const etatSchema = new mongoose.Schema({
    _id: String,                          // slug du set
    phase: String,                        // 'set' | 'liens' | 'texte' | 'jointure' | 'verifie'
    titres: [String], pages: [{ _id: false, titre: String, pageid: Number, revid: Number, etat: String }],
    verrou: { pid: Number, hote: String, depuis: Date },
    requetes: Number, debute: Date, fini: Date, derniereRequete: Date
}, { strict: false, collection: 'collecte_etat' });

// ---- images (collecteur-images.js) -------------------------------------------------------
// Une ligne par ORIGINAL collecté, clé stable dérivée de la source. La ligne s'écrit APRÈS l'objet
// R2, jamais avant ; `sha256` présent = unité finie (c'est le point de reprise).
const imageSchema = new mongoose.Schema({
    _id: String,                          // `${source}/${sourceSetId}/${n}`
    source: String, sourceSetId: Number, n: Number, titre: String,
    urlOriginal: String, cleCdn: String, cleR2: String,
    sha256: String, octets: Number, w: Number, h: Number, fmt: String,
    numero: String, total: String, nomEn: String, nomJa: String, illustrateur: String, rarete: String,
    setNomSource: String, setNomJa: String,
    carteId: Number, set: String, preuve: String,
    telechargeLe: Date, etat: String
}, { strict: false, collection: 'images' });
imageSchema.index({ set: 1 });
imageSchema.index({ carteId: 1 });
imageSchema.index({ cleCdn: 1 });

const etatImagesSchema = new mongoose.Schema({
    _id: String,                          // `${source}/${slug}`
    phase: String,                        // 'liste' | 'mesure' | 'originaux' | 'jointure' | 'verifie' | 'refuse-resolution'
    entrees: mongoose.Schema.Types.Mixed, // sourceSetId -> [{n, titre, original, cleCdn, vignette}]
    mesures: mongoose.Schema.Types.Mixed, // sourceSetId -> [{url, w, h, octets}]
    verrou: { pid: Number, hote: String, depuis: Date },
    requetes: Number, debute: Date, fini: Date, derniereRequete: Date
}, { strict: false, collection: 'collecte_images_etat' });

function modeles(connexion) {
    return {
        Set: connexion.model('Set', setSchema),
        Carte: connexion.model('Carte', carteSchema),
        CarteProduit: connexion.model('CarteProduit', carteProduitSchema),
        Reste: connexion.model('Reste', resteSchema),
        Etat: connexion.model('Etat', etatSchema),
        Image: connexion.model('Image', imageSchema),
        EtatImages: connexion.model('EtatImages', etatImagesSchema)
    };
}

module.exports = { modeles };
