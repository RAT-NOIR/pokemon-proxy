// ============================================================
// SONDE DE LECTURE — où en est l'APPRENTISSAGE d'une ou plusieurs expansions Cardmarket (production, LECTURE SEULE)
// ============================================================
//   node sonde-apprentissage-expansion.js --exp=6704[,6928,…]
//
// Pour chaque expansion : les produits du catalogue (catalogue_produits), les lignes de numeros_cartes (par certitude et par slugSet),
// cinq lignes d'exemple ; puis l'état de la file serveur `apprentissage_attente` (compte par état, cinq derniers lots).
// Cas qui l'a fait naître (2026-11-01/07) : l'expansion 6704, 141 produits sans image, 141 refus « porté par 0 expansions » — on veut
// VOIR ce que la base porte après un passage de l'userscript 1.13.
// Lecture seule : find / countDocuments / distinct uniquement (via lireMongo), liste FERME d'arguments, aucune méthode d'écriture.
// Dénominateurs imprimés (CLAUDE.md §3) : chaque compte dit sur combien il porte.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { estCarteCode } = require('./collecte-cartes/jointure');

const AUTORISES = [/^--exp=\d+(,\d+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — seul --exp=<id>[,<id>…] est accepté`); process.exit(2); }
const argExp = process.argv.find(a => a.startsWith('--exp='));
if (!argExp) { console.error('❌ --exp=<idExpansion>[,<idExpansion>…] requis'); process.exit(2); }
const EXPANSIONS = [...new Set(argExp.slice(6).split(',').map(Number))];
if (EXPANSIONS.some(e => !Number.isSafeInteger(e) || e < 1)) { console.error('❌ idExpansion illisible'); process.exit(2); }

const compter = liste => liste.reduce((m, k) => { const c = String(k ?? '(vide)'); m[c] = (m[c] || 0) + 1; return m; }, {});

(async () => {
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    try {
        const catalogue = prod.db.collection('catalogue_produits'), numeros = prod.db.collection('numeros_cartes'), file = prod.db.collection('apprentissage_attente');
        console.log(`SONDE (lecture seule) · expansions ${EXPANSIONS.join(', ')} · catalogue_produits ${await catalogue.countDocuments({})} · numeros_cartes ${await numeros.countDocuments({})} · apprentissage_attente ${await file.countDocuments({})}`);
        for (const e of EXPANSIONS) {
            const vide = 'une expansion neuve ou non apprise peut légitimement n\'avoir aucune ligne : c\'est ce que la sonde mesure';
            const produits = await lireMongo(catalogue, { idExpansion: e }, { nom: 'catalogue_produits', videAutorise: vide, projection: { _id: 0, idProduct: 1, name: 1 } });
            const hors = produits.filter(p => !estCarteCode(p.name));
            const ids = produits.map(p => p.idProduct);
            // les lignes de l'expansion : son idExpansion, OU les produits de son catalogue (une ligne lue d'un produit hors catalogue a idExpansion null)
            const lignes = await lireMongo(numeros, { $or: [{ idExpansion: e }, { idProduct: { $in: ids } }] }, { nom: 'numeros_cartes', videAutorise: vide, projection: { _id: 0, idProduct: 1, idExpansion: 1, slug: 1, slugSet: 1, numero: 1, certitude: 1, source: 1 } });
            console.log(`\n══ EXPANSION ${e} ══`);
            console.log(`produits au catalogue : ${produits.length} (dont ${produits.length - hors.length} cartes-code, ${hors.length} hors cartes-code)`);
            console.log(`lignes numeros_cartes : ${lignes.length} sur ${produits.length} produits au catalogue (${produits.length ? Math.round(100 * lignes.filter(l => ids.includes(l.idProduct)).length / produits.length) : 0} % des produits ont une ligne) · dont idExpansion=${e} : ${lignes.filter(l => l.idExpansion === e).length}`);
            console.log(`   par certitude (sur ${lignes.length}) : ${JSON.stringify(compter(lignes.map(l => l.certitude)))}`);
            console.log(`   par source    (sur ${lignes.length}) : ${JSON.stringify(compter(lignes.map(l => l.source)))}`);
            console.log(`   par slugSet   (sur ${lignes.length}) : ${JSON.stringify(compter(lignes.map(l => l.slugSet)))}`);
            console.log(`   avec slug : ${lignes.filter(l => l.slug).length} · avec numéro : ${lignes.filter(l => l.numero).length} (sur ${lignes.length})`);
            console.log('   exemples :'); for (const l of lignes.slice(0, 5)) console.log(`      ${l.idProduct} · ${l.slug ?? '—'} · n°${l.numero ?? '—'} · ${l.certitude ?? '(sans certitude)'}`);
            if (!lignes.length) console.log('      (aucune ligne)');
        }
        const parEtat = {};
        for (const etat of ['attente', 'en-cours', 'fait', 'erreur']) parEtat[etat] = await file.countDocuments({ etat });
        const total = await file.countDocuments({});
        console.log(`\n══ FILE apprentissage_attente ══\ncompte par état (sur ${total} lots) : ${JSON.stringify(parEtat)} · hors ces quatre états : ${total - Object.values(parEtat).reduce((a, b) => a + b, 0)}`);
        const derniers = await file.find({}, { projection: { _id: 0, recuLe: 1, nCartes: 1, etat: 1, essais: 1, derniereErreur: 1 } }).sort({ recuLe: -1 }).limit(5).toArray();
        console.log(`cinq derniers lots (sur ${total}) :`);
        for (const d of derniers) console.log(`   ${d.recuLe instanceof Date ? d.recuLe.toISOString() : d.recuLe} · ${d.nCartes ?? '?'} cartes · ${d.etat} · essais ${d.essais ?? 0}${d.derniereErreur ? ` · ${String(d.derniereErreur).slice(0, 120)}` : ''}`);
        if (!derniers.length) console.log('   (file vide)');
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(2); });
