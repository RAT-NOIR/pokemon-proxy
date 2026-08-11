// ============================================================================
// TROIS MESURES, EN LECTURE SEULE, SUR LES FONCTIONS RÉELLES DE PRODUCTION
// ============================================================================
// USAGE : node mesure-lotb-et-vivier.js --base=<nom>
//
//   1. LE LOT B — si le critère `numero` du scoring devient neutre sur les cartes à
//      numéro de Pokédex, combien de lignes changent de gagnant, et parmi celles-là
//      combien vont vers la BONNE carte ?
//   2. LE VIVIER — le banc cherche avec le nom LU, la production avec le `nomExact`
//      rendu par TCGdex. Sur combien de lignes les deux viviers diffèrent, et quand ils
//      diffèrent, lequel contient la vérité ?
//   3. LA PORTÉE DU DÉCALAGE — sur combien des cartes du lot de diagnostic le banc a-t-il
//      mesuré un comportement que la production n'a jamais eu ?
//
// ⚠️ AUCUNE ÉCRITURE. Aucun appel à Cardmarket. TCGdex est appelé, comme en production.
// ⚠️ AUCUNE VALEUR INVENTÉE : tout vient du journal, de banc-verites.json et du catalogue.
// ⚠️ ON APPELLE LES FONCTIONS EXPORTÉES PAR index.js, jamais une réimplémentation — c'est
//    la leçon du « la simulation dit 12, la production dit 0 ».
require('dotenv').config();

// ⚠️ LA BASE EST NOMMÉE AVANT LE require('./index'). index.js ouvre SA PROPRE connexion
// au chargement, en lisant MONGODB_BASE ; ses fonctions exportées lisent ensuite par
// cette connexion-là. La poser après le require nous ferait mesurer une autre base que
// celle qu'on a nommée, sans que rien ne le dise.
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) {
    console.error('❌ --base=<nom> obligatoire. La base de production s\'appelle « test ».');
    process.exit(1);
}
process.env.MONGODB_BASE = BASE;

const mongoose = require('mongoose');
const { numeroEstUnDexId } = require('./pokedex');
const { EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, trouverCarteTCGdex, scorerCandidatsLocal, lireCodeSets } = require('./index');
const SEAUX = require('./banc-seaux');

const LANGUES_ASIATIQUES = ['JP', 'ZH', 'KR'];
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

(async () => {
    // On attend la connexion ouverte par index.js plutôt que d'en ouvrir une seconde :
    // deux connexions, ce serait deux sources pour la même lecture.
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) {
        await new Promise(r => setTimeout(r, 500));
    }
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    const reelle = mongoose.connection.db.databaseName;
    if (reelle !== BASE) {
        console.error(`❌ ARRÊT : connecté à « ${reelle} » alors que --base=${BASE}.`);
        process.exit(1);
    }
    // `connection.db.collection` et non `connection.collection` : le second rend un
    // wrapper mongoose dont le curseur n'a pas `.sort()`.
    const lignes = await mongoose.connection.db.collection('journal_scans')
        .find({ route: 'identifier' }).sort({ le: 1 }).toArray();

    // LA SOURCE UNIQUE d'attribution des seaux et des vérités. Pas de copie locale.
    const verites = require('./banc-verites.json').verites;
    const { lignes: numerotees, horsService } = SEAUX.numeroter(lignes);
    const { parIdentite, desaccords, orphelines } = SEAUX.rattacherVerites(numerotees, verites);

    // Les lignes QUI ONT une vérité, dans la forme dont le reste du script a besoin.
    const attachees = numerotees
        .map(l => ({ ...l.d, seau: l.seau, cle: l.cle, verite: parIdentite.get(SEAUX.identiteDe(l.d)) }))
        .filter(l => l.verite && l.verite.idProduct != null);

    console.log(`base : ${BASE}`);
    console.log(`lignes /api/identifier : ${lignes.length}  ·  hors service : ${horsService.length}  ·  numérotées : ${numerotees.length}`);
    console.log(`vérités rattachées : ${attachees.length} · désaccords : ${desaccords.length} · orphelines : ${orphelines.length}\n`);

    // ────────────────────────────────────────────────────────────────────────
    const M1 = { eligibles: 0, horsPortee: [], identique: 0, change: [], erreurs: [] };
    const M2 = { comparables: 0, memeVivier: 0, different: [], erreurs: [] };
    const M3 = { lot: 0, estDex: 0, estDexEtScoring: 0 };

    for (const l of attachees) {
        const verite = l.verite;                      // { idProduct, ... }
        const avis = numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue });
        const numeroCarte = avis.estDex ? null : l.numero;
        // Le cardInfo tel que la route le reconstitue. `motif`/`reverse` ne sont pas
        // journalisés : on les laisse absents, comme le banc.
        const cardInfo = {
            name: l.nom, number: l.numero, total: l.total, setCode: l.setCode,
            language: l.langue, rarete: l.rarete, rareteElevee: false, nomBrut: l.nomBrut
        };

        if (l.seau === 'lot') M3.lot++;
        if (l.seau === 'lot' && avis.estDex) M3.estDex++;

        // ── LE VIVIER, DES DEUX FAÇONS ──────────────────────────────────────
        let nomExact = null, vivierProd = [], vivierBanc = [];
        try {
            const t = await trouverCarteTCGdex(l.nom, numeroCarte, l.setCode, null, l.langue, l.total, l.nomBrut);
            nomExact = t ? t.nomExact : null;
            vivierBanc = await trouverProduitsLocaux(l.nom);
            vivierProd = nomExact ? await trouverProduitsLocaux(nomExact) : [];
        } catch (e) {
            M2.erreurs.push({ l, e: e.message });
            continue;
        }

        // Le périmètre vintage s'applique aux DEUX de la même façon : c'est la
        // construction du vivier qu'on compare, pas ce qui vient après.
        const filtrer = v => {
            if (!(numeroCarte == null && LANGUES_ASIATIQUES.includes(String(l.langue || '').toUpperCase()) && v.length > 1)) return v;
            const dedans = v.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
            return dedans.length ? dedans : v;
        };
        const vProd = filtrer(vivierProd), vBanc = filtrer(vivierBanc);
        const idsP = new Set(vProd.map(p => p.idProduct));
        const idsB = new Set(vBanc.map(p => p.idProduct));
        const memes = idsP.size === idsB.size && [...idsP].every(x => idsB.has(x));

        M2.comparables++;
        if (memes) M2.memeVivier++;
        else {
            M2.different.push({
                nom: l.nom, numero: l.numero, nomExact, seau: l.seau, cle: l.cle,
                nProd: vProd.length, nBanc: vBanc.length,
                veriteDansProd: idsP.has(verite.idProduct),
                veriteDansBanc: idsB.has(verite.idProduct),
                verite: verite.idProduct, veriteNom: verite.nom
            });
        }

        // ── LE LOT B, SUR LE VIVIER DE PRODUCTION ───────────────────────────
        // On ne mesure QUE là où la production a réellement construit son vivier ainsi.
        const voieOk = l.voieCatalogue === 'nom' || l.voieCatalogue === 'perimetre-vintage';
        if (!avis.estDex) continue;
        if (l.seau === 'lot') M3.estDexEtScoring += (voieOk && vProd.length > 1) ? 1 : 0;
        if (!voieOk || vProd.length <= 1) {
            M1.horsPortee.push({ nom: l.nom, voie: l.voieCatalogue, n: vProd.length });
            continue;
        }
        M1.eligibles++;
        try {
            const cs = await lireCodeSets(vProd.map(p => p.idExpansion));
            const cardInfoEffectif = { ...cardInfo, number: numeroCarte };
            // AUJOURD'HUI : le critère garde le numéro brut (numeroBrutPourScoring).
            const av = await scorerCandidatsLocal(vProd, cardInfoEffectif, null, [], cs, { numeroBrutPourScoring: l.numero });
            // LOT B : l'option disparaît, le critère reçoit le numéro effectif (null).
            const ap = await scorerCandidatsLocal(vProd, cardInfoEffectif, null, [], cs, {});
            const gAv = av.scores[0]?.candidat?.idProduct ?? null;
            const gAp = ap.scores[0]?.candidat?.idProduct ?? null;
            if (gAv === gAp) M1.identique++;
            else M1.change.push({
                nom: l.nom, numero: l.numero, seau: l.seau, cle: l.cle, n: vProd.length,
                avant: gAv, apres: gAp, verite: verite.idProduct, veriteNom: verite.nom,
                avantJuste: gAv === verite.idProduct, apresJuste: gAp === verite.idProduct
            });
        } catch (e) { M1.erreurs.push({ nom: l.nom, e: e.message }); }
    }

    // ════════════════════════════════════════════════════════════════════════
    console.log('═'.repeat(78));
    console.log('MESURE 1 — LE LOT B : neutraliser le critère `numero` du scoring');
    console.log('═'.repeat(78));
    console.log(`  lignes à numéro de Pokédex, avec vérité, sur un vivier scorable : ${M1.eligibles}`);
    console.log(`  hors portée (vivier d'une autre voie, ou candidat unique)      : ${M1.horsPortee.length}`);
    console.log(`  erreurs de rejeu                                                : ${M1.erreurs.length}`);
    console.log(`\n  GAGNANT INCHANGÉ : ${M1.identique}   (${pc(M1.identique, M1.eligibles)})`);
    console.log(`  GAGNANT CHANGÉ   : ${M1.change.length}   (${pc(M1.change.length, M1.eligibles)})`);
    if (M1.change.length) {
        const gain = M1.change.filter(c => !c.avantJuste && c.apresJuste).length;
        const perte = M1.change.filter(c => c.avantJuste && !c.apresJuste).length;
        const neutre = M1.change.length - gain - perte;
        console.log(`\n     ✅ GAIN   (faux -> juste) : ${gain}`);
        console.log(`     ❌ PERTE  (juste -> faux) : ${perte}`);
        console.log(`     ⃝  NEUTRE (faux -> faux)  : ${neutre}`);
        console.log(`\n     >>> LE LOT B EST ${gain > perte ? 'UN GAIN' : gain < perte ? 'UNE PERTE' : 'NEUTRE'} sur cet échantillon.\n`);
        for (const c of M1.change) {
            console.log(`   ${c.cle} "${c.nom}" #${c.numero} (${c.n} candidats, seau ${c.seau})`);
            console.log(`      ${c.avant} ${c.avantJuste ? '✅' : '❌'}  ->  ${c.apres} ${c.apresJuste ? '✅' : '❌'}   vérité ${c.verite} "${c.veriteNom}"`);
        }
    }
    if (M1.erreurs.length) for (const e of M1.erreurs) console.log(`   ⚠️ ${e.nom} : ${e.e}`);

    console.log('\n' + '═'.repeat(78));
    console.log('MESURE 2 — LE VIVIER : nom LU (banc) contre nomExact TCGdex (production)');
    console.log('═'.repeat(78));
    console.log(`  lignes comparables : ${M2.comparables}   ·   erreurs : ${M2.erreurs.length}`);
    console.log(`  MÊME vivier        : ${M2.memeVivier}   (${pc(M2.memeVivier, M2.comparables)})`);
    console.log(`  viviers DIFFÉRENTS : ${M2.different.length}   (${pc(M2.different.length, M2.comparables)})`);
    if (M2.different.length) {
        const pSeul = M2.different.filter(d => d.veriteDansProd && !d.veriteDansBanc).length;
        const bSeul = M2.different.filter(d => !d.veriteDansProd && d.veriteDansBanc).length;
        const deux = M2.different.filter(d => d.veriteDansProd && d.veriteDansBanc).length;
        const aucun = M2.different.filter(d => !d.veriteDansProd && !d.veriteDansBanc).length;
        console.log(`\n  QUAND ILS DIFFÈRENT, QUI CONTIENT LA VÉRITÉ :`);
        console.log(`     les DEUX                    : ${deux}`);
        console.log(`     la PRODUCTION seule (nomExact) : ${pSeul}`);
        console.log(`     le BANC seul (nom lu)          : ${bSeul}`);
        console.log(`     AUCUN des deux                 : ${aucun}`);
        console.log(`\n     >>> ${bSeul > pSeul ? 'LE BANC A RAISON PLUS SOUVENT' : bSeul < pSeul ? 'LA PRODUCTION A RAISON PLUS SOUVENT' : 'ÉGALITÉ'}\n`);
        for (const d of M2.different) {
            console.log(`   ${d.cle} "${d.nom}" #${d.numero}  nomExact="${d.nomExact}"`);
            console.log(`      prod ${String(d.nProd).padStart(3)} cand. ${d.veriteDansProd ? '✅ contient' : '❌ sans'} · banc ${String(d.nBanc).padStart(3)} cand. ${d.veriteDansBanc ? '✅ contient' : '❌ sans'}   vérité ${d.verite} "${d.veriteNom}"`);
        }
    }
    if (M2.erreurs.length) for (const e of M2.erreurs) console.log(`   ⚠️ ${e.l.nom} : ${e.e}`);

    console.log('\n' + '═'.repeat(78));
    console.log('MESURE 3 — CE QUE VAUT LE 46/6/11 DU BANC SUR LE LOT DE DIAGNOSTIC');
    console.log('═'.repeat(78));
    console.log(`  cartes du seau « lot » avec vérité                    : ${M3.lot}`);
    console.log(`  ... dont le numéro est un numéro de Pokédex           : ${M3.estDex}   (${pc(M3.estDex, M3.lot)})`);
    console.log(`  ... ET qui passent par un scoring à plusieurs candidats: ${M3.estDexEtScoring}   (${pc(M3.estDexEtScoring, M3.lot)})`);
    console.log(`\n  >>> C'est sur ces ${M3.estDexEtScoring} cartes que le banc a mesuré un comportement`);
    console.log(`      que la production N'A PAS. Sur les autres, le chiffre du banc décrit`);
    console.log(`      bien la production quant à ce critère.`);

    await mongoose.disconnect();
})().catch(e => { console.error(e.stack); process.exit(1); });
