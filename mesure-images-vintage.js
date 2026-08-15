// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Septième principe (scoring.js) : un instrument qui se trompe coûte plus cher qu'un bug.
// Huit erreurs d'instrument sont recensées à ce jour, en deux familles :
//   - FABRIQUER UNE ENTRÉE que le système n'a jamais produite (clé positionnelle,
//     endpoint, identifiant reconstruit, champ lu hors de son moment) ;
//   - LIRE UNE ABSENCE COMME UNE VALEUR CONTRAIRE (`resultat !== 'succes'` sur un journal
//     où le champ n'existait pas encore).
// D'où les règles appliquées ICI :
//   1. ON N'INTERROGE QUE PAR IDENTIFIANT DE SET, jamais par recherche de nom. La
//      recherche par nom nous a induits en erreur trois fois.
//   2. ON NE SE FIE PAS À LA PRÉSENCE D'UN CHAMP `image` : on fait une requête HEAD et on
//      exige un 200 avec un content-type d'image. Un champ n'est pas un octet servi.
//   3. L'APPARIEMENT EST MONTRÉ, PAS AFFIRMÉ. Chaque ligne dit sur quelle PREUVE le set
//      japonais a été apparié, et les cas ambigus sont listés SANS être tranchés.
//
// ⚠️ CE QU'ON N'UTILISE SURTOUT PAS : le champ `setTcgdex` de numeros_cartes. Mesuré le
// 2026-08-15 — nos liens appris pour ces 24 sets pointent vers les JUMEAUX OCCIDENTAUX
// (Pokémon Jungle JP -> `base2`, qui rend 404 en /v2/ja et « Jungle » en /v2/en), et deux
// de nos sets partagent le même identifiant (`ecard3` pour EC4 ET EC5). S'en servir pour
// énumérer des cartes japonaises mesurerait le catalogue anglais.
//
// LECTURE SEULE : aucune écriture, aucune base touchée (cet outil n'ouvre même pas Mongo).
//
// ============================================================================
// CE QUE CET OUTIL MESURE : la reconnaissance par l'illustration est-elle possible ?
// ============================================================================
// Pour chacun des 24 sets de la table close vintage japonaise : combien de cartes TCGdex
// possède-t-il, et combien ont une image RÉELLEMENT SERVIE.
// USAGE : node mesure-images-vintage.js  [--tout]
//   --tout : mesure aussi les sets japonais NON appariés à la table close.
const axios = require('axios');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

const TOUT = process.argv.includes('--tout');
const CONCURRENCE = 12;
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

async function jsonTCGdex(chemin) {
    try { return (await axios.get(`https://api.tcgdex.net/v2/${chemin}`, { timeout: 25000 })).data; }
    catch (e) { return null; }
}

// UNE IMAGE EXISTE QUAND UN OCTET EST SERVI, pas quand un champ est présent.
// TCGdex sert ses assets sous `{image}/{qualite}.{extension}` : on essaie les formes
// documentées dans l'ordre, et la PREMIÈRE qui rend 200 suffit.
const FORMES = ['/high.png', '/low.png', '/high.webp', '/low.webp'];
async function imageServie(base) {
    if (!base) return { ok: false, forme: null, raison: 'aucun champ image' };
    for (const forme of FORMES) {
        try {
            const r = await axios.head(`${base}${forme}`, { timeout: 12000 });
            const ct = String(r.headers['content-type'] || '');
            if (r.status === 200 && ct.startsWith('image/')) return { ok: true, forme, ct };
        } catch (_) { /* forme suivante */ }
    }
    return { ok: false, forme: null, raison: 'aucune forme ne rend 200' };
}

// Petit ordonnanceur : `CONCURRENCE` requêtes en vol, pas plus. Sans lui, un set de 157
// cartes ouvre 157 connexions d'un coup et TCGdex répond 429 — ce qui produirait des
// « images absentes » qui sont en réalité notre propre impatience.
async function enParallele(items, n, travail) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (true) {
            const k = i++;
            if (k >= items.length) return;
            out[k] = await travail(items[k], k);
        }
    }));
    return out;
}

(async () => {
    const setsJa = await jsonTCGdex('ja/sets');
    if (!Array.isArray(setsJa)) { console.error('❌ /v2/ja/sets injoignable.'); process.exit(1); }
    console.log(`espace des sets JAPONAIS chez TCGdex : ${setsJa.length} sets\n`);

    // ─── APPARIEMENT, MONTRÉ ET NON AFFIRMÉ ──────────────────────────────
    // La seule clé numérique disponible des deux côtés est le NOMBRE DE CARTES. Notre
    // table porte `prod` (produits Cardmarket de l'expansion), TCGdex porte
    // `cardCount.total` / `.official`. Ce ne sont pas la même grandeur — d'où l'affichage
    // des candidats plutôt qu'un choix silencieux.
    const nb = s => [s.cardCount?.total, s.cardCount?.official].filter(x => Number.isFinite(x));
    const apparies = [], ambigus = [], sansCandidat = [];
    for (const notre of SETS_VINTAGE_JAPONAIS) {
        const cands = setsJa.filter(s => nb(s).includes(notre.prod));
        if (cands.length === 1) apparies.push({ notre, ja: cands[0], preuve: `cardCount == prod (${notre.prod})` });
        else if (cands.length > 1) ambigus.push({ notre, cands });
        else sansCandidat.push(notre);
    }
    // ⚠️ L'AMBIGUÏTÉ SE LIT DANS LES DEUX SENS, ET LA PREMIÈRE VERSION N'EN VOYAIT QU'UN.
    // Elle demandait « combien de sets japonais ont ce nombre de cartes ? » et déclarait
    // « sans ambiguïté » dès qu'il n'y en avait qu'un. Elle ne demandait jamais « combien
    // de NOS sets tombent sur le MÊME set japonais ? » — d'où deux lignes fausses dans le
    // premier tableau : ROG et DP5c appariés tous les deux à PMCG4 (65 cartes chacun), et
    // MCDP (24) apparié à SMP2 « 名探偵ピカチュウ » (Detective Pikachu), qui n'a rien à voir.
    // Une bijection ne se vérifie pas d'un seul côté.
    const parJa = new Map();
    for (const a of apparies) parJa.set(a.ja.id, [...(parJa.get(a.ja.id) || []), a]);
    const collisions = [...parJa.values()].filter(v => v.length > 1);
    const retenus = apparies.filter(a => (parJa.get(a.ja.id) || []).length === 1);
    for (const groupe of collisions) ambigus.push({ notre: groupe[0].notre, cands: [groupe[0].ja], collision: groupe.map(g => g.notre.code) });

    console.log('═'.repeat(96));
    console.log(`APPARIEMENT DES ${SETS_VINTAGE_JAPONAIS.length} SETS DE LA TABLE CLOSE`);
    console.log('═'.repeat(96));
    console.log(`   appariés en BIJECTION (un seul candidat, et personne d'autre dessus) : ${retenus.length}`);
    console.log(`   AMBIGUS : ${ambigus.length}`);
    for (const a of ambigus) {
        console.log(`      ${String(a.notre.code).padEnd(8)} prod=${String(a.notre.prod).padEnd(4)} "${a.notre.nom}" -> ${a.cands.map(c => `${c.id}(${c.name})`).join(' | ')}` +
            (a.collision ? `   ⚠️ COLLISION : ${a.collision.join(' et ')} visent le même set japonais` : ''));
    }
    console.log(`   SANS CANDIDAT : ${sansCandidat.length}`);
    for (const s of sansCandidat) console.log(`      ${String(s.code).padEnd(8)} prod=${String(s.prod).padEnd(4)} "${s.nom}"`);
    console.log('   ⚠️ Les ambigus et les sans-candidat NE SONT PAS MESURÉS ci-dessous : les');
    console.log('      trancher demanderait un appariement par le nom, et c\'est exactement');
    console.log('      ce que cette mesure s\'interdit.');

    // ─── LA MESURE D'IMAGES ──────────────────────────────────────────────
    const aMesurer = TOUT
        ? setsJa.map(s => ({ notre: null, ja: s, preuve: '--tout' }))
        : retenus;

    console.log('\n' + '═'.repeat(96));
    console.log('COUVERTURE D\'IMAGES, SET PAR SET (HEAD sur l\'asset, pas la présence du champ)');
    console.log('═'.repeat(96));
    console.log(`${'code'.padEnd(8)} ${'set TCGdex'.padEnd(12)} ${'cartes'.padStart(6)} ${'champ img'.padStart(10)} ${'SERVIES'.padStart(8)} ${'couverture'.padStart(11)}   nom`);
    console.log('─'.repeat(96));

    let totalCartes = 0, totalChamp = 0, totalServies = 0;
    const lignes = [];
    for (const { notre, ja, preuve } of aMesurer) {
        const detail = await jsonTCGdex(`ja/sets/${encodeURIComponent(ja.id)}`);
        const cartes = Array.isArray(detail?.cards) ? detail.cards : [];
        const avecChamp = cartes.filter(k => k.image);
        const res = await enParallele(avecChamp, CONCURRENCE, k => imageServie(k.image));
        const servies = res.filter(r => r.ok).length;
        totalCartes += cartes.length; totalChamp += avecChamp.length; totalServies += servies;
        lignes.push({ notre, ja, cartes: cartes.length, champ: avecChamp.length, servies, preuve });
        console.log(
            `${String(notre?.code ?? '—').padEnd(8)} ${String(ja.id).padEnd(12)} ${String(cartes.length).padStart(6)} ` +
            `${String(avecChamp.length).padStart(10)} ${String(servies).padStart(8)} ${pc(servies, cartes.length).padStart(11)}   ${ja.name}`
        );
    }

    console.log('─'.repeat(96));
    console.log(`${'TOTAL'.padEnd(21)} ${String(totalCartes).padStart(6)} ${String(totalChamp).padStart(10)} ${String(totalServies).padStart(8)} ${pc(totalServies, totalCartes).padStart(11)}`);

    console.log('\n' + '═'.repeat(96));
    console.log('CE QUE ÇA DIT DU CHANTIER « RECONNAISSANCE PAR L\'ILLUSTRATION »');
    console.log('═'.repeat(96));
    console.log(`   sets mesurés            : ${lignes.length} / ${SETS_VINTAGE_JAPONAIS.length} de la table close`);
    console.log(`   cartes couvertes        : ${totalServies} / ${totalCartes}  (${pc(totalServies, totalCartes)})`);
    const vides = lignes.filter(l => l.servies === 0);
    const partiels = lignes.filter(l => l.servies > 0 && l.servies < l.cartes);
    console.log(`   sets SANS AUCUNE image  : ${vides.length}${vides.length ? ' -> ' + vides.map(l => l.notre?.code ?? l.ja.id).join(', ') : ''}`);
    console.log(`   sets PARTIELS           : ${partiels.length}${partiels.length ? ' -> ' + partiels.map(l => `${l.notre?.code ?? l.ja.id} (${l.servies}/${l.cartes})`).join(', ') : ''}`);
    console.log('\n   ⚠️ CE CHIFFRE NE COUVRE QUE LES SETS APPARIÉS SANS AMBIGUÏTÉ. Les autres ne');
    console.log('      sont pas « sans images » : ils sont NON MESURÉS. Ne pas les compter comme');
    console.log('      des zéros — ce serait relire une absence comme une valeur contraire, la');
    console.log('      huitième erreur d\'instrument de la semaine.');
})().catch(e => { console.error(e.stack); process.exit(1); });
