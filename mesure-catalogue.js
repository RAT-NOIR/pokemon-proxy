// ============================================================
// LES TROIS NOMBRES DU CHANTIER — fiches, visuels, écart
// ============================================================
//   node mesure-catalogue.js [--par-set] [--tout]
//
// L'unité de mesure du catalogue d'images : sur les produits Cardmarket, combien ont une FICHE
// (une carte leur est jointe) et combien ont un VISUEL (la carte porte une image DE CE SET).
//
// 🔑 LE DÉNOMINATEUR EST 69 134, PAS 69 598. Cardmarket vend en « singles » des **Online Code Card**
// et **Live Code Card** : un carton qui porte un code pour le jeu en ligne. Ni numéro, ni
// illustration, ni page Bulbapedia — ni fiche ni visuel POSSIBLES. Les compter, c'est inscrire au
// dénominateur un trou qui ne se comblera jamais et faire mentir tous les taux.
// ÉNUMÉRÉ, pas deviné (2026-09-19) : 464 produits, 22 expansions ; et tous les autres libellés
// suspects ont été ouverts un par un — « Capsule Énergie Booster », « Pack d'Eau Fraîches »,
// « Collectionneur de Pokémon », « Némélios (Theme Deck) » sont de VRAIES cartes.
// `--tout` rend la mesure sur les 69 598 bruts, pour comparer avec les rapports d'avant.
//
// ⚠️ La file d'images ÉCRIT pendant la mesure si elle tourne : l'outil le dit lui-même, parce qu'une
// mesure prise sur une base qui bouge est un instantané, pas un dénominateur (CLAUDE.md §25).

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));

(async () => {
    const tout = process.argv.includes('--tout');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    const produits = await prod.db.collection('numeros_cartes')
        .find({}, { projection: { idProduct: 1, slugSet: 1, nom: 1, nomFr: 1, nomEn: 1, slug: 1 } }).toArray();
    const libelle = p => p.nom || p.nomFr || p.nomEn || p.slug || '';
    const cartons = produits.filter(p => estCarteCode(libelle(p)));
    const retenus = tout ? produits : produits.filter(p => !estCarteCode(libelle(p)));
    const slugParProduit = new Map(retenus.map(p => [p.idProduct, p.slugSet]));
    const total = slugParProduit.size;

    const liens = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1 } }).toArray();
    const avecImages = await cx.db.collection('cartes').find({ 'images.0': { $exists: true } }, { projection: { images: 1 } }).toArray();
    const setsParCarte = new Map(avecImages.map(c => [c._id, new Set((c.images || []).map(i => i.set))]));

    const fiches = new Set(), visuels = new Set();
    const parSet = new Map();
    const de = s => parSet.get(s) || (parSet.set(s, { produits: 0, fiches: 0, visuels: 0 }), parSet.get(s));
    for (const [, s] of slugParProduit) de(s || '(sans slugSet)').produits++;
    for (const l of liens) {
        if (!slugParProduit.has(l.idProduct)) continue;          // carte-code, ou produit hors catalogue
        const s = slugParProduit.get(l.idProduct) || l.slugSet;
        if (!fiches.has(l.idProduct)) { fiches.add(l.idProduct); de(s || '(sans slugSet)').fiches++; }
        if (visuels.has(l.idProduct)) continue;
        const sets = setsParCarte.get(l.carteId);
        if (sets && (sets.has(l.slugSet) || sets.has(s))) { visuels.add(l.idProduct); de(s || '(sans slugSet)').visuels++; }
    }
    const pc = n => `${n} = ${(n / total * 100).toFixed(1)} %`;
    console.log(`\n════ DÉNOMINATEUR : ${total} produits Cardmarket${tout ? ' (BRUT, cartes-code comprises)' : ` (${produits.length} lignes − ${cartons.length} cartes-code)`} ════`);
    console.log(`   FICHES  : ${pc(fiches.size)}`);
    console.log(`   VISUELS : ${pc(visuels.size)}`);
    console.log(`   ÉCART   : ${total - visuels.size} sans visuel, dont ${fiches.size - visuels.size} qui ont une fiche`);

    const enCours = await cx.db.collection('file_images').countDocuments({ etat: 'en-cours' });
    const attente = await cx.db.collection('file_images').countDocuments({ etat: 'attente' });
    console.log(`   file d'images : ${enCours} en cours · ${attente} en attente — ${enCours ? '🔴 LA FILE ÉCRIT : instantané, pas dénominateur' : 'à l\'arrêt'}`);

    // ════ LE FILET QUI MANQUAIT — un contrôle TRANSVERSAL, après coup ════
    // 🔑 Un produit Cardmarket est UNE carte. Cette propriété est vraie de la BASE ENTIÈRE, jamais
    // d'une exécution : chaque collecte prend son produit de son côté, seule et sans ambiguïté locale,
    // et toutes nos gardes d'unicité sont à l'intérieur d'un appel. Une ambiguïté répartie sur
    // plusieurs exécutions ne se voit pas d'une exécution — il faut donc la chercher APRÈS, sur le
    // tout. 1 993 lignes fausses ont vécu des semaines parce que personne ne posait cette question.
    // Elle est désormais posée à CHAQUE mesure, et elle coûte une agrégation.
    const multi = await cx.db.collection('cartes_produits').aggregate([
        { $group: { _id: '$idProduct', cartes: { $addToSet: '$carteId' } } },
        { $match: { 'cartes.1': { $exists: true } } }, { $count: 'n' }
    ]).toArray();
    const n = multi[0]?.n || 0;
    console.log(`   ⚖️ contrôle transversal : ${n} produit(s) rattaché(s) à PLUSIEURS cartes ${n ? '— 🔴 autant de fiches qui montrent un lien, un illustrateur ou un visuel d\'une autre carte (node detacher-jointures-fausses.js)' : '✅'}`);

    if (process.argv.includes('--par-set')) {
        console.log(`\n   les 30 sets au plus gros écart (fiche sans visuel) :`);
        for (const [s, c] of [...parSet].sort((a, b) => (b[1].fiches - b[1].visuels) - (a[1].fiches - a[1].visuels)).slice(0, 30))
            console.log(`      ${String(c.fiches - c.visuels).padStart(5)} · ${s.padEnd(40)} ${c.produits} produits · ${c.fiches} fiches · ${c.visuels} visuels`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
