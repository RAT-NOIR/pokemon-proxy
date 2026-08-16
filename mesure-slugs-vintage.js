// ============================================================================
// LES SLUGS DE GALERIE DES 24 SETS — VÉRIFIÉS, JAMAIS FABRIQUÉS
// ============================================================================
// ⚠️ POURQUOI CETTE VÉRIFICATION EXISTE. Une URL inventée fait charger une page pour rien
// sur un site qui a déjà banni ce compte deux fois. Le slug ne se devine donc pas : il se
// lit, et de DEUX sources indépendantes qu'on croise —
//   1. `slug` de sets-vintage-japonais.js (table close, relevée à la main)
//   2. `slugSet` de numeros_cartes, écrit par le userscript d'apprentissage depuis les
//      URL RÉELLES des galeries — c'est la source la plus forte : elle prouve que la page
//      a été ouverte et qu'elle a répondu.
// Quand les deux divergent, on affiche LES DEUX et on ne tranche pas. Quand aucune ne
// répond, on écrit « slug inconnu » — jamais une reconstruction.
//
// ⚠️ CE QUE CET OUTIL NE DIT PAS : combien de lignes d'échec chaque set clôt. Cette
// mesure-là reposait sur un rejeu du scoring dont la comparaison au journal a montré
// 24,8 % de divergence sur le gagnant (voir mesure-rejeu-contre-journal.js). Elle est
// retirée, et elle ne reviendra qu'avec les idProduct du groupe d'égalité journalisés au
// moment du scan. Un tableau d'ordre de collecte SANS ces colonnes n'est pas un plan
// d'exécution : c'est un inventaire.
//
// LECTURE SEULE. Aucun réseau, aucune écriture.
// USAGE : node mesure-slugs-vintage.js --base=<nom>
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const mongoose = require('mongoose');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

// ⚠️ ESTIMÉ, JAMAIS MESURÉ : je n'ai jamais chargé une galerie Cardmarket (elles refusent
// mes requêtes). Le diagnostic console compte les `a.galleryBox img` et tranchera.
const PAGES = (n, parPage) => Math.ceil(n / parPage);

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const NUM = c.collection('numeros_cartes');
    const CAT = c.collection('catalogue_produits');

    console.log('⚠️ COLONNE « pages » ESTIMÉE : encadrement 20 / 30 cartes par page.');
    console.log('   Aucune galerie n\'a jamais été chargée par moi. Le diagnostic console tranchera.\n');
    console.log('⚠️ COLONNES ABSENTES ET ASSUMÉES : « lignes closes », « cumul », « % », « ferme');
    console.log('   seul / complément ». Elles venaient d\'un rejeu du scoring divergent à 24,8 %');
    console.log('   du journal de production. Retirées jusqu\'à ce que le groupe d\'égalité soit');
    console.log('   journalisé au scan. Cet inventaire n\'est donc PAS un ordre de collecte.\n');

    console.log('═'.repeat(112));
    console.log(`${'code'.padEnd(8)} ${'produits'.padStart(8)} ${'p@20'.padStart(5)} ${'p@30'.padStart(5)}  ${'slug de galerie (VÉRIFIÉ)'.padEnd(34)} ${'source'.padEnd(14)} nom du set`);
    console.log('═'.repeat(112));

    let totalProd = 0, connus = 0, divergents = 0, inconnus = 0;
    const lignes = [];
    for (const s of SETS_VINTAGE_JAPONAIS) {
        // Source 2 : les slugs RÉELLEMENT vus par le userscript sur cette expansion.
        const vus = s.exp != null
            ? (await NUM.distinct('slugSet', { idExpansion: s.exp })).filter(Boolean)
            : [];
        // Contrôle de volume : le catalogue confirme-t-il le nombre de produits ?
        const nProd = s.exp != null ? await CAT.countDocuments({ idExpansion: s.exp }) : null;

        let slug, source;
        if (vus.length === 1 && vus[0] === s.slug) { slug = s.slug; source = 'table+journal'; connus++; }
        else if (vus.length === 1) { slug = `${vus[0]}  ⚠️(table dit « ${s.slug} »)`; source = 'DIVERGENT'; divergents++; }
        else if (vus.length > 1) { slug = vus.join(' | '); source = `${vus.length} slugs vus`; divergents++; }
        else if (s.slug) { slug = s.slug; source = 'table seule'; connus++; }
        else { slug = 'slug inconnu'; source = '—'; inconnus++; }

        totalProd += nProd ?? s.prod ?? 0;
        lignes.push({ s, nProd, slug, source });
        const ecartVolume = (nProd != null && s.prod != null && nProd !== s.prod) ? ` ⚠️ table dit ${s.prod}` : '';
        console.log(
            `${String(s.code).padEnd(8)} ${String(nProd ?? '?').padStart(8)} ${String(PAGES(nProd ?? s.prod ?? 0, 20)).padStart(5)} ` +
            `${String(PAGES(nProd ?? s.prod ?? 0, 30)).padStart(5)}  ${slug.slice(0, 34).padEnd(34)} ${source.padEnd(14)} ${s.nom}${ecartVolume}`
        );
    }

    console.log('═'.repeat(112));
    console.log(`${'TOTAL'.padEnd(8)} ${String(totalProd).padStart(8)} ${String(PAGES(totalProd, 20)).padStart(5)} ${String(PAGES(totalProd, 30)).padStart(5)}`);
    console.log(`\n   slugs concordants (table + journal) : ${connus}`);
    console.log(`   slugs DIVERGENTS ou multiples       : ${divergents}   <- à trancher à la main avant d'ouvrir quoi que ce soit`);
    console.log(`   slugs INCONNUS                      : ${inconnus}`);
    console.log(`\n   L'URL se compose : https://www.cardmarket.com/fr/Pokemon/Products/Singles/<slug>`);
    console.log('   ⚠️ Aucune URL n\'est construite ici : le slug est rendu tel qu\'il a été lu.');
    console.log('      Et n\'ajoute AUCUN paramètre (perSite) — c\'est ce qui a déclenché le ban.');
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
