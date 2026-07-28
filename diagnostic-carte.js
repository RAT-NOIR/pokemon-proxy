// ============================================================
// DIAGNOSTIC CARTE — lecture seule, autonome
// ============================================================
// Montre TOUT ce que ta base sait d'une carte : chaque produit catalogue,
// son set, son numéro appris (ou non), et surtout sa VARIANTE (V1/V2/V3).
// Sert à répondre à UNE question : une reverse est-elle un idProduct distinct
// (variante V2) ou pas ? Et : le numéro d'un secret rare est-il bien appris ?
//
// N'importe PAS live-cardmarket : aucun navigateur, aucun scraping. Lecture pure.
//
// USAGE (la base doit être NOMMÉE, le script refuse de la deviner) :
//   node diagnostic-carte.js --base=test Tandemaus
//   node diagnostic-carte.js --base=test Minisange      (nom FR : si nomFr est en base)
//   node diagnostic-carte.js --base=test "Umbreon ex"

require('dotenv').config();
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');
mongoose.set('strictQuery', false);

const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({
    idProduct: Number, idExpansion: Number, numero: String, numeroUrl: String,
    codeSet: String, nomFr: String, variante: String, slug: String
}, { strict: false }), 'numeros_cartes');

const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({
    idExpansion: Number, codeSet: String
}, { strict: false }), 'codes_set');

const CatalogueProduit = mongoose.model('CatalogueProduit', new mongoose.Schema({
    idProduct: Number, idExpansion: Number, name: String
}, { strict: false }), 'catalogue_produits');

// Même normalisation que index.js (ignore espaces, tirets, casse, ponctuation)
const normaliser = n => n.toLowerCase().replace(/[\s\-'.&]/g, '');

const NOM_VARIANTE = { V1: 'normale', V2: 'REVERSE', V3: 'illustration' };

async function main() {
    // On retire les options (--base=...) : le reste est le nom de la carte.
    const nom = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
    if (!nom) {
        console.error('Usage : node diagnostic-carte.js --base=<nom> <nom de carte>');
        console.error('Ex    : node diagnostic-carte.js --base=test Tandemaus');
        process.exit(1);
    }

    // Lecture seule, mais la règle vaut pour TOUS les scripts : on nomme la base, on
    // l'affiche, on refuse si elle ne correspond pas (voir mongo-connexion.js). Un
    // diagnostic lancé sur la mauvaise base donne des conclusions fausses.
    await connecterMongo({ script: 'diagnostic-carte.js', ecrit: false });
    console.log(`   Recherche de "${nom}"...\n`);

    // 1. Candidats catalogue : même logique que trouverProduitsLocaux (1er mot + filtre normalisé)
    const premierMot = nom.replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];
    const brut = await CatalogueProduit.find({ name: new RegExp(premierMot, 'i') }).lean();
    const cible = normaliser(nom);
    const candidats = brut.filter(p => p.name && normaliser(p.name.split('[')[0].trim()) === cible);

    if (candidats.length === 0) {
        console.log('Aucun produit catalogue pour ce nom (essaie le nom anglais, ou vérifie l\'orthographe).');
        await mongoose.disconnect();
        return;
    }

    // 2. Numéros/variantes appris pour ces produits
    const ids = candidats.map(c => c.idProduct);
    const numeros = await NumeroCarte.find({ idProduct: { $in: ids } }).lean();
    const parId = new Map(numeros.map(n => [n.idProduct, n]));

    // 3. Codes set (pour lire les sets à l'œil)
    const codes = {};
    for (const c of candidats) {
        if (!(c.idExpansion in codes)) {
            const cs = await CodeSet.findOne({ idExpansion: c.idExpansion }).lean();
            codes[c.idExpansion] = cs?.codeSet || '?';
        }
    }

    // 4. Affichage, trié par set
    candidats.sort((a, b) => (a.idExpansion || 0) - (b.idExpansion || 0));
    console.log(`${candidats.length} produit(s) catalogue :\n`);
    for (const c of candidats) {
        const n = parId.get(c.idProduct);
        const num = n ? (n.numero || n.numeroUrl || '?') : '— non appris';
        const varr = n?.variante ? `  variante ${n.variante} (${NOM_VARIANTE[n.variante] || '?'})` : '';
        const nomFr = n?.nomFr ? `  "${n.nomFr}"` : '';
        console.log(`  set ${codes[c.idExpansion]}  (exp ${c.idExpansion})  idProduct ${c.idProduct}  n°${num}${varr}${nomFr}`);
    }

    // 5. Résumé qui répond aux deux questions
    const appris = numeros.length;
    const avecVariante = numeros.filter(n => n.variante).length;
    const reverses = numeros.filter(n => n.variante === 'V2');
    console.log('\n--- Résumé ------------------------------------------');
    console.log(`Produits appris (numéro connu) : ${appris}/${candidats.length}`);
    console.log(`Dont avec variante V1/V2/V3    : ${avecVariante}`);
    if (reverses.length) {
        const sets = [...new Set(reverses.map(n => codes[n.idExpansion] || n.idExpansion))];
        console.log(`REVERSE (V2) = idProduct distinct : OUI, trouvée pour set(s) ${sets.join(', ')}`);
        console.log('  -> le correctif reverse vit dans le SCORING (choisir l\'idProduct V2).');
    } else {
        console.log('REVERSE (V2) = idProduct distinct : NON trouvée pour cette carte.');
        console.log('  -> soit ce set n\'a pas encore ses variantes (--maj), soit la reverse');
        console.log('     partage l\'idProduct de la normale et se gère au PRIX LIVE (isReverseHolo).');
    }
    console.log('-----------------------------------------------------\n');

    await mongoose.disconnect();
}

main().catch(async e => {
    console.error('❌ Erreur :', e.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});