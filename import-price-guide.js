// Script d'import du guide des prix Cardmarket dans MongoDB.
// Complète le catalogue produits déjà importé (jointure par idProduct).
//
// Usage (le fichier : téléchargé par le testeur depuis Cardmarket — price_guide_6.json, « 6 » = Pokémon —, jamais par un script) :
//   node backup-collections.js --base=test --collections=guide_prix
//   node import-price-guide.js price_guide_JJMMAA.json --base=test --confirmer-production
// (--base=test_scratch : le banc test-import-price-guide.js, jamais un import)
// Le guide sert l'API et l'extension, JAMAIS le site : il vit dans la base `test` ; le site lit `cartes`, où aucun outil ne l'écrit.
//
// ════════════════════════════════════════════════════════════════════════════
// 📌 À QUELLE CADENCE FAUT-IL RÉIMPORTER ? — LA MÉTHODE, PAS LA RÉPONSE
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ AUCUN CHIFFRE ICI, ET C'EST DÉLIBÉRÉ. « Toutes les deux semaines » serait une
// habitude déguisée en mesure. Ce qui décide de la cadence est la VOLATILITÉ DES PRIX,
// et elle n'est pas mesurable aujourd'hui.
//
// POURQUOI ELLE NE L'EST PAS : `majAt` est écrasé à chaque import. Au 2026-09-02, les
// 78 225 lignes portent TOUTES la même date (2026-08-30, 21:01–21:03) — un seul import,
// donc AUCUNE SÉRIE À COMPARER. On sait que le guide a 3,5 jours ; on ne sait rien de la
// vitesse à laquelle il se périme.
//
// 🔑 LA MÉTHODE, quand la place ne pressera plus (le cluster était à 2,5 Mo de marge) :
//   1. garder DEUX imports successifs — le second dans une collection à part, pas en
//      écrasement, sinon on reproduit le problème qu'on veut mesurer ;
//   2. comparer `trend` PRODUIT PAR PRODUIT entre les deux ;
//   3. lire la distribution de l'écart relatif, et surtout sa QUEUE HAUTE — la médiane
//      dira « les prix ne bougent pas », ce qui est vrai et sans intérêt : ce qui coûte,
//      c'est la carte à 40 € qui en vaut 25 une semaine plus tard ;
//   4. la cadence se déduit du délai au bout duquel la queue haute dépasse ce que la
//      règle de la fourchette tolère — pas d'un calendrier.
// C'est UN IMPORT DE PLUS, pas un chantier.
//
// ⚠️ ET LA MÊME MESURE RÉPOND À UNE AUTRE QUESTION : si le guide bouge peu, la lecture
// live Cardmarket — un onglet ouvert chez l'utilisateur à chaque scan abouti, sur le seul
// mur qui ne s'achète pas — devient un raffinement coûteux plutôt qu'une nécessité.
//
// ✅ LA PREMIÈRE MESURE, 2026-09-28 (le second import, feu vert du testeur : « pour l'API et
// l'extension uniquement, JAMAIS affiché sur le site ») — guide en base du 30/08 contre le
// fichier du 27/09, 28 jours, `trend` produit par produit, écart |Δ|/ancien :
//   < 1 € (32 743)  médiane 10,8 % · > 20 % pour 37,9 % · > 50 % pour 13,0 %
//   1–10 € (19 738) médiane  6,1 % · > 20 % pour 22,2 % · > 50 % pour  6,8 %
//   10–50 € (8 019) médiane  5,8 % · > 20 % pour 22,6 % · > 50 % pour  7,1 %
//   ≥ 50 € (5 694)  médiane  1,8 % · > 20 % pour 16,5 % · > 50 % pour  4,8 %
// La queue haute est LARGE à 28 jours : une carte sur six au-dessus de 50 € a bougé de plus de 20 %.
// Un seul intervalle mesuré : la vitesse à 7 jours se mesurera au prochain import.
//
// LA DATE DU GUIDE (2026-09-28) : `majAt` disait l'heure de l'IMPORT, jamais celle du GUIDE.
// Chaque ligne porte désormais `guideDu` (le `createdAt` du fichier), et `guide_prix_meta`
// (`_id: 'dernier'`) le guide le plus récent importé. Une ligne dont `guideDu` est antérieur
// à celui de `guide_prix_meta` est un produit ABSENT du dernier guide (plus d'offre) : son prix
// est périmé, et c'est lisible. Un produit n'est jamais retiré : son dernier prix connu reste,
// daté. Un guide plus ANCIEN que celui en base est refusé (il réécrirait des prix plus frais).

require('dotenv').config();
const { connecterMongo } = require('./mongo-connexion');
const fs = require('fs');
const { porteUnPrix } = require('./collecte-cartes/taux-prix-guide');
const mongoose = require('mongoose');

// la ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : le fichier, la base, la confirmation de production
const AUTORISES = [/^--base=(test|test_scratch)$/, /^--confirmer-production$/];
const positionnels = process.argv.slice(2).filter(a => !a.startsWith('--'));
const inconnus = process.argv.slice(2).filter(a => a.startsWith('--') && !AUTORISES.some(r => r.test(a)));
if (inconnus.length || positionnels.length !== 1 || !/\.json$/i.test(positionnels[0])) {
    console.error(`Usage : node import-price-guide.js <price_guide_*.json> --base=test --confirmer-production${inconnus.length ? `\n❌ argument inconnu : ${inconnus.join(' ')}` : ''}`);
    process.exit(2);
}
const cheminFichier = positionnels[0];

const guidePrixSchema = new mongoose.Schema({
    idProduct: { type: Number, required: true, unique: true },
    avg: Number,
    low: Number,
    trend: Number,
    avg1: Number,
    avg7: Number,
    avg30: Number,
    avgHolo: Number,
    lowHolo: Number,
    trendHolo: Number,
    avg1Holo: Number,
    avg7Holo: Number,
    avg30Holo: Number,
    guideDu: Date,
    majAt: { type: Date, default: Date.now }
});

const GuidePrix = mongoose.model('GuidePrix', guidePrixSchema, 'guide_prix');

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI n'est pas défini.");
        process.exit(1);
    }

    console.log("Connexion à MongoDB...");
    // Base nommée explicitement, sinon refus (voir mongo-connexion.js) : ce script
    // ÉCRIT, et la base de production s'appelle `test`.
    const base = await connecterMongo({ script: 'import-price-guide.js', ecrit: true, confirmationProduction: true });
    // la base RÉELLEMENT connectée, pas seulement l'argument (relecture du 2026-09-28 : MONGODB_BASE du .env passait sans --base=)
    if (!['test', 'test_scratch'].includes(base)) { console.error(`❌ le guide des prix vit dans « test » (ou « test_scratch » pour le banc), pas dans « ${base} » : rien n'est importé`); await mongoose.disconnect(); process.exit(2); }
    console.log("✅ Connecté.");

    console.log(`Lecture de ${cheminFichier}...`);
    const brut = fs.readFileSync(cheminFichier, 'utf-8');
    const data = JSON.parse(brut);
    const guides = data.priceGuides;
    const guideDu = new Date(data.createdAt);
    if (!Array.isArray(guides) || !guides.length || Number.isNaN(guideDu.getTime())) {
        console.error(`❌ fichier sans priceGuides ou sans createdAt lisible (${data.createdAt}) : rien n'est importé`);
        await mongoose.disconnect(); process.exit(1);
    }
    console.log(`${guides.length} prix trouvés dans le fichier (créé le ${data.createdAt}).`);
    const META = mongoose.connection.db.collection('guide_prix_meta');
    const avant = await META.findOne({ _id: 'dernier' });
    const lignesAvant = await GuidePrix.countDocuments({});
    // seul un guide PLUS RÉCENT que celui en base passe ; sans méta (imports d'avant le 2026-09-28), la date du guide en base n'est
    // pas connue : la borne prudente est le DERNIER import (le plus récent `majAt` DATÉ — un document sans `majAt` ne l'efface pas)
    const dernierImport = (await GuidePrix.find({ majAt: { $type: 'date' } }, { majAt: 1 }).sort({ majAt: -1 }).limit(1).lean())[0]?.majAt ?? null;
    const reference = avant?.guideDu ?? dernierImport;
    if (!reference && lignesAvant > 0) { console.error(`❌ ${lignesAvant} lignes en base et aucune date (ni méta, ni majAt) : je ne sais pas si le fichier est plus récent — rien n'est importé`); await mongoose.disconnect(); process.exit(1); }
    if (reference && guideDu <= new Date(reference)) {
        console.error(`❌ le fichier est du ${guideDu.toISOString()}, pas plus récent que le guide en base (${new Date(reference).toISOString()}) : rien n'est importé`);
        await mongoose.disconnect(); process.exit(1);
    }
    console.log(`DÉNOMINATEUR : ${lignesAvant} lignes en base avant (guide ${avant?.guideDu ? `du ${avant.guideDu.toISOString()}` : `importé le ${reference ? new Date(reference).toISOString() : '—'}, date du fichier non gardée`})`);

    const TAILLE_LOT = 2000;
    let traites = 0;

    for (let i = 0; i < guides.length; i += TAILLE_LOT) {
        const lot = guides.slice(i, i + TAILLE_LOT);
        const operations = lot.map(g => ({
            updateOne: {
                filter: { idProduct: g.idProduct },
                update: {
                    $set: {
                        avg: g.avg, low: g.low, trend: g.trend,
                        avg1: g.avg1, avg7: g.avg7, avg30: g.avg30,
                        avgHolo: g['avg-holo'], lowHolo: g['low-holo'], trendHolo: g['trend-holo'],
                        avg1Holo: g['avg1-holo'], avg7Holo: g['avg7-holo'], avg30Holo: g['avg30-holo'],
                        guideDu, majAt: new Date()
                    }
                },
                upsert: true
            }
        }));
        await GuidePrix.bulkWrite(operations, { ordered: false });
        traites += lot.length;
        console.log(`... ${traites}/${guides.length} importés`);
    }

    // le taux de lignes avec un prix de CE guide (même prédicat que l'import quotidien), gardé dans la méta pour le juge du suivant
    const avecPrix = guides.filter(porteUnPrix).length;
    const lignesApres = await GuidePrix.countDocuments({});
    const aJour = await GuidePrix.countDocuments({ guideDu });
    const idsDistincts = new Set(guides.map(g => g.idProduct)).size;   // un idProduct en double dans le fichier n'écrit qu'une ligne
    console.log(`RELU : ${lignesApres} lignes (avant ${lignesAvant}) · ${aJour} au guide du ${guideDu.toISOString()} (${idsDistincts} idProduct distincts dans le fichier) · ${lignesApres - aJour} absentes de ce guide, gardées avec leur date (prix périmés, lisibles)`);
    // la méta ne se pose qu'après le contrôle : un import incomplet ne se déclare pas « dernier guide » (relecture du 2026-09-28)
    if (aJour !== idsDistincts) { console.error(`🔴 ${aJour} lignes au guide du jour pour ${idsDistincts} idProduct dans le fichier : la méta n'est PAS mise à jour`); process.exitCode = 1; }
    else { await META.updateOne({ _id: 'dernier' }, { $set: { guideDu, importeLe: new Date(), fichier: require('path').basename(cheminFichier), lignesDuFichier: guides.length, avecPrix, lignes: guides.length, tauxPrix: guides.length ? avecPrix * 100 / guides.length : null } }, { upsert: true }); console.log('✅ Import terminé.'); }
    await mongoose.disconnect();
}

main().catch(err => {
    console.error("❌ Erreur import :", err);
    process.exit(1);
});
