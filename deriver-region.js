// ============================================================
// DÉRIVATION DE LA RÉGION DES EXPANSIONS — écrit dans codes_set
// ============================================================
// LE PROBLÈME. regionDuCodeSet présumait « code en majuscules donc occidental ». Vrai
// pour les sets modernes, faux pour toute la moitié japonaise historique du catalogue :
// mesuré, 50 codes et 4620 produits, dont « Darkness-and-to-Light » à 2370 €, un XY
// japonais à 1933 €, « Plasma-Gale » à 1049 € et le « World-Champions-Pack » à 990 €.
// Tous prenaient -45 sur une carte japonaise, au bénéfice d'un mauvais candidat.
//
// UNE LISTE EN DUR NE SUFFIT PAS, ET LA DÉRIVATION SEULE NON PLUS. Mesuré : 12 des 29
// codes vérifiés à la main ne sont trouvés QUE par la liste (ils n'ont aucun tag TCGdex),
// et 26 autres ne sont trouvés QUE par la dérivation. D'où l'architecture : liste
// vérifiée + dérivation + trois états.
//
// LE PRINCIPE DE LA DÉRIVATION. L'API /v2/en/sets de TCGdex ne contient QUE des sets
// internationaux — 218, et sv2a / smP2 / s12a en sont absents. Donc :
//   - le nom d'expansion Cardmarket figure au catalogue  -> l'expansion EST ce set
//     international -> OCCIDENTAL
//   - il n'y figure pas, MAIS la place internationale de son tag TCGdex est occupée par
//     une AUTRE expansion dont le nom correspond -> c'est une autre édition du même
//     contenu -> JAPONAIS
//   - sinon -> INCONNU, et le critère région reste NEUTRE
//
// ⚠️ POURQUOI LA RÈGLE EST DURCIE AINSI. La version naïve — « le nom ne correspond pas
// donc japonais » — classait japonais 15 sets occidentaux majeurs, parce que Cardmarket
// a ses propres conventions de nommage : « EX-Unseen-Forces » contre « Unseen Forces »,
// « Pokemon-GO » contre « Pokémon GO », « ...-Additionals » contre le nom nu. La
// normalisation plie les accents et retire ces deux affixes ; et surtout on n'affirme le
// japonais que si quelqu'un d'autre occupe DÉMONTRABLEMENT la place internationale.
//
// TRAÇABILITÉ. Chaque expansion reçoit `region` ET `regionSource`, qui dit d'où vient la
// classification : le jour où un cas part de travers, la raison est lisible en base sans
// relire ce script.
//
// ⚠️ Ce script ne contacte JAMAIS Cardmarket. Un seul appel réseau : la liste des sets
//    TCGdex (lecture publique, une requête).
//
// IDEMPOTENT : la dérivation est déterministe, un second passage ne change rien.
//
// USAGE (la base doit être NOMMÉE, le script refuse de la deviner) :
//   node deriver-region.js --base=test                    (SIMULATION, n'écrit rien)
//   node deriver-region.js --base=test --detail            (+ la liste complète)
//   node deriver-region.js --base=test --ecrire --confirmer-production
//
// ⚠️ Sauvegarde AVANT :
//    node backup-collections.js --base=test --collections=codes_set --dossier=backup-avant-region

require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');
const { CODES_JAPONAIS_MAJUSCULES } = require('./scoring');

const ECRIRE = process.argv.includes('--ecrire');
const DETAIL = process.argv.includes('--detail');
const LOT = 500;

const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({}, { strict: false }), 'codes_set');
const CatalogueProduit = mongoose.model('CatalogueProduit', new mongoose.Schema({}, { strict: false }), 'catalogue_produits');

// Normalisation des noms d'expansion. Les trois affixes retirés sont des écarts de
// CONVENTION mesurés entre Cardmarket et TCGdex, pas des différences de région.
const nrm = s => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // "Pokémon" -> "Pokemon"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/additionals$/, '')                        // "...-Additionals" -> nom nu
    .replace(/^ex(?=[a-z])/, '');                       // "EX-Unseen-Forces" -> "unseenforces"

// L'ancienne règle, pour mesurer précisément ce qui change.
const ancienneRegion = c => {
    if (!c) return null;
    const code = String(c).replace(/^x/, '');
    if (/^[A-Z0-9]+$/.test(code) && /[A-Z]/.test(code)) return 'occidental';
    if (/[a-z]/.test(code)) return 'japonais';
    return null;
};

async function lancer() {
    await connecterMongo({ script: 'deriver-region.js', ecrit: ECRIRE, confirmationProduction: true });
    console.log(ECRIRE
        ? "\n✍️  MODE ÉCRITURE — les documents vont être modifiés.\n"
        : "\n👀 MODE SIMULATION (dry-run) — aucune écriture. Ajoute --ecrire pour appliquer.\n");

    // ---- Catalogue international TCGdex ------------------------------------
    let sets;
    try {
        sets = (await axios.get('https://api.tcgdex.net/v2/en/sets', { timeout: 20000 })).data;
    } catch (e) {
        console.error(`❌ ARRÊT : liste des sets TCGdex indisponible (${e.message}).`);
        console.error("   Sans elle, aucune expansion ne pourrait être classée occidentale :");
        console.error("   écrire maintenant reviendrait à effacer les régions connues.");
        await mongoose.disconnect();
        process.exit(1);
    }
    if (!Array.isArray(sets) || sets.length < 100) {
        console.error(`❌ ARRÊT : réponse TCGdex inattendue (${Array.isArray(sets) ? sets.length : typeof sets} sets, ${100} attendus au minimum).`);
        await mongoose.disconnect();
        process.exit(1);
    }
    const nomParTag = new Map(sets.map(s => [s.id, s.name]));
    const nomsInternationaux = new Set(sets.map(s => nrm(s.name)));
    console.log(`🌐 TCGdex : ${sets.length} sets internationaux, ${nomsInternationaux.size} noms distincts après normalisation.`);

    // ---- Matière locale ----------------------------------------------------
    const lignes = await CodeSet.find({}).lean();
    // ⚠️ Filtrer AVANT de grouper : $first sur un groupe non trié peut tomber sur un
    // document dont slugSet est nul, et l'expansion passerait pour anonyme à tort
    // (mesuré : TEU et GRI, deux sets occidentaux majeurs, disparaissaient ainsi).
    const slugParExp = new Map();
    for (const e of await NumeroCarte.aggregate([
        { $match: { slugSet: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$idExpansion', s: { $first: '$slugSet' } } }
    ])) slugParExp.set(e._id, e.s);
    const tagsParExp = new Map();
    for (const e of await NumeroCarte.aggregate([
        { $match: { setTcgdex: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$idExpansion', t: { $addToSet: '$setTcgdex' } } }
    ])) tagsParExp.set(e._id, e.t);
    const nbParExp = new Map();
    for (const e of await CatalogueProduit.aggregate([{ $group: { _id: '$idExpansion', n: { $sum: 1 } } }])) nbParExp.set(e._id, e.n);
    const expParTag = new Map();
    for (const [e, ts] of tagsParExp) for (const t of ts) {
        if (!expParTag.has(t)) expParTag.set(t, []);
        expParTag.get(t).push(e);
    }
    const codeParExp = new Map(lignes.map(l => [l.idExpansion, l.codeSet]));

    /**
     * @returns {{region:'occidental'|'japonais'|null, source:string}}
     *   `source` est écrite en base : c'est la traçabilité de la classification.
     */
    function deriver(code, exp) {
        if (!code) return { region: null, source: 'pas-de-code' };
        const c = String(code).replace(/^x/, '');
        // Preuves tirées du code lui-même, les plus sûres.
        if (/[a-z]/.test(c)) return { region: 'japonais', source: 'code-minuscule' };
        if (/-JP$/i.test(c)) return { region: 'japonais', source: 'code-suffixe-JP' };
        if (CODES_JAPONAIS_MAJUSCULES.has(c.toUpperCase())) return { region: 'japonais', source: 'liste-verifiee' };

        const slug = nrm(slugParExp.get(exp));
        const tags = tagsParExp.get(exp) || [];
        // Le nom figure au catalogue international : l'expansion EST ce set.
        if (slug && nomsInternationaux.has(slug)) return { region: 'occidental', source: 'nom-au-catalogue-tcgdex' };
        if (slug && tags.length) {
            for (const t of tags) {
                const n = nomParTag.get(t);
                if (n && nrm(n) === slug) return { region: 'occidental', source: `nom-egal-set-${t}` };
            }
            // La place internationale du tag est-elle prise par quelqu'un d'autre ?
            for (const t of tags) {
                const n = nomParTag.get(t);
                if (!n) continue;
                const occupant = (expParTag.get(t) || []).find(e2 => e2 !== exp && nrm(slugParExp.get(e2)) === nrm(n));
                if (occupant) return { region: 'japonais', source: `place-internationale-prise-par-${codeParExp.get(occupant) || occupant}` };
            }
        }
        if (!slug) return { region: null, source: 'sans-nom-d-expansion' };
        return { region: null, source: tags.length ? 'nom-different-place-libre' : 'nom-hors-catalogue' };
    }

    // ---- Analyse AVANT écriture -------------------------------------------
    const resultats = [];
    const transitions = new Map();
    const parSource = new Map();
    const etats = { occidental: { exp: 0, prod: 0 }, japonais: { exp: 0, prod: 0 }, inconnu: { exp: 0, prod: 0 } };
    let totalProd = 0;
    // RÉGRESSION = la direction NUISIBLE : une expansion que le code lui-même prouve
    // japonaise (minuscule, -JP, liste vérifiée) et que la dérivation déclarerait
    // occidentale. Elle infligerait -45 au bon candidat sur une carte japonaise, c'est-à-
    // dire exactement le bug qu'on répare. Zéro toléré.
    const regressions = [];

    for (const l of lignes) {
        const nb = nbParExp.get(l.idExpansion) || 0;
        totalProd += nb;
        const d = deriver(l.codeSet, l.idExpansion);
        const avant = ancienneRegion(l.codeSet);
        const cle = `${avant ?? 'neutre'} -> ${d.region ?? 'inconnu'}`;
        if (!transitions.has(cle)) transitions.set(cle, { exp: 0, prod: 0 });
        transitions.get(cle).exp++; transitions.get(cle).prod += nb;
        const sc = d.source.replace(/-(par|set)-.*$/, '-…');
        if (!parSource.has(sc)) parSource.set(sc, { exp: 0, prod: 0 });
        parSource.get(sc).exp++; parSource.get(sc).prod += nb;
        const k = d.region || 'inconnu';
        etats[k].exp++; etats[k].prod += nb;
        if (avant === 'japonais' && d.region === 'occidental') regressions.push({ code: l.codeSet, exp: l.idExpansion, nb, source: d.source });
        resultats.push({ exp: l.idExpansion, code: l.codeSet, nb, avant, ...d, dejaEnBase: l.region ?? null, sourceEnBase: l.regionSource ?? null });
    }

    console.log('='.repeat(96));
    console.log(`COLLECTION codes_set — ${lignes.length} expansions, ${totalProd} produits`);
    console.log('='.repeat(96));
    console.log('\n  ── LES TROIS ÉTATS ──');
    console.log('  état          expansions            produits');
    console.log('  ' + '-'.repeat(50));
    for (const [k, v] of Object.entries(etats)) {
        console.log(`  ${k.padEnd(14)}${String(v.exp).padStart(5)} (${(100 * v.exp / lignes.length).toFixed(1).padStart(5)} %)  ${String(v.prod).padStart(7)} (${(100 * v.prod / totalProd).toFixed(1).padStart(5)} %)`);
    }

    console.log('\n  ── TRANSITIONS depuis l\'ancienne règle ──');
    for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1].prod - a[1].prod)) {
        console.log(`  ${k.padEnd(26)}${String(v.exp).padStart(5)} exp ${String(v.prod).padStart(8)} prod  ${(100 * v.prod / totalProd).toFixed(1).padStart(5)} %`);
    }

    console.log('\n  ── SOURCE DE CHAQUE CLASSIFICATION (écrite en base) ──');
    for (const [k, v] of [...parSource.entries()].sort((a, b) => b[1].prod - a[1].prod)) {
        console.log(`  ${k.padEnd(34)}${String(v.exp).padStart(5)} exp ${String(v.prod).padStart(8)} prod`);
    }

    // ---- CONTRÔLE PAR LES TÉMOINS -----------------------------------------
    // Témoins = les expansions dont le CODE prouve à lui seul la région (minuscule,
    // suffixe -JP, liste vérifiée). La dérivation doit être d'accord avec toutes.
    const temoins = resultats.filter(r => ['code-minuscule', 'code-suffixe-JP', 'liste-verifiee'].includes(r.source));
    const temoinsFaux = temoins.filter(r => r.region !== 'japonais');
    console.log('\n  ── CONTRÔLE PAR LES TÉMOINS ──');
    console.log(`  ${temoins.length} expansions dont le code PROUVE la région à lui seul : ${temoinsFaux.length} désaccord(s).`);
    console.log(`  RÉGRESSIONS (japonais prouvé -> déclaré occidental) : ${regressions.length}${regressions.length ? '   ⚠️' : '   ✅'}`);
    for (const r of regressions.slice(0, 20)) console.log(`     ${String(r.code).padEnd(10)} exp=${r.exp} ${r.nb} prod  source=${r.source}`);

    // Ce qui perd le statut occidental, ventilé — c'est le seul coût réel.
    const perdent = resultats.filter(r => r.avant === 'occidental' && r.region === null);
    console.log('\n  ── CE QUI PERD LE STATUT OCCIDENTAL (devient NEUTRE) ──');
    console.log(`  ${perdent.length} expansions, ${perdent.reduce((s, r) => s + r.nb, 0)} produits.`);
    console.log('  Les 20 plus grosses :');
    for (const r of perdent.sort((a, b) => b.nb - a.nb).slice(0, 20)) {
        console.log(`     ${String(r.code).padEnd(10)}${String(r.nb).padStart(5)} prod  ${r.source.padEnd(26)} "${String(slugParExp.get(r.exp)).slice(0, 34)}"`);
    }

    const requalifies = resultats.filter(r => r.avant === 'occidental' && r.region === 'japonais');
    console.log('\n  ── REQUALIFIÉES JAPONAISES (le bug corrigé) ──');
    console.log(`  ${requalifies.length} expansions, ${requalifies.reduce((s, r) => s + r.nb, 0)} produits.`);
    for (const r of requalifies.sort((a, b) => b.nb - a.nb).slice(0, DETAIL ? 999 : 20)) {
        console.log(`     ${String(r.code).padEnd(10)}${String(r.nb).padStart(5)} prod  ${r.source.padEnd(38)} "${String(slugParExp.get(r.exp)).slice(0, 32)}"`);
    }

    if (DETAIL) {
        console.log('\n  ── DÉTAIL COMPLET ──');
        for (const r of resultats.sort((a, b) => b.nb - a.nb)) {
            console.log(`     ${String(r.code).padEnd(10)} exp=${String(r.exp).padEnd(6)}${String(r.nb).padStart(5)} prod  ${String(r.region ?? 'inconnu').padEnd(11)} ${r.source}`);
        }
    }

    // Documents à écrire : seuls ceux dont region ou regionSource change réellement.
    const aEcrire = resultats.filter(r => r.region !== r.dejaEnBase || r.source !== r.sourceEnBase);
    console.log(`\n  ${aEcrire.length} expansion(s) à mettre à jour (region et/ou regionSource différentes de la base).`);

    if (!ECRIRE) {
        console.log("\n  (simulation : rien n'a été écrit)");
        console.log('='.repeat(96));
        await mongoose.disconnect();
        return;
    }
    if (regressions.length > 0 && !process.argv.includes('--accepter-regressions')) {
        console.error(`\n❌ ARRÊT : ${regressions.length} régression(s) — des expansions prouvées japonaises seraient déclarées occidentales.`);
        console.error(`   C'est exactement le bug qu'on répare. Examine la liste ci-dessus.`);
        console.error(`   Pour écrire malgré tout : --accepter-regressions`);
        await mongoose.disconnect();
        process.exit(1);
    }
    if (temoinsFaux.length > 0) {
        console.error(`\n❌ ARRÊT : ${temoinsFaux.length} témoin(s) en désaccord avec la dérivation. Aucune écriture.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    // ---- Écriture par paquets ----------------------------------------------
    let modifies = 0;
    for (let i = 0; i < aEcrire.length; i += LOT) {
        const paquet = aEcrire.slice(i, i + LOT);
        const r = await CodeSet.bulkWrite(paquet.map(x => ({
            updateOne: {
                filter: { idExpansion: x.exp },
                // region peut valoir null : c'est un RÉSULTAT (inconnu), pas une absence
                // de donnée. On l'écrit explicitement pour que regionSource l'explique.
                update: { $set: { region: x.region, regionSource: x.source, regionDeriveeLe: new Date() } }
            }
        })), { ordered: false });
        modifies += r.modifiedCount ?? r.nModified ?? 0;
        console.log(`  ✍️  ${Math.min(i + LOT, aEcrire.length)}/${aEcrire.length} traitées (${modifies} modifiées)`);
    }

    // ---- Contrôle post-écriture, en RELISANT la base ------------------------
    const relues = await CodeSet.find({}, { idExpansion: 1, codeSet: 1, region: 1, regionSource: 1 }).lean();
    const attendu = new Map(resultats.map(r => [r.exp, r.region]));
    let ecarts = 0, sansSource = 0;
    const compteRelu = { occidental: 0, japonais: 0, inconnu: 0 };
    for (const d of relues) {
        const r = d.region ?? null;
        compteRelu[r || 'inconnu']++;
        if (attendu.has(d.idExpansion) && (attendu.get(d.idExpansion) ?? null) !== r) ecarts++;
        if (!d.regionSource) sansSource++;
    }
    console.log('');
    console.log(`  ✅ ${modifies} expansion(s) modifiée(s) sur ${aEcrire.length} attendue(s).`);
    console.log(`  ✅ Relecture : occidental=${compteRelu.occidental} japonais=${compteRelu.japonais} inconnu=${compteRelu.inconnu}`);
    console.log(`  ✅ Écarts entre la base relue et la dérivation : ${ecarts} (attendu : 0).`);
    console.log(`  ✅ Expansions sans regionSource : ${sansSource} (attendu : 0).`);
    if (ecarts || sansSource) {
        console.log(`  ⚠️ ÉCART — relance le script, il est idempotent.`);
    } else {
        console.log(`  ℹ️ Idempotence : relance ce script, il doit annoncer 0 expansion à mettre à jour.`);
    }
    console.log('='.repeat(96));

    await mongoose.disconnect();
}

lancer().catch(async e => {
    console.error("❌ Erreur :", e.message);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
