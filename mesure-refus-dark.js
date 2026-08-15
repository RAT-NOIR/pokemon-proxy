// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Un instrument qui se trompe coûte plus cher qu'un bug : il envoie corriger là où il n'y
// a rien (septième principe, voir scoring.js). Deux règles tirées d'erreurs réelles :
//   1. NE RECONSTRUIS JAMAIS UNE CLÉ. `mesure-route-langue.js` fabriquait un identifiant
//      de carte en collant `setTcgdex` (qui est celui de l'EXPANSION, et qui vient de NOS
//      liens appris) au numéro lu. Il interrogeait des identifiants qui n'ont jamais
//      existé, et concluait faux. Ici on ne lit que des champs bruts du journal.
//   2. NE COMPARE QUE CE QUE LA PRODUCTION COMPARE. Les fonctions de décision sont
//      importées de pokedex.js et scoring.js, jamais réécrites.
// LECTURE SEULE : aucune écriture, aucune collection modifiée.
//
// ============================================================================
// CE QUE CET OUTIL MESURE : pourquoi « Dark Kadabra » #064 a-t-il été refusé ?
// ============================================================================
// USAGE : node mesure-refus-dark.js --base=<nom>
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const mongoose = require('mongoose');
const { numeroEstUnDexId, dexIdsDuNom } = require('./pokedex');

const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const J = c.collection('journal_scans');

    // ─────────────────────────────────────────────────────────────────────
    // 1. LA LIGNE DU REFUS, ET TOUTES LES LIGNES « DARK »
    // ─────────────────────────────────────────────────────────────────────
    const darks = await J.find({ route: 'identifier', nom: /dark/i }).sort({ le: 1 }).toArray();
    console.log('═'.repeat(78));
    console.log(`LES LIGNES « DARK » DU JOURNAL — ${darks.length}`);
    console.log('═'.repeat(78));
    for (const l of darks) {
        const avis = numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue });
        const ok = l.resultat === 'succes';
        console.log(
            `${String(l.le?.toISOString?.() ?? l.le).slice(0, 16)}  ${ok ? '✅' : '❌'} ` +
            `"${String(l.nom).padEnd(16)}" n°${String(l.numero ?? '—').padEnd(5)} total=${String(l.total ?? '—').padEnd(6)} ` +
            `code=${String(l.setCodeLu ?? l.setCode ?? '—').padEnd(6)} lg=${l.langue ?? '—'}`
        );
        console.log(
            `${' '.repeat(19)}   estDex=${avis.estDex}  (${avis.raison})`
        );
        console.log(
            `${' '.repeat(19)}   voie=${l.voieCatalogue ?? '—'}  produit=${l.idProduct ?? '—'}  ` +
            `setTcgdex=${l.setTcgdex ?? '—'}  identifieeEnLocal=${l.identifieeEnLocal ?? '—'}`
        );
        console.log(
            `${' '.repeat(19)}   motifEchec=${l.motifEchec ?? '—'}  raisonReserve=${l.raisonReserve ?? '—'}  ` +
            `reverseLu=${l.reverseLu ?? '—'}  motifIA=${l.motifIA ?? '—'}  nomBrut=${l.nomBrut ?? '—'}`
        );
        console.log('');
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. LA BORNE : QUI ABOUTIT, QUI ÉCHOUE, ET AVEC QUOI EN MAIN
    // ─────────────────────────────────────────────────────────────────────
    console.log('═'.repeat(78));
    console.log('CE QUI SÉPARE LES ABOUTIES DES REFUSÉES');
    console.log('═'.repeat(78));
    const abouties = darks.filter(l => l.resultat === 'succes');
    const refusees = darks.filter(l => l.resultat !== 'succes');
    for (const [titre, lot] of [['ABOUTIES', abouties], ['REFUSÉES', refusees]]) {
        const avecTotal = lot.filter(l => l.total != null && String(l.total).trim() !== '').length;
        const avecCode = lot.filter(l => l.setCodeLu || l.setCode).length;
        const dex = lot.filter(l => numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue }).estDex).length;
        console.log(`   ${titre} : ${lot.length}`);
        console.log(`      avec un TOTAL lu        : ${avecTotal}  (${pc(avecTotal, lot.length)})`);
        console.log(`      avec un setCode lu      : ${avecCode}  (${pc(avecCode, lot.length)})`);
        console.log(`      règle Pokédex DÉCLENCHÉE: ${dex}  (${pc(dex, lot.length)})`);
        // ⚠️ LIGNE RETIRÉE — « TCGdex a répondu : setTcgdex non nul ». C'ÉTAIT UN ARTEFACT,
        // et il donnait 100 % chez les abouties contre 0 % chez les refusées, ce qui avait
        // l'air d'une découverte. `setTcgdex` vient de `lienGagnant`, calculé APRÈS la
        // sortie de refus : il est nul sur TOUTE ligne d'échec, quelle qu'en soit la cause.
        // Le compteur mesurait « la ligne a-t-elle abouti », pas « TCGdex a-t-il répondu ».
        // LA PREUVE VALABLE EST AILLEURS, et elle vient du code : `carte-introuvable` n'est
        // émis QUE lorsque `trouvaille` est nulle (voir /api/identifier). Le motif d'échec
        // suffit donc, et il ne dépend d'aucun champ calculé trop tard.
        // Septième principe, deuxième récidive de la semaine sur le même schéma : un champ
        // lu hors du moment où il est rempli.
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. LA POPULATION ENTIÈRE : règle déclenchée -> que devient le scan ?
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(78));
    console.log('QUAND LA RÈGLE POKÉDEX SE DÉCLENCHE, QUE DEVIENT LE SCAN ?');
    console.log('═'.repeat(78));
    const toutes = await J.find({ route: 'identifier' }).toArray();
    const declenchees = toutes.filter(l => numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue }).estDex);
    const dOk = declenchees.filter(l => l.resultat === 'succes');
    const dKo = declenchees.filter(l => l.resultat !== 'succes');
    console.log(`   lignes du journal : ${toutes.length}   ·   règle déclenchée : ${declenchees.length}`);
    console.log(`      abouties : ${dOk.length}  (${pc(dOk.length, declenchees.length)})`);
    console.log(`      refusées : ${dKo.length}  (${pc(dKo.length, declenchees.length)})`);
    const parMotif = new Map();
    for (const l of dKo) parMotif.set(l.motifEchec ?? '—', (parMotif.get(l.motifEchec ?? '—') || 0) + 1);
    for (const [m, n] of [...parMotif].sort((a, b) => b[1] - a[1])) console.log(`         ${String(m).padEnd(28)} ${n}`);
    const parVoie = new Map();
    for (const l of dOk) parVoie.set(l.voieCatalogue ?? '—', (parVoie.get(l.voieCatalogue ?? '—') || 0) + 1);
    console.log(`      par quelle voie les abouties sont-elles passées ?`);
    for (const [v, n] of [...parVoie].sort((a, b) => b[1] - a[1])) console.log(`         ${String(v).padEnd(28)} ${n}`);

    // ─────────────────────────────────────────────────────────────────────
    // 4. LE TROU STRUCTUREL : règle déclenchée + TCGdex muet
    // ─────────────────────────────────────────────────────────────────────
    // identifierEnLocal EXIGE un numéro (voir sa 1re garde). La règle Pokédex vient
    // justement de le retirer. Cette combinaison n'a donc aucun chemin de repli.
    console.log('\n' + '═'.repeat(78));
    console.log('RÈGLE DÉCLENCHÉE **ET** TCGdex MUET — la combinaison sans repli');
    console.log('═'.repeat(78));
    const sansTcgdex = declenchees.filter(l => !l.setTcgdex);
    console.log(`   lignes concernées : ${sansTcgdex.length}`);
    for (const l of sansTcgdex) {
        console.log(`      ${String(l.le?.toISOString?.() ?? l.le).slice(0, 16)}  ${l.resultat === 'succes' ? '✅' : '❌'} ` +
            `"${l.nom}" n°${l.numero ?? '—'}  voie=${l.voieCatalogue ?? '—'}  motifEchec=${l.motifEchec ?? '—'}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. LE CATALOGUE : combien de produits « Dark », et la table les couvre-t-elle ?
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(78));
    console.log('COUVERTURE DE LA TABLE SUR LA FAMILLE « DARK » DU CATALOGUE');
    console.log('═'.repeat(78));
    const prods = await c.collection('catalogue_produits')
        .find({ name: /^Dark /i }, { projection: { name: 1, idProduct: 1 } }).toArray();
    const noms = [...new Set(prods.map(p => String(p.name).split('[')[0].trim()))];
    const connus = noms.filter(n => dexIdsDuNom(n));
    const inconnus = noms.filter(n => !dexIdsDuNom(n));
    console.log(`   produits « Dark … » au catalogue : ${prods.length}`);
    console.log(`   noms distincts                   : ${noms.length}`);
    console.log(`   connus de la table dex-ids       : ${connus.length}  (${pc(connus.length, noms.length)})`);
    console.log(`   INCONNUS de la table             : ${inconnus.length}  (${pc(inconnus.length, noms.length)})`);
    if (inconnus.length) console.log(`      ${inconnus.slice(0, 30).join(' · ')}`);

    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
