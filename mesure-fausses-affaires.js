// ============================================================================
// LES ERREURS D'IDENTIFICATION SONT-ELLES DÉJÀ COUVERTES PAR UNE RÉSERVE ?
// ============================================================================
// USAGE : node mesure-fausses-affaires.js --base=<nom>
//
// L'HYPOTHÈSE À TESTER, POSÉE PAR L'AGENT DE L'EXTENSION : les fausses bonnes affaires
// dues à une erreur d'identification s'accompagnent-elles DÉJÀ d'une réserve ?
//   - Si OUI, supprimer le verdict sous réserve les couvre, et un plafond de ratio côté
//     extension serait inutile — pire, il coûterait de vraies trouvailles, puisque les
//     deux distributions se recouvrent précisément là où vivent les pépites.
//   - Si NON, il existe des erreurs affirmées que seul le ratio peut attraper.
//
// CE QUI REND LA MESURE POSSIBLE AUJOURD'HUI, sans aucune donnée nouvelle : on n'a pas
// besoin du prix Vinted. Une erreur d'identification se constate sur les VÉRITÉS SAISIES
// (produit retenu ≠ produit vrai), et la réserve est déjà au journal.
//
// LA DIRECTION DU PRIX, elle, se déduit des deux prix GUIDE :
//   guide(retenu) > guide(vrai)  -> on affiche PLUS CHER que la réalité, l'annonce paraît
//                                   une bonne affaire -> FAUSSE BONNE AFFAIRE (fait acheter)
//   guide(retenu) < guide(vrai)  -> on affiche MOINS CHER, l'annonce paraît surcotée
//                                   -> FAUSSE SURCOTE (fait rater, cas du Rayquaza)
// ⚠️ Ce sont des prix GUIDE, pas des planchers live : la direction est fiable, l'amplitude
// ne l'est pas. On ne tire donc AUCUN seuil d'ici — seulement la couverture par réserve.
require('dotenv').config();
const mongoose = require('mongoose');
const SEAUX = require('./banc-seaux');
const { prixDeReference } = require('./scoring');

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const lignes = await c.collection('journal_scans').find({ route: 'identifier' }).sort({ le: 1 }).toArray();
    const verites = require('./banc-verites.json').verites;
    const { lignes: numerotees } = SEAUX.numeroter(lignes);
    const { parIdentite } = SEAUX.rattacherVerites(numerotees, verites);

    const avecVerite = numerotees
        .map(l => ({ ...l.d, seau: l.seau, cle: l.cle, verite: parIdentite.get(SEAUX.identiteDe(l.d)) }))
        .filter(l => l.verite && l.verite.idProduct != null && l.idProduct != null);

    console.log(`base : ${BASE}   ·   lignes abouties AVEC vérité : ${avecVerite.length}\n`);

    const justes = avecVerite.filter(l => l.idProduct === l.verite.idProduct);
    const fausses = avecVerite.filter(l => l.idProduct !== l.verite.idProduct);
    console.log(`   identifications JUSTES : ${justes.length}`);
    console.log(`   identifications FAUSSES: ${fausses.length}\n`);

    // Les prix guide des deux produits, pour la direction.
    const ids = [...new Set(fausses.flatMap(l => [l.idProduct, l.verite.idProduct]))];
    const guides = new Map((await c.collection('guide_prix').find({ idProduct: { $in: ids } }).toArray())
        .map(g => [g.idProduct, prixDeReference(g, false)]));

    console.log('═'.repeat(76));
    console.log('LES ERREURS D\'IDENTIFICATION PORTENT-ELLES UNE RÉSERVE ?');
    console.log('═'.repeat(76));
    const avecReserve = fausses.filter(l => l.carteIncertaine === true);
    const sansReserve = fausses.filter(l => l.carteIncertaine !== true);
    console.log(`   fausses AVEC réserve  : ${avecReserve.length}  (${pc(avecReserve.length, fausses.length)})`);
    console.log(`   fausses SANS réserve  : ${sansReserve.length}  (${pc(sansReserve.length, fausses.length)})   <- les faux-ET-AFFIRMÉS`);

    const classer = l => {
        const gr = guides.get(l.idProduct), gv = guides.get(l.verite.idProduct);
        if (!Number.isFinite(gr) || !Number.isFinite(gv)) return { sens: 'prix inconnu', gr, gv, rapport: null };
        if (gr > gv) return { sens: 'FAUSSE BONNE AFFAIRE', gr, gv, rapport: gr / gv };
        if (gr < gv) return { sens: 'fausse surcote', gr, gv, rapport: gv / gr };
        return { sens: 'même prix', gr, gv, rapport: 1 };
    };

    for (const [titre, lot] of [['SANS RÉSERVE (affirmées)', sansReserve], ['AVEC réserve', avecReserve]]) {
        if (!lot.length) continue;
        console.log(`\n── ${titre} — ${lot.length} ligne(s) ──`);
        const parSens = new Map();
        for (const l of lot) {
            const k = classer(l);
            parSens.set(k.sens, (parSens.get(k.sens) || 0) + 1);
            console.log(`   ${l.cle} "${String(l.nom).padEnd(18)}" retenu ${l.idProduct} (${k.gr ?? '?'} €)  vrai ${l.verite.idProduct} (${k.gv ?? '?'} €)`);
            console.log(`        ${k.sens}${k.rapport ? ` ×${k.rapport.toFixed(1)}` : ''} · raison=${l.raisonReserve ?? '—'} · niveau=${l.niveauReserve ?? '—'}`);
        }
        console.log(`   -> ${[...parSens].map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
    }

    console.log('\n' + '═'.repeat(76));
    console.log('CE QUE ÇA DIT DU PLAFOND DE RATIO');
    console.log('═'.repeat(76));
    const bonnesAffairesAffirmees = sansReserve.filter(l => classer(l).sens === 'FAUSSE BONNE AFFAIRE');
    console.log(`   fausses BONNES AFFAIRES sorties SANS réserve : ${bonnesAffairesAffirmees.length}`);
    if (!bonnesAffairesAffirmees.length) {
        console.log('   -> sur cet échantillon, AUCUNE fausse bonne affaire n\'échappe à la réserve.');
        console.log('      La suppression du verdict sous réserve les couvrirait toutes, et un plafond');
        console.log('      de ratio n\'attraperait rien de plus — il ne ferait que coûter des trouvailles.');
    } else {
        console.log('   -> il existe des fausses bonnes affaires AFFIRMÉES : la réserve seule ne suffit pas.');
    }
    console.log(`\n   ⚠️ échantillon : ${fausses.length} erreur(s) sur ${avecVerite.length} lignes avec vérité.`);
    console.log('      Un « zéro » sur un échantillon de cette taille borne mal : il dit que le cas est');
    console.log('      RARE, pas qu\'il est impossible. Le Rayquaza en est la preuve vivante.');
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
